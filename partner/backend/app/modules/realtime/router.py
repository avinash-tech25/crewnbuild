"""The live websockets (the old Partner dispatch_routes.ws_router and tracking_routes.ws_router;
paths unchanged, under /api/v1).

    /dispatch/ws/technician              job offers for the signed-in technician
    /tracking/ws/bookings/{booking_id}   the live journey, for that booking's requester

Sign-in is the session cookie sent with the handshake, never a token in the URL or the
subprotocol, and the handshake's Origin must be an allowed one, as in Professional. The
subprotocol names the protocol and is still required. An open socket re-checks its
session every WEBSOCKET_SESSION_RECHECK_SECONDS: sign-out, revocation, expiry, suspension
or (for a requester) losing the right to book closes it. Live location reaches only the
socket of that booking's requester, and only while the booking is active (the tracking
service decides what is sent).
"""

import asyncio
import json
import logging
import uuid
from collections.abc import Callable

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool
from starlette.requests import HTTPConnection

from app.core.config import Settings
from app.core.middleware import is_allowed_origin
from app.core.runtime import settings as runtime_settings
from app.core.security.access_tokens import SCOPE_PARTNER, read_requester_access, read_technician_access
from app.core.security.session_cookies import REQUESTER, TECHNICIAN, access_token_from
from app.database.session import SessionLocal
from app.modules.bookings.dependencies import build_tracking_service, get_realtime
from app.modules.identity.models import PRINCIPAL_REQUESTER, PRINCIPAL_TECHNICIAN, STEP_COMPLETE, Technician
from app.modules.identity.repository import TechnicianRepository
from app.modules.identity.session_service import SessionService
from app.modules.realtime.hub import TOPIC_BOOKING, TOPIC_TECHNICIAN, guard_session, pump
from app.modules.requesters.repository import Requester, RequesterRepository
from app.modules.requesters.service import RequesterIdentityService
from app.modules.tracking.tracking_service import EVENT_SNAPSHOT

logger = logging.getLogger(__name__)

router = APIRouter()

DISPATCH_SUBPROTOCOL = "partner.dispatch.v1"
TRACKING_SUBPROTOCOL = "partner.tracking.v1"
WS_POLICY_VIOLATION = 1008


def offered_subprotocol(websocket: WebSocket, name: str) -> str | None:
    """The subprotocol, if the client offered it. Still required; it carries no token."""
    return name if name in (websocket.scope.get("subprotocols") or []) else None


def _settings(connection: HTTPConnection) -> Settings:
    configured: Settings = connection.app.state.settings
    return configured


def _origin_allowed(connection: HTTPConnection) -> bool:
    origin = connection.headers.get("origin")
    return origin is None or is_allowed_origin(origin, _settings(connection))


# ---- technicians ----


def technician_for_socket(connection: HTTPConnection, database: Session) -> Technician | None:
    """The technician behind a handshake: a live dashboard session, an account that is
    active and finished registering, and an allowed Origin (the checks of a request)."""
    settings = _settings(connection)
    if not _origin_allowed(connection):
        return None
    claims = read_technician_access(settings, access_token_from(connection, settings, TECHNICIAN) or "")
    if claims is None or claims.scope != SCOPE_PARTNER:
        return None
    if SessionService(database, settings).validate(claims, PRINCIPAL_TECHNICIAN) is None:
        return None
    technician = TechnicianRepository(database).get(claims.user_id)
    if technician is None or technician.is_suspended or not technician.is_active:
        return None
    return technician if technician.onboarding_step == STEP_COMPLETE else None


def technician_socket_still_valid(connection: HTTPConnection, database: Session) -> bool:
    """The same rules as at the handshake, except that the access token's own minutes are
    not counted: its session family must still be live instead (it survives refreshes)."""
    settings = _settings(connection)
    claims = read_technician_access(
        settings, access_token_from(connection, settings, TECHNICIAN) or "", allow_expired=True
    )
    if claims is None or claims.scope != SCOPE_PARTNER:
        return False
    if not SessionService(database, settings).family_is_live(claims, PRINCIPAL_TECHNICIAN):
        return False
    technician = TechnicianRepository(database).get(claims.user_id)
    return (
        technician is not None
        and not technician.is_suspended
        and technician.is_active
        and technician.onboarding_step == STEP_COMPLETE
    )


# ---- requesters ----


def requester_for_socket(connection: HTTPConnection, database: Session) -> tuple[Requester, str]:
    """The booking account behind a handshake, or an HTTP error (the request rules)."""
    settings = _settings(connection)
    if not _origin_allowed(connection):
        raise HTTPException(status_code=403, detail="Origin not allowed")
    claims = read_requester_access(settings, access_token_from(connection, settings, REQUESTER) or "")
    if claims is None or SessionService(database, settings).validate(claims, PRINCIPAL_REQUESTER) is None:
        raise HTTPException(status_code=401, detail="Booking session required")
    identity = RequesterIdentityService(RequesterRepository(database, settings.professional_schema), settings)
    return identity.resolve_account(claims.user_id)


def requester_socket_still_valid(connection: HTTPConnection, database: Session) -> bool:
    settings = _settings(connection)
    claims = read_requester_access(
        settings, access_token_from(connection, settings, REQUESTER) or "", allow_expired=True
    )
    if claims is None or not SessionService(database, settings).family_is_live(claims, PRINCIPAL_REQUESTER):
        return False
    try:
        RequesterIdentityService(RequesterRepository(database, settings.professional_schema), settings).resolve_account(
            claims.user_id
        )
    except HTTPException:
        return False
    return True


def socket_session_check(
    check: Callable[[HTTPConnection, Session], bool], connection: HTTPConnection
) -> Callable[[], bool]:
    """A no-argument re-check for an open socket. Each call opens its own short database
    session; the socket holds no connection for its lifetime."""

    def still_valid() -> bool:
        with database_session() as session:
            return check(connection, session)

    return still_valid


def database_session() -> Session:
    """A short session for a socket's own checks (the tests point it at their transaction)."""
    return SessionLocal()


# ---- the sockets ----


@router.websocket("/dispatch/ws/technician")
async def technician_stream(websocket: WebSocket) -> None:
    """Live job requests for one technician. The room is the technician's own id, taken from
    their verified session, so a socket only ever receives what was offered to that account."""
    if offered_subprotocol(websocket, DISPATCH_SUBPROTOCOL) is None:
        await websocket.close(code=WS_POLICY_VIOLATION)
        return
    still_valid = socket_session_check(technician_socket_still_valid, websocket)

    def admit() -> uuid.UUID | None:
        with database_session() as session:
            technician = technician_for_socket(websocket, session)
            return technician.id if technician is not None else None

    technician_id = await run_in_threadpool(admit)
    if technician_id is None:
        await websocket.close(code=WS_POLICY_VIOLATION)
        return

    hub = get_realtime()
    await websocket.accept(subprotocol=DISPATCH_SUBPROTOCOL)
    subscription = hub.subscribe(TOPIC_TECHNICIAN, technician_id)
    sender = asyncio.create_task(pump(subscription, websocket))
    guard = asyncio.create_task(
        guard_session(websocket, still_valid, runtime_settings.websocket_session_recheck_seconds)
    )
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                message = json.loads(raw)
            except ValueError:
                continue  # a malformed frame is ignored, never a reason to drop the client
            if isinstance(message, dict) and message.get("type") == "ping":
                subscription.offer({"type": "pong"})
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("Dispatch socket error for technician %s", technician_id)
    finally:
        sender.cancel()
        guard.cancel()
        hub.unsubscribe(subscription)


@router.websocket("/tracking/ws/bookings/{booking_id}")
async def tracking_stream(websocket: WebSocket, booking_id: uuid.UUID) -> None:
    """The live journey for the House Owner or Site Engineer who made this booking. Admitted
    only after the requester session is verified and the booking is loaded as theirs, so a
    room can never be joined by guessing a booking id."""
    if offered_subprotocol(websocket, TRACKING_SUBPROTOCOL) is None:
        await websocket.close(code=WS_POLICY_VIOLATION)
        return

    def authorise() -> dict[str, object]:
        with database_session() as session:
            requester, _role = requester_for_socket(websocket, session)
            tracking = build_tracking_service(session)
            booking = tracking.load_for_requester(requester, booking_id)
            snapshot: dict[str, object] = tracking.snapshot_for_booking(booking).model_dump(mode="json")
            return snapshot

    still_valid = socket_session_check(requester_socket_still_valid, websocket)
    try:
        snapshot = await run_in_threadpool(authorise)
    except HTTPException as error:
        logger.info("Tracking socket refused for booking %s: %s", booking_id, error.status_code)
        await websocket.close(code=WS_POLICY_VIOLATION)
        return
    except Exception:
        logger.exception("Could not open the tracking socket for booking %s", booking_id)
        await websocket.close(code=WS_POLICY_VIOLATION)
        return

    hub = get_realtime()
    await websocket.accept(subprotocol=TRACKING_SUBPROTOCOL)
    subscription = hub.subscribe(TOPIC_BOOKING, booking_id)
    subscription.offer({"type": EVENT_SNAPSHOT, "tracking": snapshot})
    sender = asyncio.create_task(pump(subscription, websocket))
    guard = asyncio.create_task(
        guard_session(websocket, still_valid, runtime_settings.websocket_session_recheck_seconds)
    )
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                message = json.loads(raw)
            except ValueError:
                continue
            if isinstance(message, dict) and message.get("type") == "ping":
                subscription.offer({"type": "pong"})
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("Tracking socket error on booking %s", booking_id)
    finally:
        sender.cancel()
        guard.cancel()
        hub.unsubscribe(subscription)

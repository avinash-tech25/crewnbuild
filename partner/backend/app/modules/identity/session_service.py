"""Server-side Partner sessions for both principals: technicians and requesters (the old
app/shared/sessions/services/session_service.py, same rules).

A session is a family of rows, one per refresh token (models.Session). An access token
names its row (`sid`) and family (`fam`) and is honoured only while that row is live:
not revoked, inside the family's absolute lifetime and, for a technician, refreshed
recently enough. Refreshing retires the row it used and adds the next; a retired refresh
token presented again means it was copied, and the whole family is revoked (except two
tabs refreshing at once, REFRESH_SUPERSEDED). A technician session lasts
REFRESH_TOKEN_DAYS, a booking (requester) session REQUESTER_SESSION_MINUTES.
"""

import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.security.access_tokens import (
    AccessClaims,
    create_access_token,
    create_requester_access_token,
    csrf_token_for,
    new_refresh_token,
    token_digest,
)
from app.core.security.session_cookies import ClientInfo
from app.database.base import new_uuid7
from app.database.types import naive_utc_now
from app.modules.identity.models import (
    PRINCIPAL_REQUESTER,
    PRINCIPAL_TECHNICIAN,
    REVOKED_EXPIRED,
    REVOKED_LOGOUT,
    REVOKED_PASSWORD_CHANGE,
    REVOKED_REUSE,
    REVOKED_ROTATED,
)
from app.modules.identity.models import Session as AuthSession
from app.modules.identity.repository import SessionRepository

SESSION_EXPIRED_MESSAGE = "Session expired. Please sign in again."
# 401 when another tab rotated this refresh token a moment ago; the client retries its
# request with the cookie that rotation already set.
REFRESH_SUPERSEDED = "REFRESH_SUPERSEDED"


@dataclass(frozen=True)
class IssuedSession:
    session_id: uuid.UUID
    family_id: uuid.UUID
    principal_type: str
    user_id: uuid.UUID
    scope: str | None
    access_token: str
    refresh_token: str
    csrf_token: str
    expires_at: datetime


def session_expired() -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=SESSION_EXPIRED_MESSAGE)


class SessionService:
    def __init__(self, database: Session, settings: Settings) -> None:
        self.database = database
        self.repository = SessionRepository(database)
        self.settings = settings

    # ---- start ----

    def start_technician(self, user_id: uuid.UUID, scope: str, client: ClientInfo) -> IssuedSession:
        """A new technician session for credentials (or an e-mail code) just verified."""
        now = naive_utc_now()
        issued = self._issue(
            PRINCIPAL_TECHNICIAN,
            user_id,
            scope,
            new_uuid7(),
            now + timedelta(days=self.settings.refresh_token_days),
            client,
            now,
        )
        self.database.commit()
        return issued

    def start_requester(self, account_id: uuid.UUID, handoff_jti: str, client: ClientInfo) -> IssuedSession:
        """A new booking session for a Professional account, from a one-time hand-off. The
        hand-off id is stored with the session under a unique constraint, so the same
        hand-off can never start a second session, however it is replayed."""
        if self.repository.exists_handoff(handoff_jti):
            raise session_expired()
        now = naive_utc_now()
        issued = self._issue(
            PRINCIPAL_REQUESTER,
            account_id,
            None,
            new_uuid7(),
            now + timedelta(minutes=self.settings.requester_session_minutes),
            client,
            now,
            handoff_jti=handoff_jti,
        )
        try:
            self.database.commit()
        except IntegrityError:
            self.database.rollback()
            raise session_expired() from None
        return issued

    def _issue(
        self,
        principal_type: str,
        user_id: uuid.UUID,
        scope: str | None,
        family_id: uuid.UUID,
        expires_at: datetime,
        client: ClientInfo,
        now: datetime,
        handoff_jti: str | None = None,
    ) -> IssuedSession:
        refresh_token = new_refresh_token()
        row = AuthSession(
            id=new_uuid7(),
            principal_type=principal_type,
            user_id=user_id,
            scope=scope,
            refresh_token_hash=token_digest(refresh_token),
            token_family_id=family_id,
            created_at=now,
            last_used_at=now,
            expires_at=expires_at,
            user_agent=(client.user_agent or "")[:400] or None,
            ip_address=(client.ip_address or "")[:64] or None,
            handoff_jti=handoff_jti,
        )
        self.database.add(row)
        self.database.flush()
        if principal_type == PRINCIPAL_TECHNICIAN:
            access_token = create_access_token(self.settings, user_id, scope or "", row.id, family_id)
        else:
            access_token = create_requester_access_token(self.settings, user_id, row.id, family_id)
        return IssuedSession(
            session_id=row.id,
            family_id=family_id,
            principal_type=principal_type,
            user_id=user_id,
            scope=scope,
            access_token=access_token,
            refresh_token=refresh_token,
            csrf_token=csrf_token_for(self.settings, family_id),
            expires_at=expires_at,
        )

    # ---- validate ----

    def _is_live(self, row: AuthSession, now: datetime) -> bool:
        if row.revoked_at is not None or row.expires_at <= now:
            return False
        if row.principal_type == PRINCIPAL_TECHNICIAN:
            return row.last_used_at + timedelta(days=self.settings.session_idle_days) > now
        return True

    def validate(self, claims: AccessClaims, principal_type: str) -> AuthSession | None:
        """The live session an access token names, for this kind of principal, or None."""
        row = self.repository.get(claims.session_id)
        if (
            row is None
            or row.principal_type != principal_type
            or row.user_id != claims.user_id
            or row.token_family_id != claims.family_id
            or row.scope != claims.scope
        ):
            return None
        return row if self._is_live(row, naive_utc_now()) else None

    def family_is_live(self, claims: AccessClaims, principal_type: str) -> bool:
        """Whether the sign-in an access token belongs to is still live (an open websocket
        outlives the row it was admitted with: a refresh retires that row but continues
        the family). Sign-out, reuse detection, a password change and expiry all end it."""
        now = naive_utc_now()
        return any(
            row.principal_type == principal_type
            and row.user_id == claims.user_id
            and row.scope == claims.scope
            and self._is_live(row, now)
            for row in self.repository.list_unrevoked_in_family(claims.family_id)
        )

    # ---- rotate ----

    def rotate(
        self,
        refresh_token: str,
        principal_type: str,
        client: ClientInfo,
        require_principal: Callable[[uuid.UUID], Any],
    ) -> tuple[IssuedSession, Any]:
        """Exchange a live refresh token for the next one in its family. `require_principal`
        loads the account and raises when it may not hold a session; it runs before
        anything new is issued, and what it returns is handed back with the session."""
        now = naive_utc_now()
        row = self.repository.lock_by_refresh_hash(token_digest(refresh_token))
        if row is None or row.principal_type != principal_type:
            self.database.rollback()
            raise session_expired()
        if row.revoked_at is not None:
            recently_rotated = row.revoke_reason == REVOKED_ROTATED and row.revoked_at >= now - timedelta(
                seconds=self.settings.refresh_reuse_grace_seconds
            )
            if recently_rotated:
                self.database.rollback()
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=REFRESH_SUPERSEDED)
            # A retired token came back: someone kept a copy. End the whole family.
            self.repository.revoke_family(row.token_family_id, REVOKED_REUSE, now)
            self.database.commit()
            raise session_expired()
        if not self._is_live(row, now):
            row.revoked_at = now
            row.revoke_reason = REVOKED_EXPIRED
            self.database.commit()
            raise session_expired()
        try:
            principal = require_principal(row.user_id)
        except HTTPException:
            self.database.rollback()
            raise
        issued = self._issue(
            row.principal_type, row.user_id, row.scope, row.token_family_id, row.expires_at, client, now
        )
        row.revoked_at = now
        row.revoke_reason = REVOKED_ROTATED
        row.replaced_by_session_id = issued.session_id
        self.database.commit()
        return issued, principal

    # ---- end ----

    def end_by_refresh_token(self, refresh_token: str, principal_type: str) -> None:
        row = self.repository.lock_by_refresh_hash(token_digest(refresh_token))
        if row is not None and row.principal_type == principal_type:
            self.repository.revoke_family(row.token_family_id, REVOKED_LOGOUT, naive_utc_now())
        self.database.commit()

    def end_family(self, family_id: uuid.UUID) -> None:
        self.repository.revoke_family(family_id, REVOKED_LOGOUT, naive_utc_now())
        self.database.commit()

    def revoke_technician_sessions_after_password_change(self, user_id: uuid.UUID) -> None:
        """Staged in the caller's transaction, so the sessions end exactly when the new
        password is committed."""
        self.repository.revoke_all_for(PRINCIPAL_TECHNICIAN, user_id, REVOKED_PASSWORD_CHANGE, naive_utc_now())

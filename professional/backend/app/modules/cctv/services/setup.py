"""First-time DVR/NVR setup, per user, against a project's shared recorder.

    status()   which screen the Live Camera entry point should show
    connect()  verify the credentials a user typed, then grant them access

THE SHAPE OF THE THING

A project has ONE recorder and one set of cameras:

    4BHK, Nanakramguda -> DVR/NVR -> Camera 1, Camera 2, Camera 3

House Owner, Builder and Site Engineer all end up looking at that same
recorder. What each of them must do first is prove, once, that they hold its
credentials; that proof is a row in `cctv_project_access`. The device is never
duplicated per user, and `cctv_devices.created_by_user_id` is never consulted --
whoever registered the recorder is not its owner, only the first person who
verified it.

WHY THE SUPPLIED CREDENTIALS ARE USED, NOT THE STORED ONES

`connectivity.verify_device` verifies with the credentials already stored on the
device, which is right for a health check and useless as a gate: the second
person to arrive would prove nothing by pressing a button. So for a recorder
that already exists, this module authenticates with the username and password
THIS user typed, live, against the device.

`cctv_device_credentials` is UNIQUE(device_id) -- one row per recorder -- so the
supplied credentials are never written there: overwriting would hand the shared
recorder a different login and break it for everyone who came before. They are
used for the ONVIF exchange, then dropped. Only the first registration, which
creates the device, stores credentials at all.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from fastapi import Request, status
from sqlalchemy.orm import Session

from app.modules.cctv.models import CctvDevice, CctvDeviceCredential, CctvProjectAccess
from app.modules.cctv.repository import CctvRepository
from app.modules.cctv.schemas import (
    CctvCameraSetupOut,
    CctvCameraSetupStatusOut,
    CctvCameraSetupSubmit,
    CctvDiscoveredChannelSelection,
    CctvDiscoveredChannelsSave,
)
from app.modules.cctv.services import access, audit, cctv_error, connectivity, devices, field_error, network_policy
from app.modules.cctv.services import credentials as credential_service
from app.modules.cctv.services import onvif_client as onvif
from app.modules.identity.models import User

CODE_VERIFICATION_FAILED = "CCTV_SETUP_VERIFICATION_FAILED"
CODE_NO_CHANNELS = "CCTV_SETUP_NO_CHANNELS"

# The verification results that count as "these credentials are good".
#
# AUTHENTICATION_NOT_ENFORCED is deliberately NOT here. It means the recorder
# answered an authenticated request without being asked for credentials, so
# nothing was proved about the ones typed -- and letting that grant access would
# make the gate meaningless on exactly the devices least able to defend
# themselves.
ACCEPTED_RESULTS = frozenset({onvif.RESULT_DEVICE_VERIFIED})


def utc_now() -> datetime:
    return datetime.now(UTC)


# --- status ------------------------------------------------------------------


def _project_device(database: Session, project_id: uuid.UUID, host: str | None = None) -> CctvDevice | None:
    """The project's recorder. One project, one recorder, so the first by
    creation order is it; `host` narrows the match when a caller names one."""
    return CctvRepository(database).find_project_device(project_id, host)


def _channel_counts(database: Session, device_id: uuid.UUID | None) -> tuple[int, int]:
    if device_id is None:
        return 0, 0
    row = CctvRepository(database).find_device_channel_counts(device_id)
    return (row[0] or 0, row[1] or 0) if row else (0, 0)


def status_for(database: Session, user: User, project_id: uuid.UUID, request: Request) -> CctvCameraSetupStatusOut:
    """Which screen to show. Needs project authorization only -- a user who has
    not verified yet still has to be told that a setup step exists."""
    grant = access.authorize_project(database, user, project_id, request)
    device = _project_device(database, project_id)
    row = access.project_access_row(database, user.id, project_id)
    # A grant issued against a recorder that is no longer on this project is not
    # access to the project's camera.
    #
    # Membership, not identity with `device` above: a project that somehow holds
    # more than one recorder would otherwise read a perfectly good grant on the
    # second one as "not set up", and send that user round the setup form
    # forever -- where connect() would then refuse them for naming a different
    # address. Enforcement stays strict: project_access_active() is called with
    # the id of the device actually being reached.
    live = row is not None and CctvRepository(database).exists_project_device(project_id, row.device_id)
    total, enabled = _channel_counts(database, device.id if device else None)
    return CctvCameraSetupStatusOut(
        project_id=project_id,
        project_title=grant.project.title,
        has_device=device is not None,
        access_granted=live,
        verified_at=row.verified_at if live and row else None,
        channel_count=total,
        enabled_channel_count=enabled,
    )


# --- verification with supplied credentials ----------------------------------


@dataclass
class _Attempt:
    result: str
    reason: str | None
    information: object | None = None


def _verify_supplied(device: CctvDevice, host: str, service_path: str, plain) -> _Attempt:
    """Authenticate against the recorder with the credentials this user typed.

    Reuses the existing ONVIF client, timeouts and reachability classification.
    Nothing is written here and the credentials never leave the call.
    """
    unreachable = connectivity._classify_unreachable(host, device.onvif_port, device.rtsp_port, connectivity._timeout())
    if unreachable is not None:
        return _Attempt(unreachable.result, unreachable.reason)
    context = connectivity.ConnectionContext(host=host, credential_row=None, service_path=service_path)
    try:
        transport = connectivity._transport_factory() if connectivity._transport_factory else None
        with connectivity._client(context, device, plain, transport) as client:
            outcome = connectivity._authenticate_and_identify(client, device)
            return _Attempt(outcome.result, outcome.reason, outcome.information)
    except onvif.OnvifFailure as failure:
        return _Attempt(failure.result, failure.reason)


def _record_device_check(device: CctvDevice, attempt: _Attempt, checked_at: datetime) -> None:
    """Update the recorder's own status from a check that really happened.

    Only the device row is touched. `cctv_device_credentials` is left completely
    alone: these were not its credentials, and its `last_verified_at` must keep
    describing the stored login rather than someone else's successful attempt.
    """
    device.status = connectivity.STATUS_FOR_RESULT[attempt.result]
    device.status_detail = f"{attempt.result}: {connectivity.MESSAGE_FOR_RESULT[attempt.result]}"[:255]
    device.last_checked_at = checked_at
    if attempt.result == onvif.RESULT_DEVICE_VERIFIED:
        device.last_online_at = checked_at


def _grant(database: Session, user: User, project_id: uuid.UUID, device_id: uuid.UUID, now: datetime) -> None:
    """Record that this user has verified this project's recorder.

    UNIQUE(project_id, user_id) makes this an upsert by hand: verifying again
    refreshes the existing row (and lifts a revocation) rather than adding a
    second one.
    """
    repository = CctvRepository(database)
    row = repository.lock_project_access(project_id, user.id)
    if row is None:
        repository.add(CctvProjectAccess(project_id=project_id, user_id=user.id, device_id=device_id, verified_at=now))
        return
    row.device_id = device_id
    row.verified_at = now
    row.revoked_at = None


# --- connect -----------------------------------------------------------------


def connect(
    database: Session, user: User, project_id: uuid.UUID, payload: CctvCameraSetupSubmit, request: Request
) -> CctvCameraSetupOut:
    """Verify what the user typed and, on success, grant them the project camera.

    Two paths, one outcome:

      * the project has no recorder  -> register it, store its credentials
                                        through the existing encrypted
                                        mechanism, verify, discover cameras
      * the project already has one  -> verify the supplied credentials against
                                        it, change nothing about the device's
                                        stored credentials, discover only if it
                                        has no cameras yet

    Either way the user ends up with one row in `cctv_project_access` pointing at
    the project's single shared recorder.
    """
    grant = access.authorize_project(database, user, project_id, request)
    # Fails closed while the platform JWT secret is weak, before any packet.
    credential_service.ensure_credentials_may_be_used()

    host = network_policy.validate_device_host(payload.device.host, "device.host")
    onvif_port = network_policy.validate_port(payload.device.port, "device.port")
    rtsp_port = network_policy.validate_port(payload.device.rtsp_port, "device.rtsp_port")

    device = _project_device(database, project_id, host) or _project_device(database, project_id)
    created = False

    if device is None:
        device = _register_device(database, grant, user, payload, host, onvif_port, rtsp_port, request)
        created = True
    elif device.host != host:
        # The project already has a recorder at a different address. Registering
        # a second one is not what this flow is for, and silently verifying
        # against the existing one would be worse: the user would believe they
        # had connected the recorder they named.
        raise field_error(
            "device.host",
            "This project is already connected to a recorder at a different address.",
            "CCTV_SETUP_DEVICE_MISMATCH",
        )
    if not device.is_active:
        raise cctv_error(status.HTTP_409_CONFLICT, devices.CODE_DEVICE_INACTIVE, "This camera device is inactive.")
    if device.connection_method != "ONVIF" or device.onvif_port is None:
        raise cctv_error(
            status.HTTP_409_CONFLICT,
            "CCTV_ONVIF_NOT_CONFIGURED",
            "This recorder is not set up for ONVIF, so it cannot be verified automatically.",
        )

    # The same rate limit the reconnect and verify paths share, so this cannot
    # become a way to try passwords against the recorder in a loop.
    devices._reserve_reconnect(user, device.id)

    service_path = (
        network_policy.validate_service_path(device.onvif_service_path, "onvif_service_path")
        or onvif.DEFAULT_DEVICE_SERVICE_PATH
    )
    plain = credential_service.PlainCredentials(
        username=payload.credentials.username, password=payload.credentials.password
    )
    checked_at = utc_now()
    try:
        attempt = _verify_supplied(device, host, service_path, plain)
    finally:
        del plain

    _record_device_check(device, attempt, checked_at)
    verified = attempt.result in ACCEPTED_RESULTS
    audit.record(
        database,
        action=audit.ACTION_DEVICE_VERIFIED,
        outcome=audit.OUTCOME_SUCCESS if verified else audit.OUTCOME_FAILED,
        actor=user,
        request=request,
        project_id=project_id,
        device_id=device.id,
        detail={"result": attempt.result, "reason": attempt.reason, "flow": "camera_setup", "device_created": created},
    )

    if not verified:
        devices._commit(database)
        raise cctv_error(
            status.HTTP_409_CONFLICT,
            CODE_VERIFICATION_FAILED,
            connectivity.MESSAGE_FOR_RESULT.get(attempt.result, "The recorder could not be verified."),
        )

    _grant(database, user, project_id, device.id, checked_at)
    devices._commit(database)
    CctvRepository(database).refresh(device)

    # Cameras are discovered from the recorder, never entered by hand. Only when
    # the project has none yet: a later user verifying does not re-enumerate a
    # recorder whose cameras are already configured.
    discovered = 0
    total, enabled = _channel_counts(database, device.id)
    if total == 0:
        discovered = _discover_and_save(database, grant, device, user, request)
        total, enabled = _channel_counts(database, device.id)

    return CctvCameraSetupOut(
        project_id=project_id,
        device_id=device.id,
        result=attempt.result,
        reason=attempt.reason,
        verified=True,
        access_granted=True,
        device_created=created,
        channels_discovered=discovered,
        channel_count=total,
        enabled_channel_count=enabled,
    )


def _register_device(
    database: Session,
    grant: access.CctvGrant,
    user: User,
    payload: CctvCameraSetupSubmit,
    host: str,
    onvif_port: int,
    rtsp_port: int,
    request: Request,
) -> CctvDevice:
    """Register the project's first recorder and store its credentials.

    Goes through the existing encryption path, so the password is never written
    anywhere in the clear and never returned.
    """
    repository = CctvRepository(database)
    if devices._duplicate_device_exists(database, grant.project.id, host, rtsp_port):
        # Reached only by two first-time setups racing; the second reloads and
        # takes the verify-against-existing path.
        raise devices._duplicate_error()
    encrypted = credential_service.encrypt_credentials(
        payload.credentials.username, payload.credentials.password, field_prefix="credentials."
    )
    device = CctvDevice(
        project_id=grant.project.id,
        # Named after the project, because the recorder belongs to the project.
        name=devices.clean_text(f"{grant.project.title} camera", "name", 120, required=True),
        device_type=payload.device.device_type,
        host=host,
        rtsp_port=rtsp_port,
        onvif_port=onvif_port,
        onvif_use_tls=payload.device.onvif_use_tls,
        connection_method="ONVIF",
        status="UNKNOWN",
        is_active=True,
        created_by_user_id=user.id,
    )
    repository.add(device)
    repository.flush()
    repository.add(
        CctvDeviceCredential(
            device_id=device.id,
            username_ciphertext=encrypted.username_ciphertext,
            password_ciphertext=encrypted.password_ciphertext,
            encryption_scheme=credential_service.ENCRYPTION_SCHEME,
            key_version=encrypted.key_version,
            created_by_user_id=user.id,
        )
    )
    audit.record(
        database,
        action=audit.ACTION_DEVICE_CREATED,
        outcome=audit.OUTCOME_SUCCESS,
        actor=user,
        request=request,
        project_id=device.project_id,
        device_id=device.id,
        detail={"channel_count": 0, "flow": "camera_setup"},
    )
    audit.record(
        database,
        action=audit.ACTION_CREDENTIALS_UPDATED,
        outcome=audit.OUTCOME_SUCCESS,
        actor=user,
        request=request,
        project_id=device.project_id,
        device_id=device.id,
        detail={"replaced": False},
    )
    repository.flush()
    return device


def _discover_and_save(
    database: Session, grant: access.CctvGrant, device: CctvDevice, user: User, request: Request
) -> int:
    """Enumerate the recorder's cameras and save every one it reports.

    Uses the existing discovery, so stream paths, codecs and profile tokens are
    read from the device and stay server-side. Channel numbers follow the order
    the recorder reported its video sources, so nothing is hardcoded and a
    recorder with five cameras produces five.
    """
    discovery = connectivity.discover_channels(database, grant, device, user, request)
    if not discovery.candidates:
        raise cctv_error(
            status.HTTP_409_CONFLICT,
            CODE_NO_CHANNELS,
            "The recorder was verified but reported no usable cameras.",
        )
    selections = [
        CctvDiscoveredChannelSelection(
            candidate_id=candidate.candidate_id,
            channel_number=index,
            name=candidate.label or f"Camera {index}",
            # A candidate the recorder offers no playable stream for is saved
            # but left disabled, which is the rule save_discovered_channels
            # already enforces.
            is_enabled=bool(
                (candidate.main_stream and candidate.main_stream.stream_available)
                or (candidate.sub_stream and candidate.sub_stream.stream_available)
            ),
            display_order=index - 1,
        )
        for index, candidate in enumerate(discovery.candidates, start=1)
    ]
    connectivity.save_discovered_channels(
        database,
        grant,
        device,
        user,
        CctvDiscoveredChannelsSave(discovery_id=discovery.discovery_id, selections=selections),
        request,
    )
    return len(selections)

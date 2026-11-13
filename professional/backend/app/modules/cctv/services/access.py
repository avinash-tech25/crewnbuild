"""Who may see and manage a project's cameras. Checked on every CCTV request.

There is no foreign key from a CCTV table to `projects` or `users`, so nothing in
the database vouches for a CCTV row's project. Authorization therefore always
works from the project id STORED on the CCTV row -- never from an id or an
ownership claim in the request -- and re-reads that project every time:

    OWNER       projects.owner_id == user
    CONTRACTOR  projects.contractor_id == user, and not a self-construction project
    ENGINEER    an ACTIVE project_engineer_assignments row for (project, user)

and the project itself must exist and be active. Any other role is refused.

Existing tables are read with column-only SELECTs, which return plain rows rather
than ORM entities, so no code path in this feature can ever flush a change back
into `projects` or `project_engineer_assignments`.

Response rule:
    disallowed role                                   -> 403
    missing / inactive / inaccessible project, device
    or channel (indistinguishable on purpose)         -> 404
    invalid token -> 401 and suspended user -> 403 come from get_current_user.
"""

import uuid
from dataclasses import dataclass

from fastapi import Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.cctv.models import CctvChannel, CctvDevice, CctvProjectAccess
from app.modules.cctv.repository import _PROJECT_COLUMNS, ACTIVE_ASSIGNMENT_STATUS, CctvRepository
from app.modules.cctv.services import audit, cctv_error, not_found
from app.modules.identity.models import ROLE_BUILDER, ROLE_ENGINEER, ROLE_OWNER, User
from app.modules.projects.models import Project, ProjectEngineer

CCTV_ROLES = (ROLE_OWNER, ROLE_BUILDER, ROLE_ENGINEER)
ACTIVE_PROJECT_STATUS = "active"
SELF_CONSTRUCTION = "SELF_CONSTRUCTION"

BASIS_PROJECT_OWNER = "PROJECT_OWNER"
BASIS_AWARDED_BUILDER = "AWARDED_BUILDER"
BASIS_ASSIGNED_ENGINEER = "ASSIGNED_ENGINEER"

# Two separate permissions over a project's cameras:
#
#   VIEW    every access basis above: the house owner, the awarded builder and
#           the assigned site engineer may watch, once each has verified.
#   MANAGE  create, change or delete the recorder, replace its stored login,
#           and discover or configure its channels. Only the project's owner
#           and its awarded builder: they are the two parties who manage the
#           project elsewhere in the application (they assign and remove its
#           site engineers), so an engineer they assigned never gains control
#           of the recorder the engineer is only meant to look at.
MANAGEMENT_BASES = frozenset({BASIS_PROJECT_OWNER, BASIS_AWARDED_BUILDER})
CODE_MANAGEMENT_NOT_ALLOWED = "CCTV_MANAGEMENT_NOT_ALLOWED"


@dataclass(frozen=True)
class ProjectAccessRow:
    id: uuid.UUID
    title: str
    owner_id: uuid.UUID
    contractor_id: uuid.UUID | None
    construction_type: str | None
    status: str | None


@dataclass(frozen=True)
class CctvGrant:
    project: ProjectAccessRow
    basis: str
    user_id: uuid.UUID
    role: str


def _row_to_project(row) -> ProjectAccessRow:
    return ProjectAccessRow(
        id=row.id,
        title=row.title,
        owner_id=row.owner_id,
        contractor_id=row.contractor_id,
        construction_type=row.construction_type,
        status=row.status,
    )


def load_project_access_row(database: Session, project_id: uuid.UUID) -> ProjectAccessRow | None:
    row = CctvRepository(database).find_project_access_row(project_id)
    return _row_to_project(row) if row else None


def engineer_assignment_active(database: Session, project_id: uuid.UUID, engineer_id: uuid.UUID) -> bool:
    return CctvRepository(database).exists_active_engineer_assignment(project_id, engineer_id)


def access_basis(database: Session, user: User, project: ProjectAccessRow) -> str | None:
    """The relationship that entitles this user to this project's cameras, if any."""
    if project.status != ACTIVE_PROJECT_STATUS:
        return None
    if user.role == ROLE_OWNER and project.owner_id == user.id:
        return BASIS_PROJECT_OWNER
    if (
        user.role == ROLE_BUILDER
        and project.contractor_id is not None
        and project.contractor_id == user.id
        and project.construction_type != SELF_CONSTRUCTION
    ):
        return BASIS_AWARDED_BUILDER
    if user.role == ROLE_ENGINEER and engineer_assignment_active(database, project.id, user.id):
        return BASIS_ASSIGNED_ENGINEER
    return None


def _deny_not_found(user: User, request: Request | None, reason: str, **ids) -> None:
    audit.record_denied(actor=user, request=request, reason=reason, http_status=status.HTTP_404_NOT_FOUND, **ids)
    raise not_found()


def require_cctv_role(user: User, request: Request | None) -> None:
    if user.role not in CCTV_ROLES:
        audit.record_denied(
            actor=user, request=request, reason="ROLE_NOT_ALLOWED", http_status=status.HTTP_403_FORBIDDEN
        )
        raise cctv_error(
            status.HTTP_403_FORBIDDEN,
            "CCTV_ROLE_NOT_ALLOWED",
            "Live Camera is available to house owners, builders and site engineers only.",
        )


def authorize_project(
    database: Session,
    user: User,
    project_id: uuid.UUID,
    request: Request | None,
    *,
    device_id: uuid.UUID | None = None,
    channel_id: uuid.UUID | None = None,
) -> CctvGrant:
    require_cctv_role(user, request)
    project = load_project_access_row(database, project_id)
    ids = {"project_id": project_id, "device_id": device_id, "channel_id": channel_id}
    if project is None:
        _deny_not_found(user, request, "PROJECT_NOT_FOUND", **ids)
    if project.status != ACTIVE_PROJECT_STATUS:
        _deny_not_found(user, request, "PROJECT_INACTIVE", **ids)
    basis = access_basis(database, user, project)
    if basis is None:
        _deny_not_found(user, request, "NO_PROJECT_ACCESS", **ids)
    return CctvGrant(project=project, basis=basis, user_id=user.id, role=user.role)


def can_manage(grant: CctvGrant) -> bool:
    return grant.basis in MANAGEMENT_BASES


def require_management(
    grant: CctvGrant,
    user: User,
    request: Request | None,
    *,
    device_id: uuid.UUID | None = None,
    channel_id: uuid.UUID | None = None,
) -> None:
    """Refuse recorder management to a user who may only view.

    403 rather than 404: the caller already passed project authorization, so
    the project is not being hidden -- the action is simply not theirs.
    """
    if can_manage(grant):
        return
    audit.record_denied(
        actor=user,
        request=request,
        reason="MANAGEMENT_NOT_ALLOWED",
        http_status=status.HTTP_403_FORBIDDEN,
        project_id=grant.project.id,
        device_id=device_id,
        channel_id=channel_id,
    )
    raise cctv_error(
        status.HTTP_403_FORBIDDEN,
        CODE_MANAGEMENT_NOT_ALLOWED,
        "Only the house owner or the project's builder can change this project's DVR/NVR.",
    )


def load_device(
    database: Session,
    user: User,
    device_id: uuid.UUID,
    request: Request | None,
    *,
    for_update: bool = False,
) -> tuple[CctvDevice, CctvGrant]:
    """Load a device, then authorize the project stored on it."""
    require_cctv_role(user, request)
    device = CctvRepository(database).find_device_optionally_locked(device_id, for_update)
    if device is None:
        _deny_not_found(user, request, "DEVICE_NOT_FOUND", device_id=device_id)
    grant = authorize_project(database, user, device.project_id, request, device_id=device.id)
    return device, grant


def load_channel(
    database: Session,
    user: User,
    channel_id: uuid.UUID,
    request: Request | None,
    *,
    for_update: bool = False,
) -> tuple[CctvChannel, CctvDevice, CctvGrant]:
    """Load a channel and its device, confirm they agree on the project, then
    authorize that project."""
    repository = CctvRepository(database)
    require_cctv_role(user, request)
    channel = repository.find_channel_optionally_locked(channel_id, for_update)
    if channel is None:
        _deny_not_found(user, request, "CHANNEL_NOT_FOUND", channel_id=channel_id)
    device = repository.find_device(channel.device_id)
    # The composite foreign key already guarantees this; it is re-asserted so the
    # authorization never rests on an assumption about the schema.
    if device is None or device.project_id != channel.project_id:
        _deny_not_found(user, request, "CHANNEL_DEVICE_MISMATCH", channel_id=channel_id)
    grant = authorize_project(database, user, channel.project_id, request, device_id=device.id, channel_id=channel.id)
    return channel, device, grant


# --- per-user setup grant ----------------------------------------------------
#
# Project authorization above says WHICH project's cameras a user may reach.
# This second gate says whether that user has completed the DVR/NVR verification
# for it. Both must pass before any camera content is served.
#
# The device is untouched by this: one project, one recorder, one channel set,
# shared by everyone who has verified. `cctv_devices.created_by_user_id` is
# deliberately never consulted -- whoever first configured the recorder is not
# its owner, they are simply the first person who verified.

CODE_SETUP_REQUIRED = "CCTV_SETUP_REQUIRED"


def project_access_row(database: Session, user_id: uuid.UUID, project_id: uuid.UUID) -> CctvProjectAccess | None:
    """This user's live grant on this project, if any. A revoked row is not one."""
    return CctvRepository(database).find_live_project_access(user_id, project_id)


def project_access_active(
    database: Session, user_id: uuid.UUID, project_id: uuid.UUID, device_id: uuid.UUID | None = None
) -> bool:
    """Whether this user has completed setup for this project's camera.

    `device_id`, when given, must match the device the grant was issued against,
    so a grant earned on one recorder cannot be spent on another that later
    appeared on the same project.
    """
    row = project_access_row(database, user_id, project_id)
    if row is None:
        return False
    return device_id is None or row.device_id == device_id


def require_project_access(
    database: Session,
    user: User,
    project_id: uuid.UUID,
    request: Request | None,
    *,
    device_id: uuid.UUID | None = None,
    channel_id: uuid.UUID | None = None,
) -> None:
    """Refuse a user who is authorized for the project but has not verified.

    409 rather than 404: the caller is legitimately on this project, so hiding
    the camera's existence would only leave the interface unable to explain what
    to do. The reply names the setup step instead.
    """
    if project_access_active(database, user.id, project_id, device_id):
        return
    _refuse_setup_required(user, request, project_id=project_id, device_id=device_id, channel_id=channel_id)


def require_project_access_or_management(
    database: Session,
    grant: CctvGrant,
    user: User,
    project_id: uuid.UUID,
    request: Request | None,
    *,
    device_id: uuid.UUID | None = None,
    channel_id: uuid.UUID | None = None,
) -> None:
    """For reading recorder configuration and running health checks with the
    STORED login: a verified viewer may, and so may a manager who has not
    verified yet. A manager has to be able to repair a recorder whose login no
    longer works -- after its address changed, every grant on it was withdrawn
    (devices.update_device), so requiring one here would lock them out of the
    very screen that fixes it. None of these calls returns video, an address or
    a credential."""
    if can_manage(grant) or project_access_active(database, user.id, project_id, device_id):
        return
    _refuse_setup_required(user, request, project_id=project_id, device_id=device_id, channel_id=channel_id)


def _refuse_setup_required(
    user: User,
    request: Request | None,
    *,
    project_id: uuid.UUID,
    device_id: uuid.UUID | None,
    channel_id: uuid.UUID | None,
) -> None:
    audit.record_denied(
        actor=user,
        request=request,
        reason="CCTV_SETUP_NOT_COMPLETED",
        http_status=status.HTTP_409_CONFLICT,
        project_id=project_id,
        device_id=device_id,
        channel_id=channel_id,
    )
    raise cctv_error(
        status.HTTP_409_CONFLICT,
        CODE_SETUP_REQUIRED,
        "Connect and verify this project's DVR/NVR to use its cameras.",
    )


def revoke_device_grants(database: Session, device_id: uuid.UUID, now) -> int:
    """Withdraw every live per-user grant issued against this recorder.

    Used when the recorder's network identity changes: each grant proved its
    holder knew the login of the device at the OLD address, which says nothing
    about whatever now answers at the new one. Rows are marked revoked, never
    deleted, so re-verifying lifts the revocation (setup._grant). Open playback
    is cut at its next renewal or gateway re-check, both of which require a
    live grant."""
    rows = CctvRepository(database).lock_live_device_grants(device_id)
    for row in rows:
        row.revoked_at = now
    return len(rows)


def accessible_project_rows(
    database: Session, user: User, request: Request | None
) -> list[tuple[ProjectAccessRow, str]]:
    """Every active project this user may use cameras on, with the reason."""
    require_cctv_role(user, request)
    if user.role == ROLE_OWNER:
        statement = select(*_PROJECT_COLUMNS).where(
            Project.owner_id == user.id,
            Project.status == ACTIVE_PROJECT_STATUS,
        )
        basis = BASIS_PROJECT_OWNER
    elif user.role == ROLE_BUILDER:
        statement = select(*_PROJECT_COLUMNS).where(
            Project.contractor_id == user.id,
            Project.construction_type != SELF_CONSTRUCTION,
            Project.status == ACTIVE_PROJECT_STATUS,
        )
        basis = BASIS_AWARDED_BUILDER
    else:
        statement = (
            select(*_PROJECT_COLUMNS)
            .join(ProjectEngineer, ProjectEngineer.project_id == Project.id)
            .where(
                ProjectEngineer.engineer_id == user.id,
                ProjectEngineer.status == ACTIVE_ASSIGNMENT_STATUS,
                Project.status == ACTIVE_PROJECT_STATUS,
            )
            .distinct()
        )
        basis = BASIS_ASSIGNED_ENGINEER
    rows = CctvRepository(database).list_project_rows(statement)
    return [(_row_to_project(row), basis) for row in rows]

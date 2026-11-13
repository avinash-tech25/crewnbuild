import uuid
from datetime import datetime

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.modules.cctv.models import (
    SESSION_OPEN_STATUSES,
    CctvChannel,
    CctvDevice,
    CctvDeviceCredential,
    CctvPlaybackSession,
    CctvProjectAccess,
)
from app.modules.identity.models import User
from app.modules.projects.base_repository import BaseRepository
from app.modules.projects.models import Project, ProjectEngineer

# Query constants. Defined here because the queries below use them; the services
# that also use them (access.py, playback.py) import them from this module.
ACTIVE_ASSIGNMENT_STATUS = "ACTIVE"
MAX_EXPIRED_PER_SWEEP = 25

_PROJECT_COLUMNS = (
    Project.id,
    Project.title,
    Project.owner_id,
    Project.contractor_id,
    Project.construction_type,
    Project.status,
)


class CctvRepository(BaseRepository[CctvDevice]):
    """Every CCTV table plus the column-only reads of projects, users and
    project_engineer_assignments that CCTV authorization needs."""

    def __init__(self, database: Session):
        super().__init__(database, CctvDevice)

    def expunge(self, item) -> None:
        self.database.expunge(item)

    # --- projects / users / engineer assignments (read only) ---------------

    def find_project_access_row(self, project_id: uuid.UUID):
        return self.database.execute(select(*_PROJECT_COLUMNS).where(Project.id == project_id)).first()

    def exists_active_engineer_assignment(self, project_id: uuid.UUID, engineer_id: uuid.UUID) -> bool:
        return (
            self.database.execute(
                select(ProjectEngineer.id)
                .where(
                    ProjectEngineer.project_id == project_id,
                    ProjectEngineer.engineer_id == engineer_id,
                    ProjectEngineer.status == ACTIVE_ASSIGNMENT_STATUS,
                )
                .limit(1)
            ).first()
            is not None
        )

    def list_project_rows(self, statement):
        return self.database.execute(statement.order_by(Project.id)).all()

    def get_user(self, user_id: uuid.UUID) -> User | None:
        return self.database.get(User, user_id)

    # --- devices -----------------------------------------------------------

    def find_device(self, device_id: uuid.UUID) -> CctvDevice | None:
        return self.database.execute(select(CctvDevice).where(CctvDevice.id == device_id)).scalar_one_or_none()

    def find_device_optionally_locked(self, device_id: uuid.UUID, for_update: bool) -> CctvDevice | None:
        statement = select(CctvDevice).where(CctvDevice.id == device_id)
        if for_update:
            statement = statement.with_for_update()
        return self.database.execute(statement).scalar_one_or_none()

    def list_project_devices(self, project_id: uuid.UUID) -> list[CctvDevice]:
        return (
            self.database.execute(
                select(CctvDevice)
                .where(CctvDevice.project_id == project_id)
                .order_by(CctvDevice.created_at, CctvDevice.name)
            )
            .scalars()
            .all()
        )

    def find_project_device(self, project_id: uuid.UUID, host: str | None) -> CctvDevice | None:
        statement = select(CctvDevice).where(CctvDevice.project_id == project_id)
        if host is not None:
            statement = statement.where(CctvDevice.host == host)
        return (
            self.database.execute(statement.order_by(CctvDevice.created_at, CctvDevice.id).limit(1)).scalars().first()
        )

    def exists_project_device(self, project_id: uuid.UUID, device_id: uuid.UUID) -> bool:
        return (
            self.database.execute(
                select(CctvDevice.id).where(CctvDevice.project_id == project_id, CctvDevice.id == device_id).limit(1)
            ).first()
            is not None
        )

    def exists_duplicate_device(
        self, project_id: uuid.UUID, host: str, rtsp_port: int, exclude_id: uuid.UUID | None
    ) -> bool:
        statement = select(CctvDevice.id).where(
            CctvDevice.project_id == project_id,
            CctvDevice.host == host,
            CctvDevice.rtsp_port == rtsp_port,
        )
        if exclude_id is not None:
            statement = statement.where(CctvDevice.id != exclude_id)
        return self.database.execute(statement.limit(1)).first() is not None

    def list_device_counts(self, project_ids: list[uuid.UUID]):
        return self.database.execute(
            select(CctvDevice.project_id, func.count(CctvDevice.id))
            .where(CctvDevice.project_id.in_(project_ids))
            .group_by(CctvDevice.project_id)
        ).all()

    def delete_device(self, device_id: uuid.UUID, project_id: uuid.UUID) -> None:
        self.database.execute(delete(CctvDevice).where(CctvDevice.id == device_id, CctvDevice.project_id == project_id))

    # --- credentials -------------------------------------------------------

    def find_device_credential(self, device_id: uuid.UUID) -> CctvDeviceCredential | None:
        return self.database.execute(
            select(CctvDeviceCredential).where(CctvDeviceCredential.device_id == device_id)
        ).scalar_one_or_none()

    def lock_device_credential(self, device_id: uuid.UUID) -> CctvDeviceCredential | None:
        return self.database.execute(
            select(CctvDeviceCredential).where(CctvDeviceCredential.device_id == device_id).with_for_update()
        ).scalar_one_or_none()

    def list_credential_summaries(self, device_ids: list[uuid.UUID]):
        return self.database.execute(
            select(CctvDeviceCredential.device_id, CctvDeviceCredential.last_verified_at).where(
                CctvDeviceCredential.device_id.in_(device_ids)
            )
        ).all()

    def update_credentials_unverified(self, device_id: uuid.UUID) -> None:
        self.database.execute(
            update(CctvDeviceCredential)
            .where(CctvDeviceCredential.device_id == device_id)
            .values(last_verified_at=None)
        )

    # --- channels ----------------------------------------------------------

    def get_channel(self, channel_id: uuid.UUID) -> CctvChannel | None:
        return self.database.get(CctvChannel, channel_id)

    def find_channel_optionally_locked(self, channel_id: uuid.UUID, for_update: bool) -> CctvChannel | None:
        statement = select(CctvChannel).where(CctvChannel.id == channel_id)
        if for_update:
            statement = statement.with_for_update()
        return self.database.execute(statement).scalar_one_or_none()

    def iter_device_channels(self, device_id: uuid.UUID):
        return self.database.execute(select(CctvChannel).where(CctvChannel.device_id == device_id)).scalars()

    def iter_locked_device_channels(self, device_id: uuid.UUID):
        return self.database.execute(
            select(CctvChannel).where(CctvChannel.device_id == device_id).with_for_update()
        ).scalars()

    def lock_device_channels(self, device_id: uuid.UUID) -> list[CctvChannel]:
        return (
            self.database.execute(select(CctvChannel).where(CctvChannel.device_id == device_id).with_for_update())
            .scalars()
            .all()
        )

    def iter_channels_for_devices(self, device_ids: list[uuid.UUID]):
        return self.database.execute(
            select(CctvChannel)
            .where(CctvChannel.device_id.in_(device_ids))
            .order_by(CctvChannel.display_order, CctvChannel.channel_number)
        ).scalars()

    def list_channel_counts(self, project_ids: list[uuid.UUID]):
        return self.database.execute(
            select(
                CctvChannel.project_id,
                func.count(CctvChannel.id),
                func.count(CctvChannel.id).filter(CctvChannel.is_enabled.is_(True)),
            )
            .where(CctvChannel.project_id.in_(project_ids))
            .group_by(CctvChannel.project_id)
        ).all()

    def count_device_channels(self, device_id: uuid.UUID) -> int:
        return self.database.execute(
            select(func.count(CctvChannel.id)).where(CctvChannel.device_id == device_id)
        ).scalar_one()

    def find_device_channel_counts(self, device_id: uuid.UUID):
        return self.database.execute(
            select(
                func.count(CctvChannel.id),
                func.count(CctvChannel.id).filter(CctvChannel.is_enabled.is_(True)),
            ).where(CctvChannel.device_id == device_id)
        ).first()

    def delete_channels(self, removed_ids: list[uuid.UUID], device_id: uuid.UUID) -> None:
        self.database.execute(
            delete(CctvChannel).where(CctvChannel.id.in_(removed_ids), CctvChannel.device_id == device_id)
        )

    # --- per-user project access grants -----------------------------------

    def find_live_project_access(self, user_id: uuid.UUID, project_id: uuid.UUID) -> CctvProjectAccess | None:
        return self.database.execute(
            select(CctvProjectAccess)
            .where(
                CctvProjectAccess.project_id == project_id,
                CctvProjectAccess.user_id == user_id,
                CctvProjectAccess.revoked_at.is_(None),
            )
            .limit(1)
        ).scalar_one_or_none()

    def lock_project_access(self, project_id: uuid.UUID, user_id: uuid.UUID) -> CctvProjectAccess | None:
        return self.database.execute(
            select(CctvProjectAccess)
            .where(CctvProjectAccess.project_id == project_id, CctvProjectAccess.user_id == user_id)
            .with_for_update()
        ).scalar_one_or_none()

    def lock_live_device_grants(self, device_id: uuid.UUID) -> list[CctvProjectAccess]:
        return (
            self.database.execute(
                select(CctvProjectAccess)
                .where(CctvProjectAccess.device_id == device_id, CctvProjectAccess.revoked_at.is_(None))
                .with_for_update()
            )
            .scalars()
            .all()
        )

    # --- playback sessions -------------------------------------------------

    def lock_expired_open_sessions(self, now: datetime) -> list[CctvPlaybackSession]:
        return (
            self.database.execute(
                select(CctvPlaybackSession)
                .where(CctvPlaybackSession.status.in_(SESSION_OPEN_STATUSES), CctvPlaybackSession.expires_at <= now)
                .order_by(CctvPlaybackSession.expires_at)
                .limit(MAX_EXPIRED_PER_SWEEP)
                .with_for_update(skip_locked=True)
            )
            .scalars()
            .all()
        )

    def count_open_sessions(self, now: datetime, criteria: dict) -> int:
        statement = select(func.count(CctvPlaybackSession.id)).where(
            CctvPlaybackSession.status.in_(SESSION_OPEN_STATUSES),
            CctvPlaybackSession.expires_at > now,
        )
        for column, value in criteria.items():
            statement = statement.where(getattr(CctvPlaybackSession, column) == value)
        return self.database.execute(statement).scalar_one()

    def lock_session(self, session_id: uuid.UUID) -> CctvPlaybackSession | None:
        return self.database.execute(
            select(CctvPlaybackSession).where(CctvPlaybackSession.id == session_id).with_for_update()
        ).scalar_one_or_none()

    def lock_session_refreshed(self, session_id: uuid.UUID) -> CctvPlaybackSession | None:
        return self.database.execute(
            select(CctvPlaybackSession)
            .where(CctvPlaybackSession.id == session_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()

    def lock_existing_session_refreshed(self, session_id: uuid.UUID) -> CctvPlaybackSession:
        return self.database.execute(
            select(CctvPlaybackSession)
            .where(CctvPlaybackSession.id == session_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).scalar_one()

    def find_session_by_token_hash(self, token_hash: bytes) -> CctvPlaybackSession | None:
        return self.database.execute(
            select(CctvPlaybackSession).where(CctvPlaybackSession.token_hash == token_hash)
        ).scalar_one_or_none()

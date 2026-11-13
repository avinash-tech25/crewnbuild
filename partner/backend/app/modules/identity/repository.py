"""Database access of the identity module (the old user, OTP and auth-session repositories)."""

import uuid
from datetime import datetime

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.modules.identity.models import EmailOtpCode, Technician
from app.modules.identity.models import Session as AuthSession


class TechnicianRepository:
    def __init__(self, database: Session) -> None:
        self.database = database

    def get(self, technician_id: uuid.UUID) -> Technician | None:
        return self.database.scalars(
            select(Technician).where(Technician.id == technician_id, Technician.deleted_at.is_(None))
        ).first()

    def get_by_email(self, email: str) -> Technician | None:
        return self.database.scalars(
            select(Technician).where(
                func.lower(Technician.email) == email.strip().lower(), Technician.deleted_at.is_(None)
            )
        ).first()

    def add(self, technician: Technician) -> None:
        self.database.add(technician)


class OtpRepository:
    def __init__(self, database: Session) -> None:
        self.database = database

    def find(self, email: str, purpose: str, *, for_update: bool = False) -> EmailOtpCode | None:
        statement = select(EmailOtpCode).where(EmailOtpCode.email == email, EmailOtpCode.purpose == purpose)
        if for_update:
            statement = statement.with_for_update()
        return self.database.scalars(statement).first()


class SessionRepository:
    def __init__(self, database: Session) -> None:
        self.database = database

    def get(self, session_id: uuid.UUID) -> AuthSession | None:
        return self.database.get(AuthSession, session_id)

    def lock_by_refresh_hash(self, refresh_token_hash: str) -> AuthSession | None:
        return self.database.scalars(
            select(AuthSession).where(AuthSession.refresh_token_hash == refresh_token_hash).with_for_update()
        ).first()

    def exists_handoff(self, handoff_jti: str) -> bool:
        found = self.database.scalar(select(AuthSession.id).where(AuthSession.handoff_jti == handoff_jti))
        return found is not None

    def list_unrevoked_in_family(self, family_id: uuid.UUID) -> list[AuthSession]:
        return list(
            self.database.scalars(
                select(AuthSession).where(AuthSession.token_family_id == family_id, AuthSession.revoked_at.is_(None))
            ).all()
        )

    def revoke_family(self, family_id: uuid.UUID, reason: str, now: datetime) -> None:
        self.database.execute(
            update(AuthSession)
            .where(AuthSession.token_family_id == family_id, AuthSession.revoked_at.is_(None))
            .values(revoked_at=now, revoke_reason=reason)
            .execution_options(synchronize_session=False)
        )

    def revoke_all_for(self, principal_type: str, user_id: uuid.UUID, reason: str, now: datetime) -> None:
        self.database.execute(
            update(AuthSession)
            .where(
                AuthSession.principal_type == principal_type,
                AuthSession.user_id == user_id,
                AuthSession.revoked_at.is_(None),
            )
            .values(revoked_at=now, revoke_reason=reason)
            .execution_options(synchronize_session=False)
        )

"""Database queries of the identity module. No rules here: the services decide."""

import uuid
from collections.abc import Iterable
from datetime import datetime

from sqlalchemy import delete, func, or_, select, text, update
from sqlalchemy.orm import Session

from app.modules.accounts.models import AdminProfile
from app.modules.identity.models import (
    COUNTRY_INDIA,
    EmailVerificationCode,
    OtpSendEvent,
    PhoneVerificationCode,
    User,
    UserOAuthIdentity,
    UserSession,
)


class UserRepository:
    def __init__(self, database: Session) -> None:
        self.database = database

    def get(self, user_id: uuid.UUID) -> User | None:
        return self.database.get(User, user_id)

    def get_by_email(self, email: str) -> User | None:
        return self.database.scalars(select(User).where(func.lower(User.email) == email.strip().lower())).first()

    def find_id_by_email(self, email: str) -> uuid.UUID | None:
        return self.database.scalars(select(User.id).where(func.lower(User.email) == email.strip().lower())).first()

    def get_by_email_or_name(self, identifier: str) -> User | None:
        """The old sign-in lookup: the e-mail address, or the account name, without case."""
        normalized = identifier.strip().lower()
        return self.database.scalars(
            select(User).where(or_(func.lower(User.email) == normalized, func.lower(User.name) == normalized))
        ).first()

    def get_by_phone(self, phone: str) -> User | None:
        if not phone:
            return None
        return self.database.scalars(
            select(User).where(User.phone == phone, User.country_code == COUNTRY_INDIA)
        ).first()

    def phone_exists(self, phone: str, exclude_user_id: uuid.UUID | None = None) -> bool:
        query = select(User.id).where(User.phone == phone, User.country_code == COUNTRY_INDIA)
        if exclude_user_id is not None:
            query = query.where(User.id != exclude_user_id)
        return self.database.scalars(query).first() is not None

    def get_admin_by_phone(self, phone: str) -> User | None:
        """The administrator whose admin profile holds this number."""
        if not phone:
            return None
        return self.database.scalars(
            select(User).join(AdminProfile, AdminProfile.user_id == User.id).where(AdminProfile.phone == phone)
        ).first()

    def admin_phone_exists(self, phone: str, exclude_user_id: uuid.UUID | None = None) -> bool:
        query = select(AdminProfile.id).where(AdminProfile.phone == phone)
        if exclude_user_id is not None:
            query = query.where(AdminProfile.user_id != exclude_user_id)
        return self.database.scalars(query).first() is not None

    def find_oauth_identity(self, provider: str, subject: str) -> UserOAuthIdentity | None:
        return self.database.scalars(
            select(UserOAuthIdentity).where(
                UserOAuthIdentity.provider == provider, UserOAuthIdentity.subject == subject
            )
        ).first()

    def find_oauth_identity_for_user(self, provider: str, user_id: uuid.UUID) -> UserOAuthIdentity | None:
        return self.database.scalars(
            select(UserOAuthIdentity).where(
                UserOAuthIdentity.provider == provider, UserOAuthIdentity.user_id == user_id
            )
        ).first()


class SessionRepository:
    def __init__(self, database: Session) -> None:
        self.database = database

    def get(self, session_id: uuid.UUID) -> UserSession | None:
        return self.database.get(UserSession, session_id)

    def lock_by_refresh_hash(self, refresh_token_hash: str) -> UserSession | None:
        return self.database.scalars(
            select(UserSession).where(UserSession.refresh_token_hash == refresh_token_hash).with_for_update()
        ).first()

    def list_unrevoked_in_family(self, family_id: uuid.UUID) -> list[UserSession]:
        return list(
            self.database.scalars(
                select(UserSession).where(UserSession.token_family_id == family_id, UserSession.revoked_at.is_(None))
            )
        )

    def list_unrevoked_for_user(self, user_id: uuid.UUID) -> list[UserSession]:
        return list(
            self.database.scalars(
                select(UserSession)
                .where(UserSession.user_id == user_id, UserSession.revoked_at.is_(None))
                .order_by(UserSession.last_used_at.desc())
            )
        )

    def revoke_family(self, family_id: uuid.UUID, reason: str, now: datetime) -> None:
        self.database.execute(
            update(UserSession)
            .where(UserSession.token_family_id == family_id, UserSession.revoked_at.is_(None))
            .values(revoked_at=now, revoke_reason=reason)
            .execution_options(synchronize_session=False)
        )

    def revoke_all_for_user(self, user_id: uuid.UUID, reason: str, now: datetime) -> None:
        self.database.execute(
            update(UserSession)
            .where(UserSession.user_id == user_id, UserSession.revoked_at.is_(None))
            .values(revoked_at=now, revoke_reason=reason)
            .execution_options(synchronize_session=False)
        )


class EmailCodeRepository:
    def __init__(self, database: Session) -> None:
        self.database = database

    def find_by_email(self, email: str) -> EmailVerificationCode | None:
        return self.database.scalars(select(EmailVerificationCode).where(EmailVerificationCode.email == email)).first()


def advisory_key(subject_hash: str) -> int:
    """A signed 64-bit lock id from a SHA-256 hex digest, the range PostgreSQL takes."""
    return int.from_bytes(bytes.fromhex(subject_hash[:16]), "big", signed=True)


class PhoneCodeRepository:
    def __init__(self, database: Session) -> None:
        self.database = database

    def lock_subjects(self, *subject_hashes: str) -> None:
        """A PostgreSQL advisory lock per number and per address until this transaction
        ends, always taken in sorted order. A row lock cannot do this: a number's first
        request has no row yet, and the limits count rows that do not exist yet."""
        for key in sorted({advisory_key(value) for value in subject_hashes}):
            self.database.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key})

    def find_by_phone(self, phone: str) -> PhoneVerificationCode | None:
        """Locked for the rest of the transaction, so two requests for one number are
        handled one after the other."""
        return self.database.scalars(
            select(PhoneVerificationCode).where(PhoneVerificationCode.phone == phone).with_for_update()
        ).first()

    def send_times_since(self, kind: str, subject_hash: str, since: datetime) -> list[datetime]:
        return list(
            self.database.scalars(
                select(OtpSendEvent.occurred_at)
                .where(
                    OtpSendEvent.kind == kind,
                    OtpSendEvent.subject_hash == subject_hash,
                    OtpSendEvent.occurred_at >= since,
                )
                .order_by(OtpSendEvent.occurred_at)
            )
        )

    def record_send(self, kind: str, subject_hash: str, now: datetime) -> OtpSendEvent:
        event = OtpSendEvent(kind=kind, subject_hash=subject_hash, occurred_at=now)
        self.database.add(event)
        return event

    def remove_send_events(self, event_ids: Iterable[uuid.UUID]) -> None:
        ids = list(event_ids)
        if ids:
            self.database.execute(delete(OtpSendEvent).where(OtpSendEvent.id.in_(ids)))

    def purge_before(self, cutoff: datetime) -> None:
        self.database.execute(delete(OtpSendEvent).where(OtpSendEvent.occurred_at < cutoff))
        self.database.execute(
            delete(PhoneVerificationCode).where(
                PhoneVerificationCode.expires_at < cutoff, PhoneVerificationCode.last_sent_at < cutoff
            )
        )

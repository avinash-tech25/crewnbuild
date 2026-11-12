"""Server-side sign-in sessions: start, validate, rotate, list, end.

A session is a family of rows, one per refresh token. The access token names its row
(`sid`) and family (`fam`); a request is honoured only while that row is live: not
revoked, inside the family's absolute lifetime, and refreshed recently enough.

Refreshing retires the row it used and adds the next one. A retired refresh token
presented again means it was copied: the whole family is revoked. The one benign case
is two tabs refreshing at the same moment: a token retired by rotation within the last
REFRESH_REUSE_GRACE_SECONDS is answered "superseded" without revoking anything.
"""

import ipaddress
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.security.access_tokens import (
    AccessClaims,
    create_access_token,
    csrf_token_for,
    new_refresh_token,
    token_digest,
)
from app.database.base import new_uuid7
from app.modules.identity.models import (
    REVOKED_BY_USER,
    REVOKED_EXPIRED,
    REVOKED_LOGOUT,
    REVOKED_PASSWORD_RESET,
    REVOKED_REUSE,
    REVOKED_ROTATED,
    User,
    UserSession,
)
from app.modules.identity.policies import session_role
from app.modules.identity.repository import SessionRepository

SESSION_EXPIRED_MESSAGE = "Session expired. Please sign in again."
# Answered (401) when another tab rotated this refresh token a moment ago; the client
# retries with the cookie that rotation already set.
REFRESH_SUPERSEDED = "REFRESH_SUPERSEDED"


def utc_now() -> datetime:
    return datetime.now(UTC)


@dataclass(frozen=True)
class ClientInfo:
    user_agent: str | None
    ip_address: str | None


@dataclass(frozen=True)
class IssuedSession:
    session_id: uuid.UUID
    family_id: uuid.UUID
    user_id: uuid.UUID
    access_token: str
    refresh_token: str
    csrf_token: str
    expires_at: datetime


def session_expired() -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=SESSION_EXPIRED_MESSAGE)


def storable_ip(value: str | None) -> str | None:
    """The address as PostgreSQL inet takes it, or None (test clients send a name)."""
    try:
        return str(ipaddress.ip_address((value or "").strip()))
    except ValueError:
        return None


class SessionService:
    def __init__(self, repository: SessionRepository, settings: Settings) -> None:
        self.repository = repository
        self.settings = settings

    @property
    def database(self) -> Session:
        return self.repository.database

    # ---- start ----

    def start(self, user: User, client: ClientInfo) -> IssuedSession:
        """A new session (a new family) for an account whose credentials were just verified."""
        now = utc_now()
        issued = self._issue(
            user=user,
            family_id=uuid.uuid4(),
            expires_at=now + timedelta(days=self.settings.refresh_token_days),
            client=client,
            now=now,
        )
        self.database.commit()
        return issued

    def _issue(
        self, user: User, family_id: uuid.UUID, expires_at: datetime, client: ClientInfo, now: datetime
    ) -> IssuedSession:
        refresh_token = new_refresh_token()
        csrf_token = csrf_token_for(self.settings, family_id)
        row = UserSession(
            id=new_uuid7(),
            user_id=user.id,
            token_family_id=family_id,
            refresh_token_hash=token_digest(refresh_token),
            csrf_secret_hash=token_digest(csrf_token),
            created_at=now,
            last_used_at=now,
            expires_at=expires_at,
            user_agent=(client.user_agent or "")[:400] or None,
            ip_address=storable_ip(client.ip_address),
        )
        self.database.add(row)
        self.database.flush()
        return IssuedSession(
            session_id=row.id,
            family_id=family_id,
            user_id=user.id,
            access_token=create_access_token(self.settings, user.id, row.id, family_id, session_role(user)),
            refresh_token=refresh_token,
            csrf_token=csrf_token,
            expires_at=expires_at,
        )

    # ---- validate ----

    def is_live(self, row: UserSession, now: datetime) -> bool:
        return (
            row.revoked_at is None
            and row.expires_at > now
            and row.last_used_at + timedelta(days=self.settings.session_idle_days) > now
        )

    def validate(self, claims: AccessClaims) -> UserSession | None:
        """The live session an access token names, or None."""
        row = self.repository.get(claims.session_id)
        if row is None or row.user_id != claims.user_id or row.token_family_id != claims.family_id:
            return None
        return row if self.is_live(row, utc_now()) else None

    def family_is_live(self, claims: AccessClaims) -> bool:
        """Whether the sign-in an access token belongs to is still live (for an open
        websocket, which outlives the row it was admitted with)."""
        now = utc_now()
        return any(
            row.user_id == claims.user_id and self.is_live(row, now)
            for row in self.repository.list_unrevoked_in_family(claims.family_id)
        )

    # ---- rotate ----

    def rotate(
        self, refresh_token: str, client: ClientInfo, require_user: Callable[[uuid.UUID], User]
    ) -> tuple[IssuedSession, User]:
        """Exchange a live refresh token for the next one in its family. `require_user`
        loads the account and raises when it may not hold a session; it runs before
        anything new is issued."""
        now = utc_now()
        row = self.repository.lock_by_refresh_hash(token_digest(refresh_token))
        if row is None:
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
        if not self.is_live(row, now):
            row.revoked_at = now
            row.revoke_reason = REVOKED_EXPIRED
            self.database.commit()
            raise session_expired()

        try:
            user = require_user(row.user_id)
        except HTTPException:
            self.database.rollback()
            raise

        issued = self._issue(user, row.token_family_id, row.expires_at, client, now)
        row.revoked_at = now
        row.revoke_reason = REVOKED_ROTATED
        row.replaced_by_session_id = issued.session_id
        self.database.commit()
        return issued, user

    # ---- list and end ----

    def live_sessions_for(self, user_id: uuid.UUID) -> list[UserSession]:
        """One live row per sign-in (family), most recently used first."""
        now = utc_now()
        newest_by_family: dict[uuid.UUID, UserSession] = {}
        for row in self.repository.list_unrevoked_for_user(user_id):
            if self.is_live(row, now) and row.token_family_id not in newest_by_family:
                newest_by_family[row.token_family_id] = row
        return list(newest_by_family.values())

    def end_by_refresh_token(self, refresh_token: str) -> None:
        row = self.repository.lock_by_refresh_hash(token_digest(refresh_token))
        if row is not None:
            self.repository.revoke_family(row.token_family_id, REVOKED_LOGOUT, utc_now())
        self.database.commit()

    def end_family(self, family_id: uuid.UUID, reason: str = REVOKED_LOGOUT) -> None:
        self.repository.revoke_family(family_id, reason, utc_now())
        self.database.commit()

    def end_family_of_user(self, user_id: uuid.UUID, family_id: uuid.UUID) -> bool:
        """End one of the account's own sign-ins. False when it has no live one by that id."""
        if not any(row.token_family_id == family_id for row in self.live_sessions_for(user_id)):
            return False
        self.end_family(family_id, REVOKED_BY_USER)
        return True


def revoke_user_sessions_after_password_reset(repository: SessionRepository, user_id: uuid.UUID) -> None:
    """Staged in the caller's transaction, so the sessions end exactly when the new
    password is committed."""
    repository.revoke_all_for_user(user_id, REVOKED_PASSWORD_RESET, utc_now())

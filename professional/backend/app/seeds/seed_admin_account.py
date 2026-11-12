"""Create the Global Super Admin (ported from the old seed_admins.py).

    python -m app.seeds.seed_admin_account

Every administrator is created by another administrator, so the first one has to come
from outside the application; this creates that one account and nothing else. The
India Super Admin is then created by it through the console, with an audit entry.

The one seed that also runs with ENVIRONMENT=production. The account signs in only with
a WhatsApp code to GLOBAL_ADMIN_PHONE (10-digit Indian mobile, +91 implied), kept on its
admin profile; its password is random and unknown, as phone-first accounts have. No
number, password or address is written in this file.

Safe to run again; never makes a second account. The account is found by the
configured number on an admin profile, else the one existing Global Super Admin. An
account found by role (the old e-mail/password one) keeps its id, profile and audit
trail; it gets the configured number, GLOBAL scope, an unusable password, and its
sessions are ended so the next sign-in is a WhatsApp one. Nothing is changed when the
number belongs to another account, or when more than one Global Super Admin exists.

Exit codes: 0 created, converted or already present; 1 refused (nothing written).
"""

import secrets
import sys

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.local_time import utc_now
from app.core.security.password_hashing import hash_secret
from app.modules.accounts.models import SCOPE_GLOBAL, AdminProfile
from app.modules.identity.models import DEFAULT_COUNTRY, REVOKED_PASSWORD_RESET, ROLE_GLOBAL_SUPER_ADMIN, User
from app.modules.identity.phone_verification_service import india_mobile, phone_in_use
from app.modules.identity.repository import SessionRepository, UserRepository

CREATED, CONVERTED, EXISTS = "created", "converted", "exists"


class SeedRefusedError(RuntimeError):
    """Raised before anything is written; the transaction is rolled back."""


def configured_phone(settings: Settings) -> str:
    raw = (settings.global_admin_phone or "").strip()
    if not raw or raw == "change-me":
        raise SeedRefusedError("Refused: set GLOBAL_ADMIN_PHONE to the Global Super Admin's 10-digit mobile number.")
    try:
        return india_mobile(raw)
    except HTTPException:
        raise SeedRefusedError("Refused: GLOBAL_ADMIN_PHONE is not a valid 10-digit Indian mobile number.") from None


def unusable_password() -> str:
    return hash_secret(secrets.token_urlsafe(32))


def find_global_admin(database: Session, phone: str) -> User | None:
    by_phone = UserRepository(database).get_admin_by_phone(phone)
    if by_phone:
        if by_phone.role != ROLE_GLOBAL_SUPER_ADMIN:
            raise SeedRefusedError(
                f"Refused: the number is the sign-in number of a {by_phone.role} administrator ({by_phone.id}); "
                "nothing was changed."
            )
        return by_phone
    by_role = database.scalars(
        select(User).where(User.role == ROLE_GLOBAL_SUPER_ADMIN, User.deleted_at.is_(None))
    ).all()
    if len(by_role) > 1:
        raise SeedRefusedError(
            f"Refused: {len(by_role)} Global Super Admins exist and none holds the number; "
            "not guessing which one to change."
        )
    return by_role[0] if by_role else None


def seed(database: Session, settings: Settings) -> str:
    """Create or convert the Global Super Admin; created, converted or exists."""
    phone = configured_phone(settings)
    user = find_global_admin(database, phone)
    if phone_in_use(database, phone, DEFAULT_COUNTRY, exclude_user_id=user.id if user else None):
        raise SeedRefusedError("Refused: the number is already held by another account; nothing was changed.")

    if user is None:
        user = User(
            name="Global Super Admin",
            email=None,
            # An administrator's number lives on its admin profile, never here.
            phone="",
            password_hash=unusable_password(),
            role=ROLE_GLOBAL_SUPER_ADMIN,
            address="CREWNBUILD administration",
            pincode="",
            country_code=DEFAULT_COUNTRY,
            status="ACTIVE",
        )
        database.add(user)
        database.flush()
        # Super Admins hold every permission by role, so the stored grant stays empty.
        database.add(AdminProfile(user_id=user.id, scope=SCOPE_GLOBAL, permissions="", phone=phone))
        database.commit()
        return CREATED

    profile = database.scalars(select(AdminProfile).where(AdminProfile.user_id == user.id)).first()
    if profile and profile.phone == phone and profile.scope == SCOPE_GLOBAL:
        return EXISTS

    if profile is None:
        profile = AdminProfile(user_id=user.id, scope=SCOPE_GLOBAL, permissions="")
        database.add(profile)
    profile.scope = SCOPE_GLOBAL
    profile.phone = phone
    user.password_hash = unusable_password()
    # Sessions started with the old password end now; the next is a WhatsApp sign-in.
    SessionRepository(database).revoke_all_for_user(user.id, REVOKED_PASSWORD_RESET, utc_now())
    database.commit()
    return CONVERTED


def main() -> int:
    from app.database.session import SessionLocal

    settings = get_settings()
    database = SessionLocal()
    try:
        outcome = seed(database, settings)
    except SeedRefusedError as refusal:
        database.rollback()
        print(refusal)  # noqa: T201 command-line output
        return 1
    finally:
        database.close()
    print(f"Global Super Admin: {outcome}. It signs in with the WhatsApp code sent to GLOBAL_ADMIN_PHONE.")  # noqa: T201
    return 0


if __name__ == "__main__":
    sys.exit(main())

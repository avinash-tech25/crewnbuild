"""Create the fixed House Owner and Builder test accounts used by TEST_OTP_LOGIN_ENABLED.

    python -m app.seeds.seed_test_accounts

Creates, only where missing, a House Owner on 9000000001 and a Builder on 9000000002,
shaped as phone-first sign-up shapes them (no e-mail, an unusable random password, the
role's profile row). Nothing existing is ever changed or deleted: an account already on
the number with the right role is reported "ready"; a number held by any other account
is reported as a conflict and left alone. Safe to run again.

The Global Super Admin number (9000000003) is never created or changed here: it is
reported "ready" when an administrator of that role holds it, and "NOT LINKED" when
none does. Its sign-in code, like the others, comes from the environment.

Refused (exit code 1) when ENVIRONMENT=production, and unless TEST_OTP_LOGIN_ENABLED=true
on a development, test or staging deployment. Exit code 0 when every account is ready,
2 on any conflict, 3 when the administrator number is not linked.
"""

import secrets
import sys

from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.security.password_hashing import hash_secret
from app.modules.accounts.models import BuilderProfile, OwnerProfile
from app.modules.identity.models import COUNTRY_INDIA, ROLE_OWNER, User
from app.modules.identity.otp_test_accounts import OTP_TEST_ACCOUNTS, OTP_TEST_SEEDED_ROLES, otp_test_login_on
from app.modules.identity.phone_verification_service import phone_in_use
from app.modules.identity.repository import UserRepository

READY, CREATED, CONFLICT, NOT_LINKED = "ready", "created", "conflict", "not_linked"


class SeedRefusedError(RuntimeError):
    """Raised before anything is written."""


def ensure_allowed(settings: Settings) -> None:
    if settings.is_production():
        raise SeedRefusedError("Refused: test accounts are never created with ENVIRONMENT=production.")
    if not otp_test_login_on(settings):
        raise SeedRefusedError(
            "Refused: set TEST_OTP_LOGIN_ENABLED=true with ENVIRONMENT=development, test or staging first."
        )


def provision(database: Session, settings: Settings) -> dict[str, tuple[str, str]]:
    """{phone: (status, message)} for each test account; commits each creation."""
    ensure_allowed(settings)
    users = UserRepository(database)
    outcome: dict[str, tuple[str, str]] = {}
    for account in OTP_TEST_ACCOUNTS:
        phone = account.phone
        label = f"{account.name} ({phone})"
        if account.role not in OTP_TEST_SEEDED_ROLES:
            admin = users.get_admin_by_phone(phone)
            if admin is not None and admin.role == account.role:
                outcome[phone] = (READY, f"{label}: ready")
            elif admin is not None or phone_in_use(database, phone):
                outcome[phone] = (CONFLICT, f"{label}: CONFLICT, number held by another account; left unchanged")
            else:
                outcome[phone] = (NOT_LINKED, f"{label}: NOT LINKED, no {account.role} holds this number")
            continue
        existing = users.get_by_phone(phone)
        if existing is not None:
            status = READY if existing.role == account.role else CONFLICT
            message = "ready" if status == READY else f"CONFLICT, held by a {existing.role} account; left unchanged"
            outcome[phone] = (status, f"{label}: {message}")
            continue
        if phone_in_use(database, phone):
            outcome[phone] = (CONFLICT, f"{label}: CONFLICT, number held by another account; left unchanged")
            continue
        user = User(
            name=account.name,
            email=None,
            phone=phone,
            password_hash=hash_secret(secrets.token_urlsafe(32)),
            role=account.role,
            address="",
            pincode="",
            country_code=COUNTRY_INDIA,
        )
        database.add(user)
        database.flush()
        if account.role == ROLE_OWNER:
            database.add(
                OwnerProfile(
                    user_id=user.id,
                    building_type="RESIDENTIAL",
                    construction_type="CONTRACTOR",
                    budget_amount=0,
                    land_area=0,
                    floors=1,
                )
            )
        else:
            database.add(BuilderProfile(user_id=user.id, company_name=account.name, experience_years=0))
        database.commit()
        outcome[phone] = (CREATED, f"{label}: created")
    return outcome


def main() -> int:
    from app.database.session import SessionLocal

    settings = get_settings()
    try:
        ensure_allowed(settings)
    except SeedRefusedError as refusal:
        print(refusal)  # noqa: T201 command-line output
        return 1
    database = SessionLocal()
    try:
        outcome = provision(database, settings)
    finally:
        database.close()
    for _, message in outcome.values():
        print(message)  # noqa: T201 command-line output
    statuses = [status for status, _ in outcome.values()]
    if CONFLICT in statuses:
        return 2
    return 3 if NOT_LINKED in statuses else 0


if __name__ == "__main__":
    sys.exit(main())

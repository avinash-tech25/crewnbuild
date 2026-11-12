"""The fixed WhatsApp sign-in test accounts (TEST_OTP_LOGIN_ENABLED).

Testing only. With the flag on in development, test or staging (the service refuses
to start with it on in production), a sign-in code request for one of these numbers
runs the normal WhatsApp code flow -- account checks, role check, cooldown, limits,
hashed storage, attempt limit, expiry, single use -- except that the stored code is the
account's fixed code from the environment instead of a random one, and nothing is sent
to WhatsApp. Each fixed code works only for its own number and only on the account
holding exactly the role below. The codes are never in the code base.

The House Owner and Builder accounts are created by app/seeds/seed_test_accounts.py,
which refuses to run in production. The administrator is never created here.
"""

from dataclasses import dataclass

from app.core.config import TEST_OTP_ENVIRONMENTS, Settings
from app.modules.identity.models import ROLE_BUILDER, ROLE_GLOBAL_SUPER_ADMIN, ROLE_OWNER

OTP_TEST_CODE_TTL_MINUTES = 5
TEST_ACCOUNT_ROLE_MISMATCH = "This test number is not set up with its test account's role."


@dataclass(frozen=True)
class OtpTestAccount:
    phone: str
    role: str
    name: str
    code_setting: str


OTP_TEST_ACCOUNTS = (
    OtpTestAccount("9000000001", ROLE_OWNER, "Test House Owner", "test_owner_otp_code"),
    OtpTestAccount("9000000002", ROLE_BUILDER, "Test Builder", "test_builder_otp_code"),
    OtpTestAccount("9000000003", ROLE_GLOBAL_SUPER_ADMIN, "Global Super Admin", "test_admin_otp_code"),
)
# The roles seed_test_accounts.py may create.
OTP_TEST_SEEDED_ROLES = (ROLE_OWNER, ROLE_BUILDER)


def otp_test_login_on(settings: Settings) -> bool:
    return settings.test_otp_login_enabled and settings.environment in TEST_OTP_ENVIRONMENTS


def otp_test_account(phone: str, settings: Settings) -> OtpTestAccount | None:
    """The fixed test account for a number while the feature is on, else None."""
    if not otp_test_login_on(settings):
        return None
    return next((account for account in OTP_TEST_ACCOUNTS if account.phone == phone), None)


def otp_test_code(account: OtpTestAccount, settings: Settings) -> str:
    secret = getattr(settings, account.code_setting)
    return str(secret.get_secret_value()).strip()

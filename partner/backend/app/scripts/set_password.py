"""Set the sign-in password of a finished Partner account that has none -- server access only, no API.

Accounts that completed registration before password sign-in existed have no
password and cannot sign in. On the server:

  python -m app.scripts.set_password <email>

The password is typed twice at a hidden prompt, checked against the registration
rule and stored only as a bcrypt hash. It is never printed, logged or passed on
the command line. An account that already has a password is left unchanged, and
an unfinished account creates its password at the details step instead.
"""

import getpass
import sys

from app.core.security.password_hashing import PASSWORD_RULE_MESSAGE, hash_secret, password_is_strong
from app.database.session import SessionLocal
from app.modules.identity.models import STEP_COMPLETE
from app.modules.identity.otp_service import normalize_email
from app.modules.identity.repository import TechnicianRepository
from app.modules.registry import import_all_models

import_all_models()


def set_initial_password(session, raw_email: str, password: str) -> None:
    user = TechnicianRepository(session).get_by_email(normalize_email(raw_email))
    if not user:
        raise SystemExit("No Partner account with that email.")
    if user.onboarding_step != STEP_COMPLETE:
        raise SystemExit("That account has not finished registration. It creates its password at the details step.")
    if user.password_hash:
        raise SystemExit("That account already has a password. This script never replaces one.")
    if not password_is_strong(password):
        raise SystemExit(PASSWORD_RULE_MESSAGE)
    user.password_hash = hash_secret(password)
    session.commit()


def main(argv: list[str]) -> None:
    if len(argv) != 1:
        raise SystemExit(__doc__)
    password = getpass.getpass("New password: ")
    if getpass.getpass("Repeat the password: ") != password:
        raise SystemExit("The passwords do not match.")
    with SessionLocal() as session:
        set_initial_password(session, argv[0], password)
    print("Password set. The account can now sign in with its email and password.")


if __name__ == "__main__":
    main(sys.argv[1:])

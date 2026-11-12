"""The fixed test accounts are created only outside production, only when the test sign-in
is on, and never twice."""

import pytest
from conftest import make_settings
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.identity.models import User
from app.seeds.seed_test_accounts import CREATED, NOT_LINKED, READY, SeedRefusedError, provision

CODES = {"test_owner_otp_code": "246810", "test_builder_otp_code": "135791", "test_admin_otp_code": "112233"}


def test_refused_in_production(database: Session) -> None:
    settings = make_settings()
    settings.environment = "production"
    settings.test_otp_login_enabled = True
    with pytest.raises(SeedRefusedError, match="production"):
        provision(database, settings)
    assert database.scalars(select(User)).first() is None


def test_refused_while_the_test_sign_in_is_off(database: Session) -> None:
    with pytest.raises(SeedRefusedError, match="TEST_OTP_LOGIN_ENABLED"):
        provision(database, make_settings())


def test_creates_the_two_accounts_once(database: Session) -> None:
    settings = make_settings(test_otp_login_enabled=True, **CODES)
    first = provision(database, settings)
    assert first["9000000001"][0] == first["9000000002"][0] == CREATED
    assert first["9000000003"][0] == NOT_LINKED
    roles = {user.phone: user.role for user in database.scalars(select(User))}
    assert roles == {"9000000001": "OWNER", "9000000002": "BUILDER"}

    second = provision(database, settings)
    assert second["9000000001"][0] == second["9000000002"][0] == READY
    assert len(list(database.scalars(select(User)))) == 2

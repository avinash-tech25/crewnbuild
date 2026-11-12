"""Test setup. Settings are given here, before the app is imported, so tests never depend
on a developer's backend/.env. The database is crewnbuild_test only (section 17); no test
in this step connects to it."""

import os
import secrets

os.environ["ENVIRONMENT"] = "test"
os.environ["DATABASE_URL"] = "postgresql+psycopg://crewnbuild_professional:test@localhost:5432/crewnbuild_test"
os.environ["JWT_SECRET_KEY"] = secrets.token_urlsafe(64)
os.environ["TEST_OTP_LOGIN_ENABLED"] = "false"
os.environ["RAZORPAY_ALLOW_MOCK"] = "false"

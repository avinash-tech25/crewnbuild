"""Shared test helpers: hand-off keys and tokens, a fake mailbox, accounts."""

import os
import subprocess
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import bcrypt
import jwt
from conftest import REQUESTERS_STAND_IN
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.security.password_hashing import hash_secret
from app.database.types import naive_utc_now
from app.modules.identity.models import ACCOUNT_STATUS_ACTIVE, Technician

STRONG_PASSWORD = "Strong#Pass123"
PROFESSIONAL_BACKEND = Path(__file__).resolve().parents[3] / "professional" / "backend"


def key_pair() -> tuple[str, str]:
    """A new P-256 (private PEM, public PEM)."""
    key = ec.generate_private_key(ec.SECP256R1())
    private_pem = key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    ).decode()
    public_pem = (
        key.public_key()
        .public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
        .decode()
    )
    return private_pem, public_pem


def sign_handoff(private_pem: str, subject: uuid.UUID, lifetime: int = 60, **changes: Any) -> str:
    """A hand-off shaped like Professional's, signed here (claims may be changed or dropped
    with None)."""
    now = datetime.now(UTC)
    claims: dict[str, Any] = {
        "sub": str(subject),
        "type": "partner_handoff",
        "iss": "professional",
        "aud": "partner",
        "jti": uuid.uuid4().hex,
        "iat": now,
        "exp": now + timedelta(seconds=lifetime),
    }
    claims.update(changes)
    algorithm = claims.pop("_algorithm", "ES256")
    key = claims.pop("_key", private_pem)
    return jwt.encode({name: value for name, value in claims.items() if value is not None}, key, algorithm=algorithm)


def professional_handoff(private_pem: str, subject: uuid.UUID) -> str:
    """A hand-off minted by Professional's own code (create_partner_handoff_token), run in
    Professional's virtual environment: the real issuer, end to end."""
    python = PROFESSIONAL_BACKEND / ".venv" / "Scripts" / "python.exe"
    if not python.exists():
        python = PROFESSIONAL_BACKEND / ".venv" / "bin" / "python"
    program = (
        "import os, sys, uuid\n"
        "from app.core.config import Settings\n"
        "from app.core.security.access_tokens import create_partner_handoff_token\n"
        "settings = Settings(_env_file=None, environment='test', "
        "database_url='postgresql+psycopg://unused:unused@localhost/unused', jwt_secret_key='k' * 64, "
        "partner_handoff_private_key=os.environ['HANDOFF_KEY'])\n"
        "sys.stdout.write(create_partner_handoff_token(settings, uuid.UUID(sys.argv[1])))\n"
    )
    environment = {**os.environ, "HANDOFF_KEY": private_pem, "PYTHONPATH": str(PROFESSIONAL_BACKEND)}
    for name in ("DATABASE_URL", "JWT_SECRET_KEY", "ENVIRONMENT", "PROFESSIONAL_SCHEMA"):
        environment.pop(name, None)
    result = subprocess.run(  # noqa: S603 our own interpreter and program
        [str(python), "-c", program, str(subject)],
        cwd=PROFESSIONAL_BACKEND,
        env=environment,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    assert result.returncode == 0, result.stderr[-2000:]
    return result.stdout.strip()


class FakeEmail:
    """Collects the codes the app would e-mail."""

    def __init__(self) -> None:
        self.sent: list[tuple[str, str, str]] = []

    @property
    def configured(self) -> bool:
        return True

    def send(self, to_email: str, subject: str, text_body: str, html_body: str | None = None) -> bool:
        self.sent.append((to_email, subject, text_body))
        return True

    def last_code(self) -> str:
        body = self.sent[-1][2]
        return body.split("Your CREWNBUILD code is ")[1][:6]


def add_requester(
    database: Session,
    *,
    role: str | None = "OWNER",
    status: str = "ACTIVE",
    name: str = "Asha Rao",
    email: str | None = None,
) -> uuid.UUID:
    """A row of the stand-in for professional.v_partner_requesters."""
    account_id = uuid.uuid4()
    database.execute(
        text(
            f"INSERT INTO {REQUESTERS_STAND_IN} "  # noqa: S608 the test stand-in
            "(id, name, email, phone, status, address, pincode, location, requester_role) "
            "VALUES (:id, :name, :email, '9876500001', :status, '12 MG Road', '560001', "
            "'MG Road S.O, Bengaluru, Karnataka', :role)"
        ),
        {"id": account_id, "name": name, "email": email, "status": status, "role": role},
    )
    database.commit()
    return account_id


def set_requester(database: Session, account_id: uuid.UUID, **values: Any) -> None:
    assignments = ", ".join(f"{name} = :{name}" for name in values)
    database.execute(
        text(f"UPDATE {REQUESTERS_STAND_IN} SET {assignments} WHERE id = :id"),  # noqa: S608 test helper
        {"id": account_id, **values},
    )
    database.commit()


def finished_technician(
    database: Session, email: str = "ravi@example.in", password: str = STRONG_PASSWORD, *, legacy_bcrypt: bool = False
) -> Technician:
    """A technician who finished registration (the profile step comes with part 2)."""
    password_hash = (
        bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=4)).decode() if legacy_bcrypt else hash_secret(password)
    )
    technician = Technician(
        email=email,
        phone="9876500100",
        password_hash=password_hash,
        status=ACCOUNT_STATUS_ACTIVE,
        email_verified_at=naive_utc_now(),
        onboarding_completed_at=naive_utc_now(),
        name="Ravi Kumar",
    )
    database.add(technician)
    database.commit()
    return technician


def csrf(answer: Any) -> dict[str, str]:
    return {"X-CSRF-Token": answer.json()["csrf_token"]}


def sign_in(client: TestClient, email: str = "ravi@example.in", password: str = STRONG_PASSWORD) -> Any:
    return client.post("/api/v1/auth/login", json={"email": email, "password": password})

"""terms and privacy consent at sign-up

Every sign-up now records the Terms of Service and Privacy Policy versions it accepted
and when (the server's time): users.terms_version, users.privacy_version and
users.terms_accepted_at. All three are nullable: accounts created before this keep
NULLs (no backfill), as do accounts not created by sign-up (administrators, seeds).

Downgrade drops the three columns, and with them the consent recorded since.

Revision ID: 0007
Revises: 0006
Created: 2026-11-17 09:00:00+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: str | Sequence[str] | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "professional"


def upgrade() -> None:
    op.add_column("users", sa.Column("terms_version", sa.String(length=20), nullable=True), schema=SCHEMA)
    op.add_column("users", sa.Column("privacy_version", sa.String(length=20), nullable=True), schema=SCHEMA)
    op.add_column("users", sa.Column("terms_accepted_at", sa.DateTime(timezone=True), nullable=True), schema=SCHEMA)


def downgrade() -> None:
    op.drop_column("users", "terms_accepted_at", schema=SCHEMA)
    op.drop_column("users", "privacy_version", schema=SCHEMA)
    op.drop_column("users", "terms_version", schema=SCHEMA)

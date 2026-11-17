"""terms and privacy consent at registration

The registration step that creates a technician account now records the Terms of
Service and Privacy Policy versions it accepted and when (the server's time):
technicians.terms_version, technicians.privacy_version and technicians.terms_accepted_at.
All three are nullable: accounts registered before this keep NULLs (no backfill).

Downgrade drops the three columns, and with them the consent recorded since.

Revision ID: 0003
Revises: 0002
Created: 2026-11-17 09:00:00+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | Sequence[str] | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "partner"


def upgrade() -> None:
    op.add_column("technicians", sa.Column("terms_version", sa.String(length=20), nullable=True), schema=SCHEMA)
    op.add_column("technicians", sa.Column("privacy_version", sa.String(length=20), nullable=True), schema=SCHEMA)
    op.add_column(
        "technicians", sa.Column("terms_accepted_at", sa.DateTime(timezone=True), nullable=True), schema=SCHEMA
    )


def downgrade() -> None:
    op.drop_column("technicians", "terms_accepted_at", schema=SCHEMA)
    op.drop_column("technicians", "privacy_version", schema=SCHEMA)
    op.drop_column("technicians", "terms_version", schema=SCHEMA)

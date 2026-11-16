"""engineer category from specialization (data)

engineer_profiles.category is derived from the Engineer Category the person chose
(specialization), by the old app's rules (accounts/models.py engineer_category_for):

* SITE_ENGINEER: exactly "Site Engineer" after trimming (spaces, tabs and line breaks,
  as Python's str.strip())
* STORE_MANAGER: "Store Manager" ignoring case
* NULL for every other category

Every save keeps the two in step; this brings any row written otherwise (before the
column existed, or by hand) into line, so Book Technician, the Partner requester view
(v_partner_requesters) and the project Site Engineer assignment all read the same
answer. A row already in step is not touched.

Data only: no schema change. Every category changed is first kept in
professional.migration_0005_engineer_category_backup, and downgrade puts it back and
drops that table. Running upgrade again changes nothing and keeps the first value saved.

Revision ID: 0005
Revises: 0004
Created: 2026-11-15 10:00:00+00:00
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0005"
down_revision: str | Sequence[str] | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

BACKUP = "professional.migration_0005_engineer_category_backup"
TRIMMED = r"btrim(coalesce(specialization, ''), E' \t\r\n')"
DERIVED = (
    "CASE "
    f"WHEN {TRIMMED} = 'Site Engineer' THEN 'SITE_ENGINEER' "
    f"WHEN lower({TRIMMED}) = 'store manager' THEN 'STORE_MANAGER' "
    "END"
)
OUT_OF_STEP = f"category IS DISTINCT FROM ({DERIVED})"


def upgrade() -> None:
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {BACKUP} (
            profile_id uuid PRIMARY KEY,
            old_category text
        )
        """
    )
    op.execute(
        f"INSERT INTO {BACKUP} (profile_id, old_category) "  # noqa: S608 - constant SQL
        f"SELECT id, category FROM professional.engineer_profiles WHERE {OUT_OF_STEP} "
        "ON CONFLICT DO NOTHING"
    )
    op.execute(f"UPDATE professional.engineer_profiles SET category = {DERIVED} WHERE {OUT_OF_STEP}")  # noqa: S608


def downgrade() -> None:
    op.execute(
        "UPDATE professional.engineer_profiles AS profile "  # noqa: S608 - constant SQL
        f"SET category = backup.old_category FROM {BACKUP} AS backup WHERE backup.profile_id = profile.id"
    )
    op.execute(f"DROP TABLE IF EXISTS {BACKUP}")

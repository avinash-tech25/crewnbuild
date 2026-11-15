"""engineer category from specialization (data)

engineer_profiles.category is derived from the Engineer Category the person chose
(specialization), by the old app's rules (accounts/models.py engineer_category_for):

* SITE_ENGINEER: exactly "Site Engineer" after trimming
* STORE_MANAGER: "Store Manager" ignoring case
* NULL for every other category

Every save keeps the two in step; this brings any row written otherwise (before the
column existed, or by hand) into line, so Book Technician, the Partner requester view
(v_partner_requesters) and the project Site Engineer assignment all read the same
answer. A row already in step is not touched.

Data only: no schema change. The category is derived, so downgrade does nothing.

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

DERIVED = (
    "CASE "
    "WHEN btrim(coalesce(specialization, '')) = 'Site Engineer' THEN 'SITE_ENGINEER' "
    "WHEN lower(btrim(coalesce(specialization, ''))) = 'store manager' THEN 'STORE_MANAGER' "
    "END"
)


def upgrade() -> None:
    op.execute(
        "UPDATE professional.engineer_profiles "  # noqa: S608 - constant SQL
        f"SET category = {DERIVED} "
        f"WHERE category IS DISTINCT FROM ({DERIVED})"
    )


def downgrade() -> None:
    # The category is derived from the specialization; there is nothing to restore.
    pass

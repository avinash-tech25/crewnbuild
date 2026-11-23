"""Material usage recorded from the Site Engineer's Store, outside a daily record.

site_material_usages.daily_record_id becomes nullable (a Store usage has no daily record;
its project_id, engineer_id and work_on say where, who and when) and the row gains an
optional note. Both kinds of usage lower the same project_material_stock row, so the
project's balance is counted once.
"""

import sqlalchemy as sa
from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None

SCHEMA = "professional"


def upgrade() -> None:
    op.alter_column("site_material_usages", "daily_record_id", existing_type=sa.Uuid(), nullable=True, schema=SCHEMA)
    op.add_column("site_material_usages", sa.Column("note", sa.Text()), schema=SCHEMA)


def downgrade() -> None:
    op.execute(
        """
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM professional.site_material_usages WHERE daily_record_id IS NULL) THEN
                RAISE EXCEPTION 'Cannot downgrade with material usage recorded from the Store';
            END IF;
        END $$;
        """
    )
    op.drop_column("site_material_usages", "note", schema=SCHEMA)
    op.alter_column("site_material_usages", "daily_record_id", existing_type=sa.Uuid(), nullable=False, schema=SCHEMA)

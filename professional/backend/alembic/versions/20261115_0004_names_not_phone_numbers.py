"""names not phone numbers (data)

A builder's company name or a supplier's store name saved as a phone number (typed, or
filled in by the browser, into the name field before saves refused it) showed that
number as the account's title on every card, list and profile. Where the person's own
name is a real name, it becomes the company / store name, which is what sign-up stores
there (company_name = store_name = the name given). And a person's name saved as a phone
number takes the company / store name when that is a real one. A row where both are phone
numbers has nothing to recover and is left for its owner to correct: saves now refuse a
phone-like name (app/core/display_names.py), so the next one asks for it.

"Phone-like" matches looks_like_phone: once spaces, +, -, (, ) and . are removed, only
digits are left, at least six of them.

Data only: no schema change. The old values are not kept, so downgrade does nothing.

Revision ID: 0004
Revises: 0003
Created: 2026-11-15 09:00:00+00:00
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0004"
down_revision: str | Sequence[str] | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def phone_like(column: str) -> str:
    # Only ever called with the fixed column names below, never with input (hence the
    # S608 notes on the statements built from it).
    return f"regexp_replace(coalesce({column}, ''), '[[:space:]()+.-]', '', 'g') ~ '^[0-9]{{6,}}$'"


def upgrade() -> None:
    # The person's name first, from a real company / store name...
    op.execute(  # noqa: S608 - fixed column names only
        f"""
        UPDATE professional.users AS u SET name = b.company_name
        FROM professional.builder_profiles AS b
        WHERE b.user_id = u.id AND {phone_like("u.name")} AND NOT {phone_like("b.company_name")}
          AND btrim(coalesce(b.company_name, '')) <> ''
        """
    )
    op.execute(  # noqa: S608 - fixed column names only
        f"""
        UPDATE professional.users AS u SET name = s.store_name
        FROM professional.supplier_profiles AS s
        WHERE s.user_id = u.id AND {phone_like("u.name")} AND NOT {phone_like("s.store_name")}
          AND btrim(coalesce(s.store_name, '')) <> ''
        """
    )
    # ...then the company / store name, from a real person's name.
    op.execute(  # noqa: S608 - fixed column names only
        f"""
        UPDATE professional.builder_profiles AS b SET company_name = u.name
        FROM professional.users AS u
        WHERE b.user_id = u.id AND {phone_like("b.company_name")} AND NOT {phone_like("u.name")}
          AND btrim(coalesce(u.name, '')) <> ''
        """
    )
    op.execute(  # noqa: S608 - fixed column names only
        f"""
        UPDATE professional.supplier_profiles AS s SET store_name = u.name
        FROM professional.users AS u
        WHERE s.user_id = u.id AND {phone_like("s.store_name")} AND NOT {phone_like("u.name")}
          AND btrim(coalesce(u.name, '')) <> ''
        """
    )


def downgrade() -> None:
    # The phone numbers are not restored: they were never names.
    pass

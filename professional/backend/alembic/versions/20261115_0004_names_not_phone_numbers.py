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

Data only: no schema change. A users.name is 150 characters, a company / store name 160,
so a longer one is cut to fit. Every value changed is first kept in
professional.migration_0004_names_backup, and downgrade puts it back and drops that
table. Running upgrade again changes nothing and keeps the first value saved.

Revision ID: 0004
Revises: 0003
Created: 2026-11-15 09:00:00+00:00
"""

from collections.abc import Sequence
from typing import NamedTuple

from alembic import op

revision: str = "0004"
down_revision: str | Sequence[str] | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


BACKUP = "professional.migration_0004_names_backup"
USERS_NAME_LENGTH = 150


class Correction(NamedTuple):
    """Set `table.column` to `source_table.source_column` where the first is a phone number
    and the second a real name; both tables are matched on the account (`key` and
    `source_key` hold its id)."""

    table: str
    key: str
    column: str
    source_table: str
    source_key: str
    source_column: str


# The person's name first, from a real company / store name, then the company / store
# name, from a real person's name.
CORRECTIONS = (
    Correction("users", "id", "name", "builder_profiles", "user_id", "company_name"),
    Correction("users", "id", "name", "supplier_profiles", "user_id", "store_name"),
    Correction("builder_profiles", "user_id", "company_name", "users", "id", "name"),
    Correction("supplier_profiles", "user_id", "store_name", "users", "id", "name"),
)


def phone_like(column: str) -> str:
    # Only ever called with the fixed names above, never with input (hence the S608
    # notes on the statements built from them).
    return f"regexp_replace(coalesce({column}, ''), '[[:space:]()+.-]', '', 'g') ~ '^[0-9]{{6,}}$'"


def upgrade() -> None:
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {BACKUP} (
            table_name text NOT NULL,
            user_id uuid NOT NULL,
            old_value text,
            PRIMARY KEY (table_name, user_id)
        )
        """
    )
    for fix in CORRECTIONS:
        source = f"professional.{fix.source_table} AS source"
        matches = f"""
            source.{fix.source_key} = target.{fix.key}
            AND {phone_like(f"target.{fix.column}")} AND NOT {phone_like(f"source.{fix.source_column}")}
            AND btrim(coalesce(source.{fix.source_column}, '')) <> ''
        """
        value = f"source.{fix.source_column}"
        if fix.table == "users":
            value = f"left({value}, {USERS_NAME_LENGTH})"
        op.execute(
            f"""
            INSERT INTO {BACKUP} (table_name, user_id, old_value)
            SELECT '{fix.table}', target.{fix.key}, target.{fix.column}
            FROM professional.{fix.table} AS target, {source}
            WHERE {matches}
            ON CONFLICT DO NOTHING
            """  # noqa: S608 - fixed table and column names only
        )
        op.execute(
            f"UPDATE professional.{fix.table} AS target SET {fix.column} = {value} FROM {source} WHERE {matches}"  # noqa: S608
        )


def downgrade() -> None:
    restored = {(fix.table, fix.key, fix.column) for fix in CORRECTIONS}
    for table, key, column in sorted(restored):
        op.execute(
            f"""
            UPDATE professional.{table} AS target SET {column} = backup.old_value
            FROM {BACKUP} AS backup
            WHERE backup.table_name = '{table}' AND backup.user_id = target.{key}
            """  # noqa: S608 - fixed table and column names only
        )
    op.execute(f"DROP TABLE IF EXISTS {BACKUP}")

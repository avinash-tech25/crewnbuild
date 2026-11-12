"""Load the master catalog (ported from the old sql_scripts/master_catalog_seed.sql).

    python -m app.seeds.seed_master_catalog

Runs app/seeds/master_catalog_seed.sql, one DO block, in one transaction: units,
brands, categories, subcategories, products and variants are added where missing,
nothing existing is changed or deleted, and any failed check rolls the whole run back.
The script's own messages ("Added ...", "Exists ...", the CHECK lines) are printed.

Reference data, not an account, so it runs in every environment, production
included. The catalog tables must exist (the Professional migrations create them);
the R5 baseline can run the same file with op.execute.
"""

import sys
from pathlib import Path
from typing import Any

from sqlalchemy import Engine

SEED_FILE = Path(__file__).with_name("master_catalog_seed.sql")


def seed_sql() -> str:
    return SEED_FILE.read_text(encoding="utf-8")


def run(engine: Engine) -> list[str]:
    """Run the seed in one transaction; the PostgreSQL notices it raised, in order."""
    with engine.begin() as connection:
        raw = connection.connection.driver_connection
        notices: list[str] = []

        def collect(diagnostic: Any) -> None:
            notices.append(diagnostic.message_primary or "")

        raw.add_notice_handler(collect)  # type: ignore[union-attr]
        try:
            # On the driver's cursor with no parameters, so the % in RAISE messages is
            # not read as a placeholder.
            with connection.connection.cursor() as cursor:
                cursor.execute(seed_sql())
        finally:
            raw.remove_notice_handler(collect)  # type: ignore[union-attr]
    return notices


def main() -> int:
    from app.database.session import engine

    try:
        notices = run(engine)
    except Exception as error:
        print(f"Refused: {error}")  # noqa: T201 command-line output
        return 1
    for message in notices:
        print(message)  # noqa: T201 command-line output
    return 0


if __name__ == "__main__":
    sys.exit(main())

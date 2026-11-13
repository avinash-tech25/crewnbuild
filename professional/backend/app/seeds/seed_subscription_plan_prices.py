"""Load the builder plan prices (the old alembic revision 0031_seed_plan_prices and
app/subscription/seed_dev_prices.py).

    python -m app.seeds.seed_subscription_plan_prices [--update] [--deactivate-unlisted]

The three offered cards, in rupees:
    Pro      (PROFESSIONAL, MONTHLY)  Rs 899 for 1 month
    Plus     (BUSINESS, MONTHLY)      Rs 1,199 for 1 month
    Premium  (BUSINESS, ANNUAL)       Rs 9,999 for 12 months
Every other combination is left unpriced, so the server refuses to sell anything else.

Reference data (MG-03), so by default it runs in every environment, production included,
as the old migration did: only missing (plan, duration) rows are inserted and nothing
existing is changed. A price change is a business decision: --update (set the listed
prices on existing rows and re-activate them) and --deactivate-unlisted (is_active =
false on prices not listed; rows are never deleted) are refused with
ENVIRONMENT=production, as the old development script refused.
"""

import argparse
import sys
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.modules.billing.models import SubscriptionPlanPrice

CURRENCY = "INR"
PLAN_PRICES_RUPEES = {
    ("PROFESSIONAL", "MONTHLY"): 899,
    ("BUSINESS", "MONTHLY"): 1199,
    ("BUSINESS", "ANNUAL"): 9999,
}


class SeedRefusedError(Exception):
    pass


@dataclass
class SeedResult:
    inserted: list[tuple[str, str, int]] = field(default_factory=list)
    updated: list[tuple[str, str, int]] = field(default_factory=list)
    kept: list[tuple[str, str, int]] = field(default_factory=list)
    deactivated: list[tuple[str, str, int]] = field(default_factory=list)


def run(database: Session, *, update: bool = False, deactivate_unlisted: bool = False) -> SeedResult:
    if (update or deactivate_unlisted) and get_settings().is_production():
        raise SeedRefusedError(
            "Refused: --update and --deactivate-unlisted change prices and are not run with ENVIRONMENT=production."
        )
    result = SeedResult()
    for (plan_code, duration_code), rupees in PLAN_PRICES_RUPEES.items():
        paise = rupees * 100
        existing = database.scalars(
            select(SubscriptionPlanPrice).where(
                SubscriptionPlanPrice.plan_code == plan_code,
                SubscriptionPlanPrice.duration_code == duration_code,
                SubscriptionPlanPrice.currency == CURRENCY,
            )
        ).first()
        if existing is None:
            database.add(
                SubscriptionPlanPrice(
                    plan_code=plan_code, duration_code=duration_code, amount_paise=paise, currency=CURRENCY
                )
            )
            result.inserted.append((plan_code, duration_code, paise))
        elif update and (existing.amount_paise != paise or not existing.is_active):
            existing.amount_paise, existing.is_active = paise, True
            result.updated.append((plan_code, duration_code, paise))
        else:
            result.kept.append((plan_code, duration_code, int(existing.amount_paise)))
    if deactivate_unlisted:
        for row in database.scalars(select(SubscriptionPlanPrice).where(SubscriptionPlanPrice.is_active.is_(True))):
            if (row.plan_code, row.duration_code) not in PLAN_PRICES_RUPEES:
                row.is_active = False
                result.deactivated.append((row.plan_code, row.duration_code, int(row.amount_paise)))
    database.commit()
    return result


def main() -> int:
    from app.database.session import SessionLocal

    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--update", action="store_true", help="set the listed prices on existing rows too")
    parser.add_argument("--deactivate-unlisted", action="store_true", help="switch off prices not listed here")
    arguments = parser.parse_args()
    database = SessionLocal()
    try:
        result = run(database, update=arguments.update, deactivate_unlisted=arguments.deactivate_unlisted)
    except SeedRefusedError as error:
        print(error)  # noqa: T201 command-line output
        return 1
    finally:
        database.close()
    for label, rows in (
        ("inserted", result.inserted),
        ("updated", result.updated),
        ("already present (unchanged)", result.kept),
        ("deactivated (kept, not deleted)", result.deactivated),
    ):
        for plan_code, duration_code, paise in rows:
            print(f"  {label:32} {plan_code:13} {duration_code:11} INR {paise / 100:>9,.2f}")  # noqa: T201
    return 0


if __name__ == "__main__":
    sys.exit(main())

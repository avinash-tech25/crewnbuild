"""Load the reference data of both services (MG-03), after scripts/migrate.py.

    python scripts/seed.py                       reference data (every environment)
    python scripts/seed.py --with-test-accounts  also the OTP test accounts (never production)

Reference data, in order: Professional's master catalog and subscription plan prices,
then Partner's service catalog and checklist templates. Every seed is idempotent, so the
script can be run again at any time. The first administrator is separate, because it
needs its own settings: python -m app.seeds.seed_admin_account (in professional/backend).

Like scripts/migrate.py, each backend uses its own .env; PROFESSIONAL_DATABASE_URL or
PARTNER_DATABASE_URL in the environment replace that backend's DATABASE_URL.
"""

import sys

from migrate import run_module

REFERENCE = [
    ("professional", "app.seeds.seed_master_catalog"),
    ("professional", "app.seeds.seed_subscription_plan_prices"),
    ("partner", "app.seeds.seed_service_catalog"),
    ("partner", "app.seeds.seed_service_checklists"),
]
TEST_ACCOUNTS = [("professional", "app.seeds.seed_test_accounts")]


def main(argv: list[str]) -> None:
    extra = argv[1:]
    if extra not in ([], ["--with-test-accounts"]):
        sys.exit("usage: python scripts/seed.py [--with-test-accounts]")
    for service, module in REFERENCE + (TEST_ACCOUNTS if extra else []):
        run_module(service, module)
    print("\nDone.")


if __name__ == "__main__":
    main(sys.argv)

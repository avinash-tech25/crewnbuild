"""Migrate both services, in the one order that works (technical-architecture.md 16.2).

The two schemas refer to each other, so neither service can be migrated in one go:

    1. Professional up to 0001   its tables, professional.v_partner_requesters, grants to Partner
    2. Partner up to head        its tables, the key to professional.users, its view and grants
    3. Professional up to head   0002: booking_payment_orders.booking_id -> partner.bookings

    python scripts/migrate.py            upgrade both (safe to run again: Alembic skips what is done)
    python scripts/migrate.py --down     downgrade both to an empty database, in reverse order
    python scripts/migrate.py --check    `alembic check` for both: models and database must match

Each backend uses its own .env (its own role and password). PROFESSIONAL_DATABASE_URL or
PARTNER_DATABASE_URL in the environment replace that backend's DATABASE_URL (CI, or a
throwaway database). Nothing is printed but Alembic's own output, never an address.
"""

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROFESSIONAL_BASELINE = "0001"

UP = [
    ("professional", ["upgrade", PROFESSIONAL_BASELINE]),
    ("partner", ["upgrade", "head"]),
    ("professional", ["upgrade", "head"]),
]
DOWN = [
    ("professional", ["downgrade", PROFESSIONAL_BASELINE]),
    ("partner", ["downgrade", "base"]),
    ("professional", ["downgrade", "base"]),
]
CHECK = [("professional", ["check"]), ("partner", ["check"])]


def backend_python(service: str) -> str:
    """The backend's own virtual environment, or this interpreter if it has none."""
    backend = ROOT / service / "backend"
    for candidate in (
        backend / ".venv" / "Scripts" / "python.exe",
        backend / ".venv" / "bin" / "python",
    ):
        if candidate.exists():
            return str(candidate)
    return sys.executable


def run_module(service: str, module: str, *arguments: str) -> None:
    """python -m <module> <arguments> in the backend, with its own environment; stops on failure."""
    env = dict(os.environ)
    override = env.get(f"{service.upper()}_DATABASE_URL")
    if override:
        env["DATABASE_URL"] = override
    label = f"{service}: {module} {' '.join(arguments)}".rstrip()
    print(f"\n==> {label}", flush=True)
    result = subprocess.run(
        [backend_python(service), "-m", module, *arguments],
        cwd=ROOT / service / "backend",
        env=env,
        check=False,
    )
    if result.returncode != 0:
        sys.exit(f"{label} failed (exit {result.returncode}); stopped.")


def run(service: str, arguments: list[str]) -> None:
    run_module(service, "alembic", *arguments)


def main(argv: list[str]) -> None:
    mode = argv[1] if len(argv) > 1 else "--up"
    steps = {"--up": UP, "--down": DOWN, "--check": CHECK}.get(mode)
    if steps is None:
        sys.exit("usage: python scripts/migrate.py [--up | --down | --check]")
    for service, arguments in steps:
        run(service, arguments)
    print("\nDone.")


if __name__ == "__main__":
    main(sys.argv)

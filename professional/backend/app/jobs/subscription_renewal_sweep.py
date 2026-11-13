"""Send the due renewal reminders and expiry notices for every active builder (the old
app/subscription/sweep.py, same rules).

These notices are otherwise written the next time the builder's status is read
(GET /subscriptions/me). The old backend also ran this sweep itself, at startup and every
SUBSCRIPTION_SWEEP_INTERVAL_MINUTES, in a daemon thread; here it is run by the scheduler
unit (app/jobs/run_scheduler.py, section 15.1), not by the API processes, so a builder whose
free month or paid plan ends while they are signed out, and the house owners and Site
Engineers of their projects, are still told. It can also be run once by hand:

    .venv/Scripts/python.exe -m app.jobs.subscription_renewal_sweep

Safe to run repeatedly and concurrently: each notice is recorded once (on its period row,
or by the builder's free-access notification) and sent once.
"""

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database.session import SessionLocal
from app.modules.billing.entitlements import BUILDER_ROLE, sync_lifecycle
from app.modules.identity.models import STATUS_ACTIVE, User

logger = logging.getLogger(__name__)


def run(database: Session | None = None) -> int:
    """One pass over every active builder; returns how many were checked."""
    owns_session = database is None
    session = database or SessionLocal()
    processed = 0
    try:
        builder_ids = list(
            session.scalars(select(User.id).where(User.role == BUILDER_ROLE, User.status == STATUS_ACTIVE)).all()
        )
        for builder_id in builder_ids:
            builder = session.get(User, builder_id)
            if builder is None:
                continue
            try:
                sync_lifecycle(session, builder)
                processed += 1
            except Exception:
                session.rollback()
                logger.exception("subscription.sweep_failed builder=%s", builder_id)
    finally:
        if owns_session:
            session.close()
    return processed


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    logger.info("subscription.sweep builders=%s", run())

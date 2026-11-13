"""Technician earnings: recorded at job completion, read by the technician.

Money is Decimal throughout -- never binary floating point -- and every amount is
rounded to the paisa with ROUND_HALF_UP (0.005 rounds up), which is what the
database's round(numeric, 2) does for these non-negative amounts; the table's
CHECK constraints hold the stored figures to exactly this arithmetic:

    commission_amount = (gross_amount * commission_rate / 100) rounded half-up to 0.01
    net_amount        = gross_amount - commission_amount

There is no customer payment and no payout yet: an earning is a record of what a
completed, priced job is worth to the technician under the commission configured
when it was completed -- nothing more is claimed.
"""

from datetime import UTC, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.runtime import settings
from app.database.types import naive_utc_now
from app.modules.bookings.models import ServiceRequest
from app.modules.identity.models import Technician
from app.modules.technicians.models import EARNING_RECORDED, TechnicianEarning
from app.modules.technicians.repository import EarningsRepository
from app.modules.technicians.schemas import EarningOut, EarningsSummary

PAISA = Decimal("0.01")
HUNDRED = Decimal("100")
CURRENCY_INR = "INR"
# Partner is India-only: "today", "this week" and "this month" are India's. IST has been
# a fixed UTC+05:30 with no daylight saving since 1945, so a fixed offset is exact --
# and needs no time-zone database (Windows has none without the tzdata package).
INDIA = timezone(timedelta(hours=5, minutes=30), "IST")


class CommissionConfigurationError(RuntimeError):
    """The configured rate is not a valid percentage. Completing a job fails
    rather than recording money under a rate nobody could have meant."""


def configured_commission_rate() -> Decimal:
    """The rate to snapshot now, checked again at the moment of use."""
    rate = settings.partner_commission_rate_percent
    if (
        not isinstance(rate, Decimal)
        or not rate.is_finite()
        or rate < 0
        or rate > HUNDRED
        or rate.as_tuple().exponent < -2
    ):
        raise CommissionConfigurationError(
            "PARTNER_COMMISSION_RATE_PERCENT is not a percentage from 0 to 100 with at most two decimals."
        )
    return rate.quantize(PAISA)


def split_amount(gross: Decimal, rate: Decimal) -> tuple[Decimal, Decimal]:
    """(commission, net) for a gross amount and a percentage rate, to the paisa."""
    gross = Decimal(gross).quantize(PAISA)
    commission = (gross * rate / HUNDRED).quantize(PAISA, rounding=ROUND_HALF_UP)
    return commission, gross - commission


def record_earning_for_completion(
    database: Session, booking: ServiceRequest, earned_at: datetime
) -> TechnicianEarning | None:
    """Add the booking's earning to the CURRENT transaction -- the one completing it.

    A booking made before the catalog has no quoted price. Its completion still
    succeeds, and no earning is recorded: there is no amount to record, and one is
    never invented. The caller holds the booking's row lock and commits; the
    UNIQUE constraint on service_request_id is the backstop against a second row.
    """
    if booking.quoted_amount is None:
        return None
    rate = configured_commission_rate()
    commission, net = split_amount(booking.quoted_amount, rate)
    earning = TechnicianEarning(
        technician_id=booking.technician_id,
        service_request_id=booking.id,
        service_name=booking.service.service_name if booking.service else None,
        service_kind=booking.service_kind,
        gross_amount=Decimal(booking.quoted_amount).quantize(PAISA),
        commission_rate=rate,
        commission_amount=commission,
        net_amount=net,
        currency=booking.currency or CURRENCY_INR,
        status=EARNING_RECORDED,
        earned_at=earned_at,
    )
    EarningsRepository(database).add(earning)
    return earning


def _utc_naive(moment: datetime) -> datetime:
    return moment.astimezone(UTC).replace(tzinfo=None)


def period_starts(now_utc: datetime) -> dict[str, datetime]:
    """Start of today, this week (Monday) and this month in India, as naive UTC."""
    local = now_utc.replace(tzinfo=UTC).astimezone(INDIA)
    day = local.replace(hour=0, minute=0, second=0, microsecond=0)
    return {
        "today": _utc_naive(day),
        "week": _utc_naive(day - timedelta(days=day.weekday())),
        "month": _utc_naive(day.replace(day=1)),
    }


def earning_out(earning: TechnicianEarning) -> EarningOut:
    return EarningOut(
        id=earning.id,
        service_request_id=earning.service_request_id,
        service_name=earning.service_name,
        service_kind=earning.service_kind,
        earned_at=earning.earned_at,
        gross_amount=earning.gross_amount,
        commission_rate=earning.commission_rate,
        commission_amount=earning.commission_amount,
        net_amount=earning.net_amount,
        currency=earning.currency,
        status=earning.status,
    )


class EarningsService:
    def __init__(self, repository: EarningsRepository):
        self.repository = repository

    def _mine(self, technician: Technician):
        return self.repository.query_by_technician(technician.id)

    def summary(self, technician: Technician, now_utc: datetime | None = None) -> EarningsSummary:
        starts = period_starts(now_utc or naive_utc_now())
        net_since = lambda start: func.coalesce(
            func.sum(TechnicianEarning.net_amount).filter(TechnicianEarning.earned_at >= start), 0
        )
        row = self.repository.get_summary_totals(net_since, starts, technician.id)
        money = lambda value: Decimal(value).quantize(PAISA)
        return EarningsSummary(
            currency=CURRENCY_INR,
            today_net=money(row[0]),
            week_net=money(row[1]),
            month_net=money(row[2]),
            total_net=money(row[3]),
            total_gross=money(row[4]),
            total_commission=money(row[5]),
            earnings_count=row[6],
            timezone="Asia/Kolkata",
        )

    def history(self, technician: Technician, limit: int, offset: int) -> list[EarningOut]:
        if not 1 <= limit <= 100 or offset < 0:
            raise HTTPException(status_code=422, detail="Choose a limit from 1 to 100 and an offset of 0 or more.")
        rows = (
            self._mine(technician)
            .order_by(TechnicianEarning.earned_at.desc(), TechnicianEarning.id)
            .limit(limit)
            .offset(offset)
            .all()
        )
        return [earning_out(row) for row in rows]

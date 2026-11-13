"""Request bodies of labour supply (the old schemas/labor.py; same fields and rules, ids
are UUIDs)."""

import uuid
from datetime import date
from decimal import Decimal
from typing import Annotated

from pydantic import AfterValidator, BaseModel, Field

from app.modules.labour_supply.models import LABOR_TRADES


def canonical_trade(value: str) -> str:
    """'tile worker' -> 'Tile Worker'. Only the supported trade vocabulary is accepted."""
    wanted = (value or "").strip().casefold()
    for trade in LABOR_TRADES:
        if trade.casefold() == wanted:
            return trade
    raise ValueError(f"Unsupported trade. Choose one of: {', '.join(LABOR_TRADES)}.")


def clean_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


# Well above any real crew, far below the integer limit: an absurd number is a 422.
MAX_WORKERS = 10_000

Trade = Annotated[str, AfterValidator(canonical_trade)]
OptionalText = Annotated[str | None, AfterValidator(clean_optional_text)]


class LaborServiceCreate(BaseModel):
    trade: Trade
    skill_level: OptionalText = Field(default=None, max_length=20)
    worker_capacity: int = Field(ge=0, le=MAX_WORKERS)
    is_active: bool = True
    notes: OptionalText = None


class LaborServiceUpdate(BaseModel):
    """The trade itself is fixed once created; add another service for another trade."""

    skill_level: OptionalText = Field(default=None, max_length=20)
    worker_capacity: int | None = Field(default=None, ge=0, le=MAX_WORKERS)
    is_active: bool | None = None
    notes: OptionalText = None


class LaborRequestCreate(BaseModel):
    supplier_id: uuid.UUID
    trade: Trade
    workers_required: int = Field(gt=0, le=MAX_WORKERS)
    start_date: date
    end_date: date | None = None
    work_description: OptionalText = None


class LaborRequestUpdate(BaseModel):
    """end_date / work_description while PENDING or ACCEPTED; workers_required /
    start_date only while PENDING."""

    end_date: date | None = None
    work_description: OptionalText = None
    workers_required: int | None = Field(default=None, gt=0, le=MAX_WORKERS)
    start_date: date | None = None


class LaborAccept(BaseModel):
    workers_allocated: int = Field(gt=0, le=MAX_WORKERS)
    decision_note: OptionalText = None


class LaborDecisionNote(BaseModel):
    decision_note: OptionalText = None


class LaborDailyRecordPut(BaseModel):
    present_count: int = Field(default=0, ge=0)
    absent_count: int = Field(default=0, ge=0)
    half_day_count: int = Field(default=0, ge=0)
    overtime_workers: int = Field(default=0, ge=0)
    overtime_hours: Decimal = Field(default=Decimal("0"), ge=0, max_digits=6, decimal_places=2)
    activity: OptionalText = Field(default=None, max_length=255)
    notes: OptionalText = None

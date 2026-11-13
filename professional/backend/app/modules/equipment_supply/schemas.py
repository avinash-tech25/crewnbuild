"""Request bodies of equipment supply (the old schemas/equipment.py; same fields and
rules, ids are UUIDs)."""

import uuid
from datetime import date
from decimal import Decimal
from typing import Annotated, Any, Literal

from pydantic import AfterValidator, BaseModel, BeforeValidator, Field, model_validator

from app.modules.equipment_supply.models import RATE_COLUMNS


def clean_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


def upper(value: Any) -> Any:
    return value.strip().upper() if isinstance(value, str) else value


OptionalText = Annotated[str | None, AfterValidator(clean_optional_text)]
RequiredText = Annotated[str, AfterValidator(lambda value: value.strip())]
Mode = Annotated[Literal["RENT", "BUY", "RENT_BUY"], BeforeValidator(upper)]
Condition = Annotated[Literal["NEW", "USED"], BeforeValidator(upper)]
Kind = Annotated[Literal["RENT", "BUY"], BeforeValidator(upper)]
RateUnit = Annotated[Literal["HOUR", "DAY", "WEEK", "MONTH"], BeforeValidator(upper)]
Price = Annotated[Decimal, Field(gt=0, max_digits=12, decimal_places=2)]

RATE_FIELDS = tuple(RATE_COLUMNS.values())


def item_pricing_problem(mode: str, values: dict[str, Any]) -> str | None:
    """The mode/price rule the database also enforces, as a readable message."""
    if mode in ("RENT", "RENT_BUY") and not any(values.get(rate) is not None for rate in RATE_FIELDS):
        return "A RENT or RENT_BUY item needs at least one rental rate (hourly, daily, weekly or monthly)."
    if mode in ("BUY", "RENT_BUY") and values.get("sale_price") is None:
        return "A BUY or RENT_BUY item needs a sale price."
    return None


class EquipmentItemCreate(BaseModel):
    name: Annotated[RequiredText, Field(min_length=1, max_length=120)]
    category: Annotated[RequiredText, Field(min_length=1, max_length=60)]
    brand: OptionalText = Field(default=None, max_length=80)
    model: OptionalText = Field(default=None, max_length=80)
    specifications: OptionalText = None
    condition: Condition
    mode: Mode
    quantity_total: int = Field(ge=0, le=10_000)
    hourly_rate: Price | None = None
    daily_rate: Price | None = None
    weekly_rate: Price | None = None
    monthly_rate: Price | None = None
    sale_price: Price | None = None
    image_url: OptionalText = Field(default=None, max_length=500)
    is_active: bool = True

    @model_validator(mode="after")
    def pricing_matches_mode(self) -> "EquipmentItemCreate":
        problem = item_pricing_problem(self.mode, self.model_dump())
        if problem:
            raise ValueError(problem)
        return self


class EquipmentItemUpdate(BaseModel):
    """Partial. The mode/price rule is checked on the merged result by the service."""

    name: Annotated[RequiredText, Field(min_length=1, max_length=120)] | None = None
    category: Annotated[RequiredText, Field(min_length=1, max_length=60)] | None = None
    brand: OptionalText = Field(default=None, max_length=80)
    model: OptionalText = Field(default=None, max_length=80)
    specifications: OptionalText = None
    condition: Condition | None = None
    mode: Mode | None = None
    quantity_total: int | None = Field(default=None, ge=0, le=10_000)
    hourly_rate: Price | None = None
    daily_rate: Price | None = None
    weekly_rate: Price | None = None
    monthly_rate: Price | None = None
    sale_price: Price | None = None
    image_url: OptionalText = Field(default=None, max_length=500)
    is_active: bool | None = None


class EquipmentRequestCreate(BaseModel):
    equipment_item_id: uuid.UUID
    request_kind: Kind
    quantity: int = Field(gt=0, le=10_000)
    rate_unit: RateUnit | None = None
    start_date: date | None = None
    end_date: date | None = None
    notes: OptionalText = None

    @model_validator(mode="after")
    def kind_fields(self) -> "EquipmentRequestCreate":
        if self.request_kind == "RENT":
            if self.rate_unit is None:
                raise ValueError("A RENT request needs a rate_unit (HOUR, DAY, WEEK or MONTH).")
            if self.start_date is None or self.end_date is None:
                raise ValueError("A RENT request needs a start_date and an end_date.")
        elif self.rate_unit is not None:
            raise ValueError("A BUY request has no rate_unit.")
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError("end_date cannot be before start_date.")
        return self


class EquipmentDecisionNote(BaseModel):
    decision_note: OptionalText = None


class EquipmentUsagePut(BaseModel):
    hours_used: Decimal = Field(ge=0, max_digits=6, decimal_places=2)
    notes: OptionalText = None

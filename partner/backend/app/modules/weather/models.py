"""The forecast cache, shared by every API process (porting-todo #72, closed in R6).

One row per place, its position rounded to PLACE_DECIMALS (about a kilometre): the last
forecast fetched for it, when, and the last failure. Readers in any process share a fetch;
the transaction-scoped advisory lock per place in weather_service makes one process fetch
while the others wait for its row.
"""

from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import DateTime, Numeric, PrimaryKeyConstraint, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base


class WeatherForecast(Base):
    __tablename__ = "weather_forecasts"
    __table_args__ = (PrimaryKeyConstraint("latitude", "longitude"),)

    latitude: Mapped[Decimal] = mapped_column(Numeric(5, 2))
    longitude: Mapped[Decimal] = mapped_column(Numeric(6, 2))
    data: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    fetched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error: Mapped[str | None] = mapped_column(String(200))
    failed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

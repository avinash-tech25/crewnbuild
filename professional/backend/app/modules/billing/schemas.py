"""Request bodies of the builder tools (billing/router.py)."""

from typing import Literal

from pydantic import BaseModel, Field


class CostAdjustmentRequest(BaseModel):
    field_name: Literal["labour_cost", "material_cost", "equipment_cost", "total_expenses"]
    adjusted_value: float = Field(ge=0)
    reason: str = Field(min_length=3, max_length=500)

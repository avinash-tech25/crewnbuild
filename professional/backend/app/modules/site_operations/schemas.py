"""Request bodies of the cost tool and the legacy logs (the old schemas/daily_cost.py and
schemas/logs.py; same fields, ids are UUIDs)."""

import uuid
from datetime import date, datetime

from pydantic import BaseModel, Field


class DailyCostRegisterCreate(BaseModel):
    project_id: uuid.UUID
    work_date: date
    floor: str
    block: str
    work_type: str
    progress_note: str | None = None


class CostLabourEntryCreate(BaseModel):
    labour_category: str
    worker_name: str | None = None
    worker_count: int = Field(gt=0)
    daily_wage: float = Field(ge=0)
    attendance_status: str
    overtime_hours: float = Field(ge=0)
    overtime_rate: float = Field(ge=0)
    advance_paid: float = Field(ge=0)
    remarks: str | None = None


class CostMaterialUsageCreate(BaseModel):
    material: str
    opening_stock: float = Field(ge=0)
    quantity_used: float = Field(ge=0)
    unit: str
    rate: float = Field(ge=0)
    minimum_stock: float = Field(ge=0)


class CostMaterialPurchaseCreate(BaseModel):
    supplier_name: str
    invoice_number: str | None = None
    material: str
    quantity: float = Field(gt=0)
    unit: str
    rate: float = Field(ge=0)
    transport_cost: float = Field(ge=0)
    loading_cost: float = Field(ge=0)
    unloading_cost: float = Field(ge=0)
    gst_percent: float = Field(ge=0)
    discount: float = Field(ge=0)
    purchase_date: date
    minimum_stock: float = Field(ge=0)


class CostExpenseCreate(BaseModel):
    category: str
    description: str | None = None
    amount: float = Field(ge=0)
    expense_date: date


class CostMachineryUsageCreate(BaseModel):
    machine: str
    hours: float = Field(ge=0)
    rate_per_hour: float = Field(ge=0)
    operator_charge: float = Field(ge=0)
    fuel_cost: float = Field(ge=0)
    maintenance_cost: float = Field(ge=0)


class CostPaymentCreate(BaseModel):
    direction: str
    payment_type: str
    party_name: str | None = None
    amount: float = Field(ge=0)
    payment_date: date
    remarks: str | None = None


class MaterialCreate(BaseModel):
    project_id: uuid.UUID
    material_name: str
    quantity: float
    unit: str
    cost: float


class LabourCreate(BaseModel):
    project_id: uuid.UUID
    labour_count: int
    labour_cost: float
    work_date: datetime

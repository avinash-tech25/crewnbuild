"""Request bodies of the project endpoints (the old schemas/project.py and
schemas/engineer.py; same fields, ids are UUIDs)."""

from datetime import date
from uuid import UUID

from pydantic import BaseModel, field_validator

from app.modules.identity.schemas import INDIA_ONLY_DETAIL, RETIRED_KUWAIT_VALUES


class ProjectCreate(BaseModel):
    title: str
    description: str
    address: str
    pincode: str
    building_type: str
    construction_type: str
    budget: float = 0
    land_area: float = 0
    floors: int = 1
    floor_type: str | None = None
    project_country: str | None = None
    project_state: str | None = None
    project_city: str | None = None
    # The accepted estimate, carried with the request that creates the project.
    estimated_cost: float | None = None
    estimated_duration_days: int | None = None
    material_estimate: float | None = None
    labour_estimate: float | None = None
    # The owner's schedule; required on create, optional on PATCH /requirement.
    start_date: date | None = None
    end_date: date | None = None

    @field_validator("project_country")
    @classmethod
    def _india_only(cls, value: str | None) -> str | None:
        if str(value or "").strip().upper() in RETIRED_KUWAIT_VALUES:
            raise ValueError(INDIA_ONLY_DETAIL)
        return value


class ProjectProgressUpdate(BaseModel):
    completion_percentage: int


class ProjectRequestCreate(BaseModel):
    receiver_id: UUID
    project_id: UUID | None = None
    request_type: str
    quotation_amount: float | None = None


class RequestDecision(BaseModel):
    request_id: UUID
    quotation_amount: float | None = None


class AssignDecision(RequestDecision):
    # Optional: the owner's opening counter-offer ("Negotiate"), in one transaction.
    offer_amount: float | None = None
    offer_note: str | None = None


class AwardAmount(BaseModel):
    # The amount the user saw on screen; refused (409) if it has changed since.
    amount: float


class AwardOfferCreate(BaseModel):
    amount: float
    note: str | None = None


class EngineerInviteCreate(BaseModel):
    phone: str | None = None
    email: str | None = None


class EngineerJoinTeamRequest(BaseModel):
    invite_code: str


class EngineerJoinRequestCreate(BaseModel):
    contractor_id: UUID


class EngineerJoinRequestDecision(BaseModel):
    relationship_id: UUID
    action: str


class EngineerAssignRequest(BaseModel):
    engineer_id: UUID


class EngineerSendRequest(BaseModel):
    engineer_id: UUID
    project_id: UUID | None = None


class SupplierAssignRequest(BaseModel):
    supplier_id: UUID
    engineer_id: UUID

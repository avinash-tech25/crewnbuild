"""Request and response bodies of the accounts endpoints ported so far."""

from pydantic import BaseModel

from app.modules.identity.schemas import UserResponse


class EngineerCategoryUpdate(BaseModel):
    """The category a new engineer chose. The account comes from the session."""

    specialization: str


class EngineerCategorySaved(BaseModel):
    specialization: str
    user: UserResponse

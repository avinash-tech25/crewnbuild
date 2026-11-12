"""Request bodies of the content endpoints (field names unchanged)."""

from pydantic import BaseModel, Field, field_validator

from app.modules.identity.schemas import reject_kuwait_value


class EstimateCreate(BaseModel):
    country: str = "India"
    location: str
    pincode: str
    plot_area: float
    floors: int | None = None
    floor_type: str | None = None
    construction_type: str
    building_type: str
    finishing_type: str
    budget: float = 0

    @field_validator("country")
    @classmethod
    def india_only(cls, value: str) -> str:
        return reject_kuwait_value(value) or value


class PublicEstimateRequest(BaseModel):
    """The public Get Estimate page: the PIN is verified against the state and city."""

    country: str
    state: str
    city: str
    pincode: str
    plot_area: float
    floors: int | None = None
    floor_type: str | None = None
    construction_type: str
    building_type: str
    finishing_type: str
    budget: float = 0

    @field_validator("country")
    @classmethod
    def india(cls, value: str) -> str:
        value = reject_kuwait_value((value or "").strip()) or ""
        if value.casefold() != "india":
            raise ValueError("Get Estimate is available for India only.")
        return "India"

    @field_validator("state", "city")
    @classmethod
    def required_place(cls, value: str) -> str:
        value = " ".join((value or "").split())
        if not value:
            raise ValueError("This field is required.")
        return value

    def to_estimate_create(self) -> EstimateCreate:
        return EstimateCreate(
            country=self.country,
            location=f"{self.city}, {self.state}",
            pincode=self.pincode,
            plot_area=self.plot_area,
            floors=self.floors,
            floor_type=self.floor_type,
            construction_type=self.construction_type,
            building_type=self.building_type,
            finishing_type=self.finishing_type,
            budget=self.budget,
        )


class AdvertEvent(BaseModel):
    placement: str
    # VIEW or CLICK; anything else is ignored.
    event: str


class TranslationRequest(BaseModel):
    texts: list[str] = Field(default_factory=list)
    target: str


class TranslationResponse(BaseModel):
    translations: dict[str, str]
    configured: bool

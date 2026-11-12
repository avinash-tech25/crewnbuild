"""Construction cost estimates (ported from the old house_owner estimate_service.py; the
calculation is unchanged). Both calculators are public; the old POST /estimates (save) was
retired: it never worked and nothing called it."""

from typing import Any

from fastapi import HTTPException

from app.modules.content.schemas import EstimateCreate

# The stages a project's escrow milestones are opened with (projects module); an
# estimate shows its total split the same way.
CONSTRUCTION_STAGES: tuple[tuple[str, float], ...] = (
    ("Foundation", 0.25),
    ("Structure", 0.45),
    ("Finishing", 0.30),
)


ESTIMATE_PINCODE_RATE_MODIFIERS = {
    "110": ("Delhi NCR", 1.20),
    "122": ("Gurugram", 1.22),
    "201": ("Noida / Ghaziabad", 1.16),
    "380": ("Ahmedabad", 1.10),
    "400": ("Mumbai", 1.30),
    "411": ("Pune", 1.18),
    "500": ("Hyderabad", 1.15),
    "501": ("Ranga Reddy", 1.03),
    "502": ("Medak / Sangareddy", 0.95),
    "503": ("Nizamabad / Kamareddy", 0.94),
    "504": ("Adilabad / Mancherial", 0.92),
    "505": ("Karimnagar", 0.95),
    "506": ("Warangal", 0.97),
    "507": ("Khammam", 0.94),
    "508": ("Nalgonda", 0.94),
    "509": ("Mahabubnagar", 0.93),
    "520": ("Vijayawada", 1.04),
    "530": ("Visakhapatnam", 1.06),
    "560": ("Bengaluru", 1.22),
    "600": ("Chennai", 1.18),
    "682": ("Kochi", 1.10),
    "700": ("Kolkata", 1.12),
}


ESTIMATE_POSTAL_REGION_MODIFIERS = {
    "1": ("Northern India", 1.05),
    "2": ("North-central India", 0.98),
    "3": ("Western India", 1.00),
    "4": ("West-central India", 1.04),
    "5": ("South-central India", 1.00),
    "6": ("Southern India", 1.04),
    "7": ("Eastern India", 0.97),
    "8": ("East-central India", 0.94),
}


def estimate_location_adjustment(pincode: str, country: str = "India") -> tuple[str, float]:
    normalized = (pincode or "").strip()
    if len(normalized) != 6 or not normalized.isdigit() or normalized[0] == "0":
        raise HTTPException(status_code=400, detail="Enter a valid 6-digit Indian pincode")
    return ESTIMATE_PINCODE_RATE_MODIFIERS.get(
        normalized[:3],
        ESTIMATE_POSTAL_REGION_MODIFIERS.get(normalized[0], ("Standard location", 1.0)),
    )


# Floor configurations selectable on the public estimate form. Each maps to the
# number of constructed floor levels used by the existing built-up-area
# calculation (basement levels count as a constructed level; Duplex and Mansion
# map to the nominal number of living levels the calculation supports).
FLOOR_TYPE_COUNTS: dict[str, int] = {
    "G": 1,
    "G+1": 2,
    "G+2": 3,
    "G+3": 4,
    "G-1": 2,
    "G-2": 3,
    "G-3": 4,
    "DUPLEX": 2,
    "MANSION": 3,
}


# Building-type adjustment applied to the base per-sq.ft rate. Commercial shells
# typically cost more per sq.ft than residential (services, MEP, compliance,
# structure), so the same finish/location yields a higher commercial estimate.
BUILDING_TYPE_MULTIPLIERS: dict[str, float] = {
    "RESIDENTIAL": 1.0,
    "COMMERCIAL": 1.15,
}


# ---------------------------------------------------------------------------
# Estimator reporting breakdowns.
#
# These describe how an estimate is *presented*, not how it is calculated. Every
# amount they produce is a share of a total `estimate_calculation` has already
# worked out, so a change to a rate, a multiplier or the material/labour/other
# split flows through unchanged and a breakdown can never disagree with the
# headline figure it came from.
#
# Deliberately NOT `CONSTRUCTION_STAGES`: that tuple opens a project's escrow
# milestones in `add_project_launch_records`, so its three stages are a payment
# schedule whose meaning must not move. The phases below are a finer costing
# view of the same total, used for display only.
# ---------------------------------------------------------------------------

# One row per resource actually bought on site, each drawn from a bucket the
# calculation already returns, so the rows always add back up to the total:
#   (resource, source bucket, its share of that bucket)
# The material shares are that bucket's composition and sum to 1.0; the three
# whole-bucket rows take theirs entire.
ESTIMATE_RESOURCE_ALLOCATION: tuple[tuple[str, str, float], ...] = (
    ("Cement", "material", 0.28),
    ("Sand", "material", 0.19),
    ("Aggregate", "material", 0.13),
    ("Steel", "material", 0.26),
    ("Bricks & blocks", "material", 0.14),
    ("Fittings & fixtures", "other", 1.0),
    ("Labour", "labour", 1.0),
    ("Planning contingency", "contingency", 1.0),
)


# Share of the total cost that each build phase absorbs. Shares sum to 1.0, so
# the phases account for the whole estimate and nothing is unattributed.
ESTIMATE_COST_PHASES: tuple[tuple[str, float], ...] = (
    ("Design & approvals", 0.025),
    ("Excavation", 0.03),
    ("Footing & foundation", 0.12),
    ("RCC columns & beams", 0.10),
    ("Roof slab", 0.08),
    ("Brickwork & plastering", 0.17),
    ("Flooring & tiling", 0.13),
    ("Electrical wiring", 0.05),
    ("Plumbing & water supply", 0.08),
    ("Doors & windows", 0.075),
    ("Painting & finishing", 0.14),
)


def estimate_resource_allocation(buckets: dict[str, float]) -> list[dict[str, Any]]:
    """Cost by resource, derived from the buckets the estimate already holds.

    `share` is computed from the amounts rather than declared, so it reports what
    the chart is actually drawing even if a bucket is zero or a share is edited.
    """
    rows = [
        {"name": name, "amount": buckets.get(bucket, 0.0) * share}
        for name, bucket, share in ESTIMATE_RESOURCE_ALLOCATION
    ]
    total = sum(row["amount"] for row in rows)
    return [dict(row, share=(row["amount"] / total if total else 0.0)) for row in rows]


def estimate_cost_phases(estimated_cost: float) -> list[dict[str, Any]]:
    """Cost per build phase, as a share of the estimate's own total."""
    return [{"name": name, "share": share, "amount": estimated_cost * share} for name, share in ESTIMATE_COST_PHASES]


def resolve_floor_configuration(payload: EstimateCreate) -> tuple[int, str | None]:
    """Resolve the effective floor count, preferring the floor configuration label.

    Newer clients send ``floor_type`` (e.g. "G+1"); the numeric ``floors`` field
    remains the legacy path and keeps existing saved estimates working.
    """
    floor_type = (payload.floor_type or "").strip().upper()
    floor_counts = FLOOR_TYPE_COUNTS
    if floor_type:
        if floor_type not in floor_counts:
            raise HTTPException(status_code=400, detail="Select a valid floor configuration")
        return floor_counts[floor_type], floor_type
    if payload.floors is None or payload.floors < 1 or payload.floors > 20:
        raise HTTPException(status_code=400, detail="Floors must be between 1 and 20")
    return payload.floors, None


def estimate_calculation(payload: EstimateCreate) -> dict[str, Any]:
    if payload.plot_area <= 0:
        raise HTTPException(status_code=400, detail="Plot area must be greater than zero")
    country = (payload.country or "India").strip()
    floors, floor_type = resolve_floor_configuration(payload)
    finish = payload.finishing_type.strip().lower()
    if finish not in {"standard", "premium"}:
        raise HTTPException(status_code=400, detail="Finishing type must be Standard or Premium")

    building_type = (payload.building_type or "").strip().upper()

    # India rates in INR per sq.ft.
    base_rate = 3800 if finish == "premium" else 2800
    building_multiplier = BUILDING_TYPE_MULTIPLIERS.get(building_type, 1.0)
    rate_zone, location_multiplier = estimate_location_adjustment(payload.pincode, country)
    currency = "INR"

    adjusted_rate = round(base_rate * building_multiplier * location_multiplier)
    built_up_area = payload.plot_area * floors
    construction_subtotal = built_up_area * adjusted_rate
    contingency_percent = 0.10
    contingency_estimate = construction_subtotal * contingency_percent
    estimated_cost = construction_subtotal + contingency_estimate

    # Named here rather than inline in the payload so the resource breakdown
    # below is built from the very same amounts the response reports.
    material_estimate = construction_subtotal * 0.62
    labour_estimate = construction_subtotal * 0.28
    other_estimate = construction_subtotal * 0.10

    disclaimer = (
        "Indicative planning estimate based on planned built-up area, postal code, finish, and a 10% contingency. "
        "It excludes land purchase, finance costs, loose furniture, and unusual site conditions. "
        "Confirm the final specification with builder quotations."
    )

    return {
        "country": country,
        "currency": currency,
        "plot_area": payload.plot_area,
        "floors": floors,
        "floor_type": floor_type,
        "built_up_area": built_up_area,
        "base_rate_per_sqft": base_rate,
        "rate_per_sqft": adjusted_rate,
        "rate_zone": rate_zone,
        "location_multiplier": location_multiplier,
        "building_type_multiplier": building_multiplier,
        "construction_subtotal": construction_subtotal,
        "contingency_percent": contingency_percent,
        "contingency_estimate": contingency_estimate,
        "estimated_cost": estimated_cost,
        "estimated_range_low": estimated_cost * 0.90,
        "estimated_range_high": estimated_cost * 1.10,
        "material_estimate": material_estimate,
        "labour_estimate": labour_estimate,
        "other_estimate": other_estimate,
        # The same stages a project's escrow milestones are opened with, costed
        # against this estimate's total. Not a second calculation: every amount
        # is a share of `estimated_cost` above, and the shares are the existing
        # ones. No per-stage duration is reported, because none exists.
        "construction_stages": [
            {"name": stage_name, "share": stage_share, "amount": estimated_cost * stage_share}
            for stage_name, stage_share in CONSTRUCTION_STAGES
        ],
        # Cost by resource, split out of the buckets immediately above rather
        # than costed again, so the two views of the spend always agree.
        "resource_allocation": estimate_resource_allocation(
            {
                "material": material_estimate,
                "labour": labour_estimate,
                "other": other_estimate,
                "contingency": contingency_estimate,
            }
        ),
        # Cost per build phase — the finer view of `construction_stages`.
        "cost_phases": estimate_cost_phases(estimated_cost),
        "estimated_duration_days": max(90, floors * 90),
        "finishing_type": payload.finishing_type,
        "building_type": payload.building_type,
        "construction_type": payload.construction_type,
        "location": payload.location,
        "pincode": payload.pincode,
        "disclaimer": disclaimer,
    }

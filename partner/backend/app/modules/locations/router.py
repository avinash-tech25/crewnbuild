"""Pincode lookup for the registration and profile forms (the old Partner location_routes)."""

from typing import Any

from fastapi import APIRouter, Depends

from app.modules.locations.location_service import PincodeDirectory, clean_india_pincode, get_pincode_directory

router = APIRouter(tags=["Locations"])


@router.get("/locations/pincode/{pincode}")
def lookup_pincode_area(pincode: str, directory: PincodeDirectory = Depends(get_pincode_directory)) -> dict[str, Any]:
    """The areas (India Post branches) under a pincode, for the registration and
    profile forms to offer as choices. Same shape of answer as Professional's."""
    cleaned_pincode = clean_india_pincode(pincode)
    branches = directory.branches(cleaned_pincode)
    primary = branches[0]
    return {
        "pincode": cleaned_pincode,
        "district": primary["district"],
        "state": primary["state"],
        "display": primary["display"],
        "areas": [
            {"name": branch["name"], "block": branch["block"], "district": branch["district"], "state": branch["state"]}
            for branch in branches
        ],
    }

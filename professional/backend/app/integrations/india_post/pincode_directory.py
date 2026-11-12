"""The India Post pincode directory (api.postalpincode.in), ported from the old
app/shared/account/services/location_service.py.

Three failures, reported separately:
  503  the directory could not be reached
  404  the directory does not know this pincode
  422  it knows the pincode but none of its branches names a district and state
"""

from typing import Any

import httpx
from fastapi import HTTPException

DIRECTORY_URL = "https://api.postalpincode.in/pincode/{pincode}"
TIMEOUT_SECONDS = 8
INDIA_PINCODE_LENGTH = 6


def clean_india_pincode(pincode: str | None) -> str:
    """Exactly six digits; spaces are ignored, anything else is refused."""
    cleaned = "".join((pincode or "").split())
    if len(cleaned) != INDIA_PINCODE_LENGTH or not cleaned.isdigit():
        raise HTTPException(status_code=400, detail="Enter a valid 6 digit pincode.")
    return cleaned


async def fetch_directory_answer(pincode: str) -> Any:
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
            response = await client.get(DIRECTORY_URL.format(pincode=pincode))
            response.raise_for_status()
        return response.json()
    except (httpx.HTTPError, ValueError):
        raise HTTPException(
            status_code=503, detail="The pincode directory could not be reached. Please try again."
        ) from None


async def fetch_india_pincode_branches(pincode: str) -> list[dict[str, str]]:
    """Every India Post branch under a pincode, with its city, district and state."""
    payload = await fetch_directory_answer(pincode)
    result = payload[0] if isinstance(payload, list) and payload else {}
    post_offices = result.get("PostOffice") or []
    if result.get("Status") != "Success" or not post_offices:
        raise HTTPException(status_code=404, detail="This pincode was not found. Check the 6 digits and try again.")

    branches = []
    for item in post_offices:
        name = (item.get("Name") or "").strip()
        district = (item.get("District") or "").strip()
        state = (item.get("State") or "").strip()
        if not (name and district and state):
            continue
        division = (item.get("Division") or "").strip()
        block = (item.get("Block") or "").strip()
        if block.upper() == "NA":
            block = ""
        branches.append(
            {
                "name": name,
                "branch_type": (item.get("BranchType") or "").strip(),
                "delivery_status": (item.get("DeliveryStatus") or "").strip(),
                # India Post has no city: the postal division is the town the branch is
                # administered from.
                "city": division or block or district,
                "block": block,
                "division": division,
                "district": district,
                "state": state,
                "country": (item.get("Country") or "India").strip(),
                "pincode": pincode,
                "display": ", ".join(part for part in [name, district, state] if part),
            }
        )
    if not branches:
        raise HTTPException(status_code=422, detail="This pincode is not mapped to a district and state yet.")
    return branches

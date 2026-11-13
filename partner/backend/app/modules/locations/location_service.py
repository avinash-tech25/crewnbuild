"""Pincode -> postal area, the way Professional resolves it.

Professional has no latitude, longitude, location master or distance code. What it
does have is its India Post pincode lookup (GET /locations/pincode/{pincode}),
which asks the India Post directory for every branch under a pincode together
with the branch's block (mandal / taluk), postal division, district and state.
This module re-implements that lookup for Partner -- same directory, same field
mapping, same three failure codes -- rather than importing Professional code, so
Partner stays independently runnable.

That postal hierarchy is also what makes the nearby search honest: two pincodes
are "near" when they share a block, a division or a district, which is a fact
about geography. Nothing here ever compares pincode digits.
"""

import threading
import time

import httpx
from fastapi import HTTPException

from app.core.runtime import settings

INDIA_PINCODE_LENGTH = 6

# A pincode's branches change rarely; one lookup serves many searches.
CACHE_SECONDS = 6 * 60 * 60


def clean_india_pincode(pincode: str | None) -> str:
    """An Indian pincode is exactly six digits. Spaces are ignored; anything
    else is refused outright. Professional's rule, unchanged."""
    cleaned_pincode = "".join((pincode or "").split())
    if len(cleaned_pincode) != INDIA_PINCODE_LENGTH or not cleaned_pincode.isdigit():
        raise HTTPException(status_code=400, detail="Enter a valid 6 digit pincode.")
    return cleaned_pincode


class PincodeDirectory:
    def __init__(self, base_url: str | None = None, timeout_seconds: float = 8):
        self.base_url = (base_url or settings.pincode_directory_url).rstrip("/")
        self.timeout_seconds = timeout_seconds
        self._cache: dict[str, tuple[float, list[dict]]] = {}
        self._lock = threading.Lock()

    def branches(self, pincode: str) -> list[dict]:
        """Every India Post branch registered under a pincode.

        503  the directory could not be reached
        404  the directory does not know this pincode
        422  it knows the pincode but no branch names a district and state
        """
        with self._lock:
            cached = self._cache.get(pincode)
            if cached and time.monotonic() - cached[0] < CACHE_SECONDS:
                return cached[1]

        branches = self._fetch(pincode)
        with self._lock:
            self._cache[pincode] = (time.monotonic(), branches)
        return branches

    def _fetch(self, pincode: str) -> list[dict]:
        try:
            with httpx.Client(timeout=self.timeout_seconds) as client:
                response = client.get(f"{self.base_url}/{pincode}")
                response.raise_for_status()
            payload = response.json()
        except (httpx.HTTPError, ValueError):
            raise HTTPException(status_code=503, detail="The pincode directory could not be reached. Please try again.")

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
            block = (item.get("Block") or "").strip()
            if block.upper() == "NA":
                block = ""
            branches.append(
                {
                    "name": name,
                    "block": block,
                    "division": (item.get("Division") or "").strip(),
                    "district": district,
                    "state": state,
                    "pincode": pincode,
                    "display": ", ".join(part for part in [name, district, state] if part),
                }
            )
        if not branches:
            raise HTTPException(status_code=422, detail="This pincode is not mapped to a district and state yet.")
        return branches

    def branch(self, pincode: str, branch_name: str) -> dict:
        """The named branch under a pincode, or 422 if the pincode has no such branch."""
        wanted = (branch_name or "").strip().casefold()
        for candidate in self.branches(pincode):
            if candidate["name"].casefold() == wanted:
                return candidate
        raise HTTPException(status_code=422, detail="Select one of the areas listed for this pincode.")


pincode_directory = PincodeDirectory()


def get_pincode_directory() -> PincodeDirectory:
    return pincode_directory

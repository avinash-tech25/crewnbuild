"""Deterministic room-label normalisation.

The vision step returns the label exactly as written on the plan. Which Vastu
component that label is gets decided here, by fixed rules, never by the model:
a model asked to classify happily turned a plain "BEDROOM" into a children's
bedroom. A generic bedroom stays generic, and anything the existing rules
engine has no table for is marked unsupported so it can never reach the score.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# category -> the `evaluateVastu()` component it feeds, or None if it feeds none.
ENGINE_COMPONENT = {
    "masterBedroom": "masterBedroom",
    "childrensBedroom": "childrensBedroom",
    "guestRoom": "guestRoom",
    "kitchen": "kitchen",
    "diningRoom": "diningRoom",
    "toiletCandidate": "toilet",
    "well": "well",
    "garage": "garage",
    "genericBedroom": None,
    "unsupportedPuja": None,
    "unsupportedStaircase": None,
    "unsupportedLiving": None,
    "unsupportedOther": None,
    "unknown": None,
}

# Ordered: the first matching rule wins, so the specific bedrooms are tested
# before the generic one. Patterns run on an upper-cased label with the
# dimensions removed.
_RULES: tuple[tuple[str, re.Pattern], ...] = (
    ("masterBedroom", re.compile(r"\bMASTER\b|\bM\s*\.?\s*BED|\bMBR\b")),
    ("childrensBedroom", re.compile(r"\bCHILD(?:'?S|REN'?S?)?\b|\bKIDS?'?S?\b")),
    ("guestRoom", re.compile(r"\bGUEST\b")),
    ("genericBedroom", re.compile(r"\bBED\s*ROOM\b|\bBEDROOM\b|\bBED\b|\bBR\b")),
    ("kitchen", re.compile(r"\bKITCHEN\b|\bKIT\b")),
    ("diningRoom", re.compile(r"\bDINING\b|\bDINNING\b")),
    (
        "toiletCandidate",
        re.compile(r"\bTOILET\b|\bW\s*\.?\s*C\b|\bBATH\b|\bBATHROOM\b|\bLAVATORY\b|\bRESTROOM\b|\bWASH\s*ROOM\b"),
    ),
    (
        "well",
        re.compile(
            r"\bWELL\b|\bSUMP\b|\bUNDERGROUND\s+(?:WATER\s+)?TANK\b|\bU\s*\.?\s*G\s*\.?\s*TANK\b|\bBORE\s*WELL\b"
        ),
    ),
    ("garage", re.compile(r"\bGARAGE\b|\bPARKING\b|\bCAR\s+PORCH\b|\bCARPORT\b")),
    ("unsupportedPuja", re.compile(r"\bPUJA\b|\bPOOJA\b|\bPRAYER\b|\bMANDIR\b")),
    ("unsupportedStaircase", re.compile(r"\bSTAIR|\bSTAIRCASE\b")),
    ("unsupportedLiving", re.compile(r"\bLIVING\b|\bHALL\b|\bDRAWING\b|\bLOUNGE\b|\bFAMILY\b")),
    (
        "unsupportedOther",
        re.compile(
            r"\bBALCONY\b|\bUTILITY\b|\bSTORE\b|\bSTUDY\b|\bVERANDAH?\b|\bPORCH\b|\bLOBBY\b|\bPASSAGE\b|\bWASH\b|\bDRESS"
        ),
    ),
)

# A dimension such as 14' X 12', 4.2 x 3.6, 12'-6" or 10 FT, so "BEDROOM 12' X 12'"
# is read as "BEDROOM". Bare numbers stay ("BEDROOM 1" is still generic).
_DIMENSIONS = re.compile(
    r"\d+(?:\.\d+)?\s*(?:'|FT|FEET|M\b|MM\b|\")?\s*(?:-\s*\d+\s*\"?)?\s*[X×*]\s*\d+(?:\.\d+)?\s*(?:'|FT|FEET|M\b|MM\b|\")?(?:\s*-\s*\d+\s*\"?)?"  # noqa: RUF001 the plan may write these characters
)


@dataclass(frozen=True)
class NormalisedLabel:
    category: str
    component: str | None  # the evaluateVastu() key, or None
    ambiguous: bool  # the label names more than one supported room
    cleaned: str


def normalise_label(label: str) -> NormalisedLabel:
    text = (label or "").upper().replace("’", "'")  # noqa: RUF001 the plan may write these characters
    text = _DIMENSIONS.sub(" ", text)
    text = re.sub(r"\s+", " ", text).strip()
    matched = [category for category, pattern in _RULES if pattern.search(text)]
    if not matched:
        return NormalisedLabel("unknown", None, False, text)
    category = matched[0]
    # "KITCHEN / DINING", "MASTER BED + TOILET": two different scoring
    # components in one label, so its identity is not settled. A specific
    # bedroom also matches the generic bedroom pattern, but that pattern feeds
    # no component, so it never makes a label ambiguous.
    components = {ENGINE_COMPONENT[c] for c in matched if ENGINE_COMPONENT[c]}
    return NormalisedLabel(category, ENGINE_COMPONENT[category], len(components) > 1, text)


# Subjects of written directional claims ("Kitchen in South-East", "Main
# entrance in East"): the room categories above plus the entrance.
_ENTRANCE = re.compile(r"\bENTRANCE\b|\bENTRY\b|\bMAIN\s+DOOR\b|\bGATE\b")


def claim_subject(subject: str) -> str:
    if _ENTRANCE.search((subject or "").upper()):
        return "mainDoor"
    return normalise_label(subject).category

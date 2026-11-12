"""Visual extraction of a floor plan through Gemini's native API.

Reuses the key and host already configured for translation (OPENAI_API_KEY /
OPENAI_BASE_URL, which point at Gemini's OpenAI-compatible endpoint). The
native `generateContent` call is used instead of the compatible one because
only it enforces a response schema and accepts a PDF inline; through the
compatible path the model drifted from the requested JSON shape.

The model is asked only WHERE things are drawn. It is not asked for directions,
for the north angle as a number to be trusted, or which Vastu component a room
is: those are decided in code (geometry.py, labels.py). Its own north angle is
requested solely so a disagreement with the arrow geometry can be reported.

The key is sent from this backend only, in a header, and never logged.
"""

from __future__ import annotations

import base64
import json
import logging
import time

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)

RETRYABLE_STATUS = {429, 500, 502, 503, 504}

# Coordinates use Gemini's native convention: integers on a 0-1000 scale.
# INTEGER makes the schema itself refuse a 0..1 fraction, which the model was
# seen mixing with 0-1000 values inside a single point.
SCALE = 1000
_POINT = {"type": "OBJECT", "properties": {"x": {"type": "INTEGER"}, "y": {"type": "INTEGER"}}, "required": ["x", "y"]}
_NULLABLE_POINT = {**_POINT, "nullable": True}
_BOX = {
    "type": "OBJECT",
    "properties": {
        "ymin": {"type": "INTEGER"},
        "xmin": {"type": "INTEGER"},
        "ymax": {"type": "INTEGER"},
        "xmax": {"type": "INTEGER"},
    },
    "required": ["ymin", "xmin", "ymax", "xmax"],
}
_NULLABLE_BOX = {**_BOX, "nullable": True}
_BOUNDARY = {
    "type": "OBJECT",
    "properties": {
        "found": {"type": "BOOLEAN"},
        "polygon": {"type": "ARRAY", "items": _POINT},
        "confidence": {"type": "NUMBER"},
        "evidence": {"type": "STRING"},
    },
    "required": ["found", "polygon", "confidence", "evidence"],
}
_DIRECTIONS = ["n", "ne", "e", "se", "s", "sw", "w", "nw"]

RESPONSE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "page_count": {"type": "INTEGER"},
        "north_indicator": {
            "type": "OBJECT",
            "properties": {
                "found": {"type": "BOOLEAN"},
                "kind": {"type": "STRING", "enum": ["arrow", "compass_rose", "n_label", "none"]},
                "tail": _NULLABLE_POINT,
                "tip": _NULLABLE_POINT,
                "model_angle_degrees": {"type": "NUMBER", "nullable": True},
                "confidence": {"type": "NUMBER"},
                "evidence": {"type": "STRING"},
            },
            "required": ["found", "kind", "tail", "tip", "model_angle_degrees", "confidence", "evidence"],
        },
        "facing_text": {"type": "STRING", "nullable": True},
        "building_boundary": _BOUNDARY,
        "plot_boundary": _BOUNDARY,
        "rooms": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "label": {"type": "STRING"},
                    "box": _BOX,
                    "confidence": {"type": "NUMBER"},
                    "evidence": {"type": "STRING"},
                },
                "required": ["label", "box", "confidence", "evidence"],
            },
        },
        "main_door": {
            "type": "OBJECT",
            "properties": {
                "found": {"type": "BOOLEAN"},
                "box": _NULLABLE_BOX,
                "confidence": {"type": "NUMBER"},
                "evidence": {"type": "STRING"},
            },
            "required": ["found", "box", "confidence", "evidence"],
        },
        "directional_claims": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "text": {"type": "STRING"},
                    "subject": {"type": "STRING"},
                    "claimed_directions": {"type": "ARRAY", "items": {"type": "STRING", "enum": _DIRECTIONS}},
                },
                "required": ["text", "subject", "claimed_directions"],
            },
        },
    },
    "required": [
        "page_count",
        "north_indicator",
        "facing_text",
        "building_boundary",
        "plot_boundary",
        "rooms",
        "main_door",
        "directional_claims",
    ],
}

PROMPT = """You are extracting facts from an architectural floor plan for a separate, later calculation.
Report only what is visibly drawn or written. Never guess and never assume.

Coordinates are INTEGERS on a 0-1000 scale over the whole image or page, whatever its pixel size:
x = 0 at the left edge, x = 1000 at the right edge; y = 0 at the TOP edge, y = 1000 at the BOTTOM edge.
Use this same scale for every coordinate. Report positions as precisely as you can.

page_count: the number of pages you were given.

north_indicator:
- found = true only if a north arrow, a compass rose or an 'N' marker is drawn.
- kind: arrow, compass_rose, n_label or none.
- tail = the base of the north arrow (for a compass rose, its centre).
- tip = the point the north arrow points to (for a compass rose, the tip of its N point).
  Give tail and tip as precisely as possible; the angle will be calculated from them.
- model_angle_degrees = your own reading of where north points, clockwise from straight up the page.
- Do NOT assume north is at the top. Do NOT derive north from text such as 'EAST FACING';
  copy such text into facing_text instead.
- If nothing indicates north: found=false, kind='none', tail=null, tip=null, model_angle_degrees=null,
  confidence=0.

building_boundary: the outer walls of the built structure only (not the plot, garden, page border or
title block), as polygon vertices in order, with confidence.
plot_boundary: the plot/site boundary only if it is explicitly drawn as a separate outline (a compound
wall or boundary line around the building). Do not treat the page border, a garden texture or
dimension lines as the plot. found=false with an empty polygon if no explicit plot outline is drawn.

rooms: one entry per labelled room or space drawn inside the plan. label = the room's text exactly as
written (keep it verbatim; do not rename or classify it). box = the bounding box of that room's enclosed
area between its walls (not of the label text). Do not invent rooms that are not labelled. Ignore
legends, notes and title text.

main_door: the main entrance door of the building. found=false and box=null if it cannot be
identified. box = the bounding box of the door opening in the wall.

directional_claims: every written statement that claims a direction for a room or feature (for example
a legend or notes panel saying 'Kitchen in South-East'). subject = the room or feature named;
claimed_directions = the direction(s) claimed. Transcribe them only; do not use them for anything else.
Compass labels themselves are not claims.

Every confidence is 0..1. Evidence is a short factual note of what you saw."""


class VisionUnavailableError(RuntimeError):
    """The provider could not produce an answer (configuration, outage, timeout)."""


class VisionRejectedInputError(ValueError):
    """The provider refused the file itself (for example a corrupt image)."""


def _native_base() -> str:
    base = (get_settings().vastu_gemini_base_url or get_settings().openai_base_url or "").strip().rstrip("/")
    if base.endswith("/openai"):
        base = base[: -len("/openai")]
    return base


def vision_model() -> str:
    return (get_settings().vastu_vision_model or get_settings().openai_translation_model or "").strip()


def configured() -> bool:
    base = _native_base()
    return (
        bool(get_settings().openai_api_key.get_secret_value().strip())
        and "generativelanguage.googleapis.com" in base
        and bool(vision_model())
    )


def extract_plan(content: bytes, mime_type: str) -> dict:
    """One structured extraction. Retries transient provider failures only,
    within an overall deadline, and never indefinitely."""
    if not configured():
        raise VisionUnavailableError("Plan analysis is not configured on this server.")
    body = {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {"inline_data": {"mime_type": mime_type, "data": base64.b64encode(content).decode("ascii")}},
                    {"text": PROMPT},
                ],
            }
        ],
        "generationConfig": {
            "temperature": 0,
            "responseMimeType": "application/json",
            "responseSchema": RESPONSE_SCHEMA,
        },
    }
    url = f"{_native_base()}/models/{vision_model()}:generateContent"
    headers = {"x-goog-api-key": get_settings().openai_api_key.get_secret_value(), "Content-Type": "application/json"}
    attempts = max(1, get_settings().vastu_analysis_max_attempts)
    deadline = time.monotonic() + max(10.0, get_settings().vastu_analysis_deadline_seconds)
    last_problem = "no attempt made"
    for attempt in range(1, attempts + 1):
        remaining = deadline - time.monotonic()
        if remaining <= 5:
            break
        timeout = min(get_settings().vastu_analysis_timeout_seconds, remaining)
        try:
            response = httpx.post(url, headers=headers, json=body, timeout=timeout)
        except httpx.TimeoutException:
            last_problem = f"timed out after {timeout:.0f}s"
            logger.warning("Vastu plan analysis attempt %s/%s %s", attempt, attempts, last_problem)
            continue
        except httpx.HTTPError as exc:
            last_problem = f"connection error ({type(exc).__name__})"
            logger.warning("Vastu plan analysis attempt %s/%s failed: %s", attempt, attempts, last_problem)
        else:
            if response.status_code == 200:
                return _parse(response.json())
            if response.status_code == 400:
                logger.info("Vastu plan analysis: provider rejected the file (400).")
                raise VisionRejectedInputError(
                    "The plan file could not be read. It may be damaged or not a floor plan image."
                )
            last_problem = f"provider returned HTTP {response.status_code}"
            logger.warning("Vastu plan analysis attempt %s/%s: %s", attempt, attempts, last_problem)
            if response.status_code not in RETRYABLE_STATUS:
                break
        if attempt < attempts:
            time.sleep(min(2.0 * attempt, max(0.0, deadline - time.monotonic() - 5)))
    raise VisionUnavailableError(f"Plan analysis is temporarily unavailable ({last_problem}).")


def _parse(payload: dict) -> dict:
    candidates = payload.get("candidates") or []
    if not candidates:
        reason = (payload.get("promptFeedback") or {}).get("blockReason") or "no answer"
        raise VisionUnavailableError(f"Plan analysis returned no result ({reason}).")
    parts = (candidates[0].get("content") or {}).get("parts") or []
    text = "".join(part.get("text", "") for part in parts)
    try:
        data = json.loads(text)
    except (TypeError, ValueError) as exc:
        raise VisionUnavailableError("Plan analysis returned an unreadable result.") from exc
    if not isinstance(data, dict) or "north_indicator" not in data:
        raise VisionUnavailableError("Plan analysis returned an incomplete result.")
    return to_unit_coordinates(data)


def _unit_point(point):
    """0-1000 integer point -> 0..1 fractions; None if out of range (never repaired)."""
    if not isinstance(point, dict):
        return None
    try:
        x, y = float(point["x"]), float(point["y"])
    except (KeyError, TypeError, ValueError):
        return None
    if not (0 <= x <= SCALE and 0 <= y <= SCALE):
        return None
    return {"x": x / SCALE, "y": y / SCALE}


def _box_centre(box):
    """Centre of a 0-1000 box -> 0..1 fractions; None if the box is invalid."""
    if not isinstance(box, dict):
        return None
    try:
        ymin, xmin, ymax, xmax = (float(box[k]) for k in ("ymin", "xmin", "ymax", "xmax"))
    except (KeyError, TypeError, ValueError):
        return None
    if not (0 <= xmin < xmax <= SCALE and 0 <= ymin < ymax <= SCALE):
        return None
    return {"x": (xmin + xmax) / 2 / SCALE, "y": (ymin + ymax) / 2 / SCALE}


def to_unit_coordinates(data: dict) -> dict:
    """Convert the model's 0-1000 answer into the 0..1 page fractions the
    analysis works in. The only place the scale is handled. A point or box
    that is out of range or inverted becomes None and is treated as not
    detected; nothing is clamped, rescaled or guessed."""
    north = dict(data.get("north_indicator") or {})
    north["tail"] = _unit_point(north.get("tail"))
    north["tip"] = _unit_point(north.get("tip"))
    out = {**data, "north_indicator": north}
    for name in ("building_boundary", "plot_boundary"):
        outline = dict(data.get(name) or {})
        points = [_unit_point(p) for p in outline.get("polygon") or []]
        if any(p is None for p in points):
            outline["found"] = False
            outline["evidence"] = (outline.get("evidence") or "") + " [rejected: a vertex was outside the 0-1000 scale]"
            points = []
        outline["polygon"] = points
        out[name] = outline
    rooms = []
    for room in data.get("rooms") or []:
        centre = _box_centre(room.get("box"))
        if centre is not None:
            rooms.append({**room, "center": centre})
    out["rooms"] = rooms
    door = dict(data.get("main_door") or {})
    door["center"] = _box_centre(door.get("box"))
    out["main_door"] = door
    return out

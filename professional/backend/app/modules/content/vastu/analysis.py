"""From raw plan detections to a validated component -> direction mapping.

The rules engine (`evaluateVastu()` in the frontend's vastuRules.js) is not
reimplemented here. This module decides whether the detections are good
enough to be scored at all, and if so produces the exact `{component:
direction}` object that engine takes. Anything short of that is reported as
insufficient data, with every reason listed, and no score is produced.

Never guessed: north (no indicator -> no direction), the Brahmasthan (centroid
of the detected building outline, never the image centre), the plot (no
explicit outline -> no houseInPlot), which toilet counts, or a room's identity.
"""

from __future__ import annotations

from app.core.config import get_settings
from app.modules.content.vastu.files import PlanFile
from app.modules.content.vastu.geometry import (
    Size,
    direction_between,
    polygon_area_px,
    polygon_centroid_px,
    to_px,
    valid_point,
)
from app.modules.content.vastu.labels import claim_subject, normalise_label
from app.modules.content.vastu.north_arrow import measure_arrow

REQUIRED_COMPONENTS = ("mainDoor", "kitchen", "masterBedroom", "diningRoom", "toilet", "houseInPlot")
OPTIONAL_COMPONENTS = ("childrensBedroom", "guestRoom", "well", "garage")

# A building or plot outline covering almost the whole page is the page border
# or the drawing frame, not a wall; one covering almost nothing is a misread.
MAX_OUTLINE_PAGE_SHARE = 0.95
MIN_OUTLINE_PAGE_SHARE = 0.02
# An arrow drawn shorter than this share of the page is too small to read an
# angle from reliably.
MIN_ARROW_PAGE_SHARE = 0.02
# House centred in its plot to within this share of the plot diagonal has no
# direction within it.
HOUSE_IN_PLOT_MIN_OFFSET_SHARE = 0.02

CONFLICT_WARNING = "Plan contains directional claims that differ from detected geometry."


def _num(value, default=0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _point_out(px: tuple[float, float], size: Size) -> dict:
    return {
        "x": round(px[0] / size.width, 4),
        "y": round(px[1] / size.height, 4),
        "px": {"x": round(px[0], 1), "y": round(px[1], 1)},
    }


def _direction_out(direction) -> dict | None:
    if direction is None:
        return None
    return {
        "direction": direction.key.upper(),
        "key": direction.key,
        "angle_degrees": direction.bearing,
        "boundary_distance_degrees": direction.boundary_distance,
        "uncertain": direction.uncertain,
    }


def _outline(raw: dict, size: Size, name: str, min_confidence: float, problems: list[str]) -> dict:
    """Validate a detected outline; return its review data and centroid."""
    raw = raw or {}
    points = [p for p in (raw.get("polygon") or []) if valid_point(p)]
    px = [to_px(p, size) for p in points]
    confidence = _num(raw.get("confidence"))
    info = {
        "found": bool(raw.get("found")),
        "confidence": round(confidence, 3),
        "evidence": raw.get("evidence") or "",
        "polygon": [{"x": round(p["x"], 4), "y": round(p["y"], 4)} for p in points],
        "page_share": None,
        "reliable": False,
        "centroid": None,
    }
    if not info["found"] or len(px) < 3:
        problems.append(f"{name} was not detected.")
        return info
    share = polygon_area_px(px) / (size.width * size.height)
    info["page_share"] = round(share, 3)
    centroid = polygon_centroid_px(px)
    if centroid is None:
        problems.append(f"{name} outline is degenerate.")
    elif share >= MAX_OUTLINE_PAGE_SHARE:
        problems.append(f"{name} outline covers the whole page, so it is the page border rather than a drawn outline.")
    elif share <= MIN_OUTLINE_PAGE_SHARE:
        problems.append(f"{name} outline is implausibly small.")
    elif confidence < min_confidence:
        problems.append(f"{name} confidence {confidence:.2f} is below the required {min_confidence:.2f}.")
    else:
        info["reliable"] = True
    if centroid is not None:
        info["centroid"] = _point_out(centroid, size)
    info["_centroid_px"] = centroid
    return info


def analyse(plan: PlanFile, detections: dict) -> dict:
    size = plan.size
    min_conf = get_settings().vastu_min_confidence
    margin = get_settings().vastu_direction_margin_degrees
    warnings: list[str] = []
    missing: list[str] = []

    # ---------------------------------------------------------------- pages
    model_pages = int(_num(detections.get("page_count"), 1) or 1)
    pages = plan.page_count if plan.page_count is not None else model_pages
    if plan.mime_type == "application/pdf" and max(pages, model_pages) > 1:
        return {
            "status": "needs_page_selection",
            "reason": f"The PDF has {max(pages, model_pages)} pages. "
            "Page selection for multi-page plans is not supported yet; "
            "upload the floor-plan page on its own.",
        }

    # ---------------------------------------------------------- orientation
    raw_north = detections.get("north_indicator") or {}
    north_conf = _num(raw_north.get("confidence"))
    orientation = {
        "found": bool(raw_north.get("found")) and raw_north.get("kind") != "none",
        "kind": raw_north.get("kind"),
        "confidence": round(north_conf, 3),
        "evidence": raw_north.get("evidence") or "",
        "arrow_tail": None,
        "arrow_tip": None,
        "north_angle_degrees": None,
        "model_claimed_angle_degrees": raw_north.get("model_angle_degrees"),
        "method": None,
        "precision": None,
        "measurement": None,
        "facing_text": detections.get("facing_text"),
        "reliable": False,
    }
    north_angle = None
    if not orientation["found"]:
        missing.append(
            "North orientation: no north arrow or compass was detected. "
            "Unable to reliably determine the plan direction. Please upload a floor plan containing "
            "a North arrow or orientation indicator."
        )
    elif not (valid_point(raw_north.get("tail")) and valid_point(raw_north.get("tip"))):
        missing.append(
            "North orientation: the arrow's end points could not be located, so its angle cannot be calculated."
        )
    else:
        tail, tip = to_px(raw_north["tail"], size), to_px(raw_north["tip"], size)
        orientation["arrow_tail"] = _point_out(tail, size)
        orientation["arrow_tip"] = _point_out(tip, size)
        length = ((tip[0] - tail[0]) ** 2 + (tip[1] - tail[1]) ** 2) ** 0.5
        if length < MIN_ARROW_PAGE_SHARE * min(size.width, size.height):
            missing.append("North orientation: the detected arrow is too short to measure its angle reliably.")
        elif north_conf < min_conf:
            missing.append(f"North orientation: confidence {north_conf:.2f} is below the required {min_conf:.2f}.")
        elif raw_north.get("kind") not in ("arrow", "compass_rose"):
            missing.append(
                "North orientation: only an 'N' marker was found, with no arrow or compass needle to measure."
            )
        elif plan.pixels is None:
            missing.append("North orientation: the plan image could not be read to measure the north arrow.")
        else:
            # Every format (PNG, JPEG, rendered PDF) is measured from its decoded
            # pixels; the model's points only locate the arrow and say which end
            # is north, and its own numeric angle is never used. No fallback to
            # the model's coordinates if the drawing cannot be measured.
            measurement = measure_arrow(plan.pixels, tail, tip, raw_north["kind"])
            orientation["measurement"] = {
                "method": measurement.method,
                "ok": measurement.ok,
                "reason": measurement.reason,
                "dark_pixels": measurement.dark_pixels,
                "correction_from_model_points_degrees": measurement.correction_degrees,
                "base_px": measurement.base,
                "tip_px": measurement.tip,
            }
            if not measurement.ok:
                missing.append(f"North orientation: {measurement.reason}, so north cannot be determined reliably.")
            else:
                north_angle = measurement.angle
                orientation.update(
                    north_angle_degrees=north_angle,
                    reliable=True,
                    precision="pixel",
                    method="measured from the drawn arrow pixels; the model's own angle is not used",
                )
    if orientation["facing_text"]:
        warnings.append(f"Plan text '{orientation['facing_text']}' was recorded but not used to determine north.")

    # ------------------------------------------------- building / brahmasthan
    building_problems: list[str] = []
    building = _outline(detections.get("building_boundary"), size, "Building boundary", min_conf, building_problems)
    centre_px = building.pop("_centroid_px") if building["reliable"] else None
    building.pop("_centroid_px", None)
    missing.extend(building_problems)
    brahmasthan = None
    if centre_px is not None:
        brahmasthan = {**_point_out(centre_px, size), "method": "centroid of the detected building boundary"}

    # ------------------------------------------------------------------ plot
    plot_problems: list[str] = []
    plot = _outline(detections.get("plot_boundary"), size, "Plot boundary", min_conf, plot_problems)
    plot_centre = plot.pop("_centroid_px") if plot["reliable"] else None
    plot.pop("_centroid_px", None)
    house_in_plot = None
    if plot_problems:
        missing.append("houseInPlot: Plot boundary could not be reliably detected. (" + " ".join(plot_problems) + ")")
    elif centre_px is not None and north_angle is not None:
        plot_px = [to_px(p, size) for p in plot["polygon"]]
        diagonal = max(((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5 for a in plot_px for b in plot_px)
        offset = ((centre_px[0] - plot_centre[0]) ** 2 + (centre_px[1] - plot_centre[1]) ** 2) ** 0.5
        if offset < HOUSE_IN_PLOT_MIN_OFFSET_SHARE * diagonal:
            missing.append(
                "houseInPlot: the building sits at the centre of the plot, so it has no direction within it."
            )
        else:
            house_in_plot = _direction_out(direction_between(plot_centre, centre_px, north_angle, margin))
    plot["house_in_plot"] = house_in_plot

    # Directions exist only once both north and the Brahmasthan are reliable;
    # otherwise every direction stays empty rather than being assumed.
    can_measure = centre_px is not None and north_angle is not None

    def measure(point: tuple[float, float]) -> dict | None:
        return _direction_out(direction_between(centre_px, point, north_angle, margin)) if can_measure else None

    # ----------------------------------------------------------------- rooms
    rooms = []
    for raw in detections.get("rooms") or []:
        if not valid_point(raw.get("center")):
            continue
        label = normalise_label(raw.get("label", ""))
        point = to_px(raw["center"], size)
        confidence = _num(raw.get("confidence"))
        rooms.append(
            {
                "label": raw.get("label", ""),
                "category": label.category,
                "component": label.component,
                "supported": label.component is not None,
                "ambiguous_identity": label.ambiguous,
                "center": _point_out(point, size),
                "confidence": round(confidence, 3),
                "low_confidence": confidence < min_conf,
                "evidence": raw.get("evidence") or "",
                **(
                    measure(point)
                    or {
                        "direction": None,
                        "key": None,
                        "angle_degrees": None,
                        "boundary_distance_degrees": None,
                        "uncertain": None,
                    }
                ),
            }
        )

    # ------------------------------------------------------------- main door
    raw_door = detections.get("main_door") or {}
    door_conf = _num(raw_door.get("confidence"))
    main_door = {
        "found": bool(raw_door.get("found")) and valid_point(raw_door.get("center")),
        "confidence": round(door_conf, 3),
        "evidence": raw_door.get("evidence") or "",
        "center": None,
        "low_confidence": door_conf < min_conf,
        "direction": None,
        "key": None,
        "angle_degrees": None,
        "boundary_distance_degrees": None,
        "uncertain": None,
    }
    if main_door["found"]:
        door_px = to_px(raw_door["center"], size)
        main_door["center"] = _point_out(door_px, size)
        main_door.update(measure(door_px) or {})

    toilet_candidates = [room for room in rooms if room["category"] == "toiletCandidate"]

    # ----------------------------------------------- required + optional checks
    mapping: dict[str, str] = {}
    excluded_optional: list[str] = []

    def check_single(component: str, entries: list[dict], required: bool) -> None:
        problems = []
        if not entries:
            problems.append("not detected")
        elif len(entries) > 1:
            if component == "toilet":
                problems.append(
                    "Multiple toilets detected but the current Vastu rules engine supports one toilet component."
                )
            else:
                problems.append(
                    f"{len(entries)} rooms were identified as {component}, so which one counts is ambiguous"
                )
        else:
            entry = entries[0]
            if entry.get("ambiguous_identity"):
                problems.append(f"label '{entry.get('label')}' names more than one room type")
            if entry.get("low_confidence"):
                problems.append(f"confidence {entry['confidence']:.2f} is below the required {min_conf:.2f}")
            if entry.get("key") is None:
                problems.append("direction could not be calculated")
            elif entry.get("uncertain"):
                problems.append(
                    f"{entry['direction']} at {entry['angle_degrees']}° is only {entry['boundary_distance_degrees']}° "
                    f"from a direction boundary (threshold {margin:.1f}°)"
                )
        if problems:
            text = f"{component}: " + "; ".join(problems)
            if required:
                missing.append(text)
            else:
                excluded_optional.append(text)
        else:
            mapping[component] = entries[0]["key"]

    by_component: dict[str, list[dict]] = {}
    for room in rooms:
        if room["component"]:
            by_component.setdefault(room["component"], []).append(room)
    for component in ("kitchen", "masterBedroom", "diningRoom", "toilet"):
        check_single(component, by_component.get(component, []), required=True)
    check_single("mainDoor", [main_door] if main_door["found"] else [], required=True)
    if house_in_plot is not None:
        if house_in_plot["uncertain"]:
            missing.append(
                f"houseInPlot: {house_in_plot['direction']} is only {house_in_plot['boundary_distance_degrees']}° "
                f"from a direction boundary (threshold {margin:.1f}°)"
            )
        else:
            mapping["houseInPlot"] = house_in_plot["key"]
    for component in OPTIONAL_COMPONENTS:
        if by_component.get(component):
            check_single(component, by_component[component], required=False)
    for text in excluded_optional:
        warnings.append(f"Optional component left out of scoring — {text}.")
    unsupported = sorted({room["label"] for room in rooms if not room["supported"]})
    if unsupported:
        warnings.append(
            "Not scored (no rule exists for these in the current Vastu rules engine): " + ", ".join(unsupported) + "."
        )

    # ----------------------------------------------------- written claims
    claims_report = []
    if can_measure:
        for claim in detections.get("directional_claims") or []:
            subject = claim_subject(claim.get("subject", ""))
            claimed = [
                d for d in (claim.get("claimed_directions") or []) if d in ("n", "ne", "e", "se", "s", "sw", "w", "nw")
            ]
            if subject == "mainDoor":
                detected = [main_door] if main_door["found"] else []
            else:
                detected = [room for room in rooms if room["category"] == subject]
            measured = [entry["key"] for entry in detected if entry.get("key")]
            if not measured or not claimed:
                verdict = "not_verifiable"
            elif any(key in claimed for key in measured):
                verdict = "consistent"
            else:
                verdict = "conflict"
            claims_report.append(
                {
                    "text": claim.get("text", ""),
                    "subject": claim.get("subject", ""),
                    "claimed": [d.upper() for d in claimed],
                    "measured": [k.upper() for k in measured],
                    "verdict": verdict,
                }
            )
        if any(item["verdict"] == "conflict" for item in claims_report):
            warnings.append(CONFLICT_WARNING)

    ready = not missing and all(component in mapping for component in REQUIRED_COMPONENTS)
    return {
        "status": "success" if ready else "insufficient_data",
        "reason": None
        if ready
        else "Required information could not be reliably determined; no Vastu score was produced.",
        "readyForScoring": ready,
        "orientation": orientation,
        "building": building,
        "plot": plot,
        "brahmasthan": brahmasthan,
        "rooms": rooms,
        "mainDoor": main_door,
        "toiletCandidates": toilet_candidates,
        "directionMapping": mapping if ready else {},
        "partialDirectionMapping": mapping,
        "directionalClaims": claims_report,
        "warnings": warnings,
        "missingRequirements": missing,
        "settings": {
            "min_confidence": min_conf,
            "direction_margin_degrees": get_settings().vastu_direction_margin_degrees,
            "effective_direction_margin_degrees": round(margin, 1),
        },
        # Scored by the existing frontend engine, never here; see module docstring.
        "vastuResult": None,
    }

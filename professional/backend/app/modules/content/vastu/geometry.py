"""Deterministic plan geometry for Vastu analysis.

Nothing here asks a model anything. The vision step only reports where things
are drawn; every angle, centre and direction is worked out here, from those
positions, so the same detections always give the same answer.

Conventions, matching the frontend Vastu screens (`vastuRules.js`,
`VastuPlanUpload.jsx`):

* Points arrive normalised to the page: x 0..1 left to right, y 0..1 top to
  bottom. They are scaled back to pixels before any angle is taken, so a plan
  that is not square does not skew the bearings.
* A screen bearing is measured clockwise from straight up the page.
* The north angle is the screen bearing of the north arrow. A room's true
  bearing is its screen bearing minus the north angle, clockwise from north.
* The eight directions are 45-degree sectors centred on n, ne, e, ... nw,
  exactly the keys `evaluateVastu()` accepts.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

DIRECTION_KEYS = ("n", "ne", "e", "se", "s", "sw", "w", "nw")
SECTOR_DEGREES = 45.0


@dataclass(frozen=True)
class Size:
    width: float
    height: float


def to_px(point: dict, size: Size) -> tuple[float, float]:
    return float(point["x"]) * size.width, float(point["y"]) * size.height


def valid_point(point) -> bool:
    try:
        x, y = float(point["x"]), float(point["y"])
    except (TypeError, KeyError, ValueError):
        return False
    return math.isfinite(x) and math.isfinite(y) and -0.01 <= x <= 1.01 and -0.01 <= y <= 1.01


def polygon_area_px(points: list[tuple[float, float]]) -> float:
    total = 0.0
    for (x0, y0), (x1, y1) in zip(points, points[1:] + points[:1], strict=True):
        total += x0 * y1 - x1 * y0
    return abs(total) / 2


def polygon_centroid_px(points: list[tuple[float, float]]) -> tuple[float, float] | None:
    """Area centroid (shoelace). None for a degenerate polygon."""
    if len(points) < 3:
        return None
    signed = cx = cy = 0.0
    for (x0, y0), (x1, y1) in zip(points, points[1:] + points[:1], strict=True):
        cross = x0 * y1 - x1 * y0
        signed += cross
        cx += (x0 + x1) * cross
        cy += (y0 + y1) * cross
    if abs(signed) < 1e-9:
        return None
    return cx / (3 * signed), cy / (3 * signed)


def screen_bearing(origin: tuple[float, float], point: tuple[float, float]) -> float | None:
    """Clockwise from straight up the page, 0..360. None if the points coincide."""
    dx, dy = point[0] - origin[0], point[1] - origin[1]
    if math.hypot(dx, dy) < 1e-6:
        return None
    return math.degrees(math.atan2(dx, -dy)) % 360


def north_angle_from_arrow(tail: tuple[float, float], tip: tuple[float, float]) -> float | None:
    """The page bearing the north arrow points along, from its own end points."""
    return screen_bearing(tail, tip)


def angle_difference(a: float, b: float) -> float:
    return abs((a - b + 180) % 360 - 180)


@dataclass(frozen=True)
class Direction:
    key: str  # one of DIRECTION_KEYS
    bearing: float  # true bearing, clockwise from north
    boundary_distance: float  # degrees to the nearest sector edge (0..22.5)
    uncertain: bool


def classify(bearing: float, margin_degrees: float) -> Direction:
    """Snap a true bearing to the eight sectors and say how close to an edge it is."""
    bearing = bearing % 360
    offset = (bearing + SECTOR_DEGREES / 2) % SECTOR_DEGREES
    distance = min(offset, SECTOR_DEGREES - offset)
    key = DIRECTION_KEYS[int(((bearing + SECTOR_DEGREES / 2) % 360) // SECTOR_DEGREES)]
    return Direction(
        key=key, bearing=round(bearing, 1), boundary_distance=round(distance, 1), uncertain=distance < margin_degrees
    )


def direction_between(
    origin: tuple[float, float], point: tuple[float, float], north_angle: float, margin_degrees: float
) -> Direction | None:
    screen = screen_bearing(origin, point)
    if screen is None:
        return None
    return classify(screen - north_angle, margin_degrees)

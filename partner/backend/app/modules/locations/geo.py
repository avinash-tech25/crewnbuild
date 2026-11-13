"""Pure geometry helpers for live tracking. No I/O, no database.

Every point in this module -- and in everything that uses it -- is
`(latitude, longitude)`. OSRM and GeoJSON use the opposite order; that flip
happens once, in `routing_service`, and nowhere else.
"""

from math import atan2, cos, radians, sin, sqrt

EARTH_RADIUS_M = 6371008.8

Point = tuple[float, float]


def haversine_meters(a: Point, b: Point) -> float:
    """Great-circle distance between two points, in metres."""
    lat1, lon1 = radians(a[0]), radians(a[1])
    lat2, lon2 = radians(b[0]), radians(b[1])
    delta_lat, delta_lon = lat2 - lat1, lon2 - lon1
    h = sin(delta_lat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(delta_lon / 2) ** 2
    return 2 * EARTH_RADIUS_M * atan2(sqrt(h), sqrt(1 - h))


def interpolate(a: Point, b: Point, ratio: float) -> Point:
    return a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio


def _to_local_xy(origin: Point, point: Point) -> tuple[float, float]:
    """Equirectangular projection around `origin`; accurate over city distances."""
    x = radians(point[1] - origin[1]) * EARTH_RADIUS_M * cos(radians(origin[0]))
    y = radians(point[0] - origin[0]) * EARTH_RADIUS_M
    return x, y


def project_on_path(path: list[Point], point: Point) -> tuple[int, Point, float]:
    """Nearest position on a polyline: (segment index, projected point, metres away)."""
    if not path:
        raise ValueError("path must not be empty")
    if len(path) == 1:
        return 0, path[0], haversine_meters(path[0], point)

    best: tuple[int, Point, float] = (0, path[0], float("inf"))
    for index, (start, end) in enumerate(zip(path, path[1:])):
        end_x, end_y = _to_local_xy(start, end)
        point_x, point_y = _to_local_xy(start, point)
        squared = end_x * end_x + end_y * end_y
        ratio = 0.0 if squared <= 0 else max(0.0, min(1.0, (point_x * end_x + point_y * end_y) / squared))
        projected = interpolate(start, end, ratio)
        distance = haversine_meters(projected, point)
        if distance < best[2]:
            best = (index, projected, distance)
    return best


def remaining_distance_meters(path: list[Point], point: Point) -> float:
    """How far is still to travel along `path`, measured from the projected position.

    This is what makes the ETA fall smoothly as the technician moves without
    asking OSRM for a new route on every GPS fix.
    """
    if not path:
        return 0.0
    if len(path) == 1:
        return haversine_meters(point, path[0])

    index, projected, _ = project_on_path(path, point)
    remaining = haversine_meters(projected, path[index + 1])
    for start, end in zip(path[index + 1 :], path[index + 2 :]):
        remaining += haversine_meters(start, end)
    return remaining

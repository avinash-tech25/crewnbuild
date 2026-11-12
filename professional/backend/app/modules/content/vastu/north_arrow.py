"""Measure the north arrow's angle from its drawn pixels.

The vision model's coordinates were measured to be accurate only to about +-8
degrees on off-axis arrows, so the model is used just to say roughly WHERE the
arrow is (its tail and tip) and WHICH END is north. The angle itself is measured
here from the drawing, using two landmarks of the shape rather than its ink mass
(compass roses are often half-shaded — one side of each point filled, the other
white — which tilts any fit of the dark pixels by several degrees):

  tip    the drawn pixels furthest toward north along the arrow (the arrowhead
         point, or the end of a compass rose's north needle);
  base   for an arrow, the drawn end of the shaft opposite the tip; for a
         compass rose, the centre of the whole rose drawing, which a rose's
         rotational symmetry keeps at its true centre whatever the shading.

  north angle = page bearing from base to tip (clockwise from straight up).

Only the single connected stroke through the middle of the arrow is used, so a
nearby wall, the 'N' letter or a dimension line cannot pull the landmarks. Any
check that fails refuses the measurement instead of guessing.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

DARK_THRESHOLD = 110  # luminance below this counts as drawn ink
MAX_CORRECTION_DEGREES = 20.0  # the measured axis must stay this close to the rough one
MAX_LANDMARK_SHIFT = 0.35  # landmarks must lie within this share of the length of the rough points
EDGE_BAND_PX = 1.5  # pixels this close to the extreme form the tip/base landmark
ROSE_SECTOR = 25.0  # a needle end is searched within this many degrees of rough north/south
ROSE_COLLINEAR_DEGREES = 4.0  # the north and south needle halves must line up this closely
ROSE_SHAPE_RATIO = 0.35  # middle-half width / length: arrows measured 0.02-0.17, a compass rose 0.54-0.75


@dataclass(frozen=True)
class ArrowMeasurement:
    angle: float | None  # page bearing of north, clockwise from up
    ok: bool
    reason: str
    method: str = ""
    dark_pixels: int = 0
    correction_degrees: float = 0.0
    base: tuple[float, float] | None = None
    tip: tuple[float, float] | None = None
    shape_ratio: float = 0.0


def _bearing(dx: float, dy: float) -> float:
    return math.degrees(math.atan2(dx, -dy)) % 360


def _central_component(points, centre):
    """The 8-connected group of points whose nearest pixel is closest to `centre`."""
    remaining = set(points)
    best, best_distance = [], math.inf
    while remaining:
        seed = remaining.pop()
        group, stack = [seed], [seed]
        while stack:
            x, y = stack.pop()
            for nx in (x - 1, x, x + 1):
                for ny in (y - 1, y, y + 1):
                    if (nx, ny) in remaining:
                        remaining.discard((nx, ny))
                        group.append((nx, ny))
                        stack.append((nx, ny))
        distance = min(math.hypot(x - centre[0], y - centre[1]) for x, y in group)
        if distance < best_distance or (distance == best_distance and len(group) > len(best)):
            best, best_distance = group, distance
    return best


def _dark_in_window(image, cx, cy, ux, uy, half, band):
    reach = half + band
    points = []
    for y in range(max(0, int(cy - reach)), min(image.height, int(cy + reach) + 2)):
        for x in range(max(0, int(cx - reach)), min(image.width, int(cx + reach) + 2)):
            dx, dy = x - cx, y - cy
            if (
                abs(dx * ux + dy * uy) <= half
                and abs(-dx * uy + dy * ux) <= band
                and image.value(x, y) < DARK_THRESHOLD
            ):
                points.append((x, y))
    return points


def _dark_in_disc(image, cx, cy, radius):
    points = []
    for y in range(max(0, int(cy - radius)), min(image.height, int(cy + radius) + 2)):
        for x in range(max(0, int(cx - radius)), min(image.width, int(cx + radius) + 2)):
            if (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius and image.value(x, y) < DARK_THRESHOLD:
                points.append((x, y))
    return points


def _mean(points):
    return sum(x for x, _ in points) / len(points), sum(y for _, y in points) / len(points)


def measure_arrow(image, tail: tuple[float, float], tip: tuple[float, float], kind: str = "arrow") -> ArrowMeasurement:
    vx, vy = tip[0] - tail[0], tip[1] - tail[1]
    length = math.hypot(vx, vy)
    if length < 8:
        return ArrowMeasurement(None, False, "the arrow is too small to measure")
    ux, uy = vx / length, vy / length
    rough = _bearing(ux, uy)
    cx, cy = (tail[0] + tip[0]) / 2, (tail[1] + tip[1]) / 2
    half = length / 2 * 1.08

    # 1. Centre the measuring band on the drawn stroke (sideways only; the
    #    landmarks below, not this fit, decide the angle).
    points: list[tuple[int, int]] = []
    # The first pass is wide because the model's points were seen up to ~16 px
    # beside the drawn stroke; the nearest connected stroke is then followed
    # and the band narrows onto it.
    for band in (max(10.0, length * 0.35), max(3.0, length * 0.10), max(3.0, length * 0.06)):
        points = _central_component(_dark_in_window(image, cx, cy, ux, uy, half, band), (cx, cy))
        if len(points) < max(10, length * 0.3):
            return ArrowMeasurement(None, False, "too few drawn pixels along the arrow", dark_pixels=len(points))
        mx, my = _mean(points)
        sxx = sum((x - mx) ** 2 for x, _ in points)
        syy = sum((y - my) ** 2 for _, y in points)
        sxy = sum((x - mx) * (y - my) for x, y in points)
        theta = 0.5 * math.atan2(2 * sxy, sxx - syy)
        ax, ay = math.cos(theta), math.sin(theta)
        if ax * ux + ay * uy < 0:
            ax, ay = -ax, -ay
        along = (cx - mx) * ax + (cy - my) * ay
        cx, cy, ux, uy = mx + along * ax, my + along * ay, ax, ay

    # 2. Tip landmark: the drawn pixels furthest toward the model's tip.
    projections = [((x - cx) * ux + (y - cy) * uy, (x, y)) for x, y in points]
    far = max(p for p, _ in projections)
    tip_px = _mean([pt for p, pt in projections if p >= far - EDGE_BAND_PX])

    # Which shape this is, decided from the drawing rather than from the
    # model's label: a simple arrow is narrow across its axis (its head is about
    # a fifth of its length), a compass rose is about as wide as it is long.
    # Measuring a rose as an arrow was seen to give a confident 14-degree error.
    # Width is taken across the MIDDLE half of the drawing only: a rose's arms
    # leave from its centre, so it is wide there, while an arrow is wide only
    # at its ends (its head, or a wall or line its tail happens to touch).
    shape_points = _central_component(_dark_in_disc(image, cx, cy, length * 0.8), (cx, cy))
    shape_ratio = 0.0
    if shape_points:
        along_all = [(x - cx) * ux + (y - cy) * uy for x, y in shape_points]
        low, high = min(along_all), max(along_all)
        middle, quarter = (low + high) / 2, (high - low) / 4
        across_middle = [
            -(x - cx) * uy + (y - cy) * ux
            for (x, y), a in zip(shape_points, along_all, strict=True)
            if abs(a - middle) <= quarter
        ]
        if across_middle:
            shape_ratio = (max(across_middle) - min(across_middle)) / max(1.0, high - low)
    rose_shaped = shape_ratio > ROSE_SHAPE_RATIO
    model_midpoint = ((tail[0] + tip[0]) / 2, (tail[1] + tip[1]) / 2)

    if kind == "compass_rose" or rose_shaped:
        # 3a. Rose: isolate the WHOLE rose (its ring joins every point into one
        #     drawing), independent of how long the model thought the needle
        #     was. Its centre of mass is its true centre by rotational symmetry.
        #     North / south needle ends are the farthest drawn points within
        #     ROSE_SECTOR degrees of rough north / south; the angle runs from
        #     the south end to the north end, and the two halves must line up.
        region = max(3 * length, 60.0)
        rose = _central_component(_dark_in_disc(image, tail[0], tail[1], region), tail)
        if len(rose) < max(20, length):
            return ArrowMeasurement(None, False, "the compass rose could not be isolated", dark_pixels=len(rose))
        rx, ry = _mean(rose)

        def needle_end(direction: float):
            best, best_distance = [], 0.0
            for x, y in rose:
                dx, dy = x - rx, y - ry
                distance = math.hypot(dx, dy)
                if distance < 1 or abs((_bearing(dx, dy) - direction + 180) % 360 - 180) > ROSE_SECTOR:
                    continue
                if distance > best_distance + EDGE_BAND_PX:
                    best, best_distance = [(x, y)], distance
                elif distance >= best_distance - EDGE_BAND_PX:
                    best.append((x, y))
                    best_distance = max(best_distance, distance)
            return (
                (
                    _mean([pt for pt in best if math.hypot(pt[0] - rx, pt[1] - ry) >= best_distance - EDGE_BAND_PX]),
                    best_distance,
                )
                if best
                else (None, 0.0)
            )

        tip_px, north_reach = needle_end(rough)
        base_px, south_reach = needle_end((rough + 180) % 360)
        if tip_px is None or base_px is None:
            return ArrowMeasurement(None, False, "the compass needle could not be traced", dark_pixels=len(rose))
        half_north = _bearing(tip_px[0] - rx, tip_px[1] - ry)
        half_south = _bearing(rx - base_px[0], ry - base_px[1])
        if abs((half_north - half_south + 180) % 360 - 180) > ROSE_COLLINEAR_DEGREES:
            return ArrowMeasurement(
                None,
                False,
                "the compass needle's north and south halves do not line up",
                dark_pixels=len(rose),
                base=(round(base_px[0], 1), round(base_px[1], 1)),
                tip=(round(tip_px[0], 1), round(tip_px[1], 1)),
            )
        method = "compass rose: south needle end to north needle end, through the rose's centre"
        if kind != "compass_rose":
            method += " (drawn shape is a compass rose, although it was reported as an arrow)"
        anchor = (rx, ry)
        # What the rose's centre should be near: the model's tail for a rose,
        # the middle of its two points if it called the rose an arrow.
        anchor_reference = tail if kind == "compass_rose" else model_midpoint
        length = max(length, (north_reach + south_reach) / 2)
    else:
        # 3b. Arrow: the shaft's silhouette centre line. For each 1-px slice
        #     across the shaft, the midpoint between its outer edges (immune to
        #     shading inside the outline); slices much wider than the shaft —
        #     the arrowhead, or a wall the arrow touches — are left out. A line
        #     fitted through those midpoints gives the axis; the tip gives which
        #     way along it north lies.
        slices: dict[int, list[float]] = {}
        for x, y in points:
            a = round((x - cx) * ux + (y - cy) * uy)
            slices.setdefault(a, []).append(-(x - cx) * uy + (y - cy) * ux)
        widths = sorted(max(v) - min(v) + 1 for v in slices.values())
        shaft_width = widths[len(widths) // 2]
        kept = [(a, (max(v) + min(v)) / 2) for a, v in slices.items() if max(v) - min(v) + 1 <= shaft_width * 1.6 + 1]
        if len(kept) < max(6, length * 0.3):
            return ArrowMeasurement(None, False, "the arrow shaft could not be traced", dark_pixels=len(points))
        n = len(kept)
        ma = sum(a for a, _ in kept) / n
        mc = sum(c for _, c in kept) / n
        saa = sum((a - ma) ** 2 for a, _ in kept)
        slope = sum((a - ma) * (c - mc) for a, c in kept) / saa if saa else 0.0
        # Rotate the band axis by the fitted lateral slope.
        norm = math.hypot(1.0, slope)
        ax, ay = (ux - slope * uy) / norm, (uy + slope * ux) / norm
        # A point on the fitted line: `ma` along the band axis, `mc` across it
        # (the across direction is (-uy, ux), as used for the slices above).
        ox, oy = cx + ma * ux - mc * uy, cy + ma * uy + mc * ux
        base_px = (ox - ax * length / 2, oy - ay * length / 2)
        tip_px = (ox + ax * length / 2, oy + ay * length / 2)
        method = "arrow: fitted centre line of the drawn shaft, pointing toward the arrowhead"
        anchor = base_px
        anchor_reference = tail

    measured_length = math.hypot(tip_px[0] - base_px[0], tip_px[1] - base_px[1])
    if measured_length < length * 0.5:
        return ArrowMeasurement(
            None, False, "the drawn arrow is much shorter than its detected position", method, len(points)
        )
    shift = max(
        math.hypot(tip_px[0] - tip[0], tip_px[1] - tip[1]),
        math.hypot(anchor[0] - anchor_reference[0], anchor[1] - anchor_reference[1]),
    )
    angle = _bearing(tip_px[0] - base_px[0], tip_px[1] - base_px[1])
    correction = abs((angle - rough + 180) % 360 - 180)
    result = dict(  # noqa: C408 keyword form keeps the field names readable
        method=method,
        dark_pixels=len(points),
        correction_degrees=round(correction, 1),
        shape_ratio=round(shape_ratio, 2),
        base=(round(base_px[0], 1), round(base_px[1], 1)),
        tip=(round(tip_px[0], 1), round(tip_px[1], 1)),
    )
    if correction > MAX_CORRECTION_DEGREES or shift > length * MAX_LANDMARK_SHIFT:
        return ArrowMeasurement(None, False, "the drawn arrow does not match its detected position", **result)
    return ArrowMeasurement(round(angle, 1), True, "measured from the drawn pixels", **result)

"""What a screen shows as adverts, and counting their views and clicks (ported from the
old advertisement_service.py and admin advert_service.running_adverts / record_event).

Placement keys, positions and the console sections are the admin console's vocabulary;
they are kept here because the public side has to read them too.
"""

import uuid
from datetime import date
from typing import Any

from fastapi import HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.modules.content.models import AD_STATUS_ACTIVE, Ad, AdDailyStat
from app.modules.identity.schemas import RETIRED_KUWAIT_VALUES

EVENT_VIEW = "VIEW"
EVENT_CLICK = "CLICK"
SCOPE_GLOBAL = "GLOBAL"
LOCALITY_INDIA = "IN"
INDIA_ONLY_DETAIL = "Crew&Build is available in India only."

PLACEMENTS = {
    "home": "Landing page",
    "about": "About",
    "services": "Services",
    "projects": "Projects",
    "why_us": "Why choose us",
    "process": "Process",
    "testimonials": "Testimonials",
    "contact": "Contact",
    "estimate": "Estimate calculator",
    "owner_dashboard": "Owner dashboard",
    "contractor_dashboard": "Builder dashboard",
    "supplier_dashboard": "Supplier dashboard",
    "engineer_dashboard": "Engineer dashboard",
}
CONSOLE_SECTIONS = {
    "owner_dashboard": {
        "dashboard": "Overview",
        "projects": "Projects",
        "buySell": "Buy & Sell",
        "messages": "Messages",
        "profile": "Profile",
    },
    "contractor_dashboard": {
        "requests": "Dashboard",
        "projects": "Projects",
        "engineers": "My Site Engineers",
        "findClients": "Find Clients",
        "buySell": "Buy & Sell",
        "activity": "Site Activity",
        "payments": "Payments",
    },
    "supplier_dashboard": {
        "requests": "Dashboard",
        "myProjects": "My Projects",
        "orders": "Orders",
        "incomingRequests": "Incoming Requests",
        "findClients": "Find Clients",
        "products": "Products",
    },
    "engineer_dashboard": {
        "dashboard": "Overview",
        "projects": "Projects",
        "suppliers": "Suppliers",
        "findOpportunities": "Find Opportunities",
    },
}
for _console, _sections in CONSOLE_SECTIONS.items():
    for _section, _label in _sections.items():
        PLACEMENTS[f"{_console}:{_section}"] = f"{PLACEMENTS[_console]} - {_label}"

POSITION_TOP = "top"
POSITION_FOOTER = "footer"
POSITIONS = {POSITION_TOP: "Top of the page", POSITION_FOOTER: "Above the footer"}
DEFAULT_POSITION = POSITION_FOOTER


def split_placement(token: str) -> tuple[str, str]:
    """A stored entry as (screen, position); no "@" means the footer."""
    screen, _, position = token.partition("@")
    return screen, (position or DEFAULT_POSITION)


def placement_console(placement: str) -> str:
    return placement.split(":", 1)[0]


def parse_placements(raw: str | None) -> list[str]:
    return [entry for entry in (raw or "").split(",") if entry]


def known_placement(placement: str) -> str | None:
    """The placement, its console for an unknown section, or None for nothing at all."""
    if placement in PLACEMENTS:
        return placement
    console = placement_console(placement)
    return console if console in PLACEMENTS else None


def running_adverts(database: Session, placement: str, country: str | None, position: str | None = None) -> list[Ad]:
    """Active, inside their run window, for India or everywhere, on this screen and position."""
    known = known_placement(placement)
    if known is None:
        return []
    if str(country or "").strip().upper() in RETIRED_KUWAIT_VALUES:
        raise HTTPException(status_code=422, detail=INDIA_ONLY_DETAIL)
    today = date.today()
    console = placement_console(known)
    wrapped = func.concat(",", Ad.placements, ",")
    candidates = database.scalars(
        select(Ad)
        .where(
            Ad.status == AD_STATUS_ACTIVE,
            or_(Ad.scope == LOCALITY_INDIA, Ad.scope == SCOPE_GLOBAL),
            or_(Ad.starts_on.is_(None), Ad.starts_on <= today),
            or_(Ad.ends_on.is_(None), Ad.ends_on >= today),
            or_(
                wrapped.like(f"%,{known}@%"),
                wrapped.like(f"%,{known},%"),
                wrapped.like(f"%,{console}@%"),
                wrapped.like(f"%,{console},%"),
            ),
        )
        .order_by(Ad.created_at.desc())
    ).all()
    wanted = position if position in POSITIONS else DEFAULT_POSITION

    def sits_here(advert: Ad) -> bool:
        # A placement naming the exact section wins over one naming the whole console.
        placed = dict(split_placement(entry) for entry in parse_placements(advert.placements))
        return placed.get(known, placed.get(console)) == wanted

    return [advert for advert in candidates if sits_here(advert)]


def public_image_url(advert: Ad) -> str:
    """The public address of an uploaded picture; the stored file id rides along as `f`
    so a replaced picture is a new address (browsers keep it for an hour)."""
    stored = advert.image_url or ""
    if stored.startswith("/files/"):
        return f"/ads/{advert.id}/image?f={stored.rsplit('/', 1)[-1]}"
    return stored


def adverts_for_screen(
    database: Session, placement: str, country: str | None, position: str | None
) -> list[dict[str, Any]]:
    return [
        {
            "id": advert.id,
            "title": advert.title,
            "image_url": public_image_url(advert),
            "link_url": advert.link_url,
            "display_width": advert.display_width or "FULL",
        }
        for advert in running_adverts(database, placement, country, position)
    ]


def record_event(database: Session, advert_id: uuid.UUID, placement: str, event: str) -> None:
    """Add one view or click to today's total for this advert on this screen, in one upsert."""
    event = (event or "").strip().upper()
    known = known_placement(placement) or ""
    if event not in (EVENT_VIEW, EVENT_CLICK) or not known:
        return
    # Crash fixed: an unknown advert id used to fail the upsert's foreign key (500).
    if database.get(Ad, advert_id) is None:
        raise HTTPException(status_code=404, detail="No such advert.")
    column = "views" if event == EVENT_VIEW else "clicks"
    statement = insert(AdDailyStat.__table__).values(
        ad_id=advert_id,
        placement=known,
        day=date.today(),
        views=1 if event == EVENT_VIEW else 0,
        clicks=1 if event == EVENT_CLICK else 0,
    )
    database.execute(
        statement.on_conflict_do_update(
            index_elements=["ad_id", "placement", "day"],
            set_={column: getattr(AdDailyStat.__table__.c, column) + 1},
        )
    )
    database.commit()


def placements_list() -> list[dict[str, str]]:
    return [{"key": key, "label": label} for key, label in PLACEMENTS.items()]

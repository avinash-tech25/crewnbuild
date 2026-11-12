"""The ad console: creating, editing, starting and stopping ads, and how they perform
(ported from the old app/admin/services/advert_service.py, same rules). What a screen
shows and the view/click counting are the content module's (modules/content/ad_service.py).

An ad belongs to a country; an India administrator sees India's and the GLOBAL ones
(which run everywhere) but may change only India's. Only a Global Super Admin creates
or changes a GLOBAL ad.
"""

import uuid
from decimal import Decimal
from typing import Any

from fastapi import HTTPException
from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session

from app.core.local_time import utc_now
from app.modules.accounts.models import SCOPE_GLOBAL
from app.modules.admin.admin_identity import AdminIdentity
from app.modules.admin.audit_log import ACTION_ADVERT_CREATED, ACTION_ADVERT_STATUS, ACTION_ADVERT_UPDATED, record
from app.modules.admin.schemas import AdvertCreate, AdvertStatus, AdvertUpdate
from app.modules.admin.scope import LOCALITY_INDIA, refuse_kuwait, viewing
from app.modules.content.ad_service import PLACEMENTS, POSITIONS, parse_placements, split_placement
from app.modules.content.models import AD_STATUS_ACTIVE, AD_STATUS_DRAFT, AD_STATUS_PAUSED, Ad, AdDailyStat

ADVERT_STATUSES = (AD_STATUS_DRAFT, AD_STATUS_ACTIVE, AD_STATUS_PAUSED)
DISPLAY_WIDTHS = {"FULL": "Full width", "HALF": "Half width", "SMALL": "Small"}
DEFAULT_WIDTH = "FULL"
PRICING_FLAT = "FLAT"
PRICING_PER_1000_VIEWS = "PER_1000_VIEWS"
PRICING_PER_CLICK = "PER_CLICK"
PRICING_MODELS = (PRICING_FLAT, PRICING_PER_1000_VIEWS, PRICING_PER_CLICK)
# India only, priced in rupees.
CURRENCY_FOR_SCOPE = {"IN": "INR"}
CURRENCIES = ("INR",)


def scope_adverts(statement: Select[Any], admin: Any) -> Select[Any]:
    """A location administrator sees its own country's ads and the GLOBAL ones."""
    if admin.is_global:
        return statement
    return statement.where(or_(Ad.scope == admin.scope, Ad.scope == SCOPE_GLOBAL))


def resolve_scope(admin: AdminIdentity, requested: str | None) -> str:
    refuse_kuwait(requested)
    if not admin.is_global:
        return admin.scope
    scope = (requested or "").strip().upper()
    if scope not in (SCOPE_GLOBAL, LOCALITY_INDIA):
        raise HTTPException(status_code=400, detail="Choose a country: GLOBAL or IN.")
    return scope


def resolve_placements(requested: list[str] | None) -> str:
    """Each entry is a screen and, after an "@", where on it the ad sits; both halves
    are checked, and a screen may hold the ad in one position only."""
    wanted = {p.strip() for p in (requested or []) if p and p.strip()}
    if not wanted:
        raise HTTPException(status_code=400, detail="Choose at least one screen for this advert.")
    resolved = set()
    for token in wanted:
        screen, position = split_placement(token)
        if screen not in PLACEMENTS:
            raise HTTPException(status_code=400, detail=f"Unknown screen: {screen}")
        if position not in POSITIONS:
            raise HTTPException(status_code=400, detail=f"Unknown position: {position}")
        resolved.add(f"{screen}@{position}")
    screens = [split_placement(entry)[0] for entry in resolved]
    if len(set(screens)) != len(screens):
        raise HTTPException(status_code=400, detail="A screen can only hold this advert in one position.")
    return ",".join(sorted(resolved))


def resolve_width(requested: str | None) -> str:
    width = (requested or DEFAULT_WIDTH).strip().upper()
    if width not in DISPLAY_WIDTHS:
        raise HTTPException(status_code=400, detail="That is not a width an advert can take.")
    return width


def check_dates(starts_on: Any, ends_on: Any) -> None:
    if starts_on and ends_on and ends_on < starts_on:
        raise HTTPException(status_code=400, detail="The end date cannot be before the start date.")


def resolve_price(
    scope: str, amount: Decimal | None, currency: str | None, model: str | None
) -> tuple[Decimal | None, str | None, str | None]:
    """All of amount, currency and model, or none; the currency follows the ad's country."""
    given = [value for value in (amount, currency, model) if value not in (None, "")]
    if not given:
        return None, None, None
    if amount is None or model is None:
        raise HTTPException(
            status_code=422, detail="A price needs both an amount and how it is charged, or leave both empty."
        )
    if amount <= 0:
        raise HTTPException(status_code=422, detail="A price has to be more than nothing.")
    if model not in PRICING_MODELS:
        raise HTTPException(status_code=400, detail="That is not a way an advert can be charged.")
    refuse_kuwait(currency)
    resolved = (currency or "").strip().upper() or CURRENCY_FOR_SCOPE.get(scope, "")
    if not resolved:
        raise HTTPException(
            status_code=422, detail="An advert running in both countries has to say which currency its price is in."
        )
    if resolved not in CURRENCIES:
        raise HTTPException(status_code=400, detail="That is not a currency this platform uses.")
    return amount, resolved, model


def load_manageable_advert(database: Session, admin: AdminIdentity, advert_id: uuid.UUID) -> Ad:
    advert = database.get(Ad, advert_id)
    if advert is None:
        raise HTTPException(status_code=404, detail="No such advert.")
    if not admin.is_global:
        if advert.scope == SCOPE_GLOBAL:
            raise HTTPException(
                status_code=403,
                detail="This advert runs in both countries; only a Global administrator can change it.",
            )
        if advert.scope != admin.scope:
            raise HTTPException(status_code=403, detail="That advert belongs to another country.")
    return advert


def advert_earned(advert: Ad, views: int, clicks: int) -> Decimal | None:
    """The agreed rate met with the counts (nothing is collected; no payment rail). A
    flat booking counts once the ad has run at all."""
    if advert.price_amount is None or not advert.pricing_model:
        return None
    if advert.pricing_model == PRICING_FLAT:
        return advert.price_amount if advert.status != AD_STATUS_DRAFT else Decimal("0.00")
    if advert.pricing_model == PRICING_PER_1000_VIEWS:
        return (advert.price_amount * Decimal(views) / Decimal(1000)).quantize(Decimal("0.01"))
    if advert.pricing_model == PRICING_PER_CLICK:
        return (advert.price_amount * Decimal(clicks)).quantize(Decimal("0.01"))
    return None


def advert_totals(database: Session, advert_ids: list[uuid.UUID]) -> dict[uuid.UUID, dict[str, int]]:
    if not advert_ids:
        return {}
    rows = database.execute(
        select(
            AdDailyStat.ad_id,
            func.coalesce(func.sum(AdDailyStat.views), 0),
            func.coalesce(func.sum(AdDailyStat.clicks), 0),
        )
        .where(AdDailyStat.ad_id.in_(advert_ids))
        .group_by(AdDailyStat.ad_id)
    ).all()
    return {row[0]: {"views": int(row[1]), "clicks": int(row[2])} for row in rows}


def advert_breakdown(database: Session, advert_id: uuid.UUID) -> list[dict[str, Any]]:
    rows = database.execute(
        select(
            AdDailyStat.placement,
            func.coalesce(func.sum(AdDailyStat.views), 0),
            func.coalesce(func.sum(AdDailyStat.clicks), 0),
        )
        .where(AdDailyStat.ad_id == advert_id)
        .group_by(AdDailyStat.placement)
        .order_by(func.sum(AdDailyStat.views).desc())
    ).all()
    return [
        {"placement": row[0], "label": PLACEMENTS.get(row[0], row[0]), "views": int(row[1]), "clicks": int(row[2])}
        for row in rows
    ]


def serialise(advert: Ad, totals: dict[str, int] | None = None) -> dict[str, Any]:
    counts = totals or {"views": 0, "clicks": 0}
    entries = [split_placement(entry) for entry in parse_placements(advert.placements)]
    earned = advert_earned(advert, counts.get("views", 0), counts.get("clicks", 0))
    return {
        "id": advert.id,
        "title": advert.title,
        "image_url": advert.image_url,
        "link_url": advert.link_url,
        "placements": [screen for screen, _ in entries],
        "placement_positions": dict(entries),
        "scope": advert.scope,
        "status": advert.status,
        "display_width": advert.display_width or DEFAULT_WIDTH,
        "starts_on": advert.starts_on.isoformat() if advert.starts_on else None,
        "ends_on": advert.ends_on.isoformat() if advert.ends_on else None,
        "views": counts.get("views", 0),
        "clicks": counts.get("clicks", 0),
        # Strings: amounts of money must not round through a JSON float.
        "price_amount": str(advert.price_amount) if advert.price_amount is not None else None,
        "currency": advert.currency,
        "pricing_model": advert.pricing_model,
        "earned": str(earned) if earned is not None else None,
        "created_at": advert.created_at.isoformat() if advert.created_at else None,
    }


def revenue_by_currency(database: Session, adverts: list[Ad]) -> list[dict[str, Any]]:
    """What the ads in scope have come to, kept apart by currency (never one total)."""
    totals = advert_totals(database, [advert.id for advert in adverts])
    summary: dict[str, dict[str, Any]] = {}
    for advert in adverts:
        counts = totals.get(advert.id) or {"views": 0, "clicks": 0}
        earned = advert_earned(advert, counts.get("views", 0), counts.get("clicks", 0))
        if earned is None or not advert.currency:
            continue
        entry = summary.setdefault(
            advert.currency, {"currency": advert.currency, "earned": Decimal("0.00"), "adverts": 0}
        )
        entry["earned"] += earned
        entry["adverts"] += 1
    return [
        {"currency": row["currency"], "earned": str(row["earned"]), "adverts": row["adverts"]}
        for row in sorted(summary.values(), key=lambda row: row["currency"])
    ]


def advert_response(database: Session, advert: Ad) -> dict[str, Any]:
    return serialise(advert, advert_totals(database, [advert.id]).get(advert.id))


def list_adverts(
    database: Session, admin: AdminIdentity, *, status: str | None, limit: int, offset: int, country: str | None
) -> dict[str, Any]:
    statement = scope_adverts(select(Ad), viewing(admin, country))
    if status:
        statement = statement.where(Ad.status == status.strip().upper())
    total = database.scalar(select(func.count()).select_from(statement.subquery())) or 0
    rows = database.scalars(statement.order_by(Ad.created_at.desc()).offset(offset).limit(limit)).all()
    totals = advert_totals(database, [row.id for row in rows])
    return {
        "total": total,
        "items": [serialise(row, totals.get(row.id)) for row in rows],
        # Every ad in scope, not just this page.
        "revenue": revenue_by_currency(database, list(database.scalars(statement).all())),
    }


def create_advert(database: Session, admin: AdminIdentity, payload: AdvertCreate) -> dict[str, Any]:
    """An ad starts as a draft, so nothing goes live by accident."""
    title = (payload.title or "").strip()
    if len(title) < 3:
        raise HTTPException(status_code=422, detail="Give the advert a name you will recognise later.")
    if not (payload.image_url or "").strip():
        raise HTTPException(status_code=422, detail="An advert needs an image.")
    check_dates(payload.starts_on, payload.ends_on)
    scope = resolve_scope(admin, payload.scope)
    price_amount, currency, pricing_model = resolve_price(
        scope, payload.price_amount, payload.currency, payload.pricing_model
    )
    advert = Ad(
        title=title,
        image_url=payload.image_url.strip(),
        link_url=(payload.link_url or "").strip() or None,
        placements=resolve_placements(payload.placements),
        scope=scope,
        status=AD_STATUS_DRAFT,
        starts_on=payload.starts_on,
        ends_on=payload.ends_on,
        display_width=resolve_width(payload.display_width),
        price_amount=price_amount,
        currency=currency,
        pricing_model=pricing_model,
        created_by_user_id=admin.user.id,
    )
    database.add(advert)
    database.flush()
    record(
        database,
        admin,
        ACTION_ADVERT_CREATED,
        target_type="advert",
        target_id=advert.id,
        summary=f"Created advert '{advert.title}' for {advert.scope} on {advert.placements}",
    )
    database.commit()
    return advert_response(database, advert)


def apply_update(advert: Ad, payload: AdvertUpdate) -> list[str]:
    """Change an ad and say what changed. Its country is not editable."""
    changes: list[str] = []
    title, image_url = payload.title, payload.image_url
    if title is not None and title.strip() and title.strip() != advert.title:
        changes.append(f"title '{advert.title}' -> '{title.strip()}'")
        advert.title = title.strip()
    if image_url is not None and image_url.strip() and image_url.strip() != advert.image_url:
        changes.append("image replaced")
        advert.image_url = image_url.strip()
    if payload.link_url is not None:
        cleaned = payload.link_url.strip() or None
        if cleaned != advert.link_url:
            changes.append(f"link {advert.link_url or '(none)'} -> {cleaned or '(none)'}")
            advert.link_url = cleaned
    if payload.placements is not None:
        resolved = resolve_placements(payload.placements)
        if resolved != advert.placements:
            changes.append(f"screens {advert.placements or '(none)'} -> {resolved}")
            advert.placements = resolved
    if payload.clear_dates:
        if advert.starts_on or advert.ends_on:
            changes.append("run dates cleared")
            advert.starts_on = advert.ends_on = None
    else:
        new_start = payload.starts_on if payload.starts_on is not None else advert.starts_on
        new_end = payload.ends_on if payload.ends_on is not None else advert.ends_on
        check_dates(new_start, new_end)
        if new_start != advert.starts_on:
            changes.append(f"start {advert.starts_on or '(none)'} -> {new_start or '(none)'}")
            advert.starts_on = new_start
        if new_end != advert.ends_on:
            changes.append(f"end {advert.ends_on or '(none)'} -> {new_end or '(none)'}")
            advert.ends_on = new_end
    if payload.display_width is not None:
        resolved_width = resolve_width(payload.display_width)
        if resolved_width != advert.display_width:
            changes.append(f"width {advert.display_width} -> {resolved_width}")
            advert.display_width = resolved_width
    # The rate can be corrected; what the ad earned is restated at the new rate, which
    # is why both figures go into the audit entry.
    if payload.clear_price:
        if advert.price_amount is not None:
            changes.append(f"price {advert.price_amount} {advert.currency} -> (none)")
            advert.price_amount = advert.currency = advert.pricing_model = None
    elif payload.price_amount is not None or payload.pricing_model is not None:
        amount = payload.price_amount if payload.price_amount is not None else advert.price_amount
        model = payload.pricing_model if payload.pricing_model is not None else advert.pricing_model
        resolved_amount, resolved_currency, resolved_model = resolve_price(advert.scope, amount, advert.currency, model)
        if (resolved_amount, resolved_model) != (advert.price_amount, advert.pricing_model):
            changes.append(
                f"price {advert.price_amount or '(none)'} {advert.pricing_model or ''}".rstrip()
                + f" -> {resolved_amount} {resolved_currency} {resolved_model}"
            )
            advert.price_amount = resolved_amount
            advert.currency = resolved_currency
            advert.pricing_model = resolved_model
    if not changes:
        raise HTTPException(status_code=400, detail="Nothing was changed.")
    return changes


def update_advert(
    database: Session, admin: AdminIdentity, advert_id: uuid.UUID, payload: AdvertUpdate
) -> dict[str, Any]:
    advert = load_manageable_advert(database, admin, advert_id)
    changes = apply_update(advert, payload)
    record(
        database,
        admin,
        ACTION_ADVERT_UPDATED,
        target_type="advert",
        target_id=advert.id,
        summary=f"Updated advert '{advert.title}': {'; '.join(changes)}",
        reason=payload.reason,
    )
    database.commit()
    return advert_response(database, advert)


def change_status(
    database: Session, admin: AdminIdentity, advert_id: uuid.UUID, payload: AdvertStatus
) -> dict[str, Any]:
    advert = load_manageable_advert(database, admin, advert_id)
    was = advert.status
    status = (payload.status or "").strip().upper()
    if status not in ADVERT_STATUSES:
        raise HTTPException(status_code=400, detail="Status must be DRAFT, ACTIVE or PAUSED.")
    advert.status = status
    advert.updated_at = utc_now()
    record(
        database,
        admin,
        ACTION_ADVERT_STATUS,
        target_type="advert",
        target_id=advert.id,
        summary=f"Advert '{advert.title}' {was} -> {advert.status}",
        reason=payload.reason,
    )
    database.commit()
    return advert_response(database, advert)


def advert_performance(database: Session, admin: AdminIdentity, advert_id: uuid.UUID) -> dict[str, Any]:
    advert = database.get(Ad, advert_id)
    if advert is None:
        raise HTTPException(status_code=404, detail="No such advert.")
    if not admin.is_global and advert.scope not in (admin.scope, SCOPE_GLOBAL):
        raise HTTPException(status_code=403, detail="That advert belongs to another country.")
    totals = advert_totals(database, [advert.id]).get(advert.id, {"views": 0, "clicks": 0})
    return {"advert": serialise(advert, totals), "by_placement": advert_breakdown(database, advert.id)}

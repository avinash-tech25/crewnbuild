"""Administrator coupon management -- the existing admin permission architecture.

    GET   /admin/coupons                 coupons.view    own country (Global: all, or ?country=IN)
    POST  /admin/coupons                 coupons.manage  own country only (Global: must name IN)
    PATCH /admin/coupons/{id}            coupons.manage  own country only; code and country never change
    POST  /admin/coupons/{id}/status     coupons.manage  activate / deactivate

Who may do what is decided on the server, by the same three facts as every admin
endpoint: role (an administrator at all), scope (GLOBAL / IN) and permission
(coupons.view / coupons.manage). A Location Super Admin or Manager scoped to IN is
an "India administrator"; a Global Super Admin oversees everything. A request
naming another country's coupon or country is refused, whatever the console
showed; one naming Kuwait is refused with 422. Every change is written to the audit log.
"""

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.local_time import local_iso
from app.database.session import get_db as get_database
from app.database.types import naive_utc_now
from app.modules.admin.admin_identity import AdminIdentity
from app.modules.admin.audit_log import record
from app.modules.admin.dependencies import require_admin
from app.modules.admin.scope import locality_code, refuse_kuwait, viewing
from app.modules.billing import coupons
from app.modules.billing import plans as catalogue
from app.modules.billing.models import COUPON_COUNTRIES, COUPON_CURRENCY, SubscriptionCoupon
from app.modules.billing.schemas import CouponCreate, CouponStatus, CouponUpdate
from app.modules.identity.models import User

router = APIRouter(prefix="/admin/coupons", tags=["Admin: builder subscription coupons"])

ACTION_COUPON_CREATED = "coupon.created"
ACTION_COUPON_UPDATED = "coupon.updated"
ACTION_COUPON_STATUS = "coupon.status"
# The create form has no usage controls; a new coupon is limited to one use per builder.
NEW_COUPON_USES_PER_BUILDER = 1


def _country_of(admin: AdminIdentity, requested: str | None) -> str:
    """The country a new coupon belongs to. A location administrator gets their own
    and is refused another; a Global administrator must choose IN."""
    refuse_kuwait(requested)
    wanted = locality_code(requested) if requested else ""
    if admin.is_global:
        if wanted not in COUPON_COUNTRIES:
            raise HTTPException(status_code=400, detail="Choose the coupon's country: IN (India).")
        return wanted
    if requested and wanted != admin.scope:
        raise HTTPException(status_code=403, detail="You can only manage coupons for your own country.")
    return admin.scope


def load_manageable_coupon(database: Session, admin: AdminIdentity, coupon_id: uuid.UUID) -> SubscriptionCoupon:
    coupon = database.get(SubscriptionCoupon, coupon_id)
    if coupon is None:
        raise HTTPException(status_code=404, detail="No such coupon.")
    if not admin.may_reach(coupon.country):
        raise HTTPException(status_code=403, detail="That coupon belongs to another country.")
    return coupon


def _check_plan(plan_code: str, duration_code: str) -> tuple[str, str]:
    plan_code, duration_code = (plan_code or "").upper(), (duration_code or "").upper()
    if not catalogue.is_paid_plan(plan_code) or not catalogue.is_offered_duration(duration_code):
        raise HTTPException(status_code=400, detail="Choose a paid plan and a Monthly or Annual billing period.")
    return plan_code, duration_code


def _discount_minor(
    database: Session, raw_amount: str, currency: str, plan_code: str | None, duration_code: str | None
) -> int:
    """The discount in minor units. It must leave the minimum payable on the coupon's
    plan -- or, for a coupon on any plan, on at least the dearest priced plan."""
    try:
        minor = coupons.to_minor(raw_amount, currency)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    if minor <= 0:
        raise HTTPException(status_code=400, detail="The discount must be more than zero.")
    if plan_code is None:
        prices = [
            coupons.plan_price(database, plan, duration, currency)
            for plan in catalogue.PAID_PLANS
            for duration in catalogue.OFFERED_DURATIONS
        ]
        price = max((value for value in prices if value is not None), default=None)
    else:
        price = coupons.plan_price(database, plan_code, duration_code, currency)
    if price is not None and price - minor < coupons.MIN_PAYABLE_MINOR[currency]:
        raise HTTPException(
            status_code=400,
            detail=f"The discount must leave at least {coupons.from_minor(coupons.MIN_PAYABLE_MINOR[currency], currency)} "
            f"{currency} to pay on a plan priced {coupons.from_minor(price, currency)} {currency}.",
        )
    return minor


def _check_dates(starts_on, expires_on) -> None:
    if expires_on < starts_on:
        raise HTTPException(status_code=400, detail="The expiry date cannot be before the start date.")


def coupon_state(coupon: SubscriptionCoupon, redeemed: int, now: datetime | None = None) -> str:
    today = coupons.country_today(coupon.country, now)
    if not coupon.is_active:
        return "INACTIVE"
    if today < coupon.starts_on:
        return "SCHEDULED"
    if today > coupon.expires_on:
        return "EXPIRED"
    if coupon.max_redemptions is not None and redeemed >= coupon.max_redemptions:
        return "EXHAUSTED"
    return "ACTIVE"


def serialise(database: Session, coupon: SubscriptionCoupon) -> dict:
    redeemed, in_progress = coupons.usage(database, coupon.id)
    people = (
        {
            row.id: row.email
            for row in database.query(User.id, User.email)
            .filter(User.id.in_({coupon.created_by_id, coupon.updated_by_id} - {None}))
            .all()
        }
        if (coupon.created_by_id or coupon.updated_by_id)
        else {}
    )
    return {
        "id": str(coupon.id),
        "code": coupon.code,
        "country": coupon.country,
        "currency": coupon.currency,
        "discount_minor": int(coupon.discount_minor),
        "discount_amount": coupons.from_minor(int(coupon.discount_minor), coupon.currency),
        "plan_code": coupon.plan_code,
        "duration_code": coupon.duration_code,
        "starts_on": coupon.starts_on.isoformat(),
        "expires_on": coupon.expires_on.isoformat(),
        "max_redemptions": coupon.max_redemptions,
        "max_per_builder": coupon.max_per_builder,
        "is_active": coupon.is_active,
        "state": coupon_state(coupon, redeemed),
        "redeemed_count": redeemed,
        "in_progress_count": in_progress,
        "created_by": people.get(coupon.created_by_id),
        "updated_by": people.get(coupon.updated_by_id),
        "created_at": local_iso(coupon.created_at),
        "updated_at": local_iso(coupon.updated_at),
    }


@router.get("")
def list_coupons(
    country: str | None = Query(default=None),
    admin: AdminIdentity = Depends(require_admin("coupons.view")),
    database: Session = Depends(get_database),
):
    view = viewing(admin, country)
    query = database.query(SubscriptionCoupon)
    if not view.is_global:
        query = query.filter(SubscriptionCoupon.country == view.scope)
    rows = query.order_by(SubscriptionCoupon.created_at.desc(), SubscriptionCoupon.id.desc()).all()
    return {
        "coupons": [serialise(database, coupon) for coupon in rows],
        "scope": view.scope if not view.is_global else "GLOBAL",
        "currencies": COUPON_CURRENCY,
        "checkout_countries": ["IN"],
    }


@router.post("", status_code=201)
def create_coupon(
    payload: CouponCreate,
    admin: AdminIdentity = Depends(require_admin("coupons.manage")),
    database: Session = Depends(get_database),
):
    code = coupons.normalize_code(payload.code)
    if not coupons.valid_code(code):
        raise HTTPException(
            status_code=400,
            detail="Use 3 to 40 characters: capital letters A-Z, digits 0-9, hyphen (-) or underscore (_), starting with a letter or digit.",
        )
    country = _country_of(admin, payload.country)
    currency = COUPON_CURRENCY[country]
    _check_dates(payload.starts_on, payload.expires_on)
    discount = _discount_minor(database, payload.discount_amount, currency, None, None)
    if database.query(SubscriptionCoupon.id).filter(SubscriptionCoupon.code == code).first():
        raise HTTPException(status_code=409, detail="A coupon with this code already exists.")
    # Any offered plan, active at once, one use per builder and no total limit.
    coupon = SubscriptionCoupon(
        code=code,
        country=country,
        currency=currency,
        discount_minor=discount,
        plan_code=None,
        duration_code=None,
        starts_on=payload.starts_on,
        expires_on=payload.expires_on,
        max_redemptions=None,
        max_per_builder=NEW_COUPON_USES_PER_BUILDER,
        is_active=True,
        created_by_id=admin.user.id,
        updated_by_id=admin.user.id,
    )
    database.add(coupon)
    try:
        database.flush()
    except IntegrityError:
        database.rollback()
        raise HTTPException(status_code=409, detail="A coupon with this code already exists.")
    record(
        database,
        admin,
        ACTION_COUPON_CREATED,
        target_type="subscription_coupon",
        target_id=coupon.id,
        summary=f"Created coupon {code} for {country}: {coupons.from_minor(discount, currency)} {currency} off "
        f"any plan, {payload.starts_on}..{payload.expires_on}",
    )
    database.commit()
    database.refresh(coupon)
    return serialise(database, coupon)


@router.patch("/{coupon_id}")
def update_coupon(
    coupon_id: uuid.UUID,
    payload: CouponUpdate,
    admin: AdminIdentity = Depends(require_admin("coupons.manage")),
    database: Session = Depends(get_database),
):
    coupon = load_manageable_coupon(database, admin, coupon_id)
    refuse_kuwait(payload.country)
    if payload.country and locality_code(payload.country) != coupon.country:
        raise HTTPException(status_code=403, detail="A coupon's country cannot be changed.")
    changes = []
    plan_code, duration_code = coupon.plan_code, coupon.duration_code
    if payload.plan_code is not None or payload.duration_code is not None:
        plan_code, duration_code = _check_plan(
            payload.plan_code or coupon.plan_code, payload.duration_code or coupon.duration_code
        )
    starts_on = payload.starts_on or coupon.starts_on
    expires_on = payload.expires_on or coupon.expires_on
    _check_dates(starts_on, expires_on)
    discount = int(coupon.discount_minor)
    if payload.discount_amount is not None or (plan_code, duration_code) != (coupon.plan_code, coupon.duration_code):
        discount = _discount_minor(
            database,
            payload.discount_amount or coupons.from_minor(discount, coupon.currency),
            coupon.currency,
            plan_code,
            duration_code,
        )
    updates = {
        "plan_code": plan_code,
        "duration_code": duration_code,
        "starts_on": starts_on,
        "expires_on": expires_on,
        "discount_minor": discount,
        "max_redemptions": None
        if payload.clear_max_redemptions
        else (payload.max_redemptions or coupon.max_redemptions),
        "max_per_builder": None
        if payload.clear_max_per_builder
        else (payload.max_per_builder or coupon.max_per_builder),
    }
    for field, value in updates.items():
        if getattr(coupon, field) != value:
            changes.append(f"{field}: {getattr(coupon, field)} -> {value}")
            setattr(coupon, field, value)
    if not changes:
        return serialise(database, coupon)
    coupon.updated_by_id = admin.user.id
    coupon.updated_at = naive_utc_now()
    record(
        database,
        admin,
        ACTION_COUPON_UPDATED,
        target_type="subscription_coupon",
        target_id=coupon.id,
        summary=f"Updated coupon {coupon.code} ({coupon.country}): " + "; ".join(changes),
    )
    database.commit()
    database.refresh(coupon)
    return serialise(database, coupon)


@router.post("/{coupon_id}/status")
def set_coupon_status(
    coupon_id: uuid.UUID,
    payload: CouponStatus,
    admin: AdminIdentity = Depends(require_admin("coupons.manage")),
    database: Session = Depends(get_database),
):
    coupon = load_manageable_coupon(database, admin, coupon_id)
    if coupon.is_active != payload.active:
        coupon.is_active = payload.active
        coupon.updated_by_id = admin.user.id
        coupon.updated_at = naive_utc_now()
        record(
            database,
            admin,
            ACTION_COUPON_STATUS,
            target_type="subscription_coupon",
            target_id=coupon.id,
            summary=f"{'Activated' if payload.active else 'Deactivated'} coupon {coupon.code} ({coupon.country})",
        )
        database.commit()
        database.refresh(coupon)
    return serialise(database, coupon)

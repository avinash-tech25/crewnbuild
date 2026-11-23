"""Viswa's tools: the only way the AI can see any data.

Every tool is read-only and calls an existing service with the signed-in user from the
session, so the service's own role, permission and ownership checks apply exactly as on
the user's screens: Viswa can never see more than the user could. No tool takes a user id
or a role; a project id is accepted only for one of the user's OWN projects (checked here
and again by the service). Each tool returns a short whitelist of fields, and the result
then passes through safety.redact, so contact details, identity and bank numbers,
documents, secrets and camera data never reach the AI.

Roles (service.role_for): GUEST (help and the estimate), OWNER, BUILDER, SITE_ENGINEER,
ENGINEER (other engineer categories), the three supplier categories (and SUPPLIER for a
supplier who has not chosen one), and ADMIN (help and the counts its permissions allow:
never a person or a list of people). A tool is offered only to the roles in its set, and a
call for any other tool is refused, whatever the AI asks.
"""

import json
import logging
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.modules.assistant.knowledge import Card, Knowledge
from app.modules.assistant.safety import redact
from app.modules.identity.models import User
from app.modules.projects.models import Project

logger = logging.getLogger(__name__)

GUEST = "GUEST"
OWNER = "OWNER"
BUILDER = "BUILDER"
SITE_ENGINEER = "SITE_ENGINEER"
ENGINEER = "ENGINEER"
SUPPLIER = "SUPPLIER"
SUPPLIER_MATERIAL = "SUPPLIER_MATERIAL"
SUPPLIER_LABOUR = "SUPPLIER_LABOUR"
SUPPLIER_EQUIPMENT = "SUPPLIER_EQUIPMENT"
ADMIN = "ADMIN"
SUPPLIERS = frozenset({SUPPLIER, SUPPLIER_MATERIAL, SUPPLIER_LABOUR, SUPPLIER_EQUIPMENT})
SIGNED_IN = frozenset({OWNER, BUILDER, SITE_ENGINEER, ENGINEER, *SUPPLIERS})
ROLE_LABELS = {
    GUEST: "Visitor", OWNER: "House Owner", BUILDER: "Builder", SITE_ENGINEER: "Site Engineer", ENGINEER: "Engineer",
    SUPPLIER: "Supplier", SUPPLIER_MATERIAL: "Material Supplier", SUPPLIER_LABOUR: "Labor Supplier",
    SUPPLIER_EQUIPMENT: "Equipment Supplier", ADMIN: "Administrator",
}  # fmt: skip
MAX_ROWS = 10
OTHER_PEOPLE_TEXT = 120  # titles written by others are cut short (they are data, not instructions)


@dataclass
class ToolContext:
    database: Session
    user: User | None
    role: str
    knowledge: Knowledge
    cards_seen: list[Card] = field(default_factory=list)
    tools_used: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    parameters: dict[str, Any]
    roles: frozenset[str]
    run: Callable[..., Any]

    def schema(self) -> dict[str, Any]:
        return {
            "type": "function",
            "function": {"name": self.name, "description": self.description, "parameters": self.parameters},
        }


def pick(row: dict[str, Any] | None, *keys: str) -> dict[str, Any]:
    row = row or {}
    return {key: row[key] for key in keys if row.get(key) not in (None, "", [])}


def short(text: Any) -> str:
    return str(text or "")[:OTHER_PEOPLE_TEXT]


def no_arguments() -> dict[str, Any]:
    return {"type": "object", "properties": {}, "additionalProperties": False}


def project_argument(required: bool) -> dict[str, Any]:
    schema = {
        "type": "object",
        "properties": {
            "project_id": {"type": "string", "description": "id of one of the user's projects (my_projects)"}
        },
        "additionalProperties": False,
    }
    if required:
        schema["required"] = ["project_id"]
    return schema


class ToolRefusedError(Exception):
    """A tool call the user may not make (the message is shown to the AI)."""


def own_project(context: ToolContext, project_id: Any) -> Project:
    """One of the user's OWN projects, else refused: another user's id gets nothing. Own
    means: the House Owner's project, the project awarded to the Builder, or a project the
    Site Engineer is actively assigned to (the same tests the project screens use)."""
    from app.modules.projects.access import contractor_has_project_access, engineer_has_project_access

    try:
        parsed = uuid.UUID(str(project_id))
    except (TypeError, ValueError):
        raise ToolRefusedError("That is not a project id. Use an id from the user's project list.") from None
    project = context.database.get(Project, parsed)
    user = context.user
    mine = (
        project is not None
        and user is not None
        and (
            (context.role == OWNER and project.owner_id == user.id)
            or (
                context.role == BUILDER
                and (
                    project.contractor_id == user.id or contractor_has_project_access(context.database, parsed, user.id)
                )
            )
            or (context.role == SITE_ENGINEER and engineer_has_project_access(context.database, parsed, user.id))
        )
    )
    if not mine:
        raise ToolRefusedError("That project is not one of the user's projects.")
    return project  # type: ignore[return-value]


# ------------------------------------------------------------------ everyone


def help_search(context: ToolContext, question: str = "") -> dict[str, Any]:
    cards = context.knowledge.search(context.role, str(question)[:300])
    context.cards_seen.extend(cards)
    return {
        "cards": [
            {"id": card.id, "title": card.title, "text": card.body, "pages": [label for label, _path in card.buttons]}
            for card in cards
        ]
        or "No help card matches. Say you are not sure and offer Contact support."
    }


FLOOR_TYPES = ["G", "G+1", "G+2", "G+3", "G-1", "G-2", "G-3", "DUPLEX", "MANSION"]


def estimate_cost(
    context: ToolContext,
    plot_area: float = 0,
    floor_type: str = "",
    finishing_type: str = "",
    building_type: str = "RESIDENTIAL",
    pincode: str = "",
) -> dict[str, Any]:
    from app.modules.content import estimate_service
    from app.modules.content.schemas import EstimateCreate

    code = "".join(ch for ch in str(pincode or "") if ch.isdigit())
    if not code and context.user is not None:
        code = "".join(ch for ch in str(context.user.pincode or "") if ch.isdigit())
    if len(code) != 6:
        raise ToolRefusedError("A 6-digit pincode is needed for the estimate: ask the user for it.")
    if str(floor_type).upper() not in FLOOR_TYPES:
        raise ToolRefusedError(f"floor_type must be one of {FLOOR_TYPES}: ask the user.")
    payload = EstimateCreate(
        country="India",
        location=code,
        pincode=code,
        plot_area=float(plot_area or 0),
        floor_type=str(floor_type).upper(),
        construction_type="CONTRACTOR",
        building_type=str(building_type or "RESIDENTIAL").upper(),
        finishing_type=str(finishing_type or "").lower(),
    )
    result = estimate_service.estimate_calculation(payload)
    return pick(
        result,
        "currency", "plot_area", "floors", "floor_type", "built_up_area", "rate_per_sqft", "estimated_cost",
        "estimated_range_low", "estimated_range_high", "material_estimate", "labour_estimate", "other_estimate",
        "disclaimer",
    )  # fmt: skip


# ------------------------------------------------------------------ the owner's own records


def my_profile(context: ToolContext) -> dict[str, Any]:
    user = context.user
    return pick(
        {
            "name": user.name,
            "role": ROLE_LABELS.get(context.role, context.role),
            "city": user.location,
            "pincode": user.pincode,
            "country": user.country_code,
        },
        "name", "role", "city", "pincode", "country",
    )  # fmt: skip


def my_notifications(context: ToolContext, unread_only: bool = False) -> dict[str, Any]:
    from app.modules.messaging.notifications import NotificationService

    rows = NotificationService(context.database).fetch_user_notifications(user=context.user)
    rows = [row for row in rows if not unread_only or not row.get("is_read")]
    return {
        "total": len(rows),
        "notifications": [
            {**pick(row, "category", "is_read", "created_at"), "title": short(row.get("title"))}
            for row in rows[:MAX_ROWS]
        ],
    }


def my_conversations(context: ToolContext) -> dict[str, Any]:
    from app.modules.messaging.service import MessageService

    rows = MessageService(context.database).fetch_conversations(user=context.user)
    return {
        "conversations": [
            {
                "with": short((row.get("participant") or {}).get("primary_name") or row.get("title")),
                "their_role": (row.get("participant") or {}).get("role"),
                "unread_messages": row.get("unread_count", 0),
                "last_message_at": row.get("latest_message_at"),
            }
            for row in rows[:MAX_ROWS]
        ]
    }


def my_projects(context: ToolContext) -> dict[str, Any]:
    from app.modules.projects.project_repository import ProjectRepository
    from app.modules.projects.project_service import ProjectService

    rows = ProjectService(ProjectRepository(context.database)).fetch_owner_projects(user=context.user)
    projects = []
    for row in rows[:MAX_ROWS]:
        item = pick(
            row,
            "id", "title", "status", "construction_type", "building_type", "floor_type", "floors", "project_city",
            "pincode", "budget", "land_area", "completion_percentage", "schedule_status", "start_date", "end_date",
            "contract_amount", "contract_status",
        )  # fmt: skip
        if (row.get("contractor") or {}).get("name"):
            item["builder"] = row["contractor"]["name"]
        stages = [pick(stage, "name", "amount", "status") for stage in row.get("escrow_milestones") or []]
        if stages:
            item["escrow_stages_planning_only"] = stages
        projects.append(item)
    return {"total": len(rows), "projects": projects}


def my_project_requests(context: ToolContext, project_id: str = "") -> dict[str, Any]:
    from app.modules.projects.request_repository import ProjectRequestRepository
    from app.modules.projects.request_service import ProjectRequestService

    wanted = str(own_project(context, project_id).id) if project_id else None
    rows = ProjectRequestService(ProjectRequestRepository(context.database)).fetch_incoming_requests(user=context.user)
    requests = []
    for row in rows:
        if not row.get("project_id") or (wanted and str(row.get("project_id")) != wanted):
            continue
        requests.append(
            {
                **pick(row, "project_title", "request_type", "status", "quotation_amount", "created_at"),
                "direction": "sent" if row.get("is_sender") else "received",
                "other_party": short(row.get("profile_name")),
                "other_party_role": row.get("profile_role"),
            }
        )
    return {"total": len(requests), "requests": requests[:MAX_ROWS]}


def my_award(context: ToolContext, project_id: str = "") -> dict[str, Any]:
    from app.modules.projects.award_repository import AwardRepository
    from app.modules.projects.award_service import AwardService

    project = own_project(context, project_id)
    answer = AwardService(AwardRepository(context.database)).fetch_project_award(
        project_id=project.id, request_id=None, user=context.user
    )
    award = (answer or {}).get("award")
    if not award:
        return {"award": None, "note": "No builder has been chosen for this project yet."}
    item = pick(
        award,
        "project_title", "builder_name", "status", "phase", "original_budget", "original_quotation", "agreed_amount",
        "contract_amount", "created_at", "confirmed_at",
    )  # fmt: skip
    offer = award.get("open_offer") or {}
    if offer:
        item["open_offer"] = pick(offer, "amount", "status", "created_at")
    return {"award": item}


def my_material_orders(context: ToolContext, project_id: str = "") -> dict[str, Any]:
    from app.modules.marketplace.order_service import MaterialRequestService

    wanted = own_project(context, project_id).id if project_id else None
    rows = MaterialRequestService(context.database).fetch_my_material_requests(user=context.user, project_id=wanted)
    orders = [
        {
            **pick(row, "project_name", "supplier_name", "material_name", "quantity", "unit", "price", "status",
                   "created_at", "fulfilled_at"),
            "order_code": str(row.get("request_code") or "")[:8].upper(),
        }
        for row in rows
    ]  # fmt: skip
    return {"total": len(orders), "orders": orders[:MAX_ROWS]}


def my_property_listings(context: ToolContext) -> dict[str, Any]:
    from app.modules.property.service import PropertyListingService

    rows = PropertyListingService(context.database).fetch_my_property_listings(status_filter=None, user=context.user)
    listings = [
        pick(row, "title", "property_type", "listing_type", "city", "price", "is_negotiable", "status", "listed_at")
        for row in rows
    ]
    return {"total": len(listings), "listings": listings[:MAX_ROWS]}


def project_updates(context: ToolContext, project_id: str = "") -> dict[str, Any]:
    from app.modules.projects.project_repository import ProjectRepository
    from app.modules.projects.project_service import ProjectService

    project = own_project(context, project_id)
    rows = ProjectService(ProjectRepository(context.database)).fetch_project_timeline_entries(
        project_id=project.id, user=context.user
    )
    updates = [
        {
            "title": short(row.get("title")),
            **pick(row, "date", "completion_status"),
            "posted_by": short(row.get("created_by_name")),
            "photos": len(row.get("images") or []),
        }
        for row in rows
    ]
    return {"project": project.title, "total": len(updates), "updates": updates[:MAX_ROWS]}


def project_engineer(context: ToolContext, project_id: str = "") -> dict[str, Any]:
    from app.modules.projects.team_repository import EngineerTeamRepository
    from app.modules.projects.team_service import EngineerTeamService

    project = own_project(context, project_id)
    answer = EngineerTeamService(EngineerTeamRepository(context.database)).fetch_project_engineer(
        project_id=project.id, user=context.user
    )
    engineer = (answer or {}).get("engineer")
    if not engineer:
        return {"engineer": None}
    return {"engineer": pick(engineer, "name", "specialization", "qualification", "experience_years", "rating")}


def project_store(context: ToolContext, project_id: str = "") -> dict[str, Any]:
    from app.modules.site_operations.store_service import store_payload

    project = own_project(context, project_id)
    answer = store_payload(context.database, project.id, context.user)
    items = [
        pick(item, "name", "brand", "size", "unit", "in_stock", "received_total", "used_total", "stock_status")
        for item in answer.get("items", [])
    ]
    return {"project": project.title, "materials": items[:MAX_ROWS], "total": len(items)}


# ------------------------------------------------------------------ the directory the owner's screens show


def find_builders(context: ToolContext, project_id: str = "") -> dict[str, Any]:
    from app.modules.marketplace.discovery_service import MarketplaceService

    wanted = own_project(context, project_id).id if project_id else None
    rows = MarketplaceService(context.database).fetch_nearby_contractors(
        pincode=None, country=None, project_id=wanted, user=context.user
    )
    builders = [
        {
            **pick(row, "company_name", "experience_years", "completed_projects", "rating", "review_count",
                   "is_verified", "services_offered"),
            "name": short(row.get("name")),
        }
        for row in rows
    ]  # fmt: skip
    return {"total": len(builders), "builders": builders[:MAX_ROWS], "near": "the user's project or profile pincode"}


def find_suppliers(context: ToolContext, project_id: str = "") -> dict[str, Any]:
    from app.modules.marketplace.discovery_service import MarketplaceService

    wanted = own_project(context, project_id).id if project_id else None
    rows = MarketplaceService(context.database).fetch_nearby_suppliers(
        pincode=None, country=None, project_id=wanted, user=context.user
    )
    suppliers = [
        {
            "store_name": short(row.get("store_name") or row.get("name")),
            **pick(row, "categories", "rating", "request_status"),
            "products": len(row.get("products") or []),
        }
        for row in rows
    ]
    return {"total": len(suppliers), "suppliers": suppliers[:MAX_ROWS]}


def browse_products(context: ToolContext, search: str = "") -> dict[str, Any]:
    from app.modules.catalog.catalog_service import CatalogService

    rows = CatalogService(context.database).list_products(
        None, None, None, str(search)[:100] or None, MAX_ROWS, context.user
    )
    return {"products": [pick(row, "name", "brand_name", "category_name", "subcategory_name", "unit") for row in rows]}


def properties_for_sale(
    context: ToolContext, city: str = "", property_type: str = "", max_price: float | None = None
) -> dict[str, Any]:
    from app.modules.property.service import PropertyListingService

    answer = PropertyListingService(context.database).browse_property_listings(
        search=None,
        property_type=str(property_type) or None,
        listing_type=None,
        pincode=None,
        city=str(city) or None,
        min_price=None,
        max_price=float(max_price) if max_price else None,
        bedrooms=None,
        user=context.user,
    )
    rows = (answer or {}).get("listings", [])
    listings = [
        pick(row, "title", "property_type", "listing_type", "city", "state", "price", "is_negotiable", "bedrooms",
             "bathrooms", "built_up_area", "land_area", "furnishing", "age_years", "listed_at")
        for row in rows
    ]  # fmt: skip
    return {"total": len(listings), "listings": listings[:MAX_ROWS]}


# ------------------------------------------------------------------ the Builder


def builder_requests(context: ToolContext, sent: bool) -> dict[str, Any]:
    from app.modules.projects.request_repository import ProjectRequestRepository
    from app.modules.projects.request_service import ProjectRequestService

    rows = ProjectRequestService(ProjectRequestRepository(context.database)).fetch_incoming_requests(user=context.user)
    chosen = [row for row in rows if bool(row.get("is_sender")) == sent and row.get("project_id")]
    requests = [
        {
            **pick(row, "project_title", "request_type", "status", "quotation_amount", "building_type",
                   "construction_type", "budget", "created_at"),
            "other_party": short(row.get("profile_name")),
            "other_party_role": row.get("profile_role"),
        }
        for row in chosen
    ]  # fmt: skip
    return {"total": len(requests), "requests": requests[:MAX_ROWS]}


def incoming_requests(context: ToolContext) -> dict[str, Any]:
    return builder_requests(context, sent=False)


def sent_requests(context: ToolContext) -> dict[str, Any]:
    return builder_requests(context, sent=True)


def my_engineers(context: ToolContext) -> dict[str, Any]:
    from app.modules.projects.team_repository import EngineerTeamRepository
    from app.modules.projects.team_service import EngineerTeamService

    team = EngineerTeamService(EngineerTeamRepository(context.database)).fetch_engineer_team(user=context.user) or {}
    engineers = [
        {
            **pick(row, "specialization", "qualification", "experience_years", "rating", "project_count",
                   "working_on_project"),
            "name": short(row.get("name")),
            "projects": [
                short(item.get("title") or item.get("project_title")) for item in row.get("assigned_projects") or []
            ],
        }
        for row in team.get("active") or []
    ]  # fmt: skip
    return {
        "engineers": engineers[:MAX_ROWS],
        "pending_join_requests": len(team.get("pending_requests") or []),
        "open_invitations": len(team.get("invitations") or []),
    }


def my_suppliers(context: ToolContext) -> dict[str, Any]:
    from app.modules.projects.supplier_repository import ProjectSupplierRepository
    from app.modules.projects.supplier_service import ProjectSupplierService

    rows = ProjectSupplierService(ProjectSupplierRepository(context.database)).fetch_contractor_accepted_suppliers(
        user=context.user
    )
    suppliers = [
        {
            "store_name": short(row.get("store_name") or row.get("name")),
            **pick(row, "supplier_category", "categories", "rating"),
            "projects": [short(item.get("project_title")) for item in row.get("assigned_projects") or []],
        }
        for row in rows
    ]
    return {"total": len(suppliers), "suppliers": suppliers[:MAX_ROWS]}


def project_cost_summary(context: ToolContext, project_id: str = "") -> dict[str, Any]:
    """Totals only: no worker names, no payment parties."""
    from app.modules.site_operations.repository import DailyCostRepository
    from app.modules.site_operations.service import DailyCostService

    project = own_project(context, project_id)
    summary = DailyCostService(DailyCostRepository(context.database)).fetch_cost_tool_summary(
        project_id=project.id, work_date=None, user=context.user
    )
    totals = pick(
        summary.get("dashboard") or {},
        "labour_cost", "material_cost", "machinery_cost", "expenses", "spent_budget", "estimated_budget",
        "remaining_budget", "budget_progress", "budget_used_percent",
    )  # fmt: skip
    return {"project": project.title, "totals": totals, "daily_records": len(summary.get("registers") or [])}


def find_clients(context: ToolContext) -> dict[str, Any]:
    from app.modules.marketplace.discovery_service import MarketplaceService

    rows = MarketplaceService(context.database).fetch_nearby_projects(country=None, user=context.user)
    clients = [
        {
            "title": short(row.get("title") or row.get("store_name")),
            "name": short(row.get("name")),
            **pick(row, "client_type", "supplier_category", "rating", "created_at"),
        }
        for row in rows
    ]
    return {"total": len(clients), "clients": clients[:MAX_ROWS], "near": "the user's pincode"}


# ------------------------------------------------------------------ the Site Engineer (and other engineers)


def my_assigned_projects(context: ToolContext) -> dict[str, Any]:
    from app.modules.projects.team_repository import EngineerTeamRepository
    from app.modules.projects.team_service import EngineerTeamService

    rows = EngineerTeamService(EngineerTeamRepository(context.database)).fetch_engineer_projects(user=context.user)
    projects = [
        pick(row, "id", "title", "status", "building_type", "construction_type", "contractor_name", "company_name",
             "owner_name", "completion_percentage", "schedule_status", "start_date", "end_date", "assigned_at")
        for row in rows
    ]  # fmt: skip
    return {"total": len(projects), "projects": projects[:MAX_ROWS]}


def my_orders(context: ToolContext) -> dict[str, Any]:
    from app.modules.marketplace.models import PurchaseOrder
    from app.modules.marketplace.purchase_router import operational_orders, operational_payload

    statement = (
        operational_orders()
        .where(PurchaseOrder.buyer_id == context.user.id)  # type: ignore[union-attr]
        .order_by(PurchaseOrder.created_at.desc(), PurchaseOrder.id.desc())
    )
    orders = []
    for order in context.database.scalars(statement):
        row = operational_payload(context.database, order)
        orders.append(
            {
                "order_number": str(row.get("order_number") or "")[:8].upper(),
                **pick(row, "project_name", "supplier_name", "status", "estimated_amount", "created_at"),
                "items": [pick(item, "name", "quantity", "unit", "status") for item in row.get("items") or []][:5],
            }
        )
    return {"total": len(orders), "orders": orders[:MAX_ROWS]}


def my_daily_records(context: ToolContext, project_id: str = "") -> dict[str, Any]:
    """Dates and status only."""
    from app.modules.site_operations.repository import DailyCostRepository
    from app.modules.site_operations.service import DailyCostService

    project = own_project(context, project_id)
    summary = DailyCostService(DailyCostRepository(context.database)).fetch_cost_tool_summary(
        project_id=project.id, work_date=None, user=context.user
    )
    records = [
        pick(row, "work_date", "status", "work_type", "floor", "block") for row in summary.get("registers") or []
    ]
    return {"project": project.title, "total": len(records), "records": records[:MAX_ROWS]}


def opportunities(context: ToolContext) -> dict[str, Any]:
    from app.modules.projects.team_repository import EngineerTeamRepository
    from app.modules.projects.team_service import EngineerTeamService

    rows = EngineerTeamService(EngineerTeamRepository(context.database)).fetch_engineer_opportunities(
        country=None, user=context.user
    )
    found = [
        {
            "title": short(row.get("title")),
            **pick(row, "building_type", "construction_type", "budget", "status", "contractor_name", "company_name"),
        }
        for row in rows
    ]
    return {"total": len(found), "opportunities": found[:MAX_ROWS]}


# ------------------------------------------------------------------ the Supplier


def my_listings(context: ToolContext) -> dict[str, Any]:
    from app.modules.marketplace.listing_service import SupplierProductService

    rows = SupplierProductService(context.database).fetch_supplier_products(user=context.user)
    listings = [
        pick(row, "name", "brand", "size", "unit", "price", "discounted_price", "quantity", "low_stock_threshold",
             "stock_status", "is_published")
        for row in rows
    ]  # fmt: skip
    low = [row["name"] for row in listings if str(row.get("stock_status", "")).upper() in ("LOW_STOCK", "OUT_OF_STOCK")]
    return {"total": len(listings), "low_or_out_of_stock": low[:MAX_ROWS], "listings": listings[:MAX_ROWS]}


def incoming_orders(context: ToolContext, status: str = "") -> dict[str, Any]:
    """The supplier's incoming work, by category: material orders, labour or equipment requests."""
    wanted = str(status or "").upper()
    if context.role == SUPPLIER_LABOUR:
        from app.modules.labour_supply.service import LaborSupplyService

        rows = LaborSupplyService(context.database).list_supplier_labor_requests(status=None, user=context.user)
        items = [
            {**pick(row, "trade", "status", "workers_required", "workers_allocated", "start_date", "end_date"),
             "project": short(row.get("project_title")), "builder": short(row.get("contractor_name"))}
            for row in rows
        ]  # fmt: skip
    elif context.role == SUPPLIER_EQUIPMENT:
        from app.modules.equipment_supply.service import EquipmentSupplyService

        rows = EquipmentSupplyService(context.database).list_supplier_equipment_requests(status=None, user=context.user)
        items = [
            {**pick(row, "item_name", "item_category", "request_kind", "quantity", "status", "start_date", "end_date"),
             "project": short(row.get("project_title")), "builder": short(row.get("contractor_name"))}
            for row in rows
        ]  # fmt: skip
    else:
        from app.modules.marketplace.order_service import MaterialRequestService

        rows = MaterialRequestService(context.database).fetch_supplier_material_requests(user=context.user)
        grouped: dict[str, dict[str, Any]] = {}
        for row in rows:
            order = grouped.setdefault(
                str(row.get("request_code") or row.get("id")),
                {"order_code": str(row.get("request_code") or "")[:8].upper(), "buyer": short(row.get("engineer_name")),
                 "project": short(row.get("project_name")), "statuses": set(), "lines": 0, "total": 0.0,
                 "created_at": row.get("created_at")},
            )  # fmt: skip
            order["statuses"].add(row.get("status"))
            order["lines"] += 1
            order["total"] += float(row.get("price") or 0) * float(row.get("quantity") or 0)
        items = []
        for order in grouped.values():
            statuses = order.pop("statuses")
            order["status"] = (
                "PENDING" if "PENDING" in statuses else (statuses.pop() if len(statuses) == 1 else "MIXED")
            )
            items.append(order)
    if wanted:
        items = [item for item in items if str(item.get("status", "")).upper() == wanted]
    pending = sum(1 for item in items if str(item.get("status", "")).upper() == "PENDING")
    return {"total": len(items), "pending": pending, "orders": items[:MAX_ROWS]}


def my_labour_services(context: ToolContext) -> dict[str, Any]:
    from app.modules.labour_supply.service import LaborSupplyService

    rows = LaborSupplyService(context.database).list_labor_services(user=context.user)
    services = [
        pick(row, "trade", "skill_level", "worker_capacity", "available_workers", "allocated_workers", "is_active")
        for row in rows
    ]
    return {"total": len(services), "services": services[:MAX_ROWS]}


def my_equipment(context: ToolContext) -> dict[str, Any]:
    from app.modules.equipment_supply.service import EquipmentSupplyService

    rows = EquipmentSupplyService(context.database).list_equipment_items(user=context.user)
    items = [
        pick(row, "name", "category", "brand", "model", "condition", "quantity_total", "mode", "hourly_rate",
             "daily_rate", "weekly_rate", "monthly_rate", "sale_price", "available_to_rent", "available_to_buy",
             "is_active")
        for row in rows
    ]  # fmt: skip
    return {"total": len(items), "equipment": items[:MAX_ROWS]}


def my_clients(context: ToolContext) -> dict[str, Any]:
    from app.modules.projects.supplier_repository import ProjectSupplierRepository
    from app.modules.projects.supplier_service import ProjectSupplierService

    rows = ProjectSupplierService(ProjectSupplierRepository(context.database)).fetch_supplier_my_projects(
        user=context.user
    )
    clients = [
        {
            "project": short(row.get("title")),
            "client": short(row.get("requester") or row.get("name")),
            **pick(row, "role", "company_name", "status", "assigned_on"),
        }
        for row in rows
    ]
    return {"total": len(clients), "clients": clients[:MAX_ROWS]}


# ------------------------------------------------------------------ the Administrator


def admin_counts(context: ToolContext) -> dict[str, Any]:
    """The overview counts this administrator's permissions already allow; never a person."""
    from app.modules.admin import overview_service
    from app.modules.admin.admin_identity import active_admin_identity

    admin = active_admin_identity(context.database, context.user)  # type: ignore[arg-type]
    if admin is None:
        raise ToolRefusedError("This account has no active administrator profile.")
    overview = overview_service.fetch_overview(context.database, admin, None) or {}
    counts = {key: value for key, value in (overview.get("attention") or {}).items() if isinstance(value, int)}
    countries = [
        {key: value for key, value in row.items() if key in ("country", "accounts", "projects", "open_reports")}
        for row in overview.get("countries") or []
        if isinstance(row, dict)
    ]
    return {"scope": overview.get("scope"), "attention": counts, "by_country": countries[:MAX_ROWS]}


EVERYONE = frozenset({GUEST, *SIGNED_IN})
OWNERS = frozenset({OWNER})
PROJECT_HOLDERS = frozenset({OWNER, BUILDER})
STORE_READERS = frozenset({OWNER, BUILDER, SITE_ENGINEER})
BUILDERS = frozenset({BUILDER})
SITE_ENGINEERS = frozenset({SITE_ENGINEER})
ENGINEERS = frozenset({SITE_ENGINEER, ENGINEER})

TOOLS: dict[str, Tool] = {
    tool.name: tool
    for tool in [
        Tool(
            "help_search",
            "Search CREWNBUILD's help cards: how to use the app, steps, rules. Use it for every how-to question.",
            {
                "type": "object",
                "properties": {"question": {"type": "string", "description": "the user's question, in English"}},
                "required": ["question"],
                "additionalProperties": False,
            },
            EVERYONE | {ADMIN},
            help_search,
        ),
        Tool(
            "estimate_cost",
            "Construction cost estimate (the app's own calculator). Ask for any input the user has not given.",
            {
                "type": "object",
                "properties": {
                    "plot_area": {"type": "number", "description": "built area per floor in sq.ft"},
                    "floor_type": {"type": "string", "enum": FLOOR_TYPES},
                    "finishing_type": {"type": "string", "enum": ["standard", "premium"]},
                    "building_type": {"type": "string", "enum": ["RESIDENTIAL", "COMMERCIAL"]},
                    "pincode": {"type": "string", "description": "6-digit pincode; empty = the user's own"},
                },
                "required": ["plot_area", "floor_type", "finishing_type"],
                "additionalProperties": False,
            },
            EVERYONE,
            estimate_cost,
        ),
        Tool(
            "my_profile", "The user's own name, role, city, pincode and country.", no_arguments(), SIGNED_IN, my_profile
        ),
        Tool(
            "my_notifications",
            "The user's latest notifications (title, category, read or not).",
            {"type": "object", "properties": {"unread_only": {"type": "boolean"}}, "additionalProperties": False},
            SIGNED_IN,
            my_notifications,
        ),
        Tool(
            "my_conversations",
            "Who the user is chatting with and how many messages are unread (no message text).",
            no_arguments(),
            SIGNED_IN,
            my_conversations,
        ),
        Tool(
            "my_projects",
            "The user's own projects (a Builder's: the ones awarded to them) with ids, status, budget and progress.",
            no_arguments(),
            PROJECT_HOLDERS,
            my_projects,
        ),
        Tool(
            "my_project_requests",
            "Requests and quotations the user sent or received for their projects.",
            project_argument(False),
            OWNERS,
            my_project_requests,
        ),
        Tool(
            "my_award",
            "The builder chosen for one of the user's projects: quotation, agreed and contract amounts.",
            project_argument(True),
            OWNERS,
            my_award,
        ),
        Tool(
            "my_material_orders",
            "The user's material buy requests and their status.",
            project_argument(False),
            OWNERS,
            my_material_orders,
        ),
        Tool("my_property_listings", "The user's own property listings.", no_arguments(), OWNERS, my_property_listings),
        Tool(
            "project_updates",
            "Site updates posted on one of the user's projects.",
            project_argument(True),
            OWNERS,
            project_updates,
        ),
        Tool(
            "project_engineer",
            "The site engineer assigned to one of the user's projects (name and experience only).",
            project_argument(True),
            OWNERS,
            project_engineer,
        ),
        Tool(
            "project_store",
            "Materials in stock on one of the user's projects (quantities only).",
            project_argument(True),
            STORE_READERS,
            project_store,
        ),
        Tool(
            "find_builders",
            "Builders near the user's project or pincode, with rating and experience.",
            project_argument(False),
            OWNERS,
            find_builders,
        ),
        Tool(
            "find_suppliers",
            "Material suppliers near the user's project or pincode.",
            project_argument(False),
            OWNERS,
            find_suppliers,
        ),
        Tool(
            "browse_products",
            "Construction products in the catalog (names, brands, categories).",
            {"type": "object", "properties": {"search": {"type": "string"}}, "additionalProperties": False},
            OWNERS,
            browse_products,
        ),
        Tool(
            "properties_for_sale",
            "Published properties for sale or rent near the user (never the user's own).",
            {
                "type": "object",
                "properties": {
                    "city": {"type": "string"},
                    "property_type": {"type": "string"},
                    "max_price": {"type": "number"},
                },
                "additionalProperties": False,
            },
            OWNERS,
            properties_for_sale,
        ),
        Tool(
            "incoming_requests",
            "Requests the Builder received (from owners and others).",
            no_arguments(),
            BUILDERS,
            incoming_requests,
        ),
        Tool("sent_requests", "Requests the Builder sent.", no_arguments(), BUILDERS, sent_requests),
        Tool(
            "my_engineers",
            "The Builder's site engineer team (names, experience, projects).",
            no_arguments(),
            BUILDERS,
            my_engineers,
        ),
        Tool("my_suppliers", "The suppliers the Builder works with.", no_arguments(), BUILDERS, my_suppliers),
        Tool(
            "project_cost_summary",
            "Cost totals of one of the Builder's projects (labour, material, budget).",
            project_argument(True),
            BUILDERS,
            project_cost_summary,
        ),
        Tool("find_clients", "Open projects and clients near the Builder.", no_arguments(), BUILDERS, find_clients),
        Tool(
            "my_assigned_projects",
            "The projects the engineer is assigned to, with their ids.",
            no_arguments(),
            SITE_ENGINEERS,
            my_assigned_projects,
        ),
        Tool(
            "my_orders",
            "The Site Engineer's material orders and their status.",
            no_arguments(),
            SITE_ENGINEERS,
            my_orders,
        ),
        Tool(
            "my_daily_records",
            "Daily site records of one assigned project (dates and status).",
            project_argument(True),
            SITE_ENGINEERS,
            my_daily_records,
        ),
        Tool("opportunities", "Projects and builders looking for engineers.", no_arguments(), ENGINEERS, opportunities),
        Tool(
            "my_listings",
            "The supplier's own product listings with stock (low stock flagged).",
            no_arguments(),
            frozenset({SUPPLIER_MATERIAL}),
            my_listings,
        ),
        Tool(
            "incoming_orders",
            "Orders or requests the supplier received (material orders, labour or equipment requests).",
            {"type": "object", "properties": {"status": {"type": "string"}}, "additionalProperties": False},
            frozenset({SUPPLIER_MATERIAL, SUPPLIER_LABOUR, SUPPLIER_EQUIPMENT}),
            incoming_orders,
        ),
        Tool(
            "my_labour_services",
            "The Labor Supplier's services (trades, workers available).",
            no_arguments(),
            frozenset({SUPPLIER_LABOUR}),
            my_labour_services,
        ),
        Tool(
            "my_equipment",
            "The Equipment Supplier's equipment and rates.",
            no_arguments(),
            frozenset({SUPPLIER_EQUIPMENT}),
            my_equipment,
        ),
        Tool("my_clients", "The projects and clients the supplier works for.", no_arguments(), SUPPLIERS, my_clients),
        Tool(
            "admin_counts",
            "Overview counts this administrator may see (no names, no lists of people).",
            no_arguments(),
            frozenset({ADMIN}),
            admin_counts,
        ),
    ]
}


def tools_for(role: str) -> list[Tool]:
    return [tool for tool in TOOLS.values() if role in tool.roles]


def run_tool(context: ToolContext, name: str, arguments: str) -> dict[str, Any]:
    """Runs one tool call for this user; the answer is always redacted and JSON-safe."""
    tool = TOOLS.get(name)
    if tool is None or context.role not in tool.roles:
        return {"error": f"There is no tool '{name}' for this user."}
    try:
        parsed = json.loads(arguments or "{}")
    except ValueError:
        return {"error": "The tool arguments were not valid JSON."}
    if not isinstance(parsed, dict):
        return {"error": "The tool arguments must be an object."}
    allowed = set((tool.parameters.get("properties") or {}).keys())
    parsed = {key: value for key, value in parsed.items() if key in allowed}
    context.tools_used.append(name)
    try:
        result = tool.run(context, **parsed)
    except ToolRefusedError as refusal:
        return {"error": str(refusal)}
    except HTTPException as error:
        # The service's own check said no (403 / 404): exactly what the screen would get.
        return {"error": "Not available to this user." if error.status_code in (401, 403, 404) else str(error.detail)}
    except (TypeError, ValueError) as error:
        return {"error": f"Bad arguments: {error}"}
    except Exception:
        logger.exception("assistant tool %s failed", name)
        context.database.rollback()
        return {"error": "That information could not be read right now."}
    return json.loads(json.dumps(redact(result), default=str))

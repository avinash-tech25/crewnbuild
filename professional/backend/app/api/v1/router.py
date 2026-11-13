"""Every route of the Professional API, mounted under /api/v1 by app.main.

Registration order is significant: a request is answered by the first route whose path
and method match (SRS AR-03, CONNECTIONS.md R13). Module routers are listed in
MODULE_ROUTERS in the same order as the old app/main.py `module_routers` (identity was
auth_routes, accounts was account_routes), and that order must not be rearranged.

Each module router is mounted with enforce_route_access: a route needs a live session
unless it is in app/auth/public_routes.py (AZ-01).
"""

from fastapi import APIRouter, Depends

from app.auth.dependencies import enforce_route_access
from app.modules.accounts.router import router as accounts_router
from app.modules.admin.router import router as admin_router
from app.modules.admin.router import staff_router as admin_staff_router
from app.modules.catalog.router import admin_router as admin_catalog_router
from app.modules.catalog.router import router as catalog_router
from app.modules.content.router import router as content_router
from app.modules.content.vastu.router import router as vastu_router
from app.modules.equipment_supply.router import router as equipment_supply_router
from app.modules.files.router import router as files_router
from app.modules.identity.router import router as identity_router
from app.modules.labour_supply.router import router as labour_supply_router
from app.modules.marketplace.router import router as marketplace_router
from app.modules.messaging.router import router as messaging_router
from app.modules.messaging.router import websocket_router as messaging_websocket_router
from app.modules.projects.router import router as projects_router
from app.modules.property.router import router as property_router
from app.modules.site_operations.router import router as site_operations_router
from app.modules.store.router import router as store_router
from app.modules.support.router import router as support_router
from app.modules.weather.router import router as weather_router

api_router = APIRouter()


@api_router.get("/health", tags=["health"])
def health_check() -> dict[str, str]:
    """Process health, as before: {"status": "ok"}."""
    return {"status": "ok"}


MODULE_ROUTERS: list[APIRouter] = [
    # The old app registered the admin console first; every /admin path is its own.
    admin_router,
    # Admin > Master Catalog, then the signed-in catalog reader, as before.
    admin_catalog_router,
    catalog_router,
    identity_router,
    accounts_router,
    # Notifications and messages, where the old app registered them (before projects).
    messaging_router,
    # Projects, requests, awards, teams and supplier assignments, where the old app
    # registered them (after notifications and messages, which are not ported yet).
    projects_router,
    # The daily record, the cost tool and the owner's analysis (old daily_cost_routes).
    site_operations_router,
    # Discovery, a supplier's listings, purchase orders, the cart and the shop (old
    # marketplace, supplier_product, material_request and shop routes, in that order).
    marketplace_router,
    # Property listings and enquiries (old property_routes, after the shop routes).
    property_router,
    # The old order put the file routes after property and estimates.
    files_router,
    # Reports, contact and support, in the old order, with the admin deleted-accounts
    # and support-ticket screens where the old app registered them.
    support_router,
    admin_staff_router,
    # Estimates, ads and translation; then Vastu.
    content_router,
    vastu_router,
    # Labour supply, where the old app registered it (after payments, which are not
    # ported yet).
    labour_supply_router,
    equipment_supply_router,
    # The Store Manager, the Site Engineer's store requests and Builder <-> Store
    # Manager requests (old store_manager_routes, after equipment).
    store_router,
    # Every /weather path is new, so it shadows nothing registered above.
    weather_router,
]

for module_router in MODULE_ROUTERS:
    api_router.include_router(module_router, dependencies=[Depends(enforce_route_access)])

# The chat and live-events sockets sign in at their own handshake (session cookie and
# an allowed Origin, messaging/websocket_service.py): a route dependency reads an HTTP
# request, which a websocket is not.
api_router.include_router(messaging_websocket_router)

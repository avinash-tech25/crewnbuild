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
from app.modules.content.router import router as content_router
from app.modules.content.vastu.router import router as vastu_router
from app.modules.files.router import router as files_router
from app.modules.identity.router import router as identity_router
from app.modules.support.router import router as support_router
from app.modules.weather.router import router as weather_router

api_router = APIRouter()


@api_router.get("/health", tags=["health"])
def health_check() -> dict[str, str]:
    """Process health, as before: {"status": "ok"}."""
    return {"status": "ok"}


MODULE_ROUTERS: list[APIRouter] = [
    identity_router,
    accounts_router,
    # The old order put the file routes after property and estimates.
    files_router,
    # Reports, contact and support, in the old order.
    support_router,
    # Estimates, ads and translation; then Vastu.
    content_router,
    vastu_router,
    # Every /weather path is new, so it shadows nothing registered above.
    weather_router,
]

for module_router in MODULE_ROUTERS:
    api_router.include_router(module_router, dependencies=[Depends(enforce_route_access)])

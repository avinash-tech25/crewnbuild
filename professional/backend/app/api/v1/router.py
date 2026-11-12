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
from app.modules.identity.router import router as identity_router

api_router = APIRouter()


@api_router.get("/health", tags=["health"])
def health_check() -> dict[str, str]:
    """Process health, as before: {"status": "ok"}."""
    return {"status": "ok"}


MODULE_ROUTERS: list[APIRouter] = [
    identity_router,
    accounts_router,
]

for module_router in MODULE_ROUTERS:
    api_router.include_router(module_router, dependencies=[Depends(enforce_route_access)])

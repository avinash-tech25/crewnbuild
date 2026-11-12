"""Every route of the Professional API, mounted under /api/v1 by app.main.

Registration order is significant: a request is answered by the first route whose path
and method match (SRS AR-03, CONNECTIONS.md R13). Module routers are added to
MODULE_ROUTERS in step R4b in the same order as the old app/main.py `module_routers`,
and that order must not be rearranged.
"""

from fastapi import APIRouter

api_router = APIRouter()


@api_router.get("/health", tags=["health"])
def health_check() -> dict[str, str]:
    """Process health, as before: {"status": "ok"}."""
    return {"status": "ok"}


MODULE_ROUTERS: list[APIRouter] = []

for module_router in MODULE_ROUTERS:
    api_router.include_router(module_router)

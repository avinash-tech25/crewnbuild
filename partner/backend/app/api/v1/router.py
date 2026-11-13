"""Every route of the Partner API, mounted under /api/v1 by app.main.

Registration order is significant: a request is answered by the first route whose path
and method match. Module routers are listed in the order of the old Partner app/main.py
`module_routers` (auth_routes, then technician routes, then requester routes); the
routers of part 2 join them in that order.

A route needs a session unless it is in app/auth/public_routes.py; each route checks its
own principal (technician or requester) through app/auth/dependencies.py.
"""

from fastapi import APIRouter

from app.api.v1.health import database_health
from app.modules.bookings.dispatch_router import router as dispatch_router
from app.modules.bookings.requester_router import router as booking_router
from app.modules.catalog.router import router as catalog_router
from app.modules.identity.router import router as identity_router
from app.modules.identity.router import technician_router
from app.modules.locations.router import router as locations_router
from app.modules.realtime.router import router as realtime_router
from app.modules.requesters.router import router as requester_router
from app.modules.technicians.onboarding_router import router as onboarding_router
from app.modules.technicians.router import router as technicians_router
from app.modules.tracking.router import router as tracking_router
from app.modules.weather.router import public_router as public_weather_router
from app.modules.weather.router import router as weather_router

api_router = APIRouter()


@api_router.get("/health", tags=["health"])
def health_check() -> dict[str, str]:
    """Process health, as before: {"status": "ok", "application": "partner"}."""
    return {"status": "ok", "application": "partner"}


# Database reachability, migration head and missing tables (the old /health/db, NFR-13).
api_router.add_api_route("/health/db", database_health, methods=["GET"], tags=["health"])

MODULE_ROUTERS: list[APIRouter] = [
    identity_router,
    onboarding_router,
    locations_router,
    # The technician dashboard and jobs (old technician_routes, after the location routes),
    # with PUT /technicians/me/password from the identity module.
    technician_router,
    technicians_router,
    # The booking session, then the bookings (old requester_routes).
    requester_router,
    booking_router,
    catalog_router,
    dispatch_router,
    tracking_router,
    # The live websockets (old tracking and dispatch ws_router), after the HTTP routes.
    realtime_router,
    # Technician weather (/technicians/me/weather) and the public pages' weather; last,
    # so it changes no earlier match (as before).
    weather_router,
    public_weather_router,
]

for module_router in MODULE_ROUTERS:
    api_router.include_router(module_router)

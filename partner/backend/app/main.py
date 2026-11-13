"""create_app(): settings checks, logging, middleware, error handlers and routers.

Run in development with:  uvicorn app.main:app --reload --port 8200
"""

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.api.v1.router import api_router
from app.core.config import Settings, get_settings
from app.core.errors import register_error_handlers
from app.core.logging import configure_logging
from app.core.middleware import add_middleware
from app.core.runtime import use_settings
from app.core.security.csrf_protection import CsrfProtectionMiddleware
from app.modules.bookings.models import InvalidTransition

API_PREFIX = "/api/v1"

logger = logging.getLogger(__name__)


async def invalid_transition(request: Request, error: Exception) -> JSONResponse:
    """A booking state change the state machine does not allow: 409, never a 500 (as before)."""
    logger.warning("booking.invalid_transition path=%s", request.url.path)
    return JSONResponse(
        status_code=409,
        content={
            "detail": {
                "code": "INVALID_STATE_TRANSITION",
                "message": "That step is not possible for this booking right now.",
            }
        },
    )


def create_app(settings: Settings | None = None) -> FastAPI:
    # get_settings() runs every startup check and stops the process on an unsafe setting.
    settings = settings or get_settings()
    configure_logging(settings.debug)

    # The interactive docs and the OpenAPI schema are served only in development (API-09).
    docs: dict[str, str | None] = (
        {"docs_url": "/docs", "redoc_url": "/redoc", "openapi_url": "/openapi.json"}
        if settings.is_development()
        else {"docs_url": None, "redoc_url": None, "openapi_url": None}
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        # The realtime hub is bound to this process's event loop (and relays between
        # processes when REALTIME_CROSS_PROCESS), then this process's dispatch sweeper
        # starts (DISPATCH_WORKER_ENABLED), as the old app did at startup.
        from app.modules.bookings.dependencies import get_realtime, sweep_once
        from app.modules.bookings.dispatch_worker import DispatchWorker

        realtime = get_realtime()
        realtime.attach(asyncio.get_running_loop(), cross_process=settings.realtime_cross_process)
        worker = DispatchWorker(sweep_once, settings.dispatch_sweep_interval_seconds)
        if settings.dispatch_worker_enabled:
            worker.start()
        try:
            yield
        finally:
            await worker.stop()
            realtime.detach()

    app = FastAPI(title=settings.app_name, lifespan=lifespan, **docs)  # type: ignore[arg-type]
    # Routes read the settings of the app they belong to (app.auth.dependencies.app_settings).
    app.state.settings = settings
    # The ported services read the module-level settings proxy (app/core/runtime.py).
    use_settings(settings)

    # Added first, so it runs inside CORS and the request ID (add_middleware): a CSRF
    # refusal still carries both.
    app.add_middleware(CsrfProtectionMiddleware, settings=settings)
    add_middleware(app, settings)
    register_error_handlers(app)
    app.add_exception_handler(InvalidTransition, invalid_transition)
    app.include_router(api_router, prefix=API_PREFIX)

    logger.info("Starting %s (environment=%s)", settings.app_name, settings.environment)
    return app


app = create_app()

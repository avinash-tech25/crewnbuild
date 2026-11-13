"""create_app(): settings checks, logging, middleware, error handlers and routers.

Run in development with:  uvicorn app.main:app --reload --port 8200
"""

import logging

from fastapi import FastAPI

from app.api.v1.router import api_router
from app.core.config import Settings, get_settings
from app.core.errors import register_error_handlers
from app.core.logging import configure_logging
from app.core.middleware import add_middleware
from app.core.runtime import use_settings
from app.core.security.csrf_protection import CsrfProtectionMiddleware

API_PREFIX = "/api/v1"

logger = logging.getLogger(__name__)


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
    app = FastAPI(title=settings.app_name, **docs)  # type: ignore[arg-type]
    # Routes read the settings of the app they belong to (app.auth.dependencies.app_settings).
    app.state.settings = settings
    # The ported services read the module-level settings proxy (app/core/runtime.py).
    use_settings(settings)

    # Added first, so it runs inside CORS and the request ID (add_middleware): a CSRF
    # refusal still carries both.
    app.add_middleware(CsrfProtectionMiddleware, settings=settings)
    add_middleware(app, settings)
    register_error_handlers(app)
    app.include_router(api_router, prefix=API_PREFIX)

    logger.info("Starting %s (environment=%s)", settings.app_name, settings.environment)
    return app


app = create_app()

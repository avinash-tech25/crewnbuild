"""JSON log lines with the request ID on every line (sections 3 and 15.3).

Application code logs through the standard `logging` module or structlog; both end up
as one JSON object per line on stdout. Never log passwords, tokens, OTP codes, Aadhaar
or bank numbers, or full phone numbers (14.2); app/core/log_redaction.py removes any that
slip through, on every line.
"""

import logging
import sys

import structlog

from app.core.log_redaction import redact_event

SHARED_PROCESSORS: list[structlog.typing.Processor] = [
    structlog.contextvars.merge_contextvars,
    structlog.stdlib.add_log_level,
    structlog.stdlib.add_logger_name,
    structlog.processors.TimeStamper(fmt="iso", utc=True),
    structlog.processors.StackInfoRenderer(),
    structlog.processors.format_exc_info,
    # Last, so it also cleans the formatted message and the exception text (14.2, R6).
    redact_event,
]


def configure_logging(debug: bool) -> None:
    level = logging.DEBUG if debug else logging.INFO

    structlog.configure(
        processors=[*SHARED_PROCESSORS, structlog.stdlib.ProcessorFormatter.wrap_for_formatter],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )

    formatter = structlog.stdlib.ProcessorFormatter(
        foreign_pre_chain=SHARED_PROCESSORS,
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            structlog.processors.JSONRenderer(),
        ],
    )
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)

    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)
    # Uvicorn's own loggers go through the same JSON handler.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        uvicorn_logger = logging.getLogger(name)
        uvicorn_logger.handlers = []
        uvicorn_logger.propagate = True

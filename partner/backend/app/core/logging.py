"""JSON log lines with the request ID on every line (sections 3 and 15.3).

Application code logs through the standard `logging` module or structlog; both end up
as one JSON object per line on stdout. Never log passwords, tokens, OTP codes, Aadhaar
or bank numbers, or full phone numbers (14.2).
"""

import logging
import sys

import structlog

SHARED_PROCESSORS: list[structlog.typing.Processor] = [
    structlog.contextvars.merge_contextvars,
    structlog.stdlib.add_log_level,
    structlog.stdlib.add_logger_name,
    structlog.processors.TimeStamper(fmt="iso", utc=True),
    structlog.processors.StackInfoRenderer(),
    structlog.processors.format_exc_info,
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


def _value(value: object) -> str:
    if value is None:
        return "-"
    if isinstance(value, float):
        return f"{value:.4g}" if abs(value) < 1 else f"{value:.1f}"
    text = str(value)
    return f'"{text}"' if (" " in text or not text) else text


def log_event(logger: logging.Logger, event: str, level: int = logging.INFO, **fields: object) -> None:
    """One structured line: `event key=value key=value` (the old Partner helper). Callers
    pass identifiers (the SR-XXXXXXXX booking reference, technician ids, counts,
    distances) and never personal data: no names, phone numbers, addresses or coordinates."""
    if not logger.isEnabledFor(level):
        return
    rendered = " ".join(f"{key}={_value(value)}" for key, value in fields.items())
    logger.log(level, "%s %s", event, rendered)

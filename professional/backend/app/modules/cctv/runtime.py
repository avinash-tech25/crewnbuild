"""The settings the CCTV code reads (the old module-level `settings`).

`settings.<name>` reads the running app's Settings at call time: get_settings(), or
the Settings a test app was built with once use_settings() names them.
"""

from typing import Any

from app.core.config import Settings, get_settings

_override: Settings | None = None


def use_settings(value: Settings | None) -> None:
    """Read these Settings instead of get_settings() (None goes back to it)."""
    global _override
    _override = value


class _SettingsProxy:
    def __getattr__(self, name: str) -> Any:
        return getattr(_override or get_settings(), name)


settings: Any = _SettingsProxy()

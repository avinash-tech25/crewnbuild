"""The settings the ported Partner services read (the old module-level `settings`).

`settings.<name>` reads the running app's Settings at call time: get_settings(), or
the Settings the running app was built with (create_app calls use_settings).
"""

from typing import Any

from app.core.config import Settings, get_settings

_override: Settings | None = None


def use_settings(value: Settings | None) -> None:
    """Read these Settings instead of get_settings() (None goes back to it)."""
    global _override
    _override = value


class _SettingsProxy:
    # No instance __dict__: monkeypatch.setattr(settings, ...) then records the value it
    # read through the proxy and writes that back on undo, instead of deleting.
    __slots__ = ()

    def __getattr__(self, name: str) -> Any:
        return getattr(_override or get_settings(), name)

    def __setattr__(self, name: str, value: Any) -> None:
        # Writes go to the running app's Settings (the ported tests change a setting for
        # one test with monkeypatch.setattr(settings, ...)).
        setattr(_override or get_settings(), name, value)


settings: Any = _SettingsProxy()

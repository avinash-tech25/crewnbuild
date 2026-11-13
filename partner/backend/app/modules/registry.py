"""Every model module, imported once so all tables are on Base.metadata (Alembic, seeds,
tests and the health check read it)."""

import importlib
import pkgutil

import app.modules


def import_all_models() -> None:
    for module_info in pkgutil.iter_modules(app.modules.__path__):
        try:
            importlib.import_module(f"app.modules.{module_info.name}.models")
        except ModuleNotFoundError as error:
            if error.name != f"app.modules.{module_info.name}.models":
                raise

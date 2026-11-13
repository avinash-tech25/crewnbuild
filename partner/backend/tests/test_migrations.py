"""The Alembic history (technical-architecture.md 16.2, MG-05)."""

from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory

BACKEND = Path(__file__).resolve().parents[1]


def scripts() -> ScriptDirectory:
    return ScriptDirectory.from_config(Config(str(BACKEND / "alembic.ini")))


def test_one_head_and_short_revision_ids() -> None:
    directory = scripts()
    assert directory.get_heads() == ["0001"]
    for revision in directory.walk_revisions():
        assert len(revision.revision) < 32


def test_revision_files_are_dated_and_import_no_application_code() -> None:
    for path in (BACKEND / "alembic" / "versions").glob("*.py"):
        assert path.name[:8].isdigit() and path.name[8] == "_", path.name
        source = path.read_text(encoding="utf-8")
        assert "from app" not in source and "import app" not in source, path.name

import uuid

from sqlalchemy import CheckConstraint, Column, ForeignKey, Index, Integer, MetaData, Table, UniqueConstraint, Uuid
from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateIndex, CreateTable

from app.database.base import NAMING_CONVENTION, Base, new_uuid7


def test_tables_live_in_schema_professional() -> None:
    assert Base.metadata.schema == "professional"


def test_naming_convention_names_every_constraint() -> None:
    metadata = MetaData(schema="professional", naming_convention=NAMING_CONVENTION)
    Table("projects", metadata, Column("id", Uuid, primary_key=True))
    items = Table(
        "purchase_order_items",
        metadata,
        Column("id", Uuid, primary_key=True),
        Column("project_id", Uuid, ForeignKey("projects.id", ondelete="CASCADE")),
        Column("line_number", Integer),
        UniqueConstraint("project_id", "line_number"),
        CheckConstraint("line_number > 0", name="line_number_positive"),
    )
    index = Index(None, items.c.project_id)

    ddl = str(CreateTable(items).compile(dialect=postgresql.dialect()))
    assert "pk_purchase_order_items" in ddl
    assert "fk_purchase_order_items__project_id__projects" in ddl
    assert "uq_purchase_order_items__project_id_line_number" in ddl
    assert "ck_purchase_order_items__line_number_positive" in ddl
    assert "ix_purchase_order_items__project_id" in str(CreateIndex(index).compile(dialect=postgresql.dialect()))


def test_new_uuid7_has_version_7_and_rfc_variant() -> None:
    value = new_uuid7()
    assert value.version == 7
    assert value.variant == uuid.RFC_4122


def test_new_uuid7_values_are_time_ordered_and_unique() -> None:
    values = [new_uuid7() for _ in range(1000)]
    assert len(set(values)) == 1000
    timestamps = [value.int >> 80 for value in values]
    assert timestamps == sorted(timestamps)


def test_every_connection_works_in_utc() -> None:
    from sqlalchemy import text

    from app.database.session import engine

    with engine.connect() as connection:
        assert connection.execute(text("SHOW timezone")).scalar() == "UTC"
        # A naive UTC time bound in raw SQL is the same instant in the database.
        moment = connection.execute(text("SELECT CAST('2026-09-20 18:40' AS timestamptz) AT TIME ZONE 'UTC'")).scalar()
        assert str(moment) == "2026-09-20 18:40:00"

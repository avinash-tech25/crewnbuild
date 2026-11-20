"""Exercise the marketplace migration against PostgreSQL."""

import importlib.util
import uuid
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
from site_operations.test_site_operations import Site
from sqlalchemy import inspect, select
from sqlalchemy.orm import Session
from starlette.testclient import TestClient

from app.modules.marketplace.models import PurchaseOrder
from marketplace.test_marketplace import client, site, supplier  # noqa: F401

MIGRATION = (
    Path(__file__).resolve().parents[2] / "alembic" / "versions" / "20261118_0008_marketplace_purchase_payments.py"
)


REQUEST_MIGRATION = MIGRATION.with_name("20261119_0009_no_payment_purchase_requests.py")


def test_payment_migration_preserves_legacy_order(
    database: Session,
    client: TestClient,  # noqa: F811
    site: Site,  # noqa: F811
) -> None:
    seller = supplier(client, database)
    legacy_order = PurchaseOrder(
        order_number=uuid.uuid4().hex,
        project_id=uuid.UUID(site.project_id),
        buyer_id=site.engineer.user.id,
        supplier_id=seller.user.id,
    )
    database.add(legacy_order)
    database.commit()
    order_id = legacy_order.id
    spec = importlib.util.spec_from_file_location("purchase_payment_migration", MIGRATION)
    assert spec and spec.loader
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    request_spec = importlib.util.spec_from_file_location("no_payment_purchase_requests", REQUEST_MIGRATION)
    assert request_spec and request_spec.loader
    request_migration = importlib.util.module_from_spec(request_spec)
    request_spec.loader.exec_module(request_migration)
    with Operations.context(MigrationContext.configure(database.connection())):
        request_migration.downgrade()
        migration.downgrade()
        assert not inspect(database.connection()).has_table("purchase_payments", schema="professional")
        migration.upgrade()
        request_migration.upgrade()
        inspector = inspect(database.connection())
        assert any(
            column["name"] == "received_at"
            for column in inspector.get_columns("purchase_order_items", schema="professional")
        )
        assert any(
            constraint["column_names"] == ["buyer_user_id", "request_key"]
            for constraint in inspector.get_unique_constraints("purchase_orders", schema="professional")
        )
    database.commit()
    assert database.scalar(select(PurchaseOrder.id).where(PurchaseOrder.id == order_id)) == order_id
    assert inspect(database.connection()).has_table("purchase_payment_attempts", schema="professional")

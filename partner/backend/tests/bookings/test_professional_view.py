"""partner.v_professional_bookings: the only way Professional reads Partner bookings
(technical-architecture.md section 11.2)."""

from legacy_dispatch import AT_HOME, book, working
from sqlalchemy import text

VIEW_COLUMNS = [
    "id",
    "requested_by_user_id",
    "requested_by_role",
    "status",
    "trade",
    "quoted_amount",
    "currency",
    "completed_at",
    "service_name",
    "technician_name",
]


def test_the_view_has_the_agreed_columns(connection):
    columns = connection.execute(
        text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_schema = 'partner' AND table_name = 'v_professional_bookings' ORDER BY ordinal_position"
        )
    ).scalars()
    assert list(columns) == VIEW_COLUMNS


def test_a_booking_is_visible_through_the_view(client, connection, onboard, requester_session):
    working(client, onboard, "PLUMBER", at=AT_HOME)
    account_id, headers = requester_session()
    booking = book(client, headers, "PLUMBER").json()
    row = (
        connection.execute(text("SELECT * FROM partner.v_professional_bookings WHERE id = :id"), {"id": booking["id"]})
        .mappings()
        .one()
    )
    assert (row["requested_by_user_id"], row["requested_by_role"], row["trade"]) == (account_id, "OWNER", "PLUMBER")


def test_the_professional_role_may_read_only_the_view(connection):
    role = connection.execute(text("SELECT 1 FROM pg_roles WHERE rolname = 'crewnbuild_professional'")).first()
    if role is None:
        return  # no Professional role on this server: nothing is granted
    can = connection.execute(
        text(
            "SELECT has_table_privilege('crewnbuild_professional', 'partner.v_professional_bookings', 'SELECT'), "
            "has_table_privilege('crewnbuild_professional', 'partner.bookings', 'SELECT')"
        )
    ).one()
    assert tuple(can) == (True, False)

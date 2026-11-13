"""The database connection itself."""

from sqlalchemy import text

from app.database.session import engine


def test_every_connection_works_in_utc() -> None:
    with engine.connect() as connection:
        assert connection.execute(text("SHOW timezone")).scalar() == "UTC"
        # A naive UTC time bound in raw SQL is the same instant in the database.
        moment = connection.execute(text("SELECT CAST('2026-09-20 18:40' AS timestamptz) AT TIME ZONE 'UTC'")).scalar()
        assert str(moment) == "2026-09-20 18:40:00"

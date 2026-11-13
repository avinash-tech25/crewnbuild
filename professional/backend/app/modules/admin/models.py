"""Admin tables (technical-architecture.md section 10, domain Admin).

    admin_audit_logs   was audit_events; integer key -> UUID; target_id stays text

The other admin-domain tables live with the module that serves their public side:
user_reports (support), ads and ad_daily_stats (content), user_verification_reviews
(identity), admin_profiles and account_deletion_requests (accounts).

The audit log is append-only, enforced by the database: a trigger refuses every UPDATE
and DELETE, so an administrator cannot rewrite or remove their own history even through
the application's own connection. The trigger is created with the table here (tests)
and by the baseline migration 0001.
"""

import uuid

from sqlalchemy import DDL, ForeignKey, String, Text, event
from sqlalchemy.orm import Mapped, mapped_column

from app.core.config import PROFESSIONAL_SCHEMA
from app.database.base import Base, CreatedAtMixin, UuidPrimaryKeyMixin


class AdminAuditLog(UuidPrimaryKeyMixin, CreatedAtMixin, Base):
    """One administrative action. The target is a type and an id, not a foreign key, so
    an entry can name anything and survives its target; the actor's e-mail and role are
    copied so the entry still reads correctly if the account goes."""

    __tablename__ = "admin_audit_logs"

    # RESTRICT, not SET NULL: clearing the column would be an UPDATE, which the trigger
    # refuses. Accounts are soft-deleted, so the row in users stays.
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    actor_email: Mapped[str] = mapped_column(String(255), nullable=False)
    actor_role: Mapped[str] = mapped_column(String(40), nullable=False)
    # The scope the action was performed under (GLOBAL or IN).
    scope: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    # A dotted key: "admin.created", "user.suspended".
    action: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    target_type: Mapped[str | None] = mapped_column(String(40), index=True)
    target_id: Mapped[str | None] = mapped_column(String(64), index=True)
    summary: Mapped[str] = mapped_column(Text, nullable=False, default="")
    reason: Mapped[str | None] = mapped_column(Text)


APPEND_ONLY_FUNCTION = "admin_audit_logs_refuse_change"

event.listen(
    AdminAuditLog.__table__,
    "after_create",
    DDL(
        f"""
        CREATE OR REPLACE FUNCTION {PROFESSIONAL_SCHEMA}.{APPEND_ONLY_FUNCTION}() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'admin_audit_logs is append-only; %% is not permitted', TG_OP;
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER admin_audit_logs_append_only
            BEFORE UPDATE OR DELETE ON {PROFESSIONAL_SCHEMA}.admin_audit_logs
            FOR EACH ROW EXECUTE FUNCTION {PROFESSIONAL_SCHEMA}.{APPEND_ONLY_FUNCTION}();
        """
    ),
)
event.listen(
    AdminAuditLog.__table__,
    "after_drop",
    DDL(f"DROP FUNCTION IF EXISTS {PROFESSIONAL_SCHEMA}.{APPEND_ONLY_FUNCTION}()"),
)

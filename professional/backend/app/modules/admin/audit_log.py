"""The administrator audit log (admin_audit_logs, section 10).

NOT PORTED YET: the table and its writer come with the admin module, which replaces
this function. The old code wrote one row when an administrator changed its own
sign-in number ("admin.phone_changed"); until the admin module is ported nothing is
written.
"""

import uuid

from sqlalchemy.orm import Session

from app.modules.identity.models import User


def record_admin_action(
    database: Session, administrator: User, action: str, summary: str, target_type: str, target_id: uuid.UUID
) -> None:
    return None

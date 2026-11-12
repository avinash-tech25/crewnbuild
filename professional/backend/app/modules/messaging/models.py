"""Messaging tables (technical-architecture.md section 10, domain Messaging).

Created ahead of the messaging module only as far as other modules need it: support
tickets notify the account holder in the app. Conversations, messages and the
notification endpoints come with the messaging module.

    notifications   integer key -> UUID; FK user_id CASCADE (a notice exists only for its account)
"""

import uuid

from sqlalchemy import Boolean, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base, CreatedAtMixin, UuidPrimaryKeyMixin


class Notification(UuidPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "notifications"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    is_read: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    # NULL for notices written without a category.
    category: Mapped[str | None] = mapped_column(String(20))

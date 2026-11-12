"""The files table (technical-architecture.md section 10: uploaded_files -> files).

Created in the accounts step only as far as accounts needs it: a profile photo or a
business logo must be one of the caller's own uploads, and the account deletion unlinks
an account's own files. Uploading, serving and storage (S3) come with the files module,
which also fixes the public address of a file; until then it is /files/<uuid>
(file_ownership.FILE_ADDRESS).
"""

import uuid

from sqlalchemy import ForeignKey, Integer, LargeBinary, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base, CreatedAtMixin, UuidPrimaryKeyMixin


class File(UuidPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "files"

    storage_key: Mapped[str] = mapped_column(String(512), nullable=False, unique=True)
    # Blank for files stored before the move to S3; their bytes are in `content`.
    bucket: Mapped[str | None] = mapped_column(String(255))
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(120), nullable=False)
    content: Mapped[bytes | None] = mapped_column(LargeBinary)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    # Kept when the uploader's account goes (it is detached, not deleted).
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )

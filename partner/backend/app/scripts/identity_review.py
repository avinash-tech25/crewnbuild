"""Manual identity review for Partner technicians -- server access only, no API.

No face- or Aadhaar-verification provider is configured, so nothing is ever
marked VERIFIED automatically. A reviewer with access to the server decides:

  python -m app.scripts.identity_review pending
  python -m app.scripts.identity_review export-face <user_id> <output.jpg>
  python -m app.scripts.identity_review face <user_id> verified|failed
  python -m app.scripts.identity_review aadhaar <user_id> verified|failed
  python -m app.scripts.identity_review purge

`export-face` writes the decrypted capture to a file the reviewer chooses; delete
it after looking. Deciding the face deletes the stored encrypted capture. The
Aadhaar number itself is never printed by this script; the list shows it masked.
"""

import sys
import uuid
from pathlib import Path

from app.database.session import SessionLocal
from app.modules.registry import import_all_models
from app.modules.technicians.identity_service import (
    decide_aadhaar,
    decide_face,
    decrypt_face_capture,
    purge_expired_face_captures,
)
from app.modules.technicians.models import AADHAAR_PENDING, FACE_PENDING, IdentityVerification

import_all_models()


def _identity(session, raw_user_id: str) -> IdentityVerification:
    identity = (
        session.query(IdentityVerification).filter(IdentityVerification.user_id == uuid.UUID(raw_user_id)).first()
    )
    if not identity:
        raise SystemExit("No identity record for that user.")
    return identity


def _decision(value: str) -> bool:
    if value not in ("verified", "failed"):
        raise SystemExit("Decision must be 'verified' or 'failed'.")
    return value == "verified"


def main(argv: list[str]) -> None:
    if not argv:
        raise SystemExit(__doc__)
    command, arguments = argv[0], argv[1:]
    with SessionLocal() as session:
        if command == "pending":
            rows = (
                session.query(IdentityVerification)
                .filter(
                    (IdentityVerification.face_status == FACE_PENDING)
                    | (IdentityVerification.aadhaar_status == AADHAAR_PENDING)
                )
                .order_by(IdentityVerification.updated_at)
                .all()
            )
            for identity in rows:
                print(
                    f"{identity.user_id}  face={identity.face_status:8} aadhaar={identity.aadhaar_status:20} "
                    f"{identity.aadhaar_masked or '-':16} capture_expires={identity.face_capture_expires_at}"
                )
            print(f"{len(rows)} record(s) awaiting review")
        elif command == "export-face" and len(arguments) == 2:
            Path(arguments[1]).write_bytes(decrypt_face_capture(_identity(session, arguments[0])))
            print(f"Written to {arguments[1]}. Delete it once reviewed.")
        elif command == "face" and len(arguments) == 2:
            decide_face(session, _identity(session, arguments[0]), _decision(arguments[1]))
            print("Face decision recorded; the stored capture was deleted.")
        elif command == "aadhaar" and len(arguments) == 2:
            decide_aadhaar(session, _identity(session, arguments[0]), _decision(arguments[1]))
            print("Aadhaar decision recorded.")
        elif command == "purge":
            print(f"Purged {purge_expired_face_captures(session)} expired capture(s).")
        else:
            raise SystemExit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])

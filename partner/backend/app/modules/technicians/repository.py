"""Database access of the technicians module (the old identity and work-preference repositories)."""

from datetime import datetime

from sqlalchemy.orm import Session

from app.database.base_repository import BaseRepository
from app.modules.technicians.models import IdentityVerification, TechnicianService, TechnicianWorkingHours


class IdentityRepository(BaseRepository[IdentityVerification]):
    def __init__(self, database: Session):
        super().__init__(database, IdentityVerification)

    def list_expired_face_captures(self, now: datetime) -> list[IdentityVerification]:
        return (
            self.database.query(IdentityVerification)
            .filter(
                IdentityVerification.face_provider_reference.isnot(None),
                IdentityVerification.face_capture_expires_at < now,
            )
            .all()
        )

    def find_other_with_aadhaar_fingerprint(self, fingerprint: str, user_id):
        """The id row of another account's record holding this fingerprint, or None."""
        return (
            self.database.query(IdentityVerification.id)
            .filter(IdentityVerification.aadhaar_fingerprint == fingerprint, IdentityVerification.user_id != user_id)
            .first()
        )


class WorkPreferencesRepository(BaseRepository[TechnicianService]):
    """A technician's chosen services and weekly working hours."""

    def __init__(self, database: Session):
        super().__init__(database, TechnicianService)

    def list_services_of(self, technician_id) -> list[TechnicianService]:
        return self.database.query(TechnicianService).filter(TechnicianService.technician_id == technician_id).all()

    def list_working_hours_of(self, technician_id) -> list[TechnicianWorkingHours]:
        return (
            self.database.query(TechnicianWorkingHours)
            .filter(TechnicianWorkingHours.technician_id == technician_id)
            .all()
        )

    def delete_services_of(self, technician_id) -> None:
        self.database.query(TechnicianService).filter(TechnicianService.technician_id == technician_id).delete()

    def delete_working_hours_of(self, technician_id) -> None:
        self.database.query(TechnicianWorkingHours).filter(
            TechnicianWorkingHours.technician_id == technician_id
        ).delete()

    def get_working_hours(self, technician_id, weekday: int) -> TechnicianWorkingHours | None:
        return self.database.get(TechnicianWorkingHours, (technician_id, weekday))

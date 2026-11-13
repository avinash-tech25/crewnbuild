"""Database queries of the weather module (ported from the old weather_repository.py).

The project queries read the projects module's tables. Which projects a Store Manager or a
Supplier delivers to is asked of the store, marketplace, labour and equipment modules
(their links.py).
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import desc, func, inspect, or_
from sqlalchemy.orm import Session

from app.core.config import PROFESSIONAL_SCHEMA
from app.modules.accounts.models import ADMIN_SCOPES, CATEGORY_STORE_MANAGER, AdminProfile, EngineerProfile
from app.modules.identity.models import ADMIN_ROLES, ROLE_BUILDER, ROLE_OWNER, User
from app.modules.projects.models import Project, ProjectEngineer
from app.modules.weather.models import (
    WeatherAlert,
    WeatherAlertAcknowledgement,
    WeatherGeocodeCache,
    WeatherSiteLocation,
    WeatherSnapshot,
)

# How many in-scope projects an administrator's weather list offers at most.
ADMIN_PROJECT_LIMIT = 100
# A project in one of these statuses is not monitored or offered.
CLOSED_PROJECT_STATUSES = ("completed", "cancelled", "canceled", "closed", "archived", "deleted", "rejected")


def site_filter(model, site):
    """The rows of a per-site weather table (locations, snapshots, alerts) that
    belong to one site: a project's, or an account's own."""
    if site.project is not None:
        return model.project_id == site.project.id
    return model.user_id == site.user.id


_installed = {"value": False}


def weather_installed(database: Session) -> bool:
    """Whether migration 0045 has been applied to this database. Remembered once true."""
    if _installed["value"]:
        return True
    present = inspect(database.get_bind()).has_table(WeatherAlert.__tablename__, schema=PROFESSIONAL_SCHEMA)
    _installed["value"] = bool(present)
    return _installed["value"]


class WeatherRepository:
    def __init__(self, database: Session):
        self.database = database

    # ---- projects ----
    def project(self, project_id: Any) -> Project | None:
        return self.database.get(Project, project_id)

    def accessible_projects(self, user: User) -> list[Project]:
        """The owner's own, the builder's awarded and the Site Engineer's actively
        assigned projects (the ensure_project_activity_read_access rule)."""
        query = self.database.query(Project)
        if user.role == ROLE_OWNER:
            query = query.filter(Project.owner_id == user.id)
        elif user.role == ROLE_BUILDER:
            query = query.filter(Project.contractor_id == user.id)
        elif user.role == "ENGINEER":
            assigned = self.database.query(ProjectEngineer.project_id).filter(
                ProjectEngineer.engineer_id == user.id, ProjectEngineer.status == "ACTIVE"
            )
            query = query.filter(Project.id.in_(assigned))
        else:
            return []
        return query.order_by(desc(Project.created_at)).all()

    def open_project_filter(self):
        return or_(Project.status.is_(None), func.lower(Project.status).notin_(CLOSED_PROJECT_STATUSES))

    def is_store_manager(self, user: User) -> bool:
        if user.role != "ENGINEER":
            return False
        category = self.database.query(EngineerProfile.category).filter(EngineerProfile.user_id == user.id).scalar()
        return category == CATEGORY_STORE_MANAGER

    def store_request_project_ids(self, store_manager_id: uuid.UUID) -> set[Any]:
        """Projects this Store Manager has open site requests for."""
        from app.modules.store.links import open_request_project_ids

        return open_request_project_ids(self.database, store_manager_id)

    def supplier_order_project_ids(self, supplier_id: uuid.UUID) -> set[Any]:
        """Delivery destinations: projects this Supplier has open material, equipment or
        labour orders for."""
        from app.modules.equipment_supply import links as equipment_links
        from app.modules.labour_supply import links as labour_links
        from app.modules.marketplace.site_links import open_order_project_ids

        return (
            open_order_project_ids(self.database, supplier_id)
            | equipment_links.open_order_project_ids(self.database, supplier_id)
            | labour_links.open_order_project_ids(self.database, supplier_id)
        )

    def admin_profile(self, user: User) -> AdminProfile | None:
        """The administrator profile behind an active admin account."""
        if user.role not in ADMIN_ROLES or (user.status or "ACTIVE").upper() != "ACTIVE":
            return None
        profile = self.database.query(AdminProfile).filter(AdminProfile.user_id == user.id).first()
        return profile if profile is not None and profile.scope in ADMIN_SCOPES else None

    def admin_projects(self, admin: Any) -> list[Project]:
        """The open projects in an administrator's country scope, newest first."""
        from app.modules.admin.project_links import scope_projects

        query = scope_projects(self.database.query(Project).filter(self.open_project_filter()), admin)
        return query.order_by(desc(Project.created_at)).limit(ADMIN_PROJECT_LIMIT).all()

    def projects_by_id(self, project_ids: Any) -> list[Project]:
        if not project_ids:
            return []
        return (
            self.database.query(Project)
            .filter(Project.id.in_(list(project_ids)))
            .order_by(desc(Project.created_at))
            .all()
        )

    def active_admins(self) -> list[tuple[User, AdminProfile]]:
        return [
            (row[0], row[1])
            for row in self.database.query(User, AdminProfile)
            .join(AdminProfile, AdminProfile.user_id == User.id)
            .filter(User.role.in_(ADMIN_ROLES), User.status == "ACTIVE", AdminProfile.scope.in_(ADMIN_SCOPES))
            .all()
        ]

    def users_by_id(self, user_ids: Any) -> list[User]:
        if not user_ids:
            return []
        return self.database.query(User).filter(User.id.in_(list(user_ids)), User.status == "ACTIVE").all()

    def store_request_recipient_ids(self, project_id: Any) -> set[uuid.UUID]:
        """Store Managers with open site requests for the project."""
        from app.modules.store.links import open_request_store_manager_ids

        return open_request_store_manager_ids(self.database, project_id)

    def supplier_order_recipient_ids(self, project_id: Any) -> set[uuid.UUID]:
        """Suppliers with open material, equipment or labour orders for the project."""
        from app.modules.equipment_supply import links as equipment_links
        from app.modules.labour_supply import links as labour_links
        from app.modules.marketplace.site_links import open_order_supplier_ids

        return (
            open_order_supplier_ids(self.database, project_id)
            | equipment_links.open_order_supplier_ids(self.database, project_id)
            | labour_links.open_order_supplier_ids(self.database, project_id)
        )

    def monitored_personal_user_ids(self) -> list[uuid.UUID]:
        """Accounts with a personal weather site, still active."""
        return [
            row[0]
            for row in self.database.query(WeatherSiteLocation.user_id)
            .join(User, User.id == WeatherSiteLocation.user_id)
            .filter(WeatherSiteLocation.user_id.isnot(None), User.status == "ACTIVE")
            .all()
        ]

    def user(self, user_id: Any) -> User | None:
        return self.database.get(User, user_id)

    def monitored_project_ids(self) -> list[Any]:
        """Every open project, for the monitor (oldest first)."""
        return [
            row[0]
            for row in self.database.query(Project.id)
            .filter(self.open_project_filter())
            .order_by(Project.created_at, Project.id)
            .all()
        ]

    def project_recipients(self, project: Project) -> list[User]:
        """Who is told about a project's weather: its owner, awarded builder and actively
        assigned Site Engineers -- the accounts that can read it."""
        ids: list[uuid.UUID] = [value for value in (project.owner_id, project.contractor_id) if value]
        ids += [
            row[0]
            for row in self.database.query(ProjectEngineer.engineer_id)
            .filter(ProjectEngineer.project_id == project.id, ProjectEngineer.status == "ACTIVE")
            .all()
        ]
        unique = list(dict.fromkeys(ids))
        if not unique:
            return []
        return self.database.query(User).filter(User.id.in_(unique), User.status == "ACTIVE").all()

    # ------------------------------------------------------------- one site
    def location_of(self, site) -> WeatherSiteLocation | None:
        return self.database.query(WeatherSiteLocation).filter(site_filter(WeatherSiteLocation, site)).first()

    def snapshot_of(self, site) -> WeatherSnapshot | None:
        return self.database.query(WeatherSnapshot).filter(site_filter(WeatherSnapshot, site)).first()

    def active_alerts_of(self, site) -> list[WeatherAlert]:
        return (
            self.database.query(WeatherAlert)
            .filter(site_filter(WeatherAlert, site), WeatherAlert.status == "ACTIVE")
            .all()
        )

    def recently_resolved_of(self, site, event_key: str, since: datetime) -> WeatherAlert | None:
        return (
            self.database.query(WeatherAlert)
            .filter(
                site_filter(WeatherAlert, site),
                WeatherAlert.event_key == event_key,
                WeatherAlert.status == "RESOLVED",
                WeatherAlert.resolved_at >= since,
            )
            .order_by(desc(WeatherAlert.resolved_at))
            .first()
        )

    def personal_snapshot(self, user_id: uuid.UUID) -> WeatherSnapshot | None:
        return self.database.query(WeatherSnapshot).filter(WeatherSnapshot.user_id == user_id).first()

    # ------------------------------------------------------------- locations
    def location(self, project_id: int) -> WeatherSiteLocation | None:
        return self.database.query(WeatherSiteLocation).filter(WeatherSiteLocation.project_id == project_id).first()

    def locations(self, project_ids: list[int]) -> dict[int, WeatherSiteLocation]:
        if not project_ids:
            return {}
        rows = self.database.query(WeatherSiteLocation).filter(WeatherSiteLocation.project_id.in_(project_ids)).all()
        return {row.project_id: row for row in rows}

    def geocode(self, query_key: str) -> WeatherGeocodeCache | None:
        return self.database.query(WeatherGeocodeCache).filter(WeatherGeocodeCache.query_key == query_key).first()

    # ------------------------------------------------------------- snapshots
    def snapshot(self, project_id: int) -> WeatherSnapshot | None:
        return self.database.query(WeatherSnapshot).filter(WeatherSnapshot.project_id == project_id).first()

    # ------------------------------------------------------------- alerts
    def alert(self, alert_id: int) -> WeatherAlert | None:
        return self.database.get(WeatherAlert, alert_id)

    def active_alerts(self, project_id: int) -> list[WeatherAlert]:
        return (
            self.database.query(WeatherAlert)
            .filter(
                WeatherAlert.project_id == project_id,
                WeatherAlert.status == "ACTIVE",
            )
            .all()
        )

    def active_alerts_for(self, project_ids: list[int]) -> list[WeatherAlert]:
        if not project_ids:
            return []
        return (
            self.database.query(WeatherAlert)
            .filter(
                WeatherAlert.project_id.in_(project_ids),
                WeatherAlert.status == "ACTIVE",
            )
            .all()
        )

    def history(
        self,
        project_ids: list[int],
        *,
        personal_user_id: uuid.UUID | None = None,
        alert_type=None,
        severity=None,
        status=None,
        date_from: datetime | None = None,
        date_to: datetime | None = None,
        offset=0,
        limit=50,
    ):
        """Alerts of these projects, and of this account's own site when personal_user_id is given."""
        scopes = []
        if project_ids:
            scopes.append(WeatherAlert.project_id.in_(project_ids))
        if personal_user_id is not None:
            scopes.append(WeatherAlert.user_id == personal_user_id)
        if not scopes:
            return [], 0
        query = self.database.query(WeatherAlert).filter(or_(*scopes))
        if alert_type:
            query = query.filter(WeatherAlert.alert_type == alert_type)
        if severity:
            query = query.filter(WeatherAlert.severity == severity)
        if status:
            query = query.filter(WeatherAlert.status == status)
        if date_from:
            query = query.filter(WeatherAlert.created_at >= date_from)
        if date_to:
            query = query.filter(WeatherAlert.created_at < date_to)
        total = query.count()
        rows = query.order_by(desc(WeatherAlert.created_at), desc(WeatherAlert.id)).offset(offset).limit(limit).all()
        return rows, total

    def acknowledgements(self, alert_ids: list[int]) -> dict[int, list[tuple[WeatherAlertAcknowledgement, str | None]]]:
        if not alert_ids:
            return {}
        rows = (
            self.database.query(WeatherAlertAcknowledgement, User.name)
            .outerjoin(User, User.id == WeatherAlertAcknowledgement.user_id)
            .filter(WeatherAlertAcknowledgement.alert_id.in_(alert_ids))
            .order_by(WeatherAlertAcknowledgement.acknowledged_at)
            .all()
        )
        grouped: dict[int, list] = {}
        for acknowledgement, name in rows:
            grouped.setdefault(acknowledgement.alert_id, []).append((acknowledgement, name))
        return grouped

    def acknowledgement(self, alert_id: int, user_id: uuid.UUID) -> WeatherAlertAcknowledgement | None:
        return (
            self.database.query(WeatherAlertAcknowledgement)
            .filter(
                WeatherAlertAcknowledgement.alert_id == alert_id,
                WeatherAlertAcknowledgement.user_id == user_id,
            )
            .first()
        )

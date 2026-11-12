"""Weather sites: locations, the cached forecast, alerts and their history.

A site is a project's site, or one account's own place ("My location"). Every
signed-in account, whatever its role, has its own place: it shows general
weather and alerts for wherever that person works, needs no project, and is
seen and acknowledged by that account alone.

Project weather is private to the project. Who may read it, and how much:

    member     the House Owner of the project, its awarded builder and its
               actively assigned Site Engineers (ensure_project_activity_read_access):
               everything -- forecasts, alerts, acknowledging them, history.
               The owner and builder can set where the site is.
    store      a Store Manager with an open site request for the project, while
               they serve its builder (store_manager_serves_project)
    delivery   a Supplier with an open material, equipment or labour order for it
    admin      an administrator with projects.view whose country scope holds it
               (the same rule as the admin project pages)

The last three read the site's forecast and active alerts only: no address, no
acknowledging, and only admins see who acknowledged. None of them sees a project
it has no such link to.

A site's weather is fetched from the provider at most every
WEATHER_CACHE_MINUTES, by whichever comes first -- a reader or the monitor --
and every fetch re-evaluates the site's alerts. One process fetches a site at a
time (a per-site lock), so a page asking for current, hourly and daily at once
makes one provider call. When the provider fails, the last good forecast is
shown, marked with its time, for up to WEATHER_MAX_STALE_MINUTES; after that
only its time is shown. Weather is never made up.
"""

import logging
import threading
import uuid
from datetime import UTC, datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.local_time import local_iso as to_local_iso
from app.database.types import naive_utc_now
from app.modules.admin.admin_identity import AdminIdentity
from app.modules.identity.models import User
from app.modules.weather.models import (
    ALERT_STATUSES,
    SEVERITIES,
    SEVERITY_RANK,
    WeatherAlert,
    WeatherAlertAcknowledgement,
    WeatherGeocodeCache,
    WeatherSiteLocation,
    WeatherSnapshot,
)
from app.modules.weather.project_links import (
    Project,
    contractor_has_project_access,
    ensure_project_activity_read_access,
    project_locality,
    store_manager_serves_project,
)
from app.modules.weather.repository import WeatherRepository, weather_installed
from app.modules.weather.weather_alert_service import (
    ALERT_TYPE_LABELS,
    ALERT_TYPES,
    evaluate,
    recommendations_for,
    to_naive_utc,
)
from app.modules.weather.weather_notification_service import WeatherNotificationService, send_emails_later
from app.modules.weather.weather_presentation import presentation
from app.modules.weather.weather_provider_service import (
    Geocoder,
    WeatherProviderError,
    WeatherRateLimited,
    build_provider,
)
from app.modules.weather.weather_settings import WeatherSettings, get_weather_settings

logger = logging.getLogger(__name__)
UTC = UTC

# A failed fetch is not retried for this long, by readers or the monitor.
FAILURE_COOLDOWN = timedelta(minutes=2)
# A place search that found nothing is asked again after this long.
GEOCODE_MISS_RETRY = timedelta(days=7)

COUNTRY_CODES = {
    "india": "IN",
    "united arab emirates": "AE",
    "uae": "AE",
    "saudi arabia": "SA",
    "qatar": "QA",
    "bahrain": "BH",
    "oman": "OM",
}

# How an account reads a project's weather (see the module docstring).
MEMBER, STORE, DELIVERY, ADMIN = "member", "store", "delivery", "admin"
PERSONAL = "personal"

_site_locks: dict[tuple, threading.Lock] = {}
_locks_guard = threading.Lock()


def _site_lock(key: tuple) -> threading.Lock:
    with _locks_guard:
        return _site_locks.setdefault(key, threading.Lock())


class WeatherUnavailable(HTTPException):
    def __init__(self):
        super().__init__(status_code=503, detail="Weather is not available yet.")


def utcnow() -> datetime:
    return naive_utc_now()


def normalise_query(value: str) -> str:
    return " ".join((value or "").split()).strip()


ADMIN_AREA_WORDS = ("district", "dist", "dt", "mandal", "taluk", "taluka", "tehsil")


def query_variants(value: str) -> list[str]:
    """One place name as the place search may know it. Indian registrations often
    split or label a town ("Karim Nagar", "Karimnagar District") where the search
    knows only "Karimnagar": try the name as written, without the administrative
    word, then with its spaces closed up."""
    text = normalise_query(value)
    words = text.split(" ")
    if len(words) > 1 and words[-1].lower().strip(".") in ADMIN_AREA_WORDS:
        words = words[:-1]
    bare = " ".join(words)
    return list(dict.fromkeys(variant for variant in (text, bare, bare.replace(" ", "")) if variant))


class Site:
    """One weather site: a project's (project set) or an account's own (user set)."""

    def __init__(self, project: Project | None = None, user: User | None = None):
        if (project is None) == (user is None):
            raise ValueError("A weather site is a project's or an account's, not both")
        self.project = project
        self.user = user
        self.place_name: str | None = None

    @property
    def key(self) -> tuple:
        return ("project", self.project.id) if self.project is not None else ("user", str(self.user.id))

    @property
    def personal(self) -> bool:
        return self.project is None


class WeatherService:
    def __init__(
        self, database: Session, settings: WeatherSettings | None = None, provider=None, geocoder=None, clock=utcnow
    ):
        self.database = database
        self.settings = settings or get_weather_settings()
        self.repository = WeatherRepository(database)
        self._provider = provider
        self._geocoder = geocoder
        self.clock = clock

    @property
    def provider(self):
        if self._provider is None:
            self._provider = build_provider(self.settings)
        return self._provider

    @property
    def geocoder(self):
        if self._geocoder is None:
            self._geocoder = Geocoder(self.settings)
        return self._geocoder

    # ================================================================ access
    def require_installed(self) -> None:
        if not weather_installed(self.database):
            logger.error(
                "Weather tables are missing from this database; apply the weather alembic revisions (alembic upgrade head)."
            )
            raise WeatherUnavailable()

    def project_for(self, project_id: uuid.UUID, user: User) -> Project:
        """A project the account is a member of (owner, awarded builder, active Site Engineer)."""
        self.require_installed()
        return ensure_project_activity_read_access(self.database, project_id, user)

    def admin_identity(self, user: User) -> AdminIdentity | None:
        profile = self.repository.admin_profile(user)
        return AdminIdentity(user, profile) if profile is not None else None

    def linked_access(self, project: Project, user: User) -> str | None:
        """How a non-member may read this project's weather, if at all."""
        admin = self.admin_identity(user)
        if admin is not None:
            return ADMIN if admin.has("projects.view") and admin.may_reach(project_locality(project)) else None
        if user.role == "SUPPLIER":
            return DELIVERY if project.id in self.repository.supplier_order_project_ids(user.id) else None
        if self.repository.is_store_manager(user):
            if project.id in self.repository.store_request_project_ids(user.id) and self.serves(user, project):
                return STORE
        return None

    def serves(self, store_manager: User, project: Project) -> bool:
        # The account as this session holds it: the check reads its engineer profile.
        return store_manager_serves_project(self.database, self.repository.user(store_manager.id), project)

    def project_access(self, project_id: uuid.UUID, user: User) -> tuple[Project, str]:
        self.require_installed()
        try:
            return ensure_project_activity_read_access(self.database, project_id, user), MEMBER
        except HTTPException as error:
            if error.status_code != 403:
                raise
            project = self.repository.project(project_id)
            access = self.linked_access(project, user) if project is not None else None
            if access is None:
                raise
            return project, access

    def can_edit_location(self, project: Project, user: User) -> bool:
        if user.role == "OWNER":
            return project.owner_id == user.id
        if user.role == "BUILDER":
            return project.contractor_id == user.id or contractor_has_project_access(self.database, project.id, user.id)
        return False

    # ================================================================ projects
    def linked_projects(self, user: User) -> list[tuple[Project, str]]:
        if user.role == "SUPPLIER":
            return [
                (project, DELIVERY)
                for project in self.repository.projects_by_id(self.repository.supplier_order_project_ids(user.id))
            ]
        if self.repository.is_store_manager(user):
            return [
                (project, STORE)
                for project in self.repository.projects_by_id(self.repository.store_request_project_ids(user.id))
                if self.serves(user, project)
            ]
        admin = self.admin_identity(user)
        if admin is not None and admin.has("projects.view"):
            return [(project, ADMIN) for project in self.repository.admin_projects(admin)]
        return []

    def list_projects(self, user: User) -> dict:
        self.require_installed()
        visible = [(project, MEMBER) for project in self.repository.accessible_projects(user)]
        members = {project.id for project, _ in visible}
        visible += [(project, access) for project, access in self.linked_projects(user) if project.id not in members]
        ids = [project.id for project, _ in visible]
        locations = self.repository.locations(ids)
        alerts: dict[int, list[WeatherAlert]] = {}
        for alert in self.repository.active_alerts_for(ids):
            alerts.setdefault(alert.project_id, []).append(alert)
        rows = []
        for project, access in visible:
            active = alerts.get(project.id, [])
            rows.append(
                {
                    "id": project.id,
                    "title": project.title,
                    "city": project.project_city,
                    "state": project.project_state,
                    "country": project.project_country,
                    "status": project.status,
                    "access": access,
                    "location": self.present_location(locations.get(project.id)),
                    "can_edit_location": access == MEMBER and self.can_edit_location(project, user),
                    "can_acknowledge": access == MEMBER,
                    "active_alerts": len(active),
                    "highest_severity": self.highest(active),
                }
            )
        personal_alerts = self.repository.active_alerts_of(Site(user=user))
        return {
            "projects": rows,
            "personal": {
                "location": self.present_location(self.repository.location_of(Site(user=user))),
                "active_alerts": len(personal_alerts),
                "highest_severity": self.highest(personal_alerts),
            },
            "severities": list(SEVERITIES),
            "alert_types": [{"code": code, "label": ALERT_TYPE_LABELS[code]} for code in ALERT_TYPES],
            "provider": self.settings.provider,
            "supports_official_alerts": self.settings.provider == "openweathermap",
        }

    @staticmethod
    def highest(alerts: list[WeatherAlert]) -> str | None:
        return max((alert.severity for alert in alerts), key=lambda value: SEVERITY_RANK[value], default=None)

    # ================================================================ locations
    def present_location(self, location: WeatherSiteLocation | None) -> dict | None:
        if location is None:
            return None
        return {
            "latitude": location.latitude,
            "longitude": location.longitude,
            "location_name": location.location_name,
            "country_code": location.country_code,
            "timezone": location.timezone,
            "source": location.source,
            "approximate": location.source == "AUTO_CITY",
            "updated_at": to_local_iso(location.updated_at),
        }

    def project_country_code(self, project: Project) -> str | None:
        return COUNTRY_CODES.get((project.project_country or "").strip().lower())

    def user_country_code(self, user: User) -> str | None:
        return COUNTRY_CODES.get((user.country_code or "").strip().lower())

    def site_country_code(self, site: Site) -> str | None:
        return (
            self.project_country_code(site.project) if site.project is not None else self.user_country_code(site.user)
        )

    def suggested_query(self, project: Project) -> str:
        return normalise_query(project.project_city or project.pincode or "")

    def personal_queries(self, user: User) -> list[str]:
        """Searches for an account's registered place, most specific first: each part
        of its resolved area ("Abids, Hyderabad, Telangana") as the search may spell
        it (query_variants), then its pincode."""
        parts = [variant for part in (user.location or "").split(",") for variant in query_variants(part)]
        return list(dict.fromkeys(text for text in [*parts, normalise_query(user.pincode or "")] if len(text) >= 2))

    def get_location(self, project_id: uuid.UUID, user: User) -> dict:
        project = self.project_for(project_id, user)
        return {
            "project_id": project.id,
            "project_title": project.title,
            "address": project.address,
            "city": project.project_city,
            "state": project.project_state,
            "pincode": project.pincode,
            "country": project.project_country,
            "suggested_query": self.suggested_query(project),
            "location": self.present_location(self.repository.location(project.id)),
            "can_edit_location": self.can_edit_location(project, user),
        }

    def set_location(self, project_id: uuid.UUID, user: User, payload) -> dict:
        project = self.project_for(project_id, user)
        if not self.can_edit_location(project, user):
            raise HTTPException(status_code=403, detail="Only the project's owner or builder can set the site location")
        self.save_location(Site(project=project), user, payload)
        return self.get_location(project.id, user)

    def save_location(self, site: Site, user: User, payload) -> WeatherSiteLocation:
        location = self.repository.location_of(site)
        if location is None:
            location = (
                WeatherSiteLocation(project_id=site.project.id)
                if site.project is not None
                else WeatherSiteLocation(user_id=site.user.id)
            )
            self.database.add(location)
        moved = (location.latitude, location.longitude) != (payload.latitude, payload.longitude)
        location.latitude = round(payload.latitude, 5)
        location.longitude = round(payload.longitude, 5)
        location.location_name = (payload.location_name or "").strip()[
            :255
        ] or f"{payload.latitude:.4f}, {payload.longitude:.4f}"
        location.country_code = (payload.country_code or "").strip().upper()[:2] or self.site_country_code(site)
        location.timezone = (payload.timezone or "").strip()[:64] or None
        location.source = payload.source
        location.updated_by_user_id = user.id
        location.updated_at = self.clock()
        if moved:
            snapshot = self.repository.snapshot_of(site)
            if snapshot is not None:
                snapshot.expires_at = self.clock()  # fetched again for the new place on the next read
        self.database.commit()
        logger.info("weather.location_set site=%s source=%s by=%s", site.key, location.source, user.id)
        return location

    def search_places(self, project_id: uuid.UUID, user: User, query: str | None) -> dict:
        project = self.project_for(project_id, user)
        return self.search(query, self.suggested_query(project), self.project_country_code(project))

    def search(self, query: str | None, suggested: str, country_code: str | None) -> dict:
        text = normalise_query(query or "") or suggested
        if len(text) < 2:
            return {"query": text, "results": []}
        try:
            results = self.lookup(text, None)
            if not results and "," in text:
                results = self.lookup(normalise_query(text.split(",")[0]), country_code)
        except WeatherProviderError as error:
            raise HTTPException(status_code=502, detail=error.reason) from None
        return {"query": text, "results": results}

    def lookup(self, text: str, country_code: str | None) -> list[dict]:
        """A place search, answered from the cache when the same search was made before."""
        key = f"{text.lower()}|{(country_code or '').upper()}"[:255]
        cached = self.repository.geocode(key)
        if cached is not None and (cached.results or cached.created_at > self.clock() - GEOCODE_MISS_RETRY):
            return list(cached.results or [])
        results = self.geocoder.search(text, country_code)
        if cached is None:
            cached = WeatherGeocodeCache(query_key=key)
            self.database.add(cached)
        cached.results = results
        cached.created_at = self.clock()
        try:
            self.database.commit()
        except IntegrityError:
            self.database.rollback()  # the same search was saved by another request meanwhile
        return results

    def lookup_postal(self, code: str, country_code: str | None) -> list[dict]:
        """A pincode as a place (Nominatim), cached like lookup(); a failed request
        is not cached, so it is asked again next time."""
        key = f"postal:{code}|{(country_code or '').upper()}"[:255]
        cached = self.repository.geocode(key)
        if cached is not None and (cached.results or cached.created_at > self.clock() - GEOCODE_MISS_RETRY):
            return list(cached.results or [])
        results = self.geocoder.postal_code(code, country_code)
        if results is None:
            return []
        if cached is None:
            cached = WeatherGeocodeCache(query_key=key)
            self.database.add(cached)
        cached.results = results
        cached.created_at = self.clock()
        try:
            self.database.commit()
        except IntegrityError:
            self.database.rollback()
        return results

    def locate_automatically(self, site: Site | Project) -> WeatherSiteLocation | None:
        """An approximate location, used only while nobody has set one: a project's
        city (else pincode), or an account's registered area (else pincode). Names
        go to the place search; a pincode it does not know is looked up as a postal
        code. The project's owner or builder, or the account itself, can refine it."""
        if isinstance(site, Project):
            site = Site(project=site)
        country = self.site_country_code(site)
        if site.project is not None:
            project = site.project
            state = (project.project_state or "").strip().lower()
            queries = dict.fromkeys(
                [*query_variants(project.project_city or ""), normalise_query(project.pincode or "")]
            )
        else:
            state = ""
            parts = [part.strip().lower() for part in (site.user.location or "").split(",") if part.strip()]
            if len(parts) > 1:
                state = parts[-1]
            queries = dict.fromkeys(self.personal_queries(site.user))
        pincode = normalise_query((site.project.pincode if site.project is not None else site.user.pincode) or "")
        for text in queries:
            if len(text) < 2:
                continue
            results = self.lookup(text, country)
            if not results and text == pincode and text.isdigit():
                results = self.lookup_postal(text, country)
            if not results:
                continue
            chosen = next((row for row in results if state and state in (row.get("name") or "").lower()), results[0])
            location = WeatherSiteLocation(
                latitude=chosen["latitude"],
                longitude=chosen["longitude"],
                location_name=chosen.get("name"),
                country_code=chosen.get("country_code") or country,
                timezone=chosen.get("timezone"),
                source="AUTO_CITY",
            )
            if site.project is not None:
                location.project_id = site.project.id
            else:
                location.user_id = site.user.id
            self.database.add(location)
            try:
                self.database.commit()
            except IntegrityError:
                self.database.rollback()
                return self.repository.location_of(site)
            logger.info("weather.location_auto site=%s place=%r", site.key, location.location_name)
            return location
        return None

    # ================================================================ weather
    def site(
        self, project: Project | Site, *, allow_fetch: bool = True
    ) -> tuple[WeatherSiteLocation | None, WeatherSnapshot | None]:
        site = project if isinstance(project, Site) else Site(project=project)
        location = self.repository.location_of(site)
        if location is None and allow_fetch:
            try:
                location = self.locate_automatically(site)
            except WeatherProviderError as error:
                logger.warning("weather.location_auto_failed site=%s: %s", site.key, error.reason)
        snapshot = self.repository.snapshot_of(site)
        if location is None or not allow_fetch:
            return location, snapshot
        if self.is_fresh(snapshot, location):
            return location, snapshot
        with _site_lock(site.key):
            self.database.expire_all()
            snapshot = self.repository.snapshot_of(site)
            if not self.is_fresh(snapshot, location) and not self.cooling_down(snapshot):
                snapshot = self.refresh(site, location, snapshot)
        return location, snapshot

    def is_fresh(self, snapshot: WeatherSnapshot | None, location: WeatherSiteLocation) -> bool:
        return bool(
            snapshot
            and snapshot.weather_data
            and snapshot.expires_at
            and snapshot.expires_at > self.clock()
            and snapshot.latitude == location.latitude
            and snapshot.longitude == location.longitude
        )

    def cooling_down(self, snapshot: WeatherSnapshot | None) -> bool:
        return bool(
            snapshot
            and snapshot.last_error
            and snapshot.last_attempt_at
            and snapshot.last_attempt_at > self.clock() - FAILURE_COOLDOWN
        )

    def refresh(
        self, site: Site | Project, location: WeatherSiteLocation, snapshot: WeatherSnapshot | None
    ) -> WeatherSnapshot:
        """Fetch the site's weather now, store it, and bring its alerts up to date."""
        if isinstance(site, Project):
            site = Site(project=site)
        now = self.clock()
        if snapshot is None:
            snapshot = (
                WeatherSnapshot(project_id=site.project.id)
                if site.project is not None
                else WeatherSnapshot(user_id=site.user.id)
            )
            self.database.add(snapshot)
        snapshot.last_attempt_at = now
        try:
            data = self.provider.fetch(location.latitude, location.longitude)
        except WeatherProviderError as error:
            snapshot.last_error = error.reason[:255]
            snapshot.last_error_at = now
            self.database.commit()
            logger.warning("weather.fetch_failed site=%s: %s", site.key, error.reason)
            if isinstance(error, WeatherRateLimited):
                raise
            return snapshot
        snapshot.provider = data.get("provider")
        snapshot.latitude, snapshot.longitude = location.latitude, location.longitude
        snapshot.weather_data = data
        snapshot.fetched_at = now
        snapshot.expires_at = now + timedelta(minutes=self.settings.weather_cache_minutes)
        snapshot.last_error = None
        snapshot.last_error_at = None
        emails = self.reconcile(site, location, data, now)
        self.database.commit()
        send_emails_later(emails)
        return snapshot

    def reconcile(self, site: Site, location: WeatherSiteLocation, data: dict, now: datetime) -> list[dict]:
        site.place_name = location.location_name
        thresholds = self.settings.thresholds_for(location.country_code)
        candidates = evaluate(data, thresholds, now.replace(tzinfo=UTC))
        active = {alert.event_key: alert for alert in self.repository.active_alerts_of(site)}
        announce: list[WeatherAlert] = []
        notifier = WeatherNotificationService(self.database, self.settings, self.repository)
        reopen_since = now - timedelta(hours=self.settings.weather_reopen_window_hours)
        seen = set()
        for candidate in candidates:
            key = candidate["event_key"]
            if key in seen:
                continue
            seen.add(key)
            alert = active.pop(key, None)
            if alert is None and self.settings.weather_reopen_window_hours:
                alert = self.repository.recently_resolved_of(site, key, reopen_since)
                if alert is not None:
                    alert.status = "ACTIVE"
                    alert.resolved_at = None
            if alert is None:
                alert = WeatherAlert(event_key=key, status="ACTIVE", created_at=now)
                if site.project is not None:
                    alert.project_id = site.project.id
                else:
                    alert.user_id = site.user.id
                self._fill(alert, candidate, now)
                try:
                    with self.database.begin_nested():
                        self.database.add(alert)
                except IntegrityError:
                    # Another process raised this event at the same moment; it is theirs to announce.
                    continue
            else:
                self._fill(alert, candidate, now)
            if self._should_announce(alert):
                announce.append(alert)
        for alert in active.values():
            alert.status = "EXPIRED" if alert.expected_end and alert.expected_end <= now else "RESOLVED"
            alert.resolved_at = now
            alert.updated_at = now
        self.database.flush()
        return notifier.announce(site, announce, now)

    def _should_announce(self, alert: WeatherAlert) -> bool:
        from app.modules.weather.weather_notification_service import should_notify

        return should_notify(alert, self.settings)

    @staticmethod
    def _fill(alert: WeatherAlert, candidate: dict, now: datetime) -> None:
        alert.alert_type = candidate["alert_type"]
        alert.severity = candidate["severity"]
        alert.source = candidate["source"]
        alert.title = candidate["title"][:200]
        alert.message = candidate["message"]
        alert.weather_condition = candidate.get("weather_condition")
        alert.metrics = candidate.get("metrics") or {}
        alert.expected_start = to_naive_utc(candidate.get("expected_start"))
        alert.expected_end = to_naive_utc(candidate.get("expected_end"))
        alert.provider_alert_id = candidate.get("provider_alert_id")
        alert.updated_at = now

    # ================================================================ readers
    def freshness(
        self, snapshot: WeatherSnapshot | None, location: WeatherSiteLocation | None, personal: bool = False
    ) -> dict:
        now = self.clock()
        fetched = snapshot.fetched_at if snapshot and snapshot.weather_data else None
        usable = bool(
            fetched
            and fetched > now - timedelta(minutes=self.settings.weather_max_stale_minutes)
            and location
            and snapshot.latitude == location.latitude
            and snapshot.longitude == location.longitude
        )
        stale = bool(usable and snapshot.expires_at and snapshot.expires_at <= now)
        error = snapshot.last_error if snapshot and snapshot.last_error else None
        if location is None:
            message = (
                "Choose a location to see its weather."
                if personal
                else "Set the project site location to see its weather."
            )
        elif not usable and error:
            message = "Weather data is unavailable right now."
        elif not usable:
            message = "Weather data is not available yet."
        elif stale:
            message = "Showing the last successful update; the weather service could not be reached."
        else:
            message = None
        return {
            "available": usable,
            "stale": stale,
            "location_required": location is None,
            "last_updated_at": to_local_iso(fetched),
            "last_error": error if error and (not usable or stale) else None,
            "message": message,
            "provider": (snapshot.provider if snapshot else None) or self.settings.provider,
        }

    def _site_view(self, site: Site, can_edit: bool, access: str):
        try:
            location, snapshot = self.site(site)
        except WeatherRateLimited:
            location, snapshot = self.repository.location_of(site), self.repository.snapshot_of(site)
        status = self.freshness(snapshot, location, personal=site.personal)
        data = snapshot.weather_data if status["available"] else None
        base = {
            "site": PERSONAL if site.personal else "project",
            "access": access,
            "project_id": site.project.id if site.project is not None else None,
            "project_title": site.project.title if site.project is not None else None,
            "location": self.present_location(location),
            "can_edit_location": can_edit,
            "can_acknowledge": access in (MEMBER, PERSONAL),
            "status": status,
            "timezone": data.get("timezone") if data else (location.timezone if location else None),
        }
        return base, data

    def _view(self, project_id: uuid.UUID, user: User):
        project, access = self.project_access(project_id, user)
        can_edit = access == MEMBER and self.can_edit_location(project, user)
        return (*self._site_view(Site(project=project), can_edit, access), project, access)

    def _personal_view(self, user: User):
        self.require_installed()
        site = Site(user=user)
        return (*self._site_view(site, True, PERSONAL), site)

    def _current(self, base, data) -> dict:
        return {**base, "kind": "observed", "current": data["current"] if data else None}

    def _hourly(self, base, data) -> dict:
        hours = []
        if data:
            now = self.clock().replace(tzinfo=UTC)
            for row in data.get("hourly") or []:
                try:
                    moment = datetime.fromisoformat(row["time"])
                except (KeyError, TypeError, ValueError):
                    continue
                if moment + timedelta(hours=1) > now and len(hours) < 24:
                    hours.append(row)
        return {**base, "kind": "forecast", "hours": hours}

    def _daily(self, base, data) -> dict:
        days = []
        if data:
            offset = timezone(timedelta(seconds=int(data.get("utc_offset_seconds") or 0)))
            today = self.clock().replace(tzinfo=UTC).astimezone(offset).date().isoformat()
            days = [row for row in data.get("daily") or [] if (row.get("date") or "") >= today][
                : self.settings.weather_forecast_days
            ]
        return {**base, "kind": "forecast", "days": days, "extended": len(days) > 7}

    def current(self, project_id: uuid.UUID, user: User) -> dict:
        base, data, _, _ = self._view(project_id, user)
        return self._current(base, data)

    def hourly(self, project_id: uuid.UUID, user: User) -> dict:
        base, data, _, _ = self._view(project_id, user)
        return self._hourly(base, data)

    def daily(self, project_id: uuid.UUID, user: User) -> dict:
        base, data, _, _ = self._view(project_id, user)
        return self._daily(base, data)

    # ================================================================ my location
    def my_current(self, user: User) -> dict:
        base, data, _ = self._personal_view(user)
        return self._current(base, data)

    def my_hourly(self, user: User) -> dict:
        base, data, _ = self._personal_view(user)
        return self._hourly(base, data)

    def my_daily(self, user: User) -> dict:
        base, data, _ = self._personal_view(user)
        return self._daily(base, data)

    def my_alerts(self, user: User) -> dict:
        base, _, site = self._personal_view(user)  # brings the alerts up to date if the cache had expired
        active = self.sort_active(self.repository.active_alerts_of(site))
        return {**base, "alerts": self.present_alerts(active, user, {})}

    def my_suggested_query(self, user: User) -> str:
        queries = self.personal_queries(user)
        return queries[0] if queries else ""

    def get_my_location(self, user: User) -> dict:
        self.require_installed()
        return {
            "site": PERSONAL,
            "suggested_query": self.my_suggested_query(user),
            "location": self.present_location(self.repository.location_of(Site(user=user))),
            "can_edit_location": True,
        }

    def set_my_location(self, user: User, payload) -> dict:
        self.require_installed()
        self.save_location(Site(user=user), user, payload)
        return self.get_my_location(user)

    def search_my_places(self, user: User, query: str | None) -> dict:
        self.require_installed()
        return self.search(query, self.my_suggested_query(user), self.user_country_code(user))

    # ================================================================ summary
    def summary(self, user: User, site: str | None = None) -> dict:
        """The application-wide header indicator: the weather at one place this
        account may read, with its presentation and next hours, and the most serious
        active WARNING/SEVERE alerts across every site it may read (its own place and
        the projects /weather/projects lists).

        `site` is "me" (the account's own place) or a project id, read under the same
        rules as that project's Weather page. Without it: the project the account
        works on as a member (the one with the most serious active alert, else the
        first with a weather location), else its own place."""
        self.require_installed()
        visible = [(project, MEMBER) for project in self.repository.accessible_projects(user)]
        members = {project.id for project, _ in visible}
        visible += [(project, access) for project, access in self.linked_projects(user) if project.id not in members]
        titles = {project.id: project.title for project, _ in visible}
        if site is None and members:
            # The member project whose weather matters most now: the most serious
            # active alert first, then the first with a weather location.
            located = self.repository.locations(list(members))
            worst: dict[int, int] = {}
            for alert in self.repository.active_alerts_for(list(members)):
                worst[alert.project_id] = max(worst.get(alert.project_id, 0), SEVERITY_RANK.get(alert.severity, 0))
            ranked = sorted(
                (project for project, access in visible if access == MEMBER),
                key=lambda project: (-worst.get(project.id, 0), project.id not in located),
            )
            site = str(ranked[0].id)
        if site is None or site == "me":
            base, data, chosen = self._personal_view(user)
            choice = {"key": "me", "label": None, "access": PERSONAL}
        else:
            base, data, project, access = self._view(uuid.UUID(site), user)
            chosen = Site(project=project)
            titles.setdefault(project.id, project.title)
            choice = {"key": project.id, "label": project.title, "access": access}
        own = self.repository.active_alerts_of(chosen)
        thresholds = self.settings.thresholds_for(
            base["location"]["country_code"] if base["location"] else self.site_country_code(chosen)
        )
        everywhere = {
            alert.id: alert
            for alert in [
                *self.repository.active_alerts_of(Site(user=user)),
                *self.repository.active_alerts_for(list(titles)),
            ]
        }
        serious = [
            alert for alert in everywhere.values() if SEVERITY_RANK.get(alert.severity, 0) >= SEVERITY_RANK["WARNING"]
        ]
        serious = self.sort_active(serious)[:5]
        today = None
        if data:
            offset = timezone(timedelta(seconds=int(data.get("utc_offset_seconds") or 0)))
            today_date = self.clock().replace(tzinfo=UTC).astimezone(offset).date().isoformat()
            today = next((row for row in data.get("daily") or [] if (row.get("date") or "") >= today_date), None)
        return {
            "site": choice,
            "location": base["location"],
            "status": base["status"],
            "next_hours": [
                {
                    key: row.get(key)
                    for key in (
                        "time",
                        "temperature_c",
                        "precipitation_probability_pct",
                        "precipitation_mm",
                        "condition",
                    )
                }
                for row in self._hourly(base, data)["hours"][:6]
            ],
            "current": {
                key: data["current"].get(key)
                for key in (
                    "observed_at",
                    "temperature_c",
                    "feels_like_c",
                    "humidity_pct",
                    "wind_speed_kmh",
                    "wind_gust_kmh",
                    "wind_direction_deg",
                    "precipitation_mm",
                    "precipitation_probability_pct",
                    "condition",
                    "is_day",
                )
            }
            if data
            else None,
            "today": {
                key: today.get(key)
                for key in (
                    "date",
                    "temp_min_c",
                    "temp_max_c",
                    "precipitation_probability_pct",
                    "precipitation_mm",
                    "condition",
                )
            }
            if today
            else None,
            "presentation": presentation(
                {**data, "daily": [today] if today else []} if data else None,
                thresholds,
                [
                    {
                        "alert_type": alert.alert_type,
                        "severity": alert.severity,
                        "title": alert.title,
                        "message": alert.message,
                    }
                    for alert in own
                ],
            ),
            "alerts": [
                {
                    "id": alert.id,
                    "site": PERSONAL if alert.project_id is None else "project",
                    "project_id": alert.project_id,
                    "site_label": titles.get(alert.project_id) if alert.project_id is not None else None,
                    "alert_type": alert.alert_type,
                    "severity": alert.severity,
                    "title": alert.title,
                    "message": alert.message,
                }
                for alert in serious
            ],
        }

    # ================================================================ alerts
    def present_alerts(
        self, alerts: list[WeatherAlert], user: User, projects: dict[int, Project], access: dict[int, str] | None = None
    ) -> list[dict]:
        """Alerts as the page shows them. `access` says how the account reads each
        project (member when missing); who acknowledged is shown to members and
        administrators only."""
        access = access or {}
        acknowledgements = self.repository.acknowledgements([alert.id for alert in alerts])
        offsets = {}
        rows = []
        for alert in alerts:
            site_key = (alert.project_id, str(alert.user_id) if alert.user_id else None)
            if site_key not in offsets:
                snapshot = (
                    self.repository.snapshot(alert.project_id)
                    if alert.project_id is not None
                    else self.repository.personal_snapshot(alert.user_id)
                )
                seconds = (
                    (snapshot.weather_data or {}).get("utc_offset_seconds")
                    if snapshot and snapshot.weather_data
                    else None
                )
                offsets[site_key] = timezone(timedelta(seconds=int(seconds))) if seconds is not None else None
            offset = offsets[site_key]

            def site_time(value):
                if value is None:
                    return None
                aware = value.replace(tzinfo=UTC)
                return aware.astimezone(offset).isoformat() if offset else to_local_iso(value)

            personal = alert.project_id is None
            how = PERSONAL if personal else access.get(alert.project_id, MEMBER)
            acks = acknowledgements.get(alert.id, [])
            project = projects.get(alert.project_id)
            rows.append(
                {
                    "id": alert.id,
                    "site": PERSONAL if personal else "project",
                    "project_id": alert.project_id,
                    "project_title": project.title if project else None,
                    "alert_type": alert.alert_type,
                    "type_label": ALERT_TYPE_LABELS.get(alert.alert_type, alert.alert_type),
                    "severity": alert.severity,
                    "source": alert.source,
                    "title": alert.title,
                    "message": alert.message,
                    "weather_condition": alert.weather_condition,
                    "metrics": alert.metrics or {},
                    "recommendations": recommendations_for(alert.alert_type, alert.severity),
                    "expected_start": site_time(alert.expected_start),
                    "expected_end": site_time(alert.expected_end),
                    "status": alert.status,
                    "created_at": to_local_iso(alert.created_at),
                    "updated_at": to_local_iso(alert.updated_at),
                    "resolved_at": to_local_iso(alert.resolved_at),
                    "can_acknowledge": how in (MEMBER, PERSONAL),
                    "acknowledged": any(ack.user_id == user.id for ack, _ in acks),
                    "acknowledged_at": next(
                        (to_local_iso(ack.acknowledged_at) for ack, _ in acks if ack.user_id == user.id), None
                    ),
                    "acknowledgements": [
                        {"name": name, "acknowledged_at": to_local_iso(ack.acknowledged_at)} for ack, name in acks
                    ]
                    if how in (MEMBER, ADMIN)
                    else [],
                }
            )
        return rows

    @staticmethod
    def sort_active(alerts: list[WeatherAlert]) -> list[WeatherAlert]:
        return sorted(
            alerts, key=lambda alert: (-SEVERITY_RANK.get(alert.severity, 0), alert.expected_start or datetime.max)
        )

    def alerts(self, project_id: uuid.UUID, user: User) -> dict:
        base, _, project, access = self._view(project_id, user)  # brings the alerts up to date if the cache had expired
        active = self.sort_active(self.repository.active_alerts(project_id))
        return {**base, "alerts": self.present_alerts(active, user, {project.id: project}, {project.id: access})}

    def history(
        self,
        user: User,
        *,
        project_id=None,
        site=None,
        alert_type=None,
        severity=None,
        status=None,
        date_from=None,
        date_to=None,
        acknowledged=None,
        page=1,
        page_size=25,
    ) -> dict:
        """The account's own place's alerts and its member projects' alerts.
        site=personal narrows it to the own place, project_id to one project."""
        self.require_installed()
        projects = {project.id: project for project in self.repository.accessible_projects(user)}
        personal_user_id = user.id
        if site is not None and site != PERSONAL:
            raise HTTPException(status_code=422, detail="Unknown site")
        if project_id is not None:
            if project_id not in projects:
                ensure_project_activity_read_access(self.database, project_id, user)  # 404 or 403
            ids = [project_id]
            personal_user_id = None
        elif site == PERSONAL:
            ids = []
        else:
            ids = list(projects)
        if alert_type and alert_type not in ALERT_TYPES:
            raise HTTPException(status_code=422, detail="Unknown alert type")
        if severity and severity not in SEVERITIES:
            raise HTTPException(status_code=422, detail="Unknown severity")
        if status and status not in ALERT_STATUSES:
            raise HTTPException(status_code=422, detail="Unknown status")
        start = datetime.combine(date_from, datetime.min.time()) if date_from else None
        end = datetime.combine(date_to, datetime.min.time()) + timedelta(days=1) if date_to else None
        page = max(1, page)
        page_size = min(100, max(1, page_size))
        filters = dict(
            personal_user_id=personal_user_id,
            alert_type=alert_type,
            severity=severity,
            status=status,
            date_from=start,
            date_to=end,
        )
        if acknowledged is None:
            rows, total = self.repository.history(ids, **filters, offset=(page - 1) * page_size, limit=page_size)
            presented = self.present_alerts(rows, user, projects)
        else:
            rows, _ = self.repository.history(ids, **filters, offset=0, limit=5000)
            presented = [
                row for row in self.present_alerts(rows, user, projects) if row["acknowledged"] == acknowledged
            ]
            total = len(presented)
            presented = presented[(page - 1) * page_size : page * page_size]
        return {"alerts": presented, "total": total, "page": page, "page_size": page_size}

    def acknowledge(self, alert_id: uuid.UUID, user: User) -> dict:
        self.require_installed()
        alert = self.repository.alert(alert_id)
        if alert is None or (alert.user_id is not None and alert.user_id != user.id):
            # Another account's own place is not theirs to know about.
            raise HTTPException(status_code=404, detail="Alert not found")
        projects = {}
        if alert.project_id is not None:
            project = ensure_project_activity_read_access(self.database, alert.project_id, user)
            projects[project.id] = project
        if self.repository.acknowledgement(alert.id, user.id) is None:
            try:
                with self.database.begin_nested():
                    self.database.add(
                        WeatherAlertAcknowledgement(alert_id=alert.id, user_id=user.id, acknowledged_at=self.clock())
                    )
            except IntegrityError:
                pass  # acknowledged twice at once: one row is enough
            self.database.commit()
        return self.present_alerts([alert], user, projects)[0]

    # ================================================================ monitor
    def monitor_project(self, project: Project) -> str:
        return self.monitor_site(Site(project=project))

    def monitor_site(self, site: Site) -> str:
        """One monitoring check of one site. Returns what happened."""
        location = self.repository.location_of(site)
        if location is None:
            location = self.locate_automatically(site)
            if location is None:
                return "no-location"
        snapshot = self.repository.snapshot_of(site)
        if not self.monitor_due(site, snapshot, location):
            return "not-due"
        with _site_lock(site.key):
            self.database.expire_all()
            snapshot = self.repository.snapshot_of(site)
            if not self.monitor_due(site, snapshot, location):
                return "not-due"
            if self.cooling_down(snapshot):
                return "cooling-down"
            snapshot = self.refresh(site, location, snapshot)
        return "failed" if snapshot.last_error else "refreshed"

    def monitor_due(self, site: Site | int, snapshot: WeatherSnapshot | None, location: WeatherSiteLocation) -> bool:
        if not self.is_fresh(snapshot, location) or snapshot.fetched_at is None:
            return True
        age = self.clock() - snapshot.fetched_at
        if age >= timedelta(minutes=max(1, self.settings.weather_monitoring_interval_minutes) - 1):
            return True
        active = (
            self.repository.active_alerts(site) if isinstance(site, int) else self.repository.active_alerts_of(site)
        )
        serious = any(SEVERITY_RANK.get(alert.severity, 0) >= SEVERITY_RANK["WARNING"] for alert in active)
        return serious and age >= timedelta(minutes=self.settings.weather_severe_check_interval_minutes)

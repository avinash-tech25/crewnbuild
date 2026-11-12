"""Telling the right people about a weather alert.

A project site's alert goes to:

    its House Owner, awarded builder and active Site Engineers   (category PROJECT)
    Store Managers with an open site request for it, and
    Suppliers with an open order for it                         WARNING and SEVERE
    administrators whose country scope holds it and who have
    projects.view                                               SEVERE only

and a personal site's ("My location") alert to its own account only. Everyone
outside the project's own people gets it as category ANNOUNCEMENT, so their
dashboards' project badges are untouched.

In-app notifications go through the existing notification table and bell
(create_notification) plus a live hint so open dashboards refresh. They are written in the same transaction as the alert, so an alert is
announced exactly when it is saved, and only once per severity: the alert
remembers the severity it was announced at (notified_severity), and is announced
again only if it escalates.

E-mail is optional (WEATHER_EMAIL_ALERTS_ENABLED, off by default) and uses the
existing SMTP sender, for WARNING and SEVERE only, after the commit and off the
request thread. There is no push channel in the application, and WhatsApp is not
used for weather.
"""

import logging
import threading

from sqlalchemy.orm import Session

from app.modules.admin.admin_identity import AdminIdentity
from app.modules.identity.models import User
from app.modules.messaging.live_events import queue_live_hint
from app.modules.messaging.notifications import add_notification as create_notification
from app.modules.weather.models import SEVERITY_RANK, WeatherAlert
from app.modules.weather.project_links import project_locality, store_manager_serves_project
from app.modules.weather.repository import WeatherRepository
from app.modules.weather.weather_settings import WeatherSettings

logger = logging.getLogger(__name__)

TITLE_LIMIT = 160


# The lowest severity each kind of recipient outside the project's own people is told about.
LINKED_MIN_SEVERITY = "WARNING"
ADMIN_MIN_SEVERITY = "SEVERE"


def notification_text(alert: WeatherAlert, site) -> tuple[str, str]:
    if alert.severity == "SEVERE":
        title = f"SEVERE WEATHER ALERT – {alert.title}"
        closing = "Please take appropriate precautions and follow official weather advisories."
    else:
        title = f"Weather Alert – {alert.title}"
        closing = (
            "Please review outdoor construction activities."
            if site.project is not None
            else "Please plan outdoor work accordingly."
        )
    where = (
        f"Project: {site.project.title}"
        if site.project is not None
        else f"Location: {site.place_name or 'your weather location'}"
    )
    body = f"{alert.message}\n\n{where}\n\n{closing}"
    return title[:TITLE_LIMIT], body


def should_notify(alert: WeatherAlert, settings: WeatherSettings) -> bool:
    minimum = SEVERITY_RANK.get(settings.weather_notify_min_severity.strip().upper(), SEVERITY_RANK["WATCH"])
    rank = SEVERITY_RANK.get(alert.severity, 0)
    announced = SEVERITY_RANK.get(alert.notified_severity, -1) if alert.notified_severity else -1
    return rank >= minimum and rank > announced


class WeatherNotificationService:
    def __init__(self, database: Session, settings: WeatherSettings, repository: WeatherRepository | None = None):
        self.database = database
        self.settings = settings
        self.repository = repository or WeatherRepository(database)

    def recipients(self, site) -> list[tuple[User, str, str]]:
        """(account, category, lowest severity it is told about) for a site, each account once."""
        if site.project is None:
            return [(site.user, "ANNOUNCEMENT", "INFO")] if (site.user.status or "ACTIVE").upper() == "ACTIVE" else []
        project = site.project
        chosen: dict = {}
        for user in self.repository.project_recipients(project):
            chosen[user.id] = (user, "PROJECT", "INFO")
        linked = self.repository.supplier_order_recipient_ids(project.id) | {
            user_id for user_id in self.repository.store_request_recipient_ids(project.id)
        }
        for user in self.repository.users_by_id(linked - set(chosen)):
            if user.role == "SUPPLIER" or (
                self.repository.is_store_manager(user) and store_manager_serves_project(self.database, user, project)
            ):
                chosen[user.id] = (user, "ANNOUNCEMENT", LINKED_MIN_SEVERITY)
        locality = project_locality(project)
        for user, profile in self.repository.active_admins():
            if user.id in chosen:
                continue
            admin = AdminIdentity(user, profile)
            if admin.has("projects.view") and admin.may_reach(locality):
                chosen[user.id] = (user, "ANNOUNCEMENT", ADMIN_MIN_SEVERITY)
        return list(chosen.values())

    def announce(self, site, alerts: list[WeatherAlert], now) -> list[dict]:
        """Write the in-app notifications (in the caller's transaction) and return
        the e-mails to send once it commits."""
        emails = []
        recipients = self.recipients(site) if alerts else []
        for alert in alerts:
            title, body = notification_text(alert, site)
            rank = SEVERITY_RANK.get(alert.severity, 0)
            told = 0
            for user, category, minimum in recipients:
                if rank < SEVERITY_RANK[minimum]:
                    continue
                told += 1
                # Literal categories, so the static category check can read them.
                if category == "PROJECT":
                    create_notification(self.database, user.id, title, body, category="PROJECT")
                else:
                    create_notification(self.database, user.id, title, body, category="ANNOUNCEMENT")
                queue_live_hint(self.database, user.id)
                if (
                    self.settings.weather_email_alerts_enabled
                    and alert.severity in ("WARNING", "SEVERE")
                    and user.email
                ):
                    emails.append({"to": user.email, "subject": title, "body": body})
            alert.notified_severity = alert.severity
            alert.notified_at = now
            logger.info(
                "weather.alert_announced site=%s alert=%s severity=%s recipients=%s",
                site.key,
                alert.id,
                alert.severity,
                told,
            )
        return emails


def send_emails_later(emails: list[dict]) -> None:
    if not emails:
        return

    def send() -> None:
        from app.core.config import get_settings
        from app.integrations.email.email_sender import EmailSender

        service = EmailSender(get_settings())
        for email in emails:
            try:
                service.send_email(email["to"], email["subject"], email["body"])
            except Exception:
                logger.exception("weather.alert_email_failed")

    threading.Thread(target=send, name="weather-alert-email", daemon=True).start()

"""Sending mail over SMTP (the old Partner app/shared/email/services/email_service.py).

Partner has its own SMTP settings (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD,
SMTP_FROM_NAME, SMTP_USE_TLS). Each failure stage is logged by name; the password and the
message bodies (which carry codes) never are.
"""

import logging
import smtplib
from email.message import EmailMessage
from email.utils import formataddr
from typing import Protocol

from app.core.config import Settings

logger = logging.getLogger(__name__)


class EmailSender(Protocol):
    @property
    def configured(self) -> bool: ...

    def send(self, to_email: str, subject: str, text_body: str, html_body: str | None = None) -> bool: ...


class SmtpEmailSender:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    @property
    def configured(self) -> bool:
        return self.settings.email_configured

    def send(self, to_email: str, subject: str, text_body: str, html_body: str | None = None) -> bool:
        settings = self.settings
        if not self.configured:
            logger.warning("Email is not configured (SMTP_HOST, SMTP_USER, SMTP_PASSWORD); not sending.")
            return False
        message = EmailMessage()
        message["Subject"] = subject
        message["From"] = formataddr((settings.smtp_from_name, settings.smtp_user))
        message["To"] = to_email
        message.set_content(text_body)
        if html_body:
            message.add_alternative(html_body, subtype="html")
        stage = f"connecting to {settings.smtp_host}:{settings.smtp_port}"
        try:
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as server:
                if settings.smtp_use_tls:
                    stage = "starting TLS"
                    server.starttls()
                stage = "authenticating"
                server.login(settings.smtp_user, settings.smtp_password.get_secret_value())
                stage = "sending"
                server.send_message(message)
            logger.info("Email sent.")
            return True
        except smtplib.SMTPAuthenticationError as error:
            logger.error("SMTP authentication failed (%s). Check SMTP_USER / SMTP_PASSWORD.", error.smtp_code)
        except smtplib.SMTPRecipientsRefused:
            logger.error("SMTP server refused the recipient.")
        except (OSError, smtplib.SMTPException) as error:
            logger.error("SMTP failed while %s: %s", stage, type(error).__name__)
        return False

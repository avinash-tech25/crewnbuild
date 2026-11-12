"""Outgoing e-mail: Resend first when RESEND_API_KEY is set, then SMTP.

Ported from the old app/shared/email/services/email_service.py. Resend is now called
over its HTTP API with httpx instead of the `resend` package (which the old
requirements never installed, so it always fell back to SMTP). Never logged: the SMTP
password, the API key or a message body (it carries the code).
"""

import logging
import smtplib
from email.message import EmailMessage
from email.utils import formataddr
from html import escape

import httpx

from app.core.config import Settings

logger = logging.getLogger(__name__)

RESEND_URL = "https://api.resend.com/emails"
RESEND_SENDER_ADDRESS = "onboarding@resend.dev"
TIMEOUT_SECONDS = 15


class EmailSender:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    @property
    def resend_api_key(self) -> str:
        return self.settings.resend_api_key.get_secret_value()

    @property
    def configured(self) -> bool:
        settings = self.settings
        smtp_ready = settings.smtp_host and settings.smtp_user and settings.smtp_password.get_secret_value()
        return bool(self.resend_api_key) or bool(smtp_ready)

    def send_email(self, to_email: str, subject: str, text_body: str, html_body: str | None = None) -> bool:
        if not self.configured:
            logger.warning(
                "Email service is not configured (SMTP_HOST, SMTP_USER and SMTP_PASSWORD are required); skipping"
            )
            return False
        if self.resend_api_key and self.send_via_resend(to_email, subject, text_body, html_body):
            return True
        return self.send_via_smtp(to_email, subject, text_body, html_body)

    def send_via_resend(self, to_email: str, subject: str, text_body: str, html_body: str | None) -> bool:
        payload: dict[str, object] = {
            "from": f"{self.settings.smtp_from_name} <{RESEND_SENDER_ADDRESS}>",
            "to": [to_email],
            "subject": subject,
            "text": text_body,
        }
        if html_body:
            payload["html"] = html_body
        try:
            response = httpx.post(
                RESEND_URL,
                json=payload,
                headers={"Authorization": f"Bearer {self.resend_api_key}"},
                timeout=TIMEOUT_SECONDS,
            )
            response.raise_for_status()
        except httpx.HTTPError as error:
            logger.warning("Resend failed (%s), falling back to SMTP", type(error).__name__)
            return False
        logger.info("Email sent through Resend")
        return True

    def send_via_smtp(self, to_email: str, subject: str, text_body: str, html_body: str | None) -> bool:
        settings = self.settings
        password = settings.smtp_password.get_secret_value()
        if not settings.smtp_host or not settings.smtp_user or not password:
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
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=TIMEOUT_SECONDS) as server:
                if settings.smtp_use_tls:
                    stage = "starting TLS"
                    server.starttls()
                stage = "authenticating"
                server.login(settings.smtp_user, password)
                stage = "sending"
                server.send_message(message)
        except smtplib.SMTPAuthenticationError as error:
            logger.error("SMTP authentication failed (%s). Check SMTP_USER / SMTP_PASSWORD.", error.smtp_code)
        except smtplib.SMTPSenderRefused as error:
            logger.error("SMTP server refused the sender (%s).", error.smtp_code)
        except smtplib.SMTPRecipientsRefused:
            logger.error("SMTP server refused the recipient.")
        except (OSError, smtplib.SMTPException) as error:
            logger.error("SMTP failed while %s: %s", stage, type(error).__name__)
        else:
            logger.info("Email sent via %s:%s", settings.smtp_host, settings.smtp_port)
            return True
        return False

    def send_welcome_email(self, to_email: str, name: str | None = None) -> bool:
        display_name = (name or "there").strip() or "there"
        subject = "Welcome to CREWNBUILD"
        text_body = (
            f"Hi {display_name},\n\n"
            "Congratulations, you have created an account in CREWNBUILD.\n\n"
            "You can now manage your construction journey from your dashboard.\n\n"
            "Regards,\n"
            "CREWNBUILD"
        )
        html_body = f"""
        <div style="font-family:Arial,sans-serif;line-height:1.55;color:#10231b">
          <h2 style="margin:0 0 12px;color:#0f3d2a">Congratulations, {escape(display_name)}!</h2>
          <p>You have created an account in <strong>CREWNBUILD</strong>.</p>
          <p>You can now manage your construction journey from your dashboard.</p>
          <p style="margin-top:24px">Regards,<br><strong>CREWNBUILD</strong></p>
        </div>
        """
        return self.send_email(to_email, subject, text_body, html_body)

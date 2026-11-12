"""Approved WhatsApp templates through the Dovesoft direct API.

Ported from the old app/shared/whatsapp/services/dovesoft_client.py with the same
contract:

* template_body    the request body, built in code
* auth_headers     WHATSAPP_AUTH_HEADER carries the key (with WHATSAPP_AUTH_SCHEME, if
                   set); WHATSAPP_SENDER_HEADER carries the sender number
* accepted         WHATSAPP_SUCCESS_FIELD must hold WHATSAPP_SUCCESS_VALUE

Nothing is a default: left blank, each refuses (WhatsAppNotReadyError), so no request is
ever sent with a guessed header and no reply is read as a guessed success. "Accepted"
is Dovesoft taking the request; delivery to the handset is never known here. The API key
is never logged, returned or sent anywhere but the configured Dovesoft address.
"""

import logging
import re
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

import httpx

from app.core.config import Settings
from app.integrations.whatsapp.response_field_path import field_at, parse_path

logger = logging.getLogger(__name__)

INDIA_COUNTRY_CODE = "91"
SNIPPET_LIMIT = 120

AUTH_UNCONFIRMED = (
    "WHATSAPP_AUTH_HEADER is not set: the name of the header Dovesoft reads the API key from has not "
    "been configured, so no WhatsApp message was sent."
)
CONTRACT_UNCONFIRMED = (
    "WHATSAPP_SUCCESS_FIELD is not set: the field of Dovesoft's reply that confirms a message was "
    "accepted has not been configured, so no message was sent."
)
CONTRACT_MALFORMED = (
    "WHATSAPP_SUCCESS_FIELD is not a field path: it may hold only object keys and list indexes, "
    "as in messages[0].message_status, so no message was sent."
)


class WhatsAppNotReadyError(RuntimeError):
    """The Dovesoft request contract is not configured, so nothing is sent."""


class SendOutcome(StrEnum):
    NOT_CONFIGURED = "not_configured"  # integration off, or URL / key / sender number blank
    REJECTED = "rejected"  # Dovesoft answered with a refusal
    INVALID_RESPONSE = "invalid_response"  # a 2xx that does not confirm acceptance
    UNREACHABLE = "unreachable"  # no connection: the request certainly never arrived
    UNCERTAIN = "uncertain"  # the request may have arrived and no usable answer came back
    ACCEPTED = "accepted"


# Failures before a byte of the request reaches the provider. Any other transport
# failure may have left a request Dovesoft went on to process: uncertain, not "not sent".
NEVER_SENT_ERRORS = (
    httpx.ConnectError,
    httpx.ConnectTimeout,
    httpx.PoolTimeout,
    httpx.ProxyError,
    httpx.UnsupportedProtocol,
)


@dataclass(frozen=True)
class SendResult:
    outcome: SendOutcome
    http_status: int | None = None

    @property
    def accepted(self) -> bool:
        return self.outcome is SendOutcome.ACCEPTED

    @property
    def uncertain(self) -> bool:
        return self.outcome is SendOutcome.UNCERTAIN


def template_body(
    phone: str, template: str, variables: list[str], language: str, url_button: str | None = None
) -> dict[str, Any]:
    components: list[dict[str, Any]] = [
        {"type": "body", "parameters": [{"type": "text", "text": str(value)} for value in variables]}
    ]
    if url_button is not None:
        components.append(
            {
                "type": "button",
                "sub_type": "url",
                "index": 0,
                "parameters": [{"type": "text", "text": str(url_button)}],
            }
        )
    return {
        "messaging_product": "whatsapp",
        "to": f"{INDIA_COUNTRY_CODE}{phone}",
        "type": "template",
        "template": {
            "name": template,
            "language": {"code": language, "policy": "deterministic"},
            "components": components,
        },
        "templateName": template,
    }


def redact(text: str, secret: str = "") -> str:
    """A fragment of a provider reply made safe for the log."""
    if secret and secret in text:
        text = text.replace(secret, "[key]")
    text = re.sub(r"\d{3,}", "#", text)
    return " ".join(text.split())


def response_shape(response: httpx.Response, secret: str = "") -> str:
    """What a reply looked like, for the log, never a JSON value."""
    status = response.status_code
    media_type = response.headers.get("content-type") or "no content-type"
    size = len(response.content)
    try:
        data = response.json()
    except ValueError:
        opening = redact(response.text[: SNIPPET_LIMIT * 4], secret)[:SNIPPET_LIMIT]
        detail = f'starts "{opening}"' if opening else "empty body"
        names = ", ".join(sorted({name.lower() for name in response.headers})) or "none"
        return f"HTTP {status}, not JSON ({media_type}, {size} bytes, {detail}; reply headers: {names})"
    if isinstance(data, dict):
        fields = ", ".join(sorted(map(str, data))) or "none"
        return f"HTTP {status}, JSON fields: {fields} ({media_type}, {size} bytes)"
    return f"HTTP {status}, JSON {type(data).__name__} ({media_type}, {size} bytes)"


def provider_errors(response: httpx.Response) -> str:
    """Dovesoft's own refusal inside a 2xx ([{"errorCode": ..., "errorDescription": ...}])."""
    try:
        data = response.json()
    except ValueError:
        return ""
    if not isinstance(data, list) or not data:
        return ""
    entries = [item for item in data if isinstance(item, dict) and ("errorCode" in item or "errorDescription" in item)]
    if len(entries) != len(data):
        return ""
    return "; ".join(
        f"code {item.get('errorCode', '?')}: {redact(str(item.get('errorDescription', '')))[:80] or '-'}"
        for item in entries
    )


def mask_phone(phone: str) -> str:
    """Enough of a number to tell two log lines apart, never the whole number."""
    digits = "".join(character for character in (phone or "") if character.isdigit())
    return f"******{digits[-4:]}" if len(digits) >= 4 else "******"


class DovesoftWhatsAppClient:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    @property
    def configured(self) -> bool:
        settings = self.settings
        return bool(
            settings.whatsapp_enabled
            and (settings.whatsapp_api_url or "").strip()
            and settings.whatsapp_api_key.get_secret_value().strip()
            and (settings.whatsapp_waba_number or "").strip()
        )

    def send_template(self, phone: str, template: str, variables: list[str], language: str | None = None) -> bool:
        return self.send(phone, template, variables, language).accepted

    def send(self, phone: str, template: str, variables: list[str], language: str | None = None) -> SendResult:
        """One request, never retried: a retry after an unknown outcome could send a
        second code, so that choice is the caller's."""
        if not self.configured or not (template or "").strip():
            logger.warning(
                "WhatsApp is not configured; template %s was not sent to %s", template or "-", mask_phone(phone)
            )
            return SendResult(SendOutcome.NOT_CONFIGURED)
        self.success_path()
        request = self.build_template_request(
            phone, template.strip(), variables, language or self.settings.whatsapp_default_lang
        )
        try:
            with httpx.Client(timeout=self.settings.whatsapp_timeout_seconds) as client:
                response = client.send(request)
        except NEVER_SENT_ERRORS as error:
            logger.warning(
                "WhatsApp template %s to %s was not sent, the provider could not be reached: %s",
                template,
                mask_phone(phone),
                type(error).__name__,
            )
            return SendResult(SendOutcome.UNREACHABLE)
        except httpx.HTTPError as error:
            logger.warning(
                "WhatsApp template %s to %s got no usable reply (%s); whether the provider received it is unknown",
                template,
                mask_phone(phone),
                type(error).__name__,
            )
            return SendResult(SendOutcome.UNCERTAIN)
        if not response.is_success:
            logger.warning(
                "WhatsApp template %s to %s was refused by the provider: %s",
                template,
                mask_phone(phone),
                self.describe(response),
            )
            return SendResult(SendOutcome.REJECTED, response.status_code)
        if not response.content.strip():
            logger.warning(
                "WhatsApp template %s to %s: empty reply, so whether the provider accepted it is unknown: %s",
                template,
                mask_phone(phone),
                self.describe(response),
            )
            return SendResult(SendOutcome.UNCERTAIN, response.status_code)
        refusal = provider_errors(response)
        if refusal:
            logger.warning(
                "WhatsApp template %s to %s was refused by the provider (HTTP %s): %s",
                template,
                mask_phone(phone),
                response.status_code,
                refusal,
            )
            return SendResult(SendOutcome.REJECTED, response.status_code)
        if not self.accepted(response):
            logger.warning(
                "WhatsApp template %s to %s: the reply did not confirm acceptance (HTTP %s)",
                template,
                mask_phone(phone),
                response.status_code,
            )
            return SendResult(SendOutcome.INVALID_RESPONSE, response.status_code)
        if self.settings.whatsapp_debug:
            logger.info(
                "WhatsApp template %s accepted for %s (HTTP %s)", template, mask_phone(phone), response.status_code
            )
        return SendResult(SendOutcome.ACCEPTED, response.status_code)

    def build_template_request(self, phone: str, template: str, variables: list[str], language: str) -> httpx.Request:
        digits = "".join(character for character in (phone or "") if character.isdigit())
        if len(digits) != 10:
            raise ValueError("expected a 10 digit Indian mobile number")
        is_otp = template == (self.settings.whatsapp_otp_template or "").strip()
        url_button = variables[0] if is_otp and self.settings.whatsapp_otp_url_button and variables else None
        body = template_body(digits, template, variables, language, url_button)
        headers = {"Accept": "application/json", **self.auth_headers()}
        return httpx.Request("POST", self.settings.whatsapp_api_url.strip(), json=body, headers=headers)

    def describe(self, response: httpx.Response) -> str:
        return response_shape(response, self.settings.whatsapp_api_key.get_secret_value().strip())

    def auth_headers(self) -> dict[str, str]:
        header = (self.settings.whatsapp_auth_header or "").strip()
        if not header:
            logger.error(AUTH_UNCONFIRMED)
            raise WhatsAppNotReadyError(AUTH_UNCONFIRMED)
        key = self.settings.whatsapp_api_key.get_secret_value().strip()
        scheme = (self.settings.whatsapp_auth_scheme or "").strip()
        headers = {header: f"{scheme} {key}" if scheme else key}
        sender_header = (self.settings.whatsapp_sender_header or "").strip()
        if sender_header:
            headers[sender_header] = self.settings.whatsapp_waba_number.strip()
        return headers

    def success_path(self) -> str:
        path = (self.settings.whatsapp_success_field or "").strip()
        if not path:
            logger.error(CONTRACT_UNCONFIRMED)
            raise WhatsAppNotReadyError(CONTRACT_UNCONFIRMED)
        if parse_path(path) is None:
            logger.error(CONTRACT_MALFORMED)
            raise WhatsAppNotReadyError(CONTRACT_MALFORMED)
        return path

    def accepted(self, response: httpx.Response) -> bool:
        """Whether the reply proves Dovesoft accepted the message for sending."""
        if not response.is_success:
            return False
        path = self.success_path()
        try:
            data = response.json()
        except ValueError:
            logger.warning("Dovesoft reply could not be read: %s", self.describe(response))
            return False
        value = field_at(data, path)
        if value is None or (isinstance(value, str | list | dict) and not value):
            logger.warning("Dovesoft reply has no %s: %s", path, self.describe(response))
            return False
        expected = (self.settings.whatsapp_success_value or "").strip()
        if expected:
            if str(value).strip().lower() != expected.lower():
                logger.warning("Dovesoft reply's %s is not the success value: %s", path, self.describe(response))
                return False
        elif value is False:
            logger.warning("Dovesoft reply's %s is false: %s", path, self.describe(response))
            return False
        return True

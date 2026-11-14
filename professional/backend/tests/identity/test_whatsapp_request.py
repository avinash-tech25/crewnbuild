"""The WhatsApp OTP request, byte for byte what the old app sends to Dovesoft.

The old app (Octabuild backend, app/shared/whatsapp/services/dovesoft_client.py with its
.env) sends the OTP template in language en_US, the code as the body's one parameter and
again on the copy-code button, to 91 + the 10-digit number, with the API key in the Key
header and the sender number in wabaNumber. No request is sent here: httpx is answered
by a MockTransport.
"""

import json
from typing import Any

import httpx
import pytest

from app.core.config import Settings
from app.integrations.whatsapp import dovesoft_client
from app.integrations.whatsapp.dovesoft_client import DovesoftWhatsAppClient, SendOutcome
from tests.conftest import make_settings

DOVESOFT = {
    "whatsapp_enabled": True,
    "whatsapp_signup_otp_enabled": True,
    "whatsapp_api_url": "https://api.dovesoft.test/REST/directApi/message",
    "whatsapp_api_key": "test-key-123",
    "whatsapp_waba_number": "919999999999",
    "whatsapp_otp_template": "crewnbuild_otp",
    "whatsapp_otp_url_button": True,
    "whatsapp_auth_header": "Key",
    "whatsapp_sender_header": "wabaNumber",
    "whatsapp_success_field": "messages[0].message_status",
    "whatsapp_success_value": "accepted",
}

# The old app's request for code 482913 to 9876543210, as its code builds it.
OLD_APP_BODY = {
    "messaging_product": "whatsapp",
    "to": "919876543210",
    "type": "template",
    "template": {
        "name": "crewnbuild_otp",
        "language": {"code": "en_US", "policy": "deterministic"},
        "components": [
            {"type": "body", "parameters": [{"type": "text", "text": "482913"}]},
            {"type": "button", "sub_type": "url", "index": 0, "parameters": [{"type": "text", "text": "482913"}]},
        ],
    },
    "templateName": "crewnbuild_otp",
}


def settings(**overrides: Any) -> Settings:
    return make_settings(**{**DOVESOFT, **overrides})


def test_the_default_language_is_the_one_the_templates_are_approved_in() -> None:
    assert Settings.model_fields["whatsapp_default_lang"].default == "en_US"
    assert settings().whatsapp_default_lang == "en_US"


def test_the_otp_request_is_the_old_apps_request() -> None:
    request = DovesoftWhatsAppClient(settings()).build_template_request(
        "9876543210", "crewnbuild_otp", ["482913"], "en_US"
    )
    assert request.method == "POST"
    assert str(request.url) == "https://api.dovesoft.test/REST/directApi/message"
    assert json.loads(request.content) == OLD_APP_BODY
    assert request.headers["Key"] == "test-key-123"  # the key as it is: no "Bearer"
    assert request.headers["wabaNumber"] == "919999999999"
    assert request.headers["Accept"] == "application/json"
    assert request.headers["Content-Type"] == "application/json"
    assert "Authorization" not in request.headers


@pytest.mark.parametrize("phone", ["9876543210", "+91 98765 43210", "98765-43210"])
def test_the_number_goes_out_as_91_and_ten_digits(phone: str) -> None:
    digits = "".join(character for character in phone if character.isdigit())[-10:]
    request = DovesoftWhatsAppClient(settings()).build_template_request(digits, "crewnbuild_otp", ["1"], "en_US")
    assert json.loads(request.content)["to"] == "919876543210"


def test_a_number_that_is_not_ten_digits_is_never_sent() -> None:
    with pytest.raises(ValueError):
        DovesoftWhatsAppClient(settings()).build_template_request("919876543210", "crewnbuild_otp", ["1"], "en_US")


def test_only_the_otp_template_carries_the_copy_code_button() -> None:
    client = DovesoftWhatsAppClient(settings())
    welcome = json.loads(client.build_template_request("9876543210", "welcome", ["Asha"], "en_US").content)
    assert [component["type"] for component in welcome["template"]["components"]] == ["body"]
    no_button = DovesoftWhatsAppClient(settings(whatsapp_otp_url_button=False))
    otp = json.loads(no_button.build_template_request("9876543210", "crewnbuild_otp", ["482913"], "en_US").content)
    assert [component["type"] for component in otp["template"]["components"]] == ["body"]


def test_an_auth_scheme_is_put_before_the_key_only_when_configured() -> None:
    request = DovesoftWhatsAppClient(settings(whatsapp_auth_scheme="Bearer")).build_template_request(
        "9876543210", "crewnbuild_otp", ["1"], "en_US"
    )
    assert request.headers["Key"] == "Bearer test-key-123"


REAL_CLIENT = httpx.Client


class Recorder:
    """httpx.Client with a MockTransport that records the request and answers `reply`."""

    def __init__(self, reply: httpx.Response) -> None:
        self.reply = reply
        self.requests: list[httpx.Request] = []
        self.timeouts: list[Any] = []

    def __call__(self, *args: Any, timeout: Any = None, **kwargs: Any) -> httpx.Client:
        self.timeouts.append(timeout)

        def answer(request: httpx.Request) -> httpx.Response:
            self.requests.append(request)
            return self.reply

        return REAL_CLIENT(transport=httpx.MockTransport(answer))


def send_with(monkeypatch: pytest.MonkeyPatch, reply: httpx.Response, **overrides: Any) -> tuple[Any, Recorder]:
    recorder = Recorder(reply)
    monkeypatch.setattr(dovesoft_client.httpx, "Client", recorder)
    result = DovesoftWhatsAppClient(settings(**overrides)).send("9876543210", "crewnbuild_otp", ["482913"])
    return result, recorder


def test_send_uses_the_configured_language_and_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    accepted = httpx.Response(200, json={"messages": [{"id": "wamid.1", "message_status": "accepted"}]})
    result, recorder = send_with(monkeypatch, accepted, whatsapp_timeout_seconds=7.5)
    assert result.outcome is SendOutcome.ACCEPTED
    assert json.loads(recorder.requests[0].content) == OLD_APP_BODY
    assert recorder.timeouts == [7.5]


@pytest.mark.parametrize(
    ("reply", "outcome"),
    [
        (httpx.Response(200, json={"messages": [{"message_status": "accepted"}]}), SendOutcome.ACCEPTED),
        (httpx.Response(200, json={"messages": [{"message_status": "failed"}]}), SendOutcome.INVALID_RESPONSE),
        (httpx.Response(200, json={"messages": [{"id": "wamid.1"}]}), SendOutcome.INVALID_RESPONSE),
        (
            httpx.Response(200, json=[{"errorCode": 1053, "errorDescription": "WhatsappRateNotAssigned"}]),
            SendOutcome.REJECTED,
        ),
        (httpx.Response(400, json={"error": "template not found"}), SendOutcome.REJECTED),
        (httpx.Response(200, content=b""), SendOutcome.UNCERTAIN),
    ],
)
def test_only_an_accepted_message_status_counts_as_sent(
    monkeypatch: pytest.MonkeyPatch, reply: httpx.Response, outcome: SendOutcome
) -> None:
    result, _ = send_with(monkeypatch, reply)
    assert result.outcome is outcome

"""What the real Gemini endpoint needs and what we report when it fails:

- Gemini 3 sends a `thought_signature` (extra_content) with each tool call and refuses the
  next request without it: the provider keeps it and the service sends it back.
- Gemini's streamed tool calls carry no `index`: two calls in one reply stay two calls.
- A failure carries the HTTP status and the provider's message, key redacted, into the log.
- GET /assistant/health: enabled / configured / reachable for anyone; the status, reason and
  model only for administrators; checked at most once a minute.
"""

import json
from typing import Any

import httpx
import pytest
from admin.helpers import create_admin
from admin.helpers import signed_in as admin_signed_in
from conftest import ClientFactory, make_settings
from projects.helpers import owner
from sqlalchemy.orm import Session

from app.modules.assistant import router as assistant_router
from app.modules.assistant import service
from app.modules.assistant.provider import OpenAICompatibleProvider, ProviderError, ToolCall, ToolCalls
from assistant.test_assistant import FakeAI, chat, done
from assistant.test_provider import Network, seen, stream_body  # noqa: F401  (fixture)

SIGNATURE = {"google": {"thought_signature": "c2lnbmF0dXJl"}}


def test_gemini_tool_calls_keep_their_signature_and_stay_separate(seen: Network) -> None:  # noqa: F811
    settings = make_settings(openai_api_key="k", openai_base_url="https://g.example/v1beta/openai")
    # As Gemini streams them: each call whole, with an id, no index, and extra_content.
    gemini_calls = [
        {"id": "a", "type": "function", "function": {"name": "help_search", "arguments": '{"q": "hire"}'},
         "extra_content": SIGNATURE},
        {"id": "b", "type": "function", "function": {"name": "help_search", "arguments": '{"q": "builder"}'}},
    ]  # fmt: skip
    seen.replies.append(
        httpx.Response(200, content=stream_body({"choices": [{"delta": {"tool_calls": gemini_calls}}]}))
    )
    events = list(
        OpenAICompatibleProvider(settings).stream([{"role": "user", "content": "hi"}], [{"type": "function"}])
    )
    (calls,) = [event for event in events if isinstance(event, ToolCalls)]
    assert [(c.id, c.name, c.arguments, c.extra_content) for c in calls.calls] == [
        ("a", "help_search", '{"q": "hire"}', SIGNATURE),
        ("b", "help_search", '{"q": "builder"}', None),
    ]


def test_the_service_sends_the_signature_back_with_its_call(make_client: ClientFactory, database: Session) -> None:
    class SignedAI(FakeAI):
        def stream(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]], model: str | None = None) -> Any:
            self.calls.append((json.loads(json.dumps(messages, default=str)), [t["function"]["name"] for t in tools]))
            if len(self.calls) == 1:
                yield ToolCalls(
                    [ToolCall("call_1", "my_projects", "{}", SIGNATURE), ToolCall("call_2", "my_projects", "{}")]
                )
            else:
                yield from super().stream(messages, tools)

    ai = SignedAI("Here you go.")
    client = make_client(overrides={assistant_router.get_provider: lambda: ai}, openai_api_key="k")
    done(chat(owner(client, database), "my projects?"))
    follow_up = ai.calls[1][0]
    (assistant_turn,) = [message for message in follow_up if message.get("tool_calls")]
    first, second = assistant_turn["tool_calls"]
    assert first["extra_content"] == SIGNATURE
    assert "extra_content" not in second


def test_a_refusal_carries_the_status_and_the_providers_message_without_the_key(seen: Network) -> None:  # noqa: F811
    body = [{"error": {"code": 400, "message": "Function call is missing a thought_signature (key secret-key)",
                       "status": "INVALID_ARGUMENT"}}]  # fmt: skip
    seen.replies.append(httpx.Response(400, json=body))
    with pytest.raises(ProviderError) as raised:
        list(OpenAICompatibleProvider(make_settings(openai_api_key="secret-key")).stream([], []))
    assert raised.value.status == 400
    text = str(raised.value)
    assert "status=400" in text and "missing a thought_signature" in text
    assert "secret-key" not in text and "***" in text


def test_the_log_names_the_reason(
    make_client: ClientFactory, database: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    logged: list[str] = []
    monkeypatch.setattr(service.logger, "warning", lambda message, *args: logged.append(message % args))
    ai = FakeAI(ProviderError("The AI refused the request.", status=429, detail="You exceeded your current quota"))
    client = make_client(overrides={assistant_router.get_provider: lambda: ai}, openai_api_key="test-key")
    response = chat(owner(client, database), "hello")
    assert response.text.count("event: error") == 1 and service.BUSY in response.text
    (line,) = [entry for entry in logged if "assistant provider failed" in entry]
    assert "status=429" in line and "exceeded your current quota" in line and "test-key" not in line


class CheckingAI(FakeAI):
    def __init__(self, result: dict[str, Any]) -> None:
        super().__init__()
        self.result = result
        self.checks = 0

    def check(self) -> dict[str, Any]:
        self.checks += 1
        return self.result


@pytest.fixture(autouse=True)
def fresh_health_cache() -> Any:
    assistant_router._health_cache.clear()
    yield
    assistant_router._health_cache.clear()


def test_health_says_configured_and_reachable_and_gives_admins_the_reason(
    make_client: ClientFactory, database: Session
) -> None:
    ai = CheckingAI({"reachable": False, "status": 403, "reason": "API key not valid"})
    client = make_client(overrides={assistant_router.get_provider: lambda: ai}, openai_api_key="k", assistant_model="m")
    guest = client.get("/api/v1/assistant/health").json()
    assert guest == {"enabled": True, "configured": True, "reachable": False}
    create_admin(database)
    admin, _ = admin_signed_in(client, "india.admin@example.in")
    report = admin.get("/api/v1/assistant/health").json()
    assert report == {"enabled": True, "configured": True, "reachable": False, "model": "m", "status": 403,
                      "reason": "API key not valid"}  # fmt: skip
    assert ai.checks == 1  # the second request was answered from the one-minute cache


def test_health_without_a_key_or_turned_off_does_not_call_the_provider(make_client: ClientFactory) -> None:
    ai = CheckingAI({"reachable": True, "status": 200, "reason": ""})
    for settings, expected in (
        ({"openai_api_key": ""}, {"enabled": True, "configured": False, "reachable": False}),
        (
            {"openai_api_key": "k", "assistant_enabled": False},
            {"enabled": False, "configured": True, "reachable": False},
        ),
    ):
        client = make_client(overrides={assistant_router.get_provider: lambda: ai}, **settings)
        assert client.get("/api/v1/assistant/health").json() == expected
    assert ai.checks == 0


def test_the_real_check_asks_for_the_model_with_the_key_in_the_header_only(monkeypatch: pytest.MonkeyPatch) -> None:
    seen_requests: list[httpx.Request] = []

    def fake_get(url: str, headers: dict[str, str], timeout: float) -> httpx.Response:
        request = httpx.Request("GET", url, headers=headers)
        seen_requests.append(request)
        return httpx.Response(404, json={"error": {"message": "model m is not found"}}, request=request)

    monkeypatch.setattr("app.modules.assistant.provider.httpx.get", fake_get)
    settings = make_settings(
        openai_api_key="secret-key", openai_base_url="https://g.example/v1beta/openai/", assistant_model="m"
    )
    result = OpenAICompatibleProvider(settings).check()
    assert result == {"reachable": False, "status": 404, "reason": "model m is not found"}
    (request,) = seen_requests
    assert str(request.url) == "https://g.example/v1beta/openai/models/m"
    assert request.headers["authorization"] == "Bearer secret-key"

"""The OpenAI-compatible provider: the streamed text and tool calls are read correctly, the
key goes only in the Authorization header to OPENAI_BASE_URL, and failures become
ProviderError. httpx's mock transport stands in for the network."""

import json
from typing import Any

import httpx
import pytest
from conftest import make_settings

from app.modules.assistant import provider as provider_module
from app.modules.assistant.provider import OpenAICompatibleProvider, ProviderError, TextDelta, ToolCalls


def stream_body(*chunks: dict[str, Any]) -> bytes:
    lines = [f"data: {json.dumps(chunk)}" for chunk in chunks] + ["data: [DONE]"]
    return ("\n\n".join(lines) + "\n\n").encode()


class Network:
    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.replies: list[httpx.Response] = []


@pytest.fixture
def seen(monkeypatch: pytest.MonkeyPatch) -> Network:
    network = Network()

    def handler(request: httpx.Request) -> httpx.Response:
        network.requests.append(request)
        return network.replies.pop(0)

    real_client = httpx.Client
    monkeypatch.setattr(
        provider_module.httpx, "Client", lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw)
    )
    return network


def test_text_and_tool_calls_are_read_from_the_stream(seen: Network) -> None:
    settings = make_settings(openai_api_key="secret-key", openai_base_url="https://ai.example/v1/", assistant_model="m")
    first_part = {"index": 0, "id": "c1", "function": {"name": "my_", "arguments": '{"a"'}}
    second_part = {"index": 0, "function": {"name": "projects", "arguments": ": 1}"}}
    seen.replies.append(
        httpx.Response(
            200,
            content=stream_body(
                {"choices": [{"delta": {"content": "Hel"}}]},
                {"choices": [{"delta": {"content": "lo"}}]},
                {"choices": [{"delta": {"tool_calls": [first_part]}}]},
                {"choices": [{"delta": {"tool_calls": [second_part]}}]},
            ),
        )
    )
    events = list(
        OpenAICompatibleProvider(settings).stream([{"role": "user", "content": "hi"}], [{"type": "function"}])
    )
    assert events[:2] == [TextDelta("Hel"), TextDelta("lo")]
    (calls,) = [event for event in events if isinstance(event, ToolCalls)]
    assert [(call.id, call.name, call.arguments) for call in calls.calls] == [("c1", "my_projects", '{"a": 1}')]
    (request,) = seen.requests
    assert str(request.url) == "https://ai.example/v1/chat/completions"
    assert request.headers["authorization"] == "Bearer secret-key"
    body = json.loads(request.content)
    assert body["model"] == "m" and body["stream"] is True and body["tool_choice"] == "auto"
    assert "secret-key" not in request.content.decode()


def test_errors_and_a_missing_key_are_provider_errors(seen: Network) -> None:
    with pytest.raises(ProviderError):
        list(OpenAICompatibleProvider(make_settings(openai_api_key="")).stream([], []))
    assert seen.requests == []
    seen.replies.append(httpx.Response(429, content=b"quota"))
    with pytest.raises(ProviderError):
        list(OpenAICompatibleProvider(make_settings(openai_api_key="k")).stream([], []))

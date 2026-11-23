"""The AI behind Viswa: one OpenAI-compatible chat completions API (OPENAI_BASE_URL and
OPENAI_API_KEY, the ones translation uses; Gemini's OpenAI-compatible endpoint works),
called from this backend only, streamed, with tool calling.

    provider.stream(messages, tools) -> TextDelta ... | ToolCalls

The key never leaves the server. Tests replace the provider with a fake (get_provider is a
FastAPI dependency), so no test reaches the network.
"""

import json
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any, Protocol

import httpx

from app.core.config import Settings


class ProviderError(RuntimeError):
    """The AI could not answer (no key, busy, quota, timeout, a bad reply)."""


@dataclass(frozen=True)
class TextDelta:
    text: str


@dataclass(frozen=True)
class ToolCall:
    id: str
    name: str
    arguments: str  # JSON text, as the API sends it


@dataclass(frozen=True)
class ToolCalls:
    calls: list[ToolCall] = field(default_factory=list)


Event = TextDelta | ToolCalls


class Provider(Protocol):
    def stream(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> Iterator[Event]: ...


def configured_key(settings: Settings) -> str:
    return settings.openai_api_key.get_secret_value().strip()


class OpenAICompatibleProvider:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def stream(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> Iterator[Event]:
        key = configured_key(self.settings)
        if not key:
            raise ProviderError("The assistant is not configured.")
        body: dict[str, Any] = {
            "model": self.settings.assistant_model,
            "messages": messages,
            "stream": True,
            "temperature": 0.2,
        }
        if tools:
            body["tools"] = tools
            body["tool_choice"] = "auto"
        url = self.settings.openai_base_url.rstrip("/") + "/chat/completions"
        timeout = httpx.Timeout(self.settings.assistant_timeout_seconds, connect=10.0)
        pending: dict[int, dict[str, str]] = {}
        try:
            with (
                httpx.Client(timeout=timeout) as client,
                client.stream("POST", url, json=body, headers={"Authorization": f"Bearer {key}"}) as response,
            ):
                if response.status_code >= 400:
                    raise ProviderError(f"The AI answered {response.status_code}.")
                for line in response.iter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                    except ValueError:
                        continue
                    for choice in chunk.get("choices") or []:
                        delta = choice.get("delta") or {}
                        if delta.get("content"):
                            yield TextDelta(str(delta["content"]))
                        for call in delta.get("tool_calls") or []:
                            slot = pending.setdefault(
                                int(call.get("index", 0)), {"id": "", "name": "", "arguments": ""}
                            )
                            slot["id"] = call.get("id") or slot["id"]
                            function = call.get("function") or {}
                            slot["name"] += function.get("name") or ""
                            slot["arguments"] += function.get("arguments") or ""
        except httpx.HTTPError as error:
            raise ProviderError("The AI could not be reached.") from error
        if pending:
            yield ToolCalls(
                [
                    ToolCall(id=slot["id"] or f"call_{index}", name=slot["name"], arguments=slot["arguments"] or "{}")
                    for index, slot in sorted(pending.items())
                ]
            )

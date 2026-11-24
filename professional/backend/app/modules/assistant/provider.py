"""The AI behind Viswa: one OpenAI-compatible chat completions API (OPENAI_BASE_URL and
OPENAI_API_KEY, the ones translation uses; Gemini's OpenAI-compatible endpoint works),
called from this backend only, streamed, with tool calling.

    provider.stream(messages, tools) -> TextDelta ... | ToolCalls

Gemini 3 models attach a `thought_signature` (`extra_content`) to each tool call and refuse
the follow-up request (400 "Function call is missing a thought_signature") unless it is sent
back with that call, so ToolCall keeps `extra_content` and the service echoes it. Gemini's
streamed tool calls carry no `index`; each arrives whole with its own `id`.

A failure raises ProviderError with the HTTP status and the provider's own message (the
key redacted), for the log; the user only ever sees the generic "not available" text.

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
    """The AI could not answer (no key, busy, quota, timeout, a bad reply).

    `status` is the provider's HTTP status (None when it was not reached) and `detail` its
    own error message, key-free, for the log."""

    def __init__(self, message: str, status: int | None = None, detail: str = "") -> None:
        super().__init__(message)
        self.status = status
        self.detail = detail

    @property
    def retryable(self) -> bool:
        """Worth trying the next model: out of quota (429), model gone (404), the provider
        failing (5xx), or not reached / timed out (no status). A 400/401/403 is our request
        or our key, which another model will not fix."""
        return self.status is None or self.status in (404, 429) or self.status >= 500

    def __str__(self) -> str:
        parts = [super().__str__()]
        if self.status is not None:
            parts.append(f"status={self.status}")
        if self.detail:
            parts.append(f"message={self.detail}")
        return " ".join(parts)


@dataclass(frozen=True)
class TextDelta:
    text: str


@dataclass(frozen=True)
class ToolCall:
    id: str
    name: str
    arguments: str  # JSON text, as the API sends it
    # The provider's opaque per-call data (Gemini's thought_signature), sent back as is.
    extra_content: dict[str, Any] | None = None


@dataclass(frozen=True)
class ToolCalls:
    calls: list[ToolCall] = field(default_factory=list)


Event = TextDelta | ToolCalls


class Provider(Protocol):
    def stream(
        self, messages: list[dict[str, Any]], tools: list[dict[str, Any]], model: str | None = None
    ) -> Iterator[Event]: ...


def configured_key(settings: Settings) -> str:
    return settings.openai_api_key.get_secret_value().strip()


def redact(text: str, key: str) -> str:
    return text.replace(key, "***") if key else text


def error_detail(response: httpx.Response, key: str) -> str:
    """The provider's own error message (OpenAI and Gemini both send {"error": {"message"}};
    Gemini sometimes wraps it in a list), else the start of the body. Key-free, one line."""
    try:
        response.read()
        body: Any = response.json()
        if isinstance(body, list) and body:
            body = body[0]
        message = (body.get("error") or {}).get("message") if isinstance(body, dict) else None
        text = str(message) if message else response.text
    except (ValueError, httpx.HTTPError, AttributeError):
        text = ""
    return redact(" ".join(text.split()), key)[:500]


class OpenAICompatibleProvider:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def stream(
        self, messages: list[dict[str, Any]], tools: list[dict[str, Any]], model: str | None = None
    ) -> Iterator[Event]:
        """One request to `model` (default ASSISTANT_MODEL)."""
        key = configured_key(self.settings)
        if not key:
            raise ProviderError("The assistant is not configured.")
        body: dict[str, Any] = {
            "model": model or self.settings.assistant_model,
            "messages": messages,
            "stream": True,
            "temperature": 0.2,
        }
        if tools:
            body["tools"] = tools
            body["tool_choice"] = "auto"
        url = self.settings.openai_base_url.rstrip("/") + "/chat/completions"
        timeout = httpx.Timeout(self.settings.assistant_timeout_seconds, connect=10.0)
        pending: dict[str, dict[str, Any]] = {}
        try:
            with (
                httpx.Client(timeout=timeout) as client,
                client.stream("POST", url, json=body, headers={"Authorization": f"Bearer {key}"}) as response,
            ):
                if response.status_code >= 400:
                    raise ProviderError(
                        "The AI refused the request.",
                        status=response.status_code,
                        detail=error_detail(response, key),
                    )
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
                            # OpenAI streams a call in pieces under one `index`; Gemini sends
                            # each call whole, with an `id` and no index.
                            if call.get("index") is not None:
                                slot_key = f"index-{call['index']}"
                            else:
                                slot_key = f"id-{call.get('id') or len(pending)}"
                            slot = pending.setdefault(
                                slot_key, {"id": "", "name": "", "arguments": "", "extra_content": None}
                            )
                            slot["id"] = call.get("id") or slot["id"]
                            function = call.get("function") or {}
                            slot["name"] += function.get("name") or ""
                            slot["arguments"] += function.get("arguments") or ""
                            if call.get("extra_content"):
                                slot["extra_content"] = call["extra_content"]
        except httpx.HTTPError as error:
            raise ProviderError(
                "The AI could not be reached.", detail=redact(f"{type(error).__name__}: {error}", key)[:300]
            ) from error
        if pending:
            yield ToolCalls(
                [
                    ToolCall(
                        id=slot["id"] or f"call_{number}",
                        name=slot["name"],
                        arguments=slot["arguments"] or "{}",
                        extra_content=slot["extra_content"],
                    )
                    for number, slot in enumerate(pending.values())
                ]
            )

    def check(self) -> dict[str, Any]:
        """Whether the provider answers with this key and knows the model: one small
        GET {base}/models/{model} (no tokens used). Key-free, for /assistant/health."""
        key = configured_key(self.settings)
        if not key:
            return {"reachable": False, "status": None, "reason": "OPENAI_API_KEY is not set."}
        url = f"{self.settings.openai_base_url.rstrip('/')}/models/{self.settings.assistant_model}"
        try:
            response = httpx.get(url, headers={"Authorization": f"Bearer {key}"}, timeout=10.0)
        except httpx.HTTPError as error:
            return {"reachable": False, "status": None, "reason": redact(f"{type(error).__name__}: {error}", key)[:300]}
        if response.status_code >= 400:
            return {"reachable": False, "status": response.status_code, "reason": error_detail(response, key)}
        return {"reachable": True, "status": response.status_code, "reason": ""}

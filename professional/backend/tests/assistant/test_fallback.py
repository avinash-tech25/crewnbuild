"""Saving and stretching the AI quota:

- ASSISTANT_FALLBACK_MODELS: on 429 / 404 / 5xx / timeout from a model, the same turn is tried
  again from the start with the next model (its own tool calls); a 400-type refusal is not
  retried. The panel is told to drop a failed model's partial text ("reset").
- Every model failed: the best help card answers ("Quick answer from the help guide") with
  its own allow-listed buttons; "busy" only when no card matches.
- A plain how-to question that one card clearly answers gets the card with no AI call.
- The logs name the model that answered or failed, never the key.
"""

from typing import Any

import pytest
from conftest import ClientFactory, make_settings
from fastapi.testclient import TestClient
from projects.helpers import Person, owner
from sqlalchemy.orm import Session

from app.modules.assistant import router as assistant_router
from app.modules.assistant import service
from app.modules.assistant.knowledge import get_knowledge
from app.modules.assistant.provider import ProviderError, TextDelta
from app.modules.assistant.tools import GUEST, OWNER
from assistant.test_assistant import FakeAI, chat, done, events

KEY = "test-key-do-not-log"


def failure(status: int | None) -> ProviderError:
    return ProviderError("The AI refused the request.", status=status, detail=f"provider said {status}")


@pytest.fixture
def ai() -> FakeAI:
    return FakeAI()


@pytest.fixture
def logged(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    lines: list[str] = []
    for level in ("info", "warning"):
        monkeypatch.setattr(service.logger, level, lambda message, *args: lines.append(message % args))
    return lines


@pytest.fixture
def client(make_client: ClientFactory, ai: FakeAI) -> TestClient:
    return make_client(
        overrides={assistant_router.get_provider: lambda: ai},
        openai_api_key=KEY,
        assistant_model="main-model",
        assistant_fallback_models=" lite-1, ,lite-2,main-model ",
    )


@pytest.fixture
def asha(client: TestClient, database: Session) -> Person:
    return owner(client, database)


def test_the_model_chain_is_main_then_fallbacks_without_blanks_or_repeats() -> None:
    chain = service.model_chain(make_settings(assistant_model="a", assistant_fallback_models="b, ,c,a,b"))
    assert chain == ["a", "b", "c"]
    assert service.model_chain(make_settings(assistant_model="a", assistant_fallback_models="")) == ["a"]


@pytest.mark.parametrize("status", [429, 404, 500, 503, None], ids=["quota", "model-gone", "500", "503", "timeout"])
def test_a_failing_main_model_hands_the_turn_to_the_next(
    asha: Person, ai: FakeAI, logged: list[str], status: int | None
) -> None:
    ai.steps = [failure(status), "Answer from the backup."]
    reply = done(chat(asha, "What is happening on my project?"))
    assert reply["answer"] == "Answer from the backup." and reply["answer_type"] == "answered"
    assert ai.models == ["main-model", "lite-1"]
    assert any("model=main-model" in line and "failed" in line for line in logged)
    assert "assistant answered: model=lite-1" in logged


def test_each_fallback_is_tried_in_order_and_starts_the_turn_over(asha: Person, ai: FakeAI) -> None:
    # The main model calls a tool, then runs out of quota; lite-1 is gone; lite-2 answers.
    ai.steps = [[("my_projects", {})], failure(429), failure(404), "Third time lucky."]
    reply = done(chat(asha, "What is happening on my project?"))
    assert reply["answer"] == "Third time lucky."
    assert ai.models == ["main-model", "main-model", "lite-1", "lite-2"]
    # The backups start from the user's question: no tool turn of the failed model.
    for messages, _tools in ai.calls[2:]:
        assert messages[-1] == {"role": "user", "content": "What is happening on my project?"}
        assert not any(message.get("tool_calls") for message in messages)


def test_a_refused_request_is_not_retried_on_other_models(asha: Person, ai: FakeAI) -> None:
    ai.steps = [failure(400)]
    parsed = events(chat(asha, "What is happening on my project?"))
    assert ai.models == ["main-model"]
    assert parsed[-1][0] in ("done", "error")


def test_a_model_that_failed_part_way_is_reset_before_the_next_answers(asha: Person, ai: FakeAI) -> None:
    real_stream = ai.stream

    def half_then_fail(messages: list[dict[str, Any]], tools: list[dict[str, Any]], model: str | None = None) -> Any:
        if model == "main-model":
            ai.models.append(model)
            yield TextDelta("Half an ans")
            raise failure(503)
        yield from real_stream(messages, tools, model)

    ai.stream = half_then_fail  # type: ignore[method-assign]
    ai.steps = ["The backup's answer."]
    parsed = events(chat(asha, "What is happening on my project?"))
    names = [name for name, _data in parsed]
    assert names.index("delta") < names.index("reset") < len(names) - 1 and names[-1] == "done"
    assert parsed[-1][1]["answer"] == "The backup's answer."
    assert ai.models == ["main-model", "lite-1"]


def test_when_every_model_fails_the_best_help_card_answers(asha: Person, ai: FakeAI, logged: list[str]) -> None:
    ai.steps = [failure(429), failure(429), failure(429)]
    question = "My plumber booking from the dashboard is not working, what now?"
    reply = done(chat(asha, question))
    card = get_knowledge().search(OWNER, question, 1)[0]
    assert reply["answer_type"] == "help_fallback"
    assert reply["answer"].startswith("Quick answer from the help guide:")
    assert card.title in reply["answer"]
    assert reply["buttons"] == [{"label": label, "path": path} for label, path in card.buttons][: service.MAX_BUTTONS]
    allowed = get_knowledge().allowed_paths(OWNER)
    assert all(button["path"] in allowed for button in reply["buttons"])
    assert ai.models == ["main-model", "lite-1", "lite-2"]
    assert any(f"help card {card.id} (every model failed)" in line for line in logged)


def test_busy_only_when_every_model_fails_and_no_card_matches(asha: Person, ai: FakeAI) -> None:
    ai.steps = [failure(429), failure(429), failure(429)]
    parsed = events(chat(asha, "zzqx vvbn"))
    assert parsed[-1] == ("error", {"message": service.BUSY})


def test_a_clear_how_to_question_is_answered_from_its_card_without_the_ai(
    asha: Person, ai: FakeAI, logged: list[str]
) -> None:
    reply = done(chat(asha, "How do I book a plumber?"))
    card = get_knowledge().card(OWNER, "book-technician")
    assert card is not None
    assert reply["answer_type"] == "help_card" and card.title in reply["answer"]
    assert not reply["answer"].startswith("Quick answer")
    assert reply["buttons"] == [{"label": label, "path": path} for label, path in card.buttons]
    assert ai.calls == []
    assert any("help card book-technician (no AI call)" in line for line in logged)


@pytest.mark.parametrize(
    "question",
    [
        "How much will my house cost?",  # a data question (the estimate tool)
        "What is the status of my project?",  # the user's own data
        "How do I hire a builder?",  # two cards match equally: the AI decides
        "Tell me about plumbers",  # not phrased as a how-to
    ],
)
def test_data_ambiguous_or_open_questions_still_go_to_the_ai(asha: Person, ai: FakeAI, question: str) -> None:
    ai.steps = ["From the AI."]
    reply = done(chat(asha, question))
    assert reply["answer"] == "From the AI." and ai.models == ["main-model"]


def test_guests_get_direct_card_answers_too(client: TestClient, ai: FakeAI) -> None:
    reply = done(chat(client, "How do I sign up?"))
    assert reply["answer_type"] == "help_card" and ai.calls == []
    assert get_knowledge().best_match(GUEST, "How do I sign up?") is not None


def test_the_key_never_reaches_the_logs(asha: Person, ai: FakeAI, logged: list[str]) -> None:
    ai.steps = [failure(429), ProviderError("x", status=503, detail="upstream"), "ok"]
    done(chat(asha, "What is happening on my project?"))
    ai.steps = [failure(429), failure(429), failure(429)]
    chat(asha, "My plumber booking is not working")
    assert logged and not any(KEY in line for line in logged)

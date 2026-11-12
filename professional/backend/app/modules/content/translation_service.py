"""Display-only machine translation of stored text (ported from the old
translation_service.py; Arabic removed, section 4.7: India only).

Why this exists
---------------
The interface chrome -- labels, buttons, statuses, headings -- is translated by
the frontend's own key table (`src/i18n/translations.js`), which holds seven
hand-written strings for every key. That mechanism cannot reach text a user
typed: a project description entered five minutes ago has no key and no
pre-written translation. This service fills only that gap.

What it does NOT do
-------------------
It never writes to the database. It reads nothing from the database. The stored
value is untouched in every case -- a caller sends a string and receives a
string, and what it does with the answer is display it. Nothing here can alter a
project title, a person's name or a description at rest.

Cost and privacy
----------------
Every miss is a billed call to OpenAI and sends that text to OpenAI. Two things
keep that bounded:

  * an on-disk cache, so a description is translated once per language for the
    lifetime of the deployment rather than once per page view;
  * `en` short-circuits before any network call, because the stored text is
    already English.

The cache lives outside the database on purpose (a cache table would have meant
a schema change) and outside version control (it holds user text).

Why a chat model rather than a translation endpoint
---------------------------------------------------
A general model will happily summarise, explain or "improve" what it is given,
which for a project description would silently rewrite a record the user
believes they wrote. Three things hold it to translating:

  * a system prompt that states the job and forbids commentary;
  * `temperature: 0` and a JSON response format, so the reply is parsed rather
    than read;
  * a check, after the fact, that every protected token in the source survived
    into the translation. A reply that dropped one is discarded and the
    original text is shown instead.

The last of these is the important one: instructions can be ignored, so the
guarantee that `3BHK` or a phone number is never corrupted comes from verifying
the answer, not from asking nicely.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import threading
from pathlib import Path

import httpx

from app.core.config import BACKEND_ROOT, get_settings

logger = logging.getLogger(__name__)

# The six languages the interface offers (Arabic was removed with Kuwait). A target outside this set is
# refused rather than forwarded, so a caller cannot turn this into a general
# translation proxy for languages the product does not ship.
SUPPORTED_TARGETS = frozenset({"en", "te", "hi", "ta", "kn", "ml"})

# A model is told the language by name; a bare ISO code invites it to guess.
LANGUAGE_NAMES = {
    "te": "Telugu",
    "hi": "Hindi",
    "ta": "Tamil",
    "kn": "Kannada",
    "ml": "Malayalam",
}

# Bounds on a single request. They cap what one caller can spend in one call;
# the router applies them too, so a direct caller cannot bypass them.
MAX_TEXTS_PER_REQUEST = 100
MAX_CHARACTERS_PER_TEXT = 2000

# How many strings go to the model at once. Smaller than the request cap on
# purpose: a long list makes it likelier the reply comes back a different
# length, and the whole chunk is then discarded. Twenty keeps a dashboard to a
# couple of calls while keeping each one easy to verify.
TEXTS_PER_MODEL_CALL = 20

REQUEST_TIMEOUT_SECONDS = 60.0

SYSTEM_PROMPT = """You are a translation engine inside an application. You translate strings for display; you never converse.

Rules:
1. Translate each string in "texts" into {language}. Return JSON: {{"translations": [...]}} with exactly one entry per input, in the same order.
2. Translate faithfully. Never summarise, expand, explain, answer, correct or improve. The output must say what the input says.
3. Keep these EXACTLY as they appear, character for character: numbers, percentages, currency amounts and symbols, phone numbers, IDs and reference numbers, email addresses, URLs, dates, measurements, and alphanumeric technical codes such as 3BHK, G+4, Fe500, OPC53, 2BHK, sq.ft.
4. Names of people, companies and places: write them in the {language} script by sound (transliterate). Never translate what a name means.
5. If a string is already in {language}, return it unchanged.
6. Never return an empty string. If you cannot translate one, return that input unchanged.
7. Output only the JSON object. No markdown, no code fence, no commentary."""

# Text that carries no word to translate: digits, punctuation, symbols and
# whitespace only. Sending "3" or "75%" to a translator spends money to get the
# same string back, and risks getting a different one.
_NOTHING_TO_TRANSLATE = re.compile(r"^[\W\d_]*$", re.UNICODE)

# Values that must survive translation exactly as written. Google honours
# `<span translate="no">` in HTML-format input, which is the documented way to
# pin a substring; these patterns decide what gets pinned.
#
# Order matters: the longer, more specific forms are tried first so that a date
# is matched as a date rather than as three separate numbers.
_PROTECTED_TOKEN = re.compile(
    r"""(
        https?://\S+                              # URLs
      | [\w.+-]+@[\w-]+\.[\w.]{2,}                # email addresses
      | \b\d{1,4}[-/]\d{1,2}[-/]\d{1,4}\b         # 2026-09-18, 18/09/2026
      | \b\d{1,2}:\d{2}(?::\d{2})?\b              # 14:30, 14:30:00
      | [₹$€£¥]\s?\d[\d,.]*                       # ₹ 42,00,000
      | \b\d+(?:\.\d+)?\s?%                       # 75%, 12.5 %
      | \b\d{1,3}(?:,\d{2,3})+(?:\.\d+)?\b        # 1,23,456.78
      | \b\d{4,}\b                                # phone numbers, ids
      | \b[A-Za-z]\s?[+-]\s?\d+\b                 # G+4, G+1, G-2 (floor codes)
      | \b\d+(?:\.\d+)?[A-Za-z]{1,6}\b            # 3BHK, 250kg, 1.5x
      | \b[A-Za-z]{1,6}\d+[A-Za-z0-9]*\b          # Fe500, G3, OPC53
    )""",
    re.VERBOSE | re.UNICODE,
)


def _cache_directory() -> Path:
    configured = (get_settings().translation_cache_directory or "translation_cache").strip()
    directory = Path(configured)
    if not directory.is_absolute():
        directory = BACKEND_ROOT / directory
    return directory


def _fingerprint(text: str) -> str:
    """The cache key for a source string.

    Hashed rather than stored verbatim so the file cannot be read as a
    transcript of what users have written, and so no key needs escaping.
    """
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def protected_tokens(text: str) -> list[str]:
    """Every value in `text` that must survive translation unchanged."""
    return [match.group(0) for match in _PROTECTED_TOKEN.finditer(text)]


def keeps_protected_tokens(source: str, translated: str) -> bool:
    """Whether `translated` still contains every protected value in `source`.

    This is the guarantee, not the prompt. A model that dropped a phone number,
    rounded an amount or "corrected" 3BHK to 3 BHK fails here and its answer is
    thrown away, so the reader sees the stored text rather than a plausible
    corruption of it. Counted, not merely present: a description quoting two
    different amounts must keep both.
    """
    return all(translated.count(token) >= source.count(token) for token in set(protected_tokens(source)))


class TranslationService:
    """Translates display strings, caching every answer on disk.

    One instance is shared by the whole process (see `get_translation_service`)
    so that the cache is loaded once and one lock serialises every write.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._caches: dict[str, dict[str, str]] = {}
        self._loaded: set[str] = set()

    # --- cache -------------------------------------------------------------

    def _cache_path(self, target: str) -> Path:
        return _cache_directory() / f"{target}.json"

    def _cache_for(self, target: str) -> dict[str, str]:
        """The cache for one language, read from disk on first use.

        A damaged or unreadable file is reported and treated as empty: a cache
        is an optimisation, and losing it must never stop the page rendering.
        """
        if target in self._loaded:
            return self._caches.setdefault(target, {})

        path = self._cache_path(target)
        loaded: dict[str, str] = {}
        try:
            if path.is_file():
                with path.open("r", encoding="utf-8") as handle:
                    content = json.load(handle)
                if isinstance(content, dict):
                    loaded = {str(key): str(value) for key, value in content.items()}
                else:
                    logger.warning("Translation cache %s is not an object; ignoring it.", path)
        except (OSError, ValueError) as error:
            logger.warning("Could not read translation cache %s: %s", path, error)

        self._caches[target] = loaded
        self._loaded.add(target)
        return loaded

    def _persist(self, target: str) -> None:
        """Write the cache out atomically.

        A crash mid-write would otherwise leave a truncated file that the next
        start would refuse to parse, silently discarding every translation paid
        for so far.
        """
        path = self._cache_path(target)
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            temporary = path.with_suffix(".json.tmp")
            with temporary.open("w", encoding="utf-8") as handle:
                json.dump(self._caches.get(target, {}), handle, ensure_ascii=False)
            os.replace(temporary, path)
        except OSError as error:
            logger.warning("Could not write translation cache %s: %s", path, error)

    # --- provider ----------------------------------------------------------

    @property
    def configured(self) -> bool:
        return bool(get_settings().openai_api_key.get_secret_value().strip())

    def _call_model(self, texts: list[str], target: str) -> list[str] | None:
        """Translate one chunk, or return None if the model could not answer.

        None means "no answer", not "no translation": every caller falls back to
        the stored text, so an outage degrades to English rather than to a blank
        screen. The key travels in the Authorization header and is never logged;
        failures are logged by status code alone, in case a body echoes it.
        """
        language = LANGUAGE_NAMES.get(target)
        if language is None:
            return None

        payload = {
            "model": get_settings().openai_translation_model,
            # Deterministic: the same description must not read differently on
            # the next page load, and creativity is the opposite of the job.
            "temperature": 0,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT.format(language=language)},
                {"role": "user", "content": json.dumps({"texts": texts}, ensure_ascii=False)},
            ],
        }
        try:
            response = httpx.post(
                f"{get_settings().openai_base_url.rstrip('/')}/chat/completions",
                headers={"Authorization": f"Bearer {get_settings().openai_api_key.get_secret_value()}"},
                json=payload,
                timeout=REQUEST_TIMEOUT_SECONDS,
            )
        except httpx.HTTPError as error:
            logger.warning("Translation provider unreachable (%s): %s", target, type(error).__name__)
            return None

        if response.status_code != 200:
            logger.warning(
                "Translation provider returned %s for target %s (%d texts).",
                response.status_code,
                target,
                len(texts),
            )
            return None

        try:
            content = response.json()["choices"][0]["message"]["content"]
            results = json.loads(content)["translations"]
        except (ValueError, KeyError, TypeError, IndexError) as error:
            logger.warning("Translation provider sent an unexpected body: %s", type(error).__name__)
            return None

        if not isinstance(results, list) or len(results) != len(texts):
            logger.warning(
                "Translation provider returned %s results for %d texts; discarding.",
                len(results) if isinstance(results, list) else type(results).__name__,
                len(texts),
            )
            return None

        # Keep only answers that are a non-empty string and that preserved every
        # protected value. Anything else becomes the source text, so a bad
        # answer costs a translation, never a corrupted number.
        checked: list[str] = []
        for source, result in zip(texts, results, strict=False):
            if isinstance(result, str) and result.strip() and keeps_protected_tokens(source, result):
                checked.append(result.strip())
            else:
                checked.append(source)
        return checked

    def _translate_uncached(self, texts: list[str], target: str) -> list[str] | None:
        """Translate every pending string, in chunks the model can be held to.

        A failed chunk yields the source text for its own strings only; the rest
        of the screen still gets translated.
        """
        translated: list[str] = []
        for index in range(0, len(texts), TEXTS_PER_MODEL_CALL):
            chunk = texts[index : index + TEXTS_PER_MODEL_CALL]
            answer = self._call_model(chunk, target)
            translated.extend(answer if answer is not None else chunk)
        return translated

    # --- public ------------------------------------------------------------

    def translate(self, texts: list[str], target: str) -> dict[str, str]:
        """Map each input string to its translation.

        Any string that cannot be translated maps to itself, so the caller can
        render the result unconditionally. A string is returned unchanged when
        the target is English, when it holds no translatable word, when it is
        longer than the per-text limit, or when the provider did not answer.
        """
        if target not in SUPPORTED_TARGETS:
            return {text: text for text in texts}

        # English is what is stored, so there is nothing to ask for.
        if target == "en" or not self.configured:
            return {text: text for text in texts}

        answer: dict[str, str] = {}
        pending: list[str] = []

        with self._lock:
            cache = self._cache_for(target)
            for text in texts:
                if text in answer or not text:
                    continue
                stripped = text.strip()
                if not stripped or _NOTHING_TO_TRANSLATE.match(stripped):
                    answer[text] = text
                    continue
                if len(text) > MAX_CHARACTERS_PER_TEXT:
                    answer[text] = text
                    continue
                cached = cache.get(_fingerprint(text))
                if cached is not None:
                    answer[text] = cached
                elif text not in pending:
                    pending.append(text)

        if not pending:
            return answer

        # The provider call happens outside the lock: it is a network round trip,
        # and holding the lock across it would serialise every other request in
        # the process behind it.
        translated = self._translate_uncached(pending, target)
        if translated is None:
            for text in pending:
                answer[text] = text
            return answer

        with self._lock:
            cache = self._cache_for(target)
            for source, result in zip(pending, translated, strict=False):
                value = result or source
                answer[source] = value
                # A string that came back untranslated is not cached: that was a
                # failed chunk or a rejected answer, and caching it would make a
                # transient outage permanent for that text.
                if value != source:
                    cache[_fingerprint(source)] = value
            self._persist(target)

        return answer


_translation_service = TranslationService()


def get_translation_service() -> TranslationService:
    return _translation_service

"""Log redaction (technical-architecture.md 14.2; R6): no password, token, OTP, Aadhaar
number, bank account number, camera credential or full phone number reaches a log line.

`redact_event` is a structlog processor in the shared chain (app/core/logging.py), so it
cleans every line: standard `logging` calls (the message after formatting, its exception
text) and structlog calls (each field). Two layers:

* a field whose NAME is sensitive (password, token, otp, code, aadhaar, account_number,
  secret, credentials, authorization, cookie, api_key, ...) is replaced whole;
* in any text, these are replaced: JSON Web Tokens and Bearer values, the password in
  an address (postgresql://user:...@, rtsp://user:...@), `password=...`-style pairs, a
  4-8 digit code after "code"/"otp"/"pin", 12-digit Aadhaar-shaped numbers, and any run
  of 9 or more digits (account and phone numbers), which keeps only its last 4 digits.

Redaction is a safety net; code must still never log these on purpose.
"""

import re
from collections.abc import MutableMapping
from typing import Any

REDACTED = "[redacted]"

SENSITIVE_NAME = re.compile(
    r"(password|passwd|secret|token|otp|aadhaar|account_number|accountnumber|credential|authorization|cookie|"
    r"api_key|apikey|private_key|session_id|csrf|^code$|_code$|^pin$)",
    re.IGNORECASE,
)
# Names that contain a sensitive word but carry nothing secret.
SAFE_NAMES = {"status_code", "error_code", "country_code", "dial_code", "http_status", "event", "logger", "level"}

TEXT_RULES: list[tuple[re.Pattern[str], Any]] = [
    # Credentials inside an address: scheme://user:password@host
    (re.compile(r"([a-z][a-z0-9+.\-]*://[^\s:/@]+:)[^\s@/]+@", re.IGNORECASE), r"\1" + REDACTED + "@"),
    # JSON Web Tokens (access tokens, hand-off tokens)
    (re.compile(r"\beyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]*"), REDACTED),
    # Authorization: Bearer <value>
    (re.compile(r"(\bbearer\s+)[^\s\"',;]+", re.IGNORECASE), r"\1" + REDACTED),
    # key=value, key: value, "key": "value" for sensitive keys
    (
        re.compile(
            r"(\b(?:password|passwd|secret|token|otp|aadhaar(?:_number)?|account_number|api_key|"
            r"authorization|cookie|credentials?)\b[\"']?\s*[:=]\s*[\"']?)[^\"'\s,&;}]+",
            re.IGNORECASE,
        ),
        r"\1" + REDACTED,
    ),
    # A code after "code", "otp" or "pin": "code is 123456", "OTP: 4821"
    (re.compile(r"(\b(?:code|otp|pin)\b\D{0,12}?)\d{4,8}\b", re.IGNORECASE), r"\1" + REDACTED),
    # Aadhaar-shaped: 12 digits, optionally grouped 4-4-4
    (re.compile(r"\b\d{4}[ -]\d{4}[ -]\d{4}\b"), REDACTED),
    # Long digit runs (bank account, phone, Aadhaar written together): last 4 only
    (re.compile(r"(?<![\w.])\d{9,18}(?![\w.])"), lambda match: "*" * (len(match.group(0)) - 4) + match.group(0)[-4:]),
]


# Identifiers are not secrets: a UUID is left as it is, even when a group is all digits.
UUID = re.compile(r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b")


def _redact_plain(text: str) -> str:
    for pattern, replacement in TEXT_RULES:
        text = pattern.sub(replacement, text)
    return text


def redact_text(text: str) -> str:
    parts = UUID.split(text)
    uuids = UUID.findall(text)
    out = [_redact_plain(parts[0])]
    for identifier, rest in zip(uuids, parts[1:], strict=True):
        out.extend((identifier, _redact_plain(rest)))
    return "".join(out)


def is_sensitive_name(name: str) -> bool:
    return name.lower() not in SAFE_NAMES and bool(SENSITIVE_NAME.search(name))


def redact_value(name: str, value: Any) -> Any:
    if is_sensitive_name(name) and value not in (None, ""):
        return REDACTED
    if isinstance(value, str):
        return redact_text(value)
    if isinstance(value, dict):
        return {key: redact_value(str(key), item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return type(value)(redact_value(name, item) for item in value)
    return value


def redact_event(_logger: Any, _method: str, event_dict: MutableMapping[str, Any]) -> MutableMapping[str, Any]:
    """structlog processor: every field of the line, the message and exception included."""
    for key in list(event_dict):
        if key.startswith("_"):
            continue
        event_dict[key] = redact_value(key, event_dict[key])
    return event_dict

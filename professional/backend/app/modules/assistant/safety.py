"""Viswa's safety rails, applied in code (the prompt asks too, but code decides).

looks_like_injection(text)   a message trying to change Viswa's role, reach other users'
                             data or reveal its instructions: refused without the AI
redact(value)                every tool result passes through here before the AI sees
                             it: contact details, identity and bank numbers, secrets and
                             camera data are removed by field name AND by value pattern
clean_answer(text, paths)    an answer keeps only links to the allow-listed app pages
"""

import re
from typing import Any

# Asked to drop its rules, take another role, reach everyone's data or show its setup.
INJECTION_PATTERNS = [
    r"\b(ignore|disregard|forget|override|bypass)\b.{0,40}\b(instructions?|rules?|prompt|guidelines|restrictions)\b",
    r"\b(system|developer|hidden|initial)\s+(prompt|message|instructions?)\b",
    r"\b(reveal|show|print|repeat|display|tell me|give me|what (are|is|were))\b.{0,30}\byour\s+"
    r"(instructions?|prompt|rules|configuration|system message|tools|api key|keys?|secrets?)\b",
    r"\byou are (now )?(an? )?(admin|administrator|developer|root|superuser|god mode|dan)\b",
    r"\b(act|pretend|behave) (as|like) (an? )?(admin|administrator|developer|another user|root)\b",
    r"\b(switch|change) (my |your )?role\b",
    r"\b(all|every|other) (users?|people|accounts?|owners?|customers?|builders?|suppliers?|engineers?)('s|')? "
    r"(data|projects?|phones?|e-?mails?|details|records|numbers?|address(es)?|names?)\b",
    r"\b(phones?|mobiles?|e-?mails?|aadhaar|address(es)?|bank)\b.{0,30}\bof (another|other|every|all) "
    r"(users?|owners?|people|accounts?)\b",
    r"\b(list|show|give|export|dump)\b.{0,15}\b(all|every)\s+(the\s+)?(users|accounts|people|customers)\b",
    r"\b(drop table|database dump|jailbreak)\b|\bselect\s+\*\s+from\b",
]
INJECTION = re.compile("|".join(INJECTION_PATTERNS), re.IGNORECASE | re.DOTALL)


def looks_like_injection(text: str) -> bool:
    return bool(INJECTION.search(text or ""))


# A key containing any of these is never sent to the AI.
FORBIDDEN_KEY_PARTS = (
    "phone", "mobile", "email", "e_mail", "address", "aadhaar", "aadhar", "pan", "gstin", "gst_number",
    "bank", "ifsc", "account_number", "upi", "password", "secret", "token", "otp", "csrf", "document",
    "license", "camera", "cctv", "stream", "rtsp", "onvif", "credential", "image_url", "avatar", "logo",
    "gallery", "video", "website", "profile_about", "about",
)  # fmt: skip
ALLOWED_KEYS = {"company_name", "expand"}

EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
PHONE = re.compile(r"(?<![\w])(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?![\w])")
AADHAAR = re.compile(r"(?<!\d)\d{4}[\s-]?\d{4}[\s-]?\d{4}(?!\d)")
PAN = re.compile(r"\b[A-Z]{5}\d{4}[A-Z]\b")
GSTIN = re.compile(r"\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]\b")
IFSC = re.compile(r"\b[A-Z]{4}0[A-Z\d]{6}\b")
LONG_NUMBER = re.compile(r"(?<!\d)\d{9,18}(?!\d)")  # bank account numbers and the like
URL_WITH_SECRET = re.compile(r"\b(?:rtsp|rtmp|https?)://\S*(?:token|key|secret|password)=\S*", re.IGNORECASE)
HIDDEN = "[hidden]"
MAX_TEXT = 300


def forbidden_key(key: str) -> bool:
    name = key.lower()
    if name in ALLOWED_KEYS:
        return False
    return any(part in name for part in FORBIDDEN_KEY_PARTS)


UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.IGNORECASE)


def redact_text(text: str) -> str:
    if UUID.fullmatch(text):  # a record id the tools need back (it names nobody)
        return text
    for pattern in (URL_WITH_SECRET, EMAIL, GSTIN, PAN, IFSC, AADHAAR, PHONE, LONG_NUMBER):
        text = pattern.sub(HIDDEN, text)
    return text[:MAX_TEXT]


def redact(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: redact(item) for key, item in value.items() if not forbidden_key(str(key))}
    if isinstance(value, (list, tuple)):
        return [redact(item) for item in value]
    if isinstance(value, str):
        return redact_text(value)
    return value


MARKDOWN_LINK = re.compile(r"\[([^\]]*)\]\(([^)\s]*)\)")
BARE_URL = re.compile(r"\b(?:https?|ftp|javascript|data):\S+", re.IGNORECASE)
HTML_TAG = re.compile(r"<[^>]{1,200}>")


def clean_answer(text: str, allowed_paths: set[str]) -> str:
    """Markdown links keep their text, and their target only if it is an allowed app page;
    web addresses and HTML are removed (the widget shows text only anyway)."""

    def link(match: re.Match[str]) -> str:
        label, target = match.group(1), match.group(2)
        return f"[{label}]({target})" if target in allowed_paths else label

    text = MARKDOWN_LINK.sub(link, text or "")
    text = BARE_URL.sub("", text)
    text = HTML_TAG.sub("", text)
    return text.strip()

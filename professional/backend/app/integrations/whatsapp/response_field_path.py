"""Where in a provider's JSON reply the field that proves acceptance sits.

WHATSAPP_SUCCESS_FIELD names that place as a path, in either spelling:

    messages[0].message_status
    messages.0.message_status

A path is a sequence of object keys and list indexes and nothing else: no expressions,
no wildcards, no code. Anything else makes the whole path invalid, and an invalid path
never matches a reply.

No imports from the application, so both the settings check and the WhatsApp client
can use it without an import cycle. Ported unchanged from the old
app/shared/whatsapp/response_path.py.
"""

import re
from typing import Any

# One object key: letters, digits, underscore or hyphen.
KEY = re.compile(r"[A-Za-z0-9_-]+")
# One list index in brackets, as in messages[0].
INDEX = re.compile(r"\[(\d+)\]")


def parse_path(path: str | None) -> list[str | int] | None:
    """The steps of `path`, or None if the path is blank or holds anything but keys and
    indexes. A bracketed index comes back as an int and names a list position only; a
    dotted step comes back as a string and names an object key, or a list position when
    it is digits."""
    text = (path or "").strip()
    if not text:
        return None
    steps: list[str | int] = []
    position = 0
    while position < len(text):
        if text[position] == ".":
            if position == 0 or position == len(text) - 1 or text[position - 1] == ".":
                return None
            position += 1
            continue
        index = INDEX.match(text, position)
        if index:
            steps.append(int(index.group(1)))
            position = index.end()
            continue
        key = KEY.match(text, position)
        if key:
            steps.append(key.group(0))
            position = key.end()
            continue
        return None
    return steps or None


def field_at(data: Any, path: str | None) -> Any:
    """The value at `path` in `data`, or None if the path is invalid or any step is
    missing. An int step needs a list with that position; a string step needs an object
    with that key, or, when it is digits, a list with that position."""
    steps = parse_path(path)
    if steps is None:
        return None
    value = data
    for step in steps:
        if isinstance(step, int):
            if isinstance(value, list) and step < len(value):
                value = value[step]
            else:
                return None
        elif isinstance(value, dict) and step in value:
            value = value[step]
        elif isinstance(value, list) and step.isdigit() and int(step) < len(value):
            value = value[int(step)]
        else:
            return None
    return value

"""Viswa's help knowledge: one Markdown card per topic (ported from Kuwait-Version's
assistant, adapted to CREWNBUILD), read from knowledge/<role>/cards/*.md and
knowledge/_shared/cards/*.md.

Each file starts with TOML settings between +++ lines, then the Markdown text:

    +++
    id = "award-builder"
    title = "Award a builder"
    keywords = ["award", "assign"]
    buttons = [{ label = "Open my projects", path = "/owner/projects" }]
    next = ["track-progress"]
    +++
    Steps the user follows...

New help topic = one new card, no code. The cards are also the only source of buttons:
Viswa can never link to a page that no card names.
"""

import re
import tomllib
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

KNOWLEDGE_DIR = Path(__file__).resolve().parent / "knowledge"
SHARED = "_shared"
FRONT_MATTER = "+++"
# Which card folders each role reads (plus _shared). Guests see the owner help (they are
# usually house owners-to-be); every supplier category also reads the general supplier cards.
ROLE_FOLDERS: dict[str, tuple[str, ...]] = {
    "GUEST": ("owner",),
    "OWNER": ("owner",),
    "BUILDER": ("builder",),
    "SITE_ENGINEER": ("site_engineer", "engineer"),
    "ENGINEER": ("engineer",),
    "SUPPLIER": ("supplier",),
    "SUPPLIER_MATERIAL": ("supplier", "supplier_material"),
    "SUPPLIER_LABOUR": ("supplier", "supplier_labour"),
    "SUPPLIER_EQUIPMENT": ("supplier", "supplier_equipment"),
    "ADMIN": ("admin",),
}
WORD = re.compile(r"[a-z0-9&]+")
STOP_WORDS = frozenset(
    {"a", "an", "and", "are", "can", "do", "does", "for", "how", "i", "in", "is", "it", "me", "my", "of", "on"}
    | {"or", "the", "to", "what", "where", "when", "with", "you", "your"}
)


class KnowledgeError(ValueError):
    """A card is broken (bad settings, duplicate id, unknown link or page)."""


@dataclass(frozen=True)
class Card:
    id: str
    title: str
    body: str
    keywords: tuple[str, ...] = ()
    buttons: tuple[tuple[str, str], ...] = ()  # (label, path)
    next: tuple[str, ...] = ()

    def words(self) -> set[str]:
        return words(" ".join([self.title, *self.keywords, self.body]))


def words(text: str) -> set[str]:
    return {word for word in WORD.findall(text.lower()) if word not in STOP_WORDS and len(word) > 1}


def _read(path: Path) -> Card:
    text = path.read_text(encoding="utf-8")
    parts = text.split(FRONT_MATTER, 2)
    if not text.startswith(FRONT_MATTER) or len(parts) < 3:
        raise KnowledgeError(f"{path.name}: must start with settings between '+++' lines")
    try:
        settings = tomllib.loads(parts[1])
    except tomllib.TOMLDecodeError as error:
        raise KnowledgeError(f"{path.name}: bad settings: {error}") from None
    if not settings.get("id") or not settings.get("title"):
        raise KnowledgeError(f"{path.name}: 'id' and 'title' are required")
    buttons = []
    for button in settings.get("buttons", []):
        path_value = str(button.get("path", ""))
        if not path_value.startswith("/") or path_value.startswith("//"):
            raise KnowledgeError(f"{path.name}: button path must be an app page: {path_value!r}")
        buttons.append((str(button["label"]), path_value))
    return Card(
        id=settings["id"],
        title=settings["title"],
        body=parts[2].strip(),
        keywords=tuple(settings.get("keywords", [])),
        buttons=tuple(buttons),
        next=tuple(settings.get("next", [])),
    )


@dataclass
class Knowledge:
    cards: dict[str, list[Card]] = field(default_factory=dict)  # folder -> cards

    def cards_for(self, role: str) -> list[Card]:
        folders = ROLE_FOLDERS.get(role)
        if not folders:
            return []
        return [card for folder in (*folders, SHARED) for card in self.cards.get(folder, [])]

    def card(self, role: str, card_id: str) -> Card | None:
        return next((card for card in self.cards_for(role) if card.id == card_id), None)

    def allowed_paths(self, role: str) -> set[str]:
        return {path for card in self.cards_for(role) for _label, path in card.buttons}

    def search(self, role: str, query: str, limit: int = 3) -> list[Card]:
        """The cards that best match the question (shared words, keywords and title count double)."""
        asked = words(query)
        if not asked:
            return []
        scored = []
        for card in self.cards_for(role):
            strong = words(" ".join([card.title, *card.keywords]))
            score = 2 * len(asked & strong) + len(asked & card.words())
            if score:
                scored.append((score, card.id, card))
        scored.sort(key=lambda item: (-item[0], item[1]))
        return [card for _score, _id, card in scored[:limit]]


def load_knowledge(folder: Path = KNOWLEDGE_DIR) -> Knowledge:
    knowledge = Knowledge()
    for role_folder in sorted(path for path in folder.iterdir() if path.is_dir()):
        knowledge.cards[role_folder.name] = [_read(path) for path in sorted(role_folder.glob("cards/*.md"))]
    for role in ROLE_FOLDERS:
        cards = knowledge.cards_for(role)
        ids = [card.id for card in cards]
        duplicates = {card_id for card_id in ids if ids.count(card_id) > 1}
        if duplicates:
            raise KnowledgeError(f"duplicate card ids: {sorted(duplicates)}")
        unknown = {link for card in cards for link in card.next if link not in ids}
        if unknown:
            raise KnowledgeError(f"cards link to unknown cards: {sorted(unknown)}")
    return knowledge


@lru_cache
def get_knowledge() -> Knowledge:
    return load_knowledge()

"""The list fields of a profile, stored as text (ported from the old profile_service.py
and message_service.split_profile_list).

Service locations, categories, documents and the gallery are comma- or line-separated
text; a builder's portfolio (completed_project_details) is a JSON list.
"""

import json
from typing import Any

from app.modules.files.file_ownership import FILE_ADDRESS

# A builder's portfolio: their own previous work, not projects awarded here.
PORTFOLIO_MAX_PROJECTS = 4
PORTFOLIO_MAX_IMAGES = 6


def split_profile_list(value: str | None) -> list[str]:
    if not value:
        return []
    return [item.strip() for item in value.replace("\n", ",").split(",") if item.strip()]


def read_completed_project_details(value: str | None) -> list[dict[str, Any]]:
    """The portfolio in its cleaned form: at most 4 projects, each with at most 6 of its
    own photo addresses, in order, without repeats."""
    if not value:
        return []
    try:
        projects = json.loads(value)
    except (TypeError, ValueError):
        return [
            {"title": item, "location": "", "description": "", "images": []}
            for item in split_profile_list(value)[:PORTFOLIO_MAX_PROJECTS]
        ]
    if not isinstance(projects, list):
        return []
    cleaned: list[dict[str, Any]] = []
    for project in projects[:PORTFOLIO_MAX_PROJECTS]:
        images: list[str] = []
        if isinstance(project, dict):
            title = str(project.get("title") or "").strip()
            location = str(project.get("location") or "").strip()
            description = str(project.get("description") or "").strip()
            raw_images = project.get("images") if isinstance(project.get("images"), list) else []
            for raw_image in raw_images or []:
                image = str(raw_image or "").strip()
                if FILE_ADDRESS.match(image) and image not in images:
                    images.append(image)
            images = images[:PORTFOLIO_MAX_IMAGES]
        else:
            title = str(project or "").strip()
            location = ""
            description = ""
        if title or location or description:
            cleaned.append({"title": title, "location": location, "description": description, "images": images})
    return cleaned


def document_type_labels(documents: str | None) -> list[str]:
    """The document types a profile holds ("GST Certificate", ...), without links."""
    labels: list[str] = []
    for entry in split_profile_list(documents):
        label = entry.split(":", 1)[0].strip() if ": " in entry else ""
        if label and not label.startswith("/") and label not in labels:
            labels.append(label)
    return labels

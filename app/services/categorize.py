"""AI-assisted categorization: fall back to a local LLM (Ollama) for new descriptions.

The service is a pure function of the category tree and the description: it asks Ollama
to pick one of the assignable categories, then maps the returned path back to an id. It
never learns or stores anything itself, so it is safe to run repeatedly; the dictionary
in ``suggestions`` remains the source of truth for descriptions already seen.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from functools import lru_cache

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.services.categories import load_tree

TIMEOUT_SECONDS = 20


@lru_cache(maxsize=256)
def _ask_ollama(url: str, model: str, system: str, user: str) -> str | None:
    """POST to Ollama's /api/chat and return the model's raw message text (or None)."""
    body = json.dumps(
        {
            "model": model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "stream": False,
            "format": "json",
            "options": {"temperature": 0},
        }
    ).encode()
    request = urllib.request.Request(
        url.rstrip("/") + "/api/chat", data=body, headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            payload = json.loads(response.read().decode())
    except (urllib.error.URLError, OSError, json.JSONDecodeError):
        return None
    return (payload.get("message") or {}).get("content")


def _candidates(db: Session) -> list[str]:
    """Full paths of assignable categories (depth >= 1), for the prompt."""
    return [node.path for node in load_tree(db).walk() if node.depth >= 1 and node.category.is_active]


def _resolve(db: Session, paths: list[str], answer: str | None) -> int | None:
    """Match the model's answer to a known path; tolerate a trailing leaf-name match."""
    if not answer:
        return None
    exact = {p.lower(): p for p in paths}
    if answer.lower() in exact:
        candidate = exact[answer.lower()]
    else:
        leaf = answer.rsplit("›", 1)[-1].strip().lower()
        matches = [p for p in paths if p.rsplit("›", 1)[-1].strip().lower() == leaf]
        if len(matches) != 1:
            return None
        candidate = matches[0]
    return {p.lower(): node.id for node in load_tree(db).walk() for p in [node.path]}.get(candidate.lower())


def suggest_category(db: Session, description: str) -> int | None:
    """Best-guess category id for a description via the local LLM, or None if unavailable."""
    settings = get_settings()
    if not settings.ollama_url:
        return None
    paths = _candidates(db)
    if not paths:
        return None
    listing = "\n".join(f"- {p}" for p in paths)
    system = (
        "You categorise personal bank transactions. Given a description and a fixed list of "
        "categories, reply with JSON only: {\"category\": \"<full path from the list>\"}. "
        "Pick the closest match. Never invent a category path."
    )
    user = f"Categories:\n{listing}\n\nDescription: {description}"
    raw = _ask_ollama(settings.ollama_url, settings.ollama_model, system, user)
    return _resolve(db, paths, _parse_category(raw))


def _parse_category(content: str | None) -> str | None:
    if not content:
        return None
    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        return None
    value = data.get("category") if isinstance(data, dict) else None
    return value.strip() if isinstance(value, str) and value.strip() else None
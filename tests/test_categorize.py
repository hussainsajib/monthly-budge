"""AI categorization fallback (Ollama) for new descriptions."""

from __future__ import annotations

import json

from app.core.config import Settings
from app.services import categorize

OLLAMA = "http://localhost:11434"


def _settings_with_ollama(monkeypatch):
    settings = Settings(ollama_url=OLLAMA)
    monkeypatch.setattr(categorize, "get_settings", lambda: settings)
    return settings


def test_skipped_when_ollama_unconfigured(monkeypatch, db):
    monkeypatch.setattr(categorize, "get_settings", lambda: Settings())
    called = False

    def _fail(*_a, **_k):
        nonlocal called
        called = True
        return None

    monkeypatch.setattr(categorize, "_ask_ollama", _fail)
    assert categorize.suggest_category(db, "Fresh Mart") is None
    assert not called


def test_resolve_exact_and_leaf_name(db):
    paths = categorize._candidates(db)
    assert "Discretionary › Grocery" not in paths  # starter has no such path
    # exact full path
    assert categorize._resolve(db, paths, "Essential Variable › Grocery") == _id_of(db, "Grocery")
    # model answers with just the leaf name
    assert categorize._resolve(db, paths, "Grocery") == _id_of(db, "Grocery")
    # unknown answer
    assert categorize._resolve(db, paths, "Space Lasers") is None


def _id_of(db, name: str) -> int:
    from sqlalchemy import select

    from app.models import Category

    return db.scalar(select(Category.id).where(Category.name == name))


def test_suggest_category_uses_model_reply(monkeypatch, db):
    _settings_with_ollama(monkeypatch)
    monkeypatch.setattr(
        categorize, "_ask_ollama", lambda *_a, **_k: json.dumps({"category": "Discretionary › Dining Out / Takeout"})
    )
    cat_id = categorize.suggest_category(db, "Corner Cafe")
    assert cat_id == _id_of(db, "Dining Out / Takeout")


def test_suggest_category_handles_garbage_reply(monkeypatch, db):
    _settings_with_ollama(monkeypatch)
    monkeypatch.setattr(categorize, "_ask_ollama", lambda *_a, **_k: "not json")
    assert categorize.suggest_category(db, "Corner Cafe") is None


def test_suggest_endpoint_uses_ai_fallback(client, ids, monkeypatch):
    cats, _ = ids
    _settings_with_ollama(monkeypatch)
    monkeypatch.setattr(
        categorize, "_ask_ollama", lambda *_a, **_k: json.dumps({"category": "Discretionary › Dining Out / Takeout"})
    )
    res = client.get("/api/suggest", params={"q": "Brand New Cafe No One Typed"})
    assert res.status_code == 200
    body = res.json()
    assert body["category_id"] == cats["Dining Out / Takeout"]
    assert body["amount"] == "" and body["account_id"] is None
"""Application settings, read from environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache


@dataclass(frozen=True)
class Settings:
    database_url: str = "sqlite:///./data/budget.db"
    app_user: str = "admin"
    # When unset, HTTP Basic auth is disabled (fine for local use only).
    app_password: str | None = None
    # Local LLM (Ollama) used to suggest a category when the description is new.
    # Leave OLLAMA_URL unset to disable AI suggestions.
    ollama_url: str | None = None
    ollama_model: str = "qwen2.5:14b"

    @classmethod
    def from_env(cls) -> Settings:
        return cls(
            database_url=os.environ.get("DATABASE_URL", cls.database_url),
            app_user=os.environ.get("APP_USER", cls.app_user),
            app_password=os.environ.get("APP_PASSWORD") or None,
            ollama_url=os.environ.get("OLLAMA_URL") or None,
            ollama_model=os.environ.get("OLLAMA_MODEL", cls.ollama_model),
        )


@lru_cache
def get_settings() -> Settings:
    return Settings.from_env()

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

    @classmethod
    def from_env(cls) -> Settings:
        return cls(
            database_url=os.environ.get("DATABASE_URL", cls.database_url),
            app_user=os.environ.get("APP_USER", cls.app_user),
            app_password=os.environ.get("APP_PASSWORD") or None,
        )


@lru_cache
def get_settings() -> Settings:
    return Settings.from_env()

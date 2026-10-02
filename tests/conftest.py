"""Test setup: a throw-away SQLite file migrated with the real Alembic revisions."""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config

ROOT = Path(__file__).resolve().parents[1]
STARTER_CONFIG = ROOT / "samples" / "starter-config.json"
_DB_FILE = Path(tempfile.mkdtemp()) / "test.db"
os.environ["DATABASE_URL"] = f"sqlite:///{_DB_FILE.as_posix()}"
os.environ.pop("APP_PASSWORD", None)


@pytest.fixture(scope="session", autouse=True)
def _migrated_database():
    cfg = Config(str(ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(ROOT / "migrations"))
    command.upgrade(cfg, "head")

    # Migrations only create the schema; tests get the generic starter categories/accounts like a new user would.
    from app.db.session import get_sessionmaker
    from app.services.config_io import import_config

    with get_sessionmaker()() as session:
        import_config(session, json.loads(STARTER_CONFIG.read_text(encoding="utf-8")), replace=True)
    yield


@pytest.fixture
def db(_migrated_database):
    from sqlalchemy import delete

    from app.db.session import get_sessionmaker
    from app.models import Transaction

    with get_sessionmaker()() as session:
        yield session
        session.rollback()
        session.execute(delete(Transaction))
        session.commit()


@pytest.fixture
def client(_migrated_database, db):
    from fastapi.testclient import TestClient

    from app.main import create_app

    return TestClient(create_app(), follow_redirects=False)


@pytest.fixture
def ids(db):
    """Name -> id maps for seeded categories and accounts."""
    from sqlalchemy import select

    from app.models import Account, Category

    cats = {c.name: c.id for c in db.scalars(select(Category))}
    accs = {a.name: a.id for a in db.scalars(select(Account))}
    return cats, accs

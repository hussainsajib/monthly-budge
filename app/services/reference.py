"""Lookups for accounts and settings."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Account, AppSetting

LOW_BALANCE_KEY = "low_balance_cents"
WARN_BALANCE_KEY = "warn_balance_cents"


def list_accounts(db: Session, include_inactive: bool = False) -> list[Account]:
    stmt = select(Account).order_by(Account.id)
    if not include_inactive:
        stmt = stmt.where(Account.is_active.is_(True))
    return list(db.scalars(stmt))


def get_int_setting(db: Session, key: str, default: int) -> int:
    row = db.get(AppSetting, key)
    return int(row.value) if row else default


def set_int_setting(db: Session, key: str, value: int) -> None:
    row = db.get(AppSetting, key)
    if row:
        row.value = str(value)
    else:
        db.add(AppSetting(key=key, value=str(value)))
    db.commit()

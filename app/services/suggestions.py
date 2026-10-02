"""Autofill: remember the category/account/amount last used for a description."""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Transaction

MIN_FUZZY_LENGTH = 4


@dataclass(frozen=True)
class Suggestion:
    description: str
    category_id: int
    account_id: int | None
    amount_cents: int


def build_index(db: Session) -> dict[str, Suggestion]:
    """Map lower-cased description -> most recent usage (later rows overwrite earlier)."""
    stmt = select(
        Transaction.description,
        Transaction.category_id,
        Transaction.account_id,
        Transaction.amount_cents,
    ).order_by(Transaction.date, Transaction.id)
    return {
        row.description.strip().lower(): Suggestion(
            row.description, row.category_id, row.account_id, abs(row.amount_cents)
        )
        for row in db.execute(stmt)
    }


def lookup(index: dict[str, Suggestion], text: str) -> Suggestion | None:
    """Exact match first, then the longest known description contained in ``text``.

    The fuzzy path lets noisy bank descriptions ("FRESH MART #123 ANYTOWN") reuse
    what was learned from manual entries ("Fresh Mart").
    """
    key = text.strip().lower()
    if not key:
        return None
    if key in index:
        return index[key]
    best: str | None = None
    for known in index:
        if len(known) >= MIN_FUZZY_LENGTH and known in key and (best is None or len(known) > len(best)):
            best = known
    return index[best] if best else None

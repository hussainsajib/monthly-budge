"""Transaction CRUD and querying."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models import Category, Transaction
from app.schemas.transaction import TransactionInput


@dataclass
class TransactionFilter:
    start: date | None = None
    end: date | None = None
    category_ids: set[int] | None = None  # a category and all its descendants
    account_id: int | None = None
    search: str | None = None


def _apply(stmt, f: TransactionFilter):
    if f.start:
        stmt = stmt.where(Transaction.date >= f.start)
    if f.end:
        stmt = stmt.where(Transaction.date <= f.end)
    if f.category_ids:
        stmt = stmt.where(Transaction.category_id.in_(f.category_ids))
    if f.account_id:
        stmt = stmt.where(Transaction.account_id == f.account_id)
    if f.search:
        like = f"%{f.search.strip()}%"
        stmt = stmt.where(or_(Transaction.description.ilike(like), Transaction.notes.ilike(like)))
    return stmt


def list_transactions(
    db: Session, f: TransactionFilter, limit: int = 100, offset: int = 0
) -> tuple[list[Transaction], int]:
    base = _apply(select(Transaction), f)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    items = db.scalars(
        base.order_by(Transaction.date.desc(), Transaction.id.desc()).limit(limit).offset(offset)
    ).unique()
    return list(items), total


def recent_transactions(db: Session, limit: int = 10) -> list[Transaction]:
    stmt = (
        select(Transaction)
        .where(Transaction.date <= date.today())
        .order_by(Transaction.created_at.desc(), Transaction.id.desc())
        .limit(limit)
    )
    return list(db.scalars(stmt).unique())


def recent_descriptions(db: Session, limit: int = 300) -> list[str]:
    stmt = (
        select(Transaction.description, func.max(Transaction.date).label("last"))
        .group_by(Transaction.description)
        .order_by(func.max(Transaction.date).desc())
        .limit(limit)
    )
    return [row.description for row in db.execute(stmt)]


def _require_assignable_category(db: Session, category_id: int) -> None:
    """Transactions go under a category, never directly under a top-level section."""
    cat = db.get(Category, category_id)
    if cat is None or cat.parent_id is None:
        raise ValueError("Pick a category")


def create_transaction(db: Session, data: TransactionInput) -> Transaction:
    _require_assignable_category(db, data.category_id)
    txn = Transaction(**data.model_dump())
    db.add(txn)
    db.commit()
    return txn


def update_transaction(db: Session, txn: Transaction, data: TransactionInput) -> Transaction:
    _require_assignable_category(db, data.category_id)
    for field, value in data.model_dump().items():
        setattr(txn, field, value)
    db.commit()
    return txn


def delete_transaction(db: Session, txn: Transaction) -> None:
    db.delete(txn)
    db.commit()

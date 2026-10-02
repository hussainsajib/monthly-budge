"""Recurring templates -> concrete transactions for a month."""

from __future__ import annotations

import calendar
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import RecurringTemplate, Transaction


def list_templates(db: Session) -> list[RecurringTemplate]:
    stmt = select(RecurringTemplate).order_by(RecurringTemplate.day_of_month, RecurringTemplate.id)
    return list(db.scalars(stmt).unique())


def generate_for_month(db: Session, year: int, month: int) -> int:
    """Create missing transactions for active templates. Idempotent; returns number created."""
    last_day = calendar.monthrange(year, month)[1]
    first, last = date(year, month, 1), date(year, month, last_day)
    existing = {
        (t.description.lower(), t.category_id)
        for t in db.scalars(select(Transaction).where(Transaction.date >= first, Transaction.date <= last)).unique()
    }
    created = 0
    for tpl in list_templates(db):
        if not tpl.is_active or (tpl.description.lower(), tpl.category_id) in existing:
            continue
        db.add(
            Transaction(
                date=date(year, month, min(tpl.day_of_month, last_day)),
                description=tpl.description,
                category_id=tpl.category_id,
                account_id=tpl.account_id,
                amount_cents=tpl.amount_cents,
                notes="Recurring",
            )
        )
        created += 1
    db.commit()
    return created

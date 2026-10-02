"""Running-balance ledger for an account, including future-dated (planned) entries."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Account, Transaction
from app.services.reference import LOW_BALANCE_KEY, WARN_BALANCE_KEY, get_int_setting


@dataclass
class LedgerRow:
    txn: Transaction
    delta_cents: int
    balance_cents: int
    is_planned: bool
    level: str  # "", "warn" or "low"


@dataclass
class Ledger:
    rows: list[LedgerRow]
    current_balance_cents: int
    projected_balance_cents: int
    lowest: LedgerRow | None
    low_threshold_cents: int
    warn_threshold_cents: int


def build_ledger(db: Session, account: Account, today: date | None = None) -> Ledger:
    today = today or date.today()
    low = get_int_setting(db, LOW_BALANCE_KEY, 50_000)
    warn = get_int_setting(db, WARN_BALANCE_KEY, 100_000)

    stmt = select(Transaction).where(Transaction.account_id == account.id)
    if account.opening_date:
        stmt = stmt.where(Transaction.date >= account.opening_date)
    stmt = stmt.order_by(Transaction.date, Transaction.id)

    balance = account.opening_balance_cents
    current = balance
    rows: list[LedgerRow] = []
    for txn in db.scalars(stmt).unique():
        delta = txn.cash_delta_cents
        balance += delta
        planned = txn.date > today
        if not planned:
            current = balance
        level = "low" if balance < low else "warn" if balance < warn else ""
        rows.append(LedgerRow(txn, delta, balance, planned, level))

    return Ledger(
        rows=rows,
        current_balance_cents=current,
        projected_balance_cents=balance,
        lowest=min(rows, key=lambda r: r.balance_cents, default=None),
        low_threshold_cents=low,
        warn_threshold_cents=warn,
    )

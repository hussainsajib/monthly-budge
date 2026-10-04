"""JSON API for the React front end. Thin handlers over ``app.services``; money is integer cents."""

from __future__ import annotations

from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from pydantic import BaseModel, ValidationError
from sqlalchemy import case, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.money import to_cents
from app.db.session import get_db
from app.models import INCOME, Account, Category, RecurringTemplate, Transaction
from app.schemas.transaction import TransactionInput
from app.services import budgets, importing, reports
from app.services import categories as category_service
from app.services import transactions as txn_service
from app.services.cashflow import build_ledger
from app.services.categories import CategoryTree
from app.services.recurring import generate_for_month, list_templates, validate_schedule
from app.services.reference import (
    LOW_BALANCE_KEY,
    WARN_BALANCE_KEY,
    list_accounts,
    set_int_setting,
)

router = APIRouter(prefix="/api")

PAGE_SIZE = 100
ACCOUNT_KINDS = ("bank", "credit", "cash")
ACCOUNT_SORTS = (
    "name",
    "kind",
    "opening",
    "opening_date",
    "balance",
    "transactions",
    "activity",
    "status",
)


def friendly(exc: Exception) -> str:
    """Short user-facing text for validation / parsing errors."""
    if isinstance(exc, ValidationError):
        return exc.errors()[0]["msg"].removeprefix("Value error, ")
    return str(exc)


@contextmanager
def user_errors() -> Iterator[None]:
    """Turn business-rule / parsing failures (all ValueErrors) into a 400 with a readable message."""
    try:
        yield
    except ValueError as exc:
        raise HTTPException(400, friendly(exc)) from exc


# ---------------------------------------------------------------- categories


class CategoryBody(BaseModel):
    name: str
    parent_id: int | None = None
    kind: str = "expense"
    budget: str = "0"
    description: str = ""
    sort_order: int = 0
    is_active: bool = True


def _category_rows(db: Session, tree: CategoryTree) -> list[dict]:
    counts = dict(db.execute(select(Transaction.category_id, func.count()).group_by(Transaction.category_id)).all())
    recurring = dict(
        db.execute(select(RecurringTemplate.category_id, func.count()).group_by(RecurringTemplate.category_id)).all()
    )
    return [
        {
            "id": n.id,
            "name": n.name,
            "parent_id": n.category.parent_id,
            "kind": n.category.kind,
            "depth": n.depth,
            "path": n.path,
            "budget_cents": n.category.monthly_budget_cents,
            "effective_budget_cents": n.effective_budget_cents,
            "description": n.category.description,
            "sort_order": n.category.sort_order,
            "is_active": n.category.is_active,
            "has_children": bool(n.children),
            "child_count": len(n.children),
            "transaction_count": counts.get(n.id, 0),
            "recurring_count": recurring.get(n.id, 0),
        }
        for n in tree.walk()
    ]


@router.get("/categories")
def list_categories(db: Session = Depends(get_db)):
    return _category_rows(db, category_service.load_tree(db))


@router.post("/categories", status_code=201)
def create_category(body: CategoryBody, db: Session = Depends(get_db)):
    with user_errors():
        cat = category_service.create_category(
            db, body.name, body.parent_id, body.kind, to_cents(body.budget or "0"), body.description
        )
    return {"id": cat.id}


@router.put("/categories/{category_id}")
def update_category(category_id: int, body: CategoryBody, db: Session = Depends(get_db)):
    with user_errors():
        category_service.update_category(
            db,
            category_id,
            name=body.name,
            parent_id=body.parent_id,
            kind=body.kind,
            budget_cents=to_cents(body.budget or "0"),
            description=body.description,
            sort_order=body.sort_order,
            is_active=body.is_active,
        )
    return {"id": category_id}


@router.delete("/categories/{category_id}", status_code=204)
def delete_category(category_id: int, move_to_id: int | None = None, db: Session = Depends(get_db)):
    with user_errors():
        category_service.delete_category(db, category_id, move_to_id)
    return Response(status_code=204)


# ------------------------------------------------------------------ accounts


class AccountBody(BaseModel):
    name: str
    kind: str = "bank"
    opening_balance: str = "0"
    opening_date: date | None = None
    is_active: bool = True


def _account_out(a: Account, stats: dict | None = None) -> dict:
    stats = stats or {}
    return {
        "id": a.id,
        "name": a.name,
        "kind": a.kind,
        "opening_balance_cents": a.opening_balance_cents,
        "opening_date": a.opening_date.isoformat() if a.opening_date else None,
        "current_balance_cents": a.opening_balance_cents + stats.get("delta", 0),
        "transaction_count": stats.get("count", 0),
        "transacted_cents": stats.get("abs", 0),
        "is_active": a.is_active,
    }


def _sort_accounts(rows: list[dict], sort: str, desc: bool) -> list[dict]:
    """Order the accounts table. An account set is small, so the shaped rows sort directly in Python."""
    keys: dict[str, Callable[[dict], Any]] = {
        "name": lambda a: a["name"].lower(),
        "kind": lambda a: a["kind"],
        "opening": lambda a: a["opening_balance_cents"],
        "opening_date": lambda a: a["opening_date"] or "",
        "balance": lambda a: a["current_balance_cents"],
        "transactions": lambda a: a["transaction_count"],
        "activity": lambda a: a["transacted_cents"],
        "status": lambda a: a["is_active"],
    }
    if sort not in ACCOUNT_SORTS:
        raise HTTPException(400, f"Sort must be one of: {', '.join(ACCOUNT_SORTS)}")
    return sorted(rows, key=keys[sort], reverse=desc)


def _account_stats(db: Session) -> dict[int, dict]:
    """Per-account: balance change up to today, transaction count, and total transacted."""
    today = date.today()
    deltas = dict(
        db.execute(
            select(
                Transaction.account_id,
                func.sum(case((Category.kind == INCOME, Transaction.amount_cents), else_=-Transaction.amount_cents)),
            )
            .join(Category, Transaction.category_id == Category.id)
            .where(Transaction.account_id.is_not(None), Transaction.date <= today)
            .group_by(Transaction.account_id)
        ).all()
    )
    rows = db.execute(
        select(
            Transaction.account_id,
            func.count(),
            func.sum(func.abs(Transaction.amount_cents)),
        )
        .where(Transaction.account_id.is_not(None))
        .group_by(Transaction.account_id)
    ).all()
    stats: dict[int, dict] = {}
    for acc_id, count, transacted in rows:
        stats[acc_id] = {"delta": deltas.get(acc_id, 0), "count": count, "abs": transacted or 0}
    for acc_id, delta in deltas.items():
        stats.setdefault(acc_id, {"delta": delta, "count": 0, "abs": 0})
    return stats


def _apply_account(acc: Account, body: AccountBody) -> None:
    if body.kind not in ACCOUNT_KINDS or not body.name.strip():
        raise ValueError("Name and a valid type are required")
    acc.name, acc.kind = body.name.strip(), body.kind
    acc.opening_balance_cents = to_cents(body.opening_balance or "0")
    acc.opening_date = body.opening_date
    acc.is_active = body.is_active


def _save_account(db: Session, acc: Account, body: AccountBody) -> dict:
    with user_errors():
        _apply_account(acc, body)
        db.add(acc)
        try:
            db.commit()
        except IntegrityError as exc:
            db.rollback()
            raise ValueError(f"'{body.name.strip()}' already exists") from exc
    return _account_out(acc)


@router.get("/accounts")
def get_accounts(
    include_inactive: bool = True, sort: str = "name", dir: str = "asc", db: Session = Depends(get_db)
):
    if dir not in ("asc", "desc"):
        raise HTTPException(400, "dir must be 'asc' or 'desc'")
    stats = _account_stats(db)
    rows = [_account_out(a, stats.get(a.id)) for a in list_accounts(db, include_inactive=include_inactive)]
    return _sort_accounts(rows, sort, dir == "desc")


@router.post("/accounts", status_code=201)
def create_account(body: AccountBody, db: Session = Depends(get_db)):
    return _save_account(db, Account(), body)


@router.put("/accounts/{account_id}")
def update_account(account_id: int, body: AccountBody, db: Session = Depends(get_db)):
    acc = db.get(Account, account_id)
    if acc is None:
        raise HTTPException(404, "Account not found")
    return _save_account(db, acc, body)


@router.delete("/accounts/{account_id}", status_code=204)
def delete_account(account_id: int, db: Session = Depends(get_db)):
    acc = db.get(Account, account_id)
    if acc is not None:
        db.delete(acc)  # transactions/recurring reference accounts with ON DELETE SET NULL
        db.commit()
    return Response(status_code=204)


# -------------------------------------------------------------- transactions


class TransactionBody(BaseModel):
    date: date
    description: str
    category_id: int
    account_id: int | None = None
    amount: str
    notes: str | None = None


class BulkCategoryBody(BaseModel):
    ids: list[int]
    category_id: int


def _txn_input(body: TransactionBody) -> TransactionInput:
    return TransactionInput(
        date=body.date,
        description=body.description,
        category_id=body.category_id,
        account_id=body.account_id,
        amount_cents=to_cents(body.amount),
        notes=body.notes,
    )


def _txn_out(t: Transaction, tree: CategoryTree) -> dict:
    return {
        "id": t.id,
        "date": t.date.isoformat(),
        "description": t.description,
        "category_id": t.category_id,
        "category_path": tree.path(t.category_id),
        "kind": t.category.kind,
        "account_id": t.account_id,
        "account_name": t.account.name if t.account else None,
        "amount_cents": t.amount_cents,
        "notes": t.notes,
        "planned": t.date > date.today(),
    }


def _get_txn(db: Session, txn_id: int) -> Transaction:
    txn = db.get(Transaction, txn_id)
    if txn is None:
        raise HTTPException(404, "Transaction not found")
    return txn


@router.get("/transactions")
def list_transactions(
    db: Session = Depends(get_db),
    start: date | None = None,
    end: date | None = None,
    category_id: int | None = None,
    account_id: int | None = None,
    q: str | None = None,
    sort: str = "date",
    dir: str = "desc",
    page: int = 1,
):
    tree = category_service.load_tree(db)
    flt = txn_service.TransactionFilter(
        start=start,
        end=end,
        category_ids=tree.nodes[category_id].subtree_ids() if category_id in tree.nodes else None,
        account_id=account_id,
        search=q,
    )
    page = max(page, 1)
    items, total = txn_service.list_transactions(
        db, flt, PAGE_SIZE, (page - 1) * PAGE_SIZE, sort=sort, desc=(dir != "asc")
    )
    return {
        "items": [_txn_out(t, tree) for t in items],
        "total": total,
        "page": page,
        "pages": max((total + PAGE_SIZE - 1) // PAGE_SIZE, 1),
    }


# Static paths first so "recent" is not parsed as a transaction id.
@router.get("/transactions/recent")
def recent_transactions(db: Session = Depends(get_db)):
    tree = category_service.load_tree(db)
    return [_txn_out(t, tree) for t in txn_service.recent_transactions(db)]


@router.get("/transactions/descriptions")
def descriptions(db: Session = Depends(get_db)):
    return txn_service.recent_descriptions(db)


@router.post("/transactions/bulk-category")
def bulk_category(body: BulkCategoryBody, db: Session = Depends(get_db)):
    if not body.ids:
        raise HTTPException(400, "Select at least one transaction")
    with user_errors():
        count = category_service.reassign_transactions(db, body.ids, body.category_id)
    return {"moved": count}


@router.post("/transactions", status_code=201)
def create_transaction(body: TransactionBody, db: Session = Depends(get_db)):
    with user_errors():
        txn = txn_service.create_transaction(db, _txn_input(body))
    return _txn_out(txn, category_service.load_tree(db))


@router.get("/transactions/{txn_id}")
def get_transaction(txn_id: int, db: Session = Depends(get_db)):
    return _txn_out(_get_txn(db, txn_id), category_service.load_tree(db))


@router.put("/transactions/{txn_id}")
def update_transaction(txn_id: int, body: TransactionBody, db: Session = Depends(get_db)):
    txn = _get_txn(db, txn_id)
    with user_errors():
        txn_service.update_transaction(db, txn, _txn_input(body))
    return _txn_out(txn, category_service.load_tree(db))


@router.delete("/transactions/{txn_id}", status_code=204)
def delete_transaction(txn_id: int, db: Session = Depends(get_db)):
    txn_service.delete_transaction(db, _get_txn(db, txn_id))
    return Response(status_code=204)


# ----------------------------------------------------------------- recurring


class RecurringBody(BaseModel):
    description: str
    category_id: int
    account_id: int | None = None
    amount: str
    day_of_month: int = 1
    schedule: dict | None = None
    is_active: bool = True


class GenerateBody(BaseModel):
    month: str | None = None  # "YYYY-MM"; defaults to the current month


def _recurring_out(t: RecurringTemplate, tree: CategoryTree) -> dict:
    return {
        "id": t.id,
        "description": t.description,
        "category_id": t.category_id,
        "category_path": tree.path(t.category_id),
        "account_id": t.account_id,
        "account_name": t.account.name if t.account else None,
        "amount_cents": t.amount_cents,
        "day_of_month": t.day_of_month,
        "schedule": t.schedule,
        "is_active": t.is_active,
    }


def _sort_recurring(rows: list[dict], sort: str, desc: bool) -> list[dict]:
    """Order the recurring table. Repeats is left unsortable: its summary is text, not a rank."""
    keys: dict[str, Callable[[dict], Any]] = {
        "description": lambda t: t["description"].lower(),
        "category": lambda t: t["category_path"].lower(),
        "account": lambda t: (t["account_name"] or "").lower(),
        "amount": lambda t: t["amount_cents"],
        "status": lambda t: t["is_active"],
    }
    if sort not in keys:
        raise HTTPException(400, f"Sort must be one of: {', '.join(keys)}")
    return sorted(rows, key=keys[sort], reverse=desc)


def _apply_recurring(tpl: RecurringTemplate, body: RecurringBody) -> None:
    if not body.description.strip():
        raise ValueError("Description and category are required")
    if body.schedule is not None:
        tpl.schedule = validate_schedule(body.schedule)
    else:
        if not 1 <= body.day_of_month <= 31:
            raise ValueError("Day of month must be 1-31")
        tpl.schedule = None
    tpl.day_of_month = body.day_of_month
    tpl.description = body.description.strip()
    tpl.category_id = body.category_id
    tpl.account_id = body.account_id
    tpl.amount_cents = to_cents(body.amount)
    tpl.is_active = body.is_active


@router.get("/recurring")
def get_recurring(sort: str = "description", dir: str = "asc", db: Session = Depends(get_db)):
    if dir not in ("asc", "desc"):
        raise HTTPException(400, "dir must be 'asc' or 'desc'")
    tree = category_service.load_tree(db)
    rows = [_recurring_out(t, tree) for t in list_templates(db)]
    return _sort_recurring(rows, sort, dir == "desc")


@router.post("/recurring/generate")
def generate_recurring(body: GenerateBody, db: Session = Depends(get_db)):
    with user_errors():
        year, month = (int(p) for p in (body.month or date.today().strftime("%Y-%m")).split("-"))
        created = generate_for_month(db, year, month)
    return {"created": created}


@router.post("/recurring", status_code=201)
def create_recurring(body: RecurringBody, db: Session = Depends(get_db)):
    tpl = RecurringTemplate()
    with user_errors():
        _apply_recurring(tpl, body)
    db.add(tpl)
    db.commit()
    return {"id": tpl.id}


@router.put("/recurring/{tpl_id}")
def update_recurring(tpl_id: int, body: RecurringBody, db: Session = Depends(get_db)):
    tpl = db.get(RecurringTemplate, tpl_id)
    if tpl is None:
        raise HTTPException(404, "Template not found")
    with user_errors():
        _apply_recurring(tpl, body)
    db.commit()
    return {"id": tpl.id}


@router.delete("/recurring/{tpl_id}", status_code=204)
def delete_recurring(tpl_id: int, db: Session = Depends(get_db)):
    tpl = db.get(RecurringTemplate, tpl_id)
    if tpl is not None:
        db.delete(tpl)
        db.commit()
    return Response(status_code=204)


# -------------------------------------------------------------------- import

MAX_UPLOAD_BYTES = 2_000_000


class ImportRow(BaseModel):
    date: date
    description: str
    amount_cents: int
    direction: str
    category_id: int
    key: str


class ImportCommitBody(BaseModel):
    account_id: int | None = None
    rows: list[ImportRow]


@router.post("/import/preview")
async def import_preview(
    db: Session = Depends(get_db),
    file: UploadFile = File(...),
    account_id: int | None = Form(None),
    amount_sign: str = Form("positive_is_expense"),
):
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(400, "File is too large (2 MB max)")
    with user_errors():
        rows = importing.parse_csv(content, positive_is_expense=amount_sign == "positive_is_expense")
        rows = importing.prepare_preview(db, rows, account_id)
    if not rows:
        raise HTTPException(400, "No transactions found in that file")
    return [
        {
            "date": r.date.isoformat(),
            "description": r.description,
            "amount_cents": r.amount_cents,
            "direction": r.direction,
            "category_id": r.category_id,
            "duplicate": r.duplicate,
            "key": r.key,
        }
        for r in rows
    ]


@router.post("/import/commit")
def import_commit(body: ImportCommitBody, db: Session = Depends(get_db)):
    tree = category_service.load_tree(db)
    for i, row in enumerate(body.rows, start=1):
        node = tree.nodes.get(row.category_id)
        if node is None or node.depth < 1:
            raise HTTPException(400, f"Row {i} ({row.description}) has no category; nothing was imported")
        if row.direction not in ("in", "out"):
            raise HTTPException(400, f"Row {i} has an invalid direction")
    parsed = [
        importing.ParsedRow(
            r.date, r.description, r.amount_cents, r.direction, category_id=r.category_id, key=r.key
        )
        for r in body.rows
    ]
    return {"imported": importing.commit_rows(db, parsed, body.account_id)}


# ------------------------------------------------------------------- budgets


class BudgetAmountBody(BaseModel):
    amount: str | None = None  # None clears the override (back to the category default)


@router.get("/budget")
def get_budget(month: str | None = None, db: Session = Depends(get_db)):
    """Budget vs actual for one month (``YYYY-MM``, default: this month), with the zero-based check."""
    with user_errors():
        first = budgets.parse_month(month or date.today().strftime("%Y-%m"))
    data = budgets.build_month(db, first)
    return {
        "month": first.strftime("%Y-%m"),
        "income_budget": data.income_budget,
        "expense_budget": data.expense_budget,
        "income_actual": data.income_actual,
        "expense_actual": data.expense_actual,
        "unassigned": data.unassigned_cents,
        "lines": [
            {
                "category_id": line.category_id,
                "name": line.name,
                "parent_id": line.parent_id,
                "depth": line.depth,
                "kind": line.kind,
                "has_children": line.has_children,
                "is_active": line.is_active,
                "default_cents": line.default_cents,
                "budget_cents": line.budget_cents,
                "is_override": line.is_override,
                "actual_cents": line.actual_cents,
                "remaining_cents": line.remaining_cents,
            }
            for line in data.lines
        ],
    }


@router.put("/budget/{month}/{category_id}")
def set_budget(month: str, category_id: int, body: BudgetAmountBody, db: Session = Depends(get_db)):
    with user_errors():
        budgets.set_budget(
            db,
            budgets.parse_month(month),
            category_id,
            None if body.amount is None else to_cents(body.amount or "0"),
        )
    return {"ok": True}


@router.post("/budget/{month}/copy-previous")
def copy_previous_budget(month: str, db: Session = Depends(get_db)):
    with user_errors():
        changed = budgets.copy_previous(db, budgets.parse_month(month))
    return {"changed": changed}


# ------------------------------------------------------------------- reports


@router.get("/reports")
def get_report(db: Session = Depends(get_db), month: int | None = None, as_of: date | None = None):
    """Rolling report over the last ``WINDOW_MONTHS`` months.

    ``month`` is a 1-based position in that window and only drives the category chart; it defaults
    to the last month with activity. ``as_of`` pins the end of the window instead of today.
    """
    anchor = as_of or date.today()
    report = reports.budget_report(db, as_of=anchor)
    n = len(report.window)
    default = (report.last_active_index + 1) if report.last_active_index is not None else n
    m = min(max((month or default) - 1, 0), n - 1)
    return {
        "months": report.months,
        "month": m + 1,
        "net_months": report.net_months,
        "expense_budget": report.expense_budget,
        "income_budget": report.income_budget,
        "avg_expense": report.avg_expense,
        "rows": [
            {
                "category_id": r.category_id,
                "name": r.name,
                "depth": r.depth,
                "kind": r.kind,
                "has_children": r.has_children,
                "months": r.months,
                "budget": r.budget,
                "total": r.total,
                "avg": r.avg,
                "variance": r.variance,
                "status": r.status,
            }
            for r in report.rows
        ],
        "chart": reports.chart_payload(report, m),
    }


# ------------------------------------------------------------------ cash flow


@router.get("/cashflow")
def get_cashflow(db: Session = Depends(get_db), account_id: int | None = None):
    accounts = list_accounts(db)
    account = db.get(Account, account_id) if account_id else None
    account = account or next((a for a in accounts if a.kind == "bank"), None)
    if account is None:
        return {"account": None, "ledger": None}
    ledger = build_ledger(db, account)

    def row(r) -> dict:
        return {
            "txn_id": r.txn.id,
            "date": r.txn.date.isoformat(),
            "description": r.txn.description,
            "delta_cents": r.delta_cents,
            "balance_cents": r.balance_cents,
            "is_planned": r.is_planned,
            "level": r.level,
        }

    return {
        "account": _account_out(account),
        "ledger": {
            "rows": [row(r) for r in ledger.rows],
            "current_balance_cents": ledger.current_balance_cents,
            "projected_balance_cents": ledger.projected_balance_cents,
            "lowest": row(ledger.lowest) if ledger.lowest else None,
            "low_threshold_cents": ledger.low_threshold_cents,
            "warn_threshold_cents": ledger.warn_threshold_cents,
        },
    }


# ------------------------------------------------------------------- settings


class ThresholdsBody(BaseModel):
    low: str
    warn: str


@router.put("/settings/thresholds")
def set_thresholds(body: ThresholdsBody, db: Session = Depends(get_db)):
    with user_errors():
        low, warn = to_cents(body.low), to_cents(body.warn)
    set_int_setting(db, LOW_BALANCE_KEY, low)
    set_int_setting(db, WARN_BALANCE_KEY, warn)
    return {"low_balance_cents": low, "warn_balance_cents": warn}

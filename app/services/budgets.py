"""Per-month budgets: a category's default budget, optionally overridden for a given month.

Only leaf categories hold a budget; a parent's budget and actual are the sum of its children
(the same rule ``app.services.categories`` uses for the default budgets).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.models import EXPENSE, INCOME, MonthlyBudget, Transaction
from app.services.categories import CategoryError, Node, load_tree


@dataclass
class BudgetLine:
    category_id: int
    name: str
    parent_id: int | None
    depth: int
    kind: str
    has_children: bool
    is_active: bool
    default_cents: int  # rolled up for parents
    budget_cents: int  # this month's budget, rolled up for parents
    is_override: bool  # leaf only
    actual_cents: int  # rolled up for parents

    @property
    def remaining_cents(self) -> int:
        return self.budget_cents - self.actual_cents


@dataclass
class BudgetMonth:
    month: date
    lines: list[BudgetLine]
    income_budget: int
    expense_budget: int
    income_actual: int
    expense_actual: int

    @property
    def unassigned_cents(self) -> int:
        """Zero-based check: income expected minus everything given a budget (0 = every dollar assigned)."""
        return self.income_budget - self.expense_budget


def parse_month(text: str) -> date:
    """'2026-05' -> date(2026, 5, 1)."""
    try:
        year, month = (int(p) for p in text.split("-"))
        return date(year, month, 1)
    except (ValueError, AttributeError) as exc:
        raise ValueError(f"Not a valid month: {text!r} (expected YYYY-MM)") from exc


def previous_month(month: date) -> date:
    return date(month.year - 1, 12, 1) if month.month == 1 else date(month.year, month.month - 1, 1)


def _next_month(month: date) -> date:
    return date(month.year + 1, 1, 1) if month.month == 12 else date(month.year, month.month + 1, 1)


def _overrides(db: Session, month: date) -> dict[int, int]:
    rows = db.execute(select(MonthlyBudget.category_id, MonthlyBudget.amount_cents).where(MonthlyBudget.month == month))
    return {category_id: amount for category_id, amount in rows}


def _actuals(db: Session, month: date) -> dict[int, int]:
    stmt = (
        select(Transaction.category_id, func.sum(Transaction.amount_cents))
        .where(Transaction.date >= month, Transaction.date < _next_month(month))
        .group_by(Transaction.category_id)
    )
    return {category_id: int(total) for category_id, total in db.execute(stmt)}


def effective_budgets(db: Session, month: date) -> dict[int, int]:
    """Leaf category id -> budget for ``month`` (override if set, else the default)."""
    overrides = _overrides(db, month)
    return {
        n.id: overrides.get(n.id, n.category.monthly_budget_cents) for n in load_tree(db).walk() if not n.children
    }


def build_month(db: Session, month: date) -> BudgetMonth:
    tree = load_tree(db)
    overrides = _overrides(db, month)
    actuals = _actuals(db, month)
    lines: list[BudgetLine] = []

    def visit(node: Node) -> tuple[int, int, int]:
        """Pre-order emit with post-order totals: reserve the slot, fill after the children."""
        slot = len(lines)
        lines.append(None)  # type: ignore[arg-type]
        if node.children:
            totals = [visit(child) for child in node.children]
            default, budget, actual = (sum(t[i] for t in totals) for i in range(3))
            actual += actuals.get(node.id, 0)  # a parent should not hold transactions, but never lose one
        else:
            default = node.category.monthly_budget_cents
            budget = overrides.get(node.id, default)
            actual = actuals.get(node.id, 0)
        cat = node.category
        if cat.is_active or budget or actual:
            lines[slot] = BudgetLine(
                node.id,
                node.name,
                cat.parent_id,
                node.depth,
                cat.kind,
                bool(node.children),
                cat.is_active,
                default,
                budget,
                node.id in overrides and not node.children,
                actual,
            )
        else:
            lines[slot] = None  # type: ignore[assignment]
        return default, budget, actual

    for root in tree.roots:
        visit(root)
    lines = [line for line in lines if line is not None]

    def total(kind: str, attr: str) -> int:
        return sum(getattr(line, attr) for line in lines if line.depth == 0 and line.kind == kind)

    return BudgetMonth(
        month,
        lines,
        income_budget=total(INCOME, "budget_cents"),
        expense_budget=total(EXPENSE, "budget_cents"),
        income_actual=total(INCOME, "actual_cents"),
        expense_actual=total(EXPENSE, "actual_cents"),
    )


def _leaf(db: Session, category_id: int) -> Node:
    node = load_tree(db).nodes.get(category_id)
    if node is None:
        raise CategoryError("Category not found")
    if node.depth < 1 or node.children:
        raise CategoryError("Budgets are set on the lowest-level categories; parents show the sum of their children")
    return node


def set_budget(db: Session, month: date, category_id: int, cents: int | None) -> None:
    """Override ``category_id``'s budget for ``month``; ``None`` goes back to the category default."""
    _leaf(db, category_id)
    if cents is not None and cents < 0:
        raise ValueError("A budget cannot be negative")
    row = db.get(MonthlyBudget, (month, category_id))
    if cents is None:
        if row is not None:
            db.delete(row)
    elif row is None:
        db.add(MonthlyBudget(month=month, category_id=category_id, amount_cents=cents))
    else:
        row.amount_cents = cents
    db.commit()


def copy_previous(db: Session, month: date) -> int:
    """Make ``month``'s budgets equal last month's. Replaces this month's overrides; returns lines changed."""
    before = effective_budgets(db, month)
    source = effective_budgets(db, previous_month(month))
    defaults = {n.id: n.category.monthly_budget_cents for n in load_tree(db).walk() if not n.children}
    db.execute(delete(MonthlyBudget).where(MonthlyBudget.month == month))
    # Only store what differs from the default, so the "customised" marker stays meaningful.
    db.add_all(
        MonthlyBudget(month=month, category_id=cid, amount_cents=cents)
        for cid, cents in source.items()
        if cents != defaults.get(cid)
    )
    db.commit()
    return sum(1 for cid, cents in source.items() if before.get(cid) != cents)

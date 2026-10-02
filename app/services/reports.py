"""Budget Tracker report: category tree x month actuals vs. monthly budget."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date

from sqlalchemy import extract, func, select
from sqlalchemy.orm import Session

from app.models import EXPENSE, INCOME, Transaction
from app.services.categories import Node, load_tree

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


@dataclass
class ReportRow:
    category_id: int
    name: str
    depth: int
    kind: str
    has_children: bool
    months: list[int]  # rolled up: own + all descendants
    budget: int  # effective monthly budget
    avg: int
    variance: int  # avg - budget (for expenses, positive = over budget)

    @property
    def total(self) -> int:
        return sum(self.months)

    @property
    def status(self) -> str:
        """CSS class: 'over' / 'under' relative to what is good for this kind."""
        if self.variance == 0:
            return ""
        good = self.variance < 0 if self.kind == EXPENSE else self.variance > 0
        return "under" if good else "over"


@dataclass
class BudgetReport:
    year: int
    active_months: list[int]  # 0-based month indexes that have any activity
    rows: list[ReportRow]
    expense_months: list[int]
    income_months: list[int]
    net_months: list[int]
    expense_budget: int
    income_budget: int

    @property
    def n_active(self) -> int:
        return len(self.active_months)

    @property
    def avg_expense(self) -> int:
        return _average(sum(self.expense_months), self.n_active)

    @property
    def last_active_month(self) -> int | None:
        return self.active_months[-1] if self.active_months else None


def _average(total: int, n: int) -> int:
    return round(total / n) if n else 0


def _add(a: list[int], b: list[int]) -> list[int]:
    return [x + y for x, y in zip(a, b, strict=True)]


def budget_report(db: Session, year: int, as_of: date | None = None) -> BudgetReport:
    """Aggregate actuals for ``year``. Future-dated (planned) rows are excluded."""
    as_of = as_of or date.today()
    month = extract("month", Transaction.date)
    stmt = (
        select(Transaction.category_id, month.label("m"), func.sum(Transaction.amount_cents))
        .where(Transaction.date >= date(year, 1, 1), Transaction.date <= min(date(year, 12, 31), as_of))
        .group_by(Transaction.category_id, month)
    )
    own: dict[int, list[int]] = defaultdict(lambda: [0] * 12)
    active: set[int] = set()
    for category_id, m, total in db.execute(stmt):
        own[category_id][int(m) - 1] = int(total)
        active.add(int(m) - 1)
    active_months = sorted(active)
    n = len(active_months)

    rows: list[ReportRow] = []

    def build(node: Node) -> list[int]:
        """Pre-order emit with post-order totals: reserve the slot, fill after children."""
        slot = len(rows)
        rows.append(None)  # type: ignore[arg-type]
        months = list(own.get(node.id, [0] * 12))
        for child in node.children:
            months = _add(months, build(child))
        cat = node.category
        if cat.is_active or any(months):
            budget = node.effective_budget_cents
            avg = _average(sum(months), n)
            rows[slot] = ReportRow(
                node.id, node.name, node.depth, cat.kind, bool(node.children), months, budget, avg, avg - budget
            )
        else:
            rows[slot] = None  # type: ignore[assignment]
        return months

    tree = load_tree(db)
    for root in tree.roots:
        build(root)
    rows = [r for r in rows if r is not None]

    roots = [r for r in rows if r.depth == 0]

    def totals(kind: str) -> list[int]:
        out = [0] * 12
        for r in roots:
            if r.kind == kind:
                out = _add(out, r.months)
        return out

    expense_months, income_months = totals(EXPENSE), totals(INCOME)
    return BudgetReport(
        year=year,
        active_months=active_months,
        rows=rows,
        expense_months=expense_months,
        income_months=income_months,
        net_months=[i - e for i, e in zip(income_months, expense_months, strict=True)],
        expense_budget=sum(r.budget for r in roots if r.kind == EXPENSE),
        income_budget=sum(r.budget for r in roots if r.kind == INCOME),
    )


def chart_payload(report: BudgetReport, month_index: int) -> dict:
    """Plain-dict data for the two charts (dollars, not cents)."""

    def dollars(cents: int) -> float:
        return round(cents / 100, 2)

    top = sorted(
        (
            (r.name, r.months[month_index], r.budget)
            for r in report.rows
            if r.depth == 1 and r.kind == EXPENSE and r.months[month_index] > 0
        ),
        key=lambda t: t[1],
        reverse=True,
    )[:12]
    return {
        "months": MONTHS,
        "spending": [dollars(c) for c in report.expense_months],
        "income": [dollars(c) for c in report.income_months],
        "categories": [t[0] for t in top],
        "category_actual": [dollars(t[1]) for t in top],
        "category_budget": [dollars(t[2]) for t in top],
    }

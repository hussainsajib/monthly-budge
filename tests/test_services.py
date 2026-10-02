from datetime import date

from app.models import Account, Transaction
from app.services import cashflow, importing, recurring, reports, suggestions
from app.services import categories as category_service


def _add(db, cat, cents, when, desc="x", acc=None):
    t = Transaction(date=when, description=desc, category_id=cat, account_id=acc, amount_cents=cents)
    db.add(t)
    db.commit()
    return t


def test_report_rolls_up_children_and_ignores_future(db, ids):
    cats, _ = ids
    costco = category_service.create_category(db, "Costco", cats["Grocery"], budget_cents=20000)
    try:
        _add(db, costco.id, 10000, date(2026, 5, 3))
        _add(db, cats["Grocery"], 5000, date(2026, 5, 4))
        _add(db, cats["Grocery"], 7000, date(2026, 6, 4))
        _add(db, cats["Grocery"], 9999, date(2026, 12, 30))  # planned: excluded
        report = reports.budget_report(db, 2026, as_of=date(2026, 6, 30))
        row = {r.name: r for r in report.rows}
        assert row["Grocery"].months[4] == 15000  # own + Costco
        assert row["Costco"].months[4] == 10000
        assert row["Grocery"].months[11] == 0
        assert report.active_months == [4, 5]
        assert row["Grocery"].avg == 11000
        assert row["Essential Variable"].total == 22000
        assert row["Grocery"].budget == 20000  # sum of children
    finally:
        db.query(Transaction).delete()
        db.commit()
        category_service.delete_category(db, costco.id)


def test_income_counts_toward_net(db, ids):
    cats, _ = ids
    _add(db, cats["Salary (net)"], 300000, date(2026, 5, 1))
    _add(db, cats["Rent"], 100000, date(2026, 5, 2))
    report = reports.budget_report(db, 2026, as_of=date(2026, 5, 31))
    assert report.net_months[4] == 200000


def test_cashflow_running_balance_and_planned(db, ids):
    cats, accs = ids
    acc = db.get(Account, accs["Chequing"])
    acc.opening_balance_cents, acc.opening_date = 100000, date(2026, 5, 1)
    db.commit()
    try:
        _add(db, cats["Rent"], 80000, date(2026, 5, 2), acc=acc.id)
        _add(db, cats["Salary (net)"], 50000, date(2026, 5, 10), acc=acc.id)
        _add(db, cats["Grocery"], 20000, date(2026, 6, 1), acc=acc.id)  # planned
        _add(db, cats["Grocery"], 99999, date(2026, 5, 5), acc=accs["Credit Card"])  # other account
        ledger = cashflow.build_ledger(db, acc, today=date(2026, 5, 15))
        assert [r.balance_cents for r in ledger.rows] == [20000, 70000, 50000]
        assert ledger.current_balance_cents == 70000
        assert ledger.projected_balance_cents == 50000
        assert ledger.rows[0].level == "low"  # 200.00 < 500.00 default alert
        assert ledger.rows[2].is_planned
        assert ledger.lowest.balance_cents == 20000
    finally:
        acc.opening_balance_cents, acc.opening_date = 0, None
        db.commit()


def test_recurring_generation_is_idempotent(db):
    first = recurring.generate_for_month(db, 2026, 2)
    assert first == 5
    assert recurring.generate_for_month(db, 2026, 2) == 0
    feb = db.query(Transaction).filter(Transaction.date.between(date(2026, 2, 1), date(2026, 2, 28))).count()
    assert feb == 5


def test_suggestions_exact_and_noisy_match(db, ids):
    cats, accs = ids
    _add(db, cats["Grocery"], 7400, date(2026, 5, 1), desc="Fresh Mart", acc=accs["Chequing"])
    index = suggestions.build_index(db)
    assert suggestions.lookup(index, "fresh mart").category_id == cats["Grocery"]
    assert suggestions.lookup(index, "FRESH MART #123 ANYTOWN ON").account_id == accs["Chequing"]
    assert suggestions.lookup(index, "Unknown shop") is None


TD_CSV = b"2026-05-02,FRESH MART #1,74.00,,5000.00\n2026-05-03,PAYROLL,,3500.00,8500.00\n"


def test_csv_parse_headerless_td_and_directions():
    rows = importing.parse_csv(TD_CSV)
    assert [(r.description, r.amount_cents, r.direction) for r in rows] == [
        ("FRESH MART #1", 7400, "out"),
        ("PAYROLL", 350000, "in"),
    ]


def test_csv_parse_header_with_signed_amount():
    csv = b"Date,Description,Amount\n05/02/2026,Coffee,4.50\n05/03/2026,Refund,-10.00\n"
    out = importing.parse_csv(csv, positive_is_expense=True)
    assert [(r.date, r.direction) for r in out] == [(date(2026, 5, 2), "out"), (date(2026, 5, 3), "in")]


def test_csv_import_flags_duplicates_and_is_idempotent(db, ids):
    cats, accs = ids
    acc = accs["Chequing"]
    _add(db, cats["Grocery"], 7400, date(2026, 4, 1), desc="Fresh Mart", acc=acc)
    rows = importing.prepare_preview(db, importing.parse_csv(TD_CSV), acc)
    assert rows[0].category_id == cats["Grocery"]  # learned from history
    assert not rows[0].duplicate
    rows[1].category_id = cats["Salary (net)"]
    assert importing.commit_rows(db, rows, acc) == 2
    again = importing.prepare_preview(db, importing.parse_csv(TD_CSV), acc)
    assert all(r.duplicate for r in again)  # same hashes -> flagged
    salary = db.query(Transaction).filter_by(description="PAYROLL").one()
    assert salary.amount_cents == 350000  # money in on an income category stays positive


def test_refund_on_expense_category_is_negative(db, ids):
    cats, _ = ids
    row = importing.ParsedRow(date(2026, 5, 3), "Refund", 1000, "in", category_id=cats["Grocery"], key="k1")
    importing.commit_rows(db, [row], None)
    assert db.query(Transaction).filter_by(import_hash="k1").one().amount_cents == -1000

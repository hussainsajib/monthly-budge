"""Export / import the user-editable setup: categories, accounts, recurring items, monthly budgets, settings.

This keeps personal data out of migrations and git: the schema migrations stay generic, and a private JSON
file (see ``python -m app.cli export-config``) rebuilds your own setup on any database.

References are by name/path, never by database id, so a file can be loaded into a different database.
"""

from __future__ import annotations

from datetime import date

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.models import Account, AppSetting, Category, MonthlyBudget, RecurringTemplate, Transaction
from app.services.categories import KINDS, MAX_DEPTH, Node, load_tree
from app.services.recurring import list_templates, validate_schedule

FORMAT_VERSION = 1
Path = tuple[str, ...]


class ConfigError(ValueError):
    """The file is malformed or the import would break existing data (shown to the user)."""


def _names(node: Node) -> list[str]:
    parts: list[str] = []
    current: Node | None = node
    while current:
        parts.append(current.name)
        current = current.parent
    return parts[::-1]


# ------------------------------------------------------------------ export


def export_config(db: Session) -> dict:
    tree = load_tree(db)
    path_of = {node_id: _names(node) for node_id, node in tree.nodes.items()}

    categories = [
        {
            "path": path_of[n.id],
            "kind": n.category.kind,
            "monthly_budget_cents": n.category.monthly_budget_cents,
            "description": n.category.description,
            "sort_order": n.category.sort_order,
            "is_active": n.category.is_active,
        }
        for n in tree.walk()  # parents always precede their children
    ]
    accounts = [
        {
            "name": a.name,
            "kind": a.kind,
            "opening_balance_cents": a.opening_balance_cents,
            "opening_date": a.opening_date.isoformat() if a.opening_date else None,
            "is_active": a.is_active,
        }
        for a in db.scalars(select(Account).order_by(Account.id))
    ]
    recurring = [
        {
            "description": t.description,
            "category": path_of[t.category_id],
            "account": t.account.name if t.account else None,
            "amount_cents": t.amount_cents,
            "day_of_month": t.day_of_month,
            "schedule": t.schedule,
            "is_active": t.is_active,
        }
        for t in list_templates(db)
    ]
    monthly_budgets = [
        {"month": b.month.strftime("%Y-%m"), "category": path_of[b.category_id], "amount_cents": b.amount_cents}
        for b in db.scalars(select(MonthlyBudget).order_by(MonthlyBudget.month, MonthlyBudget.category_id))
    ]
    settings = {s.key: s.value for s in db.scalars(select(AppSetting).order_by(AppSetting.key))}
    return {
        "version": FORMAT_VERSION,
        "categories": categories,
        "accounts": accounts,
        "recurring": recurring,
        "monthly_budgets": monthly_budgets,
        "settings": settings,
    }


# ------------------------------------------------------------------ import


def _wipe_setup(db: Session) -> None:
    """Delete categories, accounts, recurring items and monthly budgets. Only legal when no transactions exist."""
    if db.scalar(select(func.count()).select_from(Transaction)):
        raise ConfigError(
            "This database already has transactions; replacing categories and accounts would orphan them. "
            "Import without --replace to merge instead."
        )
    db.execute(delete(MonthlyBudget))
    db.execute(delete(RecurringTemplate))
    # parent_id is ON DELETE RESTRICT: remove leaves first, repeatedly, until nothing is left
    while True:
        parents = select(Category.parent_id).where(Category.parent_id.is_not(None))
        result = db.execute(delete(Category).where(Category.id.not_in(parents)))
        if result.rowcount == 0:
            break
    db.execute(delete(Account))
    db.flush()


def _require(entry: dict, keys: tuple[str, ...], what: str) -> None:
    missing = [k for k in keys if k not in entry]
    if missing:
        raise ConfigError(f"{what}: missing {', '.join(missing)}")


def import_config(db: Session, data: dict, replace: bool = False) -> dict[str, int]:
    """Load a file produced by :func:`export_config`.

    Default is a merge: rows are matched by category path / account name and updated or created, nothing is
    deleted. ``replace=True`` first wipes the existing setup (refused if transactions exist).
    Everything happens in one transaction; any problem rolls it all back.
    """
    if data.get("version") != FORMAT_VERSION:
        raise ConfigError(f"Unsupported config version {data.get('version')!r} (expected {FORMAT_VERSION})")
    try:
        if replace:
            _wipe_setup(db)
        counts = _apply(db, data)
        db.commit()
        return counts
    except Exception:
        db.rollback()
        raise


def _apply(db: Session, data: dict) -> dict[str, int]:
    counts = {"categories": 0, "accounts": 0, "recurring": 0, "monthly_budgets": 0, "settings": 0}

    # categories, matched by path
    by_path: dict[Path, Category] = {tuple(_names(n)): n.category for n in load_tree(db).walk()}
    for entry in data.get("categories", []):
        _require(entry, ("path", "kind"), "category")
        path = tuple(entry["path"])
        if not path or not all(isinstance(p, str) and p.strip() for p in path):
            raise ConfigError(f"Bad category path: {entry['path']!r}")
        if len(path) > MAX_DEPTH:
            raise ConfigError(f"{' › '.join(path)}: nested more than {MAX_DEPTH} levels")
        if entry["kind"] not in KINDS:
            raise ConfigError(f"{' › '.join(path)}: kind must be expense or income")
        parent = by_path.get(path[:-1]) if len(path) > 1 else None
        if len(path) > 1 and parent is None:
            raise ConfigError(f"{' › '.join(path)}: its parent must appear earlier in the file")
        cat = by_path.get(path)
        if cat is None:
            cat = Category(name=path[-1], parent_id=parent.id if parent else None)
            db.add(cat)
            by_path[path] = cat
        cat.kind = parent.kind if parent else entry["kind"]
        cat.monthly_budget_cents = int(entry.get("monthly_budget_cents", 0))
        cat.description = entry.get("description", "")
        cat.sort_order = int(entry.get("sort_order", 0))
        cat.is_active = bool(entry.get("is_active", True))
        db.flush()  # children need this row's id
        counts["categories"] += 1

    # accounts, matched by name
    accounts = {a.name: a for a in db.scalars(select(Account))}
    for entry in data.get("accounts", []):
        _require(entry, ("name",), "account")
        acc = accounts.get(entry["name"])
        if acc is None:
            acc = Account(name=entry["name"])
            db.add(acc)
            accounts[acc.name] = acc
        acc.kind = entry.get("kind", "bank")
        acc.opening_balance_cents = int(entry.get("opening_balance_cents", 0))
        opening = entry.get("opening_date")
        acc.opening_date = date.fromisoformat(opening) if opening else None
        acc.is_active = bool(entry.get("is_active", True))
        counts["accounts"] += 1
    db.flush()

    def category_for(path_list: list[str], what: str) -> Category:
        cat = by_path.get(tuple(path_list))
        if cat is None:
            raise ConfigError(f"{what}: unknown category {' › '.join(path_list)}")
        return cat

    # recurring items, matched by (description, category)
    existing = {(t.description.lower(), t.category_id): t for t in db.scalars(select(RecurringTemplate)).unique()}
    for entry in data.get("recurring", []):
        _require(entry, ("description", "category", "amount_cents", "day_of_month"), "recurring item")
        cat = category_for(entry["category"], f"recurring item {entry['description']!r}")
        account_name = entry.get("account")
        if account_name is not None and account_name not in accounts:
            raise ConfigError(f"recurring item {entry['description']!r}: unknown account {account_name!r}")
        tpl = existing.get((entry["description"].lower(), cat.id))
        if tpl is None:
            tpl = RecurringTemplate(description=entry["description"], category_id=cat.id)
            db.add(tpl)
        tpl.account_id = accounts[account_name].id if account_name else None
        tpl.amount_cents = int(entry["amount_cents"])
        tpl.day_of_month = int(entry.get("day_of_month", 1))
        tpl.schedule = validate_schedule(entry["schedule"]) if entry.get("schedule") is not None else None
        tpl.is_active = bool(entry.get("is_active", True))
        counts["recurring"] += 1

    # monthly budget overrides, matched by (month, category)
    for entry in data.get("monthly_budgets", []):
        _require(entry, ("month", "category", "amount_cents"), "monthly budget")
        cat = category_for(entry["category"], "monthly budget")
        year, month = (int(p) for p in entry["month"].split("-"))
        row = db.get(MonthlyBudget, (date(year, month, 1), cat.id))
        if row is None:
            row = MonthlyBudget(month=date(year, month, 1), category_id=cat.id, amount_cents=0)
            db.add(row)
        row.amount_cents = int(entry["amount_cents"])
        counts["monthly_budgets"] += 1

    for key, value in data.get("settings", {}).items():
        setting = db.get(AppSetting, key)
        if setting is None:
            db.add(AppSetting(key=key, value=str(value)))
        else:
            setting.value = str(value)
        counts["settings"] += 1
    return counts

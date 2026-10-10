from datetime import date

import pytest

from app.models import Category, Transaction
from app.services import categories as svc
from app.services import category_config as cfg
from app.services.categories import CategoryError
from app.services.category_config import CategoryConfigError


def _txn(db, category_id, cents=1000, when=date(2026, 5, 1), desc="x"):
    t = Transaction(date=when, description=desc, category_id=category_id, amount_cents=cents)
    db.add(t)
    db.commit()
    return t


def _update(db, cat_id, **overrides):
    cat = db.get(Category, cat_id)
    args = dict(
        name=cat.name,
        parent_id=cat.parent_id,
        kind=cat.kind,
        budget_cents=cat.monthly_budget_cents,
        description="",
        sort_order=cat.sort_order,
        is_active=True,
    )
    args.update(overrides)
    return svc.update_category(db, cat_id, **args)


def test_seed_tree_shape(db):
    tree = svc.load_tree(db)
    assert [r.name for r in tree.roots][:2] == ["Fixed Expenses", "Essential Variable"]
    grocery = next(n for n in tree.walk() if n.name == "Grocery")
    assert grocery.path == "Essential Variable › Grocery"
    assert grocery.depth == 1


def test_subcategory_inherits_kind_and_rolls_up_budget(db, ids):
    cats, _ = ids
    costco = svc.create_category(db, "Costco", cats["Grocery"], budget_cents=30000)
    fresh_mart = svc.create_category(db, "Fresh Mart", cats["Grocery"], budget_cents=20000)
    try:
        assert costco.kind == "expense"
        # The parent shows the sum of its children, not its own stored 600.00.
        assert svc.load_tree(db).nodes[cats["Grocery"]].effective_budget_cents == 50000
    finally:
        svc.delete_category(db, costco.id)
        svc.delete_category(db, fresh_mart.id)


def test_duplicate_name_under_same_parent_rejected(db, ids):
    cats, _ = ids
    first = svc.create_category(db, "Costco", cats["Grocery"])
    try:
        with pytest.raises(CategoryError):
            svc.create_category(db, "costco", cats["Grocery"])
        # Same name under a different parent is fine.
        other = svc.create_category(db, "Costco", cats["Car Fuel"])
        svc.delete_category(db, other.id)
    finally:
        svc.delete_category(db, first.id)


def test_cannot_move_under_own_descendant(db, ids):
    cats, _ = ids
    child = svc.create_category(db, "Child", cats["Grocery"])
    try:
        with pytest.raises(CategoryError):
            _update(db, cats["Grocery"], parent_id=child.id)
    finally:
        svc.delete_category(db, child.id)


def test_depth_limit(db, ids):
    cats, _ = ids
    a = svc.create_category(db, "A", cats["Grocery"])
    b = svc.create_category(db, "B", a.id)
    try:
        with pytest.raises(CategoryError):
            svc.create_category(db, "C", b.id)
    finally:
        svc.delete_category(db, b.id)
        svc.delete_category(db, a.id)


def test_moving_to_income_section_changes_kind(db, ids):
    cats, _ = ids
    node = svc.create_category(db, "Gift money", cats["Grocery"])
    try:
        _update(db, node.id, parent_id=cats["Income"])
        assert db.get(Category, node.id).kind == "income"
    finally:
        svc.delete_category(db, node.id)


def test_delete_requires_target_for_transactions(db, ids):
    cats, _ = ids
    extra = svc.create_category(db, "Temp", cats["Grocery"])
    txn = _txn(db, extra.id)
    with pytest.raises(CategoryError):
        svc.delete_category(db, extra.id)
    svc.delete_category(db, extra.id, move_to_id=cats["Grocery"])
    db.refresh(txn)
    assert txn.category_id == cats["Grocery"]


def test_parent_with_children_cannot_be_deleted(db, ids):
    cats, _ = ids
    child = svc.create_category(db, "Kid", cats["Grocery"])
    try:
        with pytest.raises(CategoryError):
            svc.delete_category(db, cats["Grocery"])
    finally:
        svc.delete_category(db, child.id)


def test_bulk_reassign(db, ids):
    cats, _ = ids
    a, b = _txn(db, cats["Grocery"]), _txn(db, cats["Grocery"])
    assert svc.reassign_transactions(db, [a.id, b.id], cats["Rent"]) == 2
    db.refresh(a)
    assert a.category_id == cats["Rent"]
    with pytest.raises(CategoryError):  # top-level sections are not assignable
        svc.reassign_transactions(db, [a.id], cats["Essential Variable"])


def test_category_config_types_and_levels(db):
    try:
        assert [t.key for t in cfg.get_types(db)] == ["expense", "income", "savings", "debt", "investment"]
        assert cfg.income_keys(db) == {"income"}
        assert cfg.is_income(db, "income") and not cfg.is_income(db, "savings")
        assert cfg.get_levels(db) == ["Section", "Category", "Sub-category", "Sub-sub-category"]

        cfg.set_levels(db, ["Group", "Category", "Item", "Detail"])
        assert cfg.get_levels(db) == ["Group", "Category", "Item", "Detail"]
        with pytest.raises(CategoryConfigError):
            cfg.set_levels(db, ["Only", "Three"])
        with pytest.raises(CategoryConfigError):
            cfg.set_levels(db, ["a,b", "b", "c", "d"])
    finally:
        cfg.set_levels(db, list(cfg.DEFAULT_LEVELS))


def test_custom_outflow_type_behaves_like_expense(db):
    section = svc.create_category(db, "Savings Section", None, kind="savings")
    leaf = svc.create_category(db, "Emergency", section.id)
    try:
        assert leaf.kind == "savings"
        # A positive amount on an outflow type is money out (negative cash delta).
        txn = Transaction(date=date(2026, 5, 1), description="x", category_id=leaf.id, amount_cents=5000)
        assert txn.cash_delta_cents(leaf.kind in cfg.income_keys(db)) == -5000
    finally:
        svc.delete_category(db, leaf.id)
        svc.delete_category(db, section.id)


def test_unknown_type_rejected(db):
    with pytest.raises(CategoryError):
        svc.create_category(db, "Bad", None, kind="weird")

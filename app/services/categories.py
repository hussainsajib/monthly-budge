"""Category tree: loading, CRUD, moving, and re-mapping transactions."""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, field

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.models import EXPENSE, Category, RecurringTemplate, Transaction
from app.services.category_config import type_keys

MAX_DEPTH = 4  # section > category > sub-category > sub-sub-category


class CategoryError(ValueError):
    """A category operation violated a business rule (shown to the user)."""


@dataclass
class Node:
    category: Category
    depth: int = 0
    parent: Node | None = None
    children: list[Node] = field(default_factory=list)

    @property
    def id(self) -> int:
        return self.category.id

    @property
    def name(self) -> str:
        return self.category.name

    @property
    def path(self) -> str:
        parts, node = [], self
        while node:
            parts.append(node.name)
            node = node.parent
        return " › ".join(reversed(parts))

    @property
    def effective_budget_cents(self) -> int:
        """Leaf: its own budget. Parent: the sum of its children."""
        if self.children:
            return sum(c.effective_budget_cents for c in self.children)
        return self.category.monthly_budget_cents

    def walk(self) -> Iterator[Node]:
        yield self
        for child in self.children:
            yield from child.walk()

    def subtree_ids(self) -> set[int]:
        return {n.id for n in self.walk()}


class CategoryTree:
    def __init__(self, categories: list[Category]):
        self.nodes: dict[int, Node] = {c.id: Node(c) for c in categories}
        self.roots: list[Node] = []
        for node in self.nodes.values():
            parent = self.nodes.get(node.category.parent_id) if node.category.parent_id else None
            node.parent = parent
            (parent.children if parent else self.roots).append(node)
        order = lambda n: (n.category.sort_order, n.name.lower())  # noqa: E731
        self.roots.sort(key=order)
        for root in self.roots:
            self._finish(root, 0, order)

    def _finish(self, node: Node, depth: int, order) -> None:
        node.depth = depth
        node.children.sort(key=order)
        for child in node.children:
            self._finish(child, depth + 1, order)

    def walk(self) -> Iterator[Node]:
        for root in self.roots:
            yield from root.walk()

    def path(self, category_id: int) -> str:
        node = self.nodes.get(category_id)
        return node.path if node else ""


def load_tree(db: Session) -> CategoryTree:
    return CategoryTree(list(db.scalars(select(Category))))


def _clean_name(name: str) -> str:
    name = name.strip()
    if not name:
        raise CategoryError("Name is required")
    return name[:80]


def _check_unique(db: Session, name: str, parent_id: int | None, exclude_id: int | None = None) -> None:
    stmt = select(Category.id).where(
        func.lower(Category.name) == name.lower(),
        Category.parent_id.is_(None) if parent_id is None else Category.parent_id == parent_id,
    )
    if exclude_id:
        stmt = stmt.where(Category.id != exclude_id)
    if db.scalar(stmt) is not None:
        raise CategoryError(f"'{name}' already exists here")


def _next_sort(db: Session, parent_id: int | None) -> int:
    stmt = select(func.max(Category.sort_order)).where(
        Category.parent_id.is_(None) if parent_id is None else Category.parent_id == parent_id
    )
    return (db.scalar(stmt) or 0) + 10


def create_category(
    db: Session,
    name: str,
    parent_id: int | None,
    kind: str = EXPENSE,
    budget_cents: int = 0,
    description: str = "",
) -> Category:
    name = _clean_name(name)
    tree = load_tree(db)
    if parent_id is not None:
        parent = tree.nodes.get(parent_id)
        if parent is None:
            raise CategoryError("Parent not found")
        if parent.depth + 1 >= MAX_DEPTH:
            raise CategoryError(f"Categories can only be nested {MAX_DEPTH} levels deep")
        kind = parent.category.kind
    elif kind not in type_keys(db):
        raise CategoryError("Pick a valid category type")
    _check_unique(db, name, parent_id)
    cat = Category(
        name=name,
        parent_id=parent_id,
        kind=kind,
        monthly_budget_cents=max(budget_cents, 0),
        description=description.strip(),
        sort_order=_next_sort(db, parent_id),
    )
    db.add(cat)
    db.commit()
    return cat


def update_category(
    db: Session,
    category_id: int,
    *,
    name: str,
    parent_id: int | None,
    kind: str,
    budget_cents: int,
    description: str,
    sort_order: int,
    is_active: bool,
) -> Category:
    tree = load_tree(db)
    node = tree.nodes.get(category_id)
    if node is None:
        raise CategoryError("Category not found")
    name = _clean_name(name)

    if parent_id is not None:
        new_parent = tree.nodes.get(parent_id)
        if new_parent is None:
            raise CategoryError("Parent not found")
        if parent_id in node.subtree_ids():
            raise CategoryError("A category cannot be moved under itself")
        subtree_height = max(n.depth for n in node.walk()) - node.depth
        if new_parent.depth + 1 + subtree_height >= MAX_DEPTH:
            raise CategoryError(f"Categories can only be nested {MAX_DEPTH} levels deep")
        kind = new_parent.category.kind
    elif kind not in type_keys(db):
        raise CategoryError("Pick a valid category type")

    _check_unique(db, name, parent_id, exclude_id=category_id)
    cat = node.category
    cat.name, cat.parent_id, cat.description = name, parent_id, description.strip()
    cat.monthly_budget_cents, cat.sort_order, cat.is_active = max(budget_cents, 0), sort_order, is_active
    # Kind lives on every row (cheap reads); keep the whole subtree consistent.
    for descendant in node.walk():
        descendant.category.kind = kind
    db.commit()
    return cat


def delete_category(db: Session, category_id: int, move_to_id: int | None = None) -> None:
    """Delete a leaf category, first moving its transactions/templates to ``move_to_id``."""
    tree = load_tree(db)
    node = tree.nodes.get(category_id)
    if node is None:
        raise CategoryError("Category not found")
    if node.children:
        raise CategoryError("Delete or move its sub-categories first")

    tx_count = db.scalar(select(func.count()).select_from(Transaction).where(Transaction.category_id == category_id))
    tpl_count = db.scalar(
        select(func.count()).select_from(RecurringTemplate).where(RecurringTemplate.category_id == category_id)
    )
    if tx_count or tpl_count:
        target = tree.nodes.get(move_to_id) if move_to_id else None
        if target is None or target.depth < 1 or target.id == category_id:
            raise CategoryError(f"Choose a category to move its {tx_count} transaction(s) to first")
        db.execute(update(Transaction).where(Transaction.category_id == category_id).values(category_id=target.id))
        db.execute(
            update(RecurringTemplate).where(RecurringTemplate.category_id == category_id).values(category_id=target.id)
        )
    db.delete(node.category)
    db.commit()


def reassign_transactions(db: Session, transaction_ids: list[int], category_id: int) -> int:
    """Bulk re-map transactions to another category."""
    target = load_tree(db).nodes.get(category_id)
    if target is None or target.depth < 1:
        raise CategoryError("Pick a category (not a top-level section)")
    result = db.execute(update(Transaction).where(Transaction.id.in_(transaction_ids)).values(category_id=category_id))
    db.commit()
    return result.rowcount

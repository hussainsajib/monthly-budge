"""Core ledger tables: categories (a tree), accounts, transactions."""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

EXPENSE = "expense"
INCOME = "income"


class Category(Base):
    """A node in the category tree.

    Top-level nodes (``parent_id`` is NULL) are *sections* such as "Fixed Expenses"; they
    carry the ``kind`` (expense/income) that every descendant inherits. Budgets are only
    meaningful on leaves - a parent's budget is the sum of its children (see
    ``app.services.categories``).
    """

    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id", ondelete="RESTRICT"), index=True)
    kind: Mapped[str] = mapped_column(String(10), default=EXPENSE)  # expense | income
    monthly_budget_cents: Mapped[int] = mapped_column(Integer, default=0)
    description: Mapped[str] = mapped_column(Text, default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(60), unique=True)
    kind: Mapped[str] = mapped_column(String(10), default="bank")  # bank | credit | cash
    opening_balance_cents: Mapped[int] = mapped_column(Integer, default=0)
    opening_date: Mapped[date | None] = mapped_column(Date)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Transaction(Base):
    """One ledger entry.

    ``amount_cents`` is signed relative to the category kind: a positive amount in an
    expense category is money out, in an income category money in; a negative amount
    is a refund / reversal of that.
    """

    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    description: Mapped[str] = mapped_column(String(200))
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id", ondelete="RESTRICT"))
    account_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id", ondelete="SET NULL"))
    amount_cents: Mapped[int] = mapped_column(Integer)
    notes: Mapped[str | None] = mapped_column(Text)
    # Set for imported rows so re-importing the same file is idempotent.
    import_hash: Mapped[str | None] = mapped_column(String(40), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    category: Mapped[Category] = relationship(lazy="joined")
    account: Mapped[Account | None] = relationship(lazy="joined")

    @property
    def cash_delta_cents(self) -> int:
        """Effect on the owning account's balance."""
        return self.amount_cents if self.category.kind == INCOME else -self.amount_cents

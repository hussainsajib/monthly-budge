"""Planning tables: recurring templates, per-month budgets and key/value app settings."""

from __future__ import annotations

from datetime import date

from sqlalchemy import JSON, Boolean, Date, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.ledger import Account, Category


class RecurringTemplate(Base):
    __tablename__ = "recurring_templates"

    id: Mapped[int] = mapped_column(primary_key=True)
    description: Mapped[str] = mapped_column(String(200))
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id", ondelete="CASCADE"))
    account_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id", ondelete="SET NULL"))
    amount_cents: Mapped[int] = mapped_column(Integer)
    day_of_month: Mapped[int] = mapped_column(Integer)  # legacy monthly day; clamped to month length on use
    # Flexible recurrence. None = monthly on day_of_month. See app.services.recurring for the format.
    schedule: Mapped[dict | None] = mapped_column(JSON)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    category: Mapped[Category] = relationship(lazy="joined")
    account: Mapped[Account | None] = relationship(lazy="joined")


class AppSetting(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    value: Mapped[str] = mapped_column(String(200))


class MonthlyBudget(Base):
    """Budget for one leaf category in one month.

    ``Category.monthly_budget_cents`` is the default; a row here overrides it for ``month``
    (always the first day of that month).
    """

    __tablename__ = "monthly_budgets"

    month: Mapped[date] = mapped_column(Date, primary_key=True)
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id", ondelete="CASCADE"), primary_key=True)
    amount_cents: Mapped[int] = mapped_column(Integer)

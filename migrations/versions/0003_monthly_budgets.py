"""per-month budget overrides

Revision ID: 0003
Revises: 0001
Create Date: 2026-10-01
"""

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "monthly_budgets",
        sa.Column("month", sa.Date, nullable=False),  # always the first day of the month
        sa.Column("category_id", sa.Integer, nullable=False),
        sa.Column("amount_cents", sa.Integer, nullable=False),
        sa.PrimaryKeyConstraint("month", "category_id", name="pk_monthly_budgets"),
        sa.ForeignKeyConstraint(
            ["category_id"],
            ["categories.id"],
            name="fk_monthly_budgets_category_id_categories",
            ondelete="CASCADE",
        ),
    )


def downgrade() -> None:
    op.drop_table("monthly_budgets")

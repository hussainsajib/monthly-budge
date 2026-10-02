"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-10-01
"""

import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "categories",
        sa.Column("id", sa.Integer, nullable=False),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("parent_id", sa.Integer),
        sa.Column("kind", sa.String(10), nullable=False, server_default="expense"),
        sa.Column("monthly_budget_cents", sa.Integer, nullable=False, server_default="0"),
        sa.Column("description", sa.Text, nullable=False, server_default=""),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.PrimaryKeyConstraint("id", name="pk_categories"),
        sa.ForeignKeyConstraint(
            ["parent_id"],
            ["categories.id"],
            name="fk_categories_parent_id_categories",
            ondelete="RESTRICT",
        ),
    )
    op.create_index("ix_categories_parent_id", "categories", ["parent_id"])
    op.create_table(
        "accounts",
        sa.Column("id", sa.Integer, nullable=False),
        sa.Column("name", sa.String(60), nullable=False),
        sa.Column("kind", sa.String(10), nullable=False, server_default="bank"),
        sa.Column("opening_balance_cents", sa.Integer, nullable=False, server_default="0"),
        sa.Column("opening_date", sa.Date),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.PrimaryKeyConstraint("id", name="pk_accounts"),
        sa.UniqueConstraint("name", name="uq_accounts_name"),
    )
    op.create_table(
        "transactions",
        sa.Column("id", sa.Integer, nullable=False),
        sa.Column("date", sa.Date, nullable=False),
        sa.Column("description", sa.String(200), nullable=False),
        sa.Column("category_id", sa.Integer, nullable=False),
        sa.Column("account_id", sa.Integer),
        sa.Column("amount_cents", sa.Integer, nullable=False),
        sa.Column("notes", sa.Text),
        sa.Column("import_hash", sa.String(40)),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id", name="pk_transactions"),
        sa.UniqueConstraint("import_hash", name="uq_transactions_import_hash"),
        sa.ForeignKeyConstraint(
            ["category_id"],
            ["categories.id"],
            name="fk_transactions_category_id_categories",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["account_id"],
            ["accounts.id"],
            name="fk_transactions_account_id_accounts",
            ondelete="SET NULL",
        ),
    )
    op.create_index("ix_transactions_date", "transactions", ["date"])
    op.create_table(
        "recurring_templates",
        sa.Column("id", sa.Integer, nullable=False),
        sa.Column("description", sa.String(200), nullable=False),
        sa.Column("category_id", sa.Integer, nullable=False),
        sa.Column("account_id", sa.Integer),
        sa.Column("amount_cents", sa.Integer, nullable=False),
        sa.Column("day_of_month", sa.Integer, nullable=False),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.PrimaryKeyConstraint("id", name="pk_recurring_templates"),
        sa.ForeignKeyConstraint(
            ["category_id"],
            ["categories.id"],
            name="fk_recurring_templates_category_id_categories",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["account_id"],
            ["accounts.id"],
            name="fk_recurring_templates_account_id_accounts",
            ondelete="SET NULL",
        ),
    )
    op.create_table(
        "app_settings",
        sa.Column("key", sa.String(60), nullable=False),
        sa.Column("value", sa.String(200), nullable=False),
        sa.PrimaryKeyConstraint("key", name="pk_app_settings"),
    )


def downgrade() -> None:
    op.drop_table("app_settings")
    op.drop_table("recurring_templates")
    op.drop_index("ix_transactions_date", table_name="transactions")
    op.drop_table("transactions")
    op.drop_table("accounts")
    op.drop_index("ix_categories_parent_id", table_name="categories")
    op.drop_table("categories")

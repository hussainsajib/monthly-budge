from __future__ import annotations

from datetime import date

from pydantic import BaseModel, field_validator


class TransactionInput(BaseModel):
    date: date
    description: str
    category_id: int
    account_id: int | None = None
    amount_cents: int
    notes: str | None = None

    @field_validator("description")
    @classmethod
    def _description_required(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Description is required")
        return value[:200]

    @field_validator("notes")
    @classmethod
    def _blank_notes_to_none(cls, value: str | None) -> str | None:
        return (value or "").strip() or None


class SuggestionOut(BaseModel):
    description: str
    category_id: int
    account_id: int | None
    amount: str

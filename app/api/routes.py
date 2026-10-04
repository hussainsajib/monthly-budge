"""JSON endpoints used by the UI's JavaScript, plus a health probe."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.money import cents_to_input
from app.db.session import get_db
from app.schemas.transaction import SuggestionOut
from app.services import categorize, suggestions

router = APIRouter(prefix="/api")
health_router = APIRouter()


@router.get("/suggest", response_model=SuggestionOut | None)
def suggest(q: str, db: Session = Depends(get_db)):
    """Category/account/amount last used for a (possibly noisy) description.

    When the description is new, falls back to a local LLM (Ollama) for the category
    (no account/amount yet). AI is skipped when OLLAMA_URL is not configured.
    """
    hit = suggestions.lookup(suggestions.build_index(db), q)
    if hit is not None:
        return SuggestionOut(
            description=hit.description,
            category_id=hit.category_id,
            account_id=hit.account_id,
            amount=cents_to_input(hit.amount_cents),
        )
    category_id = categorize.suggest_category(db, q)
    if category_id is None:
        return None
    return SuggestionOut(description=q, category_id=category_id, account_id=None, amount="")


@health_router.get("/healthz", include_in_schema=False)
def healthz() -> dict[str, str]:
    return {"status": "ok"}

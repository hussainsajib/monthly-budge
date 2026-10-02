"""JSON endpoints used by the UI's JavaScript, plus a health probe."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.money import cents_to_input
from app.db.session import get_db
from app.schemas.transaction import SuggestionOut
from app.services import suggestions

router = APIRouter(prefix="/api")
health_router = APIRouter()


@router.get("/suggest", response_model=SuggestionOut | None)
def suggest(q: str, db: Session = Depends(get_db)):
    """Category/account/amount last used for a (possibly noisy) description."""
    hit = suggestions.lookup(suggestions.build_index(db), q)
    if hit is None:
        return None
    return SuggestionOut(
        description=hit.description,
        category_id=hit.category_id,
        account_id=hit.account_id,
        amount=cents_to_input(hit.amount_cents),
    )


@health_router.get("/healthz", include_in_schema=False)
def healthz() -> dict[str, str]:
    return {"status": "ok"}

"""Money helpers. Amounts are stored as integer cents to avoid float drift."""

from __future__ import annotations

import re
from decimal import ROUND_HALF_UP, Decimal

_TERM = r"(?:\d+\.?\d*|\.\d+)"
_EXPR = re.compile(rf"^[+-]?{_TERM}(?:[+-]{_TERM})*$")
_TOKEN = re.compile(rf"[+-]?{_TERM}")


def to_cents(value: str | int | float | Decimal) -> int:
    """Parse '1,234.50', '$12', '(5.00)' or a simple sum like '=61.09+1.37-5' into cents."""
    if isinstance(value, int):
        return value * 100
    if isinstance(value, (float, Decimal)):
        return int((Decimal(str(value)) * 100).quantize(Decimal(1), ROUND_HALF_UP))

    text = re.sub(r"[\s$,=]", "", value)
    negate = text.startswith("(") and text.endswith(")")
    if negate:
        text = text[1:-1]
    if not _EXPR.match(text):
        raise ValueError(f"Not a valid amount: {value!r}")
    total = sum((Decimal(tok) for tok in _TOKEN.findall(text)), Decimal(0))
    cents = int((total * 100).quantize(Decimal(1), ROUND_HALF_UP))
    return -cents if negate else cents


def cents_to_input(cents: int | None) -> str:
    if cents is None:
        return ""
    sign = "-" if cents < 0 else ""
    whole, frac = divmod(abs(cents), 100)
    return f"{sign}{whole}.{frac:02d}"

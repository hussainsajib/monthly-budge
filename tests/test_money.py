import pytest

from app.core.money import cents_to_input, to_cents


@pytest.mark.parametrize(
    ("text", "cents"),
    [
        ("12", 1200),
        ("12.5", 1250),
        ("$1,234.56", 123456),
        ("=61.09+1.37", 6246),
        ("-5.00", -500),
        ("(5.00)", -500),
        (".99", 99),
    ],
)
def test_to_cents(text, cents):
    assert to_cents(text) == cents


@pytest.mark.parametrize("bad", ["", "abc", "1.2.3", "1+", "12; DROP"])
def test_to_cents_rejects_garbage(bad):
    with pytest.raises(ValueError):
        to_cents(bad)


def test_cents_to_input():
    assert cents_to_input(5) == "0.05"
    assert cents_to_input(-1250) == "-12.50"
    assert cents_to_input(None) == ""


def test_to_cents_subtraction():
    assert to_cents("=100-30") == 7000
    assert to_cents("10+5-2.50") == 1250

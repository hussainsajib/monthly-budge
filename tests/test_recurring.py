"""Recurring schedule validation and occurrence calculation."""

from __future__ import annotations

import pytest

from app.services.recurring import occurrences, validate_schedule


def days(schedule: dict, year: int, month: int) -> list[int]:
    return [d.day for d in occurrences(schedule, year, month)]


def test_daily():
    sched = {"freq": "daily", "interval": 30, "start": "2026-01-15"}
    assert days(sched, 2026, 1) == [15]
    assert days(sched, 2026, 2) == [14]  # Jan 15 + 30
    assert days(sched, 2026, 3) == [16]  # + 60


def test_weekly_single_and_multi_weekday():
    # start is a Monday (2026-01-05). Every week on Monday: all Mondays of Feb 2026.
    weekly = {"freq": "weekly", "interval": 1, "start": "2026-01-05", "by_weekday": [0]}
    assert days(weekly, 2026, 2) == [2, 9, 16, 23]
    # Bi-weekly on Monday: every 14 days from the start.
    biweekly = {"freq": "weekly", "interval": 2, "start": "2026-01-05", "by_weekday": [0]}
    assert days(biweekly, 2026, 2) == [2, 16]
    # Every week on Monday + Wednesday.
    multi = {"freq": "weekly", "interval": 1, "start": "2026-01-05", "by_weekday": [0, 2]}
    assert days(multi, 2026, 2) == [2, 4, 9, 11, 16, 18, 23, 25]


def test_weekly_defaults_to_start_weekday():
    sched = {"freq": "weekly", "interval": 1, "start": "2026-01-05"}  # no by_weekday
    assert days(sched, 2026, 2) == [2, 9, 16, 23]


def test_monthly_by_day_and_last():
    monthly = {"freq": "monthly", "interval": 1, "start": "2026-01-01", "by_month_day": [1, 15]}
    assert days(monthly, 2026, 2) == [1, 15]
    last = {"freq": "monthly", "interval": 1, "start": "2026-01-01", "by_month_day": [-1]}
    assert days(last, 2026, 2) == [28]  # Feb 2026 has 28 days
    clamped = {"freq": "monthly", "interval": 1, "start": "2026-01-01", "by_month_day": [31]}
    assert days(clamped, 2026, 4) == [30]


def test_monthly_nth_weekday():
    # weekday 2 = Wednesday; Feb 2026 Wednesdays: 4, 11, 18, 25 -> the 2nd is the 11th.
    nth = {"freq": "monthly", "interval": 1, "start": "2026-01-01", "by_nth_weekday": {"week": 2, "weekday": 2}}
    assert days(nth, 2026, 2) == [11]
    # Last Monday of Feb 2026: 23.
    last = {"freq": "monthly", "interval": 1, "start": "2026-01-01", "by_nth_weekday": {"week": -1, "weekday": 0}}
    assert days(last, 2026, 2) == [23]
    # 5th Monday does not exist in Feb 2026.
    none = {"freq": "monthly", "interval": 1, "start": "2026-01-01", "by_nth_weekday": {"week": 5, "weekday": 0}}
    assert days(none, 2026, 2) == []


def test_yearly():
    yearly = {"freq": "yearly", "interval": 1, "start": "2026-02-15", "month": 2, "day": 15}
    assert days(yearly, 2026, 2) == [15]
    assert days(yearly, 2026, 3) == []
    assert days(yearly, 2027, 2) == [15]


def test_until_is_inclusive():
    sched = {"freq": "daily", "interval": 30, "start": "2026-01-15", "until": "2026-02-14"}
    assert days(sched, 2026, 1) == [15]
    assert days(sched, 2026, 2) == [14]
    assert days(sched, 2026, 3) == []  # ended


def test_count_stops_after_n_occurrences():
    sched = {"freq": "weekly", "interval": 1, "start": "2026-01-05", "by_weekday": [0], "count": 3}
    # First three Mondays: Jan 5, 12, 19. Nothing after.
    assert days(sched, 2026, 1) == [5, 12, 19]
    assert days(sched, 2026, 2) == []


def test_validate_rejects_bad_schedules():
    for bad in (
        {"freq": "fortnightly", "interval": 1, "start": "2026-01-01"},
        {"freq": "daily", "interval": 0, "start": "2026-01-01"},
        {"freq": "daily", "interval": 1, "start": "nope"},
        {"freq": "daily", "interval": 1, "start": "2026-01-01", "until": "2025-12-31"},
        {"freq": "daily", "interval": 1, "start": "2026-01-01", "count": 0},
        {"freq": "weekly", "interval": 1, "start": "2026-01-05", "by_weekday": [7]},
        {"freq": "monthly", "interval": 1, "start": "2026-01-01"},  # needs by_month_day or by_nth_weekday
        {"freq": "monthly", "interval": 1, "start": "2026-01-01", "by_month_day": [0]},
        {"freq": "monthly", "interval": 1, "start": "2026-01-01", "by_nth_weekday": {"week": 6, "weekday": 0}},
        {"freq": "yearly", "interval": 1, "start": "2026-01-01", "month": 13, "day": 1},
        {"freq": "yearly", "interval": 1, "start": "2026-01-01", "month": 1},  # needs day or nth
        "not a dict",
    ):
        with pytest.raises(ValueError):
            validate_schedule(bad)


def test_validate_normalizes():
    sched = validate_schedule(
        {"freq": "weekly", "interval": 2, "start": "2026-01-05", "by_weekday": [2, 0, 2]}
    )
    assert sched["by_weekday"] == [0, 2]
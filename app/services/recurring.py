"""Recurring templates -> concrete transactions for a month.

A template has a JSON ``schedule`` in a calendar-style (RRULE-like) format; ``None``
means the legacy "monthly on ``day_of_month``". Shape:

- ``freq``: ``daily`` | ``weekly`` | ``monthly`` | ``yearly``
- ``interval``: repeat every N units (default 1)
- ``start``: first occurrence (ISO date)
- ``until``: optional inclusive end date; ``count``: optional total occurrences
- ``weekly``: ``by_weekday`` = [0..6] (Mon..Sun); default [start's weekday]
- ``monthly``: ``by_month_day`` = [1..31, -1=last]  OR  ``by_nth_weekday`` = {week, weekday}
- ``yearly``: ``month`` = 1..12 plus ``day`` (1..31, -1=last) OR ``by_nth_weekday``
"""

from __future__ import annotations

import calendar
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import RecurringTemplate, Transaction

FREQS = ("daily", "weekly", "monthly", "yearly")


def validate_schedule(schedule: dict) -> dict:
    """Return a normalized copy of a valid schedule, or raise ``ValueError``."""
    if not isinstance(schedule, dict):
        raise ValueError("Schedule must be an object")
    freq = schedule.get("freq")
    if freq not in FREQS:
        raise ValueError("freq must be daily, weekly, monthly or yearly")
    interval = schedule.get("interval", 1)
    if not isinstance(interval, int) or interval < 1:
        raise ValueError("interval must be >= 1")
    start = _parse_date(schedule.get("start"), "Schedule needs a 'start' date")
    out: dict = {"freq": freq, "interval": interval, "start": start.isoformat()}

    if schedule.get("until"):
        until = _parse_date(schedule["until"], "Invalid 'until' date")
        if until < start:
            raise ValueError("End date must be on or after the start date")
        out["until"] = until.isoformat()
    count = schedule.get("count")
    if count is not None:
        if not isinstance(count, int) or count < 1:
            raise ValueError("count must be >= 1")
        out["count"] = count

    if freq == "weekly":
        weekdays = schedule.get("by_weekday")
        if weekdays is not None:
            if not isinstance(weekdays, list) or not all(isinstance(w, int) and 0 <= w <= 6 for w in weekdays):
                raise ValueError("by_weekday must be a list of 0-6 (Monday-Sunday)")
            out["by_weekday"] = sorted(set(weekdays))
    elif freq == "monthly":
        days = schedule.get("by_month_day")
        nth = schedule.get("by_nth_weekday")
        if days is not None:
            if not isinstance(days, list) or not days or not all(
                isinstance(d, int) and (1 <= d <= 31 or d == -1) for d in days
            ):
                raise ValueError("by_month_day must be days like [1, 15] (or -1 for last day)")
            out["by_month_day"] = sorted(set(days))
        elif nth is not None:
            out["by_nth_weekday"] = _validate_nth(nth)
        else:
            raise ValueError("Monthly schedule needs by_month_day or by_nth_weekday")
    elif freq == "yearly":
        month = schedule.get("month")
        if not isinstance(month, int) or not 1 <= month <= 12:
            raise ValueError("month must be 1-12")
        out["month"] = month
        day = schedule.get("day")
        if day is not None:
            if not isinstance(day, int) or not (1 <= day <= 31 or day == -1):
                raise ValueError("day must be 1-31 or -1 (last day)")
            out["day"] = day
        elif schedule.get("by_nth_weekday") is not None:
            out["by_nth_weekday"] = _validate_nth(schedule["by_nth_weekday"])
        else:
            raise ValueError("Yearly schedule needs a day or by_nth_weekday")
    return out


def _validate_nth(nth: dict) -> dict:
    if not isinstance(nth, dict):
        raise ValueError("by_nth_weekday must be an object")
    week = nth.get("week")
    weekday = nth.get("weekday")
    if not isinstance(week, int) or not (1 <= week <= 5 or week == -1):
        raise ValueError("week must be 1-5 or -1 (last)")
    if not isinstance(weekday, int) or not 0 <= weekday <= 6:
        raise ValueError("weekday must be 0-6 (Monday-Sunday)")
    return {"week": week, "weekday": weekday}


def _parse_date(value, message: str) -> date:
    try:
        return date.fromisoformat(str(value))
    except (TypeError, ValueError) as exc:
        raise ValueError(message) from exc


def _month_dates(s: dict, year: int, month: int, start: date, horizon: date) -> list[date]:
    last_day = calendar.monthrange(year, month)[1]
    if "by_nth_weekday" in s:
        nth = s["by_nth_weekday"]
        matches = [
            date(year, month, d)
            for d in range(1, last_day + 1)
            if date(year, month, d).weekday() == nth["weekday"]
        ]
        candidate = (
            matches[-1]
            if nth["week"] == -1
            else (matches[nth["week"] - 1] if nth["week"] <= len(matches) else None)
        )
        return [candidate] if candidate and start <= candidate <= horizon else []
    days = s.get("by_month_day") or ([s["day"]] if "day" in s else [1])
    out = []
    for day in days:
        d = date(year, month, last_day if day == -1 else min(day, last_day))
        if start <= d <= horizon:
            out.append(d)
    return out


def _iter_dates(s: dict, horizon: date):
    start = date.fromisoformat(s["start"])
    interval = s["interval"]
    freq = s["freq"]

    if freq == "daily":
        d = start
        while d <= horizon:
            yield d
            d += timedelta(days=interval)
        return

    if freq == "weekly":
        weekdays = s.get("by_weekday") or [start.weekday()]
        n = 0
        while True:
            d = start + timedelta(days=n)
            if d > horizon:
                return
            if (d - start).days // 7 % interval == 0 and d.weekday() in weekdays:
                yield d
            n += 1

    if freq == "monthly":
        start_index = start.year * 12 + (start.month - 1)
        horizon_index = horizon.year * 12 + (horizon.month - 1)
        index = start_index
        while index <= horizon_index:
            year, month = divmod(index, 12)
            month += 1
            yield from _month_dates(s, year, month, start, horizon)
            index += interval
        return

    if freq == "yearly":
        year = start.year
        while year <= horizon.year:
            yield from _month_dates(s, year, s["month"], start, horizon)
            year += interval


def occurrences(schedule: dict, year: int, month: int) -> list[date]:
    """The dates this schedule fires inside ``(year, month)``, sorted, deduplicated."""
    s = validate_schedule(schedule)
    first, last = date(year, month, 1), date(year, month, calendar.monthrange(year, month)[1])
    horizon = last
    if s.get("until"):
        until = date.fromisoformat(s["until"])
        if until < first:
            return []
        horizon = min(horizon, until)
    count = s.get("count")
    out: list[date] = []
    for ordinal, d in enumerate(_iter_dates(s, horizon), start=1):
        if count is not None and ordinal > count:
            break
        if first <= d <= last:
            out.append(d)
    return sorted(out)


def list_templates(db: Session) -> list[RecurringTemplate]:
    stmt = select(RecurringTemplate).order_by(RecurringTemplate.day_of_month, RecurringTemplate.id)
    return list(db.scalars(stmt).unique())


def generate_for_month(db: Session, year: int, month: int) -> int:
    """Create missing transactions for active templates. Idempotent; returns number created."""
    last_day = calendar.monthrange(year, month)[1]
    first, last = date(year, month, 1), date(year, month, last_day)
    existing = {
        (t.description.lower(), t.category_id)
        for t in db.scalars(select(Transaction).where(Transaction.date >= first, Transaction.date <= last)).unique()
    }
    created = 0
    for tpl in list_templates(db):
        if not tpl.is_active or (tpl.description.lower(), tpl.category_id) in existing:
            continue
        schedule = tpl.schedule if tpl.schedule is not None else {
            "freq": "monthly",
            "interval": 1,
            "start": "2000-01-01",
            "by_month_day": [tpl.day_of_month],
        }
        for when in occurrences(schedule, year, month):
            db.add(
                Transaction(
                    date=when,
                    description=tpl.description,
                    category_id=tpl.category_id,
                    account_id=tpl.account_id,
                    amount_cents=tpl.amount_cents,
                    notes="Recurring",
                )
            )
            created += 1
    db.commit()
    return created
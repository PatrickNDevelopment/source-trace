"""Time source. Tests inject a fixed clock."""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime

Clock = Callable[[], str]


def utc_now() -> str:
    """``YYYY-MM-DDTHH:MM:SS.mmmZ``, the exact shape of spec 03."""
    now = datetime.now(UTC)
    return now.strftime("%Y-%m-%dT%H:%M:%S") + f".{now.microsecond // 1000:03d}Z"

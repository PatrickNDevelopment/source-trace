"""Spec 01 section 2 (content hash) and section 3 (locators)."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Any, Final

from .text import normalize_text

MAX_PASSAGE_CODEPOINTS: Final = 5_000
_CONTEXT_WINDOW: Final = 32
_SEP: Final = "\u001f"


def sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def content_hash(text: str) -> str:
    """Lowercase hex SHA-256 of the UTF-8 encoding of the normalized text."""
    return sha256_hex(normalize_text(text))


@dataclass(frozen=True)
class Locator:
    start: int
    end: int
    text: str
    context_hash: str


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _range_code(length: int, start: Any, end: Any) -> str:
    if not _is_int(start) or not _is_int(end) or start < 0 or end > length or start >= end:
        return "LOC_RANGE"
    if end - start > MAX_PASSAGE_CODEPOINTS:
        return "LOC_TOO_LONG"
    return "OK"


def _context(text: str, start: int, end: int) -> str:
    before = text[max(0, start - _CONTEXT_WINDOW) : start]
    after = text[end : end + _CONTEXT_WINDOW]
    return sha256_hex(before + _SEP + text[start:end] + _SEP + after)


def build_locator(source_text: str, start: int, end: int) -> Locator | str:
    """A locator, or the error code (``LOC_RANGE`` / ``LOC_TOO_LONG``)."""
    code = _range_code(len(source_text), start, end)
    if code != "OK":
        return code
    return Locator(start, end, source_text[start:end], _context(source_text, start, end))


def verify_locator(source_text: str, locator: Locator) -> str:
    code = _range_code(len(source_text), locator.start, locator.end)
    if code != "OK":
        return code
    if locator.text != source_text[locator.start : locator.end]:
        return "LOC_TEXT_MISMATCH"
    if locator.context_hash != _context(source_text, locator.start, locator.end):
        return "LOC_CONTEXT_MISMATCH"
    return "OK"

"""Spec 01 section 1: text rules. Lengths and offsets are Unicode code points."""

from __future__ import annotations

from typing import Final

MAX_SOURCE_CODEPOINTS: Final = 500_000

# Spec 01 blank set, explicit so Python and TypeScript agree (str.isspace() differs).
_BLANK: Final = frozenset(
    [0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0x85, 0xA0, 0x1680, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000]
    + list(range(0x2000, 0x200B))
)


def normalize_text(raw: str) -> str:
    """Remove leading BOMs; CRLF and lone CR become LF. Idempotent."""
    without_bom = raw.lstrip("﻿")
    return without_bom.replace("\r\n", "\n").replace("\r", "\n")


def cp_length(text: str) -> int:
    return len(text)


def has_lone_surrogate(text: str) -> bool:
    # Python decodes valid surrogate pairs from JSON into one character, so any surrogate left is lone.
    return any(0xD800 <= ord(ch) <= 0xDFFF for ch in text)


def is_blank(text: str) -> bool:
    return all(ord(ch) in _BLANK for ch in text)


def text_problems(text: str) -> list[str]:
    """Sorted problem codes of an already-normalized text (spec 01 section 1)."""
    out: set[str] = set()
    if has_lone_surrogate(text):
        out.add("TEXT_INVALID_UNICODE")
    if "\u0000" in text:
        out.add("TEXT_CONTAINS_NUL")
    if "\r" in text or text.startswith("﻿"):
        out.add("TEXT_NOT_NORMALIZED")
    if len(text) > MAX_SOURCE_CODEPOINTS:
        out.add("TEXT_TOO_LONG")
    if is_blank(text):
        out.add("TEXT_EMPTY")
    return sorted(out)

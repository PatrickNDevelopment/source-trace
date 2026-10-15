"""Spec 02 sections 1 and 2: the transition table and the approval gate."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Final, Protocol

from .locator import Locator, verify_locator
from .text import is_blank

STATUSES: Final = ("draft", "needs_review", "approved", "rejected", "revise")
KINDS: Final = ("factual", "interpretation", "disputed", "fictional_canon", "creator_inference")
LABELS: Final = ("support", "contradiction", "unknown")
BLOCKER_CODES: Final = (
    "CLAIM_TEXT_EMPTY",
    "CONTRADICTION_PRESENT",
    "EVIDENCE_LOCATOR_INVALID",
    "EVIDENCE_SOURCE_MISSING",
    "NO_EVIDENCE",
    "NO_SUPPORT",
)

TRANSITIONS: Final[Mapping[str, tuple[str, ...]]] = {
    "draft": ("needs_review",),
    "needs_review": ("approved", "rejected", "revise"),
    "approved": ("revise",),
    "rejected": ("draft",),
    "revise": ("needs_review",),
}


def can_transition(from_status: str, to_status: str) -> bool:
    return to_status in TRANSITIONS.get(from_status, ())


class EvidenceLike(Protocol):
    @property
    def source_id(self) -> str: ...
    @property
    def locator(self) -> Locator: ...
    @property
    def label(self) -> str: ...


def approval_blockers(
    text: str,
    kind: str,
    evidence: Sequence[EvidenceLike],
    source_texts: Mapping[str, str],
) -> list[str]:
    """Sorted, unique blocker codes; empty means the claim may be approved (spec 02 section 2)."""
    out: set[str] = set()
    if is_blank(text):
        out.add("CLAIM_TEXT_EMPTY")
    if len(evidence) == 0:
        out.add("NO_EVIDENCE")
    valid_support = 0
    for ev in evidence:
        source_text = source_texts.get(ev.source_id)
        if source_text is None:
            out.add("EVIDENCE_SOURCE_MISSING")
        elif verify_locator(source_text, ev.locator) != "OK":
            out.add("EVIDENCE_LOCATOR_INVALID")
        elif ev.label == "support":
            valid_support += 1
        if ev.label == "contradiction" and kind != "disputed":
            out.add("CONTRADICTION_PRESENT")
    if len(evidence) > 0 and valid_support == 0:
        out.add("NO_SUPPORT")
    return sorted(out)

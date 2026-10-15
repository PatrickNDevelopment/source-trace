"""Independent builders for vectors and fuzz inputs.

Nothing here imports the backend engine or the TypeScript engine. Hashes come straight from
``hashlib`` and offsets from plain ``str`` slicing, written from spec 01 only, so a vector derived
with these builders is a third opinion on the two implementations.
"""

from __future__ import annotations

import copy
import hashlib
import random
from typing import Any

TRANSITIONS = {
    "draft": ["needs_review"],
    "needs_review": ["approved", "rejected", "revise"],
    "approved": ["revise"],
    "rejected": ["draft"],
    "revise": ["needs_review"],
}
KINDS = ["factual", "interpretation", "disputed", "fictional_canon", "creator_inference"]
LABELS = ["support", "contradiction", "unknown"]
BLOCKERS = [
    "CLAIM_TEXT_EMPTY",
    "CONTRADICTION_PRESENT",
    "EVIDENCE_LOCATOR_INVALID",
    "EVIDENCE_SOURCE_MISSING",
    "NO_EVIDENCE",
    "NO_SUPPORT",
]
EPOCH_MS = 1_760_000_000_000  # an arbitrary fixed instant, only used to make ordered timestamps


def sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def norm(text: str) -> str:
    if text.startswith("﻿"):
        text = text[1:]
    return text.replace("\r\n", "\n").replace("\r", "\n")


def ts(step: int) -> str:
    """The ``step``-th timestamp: strictly increasing, in the exact spec shape."""
    ms = EPOCH_MS + step * 1500
    secs, milli = divmod(ms, 1000)
    import datetime as dt

    t = dt.datetime.fromtimestamp(secs, dt.UTC)
    return t.strftime("%Y-%m-%dT%H:%M:%S") + f".{milli:03d}Z"


def locator(text: str, start: int, end: int) -> dict[str, Any]:
    before = text[max(0, start - 32) : start]
    after = text[end : end + 32]
    return {
        "start": start,
        "end": end,
        "text": text[start:end],
        "contextHash": sha(before + "\x1f" + text[start:end] + "\x1f" + after),
    }


def source(n: int, text: str, *, title: str | None = None, **meta: Any) -> dict[str, Any]:
    body = norm(text)
    out: dict[str, Any] = {
        "id": f"s_{n}",
        "title": title if title is not None else f"Source {n}",
        "author": "",
        "date": "",
        "provenance": "synthetic fixture",
        "url": "",
        "rights": "synthetic",
        "origin": "paste",
        "text": body,
        "contentHash": sha(body),
        "createdAt": ts(n),
    }
    out.update(meta)
    return out


def evidence(n: int, src: dict[str, Any], start: int, end: int, label: str = "support",
             note: str = "") -> dict[str, Any]:
    return {
        "id": f"e_{n}",
        "sourceId": src["id"],
        "locator": locator(src["text"], start, end),
        "label": label,
        "note": note,
    }


def audit_event(seq: int, step: int, typ: str, note: str = "", **extra: Any) -> dict[str, Any]:
    event: dict[str, Any] = {"seq": seq, "at": ts(step), "actor": "user", "type": typ, "note": note}
    event.update(extra)
    return event


def claim(n: int, text: str, kind: str, status: str, evidence_list: list[dict[str, Any]],
          path: list[str] | None = None, step0: int = 100) -> dict[str, Any]:
    """A claim whose audit trail walks ``path`` (statuses after draft) and ends at ``status``."""
    events = [audit_event(1, step0, "created")]
    current = "draft"
    for target in path if path is not None else ([] if status == "draft" else [status]):
        events.append(
            audit_event(len(events) + 1, step0 + len(events), "transition", "", **{"from": current, "to": target})
        )
        current = target
    return {
        "id": f"c_{n}",
        "text": text,
        "kind": kind,
        "status": status,
        "evidence": evidence_list,
        "reviewNote": "",
        "audit": events,
        "origin": "manual",
        "createdAt": ts(step0),
        "updatedAt": ts(step0 + len(events)),
    }


def workspace(sources: list[dict[str, Any]], claims: list[dict[str, Any]],
              name: str = "Fixture workspace") -> dict[str, Any]:
    def top(prefix: str, rows: list[dict[str, Any]]) -> int:
        return max([int(r["id"].split("_")[1]) for r in rows] + [0])

    ev = [e for c in claims for e in c["evidence"]]
    return {
        "schema": 1,
        "name": name,
        "counters": {"source": top("s", sources), "claim": top("c", claims), "evidence": top("e", ev)},
        "sources": sources,
        "claims": claims,
    }


# ---- random valid workspaces for the fuzz --------------------------------------------------

ALPHABET = list(
    "abcdefghij klmnop. ,\n\n\t  QRST 0123 -\"'“”"
) + ["😀", "é", "é", "日", "本", "語", " ", "　", "ß", "İ", "​", "𝔘", " "]


def rand_text(rng: random.Random, lo: int = 3, hi: int = 120, *, bad: bool = False) -> str:
    n = rng.randint(lo, hi)
    chars = [rng.choice(ALPHABET) for _ in range(n)]
    if bad:
        chars.insert(rng.randrange(len(chars) + 1), rng.choice(["\r\n", "\r", "﻿", "\u0000"]))
    return "".join(chars)


def rand_valid_workspace(rng: random.Random) -> dict[str, Any]:
    sources: list[dict[str, Any]] = []
    seen: set[str] = set()
    for n in range(1, rng.randint(1, 4) + 1):
        for _ in range(20):
            body = norm(rand_text(rng, 5, 150))
            if body.strip(" \t\n") and body not in seen:
                seen.add(body)
                break
        else:
            body = f"fallback text {n}"
        date = rng.choice(["", "2020-02-29", "1999-12-31", "2024-06-01"])
        url = rng.choice(["", "https://example.org/a", "http://example.org/b"])
        sources.append(source(n, body, date=date, url=url, origin=rng.choice(["paste", "file", "pdf"])))
    claims: list[dict[str, Any]] = []
    eid = 0
    for cn in range(1, rng.randint(0, 5) + 1):
        kind = rng.choice(KINDS)
        evs: list[dict[str, Any]] = []
        for _ in range(rng.randint(0, 3)):
            src = rng.choice(sources)
            length = len(src["text"])
            a = rng.randrange(length)
            b = min(length, a + rng.randint(1, 12))
            eid += 1
            label = rng.choice(LABELS)
            evs.append(evidence(eid, src, a, b, label, rand_text(rng, 0, 10)))
        status = rng.choice(["draft", "needs_review", "approved", "rejected", "revise"])
        has_support = any(e["label"] == "support" for e in evs)
        has_contra = any(e["label"] == "contradiction" for e in evs)
        text = rand_text(rng, 1, 60)
        if not text.strip(" \t\n"):
            text = "claim text"
        if status == "approved" and (not has_support or (has_contra and kind != "disputed")):
            status = "needs_review"
        paths = {
            "draft": [],
            "needs_review": ["needs_review"],
            "approved": ["needs_review", "approved"],
            "rejected": ["needs_review", "rejected"],
            "revise": ["needs_review", "revise"],
        }
        path = paths[status]
        if rng.random() < 0.3 and status in ("needs_review", "draft"):
            # a longer legal walk: draft -> needs_review -> revise -> needs_review
            path = ["needs_review", "revise", "needs_review"] if status == "needs_review" else []
        c = claim(cn, text, kind, status, evs, path, step0=100 + cn * 20)
        if rng.random() < 0.3:
            c["audit"].append(
                audit_event(
                    len(c["audit"]) + 1,
                    100 + cn * 20 + len(c["audit"]),
                    "approval_refused",
                    "",
                    codes=sorted(rng.sample(BLOCKERS, rng.randint(1, 3))),
                )
            )
        claims.append(c)
    return workspace(sources, claims, name=rand_text(rng, 1, 30) or "w")


def deep_copy(value: Any) -> Any:
    return copy.deepcopy(value)

"""Spec 03 section 1: workspace validation (shared contract).

Mirrors ``src/engine/workspace.ts``. Rule order and codes must stay identical: the vectors and the
differential fuzz (``contracts/tools/fuzz_diff.py``) fail loudly if the two drift.
"""

from __future__ import annotations

import json
import math
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Final

from .locator import Locator, content_hash, verify_locator
from .state import BLOCKER_CODES, KINDS, LABELS, STATUSES, approval_blockers, can_transition
from .text import has_lone_surrogate, text_problems

MAX_INT: Final = 999_999_999
LIMIT_SOURCES: Final = 200
LIMIT_CLAIMS: Final = 2000
LIMIT_EVIDENCE: Final = 50
LIMIT_AUDIT: Final = 500
MAX_JSON_BYTES: Final = 20_000_000

SOURCE_ORIGINS: Final = ("paste", "file", "pdf")
CLAIM_ORIGINS: Final = ("manual", "ai_suggestion")
AUDIT_TYPES: Final = (
    "created",
    "edited",
    "evidence_added",
    "evidence_removed",
    "evidence_labeled",
    "note",
    "transition",
    "approval_refused",
)

_TS_RE: Final = re.compile(
    r"[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])"
    r"T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{3}Z"
)
_DATE_RE: Final = re.compile(r"([0-9]{4})-([0-9]{2})-([0-9]{2})")
_HASH_RE: Final = re.compile(r"[0-9a-f]{64}")


def is_real_date(text: str) -> bool:
    m = _DATE_RE.fullmatch(text)
    if m is None:
        return False
    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if mo < 1 or mo > 12 or d < 1:
        return False
    leap = (y % 4 == 0 and y % 100 != 0) or y % 400 == 0
    days = [31, 29 if leap else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1]
    return d <= days


def _id_number(prefix: str, value: str) -> int | None:
    m = re.fullmatch(rf"{prefix}_([1-9][0-9]{{0,8}})", value)
    return None if m is None else int(m.group(1))


class _Check:
    def __init__(self) -> None:
        self.codes: set[str] = set()

    def keys(
        self, obj: Mapping[str, Any], required: Sequence[str], optional: Sequence[str] = ()
    ) -> bool:
        ok = True
        for key in required:
            if key not in obj:
                self.codes.add("FIELD_MISSING")
                ok = False
        allowed = set(required) | set(optional)
        for key in obj:
            if key not in allowed:
                self.codes.add("UNKNOWN_FIELD")
                ok = False
        return ok

    def str_(self, v: Any, lo: int, hi: int) -> str | None:
        if not isinstance(v, str):
            self.codes.add("FIELD_TYPE")
            return None
        good = True
        if has_lone_surrogate(v):
            self.codes.add("TEXT_INVALID_UNICODE")
            good = False
        if "\u0000" in v:
            self.codes.add("TEXT_CONTAINS_NUL")
            good = False
        if len(v) < lo or len(v) > hi:
            self.codes.add("FIELD_VALUE")
            good = False
        return v if good else None

    def enum(self, v: Any, allowed: Sequence[str]) -> str | None:
        s = self.str_(v, 0, 64)
        if s is None:
            return None
        if s not in allowed:
            self.codes.add("FIELD_VALUE")
            return None
        return s

    def int_(self, v: Any, lo: int, hi: int) -> int | None:
        if isinstance(v, bool) or not isinstance(v, int | float):
            self.codes.add("FIELD_TYPE")
            return None
        if isinstance(v, float) and (not math.isfinite(v) or not v.is_integer()):
            self.codes.add("FIELD_VALUE")
            return None
        n = int(v)
        if n < lo or n > hi:
            self.codes.add("FIELD_VALUE")
            return None
        return n

    def arr(self, v: Any) -> list[Any] | None:
        if not isinstance(v, list):
            self.codes.add("FIELD_TYPE")
            return None
        return v

    def obj(self, v: Any) -> dict[str, Any] | None:
        if not isinstance(v, dict):
            self.codes.add("FIELD_TYPE")
            return None
        return v


def _check_id(c: _Check, v: Any, prefix: str) -> str | None:
    s = c.str_(v, 1, 40)
    if s is None:
        return None
    if _id_number(prefix, s) is None:
        c.codes.add("FIELD_VALUE")
        return None
    return s


def _check_ts(c: _Check, v: Any) -> str | None:
    s = c.str_(v, 0, 64)
    if s is None:
        return None
    if _TS_RE.fullmatch(s) is None:
        c.codes.add("FIELD_VALUE")
        return None
    return s


@dataclass(frozen=True)
class _Evidence:
    id: str
    source_id: str
    locator: Locator
    label: str


@dataclass(frozen=True)
class _Claim:
    id: str
    text: str
    kind: str
    status: str
    evidence: list[_Evidence]
    audit: list[dict[str, Any]]


def _check_source(c: _Check, v: Any) -> tuple[bool, dict[str, str] | None, str | None]:
    o = c.obj(v)
    if o is None:
        return False, None, None
    ok = c.keys(
        o,
        [
            "id",
            "title",
            "author",
            "date",
            "provenance",
            "url",
            "rights",
            "origin",
            "text",
            "contentHash",
            "createdAt",
        ],
    )
    raw_id = o["id"] if isinstance(o.get("id"), str) else None
    sid = _check_id(c, o["id"], "s") if "id" in o else None
    title = c.str_(o["title"], 1, 200) if "title" in o else None
    author = c.str_(o["author"], 0, 200) if "author" in o else None
    date: str | None = None
    if "date" in o:
        date = c.str_(o["date"], 0, 10)
        if date is not None and date != "" and not is_real_date(date):
            c.codes.add("FIELD_VALUE")
            date = None
    provenance = c.str_(o["provenance"], 0, 1000) if "provenance" in o else None
    url: str | None = None
    if "url" in o:
        url = c.str_(o["url"], 0, 2000)
        if url is not None and url != "" and not re.match(r"https?://", url):
            c.codes.add("FIELD_VALUE")
            url = None
    rights = c.str_(o["rights"], 0, 1000) if "rights" in o else None
    origin = c.enum(o["origin"], SOURCE_ORIGINS) if "origin" in o else None
    text: str | None = None
    if "text" in o:
        raw = o["text"]
        if not isinstance(raw, str):
            c.codes.add("FIELD_TYPE")
        else:
            problems = text_problems(raw)
            c.codes.update(problems)
            if not problems:
                text = raw
    chash = c.str_(o["contentHash"], 0, 64) if "contentHash" in o else None
    if chash is not None and _HASH_RE.fullmatch(chash) is None:
        c.codes.add("FIELD_VALUE")
    created = _check_ts(c, o["createdAt"]) if "createdAt" in o else None
    hash_checkable = text is not None and chash is not None and _HASH_RE.fullmatch(chash)
    if hash_checkable and text is not None and content_hash(text) != chash:
        c.codes.add("HASH_MISMATCH")
        ok = False
    if (
        not ok
        or sid is None
        or title is None
        or author is None
        or date is None
        or provenance is None
        or url is None
        or rights is None
        or origin is None
        or text is None
        or chash is None
        or _HASH_RE.fullmatch(chash) is None
        or created is None
    ):
        return False, None, raw_id
    return True, {"id": sid, "text": text, "contentHash": chash}, sid


def _check_locator(c: _Check, v: Any) -> Locator | None:
    o = c.obj(v)
    if o is None:
        return None
    keys_ok = c.keys(o, ["start", "end", "text", "contextHash"])
    start = c.int_(o["start"], 0, MAX_INT) if "start" in o else None
    end = c.int_(o["end"], 0, MAX_INT) if "end" in o else None
    text = c.str_(o["text"], 0, 5000) if "text" in o else None
    ctx = c.str_(o["contextHash"], 0, 64) if "contextHash" in o else None
    if ctx is not None and _HASH_RE.fullmatch(ctx) is None:
        c.codes.add("FIELD_VALUE")
        return None
    if not keys_ok or start is None or end is None or text is None or ctx is None:
        return None
    return Locator(start, end, text, ctx)


def _check_evidence(c: _Check, v: Any) -> _Evidence | None:
    o = c.obj(v)
    if o is None:
        return None
    keys_ok = c.keys(o, ["id", "sourceId", "locator", "label", "note"])
    eid = _check_id(c, o["id"], "e") if "id" in o else None
    sid = _check_id(c, o["sourceId"], "s") if "sourceId" in o else None
    loc = _check_locator(c, o["locator"]) if "locator" in o else None
    label = c.enum(o["label"], LABELS) if "label" in o else None
    note = c.str_(o["note"], 0, 1000) if "note" in o else None
    if not keys_ok or eid is None or sid is None or loc is None or label is None or note is None:
        return None
    return _Evidence(eid, sid, loc, label)


def _check_audit(c: _Check, v: Any, index: int) -> dict[str, Any] | None:
    o = c.obj(v)
    if o is None:
        return None
    type_raw = o.get("type")
    known = isinstance(type_raw, str) and type_raw in AUDIT_TYPES
    is_transition = known and type_raw == "transition"
    is_refusal = known and type_raw == "approval_refused"
    optional = ["from", "to"] if is_transition else ["codes"] if is_refusal else []
    ok = c.keys(o, ["seq", "at", "actor", "type", "note", *optional])
    seq = c.int_(o["seq"], 0, MAX_INT) if "seq" in o else None
    if seq is not None and seq != index + 1:
        c.codes.add("AUDIT_SEQ")
        ok = False
    at = _check_ts(c, o["at"]) if "at" in o else None
    actor: str | None = None
    if "actor" in o:
        a = c.str_(o["actor"], 0, 64)
        if a is not None:
            if a != "user":
                c.codes.add("AUDIT_ACTOR_INVALID")
                ok = False
            else:
                actor = "user"
    typ: str | None = None
    if "type" in o:
        t = c.str_(type_raw, 0, 64)
        if t is not None:
            if not known:
                c.codes.add("AUDIT_TYPE_INVALID")
                ok = False
            else:
                typ = t
    note = c.str_(o["note"], 0, 1000) if "note" in o else None
    from_: str | None = None
    to: str | None = None
    codes: list[str] | None = None
    if is_transition:
        if "from" in o:
            from_ = c.enum(o["from"], STATUSES)
        if "to" in o:
            to = c.enum(o["to"], STATUSES)
        if from_ is None or to is None:
            ok = False
    if is_refusal and "codes" in o:
        raw = c.arr(o["codes"])
        if raw is None:
            ok = False
        else:
            strings: list[str] = []
            all_strings = True
            for item in raw:
                s = c.str_(item, 0, 64)
                if s is None:
                    all_strings = False
                else:
                    strings.append(s)
            if not all_strings:
                ok = False
            else:
                bad = len(strings) == 0
                for i, cur in enumerate(strings):
                    if cur not in BLOCKER_CODES:
                        bad = True
                    if i > 0 and not strings[i - 1] < cur:
                        bad = True
                if bad:
                    c.codes.add("AUDIT_REFUSAL_CODES")
                    ok = False
                else:
                    codes = strings
    if not ok or seq is None or at is None or actor is None or typ is None or note is None:
        return None
    event: dict[str, Any] = {"seq": seq, "at": at, "type": typ}
    if from_ is not None:
        event["from"] = from_
    if to is not None:
        event["to"] = to
    if codes is not None:
        event["codes"] = codes
    return event


def _check_claim(c: _Check, v: Any) -> tuple[_Claim | None, list[str]]:
    o = c.obj(v)
    if o is None:
        return None, []
    ok = c.keys(
        o,
        [
            "id",
            "text",
            "kind",
            "status",
            "evidence",
            "reviewNote",
            "audit",
            "origin",
            "createdAt",
            "updatedAt",
        ],
    )
    cid = _check_id(c, o["id"], "c") if "id" in o else None
    text = c.str_(o["text"], 0, 2000) if "text" in o else None
    kind = c.enum(o["kind"], KINDS) if "kind" in o else None
    status = c.enum(o["status"], STATUSES) if "status" in o else None
    review = c.str_(o["reviewNote"], 0, 2000) if "reviewNote" in o else None
    origin = c.enum(o["origin"], CLAIM_ORIGINS) if "origin" in o else None
    created = _check_ts(c, o["createdAt"]) if "createdAt" in o else None
    updated = _check_ts(c, o["updatedAt"]) if "updatedAt" in o else None

    evidence: list[_Evidence] = []
    evidence_ids: list[str] = []
    if "evidence" in o:
        raw = c.arr(o["evidence"])
        if raw is None:
            ok = False
        else:
            if len(raw) > LIMIT_EVIDENCE:
                c.codes.add("LIMIT_EXCEEDED")
            for item in raw:
                if isinstance(item, dict) and isinstance(item.get("id"), str):
                    evidence_ids.append(item["id"])
                ev = _check_evidence(c, item)
                if ev is None:
                    ok = False
                else:
                    evidence.append(ev)

    audit: list[dict[str, Any]] = []
    if "audit" in o:
        raw_a = c.arr(o["audit"])
        if raw_a is None:
            ok = False
        else:
            if len(raw_a) > LIMIT_AUDIT:
                c.codes.add("LIMIT_EXCEEDED")
            previous_at: str | None = None
            for index, item in enumerate(raw_a):
                ev_a = _check_audit(c, item, index)
                if ev_a is None:
                    ok = False
                    if (
                        isinstance(item, dict)
                        and isinstance(item.get("at"), str)
                        and _TS_RE.fullmatch(item["at"])
                    ):
                        if previous_at is not None and item["at"] < previous_at:
                            c.codes.add("AUDIT_TIME")
                        previous_at = item["at"]
                    continue
                if previous_at is not None and ev_a["at"] < previous_at:
                    c.codes.add("AUDIT_TIME")
                    ok = False
                previous_at = ev_a["at"]
                audit.append(ev_a)

    if (
        not ok
        or cid is None
        or text is None
        or kind is None
        or status is None
        or review is None
        or origin is None
        or created is None
        or updated is None
    ):
        return None, evidence_ids
    return _Claim(cid, text, kind, status, evidence, audit), evidence_ids


def validate_workspace(value: Any) -> list[str]:
    """Spec 03 section 1: the sorted list of unique codes; empty means valid."""
    if not isinstance(value, dict):
        return ["NOT_OBJECT"]
    schema = value.get("schema")
    schema_ok = (
        not isinstance(schema, bool)
        and isinstance(schema, int | float)
        and not (isinstance(schema, float) and not math.isfinite(schema))
        and schema == 1
    )
    if not schema_ok:
        return ["SCHEMA_VERSION"]
    c = _Check()
    c.keys(value, ["schema", "name", "counters", "sources", "claims"])
    if "name" in value:
        c.str_(value["name"], 1, 120)

    counters: tuple[int, int, int] | None = None
    if "counters" in value:
        co = c.obj(value["counters"])
        if co is not None:
            keys_ok = c.keys(co, ["source", "claim", "evidence"])
            s = c.int_(co["source"], 0, MAX_INT) if "source" in co else None
            cl = c.int_(co["claim"], 0, MAX_INT) if "claim" in co else None
            e = c.int_(co["evidence"], 0, MAX_INT) if "evidence" in co else None
            if keys_ok and s is not None and cl is not None and e is not None:
                counters = (s, cl, e)

    source_raw = c.arr(value["sources"]) if "sources" in value else None
    claim_raw = c.arr(value["claims"]) if "claims" in value else None
    if source_raw is not None and len(source_raw) > LIMIT_SOURCES:
        c.codes.add("LIMIT_EXCEEDED")
    if claim_raw is not None and len(claim_raw) > LIMIT_CLAIMS:
        c.codes.add("LIMIT_EXCEEDED")

    good_sources: dict[str, str] = {}
    source_ids: set[str] = set()
    hashes: set[str] = set()
    max_source = 0
    for item in source_raw or []:
        ok, info, raw_id = _check_source(c, item)
        if raw_id is not None:
            if raw_id in source_ids:
                c.codes.add("DUPLICATE_ID")
            source_ids.add(raw_id)
            max_source = max(max_source, _id_number("s", raw_id) or 0)
        if ok and info is not None:
            if info["contentHash"] in hashes:
                c.codes.add("DUPLICATE_SOURCE_HASH")
            hashes.add(info["contentHash"])
            if info["id"] not in good_sources:
                good_sources[info["id"]] = info["text"]

    claim_ids: set[str] = set()
    evidence_ids_seen: set[str] = set()
    max_claim = 0
    max_evidence = 0
    for item in claim_raw or []:
        if isinstance(item, dict) and isinstance(item.get("id"), str):
            if item["id"] in claim_ids:
                c.codes.add("DUPLICATE_ID")
            claim_ids.add(item["id"])
            max_claim = max(max_claim, _id_number("c", item["id"]) or 0)
        claim, ev_ids = _check_claim(c, item)
        for eid in ev_ids:
            if eid in evidence_ids_seen:
                c.codes.add("DUPLICATE_ID")
            evidence_ids_seen.add(eid)
            max_evidence = max(max_evidence, _id_number("e", eid) or 0)
        if claim is None:
            continue
        for ev in claim.evidence:
            if ev.source_id not in source_ids:
                c.codes.add("EVIDENCE_SOURCE_MISSING")
                continue
            src_text = good_sources.get(ev.source_id)
            if src_text is not None and verify_locator(src_text, ev.locator) != "OK":
                c.codes.add("LOCATOR_INVALID")
        status = "draft"
        for event in claim.audit:
            if event["type"] != "transition":
                continue
            if not can_transition(event["from"], event["to"]):
                c.codes.add("AUDIT_TRANSITION_INVALID")
            if event["from"] != status:
                c.codes.add("AUDIT_STATUS_MISMATCH")
            status = event["to"]
        if status != claim.status:
            c.codes.add("AUDIT_STATUS_MISMATCH")
        if claim.status == "approved" and approval_blockers(
            claim.text, claim.kind, claim.evidence, good_sources
        ):
            c.codes.add("APPROVED_FAILS_GATE")

    if counters is not None and (
        counters[0] < max_source or counters[1] < max_claim or counters[2] < max_evidence
    ):
        c.codes.add("COUNTER_INVALID")
    return sorted(c.codes)


MAX_JSON_DEPTH: Final = 64


def json_too_deep(text: str, limit: int = MAX_JSON_DEPTH) -> bool:
    """True when brackets outside string literals nest deeper than ``limit`` (a plain scan, so
    the answer never depends on a parser's recursion limit)."""
    depth = 0
    in_string = False
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        if in_string:
            if ch == "\\":
                i += 1
            elif ch == '"':
                in_string = False
        elif ch == '"':
            in_string = True
        elif ch in "[{":
            depth += 1
            if depth > limit:
                return True
        elif ch in "]}":
            depth -= 1
        i += 1
    return False


def _parse_int(digits: str) -> int | float:
    """JSON numbers are IEEE-754 doubles in the TypeScript twin. Integers short enough to be
    exact stay ``int``; longer ones (beyond Python's int-string limit, too) become a float,
    which is ``inf`` exactly when JavaScript gives ``Infinity``."""
    return int(digits) if len(digits) <= 300 else float(digits)


def _reject_constant(_name: str) -> Any:
    raise ValueError("non-finite number")


def parse_workspace_json(text: str, max_bytes: int = MAX_JSON_BYTES) -> tuple[Any, list[str]]:
    """Spec 03 ``parseWorkspaceJson``: (workspace or None, codes)."""
    try:
        size = len(text.encode("utf-8"))
    except UnicodeEncodeError:
        # A lone surrogate cannot be encoded; JSON text read from a file never carries one raw.
        return None, ["JSON_INVALID"]
    if size > max_bytes:
        return None, ["JSON_TOO_LARGE"]
    if json_too_deep(text):
        return None, ["JSON_INVALID"]
    try:
        value = json.loads(text, parse_constant=_reject_constant, parse_int=_parse_int)
    except (ValueError, RecursionError):
        return None, ["JSON_INVALID"]
    codes = validate_workspace(value)
    return (None, codes) if codes else (value, [])

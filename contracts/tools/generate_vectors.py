#!/usr/bin/env python3
"""Writes ``contracts/vectors/*.json``.

Every ``expected`` value below is stated by hand from the spec, never produced by either engine.
The only computed values are SHA-256 digests and context hashes (``hashlib`` through
``builders.py``); those inputs are listed next to the expectation so a reviewer can check them.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from builders import (
    audit_event,
    claim,
    evidence,
    locator,
    norm,
    sha,
    source,
    ts,
    workspace,
)

OUT = Path(__file__).resolve().parents[1] / "vectors"
SURR = "\ud800"  # a lone surrogate: not valid Unicode text


def write(name: str, doc: dict[str, Any]) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    text = json.dumps(doc, indent=1, ensure_ascii=True, sort_keys=False) + "\n"
    (OUT / name).write_text(text, encoding="utf-8", newline="\n")


# ---- text -----------------------------------------------------------------------------------
text_doc = {
    "normalize": [
        {"name": "crlf", "input": "a\r\nb", "expected": "a\nb"},
        {"name": "lone cr", "input": "a\rb", "expected": "a\nb"},
        {"name": "lf unchanged", "input": "a\nb", "expected": "a\nb"},
        {"name": "bom dropped", "input": "\ufeffabc", "expected": "abc"},
        {"name": "all leading boms", "input": "\ufeff\ufeffabc", "expected": "abc"},
        {"name": "inner bom kept", "input": "a\ufeffb", "expected": "a\ufeffb"},
        {"name": "cr cr lf is two breaks", "input": "a\r\r\nb", "expected": "a\n\nb"},
        {"name": "lf cr is two breaks", "input": "a\n\rb", "expected": "a\n\nb"},
        {"name": "no nfc", "input": "e\u0301", "expected": "e\u0301"},
        {"name": "no trim", "input": "  a  ", "expected": "  a  "},
        {"name": "emoji kept", "input": "x\U0001f600y", "expected": "x\U0001f600y"},
    ],
    "problems": [
        {"name": "clean", "text": "Hello", "expected": []},
        {"name": "empty", "text": "", "expected": ["TEXT_EMPTY"]},
        {"name": "spaces only", "text": " \t\n", "expected": ["TEXT_EMPTY"]},
        {
            "name": "ideographic space only",
            "text": "\u3000\u00a0",
            "expected": ["TEXT_EMPTY"],
        },
        {"name": "zero width space is not blank", "text": "\u200b", "expected": []},
        {"name": "cr present", "text": "a\rb", "expected": ["TEXT_NOT_NORMALIZED"]},
        {"name": "bom present", "text": "\ufeffa", "expected": ["TEXT_NOT_NORMALIZED"]},
        {"name": "nul", "text": "a\u0000b", "expected": ["TEXT_CONTAINS_NUL"]},
        {
            "name": "lone high surrogate",
            "text": "a" + SURR + "b",
            "expected": ["TEXT_INVALID_UNICODE"],
        },
        {
            "name": "lone low surrogate",
            "text": "a\udc00b",
            "expected": ["TEXT_INVALID_UNICODE"],
        },
        {"name": "valid pair is fine", "text": "\U0001f600", "expected": []},
        {
            "name": "nul and cr",
            "text": "\u0000\r",
            "expected": ["TEXT_CONTAINS_NUL", "TEXT_NOT_NORMALIZED"],
        },
        {"name": "exactly 500000", "repeat": ["a", 500_000], "expected": []},
        {"name": "500001", "repeat": ["a", 500_001], "expected": ["TEXT_TOO_LONG"]},
        {"name": "500000 emoji", "repeat": ["\U0001f600", 500_000], "expected": []},
    ],
    "hash": [
        # SHA-256 of "abc" and of the empty string are the FIPS 180 test vectors.
        {
            "name": "abc",
            "input": "abc",
            "expected": "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        },
        {
            "name": "empty",
            "input": "",
            "expected": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        },
        {"name": "crlf equals lf", "input": "a\r\nb", "expected": sha("a\nb")},
        {
            "name": "bom ignored",
            "input": "\ufeffabc",
            "expected": "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        },
        {"name": "emoji utf8", "input": "\U0001f600", "expected": sha("\U0001f600")},
        {
            "name": "combining differs from precomposed",
            "input": "e\u0301",
            "expected": sha("e\u0301"),
        },
    ],
}

# ---- independent acceptance review: hand-derived cases (expected values stated by hand) ------
text_doc["normalize"] += [
    {"name": "review: crlf then lone cr", "input": "\r\n\r", "expected": "\n\n"},
    {"name": "review: lf then crlf", "input": "\n\r\n", "expected": "\n\n"},
    {
        "name": "review: boms, cr cr lf and a lone cr",
        "input": "\ufeff\ufeffa\r\r\nb\rc",
        "expected": "a\n\nb\nc",
    },
    {
        "name": "review: line separator and NEL untouched",
        "input": "a\u2028b\u0085c",
        "expected": "a\u2028b\u0085c",
    },
]
text_doc["problems"] += [
    {"name": "review: U+180E is not in the blank set", "text": "\u180e", "expected": []},
    {
        "name": "review: blank set edge members",
        "text": "\u2000\u200a\u205f\u1680\u0085\u000b\u000c",
        "expected": ["TEXT_EMPTY"],
    },
    {
        "name": "review: one zero width space breaks blankness",
        "text": "\u3000\u200b",
        "expected": [],
    },
    {"name": "review: a lone BOM", "text": "\ufeff", "expected": ["TEXT_NOT_NORMALIZED"]},
    {"name": "review: a lone CR", "text": "\r", "expected": ["TEXT_EMPTY", "TEXT_NOT_NORMALIZED"]},
    {
        "name": "review: Python isspace() separators are not blank",
        "text": "\x1c\x1d\x1e\x1f",
        "expected": [],
    },
    {"name": "review: NUL alone", "text": "\u0000", "expected": ["TEXT_CONTAINS_NUL"]},
]
write("text.json", text_doc)

# ---- locators -------------------------------------------------------------------------------
EMOJI = "x\U0001f600y"  # code points: x=0, emoji=1, y=2 (length 3; 4 UTF-16 units; 6 UTF-8 bytes)
CJK = "日本語のテキスト"  # 8 code points, each one UTF-16 unit
COMB = "e\u0301x"  # e=0, U+0301=1, x=2 (a grapheme of two code points)
CRLF_SRC = norm("line one\r\nline two")  # "line one\nline two": the break is ONE code point at 8
LONG = "a" * 6000

loc_doc: dict[str, Any] = {"build": [], "verify": []}
for name, src, a, b in [
    ("emoji passage", EMOJI, 1, 3),
    ("emoji alone", EMOJI, 1, 2),
    ("cjk middle", CJK, 2, 5),
    ("combining split between base and mark", COMB, 0, 1),
    ("combining whole grapheme", COMB, 0, 2),
    ("crlf normalized offsets", CRLF_SRC, 5, 12),
    ("whole text", "abc", 0, 3),
    ("near start context shorter than window", "hello world", 0, 5),
    ("max length 5000", LONG, 0, 5000),
]:
    loc_doc["build"].append(
        {
            "name": name,
            "source": src,
            "start": a,
            "end": b,
            "expected": locator(src, a, b),
        }
    )
for name, src, a, b, code in [
    ("start negative", "abc", -1, 2, "LOC_RANGE"),
    ("end beyond", "abc", 0, 4, "LOC_RANGE"),
    ("empty range", "abc", 1, 1, "LOC_RANGE"),
    ("reversed", "abc", 2, 1, "LOC_RANGE"),
    ("emoji end beyond utf16 count", EMOJI, 0, 4, "LOC_RANGE"),
    ("too long", LONG, 0, 5001, "LOC_TOO_LONG"),
]:
    loc_doc["build"].append({"name": name, "source": src, "start": a, "end": b, "expected": code})

good = locator(EMOJI, 1, 3)
loc_doc["verify"] += [
    {"name": "ok", "source": EMOJI, "locator": good, "expected": "OK"},
    {
        "name": "text mismatch",
        "source": EMOJI,
        "locator": {**good, "text": "x"},
        "expected": "LOC_TEXT_MISMATCH",
    },
    {
        "name": "context mismatch",
        "source": EMOJI,
        "locator": {**good, "contextHash": sha("nope")},
        "expected": "LOC_CONTEXT_MISMATCH",
    },
    {
        "name": "out of range",
        "source": "abc",
        "locator": locator("abcdef", 3, 6),
        "expected": "LOC_RANGE",
    },
    {
        "name": "same text different place",
        "source": "abab",
        "locator": {**locator("abab", 0, 2), "start": 2, "end": 4},
        "expected": "LOC_CONTEXT_MISMATCH",
    },
    {
        "name": "range wins over text",
        "source": "abc",
        "locator": {"start": 0, "end": 9, "text": "zzz", "contextHash": sha("x")},
        "expected": "LOC_RANGE",
    },
    {
        "name": "text wins over context",
        "source": "abc",
        "locator": {"start": 0, "end": 2, "text": "zz", "contextHash": sha("x")},
        "expected": "LOC_TEXT_MISMATCH",
    },
]

# ---- independent acceptance review: locators ---------------------------------------------------
# "Ab\r\n<emoji><CJK>e<U+0301>!" normalizes to 8 code points: A0 b1 LF2 emoji3 CJK4 e5 U+0301 6 !7.
MIX = norm("Ab\r\n\U0001f600\u6f22e\u0301!")
# 40 emoji, "ab" at code points 40..41 (UTF-16 80..81), 40 emoji: tests the 32 code point window.
WIN = "\U0001f600" * 40 + "ab" + "\U0001f600" * 40
for name, src, a, b in [
    ("review: emoji, CJK and a combining mark after a CRLF", MIX, 3, 7),
    ("review: a combining mark alone is a code point", MIX, 6, 7),
    ("review: context window counted in code points", WIN, 40, 42),
]:
    loc_doc["build"].append(
        {"name": name, "source": src, "start": a, "end": b, "expected": locator(src, a, b)}
    )
loc_doc["build"].append(
    {
        "name": "review: end beyond 8 code points",
        "source": MIX,
        "start": 7,
        "end": 9,
        "expected": "LOC_RANGE",
    }
)


def _swap(text: str, index: int, ch: str) -> str:
    return text[:index] + ch + text[index + 1 :]


win_loc = locator(WIN, 40, 42)
loc_doc["verify"] += [
    {
        "name": "review: passage kept, character after it changed",
        "source": _swap(MIX, 7, "?"),
        "locator": locator(MIX, 3, 7),
        "expected": "LOC_CONTEXT_MISMATCH",
    },
    {
        "name": "review: change at code point 7 is outside the window",
        "source": _swap(WIN, 7, "x"),
        "locator": win_loc,
        "expected": "OK",
    },
    {
        "name": "review: change at code point 8 is inside the window",
        "source": _swap(WIN, 8, "x"),
        "locator": win_loc,
        "expected": "LOC_CONTEXT_MISMATCH",
    },
    {
        "name": "review: change at code point 73 is inside the window",
        "source": _swap(WIN, 73, "x"),
        "locator": win_loc,
        "expected": "LOC_CONTEXT_MISMATCH",
    },
    {
        "name": "review: change at code point 74 is outside the window",
        "source": _swap(WIN, 74, "x"),
        "locator": win_loc,
        "expected": "OK",
    },
    {
        "name": "review: UTF-16 offsets are not code point offsets",
        "source": WIN,
        "locator": {**win_loc, "start": 80, "end": 82},
        "expected": "LOC_TEXT_MISMATCH",
    },
]
write("locator.json", loc_doc)

# ---- state machine and gate -------------------------------------------------------------------
statuses = ["draft", "needs_review", "approved", "rejected", "revise"]
legal = {
    ("draft", "needs_review"),
    ("needs_review", "approved"),
    ("needs_review", "rejected"),
    ("needs_review", "revise"),
    ("approved", "revise"),
    ("rejected", "draft"),
    ("revise", "needs_review"),
}
state_doc = {
    "transitions": [
        {"from": a, "to": b, "legal": (a, b) in legal} for a in statuses for b in statuses
    ]
}

S1 = source(1, "The bridge opened in 1932. Critics disliked the paint.")
S2 = source(2, "Report B says the bridge opened in 1934.")


def gate_case(
    name: str,
    text: str,
    kind: str,
    evs: list[dict[str, Any]],
    expected: list[str],
    sources: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    srcs = sources if sources is not None else [S1, S2]
    return {
        "name": name,
        "claim": {"text": text, "kind": kind, "evidence": evs},
        "sources": {s["id"]: s["text"] for s in srcs},
        "expected": expected,
    }


sup = evidence(1, S1, 0, 25, "support")  # "The bridge opened in 1932."
con = evidence(2, S2, 0, 38, "contradiction")
unk = evidence(3, S1, 27, 54, "unknown")
dangling = {**evidence(4, S1, 0, 5, "support"), "sourceId": "s_9"}
stale = {
    **evidence(5, S1, 0, 5, "support"),
    "locator": {**locator(S1["text"], 0, 5), "text": "Wrong"},
}
state_doc["gate"] = [
    gate_case("supported factual claim", "The bridge opened in 1932.", "factual", [sup], []),
    gate_case("blank text", " \u3000", "factual", [sup], ["CLAIM_TEXT_EMPTY"]),
    gate_case("no evidence", "The bridge opened in 1932.", "factual", [], ["NO_EVIDENCE"]),
    gate_case("only unknown evidence", "x", "factual", [unk], ["NO_SUPPORT"]),
    gate_case(
        "support plus contradiction, factual",
        "x",
        "factual",
        [sup, con],
        ["CONTRADICTION_PRESENT"],
    ),
    gate_case("support plus contradiction, disputed", "x", "disputed", [sup, con], []),
    gate_case("contradiction only, disputed", "x", "disputed", [con], ["NO_SUPPORT"]),
    gate_case(
        "contradiction only, factual",
        "x",
        "factual",
        [con],
        ["CONTRADICTION_PRESENT", "NO_SUPPORT"],
    ),
    gate_case(
        "dangling source",
        "x",
        "factual",
        [dangling],
        ["EVIDENCE_SOURCE_MISSING", "NO_SUPPORT"],
    ),
    gate_case(
        "stale locator",
        "x",
        "factual",
        [stale],
        ["EVIDENCE_LOCATOR_INVALID", "NO_SUPPORT"],
    ),
    gate_case(
        "valid support rescues invalid sibling",
        "x",
        "factual",
        [sup, stale],
        ["EVIDENCE_LOCATOR_INVALID"],
    ),
    gate_case(
        "blank text and no evidence",
        "",
        "interpretation",
        [],
        ["CLAIM_TEXT_EMPTY", "NO_EVIDENCE"],
    ),
    gate_case(
        "fictional canon needs the same gate",
        "x",
        "fictional_canon",
        [unk],
        ["NO_SUPPORT"],
    ),
]

# ---- independent acceptance review: gate ---------------------------------------------------------
con_stale = {**con, "id": "e_6", "locator": {**con["locator"], "text": "Wrong"}}
con_dangling = {**con, "id": "e_7", "sourceId": "s_9"}
state_doc["gate"] += [
    gate_case(
        "review: factual with an invalid contradiction",
        "x",
        "factual",
        [con_stale],
        ["CONTRADICTION_PRESENT", "EVIDENCE_LOCATOR_INVALID", "NO_SUPPORT"],
    ),
    gate_case(
        "review: disputed with support and a dangling contradiction",
        "x",
        "disputed",
        [sup, con_dangling],
        ["EVIDENCE_SOURCE_MISSING"],
    ),
    gate_case(
        "review: interpretation with support and contradiction",
        "x",
        "interpretation",
        [sup, con],
        ["CONTRADICTION_PRESENT"],
    ),
    gate_case(
        "review: disputed with unknown evidence only", "x", "disputed", [unk], ["NO_SUPPORT"]
    ),
    gate_case("review: a zero width space is not blank text", "\u200b", "factual", [sup], []),
]
write("state.json", state_doc)

# ---- workspaces ---------------------------------------------------------------------------------
ok_claim = claim(
    1,
    "The bridge opened in 1932.",
    "factual",
    "approved",
    [sup],
    ["needs_review", "approved"],
)
base = workspace([S1, S2], [ok_claim])


def mutated(fn: Any) -> dict[str, Any]:
    import copy

    doc = copy.deepcopy(base)
    fn(doc)
    return doc


def case(name: str, value: Any, expected: list[str]) -> dict[str, Any]:
    return {"name": name, "value": value, "expected": expected}


def refusal(codes: list[str]) -> dict[str, Any]:
    return audit_event(4, 110, "approval_refused", "no", codes=codes)


ws: list[dict[str, Any]] = [
    case("minimal empty", workspace([], [], "Empty"), []),
    case("valid with approved claim", base, []),
    case("not an object", [], ["NOT_OBJECT"]),
    case("null", None, ["NOT_OBJECT"]),
    case("schema 2", {**base, "schema": 2}, ["SCHEMA_VERSION"]),
    case("schema true", {**base, "schema": True}, ["SCHEMA_VERSION"]),
    case("schema 1.0 is the integer 1", {**base, "schema": 1.0}, []),
    case("unknown top-level key", {**base, "extra": 1}, ["UNKNOWN_FIELD"]),
    case(
        "missing claims",
        {k: v for k, v in base.items() if k != "claims"},
        ["FIELD_MISSING"],
    ),
    case("name empty", {**base, "name": ""}, ["FIELD_VALUE"]),
    case("name wrong type", {**base, "name": 5}, ["FIELD_TYPE"]),
    case("name with NUL", {**base, "name": "a\u0000"}, ["TEXT_CONTAINS_NUL"]),
    case(
        "name with lone surrogate",
        {**base, "name": "a" + SURR},
        ["TEXT_INVALID_UNICODE"],
    ),
    case(
        "counter too small",
        mutated(lambda d: d["counters"].update(source=1)),
        ["COUNTER_INVALID"],
    ),
    case(
        "counter wrong type",
        mutated(lambda d: d["counters"].update(claim="1")),
        ["FIELD_TYPE"],
    ),
    case(
        "duplicate source hash",
        workspace([S1, {**S1, "id": "s_2"}], []),
        ["DUPLICATE_SOURCE_HASH"],
    ),
    case(
        "duplicate source id",
        workspace([S1, {**S2, "id": "s_1"}], []),
        ["DUPLICATE_ID"],
    ),
    case(
        "source hash tampered",
        mutated(lambda d: d["sources"][0].update(contentHash=sha("other"))),
        ["APPROVED_FAILS_GATE", "HASH_MISMATCH"],
    ),
    case(
        "source text has CR",
        mutated(lambda d: d["sources"][1].update(text="a\rb")),
        ["TEXT_NOT_NORMALIZED"],
    ),
    case(
        "source text empty",
        mutated(lambda d: d["sources"][1].update(text="")),
        ["TEXT_EMPTY"],
    ),
    case(
        "source date impossible",
        mutated(lambda d: d["sources"][0].update(date="2023-02-29")),
        ["APPROVED_FAILS_GATE", "FIELD_VALUE"],
    ),
    case(
        "source date leap day ok",
        mutated(lambda d: d["sources"][1].update(date="2024-02-29")),
        [],
    ),
    case(
        "source url scheme",
        mutated(lambda d: d["sources"][1].update(url="ftp://x")),
        ["FIELD_VALUE"],
    ),
    case(
        "source origin unknown",
        mutated(lambda d: d["sources"][1].update(origin="scan")),
        ["FIELD_VALUE"],
    ),
    case(
        "claim kind unknown",
        mutated(lambda d: d["claims"][0].update(kind="fact")),
        ["FIELD_VALUE"],
    ),
    case(
        "claim status unknown",
        mutated(lambda d: d["claims"][0].update(status="done")),
        ["FIELD_VALUE"],
    ),
    case(
        "evidence source missing",
        mutated(lambda d: d["claims"][0]["evidence"][0].update(sourceId="s_7")),
        ["APPROVED_FAILS_GATE", "EVIDENCE_SOURCE_MISSING"],
    ),
    case(
        "locator text tampered",
        mutated(lambda d: d["claims"][0]["evidence"][0]["locator"].update(text="Wrong")),
        ["APPROVED_FAILS_GATE", "LOCATOR_INVALID"],
    ),
    case(
        "locator offsets tampered",
        mutated(lambda d: d["claims"][0]["evidence"][0]["locator"].update(end=26)),
        ["APPROVED_FAILS_GATE", "LOCATOR_INVALID"],
    ),
    case(
        "locator context hash tampered",
        mutated(lambda d: d["claims"][0]["evidence"][0]["locator"].update(contextHash="0" * 64)),
        ["APPROVED_FAILS_GATE", "LOCATOR_INVALID"],
    ),
    case(
        "locator float offset",
        mutated(lambda d: d["claims"][0]["evidence"][0]["locator"].update(start=0.5)),
        ["FIELD_VALUE"],
    ),
    case(
        "duplicate evidence id",
        mutated(lambda d: d["claims"][0]["evidence"].append(dict(d["claims"][0]["evidence"][0]))),
        ["DUPLICATE_ID"],
    ),
    case(
        "approved without support",
        mutated(lambda d: d["claims"][0]["evidence"][0].update(label="unknown")),
        ["APPROVED_FAILS_GATE"],
    ),
    case(
        "approved factual with contradiction",
        mutated(
            lambda d: (
                d["claims"][0]["evidence"].append(evidence(2, S2, 0, 38, "contradiction")),
                d["counters"].update(evidence=2),
            )
        ),
        ["APPROVED_FAILS_GATE"],
    ),
    case(
        "approved disputed with contradiction",
        mutated(
            lambda d: (
                d["claims"][0]["evidence"].append(evidence(2, S2, 0, 38, "contradiction")),
                d["counters"].update(evidence=2),
                d["claims"][0].update(kind="disputed"),
            )
        ),
        [],
    ),
    case(
        "status without audit trail",
        mutated(lambda d: d["claims"][0].update(audit=[audit_event(1, 100, "created")])),
        ["AUDIT_STATUS_MISMATCH"],
    ),
    case(
        "audit seq broken makes the record malformed",
        mutated(lambda d: d["claims"][0]["audit"].pop(1)),
        ["AUDIT_SEQ"],
    ),
    case(
        "audit skips needs_review",
        workspace(
            [S1, S2],
            [
                claim(
                    1,
                    "The bridge opened in 1932.",
                    "factual",
                    "approved",
                    [sup],
                    ["approved"],
                )
            ],
        ),
        ["AUDIT_TRANSITION_INVALID"],
    ),
    case(
        "audit illegal transition",
        mutated(
            lambda d: d["claims"][0]["audit"][2].update(**{"from": "needs_review", "to": "draft"})
        ),
        ["AUDIT_STATUS_MISMATCH", "AUDIT_TRANSITION_INVALID"],
    ),
    case(
        "audit actor ai",
        mutated(lambda d: d["claims"][0]["audit"][1].update(actor="ai")),
        ["AUDIT_ACTOR_INVALID"],
    ),
    case(
        "audit actor system",
        mutated(lambda d: d["claims"][0]["audit"][1].update(actor="system")),
        ["AUDIT_ACTOR_INVALID"],
    ),
    case(
        "audit time goes backwards",
        mutated(lambda d: d["claims"][0]["audit"][2].update(at=ts(1))),
        ["AUDIT_TIME"],
    ),
    case(
        "audit seq gap",
        mutated(lambda d: d["claims"][0]["audit"][2].update(seq=5)),
        ["AUDIT_SEQ"],
    ),
    case(
        "audit unknown type",
        mutated(lambda d: d["claims"][0]["audit"][0].update(type="magic")),
        ["AUDIT_TYPE_INVALID"],
    ),
    case(
        "transition missing to",
        mutated(lambda d: d["claims"][0]["audit"][2].pop("to")),
        ["FIELD_MISSING"],
    ),
    case(
        "created event with a from",
        mutated(lambda d: d["claims"][0]["audit"][0].update(**{"from": "draft"})),
        ["UNKNOWN_FIELD"],
    ),
    case(
        "refusal event ok",
        mutated(lambda d: d["claims"][0]["audit"].append(refusal(["NO_EVIDENCE", "NO_SUPPORT"]))),
        [],
    ),
    case(
        "refusal codes unsorted",
        mutated(lambda d: d["claims"][0]["audit"].append(refusal(["NO_SUPPORT", "NO_EVIDENCE"]))),
        ["AUDIT_REFUSAL_CODES"],
    ),
    case(
        "refusal codes empty",
        mutated(lambda d: d["claims"][0]["audit"].append(refusal([]))),
        ["AUDIT_REFUSAL_CODES"],
    ),
    case(
        "refusal codes unknown",
        mutated(lambda d: d["claims"][0]["audit"].append(refusal(["TRUE_CLAIM"]))),
        ["AUDIT_REFUSAL_CODES"],
    ),
    case(
        "refusal codes duplicate",
        mutated(lambda d: d["claims"][0]["audit"].append(refusal(["NO_EVIDENCE", "NO_EVIDENCE"]))),
        ["AUDIT_REFUSAL_CODES"],
    ),
    case(
        "bad timestamp shape",
        mutated(lambda d: d["claims"][0].update(createdAt="2026-10-15")),
        ["FIELD_VALUE"],
    ),
    case(
        "id wrong prefix",
        mutated(lambda d: d["claims"][0].update(id="s_1")),
        ["FIELD_VALUE"],
    ),
    case(
        "id leading zero",
        mutated(lambda d: d["claims"][0].update(id="c_01")),
        ["FIELD_VALUE"],
    ),
]

# ---- independent acceptance review: workspaces ---------------------------------------------------
draft_ws = workspace([S1, S2], [claim(1, "x", "factual", "draft", [])])
ws += [
    case(
        "review: approved claim citing a malformed source",
        mutated(lambda d: d["sources"][0].update(text="a\r\nb")),
        ["APPROVED_FAILS_GATE", "TEXT_NOT_NORMALIZED"],
    ),
    case(
        "review: draft with an empty audit trail is valid",
        {**draft_ws, "claims": [{**draft_ws["claims"][0], "audit": []}]},
        [],
    ),
    case(
        "review: needs_review with an empty audit trail",
        {**draft_ws, "claims": [{**draft_ws["claims"][0], "audit": [], "status": "needs_review"}]},
        ["AUDIT_STATUS_MISMATCH"],
    ),
    case(
        "review: transition event carrying codes",
        mutated(lambda d: d["claims"][0]["audit"][2].update(codes=["NO_SUPPORT"])),
        ["UNKNOWN_FIELD"],
    ),
    case(
        "review: refusal event carrying from",
        mutated(
            lambda d: d["claims"][0]["audit"].append(
                {**refusal(["NO_SUPPORT"]), "from": "needs_review"}
            )
        ),
        ["UNKNOWN_FIELD"],
    ),
    case(
        "review: claim counter zero",
        mutated(lambda d: d["counters"].update(claim=0)),
        ["COUNTER_INVALID"],
    ),
    case(
        "review: timestamps are checked for shape only",
        mutated(lambda d: d["claims"][0].update(createdAt="2026-02-30T00:00:00.000Z")),
        [],
    ),
    case(
        "review: 1900 is not a leap year",
        mutated(lambda d: d["sources"][1].update(date="1900-02-29")),
        ["FIELD_VALUE"],
    ),
    case(
        "review: 2000 is a leap year",
        mutated(lambda d: d["sources"][1].update(date="2000-02-29")),
        [],
    ),
]
write("workspace.json", {"cases": ws})

# JSON-text level (the import layer)
good_text = json.dumps(base)
json_cases = [
    {"name": "valid", "text": good_text, "expected": []},
    {"name": "empty", "text": "", "expected": ["JSON_INVALID"]},
    {"name": "trailing comma", "text": '{"schema":1,}', "expected": ["JSON_INVALID"]},
    {
        "name": "NaN literal",
        "text": good_text.replace('"schema": 1', '"schema": NaN', 1),
        "expected": ["JSON_INVALID"],
    },
    {
        "name": "Infinity literal",
        "text": '{"schema": Infinity}',
        "expected": ["JSON_INVALID"],
    },
    {"name": "single quotes", "text": "{'schema': 1}", "expected": ["JSON_INVALID"]},
    {"name": "array", "text": "[1]", "expected": ["NOT_OBJECT"]},
    {"name": "string", "text": '"hi"', "expected": ["NOT_OBJECT"]},
    {"name": "bom prefix", "text": "\ufeff" + good_text, "expected": ["JSON_INVALID"]},
    {
        "name": "escaped lone surrogate in name",
        "text": good_text.replace('"Fixture workspace"', '"a\\ud800b"', 1),
        "expected": ["TEXT_INVALID_UNICODE"],
    },
    {
        "name": "escaped pair in name is fine",
        "text": good_text.replace('"Fixture workspace"', '"a\\ud83d\\ude00b"', 1),
        "expected": [],
    },
    {
        "name": "exponent integer",
        "text": good_text.replace('"schema": 1', '"schema": 1e0', 1),
        "expected": [],
    },
    {
        "name": "duplicate key last wins",
        "text": '{"schema": 2, "schema": 1, "name":"w","counters":{"source":0,"claim":0,"evidence":0},'
        '"sources":[],"claims":[]}',
        "expected": [],
    },
    {
        "name": "huge exponent",
        "text": good_text.replace('"claim": 1', '"claim": 1e999', 1),
        "expected": ["FIELD_VALUE"],
    },
]

# ---- independent acceptance review: the JSON layer (nesting, huge integers) ---------------------
json_cases += [
    {
        "name": "review: nesting 65 levels deep",
        "text": '{"schema": 1, "zz": ' + "[" * 64 + "]" * 64 + "}",
        "expected": ["JSON_INVALID"],
    },
    {
        "name": "review: nesting exactly 64 levels deep",
        "text": good_text[:-1] + ', "zz": ' + "[" * 63 + "]" * 63 + "}",
        "expected": ["UNKNOWN_FIELD"],
    },
    {
        "name": "review: 100000 nested arrays",
        "text": "[" * 100_000 + "]" * 100_000,
        "expected": ["JSON_INVALID"],
    },
    {
        "name": "review: brackets inside a string do not nest",
        "text": good_text.replace('"Fixture workspace"', '"' + "[" * 100 + '"', 1),
        "expected": [],
    },
    {
        "name": "review: escaped quote keeps the string open",
        "text": good_text.replace('"Fixture workspace"', '"a\\"' + "{" * 70 + '"', 1),
        "expected": [],
    },
    {
        "name": "review: 5000-digit integer counter",
        "text": good_text.replace('"claim": 1', '"claim": 1' + "0" * 5000, 1),
        "expected": ["FIELD_VALUE"],
    },
    {
        "name": "review: 5000-digit schema",
        "text": '{"schema": 1' + "0" * 5000 + "}",
        "expected": ["SCHEMA_VERSION"],
    },
    {
        "name": "review: 400-digit negative integer",
        "text": good_text.replace('"source": 2', '"source": -1' + "0" * 399, 1),
        "expected": ["FIELD_VALUE"],
    },
]
write("json.json", {"cases": json_cases})
print("vectors written to", OUT)

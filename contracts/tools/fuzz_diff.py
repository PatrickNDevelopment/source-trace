#!/usr/bin/env python3
"""Differential fuzz of the shared contract: Python engine vs TypeScript engine.

Generates seeded random inputs for every shared function (text rules, hashing, locators, the
approval gate, workspace validation and the JSON import layer), evaluates them with the Python
engine here and with the TypeScript engine through ``tests/fuzz-diff.test.ts``, and compares the
results exactly. Exit status 0 only when every case agrees.

    python contracts/tools/fuzz_diff.py --seed 1 --count 1500
    python contracts/tools/fuzz_diff.py --seed 7 --count 200 --keep
"""

from __future__ import annotations

import argparse
import json
import os
import random
import shutil
import subprocess
import sys
import tempfile
from collections import Counter
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT / "backend"))

import builders as b  # noqa: E402
from source_trace.engine.locator import (  # noqa: E402
    Locator,
    build_locator,
    content_hash,
    verify_locator,
)
from source_trace.engine.state import approval_blockers  # noqa: E402
from source_trace.engine.text import normalize_text, text_problems  # noqa: E402
from source_trace.engine.workspace import parse_workspace_json, validate_workspace  # noqa: E402

HIGH, LOW = chr(0xD800), chr(0xDC00)  # lone surrogates: not valid Unicode text
WEIRD: list[Any] = [
    None, True, False, 0, -1, 1, 2, 7, 10**12, 2**53 + 1, 1.5, 1.0, [], {}, [1], {"a": 1}, "",
    "x", "s_1", "c_1", "e_1", "support", "approved", "user", "ai", "draft", "2024-02-30",
    "2024-02-29", "ftp://x", "https://example.org", "a\u0000b", "a" + HIGH + "b", "a\r\nb",
    "﻿x", "\U0001F600", "y" * 3000, "0" * 64, "G" * 64, "2026-10-15T12:00:00.000Z",
    "2026-13-15T12:00:00.000Z",
]


def strip_lone(text: str) -> str:
    return text.replace(HIGH, "?").replace(LOW, "?")


def rand_chars(rng: random.Random, n: int) -> str:
    pool = list(b.ALPHABET) + ["\r", "\r\n", "﻿", "\u0000", HIGH, LOW, "\u0085"]
    return "".join(rng.choice(pool) for _ in range(n))


def paths(doc: Any, prefix: tuple[Any, ...] = ()) -> list[tuple[Any, ...]]:
    out: list[tuple[Any, ...]] = [prefix]
    if isinstance(doc, dict):
        for key, value in doc.items():
            out += paths(value, (*prefix, key))
    elif isinstance(doc, list):
        for index, value in enumerate(doc):
            out += paths(value, (*prefix, index))
    return out


def get(doc: Any, path: tuple[Any, ...]) -> Any:
    for part in path:
        doc = doc[part]
    return doc


def mutate(rng: random.Random, doc: dict[str, Any]) -> dict[str, Any]:
    for _ in range(rng.randint(1, 3)):
        candidates = [p for p in paths(doc) if p]
        if not candidates:
            break
        path = rng.choice(candidates)
        parent = get(doc, path[:-1])
        key = path[-1]
        action = rng.choice(["set", "set", "delete", "unknown", "dup", "swap", "tamper"])
        if action == "set":
            parent[key] = rng.choice(WEIRD)
        elif action == "delete" and isinstance(parent, dict):
            parent.pop(key, None)
        elif action == "delete" and isinstance(parent, list) and parent:
            parent.pop(key)
        elif action == "unknown" and isinstance(parent, dict):
            parent["zz_" + str(rng.randint(0, 9))] = rng.choice(WEIRD)
        elif action == "dup" and isinstance(parent, list) and parent:
            parent.append(b.deep_copy(parent[key]))
        elif action == "swap" and isinstance(parent, list) and len(parent) > 1:
            j = rng.randrange(len(parent))
            parent[key], parent[j] = parent[j], parent[key]
        elif action == "tamper":
            value = get(doc, path)
            if isinstance(value, str):
                parent[key] = value + rng.choice(["x", "\r", "\u0000", " "]) if value else "x"
            elif isinstance(value, int) and not isinstance(value, bool):
                parent[key] = value + rng.choice([-1, 1, 2, 1000])
    return doc


def semantic_mutate(rng: random.Random, doc: dict[str, Any]) -> dict[str, Any]:
    """Well-formed but semantically wrong edits: the rules that need cross-record knowledge."""
    claims = doc["claims"]
    if not claims:
        return doc
    c = rng.choice(claims)
    action = rng.choice(
        ["status", "from_to", "label", "source_text", "kind", "drop_transition", "locator", "dupe_claim"]
    )
    transitions = [e for e in c["audit"] if e["type"] == "transition"]
    if action == "status":
        c["status"] = rng.choice(["draft", "needs_review", "approved", "rejected", "revise"])
    elif action == "from_to" and transitions:
        e = rng.choice(transitions)
        e["from"] = rng.choice(list(b.TRANSITIONS))
        e["to"] = rng.choice(list(b.TRANSITIONS))
    elif action == "label" and c["evidence"]:
        rng.choice(c["evidence"])["label"] = rng.choice(b.LABELS)
    elif action == "source_text" and doc["sources"]:
        src = rng.choice(doc["sources"])
        src["text"] = src["text"][1:] or "z"
        if rng.random() < 0.5:
            src["contentHash"] = b.sha(src["text"])
    elif action == "kind":
        c["kind"] = rng.choice(b.KINDS)
    elif action == "drop_transition" and transitions:
        victim = rng.choice(transitions)
        c["audit"] = [e for e in c["audit"] if e is not victim]
        for index, e in enumerate(c["audit"]):
            e["seq"] = index + 1
    elif action == "locator" and c["evidence"]:
        loc = rng.choice(c["evidence"])["locator"]
        loc["start"] = max(0, loc["start"] - 1)
    elif action == "dupe_claim":
        claims.append(b.deep_copy(c))
    return doc


def gate_case(rng: random.Random) -> dict[str, Any]:
    srcs = []
    for n in range(1, rng.randint(1, 3) + 1):
        body = b.norm(strip_lone(rand_chars(rng, rng.randint(1, 40)))).replace("\u0000", "")
        srcs.append(b.source(n, body or "z"))
    evs: list[dict[str, Any]] = []
    for n in range(rng.randint(0, 4)):
        src = rng.choice(srcs)
        length = len(src["text"])
        a = rng.randrange(length)
        e = min(length, a + rng.randint(1, 10))
        ev = b.evidence(n + 1, src, a, e, rng.choice(b.LABELS))
        roll = rng.random()
        if roll < 0.15:
            ev["locator"]["text"] += "!"
        elif roll < 0.25:
            ev["locator"]["contextHash"] = "0" * 64
        elif roll < 0.35:
            ev["sourceId"] = "s_9"
        elif roll < 0.45:
            ev["locator"]["end"] = length + rng.randint(1, 5)
        evs.append(ev)
    return {
        "claim": {
            "text": rng.choice(["", " ", "　", "claim", strip_lone(rand_chars(rng, 5))]),
            "kind": rng.choice(b.KINDS),
            "evidence": evs,
        },
        "sources": {s["id"]: s["text"] for s in srcs},
    }


def generate(seed: int, count: int) -> list[dict[str, Any]]:
    rng = random.Random(seed)
    cases: list[dict[str, Any]] = []

    def add(op: str, value: Any) -> None:
        cases.append({"id": f"fz-{len(cases):05d}", "op": op, "input": value})

    for _ in range(count):
        roll = rng.random()
        if roll < 0.12:
            add("normalize", rand_chars(rng, rng.randint(0, 30)))
        elif roll < 0.22:
            add("problems", rand_chars(rng, rng.randint(0, 30)))
        elif roll < 0.28:
            add("hash", strip_lone(rand_chars(rng, rng.randint(0, 40))))
        elif roll < 0.40:
            text = strip_lone(rand_chars(rng, rng.randint(1, 60)))
            n = len(text)
            add("build", {"text": text, "start": rng.randint(-2, n + 2), "end": rng.randint(-2, n + 3)})
        elif roll < 0.52:
            text = b.norm(strip_lone(rand_chars(rng, rng.randint(1, 60)))) or "z"
            n = len(text)
            s = rng.randrange(n)
            e = min(n, s + rng.randint(1, 15))
            loc = b.locator(text, s, e)
            r = rng.random()
            if r < 0.2:
                loc["text"] += "x"
            elif r < 0.35:
                loc["contextHash"] = "f" * 64
            elif r < 0.5:
                loc["start"] += rng.choice([-1, 1, 5])
            elif r < 0.6:
                loc["end"] = n + rng.randint(1, 4)
            add("verify", {"text": text, "locator": loc})
        elif roll < 0.62:
            add("gate", gate_case(rng))
        elif roll < 0.92:
            doc = b.rand_valid_workspace(rng)
            if rng.random() < 0.4:
                doc = semantic_mutate(rng, doc)
            add("workspace", mutate(rng, doc) if rng.random() < 0.5 else doc)
        else:
            doc = b.rand_valid_workspace(rng)
            text = json.dumps(doc, ensure_ascii=rng.random() < 0.5)
            r = rng.random()
            if r < 0.15:
                text = text[: rng.randint(0, len(text))]
            elif r < 0.25:
                text = text.replace(":", ": NaN", 1)
            elif r < 0.35:
                text = "﻿" + text
            elif r < 0.45:
                i = rng.randrange(len(text) + 1)
                text = text[:i] + rng.choice([",", "}", "]", " ", "\n", "\t", "1", '"']) + text[i:]
            elif r < 0.55:
                text = text.replace('"schema": 1', '"schema": 1.0', 1).replace(
                    '"schema":1', '"schema":1e0', 1
                )
            elif r < 0.65:
                text = "  \n" + text + "\n  "
            add("json", text)
    # fixed boundary cases that random generation rarely reaches
    add("problems", "a" * 500_000)
    add("problems", "a" * 500_001)
    add("json", "x" * 10)
    return cases


class Ev:
    def __init__(self, d: dict[str, Any]) -> None:
        self.source_id = d["sourceId"]
        dl = d["locator"]
        self.locator = Locator(dl["start"], dl["end"], dl["text"], dl["contextHash"])
        self.label = d["label"]


def evaluate(case: dict[str, Any]) -> Any:
    op, i = case["op"], case["input"]
    if op == "normalize":
        return normalize_text(i)
    if op == "problems":
        return text_problems(i)
    if op == "hash":
        return content_hash(i)
    if op == "build":
        r = build_locator(i["text"], i["start"], i["end"])
        if isinstance(r, str):
            return {"ok": False, "code": r}
        return {
            "ok": True,
            "locator": {"start": r.start, "end": r.end, "text": r.text, "contextHash": r.context_hash},
        }
    if op == "verify":
        d = i["locator"]
        return verify_locator(i["text"], Locator(d["start"], d["end"], d["text"], d["contextHash"]))
    if op == "gate":
        cl = i["claim"]
        return approval_blockers(cl["text"], cl["kind"], [Ev(e) for e in cl["evidence"]], i["sources"])
    if op == "workspace":
        return validate_workspace(i)
    if op == "json":
        return parse_workspace_json(i)[1]
    raise ValueError(op)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--count", type=int, default=1500)
    ap.add_argument("--keep", action="store_true", help="keep the work directory")
    args = ap.parse_args()

    # Round-trip through JSON so Python evaluates exactly what the TypeScript leg will parse (a
    # lone high surrogate followed by a lone low one is a single astral character once serialized).
    cases = json.loads(json.dumps(generate(args.seed, args.count)))
    py: dict[str, Any] = {c["id"]: {"ok": True, "value": evaluate(c)} for c in cases}

    work = Path(tempfile.mkdtemp(prefix="source-trace-fuzz-"))
    cases_file = work / f"seed{args.seed}.cases.json"
    ts_file = work / f"seed{args.seed}.ts.json"
    cases_file.write_text(json.dumps({"cases": cases}), encoding="utf-8")
    npx = shutil.which("npx") or "npx"
    env = {**os.environ, "ST_FUZZ_FILE": str(cases_file), "ST_FUZZ_OUT": str(ts_file)}
    proc = subprocess.run(
        [npx, "vitest", "run", "tests/fuzz-diff.test.ts"],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=600,
    )
    if proc.returncode != 0 or not ts_file.exists():
        print(proc.stdout[-3000:], proc.stderr[-3000:])
        print("fuzz: the TypeScript leg failed to run")
        return 2
    ts = json.loads(ts_file.read_text(encoding="utf-8"))["results"]

    mismatches: list[str] = []
    by_op: Counter[str] = Counter()
    for c in cases:
        by_op[c["op"]] += 1
        got_ts = ts.get(c["id"])
        want = py[c["id"]]
        if got_ts != want:
            mismatches.append(f"{c['id']} {c['op']}: python={want!r:.300} ts={got_ts!r:.300}")
    summary = ", ".join(f"{k}={v}" for k, v in sorted(by_op.items()))
    print(f"fuzz seed={args.seed}: {len(cases)} cases ({summary})")
    print(f"fuzz: {len(mismatches)} mismatches")
    for line in mismatches[:10]:
        print("  MISMATCH", line)
    if mismatches or args.keep:
        print("work directory kept:", work)
    else:
        shutil.rmtree(work, ignore_errors=True)
    return 1 if mismatches else 0


if __name__ == "__main__":
    sys.exit(main())

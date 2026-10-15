#!/usr/bin/env python3
"""Checks the golden vectors in ``contracts/vectors`` against the Python engine.

Exit status 0 only when every vector agrees. The TypeScript engine is checked against the same
files by ``tests/vectors.test.ts``. Run: ``python contracts/tools/check_vectors.py``.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from source_trace.engine.locator import (  # noqa: E402
    Locator,
    build_locator,
    content_hash,
    verify_locator,
)
from source_trace.engine.state import approval_blockers, can_transition  # noqa: E402
from source_trace.engine.text import normalize_text, text_problems  # noqa: E402
from source_trace.engine.workspace import parse_workspace_json, validate_workspace  # noqa: E402

VECTORS = ROOT / "contracts" / "vectors"


def load(name: str) -> Any:
    return json.loads((VECTORS / name).read_text(encoding="utf-8"))


def loc(d: dict[str, Any]) -> Locator:
    return Locator(d["start"], d["end"], d["text"], d["contextHash"])


class Ev:
    def __init__(self, d: dict[str, Any]) -> None:
        self.source_id = d["sourceId"]
        self.locator = loc(d["locator"])
        self.label = d["label"]


def vector_text(case: dict[str, Any], key: str) -> str:
    if "repeat" in case:
        unit, count = case["repeat"]
        return str(unit) * int(count)
    return str(case[key])


def main() -> int:
    failures: list[str] = []
    total = 0

    def check(name: str, got: Any, want: Any) -> None:
        nonlocal total
        total += 1
        if got != want:
            failures.append(f"{name}: got {got!r}, want {want!r}")

    text = load("text.json")
    for c in text["normalize"]:
        check("normalize/" + c["name"], normalize_text(c["input"]), c["expected"])
        check("normalize-idempotent/" + c["name"], normalize_text(c["expected"]), c["expected"])
    for c in text["problems"]:
        check("problems/" + c["name"], text_problems(vector_text(c, "text")), c["expected"])
    for c in text["hash"]:
        check("hash/" + c["name"], content_hash(c["input"]), c["expected"])

    for c in load("locator.json")["build"]:
        got = build_locator(c["source"], c["start"], c["end"])
        want = c["expected"]
        if isinstance(want, str):
            check("build/" + c["name"], got, want)
        else:
            ok = isinstance(got, Locator) and got == loc(want)
            check("build/" + c["name"], ok, True)
    for c in load("locator.json")["verify"]:
        check("verify/" + c["name"], verify_locator(c["source"], loc(c["locator"])), c["expected"])

    state = load("state.json")
    for t in state["transitions"]:
        check(f"transition/{t['from']}->{t['to']}", can_transition(t["from"], t["to"]), t["legal"])
    for c in state["gate"]:
        cl = c["claim"]
        got = approval_blockers(cl["text"], cl["kind"], [Ev(e) for e in cl["evidence"]], c["sources"])
        check("gate/" + c["name"], got, c["expected"])

    for c in load("workspace.json")["cases"]:
        check("workspace/" + c["name"], validate_workspace(c["value"]), c["expected"])
    for c in load("json.json")["cases"]:
        check("json/" + c["name"], parse_workspace_json(c["text"])[1], c["expected"])

    for line in failures:
        print("MISMATCH", line)
    print(f"vectors: {total - len(failures)}/{total} agree")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

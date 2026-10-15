# Handoff

**State:** v0.1 built locally on branch `phase/03a-build`. Not pushed, not deployed, no remote.
Registry status `in_progress` until an independent acceptance review passes.

## Run

```powershell
npm ci
npm run dev                                   # static app: http://localhost:5174/source-trace/
python -m venv .venv ; .\.venv\Scripts\python -m pip install -r backend\requirements.lock.txt
cd backend ; ..\.venv\Scripts\python -m source_trace   # optional backend: http://127.0.0.1:8797
npm run verify                                # the full gate (or scripts\verify.ps1 / verify.sh)
```

## What really works (all covered by automated tests, see docs/test-report.md)

- Sources by paste, Markdown/text file, or PDF via the backend; metadata; content hash; dedup.
- Claims of five kinds; exact passages chosen by mouse or keyboard; code point locators.
- Side-by-side review, evidence labels, review notes, append-only status timeline.
- State machine with a user-only approval gate; refused approvals recorded with codes.
- Heuristic checks (labelled); Markdown and JSON evidence report; workspace backup/restore with
  full validation.
- localStorage persistence with corruption recovery, save-failure banner and cross-tab warning.
- Backend: validated snapshots in SQLite with revisions and conflict detection, isolated PDF
  extraction, opt-in AI broker (fake provider in tests), Host/Origin/CORS/body-cap/deadline guards.
- Shared contract (text, hash, locators, state table, gate, workspace validation) implemented in TS
  and Python, held together by 171 golden vectors and a differential fuzz in the default gate.

## What is absent

- No hosted demo; CI and Pages workflows have never run (no remote).
- No live AI provider call was made (no key in this environment; by design tests never use one).
- See docs/known-limitations.md and docs/backlog.md.

## Release blockers before publication

1. Independent acceptance review (adversarial, by a reviewer who did not write the code).
2. Owner review and explicit approval to publish (separate decision).
3. First real CI run on Linux / Python 3.12.

## Gotchas

- `vite.config.ts` sets `base: '/source-trace/'`; e2e runs on the production build at port 4175.
- Ports: backend 8797 (e2e: fake AI), 8798 (e2e: AI not configured), preview 4175, dev 5174.
- If you change the shared contract: spec, both engines, `contracts/tools/generate_vectors.py`
  (re-run it), then `npm run fuzz` with several seeds.
- `npm run e2e` rewrites `docs/screenshots`; restore them with `git checkout docs/screenshots` unless
  the UI changed.
- The source text box is deliberately not a `readOnly` textarea: a readOnly one does not let the
  keyboard extend a selection. Edits are cancelled in event handlers and covered by an e2e test.

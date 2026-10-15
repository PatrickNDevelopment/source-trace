# Handoff

**State:** v0.1 on branch `phase/03a-build`, independently accepted (see Part 1 of
`docs/test-report.md`; seven defects fixed with regression tests). Approved by the owner for
publication on 2026-10-15.

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
  and Python, held together by 218 golden vectors (47 hand-derived by the acceptance review) and a
  differential fuzz in the default gate.

## What is absent

- The hosted demo (https://patrickndevelopment.github.io/source-trace/) is static only; the backend features run locally.
- No live AI provider call was made (no key in this environment; by design tests never use one).
- See docs/known-limitations.md and docs/backlog.md.

## Release status

Published on 2026-10-15 after owner review. CI and Pages passed on their first real runs; see
Part 3 of `docs/test-report.md`.

## Next step

Maintenance and the follow-ups in `docs/known-limitations.md` and `docs/backlog.md`.

## Gotchas

- `vite.config.ts` sets `base: '/source-trace/'`; e2e runs on the production build at port 4175.
- Ports: backend 8797 (e2e: fake AI), 8798 (e2e: AI not configured), preview 4175, dev 5174.
- If you change the shared contract: spec, both engines, `contracts/tools/generate_vectors.py`
  (re-run it from `contracts/tools`, then `npx prettier --write contracts/vectors`), then
  `npm run fuzz` with several seeds.
- A claim holds at most 500 audit events; operations refuse to append more (`AUDIT_FULL`).
- e2e backend databases go to the git-ignored `.e2e-data/` (wiped at the start of every run); test
  files go to `test-results/`. Nothing is written to the system temp folder by the e2e suite.
- `npm run e2e` rewrites `docs/screenshots`; restore them with `git checkout docs/screenshots` unless
  the UI changed.
- The source text box is deliberately not a `readOnly` textarea: a readOnly one does not let the
  keyboard extend a selection. Edits are cancelled in event handlers and covered by an e2e test.

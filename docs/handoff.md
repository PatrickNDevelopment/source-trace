# Handoff

**State:** v0.1 on branch `phase/03a-build`, independently accepted (see Part 1 of
`docs/test-report.md`; seven defects fixed with regression tests). Not pushed, not deployed, no
remote. The evidence supports registry status `ready_for_publication_review`; the lead engineer
updates `portfolio-control/projects.json` after re-running it.

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

- No hosted demo; CI and Pages workflows have never run (no remote).
- No live AI provider call was made (no key in this environment; by design tests never use one).
- See docs/known-limitations.md and docs/backlog.md.

## Release blockers before publication

1. Owner review (G3): README, screenshots, limitations, license, secrets scan, and the commit author
   e-mail that publication would make public.
2. Explicit owner approval to create the repository, push and enable Pages (G4).
3. First real CI run on Linux / Python 3.12 (action versions never exercised).

## Next step

Owner (human) review of `docs/test-report.md` Part 1 and the screenshots; nothing else is pending in
code.

## Gotchas

- `vite.config.ts` sets `base: '/source-trace/'`; e2e runs on the production build at port 4175.
- Ports: backend 8797 (e2e: fake AI), 8798 (e2e: AI not configured), preview 4175, dev 5174.
- If you change the shared contract: spec, both engines, `contracts/tools/generate_vectors.py`
  (re-run it from `contracts/tools`, then `npx prettier --write contracts/vectors`), then
  `npm run fuzz` with several seeds.
- A claim holds at most 500 audit events; operations refuse to append more (`AUDIT_FULL`).
- `npm run e2e` rewrites `docs/screenshots`; restore them with `git checkout docs/screenshots` unless
  the UI changed.
- The source text box is deliberately not a `readOnly` textarea: a readOnly one does not let the
  keyboard extend a selection. Edits are cancelled in event handlers and covered by an e2e test.

# Test report

## Part 1: independent acceptance (2026-10-15)

Reviewer: an independent Claude Code session that did not write the code, following the portfolio
acceptance prompt and `portfolio-control/CLAUDE_RULES.md`. Environment: Windows 10, Node.js 24.20,
npm 11.19, Python 3.14.7, Playwright with the installed Microsoft Edge. Starting point: branch
`phase/03a-build`, builder commit `3051d79`, clean working tree. Every result below comes from a
command that was run and whose output was read. Scratch work (probes, hostile PDFs, a fresh clone,
broken copies) was done under `%TEMP%` and deleted afterwards.

### Verdict

The evidence supports **ready_for_publication_review** (G2), after the fixes listed below. Nothing
is published, pushed or deployed. CI and the Pages workflow have still never run (no remote).

### Commands, exit codes, results

| What                                                        | Command                                                                                           | Exit | Result                                                                                                   |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------- |
| Baseline gate before any change (`3051d79`)                 | `scripts\verify.ps1`                                                                              | 0    | ALL CHECKS PASSED: 175 unit, 45 backend, 171/171 vectors, fuzz 0 mismatches, 25 e2e                      |
| Fresh clone of the fixed commit `683b50e`, new venv         | `git clone`, `python -m venv .venv`, `pip install -r backend\requirements.lock.txt`, `verify.ps1` | 0    | ALL CHECKS PASSED: 221 unit, 51 backend, 218/218 vectors, fuzz 0 mismatches, 29 e2e                      |
| Final gate in the working copy (`683b50e`)                  | `scripts\verify.ps1`                                                                              | 0    | see "Final gate" below                                                                                   |
| Differential fuzz, extra seeds, extended generator          | `python contracts/tools/fuzz_diff.py --seed N --count 3000`, N = 1, 11, 29, 97                    | 0    | 3,003 cases each, 0 mismatches                                                                           |
| New tests against the OLD code (`3051d79` `src`, `backend`) | `npx vitest run`                                                                                  | 1    | 7 failed (Markdown fences x2, quote length, audit cap, NUL, JSON nesting x2)                             |
|                                                             | `pytest backend/tests/test_review_regressions.py` (import-free subset)                            | 1    | 5 failed (413, strict revision, Host user info, AI ids, AI NUL)                                          |
|                                                             | `python contracts/tools/check_vectors.py`                                                         | -    | 215/218 agree (3 new JSON vectors disagree)                                                              |
|                                                             | `python contracts/tools/fuzz_diff.py --seed 1 --count 1500` (extended generator)                  | 1    | 3 mismatches between the old engines (deep nesting, huge integers)                                       |
| Verify scripts fail loudly (scratch copy)                   | `verify.ps1` with the old engine and new tests                                                    | 2    | stopped at `FAILED: typecheck (exit 2)`                                                                  |
|                                                             | `sh scripts/verify.sh` with a Prettier violation in `src/engine/text.ts`                          | 1    | stopped at "format check"                                                                                |
| Live backend probes (scratch script, fake AI, port 8797)    | forged snapshots, JSON layer, Host/Origin/CORS, body caps, deadline, AI broker                    | -    | results in "Adversarial cases" below                                                                     |
| Hostile PDFs (scratch, built in `%TEMP%`)                   | 14 crafted files posted to `/api/pdf/extract`                                                     | -    | every cap held, see below; no worker process left behind                                                 |
| History scan                                                | `git log --all -p` grepped for key/token patterns and e-mail addresses                            | -    | no secret; only e-mails are the commit author's own address and the Anthropic no-reply co-author address |

### Defects found and fixed (each with a regression test that fails on `3051d79`)

1. **Data loss after repeated refused approvals (high).** Every press of "Approve" on a blocked
   claim appends an `approval_refused` event, with no upper bound. Past 500 events the saved workspace
   fails validation (`LIMIT_EXCEEDED`), so the next reload showed an **empty workspace** (seen in the
   browser: 504 events, then the recovery banner). Holding Enter on the button is enough. Fix: every
   operation refuses to append beyond 500 events (`AUDIT_FULL`, with a message) and changes nothing;
   the recovery banner now offers "Download the unreadable copy". Tests: `tests/ops.test.ts`
   (reviewer regressions), `e2e/review-regressions.spec.ts` (520 real clicks, reload keeps 4 claims;
   download of the unreadable copy).
2. **Markdown report rendered source and claim markup (high).** Passages and claim text were put in
   `>` blockquotes, where inline HTML, images (tracking pixels) and links still render; the builder's
   unit test even asserted `> Claim <script>…`. Fix: fenced code blocks whose fence is longer than any
   backtick run in the text. Tests: a CommonMark-style fence walk in `tests/checks-report.test.ts` and
   a downloaded-report check in e2e.
3. **Contract disagreement in the JSON import layer (medium).** Found by hand probes, missed by the
   fuzz: 100,000 nested arrays gave `JSON_INVALID` in Python (recursion limit) and `NOT_OBJECT` in
   TypeScript; integers longer than 4,300 digits gave `JSON_INVALID` in Python (int-string limit) and
   `SCHEMA_VERSION`/`FIELD_VALUE` in TypeScript. Fix (spec 03 §1 updated): a plain bracket scan rejects
   nesting deeper than 64 in both engines; Python reads over-long integers as doubles like JavaScript.
   New golden vectors; the fuzz generator now also produces deep nesting, huge integers, prototype-like
   keys, shuffled keys and forbidden or allowed whitespace.
4. **Streamed JSON body over the cap answered 400, not 413 (medium).** The cap held, but FastAPI turned
   the middleware's exception into "error parsing the body". Fix: the middleware answers 413 itself and
   tells the app the client disconnected.
5. **AI suggestion text could hold U+0000 (medium).** A suggestion whose `claimText` had a NUL was
   returned, and accepting it would have created a claim that makes the workspace invalid (see 1).
   Fix: the broker drops such suggestions (counted in `rejected`); all client operations refuse NUL
   and lone surrogates.
6. **Smaller hardening:** AI request source ids are now restricted to `s_<n>` (an id could carry
   `</source>` into the prompt and arbitrary text into the usage log); `baseRevision` must be a JSON
   integer (`"2"` and `true` were coerced and saved); a Host header with user info
   (`evil@127.0.0.1`) is refused; a workspace loaded from the backend is validated before it replaces
   the local one (forged answer test in e2e); the quote heuristic counts code points, as the spec says;
   "locked while a claim is needs review" reworded.
7. **Docs:** spec 00 named files that do not exist (`hash.ts`, `hashing.py`); spec 03 now states that
   the gate's source map holds only well-formed sources, the JSON depth and number rules, and the API
   tightening; spec 02 states the audit limit behaviour; `SECURITY.md` and
   `docs/known-limitations.md` updated.

### Hand-derived scenarios (guidance 1)

Derived from the spec by hand, then added to `contracts/tools/generate_vectors.py` as `review:`
cases, so both engines run them in the default gate (TypeScript via `tests/vectors.test.ts`, Python
via `check_vectors.py`). 47 new vectors in six groups: text normalization and the blank set (for
example `"\ufeff\ufeffa\r\r\nb\rc"` gives `"a\n\nb\nc"`; U+180E and the Python `isspace()` separators
U+001C to U+001F are not blank; a lone CR is `TEXT_EMPTY` and `TEXT_NOT_NORMALIZED`); code point
locators over emoji, CJK, a combining mark and a CRLF, and the exact 32-code-point context window
edges (a change at code point 7 or 74 keeps the locator, at 8 or 73 breaks it; UTF-16 offsets give
`LOC_TEXT_MISMATCH`); the gate including the disputed-kind rule (a contradiction with an invalid
locator on a factual claim gives `CONTRADICTION_PRESENT`, `EVIDENCE_LOCATOR_INVALID`, `NO_SUPPORT`;
a disputed claim with support and a dangling contradiction gives only `EVIDENCE_SOURCE_MISSING`);
workspace validation (an approved claim citing a malformed source; empty audit trails; `codes` on a
transition; leap years 1900 and 2000); and the JSON layer. Result: both engines agreed with every hand
result except the JSON-layer cases, which is defect 3. The old transition table was already
enumerated in full by the builder's vectors.

### Adversarial cases and invariants (all observed)

- **Approval gate bypass.** UI: Approve is refused with precise codes and recorded (journeys 1 and 2,
  sample claim c_2); keyboard and repeated clicks covered by defect 1. Backend `PUT` with an `ai`
  actor, a skipped transition, approved without support, approved factual with a contradiction, a
  tampered text (with and without re-hashing) and a tampered locator: all 422 with the right code;
  approved **disputed** with a contradiction: accepted (spec). Browser import of a crafted workspace
  (AI actor) and of invalid JSON: refused (existing e2e). A forged backend answer is no longer loaded.
- **Versioning and stale updates.** Source text is immutable; identical text is refused as a duplicate
  by hash (CRLF and LF count as the same). Claim content is locked outside draft/revise (unit tests,
  disabled controls seen at 320 px). Backend revisions: stale, future and negative base revisions are
  refused (409/422); two tabs show a warning banner (last writer still wins, now documented).
- **Injection and XSS.** Hostile markup in titles, source text and claim text stays text in every view
  (existing e2e, `main img/script/b` count 0) and now also in the Markdown report. The PDF text
  `<script>…` came back as plain text. File names come from `slug()` (`[a-z0-9-]` only).
- **Malformed and hostile PDFs:** wrong content type 415; not a PDF, empty body, truncated file, header
  only, nested-array bomb: 422 `pdf_invalid`; 51 pages 422 `pdf_too_many_pages` (50 accepted);
  RC4-encrypted 422 `pdf_encrypted`; image-free text-free page 422 `pdf_no_text`; 5.5 MB 413; a Flate
  bomb (300 MB of operators in 437 KB) 422 in 4.5 s; 330,000 text operators 504 `pdf_timeout` after
  10.3 s with the worker killed (no `pdf_worker` process left). A lying `/Count` was ignored.
- **AI broker (fake provider and mocked transport only; no network):** no opt-in header or a wrong
  value 403; disabled-provider backend 403 `ai_disabled` and the UI says so; an invented source id and
  a mismatching passage are dropped and counted; an answer with a `status` field, prose and a provider
  failure are 502; a lone surrogate in the request 422; 6 sources 422; 63,000 characters 413; the 21st
  call in an hour 429 with `Retry-After`. The usage log holds prompt hash, version, ids and counts, no
  key and no source text.
- **Backend hardening:** foreign Host 400 `host_not_allowed`; foreign Origin and `Origin: null` on
  writes 403; CORS preflight from a foreign origin gets no allow header; declared and streamed
  oversized bodies 413; a request that never finishes its body gets 504 after 30 s; 404, 405, 413, 422
  and 500 all use the error envelope; huge-integer and deeply nested bodies 400 with the envelope.
- **Static release under `/source-trace/`:** production build served by `vite preview` on port 4175;
  `/source-trace/`, a deep link `#/review` and a hard refresh work (e2e and by hand); assets are
  prefixed; no request to localhost or 127.0.0.1 is made unless "Use the backend" is pressed (e2e).

### Visual and accessibility inspection

Read `docs/screenshots/desktop-review.png`, `desktop-sources.png`, `mobile-review.png` and
`desktop-review-dark.png`, and took live 320 px screenshots of Settings (recovery banner), Review
(claim detail) and Report. No overflow (`scrollWidth` 320 of 320); visible focus outline
(`:focus-visible`); every control named (e2e check). The three review screenshots were regenerated by
the final gate because the locked-claim wording changed; they were inspected again.

### Remaining issues (not fixed, not blocking)

- CI, the Pages workflow and their action versions (`actions/*@v7`, `configure-pages@v6`,
  `upload-pages-artifact@v5`, `deploy-pages@v5`) have never run; Linux and Python 3.12 untested here.
- The e2e configuration leaves a `source-trace-e2e-*` temporary directory per run (SQLite files).
- Two tabs: warning only, last writer wins (documented).
- The commit author e-mail in the history will become public on publication (owner decision).
- Firefox, Safari, screen readers, 200 % zoom and a live AI provider are untested (documented).

### Final gate

`scriptserify.ps1` in the working copy at `683b50e` (the three review screenshots regenerated by
the run were then committed with this report), exit code 0:

```
==> install (lockfile)          npm ci: ok
==> format check                ok
==> lint                        ok
==> typecheck                   ok
==> frontend unit tests         Test Files 3 passed | 1 skipped (4); Tests 221 passed | 1 skipped (222)
==> backend lint                All checks passed!
==> backend format              ok
==> backend types               Success: no issues found in 18 source files
==> backend tests               51 passed, 1 warning
==> golden vectors              vectors: 218/218 agree
==> cross-implementation fuzz   fuzz seed=1: 1503 cases; fuzz: 0 mismatches
==> production build            ok
==> secret scan                 secret-scan: no findings
==> browser e2e                 29 passed (1.7m)
ALL CHECKS PASSED
```

A re-run after the first report commit (`c5eeb74`) stopped at `FAILED: secret scan (exit 1)`: this
report quoted an e-mail address (`docs/test-report.md:33  email address (personal data check)`). The
address was removed and the gate re-run on the next commit; its result is in the reviewer's final
answer and must be reproduced by the lead engineer.

The one skipped Vitest case is the inert TypeScript leg of the fuzz (it runs inside `npm run fuzz`).
The one pytest warning is Starlette's `httpx` deprecation notice.

## Part 2: builder's report, unchanged

Environment: Windows 10, Node.js 24.20, npm 11.19, Python 3.14.7, Microsoft Edge (Chromium) for
Playwright. All results below come from commands that were run and read; nothing is copied from a
plan.

### Full gate in the working copy

`scripts\verify.ps1` (the same steps as `npm run verify`), exit code 0, `ALL CHECKS PASSED`:

| Step                          | Command                     | Result                                                                                  |
| ----------------------------- | --------------------------- | --------------------------------------------------------------------------------------- |
| install                       | `npm ci`                    | ok                                                                                      |
| format                        | `npm run format:check`      | ok                                                                                      |
| lint                          | `npm run lint`              | ok                                                                                      |
| types                         | `npm run typecheck`         | ok (strict)                                                                             |
| frontend unit tests           | `npm test`                  | 175 passed, 1 skipped (fuzz leg, inert)                                                 |
| backend lint / format / types | `npm run backend:lint` etc. | ruff clean, mypy --strict clean (18 files)                                              |
| backend tests                 | `npm run backend:test`      | 45 passed                                                                               |
| golden vectors                | `npm run vectors:check`     | 171/171 agree (Python); TS checks the same files in `tests/vectors.test.ts` (160 cases) |
| differential fuzz             | `npm run fuzz`              | seed 1, 1,503 cases, 0 mismatches                                                       |
| build                         | `npm run build`             | ok                                                                                      |
| secret scan                   | `npm run secrets`           | no findings                                                                             |
| end-to-end                    | `npm run e2e`               | 25 passed                                                                               |

### Fresh clone

`git clone` of commit `4ff8ca1` into a temporary directory, new virtualenv, `pip install -r
backend/requirements.lock.txt`, `scripts\verify.ps1`: exit 0, `ALL CHECKS PASSED` (175 frontend
tests, 45 backend tests, 171/171 vectors, 0 fuzz mismatches, 25 e2e). The directory was deleted
afterwards.

### The verify scripts fail loudly

In a scratch clone: a Prettier violation made `scripts\verify.ps1` stop at "format check" with exit 1;
a deliberately failing unit test made `scripts/verify.sh` stop at "frontend unit tests" with exit 1.
Scratch copy deleted.

### Differential fuzz, extra seeds

`python contracts/tools/fuzz_diff.py --seed N --count 2000` for N = 1, 2, 3, 4: 2,003 cases each, 0
mismatches. Case mix per run: normalize, problems, hash, locator build and verify, approval gate,
mutated workspaces (structural and semantic mutations: status, transitions, labels, kinds, source
text with and without re-hashing, dropped transitions, locator shifts, duplicated claims) and JSON
import text (truncation, NaN, BOM, stray characters, float integers). Coverage of validation codes in
one 2,000-case run included every cross-record code (APPROVED_FAILS_GATE, AUDIT_STATUS_MISMATCH,
AUDIT_TRANSITION_INVALID, LOCATOR_INVALID, HASH_MISMATCH, DUPLICATE_ID, ...).

### Defects found while building (all fixed, with tests)

1. `normalizeText` was not idempotent for a doubled BOM (found by the vector self-check); the spec now
   removes every leading U+FEFF.
2. The fuzz harness compared a Python string holding two separate lone surrogates with the single
   astral character JSON turns them into; the harness now round-trips inputs through JSON.
3. A `readOnly` textarea did not let the keyboard extend a selection (found by the keyboard e2e
   test): the source text box now cancels edits in event handlers instead, with an e2e test that
   typing, cutting and deleting change nothing.
4. Years inside ISO dates were reported twice by `DATE_NOT_IN_PASSAGE`.

### Journeys covered by Playwright (production build under `/source-trace/`)

Static: journey 1 (paste, select, claim, contradiction, refused approval, revise, approve as
disputed, Markdown and JSON export) and journey 2 (unsupported claim refused with `NO_SUPPORT`,
history survives reload); no-evidence refusal; keyboard-only selection; edits to the source box are
impossible; empty selection; code point offsets with an emoji; duplicate hash with CRLF; hostile markup
is inert; export/import round trip plus a crafted workspace (AI actor) and invalid JSON refused;
corrupt storage recovery; failing storage write banner; cross-tab warning; no backend request from the
static demo; sample data labelling and confirmation; deep link and refresh under the prefix; every
control named and no overflow at 320 px on all views; screenshots (desktop, mobile, dark).
Backend: PDF extraction and malformed PDF; save, conflict, load; AI opt-in, drafts only, invented
source dropped; AI answer with a `status` field rejected; AI not configured; backend offline;
backend refuses a forged approved snapshot.

### Not tested

Linux and Python 3.12 (CI not run), Firefox, Safari, screen readers, a live AI provider, very large
PDFs beyond the generated fixtures.

Screenshots: `docs/screenshots/desktop-review.png`, `desktop-sources.png`, `mobile-review.png`,
`desktop-review-dark.png` (inspected).

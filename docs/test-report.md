# Test report

## Part 1: builder's report (2026-10-15)

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

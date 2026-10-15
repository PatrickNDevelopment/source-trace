# Spec 00: overview and decisions

SourceTrace is a human review workbench for claims and their citations. It does **not** establish
truth. Everything it computes is either a structural fact about the user's own data (a quote is at
these offsets, a hash is this value) or a labelled heuristic.

## Architecture in one paragraph

All domain logic lives in one TypeScript engine (`src/engine`). The browser holds one workspace
(`schema` 1) and persists it in `localStorage`. The optional FastAPI backend is **not** a second
application: it stores workspace snapshots in SQLite, extracts text from PDFs, and brokers the optional
AI assistant. Because it stores snapshots, it must refuse invalid ones, so a small subset of the
engine exists twice (TypeScript and Python). That subset is the **shared contract**:

| Shared contract piece | Spec      | TS                                          | Python                         |
| --------------------- | --------- | ------------------------------------------- | ------------------------------ |
| text rules + hash     | 01 §1, §2 | `engine/text.ts`, `sha256.ts`, `locator.ts` | `engine/text.py`, `locator.py` |
| locators              | 01 §3     | `engine/locator.ts`                         | `engine/locator.py`            |
| state table + gate    | 02 §1, §2 | `engine/state.ts`                           | `engine/state.py`              |
| workspace validation  | 03 §1     | `engine/workspace.ts`                       | `engine/workspace.py`          |

Everything else (heuristic checks, report, UI view-models, AI suggestion handling in the client) is
TypeScript only and is **not** part of the contract. The contract is held together by:
hand-derived golden vectors (`contracts/vectors/*.json`), a differential fuzz that feeds the same
generated inputs, including the JSON parse and import layer, to both implementations
(`contracts/tools/fuzz_diff.py`), and a self-check of the vectors against the Python implementation.

## Domain model (summary; exact field rules in spec 03)

- **Source**: immutable imported text plus metadata (title, author, date, provenance, URL, rights note,
  origin). Identified by `s_<n>`. Text never changes after import; to use different text, import it as a
  new source. Identical normalized text de-duplicates by content hash.
- **Claim**: a statement of one of five kinds (`factual`, `interpretation`, `disputed`,
  `fictional_canon`, `creator_inference`) with a status, evidence list, review note and audit trail.
- **Evidence**: a link from a claim to an exact passage of a source (a locator) with a label
  `support`, `contradiction` or `unknown` and a note.
- **Audit event**: append-only record of every change and every refused approval.
- **Report**: Markdown and JSON export. Never says anything is verified or true.

## Decisions (resolved ambiguities)

1. Offsets are Unicode **code points**, not UTF-16 units and not bytes. The UI converts the browser's
   UTF-16 selection offsets; the engine never sees UTF-16 offsets.
2. Line endings are normalized on import (CRLF and lone CR become LF) and a leading BOM is dropped.
   Nothing else is normalized (no NFC, no trimming), so offsets always refer to what the user pasted.
3. Source text is immutable. There is no "source version"; a changed text is a new source.
4. Claim content (text, kind, evidence) can be edited only while the claim is `draft` or `revise`.
5. The approval gate depends only on the claim and its sources (not on who asks or on a note), so a
   stored snapshot can be re-checked. A claim with contradicting evidence can only be approved as
   `disputed`.
6. Only a user can transition a claim. An AI suggestion is plain data in the client; accepting it
   creates a **draft** claim through the same user action as typing one. Audit `actor` is always
   `user` in v0.1, and a snapshot containing any other actor is invalid.
7. A refused approval is recorded as an `approval_refused` audit event with the precise blocker codes.
8. The backend never runs heuristic checks and never creates or changes claims.
9. Ids are monotonic counters (`s_1`, `c_1`, `e_1`), so same-time events keep a stable order.
10. All timestamps are `YYYY-MM-DDTHH:MM:SS.mmmZ` (UTC, millisecond precision, exactly this shape).

## Non-goals (v0.1)

Truth verification, automatic source discovery, multi-user sync, OCR, scanned PDFs, per-source version
history, interoperability with other tools (see `docs/backlog.md`).

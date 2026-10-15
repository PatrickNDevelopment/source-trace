# Spec 03: workspace, report, API

## 1. Workspace JSON (schema 1) and validation (shared contract)

```
Workspace { schema: 1, name, counters: {source, claim, evidence}, sources[], claims[] }
Source    { id, title, author, date, provenance, url, rights, origin, text, contentHash, createdAt }
Claim     { id, text, kind, status, evidence[], reviewNote, audit[], origin, createdAt, updatedAt }
Evidence  { id, sourceId, locator{start,end,text,contextHash}, label, note }
Audit     { seq, at, actor, type, from?, to?, note, codes? }
```

Field rules (strings are measured in code points):

| Field                  | Rule                                                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `schema`               | the integer 1 (`SCHEMA_VERSION` otherwise)                                                                              |
| `name`                 | string 1..120                                                                                                           |
| `counters.*`           | integers 0..999,999,999, each >= the largest numeric id of that type                                                    |
| ids                    | `s_<n>`, `c_<n>`, `e_<n>` with `n` 1..999,999,999 and no leading zero                                                   |
| `title`                | string 1..200                                                                                                           |
| `author`               | string 0..200                                                                                                           |
| `date`                 | `""` or a real calendar date `YYYY-MM-DD` (Gregorian, leap years)                                                       |
| `provenance`, `rights` | string 0..1000                                                                                                          |
| `url`                  | `""` or string 1..2000 starting with `http://` or `https://`                                                            |
| `origin` (source)      | `paste`, `file`, `pdf`                                                                                                  |
| `text` (source)        | normalized and valid per spec 01 (`textProblems` empty)                                                                 |
| `contentHash`          | equals `contentHash(text)` (`HASH_MISMATCH`)                                                                            |
| claim `text`           | string 0..2000                                                                                                          |
| `kind`                 | `factual`, `interpretation`, `disputed`, `fictional_canon`, `creator_inference`                                         |
| `status`               | the five statuses                                                                                                       |
| `reviewNote`, note     | string 0..2000 (claim review note) / 0..1000 (evidence note, audit note)                                                |
| claim `origin`         | `manual`, `ai_suggestion`                                                                                               |
| `label`                | `support`, `contradiction`, `unknown`                                                                                   |
| timestamps             | exactly `YYYY-MM-DDTHH:MM:SS.mmmZ`                                                                                      |
| audit `seq`            | 1, 2, 3, ... contiguous                                                                                                 |
| audit `at`             | non-decreasing in string order                                                                                          |
| audit `actor`          | `user` only                                                                                                             |
| audit `type`           | `created`, `edited`, `evidence_added`, `evidence_removed`, `evidence_labeled`, `note`, `transition`, `approval_refused` |
| `from`,`to`            | present (statuses) exactly on `transition`; absent otherwise                                                            |
| `codes`                | present exactly on `approval_refused`: non-empty, sorted, unique, all known blocker codes                               |

An "integer" is a JSON number whose mathematical value is an integer (so `1.0` and `1e0` count);
booleans are not numbers. Objects must have exactly the listed keys (`from`, `to`, `codes` only where
allowed): a missing key is `FIELD_MISSING`, an extra key is `UNKNOWN_FIELD`, a wrong JSON type is
`FIELD_TYPE`, a right type with a bad value is `FIELD_VALUE`.

Limits: 200 sources, 2,000 claims, 50 evidence per claim, 500 audit events per claim
(`LIMIT_EXCEEDED`).

Cross-record rules:

- `DUPLICATE_ID`: an id used twice among sources, among claims, or among evidence (any claim).
- `DUPLICATE_SOURCE_HASH`: two sources with the same `contentHash`.
- `EVIDENCE_SOURCE_MISSING`: evidence `sourceId` names no source.
- `LOCATOR_INVALID`: evidence whose source exists and `verifyLocator != OK`.
- `AUDIT_STATUS_MISMATCH`: replaying the audit trail does not end at `claim.status`. Replay starts at
  `draft`; each `transition` must have `from` equal to the replayed status. A claim with an empty
  audit trail must be `draft`.
- `AUDIT_TRANSITION_INVALID`: a `transition` whose (from, to) is not in the table of spec 02.
- `APPROVED_FAILS_GATE`: `status == approved` and `approvalBlockers` is not empty.
- `AUDIT_REFUSAL_CODES`: `approval_refused` codes missing, empty, unsorted, duplicated or unknown.
- `AUDIT_SEQ`, `AUDIT_TIME`, `AUDIT_ACTOR_INVALID`, `AUDIT_TYPE_INVALID`: per the table above.
- `COUNTER_INVALID`: a counter below the largest id number of its type.

`validateWorkspace(value)` returns the **sorted list of unique codes**; empty means valid.
Validation never throws. It collects every code it can find, but when the top-level value is not an
object it returns `["NOT_OBJECT"]`; and when `schema` is not 1 it returns `["SCHEMA_VERSION"]` only.
Rules that need a well-formed record (hash, locator, gate) are evaluated only for records whose own
field rules passed, so the result is the same in both implementations.

`parseWorkspaceJson(text)`: text whose UTF-8 encoding is longer than 20,000,000 bytes
returns `["JSON_TOO_LARGE"]`; text that is not valid JSON (`NaN`, `Infinity` and trailing commas are
invalid) returns `["JSON_INVALID"]`; otherwise `validateWorkspace(JSON.parse(text))`.
Import and export are therefore symmetric: what the exporter writes always validates.

## 2. Report (TypeScript only)

`buildReport(workspace, generatedAt)` produces a plain object, serialised as JSON
(`schema: "source-trace.report/1"`) and rendered as Markdown. Contents: disclaimer, workspace name,
generation time, source list (id, title, author, date, provenance, URL, rights, content hash, origin),
claims (id, kind, status, text, review note, evidence with source id, label, passage, offsets, note),
audit trail, heuristic findings (labelled), counts by status. The disclaimer always reads: "Review
record only. Statuses reflect a person's decisions. Nothing here verifies that any claim is true."
Report output is deterministic for the same workspace and `generatedAt`.

## 3. API (backend, loopback only)

Base path `/api`. Every non-2xx response is `{"error": {"code", "message", "details"?}}`.

| Method and path               | Purpose                                                                   |
| ----------------------------- | ------------------------------------------------------------------------- |
| `GET /api/health`             | `{status: "ok", version}`                                                 |
| `GET /api/capabilities`       | PDF limits; AI state (`enabled`, `provider`, `model`, `limits`); storage  |
| `GET /api/workspaces`         | list `{id, name, revision, updatedAt}`                                    |
| `GET /api/workspaces/{id}`    | `{id, revision, updatedAt, workspace}` or 404 `not_found`                 |
| `PUT /api/workspaces/{id}`    | body `{baseRevision: int \| null, workspace}`; saves a validated snapshot |
| `DELETE /api/workspaces/{id}` | removes it (204)                                                          |
| `POST /api/pdf/extract`       | raw `application/pdf` body; returns extracted normalized text             |
| `POST /api/ai/suggest`        | AI suggestions (disabled unless configured **and** opted in per request)  |

`PUT`: `baseRevision` must equal the stored revision (`null` when none exists), otherwise 409
`stale_revision` with `details.currentRevision`. An invalid snapshot is 422 `invalid_workspace` with
`details.codes` (the list from section 1). A valid one is stored and the new revision (previous + 1,
starting at 1) is returned. Ids match `^[A-Za-z0-9_-]{1,64}$`.

`POST /api/pdf/extract` errors: 413 `payload_too_large` (over 5,000,000 bytes), 422 `pdf_invalid`,
`pdf_encrypted`, `pdf_too_many_pages` (over 50 pages), `pdf_no_text`, 408/504-style `pdf_timeout`
(extraction runs in a separate process with a 10 s limit; the process is killed on expiry).

`POST /api/ai/suggest`: requires configured provider **and** header
`X-SourceTrace-AI-Opt-In: session`. Body `{task: "suggest_claims" | "find_evidence", sources:
[{id, title, text}], claimText?}` with at most 5 sources and 60,000 code points of text in total.
Provider output must match the schema `{suggestions: [{claimText, kind, sourceId, start, end, text,
label, rationale}]}`; each suggestion is kept only if `sourceId` is one of the request's ids and
`verifyLocator` succeeds against that source's text for `[start, end)` and `text`; the others are
counted in `meta.rejected`. The response is `{suggestions, meta: {provider, model, promptVersion,
rejected}}` and never contains a status or an approval. Limits: 20 calls per hour per process,
`ai_rate_limited` (429) beyond. Errors: 403 `ai_disabled`, 403 `ai_opt_in_required`,
502 `ai_invalid_output`, 502 `ai_provider_error`.

Hardening (all in the backend): Host header allow-list, strict CORS and an Origin check on writes,
request body cap (6 MB, enforced while streaming), a total deadline of 30 s per request, loopback bind
by default, one error envelope for validation, 404, 405, 413 and unexpected errors.

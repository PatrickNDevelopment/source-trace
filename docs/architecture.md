# Architecture and decisions

Read the specification first: [spec/00-overview.md](spec/00-overview.md) to
[spec/03-workspace-report-api.md](spec/03-workspace-report-api.md). This page records why the
system is shaped the way it is.

## Shape

```
browser (React + TypeScript)                      optional local backend (FastAPI)
  engine: text, hash, locators,    PUT snapshot     validate_workspace (same rules)
          state table, gate,      ------------->    SQLite (versioned migrations)
          checks, report                            PDF extraction (isolated process)
  localStorage workspace          <--- text ------  AI broker (opt-in, schema-validated)
```

## Decisions

1. **One domain engine, in TypeScript.** The static demo must be fully usable, so all review logic
   runs in the browser. The backend does not re-implement features; it re-implements only the part
   it must **enforce** when it stores a snapshot (defence in depth): text rules and hash, locators, the
   transition table, the approval gate and workspace validation (the "shared contract").
2. **Everything duplicated is specified, vectored and fuzzed.** Lesson from the previous project:
   two implementations agreed on 44 hand-written vectors while 212 of 940 random inputs disagreed, and
   two importers outside the vectors disagreed on 426 of 1,210 files. So the shared contract has (a)
   one spec, (b) hand-derived golden vectors with independent hashlib-derived digests, (c) a
   differential fuzz that includes mutated workspaces and the JSON import layer, run in the default
   gate.
3. **The import layer is part of the contract.** `parseWorkspaceJson` and its Python twin reject the
   same inputs for the same reasons (NaN, trailing commas, BOM, lone surrogates, float integers,
   duplicate ids, forged audit trails).
4. **Offsets are Unicode code points.** Not UTF-16 units (the browser's unit) and not bytes (the
   hash's unit). The UI converts and widens a selection so it never splits a surrogate pair.
5. **Source text is immutable.** No source versioning; changed text is a new source, identical text
   is de-duplicated by hash. This removes the whole class of stale-locator updates inside a workspace.
6. **Approval is a gate on review preconditions, not on truth**, and depends only on the claim and its
   sources, so a stored snapshot can be re-checked at any time.
7. **Audit is append-only and user-only.** `actor` is `user` or the snapshot is invalid, so no import
   path can smuggle in an AI-driven transition.
8. **Local-first persistence, optional backend.** One workspace in `localStorage` with corruption
   recovery, a cross-tab warning and a visible save-failure banner; optimistic revisions on the
   backend (`PUT` with `baseRevision`).
9. **PDF extraction runs out of process** (`python -I`, killed on timeout) because the PDF is hostile
   input and the parser is pure Python: a hang or a bomb must not take the API down.
10. **The AI broker has no workspace.** It receives text, returns validated suggestions, and logs
    prompt version and hash, never the key or the source text.
11. **Static hosting friendly**: hash routing, `base: /source-trace/`, no server routes.

## Backend hardening (added up front this time)

Host-header allow-list against DNS rebinding, strict CORS plus an Origin check on writes, a body cap
enforced while streaming, a total per-request deadline, loopback bind by default, one error
envelope for validation, 404, 405, 413, timeouts and unexpected errors, SQLite busy timeout mapped to 503.

## Ports

| Port | Use                                       |
| ---- | ----------------------------------------- |
| 5174 | Vite dev server                           |
| 4175 | Production preview (e2e)                  |
| 8797 | Backend (e2e: AI provider "fake")         |
| 8798 | Second backend in e2e (AI not configured) |

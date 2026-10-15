# Contributing

1. Read `docs/spec` first. Behaviour is defined there; code follows it.
2. `npm ci`, create the backend virtualenv (see README), then run `npm run verify` before you push.
   It runs everything: format, lint, types, unit tests, backend lint/format/types/tests, golden vectors,
   differential fuzz, build, secret scan and end-to-end tests.
3. If you change anything in the **shared contract** (text rules, hashing, locators, transition table,
   approval gate, workspace validation): change the spec, **both** implementations
   (`src/engine/*.ts`, `backend/source_trace/engine/*.py`) and the vectors
   (`contracts/tools/generate_vectors.py`, then re-run it) in one commit, and run
   `npm run fuzz` with a few different `--seed` values.
4. Add a regression test for every bug you fix.
5. Never add a statement to the UI or docs that implies truth was verified.
6. Do not commit proprietary or third-party source texts. Use public domain, licensed or synthetic
   text and label it.

Style: Prettier (`npm run format`), ESLint, strict TypeScript, ruff and strict mypy for Python.

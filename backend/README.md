# SourceTrace backend

Optional, local-only FastAPI service. See `docs/spec/03-workspace-report-api.md` for the API and
`docs/architecture.md` for why it exists.

```powershell
python -m venv ..\.venv
..\.venv\Scripts\python -m pip install -r requirements.lock.txt
..\.venv\Scripts\python -m source_trace          # http://127.0.0.1:8797, docs at /api/docs
```

Settings are `SOURCE_TRACE_*` environment variables (see `../.env.example`). The AI assistant is
disabled unless `SOURCE_TRACE_AI_PROVIDER` is set and, for `anthropic`, `ANTHROPIC_API_KEY` and
`SOURCE_TRACE_AI_MODEL` are present. The provider `fake` exists for tests only.

Checks (from the repository root): `npm run backend:lint`, `backend:format`, `backend:types`,
`backend:test`.

# AI assistance

## In the product

SourceTrace has an **optional** assistant that suggests claim drafts from a source you choose.

- Off by default. Needs `SOURCE_TRACE_AI_PROVIDER=anthropic`, `SOURCE_TRACE_AI_MODEL` and
  `ANTHROPIC_API_KEY` in the **server** environment, and an explicit tick-box in the UI for each
  session. The key is never sent to the browser, logged or returned by the API.
- The only data sent is the text of the sources you select, with the fixed instructions in
  `backend/source_trace/ai.py` (prompt version `st-suggest-1`).
- The answer must match a strict JSON schema. Unknown fields (for example `status` or `approve`)
  invalidate the whole answer. Each suggestion is kept only if it cites a source id from your request
  and a passage that exactly matches that source at the stated offsets.
- Suggestions are plain data. Accepting one creates an ordinary **draft** claim through a user
  action. The assistant cannot approve, reject, edit or verify anything and has no access to your
  workspace.
- Calls are rate limited (default 20 per hour) and logged without secrets or source text (prompt
  hash, version, source ids, counts).
- Automated tests use a deterministic fake provider and a mocked HTTP transport; they never reach a
  network.

## In building it

This repository was written with Anthropic's Claude (through Claude Code) as the implementing
engineer, under a human owner's specification and review. The code, specification, vectors and tests
were generated and then verified by running the commands listed in `docs/test-report.md`; an
independent review pass is recorded there. Treat the behaviour documented there, not this sentence, as
the evidence.

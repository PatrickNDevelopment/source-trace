# Demo walkthroughs

Both use the static app (`npm run dev`, then http://localhost:5174/source-trace/). No backend needed.

## Journey 1: paste, select, claim, contradiction, review, export

1. Sources: title "Lighthouse log (synthetic)", paste a short text, "Add source".
2. Review: click in the source text, hold Shift and use the arrow keys (or drag with the mouse) to
   select a sentence, then "Use selection as passage".
3. Write the claim text, "Create claim". The passage is attached as "Supports".
4. Select a second passage that disagrees, choose label "Contradicts", "Attach passage".
   "Before approval" now lists `CONTRADICTION_PRESENT`.
5. "Send for review", then "Approve". Approval is refused with the reason and the attempt appears in
   the timeline.
6. "Request revision", set the kind to "Disputed assertion", "Send for review again", "Approve".
7. Report: read the preview, download the Markdown and JSON report.

## Journey 2: an unsupported claim

1. Create a claim and attach only a passage labelled "Unknown", or none.
2. "Send for review", then "Approve": refused, with `NO_SUPPORT` (or `NO_EVIDENCE`).
3. The status stays "Needs review"; the timeline shows the refusal; reload the page and it is still
   there. Heuristic checks list `UNSUPPORTED_CLAIM` or `MISSING_SOURCE`, labelled heuristic.

## With the backend

Settings: "Use the backend". Sources then offers "Extract text from a PDF". Settings can save and load
the workspace. With `SOURCE_TRACE_AI_PROVIDER` configured, Review shows the AI panel; it stays inert
until you tick the per-session opt-in.

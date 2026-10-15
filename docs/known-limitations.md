# Known limitations

- **The hosted demo is static.** https://patrickndevelopment.github.io/source-trace/ runs entirely in the browser; PDF import, backend
  storage and the AI assistant need the local backend.
- **No truth verification.** Heuristic checks and the approval gate cannot establish that a claim is
  true, accurate or complete. They flag; a person decides.
- **Heuristics are crude.** Quote and date matching is literal (after collapsing blank runs): a
  paraphrase or a date written in words is not matched, and a year in the claim that merely appears
  somewhere in the passage counts as present. Duplicate detection uses token overlap, not meaning.
- **Text only.** No scanned PDFs or OCR, no images, no tables, no layout. PDF text extraction (pypdf)
  can reorder or merge words in multi-column documents; review the extracted text before adding it.
- **Source text is immutable.** To correct a source, add the corrected text as a new source and
  re-cite; there is no diff or version history of a source.
- **One workspace per browser.** `localStorage` is per browser profile and size-limited (about 5 MB);
  a full store shows a banner and the workspace should be exported. The backend holds one default
  workspace per id with last-writer conflict detection, not merge.
- **No authentication and loopback only** for the backend. Do not expose it on a network.
- **AI assistant:** disabled by default and untested against a live provider in this repository
  (tests use a deterministic fake and a mocked HTTP transport). The model name must be set by the
  operator. Suggestions are only as good as the model; they are filtered for existence and exact
  passage match, not for correctness.
- **Accessibility:** automated checks and keyboard-only selection are tested; there has been no
  screen-reader session, no 200% zoom audit and no automated contrast audit.
- **Browsers:** tested in Microsoft Edge (Chromium) locally and Chromium in CI. Firefox and Safari
  are untested.
- **Platforms:** developed and fully verified on Windows 10 with Python 3.14 and Node 24. CI runs
  on Linux with Python 3.12 (first run passed on 2026-10-15).
- **PDF isolation is process-level only:** no memory limit is applied on Windows. Size, page and time
  caps still bound the work.
- **Audit trail limit:** a claim holds at most 500 audit events (spec 03). At the limit every further
  change to that claim, including another refused approval, is refused with a message; the history is
  kept and a new claim must be created to continue.
- **JSON imports** nest at most 64 levels deep (a real workspace nests 6); deeper files are treated as
  invalid JSON by both engines.
- **Two tabs:** a change saved in another tab is flagged with a banner, but this tab's next change still
  overwrites it (last writer wins in `localStorage`). Reload before continuing.
- **Hosted demo and the local backend:** the backend's default CORS list only allows
  `http://localhost:5174` and `http://localhost:4175`. A page served from another origin (for example a
  future GitHub Pages site) needs `SOURCE_TRACE_CORS_ORIGINS` set before it can write to the backend.

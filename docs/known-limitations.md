# Known limitations

- **Not deployed and not published.** There is no hosted demo. A Pages workflow exists but has not
  been run on a remote.
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
- **Platforms:** developed and fully verified on Windows 10 with Python 3.14 and Node 24. CI targets
  Linux with Python 3.12 (not run on a remote yet).
- **PDF isolation is process-level only:** no memory limit is applied on Windows. Size, page and time
  caps still bound the work.

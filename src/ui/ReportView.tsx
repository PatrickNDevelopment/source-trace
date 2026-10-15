import { useMemo, useRef, useState, type ReactNode } from 'react';
import { buildReport, parseWorkspaceJson, renderMarkdown, type Workspace } from '../engine';
import { downloadText, slug } from '../lib/files';
import { useApp } from './common';

const IMPORT_LIMIT = 20_000_000;

const CODE_HELP: Record<string, string> = {
  JSON_INVALID: 'The file is not valid JSON.',
  JSON_TOO_LARGE: 'The file is larger than 20 MB.',
  NOT_OBJECT: 'The file is JSON but not a SourceTrace workspace.',
  SCHEMA_VERSION: 'This is not a schema 1 SourceTrace workspace.',
  APPROVED_FAILS_GATE: 'A claim is marked approved but does not meet the approval preconditions.',
  AUDIT_ACTOR_INVALID: 'An audit event names an actor other than a user.',
  AUDIT_TRANSITION_INVALID: 'An audit event records a status change the state machine forbids.',
  AUDIT_STATUS_MISMATCH: 'A claim status does not match its audit trail.',
  HASH_MISMATCH: 'A source text does not match its content hash.',
  LOCATOR_INVALID: 'A cited passage does not match its source text.',
  DUPLICATE_ID: 'Two records share an id.',
  DUPLICATE_SOURCE_HASH: 'Two sources have identical text.',
  EVIDENCE_SOURCE_MISSING: 'Evidence cites a source that is not in the file.',
};

export function ReportView(): ReactNode {
  const app = useApp();
  const { ws } = app;
  const [errors, setErrors] = useState<string[]>([]);
  const [candidate, setCandidate] = useState<Workspace | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const stamp = useMemo(() => new Date().toISOString(), []);
  const report = useMemo(() => buildReport(ws, stamp), [ws, stamp]);
  const markdown = useMemo(() => renderMarkdown(report), [report]);

  async function onImport(file: File | undefined): Promise<void> {
    if (!file) return;
    setErrors([]);
    setCandidate(null);
    if (file.size > IMPORT_LIMIT) {
      setErrors(['JSON_TOO_LARGE']);
      return;
    }
    const parsed = parseWorkspaceJson(await file.text());
    if (parsed.ok) setCandidate(parsed.workspace);
    else setErrors(parsed.codes);
  }

  const empty = ws.claims.length === 0;

  return (
    <div className="stack">
      <section className="card" aria-labelledby="exp-h">
        <h2 id="exp-h">Evidence report</h2>
        <p className="help">
          {report.disclaimer} The report lists sources with their content hashes, every claim with
          its exact cited passages and offsets, the full audit trail (including refused approvals)
          and the heuristic flags, labelled as such.
        </p>
        <p>
          {ws.claims.length} claim(s), {ws.sources.length} source(s):{' '}
          {Object.entries(report.counts)
            .filter(([k]) => k !== 'claims' && k !== 'sources')
            .map(([k, v]) => `${k.replace('_', ' ')} ${v}`)
            .join(', ')}
        </p>
        <div className="row">
          <button
            type="button"
            className="primary"
            onClick={() =>
              downloadText(`${slug(ws.name)}-evidence-report.md`, markdown, 'text/markdown')
            }
          >
            Download report (Markdown)
          </button>
          <button
            type="button"
            onClick={() =>
              downloadText(
                `${slug(ws.name)}-evidence-report.json`,
                `${JSON.stringify(report, null, 2)}\n`,
                'application/json',
              )
            }
          >
            Download report (JSON)
          </button>
        </div>
        {empty ? (
          <p className="help">There are no claims yet; the report will be nearly empty.</p>
        ) : null}
        <h3>Markdown preview</h3>
        <pre
          className="preview"
          tabIndex={0}
          aria-label="Markdown report preview"
          data-testid="report-preview"
        >
          {markdown}
        </pre>
      </section>

      <section className="card" aria-labelledby="bk-h">
        <h2 id="bk-h">Workspace backup and restore</h2>
        <p className="help">
          The workspace file contains full source texts and the complete audit trail. Importing
          validates every rule first and replaces the current workspace only after you confirm.
        </p>
        <div className="row">
          <button
            type="button"
            onClick={() =>
              downloadText(
                `${slug(ws.name)}-workspace.json`,
                `${JSON.stringify(ws, null, 2)}\n`,
                'application/json',
              )
            }
          >
            Download workspace (JSON)
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="sr-only-input"
            aria-label="Workspace JSON file to import"
            data-testid="import-file"
            onChange={(e) => {
              void onImport(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <button type="button" onClick={() => fileRef.current?.click()}>
            Import a workspace (JSON)
          </button>
        </div>
        {errors.length > 0 ? (
          <div className="banner banner-error" role="alert" data-testid="import-errors">
            <strong>This file was not imported.</strong>
            <ul>
              {errors.map((c) => (
                <li key={c}>
                  <code>{c}</code>{' '}
                  {CODE_HELP[c] ?? 'A field is missing, has the wrong type or an invalid value.'}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {candidate ? (
          <div className="banner banner-warn" role="group" aria-label="Confirm import">
            <p>
              Valid workspace &ldquo;{candidate.name}&rdquo;: {candidate.sources.length} source(s),{' '}
              {candidate.claims.length} claim(s). Replace the current workspace with it?
            </p>
            <div className="row">
              <button
                type="button"
                className="danger"
                onClick={() => {
                  app.replaceWorkspace(candidate, `Imported workspace "${candidate.name}".`);
                  setCandidate(null);
                }}
              >
                Replace current workspace
              </button>
              <button type="button" onClick={() => setCandidate(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  editSourceMeta,
  importSource,
  newWorkspace,
  type Source,
  type SourceOrigin,
} from '../engine';
import { ApiError, api } from '../lib/api';
import { createSampleWorkspace, isSampleWorkspace } from '../lib/sample';
import { short, useApp } from './common';

const TEXT_FILE_LIMIT = 2_000_000;

export function SourcesView(): ReactNode {
  const app = useApp();
  const { ws, backend } = app;
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [date, setDate] = useState('');
  const [provenance, setProvenance] = useState('');
  const [url, setUrl] = useState('');
  const [rights, setRights] = useState('');
  const [text, setText] = useState('');
  const [origin, setOrigin] = useState<SourceOrigin>('paste');
  const [error, setError] = useState('');
  const [existing, setExisting] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmSample, setConfirmSample] = useState(false);
  const [editing, setEditing] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);

  const pdfAvailable = backend.status === 'online' && backend.caps?.pdf.enabled === true;

  function onSubmit(event: FormEvent): void {
    event.preventDefault();
    setError('');
    setExisting('');
    const result = app.run((w, at) =>
      importSource(w, { title, author, date, provenance, url, rights, origin, rawText: text }, at),
    );
    if (result.ok) {
      app.setSelectedSourceId(result.value);
      app.notify(
        'success',
        `Added source ${result.value}. Its text is stored exactly as imported.`,
      );
      setTitle('');
      setAuthor('');
      setDate('');
      setProvenance('');
      setUrl('');
      setRights('');
      setText('');
      setOrigin('paste');
    } else {
      setError(result.message);
      if (result.existingSourceId) setExisting(result.existingSourceId);
    }
  }

  async function onTextFile(file: File | undefined): Promise<void> {
    if (!file) return;
    setError('');
    if (file.size > TEXT_FILE_LIMIT) {
      setError('That file is larger than 2 MB. Paste or import a shorter text.');
      return;
    }
    try {
      const raw = await file.text();
      setText(raw);
      setOrigin('file');
      if (title.trim() === '') setTitle(file.name.replace(/\.[^.]+$/, ''));
    } catch {
      setError('The file could not be read as text.');
    }
  }

  async function onPdf(file: File | undefined): Promise<void> {
    if (!file) return;
    setError('');
    setBusy(true);
    try {
      const r = await api.extractPdf(backend.url, file);
      setText(r.text);
      setOrigin('pdf');
      if (title.trim() === '') setTitle(file.name.replace(/\.pdf$/i, ''));
      app.notify(
        'info',
        `Extracted ${r.characters.toLocaleString()} characters from ${r.pages} page(s). Review the text before adding it.`,
      );
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function loadSample(): void {
    app.replaceWorkspace(
      createSampleWorkspace(),
      'Loaded the synthetic sample workspace (2 sources, 4 claims).',
    );
    setConfirmSample(false);
  }

  function saveMeta(source: Source, form: FormData): void {
    const patch = {
      title: String(form.get('title') ?? ''),
      author: String(form.get('author') ?? ''),
      date: String(form.get('date') ?? ''),
      provenance: String(form.get('provenance') ?? ''),
      url: String(form.get('url') ?? ''),
      rights: String(form.get('rights') ?? ''),
    };
    const r = app.run((w) => editSourceMeta(w, source.id, patch));
    if (r.ok) {
      setEditing('');
      app.notify('success', `Updated the details of ${source.id}. Its text did not change.`);
    } else {
      app.notify('error', r.message);
    }
  }

  const claimCount = (id: string): number =>
    ws.claims.filter((c) => c.evidence.some((e) => e.sourceId === id)).length;

  return (
    <div className="stack">
      <section aria-labelledby="add-h" className="card">
        <h2 id="add-h">Add a source</h2>
        <p className="help">
          Paste text, load a Markdown or text file, or (with the local backend) extract text from a
          PDF. The text is kept exactly as imported, except that line endings are normalized to LF.
          Use only public domain, licensed, synthetic or your own text.
        </p>
        <form onSubmit={onSubmit} className="form-grid" noValidate>
          <label>
            Title <span className="req">(required)</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          </label>
          <label>
            Author
            <input value={author} onChange={(e) => setAuthor(e.target.value)} maxLength={200} />
          </label>
          <label>
            Date (YYYY-MM-DD)
            <input
              value={date}
              onChange={(e) => setDate(e.target.value)}
              placeholder="2026-01-31"
              inputMode="numeric"
            />
          </label>
          <label>
            Source URL (metadata only; never fetched)
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.org/document"
            />
          </label>
          <label className="wide">
            Provenance (where this text came from)
            <input
              value={provenance}
              onChange={(e) => setProvenance(e.target.value)}
              maxLength={1000}
            />
          </label>
          <label className="wide">
            Rights note
            <input value={rights} onChange={(e) => setRights(e.target.value)} maxLength={1000} />
          </label>
          <label className="wide">
            Source text
            <textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setOrigin('paste');
              }}
              rows={8}
              spellCheck={false}
            />
          </label>
          <div className="wide row">
            <input
              ref={fileRef}
              id="text-file"
              aria-label="Markdown or text file to load"
              type="file"
              accept=".md,.markdown,.txt,text/plain,text/markdown"
              className="sr-only-input"
              onChange={(e) => {
                void onTextFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <button type="button" onClick={() => fileRef.current?.click()}>
              Load a Markdown or text file
            </button>
            <input
              ref={pdfRef}
              id="pdf-file"
              aria-label="PDF file to extract text from"
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only-input"
              onChange={(e) => {
                void onPdf(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              disabled={!pdfAvailable || busy}
              aria-describedby="pdf-help"
              onClick={() => pdfRef.current?.click()}
            >
              {busy ? 'Reading PDF…' : 'Extract text from a PDF'}
            </button>
            <span id="pdf-help" className="help" data-testid="pdf-help">
              {pdfAvailable
                ? `Up to ${((backend.caps?.pdf.maxBytes ?? 0) / 1_000_000).toFixed(0)} MB and ${backend.caps?.pdf.maxPages} pages; text PDFs only (no OCR).`
                : 'PDF import needs the local backend (Settings). It is unavailable in this static demo.'}
            </span>
          </div>
          {error ? (
            <p className="banner banner-error wide" role="alert" data-testid="source-error">
              {error}{' '}
              {existing ? (
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    app.setSelectedSourceId(existing);
                    app.go('review');
                  }}
                >
                  Open the existing source
                </button>
              ) : null}
            </p>
          ) : null}
          <div className="wide row">
            <button type="submit" className="primary">
              Add source
            </button>
            <span className="help">{Array.from(text).length.toLocaleString()} characters</span>
          </div>
        </form>
      </section>

      <section aria-labelledby="list-h" className="card">
        <h2 id="list-h">Sources in this workspace ({ws.sources.length})</h2>
        {ws.sources.length === 0 ? (
          <div className="empty">
            <p>No sources yet. Add one above, or load the synthetic sample to explore.</p>
          </div>
        ) : (
          <ul className="plain-list" data-testid="source-list">
            {ws.sources.map((s) => (
              <li key={s.id} className="list-item" data-testid="source-item">
                <div className="list-head">
                  <strong>
                    {s.id}: {s.title}
                  </strong>
                  <span className="badge">{s.origin}</span>
                </div>
                <p className="meta">
                  {[s.author, s.date, `${Array.from(s.text).length.toLocaleString()} characters`]
                    .filter(Boolean)
                    .join(' · ')}
                  {' · '}hash <code>{s.contentHash.slice(0, 12)}</code> {' · '}cited by{' '}
                  {claimCount(s.id)} claim(s)
                </p>
                {s.provenance ? (
                  <p className="meta">Provenance: {short(s.provenance, 160)}</p>
                ) : null}
                {s.rights ? <p className="meta">Rights: {short(s.rights, 160)}</p> : null}
                {s.url ? <p className="meta">URL (not fetched): {s.url}</p> : null}
                {editing === s.id ? (
                  <form
                    className="form-grid"
                    onSubmit={(e) => {
                      e.preventDefault();
                      saveMeta(s, new FormData(e.currentTarget));
                    }}
                  >
                    <label>
                      Title
                      <input name="title" defaultValue={s.title} />
                    </label>
                    <label>
                      Author
                      <input name="author" defaultValue={s.author} />
                    </label>
                    <label>
                      Date
                      <input name="date" defaultValue={s.date} />
                    </label>
                    <label>
                      URL
                      <input name="url" defaultValue={s.url} />
                    </label>
                    <label className="wide">
                      Provenance
                      <input name="provenance" defaultValue={s.provenance} />
                    </label>
                    <label className="wide">
                      Rights note
                      <input name="rights" defaultValue={s.rights} />
                    </label>
                    <div className="wide row">
                      <button type="submit" className="primary">
                        Save details
                      </button>
                      <button type="button" onClick={() => setEditing('')}>
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="row">
                    <button
                      type="button"
                      onClick={() => {
                        app.setSelectedSourceId(s.id);
                        app.go('review');
                      }}
                    >
                      Open in review
                    </button>
                    <button type="button" onClick={() => setEditing(s.id)}>
                      Edit details
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="sample-h" className="card">
        <h2 id="sample-h">Synthetic sample</h2>
        <p className="help">
          Two short invented texts about a fictional bridge, four claims in different states, and a
          real audit trail. Nothing in it is a real document.
          {isSampleWorkspace(ws) ? ' The sample is currently loaded.' : ''}
        </p>
        {confirmSample ? (
          <div className="row" role="group" aria-label="Confirm loading the sample">
            <span>This replaces the current workspace. Export a backup first if you need it.</span>
            <button type="button" className="danger" onClick={loadSample}>
              Replace with the sample
            </button>
            <button type="button" onClick={() => setConfirmSample(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              if (ws.sources.length === 0 && ws.claims.length === 0) loadSample();
              else setConfirmSample(true);
            }}
          >
            Load sample data
          </button>
        )}
        {ws.sources.length > 0 || ws.claims.length > 0 ? (
          <p className="help">
            <button
              type="button"
              className="link"
              onClick={() =>
                app.replaceWorkspace(newWorkspace('My workspace'), 'Started an empty workspace.')
              }
            >
              Start an empty workspace
            </button>{' '}
            (does not touch your exported files)
          </p>
        ) : null}
      </section>
    </div>
  );
}

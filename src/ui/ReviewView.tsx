import { useMemo, useRef, useState, type ReactNode } from 'react';
import {
  KINDS,
  LABELS,
  STATUSES,
  TRANSITIONS,
  acceptSuggestion,
  addEvidence,
  approvalBlockers,
  createClaim,
  editClaim,
  isContentEditable,
  removeEvidence,
  runChecks,
  setEvidenceLabel,
  setReviewNote,
  transitionClaim,
  verifyLocator,
  type Claim,
  type Kind,
  type Label,
  type Source,
  type Status,
} from '../engine';
import { ApiError, api, type Suggestion } from '../lib/api';
import { codePointToUtf16, selectionAsCodePoints } from '../lib/selection';
import {
  BLOCKER_MESSAGE,
  KIND_LABEL,
  LABEL_TEXT,
  STATUS_LABEL,
  StatusBadge,
  short,
  useApp,
} from './common';

interface Pending {
  sourceId: string;
  start: number;
  end: number;
  text: string;
}

const TRANSITION_BUTTON: Record<string, string> = {
  'draft>needs_review': 'Send for review',
  'needs_review>approved': 'Approve',
  'needs_review>rejected': 'Reject',
  'needs_review>revise': 'Request revision',
  'approved>revise': 'Withdraw approval (revise)',
  'rejected>draft': 'Reopen as draft',
  'revise>needs_review': 'Send for review again',
};

export function ReviewView(): ReactNode {
  const app = useApp();
  const { ws } = app;
  const [pending, setPending] = useState<Pending | null>(null);
  const source = ws.sources.find((s) => s.id === app.selectedSourceId);
  const claim = ws.claims.find((c) => c.id === app.selectedClaimId);

  if (ws.sources.length === 0) {
    return (
      <div className="card empty">
        <h2>Nothing to review yet</h2>
        <p>Add a source first, or load the synthetic sample on the Sources page.</p>
        <button type="button" className="primary" onClick={() => app.go('sources')}>
          Go to Sources
        </button>
      </div>
    );
  }

  return (
    <div className="review-grid">
      <SourcePane
        key={source?.id ?? 'none'}
        source={source}
        claim={claim}
        pending={pending}
        onPending={setPending}
      />
      <ClaimsPane
        source={source}
        claim={claim}
        pending={pending}
        onPendingUsed={() => setPending(null)}
      />
    </div>
  );
}

function SourcePane({
  source,
  claim,
  pending,
  onPending,
}: {
  source: Source | undefined;
  claim: Claim | undefined;
  pending: Pending | null;
  onPending: (p: Pending | null) => void;
}): ReactNode {
  const app = useApp();
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const [message, setMessage] = useState('');

  if (!source) return null;

  const cited = (claim?.evidence ?? []).filter((e) => e.sourceId === source.id);

  function useSelection(): void {
    const el = areaRef.current;
    if (!el || !source) return;
    const sel = selectionAsCodePoints(source.text, el.selectionStart, el.selectionEnd);
    if (sel === null) {
      setMessage(
        'Select some text first: drag with the mouse, or press Shift with the arrow keys inside the text.',
      );
      return;
    }
    const cps = Array.from(source.text).slice(sel.start, sel.end).join('');
    onPending({ sourceId: source.id, start: sel.start, end: sel.end, text: cps });
    setMessage(`Passage selected: characters ${sel.start} to ${sel.end}.`);
  }

  function reveal(start: number, end: number): void {
    const el = areaRef.current;
    if (!el || !source) return;
    el.focus();
    el.setSelectionRange(codePointToUtf16(source.text, start), codePointToUtf16(source.text, end));
  }

  const cps = Array.from(source.text);
  function excerpt(start: number, end: number): ReactNode {
    const a = Math.max(0, start - 40);
    const b = Math.min(cps.length, end + 40);
    return (
      <>
        {a > 0 ? '…' : ''}
        {cps.slice(a, start).join('')}
        <mark>{cps.slice(start, end).join('')}</mark>
        {cps.slice(end, b).join('')}
        {b < cps.length ? '…' : ''}
      </>
    );
  }

  return (
    <section aria-labelledby="src-h" className="card pane">
      <h2 id="src-h">Source</h2>
      <label>
        Source being read
        <select
          value={source.id}
          onChange={(e) => {
            app.setSelectedSourceId(e.target.value);
            onPending(null);
          }}
        >
          {app.ws.sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.id}: {short(s.title, 60)}
            </option>
          ))}
        </select>
      </label>
      <p className="meta">
        {[source.author, source.date, source.origin].filter(Boolean).join(' · ')}
        {source.provenance ? ` · ${short(source.provenance, 100)}` : ''}
      </p>
      <label>
        Source text (read-only)
        <textarea
          ref={areaRef}
          // A true readOnly textarea does not let the keyboard move or extend a selection in all
          // browsers. This one stays navigable and selectable, and every edit is cancelled.
          aria-readonly="true"
          inputMode="none"
          value={source.text}
          onChange={() => undefined}
          onBeforeInput={(e) => e.preventDefault()}
          onPaste={(e) => e.preventDefault()}
          onCut={(e) => e.preventDefault()}
          onDrop={(e) => e.preventDefault()}
          rows={12}
          spellCheck={false}
          aria-describedby="sel-help"
          data-testid="source-text"
        />
      </label>
      <p id="sel-help" className="help">
        Select a passage with the mouse, or click in the text and hold Shift while using the arrow
        keys. Then press &ldquo;Use selection as passage&rdquo;. The text is shown as plain text
        only; markup in a source is never interpreted.
      </p>
      <div className="row">
        <button type="button" className="primary" onClick={useSelection}>
          Use selection as passage
        </button>
        {pending ? (
          <button type="button" onClick={() => onPending(null)}>
            Clear passage
          </button>
        ) : null}
      </div>
      <p role="status" aria-live="polite" className="help" data-testid="selection-status">
        {message}
      </p>
      {pending && pending.sourceId === source.id ? (
        <div className="passage pending" data-testid="pending-passage">
          <strong>Chosen passage</strong> (characters {pending.start} to {pending.end}):
          <blockquote>{excerpt(pending.start, pending.end)}</blockquote>
        </div>
      ) : null}
      <h3>Passages cited by the selected claim</h3>
      {cited.length === 0 ? (
        <p className="help">
          {claim ? 'The selected claim cites nothing in this source.' : 'No claim is selected.'}
        </p>
      ) : (
        <ul className="plain-list">
          {cited.map((e) => (
            <li key={e.id} className={`passage label-${e.label}`}>
              <span className="badge">{LABEL_TEXT[e.label]}</span>{' '}
              <span className="meta">
                {e.id}, characters {e.locator.start} to {e.locator.end}
              </span>
              <blockquote>{excerpt(e.locator.start, e.locator.end)}</blockquote>
              <button type="button" onClick={() => reveal(e.locator.start, e.locator.end)}>
                Select this passage in the text
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ClaimsPane({
  source,
  claim,
  pending,
  onPendingUsed,
}: {
  source: Source | undefined;
  claim: Claim | undefined;
  pending: Pending | null;
  onPendingUsed: () => void;
}): ReactNode {
  const app = useApp();
  const { ws } = app;
  const [text, setText] = useState('');
  const [kind, setKind] = useState<Kind>('factual');
  const [label, setLabel] = useState<Label>('support');
  const [note, setNote] = useState('');
  const [filter, setFilter] = useState<'all' | Status>('all');
  const [error, setError] = useState('');

  const visible = ws.claims.filter((c) => filter === 'all' || c.status === filter);

  function create(): void {
    setError('');
    const created = app.run((w, at) => createClaim(w, { text, kind }, at));
    if (!created.ok) {
      setError(created.message);
      return;
    }
    const id = created.value;
    if (pending) {
      const added = app.run((w, at) =>
        addEvidence(
          w,
          id,
          { sourceId: pending.sourceId, start: pending.start, end: pending.end, label, note },
          at,
        ),
      );
      if (!added.ok) {
        setError(`The claim was created, but the passage could not be attached: ${added.message}`);
      } else {
        onPendingUsed();
      }
    }
    app.setSelectedClaimId(id);
    app.notify(
      'success',
      pending
        ? `Created ${id} as a draft with the chosen passage attached.`
        : `Created ${id} as a draft. Attach a passage before sending it for review.`,
    );
    setText('');
    setNote('');
  }

  return (
    <section aria-labelledby="claims-h" className="card pane">
      <h2 id="claims-h">Claims</h2>

      <form
        className="subcard"
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
        aria-label="New claim"
      >
        <h3>New claim</h3>
        <label>
          Claim text
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            maxLength={2000}
            data-testid="new-claim-text"
          />
        </label>
        <div className="form-grid">
          <label>
            Kind
            <select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Evidence label for the chosen passage
            <select value={label} onChange={(e) => setLabel(e.target.value as Label)}>
              {LABELS.map((l) => (
                <option key={l} value={l}>
                  {LABEL_TEXT[l]}
                </option>
              ))}
            </select>
          </label>
          <label className="wide">
            Evidence note (optional)
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
          </label>
        </div>
        <p className="help" data-testid="pending-summary">
          {pending
            ? `The passage chosen in ${pending.sourceId} (characters ${pending.start} to ${pending.end}) will be attached.`
            : 'No passage chosen yet. You can create the claim now and attach a passage later.'}
        </p>
        {error ? (
          <p className="banner banner-error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className="primary" disabled={text.trim() === ''}>
          Create claim
        </button>
      </form>

      <AiPanel source={source} />

      <div className="row between">
        <h3>All claims ({ws.claims.length})</h3>
        <label className="inline">
          Show
          <select value={filter} onChange={(e) => setFilter(e.target.value as 'all' | Status)}>
            <option value="all">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {visible.length === 0 ? (
        <p className="help">No claims match.</p>
      ) : (
        <ul className="plain-list" data-testid="claim-list">
          {visible.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className={`claim-pick ${c.id === claim?.id ? 'selected' : ''}`}
                aria-pressed={c.id === claim?.id}
                onClick={() => app.setSelectedClaimId(c.id)}
                data-testid="claim-pick"
              >
                <span className="claim-pick-head">
                  <strong>{c.id}</strong> <StatusBadge status={c.status} />
                </span>
                <span>{c.text.trim() === '' ? '(empty claim)' : short(c.text, 110)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {claim ? (
        <ClaimDetail key={claim.id} claim={claim} pending={pending} onPendingUsed={onPendingUsed} />
      ) : (
        <p className="help">Pick a claim above to review it.</p>
      )}
    </section>
  );
}

function ClaimDetail({
  claim,
  pending,
  onPendingUsed,
}: {
  claim: Claim;
  pending: Pending | null;
  onPendingUsed: () => void;
}): ReactNode {
  const app = useApp();
  const { ws } = app;
  const [textDraft, setTextDraft] = useState(claim.text);
  const [noteDraft, setNoteDraft] = useState(claim.reviewNote);
  const [attachLabel, setAttachLabel] = useState<Label>('support');
  const [attachNote, setAttachNote] = useState('');
  const [decisionNote, setDecisionNote] = useState('');
  const [refusal, setRefusal] = useState<string[] | null>(null);

  const editable = isContentEditable(claim.status);
  const sources = useMemo(() => new Map(ws.sources.map((s) => [s.id, s])), [ws.sources]);
  const preview = approvalBlockers(claim, sources);
  const findings = useMemo(
    () => runChecks(ws).filter((f) => f.claimId === claim.id),
    [ws, claim.id],
  );
  const allowed = TRANSITIONS[claim.status];

  function saveText(): void {
    if (textDraft === claim.text) return;
    const r = app.run((w, at) => editClaim(w, claim.id, { text: textDraft }, at));
    if (!r.ok) app.notify('error', r.message);
  }

  function attach(): void {
    if (!pending) return;
    const r = app.run((w, at) =>
      addEvidence(
        w,
        claim.id,
        {
          sourceId: pending.sourceId,
          start: pending.start,
          end: pending.end,
          label: attachLabel,
          note: attachNote,
        },
        at,
      ),
    );
    if (r.ok) {
      onPendingUsed();
      setAttachNote('');
      app.notify(
        'success',
        `Attached the passage to ${claim.id} as ${LABEL_TEXT[attachLabel].toLowerCase()}.`,
      );
    } else {
      app.notify('error', r.message);
    }
  }

  function move(to: Status): void {
    const r = app.run((w, at) => transitionClaim(w, claim.id, to, decisionNote, at));
    if (r.ok) {
      setRefusal(null);
      setDecisionNote('');
      app.notify('success', `${claim.id} is now ${STATUS_LABEL[to].toLowerCase()}.`);
    } else if (r.blockers) {
      setRefusal(r.blockers);
      app.notify(
        'error',
        `Approval refused for ${claim.id}. The attempt was recorded in its audit trail.`,
      );
    } else {
      app.notify('error', r.message);
    }
  }

  return (
    <article className="subcard detail" aria-labelledby="claim-h" data-testid="claim-detail">
      <div className="row between">
        <h3 id="claim-h">
          {claim.id} <StatusBadge status={claim.status} />
        </h3>
        <span className="meta">
          {KIND_LABEL[claim.kind]}
          {claim.origin === 'ai_suggestion' ? ' · started from an AI suggestion' : ''}
        </span>
      </div>

      <label>
        Claim text
        <textarea
          value={textDraft}
          readOnly={!editable}
          rows={3}
          onChange={(e) => setTextDraft(e.target.value)}
          onBlur={saveText}
        />
      </label>
      <label>
        Kind
        <select
          value={claim.kind}
          disabled={!editable}
          onChange={(e) => {
            const kindValue = e.target.value as Kind;
            const r = app.run((w, at) => editClaim(w, claim.id, { kind: kindValue }, at));
            if (!r.ok) app.notify('error', r.message);
          }}
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      {!editable ? (
        <p className="help">
          {`Text, kind and evidence are locked while the status is “${STATUS_LABEL[claim.status]}”.`}
          {claim.status === 'needs_review' || claim.status === 'approved'
            ? ' Request a revision to edit it.'
            : ' Reopen it as a draft to edit it.'}
        </p>
      ) : null}

      <h4>Evidence ({claim.evidence.length})</h4>
      {claim.evidence.length === 0 ? (
        <p className="help">No evidence attached.</p>
      ) : (
        <ul className="plain-list" data-testid="evidence-list">
          {claim.evidence.map((e) => {
            const src = sources.get(e.sourceId);
            const code = src ? verifyLocator(src.text, e.locator) : 'SOURCE_MISSING';
            return (
              <li key={e.id} className={`passage label-${e.label}`} data-testid="evidence-item">
                <div className="row between">
                  <span className="meta">
                    {e.id} in {e.sourceId}
                    {src ? ` (${short(src.title, 40)})` : ''}, characters {e.locator.start} to{' '}
                    {e.locator.end}
                  </span>
                  <span className={`badge ${code === 'OK' ? 'ok' : 'bad'}`}>
                    {code === 'OK' ? 'Matches source' : `Locator problem: ${code}`}
                  </span>
                </div>
                <blockquote>{e.locator.text}</blockquote>
                {e.note ? <p className="meta">Note: {e.note}</p> : null}
                <div className="row">
                  <label className="inline">
                    Label
                    <select
                      value={e.label}
                      disabled={!editable}
                      onChange={(ev) => {
                        const next = ev.target.value as Label;
                        const r = app.run((w, at) => setEvidenceLabel(w, claim.id, e.id, next, at));
                        if (!r.ok) app.notify('error', r.message);
                      }}
                    >
                      {LABELS.map((l) => (
                        <option key={l} value={l}>
                          {LABEL_TEXT[l]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    disabled={!editable}
                    onClick={() => {
                      const r = app.run((w, at) => removeEvidence(w, claim.id, e.id, at));
                      if (!r.ok) app.notify('error', r.message);
                    }}
                  >
                    Remove
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {editable ? (
        <div className="subcard">
          <h4>Attach the chosen passage</h4>
          {pending ? (
            <>
              <p className="help">
                {pending.sourceId}, characters {pending.start} to {pending.end}:{' '}
                {short(pending.text, 80)}
              </p>
              <div className="form-grid">
                <label>
                  Label
                  <select
                    value={attachLabel}
                    onChange={(e) => setAttachLabel(e.target.value as Label)}
                  >
                    {LABELS.map((l) => (
                      <option key={l} value={l}>
                        {LABEL_TEXT[l]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Note (optional)
                  <input value={attachNote} onChange={(e) => setAttachNote(e.target.value)} />
                </label>
              </div>
              <button type="button" className="primary" onClick={attach}>
                Attach passage to {claim.id}
              </button>
            </>
          ) : (
            <p className="help">
              Choose a passage in the source text first (&ldquo;Use selection as passage&rdquo;).
            </p>
          )}
        </div>
      ) : null}

      <h4>Before approval</h4>
      {preview.length === 0 ? (
        <p className="help" data-testid="gate-clear">
          The review preconditions are met. This does not say the claim is true.
        </p>
      ) : (
        <ul className="warn-list" data-testid="gate-blockers">
          {preview.map((b) => (
            <li key={b}>
              <code>{b}</code> {BLOCKER_MESSAGE[b]}
            </li>
          ))}
        </ul>
      )}

      <h4>Heuristic checks</h4>
      <p className="help">
        Heuristics flag things worth a look. They are not proof and never block anything.
      </p>
      {findings.length === 0 ? (
        <p className="help">No heuristic flags for this claim.</p>
      ) : (
        <ul className="plain-list" data-testid="findings">
          {findings.map((f, i) => (
            <li key={`${f.code}-${f.evidenceId ?? ''}-${i}`} className="finding">
              <span className="badge">{f.severity}</span> <code>{f.code}</code> {f.message}
              <span className="meta"> (heuristic)</span>
            </li>
          ))}
        </ul>
      )}

      <h4>Review</h4>
      <label>
        Review note
        <textarea
          value={noteDraft}
          rows={2}
          onChange={(e) => setNoteDraft(e.target.value)}
          onBlur={() => {
            if (noteDraft !== claim.reviewNote) {
              const r = app.run((w, at) => setReviewNote(w, claim.id, noteDraft, at));
              if (!r.ok) app.notify('error', r.message);
            }
          }}
        />
      </label>
      <label>
        Note for this decision (recorded in the audit trail)
        <input
          value={decisionNote}
          onChange={(e) => setDecisionNote(e.target.value)}
          maxLength={1000}
        />
      </label>
      <div className="row" role="group" aria-label="Status actions">
        {allowed.map((to) => (
          <button
            key={to}
            type="button"
            className={to === 'approved' ? 'primary' : ''}
            onClick={() => move(to)}
            data-testid={`move-${to}`}
          >
            {TRANSITION_BUTTON[`${claim.status}>${to}`] ?? STATUS_LABEL[to]}
          </button>
        ))}
      </div>
      {refusal ? (
        <div className="banner banner-error" role="alert" data-testid="refusal">
          <strong>Approval refused.</strong> The attempt was written to the audit trail. Fix the
          following, then try again:
          <ul>
            {refusal.map((b) => (
              <li key={b}>
                <code>{b}</code> {BLOCKER_MESSAGE[b as keyof typeof BLOCKER_MESSAGE]}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <h4>Status timeline (audit trail, append-only)</h4>
      <ol className="timeline" data-testid="audit">
        {claim.audit.map((a) => (
          <li key={a.seq} className={a.type === 'approval_refused' ? 'refused' : ''}>
            <time dateTime={a.at}>{a.at.replace('T', ' ').replace('Z', ' UTC')}</time>{' '}
            <strong>{a.type.replace(/_/g, ' ')}</strong>
            {a.from ? ` ${STATUS_LABEL[a.from]} → ${a.to ? STATUS_LABEL[a.to] : ''}` : ''}
            {a.codes ? ` blocked by ${a.codes.join(', ')}` : ''}
            {a.note ? `: ${a.note}` : ''}
            <span className="meta"> by user</span>
          </li>
        ))}
      </ol>
    </article>
  );
}

function AiPanel({ source }: { source: Source | undefined }): ReactNode {
  const app = useApp();
  const { backend } = app;
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [meta, setMeta] = useState('');
  const [error, setError] = useState('');

  const aiOn = backend.status === 'online' && backend.caps?.ai.enabled === true;

  async function ask(): Promise<void> {
    if (!source) return;
    setBusy(true);
    setError('');
    setSuggestions([]);
    try {
      const r = await api.suggest(backend.url, {
        task: 'suggest_claims',
        sources: [{ id: source.id, title: source.title, text: source.text }],
      });
      setSuggestions(r.suggestions);
      setMeta(
        `${r.suggestions.length} suggestion(s) from ${r.meta.provider} (${r.meta.model}), prompt ${r.meta.promptVersion}` +
          (r.meta.rejected > 0
            ? `; ${r.meta.rejected} discarded because they did not match the source.`
            : '.'),
      );
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="subcard" aria-labelledby="ai-h">
      <h3 id="ai-h">AI suggestions (optional)</h3>
      {!aiOn ? (
        <p className="help" data-testid="ai-disabled">
          {backend.status === 'online'
            ? 'The connected backend has no AI provider configured. Manual review works fully without one.'
            : 'The AI assistant needs the local backend and a configured provider. It is off in this static demo. Manual review works fully without it.'}
        </p>
      ) : (
        <>
          <p className="help">
            Suggestions are drafts for a person to accept or ignore. They cannot approve anything or
            change a status, and nothing they say verifies a claim.
          </p>
          <label className="inline">
            <input
              type="checkbox"
              checked={backend.aiOptIn}
              onChange={(e) => backend.setAiOptIn(e.target.checked)}
            />
            Allow AI suggestions for this session (sends the selected source text to{' '}
            {backend.caps?.ai.provider})
          </label>
          <div className="row">
            <button
              type="button"
              disabled={!backend.aiOptIn || busy || !source}
              onClick={() => void ask()}
            >
              {busy ? 'Asking…' : 'Suggest claims from this source'}
            </button>
          </div>
          {error ? (
            <p className="banner banner-error" role="alert">
              {error}
            </p>
          ) : null}
          {meta ? <p className="help">{meta}</p> : null}
          <ul className="plain-list" data-testid="suggestions">
            {suggestions.map((s, i) => (
              <li key={i} className="passage">
                <p>
                  <strong>{s.claimText}</strong>
                </p>
                <p className="meta">
                  {KIND_LABEL[s.kind]} · {LABEL_TEXT[s.label]} · {s.sourceId}, characters {s.start}{' '}
                  to {s.end}
                </p>
                <blockquote>{s.text}</blockquote>
                <p className="meta">Rationale from the assistant: {s.rationale}</p>
                <button
                  type="button"
                  onClick={() => {
                    const r = app.run((w, at) => acceptSuggestion(w, s, at));
                    if (r.ok) {
                      app.setSelectedClaimId(r.value);
                      setSuggestions((cur) => cur.filter((_, k) => k !== i));
                      app.notify(
                        'success',
                        `Added ${r.value} as a draft. You still decide everything else.`,
                      );
                    } else {
                      app.notify('error', r.message);
                    }
                  }}
                >
                  Add as a draft claim
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

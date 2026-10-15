/**
 * Workspace operations. Every function is pure: it returns a new workspace and never mutates its
 * input. Every user action that changes a claim appends an audit event; a refused approval is
 * recorded and the status is left alone (spec 02 §1). After any sequence of these operations the
 * workspace passes `validateWorkspace` (tests/ops.test.ts checks that with random sequences).
 */
import { buildLocator } from './locator';
import { approvalBlockers, canTransition, isContentEditable } from './state';
import { contentHash } from './locator';
import { isBlank, normalizeText, textProblems, trimBlank } from './text';
import { isRealDate } from './workspace';
import {
  KINDS,
  LABELS,
  LIMITS,
  type AuditEvent,
  type BlockerCode,
  type Claim,
  type Evidence,
  type Kind,
  type Label,
  type Source,
  type SourceOrigin,
  type Status,
  type Workspace,
} from './types';

export type OpFailure = {
  ok: false;
  /** The workspace to keep. Equal to the input except after a recorded refused approval. */
  workspace: Workspace;
  code: string;
  message: string;
  blockers?: BlockerCode[];
  existingSourceId?: string;
};
export type OpSuccess<T = undefined> = { ok: true; workspace: Workspace; value: T };
export type OpResult<T = undefined> = OpSuccess<T> | OpFailure;

const NIL = undefined;

export function newWorkspace(name = 'Untitled workspace'): Workspace {
  return {
    schema: 1,
    name,
    counters: { source: 0, claim: 0, evidence: 0 },
    sources: [],
    claims: [],
  };
}

function fail(
  workspace: Workspace,
  code: string,
  message: string,
  extra: Partial<OpFailure> = {},
): OpFailure {
  return { ok: false, workspace, code, message, ...extra };
}

function maxIso(a: string, b: string): string {
  return a >= b ? a : b;
}

function lastAt(claim: Claim): string {
  return claim.audit.length > 0 ? (claim.audit[claim.audit.length - 1] as AuditEvent).at : '';
}

/** A timestamp that never goes backwards within a claim's audit trail. */
function stampFor(claim: Claim, at: string): string {
  return maxIso(at, lastAt(claim));
}

function withEvent(
  claim: Claim,
  at: string,
  event: Omit<AuditEvent, 'seq' | 'at' | 'actor'>,
): Claim {
  const when = stampFor(claim, at);
  const full: AuditEvent = { seq: claim.audit.length + 1, at: when, actor: 'user', ...event };
  return { ...claim, audit: [...claim.audit, full], updatedAt: when };
}

function replaceClaim(ws: Workspace, claim: Claim): Workspace {
  return { ...ws, claims: ws.claims.map((c) => (c.id === claim.id ? claim : c)) };
}

function findClaim(ws: Workspace, id: string): Claim | undefined {
  return ws.claims.find((c) => c.id === id);
}

export interface SourceInput {
  title: string;
  author?: string;
  date?: string;
  provenance?: string;
  url?: string;
  rights?: string;
  origin: SourceOrigin;
  rawText: string;
}

const META_LIMITS = { title: 200, author: 200, provenance: 1000, rights: 1000, url: 2000 } as const;

export function sourceMetaProblems(m: {
  title: string;
  author: string;
  date: string;
  provenance: string;
  url: string;
  rights: string;
}): string[] {
  const problems: string[] = [];
  const len = (s: string) => Array.from(s).length;
  if (isBlank(m.title)) problems.push('A title is required.');
  if (len(m.title) > META_LIMITS.title) problems.push('Title is longer than 200 characters.');
  if (len(m.author) > META_LIMITS.author) problems.push('Author is longer than 200 characters.');
  if (m.date !== '' && !isRealDate(m.date)) problems.push('Date must be a real date, YYYY-MM-DD.');
  if (len(m.provenance) > META_LIMITS.provenance)
    problems.push('Provenance is longer than 1000 characters.');
  if (len(m.rights) > META_LIMITS.rights)
    problems.push('Rights note is longer than 1000 characters.');
  if (m.url !== '' && !/^https?:\/\//.test(m.url))
    problems.push('URL must start with http:// or https://.');
  if (len(m.url) > META_LIMITS.url) problems.push('URL is longer than 2000 characters.');
  return problems;
}

const TEXT_PROBLEM_MESSAGES: Record<string, string> = {
  TEXT_EMPTY: 'The source text is empty.',
  TEXT_TOO_LONG: 'The source text is longer than 500,000 characters.',
  TEXT_CONTAINS_NUL: 'The source text contains a NUL character.',
  TEXT_INVALID_UNICODE: 'The source text contains invalid Unicode.',
  TEXT_NOT_NORMALIZED: 'The source text could not be normalized.',
};

export function importSource(ws: Workspace, input: SourceInput, at: string): OpResult<string> {
  const meta = {
    title: trimBlank(input.title),
    author: trimBlank(input.author ?? ''),
    date: (input.date ?? '').trim(),
    provenance: trimBlank(input.provenance ?? ''),
    url: (input.url ?? '').trim(),
    rights: trimBlank(input.rights ?? ''),
  };
  const metaProblems = sourceMetaProblems(meta);
  if (metaProblems.length > 0) return fail(ws, 'INVALID_SOURCE', metaProblems.join(' '));
  const text = normalizeText(input.rawText);
  const problems = textProblems(text);
  if (problems.length > 0) {
    const message = problems.map((p) => TEXT_PROBLEM_MESSAGES[p] ?? p).join(' ');
    return fail(ws, problems[0] ?? 'INVALID_SOURCE', message);
  }
  if (ws.sources.length >= LIMITS.sources) {
    return fail(ws, 'LIMIT_EXCEEDED', 'This workspace already holds 200 sources.');
  }
  const hash = contentHash(text);
  const existing = ws.sources.find((s) => s.contentHash === hash);
  if (existing !== undefined) {
    return fail(
      ws,
      'DUPLICATE_SOURCE',
      `This text is already in the workspace as "${existing.title}" (${existing.id}).`,
      { existingSourceId: existing.id },
    );
  }
  const id = `s_${ws.counters.source + 1}`;
  const source: Source = {
    id,
    ...meta,
    origin: input.origin,
    text,
    contentHash: hash,
    createdAt: at,
  };
  return {
    ok: true,
    value: id,
    workspace: {
      ...ws,
      counters: { ...ws.counters, source: ws.counters.source + 1 },
      sources: [...ws.sources, source],
    },
  };
}

export function editSourceMeta(
  ws: Workspace,
  sourceId: string,
  patch: Partial<Pick<Source, 'title' | 'author' | 'date' | 'provenance' | 'url' | 'rights'>>,
): OpResult {
  const current = ws.sources.find((s) => s.id === sourceId);
  if (current === undefined) return fail(ws, 'NOT_FOUND', 'That source does not exist.');
  const next = { ...current, ...patch };
  const problems = sourceMetaProblems(next);
  if (problems.length > 0) return fail(ws, 'INVALID_SOURCE', problems.join(' '));
  return {
    ok: true,
    value: NIL,
    workspace: { ...ws, sources: ws.sources.map((s) => (s.id === sourceId ? next : s)) },
  };
}

export function createClaim(
  ws: Workspace,
  input: { text: string; kind: Kind; origin?: Claim['origin'] },
  at: string,
): OpResult<string> {
  if (ws.claims.length >= LIMITS.claims) {
    return fail(ws, 'LIMIT_EXCEEDED', 'This workspace already holds 2000 claims.');
  }
  if (!(KINDS as readonly string[]).includes(input.kind)) {
    return fail(ws, 'INVALID_CLAIM', 'Unknown claim kind.');
  }
  if (Array.from(input.text).length > 2000) {
    return fail(ws, 'INVALID_CLAIM', 'A claim is limited to 2000 characters.');
  }
  const id = `c_${ws.counters.claim + 1}`;
  const claim: Claim = {
    id,
    text: input.text,
    kind: input.kind,
    status: 'draft',
    evidence: [],
    reviewNote: '',
    audit: [{ seq: 1, at, actor: 'user', type: 'created', note: '' }],
    origin: input.origin ?? 'manual',
    createdAt: at,
    updatedAt: at,
  };
  return {
    ok: true,
    value: id,
    workspace: {
      ...ws,
      counters: { ...ws.counters, claim: ws.counters.claim + 1 },
      claims: [...ws.claims, claim],
    },
  };
}

export function editClaim(
  ws: Workspace,
  claimId: string,
  patch: { text?: string; kind?: Kind },
  at: string,
): OpResult {
  const claim = findClaim(ws, claimId);
  if (claim === undefined) return fail(ws, 'NOT_FOUND', 'That claim does not exist.');
  if (!isContentEditable(claim.status)) {
    return fail(
      ws,
      'NOT_EDITABLE',
      'A claim can be edited only while it is a draft or marked revise.',
    );
  }
  const text = patch.text ?? claim.text;
  const kind = patch.kind ?? claim.kind;
  if (Array.from(text).length > 2000)
    return fail(ws, 'INVALID_CLAIM', 'A claim is limited to 2000 characters.');
  if (!(KINDS as readonly string[]).includes(kind))
    return fail(ws, 'INVALID_CLAIM', 'Unknown claim kind.');
  if (text === claim.text && kind === claim.kind) return { ok: true, value: NIL, workspace: ws };
  const changed: string[] = [];
  if (text !== claim.text) changed.push('text');
  if (kind !== claim.kind) changed.push(`kind ${claim.kind} to ${kind}`);
  const next = withEvent({ ...claim, text, kind }, at, {
    type: 'edited',
    note: changed.join(', '),
  });
  return { ok: true, value: NIL, workspace: replaceClaim(ws, next) };
}

export function addEvidence(
  ws: Workspace,
  claimId: string,
  input: { sourceId: string; start: number; end: number; label: Label; note?: string },
  at: string,
): OpResult<string> {
  const claim = findClaim(ws, claimId);
  if (claim === undefined) return fail(ws, 'NOT_FOUND', 'That claim does not exist.');
  if (!isContentEditable(claim.status)) {
    return fail(
      ws,
      'NOT_EDITABLE',
      'Evidence can be changed only while the claim is a draft or marked revise.',
    );
  }
  const source = ws.sources.find((s) => s.id === input.sourceId);
  if (source === undefined) return fail(ws, 'NOT_FOUND', 'That source does not exist.');
  if (!(LABELS as readonly string[]).includes(input.label)) {
    return fail(ws, 'INVALID_EVIDENCE', 'Unknown evidence label.');
  }
  if (claim.evidence.length >= LIMITS.evidencePerClaim) {
    return fail(ws, 'LIMIT_EXCEEDED', 'A claim can hold at most 50 pieces of evidence.');
  }
  const note = input.note ?? '';
  if (Array.from(note).length > 1000)
    return fail(ws, 'INVALID_EVIDENCE', 'Evidence notes are limited to 1000 characters.');
  const built = buildLocator(source.text, input.start, input.end);
  if (!built.ok) {
    return fail(
      ws,
      built.code,
      built.code === 'LOC_TOO_LONG'
        ? 'A cited passage is limited to 5,000 characters.'
        : 'Select a non-empty passage inside the source text.',
    );
  }
  const id = `e_${ws.counters.evidence + 1}`;
  const ev: Evidence = {
    id,
    sourceId: source.id,
    locator: built.locator,
    label: input.label,
    note,
  };
  const next = withEvent({ ...claim, evidence: [...claim.evidence, ev] }, at, {
    type: 'evidence_added',
    note: `${id} ${input.label} ${source.id}[${input.start},${input.end})`,
  });
  return {
    ok: true,
    value: id,
    workspace: {
      ...replaceClaim(ws, next),
      counters: { ...ws.counters, evidence: ws.counters.evidence + 1 },
    },
  };
}

export function removeEvidence(
  ws: Workspace,
  claimId: string,
  evidenceId: string,
  at: string,
): OpResult {
  const claim = findClaim(ws, claimId);
  if (claim === undefined) return fail(ws, 'NOT_FOUND', 'That claim does not exist.');
  if (!isContentEditable(claim.status)) {
    return fail(
      ws,
      'NOT_EDITABLE',
      'Evidence can be changed only while the claim is a draft or marked revise.',
    );
  }
  if (!claim.evidence.some((e) => e.id === evidenceId))
    return fail(ws, 'NOT_FOUND', 'That evidence does not exist.');
  const next = withEvent(
    { ...claim, evidence: claim.evidence.filter((e) => e.id !== evidenceId) },
    at,
    {
      type: 'evidence_removed',
      note: evidenceId,
    },
  );
  return { ok: true, value: NIL, workspace: replaceClaim(ws, next) };
}

export function setEvidenceLabel(
  ws: Workspace,
  claimId: string,
  evidenceId: string,
  label: Label,
  at: string,
): OpResult {
  const claim = findClaim(ws, claimId);
  if (claim === undefined) return fail(ws, 'NOT_FOUND', 'That claim does not exist.');
  if (!isContentEditable(claim.status)) {
    return fail(
      ws,
      'NOT_EDITABLE',
      'Evidence can be changed only while the claim is a draft or marked revise.',
    );
  }
  const ev = claim.evidence.find((e) => e.id === evidenceId);
  if (ev === undefined) return fail(ws, 'NOT_FOUND', 'That evidence does not exist.');
  if (!(LABELS as readonly string[]).includes(label))
    return fail(ws, 'INVALID_EVIDENCE', 'Unknown evidence label.');
  if (ev.label === label) return { ok: true, value: NIL, workspace: ws };
  const next = withEvent(
    { ...claim, evidence: claim.evidence.map((e) => (e.id === evidenceId ? { ...e, label } : e)) },
    at,
    { type: 'evidence_labeled', note: `${evidenceId} ${ev.label} to ${label}` },
  );
  return { ok: true, value: NIL, workspace: replaceClaim(ws, next) };
}

export function setReviewNote(ws: Workspace, claimId: string, note: string, at: string): OpResult {
  const claim = findClaim(ws, claimId);
  if (claim === undefined) return fail(ws, 'NOT_FOUND', 'That claim does not exist.');
  if (Array.from(note).length > 2000)
    return fail(ws, 'INVALID_CLAIM', 'Review notes are limited to 2000 characters.');
  if (note === claim.reviewNote) return { ok: true, value: NIL, workspace: ws };
  const next = withEvent({ ...claim, reviewNote: note }, at, { type: 'note', note: '' });
  return { ok: true, value: NIL, workspace: replaceClaim(ws, next) };
}

/**
 * The only way a status changes. `to: "approved"` runs the gate; when it blocks, the attempt is
 * recorded as `approval_refused` and the failure carries the precise blocker codes.
 */
export function transitionClaim(
  ws: Workspace,
  claimId: string,
  to: Status,
  note: string,
  at: string,
): OpResult<Status> {
  const claim = findClaim(ws, claimId);
  if (claim === undefined) return fail(ws, 'NOT_FOUND', 'That claim does not exist.');
  if (Array.from(note).length > 1000)
    return fail(ws, 'INVALID_CLAIM', 'Notes are limited to 1000 characters.');
  if (!canTransition(claim.status, to)) {
    return fail(ws, 'ILLEGAL_TRANSITION', `A claim cannot go from ${claim.status} to ${to}.`);
  }
  if (to === 'approved') {
    const sources = new Map(ws.sources.map((s) => [s.id, s]));
    const blockers = approvalBlockers(claim, sources);
    if (blockers.length > 0) {
      const refused = withEvent(claim, at, { type: 'approval_refused', note, codes: blockers });
      return fail(
        replaceClaim(ws, refused),
        'APPROVAL_REFUSED',
        'This claim cannot be approved yet.',
        {
          blockers,
        },
      );
    }
  }
  const next = withEvent({ ...claim, status: to }, at, {
    type: 'transition',
    note,
    from: claim.status,
    to,
  });
  return { ok: true, value: to, workspace: replaceClaim(ws, next) };
}

/** A suggestion the user chose to accept. It becomes an ordinary draft claim with one evidence. */
export interface AcceptedSuggestion {
  claimText: string;
  kind: Kind;
  sourceId: string;
  start: number;
  end: number;
  text: string;
  label: Label;
}

export function acceptSuggestion(
  ws: Workspace,
  s: AcceptedSuggestion,
  at: string,
): OpResult<string> {
  const source = ws.sources.find((x) => x.id === s.sourceId);
  if (source === undefined)
    return fail(ws, 'NOT_FOUND', 'That suggestion cites a source that is not in the workspace.');
  const built = buildLocator(source.text, s.start, s.end);
  if (!built.ok || built.locator.text !== s.text) {
    return fail(ws, 'LOCATOR_MISMATCH', 'The suggested passage does not match the source text.');
  }
  const created = createClaim(ws, { text: s.claimText, kind: s.kind, origin: 'ai_suggestion' }, at);
  if (!created.ok) return created;
  const withEv = addEvidence(
    created.workspace,
    created.value,
    {
      sourceId: s.sourceId,
      start: s.start,
      end: s.end,
      label: s.label,
      note: 'Suggested by the AI assistant; accepted by the user.',
    },
    at,
  );
  if (!withEv.ok) return fail(ws, withEv.code, withEv.message);
  return { ok: true, value: created.value, workspace: withEv.workspace };
}

import { describe, expect, it } from 'vitest';
import {
  addEvidence,
  buildReport,
  comparisonForm,
  createClaim,
  datesIn,
  importSource,
  jaccard,
  newWorkspace,
  quotedSpans,
  renderMarkdown,
  runChecks,
  transitionClaim,
  validateWorkspace,
  type Workspace,
} from '../src/engine';

const AT = '2026-10-15T12:00:00.000Z';

describe('heuristic helpers', () => {
  it('extracts quotes and dates', () => {
    expect(quotedSpans('He said "hello there" and “farewell”')).toEqual([
      'hello there',
      'farewell',
    ]);
    expect(quotedSpans('"ab"')).toEqual([]);
    expect(datesIn('In 1932 and 2024-06-01, not 12345 or 3000')).toEqual(['2024-06-01', '1932']);
  });
  it('comparison form and jaccard', () => {
    expect(comparisonForm('  Hello,   WORLD! ')).toBe('hello world');
    expect(jaccard(new Set(['a', 'b']), new Set(['b', 'c']))).toBeCloseTo(1 / 3);
    expect(jaccard(new Set(), new Set())).toBe(0);
  });
});

function fixture(): { ws: Workspace; sid: string } {
  const s = importSource(
    newWorkspace('Check me'),
    { title: 'A', origin: 'paste', rawText: 'The tower was finished in 1889 by a team.' },
    AT,
  );
  if (!s.ok) throw new Error('source');
  return { ws: s.workspace, sid: s.value };
}

function claim(ws: Workspace, text: string): { ws: Workspace; id: string } {
  const c = createClaim(ws, { text, kind: 'factual' }, AT);
  if (!c.ok) throw new Error('claim');
  return { ws: c.workspace, id: c.value };
}

describe('runChecks', () => {
  it('flags missing sources, unsupported, dates, quotes and duplicates', () => {
    const f = fixture();
    const a = claim(f.ws, 'The tower was finished in 1890, "completed by a crew".');
    const b = claim(a.ws, 'The tower was finished in 1890, completed by a crew');
    const c = claim(b.ws, 'Unrelated.');
    const ev = addEvidence(
      c.ws,
      a.id,
      { sourceId: f.sid, start: 0, end: 41, label: 'unknown' },
      AT,
    );
    if (!ev.ok) throw new Error('ev');
    const found = runChecks(ev.workspace);
    const codes = found.map((x) => `${x.claimId}:${x.code}`);
    expect(codes).toContain('c_1:UNSUPPORTED_CLAIM');
    expect(codes).toContain('c_1:DATE_NOT_IN_PASSAGE');
    expect(codes).toContain('c_1:QUOTE_NOT_IN_PASSAGE');
    expect(codes).toContain('c_1:DUPLICATE_CLAIM');
    expect(codes).toContain('c_2:MISSING_SOURCE');
    expect(codes).toContain('c_3:MISSING_SOURCE');
    expect(codes).toContain('c_1:SOURCE_DATE_MISSING');
    expect(found.every((x) => x.heuristic)).toBe(true);
  });
  it('is silent about a well-cited claim', () => {
    const f = fixture();
    const a = claim(f.ws, 'The tower was finished in 1889.');
    const ev = addEvidence(
      a.ws,
      a.id,
      { sourceId: f.sid, start: 0, end: 41, label: 'support' },
      AT,
    );
    if (!ev.ok) throw new Error('ev');
    expect(runChecks(ev.workspace).filter((x) => x.severity === 'warning')).toEqual([]);
  });
});

describe('report', () => {
  it('is deterministic, labelled, and never claims verification', () => {
    const f = fixture();
    const a = claim(f.ws, 'Claim <script>alert(1)</script> with `markup` and # heading');
    const ev = addEvidence(
      a.ws,
      a.id,
      { sourceId: f.sid, start: 0, end: 10, label: 'support' },
      AT,
    );
    if (!ev.ok) throw new Error('ev');
    const r0 = transitionClaim(ev.workspace, a.id, 'needs_review', '', AT);
    if (!r0.ok) throw new Error('r0');
    const approved = transitionClaim(r0.workspace, a.id, 'approved', 'ok', AT);
    expect(approved.ok).toBe(true);
    const back = transitionClaim(approved.workspace, a.id, 'revise', '', AT);
    expect(back.ok).toBe(true);
    const refused = transitionClaim(back.workspace, a.id, 'approved', 'too early', AT);
    expect(refused.ok).toBe(false);
    const ws = refused.workspace;
    expect(validateWorkspace(ws)).toEqual([]);
    const r1 = buildReport(ws, AT);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(buildReport(ws, AT)));
    expect(r1.disclaimer).toMatch(/Nothing here verifies/);
    const md = renderMarkdown(r1);
    expect(md).toMatch(/Nothing here verifies that any claim is true/);
    expect(md).toContain('> Claim <script>alert(1)</script>');
    expect(md.split('\n').every((l) => !l.startsWith('<script'))).toBe(true);
  });
});

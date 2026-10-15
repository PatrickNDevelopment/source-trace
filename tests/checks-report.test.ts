import { describe, expect, it } from 'vitest';
import {
  addEvidence,
  buildReport,
  comparisonForm,
  createClaim,
  datesIn,
  fence,
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
    // Lengths are code points: two emoji (four UTF-16 units) are too short, 300 emoji fit.
    expect(quotedSpans('"\u{1F600}\u{1F600}"')).toEqual([]);
    expect(quotedSpans(`"${'\u{1F600}'.repeat(300)}"`)).toHaveLength(1);
    expect(quotedSpans(`"${'\u{1F600}'.repeat(301)}"`)).toEqual([]);
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
    // The claim text sits in a fenced code block, where HTML and Markdown are never rendered.
    expect(md).toContain(
      '```text\nClaim <script>alert(1)</script> with `markup` and # heading\n```',
    );
    expect(md.split('\n').every((l) => !l.startsWith('<script'))).toBe(true);
  });

  it('keeps hostile source and claim markup inside code blocks (reviewer regression)', () => {
    const hostile =
      '<img src=x onerror=alert(1)> ![t](http://tracker.example/p.png) [x](javascript:alert(1))\n' +
      '# Heading\n```\nfence break attempt ```` and ~~~\n<script>alert(2)</script>';
    const s = importSource(
      newWorkspace('W'),
      { title: 'T', origin: 'paste', rawText: hostile },
      AT,
    );
    if (!s.ok) throw new Error('src');
    const c = createClaim(s.workspace, { text: `See ${hostile}`, kind: 'factual' }, AT);
    if (!c.ok) throw new Error('claim');
    const e = addEvidence(
      c.workspace,
      c.value,
      { sourceId: s.value, start: 0, end: Array.from(hostile).length, label: 'support' },
      AT,
    );
    if (!e.ok) throw new Error('ev');
    const md = renderMarkdown(buildReport(e.workspace, AT));
    // Walk the Markdown the way CommonMark treats backtick fences: hostile lines must be inside one.
    let open: string | null = null;
    const outside: string[] = [];
    for (const raw of md.split('\n')) {
      const m = /^ {0,3}(`{3,})(.*)$/.exec(raw);
      if (open === null && m) {
        open = m[1] ?? '';
        continue;
      }
      if (open !== null && m && (m[1] ?? '').length >= open.length && (m[2] ?? '').trim() === '') {
        open = null;
        continue;
      }
      if (open === null) outside.push(raw);
    }
    expect(open).toBeNull();
    const leaked = outside.filter((l) => /<img|<script|!\[|\]\(javascript|^# Heading/.test(l));
    expect(leaked).toEqual([]);
    expect(fence('a ```` b')).toBe('`````text\na ```` b\n`````');
  });
});

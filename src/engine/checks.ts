/**
 * Spec 02 §3: heuristic checks. TypeScript only, advisory, never blocking, never a statement that
 * anything is true. Every finding is labelled `heuristic`.
 */
import { verifyLocator } from './locator';
import { isBlank, isBlankCodePoint } from './text';
import type { Claim, Workspace } from './types';

export type CheckCode =
  | 'CONTRADICTION_PRESENT'
  | 'DATE_NOT_IN_PASSAGE'
  | 'DUPLICATE_CLAIM'
  | 'MISMATCHED_CITATION'
  | 'MISSING_SOURCE'
  | 'QUOTE_NOT_IN_PASSAGE'
  | 'SOURCE_DATE_MISSING'
  | 'UNSUPPORTED_CLAIM';

export interface Finding {
  code: CheckCode;
  severity: 'warning' | 'info';
  claimId: string;
  evidenceId?: string;
  message: string;
  heuristic: true;
}

export const CHECK_DESCRIPTIONS: Record<CheckCode, string> = {
  MISSING_SOURCE: 'The claim cites no source passage.',
  UNSUPPORTED_CLAIM: 'No cited passage is a valid supporting citation.',
  MISMATCHED_CITATION:
    'A cited passage no longer matches its source text, or its source is missing.',
  QUOTE_NOT_IN_PASSAGE: 'A quoted span in the claim does not appear in any cited passage.',
  DATE_NOT_IN_PASSAGE: 'A year or date in the claim does not appear in any cited passage.',
  SOURCE_DATE_MISSING: 'A cited source has no date recorded.',
  DUPLICATE_CLAIM: 'Another claim has the same or a very similar wording.',
  CONTRADICTION_PRESENT: 'Contradicting evidence is attached to this claim.',
};

/** Collapses every run of blank-set code points (spec 01) into one space. */
function collapse(text: string): string {
  let out = '';
  let inRun = false;
  for (const ch of text) {
    if (isBlankCodePoint(ch.codePointAt(0) ?? 0)) {
      if (!inRun) out += ' ';
      inRun = true;
    } else {
      out += ch;
      inRun = false;
    }
  }
  return out;
}

/** Spec 02 §3 comparison form: lower case, non-letters/digits to one space, trimmed. */
export function comparisonForm(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function tokens(form: string): Set<string> {
  return new Set(form === '' ? [] : form.split(' '));
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}

export function quotedSpans(text: string): string[] {
  const out: string[] = [];
  // `u`: the 3 to 300 limit counts code points (spec 02 §3), not UTF-16 units.
  const re = /"([^"]{3,300})"|“([^”]{3,300})”/gu;
  for (const m of text.matchAll(re)) out.push((m[1] ?? m[2]) as string);
  return out;
}

export function datesIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) out.add(m[0]);
  // A year inside an ISO date belongs to that date and is not a separate finding.
  const withoutIso = text.replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ');
  for (const m of withoutIso.matchAll(/\b(1[0-9]{3}|20[0-9]{2})\b/g)) out.add(m[0]);
  return [...out];
}

function check(ws: Workspace, claim: Claim, others: Claim[]): Finding[] {
  const out: Finding[] = [];
  const add = (code: CheckCode, severity: Finding['severity'], evidenceId?: string): void => {
    const f: Finding = {
      code,
      severity,
      claimId: claim.id,
      message: CHECK_DESCRIPTIONS[code],
      heuristic: true,
    };
    if (evidenceId !== undefined) f.evidenceId = evidenceId;
    out.push(f);
  };
  if (claim.evidence.length === 0) add('MISSING_SOURCE', 'warning');

  const sources = new Map(ws.sources.map((s) => [s.id, s]));
  let validSupport = 0;
  const passages: string[] = [];
  const undated = new Set<string>();
  for (const ev of claim.evidence) {
    const src = sources.get(ev.sourceId);
    if (src === undefined || verifyLocator(src.text, ev.locator) !== 'OK') {
      add('MISMATCHED_CITATION', 'warning', ev.id);
      continue;
    }
    passages.push(collapse(ev.locator.text));
    if (ev.label === 'support') validSupport += 1;
    if (src.date === '') undated.add(src.id);
  }
  if (claim.evidence.length > 0 && validSupport === 0) add('UNSUPPORTED_CLAIM', 'warning');

  if (passages.length > 0) {
    for (const quote of quotedSpans(claim.text)) {
      const q = collapse(quote);
      if (!passages.some((p) => p.includes(q))) add('QUOTE_NOT_IN_PASSAGE', 'warning');
    }
    for (const date of datesIn(claim.text)) {
      if (!passages.some((p) => p.includes(date))) add('DATE_NOT_IN_PASSAGE', 'warning');
    }
  }
  for (const sourceId of [...undated].sort()) {
    void sourceId;
    add('SOURCE_DATE_MISSING', 'info');
  }

  if (!isBlank(claim.text)) {
    const mine = comparisonForm(claim.text);
    const myTokens = tokens(mine);
    const dup = others.some((o) => {
      if (o.id === claim.id || isBlank(o.text)) return false;
      const theirs = comparisonForm(o.text);
      if (theirs === '' && mine === '') return false;
      return theirs === mine || jaccard(myTokens, tokens(theirs)) >= 0.8;
    });
    if (dup) add('DUPLICATE_CLAIM', 'warning');
  }
  if (claim.evidence.some((e) => e.label === 'contradiction')) add('CONTRADICTION_PRESENT', 'info');
  return out;
}

/** All findings, sorted by claim id (numeric), then code, then evidence id. */
export function runChecks(ws: Workspace): Finding[] {
  const all = ws.claims.flatMap((c) => check(ws, c, ws.claims));
  const num = (id: string): number => Number(id.slice(2));
  return all.sort(
    (a, b) =>
      num(a.claimId) - num(b.claimId) ||
      (a.code < b.code ? -1 : a.code > b.code ? 1 : 0) ||
      (a.evidenceId ?? '').localeCompare(b.evidenceId ?? ''),
  );
}

/** Spec 03 §2: the evidence report (JSON and Markdown). Deterministic for the same inputs. */
import { runChecks, type Finding } from './checks';
import { verifyLocator } from './locator';
import { STATUSES, type Workspace } from './types';

export const DISCLAIMER =
  'Review record only. Statuses reflect a person’s decisions. Nothing here verifies that any claim is true.';

export interface ReportEvidence {
  id: string;
  sourceId: string;
  sourceTitle: string;
  label: string;
  passage: string;
  start: number;
  end: number;
  locatorCheck: string;
  note: string;
}

export interface ReportClaim {
  id: string;
  kind: string;
  status: string;
  text: string;
  origin: string;
  reviewNote: string;
  evidence: ReportEvidence[];
  audit: {
    seq: number;
    at: string;
    type: string;
    from?: string;
    to?: string;
    note: string;
    codes?: string[];
  }[];
}

export interface Report {
  schema: 'source-trace.report/1';
  disclaimer: string;
  workspace: string;
  generatedAt: string;
  counts: Record<string, number>;
  sources: {
    id: string;
    title: string;
    author: string;
    date: string;
    provenance: string;
    url: string;
    rights: string;
    origin: string;
    contentHash: string;
  }[];
  claims: ReportClaim[];
  heuristicFindings: (Omit<Finding, 'heuristic'> & { label: 'heuristic' })[];
}

export function buildReport(ws: Workspace, generatedAt: string): Report {
  const titles = new Map(ws.sources.map((s) => [s.id, s]));
  const counts: Record<string, number> = { claims: ws.claims.length, sources: ws.sources.length };
  for (const status of STATUSES)
    counts[status] = ws.claims.filter((c) => c.status === status).length;
  return {
    schema: 'source-trace.report/1',
    disclaimer: DISCLAIMER,
    workspace: ws.name,
    generatedAt,
    counts,
    sources: ws.sources.map((s) => ({
      id: s.id,
      title: s.title,
      author: s.author,
      date: s.date,
      provenance: s.provenance,
      url: s.url,
      rights: s.rights,
      origin: s.origin,
      contentHash: s.contentHash,
    })),
    claims: ws.claims.map((c) => ({
      id: c.id,
      kind: c.kind,
      status: c.status,
      text: c.text,
      origin: c.origin,
      reviewNote: c.reviewNote,
      evidence: c.evidence.map((e) => {
        const src = titles.get(e.sourceId);
        return {
          id: e.id,
          sourceId: e.sourceId,
          sourceTitle: src?.title ?? '(missing source)',
          label: e.label,
          passage: e.locator.text,
          start: e.locator.start,
          end: e.locator.end,
          locatorCheck: src === undefined ? 'SOURCE_MISSING' : verifyLocator(src.text, e.locator),
          note: e.note,
        };
      }),
      audit: c.audit.map((a) => {
        const row: ReportClaim['audit'][number] = {
          seq: a.seq,
          at: a.at,
          type: a.type,
          note: a.note,
        };
        if (a.from !== undefined) row.from = a.from;
        if (a.to !== undefined) row.to = a.to;
        if (a.codes !== undefined) row.codes = a.codes;
        return row;
      }),
    })),
    heuristicFindings: runChecks(ws).map(({ heuristic: _h, ...rest }) => ({
      ...rest,
      label: 'heuristic',
    })),
  };
}

function fence(text: string): string {
  // One-line blockquote per passage line, so source markup can never become report markup.
  return text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

function inline(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/([\\`*_{}[\]<>#|~])/g, '\\$1')
    .trim();
}

export function renderMarkdown(report: Report): string {
  const lines: string[] = [];
  lines.push(`# Evidence report: ${inline(report.workspace)}`, '');
  lines.push(`_${report.disclaimer}_`, '');
  lines.push(`Generated: ${report.generatedAt}`, '');
  lines.push(
    `Claims: ${report.counts['claims']} (` +
      STATUSES.map((s) => `${s}: ${report.counts[s]}`).join(', ') +
      `). Sources: ${report.counts['sources']}.`,
    '',
  );
  lines.push('## Sources', '');
  for (const s of report.sources) {
    lines.push(
      `- **${s.id}** ${inline(s.title)}${s.author ? `, ${inline(s.author)}` : ''}${s.date ? ` (${s.date})` : ''}`,
    );
    lines.push(`  - Origin: ${s.origin}. Content hash: \`${s.contentHash}\``);
    if (s.provenance) lines.push(`  - Provenance: ${inline(s.provenance)}`);
    if (s.url) lines.push(`  - URL: ${inline(s.url)}`);
    if (s.rights) lines.push(`  - Rights note: ${inline(s.rights)}`);
  }
  lines.push('', '## Claims', '');
  for (const c of report.claims) {
    lines.push(`### ${c.id} [${c.status}] (${c.kind})`, '');
    lines.push(c.text.trim() === '' ? '_(empty claim text)_' : fence(c.text), '');
    if (c.origin === 'ai_suggestion')
      lines.push('_Origin: an AI suggestion that a person accepted as a draft._', '');
    if (c.reviewNote) lines.push(`Review note: ${inline(c.reviewNote)}`, '');
    if (c.evidence.length === 0) lines.push('No evidence attached.', '');
    for (const e of c.evidence) {
      lines.push(
        `- **${e.label}**: ${e.sourceId} "${inline(e.sourceTitle)}", characters ${e.start} to ${e.end} (locator check: ${e.locatorCheck})`,
      );
      lines.push(fence(e.passage).replace(/^/gm, '  '));
      if (e.note) lines.push(`  - Note: ${inline(e.note)}`);
    }
    lines.push('', 'Audit trail:', '');
    for (const a of c.audit) {
      const change = a.from !== undefined ? ` ${a.from} to ${a.to}` : '';
      const codes = a.codes ? ` blocked by ${a.codes.join(', ')}` : '';
      lines.push(
        `${a.seq}. ${a.at} ${a.type}${change}${codes}${a.note ? `: ${inline(a.note)}` : ''}`,
      );
    }
    lines.push('');
  }
  lines.push('## Heuristic findings', '');
  lines.push(
    '_These are heuristic flags for a reviewer. They do not prove or disprove anything._',
    '',
  );
  if (report.heuristicFindings.length === 0) lines.push('None.');
  for (const f of report.heuristicFindings) {
    lines.push(
      `- ${f.claimId}${f.evidenceId ? `/${f.evidenceId}` : ''} ${f.code} (${f.severity}, heuristic): ${f.message}`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

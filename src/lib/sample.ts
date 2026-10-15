/**
 * Synthetic sample workspace. Every text here was written for SourceTrace demos; none is quoted
 * from a real document. Built through the real operations so its audit trails are genuine.
 */
import {
  addEvidence,
  createClaim,
  importSource,
  newWorkspace,
  setReviewNote,
  transitionClaim,
  type Label,
  type Workspace,
} from '../engine';

export const SAMPLE_PROVENANCE =
  'Synthetic sample: written for SourceTrace demos, not a real document.';

export const SAMPLE_SOURCE_1 =
  'The Harbor Bridge opened to traffic on 4 June 1932 after four years of construction. ' +
  'The main span is 410 metres long. Early critics described the grey paint as dull, and a ' +
  'petition in 1933 asked for a lighter colour. The bridge was closed for six days in 1951 for ' +
  'repairs after a ship struck a pier.';

export const SAMPLE_SOURCE_2 =
  'A common claim is that the Harbor Bridge opened in 1934, but the society ledger records the ' +
  'ribbon-cutting on 4 June 1932. The main span is often quoted as 400 metres; surveyors measured ' +
  '410 metres. Locals say the 1953 repaint was paid for by a lottery, though no receipt has survived.';

function must<T>(
  r: { ok: true; workspace: Workspace; value: T } | { ok: false; message: string },
): {
  workspace: Workspace;
  value: T;
} {
  if (!r.ok) throw new Error(`sample build failed: ${r.message}`);
  return { workspace: r.workspace, value: r.value };
}

function span(text: string, needle: string): { start: number; end: number } {
  const start = text.indexOf(needle);
  if (start < 0) throw new Error(`sample passage missing: ${needle}`);
  return { start, end: start + needle.length };
}

export function createSampleWorkspace(): Workspace {
  const t = (n: number): string => new Date(Date.UTC(2026, 0, 5, 9, 0, n)).toISOString();
  let clock = 0;
  const at = (): string => t((clock += 1));
  let ws = newWorkspace('Sample workspace (synthetic)');

  const s1 = must(
    importSource(
      ws,
      {
        title: 'Harbor Bridge: engineers summary (synthetic)',
        author: 'Sample Author',
        date: '2026-01-05',
        provenance: SAMPLE_PROVENANCE,
        rights: 'Synthetic text released with this repository (MIT).',
        origin: 'paste',
        rawText: SAMPLE_SOURCE_1,
      },
      at(),
    ),
  );
  ws = s1.workspace;
  const s2 = must(
    importSource(
      ws,
      {
        title: 'Harbor Historical Society newsletter (synthetic)',
        author: 'Sample Society',
        date: '',
        provenance: SAMPLE_PROVENANCE,
        rights: 'Synthetic text released with this repository (MIT).',
        origin: 'paste',
        rawText: SAMPLE_SOURCE_2,
      },
      at(),
    ),
  );
  ws = s2.workspace;

  const claim = (text: string, kind: Parameters<typeof createClaim>[1]['kind']): string => {
    const c = must(createClaim(ws, { text, kind }, at()));
    ws = c.workspace;
    return c.value;
  };
  const cite = (
    claimId: string,
    sourceId: string,
    sourceText: string,
    needle: string,
    label: Label,
    note = '',
  ): void => {
    const { start, end } = span(sourceText, needle);
    ws = must(addEvidence(ws, claimId, { sourceId, start, end, label, note }, at())).workspace;
  };
  const move = (claimId: string, to: Parameters<typeof transitionClaim>[2], note = ''): void => {
    const r = transitionClaim(ws, claimId, to, note, at());
    if (!r.ok) throw new Error(`sample transition failed: ${r.message}`);
    ws = r.workspace;
  };

  // 1. A claim that is fully supported and approved by a person.
  const c1 = claim('The Harbor Bridge opened to traffic in 1932.', 'factual');
  cite(c1, s1.value, SAMPLE_SOURCE_1, 'opened to traffic on 4 June 1932', 'support');
  cite(c1, s2.value, SAMPLE_SOURCE_2, 'ribbon-cutting on 4 June 1932', 'support');
  move(c1, 'needs_review');
  move(c1, 'approved', 'Two independent passages agree on the date.');

  // 2. A claim contradicted by a source: approval would be refused.
  const c2 = claim('The Harbor Bridge opened in 1934.', 'factual');
  cite(c2, s1.value, SAMPLE_SOURCE_1, 'opened to traffic on 4 June 1932', 'contradiction');
  cite(
    c2,
    s2.value,
    SAMPLE_SOURCE_2,
    'opened in 1934',
    'unknown',
    'Cited only as the claim being refuted.',
  );
  move(c2, 'needs_review');

  // 3. An interpretation with support, still a draft.
  const c3 = claim('Early critics found the paint dull.', 'interpretation');
  cite(c3, s1.value, SAMPLE_SOURCE_1, 'described the grey paint as dull', 'support');

  // 4. A claim with no usable evidence, used to show the unsupported warnings.
  const c4 = claim('A lottery paid for the 1953 repaint.', 'disputed');
  cite(c4, s2.value, SAMPLE_SOURCE_2, 'paid for by a lottery', 'unknown', 'Hearsay; no receipt.');
  ws = must(
    setReviewNote(ws, c4, 'Worth keeping as a disputed assertion until a record turns up.', at()),
  ).workspace;
  return ws;
}

export function isSampleWorkspace(ws: Workspace): boolean {
  return ws.sources.some((s) => s.provenance.startsWith('Synthetic sample'));
}

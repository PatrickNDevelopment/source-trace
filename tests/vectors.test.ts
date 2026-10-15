/** Golden vectors (contracts/vectors) against the TypeScript engine. Python runs the same files. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  approvalBlockers,
  buildLocator,
  canTransition,
  contentHash,
  normalizeText,
  parseWorkspaceJson,
  textProblems,
  validateWorkspace,
  verifyLocator,
  type Locator,
  type Status,
} from '../src/engine';

function load<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`../contracts/vectors/${name}`, import.meta.url), 'utf8'));
}

interface TextCase {
  name: string;
  input?: string;
  text?: string;
  repeat?: [string, number];
  expected: unknown;
}
const text = load<{ normalize: TextCase[]; problems: TextCase[]; hash: TextCase[] }>('text.json');

describe('text vectors', () => {
  for (const c of text.normalize) {
    it(`normalize: ${c.name}`, () => {
      expect(normalizeText(c.input ?? '')).toBe(c.expected);
      expect(normalizeText(c.expected as string)).toBe(c.expected);
    });
  }
  for (const c of text.problems) {
    it(`problems: ${c.name}`, () => {
      const value = c.repeat ? c.repeat[0].repeat(c.repeat[1]) : (c.text ?? '');
      expect(textProblems(value)).toEqual(c.expected);
    });
  }
  for (const c of text.hash) {
    it(`hash: ${c.name}`, () => expect(contentHash(c.input ?? '')).toBe(c.expected));
  }
});

const loc = load<{
  build: { name: string; source: string; start: number; end: number; expected: Locator | string }[];
  verify: { name: string; source: string; locator: Locator; expected: string }[];
}>('locator.json');

describe('locator vectors', () => {
  for (const c of loc.build) {
    it(`build: ${c.name}`, () => {
      const r = buildLocator(c.source, c.start, c.end);
      if (typeof c.expected === 'string') expect(r).toEqual({ ok: false, code: c.expected });
      else expect(r).toEqual({ ok: true, locator: c.expected });
    });
  }
  for (const c of loc.verify) {
    it(`verify: ${c.name}`, () => expect(verifyLocator(c.source, c.locator)).toBe(c.expected));
  }
});

const state = load<{
  transitions: { from: Status; to: Status; legal: boolean }[];
  gate: {
    name: string;
    claim: {
      text: string;
      kind: 'factual';
      evidence: { sourceId: string; label: 'support'; locator: Locator }[];
    };
    sources: Record<string, string>;
    expected: string[];
  }[];
}>('state.json');

describe('state vectors', () => {
  for (const t of state.transitions) {
    it(`transition ${t.from} -> ${t.to}`, () => expect(canTransition(t.from, t.to)).toBe(t.legal));
  }
  for (const c of state.gate) {
    it(`gate: ${c.name}`, () => {
      const sources = new Map(Object.entries(c.sources).map(([id, t]) => [id, { text: t }]));
      const claim = { ...c.claim, evidence: c.claim.evidence as never };
      expect(approvalBlockers(claim, sources)).toEqual(c.expected);
    });
  }
});

describe('workspace vectors', () => {
  const ws = load<{ cases: { name: string; value: unknown; expected: string[] }[] }>(
    'workspace.json',
  );
  for (const c of ws.cases) {
    it(`workspace: ${c.name}`, () => expect(validateWorkspace(c.value)).toEqual(c.expected));
  }
  const js = load<{ cases: { name: string; text: string; expected: string[] }[] }>('json.json');
  for (const c of js.cases) {
    it(`json: ${c.name}`, () => {
      const r = parseWorkspaceJson(c.text);
      expect(r.ok ? [] : r.codes).toEqual(c.expected);
    });
  }
});

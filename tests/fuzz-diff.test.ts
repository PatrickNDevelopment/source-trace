/**
 * TypeScript leg of the differential fuzz (contracts/tools/fuzz_diff.py). Inert unless
 * ST_FUZZ_FILE names a cases file; it never compares anything itself:
 *   ST_FUZZ_FILE=cases.json ST_FUZZ_OUT=ts.json npx vitest run tests/fuzz-diff.test.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  approvalBlockers,
  buildLocator,
  contentHash,
  normalizeText,
  parseWorkspaceJson,
  textProblems,
  validateWorkspace,
  verifyLocator,
} from '../src/engine';

const FILE = process.env['ST_FUZZ_FILE'] ?? '';
const OUT = process.env['ST_FUZZ_OUT'] ?? `${FILE}.ts.json`;

interface Case {
  id: string;
  op: string;
  input: Record<string, unknown> | string;
}

function run(c: Case): unknown {
  const i = c.input as Record<string, never>;
  switch (c.op) {
    case 'normalize':
      return normalizeText(c.input as string);
    case 'problems':
      return textProblems(c.input as string);
    case 'hash':
      return contentHash(c.input as string);
    case 'build':
      return buildLocator(i['text'], i['start'], i['end']);
    case 'verify':
      return verifyLocator(i['text'], i['locator']);
    case 'gate': {
      const sources = new Map(
        Object.entries(i['sources'] as Record<string, string>).map(([k, v]) => [k, { text: v }]),
      );
      return approvalBlockers(i['claim'], sources);
    }
    case 'workspace':
      return validateWorkspace(c.input);
    case 'json': {
      const r = parseWorkspaceJson(c.input as string);
      return r.ok ? [] : r.codes;
    }
    default:
      throw new Error(`unknown op ${c.op}`);
  }
}

describe.skipIf(FILE === '')('differential fuzz (TypeScript leg)', () => {
  it('evaluates every case', () => {
    const { cases } = JSON.parse(readFileSync(FILE, 'utf8')) as { cases: Case[] };
    const results: Record<string, unknown> = {};
    for (const c of cases) {
      try {
        results[c.id] = { ok: true, value: run(c) };
      } catch (error) {
        results[c.id] = { ok: false, error: String(error) };
      }
    }
    writeFileSync(OUT, JSON.stringify({ results }));
    expect(Object.keys(results)).toHaveLength(cases.length);
  });
});

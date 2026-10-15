/** Spec 01 §2 content hash and §3 locators. */
import { sha256Hex } from './sha256';
import { cpLength, normalizeText, toCodePoints } from './text';

export const MAX_PASSAGE_CODEPOINTS = 5_000;
const CONTEXT_WINDOW = 32;
const SEP = '\u001f';

export interface Locator {
  start: number;
  end: number;
  text: string;
  contextHash: string;
}

export type LocatorCode =
  | 'OK'
  | 'LOC_RANGE'
  | 'LOC_TOO_LONG'
  | 'LOC_TEXT_MISMATCH'
  | 'LOC_CONTEXT_MISMATCH';

/** Spec 01 §2. */
export function contentHash(text: string): string {
  return sha256Hex(normalizeText(text));
}

function isInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n);
}

function rangeCode(length: number, start: unknown, end: unknown): LocatorCode {
  if (!isInt(start) || !isInt(end) || start < 0 || end > length || start >= end) return 'LOC_RANGE';
  if (end - start > MAX_PASSAGE_CODEPOINTS) return 'LOC_TOO_LONG';
  return 'OK';
}

function contextOf(cps: string[], start: number, end: number): string {
  const before = cps.slice(Math.max(0, start - CONTEXT_WINDOW), start).join('');
  const passage = cps.slice(start, end).join('');
  const after = cps.slice(end, end + CONTEXT_WINDOW).join('');
  return sha256Hex(before + SEP + passage + SEP + after);
}

export function buildLocator(
  sourceText: string,
  start: number,
  end: number,
): { ok: true; locator: Locator } | { ok: false; code: 'LOC_RANGE' | 'LOC_TOO_LONG' } {
  const cps = toCodePoints(sourceText);
  const code = rangeCode(cps.length, start, end);
  if (code !== 'OK') return { ok: false, code: code as 'LOC_RANGE' | 'LOC_TOO_LONG' };
  return {
    ok: true,
    locator: {
      start,
      end,
      text: cps.slice(start, end).join(''),
      contextHash: contextOf(cps, start, end),
    },
  };
}

export function verifyLocator(sourceText: string, locator: Locator): LocatorCode {
  const cps = toCodePoints(sourceText);
  const range = rangeCode(cps.length, locator.start, locator.end);
  if (range !== 'OK') return range;
  if (locator.text !== cps.slice(locator.start, locator.end).join('')) return 'LOC_TEXT_MISMATCH';
  if (locator.contextHash !== contextOf(cps, locator.start, locator.end)) {
    return 'LOC_CONTEXT_MISMATCH';
  }
  return 'OK';
}

/** Length helper re-exported for callers that only need counts. */
export { cpLength };

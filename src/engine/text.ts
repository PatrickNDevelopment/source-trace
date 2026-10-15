/** Spec 01 §1: text rules. Lengths and offsets are Unicode code points, never UTF-16 units. */

export const MAX_SOURCE_CODEPOINTS = 500_000;

/** Spec 01 §1 blank set: explicit so TypeScript and Python agree. */
const BLANK = new Set<number>([
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0x85, 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
]);
for (let cp = 0x2000; cp <= 0x200a; cp += 1) BLANK.add(cp);

export function isBlankCodePoint(cp: number): boolean {
  return BLANK.has(cp);
}

/** Removes a leading BOM and converts CRLF and lone CR to LF. Idempotent. */
export function normalizeText(raw: string): string {
  let start = 0;
  while (raw.charCodeAt(start) === 0xfeff) start += 1;
  const withoutBom = start === 0 ? raw : raw.slice(start);
  return withoutBom.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/** Number of Unicode code points (a lone surrogate counts as one). */
export function cpLength(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const d = text.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) i += 1;
    }
    n += 1;
  }
  return n;
}

/** Code points as strings (a lone surrogate is its own element). */
export function toCodePoints(text: string): string[] {
  return Array.from(text);
}

/** `slice(start, end)` in code points. */
export function sliceCp(text: string, start: number, end: number): string {
  return toCodePoints(text).slice(start, end).join('');
}

export function hasLoneSurrogate(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (d >= 0xdc00 && d <= 0xdfff) i += 1;
      else return true;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return true;
    }
  }
  return false;
}

export function isBlank(text: string): boolean {
  for (const ch of text) {
    if (!BLANK.has(ch.codePointAt(0) ?? 0)) return false;
  }
  return true;
}

/** Strips leading and trailing blank-set code points. */
export function trimBlank(text: string): string {
  const cps = toCodePoints(text);
  let a = 0;
  let b = cps.length;
  while (a < b && BLANK.has(cps[a]?.codePointAt(0) ?? 0)) a += 1;
  while (b > a && BLANK.has(cps[b - 1]?.codePointAt(0) ?? 0)) b -= 1;
  return cps.slice(a, b).join('');
}

/** Spec 01 §1: the set of problem codes of an already-normalized text, sorted. */
export function textProblems(text: string): string[] {
  const out = new Set<string>();
  if (hasLoneSurrogate(text)) out.add('TEXT_INVALID_UNICODE');
  if (text.includes('\u0000')) out.add('TEXT_CONTAINS_NUL');
  if (text.includes('\r') || text.startsWith('﻿')) out.add('TEXT_NOT_NORMALIZED');
  if (cpLength(text) > MAX_SOURCE_CODEPOINTS) out.add('TEXT_TOO_LONG');
  if (isBlank(text)) out.add('TEXT_EMPTY');
  return [...out].sort();
}

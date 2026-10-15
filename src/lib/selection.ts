/** Conversion between browser (UTF-16) selection offsets and engine (code point) offsets. */

/** Code point index for a UTF-16 index, widening to never split a surrogate pair. */
export function utf16ToCodePoint(text: string, index: number, widen: 'down' | 'up'): number {
  let i = Math.max(0, Math.min(index, text.length));
  if (i > 0 && i < text.length) {
    const before = text.charCodeAt(i - 1);
    const at = text.charCodeAt(i);
    const splitsPair = before >= 0xd800 && before <= 0xdbff && at >= 0xdc00 && at <= 0xdfff;
    if (splitsPair) i += widen === 'down' ? -1 : 1;
  }
  let n = 0;
  for (let k = 0; k < i; k += 1) {
    const c = text.charCodeAt(k);
    if (c >= 0xd800 && c <= 0xdbff && k + 1 < text.length) {
      const d = text.charCodeAt(k + 1);
      if (d >= 0xdc00 && d <= 0xdfff) k += 1;
    }
    n += 1;
  }
  return n;
}

/** UTF-16 index of a code point offset (clamped to the text length). */
export function codePointToUtf16(text: string, cp: number): number {
  let n = 0;
  let k = 0;
  while (k < text.length && n < cp) {
    const c = text.charCodeAt(k);
    k += c >= 0xd800 && c <= 0xdbff && k + 1 < text.length ? 2 : 1;
    n += 1;
  }
  return k;
}

/** The selection of a text area as a code point range, or null when it is empty. */
export function selectionAsCodePoints(
  text: string,
  start: number,
  end: number,
): { start: number; end: number } | null {
  if (start === end) return null;
  const a = utf16ToCodePoint(text, Math.min(start, end), 'down');
  const b = utf16ToCodePoint(text, Math.max(start, end), 'up');
  return a === b ? null : { start: a, end: b };
}

# Spec 01: text rules, content hash, locators (shared contract)

## 1. Text rules

A **text** is a sequence of Unicode code points. Length is the number of code points.

`normalizeText(raw)`:

1. Remove every leading U+FEFF (so the result never starts with one).
2. Replace every `CRLF` (U+000D U+000A) with `LF` (U+000A).
3. Replace every remaining `CR` (U+000D) with `LF`.

Nothing else is changed. Normalization is idempotent.

`textProblems(text)` returns the **set** of problem codes of an already-normalized text:

| Code                    | Condition                                                            |
| ----------------------- | -------------------------------------------------------------------- |
| `TEXT_INVALID_UNICODE`  | contains a lone surrogate (U+D800 to U+DFFF not part of a pair)      |
| `TEXT_CONTAINS_NUL`     | contains U+0000                                                      |
| `TEXT_NOT_NORMALIZED`   | contains U+000D, or starts with U+FEFF                               |
| `TEXT_TOO_LONG`         | more than 500,000 code points                                        |
| `TEXT_EMPTY`            | zero code points, or only code points in the **blank set**           |

Blank set (explicit so Python and JavaScript agree): U+0009 to U+000D, U+0020, U+0085, U+00A0,
U+1680, U+2000 to U+200A, U+2028, U+2029, U+202F, U+205F, U+3000.
`isBlank(text)` is true when every code point is in the blank set (an empty text is blank).
`trim` in this spec strips leading and trailing blank-set code points.

## 2. Content hash

`contentHash(text) = lowercase hexadecimal SHA-256 of the UTF-8 encoding of normalizeText(text)`.
64 characters. Two sources are duplicates exactly when their content hashes are equal.

## 3. Locators

A **locator** is `{ start, end, text, contextHash }`:

- `start`, `end`: integers, half-open range `[start, end)` of **code points** in the source text.
- `text`: the exact passage, equal to `slice(start, end)`.
- `contextHash`: lowercase hex SHA-256 of the UTF-8 encoding of
  `before + U+001F + text + U+001F + after` where `before` is up to 32 code points ending at `start`
  and `after` is up to 32 code points beginning at `end`.

`buildLocator(sourceText, start, end)` returns the locator, or the error `LOC_RANGE` when
`start` or `end` is not an integer, `start < 0`, `end > length`, or `start >= end`;
`LOC_TOO_LONG` when `end - start > 5,000`.

`verifyLocator(sourceText, locator)` returns exactly one code, checked in this order:

1. `LOC_RANGE`: start/end not integers, `start < 0`, `end > length`, `start >= end`.
2. `LOC_TOO_LONG`: `end - start > 5,000`.
3. `LOC_TEXT_MISMATCH`: `locator.text != slice(start, end)`.
4. `LOC_CONTEXT_MISMATCH`: `locator.contextHash` differs from the recomputed value.
5. `OK`.

Locators are never "repaired" or re-anchored by searching. A locator that fails stays failed and the
claim cannot be approved on it.

## 4. Passage selection (UI contract, not shared)

The UI reads a selection from a read-only text area (UTF-16 offsets) and converts it to code points
before calling `buildLocator`. Selection that begins or ends inside a surrogate pair is widened to
include the whole pair. An empty selection is refused with a visible message.

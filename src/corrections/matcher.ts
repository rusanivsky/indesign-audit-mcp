import { hasSeparator, isMatchWhitespace, isSeparator, normalizeForMatching } from "./normalize.js";

export interface MatchRange {
  start: number;
  end: number;
}

/**
 * C1. Normalization collapses every whitespace run into one space, so a
 * normalized space can correspond to a source sequence that contains a
 * paragraph-end mark (`\r`). Without this trimming, an `old` with a
 * trailing space — the most natural form when dictating — gave a write
 * range that included the `\r`, and the replacement SILENTLY merged two
 * paragraphs into one. Verification before writing is powerless there:
 * expectedOld = matchText contains that same `\r`, so
 * actual === expectedOld.
 *
 * Rule: if `old` itself does not contain a separator, the match range must
 * not either.
 * - a separator in the whitespace "tail" or "head" of the match — we trim
 *   the range to the paragraph boundary (the correction still applies,
 *   within the paragraph);
 * - a separator inside the core of the match (between the first and last
 *   non-whitespace character) — there is nowhere to trim, the match is
 *   dropped: "not found" with hints is better than silently destroying a
 *   paragraph boundary.
 *
 * T-trim (wave C1 review, after which this function appeared). The
 * trimming here and further SILENTLY shifts the boundaries: the function
 * knows exactly which side (head, tail, both) it moved, but previously
 * that knowledge was lost on output — bare {start, end} went out, and at
 * the planner level there was nothing to build a warning on about a
 * possible stray space that may remain before/after a paragraph mark, when
 * `new` (which is written verbatim — Global Constraint) borders with a
 * space exactly at the trimmed edge. headTrimmed/tailTrimmed is that
 * signal, without any change to the trimming logic itself.
 */
interface ClampedRange extends MatchRange {
  headTrimmed: boolean;
  tailTrimmed: boolean;
}

function clampToParagraph(
  source: string,
  range: MatchRange,
  needleHasSeparator: boolean,
): ClampedRange | null {
  if (needleHasSeparator) return { ...range, headTrimmed: false, tailTrimmed: false };

  let { start, end } = range;

  let coreStart = start;
  while (coreStart < end && isMatchWhitespace(source.charCodeAt(coreStart))) coreStart++;
  let coreEnd = end;
  while (coreEnd > coreStart && isMatchWhitespace(source.charCodeAt(coreEnd - 1))) coreEnd--;
  // The match is entirely whitespace characters: there is no core, nothing to trim.
  if (coreStart >= coreEnd) {
    return hasSeparator(source.slice(start, end))
      ? null
      : { start, end, headTrimmed: false, tailTrimmed: false };
  }

  for (let i = coreStart; i < coreEnd; i++) {
    if (isSeparator(source.charCodeAt(i))) return null;
  }
  let headTrimmed = false;
  // In the head we take the position right after the LAST separator.
  for (let i = coreStart - 1; i >= start; i--) {
    if (isSeparator(source.charCodeAt(i))) {
      start = i + 1;
      headTrimmed = true;
      break;
    }
  }
  let tailTrimmed = false;
  // In the tail we trim at the FIRST separator.
  for (let i = coreEnd; i < end; i++) {
    if (isSeparator(source.charCodeAt(i))) {
      end = i;
      tailTrimmed = true;
      break;
    }
  }
  return { start, end, headTrimmed, tailTrimmed };
}

export interface Suggestion {
  text: string;
  start: number;
  end: number;
  score: number;
}

export interface OccurrenceMatch extends MatchRange {
  /** The head of the range was trimmed at a paragraph boundary (clampToParagraph, C1). */
  headTrimmed: boolean;
  /** The tail of the range was trimmed at a paragraph boundary. */
  tailTrimmed: boolean;
}

/**
 * The same as findOccurrences, but with a headTrimmed/tailTrimmed flag for
 * each match (T-trim) — needed only where a warning to the operator is
 * built from the fact of trimming (planner.ts). findOccurrences()
 * deliberately stays without these fields and returns exactly
 * {start, end}, as before this task: the MatchRange shape does not change
 * for appliedPlace() and the existing tests.
 */
export function findOccurrencesWithTrim(source: string, needle: string): OccurrenceMatch[] {
  const s = normalizeForMatching(source);
  const n = normalizeForMatching(needle);
  const result: OccurrenceMatch[] = [];
  if (n.text.length === 0) return result;

  const needleHasSeparator = hasSeparator(needle);
  let from = 0;
  for (;;) {
    const idx = s.text.indexOf(n.text, from);
    if (idx === -1) break;
    const raw = { start: s.map[idx]!, end: s.mapEnd[idx + n.text.length - 1]! };
    const safe = clampToParagraph(source, raw, needleHasSeparator);
    if (safe) result.push(safe);
    from = idx + 1;
  }
  return result;
}

/** All occurrences of needle in source, adjusted for whitespace, line breaks, quotes, and dashes. */
export function findOccurrences(source: string, needle: string): MatchRange[] {
  return findOccurrencesWithTrim(source, needle).map(({ start, end }) => ({ start, end }));
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    const swap = prev;
    prev = curr;
    curr = swap;
  }
  return prev[b.length]!;
}

/**
 * The fragments closest by similarity. To avoid computing the distance
 * over the whole document, we first look for an anchor word (the longest
 * word of the query), and measure similarity only around its occurrences.
 */
export function findClosest(source: string, needle: string, limit = 3): Suggestion[] {
  const s = normalizeForMatching(source);
  const n = normalizeForMatching(needle);
  if (n.text.length === 0) return [];

  const words = n.text.split(" ").filter((w) => w.length >= 4);
  if (words.length === 0) return [];
  const anchor = words.reduce((a, b) => (b.length > a.length ? b : a));

  const windowLen = n.text.length;
  const found: Suggestion[] = [];
  const seen = new Set<number>();

  let from = 0;
  for (;;) {
    const hit = s.text.indexOf(anchor, from);
    if (hit === -1) break;
    from = hit + 1;

    const anchorOffset = n.text.indexOf(anchor);
    const winStart = Math.max(0, hit - anchorOffset);
    const winEnd = Math.min(s.text.length, winStart + windowLen);
    if (seen.has(winStart)) continue;
    seen.add(winStart);

    const window = s.text.slice(winStart, winEnd);
    const dist = levenshtein(window, n.text);
    const score = 1 - dist / Math.max(window.length, n.text.length);
    if (score < 0.6) continue;

    const realStart = s.map[winStart]!;
    const realEnd = s.mapEnd[winEnd - 1]!;
    found.push({ text: source.slice(realStart, realEnd), start: realStart, end: realEnd, score });
  }

  found.sort((a, b) => b.score - a.score);
  return found.slice(0, limit);
}

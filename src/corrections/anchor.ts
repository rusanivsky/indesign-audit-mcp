import type { MatchRange } from "./matcher.js";

/**
 * K1. Compound anchor for short corrections.
 *
 * The editor often marks a single letter and proposes a different one (most
 * often a final "ь" → "я"). The `old` field then equals a single character,
 * and searching the document produces thousands of matches — the pipeline
 * correctly refuses to write. The anchor must be wider than the letter itself:
 * the whole word, the letter's position within it, and the neighbouring words.
 */

/** Up to what length of marked text the anchor path kicks in. */
export const SHORT_EDIT_MAX = 2;

/** How many words on each side we take to disambiguate locations. */
const NEIGHBOURS = 2;

/** Letters, digits, and an apostrophe — everything we treat as part of a word. */
const WORD_CHAR = /[\p{L}\p{N}'’ʼ’-]/u;

export interface WordAnchor {
  /** The whole word as it stands in the document RIGHT NOW (before the correction). */
  word: string;
  /** Index of the first marked character within word. */
  offsetInWord: number;
  /** How many characters are marked. */
  length: number;
  /** Up to two words to the left of word. */
  before: string[];
  /** Up to two words to the right of word. */
  after: string[];
}

export function needsAnchor(markedText: string): boolean {
  return markedText.trim().length > 0 && markedText.trim().length <= SHORT_EDIT_MAX;
}

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && WORD_CHAR.test(ch);
}

/** The trailing run of the string made up of word characters. */
function trailingWordPart(text: string): string {
  let i = text.length;
  while (i > 0 && isWordChar(text[i - 1])) i--;
  return text.slice(i);
}

/** The leading run of the string made up of word characters. */
function leadingWordPart(text: string): string {
  let i = 0;
  while (i < text.length && isWordChar(text[i])) i++;
  return text.slice(0, i);
}

function words(text: string): string[] {
  return text.split(/[^\p{L}\p{N}'’ʼ’-]+/u).filter((w) => w.length > 0);
}

export function buildWordAnchor(a: {
  markedText: string;
  contextBefore: string;
  contextAfter: string;
}): WordAnchor | null {
  const marked = a.markedText.trim();
  if (marked.length === 0) return null;
  if (a.contextBefore.length === 0 && a.contextAfter.length === 0) return null;

  const head = trailingWordPart(a.contextBefore);
  const tail = leadingWordPart(a.contextAfter);
  const word = head + marked + tail;

  // A word made up of only the marked text adds nothing to uniqueness —
  // but the neighbours can still provide it, so that's no reason to give up.
  const beforeRest = a.contextBefore.slice(0, a.contextBefore.length - head.length);
  const afterRest = a.contextAfter.slice(tail.length);

  return {
    word,
    offsetInWord: head.length,
    length: marked.length,
    before: words(beforeRest).slice(-NEIGHBOURS),
    after: words(afterRest).slice(0, NEIGHBOURS),
  };
}

/** All occurrences of word as a WHOLE word — the boundaries are not word characters. */
function wholeWordOccurrences(source: string, word: string): number[] {
  const hits: number[] = [];
  let from = 0;
  for (;;) {
    const idx = source.indexOf(word, from);
    if (idx === -1) break;
    from = idx + 1;
    if (isWordChar(source[idx - 1])) continue;
    if (isWordChar(source[idx + word.length])) continue;
    hits.push(idx);
  }
  return hits;
}

/**
 * Ranges of marked characters at every location where the word appears with
 * the same neighbours. One range — the location is uniquely determined.
 * Several — the correction goes into the disputed bucket with reason
 * `ambiguous-anchor` (K3). Zero — `not-found`.
 */
export function findAnchorRanges(source: string, anchor: WordAnchor): MatchRange[] {
  const out: MatchRange[] = [];

  for (const at of wholeWordOccurrences(source, anchor.word)) {
    if (!neighboursMatch(source, at, anchor)) continue;
    out.push({
      start: at + anchor.offsetInWord,
      end: at + anchor.offsetInWord + anchor.length,
    });
  }
  return out;
}

function neighboursMatch(source: string, at: number, anchor: WordAnchor): boolean {
  if (anchor.before.length > 0) {
    const left = words(source.slice(Math.max(0, at - 120), at)).slice(-anchor.before.length);
    if (left.join(" ") !== anchor.before.join(" ")) return false;
  }
  if (anchor.after.length > 0) {
    const rightStart = at + anchor.word.length;
    const right = words(source.slice(rightStart, rightStart + 120)).slice(0, anchor.after.length);
    if (right.join(" ") !== anchor.after.join(" ")) return false;
  }
  return true;
}

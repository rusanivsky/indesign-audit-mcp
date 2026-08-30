import type { Aff, WordToken } from "./types.js";

/** Every apostrophe form found in the text → U+0027 from the dictionary. */
const APOSTROPHE_FORMS = /[’ʼ‘´`]/g;

export function normaliseApostrophes(word: string): string {
  return word.replace(APOSTROPHE_FORMS, "'");
}

/**
 * A word = a sequence of letters plus characters from WORDCHARS. Word-boundary
 * rules live HERE, in one place: duplicating them in JSX would mean
 * maintaining two implementations that would drift apart.
 */
export function splitWords(text: string, aff: Aff): WordToken[] {
  /* aff.ignore (the U+0301 stress mark) is NOT stripped here — that's the
   * dictionary lookup's job (a later step). Here the character is only kept
   * INSIDE the token: without it the regex splits the word in two right at
   * the stress mark, and neither half is found in the dictionary. */
  const extra = [...aff.wordChars, ...aff.ignore, ...APOSTROPHE_FORMS.source.slice(1, -1).split("")]
    .map((c) => c.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&"))
    .join("");
  const re = new RegExp(`[\\p{L}${extra}]+`, "gu");

  const out: WordToken[] = [];
  for (const m of text.matchAll(re)) {
    /* Edges are trimmed: a «слово-» at a line break shouldn't drag the hyphen
     * along. An empty result catches TWO cases AT ONCE: a match that had no
     * letters at all to begin with («--», «’»), and a match whose non-letter
     * edges the trim removed entirely. */
    const trimmed = m[0].replace(/^[^\p{L}]+/u, "").replace(/[^\p{L}]+$/u, "");
    if (trimmed === "") continue;
    const offset = m[0].indexOf(trimmed);
    out.push({
      text: trimmed,
      start: m.index + offset,
      end: m.index + offset + trimmed.length,
    });
  }
  return out;
}

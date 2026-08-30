/**
 * Character classes for the Chicago dialect. The counterpart of `chars.ts`,
 * which serves the ДСТУ side.
 *
 * The two files pull in opposite directions on purpose. `UK_UPPER` there
 * DELIBERATELY includes Latin homoglyphs, because Ukrainian text is typed
 * with them — measured at 55,847 Latin `i` against 115 Cyrillic `і` on a real
 * edition. Chicago material has the opposite need: a class that admits no
 * Cyrillic at all, so an entry opener cannot fire inside a Ukrainian record.
 */

export const LATIN_UPPER = "A-Z";
export const LATIN_LOWER = "a-z";

/**
 * Horizontal space OR a forced line break — but NEVER a paragraph mark.
 *
 * `H` in `chars.ts` is `[^\S\r\n]`: it excludes both. That is right for the
 * ДСТУ index, where records are laid out one per paragraph with no manual
 * breaks. It is wrong here, and the difference is measured rather than
 * imagined: the live CIP record carries a forced line break between the place
 * of publication and the publisher — `City :\nPUBLISHER, 2026.` A rule built
 * on `H` cannot see across it and would silently find nothing.
 *
 * `\r` stays excluded, for the same reason `segment.ts` stopped substituting
 * it: a mark placed "instead of" a paragraph boundary MERGES two paragraphs.
 */
export const HN = "[^\\S\\r]";

/**
 * Cyrillic across every block it actually occupies, not just U+0400–U+04FF.
 *
 * Ukrainian needs only the basic block, so a narrower test would pass every
 * test written from this book. The wider class costs nothing and removes a
 * class of silent miss: a gate that reports "no Cyrillic" about text that has
 * some is worse than no gate, because it reads as a measurement.
 */
const CYRILLIC = /[Ѐ-ӿԀ-ԯⷠ-ⷿꙀ-ꚟ]/u;

export function hasCyrillic(s: string): boolean {
  return CYRILLIC.test(s);
}

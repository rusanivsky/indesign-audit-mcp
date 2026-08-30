/**
 * Character constants for the bibliography layer. The ONE place where character
 * literals live: scattered across regexes they are guaranteed to drift apart.
 *
 * Spec §0.6. Measured on the 2022 edition: 55,847 LATIN `i` versus 115
 * Cyrillic `і`, 3,996 Latin `I` versus 9 Cyrillic `І`. The letter `ї` is
 * Cyrillic in all cases. That is, «Iсторiя України» is typed with three Latin letters
 * inside a Ukrainian word, and the class `[А-ЯЇІЄҐ]` will silently miss on
 * half the book. The client isn't going to fix the text — that's their decision,
 * and the code has to live with it.
 */

/** Latin homoglyphs that occur in place of Cyrillic letters. */
export const LATIN_HOMOGLYPHS_UPPER = "IABCEHKMOPTX";
export const LATIN_HOMOGLYPHS_LOWER = "iacepox";

/** Uppercase letters of the Ukrainian alphabet PLUS Latin homoglyphs. */
export const UK_UPPER = `А-ЩЬЮЯЄІЇҐ${LATIN_HOMOGLYPHS_UPPER}`;
/** Lowercase letters of the Ukrainian alphabet PLUS Latin homoglyphs and the apostrophe. */
export const UK_LOWER = `а-щьюяєіїґ'’${LATIN_HOMOGLYPHS_LOWER}`;
/*
 * `UK_LETTER` (a concatenation of both cases) USED TO BE here and was removed (finding M1): across
 * the whole module nobody consumed it — no import in `src/`, none in
 * `tests/`. An unused character-class constant is worse than a missing one: it
 * looks like the "canonical letter class" and invites using it exactly where
 * a specific case is actually needed (`UK_UPPER` for an initial, `UK_LOWER` for the tail
 * of a word). If it's needed — add it back as a line, together with its consumer.
 */

/** The correct zone- and range-separator character — an en dash. Spec §0.1. */
export const EN_DASH = "–";

/**
 * All the dash-like characters that occur IN PLACE OF EN_DASH. Measured on the 2022/2023
 * editions: U+2014 — 7 and 1, U+2012 figure dash — 5 and 8, U+2212 minus — 0 and 3. Stray
 * figure dashes and minus signs are invisible to the eye, and cheap to find.
 *
 * U+2013 is NOT included here: it IS the norm.
 */
export const FOREIGN_DASHES = "\\u002d\\u2010\\u2011\\u2012\\u2014\\u2015\\u2212";

export const NBSP = " ";

/**
 * УСІ ПРОБІЛЬНІ, ЩО НЕ ДАЮТЬ ПЕРЕНЕСЕННЯ.
 *
 * U+00A0 — найпоширеніший, але не єдиний: U+202F (вузький нерозривний) і
 * U+2007 (цифровий) роблять рівно те саме. Захист, що зараховував лише
 * перший, звітував роздільник, набраний вузьким нерозривним, як
 * НЕЗАХИЩЕНИЙ — і то з упевненістю `high`.
 *
 * U+2011 (нерозривний дефіс) сюди НЕ входить: він не пробільний, і його
 * місце в переліку чужих тире, а не тут.
 */
export const NO_BREAK_SPACES = ["\u00a0", "\u202f", "\u2007"] as const;

/**
 * Horizontal whitespace: everything whitespace-like except paragraph and line
 * separators — and except U+FEFF, which is not whitespace at all.
 *
 * THE SAME DEFECT TYPOGRAPHY MEASURED AND FIXED ONE FILE OVER, LEFT STANDING
 * HERE UNTIL 2026-08-26. JavaScript's `\s` includes U+FEFF (ZERO WIDTH NO-BREAK
 * SPACE), so the plain `[^\S\r\n]` caught it as an ordinary space. On the
 * working book on 2026-08-15 that produced nine `collapse-spaces` findings
 * shaped [U+FEFF U+FEFF] → [U+0020]: the "correction" was not removing clutter,
 * it was INSERTING a visible space where there had been no space at all.
 * `src/typography/rules-shared.ts` carries the full account.
 *
 * Bibliography's consequence is the same shape one rule further on. `H` feeds
 * the NBSP specs in `rules-nbsp.ts`, so a locator written as «С.﻿12–15» — a
 * zero-width character between the abbreviation and the number — yielded a
 * `high`-confidence finding proposing U+00A0 in its place: again a visible
 * space conjured out of nothing. It also feeds `ZONE_SEP_SOURCE` below and
 * `NEEDS_BOTH_SIDES` in `rules-dstu.ts`.
 *
 * U+FEFF is zero-width by definition: it is never a space, no matter how many
 * appear in a row.
 */
export const H = "[^\\S\\r\\n\\uFEFF]";

/**
 * The source pattern for the zone separator — "period, space, dash (the correct one or
 * something IN PLACE OF it), space". Shared by `parse.ts` (where it recognizes a zone
 * regardless of which character it's written with) and `rules-dstu.ts` (where it
 * checks whether the character is correct). A byte-identical expression would drift
 * apart if kept as two separate literals — one gets fixed, the other gets forgotten.
 *
 * This is a raw STRING, not a ready-made `RegExp`: both consumers create their own
 * instance with their own flags, and a shared `RegExp` with the `g` flag would again
 * bring back the shared-`lastIndex` trap.
 */
export const ZONE_SEP_SOURCE = `\\.${H}[${EN_DASH}${FOREIGN_DASHES}]${H}`;

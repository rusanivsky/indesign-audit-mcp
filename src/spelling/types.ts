/**
 * Types for the spelling layer. Responsibility boundary: this directory does NOT know about
 * InDesign or MCP — it works with strings. The same decision maintained by
 * `src/typography/` and `src/bibliography/`.
 */

import type { ContainerSnapshot } from "../corrections/types.js";

export interface AffixRule {
  /** What to strip from the end (SFX) or the beginning (PFX) of the stem. "" = nothing. */
  strip: string;
  /** What to append. "" = nothing. */
  add: string;
  /** The condition the STEM (not the word) must match. */
  condition: RegExp;
}

export interface AffixGroup {
  flag: string;
  /** Y — can be combined with an affix on the opposite side. */
  crossProduct: boolean;
  rules: AffixRule[];
}

/** How flags are encoded in .aff/.dic lines — determined by the FLAG directive. */
export type FlagMode = "single" | "long" | "num";

export interface Aff {
  sfx: Map<string, AffixGroup>;
  pfx: Map<string, AffixGroup>;
  /** Characters stripped before checking (stress mark U+0301). */
  ignore: string[];
  /** Characters that BELONG to the word despite not being letters. */
  wordChars: string[];
  /** Patterns by which a compound word is split into parts. */
  breaks: string[];
  /** How to parse flag text: a single character, a character pair, or a number. */
  flagMode: FlagMode;
  /**
   * AF alias table, 1-based index — the same way hunspell itself numbers them.
   * `aliases[0]` is unused: an index shift would be a needless source of error
   * exactly where the cost of an error is highest (see the comment at the AF
   * parsing in aff.ts).
   */
  aliases: string[][];
  /** ICONV pairs: input character → the character to replace it with before checking. */
  iconv: Array<[string, string]>;
  /** Compound-word rules are present in .aff, but the expander does NOT apply them. */
  compoundPresent: boolean;
}

export interface WordToken {
  text: string;
  /** Offsets in the CONTAINER's text — so the finding can be shown. */
  start: number;
  end: number;
}

export interface DictSource {
  dicPath: string;
  affPath: string;
  /** Dictionary attribution, or null if attribution is not determined. */
  vintage: string | null;
}

export interface LanguageRun {
  start: number;
  end: number;
  /** InDesign's English language name, e.g. "Ukrainian" or "[No Language]". */
  language: string;
}

export interface ContainerLanguage {
  containerId: string;
  runs: LanguageRun[];
}

export interface Dictionary {
  known(word: string): boolean;
  /** How many stems are in the dictionary — goes into the response as "what it was measured by". */
  stems: number;
}

/**
 * Only two defects survive from the original design of the `language` family (three
 * detectors). The third, `language-foreign` — "a language other than the dominant one,
 * on a range with words" — was removed: on a multilingual edition it would flag every
 * legitimate quote, name, or term as a defect, and the notion of a "dominant language"
 * itself makes no sense in a parallel translation where languages split roughly in
 * half. Instead of a verdict — an inventory (`tallyLanguages`), the decision stays
 * with the human.
 */
export type LanguageDefect = "language-none" | "language-stray";

export interface LanguageFinding {
  defect: LanguageDefect;
  containerId: string;
  page: string;
  language: string;
  start: number;
  end: number;
  /** How many WORDS are in the range — this is exactly what distinguishes a defect from a triviality. */
  words: number;
  sample: string;
}

/** One row of the document's language inventory — a fact, not a verdict. */
export interface LanguageTally {
  language: string;
  ranges: number;
  /** Weight is counted in WORDS (splitWords), not in ranges and not in characters. */
  words: number;
  /** The share of this language's words out of all the document's words, 0..1. */
  share: number;
  /** The first MAX_PAGES_LISTED pages in document order. The total count is in pageCount. */
  pages: string[];
  /** The total number of DISTINCT pages for this language, before `pages` is truncated. */
  pageCount: number;
}

/**
 * How many pages to show in a row — both in `WordTypeFinding.pages` and in
 * `LanguageTally.pages`. The rest — just a number (`pageCount`).
 *
 * At first the cap stood on the word alone: the most frequent words have the
 * longest page lists, and it was exactly these that bloated the response past
 * any limit (Task 16, a run on the book on 2026-08-13 — 72,354 B against a row
 * cap that had already kicked in). The branch's final review showed that the
 * language inventory is a MIRROR case of the same flaw, and a worse one: it
 * lives in the service part of the response, which the `report.ts` budget
 * RESERVES rather than trims. On this book the `Ukrainian` row carried all
 * 196 pages; it was proven by execution that six languages of 900 pages each
 * produce an 83,004 B response against a 50,000 cap — i.e. past the 78 KB
 * limit the whole budget was built around, and `truncated` in that case
 * honestly reports "everything was cut", because it trims the wrong side.
 *
 * The number is the same as for the word, and that is not a coincidence but
 * the whole point of the fix: what is being bought is not "six" but the
 * property that "row length does NOT depend on the book's size", while
 * `pageCount` carries the volume. Different numbers for the two rows would
 * mean two thresholds where there should be one rule.
 */
export const MAX_PAGES_LISTED = 6;

/**
 * Ordering of page names for the inventory row. Numeric ones — by number;
 * the rest (Roman numerals, "?", non-standard names) — alphabetically and
 * AFTER the numeric ones.
 *
 * This turned out to be needed after measurement, not from reasoning, and
 * measurement itself disproved the previous comment in this file. While the
 * row carried ALL of a language's pages, order didn't matter at all. As soon
 * as it was truncated to `MAX_PAGES_LISTED`, order became the very answer to
 * "where does this language live" — and insertion order into the `Set`
 * turned out to be the order of CONTAINERS, not pages: a re-measurement on
 * the book on 2026-08-14 gave `["13","22","14","15","16","17"]`.
 * Stories don't follow pages, and "the first six" without sorting is noise.
 */
export function comparePageNames(a: string, b: string): number {
  const na = /^\d+$/.test(a) ? Number(a) : null;
  const nb = /^\d+$/.test(b) ? Number(b) : null;
  if (na !== null && nb !== null) return na - nb;
  if (na !== null) return -1;
  if (nb !== null) return 1;
  return a.localeCompare(b, "uk");
}

/**
 * The page on which the container's character offset lies.
 *
 * The fallback is the LAST page (`.at(-1)`), and this is the same convention
 * already held by `corrections/planner.ts`, `tools/typography.ts`,
 * `typography/spelling2019.ts`, `typography/piv2019.ts` and
 * `bibliography/segment.ts`. It fires NOT on an empty `pageRuns` (there
 * `.at(-1)` and `[0]` would equally give `undefined`), but when the offset
 * lies OUTSIDE every run in a NON-EMPTY `pageRuns` — a real, not
 * hypothetical, state: language ranges (`language_runs_read`, spelling.jsx)
 * are read from `story.textStyleRanges` and cover the story's FULL text,
 * including overset, whereas `pageRunsFor` (inspect.jsx) only sees placed
 * frames. A word inside overset text produces exactly this case. Invisible
 * text logically continues the LAST visible page rather than starting from
 * the first.
 *
 * BEFORE THIS MODULE both consumers (`language.ts` and `unknown.ts`) had
 * THEIR OWN copies using `[0]`, and this produced a discrepancy noticeable
 * only on overset: the same word in the same story was attributed to the
 * last page by `typography_audit` (spelling2019), but to the first by
 * `spelling_audit`. The review aligned `spelling2019.ts` and deferred these
 * two copies "to triage"; now there is one copy, and by construction they
 * can no longer diverge.
 */
export function pageAt(c: ContainerSnapshot, offset: number): string {
  for (const r of c.pageRuns) if (offset >= r.start && offset < r.end) return r.page;
  return c.pageRuns.at(-1)?.page ?? "?";
}

/**
 * The `dictionary` family: "not in the dictionary" is a fact about the
 * dictionary, not an error. Proper names, invented words, borrowings, and new
 * norms are legitimately absent — so `word-unknown` is NOT counted in
 * `deviating`; the useful signal is FREQUENCY (`count`), not the mere fact of
 * absence. `word-not-checked` is a different matter: a range whose language
 * the tool could not check at all (no dictionary), and this DOES count in
 * `deviating` — otherwise an unmarked language would silently pass as
 * "clean".
 */
export interface WordTypeFinding {
  defect: "word-unknown" | "word-not-checked";
  word: string;
  /** How many times it occurred. A typo — once; a deliberate choice — many times. */
  count: number;
  /** The first MAX_PAGES_LISTED pages. The total count is in pageCount. */
  pages: string[];
  /** The total number of DISTINCT pages. Shows prevalence when pages is truncated. */
  pageCount: number;
  language: string;
}

/**
 * A summary of both families, ready for a human. `deviating` counts only
 * TRUE defects: `language-none` and `word-not-checked` — yes; `language-stray`
 * and `word-unknown` — no (see the comments at `LanguageDefect` and
 * `WordTypeFinding` above).
 *
 * COMPLETENESS and DETAIL are deliberately separated (Task 16, round-1
 * review): most of the book's words occur exactly once, i.e. they're all
 * pinned to the SAME `count = 1` — and a byte budget, when trimming by size,
 * would cut exactly this solid mass arbitrarily, alphabetically. The silent
 * disappearance of typo candidates chosen by the alphabet is worse than a
 * large response. Hence: `words` carries DETAILED rows (`count`, `pages`,
 * `language`…) for the words the budget could afford. `wordsAll` and
 * `wordsNotCheckedAll` carry a list of all word-types as bare strings, with
 * no structure at all: a word costs a dozen bytes, a row's structure an order
 * of magnitude more. They are split by defect (not one shared array), because
 * merging "not in the dictionary" with "language not checked at all" would
 * erase the distinction this phase deliberately keeps (comment at
 * `WordTypeFinding`). Both are sorted the SAME way as `words` (frequency
 * ascending, then alphabetically).
 *
 * REVIEW ROUND 2: the `MAX_RESPONSE_BYTES` budget (report.ts) now governs the
 * OVERALL response size, not just `words` — a constant limiting only one
 * field doesn't hold up for a future, bigger book: `wordsAll`/
 * `wordsNotCheckedAll` and the response's service fields grow together with
 * the book, and the budget needs to see that. The ceiling wins over
 * completeness: if even the FULL bare lists don't fit the budget (a much
 * larger edition), they too get truncated — but this does NOT stay silent:
 * `truncated` then names what's shown and the total separately for `words`,
 * for `wordsAll`, and for `wordsNotCheckedAll`, not just for `words` as
 * before. `wordTypesTotal` remains the full count of both defects together,
 * REGARDLESS of what's shown (`wordsAll.length + wordsNotCheckedAll.length`
 * equals it only when nothing was truncated). `truncated` is null only when
 * ALL THREE (words, wordsAll, wordsNotCheckedAll) are complete — a silently
 * full ceiling reads as "everything is covered" (the Phase 8 rule).
 */
export interface SpellingReport {
  deviating: number;
  language: LanguageFinding[];
  words: WordTypeFinding[];
  /** word-unknown word-types as bare strings, with no structure — may be truncated if even this doesn't fit the budget (see truncated). */
  wordsAll: string[];
  /** word-not-checked word-types as bare strings — separate from wordsAll (see the heading above). May be truncated the same way. */
  wordsNotCheckedAll: string[];
  /** The full count of word-types for BOTH defects together, before any truncation. */
  wordTypesTotal: number;
  truncated: {
    /** How many DETAILED rows are shown out of wordTypesTotal. */
    shown: number;
    total: number;
    /** How many word-unknown words are shown in wordsAll (out of wordsAllTotal). */
    wordsAllShown: number;
    wordsAllTotal: number;
    /** How many word-not-checked words are shown in wordsNotCheckedAll (out of wordsNotCheckedAllTotal). */
    wordsNotCheckedAllShown: number;
    wordsNotCheckedAllTotal: number;
    note: string;
  } | null;
}

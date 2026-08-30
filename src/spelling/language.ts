/**
 * The `language` family: NOT "is this language appropriate here" — the tool
 * fundamentally cannot know whether an English paragraph here is intentional
 * or a mistake (it could be a quote, a parallel translation, a term). So the
 * question is narrowed to what the document actually says about itself:
 * WHAT the text is tagged with, and where that tag is broken.
 *
 * REWRITTEN per the user's own words (five separate clarifications): a book
 * can hold two, three, or more languages; two texts can sit side by side,
 * one translating the other; short English insertions and quotes are
 * ordinary; the rules must generalize to any book, because everything
 * depends on the edition and the task. Together these kill the very idea of
 * a "dominant language" — in a parallel translation it doesn't even exist as
 * a concept, because the languages split roughly in half. The first edition
 * had a third detector, `language-foreign` ("a language other than the
 * dominant one, on a range with words"); on a multilingual edition it would
 * have flagged every legitimate quote as a defect. Removed together with the
 * very notion of a dominant language.
 *
 * Instead of a verdict — `tallyLanguages` returns an INVENTORY: how many
 * languages, how many ranges and words for each, what share, on which
 * pages. The same approach as in `styles_audit` — the tool shows the fact
 * and the location, and doesn't decide on its own, because 19 of 22
 * standalone verdicts there turned out to be wrong.
 *
 * What remains a REAL defect — and why it holds for any book:
 *  - `language-none` — a range WITH WORDS that has no language assigned at
 *    all. Neither spell-checking nor hyphenation applies to it — this
 *    doesn't depend on authorial intent, so it stays a defect and goes into
 *    `deviating`.
 *  - `language-stray` — a language that carries NOT A SINGLE word ANYWHERE
 *    in the whole document, yet is applied somewhere. It cannot be a content
 *    language — it's a stray tag. Measured on a real book: p. 66, Vietnamese
 *    on a single paragraph mark. NOT counted in `deviating` — it's harmless.
 *
 *    The key point: this is a property of the DOCUMENT AS A WHOLE, not of a
 *    local range. A language on an empty range is NOT a stray if that same
 *    language carries words elsewhere in the document (a bilingual book).
 *    The test for this distinction is exactly what separates
 *    `language-stray` from "a foreign language with no words" and makes the
 *    rule fair to a bilingual edition.
 *
 * Word boundaries follow the language of EACH range, not one language for
 * the whole document (fixed during review — the same defect already fixed
 * in the `dictionary` family, unknown.ts: WORDCHARS differs by language —
 * en_US doesn't treat a hyphen as part of a word, uk_UA does, en_GB also
 * treats a period as one. Cutting an English range with Ukrainian boundaries
 * would have counted "well-known" as ONE word instead of two. For
 * `language-none` and `language-stray` this doesn't change the verdict (no
 * boundary turns words into their absence or vice versa), but for
 * `tallyLanguages` it does: it's exactly the inventory numbers a human reads
 * to judge the book by, and measured with the wrong ruler they lie.
 */
import type { ContainerSnapshot } from "../corrections/types.js";
import { dictLangCode } from "./dictpath.js";
import { DEFAULT_WORD_AFF } from "./unknown.js";
import { splitWords } from "./words.js";
import { comparePageNames, MAX_PAGES_LISTED, pageAt } from "./types.js";
import type {
  Aff,
  ContainerLanguage,
  LanguageDefect,
  LanguageFinding,
  LanguageTally,
} from "./types.js";

const NO_LANGUAGE = "[No Language]";

/**
 * The `Aff` for this specific range — by its language's DICTIONARY CODE, not
 * by the document's language (the same choice as `detectUnknown`,
 * unknown.ts). A language with no dictionary code ("[No Language]", a name
 * InDesign doesn't recognize) or with no `Aff` recorded in the map falls
 * back to `DEFAULT_WORD_AFF` — conservative boundaries, not a guess.
 *
 * `override` — a parameter of the `languageDictionaries` call (spelling.ts,
 * spec §5.1): "in case of a tricky situation I'll note language-usage
 * specifics in the prompt" (the user's own words). Threaded all the way
 * through to here rather than staying at the dictionary-building level —
 * otherwise a book with a language outside the built-in table (e.g. Czech)
 * would get an in-memory dictionary that `affFor`/`dictLangCode` couldn't
 * find anyway without the override.
 */
function affFor(
  language: string,
  affs: Map<string, Aff>,
  override?: Record<string, string | null>,
): Aff {
  const code = dictLangCode(language, override);
  return (code === null ? undefined : affs.get(code)) ?? DEFAULT_WORD_AFF;
}

/**
 * The document's language inventory. Weight is WORDS (`splitWords`), NOT
 * ranges and NOT characters: otherwise a paragraph mark tagged with a
 * foreign language would weigh as much as a paragraph of prose, and the two
 * measured cases (p. 66 vs. p. 31) would come out indistinguishable or even
 * inverted (the "counts WORDS, not ranges" test).
 */
export function tallyLanguages(
  containers: ContainerSnapshot[],
  langs: ContainerLanguage[],
  affs: Map<string, Aff>,
  override?: Record<string, string | null>,
): LanguageTally[] {
  const byId = new Map(langs.map((l) => [l.containerId, l]));

  interface Acc {
    ranges: number;
    words: number;
    pages: Set<string>;
  }
  const acc = new Map<string, Acc>();
  let totalWords = 0;

  for (const c of containers) {
    for (const run of byId.get(c.containerId)?.runs ?? []) {
      const aff = affFor(run.language, affs, override);
      const words = splitWords(c.text.slice(run.start, run.end), aff).length;
      let a = acc.get(run.language);
      if (!a) {
        a = { ranges: 0, words: 0, pages: new Set() };
        acc.set(run.language, a);
      }
      a.ranges += 1;
      a.words += words;
      a.pages.add(pageAt(c, run.start));
      totalWords += words;
    }
  }

  const out: LanguageTally[] = [];
  for (const [language, a] of acc) {
    /* Pages are truncated with the same MAX_PAGES_LISTED as the word row, with
     * the total volume left in pageCount. Otherwise this row is the one
     * response field that grows with the book while sitting in the service
     * section that the report.ts budget RESERVES rather than trims: on this
     * book "Ukrainian" carried all 196 pages, and six languages of 900 pages
     * each gave 83,004 B against a 50,000 cap (proven by execution, the
     * branch's final review).
     *
     * Sorting is NOT cosmetic, and this is a fix after a re-measurement on
     * the book (2026-08-14). Insertion order into the `Set` is CONTAINER
     * order, and stories don't follow pages: without sorting the row gave
     * `["13","22","14","15","16","17"]`. While all pages were shown this
     * didn't matter; the moment they were truncated to six, order became the
     * very answer to "where does this language live." */
    const pages = [...a.pages].sort(comparePageNames);
    out.push({
      language,
      ranges: a.ranges,
      words: a.words,
      share: totalWords > 0 ? a.words / totalWords : 0,
      pages: pages.slice(0, MAX_PAGES_LISTED),
      pageCount: pages.length,
    });
  }
  /* The most important language comes first: sorting by words descending
   * makes the inventory readable without further processing. */
  out.sort((x, y) => y.words - x.words);
  return out;
}

/**
 * Two narrow defects — not a verdict on whether a language belongs, but a
 * check of the tag itself. `language-stray` looks at the language's weight
 * across the WHOLE document (`tallyLanguages`), not at a specific range: the
 * same language carrying words elsewhere means it's a legitimate content
 * language, not a stray tag.
 */
export function detectLanguage(
  containers: ContainerSnapshot[],
  langs: ContainerLanguage[],
  affs: Map<string, Aff>,
  override?: Record<string, string | null>,
): LanguageFinding[] {
  const byId = new Map(langs.map((l) => [l.containerId, l]));
  const wordsByLanguage = new Map(
    tallyLanguages(containers, langs, affs, override).map((t) => [t.language, t.words]),
  );

  const out: LanguageFinding[] = [];
  for (const c of containers) {
    for (const run of byId.get(c.containerId)?.runs ?? []) {
      const aff = affFor(run.language, affs, override);
      const text = c.text.slice(run.start, run.end);
      const words = splitWords(text, aff);
      const isNone = run.language === NO_LANGUAGE;

      let defect: LanguageDefect | null;
      if (isNone) {
        /* [No Language] with no words — nothing to check: neither spelling nor
         * hyphenation has anything to rely on here. */
        if (words.length === 0) continue;
        defect = "language-none";
      } else if ((wordsByLanguage.get(run.language) ?? 0) === 0) {
        defect = "language-stray";
      } else {
        continue;
      }

      out.push({
        defect,
        containerId: c.containerId,
        page: pageAt(c, run.start),
        language: run.language,
        start: run.start,
        end: run.end,
        words: words.length,
        sample: text.slice(0, 60).replace(/[\r\n]/g, "⏎"),
      });
    }
  }
  return out;
}

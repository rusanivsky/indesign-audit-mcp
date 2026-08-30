import { regexRule, type TypographyRule } from "./rule.js";

/**
 * The language-neutral core of the typographic set — the rules that are
 * IDENTICAL in all three locales (uk, en-US, en-GB).
 *
 * They moved here out of rules-uk.ts on 2026-08-25, when the English pack
 * appeared. The selection criterion is measured rather than a matter of taste:
 * on an English sample (docs/measured-facts-bilingual.md M1) these are the rules
 * that produced the CORRECT result — `don't → don’t`, `... → …`,
 * `1939-1945 → 1939–1945`, space collapsing. Everything that produced a WRONG
 * result on that same sample — quotes, the separator dash, the dialogue dash —
 * stayed in rules-uk.ts and gained a `locale` field.
 *
 * CRITICAL: `\s` includes `\r`, and in ExtendScript `\r` marks the end of a
 * paragraph. A rule using `\s` could eat a paragraph boundary — the same mistake
 * that produced C1 in Phase 1 (silent merging of two paragraphs). Wherever a
 * horizontal space is meant, `[^\S\r\n]` is used instead.
 *
 * Non-breaking spaces are DELIBERATELY excluded: they produce thousands of
 * matches and recompose the text most aggressively.
 */

/**
 * Horizontal space: everything whitespace-like except paragraph and line
 * separators, and except U+FEFF.
 *
 * U+FEFF is EXPLICITLY EXCLUDED, and this is not cosmetic. In JavaScript
 * `\s` includes U+FEFF (ZERO WIDTH NO-BREAK SPACE), so `[^\S\r\n]` was
 * catching it as an ordinary space. The consequence was measured on the
 * working book on 2026-08-15: nine `collapse-spaces` findings looked like
 * [U+FEFF U+FEFF] → [U+0020] — meaning the replacement wasn't removing
 * clutter, it was INSERTING a visible space before a section heading where
 * there had been no space at all. Verified by eye too — the p. 21 export
 * shows «ВАГІТНІСТЬ» with no indent.
 *
 * U+FEFF is zero-width by definition: it is never a space, no matter how
 * many appear in a row.
 */
const H = "[^\\S\\r\\n\\uFEFF]";

// ── Spaces and clutter ───────────────────────────────────────────────────────

const collapseSpaces = regexRule({
  id: "collapse-spaces",
  title: "Multiple spaces in a row → one",
  confidence: "high",
  find: new RegExp(`${H}{2,}`, "gu"),
  replace: " ",
});

const spaceBeforePunct = regexRule({
  id: "space-before-punct",
  title: "Space before a punctuation mark",
  confidence: "high",
  find: new RegExp(`${H}+([,.:;!?])`, "gu"),
  replace: "$1",
  /*
   * A COLON STANDING ALONE is DSTU'S PRESCRIBED PUNCTUATION, not a
   * typing mistake.
   *
   * Measured on p. 4 of the working book: «Назва книжки / Автор Авторенко. —
   * Київ : ВИДАВНИЦТВО, 2026. — 196 с.» In a bibliographic
   * description the space before the colon before the publisher is
   * REQUIRED, and a rule that strips "space before a punctuation mark"
   * would break the imprint data of EVERY book.
   * Worse: our two rule packages flatly contradicted each other on this
   * very page — `bibliography_audit` REQUIRES this exact punctuation.
   *
   * A signal available straight from the text itself: the mark has a
   * space on BOTH SIDES. Ordinary prose never writes it that way, so this
   * produces no false negatives. The exception applies ONLY to the colon and
   * the semicolon — prescribed punctuation uses exactly those two marks, while
   * a comma or a period never stand alone in any norm.
   *
   * THE SEMICOLON WAS MISSING HERE UNTIL 2026-08-26, and the omission cost
   * exactly what the paragraphs above warn about. DSTU 7.1 spaces the
   * semicolon too — between places of publication, and between the second and
   * later statements of responsibility — and this repository's own
   * `slashOnceRule` (`src/bibliography/rules-dstu.ts:230-233`) asserts that
   * form. So the two rule packages contradicted each other on the imprint page
   * a second time, in the same way, one mark over.
   *
   * Measured on the line this comment already cites:
   *   «… / Автор Авторенко ; ред. Р. Редакторенко. — Київ ; Харків : ТОВ, 2026.»
   * gave TWO matches, both `high`, and `typography_apply` writes `high`
   * without review (`src/tools/typography.ts:429-433`) — producing
   * «Авторенко; ред.» and «Київ; Харків». The colon on the same line was
   * protected while the semicolons beside it were not.
   *
   * The cost is stated out loud: a genuine typo like «слово : інше» in the
   * middle of prose now goes undetected. Missing a typo is cheaper than
   * corrupting imprint data.
   */
  except: (m, text) => {
    if (m[1] !== ":" && m[1] !== ";") return false;
    const after = text[m.index + m[0].length];
    return after === undefined || /\s/u.test(after);
  },
});

const spaceBeforeBreak = regexRule({
  id: "space-before-break",
  title: "Space before a paragraph mark",
  confidence: "high",
  find: new RegExp(`${H}+(?=[\\r\\n]|$)`, "gu"),
  replace: "",
});

const spaceAfterOpenParen = regexRule({
  id: "space-after-open-paren",
  title: "Space after an opening bracket",
  confidence: "high",
  find: new RegExp(`([([])${H}+`, "gu"),
  replace: "$1",
});

const spaceBeforeCloseParen = regexRule({
  id: "space-before-close-paren",
  title: "Space before a closing bracket",
  confidence: "high",
  find: new RegExp(`${H}+([)\\]])`, "gu"),
  replace: "$1",
});

/*
 * spaceBeforeBreak deliberately comes BEFORE collapseSpaces: when an entire
 * whitespace run sits directly before \r/\n/end of text, both rules match
 * the same range (e.g. "line   \r" — three spaces before \r). runRules and
 * rewrite sort by (start, end) with a stable sort, so on an exact
 * (start,end) tie the rule whose match landed in the array first wins —
 * i.e. whichever one appears earlier in this array. If collapseSpaces came
 * first here, it would "win" and leave one space instead of removing it
 * entirely before the paragraph mark.
 */
export const SPACING_RULES: TypographyRule[] = [
  spaceBeforeBreak,
  collapseSpaces,
  spaceBeforePunct,
  spaceAfterOpenParen,
  spaceBeforeCloseParen,
];

/** Hyphens and the en dash — anything that could turn out to be the wrong mark. */
const HYPHENS = "[-\\u2010\\u2011\\u2013]";

/** Numeric range: 1941-1945 → 1941–1945, en dash with no spaces. */
const rangeDashNumeric = regexRule({
  id: "range-dash-numeric",
  title: "Numeric range → en dash without spaces",
  confidence: "high",
  /*
   * `\d+`, NOT `\d{1,4}` — AND THE TWO GUARDS BELOW DEPEND ON IT.
   *
   * The capture used to be `\d{1,4}`, which made BOTH filters in `except`
   * dead letters, because a capture that cannot exceed four characters can
   * never trip `a.length > 4`, and a capture free to START ANYWHERE inside a
   * longer run never sees the leading zero either. The regex simply slid along
   * the number until it found a four-digit window that fit.
   *
   * Measured 2026-08-26, both at `high`, i.e. both written without review:
   *   «тел. 0671234-5678»   → matched «1234-5678» → «0671234–5678»
   *   «с. 123456-789012»    → matched «3456-7890» → «с. 123456–789012»
   * The `067` prefix was outside the window, so the mobile-prefix guard the
   * comment below describes never saw it; the run was seven digits long, so
   * the ">4 digits is not a year" guard never saw that either.
   *
   * Anchoring the capture to the WHOLE run restores both: a range is now
   * matched only when the digits on each side stand alone, which is precisely
   * what «1941-1945» and «12-15» look like and what a phone or reference
   * number does not.
   */
  find: new RegExp(`(\\d+)${H}*${HYPHENS}${H}*(\\d+)`, "gu"),
  replace: "$1–$2",
  /*
   * Longer numbers are no longer years or page numbers — most likely a
   * phone or reference number.
   *
   * Also: a digit group with a leading zero (067, 097, 050 …) is a typical
   * Ukrainian mobile-number prefix, not a year or a page (genuine ranges in
   * prose — «1941-1945», «12-15» — never start with a zero). Without this
   * exception, rangeDashNumeric broadly overlaps the narrower dashSeparator
   * match (e.g. in «тел. 067 - 123» its bounds [5,14) contain the
   * dashSeparator match [8,11)), and under the earliest-start overlap
   * resolution in rewrite() this wider, "high"-confidence match wins — the
   * phone number is silently turned into «067–123», even though
   * dashSeparator correctly flagged the spot as needing review.
   */
  except: (m, text) => {
    /*
     * A CHAIN OF DIGITS-SEPARATED-BY-HYPHENS THAT CONTINUES PAST THE MATCH
     * is a CODE, not a range. A range has exactly two members.
     *
     * Measured on p. 4: ISBN 978-966-1234-56-7 produced TWO matches
     * («978-966» and «1234-56»), and the replacement would have produced
     * «978–966-1234–56-7» — a corrupted ISBN on the imprint page. The
     * existing filters (>4 digits, leading zero) don't catch the ISBN: all
     * of its groups are short and have no leading zeros.
     *
     * We look at the ADJACENT hyphen specifically with a digit right after
     * it (or right before it), not just any hyphen: «10-11-му» is a genuine
     * range with a grammatical ending (a real form found in the book, p. 24),
     * and there a LETTER follows the hyphen, so the code chain doesn't
     * continue.
     */
    const start = m.index;
    const end = m.index + m[0].length;
    if (/[-‐‑–]/u.test(text[end] ?? "") && /\d/u.test(text[end + 1] ?? "")) return true;
    if (/[-‐‑–]/u.test(text[start - 1] ?? "") && /\d/u.test(text[start - 2] ?? "")) return true;

    const a = m[1] ?? "";
    const b = m[2] ?? "";
    if (a.length > 4 || b.length > 4) return true;
    if (/^0\d/u.test(a) || /^0\d/u.test(b)) return true;
    return false;
  },
});

/**
 * A geographic or similar range (Київ-Львів) → en dash. ALWAYS needs review:
 * telling «рейс Київ-Львів» apart from the compound word «синьо-жовтий»
 * can't be done automatically, and a mistake here corrupts the word.
 */
const rangeDashWords = regexRule({
  id: "range-dash-words",
  title: "Range between proper names → en dash",
  confidence: "needs-review",
  find: new RegExp(`(\\p{Lu}\\p{Ll}+)${HYPHENS}(\\p{Lu}\\p{Ll}+)`, "gu"),
  replace: "$1–$2",
});

const APOSTROPHES = "['`\\u00b4\\u02bc\\u2018]";

const apostrophe = regexRule({
  id: "apostrophe",
  title: "Apostrophe inside a word → typographic",
  confidence: "high",
  find: new RegExp(`(\\p{L})${APOSTROPHES}(\\p{L})`, "gu"),
  replace: "$1’$2",
});

const ellipsis = regexRule({
  id: "ellipsis",
  title: "Three dots → ellipsis",
  confidence: "high",
  find: /\.{3,}/gu,
  replace: "…",
});

/** Apostrophe and ellipsis — identical in Cyrillic and Latin. */
export const NEUTRAL_QUOTE_RULES: TypographyRule[] = [apostrophe, ellipsis];

/** En-dash ranges — identical in the Ukrainian and English conventions. */
export const NEUTRAL_DASH_RULES: TypographyRule[] = [rangeDashNumeric, rangeDashWords];

export { H, HYPHENS, apostrophe, ellipsis, rangeDashNumeric, rangeDashWords };

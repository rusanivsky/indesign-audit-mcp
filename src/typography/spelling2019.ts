/**
 * The 2019 orthography, the VARIANT half. This is NOT a rule: there's no
 * `match` and no `replacement` here, and `typography_apply` has physically
 * nothing to apply from it. Precedent — `auditOnly()` in rules-uk.ts, which
 * exists for exactly the same reason.
 *
 * The split into "no variants" and "variants" isn't our construction: the MON
 * (Ministry of Education) review itself split the changes this way. Both
 * forms of every pair are LEGITIMATE, so there can be no verdict here in
 * principle; the report's unit is a PAIR with each form's frequency.
 *
 * WHAT'S NOT HERE AND WHY:
 *  - the genitive in `-и` («радости»/«радості»): «радості» is also the
 *    dative and locative case, i.e. one half of the pair can't be counted
 *    cleanly, and the "both forms present" test would be false. If this class
 *    is ever needed, its form should be a ONE-SIDED inventory, not a pair
 *    (spec §4.4);
 *  - paragraph numbers: the MON review doesn't give them for the variant
 *    classes, and secondary sources give conflicting numbers. The LISTS
 *    themselves are taken from verbatim orthography quotes inside the review
 *    and aren't in doubt. A made-up number would cost more than not having
 *    one.
 *
 * HOW FORMS ARE COUNTED. This phase has no morphological analyzer (spec §2),
 * so each form carries EITHER `stem` — the start of the word, transcribed by
 * hand — OR `exact`, an exact list of word forms. `exact` is used where the
 * stem would collide with unrelated words («міт» against «мітинг», «мітла»).
 * Both halves of a pair are ALWAYS recognized the same way, otherwise their
 * numbers aren't comparable. A pinpoint exception is written into `except` —
 * the same technique `rangeDashNumeric.except` already uses in rules-uk.ts.
 *
 * The document-level collection (`collectVariantPairs`) is below: it consumes
 * `ContainerSnapshot` and `ContainerLanguage`, is gated by language via
 * `mergedRuns` (`./langgate.js`), and also does NOT write — it only returns
 * findings and inventory rows.
 */

import type { ContainerSnapshot } from "../corrections/types.js";
import type { ContainerLanguage } from "../spelling/types.js";
import { comparePageNames, MAX_PAGES_LISTED } from "../spelling/types.js";
import { DEFAULT_WORD_AFF } from "../spelling/unknown.js";
import { splitWords } from "../spelling/words.js";
import { mergedRuns } from "./langgate.js";

export type VariantClass = "au" | "th" | "и-" | "ґ";

export interface VariantForm {
  /** The dictionary form, as named by the orthography. */
  form: string;
  /** The start of the word used to recognize the form. Mutually exclusive with `exact`. */
  stem?: string;
  /** An exact list of word forms in lowercase. Mutually exclusive with `stem`. */
  exact?: string[];
  /** Words that start with `stem` but are NOT this form. */
  except?: RegExp;
}

export interface VariantPair {
  /** «ефір/етер» — both the key and what a human reads. */
  pairId: string;
  class: VariantClass;
  forms: [VariantForm, VariantForm];
}

const s = (form: string, stem: string, except?: RegExp): VariantForm =>
  except === undefined ? { form, stem } : { form, stem, except };

/** Exact list: the dictionary form plus the enumerated word forms. */
const e = (form: string, ...rest: string[]): VariantForm => ({
  form,
  exact: [form.toLocaleLowerCase("uk"), ...rest],
});

const pair = (
  a: VariantForm,
  b: VariantForm,
  cls: VariantClass,
): VariantPair => ({ pairId: `${a.form}/${b.form}`, class: cls, forms: [a, b] });

export const VARIANT_PAIRS: VariantPair[] = [
  // ── au / ав ────────────────────────────────────────────────────────────────
  pair(s("аудієнція", "аудієнц"), s("авдієнція", "авдієнц"), "au"),
  pair(s("аудиторія", "аудиторі"), s("авдиторія", "авдиторі"), "au"),
  pair(s("лауреат", "лауреат"), s("лавреат", "лавреат"), "au"),
  pair(s("пауза", "пауз"), s("павза", "павз"), "au"),
  pair(s("фауна", "фаун"), s("фавна", "фавн"), "au"),

  // ── θ: ф / т ───────────────────────────────────────────────────────────────
  pair(s("анафема", "анафем"), s("анатема", "анатем"), "th"),
  pair(s("дифірамб", "дифірамб"), s("дитирамб", "дитирамб"), "th"),
  pair(s("ефір", "ефір"), s("етер", "етер"), "th"),
  pair(s("кафедра", "кафедр"), s("катедра", "катедр"), "th"),
  pair(s("логарифм", "логарифм"), s("логаритм", "логаритм"), "th"),
  /* «міт» as a stem would catch «мітинг», «мітка», «мітла»; «міф» — «міфічний»,
   * «міфотворчість». Both halves use an exact list, so the numbers stay
   * comparable. */
  pair(
    e("міф", "міфу", "міфом", "міфі", "міфи", "міфів", "міфам", "міфами", "міфах"),
    e("міт", "міту", "мітом", "міті", "міти", "мітів", "мітам", "мітами", "мітах"),
    "th",
  ),
  pair(s("міфологія", "міфологі"), s("мітологія", "мітологі"), "th"),
  pair(s("Агатангел", "агатангел"), s("Агафангел", "агафангел"), "th"),
  pair(s("Афіни", "афін"), s("Атени", "атен"), "th"),
  pair(s("Борисфен", "борисфен"), s("Бористен", "бористен"), "th"),
  pair(s("Демосфен", "демосфен"), s("Демостен", "демостен"), "th"),
  /* «март» would catch «мартин», «мартіні», «мартен» — exact list. */
  pair(
    e("Марфа", "марфи", "марфі", "марфу", "марфою"),
    e("Марта", "марти", "марті", "марту", "мартою"),
    "th",
  ),
  pair(s("Фессалія", "фессалі"), s("Тессалія", "тессалі"), "th"),

  // ── initial и ──────────────────────────────────────────────────────────────
  /* There are exactly two variants of initial «и». «индик» is NOT a variant:
   * the orthography gives «і́ндик» unconditionally (spec §0). «ірі» as a stem
   * would catch «Ірина», «іріс» — hence the exact list. */
  pair(e("ірій", "ірію", "ірієм", "ірії"), e("ирій", "ирію", "ирієм", "ирії"), "и-"),
  pair(
    s("ірод", "ірод", /^іроді[ая]/u),
    s("ирод", "ирод", /^ироді[ая]/u),
    "и-",
  ),

  // ── ґ ──────────────────────────────────────────────────────────────────────
  pair(s("Вергілій", "вергілі"), s("Верґілій", "верґілі"), "ґ"),
  pair(s("Гегель", "гегел"), s("Геґель", "геґел"), "ґ"),
  /* «георг» would catch «Георгій», «Георгіївна», «георгін». */
  pair(s("Георг", "георг", /^георгі/u), s("Ґеорґ", "ґеорґ"), "ґ"),
  pair(s("Гарсія", "гарсі"), s("Ґарсія", "ґарсі"), "ґ"),
  /* «гете» would catch «гетероген», «гетера». */
  pair(s("Гете", "гете", /^гетер/u), s("Ґете", "ґете"), "ґ"),
  pair(s("Грегуар", "грегуар"), s("Ґреґуар", "ґреґуар"), "ґ"),
  pair(s("Гуллівер", "гуллівер"), s("Ґуллівер", "ґуллівер"), "ґ"),
];

export const SPELLING2019_CAVEAT =
  "Both forms of every pair are LEGAL — these are not errors, they are variants of the 2019 orthography, " +
  "and the choice between them belongs to the publication, not the tool. Only a pair where " +
  "BOTH forms occurred (mixed) is a finding: a consistent edition can't be faulted for " +
  "that. The prevailing form is NOT computed and is not named as the reference. The 'th' class " +
  "closes in the orthography with the words \"and others\" — meaning the list in the orthography itself is " +
  "OPEN, while ours is closed: we enumerate what's named and don't guess. Forms " +
  "are recognized by the start of the word or an exact list of word forms, without " +
  "a morphological analyzer: derived adjectives mostly aren't counted. " +
  "Only ranges with the Ukrainian language are counted — on a localized InDesign " +
  "build the family will silently return zeros, so look at ukrainianRuns. " +
  "skippedByLanguage under this same key belongs not to the variant half (here " +
  "there really are no 'skipped' — see above), but to the MANDATORY one: these are hits from uk2019-proiekt, " +
  "uk2019-compound, uk2019-sviashchennyk that crossed the language boundary and are reported under " +
  "groups. The number reads as 0 both when ruleIds excluded all three " +
  "2019 rules from the mandatory half — that's the same zero for a different reason, " +
  "not a guarantee of no overlap.";

/**
 * Recognizes a word's form: walks VARIANT_PAIRS in table order and for each
 * form of a pair checks its exact list or stem (whichever the form has). NOT
 * "all exact lists first, then all stems" — the check goes pair by pair, in
 * the order the array declares them. There can be no ambiguity here: a
 * structural test proves that no stem is the start of another (and, together
 * with the extension below, that no stem is the start of another pair's
 * exact word form), so the first match is the only one.
 */
export function matchVariantForm(word: string): { pairId: string; form: string } | null {
  const w = word.toLocaleLowerCase("uk");
  for (const p of VARIANT_PAIRS) {
    for (const f of p.forms) {
      if (f.exact !== undefined) {
        if (f.exact.includes(w)) return { pairId: p.pairId, form: f.form };
        continue;
      }
      if (f.stem === undefined || !w.startsWith(f.stem)) continue;
      if (f.except?.test(w) === true) continue;
      return { pairId: p.pairId, form: f.form };
    }
  }
  return null;
}

export interface VariantFormCount {
  form: string;
  count: number;
  /** The first MAX_PAGES_LISTED pages, in order of appearance. The full count is in pageCount. */
  pages: string[];
  pageCount: number;
}

export interface VariantPairFinding {
  pairId: string;
  class: VariantClass;
  /** Only the forms that actually occurred: one — inventory, two — a finding. */
  forms: VariantFormCount[];
  /** Both forms are present. No MODE is computed and neither is called the reference. */
  mixed: boolean;
}

/*
 * The fallback is the LAST page (`.at(-1)`), the same choice as in
 * tools/typography.ts and corrections/planner.ts. It doesn't trigger on an
 * empty pageRuns (there both `.at(-1)` and `[0]` would equally give
 * undefined), but when the offset lies OUTSIDE every run in a NON-EMPTY
 * pageRuns — and that's a real, not hypothetical, state: the language ranges
 * here (language_runs_read, spelling.jsx) are read from
 * story.textStyleRanges and cover the story's FULL text, including overset,
 * while pageRunsFor (inspect.jsx) only sees placed frames. A word inside
 * overset text produces exactly this case, and corrections/planner.ts
 * (warningsFor, `in-overset`) deliberately catches such spots instead of
 * discarding them — the same interpretation applies here: invisible text
 * logically continues the LAST visible page rather than starting from the
 * first. This line used to have `[0]` — a discrepancy with typography.ts that
 * review caught; now aligned.
 */
function pageAt(c: ContainerSnapshot, offset: number): string {
  for (const r of c.pageRuns) if (offset >= r.start && offset < r.end) return r.page;
  return c.pageRuns.at(-1)?.page ?? "?";
}

/**
 * The document-wide inventory of pairs. Foreign-language text never enters
 * here at all — only words inside ranges of the required language are
 * counted, so there's no "discarded" here: unscanned isn't the same as
 * filtered out. Master pages are outside the audit's scope — the same
 * boundary already held by typography_audit, spelling_audit, and
 * bibliography_audit.
 */
export function collectVariantPairs(
  containers: ContainerSnapshot[],
  langs: ContainerLanguage[],
  language: string,
): { pairs: VariantPairFinding[]; mixedCount: number } {
  const runsById = mergedRuns(langs);
  const acc = new Map<string, Map<string, { count: number; pages: string[]; seen: Set<string> }>>();

  for (const c of containers) {
    if (c.isMaster) continue;
    for (const run of runsById.get(c.containerId) ?? []) {
      if (run.language !== language) continue;
      const slice = c.text.slice(run.start, run.end);
      /* Word boundaries are taken from the SAME splitWords used by the dictionary
       * family: two implementations of word boundaries would inevitably drift
       * apart. */
      for (const w of splitWords(slice, DEFAULT_WORD_AFF)) {
        const hit = matchVariantForm(w.text);
        if (hit === null) continue;
        const forms = acc.get(hit.pairId) ?? new Map();
        acc.set(hit.pairId, forms);
        const cell = forms.get(hit.form) ?? { count: 0, pages: [], seen: new Set<string>() };
        cell.count++;
        const page = pageAt(c, run.start + w.start);
        if (!cell.seen.has(page)) {
          cell.seen.add(page);
          cell.pages.push(page);
        }
        forms.set(hit.form, cell);
      }
    }
  }

  const pairs: VariantPairFinding[] = [];
  let mixedCount = 0;
  for (const p of VARIANT_PAIRS) {
    const forms = acc.get(p.pairId);
    if (forms === undefined) continue;
    const rows: VariantFormCount[] = [];
    for (const f of p.forms) {
      const cell = forms.get(f.form);
      if (cell === undefined) continue;
      rows.push({
        form: f.form,
        count: cell.count,
        pages: [...cell.pages].sort(comparePageNames).slice(0, MAX_PAGES_LISTED),
        pageCount: cell.pages.length,
      });
    }
    const mixed = rows.length === 2;
    if (mixed) mixedCount++;
    pairs.push({ pairId: p.pairId, class: p.class, forms: rows, mixed });
  }

  /* Findings first, the rest in table order. The sort is stable, so the
   * order within each group is deterministic. */
  pairs.sort((a, b) => Number(b.mixed) - Number(a.mixed));
  return { pairs, mixedCount };
}

import { regexRule, type RawMatch, type TypographyRule } from "./rule.js";
import { H, HYPHENS, NEUTRAL_DASH_RULES, NEUTRAL_QUOTE_RULES, SPACING_RULES } from "./rules-shared.js";
import type { Locale } from "./locale.js";

/**
 * The English typographic set — TWO SCHOOLS, not one.
 *
 * British and American practice diverge at exactly the points where the
 * Ukrainian set produced a wrong result on English text (measured:
 * docs/measured-facts-bilingual.md M1), so "add English" without choosing a
 * school is not a thing that exists — the choice of school IS the English pack:
 *
 *                        en-US (Chicago)          en-GB (New Hart's Rules)
 *   outer quotes         “ ”                      ‘ ’
 *   nested quotes        ‘ ’                      “ ”
 *   parenthetical dash   —  unspaced              –  spaced
 *   double hyphen --     —                        –
 *
 * What the two schools SHARE (apostrophe, ellipsis, numeric range, spacing) is
 * not duplicated here — it lives in rules-shared.ts and is in both packs.
 *
 * WHAT THIS PACK DELIBERATELY DOES NOT DO. Logical versus syntactic punctuation
 * — British `‘word’,` against American `“word,”` — moves the comma ACROSS the
 * quote mark, which reorders characters rather than substituting one. A rule
 * that moves punctuation cannot tell a quotation from a title and would corrupt
 * both; that difference between the schools is left to a human.
 */

// ── Quotes ───────────────────────────────────────────────────────────────────

/* Straight marks still to be converted, and finished curly ones — both are input. */
const DOUBLE = /["“”]/u;
const SINGLE = /['‘’]/u;

/* What a mark must follow to count as opening. The same pattern as matchQuotes
 * for Ukrainian, plus the English curly glyphs: a straight mark right after “ or
 * ‘ almost always opens a nested level rather than closing the one just opened. */
const BEFORE_OPENING = /[\s(\[—–‒“‘„«-]/u;

interface QuoteStyle {
  /** Outer level: [opening, closing]. */
  outer: [string, string];
  /** Nested level. */
  inner: [string, string];
}

export const US_QUOTES: QuoteStyle = { outer: ["“", "”"], inner: ["‘", "’"] };
export const GB_QUOTES: QuoteStyle = { outer: ["‘", "’"], inner: ["“", "”"] };

/**
 * Nesting-depth counter — the same principle as the Ukrainian matchQuotes: which
 * glyph is wanted depends on depth, and depth accumulates during the pass, so a
 * regular expression cannot do this.
 *
 * The difference from the Ukrainian version is that BOTH kinds of mark are
 * style-driven here, not one. In Ukrainian «» are always the outer pair, so they
 * could be counted as fixed. Here whether “ ” is outer (US) or nested (GB)
 * depends on the school, and ONE counter drives both kinds.
 */
function matchQuotesEn(style: QuoteStyle): (text: string) => RawMatch[] {
  const level = (depth: number): [string, string] => (depth === 0 ? style.outer : style.inner);

  return (text: string): RawMatch[] => {
    const out: RawMatch[] = [];
    let depth = 0;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!;
      const isDouble = DOUBLE.test(ch);
      const isSingle = SINGLE.test(ch);
      if (!isDouble && !isSingle) continue;

      const prev = text[i - 1];
      const next = text[i + 1];

      /* Inches and feet: 15" and 6' are units, not quotes. */
      if (prev !== undefined && /\d/u.test(prev)) continue;

      /*
       * AN APOSTROPHE, NOT A QUOTE. A single mark between two letters is always
       * a contraction (don't, it's), and the neutral `apostrophe` rule in
       * rules-shared.ts already normalises it. If it reached this loop the depth
       * counter would read every "don't" as an opened quote and skew every
       * subsequent level in the paragraph.
       */
      if (isSingle && prev !== undefined && next !== undefined
        && /\p{L}/u.test(prev) && /\p{L}/u.test(next)) continue;

      const opening = prev === undefined || BEFORE_OPENING.test(prev);
      const [o, c] = level(opening ? depth : Math.max(0, depth - 1));
      let want: string;
      if (opening) {
        want = o;
        depth++;
      } else {
        depth = Math.max(0, depth - 1);
        want = c;
      }

      /* A match that changes nothing is not a match — the same invariant that
       * tests/unit/typography-rule.test.ts proves for regexRule. */
      if (want !== ch) out.push({ start: i, end: i + 1, replacement: want });
    }
    return out;
  };
}

/**
 * A SINGLE MARK NEXT TO `s` OR A DIGIT IS DOUBTFUL, and that is a limit of the
 * method rather than caution. `the boys' books` (possessive plural) and `the
 * '90s` (elision) present exactly the same context as a closing single quote,
 * and nothing in the text distinguishes them. Both cases want ’ (U+2019) — the
 * same glyph as the closing quote — so a mistake here does not corrupt the
 * CHARACTER, it corrupts the DEPTH COUNTER for the rest of the paragraph. The
 * match therefore survives, but is confirmed one by one.
 */
function doubtfulSingle(m: RawMatch, text: string): boolean {
  const ch = text[m.start] ?? "";
  if (!SINGLE.test(ch)) return false;
  const prev = text[m.start - 1] ?? "";
  const next = text[m.start + 1] ?? "";
  return /[s\d]/u.test(prev) || /\d/u.test(next);
}

function quoteRule(id: string, title: string, locale: Locale, style: QuoteStyle): TypographyRule {
  return {
    id,
    title,
    confidence: "high",
    locale,
    match: matchQuotesEn(style),
    review: doubtfulSingle,
  };
}

const quotesUs = quoteRule(
  "en-quotes-us",
  'Straight quotes → “curly”, nested → ‘single’ (Chicago)',
  "en-US",
  US_QUOTES,
);

const quotesGb = quoteRule(
  "en-quotes-gb",
  "Straight quotes → ‘curly’, nested → “double” (Oxford)",
  "en-GB",
  GB_QUOTES,
);

/**
 * Word-initial elision: '90s, 'tis, 'em need the RIGHT single quote (’), not the
 * left one (‘), because the mark stands in for dropped letters rather than
 * opening a quotation. No word processor gets this right — they all insert ‘ —
 * which makes it the most common mechanical error in English typesetting.
 *
 * Shared by both schools: elision does not depend on which quotes are outer.
 */
const elision = regexRule({
  id: "en-elision-apostrophe",
  title: "Elision apostrophe ('90s, 'tis) → right single quote",
  confidence: "high",
  find: /(^|[\s(\[])['‘](\d\ds\b|\d\d\b|tis\b|twas\b|em\b|til\b|round\b|cause\b)/gimu,
  replace: (m) => `${m[1] ?? ""}’${m[2] ?? ""}`,
});

// ── Dashes ───────────────────────────────────────────────────────────────────

/*
 * THE PARENTHETICAL DASH IS THE ONE DIFFERENCE BETWEEN THE SCHOOLS THAT CAN BE
 * MADE MECHANICALLY.
 *
 * Chicago 6.85: em dash with NO spaces ("the result—a mess—was clear").
 * New Hart's Rules 4.11: en dash WITH spaces ("the result – a mess – was
 * clear"). The Ukrainian set produced an EM DASH WITH SPACES, matching neither
 * (measured, M1) — which is why "add the British school" could not be reduced to
 * switching an existing rule on.
 *
 * The spaces are part of the MATCH, not just the hyphen: the American convention
 * REMOVES them, so they have to be inside the replaced range.
 */
const DASHES_SPACED = `${H}+[-\\u2010\\u2011\\u2013\\u2014]${H}+`;

/* A digit before the dash means a broken-up number, not a parenthetical dash.
 * The same guard as the Ukrainian dashSeparator: "tel. 067 - 123" is not an
 * interpolated clause. */
const phoneish = (m: RawMatch, text: string): boolean =>
  /\d/u.test(text.slice(Math.max(0, m.start - 6), m.start));

/*
 * ЗОНА ВИХІДНИХ ВІДОМОСТЕЙ — І ЧОМУ ЦЕ ЗНАДОБИЛОСЬ ЛИШЕ АНГЛІЙСЬКОМУ ПАКЕТУ.
 *
 * Знайдено живим прогоном 2026-08-27, на першій англійській книжці, що пройшла
 * крізь пакет Chicago. На сторінці вихідних відомостей стоїть бібліографічний
 * запис, і `en-dash-parenthetical-us` дав на ньому збіг `high` — а `high`
 * пишеться без перегляду.
 *
 * Українською цього не було видно, і не через недогляд: ДСТУ розділяє зони
 * записом « — » (тире В ПРОБІЛАХ), і українська конвенція вимагає рівно такого
 * самого тире в пробілах. Міняти нічого — збігу немає. Chicago ж вимагає тире
 * БЕЗ пробілів, Oxford — коротке в пробілах, тож конвенція вперше вступає в
 * суперечку зі стандартом саме на перекладеному виданні. Колізію створює
 * перемикання мови, а не текст.
 *
 * Ознака береться з САМОГО ТЕКСТУ, а не з номера сторінки: приписна пунктуація
 * ДСТУ (« : » або « ; » у пробілах з обох боків) чи ISBN у тому самому абзаці.
 * Той самий сигнал, що вже боронить двокрапку в `rules-shared.ts`, і та сама
 * підстава: звичайна проза так не пише. Правило мусить узагальнюватись на будь-яке
 * видання, тож воно не знає ні сторінки, ні назви — лише форму запису.
 *
 * ЦІНА НАЗВАНА ВГОЛОС: справжнє вставне тире в абзаці, який ще й несе
 * бібліографічний запис, лишиться незапропонованим. Пропустити тире дешевше,
 * ніж зіпсувати вихідні відомості — той самий обмін, що й у спільному правилі.
 */
const PRESCRIBED_PUNCT = /\s[:;]\s/u;
const ISBN_ISH = /\bISB[NM]\b|\b97[89][\s\u2010-\u2015-]\d/u;

/**
 * Абзац, усередині якого стоїть збіг: приписна пунктуація може бути з будь-якого боку.
 *
 * МЕЖА РАХУЄТЬСЯ ЛИШЕ ПО `\r`, І ЦЕ НЕ ДРІБНИЦЯ. В InDesign `\r` — кінець
 * абзацу, а `\n` — примусовий розрив рядка ВСЕРЕДИНІ нього. Перша редакція
 * різала й по `\n` — і на живій верстці виняток мовчав би саме там, де
 * потрібен: набірник ламає бібліографічний запис руками, розрив стає між
 * приписною двокрапкою й другим тире, і той шматок уже не має жодної ознаки
 * запису. Зміряно на справжньому документі 2026-08-27, тест нижче тримає цю
 * форму.
 */
function paragraphAround(text: string, index: number): string {
  const from = text.lastIndexOf("\r", index) + 1;
  const end = text.indexOf("\r", index);
  return text.slice(from, end === -1 ? text.length : end);
}

const inBibliographicRecord = (index: number, text: string): boolean => {
  const para = paragraphAround(text, index);
  return PRESCRIBED_PUNCT.test(para) || ISBN_ISH.test(para);
};

const dashUs = regexRule({
  id: "en-dash-parenthetical-us",
  title: "Parenthetical dash → em dash, unspaced (Chicago)",
  confidence: "high",
  locale: "en-US",
  find: new RegExp(DASHES_SPACED, "gu"),
  replace: "—",
  except: (m, text) => inBibliographicRecord(m.index, text),
  review: phoneish,
});

const dashGb = regexRule({
  id: "en-dash-parenthetical-gb",
  title: "Parenthetical dash → en dash, spaced (Oxford)",
  confidence: "high",
  locale: "en-GB",
  find: new RegExp(DASHES_SPACED, "gu"),
  replace: " – ",
  except: (m, text) => inBibliographicRecord(m.index, text),
  review: phoneish,
});

/**
 * The double hyphen -- : a typewriter residue that survives in manuscripts. Both
 * schools replace it, but with DIFFERENT marks, so there are two rules.
 */
const doubleHyphenUs = regexRule({
  id: "en-double-hyphen-us",
  title: "Double hyphen -- → em dash (Chicago)",
  confidence: "high",
  locale: "en-US",
  find: /(\S)-{2,3}(\S)/gu,
  replace: "$1—$2",
});

const doubleHyphenGb = regexRule({
  id: "en-double-hyphen-gb",
  title: "Double hyphen -- → spaced en dash (Oxford)",
  confidence: "high",
  locale: "en-GB",
  find: /(\S)-{2,3}(\S)/gu,
  replace: "$1 – $2",
});

// ── Packs ────────────────────────────────────────────────────────────────────

export const EN_US_ONLY_RULES: TypographyRule[] = [quotesUs, dashUs, doubleHyphenUs, elision];
export const EN_GB_ONLY_RULES: TypographyRule[] = [quotesGb, dashGb, doubleHyphenGb, elision];

/** The complete American pack: the shared core plus the American school. */
export const EN_US_RULES: TypographyRule[] = [
  ...SPACING_RULES,
  ...NEUTRAL_DASH_RULES,
  ...NEUTRAL_QUOTE_RULES,
  ...EN_US_ONLY_RULES,
];

/** The complete British pack: the same core plus the British school. */
export const EN_GB_RULES: TypographyRule[] = [
  ...SPACING_RULES,
  ...NEUTRAL_DASH_RULES,
  ...NEUTRAL_QUOTE_RULES,
  ...EN_GB_ONLY_RULES,
];

export { HYPHENS };

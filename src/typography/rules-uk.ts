import { type RawMatch, type TypographyRule } from "./rule.js";
import { regexRule } from "./rule.js";
import { UK_LANGUAGE } from "./langgate.js";
import {
  H,
  HYPHENS,
  SPACING_RULES,
  apostrophe,
  ellipsis,
  rangeDashNumeric,
  rangeDashWords,
} from "./rules-shared.js";

/*
 * The language-neutral rules (spacing, apostrophe, ellipsis, numeric ranges)
 * live in rules-shared.ts and are used by all three locales. What remains here
 * is only what belongs to the Ukrainian set specifically. SPACING_RULES,
 * QUOTE_RULES and DASH_RULES are re-exported with the same members IN THE SAME
 * ORDER as before the split: spaceBeforeBreak versus collapseSpaces depends on
 * that order, and the existing tests rely on it.
 */
export { SPACING_RULES };


/**
 * B2. Ukrainian typography package: three groups, chosen by the user.
 *
 * Non-breaking spaces are DELIBERATELY excluded: they produce thousands of
 * matches and recompose the text most aggressively.
 *
 * CRITICAL: `\s` includes `\r`, and in ExtendScript `\r` marks the end of a
 * paragraph. A rule using `\s` could eat a paragraph boundary — the same
 * mistake that produced C1 in Phase 1 (silent merging of two paragraphs).
 * Wherever a horizontal space is meant, `[^\S\r\n]` is used instead.
 */

// ── Dashes and hyphens ───────────────────────────────────────────────────────


/**
 * A hyphen between HORIZONTAL spaces → em dash. The `[^\S\r\n]` class instead
 * of `\s` here isn't cosmetic: with `\s` the rule would grab a paragraph mark
 * and silently merge two paragraphs.
 *
 * An ambiguous case — a digit before the hyphen: «тел. 067 - 123» isn't a
 * dash, it's a broken-up phone number. Such matches aren't discarded — they
 * go into the needs-review list.
 */
const dashSeparator = regexRule({
  id: "dash-separator",
  title: "Hyphen between spaces → em dash",
  confidence: "high",
  locale: "uk",
  find: new RegExp(`(${H})${HYPHENS}(${H})`, "gu"),
  replace: "$1—$2",
  review: (m, text) => /\d/u.test(text.slice(Math.max(0, m.start - 6), m.start)),
});

/** A hyphen at the start of a line of dialogue. */
const dialogueDash = regexRule({
  id: "dialogue-dash",
  title: "Hyphen at the start of dialogue → em dash",
  confidence: "high",
  locale: "uk",
  find: new RegExp(`(^|[\\r\\n])${HYPHENS}(${H})`, "gu"),
  replace: "$1—$2",
});

export const DASH_RULES: TypographyRule[] = [
  dialogueDash,
  dashSeparator,
  rangeDashNumeric,
  rangeDashWords,
];


// ── Quotes, apostrophe, dots ─────────────────────────────────────────────────



/**
 * Quotes don't lend themselves to a regular expression: the choice of mark
 * depends on nesting depth, which accumulates over the course of the pass.
 * Hence a dedicated matcher.
 *
 * Convention CHOSEN BY THE USER on 2026-07-31: outer «guillemets», inner
 * “curly quotes”. That's what typography.org.ua prescribes in its
 * «Вкладені лапки» ("Nested quotes") section; „German-style“ quotes are
 * named there as a separate whole-text style, not a nesting level.
 *
 * The rule must be IDEMPOTENT: “ and ” are both an input (they must be
 * re-countable if the nesting changed) and an output. The matcher only
 * emits a match when the mark DIFFERS from what's already there — otherwise
 * a repeat pass and the end-to-end audit would report hundreds of
 * "corrections" that change nothing.
 */
const STRAIGHT_QUOTE = /["“”]/u;
/*
 * What a quote counts as opening after. Includes «: without it, a straight
 * quote right after a literal «, with no space («"Мати"»), would land in
 * the CLOSING branch (prev === «, and « wasn't in the class) and corrupt the
 * text — «"Мати" would become «»Мати» instead of «"Мати". » was added for
 * the same reason: a straight quote right after a closing » is likewise
 * almost always opening a new nested quote, not closing the one just closed.
 */
const BEFORE_OPENING = /[\s(\[—–‒«»-]/u;

function matchQuotes(text: string): RawMatch[] {
  const out: RawMatch[] = [];
  let depth = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    /*
     * «» are already canonical outer quotes: the glyph itself encodes its
     * opening/closing role, so no heuristic (opening/BEFORE_OPENING) is
     * needed here. But they MUST still change the nesting depth — otherwise
     * the next straight quote inside them would count itself at the wrong
     * nesting level and break idempotency (e.g. «роман “Мати” тут» — without
     * this, the «“» inside « » would be treated as outer, because depth
     * would stay at 0).
     */
    if (ch === "«") { depth++; continue; }
    if (ch === "»") { depth = Math.max(0, depth - 1); continue; }
    if (!STRAIGHT_QUOTE.test(ch)) continue;

    const prev = text[i - 1];
    /* Inches: 15" isn't a quote mark, it's a unit. Skipped silently. */
    if (prev !== undefined && /\d/u.test(prev)) continue;

    const opening = prev === undefined || BEFORE_OPENING.test(prev);
    let want: string;
    if (opening) {
      want = depth === 0 ? "«" : "“";
      depth++;
    } else {
      depth = Math.max(0, depth - 1);
      want = depth === 0 ? "»" : "”";
    }
    /* The depth is already accounted for — but a match is emitted only where
     * the mark actually differs. Without this, a repeat pass and
     * typography_audit would report hundreds of "corrections" that change
     * nothing. */
    if (want !== ch) out.push({ start: i, end: i + 1, replacement: want });
  }
  return out;
}

const quotes: TypographyRule = {
  id: "quotes-uk",
  title: "Straight quotes → «guillemets», nested → “curly”",
  confidence: "high",
  locale: "uk",
  match: matchQuotes,
  /*
   * A WELL-FORMED “ENGLISH” QUOTE IS ONLY A CANDIDATE, NEVER A SURE FIX.
   *
   * A straight ASCII quote (") in Ukrainian text is wrong ALWAYS, no matter
   * the nesting level — there's nothing to hesitate over there, and it
   * stays "high". But “ ” is a LEGITIMATE second level of the Ukrainian
   * convention (outer guillemets, curly inside), and whether it sits at its
   * correct level isn't visible from the text alone.
   *
   * Measured on the working book on 2026-08-15: 8 findings out of 8 were
   * false positives. On p. 24 the quotation sits inside a CALLOUT BOX with a
   * decorative 150 pt quote mark, meaning the quotation's outer level is
   * expressed GRAPHICALLY, not by a character. The depth counter in
   * matchQuotes only counts «» characters and has no way to see the callout
   * box — for it depth === 0, so it confidently proposed « » in place of the
   * legitimate “ ”, i.e. it was BREAKING SOMETHING CORRECT.
   *
   * A page's visual design is inaccessible to a text rule by construction,
   * so the only honest answer is not a verdict but a candidate: the
   * decision stays with the person who sees the page. The same pattern
   * already used for names like `La Roche-Posay` in range-dash-words.
   */
  review: (m, text) => /[“”]/u.test(text[m.start] ?? ""),
};

export const QUOTE_RULES: TypographyRule[] = [quotes, apostrophe, ellipsis];

// ── 2019 orthography: mandatory half ─────────────────────────────────────────

/*
 * Every rule in this section has language: UK_LANGUAGE. Orthography rules
 * applied to foreign-language text destroy it: «проект» is a correct
 * Russian word, and a rule that rewrites it inside a quotation would
 * silently corrupt the text.
 *
 * The `i` flag is safe here: none of this section's rules rely on
 * `\p{Ll}`. In `uk2019-compound` (below) one does, and there `i` is
 * forbidden.
 */

/**
 * Sound [j]: «проект» → «проєкт». §126 of the full orthography text (not
 * §35 — that one covers compound words); quote from the МОН [Ministry of
 * Education and Science] review:
 *
 *   «Звук [j] звичайно передаємо відповідно до вимови іншомовного слова буквою
 *   й, а в складі звукосполучень [je], [ji], [ju], [ja] буквами є, ї, ю, я»
 *
 * A CLOSED list of stems, not a general «о+е» pattern: generalizing would
 * catch «поет», «поему», «Європу», and any other «ое». The core, named
 * directly by the source, is «проєкт»/«проєкція» and their derivatives; they
 * all share the opening «прое» before «к». The paragraph's other examples
 * (конвеєр, плеєр, фоє, феєрверк) are separate lemmas: they're included ONLY
 * if their pre-reform form actually occurs in the book (checked by Task 10);
 * we don't write an empty rule.
 */
const uk2019Proiekt = regexRule({
  id: "uk2019-proiekt",
  title: "«проект» → «проєкт» (sound [j], 2019 orthography)",
  confidence: "high",
  language: UK_LANGUAGE,
  find: /прое(?=к)/giu,
  replace: (m) => m[0].replace(/е/u, "є").replace(/Е/u, "Є"),
});

/**
 * §29, gemination at the boundary of the root and the `-ник` suffix:
 * «письменник, священник». A single lemma, named by the source by name —
 * the safest prescriptive rule of the phase.
 *
 * IDEMPOTENT with no exception needed: «священник» doesn't contain the
 * substring «священик» (after «священ» there stands «н», not «и»).
 *
 * The rule does NOT take derivatives («священницький»): the source doesn't
 * name them, and guessing in a prescriptive rule would do more harm than
 * skipping them.
 */
const uk2019Sviashchennyk = regexRule({
  id: "uk2019-sviashchennyk",
  title: "«священик» → «священник» (§29, 2019 orthography)",
  confidence: "high",
  language: UK_LANGUAGE,
  find: /священик/giu,
  replace: (m) => {
    const w = m[0];
    /* «священник» differs from «священика» by exactly one doubled «н», and
     * that very «н» already sits in the match (index 5). We duplicate IT,
     * rather than writing a letter of our own: the case is preserved by
     * construction, as in uk2019-proiekt, and no list of canonical forms is
     * needed. */
    return w.slice(0, 6) + w[5]! + w.slice(6);
  },
});

/*
 * §35 of the full orthography text (the МОН review calls this material
 * §36 — the source numbering diverges, see
 * docs/measured-facts-phase11.md). Three lists of the first component,
 * transcribed verbatim and NOT padded with guesswork. Cross-checked on
 * 2026-08-14 against three sources; that check closed the open risk from
 * spec §10 and allowed «веб-» and «прес-» to be added.
 */

/** §35 item 2 — regularly used foreign-origin components. */
const COMPOUND_REGULAR = [
  "абро", "авіа", "авто", "агро", "аеро", "аква", "алко", "арт", "астро", "аудіо",
  "біо", "боди", "боді", "веб", "геліо", "гео", "гідро", "дендро", "екзо", "еко",
  "економ", "етно", "євро", "зоо", "ізо", "кібер", "мета", "метео", "моно", "мото",
  "нарко", "нео", "онко", "палео", "пан", "пара", "поп", "прес", "псевдо", "смарт",
  "соціо", "теле", "фіто", "фолк", "фольк", "фоно",
];

/** §35 item 3 — a component with a quantitative meaning. */
const COMPOUND_QUANTITY = [
  "архі", "архи", "бліц", "гіпер", "екстра", "макро", "максі", "міді", "мікро",
  "міні", "мульти", "нано", "полі", "преміум", "супер", "топ", "ультра", "флеш",
];

/** §35 item 4. */
const COMPOUND_RANK = ["анти", "віце", "екс", "контр", "лейб", "обер", "штабс", "унтер"];

/**
 * Components that are also standalone nouns in the nominative case. A
 * hyphen after them may join two EQUAL words («пара-трійка») rather than
 * attaching a prefix, and there's no automatic way to tell the two apart.
 * Such a match isn't discarded — it's downgraded to needs-review: it goes
 * into the report, but `typography_apply` doesn't apply it by default. The
 * same technique already used by rangeDashWords («Київ-Львів» vs.
 * «синьо-жовтий»).
 */
const COMPOUND_HOMOGRAPHS = new Set([
  "арт", "авто", "мета", "пан", "пара", "поп", "прес", "топ", "флеш", "бліц",
]);

/** «веб» → «[вВ]еб»: this rule CANNOT carry the `i` flag (see below). */
function anyInitialCase(component: string): string {
  const head = component[0]!;
  return `[${head}${head.toLocaleUpperCase("uk")}]${component.slice(1)}`;
}

const COMPOUND_ALTERNATION = [...COMPOUND_REGULAR, ...COMPOUND_QUANTITY, ...COMPOUND_RANK]
  /* Longest first — so the alternation reads unambiguously even where the
   * engine might otherwise stop at the shorter one («еко» vs. «економ»). */
  .sort((a, b) => b.length - a.length)
  .map(anyInitialCase)
  .join("|");

/**
 * Pattern: start of word + component + hyphen + CYRILLIC LOWERCASE letter →
 * merged.
 *
 * Three details, each non-obvious and each one costing a bug if missed:
 *
 *  1. `(?<![\p{L}\p{N}])` instead of `\b`: in JS `\w` is ASCII-only, so `\b`
 *     before Cyrillic doesn't sit where it looks like it should. Without
 *     this, «стоп-кадр» would become «стопкадр» (it contains «топ» inside
 *     it), and «експрес-доставка» would become «експресдоставка».
 *  2. There's NO `i` flag: in JS, `i` together with `u` makes `\p{Ll}` match
 *     an UPPERCASE letter too, and the exception for "hyphen before a
 *     proper name" («пан-Європа», «веб-API») would stop working. Instead of
 *     `i` there's `anyInitialCase` applied to each component. A component
 *     typed in FULL CAPS («ВЕБ-сайт») is deliberately skipped by the rule:
 *     that mix of case doesn't occur in the book, and widening the pattern
 *     would cost exactly the exception just bought.
 *  3. The replacement is m[1], i.e. the component AS TYPED: this preserves
 *     the case of the first letter with no extra code at all.
 *  4. `(?=\p{Script=Cyrillic})(?=\p{Ll})` — TWO lookaheads at the same
 *     position, not one `\p{Ll}`: `\p{Ll}` on its own is language-neutral
 *     and also matches a Latin lowercase letter («смарт-tv»,
 *     «веб-preview»). The language gate sits ON THE RUN (ukrainianRuns),
 *     not on the word, so a single Latin word inside a Ukrainian run stays
 *     inside it and passes the gate; without this refinement the match
 *     would be written as confidence: "high" — silently, with no
 *     confirmation. `u` mode has no set-intersection syntax, which is why
 *     this uses two lookaheads rather than one character class.
 */
const uk2019Compound = regexRule({
  id: "uk2019-compound",
  title: "Foreign-origin component with hyphen → merged (§35, 2019 orthography)",
  confidence: "high",
  language: UK_LANGUAGE,
  find: new RegExp(
    `(?<![\\p{L}\\p{N}])(${COMPOUND_ALTERNATION})-(?=\\p{Script=Cyrillic})(?=\\p{Ll})`,
    "gu",
  ),
  replace: (m) => m[1]!,
  review: (m) => COMPOUND_HOMOGRAPHS.has(m.replacement.toLocaleLowerCase("uk")),
});

export const UK2019_RULES: TypographyRule[] = [
  uk2019Proiekt,
  uk2019Sviashchennyk,
  uk2019Compound,
];

export const UK_RULES: TypographyRule[] = [
  ...SPACING_RULES,
  ...DASH_RULES,
  ...QUOTE_RULES,
  ...UK2019_RULES,
];

// ── Report only, no auto-fix ─────────────────────────────────────────────────

export interface AuditFinding {
  kind: "tab-indent" | "empty-paragraph";
  start: number;
  end: number;
  contextBefore: string;
}

/**
 * Tabs instead of indents and empty paragraphs instead of spacing are a
 * decision about PARAGRAPH STYLES, not about the text. Fixing them
 * automatically would mean hiding a layout problem behind text-level
 * cosmetics. Hence — report only.
 */
export function auditOnly(text: string): AuditFinding[] {
  const out: AuditFinding[] = [];

  const tab = /(^|[\r\n])(\t+)/gu;
  let m: RegExpExecArray | null;
  while ((m = tab.exec(text)) !== null) {
    const start = m.index + m[1]!.length;
    out.push({
      kind: "tab-indent",
      start,
      end: start + m[2]!.length,
      contextBefore: text.slice(Math.max(0, start - 40), start),
    });
  }

  const empty = /[\r\n][^\S\r\n]*(?=[\r\n])/gu;
  while ((m = empty.exec(text)) !== null) {
    out.push({
      kind: "empty-paragraph",
      start: m.index,
      end: m.index + m[0].length,
      contextBefore: text.slice(Math.max(0, m.index - 40), m.index),
    });
  }

  return out.sort((a, b) => a.start - b.start);
}

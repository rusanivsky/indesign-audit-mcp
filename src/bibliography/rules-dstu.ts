/**
 * Zone-description rules per ДСТУ ГОСТ 7.1:2006 and ДСТУ 8302:2015.
 *
 * Task 6: the two most important rules of the whole tool — the zone
 * separator ("period and dash") and the page/year range mark. Tasks 7–8 add
 * the prescribed-punctuation and abbreviation rules into that same
 * `DSTU_RULES`.
 */

import { isKnownAbbreviation } from "./abbrev.js";
import { EN_DASH, FOREIGN_DASHES, H, UK_LOWER, UK_UPPER, ZONE_SEP_SOURCE } from "./chars.js";
import { ZONE_STARTERS } from "./parse.js";
import type { Finding, ParsedRecord } from "./types.js";

export type Standard = "7.1" | "8302";

export interface BibRule {
  id: string;
  title: string;
  /** The standard's clause. The bibliographer should see the basis, not just the verdict. */
  basis: string;
  check(parsed: ParsedRecord, standard: Standard): Finding[];
}

const CONTEXT = 40;

/**
 * A shared finding factory for every rule in this file (and for Tasks 7–8,
 * which reuse it). Hence it is NOT private to a specific rule.
 */
function finding(
  rule: Pick<BibRule, "id" | "title" | "basis">,
  parsed: ParsedRecord,
  localStart: number,
  localEnd: number,
  suggested: string,
): Finding {
  const { record } = parsed;
  const zone = parsed.zones.find((z) => localStart >= z.start && localStart < z.end);
  return {
    ruleId: rule.id,
    title: rule.title,
    confidence: "high",
    recordNumber: record.number,
    containerId: record.containerId,
    page: record.page,
    zone: zone?.id ?? null,
    /* Offsets are converted into CONTAINER coordinates — a finding needs to be
     * showable in the document, not just in the record's text line. */
    start: record.start + localStart,
    end: record.start + localEnd,
    before: record.text.slice(localStart, localEnd),
    suggested,
    contextBefore: record.text.slice(Math.max(0, localStart - CONTEXT), localStart),
    contextAfter: record.text.slice(localEnd, localEnd + CONTEXT),
    basis: rule.basis,
  };
}

/*
 * The zone separator. The mark is specifically U+2013, not U+2014: measured
 * on the text of the standard itself, 779 en dashes against ZERO em dashes
 * (spec §0.1).
 *
 * One pattern for both the ДСТУ 7.1 and ДСТУ 8302 standards — it searches
 * for any dash-like mark between a period and a space. The standards differ
 * in WHAT to replace it with, not in what to search for. The pattern's
 * source is shared with the parser (`ZONE_SEP_SOURCE` in `chars.ts`) — the
 * same expression, built from the same building blocks.
 *
 * CRITICAL: both spaces are mandatory in the pattern. Without them the rule
 * would catch `наук.-практ.` — 394 and 395 legitimate matches across two
 * issues of the series.
 */
const SEPARATOR = new RegExp(ZONE_SEP_SOURCE, "gu");

/*
 * The basis differs by standard — otherwise a finding under 8302 would
 * recommend REMOVING the dash while its own basis says the dash must be
 * there and cites a different standard. The 8302 wording is taken from the
 * standard's own text, not invented.
 */
const BASIS_7_1 =
  "ДСТУ ГОСТ 7.1:2006: every zone except the first is preceded by a \"period and dash\" mark (U+2013)";
const BASIS_8302 =
  "ДСТУ 8302:2015: in a bibliographic reference, a \"period\" mark is recommended instead of the \"period and dash\" mark";

export const zoneSeparatorRule: BibRule = {
  id: "bib-zone-separator",
  title: "Zone separator in the description",
  basis: BASIS_7_1,
  check(parsed, standard) {
    if (parsed.unparsed !== null) return [];
    const want = standard === "7.1" ? `. ${EN_DASH} ` : ". ";
    const basis = standard === "7.1" ? BASIS_7_1 : BASIS_8302;
    /* A regex with the `g` flag keeps `lastIndex` between calls — obligatory
     * to reset before every record, or the next call won't start from zero. */
    const re = SEPARATOR;
    re.lastIndex = 0;
    const out: Finding[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(parsed.record.text)) !== null) {
      /* Context filter: without it the rule catches grammatical dashes, which
       * make up most of the corpus (spec §0.3). */
      if (!ZONE_STARTERS.test(parsed.record.text.slice(m.index + m[0].length))) continue;
      if (m[0] === want) continue;
      /* `basis` is substituted based on `standard`, not from `this` — the rule's
       * static field stays the default (7.1) description and doesn't fit 8302. */
      out.push(
        finding(
          { id: this.id, title: this.title, basis },
          parsed,
          m.index,
          m.index + m[0].length,
          want,
        ),
      );
    }
    return out;
  },
};

/** Page and year ranges. A CLASS of dash-like marks is caught, not just the hyphen. */
const RANGES = [
  new RegExp(`(?<=С\\.${H}*\\d+)[${FOREIGN_DASHES}](?=\\d+)`, "gu"),
  new RegExp(`(?<=(?<!\\d)(?:19|20)\\d\\d)[${FOREIGN_DASHES}](?=(?:19|20)\\d\\d(?!\\d))`, "gu"),
];

export const rangeDashRule: BibRule = {
  id: "bib-range-dash",
  title: "Range dash for pages or years",
  basis: "ДСТУ ГОСТ 7.1:2006: a range is given with a short dash U+2013",
  check(parsed) {
    if (parsed.unparsed !== null) return [];
    const out: Finding[] = [];
    for (const re of RANGES) {
      /* The same `lastIndex` risk: these regexes are shared across all records, so
       * resetting before every pass is mandatory. */
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(parsed.record.text)) !== null) {
        out.push(finding(this, parsed, m.index, m.index + m[0].length, EN_DASH));
      }
    }
    return out.sort((a, b) => a.start - b.start);
  },
};

/*
 * Prescribed punctuation, ДСТУ ГОСТ 7.1:2006:
 *  - ONE typographic space before and after a prescribed mark;
 *  - EXCEPTION — period and comma: a space only AFTER them;
 *  - the marks `;` `:` `…` are NOT among the exceptions — spaces on both sides.
 *
 * A role marker before names (`упоряд.:`, `ред.:`, `уклад.:`) is NOT
 * included here: there the colon is grammatical, not prescribed. Measured:
 * 27 to 0 in the standard, 84 to 0 in the corpus.
 */
const ROLE_COLON = new RegExp(
  `(?:упоряд|уклад|ред|редкол|авт|пер|відп|кер|сост)\\.:`,
  "u",
);
/*
 * We catch `:`/`;` that have NO space before them (the left lookbehind is
 * exactly the check "the previous character is not a horizontal space"),
 * and that already have a space after them (otherwise the finding for "no
 * space before" would also grab the end of a line).
 *
 * `\r` is named EXPLICITLY on both sides, and this follows from the C1 fix
 * (`segment.ts`): once a paragraph boundary stays as `\r` instead of being
 * replaced with a space, it stopped matching `H`. Without this explicit
 * mention, a mark at the start of a paragraph («\r: щось») would be wrongly
 * declared as having "no space before" — and the rule would suggest
 * inserting a space RIGHT AFTER the paragraph mark; and a mark at the end
 * of a paragraph («…:\r») would silently vanish from the report. A
 * paragraph boundary is a separator NO WEAKER than a space, so both sides
 * are treated the same way a space would be.
 */
const NEEDS_BOTH_SIDES = new RegExp(`(?<!${H})(?<!\\r)[:;](?=${H}|\\r)`, "gu");

/**
 * ALWAYS `needs-review`, and this is measured: the corpus has 1290 colons
 * with no space before them, and most of them are GRAMMATICAL, inside a
 * title («Вісник Черкас. ун-ту. Серія: Історичні науки»), not prescribed.
 * Telling a prescribed colon apart from a grammatical one can't be done
 * automatically, so a confident verdict here would be a lie — the rule
 * shows candidates to the bibliographer.
 *
 * THE TITLE AND THE BASIS ARE NARROWED TO WHAT THE RULE ACTUALLY DOES
 * (finding I6 of the final review). The standard requires a space on both
 * sides of a prescribed mark, and there are more prescribed marks than
 * this — `…`, brackets, `=`, `+`. This rule checks EXACTLY one form: `:` or
 * `;` with no space BEFORE them. It sees neither "no space AFTER" nor the
 * other marks, and the former title «Пробіли навколо приписаного знака»
 * ("Spaces around a prescribed mark") promised the bibliographer coverage
 * it didn't have (6,865 findings on the book — a good reason not to lie in
 * the title). What's missing from v1 is listed in spec §7.1.
 */
export const prescribedSpacingRule: BibRule = {
  id: "bib-prescribed-spacing",
  title: "No space before the prescribed mark \":\" or \";\"",
  basis:
    "ДСТУ ГОСТ 7.1:2006: one space before and after a prescribed mark " +
    "(exception — period and comma). The rule checks only the space BEFORE \":\" and \";\".",
  check(parsed) {
    if (parsed.unparsed !== null) return [];
    const text = parsed.record.text;
    const out: Finding[] = [];
    /* A regex with the `g` flag keeps `lastIndex` between calls — resetting it
     * before every record is mandatory. */
    NEEDS_BOTH_SIDES.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = NEEDS_BOTH_SIDES.exec(text)) !== null) {
      const head = text.slice(Math.max(0, m.index - 12), m.index + 1);
      if (ROLE_COLON.test(head)) continue;
      out.push({
        ...finding(this, parsed, m.index, m.index + 1, ` ${m[0]}`),
        confidence: "needs-review",
      });
    }
    return out;
  },
};

/**
 * `/` is given ONLY once — a direct clause of the standard. The second and
 * further statement-of-responsibility elements are separated with a
 * semicolon, not by repeating the slash.
 */
export const slashOnceRule: BibRule = {
  id: "bib-slash-once",
  title: "Slash used twice",
  basis: "ДСТУ ГОСТ 7.1:2006: if an element repeats, the mark repeats too, except for \"/\"",
  check(parsed) {
    if (parsed.unparsed !== null) return [];
    const text = parsed.record.text;
    const hits: number[] = [];
    /*
     * The separator around the slash is a space OR a paragraph boundary.
     * `\r` is named explicitly following the C1 fix (`segment.ts`): once a
     * paragraph boundary stays as `\r`, it stopped looking like a space,
     * and a slash at the start of a continuation paragraph would silently
     * drop out of the report.
     */
    /*
     * ТОЙ САМИЙ НАБІР ПРОБІЛЬНИХ, ЩО Й У СУСІДІВ.
     *
     * Тут приймалися лише звичайний пробіл і `\r`, тоді як решта правил
     * модуля користується `H`, який покриває і нерозривний. А `rules-nbsp.ts`
     * існує саме тому, що це видавництво ставить у описах нерозривні:
     * «Мар'яна\u00A0/\u00A0Іван» не давав збігу зовсім, тож повторна скісна,
     * набрана нерозривними, не потрапляла в звіт ніколи.
     */
    const SEPARATOR = new RegExp(`^(?:${H}|\r)$`, "u");
    const isSeparator = (ch: string | undefined): boolean =>
      ch !== undefined && SEPARATOR.test(ch);
    for (let i = 0; i < text.length - 2; i++) {
      /* We search for " / " (space-slash-space). "// " (a double slash — the
       * source mark) is a DIFFERENT mark, not a repeat of the single one; a
       * separate check for `text[i + 2] === "/"` isn't needed — the
       * requirement for a separator AFTER the slash rejects it on its own
       * (finding M8: that branch was dead). */
      if (!isSeparator(text[i]) || text[i + 1] !== "/") continue;
      if (!isSeparator(text[i + 2])) continue;
      hits.push(i + 1);
    }
    /* The first occurrence is legitimate (the first statement-of-responsibility
     * element). Every next one is an error. */
    return hits.slice(1).map((at) => finding(this, parsed, at, at + 1, ";"));
  },
};

export const finalDotRule: BibRule = {
  id: "bib-final-dot",
  title: "Description not closed with a period",
  basis: "ДСТУ ГОСТ 7.1:2006: a bibliographic description ends with a period",
  check(parsed) {
    if (parsed.unparsed !== null) return [];
    const text = parsed.record.text.replace(/\s+$/u, "");
    if (text.endsWith(".")) return [];
    return [finding(this, parsed, text.length, text.length, ".")];
  },
};

/*
 * The form of a record's heading: «Прізвище, Ім'я По батькові.» ("Surname,
 * First name Patronymic.") (ДСТУ ГОСТ 7.80:2007).
 *
 * This CANNOT be checked through the parser's "heading" zone (`parse.ts`):
 * the parser builds that zone ONLY when the comma is already there — that's
 * how it tells a personal heading apart from an ordinary title that simply
 * starts with a capital letter (see the comment at `HEADING` in
 * `parse.ts`). Meaning: when the comma is missing — the very defect this
 * rule must catch — there will be no "heading" zone at all, and the check
 * "is there a comma in the zone" will always stay silent. The rule searches
 * for a candidate on its own, directly in the record's text, using the same
 * outline: a surname is one word, followed by one to three name tokens (a
 * full word or an initial), and then immediately a period that closes the
 * heading.
 *
 * The first name token must start with a capital letter — just like the
 * name itself does in a real record; this isn't proof, only a weak signal:
 * the second and third tokens (a patronymic is often written either as
 * «Побатькович» or as two words) are allowed to start lowercase too, so as
 * not to lose a candidate like «Ім'я По батькові» — the literal text from
 * the test fixture.
 *
 * Always `needs-review`: the same unresolvable ambiguity as in
 * `prescribedSpacingRule`. A title that starts with two capitalized words
 * («Зоряні Мрії.»), is syntactically indistinguishable from a heading
 * with a missing comma — no regex can see the difference here, and a
 * fabricated confident verdict would be a lie.
 */
const NAME_TOKEN = `(?:[${UK_UPPER}]\\.|[${UK_UPPER}][${UK_LOWER}]+)`;
const TRAILING_TOKEN = `(?:[${UK_UPPER}]\\.|[${UK_UPPER}${UK_LOWER}]+)`;
const HEADING_CANDIDATE = new RegExp(
  `^${H}*\\d{1,5}\\.${H}+([${UK_UPPER}][${UK_LOWER}]*)(,?)${H}+(${NAME_TOKEN}(?:${H}${TRAILING_TOKEN}){0,2})\\.`,
  "u",
);

export const headingFormRule: BibRule = {
  id: "bib-heading-form",
  title: "Record heading form",
  basis: "ДСТУ ГОСТ 7.80:2007: the heading is \"Surname, First name Patronymic.\"",
  check(parsed) {
    if (parsed.unparsed !== null) return [];
    const m = HEADING_CANDIDATE.exec(parsed.record.text);
    if (m === null || m[2] === ",") return [];
    return [
      {
        /*
         * НОМЕР ЗАПИСУ ЛИШАЄТЬСЯ В ПРОПОЗИЦІЇ.
         *
         * Діапазон знахідки — це весь збіг `m[0]`, а він ПОЧИНАЄТЬСЯ з
         * префікса `\d{1,5}\.`, що його з'їдає `HEADING_CANDIDATE`. Пропозиція
         * ж будувалася лише з `m[1]` і `m[3]`, тож подана як заміна діапазону
         * вона МОВЧКИ ВИДАЛЯЛА номер: «12. Шевченко Тарас Григорович.» →
         * «Шевченко, Тарас Григорович.». Редактор, що прийняв би її не
         * дивлячись, втратив би нумерацію запису.
         */
        ...finding(
          this,
          parsed,
          m.index,
          m.index + m[0].length,
          `${m[0].slice(0, m[0].indexOf(m[1] ?? ""))}${m[1] ?? ""}, ${m[3] ?? ""}.`,
        ),
        confidence: "needs-review",
      },
    ];
  },
};

/** A doubled period at the junction of an abbreviation and a prescribed mark. */
export const doubleDotRule: BibRule = {
  id: "bib-double-dot",
  title: "Doubled period",
  basis: "ДСТУ ГОСТ 7.1:2006: the prescribed-punctuation period is dropped after an abbreviation's period",
  check(parsed) {
    if (parsed.unparsed !== null) return [];
    const out: Finding[] = [];
    /* The regex is created LOCALLY on every call — the simplest way not to get
     * caught by a shared `lastIndex` across records. */
    const re = /\.\./gu;
    let m: RegExpExecArray | null;
    while ((m = re.exec(parsed.record.text)) !== null) {
      /* Three periods are a different mark (an ellipsis), not a doubled period. */
      if (parsed.record.text.slice(m.index, m.index + 3) === "...") continue;
      out.push(finding(this, parsed, m.index, m.index + 2, "."));
    }
    return out;
  },
};

/*
 * Abbreviations outside the ДСТУ 3582:2013 lexicon.
 *
 * A candidate is a word of 1–11 letters ending with a period (a simple
 * abbreviation `наук.`, or a compound one joined by a hyphen
 * `наук.-практ.` — the halves are checked separately inside
 * `isKnownAbbreviation`). The letter class is `\p{L}` (any script, so Latin
 * homoglyphs are caught too, spec §0.6), PLUS the apostrophe: without it
 * «Ім'я.» splits into «Ім» and «я.», and it's the second part that gets
 * wrongly caught as an abbreviation — the apostrophe isn't part of `\p{L}`
 * (category Po/Pf, not Letter). The lookbehind prevents catching the tail
 * of a longer word or a repeat period after an abbreviation already found;
 * the lookahead requires that the period be followed by a HORIZONTAL
 * space, a PARAGRAPH BOUNDARY, or the end of the text — `H` and `\r` named
 * individually, not `\s` as a group (Global Constraints).
 *
 * `\r` is named EXPLICITLY following the C1 fix (`segment.ts`): a paragraph
 * boundary used to be replaced with a space and silently match `H`.
 * Measured on the dump `/tmp/story141.txt`: without this mention, 9 out of
 * 1944 findings would have vanished — their abbreviation sits at the end of
 * a paragraph. The lookahead consumes nothing, so the finding points at the
 * WORD, not at `\r`.
 */
const ABW = "\\p{L}'’";
const ABBREV_CANDIDATE = new RegExp(
  `(?<![.${ABW}])([${ABW}]{1,11}(?:\\.-[${ABW}]{1,11})?\\.)(?=${H}|\\r|$)`,
  "gu",
);

/*
 * The pattern for `endsZoneSeparator` — WITHOUT the `g` flag: `exec` always
 * searches the passed slice from scratch, so the shared module-level
 * instance holds no state between calls (unlike `SEPARATOR`/
 * `ABBREV_CANDIDATE` above, where `g` is present and `lastIndex` has to be
 * reset). We hoist it to module level rather than compiling it for every
 * candidate in every record — the same technique used for `SEPARATOR`.
 */
const ZONE_SEP_AT_START = new RegExp(`^${ZONE_SEP_SOURCE}`, "u");

/**
 * A candidate's period that is at the same time the LEFT period of a zone
 * separator («. – »). This period already belongs to a different mark
 * (checked by `zoneSeparatorRule`), which means it does NOT mark an
 * abbreviation — otherwise an ordinary full word before the separator
 * («Журнал. – 2024.») would be wrongly declared an abbreviation just
 * because a period happened to land there. The same outline filter as in
 * `parseRecord` (`ZONE_STARTERS` checks that a genuine start of a zone
 * follows the separator, not a grammatical dash).
 */
function endsZoneSeparator(text: string, dotIndex: number): boolean {
  const m = ZONE_SEP_AT_START.exec(text.slice(dotIndex));
  if (m === null) return false;
  return ZONE_STARTERS.test(text.slice(dotIndex + m[0].length));
}

/**
 * ALWAYS `needs-review`, NEVER `high`: the ДСТУ 3582 lexicon is admittedly
 * incomplete — it doesn't cover the names of institutions, series, and
 * periodicals, and those make up most of a bibliographic index. A
 * confident verdict here would be a lie (the same reason as in
 * `prescribedSpacingRule`).
 *
 * `suggested` is an EMPTY STRING, and that's deliberate (finding M7). It
 * used to hold the word itself, and on the book that produced 7,555
 * "suggestions," each identical to the text: `before === suggested`. A
 * suggestion that changes nothing is noise, and worse, it invites automatic
 * application (replacing a word with itself). The rule doesn't KNOW what to
 * replace an unknown abbreviation with — it puts a QUESTION to the
 * bibliographer: "is this really an abbreviation under ДСТУ 3582?" An
 * empty `suggested` is the only honest answer: there's a question, but no
 * ready-made replacement.
 */
export const abbrevRule: BibRule = {
  id: "bib-abbrev",
  title: "Abbreviation outside the standard's lexicon",
  basis: "ДСТУ 3582:2013 / ДСТУ 7093:2009",
  check(parsed) {
    if (parsed.unparsed !== null) return [];
    const text = parsed.record.text;
    /*
     * A record's heading is a personal name («Прізвище, Ім'я По батькові.»),
     * not a bibliographic description: it has none of the abbreviations
     * that ДСТУ 3582 regulates, only the full words of the first name and
     * patronymic. Without this exclusion, a full first name («Ім'я.»)
     * would be wrongly declared an unknown abbreviation simply because it
     * ends with the heading's period.
     *
     * A DELIBERATE BLIND SPOT: the exception turns the rule off across the
     * ENTIRE heading, so a garbled patronymic («Ім'я Ксвкпр.») also passes
     * through silently — grammatically, a patronymic's position looks
     * exactly like "capital letter + letters + period," and telling it
     * apart from an abbreviated word without a dictionary of personal
     * names is impossible in principle. This is the boundary of the task,
     * not carelessness: the rule is already `needs-review`, and the
     * alternative is a false positive on EVERY record with a personal
     * heading (verified by execution; the «СВІДОМО мовчить…» test in
     * bibliography-abbrev.test.ts records this trade-off).
     */
    const heading = parsed.zones.find((z) => z.id === "heading");
    /*
     * ЗАГОЛОВОК БЕЗ КОМИ — ТЕЖ ЗАГОЛОВОК, і саме на ньому виняток не спрацьовував.
     *
     * Зону «heading» парсер створює ЛИШЕ за наявності коми: у `parse.ts`
     * `HEADING` несе `,` літералом. Отже на записі «12. Шевченко Тарас
     * Григорович.» зони немає, виняток нижче не має за що зачепитися, і
     * по батькові «Григорович.» звітується як невідоме скорочення.
     *
     * Найгірше, що це РІВНО ті записи, які вже позначає `bib-heading-form`
     * (він для того й має власний, безкомовий `HEADING_CANDIDATE`): запис
     * без коми діставав ДВІ знахідки, і друга була хибною — редактор,
     * виправивши кому, побачив би, що «скорочення» зникло само.
     *
     * Тож межу заголовка беремо з того самого зразка, що й `bib-heading-form`,
     * коли зони немає. Свідома сліпа пляма всередині заголовка, описана вище,
     * лишається такою самою — вона просто тепер поширюється й на цей випадок.
     */
    const headingBounds = ((): { start: number; end: number } | undefined => {
      if (heading !== undefined) return { start: heading.start, end: heading.end };
      const cand = HEADING_CANDIDATE.exec(text);
      if (cand === null) return undefined;
      return { start: cand.index, end: cand.index + cand[0].length };
    })();
    const out: Finding[] = [];
    /* A regex with the `g` flag keeps `lastIndex` between calls — resetting it
     * before every record is mandatory. */
    ABBREV_CANDIDATE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ABBREV_CANDIDATE.exec(text)) !== null) {
      const word = m[1] ?? "";
      if (isKnownAbbreviation(word)) continue;
      /* Initials («А.») are not an abbreviation — they're part of the heading. */
      if (/^\p{Lu}\.$/u.test(word)) continue;
      if (
        headingBounds !== undefined &&
        m.index >= headingBounds.start &&
        m.index < headingBounds.end
      ) {
        continue;
      }
      /* The candidate's period is actually the left period of a zone separator. */
      if (endsZoneSeparator(text, m.index + word.length - 1)) continue;
      out.push({
        ...finding(this, parsed, m.index, m.index + word.length, ""),
        confidence: "needs-review",
      });
    }
    return out;
  },
};

export const DSTU_RULES: BibRule[] = [
  zoneSeparatorRule,
  rangeDashRule,
  prescribedSpacingRule,
  slashOnceRule,
  finalDotRule,
  headingFormRule,
  doubleDotRule,
  abbrevRule,
];

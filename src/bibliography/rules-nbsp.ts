/**
 * The non-breaking-space layer: so that neither a lone initial letter, nor
 * the initials as a whole get separated from the surname by a line break,
 * nor a locator number from «С.» — this is exactly what the client named
 * as key (spec §7.2).
 *
 * Protection comes in TWO forms: the U+00A0 character in the text (visible
 * on an ordinary read) OR the `Text.noBreak` attribute, typically applied
 * through a GREP style in a paragraph style (nothing visible in the text —
 * the character stays an ordinary space). So the work is split into two
 * steps:
 *  - `collectNbspCandidates` — a purely textual pass, collecting the
 *    PLACES where a non-breaking space must stand per ДСТУ 8302:2015, and
 *    immediately discarding the ones that already have U+00A0;
 *  - `nbspFindings` — hands down the verdict, having received, for each
 *    candidate, the answer from the attribute mechanism (`readNoBreak` in
 *    `nobreak.ts`).
 * A rule that only checked characters would have produced thousands of
 * false positives on an edition using a GREP style (spec §0.5). Measured
 * on the 2022 edition: there is no protection, neither by character nor by
 * attribute — 5527 initial pairs and 3920 locators.
 *
 * THESE TWO NUMBERS ARE NOT THE EXPECTED FINDING COUNT, and it's easy to
 * confuse them. `5527` was measured with `findGrep` against the LITERAL
 * pair «А. В.», i.e. the space BETWEEN INITIALS. `INITIALS` below
 * deliberately catches TWO pairs for every such case (between the initials
 * AND between the second initial and the surname — see the comment by the
 * regex), so the rule naturally produces roughly twice as many: 11,706 on
 * the book. Cross-checked with a separate measurement on a dump of story
 * 141 (`docs/measured-facts-bibliography.md`, "Question 2"): 2962 findings
 * = 1419 "initial+initial" pairs + 1543 "initial+surname" pairs, against
 * 1421 literal `findGrep` matches in the same text. Whoever "fixes" the
 * regex to match 5527 would remove half of the phenomenon the client named
 * as key.
 */

import { H, NBSP, UK_LOWER, UK_UPPER } from "./chars.js";
import { isProtected } from "./nobreak.js";
import type { Finding, ParsedRecord } from "./types.js";

export const NBSP_RULE_IDS = ["bib-nbsp-initials", "bib-nbsp-locator", "bib-nbsp-extent"] as const;

export interface NbspCandidate {
  parsed: ParsedRecord;
  /** Offsets of the SPACE within the record's text (not the whole record). */
  localStart: number;
  localEnd: number;
  ruleId: (typeof NBSP_RULE_IDS)[number];
  title: string;
  basis: string;
}

const BASIS =
  "ДСТУ 8302:2015: separate initials, and initials from the surname, with spaces; " +
  "use a non-breaking space for the separator";

/**
 * Initial + initial AND initial + surname — both pairs, one pass.
 *
 * A lookahead `(?=[UK_UPPER])`, rather than a second initial inside the
 * match itself — deliberate: otherwise «А. В. Прізвище» would give only
 * ONE match («А. В.», eating the space between the initials), and the
 * space between «В.» and «Прізвище» would go unnoticed, because the first
 * match already "ate" it. A lookahead consumes nothing, so the next
 * `exec` pass starts right from the letter «В» and finds the second pair —
 * exactly what the client requires (spec §7.2, the "catches BOTH pairs"
 * test).
 */
/*
 * ІНІЦІАЛ — ЦЕ ОДНА ЛІТЕРА, А НЕ ОСТАННЯ ЛІТЕРА АБРЕВІАТУРИ.
 *
 * Без погляду назад шаблон вимагав лише ОДНУ велику літеру перед крапкою — а
 * остання літера абревіатури цю вимогу задовольняє. Зміряно 2026-08-26:
 *   «12. Праці НТШ. Львів : Наукова думка, 2020.»  → збіг на «НТШ. Львів»
 *   «13. Історія УРСР. Київ : Наук. думка, 1980.»  → збіг на «УРСР. Київ»
 * Обидва ставали знахідками `high` і пропонували U+00A0 між крапкою в кінці
 * РЕЧЕННЯ і першим словом наступного, тобто склеювали через межу зон.
 * Українська бібліографія рясніє такими абревіатурами (НТШ, УРСР, НАН, ДСТУ),
 * тож це не крайовий випадок, а постійний шум у звіті.
 *
 * `(?<![...])` вимагає, щоб перед літерою НЕ стояла інша літера: справжній
 * ініціал стоїть або на початку, або після пробілу чи розділового знака.
 * «А. В. Прізвище» обидві пари дає, як і давало.
 */
const INITIALS = new RegExp(
  `(?<![${UK_UPPER}${UK_LOWER}])[${UK_UPPER}]\\.(${H})(?=[${UK_UPPER}])`,
  "gu",
);
/** A locator («С.», «Вип.», «Т.», «№», etc.) plus the number that follows it. */
const LOCATOR = new RegExp(
  `(?:С|с|Вип|Т|Ч|Чис|Кн)\\.(${H})(?=\\d)|\u2116(${H})(?=\\d)`,
  "gu",
);
/** A number plus «с.» in the extent zone («240 с.»). */
const EXTENT = new RegExp(`\\d(${H})(?=с\\.)`, "gu");

const SPECS = [
  { re: INITIALS, ruleId: "bib-nbsp-initials" as const, title: "Non-breaking space in initials" },
  {
    re: LOCATOR,
    ruleId: "bib-nbsp-locator" as const,
    title: "Non-breaking space after a locator",
  },
  { re: EXTENT, ruleId: "bib-nbsp-extent" as const, title: "Non-breaking space before \"с.\"" },
];

/**
 * Collects candidates for a non-breaking space. Does NOT hand down a
 * verdict — this level knows nothing about protection via the
 * `Text.noBreak` attribute (that's what `nbspFindings` below is for).
 */
export function collectNbspCandidates(parsed: ParsedRecord[]): NbspCandidate[] {
  const out: NbspCandidate[] = [];
  for (const p of parsed) {
    if (p.unparsed !== null) continue;
    for (const spec of SPECS) {
      /* The regex, with the `g` flag, keeps `lastIndex` between calls — it MUST
       * be reset before EVERY record, or the next record will start not
       * from zero and half the candidates will silently get lost (Task 4). */
      spec.re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = spec.re.exec(p.record.text)) !== null) {
        const group = m[1] ?? m[2] ?? "";
        if (group === "") continue;
        /* Already non-breaking via the character — not a candidate at all: the
         * protection is there, and `nbspFindings` won't be checking anything
         * here. */
        if (group === NBSP) continue;
        const at = m.index + m[0].indexOf(group);
        out.push({
          parsed: p,
          localStart: at,
          localEnd: at + group.length,
          ruleId: spec.ruleId,
          title: spec.title,
          basis: BASIS,
        });
      }
    }
  }
  return out;
}

const CONTEXT = 40;

/**
 * A candidate becomes a finding only if it's protected by NEITHER of the
 * two mechanisms.
 *
 * `attributeAnswers` is a parallel array: `attributeAnswers[i]` corresponds
 * to `candidates[i]`. The same length and the same order is a CONTRACT,
 * not a coincidence: the answers come from `readNoBreak` (`nobreak.ts`),
 * to which the tool call passes queries built from these same candidates
 * in the same order. Breaking the contract means substituting the answer
 * for the wrong range and either silencing a real finding or inventing one
 * that doesn't exist.
 */
export function nbspFindings(
  candidates: NbspCandidate[],
  attributeAnswers: boolean[],
): Finding[] {
  const out: Finding[] = [];
  for (const [i, c] of candidates.entries()) {
    const byAttribute = attributeAnswers[i] ?? false;
    const { record } = c.parsed;
    if (isProtected(record.text, c.localStart, c.localEnd, byAttribute)) continue;
    const zone = c.parsed.zones.find((z) => c.localStart >= z.start && c.localStart < z.end);
    out.push({
      ruleId: c.ruleId,
      title: c.title,
      confidence: "high",
      recordNumber: record.number,
      containerId: record.containerId,
      page: record.page,
      zone: zone?.id ?? null,
      /* Offsets are converted to CONTAINER coordinates — a finding must be
       * showable in the document, not just in the record's text line. */
      start: record.start + c.localStart,
      end: record.start + c.localEnd,
      before: record.text.slice(c.localStart, c.localEnd),
      suggested: NBSP,
      contextBefore: record.text.slice(Math.max(0, c.localStart - CONTEXT), c.localStart),
      contextAfter: record.text.slice(c.localEnd, c.localEnd + CONTEXT),
      basis: c.basis,
    });
  }
  return out;
}

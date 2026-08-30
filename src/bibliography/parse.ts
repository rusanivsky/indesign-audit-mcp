/**
 * Parses ONE record into ISBD zones (heading / title / subtitle /
 * statement of responsibility / source / imprint).
 *
 * Boundary of responsibility: the parser is NOT a judge (spec §5). It must
 * recognize a zone even when the separator is written with the wrong mark —
 * otherwise the rule that's supposed to complain "here's a hyphen instead of
 * a dash" would have nothing to point at. Verifying that the separator is
 * correct is the rules' job (Task 6), not this module's.
 */

import { H, UK_LOWER, UK_UPPER, ZONE_SEP_SOURCE } from "./chars.js";
import type { BibRecord, ParsedRecord, Zone, ZoneId } from "./types.js";

/**
 * What exactly is allowed to STAND AFTER a zone separator. This is the
 * contextual filter without which the separator rule is impossible (spec
 * §0.3): in the corpus, most `. – ` occurrences are grammatical dashes
 * («ХІІ ст. – перша третина ХХ ст.»), and a regex over plain text would
 * mostly produce false positives.
 */
export const ZONE_STARTERS = new RegExp(
  `^(?:` +
    `(?:19|20)\\d\\d` + // year of publication
    `|С\\.|с\\.|\\d+${H}*с\\.` + // localization or extent
    `|Вип\\.|Т\\.|Ч\\.|Чис\\.|Кн\\.|№` + // issue numbering
    `|ISBN|ISSN|URL|DOI` +
    `|Бібліогр\\.|Б-ка|Алф\\.|Імен\\.` + // notes
    `|\\(` + // series
    /* Word tail — `UK_LOWER` from chars.ts, not an inline literal (finding
     * M3). This is DEDUPLICATION, not a behavior fix, and it must be
     * described that way: the literal `a-zа-яїієґ'’.-` inlined here happened
     * to cover the same Ukrainian letters (the `а-я` range includes `ь`,
     * `ю`, `я`), so no test can kill it — on the story 141 dump all the
     * counts before and after the swap are identical. The danger wasn't in
     * today's character set, but in the fact that the canonical class from
     * `chars.ts` and its copy here would diverge the moment either one is
     * edited (the same risk `ZONE_SEP_SOURCE` already eliminated for the
     * zone separator).
     * `a-z` stays SEPARATE and deliberately: `UK_LOWER` contains only Latin
     * HOMOGLYPHS (`iacepox`), while a place of publication can also be
     * entirely Latin («Cambridge :»). */
    `|[${UK_UPPER}][${UK_UPPER}${UK_LOWER}a-z.-]*${H}*:` + // «Київ :» — place of publication
    `)`,
  "u",
);

/** Zone separator in ANY of the allowed spellings — the parser is not a judge. */
const ZONE_SEP = new RegExp(ZONE_SEP_SOURCE, "gu");

/**
 * A record's heading: «Прізвище, Ім'я По батькові.» ("Surname, First name
 * Patronymic.") or «Прізвище, І. П.» — ДСТУ ГОСТ 7.80:2007.
 *
 * The surname is ONE word with no period, colon, or dash inside it: the
 * heading must not cross a zone separator. Previously the class
 * `[^,]{1,40}` before the comma grabbed everything up to «Видавництво**,**
 * рік» in the imprint — any ordinary record without a personal heading
 * («Педагогіка. – Київ : Освіта, 2024.») got declared unparseable because
 * the period and dash were "eaten" while hunting for the comma.
 *
 * The name part is EXACTLY one or two tokens (first name/patronymic, in
 * full or as an initial), because that's exactly how many the standard puts
 * in a heading. Without this bound, greedy token repetition would swallow
 * the title's first word too — it also starts with a capital letter and can
 * also stand before a space.
 */
const INITIAL = `[${UK_UPPER}]\\.`;
const NAME_WORD = `[${UK_UPPER}][${UK_LOWER}]+`;
const NAME_PART =
  `(?:(?:${INITIAL}|${NAME_WORD})${H}(?:${INITIAL}|${NAME_WORD}\\.))` + // first name + patronymic
  `|(?:${INITIAL}|${NAME_WORD}\\.)`; // initials only, or a single first name
const HEADING = new RegExp(
  `^${H}*\\d{1,5}\\.${H}+([${UK_UPPER}][${UK_LOWER}]*,${H}+(?:${NAME_PART}))`,
  "u",
);

function push(zones: Zone[], id: ZoneId, text: string, start: number): void {
  if (text.trim() === "") return;
  zones.push({ id, start, end: start + text.length, text });
}

export function parseRecord(record: BibRecord): ParsedRecord {
  const text = record.text;
  const zones: Zone[] = [];

  /* 1. Record heading — optional: the description may start with the title. */
  let cursor = 0;
  const heading = HEADING.exec(text);
  if (heading?.[1] !== undefined) {
    const at = text.indexOf(heading[1]);
    push(zones, "heading", heading[1], at);
    cursor = at + heading[1].length;
  } else {
    /* The same number as at the start of HEADING — H instead of \s: spec §Global Constraints. */
    const numbered = new RegExp(`^${H}*\\d{1,5}\\.${H}+`, "u").exec(text);
    cursor = numbered ? numbered[0].length : 0;
  }

  /* 2. Head of the description — up to the first zone separator that LEADS into a real zone. */
  ZONE_SEP.lastIndex = cursor;
  let imprintAt = -1;
  let m: RegExpExecArray | null;
  while ((m = ZONE_SEP.exec(text)) !== null) {
    if (ZONE_STARTERS.test(text.slice(m.index + m[0].length))) {
      imprintAt = m.index;
      break;
    }
  }
  const head = text.slice(cursor, imprintAt === -1 ? text.length : imprintAt);

  /* 3. The head is cut by the prescribed marks ` // `, ` / `, ` : `. */
  const sourceAt = head.indexOf(" // ");
  const beforeSource = sourceAt === -1 ? head : head.slice(0, sourceAt);
  const respAt = beforeSource.indexOf(" / ");
  const titlePart = respAt === -1 ? beforeSource : beforeSource.slice(0, respAt);
  const subtitleAt = titlePart.indexOf(" : ");

  if (subtitleAt === -1) {
    push(zones, "title", titlePart, cursor);
  } else {
    push(zones, "title", titlePart.slice(0, subtitleAt), cursor);
    push(zones, "subtitle", titlePart.slice(subtitleAt), cursor + subtitleAt);
  }
  if (respAt !== -1) {
    push(zones, "responsibility", beforeSource.slice(respAt), cursor + respAt);
  }
  if (sourceAt !== -1) {
    push(zones, "source", head.slice(sourceAt), cursor + sourceAt);
  }

  /* 4. Tail: imprint, extent, notes — everything after the first separator. */
  if (imprintAt !== -1) {
    push(zones, "imprint", text.slice(imprintAt), imprintAt);
  }

  /*
   * A paragraph can consist of nothing but words with no prescribed mark at
   * all — in that case "title" would be a fabrication, not a recognized
   * zone (spec §5, the unparseable-record test). A prescribed mark is a
   * subtitle, a statement of responsibility, a source, OR a separator that
   * leads to the imprint; the number itself plus its period is not enough.
   */
  const hasPrescribedPunctuation =
    subtitleAt !== -1 || respAt !== -1 || sourceAt !== -1 || imprintAt !== -1;

  const unparsed = !hasPrescribedPunctuation
    ? "no prescribed punctuation mark found"
    : zones.find((z) => z.id === "title") === undefined
      ? "no main title found"
      : null;

  return { record, zones: unparsed === null ? zones : [], unparsed };
}

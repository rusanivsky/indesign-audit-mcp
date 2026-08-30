/**
 * The Chicago Manual of Style bibliography-entry rules.
 *
 * `check` takes ONE argument. The ДСТУ family takes a second because 7.1 and
 * 8302 disagree about the very mark 7.1 prescribes, so a rule there cannot
 * know what to propose without being told which standard is in force. Chicago
 * is one standard; a second parameter would describe a choice that does not
 * exist.
 */

import { HN, LATIN_LOWER, LATIN_UPPER } from "./latin.js";
import type { Confidence, Finding, ParsedRecord } from "./types.js";

export interface ChicagoRule {
  id: string;
  title: string;
  /** The standard's clause. The bibliographer should see the basis, not just the verdict. */
  basis: string;
  check(parsed: ParsedRecord): Finding[];
}

const CONTEXT = 40;

function finding(
  rule: Pick<ChicagoRule, "id" | "title" | "basis">,
  parsed: ParsedRecord,
  localStart: number,
  localEnd: number,
  suggested: string,
  confidence: Confidence = "high",
): Finding {
  const { record } = parsed;
  const zone = parsed.zones.find((z) => localStart >= z.start && localStart < z.end);
  return {
    ruleId: rule.id,
    title: rule.title,
    confidence,
    recordNumber: record.number,
    containerId: record.containerId,
    page: record.page,
    zone: zone?.id ?? null,
    /* Offsets are converted into CONTAINER coordinates — a finding needs to be
     * showable in the document, not just in the record's own text. */
    start: record.start + localStart,
    end: record.start + localEnd,
    before: record.text.slice(localStart, localEnd),
    suggested,
    contextBefore: record.text.slice(Math.max(0, localStart - CONTEXT), localStart),
    contextAfter: record.text.slice(localEnd, localEnd + CONTEXT),
    basis: rule.basis,
  };
}

const INVERTED_NAME = new RegExp(
  `^([${LATIN_UPPER}][${LATIN_LOWER}'’-]+)(${HN}+)([${LATIN_UPPER}][${LATIN_LOWER}]*)`,
  "u",
);

export const headingCommaRule: ChicagoRule = {
  id: "chicago-heading-comma",
  title: "Comma in an inverted name",
  basis:
    "CMOS: in a bibliography the first author's name is inverted — surname, comma, given name",
  check(parsed) {
    if (parsed.unparsed !== null) return [];
    const heading = parsed.zones.find((z) => z.id === "heading");
    if (heading === undefined) return [];
    /*
     * The surname class excludes a comma, so a heading that ALREADY has one
     * simply fails to match: the character after the surname is `,` and not
     * the whitespace the pattern requires. No separate "already correct"
     * branch is needed, and none should be added — it would be unreachable.
     */
    const m = INVERTED_NAME.exec(heading.text);
    if (m === null) return [];
    const surname = m[1] ?? "";
    const gap = m[2] ?? "";
    const given = m[3] ?? "";
    return [
      finding(
        this,
        parsed,
        heading.start,
        heading.start + surname.length + gap.length + given.length,
        `${surname}, ${given}`,
      ),
    ];
  },
};

/**
 * The ГОСТ zone separator — period, space, dash, space — in ANY dash spelling.
 *
 * A CLASS of dash-like marks, not one character, and that is measured rather
 * than defensive: ДСТУ prescribes U+2013, and the live record uses U+2014
 * throughout. A pattern written to the standard would have found nothing in
 * the real document.
 *
 * Both spaces are mandatory. Without them the rule catches abbreviations — the
 * ДСТУ side counted 394 and 395 legitimate matches across two issues before
 * the spaces were required.
 */
const GOST_SEPARATOR = new RegExp(`\\.${HN}[\\u2010-\\u2015\\u2212]${HN}`, "gu");

export const zoneSeparatorRule: ChicagoRule = {
  id: "chicago-zone-separator",
  title: "Zone separator",
  basis:
    "CMOS: bibliography entry elements are separated by a period and a space, not by the period-dash of ГОСТ",
  check(parsed) {
    if (parsed.unparsed !== null) return [];
    /* A `g` regex keeps `lastIndex` between calls — reset before every record. */
    const re = GOST_SEPARATOR;
    re.lastIndex = 0;
    const out: Finding[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(parsed.record.text)) !== null) {
      out.push(finding(this, parsed, m.index, m.index + m[0].length, ". "));
    }
    return out;
  },
};

export const colonSpacingRule: ChicagoRule = {
  id: "chicago-colon-spacing",
  title: "Space before the imprint colon",
  basis: "CMOS: place and publisher are joined as «Place: Publisher» — no space before the colon",
  check(parsed) {
    if (parsed.unparsed !== null) return [];
    const place = parsed.zones.find((z) => z.id === "place");
    if (place === undefined) return [];
    const m = new RegExp(`^(${HN}+):`, "u").exec(parsed.record.text.slice(place.end));
    if (m === null) return [];
    return [finding(this, parsed, place.end, place.end + m[0].length, ":")];
  },
};

export const responsibilityRepeatRule: ChicagoRule = {
  id: "chicago-responsibility-repeat",
  title: "Author repeated after a slash",
  basis:
    "CMOS: Chicago has no statement-of-responsibility zone; the author appears once, in the heading",
  check(parsed) {
    if (parsed.unparsed !== null) return [];
    const resp = parsed.zones.find((z) => z.id === "responsibility");
    if (resp === undefined) return [];
    return [finding(this, parsed, resp.start, resp.end, "")];
  },
};

export const extentRule: ChicagoRule = {
  id: "chicago-extent",
  title: "Page extent in a bibliography entry",
  basis: "CMOS: a bibliography entry ends with the year; total pagination is not given",
  check(parsed) {
    if (parsed.unparsed !== null) return [];
    const extent = parsed.zones.find((z) => z.id === "extent");
    if (extent === undefined) return [];
    /*
     * needs-review, never high, and the reason is measured rather than
     * cautious: a CIP block legitimately carries an extent, and in the live
     * record the value is not a literal at all — it is U+0018, InDesign's
     * page-number marker, which composes to the last page number. Deleting it
     * automatically destroys a live marker and silently replaces a computed
     * number with nothing.
     */
    return [finding(this, parsed, extent.start, extent.end, "", "needs-review")];
  },
};

/** Full caps means: at least two letters, and NOT ONE of them lowercase. */
const ALL_CAPS_WORD = new RegExp(`^[${LATIN_UPPER}][${LATIN_UPPER}’'&.-]+$`, "u");

function titleCase(s: string): string {
  return s
    .split(/(\s+)/u)
    .map((w) => (/^\s*$/u.test(w) ? w : w.charAt(0) + w.slice(1).toLowerCase()))
    .join("");
}

export const publisherCapsRule: ChicagoRule = {
  id: "chicago-publisher-caps",
  title: "Publisher name in full caps",
  basis:
    "CMOS: publishers' names are given in headline style, not in the capitalisation of a logo",
  check(parsed) {
    if (parsed.unparsed !== null) return [];
    const publisher = parsed.zones.find((z) => z.id === "publisher");
    if (publisher === undefined) return [];
    const words = publisher.text.split(/\s+/u).filter((w) => w !== "");
    if (words.length === 0) return [];
    /*
     * EVERY word must be all-caps. One all-caps word among ordinary ones is an
     * abbreviation — «MIT Press» — not a house style, and proposing to
     * lowercase it would be wrong.
     */
    if (!words.every((w) => ALL_CAPS_WORD.test(w))) return [];
    /*
     * needs-review by construction, and this is the «specimen ≠ usage» gate.
     * The copyright block of the same imprint writes the name in exactly this
     * form with a trademark sign: that is the house's own SPECIMEN of its
     * name, not a typesetting slip, and nothing in the record itself can tell
     * the two apart. A rule that could not make this distinction is the defect
     * Phase 14 found in two detectors out of five — and it reached `main` past
     * seven reviews.
     */
    return [
      finding(
        this,
        parsed,
        publisher.start,
        publisher.end,
        titleCase(publisher.text),
        "needs-review",
      ),
    ];
  },
};

export const CHICAGO_RULES: ChicagoRule[] = [
  headingCommaRule,
  zoneSeparatorRule,
  colonSpacingRule,
  responsibilityRepeatRule,
  extentRule,
  publisherCapsRule,
];

/**
 * Parses ONE Chicago entry into zones.
 *
 * Boundary of responsibility, inherited from `parse.ts` and restated because
 * it is the rule most easily broken: THE PARSER IS NOT A JUDGE. It must
 * recognise `City :` as the place zone even though the space before the colon
 * is exactly what `chicago-colon-spacing` exists to complain about. A parser
 * that accepted only correct punctuation would leave every rule with nothing
 * to point at.
 */

import { HN, LATIN_LOWER, LATIN_UPPER } from "./latin.js";
import type { BibRecord, ParsedRecord, Zone, ZoneId } from "./types.js";

/**
 * The heading: an inverted personal name, or Chicago's 3-em dash for a
 * repeated author, up to and including the period that closes it.
 *
 * The comma is OPTIONAL here and mandatory in the rule. That split is the
 * not-a-judge boundary in one character: without it, the very record this
 * family exists to fix would parse as headingless and no rule would fire.
 */
const HEADING = new RegExp(
  `^${HN}*((?:———` +
    `|[${LATIN_UPPER}][${LATIN_LOWER}]+(?:[-'’][${LATIN_UPPER}]?[${LATIN_LOWER}]+)*` +
    `,?${HN}+[${LATIN_UPPER}][${LATIN_LOWER}.]*)\\.)`,
  "u",
);

/**
 * Place, publisher and year, in either the Chicago or the ГОСТ spelling of the
 * colon.
 *
 * The publisher class spells its whitespace out as ` \t\n` rather than reusing
 * `HN`: `HN` is itself a bracketed class and cannot be nested inside another
 * one. `\r` is absent for the usual reason — a zone may not cross a paragraph
 * boundary. `\n` is present because the live record breaks the line right
 * here, between the colon and the publisher.
 *
 * The publisher stops at the first comma, and the class therefore excludes
 * one: «Harper, Collins, 2026» yields «Harper». That is a known, named limit,
 * not an accident — a greedier rule would have to guess which comma separates
 * a name from a year.
 */
const IMPRINT = new RegExp(
  `([${LATIN_UPPER}][${LATIN_LOWER}]+)${HN}*:${HN}*` +
    `([${LATIN_UPPER}][${LATIN_UPPER}${LATIN_LOWER} \\t\\n.&'’-]*?)` +
    `,${HN}*((?:1[5-9]|20)\\d\\d)`,
  "u",
);

const URL_RE = /https?:\/\/[^\s”)]+/u;

/**
 * An extent zone: a page count — OR the page-number MARKER a CIP block uses in
 * place of one. `\u0018` is in the class deliberately: on the live record the
 * value is not a literal at all, and a pattern that only accepted digits would
 * report the zone as absent and leave the rule silent.
 */
const EXTENT = new RegExp(`[\\d\\u0018]+${HN}*(?:pp?\\.|pages)`, "u");

function push(zones: Zone[], id: ZoneId, text: string, start: number): void {
  if (text.trim() === "") return;
  zones.push({ id, start, end: start + text.length, text });
}

/**
 * Strips the punctuation a neighbouring zone owns off both ends, and reports
 * how much came off the front so the offset stays exact. Computing the offset
 * arithmetically rather than searching for the trimmed text matters: `indexOf`
 * would find the wrong occurrence whenever a title repeats a word.
 */
function trimZone(raw: string): { text: string; offset: number } {
  const afterLead = raw.replace(/^[\s./–—]+/u, "");
  const offset = raw.length - afterLead.length;
  return { text: afterLead.replace(/[\s./–—]+$/u, ""), offset };
}

export function parseChicago(record: BibRecord): ParsedRecord {
  const text = record.text;
  const zones: Zone[] = [];

  let cursor = 0;
  const heading = HEADING.exec(text);
  if (heading?.[1] !== undefined) {
    const at = text.indexOf(heading[1]);
    push(zones, "heading", heading[1], at);
    cursor = at + heading[1].length;
  }

  const imprint = IMPRINT.exec(text);
  const imprintAt = imprint?.index ?? -1;

  /*
   * The title runs from the end of the heading to the imprint, minus a
   * statement of responsibility if the ГОСТ ` / ` repeat is present. Chicago
   * has no such zone, which is precisely why the rule that removes it needs
   * the parser to mark one.
   */
  const head = text.slice(cursor, imprintAt === -1 ? text.length : imprintAt);
  const respAt = head.indexOf(" / ");
  const titleRaw = respAt === -1 ? head : head.slice(0, respAt);

  const title = trimZone(titleRaw);
  push(zones, "title", title.text, cursor + title.offset);

  if (respAt !== -1) {
    const respRaw = head.slice(respAt);
    /* Only the tail is trimmed: the leading « / » is part of what gets deleted. */
    const respText = respRaw.replace(/[\s.–—]+$/u, "");
    push(zones, "responsibility", respText, cursor + respAt);
  }

  if (imprint !== null && imprintAt !== -1) {
    const place = imprint[1] ?? "";
    const publisherRaw = imprint[2] ?? "";
    const year = imprint[3] ?? "";
    const publisher = publisherRaw.replace(/[\s,]+$/u, "");
    /* Offsets are derived from the match's own geometry, never re-searched. */
    const publisherAt = imprintAt + imprint[0].indexOf(publisherRaw);
    const yearAt = imprintAt + imprint[0].lastIndexOf(year);
    push(zones, "place", place, imprintAt);
    push(zones, "publisher", publisher, publisherAt);
    push(zones, "year", year, yearAt);
  }

  const extent = EXTENT.exec(text);
  if (extent !== null) push(zones, "extent", extent[0], extent.index);

  const url = URL_RE.exec(text);
  if (url !== null) push(zones, "url", url[0], url.index);

  /*
   * A paragraph can consist of words and nothing else; calling that a "title"
   * would be a fabrication rather than a recognised zone. The same guard
   * `parse.ts` carries, for the same reason.
   */
  const hasPrescribed = imprintAt !== -1 || respAt !== -1 || url !== null;
  const unparsed = !hasPrescribed
    ? "no prescribed punctuation mark found"
    : zones.find((z) => z.id === "title") === undefined
      ? "no main title found"
      : null;

  return { record, zones: unparsed === null ? zones : [], unparsed };
}

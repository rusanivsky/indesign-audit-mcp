import { EN_DASH, FOREIGN_DASHES, H, UK_UPPER } from "./chars.js";
import type { BibRecord, SegmentResult, SkippedParagraph } from "./types.js";
import type { ContainerSnapshot } from "../corrections/types.js";

/**
 * A paragraph becomes a record only when it has BOTH a number AND a
 * discriminator.
 *
 * THE NUMBER ALONE ISN'T ENOUGH, and this is measured (spec §4): section
 * headings are numbered exactly the same way as records, so a number-only
 * pattern gave six sections out of the first six "records" — «4. Iсторичне
 * краєзнавство», «2. Теорія та філософія історії України», «3. Населення.
 * Демографія». The trap fired on two independent runs, and both times it
 * only became visible once someone looked at the sample with their own
 * eyes.
 *
 * The discriminator: a zone separator OR a four-digit year. A section
 * heading has neither — it's short and consists of just the title.
 */
/*
 * The space is `H`, not `\s` (finding M4). `parse.ts:81` already uses `H`
 * for the SAME prefix («number, period, space»), and two modules that
 * understand the same boundary differently drift apart silently: `\s`
 * matches a paragraph mark, `H` doesn't. Since `closeOpen()` no longer
 * substitutes a space for `\r` (fix C1 below), the difference stopped being
 * theoretical.
 */
export const DEFAULT_RECORD_PATTERN = `^${H}*(\\d{1,5})\\.${H}+(?=[${UK_UPPER}A-Z„"«\\[])`;
export const DEFAULT_RECORD_DISCRIMINATOR =
  `(?:\\s[${FOREIGN_DASHES}${EN_DASH}]\\s)|(?<!\\d)(?:19|20)\\d\\d(?!\\d)`;

/** A cross-reference like «Див. також №: 195, 219.» — not a record, and never will be. */
const CROSS_REFERENCE = /^\s*Див\.\s+також\s+№/u;

function pageAt(snapshot: ContainerSnapshot, index: number): string {
  for (const run of snapshot.pageRuns) {
    if (index >= run.start && index < run.end) return run.page;
  }
  return snapshot.pageRuns.at(-1)?.page ?? "?";
}

/**
 * An open, not-yet-closed record. `end` keeps moving out while
 * continuation paragraphs keep getting attached; `number` doesn't change
 * from the moment it opens.
 */
interface OpenRecord {
  start: number;
  end: number;
  number: number;
}

export function segmentContainer(
  snapshot: ContainerSnapshot,
  opts: { recordPattern?: string; recordDiscriminator?: string } = {},
): SegmentResult {
  const records: BibRecord[] = [];
  const skipped: SkippedParagraph[] = [];
  const numberingGaps: Array<{ after: number; next: number }> = [];

  /* Master pages are skipped — the same logic as in src/tools/typography.ts:29. */
  if (snapshot.isMaster) return { records, skipped, numberingGaps };

  const numberRe = new RegExp(opts.recordPattern ?? DEFAULT_RECORD_PATTERN, "u");
  const discriminatorRe = new RegExp(
    opts.recordDiscriminator ?? DEFAULT_RECORD_DISCRIMINATOR,
    "u",
  );

  /*
   * A record is often split across several paragraphs — heading and
   * description separately (task 15, measured on the live book: the
   * "paragraph = record" model caught 76 records out of 1159 present, and
   * the discriminator rejected the remaining 93% precisely because it only
   * saw the record's first paragraph). Segmentation is therefore
   * block-based: a record "opens" on a paragraph with a number and
   * "closes" on an empty paragraph, a paragraph with the NEXT number, or
   * the end of the container. The discriminator is checked against the
   * ASSEMBLED block, not the first paragraph.
   */
  let open: OpenRecord | null = null;

  const closeOpen = (): void => {
    if (open === null) return;
    const { start, end, number } = open;
    open = null;

    /*
     * OFFSETS: rules-dstu.ts and rules-nbsp.ts compute Finding.start as
     * record.start + localOffset in CONTAINER coordinates. So a record's
     * text is EXACTLY the slice `container.text.slice(start, end)`, not a
     * concatenation of paragraphs and not a slice with substituted
     * characters.
     *
     * `\r` STAYS `\r` — this is the fix for finding C1 of the final review.
     * It used to be replaced with a space character-for-character (which
     * kept the slice length the same, so offsets "lined up"), but no layer
     * below it already distinguished a real space from a paragraph
     * boundary. The consequence, reproduced by execution on the form of the
     * «name index» (`967. Прізвище, А. В.\rНазва праці…`): `bib-nbsp-initials`
     * produced a finding EXACTLY at the paragraph mark and proposed placing
     * U+00A0 there — i.e. MERGING two paragraphs. The same class of bug
     * touched `bib-zone-separator` and `bib-prescribed-spacing`: a
     * separator could "cross" a paragraph boundary.
     *
     * Why "don't substitute" specifically — the cheapest fix: `H`
     * (`[^\S\r\n]`, chars.ts) by construction does NOT match `\r`, so every
     * rule built on `H` simply doesn't fire at a paragraph boundary — and
     * that's correct behavior (a non-breaking space can't be placed
     * "instead of" a paragraph mark). The contract
     * `container.text.slice(f.start, f.end) === f.before` becomes an
     * identity by construction, not a coincidence.
     *
     * The cost: rules that used to rely on a paragraph boundary LOOKING
     * like a space now have to name `\r` explicitly. Such spots are marked
     * in `rules-dstu.ts` (`ABBREV_CANDIDATE`, `NEEDS_BOTH_SIDES`) — without
     * them, some findings would silently vanish, and the disappearance
     * would look like "it got clean".
     */
    const text = snapshot.text.slice(start, end);
    if (!discriminatorRe.test(text)) {
      skipped.push({ reason: "no-discriminator", text, start });
      return;
    }

    const previous = records.at(-1);
    if (previous !== undefined && number !== previous.number + 1) {
      numberingGaps.push({ after: previous.number, next: number });
    }
    records.push({
      number,
      text,
      containerId: snapshot.containerId,
      start,
      end,
      page: pageAt(snapshot, start),
    });
  };

  let offset = 0;
  for (const para of snapshot.text.split("\r")) {
    const start = offset;
    const end = start + para.length;
    offset = end + 1; // +1 — the \r character itself, which split ate

    if (para.trim() === "") {
      /* An empty paragraph — the boundary between records (spec §task 15). */
      closeOpen();
      continue;
    }

    if (CROSS_REFERENCE.test(para)) {
      /*
       * «Див. також №:» closes an open record the same way an empty
       * paragraph or a new number does — otherwise this text ends up both
       * in `skipped` AND inside a record's slice at the same time, and the
       * DSTU rules (bib-abbrev, bib-prescribed-spacing) produce findings
       * attributed to the wrong record.
       */
      closeOpen();
      skipped.push({ reason: "cross-reference", text: para, start });
      continue;
    }

    const m = numberRe.exec(para);
    if (m !== null) {
      /* A new number closes the previous open record and opens its own. */
      closeOpen();
      open = { start, end, number: Number(m[1]) };
      continue;
    }

    if (open !== null) {
      /* A continuation paragraph — extend the open record. */
      open.end = end;
    } else {
      /* No open record — this is either a section heading or a tail that lost its head. */
      skipped.push({ reason: "heading", text: para, start });
    }
  }
  closeOpen();

  return { records, skipped, numberingGaps };
}

import { hasCyrillic, HN, LATIN_LOWER, LATIN_UPPER } from "./latin.js";
import type { BibRecord, SegmentResult, SkippedParagraph } from "./types.js";
import type { ContainerSnapshot } from "../corrections/types.js";

/**
 * Segments a container into Chicago bibliography entries.
 *
 * A Chicago entry is ONE paragraph: bibliographies are set with a hanging
 * indent, so continuation lines are soft wraps, not paragraphs. That is the
 * opposite of the ДСТУ index, where block-based segmentation was required
 * (`segment.ts`) because a record spans several paragraphs.
 *
 * One exception is MEASURED, not assumed: the CIP block of a translated
 * edition puts its heading on its own paragraph — `Surname Firstname.\rTitle
 * / …`. So a paragraph carrying an opener stays OPEN and absorbs the
 * paragraphs after it, exactly as a numbered record does on the ДСТУ side.
 * Only the thing that opens it differs, and that difference is the whole
 * reason this file exists: on this edition the numbered segmenter found
 * `records: 0` and filed 1866 paragraphs as headings.
 */

/**
 * What may OPEN an entry: an inverted personal name, or Chicago's 3-em dash
 * standing in for a repeated author.
 *
 * THE SECOND TOKEN MUST LOOK LIKE A GIVEN NAME — either `Ann` (a capital with
 * a lowercase tail) or `J.` (an initial). "Capitalised" is NOT enough, and
 * that is measured, not reasoned: the first version of this pattern required
 * only `[A-Z]`, and a live run over the English edition opened five false
 * entries out of six, every one of them prose —
 *
 *     When I found out …      Today I’m a mom …      Here I want to speak …
 *     Professionally, I …     Do NOT rely on AI …
 *
 * — because «When I», «Today I», «Do NOT» all satisfy `[A-Z][a-z]+ [A-Z]`.
 * That is the ДСТУ trap exactly, arrived at by a different road: the unit test
 * meant to guard against it had picked prose whose second word happened to be
 * lowercase, so it proved nothing about the real book.
 *
 * A lone `I` fails both alternatives; `NOT` has no lowercase tail and is not
 * an initial; `I’m` breaks on the apostrophe.
 */
const GIVEN_NAME =
  `(?:[${LATIN_UPPER}][${LATIN_LOWER}]+|[${LATIN_UPPER}]\\.)`;

export const CHICAGO_OPENER =
  `^${HN}*(?:———\\.` +
  `|[${LATIN_UPPER}][${LATIN_LOWER}]+(?:[-'’][${LATIN_UPPER}]?[${LATIN_LOWER}]+)*` +
  `,?${HN}+${GIVEN_NAME})`;

/**
 * What makes an opened block an ENTRY rather than a sentence that happens to
 * begin with two name-shaped words. The opener alone repeats the exact trap
 * ДСТУ hit.
 *
 * `HN` and not `H` in the place/publisher alternative: the live record breaks
 * the line right there, between the colon and the publisher.
 *
 * A QUOTED PHRASE IS NOT A DISCRIMINATOR, and the alternative that treated one
 * as an article title has been removed. The same live run showed why: running
 * prose is full of quoted words — «boom-», «just in case,», «fighting the
 * swings» — and every false entry above cleared the discriminator on one of
 * them. Nothing is lost by removing it: a Chicago article entry carries a year
 * as well as a title, so the year alternative still opens it.
 */
export const CHICAGO_DISCRIMINATOR =
  `(?:(?<!\\d)(?:1[5-9]|20)\\d\\d(?!\\d)` + // a year of publication
  `|[${LATIN_UPPER}][${LATIN_LOWER}]+${HN}*:${HN}+[${LATIN_UPPER}]` + // «City: Publisher»
  `|https?://)`;

function pageAt(snapshot: ContainerSnapshot, index: number): string {
  for (const run of snapshot.pageRuns) {
    if (index >= run.start && index < run.end) return run.page;
  }
  return snapshot.pageRuns.at(-1)?.page ?? "?";
}

interface OpenBlock {
  start: number;
  end: number;
}

export function segmentChicago(
  snapshot: ContainerSnapshot,
  opts: { recordPattern?: string; recordDiscriminator?: string } = {},
): SegmentResult {
  const records: BibRecord[] = [];
  const skipped: SkippedParagraph[] = [];

  /* Master pages are skipped — the same choice as segment.ts and typography.ts. */
  if (snapshot.isMaster) return { records, skipped, numberingGaps: [] };

  const openerRe = new RegExp(opts.recordPattern ?? CHICAGO_OPENER, "u");
  const discriminatorRe = new RegExp(opts.recordDiscriminator ?? CHICAGO_DISCRIMINATOR, "u");

  let open: OpenBlock | null = null;

  const closeOpen = (): void => {
    if (open === null) return;
    const { start, end } = open;
    open = null;

    /*
     * The slice is taken RAW — `\r` stays `\r`. Every rule computes
     * `Finding.start` as `record.start + localOffset` in container
     * coordinates, so `container.text.slice(start, end) === record.text` has to
     * be an identity by construction rather than a coincidence. `segment.ts`
     * learned this expensively: substituting a space for `\r` kept the lengths
     * equal, and produced a finding that proposed MERGING two paragraphs.
     */
    const text = snapshot.text.slice(start, end);

    if (!discriminatorRe.test(text)) {
      skipped.push({ reason: "no-discriminator", text, start });
      return;
    }

    records.push({
      /* Chicago entries are unnumbered; the ordinal is the only identifier there is. */
      number: records.length + 1,
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
    offset = end + 1; // +1 — the \r that split ate

    if (para.trim() === "") {
      closeOpen();
      continue;
    }

    if (hasCyrillic(para)) {
      /*
       * The language gate, and it sits HERE — at paragraph level, ahead of the
       * opener — because measurement moved it.
       *
       * It was first written inside `closeOpen`, testing the assembled block.
       * That branch turned out to be UNREACHABLE for the case it was written
       * for: a Ukrainian record never opens in the first place, since the
       * opener demands `[A-Z][a-z]+`. The record was therefore filed as
       * `heading` — a reason that says "this looked like a section title" when
       * the truth is "this is not our material at all". For a tool whose skip
       * reasons are its only account of what it did NOT judge, a plausible
       * wrong reason is worse than a blunt right one.
       *
       * Placed here it also stops a Latin-opened block from absorbing a
       * Cyrillic continuation paragraph, which the block-level test could only
       * have caught by discarding the whole entry.
       *
       * Why a script test rather than a read of InDesign's language attribute:
       * the attribute costs a separate bridge call and, on a localised build,
       * the language-name comparison silently yields zero — the failure mode
       * `typography_audit` has to carry as `ukrainianRuns`. A script test
       * cannot fail that way.
       *
       * ITS MEASURED VALUE IS SMALLER THAN IT LOOKS, and saying so here is the
       * point of the comment. Disabled and re-run against all three books, the
       * outcome does not change: same records, same findings, only the skip
       * reason differs (`cyrillic: 2079` becomes `heading` on the Ukrainian
       * edition). The Latin-only opener is what actually keeps Cyrillic out;
       * this is a second lock on a door the first one already holds.
       *
       * It is kept for a case these books do not contain and the tool is meant
       * to serve: a UKRAINIAN work with a LATIN-SCRIPT source list. There
       * Chicago is the right standard, the document is full of Cyrillic, and
       * this gate stops a Latin-opened entry from absorbing the Cyrillic
       * paragraph beside it. That protection is unmeasured on real material —
       * only unit-tested — and must not be described as proven.
       *
       * What it does NOT do, on any book: make the segmenter safe on an
       * English book whose prose contains years. There the discriminator can
       * still open a false entry — it did, five times, before the opener was
       * tightened — which is why the counts are reported and why the write
       * path is gated on the record count.
       */
      closeOpen();
      skipped.push({ reason: "cyrillic", text: para, start });
      continue;
    }

    if (openerRe.test(para)) {
      closeOpen();
      open = { start, end };
      continue;
    }
    if (open !== null) {
      open.end = end;
    } else {
      skipped.push({ reason: "heading", text: para, start });
    }
  }
  closeOpen();

  /* Chicago entries carry no numbering, so there are no gaps to report. */
  return { records, skipped, numberingGaps: [] };
}

/**
 * Draft config scaffolder — `--init`.
 *
 * WHAT THIS SOLVES. Spec §11 calls the config a transferred cost: what the
 * document doesn't know about itself, a person must name. But out of sixty
 * config lines, only a handful are human decisions, and the rest is what
 * the document ITSELF KNOWS: its own name, how many pages it has, what
 * styles it uses. Until now a person wrote everything, including what
 * could be read automatically — and every new book cost hours on a JSON
 * file where it's easy to make a silent mistake.
 *
 * WHAT THIS SCAFFOLDER DOES NOT DO — AND THIS IS THE MAIN POINT. It does
 * NOT guess which style is the folio and which is body text. The
 * temptation is huge: names like `Нумерація L`, `Колонтитул R`,
 * `03 Основний текст` are self-descriptive, and a rule "take the one whose
 * name contains the word 'Нумерація'" would be written in a minute. This
 * exact kind of name-based guess already cost this project a Critical
 * (R26) once: a name addresses nothing, and a silently wrong config
 * produces a silently wrong report — the most expensive kind of failure,
 * because it looks like work.
 *
 * So every human decision leaves marked `UNCONFIRMED`, and Tier 1
 * validation REFUSES as long as even one remains. That is, running on an
 * underfilled draft is impossible by construction, not by convention. The
 * candidates are shown to the person in the hint alongside it — the choice
 * remains theirs.
 */
import type { AuditConfig } from "./schema.js";

/**
 * Marker: "a human must decide here".
 *
 * Short and deliberately impossible as a real style name: InDesign allows
 * angle brackets in names, but no one uses `<?>` outright. A longer text
 * ("CONFIRM") would tempt someone to leave it as is, since it looks like a
 * real value.
 */
export const UNCONFIRMED = "<?>";

/** What the document tells about itself (`doc_overview`). */
export interface DocumentPassport {
  docName: string;
  /** `null` — the document hasn't been saved to disk yet. */
  fullName: string | null;
  pageCount: number;
  paragraphStyles: string[];
}

/**
 * The path the config will use to address the document.
 *
 * An unsaved document has no path, but `chooseDocument` can attach to it
 * by file NAME when there is exactly one such candidate
 * (`src/cli/run/session.ts`). So for an unsaved document we write the name
 * itself: it works right now, and as soon as the document is saved, the
 * line must be replaced with the full path, because a document's identity
 * is its path, not its name (R10/R23).
 */
export function pathForConfig(doc: DocumentPassport): string {
  return doc.fullName ?? doc.docName;
}

/** The edition's title, from the file name, without the extension. */
export function titleFromName(docName: string): string {
  return docName.replace(/\.indd$/i, "");
}

/**
 * The config draft.
 *
 * WHAT'S FILLED FROM MEASUREMENT: the name, the path, and nothing more —
 * everything else is either a human decision or something the audit
 * measures and reports on its own anyway.
 *
 * WHAT'S FILLED BY DEFAULT: `print`. 300 ppi and 300% ink are PRINTER
 * requirements, not a property of the file; the document doesn't and can't
 * know them. A default here is more honest than `UNCONFIRMED`: these
 * are commonly used numbers, they're printed in the report verbatim, and
 * the reader sees what they were compared against. `expectedInks: 4` is
 * the same: it's the client's expectation, not a measurement; how many
 * inks are ACTUALLY in the file is what `color_audit` will say, and any
 * discrepancy becomes a finding, not silent agreement.
 *
 * WHAT'S LEFT TO THE HUMAN: everything that addresses styles. These are
 * exactly the fields where a mistake produces not a crash, but a wrong
 * number.
 */
export function scaffoldConfig(doc: DocumentPassport): AuditConfig {
  return {
    edition: {
      title: titleFromName(doc.docName),
      docPath: pathForConfig(doc),
    },
    print: { minPpi: 300, maxTotalInk: 300, expectedInks: 4 },
    families: {
      color: {},
      geometry: { nearMissPt: 3 },
      spelling: {},
      typography: {},
      styles: {},
      pagination: {
        folio: { styleNames: [UNCONFIRMED] },
        runningHead: { styleNames: [UNCONFIRMED] },
        headingStyles: [UNCONFIRMED],
      },
      composition: { spacingMode: "style-bounds" },
      layout: {},
      bibliography: {},
      /*
       * A MARKER, NOT AN EMPTY LIST (transfer §3.3). `rules: []` is a state
       * WORSE than `notApplicable`: the pass runs, pays for the whole
       * document traversal, checks nothing, and disappears from the report
       * entirely (`out.sequences` doesn't even appear for an empty list). A
       * draft that PRODUCED this state by default handed it to every new
       * edition, and `unfilledSpots` didn't see it: an empty array
       * contains no markers.
       *
       * Now this is an ordinary unfilled spot, like the rest: either name a
       * style, or declare the family not applicable with a reason.
       */
      sequences: { rules: [{ style: UNCONFIRMED }] },
      extras: { bodyTextStyles: [UNCONFIRMED] },
    },
  } as AuditConfig;
}

/**
 * All the places in the config where `UNCONFIRMED` still stands, with
 * their paths.
 *
 * The traversal is generic (objects and arrays), not a list of known
 * fields: a list would drift out of sync with the schema the moment a
 * field is added to it — and a silent gap in this check would mean running
 * on an unresolved config.
 */
export function unfilledSpots(node: unknown, path = ""): string[] {
  if (typeof node === "string") return node === UNCONFIRMED ? [path] : [];
  if (Array.isArray(node)) {
    return node.flatMap((value, i) => unfilledSpots(value, `${path}[${i}]`));
  }
  if (node !== null && typeof node === "object") {
    return Object.entries(node).flatMap(([key, value]) =>
      unfilledSpots(value, path === "" ? key : `${path}.${key}`),
    );
  }
  return [];
}

/**
 * A hint for the operator: all the document's paragraph styles, so there's
 * something to choose from. Printed NEXT TO the file, not inside it: the
 * config is read by a strict schema, which rejects an extra key
 * (`unrecognized_keys`), and JSON has no comments.
 *
 * Styles are NOT sorted or grouped by guesswork: the order stays whatever
 * the document handed them in, because that order is meaningful (the
 * layout artist keeps styles in order of use), and any grouping would be
 * the same name-based guess, just dressed up as convenience.
 */
export function підказкаСтилів(doc: DocumentPassport): string {
  const lines = [
    `Document: ${doc.docName} — ${doc.pageCount} pages, paragraph styles ${doc.paragraphStyles.length}.`,
    "",
    `Fill in every "${UNCONFIRMED}" in the config. As long as even one remains,`,
    "the audit will refuse to start — before it even touches InDesign.",
    "",
    "  pagination.folio.styleNames       — FOLIO styles (page number)",
    "  pagination.runningHead.styleNames — RUNNING HEAD styles",
    "  pagination.headingStyles          — chapter HEADING styles",
    "  extras.bodyTextStyles             — BODY TEXT styles",
    "",
    "Declare a family that doesn't apply to this edition as not applicable, with a reason:",
    '  "bibliography": { "notApplicable": "this edition has no bibliography" }',
    "",
    "This document's paragraph styles, in the document's own order:",
    ...doc.paragraphStyles.map((s) => `  ${s}`),
  ];
  return lines.join("\n");
}

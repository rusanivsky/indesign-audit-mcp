/**
 * Types for the bibliography layer. Boundary of responsibility: this
 * directory knows NOTHING about InDesign or about corrector's marks — it
 * works with strings. Same decision as the one `src/typography/` holds to
 * (see `src/typography/rule.ts:1`).
 */

/**
 * `cyrillic` belongs to the Chicago dialect only: an entry whose text carries
 * a Cyrillic letter is not opened at all. It is a SKIP REASON rather than a
 * silent drop because a gate that removes material without saying so reads as
 * "there was nothing there".
 */
export type SkipReason = "heading" | "cross-reference" | "no-discriminator" | "cyrillic";

export interface BibRecord {
  /** Record number — the natural identifier for a bibliographer ("record 967"). */
  number: number;
  text: string;
  containerId: string;
  /** Offsets into the CONTAINER text, not into the record's own text. */
  start: number;
  end: number;
  page: string;
}

export interface SkippedParagraph {
  reason: SkipReason;
  text: string;
  start: number;
}

export interface SegmentResult {
  records: BibRecord[];
  skipped: SkippedParagraph[];
  numberingGaps: Array<{ after: number; next: number }>;
}

export type ZoneId =
  | "heading"
  | "title"
  | "subtitle"
  | "responsibility"
  | "source"
  | "imprint"
  | "extent"
  | "notes"
  /*
   * Chicago splits what ISBD keeps together as one `imprint` zone. It has to:
   * the rules that fire there address the parts separately — a space before
   * the colon belongs to `place`, full caps belong to `publisher`, and the
   * year is the element a Chicago entry ends on.
   */
  | "place"
  | "publisher"
  | "year"
  | "url";

export interface Zone {
  id: ZoneId;
  /** Offsets within the RECORD's own text. */
  start: number;
  end: number;
  text: string;
}

export interface ParsedRecord {
  record: BibRecord;
  zones: Zone[];
  /** Reason parsing failed; null means it parsed successfully. */
  unparsed: string | null;
}

export type Confidence = "high" | "needs-review";

export interface Finding {
  ruleId: string;
  title: string;
  confidence: Confidence;
  recordNumber: number;
  containerId: string;
  page: string;
  zone: ZoneId | null;
  /** Offsets into the CONTAINER text — so the finding can be shown in the document. */
  start: number;
  end: number;
  before: string;
  suggested: string;
  contextBefore: string;
  contextAfter: string;
  /** The standard's clause it diverges from. The bibliographer must see the basis. */
  basis: string;
}

export type UniformityVerdict = "systematic" | "scattered" | "mixed";

export interface UniformityFact {
  id: string;
  forms: Array<{ value: string; count: number }>;
  dominantShare: number;
  verdict: UniformityVerdict;
}

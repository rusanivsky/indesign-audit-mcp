import type { Suggestion } from "./matcher.js";
import type { SeamNormalization } from "../typography/seam.js";

export type CorrectionAction = "replace" | "delete" | "insert";

/** One correction request, regardless of which channel it arrived from. */
export interface CorrectionRequest {
  id: string;
  action: CorrectionAction;
  /** For insert — the anchor text, AFTER which new is inserted. */
  old: string;
  /** For delete — an empty string. */
  new: string;
  pageHint?: number;
  /** The corrector's original comment, for reference only. */
  note?: string;
  /** Context from the PDF annotation — needed to anchor short corrections (K1). */
  contextBefore?: string;
  contextAfter?: string;
}

export interface PageRun {
  start: number;
  end: number;
  page: string;
}

/** Snapshot of a single text container, read from InDesign. */
export interface ContainerSnapshot {
  /** Opaque identifier, e.g. "story:3" or "story:3/table:0/cell:2,1". */
  containerId: string;
  text: string;
  pageRuns: PageRun[];
  /** Index from which the text no longer fits the frames; null — no overset. */
  oversetFrom: number | null;
  isMaster: boolean;
  kind: "text" | "footnote" | "table";
}

/**
 * T-trim (wave C1 review). clampToParagraph (matcher.ts) silently trims the
 * write range to the paragraph boundary, while `new` is written verbatim
 * (Global Constraint: "exactly the new field is written to the document").
 * Two separate warnings, not one blurred one:
 *  - clamped-to-paragraph: the trimming itself — the write range is narrower
 *    than what the operator dictated via `old`. The flag is always true when
 *    the head and/or tail was trimmed, regardless of `new`'s content.
 *  - possible-stray-space: a targeted risk signal. Fires only when the
 *    trimmed edge BORDERS a whitespace edge of `new` — meaning a stray space
 *    could genuinely be left at the paragraph-end-mark seam. On a large
 *    document (547 stories) noise would devalue the warning, so it doesn't
 *    fire where the artifact is impossible (delete writes an empty string,
 *    or `new` has no whitespace on the corresponding edge).
 */
export type Warning =
  | "in-overset"
  | "on-master-page"
  | "in-footnote"
  | "in-table-cell"
  | "multiple-char-styles"
  | "multiple-para-styles"
  | "clamped-to-paragraph"
  | "possible-stray-space";

export interface Candidate {
  candidateId: string;
  containerId: string;
  start: number;
  end: number;
  page: string;
  contextBefore: string;
  matchText: string;
  contextAfter: string;
  warnings: Warning[];
  /**
   * The text that will ACTUALLY land in the document at this candidate's
   * spot — the `new` field after typographic normalization in the seam
   * context (B4). Computed once, during the dry run; corrections_apply just
   * takes it. This way the plan and the application can't diverge.
   */
  writeText: string;
  /** What exactly the normalization changed. Empty — `new` went verbatim. */
  normalizations: SeamNormalization[];
}

export type PlanItemStatus = "unique" | "ambiguous" | "not_found" | "already_applied";

/** The place where `new` already stands — proof for the already_applied status. */
export interface AppliedPlace {
  containerId: string;
  start: number;
  end: number;
  page: string;
  contextBefore: string;
  matchText: string;
  contextAfter: string;
}

export interface PlanItem {
  id: string;
  status: PlanItemStatus;
  request: CorrectionRequest;
  candidates: Candidate[];
  suggestions: Suggestion[];
  /**
   * Filled in only for already_applied: the single place in the document
   * where `new` already stands. A status that silently skips a correction
   * must show on what grounds it skips it.
   */
  appliedAt?: AppliedPlace;
  /**
   * Filled in only if there were more matches than the plan's limit: how
   * many candidates were shown and how many were actually found. A
   * truncation must not look like "that's all there was".
   */
  candidatesTruncated?: { shown: number; total: number };
}

export interface Plan {
  planId: string;
  createdAt: string;
  docName: string;
  items: PlanItem[];
}

/** Report on applying a batch of corrections — what the apply_edits handler returns. */
export interface ApplyReport {
  /** Full path to the document copy made before any changes. */
  backupPath: string;
  /** How many old copies were removed during the _backups/ rotation (Task A4). */
  backupsRemoved: number;
  /**
   * Error message from the copy rotation if it failed (Task A4, round 2) —
   * e.g. the file is locked by a cloud sync. Rotation is cosmetic, not a
   * safeguard: its failure does NOT abort writing the corrections —
   * backupPath and applied are returned all the same. null if rotation
   * completed without error (regardless of whether anything needed removing).
   */
  backupRotationError: string | null;
  applied: { requestId: string; candidateId: string }[];
  skipped: {
    requestId: string;
    candidateId: string;
    reason: string;
    expected: string;
    actual: string;
  }[];
  /**
   * Corrections on which the write threw an exception (locked layer or
   * story, a frame on a locked master page). The batch is not aborted
   * because of this: the rest go through, and the report with backupPath is
   * returned to the user either way.
   */
  failed: { requestId: string; candidateId: string; reason: string }[];
  /** Story identifiers with overset before and after the corrections — to see whether text shifted. */
  oversetBefore: string[];
  oversetAfter: string[];
  pageCountBefore: number;
  pageCountAfter: number;
  /**
   * An exception that occurred AFTER the document copy was created. The
   * handler doesn't rethrow it, because then backupPath would be lost along
   * with the stack — and that's the one thing the user needs most.
   */
  fatalError?: string;
}

/**
 * Report diffs (spec §4.5): not "which stories are in overset", but which
 * BECAME so after the corrections, and by how much the page count shifted.
 */
export interface ApplyDiffs {
  becameOverset: string[];
  noLongerOverset: string[];
  /** Positive — page count grew; negative — the text got more compact. */
  pageCountDelta: number;
}

export interface ApplyOutcome extends ApplyReport {
  diffs: ApplyDiffs;
}

export interface AcceptedEdit {
  requestId: string;
  candidateId: string;
  containerId: string;
  start: number;
  end: number;
  /** The text that must stand in the range at write time. Checked before the correction. */
  expectedOld: string;
  newText: string;
  action: CorrectionAction;
}

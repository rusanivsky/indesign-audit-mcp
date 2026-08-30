/**
 * B5.3. Shared by ALL five composition detectors (Tasks 8–11): the finding
 * key, and the single answer to the question "what can be compared with
 * what".
 *
 * WHY THIS FILE EXISTS
 * =====================
 * `findingId` was born in `detect-spacing.ts`, and the next two detectors
 * imported it FROM THERE — meaning the module about spacing tightness became
 * the de-facto owner of a shared vocabulary and dragged `Calibration`,
 * `spaceWidths`, and the rest of its apparatus along for everyone who only
 * needed the line key. A finding key belongs to no single detector; it
 * belongs to all of them.
 *
 * The second thing that lives here is the `DefectClass → StrengthScale` map.
 * It's needed exactly because `Finding.strength` is contractually comparable
 * ONLY WITHIN A SINGLE CLASS, while in fact three modules independently
 * documented that some CLASSES ARE ALSO comparable WITH EACH OTHER, because
 * they measure the same quantity. Until now that information lived only in
 * three prose comments and was unreachable by machine — see below.
 */

import type { DefectClass, LineMeasure } from "./types.js";

/**
 * A stable finding key. The triple (container, paragraph, line) addresses a
 * line unambiguously, so the key survives a repeat run and gives Tasks 13–14
 * something to anchor a fix to.
 *
 * MOVED HERE FROM `detect-spacing.ts` (Task 11). The body is unchanged — only
 * the owner changed, so all previously issued keys stay the same.
 */
export function findingId(line: LineMeasure, defect: string): string {
  return `${defect}:${line.containerId}:${line.paragraphIndex}:${line.lineInParagraph}`;
}

/**
 * STRENGTH SCALE — the quantity `Finding.strength` is measured in.
 *
 * This is Task 11's answer to "how do you fold four detectors into one
 * ranking": **you don't, and here is the exact boundary of what CAN be
 * folded together.**
 *
 * `Finding.strength` only allows comparison within a class. But three
 * modules, each independently, documented that SOME PAIRS OF CLASSES measure
 * the same quantity and are comparable with each other:
 *
 * - `detect-spacing.ts` on `tight`/`loose`: "the quantity makes both sides
 *   comparable IN UNITS" — both are a fraction of excess air relative to the
 *   measure;
 * - `detect-lines.ts` on `widow`/`short-last-line`: "These two classes are
 *   comparable with each other (one quantity), and it's the only pair in the
 *   module" — both are line emptiness `1 − fill`;
 * - `detect-hyphens.ts` on `hyphen-across-spread`/`hyphen-forbidden`: "Both
 *   classes measure ONE quantity, so they're comparable with each other —
 *   it's the only such pair in the module" — the fraction of a word carried
 *   across a break.
 *
 * Until now these three claims existed ONLY IN PROSE. The consumer (Task 12)
 * had no way to learn that `widow` and `short-last-line` can go into one
 * ranked list while `widow` and `orphan` cannot, and would have had to either
 * re-derive it from the comments or lose it.
 *
 * Ten classes yield SEVEN scales. The order of the scales themselves relative
 * to each other is NOT DEFINED — `detectAll` sorts them by name precisely
 * because alphabetical order is obviously meaningless and reads as a refusal
 * rather than a claim (the idiom from Tasks 9 and 10).
 */
export type StrengthScale =
  /**
   * Excess inter-word air as a fraction of the measure. `detect-spacing.ts`.
   *
   * A CAVEAT that must travel together with the scale (`detect-spacing.ts:
   * 224-227`): `tight` and `loose` are comparable **in units, but not in
   * range**. The tightest possible line has zero spacing, so its strength is
   * bounded above at roughly 10–20% of the measure, while a loose line has no
   * upper bound at all. So `groupByScale().get("air-fraction")`, presented as
   * "N worst", systematically buries `tight` under `loose`. Anyone who wants
   * to see tight lines should filter them separately by `defect`.
   */
  | "air-fraction"
  /** The fraction of a word carried across a break. `detect-hyphens.ts`. */
  | "carried-fraction"
  /** Line emptiness, `1 − fill` of the measure. `detect-lines.ts`. */
  | "emptiness"
  /** Length of a run of hyphens across lines. `detect-hyphens.ts`. */
  | "ladder-rows"
  /** The fraction of a paragraph cut off by a frame seam. `detect-lines.ts`. */
  | "paragraph-share"
  /** White river channel: lines × gap width / measure. `detect-rivers.ts`. */
  | "river-channel"
  /**
   * A REFUSAL TO RANK, NOT A MEASUREMENT. The defect is binary: a dash either
   * starts the line or it doesn't, and "worse" means nothing here. Strength is
   * constant, so within the scale `id` sets the order — effectively the
   * line's address.
   *
   * The name is deliberately generic: the next binary class should land here
   * too, rather than starting an eighth scale.
   *
   * A CONSEQUENCE to know in advance: in the scale alphabet, `unranked` comes
   * LAST, so in `detectAll`'s flat result these findings sit at the end. The
   * `slice(0, N)` trap from `detect.ts`'s header makes this sharper: the slice
   * will never show them. Read them via `groupByScale` or `byDocumentOrder`.
   */
  | "unranked";

/**
 * Which quantity `strength` holds for each class. A complete map, no
 * defaults: `Record<DefectClass, …>` won't let a class be added to
 * `DefectClass` without naming its scale — that's exactly why it's a
 * `Record` here, not a `Partial`.
 */
export const STRENGTH_SCALE: Record<DefectClass, StrengthScale> = {
  tight: "air-fraction",
  loose: "air-fraction",
  widow: "emptiness",
  "short-last-line": "emptiness",
  orphan: "paragraph-share",
  "hyphen-ladder": "ladder-rows",
  "hyphen-across-spread": "carried-fraction",
  "hyphen-forbidden": "carried-fraction",
  river: "river-channel",
  "line-start-dash": "unranked",
};

/** The finding's scale — the one place the map is read. */
export function strengthScaleOf(defect: DefectClass): StrengthScale {
  return STRENGTH_SCALE[defect];
}

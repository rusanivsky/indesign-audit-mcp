/**
 * B5.3. Assembling five composition detectors into a single pass.
 *
 * This file measures nothing itself. Its entire weight sits in two decisions
 * that the five detectors deliberately left unmade, because none of them has
 * the right to make them unilaterally.
 *
 * DECISION 1: THERE IS NO SHARED ORDER, AND THAT IS RECORDED, NOT HIDDEN
 * ===================================================================
 * `Finding.strength` is, by contract, comparable only within its own class. The
 * five detectors measure strength in five different units: the air fraction
 * against the measure, line emptiness, paragraph fraction, run length in lines,
 * word fraction across the break; the river adds a sixth, and the binary dash
 * class measures nothing at all, so its scale is literally called `unranked`.
 * No shared scale exists for them, and **I am not inventing one** — this is
 * the same refusal Task 8 made about the threshold, which Tasks 9 and 10
 * repeated about the cross-class order of their own classes.
 *
 * But refusing alone isn't enough: the refusal has to be made READABLE. So:
 *
 * - the result is grouped by strength SCALE (`STRENGTH_SCALE` in `finding.ts`),
 *   not by class. That is strictly more information than grouping by class
 *   would give: three modules separately documented that some PAIRS of classes
 *   measure the same quantity and are comparable with each other
 *   (`tight`/`loose`, `widow`/`short-last-line`,
 *   `hyphen-across-spread`/`hyphen-forbidden`), and grouping by class would
 *   break those pairs — i.e. LOSE the comparability the detectors proved;
 * - the scales themselves are ordered by name. The alphabet is obviously
 *   meaningless, and that's exactly why it's here: it reads as a refusal, not
 *   a claim (the idiom Tasks 9 and 10 used);
 * - `detectAll` returns a flat array (the signature requires it), so for
 *   whoever needs the groups themselves, `groupByScale` sits right next to it.
 *   Whoever slices `slice(0, 20)` off the FLAT array gets the twenty worst of
 *   the FIRST scale alphabetically, not the twenty worst of the document — and
 *   that is exactly why slicing that way is not allowed. This is said both
 *   here and in the function's own doc.
 *
 * THE `slice` TRAP IS WORSE THAN IT LOOKS, and it's worth knowing in advance.
 * The alphabetically first scale is `air-fraction`, and it's also the biggest
 * one: in `"style-bounds"` mode that's 59.14% of the book's justified lines
 * (`docs/measured-facts-phase3.md`), and in `"rank"` mode it's simply
 * everything measured. So `slice(0, 20)` won't return a mixed sample in a
 * suspicious order that would make the bug visible — it will return EXACTLY
 * the density findings, a result that looks flawlessly correct while silently
 * hiding the other three detectors. The alphabet works against the reader
 * precisely because it doesn't draw attention to itself.
 *
 * Document order is also needed — a report that runs page by page reads
 * differently — so a ready-made comparator, `byDocumentOrder`, sits right
 * beside it. It is deliberately NOT the default, because it would destroy the
 * ranking each detector computed: in document order, `strength` plays no role
 * at all.
 *
 * DECISION 2: `Severity` STAYS, BUT ITS CONSTANCY IS NOW CHECKED
 * ======================================================================
 * Three detectors in a row (Tasks 9, 10, and 11) each independently found that
 * their weight is a constant `error`, and each wrote a paragraph of prose
 * about it. After five detectors the picture is complete, and it is this:
 * **weight varies in exactly two of ten classes** — `tight` and `loose`, and
 * only where the standard is declared by THE DOCUMENT ITSELF (the style's
 * numeric justification bounds, 80/133). For the remaining eight classes, no
 * document declares anything: `LineMeasure` carries neither
 * `hyphenateLadderLimit` nor Keep Options, nor anything about rivers.
 *
 * WHAT WAS DONE ABOUT IT — and why exactly this way:
 *
 * - **not dropped.** Dropping `severity` would mean losing the one thing it
 *   genuinely carries: in `detectSpacing(…, { mode: "rank" })` mode there is
 *   no filtering at all, so `error` vs `info` vs `unrated` is the ONLY signal
 *   for whether a line crossed the bound the document declared. Task 12 could
 *   reconstruct it only by keeping every `LineMeasure` alongside the
 *   `Calibration` and recomputing the bounds from scratch — exactly the work
 *   `strength` became a field to avoid;
 * - **not renamed and not extended.** There was a temptation to add a fifth
 *   value for "no standard exists," and it was rejected: `error` in the
 *   remaining eight classes isn't a lie. For `hyphen-ladder`, `short-last-line`,
 *   and `river` the bound is declared by the CALLER, which is exactly Task 8's
 *   `mode: "ratio"` case, where a line past that bound also gets `error`; for
 *   `widow`/`orphan`/`hyphen-across-spread`/`hyphen-forbidden` the predicate is
 *   binary, and the rule itself was violated. The problem with the weight
 *   isn't that it lies, it's that it's SILENT: the constant carries no
 *   information;
 * - **fixed mechanically.** `SEVERITY_VARYING_CLASSES` turns four paragraphs of
 *   prose into a single assertion a test checks. Until now it lived only in
 *   comments and could quietly rot: a detector that started emitting `warning`
 *   tomorrow would break nothing, and Task 12 would keep treating the weight
 *   as constant.
 *
 * WHEN THE WEIGHT SHOULD BE DROPPED (the condition is named in advance so it
 * doesn't have to be decided blind a second time): if Task 12 writes its
 * report and never reads `severity` outside `"rank"` mode. Then the field
 * serves one mode of one detector and should move there. But if the
 * measurement layer starts providing `hyphenateLadderLimit` (the most useful
 * change, named by Task 10), weight becomes variable for the ladder too — and
 * this comment will need to be rewritten the other way.
 */

import { type DashOptions, detectDashes } from "./detect-dashes.js";
import { detectHyphens, type HyphenOptions } from "./detect-hyphens.js";
import { detectLines, type LineOptions } from "./detect-lines.js";
import { detectRivers, type RiverOptions } from "./detect-rivers.js";
import { detectSpacing, type SpacingOptions } from "./detect-spacing.js";
import { type StrengthScale, strengthScaleOf } from "./finding.js";
import type { Calibration, DefectClass, Finding, LineMeasure } from "./types.js";

export interface DetectOptions {
  /**
   * MANDATORY. `SpacingOptions.mode` has no default — Task 8 removed it,
   * because the style-bounds rule flags 59.14% of the book's justified lines.
   * That decision isn't softened here: without `spacing`, `detectAll` throws,
   * rather than silently skipping the detector. A report with no density
   * findings because the detector wasn't run is indistinguishable from a
   * report with none because the set is clean — the same "null = clean"
   * substitution the module guards against.
   */
  spacing: SpacingOptions;
  lines?: LineOptions;
  hyphens?: HyphenOptions;
  rivers?: RiverOptions;
  /**
   * Optional, unlike `spacing`. The reason `spacing` is mandatory is the
   * measured 59.14%; carrying that requirement over to an unmeasured rule
   * would mean inventing a justification.
   */
  dashes?: DashOptions;
}

/**
 * Classes where `Finding.severity` is NOT constant.
 *
 * After five detectors there are exactly two, and both belong to
 * `detect-spacing.ts`, because only for spacing density does the document
 * itself declare the standard (the style's justification bounds). In the
 * remaining eight classes weight is always `error`; sorting, filtering, or
 * aggregating by it there is meaningless.
 *
 * Checked by a test across all five detectors. That's deliberate: until now
 * the claim lived as prose in three files and could silently drift out of
 * sync with the code.
 */
export const SEVERITY_VARYING_CLASSES: ReadonlySet<DefectClass> = new Set<DefectClass>([
  "tight",
  "loose",
]);

/**
 * Assembly order: first by strength SCALE (by name — a refusal, not a
 * claim), then within the scale by descending strength, ties broken by key.
 *
 * The rationale is in the file header. In short: strengths on different
 * scales are incommensurable, so a finding's position only makes sense
 * against findings on the same scale.
 */
export function byScaleThenStrength(a: Finding, b: Finding): number {
  const sa = strengthScaleOf(a.defect);
  const sb = strengthScaleOf(b.defect);
  if (sa !== sb) return sa < sb ? -1 : 1;
  return b.strength - a.strength || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Document order: page, container, paragraph, line, class. Ready for
 * Task 12, for when the report runs page by page.
 *
 * `page` is compared as a STRING with numeric collation, because `page` is a
 * string: for frames on master pages it's the master's name («B», «E», «F»,
 * «M», «N» — `docs/measured-facts-phase3.md`, the section on master pages),
 * not a number. `numeric: true` gives «2» < «10» where these really are
 * numbers, and doesn't break where they're letters.
 *
 * DELIBERATELY NOT `detectAll`'s default: in this order `strength` plays no
 * role at all, meaning the ranking each detector computed disappears.
 */
export function byDocumentOrder(a: Finding, b: Finding): number {
  return (
    a.page.localeCompare(b.page, "uk", { numeric: true }) ||
    a.containerId.localeCompare(b.containerId) ||
    a.paragraphIndex - b.paragraphIndex ||
    a.lineInParagraph - b.lineInParagraph ||
    (a.defect < b.defect ? -1 : a.defect > b.defect ? 1 : 0)
  );
}

/**
 * Findings grouped by strength scale. Within each group the order is
 * ranked and meaningful; BETWEEN groups it is not.
 *
 * This is the shape to use for "worst N": N is taken within a group. A flat
 * slice `detectAll(...).slice(0, N)` would return the N worst of whichever
 * scale comes first alphabetically.
 */
export function groupByScale(findings: readonly Finding[]): Map<StrengthScale, Finding[]> {
  const out = new Map<StrengthScale, Finding[]>();
  for (const f of findings) {
    const scale = strengthScaleOf(f.defect);
    const bucket = out.get(scale);
    if (bucket) bucket.push(f);
    else out.set(scale, [f]);
  }
  return out;
}

/**
 * Runs all five detectors over one range of lines.
 *
 * WARNING, and this is the main thing to know about the result: **this is
 * NOT one ranked list.** It's several ranked lists concatenated back to back
 * and separated by scale boundaries; the order of the scales themselves is
 * alphabetical and means nothing. See `groupByScale`.
 *
 * THE DETECTORS' DENOMINATORS DIFFER, so findings cannot be divided over a
 * shared population: `detectSpacing` narrows to justified, non-last lines of
 * calibrated styles; `detectLines` discards single-line paragraphs;
 * `detectHyphens` discards neither; `detectRivers` works on unbroken
 * "line under line" bands; `detectDashes` discards neither but narrows to
 * NON-FIRST lines of a paragraph. The only filter they share is the FIRST
 * one — `isMeasurable`. Fractions must be taken from each detector's own
 * `survey*` function, each against its own denominator.
 */
export function detectAll(
  lines: readonly LineMeasure[],
  cal: Calibration,
  opts?: DetectOptions,
): Finding[] {
  if (opts?.spacing === undefined) {
    throw new Error(
      "detectAll: opts.spacing is required — detectSpacing has no default for mode. " +
        "On the measured sample (the first 400 paragraphs), the style-bounds rule flags 59.14% " +
        "of justified lines, so the default was deliberately removed (Task 8). Silently skipping " +
        "the detector isn't an option: a report with no spacing findings would be indistinguishable " +
        "from a clean set — see surveySpacing().",
    );
  }

  return [
    ...detectSpacing(lines, cal, opts.spacing),
    ...detectLines(lines, opts.lines),
    ...detectHyphens(lines, opts.hyphens),
    ...detectRivers(lines, opts.rivers),
    ...detectDashes(lines, opts.dashes),
  ].sort(byScaleThenStrength);
}

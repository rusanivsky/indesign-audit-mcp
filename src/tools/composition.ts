/**
 * B5.4. The `composition_audit` tool — what the user actually calls.
 *
 * THE REPORT IS THE PRODUCT
 * ==========================
 * The baseline share on the real book — **59.14% of lines excluded outside
 * the bounds declared by the style itself** (`docs/measured-facts-phase3.md`). A flat
 * list of findings at that share is not a report: it flags a fifth of the book and
 * doesn't say what to do about it. So this module builds not a list, but an analysis:
 *
 *  1. up front — the baseline share and WHAT EXACTLY selected the findings (the mode);
 *  2. next to it — thresholds for a desired share, computed from the QUANTILES of the
 *     measured distribution of this document, so a "mandatory threshold" doesn't
 *     mean "guess";
 *  3. a breakdown by style (measured: 63.1% vs 58.3% — there's a signal in the breakdown);
 *  4. a separate block — what was NOT measured: uncalibrated styles, unmeasurable
 *     lines, masters, overset. None of this counts as "clean";
 *  5. findings — grouped by STRENGTH SCALE, with a per-class limit, and without any
 *     flat "worst twenty" — which doesn't exist (see below).
 *
 * WHAT IS DELIBERATELY MISSING HERE
 * ===================================
 * **A flat "N worst."** `detectAll` orders scales ALPHABETICALLY — this is
 * a documented refusal to rank across classes, not a ranking. The alphabetically
 * first scale is `air-fraction`, and it's also the biggest, so `slice(0, 20)` would
 * return exactly the density findings, look flawless, and quietly hide the four
 * other detectors. That's why the report groups via `groupByScale`, calls the scale
 * order meaningless in the `scaleOrderNote` field, and cuts the limit PER-CLASS
 * inside the scale — otherwise `tight` would systematically drown under `loose`, as
 * `finding.ts` warns directly (the tight side is bounded above at ≈10–20% of the
 * measure, the loose side by nothing).
 *
 * **A made-up density threshold.** `SpacingOptions.mode` is mandatory by
 * Task 8's decision. The tool's default is `"survey"`: it measures everything,
 * shows the distribution, and flags NOTHING, saying outright that there are no
 * density findings because the detector wasn't run. This is the one distinction
 * `detect.ts` calls the most dangerous ("a report with no density findings is
 * indistinguishable from a clean set"), and here it's spelled out in the text
 * rather than left for the reader to guess.
 *
 * SEVERITY (`Severity`) IS READ. `detect.ts` named the condition under which the
 * field should be dropped: "if Task 12 writes a report and never reads `severity`
 * once outside `rank` mode." It's read: `severityCounts` sits in every finding
 * group, and in `style-bounds`/`ratio` modes distinguishes `error` from `warning`
 * (the warning band), and in `rank` — `error`/`info`/`unrated`, i.e. the only signal
 * that "the line is past a document-declared bound" where there's no selection.
 * The condition for dropping it never came up.
 */

import { z } from "zod";
import { runWrite } from "../bridge/envelope.js";
import { IndesignError } from "../bridge/errors.js";
import { runJsx } from "../bridge/runner.js";
import { calibrate, styleKey } from "../composition/calibrate.js";
import { type DashOptions, detectDashes } from "../composition/detect-dashes.js";
import {
  DEFAULT_MAX_LADDER,
  detectHyphens,
  surveyHyphens,
  type HyphenOptions,
} from "../composition/detect-hyphens.js";
import {
  DEFAULT_MIN_WORD_CHARS,
  DEFAULT_SHORT_LAST_LINE_FRACTION,
  detectLines,
  surveyLines,
  type LineOptions,
} from "../composition/detect-lines.js";
import {
  DEFAULT_MIN_ROWS,
  DEFAULT_TOLERANCE_PT,
  detectRivers,
  surveyRivers,
  type RiverOptions,
} from "../composition/detect-rivers.js";
import { surveySpacing, type SpacingMode, type SpacingOptions } from "../composition/detect-spacing.js";
import { byScaleThenStrength, detectAll, groupByScale } from "../composition/detect.js";
import type { StrengthScale } from "../composition/finding.js";
import { isMeasurable, percentile, widthContext } from "../composition/measurable.js";
import {
  DEFAULT_MAX_TRACKING,
  type FixKind,
  type Proposal,
  type TrackingFix,
  proposeFixes,
} from "../composition/propose.js";
import type { DefectClass, Finding, LineMeasure, MeasureResult, Severity } from "../composition/types.js";
import { verifyFixes } from "../composition/verify.js";
import { findConflicts, orderForApply } from "../corrections/planner.js";
import type { AcceptedEdit, ApplyReport, ContainerSnapshot } from "../corrections/types.js";
import { APPLY_TIMEOUT_MS, backupStamp, describeApplyTimeout } from "./corrections.js";
import { assertExpectedDoc, EXPECTED_DOC_NAME_FIELD, fail, ok, type Tools } from "./shared.js";

/**
 * How many pages we measure per JSX call. A briefing value, and it's
 * measured — unlike 10, which stood here in the first draft.
 *
 * WHAT THE FACTS SAY (`docs/measured-facts-phase3.md`), verbatim and without
 * embellishment: exactly two sizes were measured there — **two pages in 542 ms**
 * (the section on story-level filtering) and **the whole document in 116,533 ms
 * over 5,193 lines**, after which it says "Task 12 should cut the document into
 * batches of pages." The number 10 isn't in the facts, and the first draft of this
 * comment attributed to them a recommendation they didn't make.
 *
 * WHAT WAS MEASURED HERE, on the same document, both sizes back to back so the
 * document state would be shared:
 *
 * | Window | Calls | Run 1 | Run 2 | Lines |
 * |---|---|---|---|---|
 * | 20 | 10 | **21,149 ms** | **20,697 ms** | 5,174 |
 * | 10 | 20 | 24,731 ms | 55,059 ms | 5,174 |
 *
 * The work is identical (line for line), and the smaller window is more expensive.
 * The mechanism has been identified, and it's the opposite of what the first draft
 * assumed: the main-text story runs through `storyOnWantedPage` in EVERY window,
 * so its full pass over `story.paragraphs` and `paragraphLineTexts` executes once
 * per window. Story-level filtering removes 548 of 549 stories — but not the one
 * that costs the most. So halving the window means DOUBLING that constant, not
 * dividing it. Direct measurement of the constant over the 22–41 range (546 lines
 * in all three cases): one window of 20 — 2,109–2,486 ms, two of 10 —
 * 2,477–2,504 ms, four of 5 — 3,214–3,236 ms, i.e. ≈300 ms per extra window.
 *
 * Why not more than 20: margin to the timeout. 20 pages cost ~2.1 s against
 * `MEASURE_TIMEOUT_MS` = 60 s, i.e. ~24×; beyond that the margin shrinks while the
 * gain — ≈300 ms per window — is already nearly spent.
 */
export const PAGE_WINDOW = 20;

/**
 * Timeout for ONE window.
 *
 * DECLARED DEVIATION FROM THE BRIEFING: it specified 120,000 ms per call, but
 * there the call was also one for the whole document. Here the window is 20 pages,
 * measured at ~2.1 s, so 60 s leaves ~24× margin while also not forcing a
 * two-minute wait on each of ten windows when InDesign has genuinely hung.
 * `runJsx` derives the AppleScript timeout from this number, so there's still one
 * single limit.
 */
export const MEASURE_TIMEOUT_MS = 60_000;

/** The shares for which the report computes thresholds from quantiles of the measured distribution. */
const TARGET_SHARES = [0.2, 0.1, 0.05, 0.01] as const;

/** How many characters of line text remain in a report finding. */
const LINE_TEXT_LIMIT = 200;

/* ────────────────────────── pure functions ────────────────────────── */

export function pageWindows(pages: string[], size: number): string[][] {
  if (!Number.isInteger(size) || size < 1) {
    throw new Error(`pageWindows: the window size must be an integer ≥ 1, but received ${size}.`);
  }
  const out: string[][] = [];
  for (let i = 0; i < pages.length; i += size) out.push(pages.slice(i, i + size));
  return out;
}

/**
 * Merges windows into one result — and RESTORES DOCUMENT ORDER.
 *
 * Order here isn't cosmetic. `detectHyphens` and `detectRivers` rely on line
 * ADJACENCY in the array: a ladder is a run of consecutive hyphenated lines, a
 * river is a solid band of "line under line." A story that spans pages across two
 * windows (measured: at least 32 paragraphs of the book are split across pages)
 * arrives in two pieces, and a flat concatenation would place other stories' lines
 * from the first window between them — breaking the run exactly at the window
 * seam. So the choice of window size would quietly change the findings.
 *
 * Containers go in order of first appearance (sorting "story:10" as a string would
 * put story:10 before story:2), and within a container — by (paragraph, line),
 * exactly the order the handler itself returns them in.
 *
 * Deduplication by address (container, paragraph, line) is a safeguard:
 * `pageWindows` doesn't overlap windows, but an explicit page list from the caller
 * may contain repeats.
 */
export function mergeResults(parts: MeasureResult[]): MeasureResult {
  const names = new Set(parts.map((p) => p.docName));
  if (names.size > 1) {
    throw new IndesignError(
      "jsx-error",
      `Measurement windows came from different documents: ${[...names].join(", ")}. ` +
        "The active document changed mid-run, and such windows must not be stitched together.",
      "Make sure the intended document is active and repeat the audit.",
    );
  }

  const pages: string[] = [];
  const seenPage = new Set<string>();
  for (const part of parts) {
    for (const page of part.pages) {
      if (seenPage.has(page)) continue;
      seenPage.add(page);
      pages.push(page);
    }
  }

  const unmeasured: MeasureResult["unmeasured"] = [];
  const seenUnmeasured = new Set<string>();
  for (const part of parts) {
    for (const u of part.unmeasured) {
      const key = `${u.containerId}:${u.reason}`;
      if (seenUnmeasured.has(key)) continue;
      seenUnmeasured.add(key);
      unmeasured.push(u);
    }
  }

  const byContainer = new Map<string, Map<string, LineMeasure>>();
  for (const part of parts) {
    for (const line of part.lines) {
      let bucket = byContainer.get(line.containerId);
      if (bucket === undefined) {
        bucket = new Map();
        byContainer.set(line.containerId, bucket);
      }
      bucket.set(`${line.paragraphIndex}:${line.lineInParagraph}`, line);
    }
  }
  const lines: LineMeasure[] = [];
  for (const bucket of byContainer.values()) {
    const ordered = [...bucket.values()].sort(
      (a, b) => a.paragraphIndex - b.paragraphIndex || a.lineInParagraph - b.lineInParagraph,
    );
    lines.push(...ordered);
  }

  return {
    docName: parts[0]?.docName ?? "",
    pages,
    lines,
    unmeasured,
    measurementUnit: parts[0]?.measurementUnit ?? "points",
  };
}

/* ───────────────────── typed parsing at the JSX boundary ───────────────────── */

/**
 * `MeasureResult` arrives from JSX as JSON, and there was no runtime validator in
 * `src/`. This is a debt recorded outright: the `MeasurableLine` brand **does not
 * survive `JSON.parse`** (`measurable.ts`), so the whole type system that protects
 * detectors from unmeasurable lines rests on this one boundary. An `as MeasureResult`
 * cast would turn it into decoration.
 *
 * What's checked is STRUCTURE, not semantic invariants: `NaN` is rejected (it
 * passes `typeof === "number"` and quietly poisons every median), a missing field
 * is rejected (JS would hand `undefined` into arithmetic), nullability is honored
 * field by field. A `text`/`chars` desync is NOT a parse error here — the result is
 * structurally correct, and the line is filtered out and counted in the report.
 */
export function parseMeasureResult(raw: unknown): MeasureResult {
  const root = obj(raw, "result");
  return {
    docName: str(root.docName, "docName"),
    pages: arr(root.pages, "pages").map((p, i) => str(p, `pages[${i}]`)),
    lines: arr(root.lines, "lines").map((l, i) => parseLine(l, `lines[${i}]`)),
    unmeasured: arr(root.unmeasured, "unmeasured").map((u, i) => {
      const rec = obj(u, `unmeasured[${i}]`);
      const reason = str(rec.reason, `unmeasured[${i}].reason`);
      if (reason !== "overset" && reason !== "text-path") {
        bad(`unmeasured[${i}].reason`, '"overset" | "text-path"', reason);
      }
      return {
        containerId: str(rec.containerId, `unmeasured[${i}].containerId`),
        reason: reason as "overset" | "text-path",
      };
    }),
    measurementUnit: str(root.measurementUnit, "measurementUnit"),
  };
}

function parseLine(raw: unknown, path: string): LineMeasure {
  const l = obj(raw, path);
  const spacing = obj(l.spacing, `${path}.spacing`);
  return {
    containerId: str(l.containerId, `${path}.containerId`),
    page: str(l.page, `${path}.page`),
    /* Старіші виміри поля не несуть — тоді `-1`, і правило шва чесно
     * падає назад на порівняння сторінок. */
    spreadIndex: typeof l.spreadIndex === "number" ? l.spreadIndex : -1,
    paragraphIndex: num(l.paragraphIndex, `${path}.paragraphIndex`),
    lineInParagraph: num(l.lineInParagraph, `${path}.lineInParagraph`),
    paragraphLineCount: num(l.paragraphLineCount, `${path}.paragraphLineCount`),
    left: num(l.left, `${path}.left`),
    right: num(l.right, `${path}.right`),
    baseline: num(l.baseline, `${path}.baseline`),
    columnWidth: num(l.columnWidth, `${path}.columnWidth`),
    styleName: str(l.styleName, `${path}.styleName`),
    pointSize: numOrNull(l.pointSize, `${path}.pointSize`),
    spacing: {
      min: numOrNull(spacing.min, `${path}.spacing.min`),
      desired: numOrNull(spacing.desired, `${path}.spacing.desired`),
      max: numOrNull(spacing.max, `${path}.spacing.max`),
    },
    justification: str(l.justification, `${path}.justification`),
    text: str(l.text, `${path}.text`),
    chars: arr(l.chars, `${path}.chars`).map((c, i) => {
      const ch = obj(c, `${path}.chars[${i}]`);
      return {
        x: num(ch.x, `${path}.chars[${i}].x`),
        ch: ch.ch === null ? null : str(ch.ch, `${path}.chars[${i}].ch`),
      };
    }),
    endsWithHyphen: bool(l.endsWithHyphen, `${path}.endsWithHyphen`),
    isFirstInFrame: bool(l.isFirstInFrame, `${path}.isFirstInFrame`),
    isLastInFrame: bool(l.isLastInFrame, `${path}.isLastInFrame`),
    rotated: bool(l.rotated, `${path}.rotated`),
    rotationAngle: num(l.rotationAngle, `${path}.rotationAngle`),
    isMaster: bool(l.isMaster, `${path}.isMaster`),
  };
}

function bad(path: string, expected: string, got: unknown): never {
  throw new IndesignError(
    "jsx-error",
    `composition_measure returned an unexpected structure: ${path} must be ${expected}, ` +
      `but received ${describeValue(got)}.`,
    "This is a mismatch between the src/jsx/composition.jsx handler and the MeasureResult type, " +
      "not a state of the document. Rebuild the project (npm run build) and repeat; " +
      "if it recurs — the handler and the type have diverged.",
  );
}

function describeValue(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "nothing";
  if (Array.isArray(v)) return `an array of ${v.length}`;
  if (typeof v === "number" && !Number.isFinite(v)) return String(v);
  return `${typeof v} (${JSON.stringify(v)?.slice(0, 40) ?? "?"})`;
}

function obj(v: unknown, path: string): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) bad(path, "an object", v);
  return v as Record<string, unknown>;
}

function arr(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) bad(path, "an array", v);
  return v;
}

function str(v: unknown, path: string): string {
  if (typeof v !== "string") bad(path, "a string", v);
  return v;
}

function bool(v: unknown, path: string): boolean {
  if (typeof v !== "boolean") bad(path, "a boolean", v);
  return v;
}

/** A finite number. `NaN` passes `typeof`, then silently poisons any median. */
function num(v: unknown, path: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) bad(path, "a finite number", v);
  return v;
}

/**
 * A nullable number. The comparison is STRICT (`=== null`), and that's not a
 * stylistic choice: `v == null` would also accept `undefined`, meaning a MISSING
 * field would silently become a "mixed value."
 *
 * The cost of the error was measured on this same document: if the handler
 * stopped returning `pointSize`, every line would get `null`, `styleKey` would
 * turn into "@mixed" across the whole document, no style would calibrate — and the
 * report would call it "styles without a measurement" instead of "handler and type
 * diverged." Exactly the substitution `parseMeasureResult` was put here to catch.
 */
function numOrNull(v: unknown, path: string): number | null {
  if (v === null) return null;
  if (v === undefined) bad(path, "a number or null (field absent)", v);
  return num(v, path);
}

/* ──────────────────────── report helper measures ──────────────────────── */

/**
 * A threshold that would cut off roughly the given share of measured lines — from
 * either side.
 *
 * This is NOT a recommendation and not a chosen number: these are quantiles of the
 * very same distribution the detector measures. It exists because `mode` is
 * mandatory, and "a person looked at the distribution" shouldn't mean "guessed":
 * percentiles say where the distribution sits, and this function says what share a
 * chosen threshold would produce.
 *
 * `sortedRatios` must be sorted ascending (exactly what `surveySpacing().ratios`
 * returns). On an empty sample — NaN, not zero.
 */
export function ratioForShare(
  sortedRatios: readonly number[],
  share: number,
): { loose: number; tight: number } {
  /*
   * ВЕРХНІЙ ПОРІГ БЕРЕТЬСЯ НА ОДИН КРОК ВИЩЕ, і причина — у ВКЛЮЧНІЙ межі.
   *
   * `boundSide` порівнює `ratio >= bounds.max`, тобто саме значення порогу
   * ТЕЖ позначається. `percentile` повертає значення З ВИБІРКИ, тож поріг,
   * узятий як `percentile(1 − share)`, позначав `share·n + 1` рядків, а не
   * `share·n`. Нижній бік такої вади не має: там `ratio <= min`, і
   * `percentile(share)` лягає рівно.
   *
   * Зміряно на рівномірних 100 значеннях 1,00–1,99: share 0,01 давав
   * maxRatio 1,98 і позначав 2 рядки зі 100 замість одного — подвоєння на
   * тому самому рядку, який людина найімовірніше й вибере. Обидві половини
   * `thresholdsForShare` подано як пару, тож несиметричність читалася як
   * властивість набору, а не як похибка.
   */
  const n = sortedRatios.length;
  const looseIndex = Math.max(0, n - Math.max(1, Math.round(share * n)));
  return {
    loose: n === 0 ? percentile(sortedRatios, 1 - share) : sortedRatios[looseIndex]!,
    tight: percentile(sortedRatios, share),
  };
}

/** A (style, size) pair under which different `spacing.desired` values sit. */
export interface StyleKeyConflict {
  styleKey: string;
  /** All measured `desiredWordSpacing` values under this key. `null` — mixed. */
  desired: (number | null)[];
  lines: number;
}

/**
 * Task 7's debt, stated outright: **`styleKey` doesn't read `spacing.desired`**, so
 * a local override of inter-word spacing dumps TWO different baseline spacings into
 * one median — and the natural width of both becomes an average neither of them
 * has. Silently, this shows up nowhere: calibration returns a single number,
 * stability just dips a little.
 *
 * Fixing the key would mean fragmenting the sample (470 samples of one style in
 * the book), so instead the report SHOWS the conflict. The denominator takes lines
 * eligible for measurement — exactly the population calibration draws its keys
 * from.
 */
export function styleKeyConflicts(lines: readonly LineMeasure[]): StyleKeyConflict[] {
  const seen = new Map<string, { values: Set<number | null>; lines: number }>();
  for (const line of lines) {
    if (!isMeasurable(line)) continue;
    const key = styleKey(line.styleName, line.pointSize);
    let entry = seen.get(key);
    if (entry === undefined) {
      entry = { values: new Set(), lines: 0 };
      seen.set(key, entry);
    }
    entry.values.add(line.spacing.desired);
    entry.lines++;
  }

  return [...seen.entries()]
    .filter(([, e]) => e.values.size > 1)
    .map(([key, e]) => ({
      styleKey: key,
      /* `null` ("mixed value") comes last — it's not a number and not part of the sequence. */
      desired: [...e.values].sort((a, b) => (a === null ? 1 : b === null ? -1 : a - b)),
      lines: e.lines,
    }))
    .sort((a, b) => a.styleKey.localeCompare(b.styleKey, "uk"));
}

/** Rounding to a readable form; NaN stays NaN, not zero. */
function round(v: number, digits = 4): number {
  return Number.isFinite(v) ? Number(v.toFixed(digits)) : v;
}

function pct(v: number): number {
  return Number.isFinite(v) ? Number((v * 100).toFixed(2)) : v;
}

function countSeverity(findings: readonly Finding[]): Record<Severity, number> {
  const out: Record<Severity, number> = { error: 0, warning: 0, info: 0, unrated: 0 };
  for (const f of findings) out[f.severity]++;
  return out;
}

/* ──────────────────────────── the report itself ──────────────────────────── */

/** The tool's density mode: the detector's three modes plus "survey only". */
export type AuditSpacingMode = SpacingMode | "survey";

export interface AuditParams {
  spacingMode: AuditSpacingMode;
  minRatio?: number;
  maxRatio?: number;
  warnBandPct: number;
  shortLastLineFraction: number;
  minWordChars: number;
  maxLadder: number;
  forbiddenWords?: string[];
  riverMinRows: number;
  riverTolerancePt: number;
  riverMinChannelPt: number;
  riverJustifiedOnly: boolean;
  /** Include master-page lines in the analysis. The module's decision — not to include them. */
  includeMasters: boolean;
  /**
   * Sentence-ending marks for the `line-start-dash` exception. `undefined` — the
   * default set (`SENTENCE_ENDERS`); an empty array disables the exception.
   */
  sentenceEnders?: string[];
  /** How many worst findings to show per defect CLASS (not per scale). */
  perDefectLimit: number;
  /** Pages named by the call; `null` — the whole document. */
  requestedPages: string[] | null;
  windows: number;
  windowsDone: number;
  stoppedAt: string | null;
  stoppedReason: string | null;
}

/**
 * Parameters that determine WHICH findings the measurement will produce.
 *
 * Split into a separate type not for tidiness: `composition_apply` must reproduce
 * the EXACT SAME set of findings the operator saw in the audit, because
 * `findingIds` is the only address shared between the two calls. Let one flag
 * diverge (`includeMasters`, the density threshold, `forbiddenWords`), and half
 * the identifiers simply won't be found — silently, because "there's no such
 * finding" and "the finding was fixed" look identical from outside.
 */
export type DetectionParams = Pick<
  AuditParams,
  | "spacingMode"
  | "minRatio"
  | "maxRatio"
  | "warnBandPct"
  | "shortLastLineFraction"
  | "minWordChars"
  | "maxLadder"
  | "forbiddenWords"
  | "riverMinRows"
  | "riverTolerancePt"
  | "riverMinChannelPt"
  | "riverJustifiedOnly"
  | "includeMasters"
  | "sentenceEnders"
>;

export interface Analysis {
  /** Lines that reached the detectors — exactly what to feed into `proposeFixes`. */
  analysed: LineMeasure[];
  dropped: { master: number; textMismatch: number };
  cal: ReturnType<typeof calibrate>;
  findings: Finding[];
}

/**
 * Filtering + calibration + five detectors — ONE place shared by two tools.
 *
 * Until now this chain lived inside `buildReport`, and `composition_apply` would
 * have had to repeat it. Two copies would have quietly diverged in the worst way:
 * the audit would show one set of identifiers, the apply would look for another.
 *
 * `calOverride` (final review, I3) — so that `composition_apply`'s RE-MEASUREMENT
 * doesn't calibrate again from the JUST-WRITTEN text. Tracking physically widens
 * inter-word gaps in tracked paragraphs (measured: ~8.7% at a typical delta), and
 * `calibrate` takes the natural space width from the LAST lines of the sample's
 * paragraphs — a handful of tracked paragraphs in a narrow `pages` window can shift
 * its `styleKey`'s median and thereby substitute the deviation for EVERY line of
 * that style, tracked or not. The consequence is invented `displaced` or false
 * `resolved` results in the modes where anything is calibrated at all
 * (`style-bounds`/`ratio`/`rank`; in `survey` the density detector doesn't run, so
 * calibration has no effect there). When passed, `calibrate` isn't called at all —
 * the SAME yardstick used for the "before" measurement is used: a fixed reference,
 * not a moving one. `composition_audit` NEVER passes this parameter — the audit
 * recalibrates every time, because it has no "before/after" pair the reference
 * would need to stay consistent with.
 */
export function analyse(
  measured: MeasureResult,
  p: DetectionParams,
  calOverride?: ReturnType<typeof calibrate>,
): Analysis {
  /*
   * FILTERING AT THE REPORT BOUNDARY — two classes, and neither is "clean."
   *
   * 1. Master pages — THIS TASK'S DECISION, justified in the tool description
   *    and reversible via the `includeMasters` flag.
   * 2. A `text`/`chars` desync. The `LineMeasure` contract promises equal
   *    lengths; when they're absent, `chars[i]` and `text[i]` are different
   *    characters, and a detector that reads both (the short-word rule, the
   *    river) would be measuring a chimera. Breaking the whole audit over one
   *    such line isn't acceptable either, so the line is dropped and counted.
   *
   * The ORDER is deliberate and meaningful: master is a decision about SCOPE,
   * desync is a signal about data quality WITHIN that scope. The reverse order
   * would file a corrupted master line under `textCharsMismatch`, i.e. complain
   * about data it never intended to judge in the first place. With
   * `includeMasters`, such a line returns to scope and is then counted, correctly,
   * as a desync.
   */
  const dropped = { master: 0, textMismatch: 0 };
  const analysed: LineMeasure[] = [];
  for (const line of measured.lines) {
    if (!p.includeMasters && line.isMaster) {
      dropped.master++;
      continue;
    }
    if (line.chars.length !== line.text.length) {
      dropped.textMismatch++;
      continue;
    }
    analysed.push(line);
  }

  const cal = calOverride ?? calibrate(analysed);
  /*
   * `includeMasters` goes into each detector SEPARATELY (Phase 4 Task 10, spec §8)
   * — not just here, into the filtering at the report boundary. When the flag is
   * false, `analysed` already excludes masters, so the value passed below is a
   * no-op repeat (no masters — nothing to filter a second time). When it's true,
   * `analysed` keeps masters, and WITHOUT this field each detector's own default
   * (`false`) would filter them back out — i.e. the tool's decision to "include
   * masters" would silently be undone at the detector boundary.
   */
  const lineOpts: LineOptions = {
    shortLastLineFraction: p.shortLastLineFraction,
    minWordChars: p.minWordChars,
    includeMasters: p.includeMasters,
  };
  const hyphenOpts: HyphenOptions = {
    maxLadder: p.maxLadder,
    forbidden: p.forbiddenWords,
    includeMasters: p.includeMasters,
  };
  const riverOpts: RiverOptions = {
    minRows: p.riverMinRows,
    tolerancePt: p.riverTolerancePt,
    minChannelPt: p.riverMinChannelPt,
    justifiedOnly: p.riverJustifiedOnly,
    includeMasters: p.includeMasters,
  };
  const dashOpts: DashOptions = {
    includeMasters: p.includeMasters,
    ...(p.sentenceEnders === undefined ? {} : { sentenceEnders: p.sentenceEnders }),
  };

  /*
   * In `survey` mode the density detector does NOT run, and `detectAll` is
   * unusable here by construction: it throws without `spacing`, and that's
   * correct. The other four detectors run — none of them has a made-up threshold.
   */
  const findings: Finding[] =
    p.spacingMode === "survey"
      ? [
          ...detectLines(analysed, lineOpts),
          ...detectHyphens(analysed, hyphenOpts),
          ...detectRivers(analysed, riverOpts),
          ...detectDashes(analysed, dashOpts),
        ].sort(byScaleThenStrength)
      : detectAll(analysed, cal, {
          spacing: spacingOptionsOf(p),
          lines: lineOpts,
          hyphens: hyphenOpts,
          rivers: riverOpts,
          dashes: dashOpts,
        });

  return { analysed, dropped, cal, findings };
}

/**
 * Builds the report from an already-merged measurement. A pure function — no
 * touching InDesign, so the whole analysis is unit-testable.
 */
export function buildReport(measured: MeasureResult, p: AuditParams) {
  if (p.spacingMode === "ratio" && p.minRatio === undefined && p.maxRatio === undefined) {
    throw new Error(
      'composition_audit: spacingMode "ratio" requires minRatio or maxRatio. ' +
        "There is deliberately no default — on the measured sample (220 of 372 justified lines of the first " +
        "400 paragraphs) the style-bounds rule flags 59.14% of them, and no number derived for the whole book " +
        'exists. Run spacingMode: "survey" and take the number from spacing.percentiles ' +
        "or spacing.thresholdsForShare.",
    );
  }

  const { analysed, dropped, cal, findings } = analyse(measured, p);

  /* Two classes that can't go into any denominator (11.5% of the book). */
  let rotated = 0;
  let emptyParagraphs = 0;
  for (const line of analysed) {
    if (line.rotated) rotated++;
    else if (!line.chars.some((c) => c.ch !== null)) emptyParagraphs++;
  }

  const hyphen = widthContext(analysed);
  const riverOpts: RiverOptions = {
    minRows: p.riverMinRows,
    tolerancePt: p.riverTolerancePt,
    minChannelPt: p.riverMinChannelPt,
    justifiedOnly: p.riverJustifiedOnly,
    /* `surveyRivers` counts bands with the same `columnSegments` as `detectRivers`
     * (see the comment in detect-rivers.ts) — without this field the survey would
     * count against a different denominator than the one the detector flags
     * against. `surveyLines`/`surveySpacing`/`surveyHyphens` don't have this
     * parameter: their detectors filter masters in their own loop, not in the
     * function shared with the survey. */
    includeMasters: p.includeMasters,
  };

  const spacingSurvey = surveySpacing(analysed, cal);
  const lineSurvey = surveyLines(analysed);
  const hyphenSurvey = surveyHyphens(analysed);
  const riverSurvey = surveyRivers(analysed, riverOpts);

  /*
   * PROPOSALS (W1). Counted across ALL findings, but shown for the ones that
   * passed the per-class limit: 199 proposals on the measured book would crush the
   * report, while the summary by kind stays complete regardless.
   *
   * `opts.containers` is deliberately NOT passed here. Container-text snapshots
   * cost a separate read of every story (`containers_read` takes
   * `story.contents` across the book's 549 containers), and the audit already
   * pays two minutes for the measurement alone. The consequence is named in
   * `proposals.note`, not left unsaid: invisible characters go here without an
   * addressed fix, and `composition_apply` addresses them, reading the snapshots
   * itself.
   */
  const proposals = proposeFixes(findings, analysed);
  const proposalById = new Map(proposals.map((pr) => [pr.findingId, pr]));
  const findingsByScale = groupFindings(findings, p.perDefectLimit, proposalById);

  const conflicts = styleKeyConflicts(analysed);
  const warnings = collectWarnings(p, cal.uncalibrated, conflicts, hyphen, measured, dropped);

  const base = spacingSurvey.bounds;
  return {
    docName: measured.docName,

    scope: {
      requestedPages: p.requestedPages,
      pagesMeasured: measured.pages.length,
      pages: measured.pages,
      windows: p.windows,
      windowsDone: p.windowsDone,
      partial: p.stoppedAt !== null,
      stoppedAt: p.stoppedAt,
      stoppedReason: p.stoppedReason,
      linesReturned: measured.lines.length,
      linesAnalysed: analysed.length,
      measurementUnit: measured.measurementUnit,
    },

    readThisFirst: readThisFirst(p, analysed.length, base, findings.length),

    scaleOrderNote:
      "The order of SCALES in findingsByScale is alphabetical, and that is a refusal rather than a ranking: the strengths of different " +
      "scales are incommensurable (share of white, emptiness of a line, share of a paragraph, run length, " +
      "share of a word, corridor width). “The N worst” makes sense only within a group, and that is exactly " +
      "why this report contains no flat top-twenty at all.",

    spacing: {
      mode: p.spacingMode,
      selection: selectionText(p),
      /*
       * THE DENOMINATOR IS NAMED AS A FIELD, NOT A COMMENT. The baseline share is
       * outsideKnown / known, where known is lines with BOTH bounds measured.
       * Lines with only one bound measured sit in partial and are NOT part of the
       * share; those among them that did cross their single measured bound stand
       * separately in outsidePartial and aren't lost.
       */
      baseRate: {
        known: base.known,
        outsideKnown: base.outsideKnown,
        pct: pct(base.baseRate),
        partial: base.partial,
        outsidePartial: base.outsidePartial,
        unknown: base.unknown,
        note:
          "pct = outsideKnown / known. The denominator holds only lines with both style bounds " +
          "measured; partial (one bound measured) and unknown (mixed bounds within the paragraph) are outside it. " +
          "outsidePartial — those among partial that crossed their single bound: they are not in the share, " +
          "but neither are they “clean”.",
      },
      measured: spacingSurvey.measured,
      percentiles: mapNumbers(spacingSurvey.percentiles),
      thresholdsForShare: TARGET_SHARES.map((share) => {
        const r = ratioForShare(spacingSurvey.ratios, share);
        return { share, maxRatio: round(r.loose), minRatio: round(r.tight) };
      }),
      thresholdsNote:
        "These are QUANTILES of this document's measured distribution, not advice: a maxRatio threshold " +
        "will flag roughly share of the loose lines, minRatio the same number of tight ones. " +
        'The number for spacingMode: "ratio" is taken from here, not from thin air.',
      byStyle: [...spacingSurvey.byStyle.entries()]
        .map(([key, s]) => ({
          styleKey: key,
          measured: s.measured,
          known: s.bounds.known,
          outsideKnown: s.bounds.outsideKnown,
          pct: pct(s.bounds.baseRate),
          partial: s.bounds.partial,
          outsidePartial: s.bounds.outsidePartial,
          unknown: s.bounds.unknown,
        }))
        .sort((a, b) => b.measured - a.measured),
    },

    calibration: {
      styles: [...cal.natural.entries()]
        .map(([key, natural]) => ({
          styleKey: key,
          naturalPt: round(natural, 6),
          samples: cal.samples.get(key) ?? 0,
          stabilityPct: pct(cal.stability.get(key) ?? 0),
        }))
        .sort((a, b) => b.samples - a.samples),
      stabilityNote:
        "stabilityPct — the share of samples within ±1% of the median. The share specifically, not the p05–p95 " +
        "spread: the percentile form breaks under a few extra bad samples and " +
        "starts reporting “clean”.",
      /*
       * The weakest link in calibration, named outright. There is NO threshold here
       * and there can't be — nobody measured stability against markup — but buried
       * among a dozen identical lines it wouldn't matter. On the measured book this
       * is «Підпункт чеклисту@17» at 77.9% versus 100% for the three main styles,
       * i.e. this style's natural width rests on a scattered sample, and its ratios
       * are weaker than the rest.
       */
      leastStable: leastStableStyle(cal),
      /* measurable.ts's requirement: the hyphen-width source must be visible in the report. */
      hyphen: {
        em: round(hyphen.hyphenEm, 4),
        source: hyphen.hyphenSource,
        samples: hyphen.hyphenSamples,
        disagreementEm:
          hyphen.hyphenDisagreementEm === null ? null : round(hyphen.hyphenDisagreementEm, 4),
        note:
          "Width of the hyphen drawn by the composer, in fractions of the point size. “literal” — a direct " +
          "measurement of the glyph, “shortfall” — inferred from the shortfalls of justified lines, “fallback” — " +
          "a fallback 0.34 em, i.e. NOT a measurement. A non-zero disagreementEm means the two " +
          "measured paths diverged, i.e. one of the assumptions does not hold.",
      },
    },

    notMeasured: {
      note:
        "These are NOT “clean” lines. No line from here may go into the denominator at all, " +
        "and none of them carries a verdict.",
      rotated: {
        lines: rotated,
        note:
          "Rotated frames (running heads, folios): left === right, the whole horizontal " +
          "geometry is invalid. Narrowing by pages does NOT filter them out — in the book 91 of 111 " +
          "such lines sit on ORDINARY pages rather than on masters. The only reliable " +
          "sign is the rotated flag.",
      },
      /*
       * ТЕКСТ У ТАБЛИЦЯХ І ВИНОСКАХ НЕ МІРЯЄТЬСЯ ЗОВСІМ, і доти про це не
       * було сказано НІДЕ. `composition_measure` обходить лише
       * `doc.stories[s].paragraphs`, а текст комірки та виноски в
       * `story.characters` не входить — це вже зафіксовано в `inspect.jsx`
       * («Table cells are separate containers») і врахоно в `spelling.jsx`,
       * який ходить по `story.tables[...]` і `story.footnotes` явно.
       *
       * Отже нуль удів, сиріт, драбинок і коридорів у виносці означав «не
       * дивилися», а читався як «чисто» — рівно та підміна, проти якої
       * написано весь блок `notMeasured`. Поки міряння не додано, мовчати про
       * це не можна.
       */
      tablesAndFootnotes: {
        measured: false,
        note:
          "Text inside TABLE CELLS and FOOTNOTES is not measured at all: the pass walks " +
          "story paragraphs, and cell/footnote text is not part of a story's characters. " +
          "Zero widows, orphans, hyphen ladders or rivers there means NOT LOOKED AT, not clean. " +
          "This is a limit of the tool, not a property of the document — spelling_audit walks " +
          "both collections explicitly, so the gap is closable, just not closed.",
      },
      emptyParagraphs: {
        lines: emptyParagraphs,
        note:
          "Paragraphs without a single glyph: a full measure at their own width of 2.3–7.6 pt and not a single " +
          "flag. To a detector they look like the crudest of setting defects.",
      },
      masterPages: {
        lines: dropped.master,
        included: p.includeMasters,
        note:
          "Lines of master pages. Outside the analysis by default: page for them is the NAME " +
          "of the master («B», «E») rather than a page number, so any statement about a page " +
          "(“a hyphen between pages B and E”, document order) is meaningless for them; an edit " +
          "there changes the template, not the text of the book. The includeMasters flag brings them back.",
      },
      textCharsMismatch: dropped.textMismatch,
      uncalibratedStyles: cal.uncalibrated,
      uncalibratedNote:
        "Pairs (style, size) for which there were too few samples for a median, or with a mixed size. " +
        "Their lines are not measured and do not end up in “clean”.",
      /* THE FIELD CARRIES BOTH REASONS, each entry names its own in `reason`
       * (`overset` | `text-path`). The name is historical: before 2026-08-18 there
       * was only one reason. A consumer that relies on the field name instead of
       * `reason` will count text-on-a-path lines as overset. */
      overset: measured.unmeasured,
      spacingExcluded: {
        ...spacingSurvey.excluded,
        notMeasured: spacingSurvey.notMeasured,
        note:
          "Outside the density denominator by construction: ineligible lines, last lines of paragraphs " +
          "(the calibration itself is taken from them) and unjustified lines (in them the ratio is trivially " +
          "1.000 and they cannot be flagged).",
      },
    },

    surveys: {
      note:
        "The detectors' denominators DIFFER — all they share is line eligibility. The share of each " +
        "class must be taken from its own survey, not divided by a common population.",
      lines: {
        judged: lineSurvey.judged,
        lastLines: lineSurvey.lastLines,
        fillPercentiles: mapNumbers(lineSurvey.percentiles),
        singleWordLastLines: lineSurvey.singleWordLengths.length,
        counts: lineSurvey.counts,
        excluded: lineSurvey.excluded,
      },
      hyphens: {
        judged: hyphenSurvey.judged,
        hyphenated: hyphenSurvey.hyphenated,
        runs: hyphenSurvey.runs.length,
        runPercentiles: mapNumbers(hyphenSurvey.percentiles),
        frameBreaks: hyphenSurvey.frameBreaks,
        acrossSpread: hyphenSurvey.acrossSpread,
        undecidableSpread: hyphenSurvey.undecidableSpread,
        unmeasuredWord: hyphenSurvey.unmeasuredWord,
        excluded: hyphenSurvey.excluded,
      },
      rivers: {
        judged: riverSurvey.judged,
        segments: riverSurvey.segments,
        runs: riverSurvey.runs.length,
        runPercentiles: mapNumbers(riverSurvey.percentiles),
        channelPercentiles: {
          p50: round(percentile(riverSurvey.channels, 0.5), 3),
          p95: round(percentile(riverSurvey.channels, 0.95), 3),
          max:
            riverSurvey.channels.length === 0
              ? NaN
              : round(riverSurvey.channels[riverSurvey.channels.length - 1]!, 3),
        },
        excluded: riverSurvey.excluded,
      },
    },

    warnings,
    findingsTotal: findings.length,
    proposals: summariseProposals(proposals),
    findingsByScale,
  };
}

/**
 * Proposal summary — across ALL findings, not just the shown ones.
 *
 * Shown findings carry their proposal individually (`compactFinding`), but the
 * limit is per-class, so without this summary the reader would only see fix kinds
 * at the top of each class and wouldn't know how many there really are.
 */
function summariseProposals(proposals: readonly Proposal[]) {
  const byKind: Record<FixKind, number> = { invisible: 0, tracking: 0, text: 0, manual: 0 };
  let writable = 0;
  let blocked = 0;
  for (const pr of proposals) {
    byKind[pr.kind]++;
    if (pr.edit !== undefined || pr.tracking !== undefined) writable++;
    if (pr.blocked !== undefined) blocked++;
  }
  return {
    total: proposals.length,
    byKind,
    writable,
    blocked,
    note:
      "kind is the kind of correction the defect class REQUIRES; writable is how many proposals " +
      "actually carry a write. The difference between them is explained by the blocked field on each " +
      "finding and is not an error: the audit does not read container text, so invisible characters here " +
      "are left without an address in the text — composition_apply addresses them. The “text” kind is never " +
      "issued: no detector measures WHICH word to replace and with what, so " +
      "rewriting text is left to the editor and goes out as “manual”.",
  };
}

/**
 * The style with the lowest calibration stability — or `null` if there was nothing
 * to calibrate. Only calibrated pairs are compared: for uncalibrated styles
 * stability isn't defined, not "zero," and they already stand in a separate list.
 */
function leastStableStyle(
  cal: ReturnType<typeof calibrate>,
): { styleKey: string; stabilityPct: number; samples: number; note: string } | null {
  let worstKey: string | null = null;
  let worst = Infinity;
  for (const key of cal.natural.keys()) {
    const s = cal.stability.get(key) ?? 0;
    if (s < worst) {
      worst = s;
      worstKey = key;
    }
  }
  if (worstKey === null) return null;
  return {
    styleKey: worstKey,
    stabilityPct: pct(worst),
    samples: cal.samples.get(worstKey) ?? 0,
    note:
      "The lowest stability among the CALIBRATED pairs. There is no threshold here — nobody has " +
      "measured one; the number is given so that the weakest link of the calibration is not buried among " +
      "identical rows. The lower it is, the more this style's natural width rests " +
      "on a scattered sample, and the weaker every ratio computed from it.",
  };
}

function spacingOptionsOf(p: DetectionParams): SpacingOptions {
  /* `survey` never reaches here: `detectAll` isn't called at all there. */
  const mode = p.spacingMode === "survey" ? "rank" : p.spacingMode;
  return {
    mode,
    minRatio: p.minRatio,
    maxRatio: p.maxRatio,
    warnBandPct: p.warnBandPct,
    /* The same caveat as in `lineOpts`/`hyphenOpts`/`riverOpts` in `analyse()`:
     * without this field the tool's decision to "include masters" would be
     * silently undone by the detector's own default. */
    includeMasters: p.includeMasters,
  };
}

/** Numeric survey fields — to a readable form, preserving NaN. */
function mapNumbers<T extends Record<string, number>>(src: T): Record<keyof T, number> {
  const out = {} as Record<keyof T, number>;
  for (const key of Object.keys(src) as (keyof T)[]) out[key] = round(src[key] as number, 4);
  return out;
}

interface ScaleGroup {
  scale: StrengthScale;
  total: number;
  defects: {
    defect: DefectClass;
    total: number;
    severity: Record<Severity, number>;
    worst: ReturnType<typeof compactFinding>[];
  }[];
}

/**
 * The grouping that makes the refusal readable.
 *
 * The limit applies PER-CLASS within a scale, not to the whole scale. This is a
 * direct enforcement of `finding.ts`'s caveat: on the `air-fraction` scale the
 * tight side is bounded above (the tightest possible line has zero spaces, i.e.
 * ≈10–20% of the measure), while the loose side is unbounded, so a slice by scale
 * would systematically hide `tight` under `loose`.
 */
function groupFindings(
  findings: readonly Finding[],
  limit: number,
  proposalById: ReadonlyMap<string, Proposal>,
): ScaleGroup[] {
  const out: ScaleGroup[] = [];
  for (const [scale, list] of groupByScale(findings)) {
    const byDefect = new Map<DefectClass, Finding[]>();
    for (const f of list) {
      const bucket = byDefect.get(f.defect);
      if (bucket) bucket.push(f);
      else byDefect.set(f.defect, [f]);
    }
    out.push({
      scale,
      total: list.length,
      defects: [...byDefect.entries()]
        .map(([defect, fs]) => ({
          defect,
          total: fs.length,
          severity: countSeverity(fs),
          worst: fs.slice(0, limit).map((f) => compactFinding(f, proposalById.get(f.id))),
        }))
        .sort((a, b) => b.total - a.total || (a.defect < b.defect ? -1 : 1)),
    });
  }
  return out;
}

function compactFinding(f: Finding, proposal: Proposal | undefined) {
  return {
    id: f.id,
    severity: f.severity,
    page: f.page,
    containerId: f.containerId,
    paragraphIndex: f.paragraphIndex,
    lineInParagraph: f.lineInParagraph,
    measured: round(f.measured),
    strength: round(f.strength),
    lineText: f.lineText.length > LINE_TEXT_LIMIT ? `${f.lineText.slice(0, LINE_TEXT_LIMIT)}…` : f.lineText,
    detail: f.detail,
    /*
     * The proposal (W1). `null` is impossible here by construction —
     * `proposeFixes` returns one proposal per finding — but writing `!` over a
     * map keyed by a string would be a promise the type doesn't hold.
     *
     * `edit` is deliberately NOT shown: in the audit report it's always empty (no
     * text snapshots here), and showing a field that's never populated would
     * imply that records never occur at all.
     */
    proposal:
      proposal === undefined
        ? null
        : {
            kind: proposal.kind,
            description: proposal.description,
            tracking: proposal.tracking ?? null,
            shortfall: proposal.shortfall ?? null,
            blocked: proposal.blocked ?? null,
            alsoInParagraph: proposal.alsoInParagraph,
          },
  };
}

function selectionText(p: AuditParams): string {
  switch (p.spacingMode) {
    case "survey":
      return (
        "SURVEY ONLY: the density detector was not run, so the absence of tight/loose findings is NOT because " +
        "the setting is clean. Look at spacing.percentiles and spacing.thresholdsForShare, then " +
        'repeat with spacingMode: "ratio" (and minRatio/maxRatio), "style-bounds" or "rank".'
      );
    case "style-bounds":
      return (
        "Selection by the bounds declared by the style itself (80/133 in the book). It honestly returns its " +
        "base share — on the measured sample (the first 400 paragraphs) that is 59.14% of justified lines, " +
        "i.e. an answer to “what violates the standard at all”, not a daily report."
      );
    case "ratio":
      return (
        `Selection by the threshold of the call: minRatio=${p.minRatio ?? "—"}, maxRatio=${p.maxRatio ?? "—"}. ` +
        "Giving only one side means the other was NOT checked, not that it is clean."
      );
    case "rank":
      return (
        "No selection: every measured justified line received a finding, ordered by the strength of the " +
        "deviation. The style bounds here govern only the weight (error / info / unrated) and appear in " +
        "the explanation for reference."
      );
  }
}

function readThisFirst(
  p: AuditParams,
  analysedLines: number,
  base: { known: number; outsideKnown: number; baseRate: number },
  findingsTotal: number,
): string[] {
  const out: string[] = [];

  if (analysedLines === 0) {
    out.push(
      "Not a single line was measured: the given range contains no text suitable for analysis. " +
        "This is NOT “the setting is clean” — it is the absence of a sample.",
    );
    return out;
  }

  out.push(
    base.known === 0
      ? "There is no base share: not one measured line has BOTH justification bounds of its style measured, " +
        "so there is nothing to divide by. This is not zero defects."
      : `Base share: ${pct(base.baseRate)}% (${base.outsideKnown} of ${base.known}) justified ` +
        "lines fall outside the bounds declared by the STYLE ITSELF. This is a distribution, not a list of defects: " +
        "a report that flags a fifth of the book is not a report — which is exactly why the threshold is chosen by a human " +
        "and not by this tool.",
  );

  /*
   * У readThisFirst, а не лише в notMeasured: цей блок читають першим і
   * часто єдиним, а межа тут така, що без неї нуль читається неправильно на
   * будь-якій книжці з виносками чи таблицями.
   */
  out.push(
    "NOT MEASURED AT ALL: text inside table cells and footnotes. The pass walks story " +
      "paragraphs, and that text is not part of a story's characters — so zero widows, " +
      "orphans, hyphen ladders or rivers there means “not looked at”, not “clean”.",
  );

  out.push(selectionText(p));

  out.push(
    `Findings in total ${findingsTotal}, and this is NOT one ranked list: they are laid out across ` +
      "scales of strength, the order of the scales is alphabetical and carries no meaning, and “the worst” are shown per class " +
      "(perDefectLimit) — otherwise the bulkiest class would hide every other detector.",
  );

  out.push(
    "Each shown finding carries a PROPOSED correction of one of these kinds: tracking " +
      "(paragraph tracking), invisible (a soft hyphen), manual (an instruction only). “manual” is " +
      "an honest answer, not a gap: for an orphan, a hyphen ladder and a corridor no automatic choice " +
      "exists. The shortfall field says what share of the required correction the tracking actually covers; " +
      "alsoInParagraph — which other findings will be recomposed together with this one.",
  );

  out.push(
    "Before reading the findings, read notMeasured: uncalibrated styles, rotated frames, " +
      "empty paragraphs and overset carry no verdict at all and did not end up in “clean”.",
  );

  return out;
}

function collectWarnings(
  p: AuditParams,
  uncalibrated: readonly string[],
  conflicts: readonly StyleKeyConflict[],
  hyphen: ReturnType<typeof widthContext>,
  measured: MeasureResult,
  dropped: { master: number; textMismatch: number },
): string[] {
  const out: string[] = [];

  if (p.stoppedAt !== null) {
    out.push(
      `The run is INCOMPLETE: it stopped at page ${p.stoppedAt} (${p.windowsDone} windows of ` +
        `${p.windows}). Everything gathered up to that point is kept, the rest of the document was not measured.` +
        (p.stoppedReason === null ? "" : ` Reason: ${p.stoppedReason}`),
    );
  }

  /*
   * Transfer §3.2. `forbiddenWords` has no default, and without it
   * `detectHyphens` takes `opts.forbidden ?? []` — meaning the `hyphen-forbidden`
   * defect never fires AT ALL. Until now this went unstated: the `hyphens` family
   * returned zero findings of this class, and zero read as "no hyphenation in
   * forbidden words."
   *
   * There deliberately is and can be no default here — the list of words that
   * can't be broken is a property of the EDITION (the author's surname, a series
   * title, a brand), not of the language. But "the tool has no opinion of its own"
   * has to be STATED, not left silent — exactly what `geometry_audit` does for an
   * unset `anchorRule` (`src/geometry/report.ts:244`).
   */
  if (p.forbiddenWords === undefined || p.forbiddenWords.length === 0) {
    out.push(
      "Hyphenation in forbidden words was NOT checked: forbiddenWords was not named. " +
        "The hyphen-forbidden defect never fired, so its zero means " +
        "“not asked”, not “none”. The list of such words is a property of the edition " +
        "(a surname, a series title, a brand), and it is the user who supplies it.",
    );
  }

  if (p.requestedPages !== null) {
    out.push(
      "The range was narrowed by an explicit list of pages. Runs that extend beyond its edges " +
        "are cut off: a hyphen ladder and a corridor that begin before the first page " +
        "of the range or continue past the last will be undercounted. For a complete accounting " +
        "run without the pages field.",
    );
  }

  for (const c of conflicts) {
    out.push(
      `The calibration key “${c.styleKey}” contains differing desiredWordSpacing ` +
        `(${c.desired.map((d) => (d === null ? "mixed" : String(d))).join(", ")}) on ${c.lines} ` +
        "lines. styleKey deliberately does not read spacing.desired, so a local override of " +
        "the word spacing pours two different base spacings into one median — the ratios " +
        "for those lines are skewed in both directions.",
    );
  }

  if (hyphen.hyphenSource === "fallback") {
    out.push(
      "The width of the hyphen character was NOT measured — a fallback 0.34 em was used (a number for one size of one " +
        "typeface). Hyphenated lines fall short of the measure by exactly that amount, so in a different " +
        "typeface some of them may read as loose.",
    );
  }

  if (uncalibrated.length > 0) {
    out.push(
      `Not calibrated: ${uncalibrated.length} pairs (style, size); their lines are outside the density ` +
        "analysis. These are not “clean” styles — these are styles without a measurement.",
    );
  }

  /*
   * TWO REASONS FOR UNMEASURABILITY — TWO ROWS, and they must not be merged.
   *
   * `overset` — the lines physically DO NOT EXIST. `text-path` — the lines DO
   * exist, but there's nothing to measure them against: the whole composition
   * measure rests on a RECTANGULAR text frame, and text on a path has none
   * (measured 2026-08-18).
   *
   * Before this fix both went under one row, "Overset in N containers" — a book
   * with a single heading on an oval got a named FALSE cause, presented as a
   * measurement, and an inflated overset count.
   */
  const overset = measured.unmeasured.filter((u) => u.reason === "overset");
  const onPath = measured.unmeasured.filter((u) => u.reason === "text-path");
  if (overset.length > 0) {
    out.push(
      `Overset in ${overset.length} containers: composed lines for that ` +
        "text do not exist at all, so it was not measured and could not have been flagged.",
    );
  }
  if (onPath.length > 0) {
    out.push(
      `Text along a path in ${onPath.length} containers was NOT measured: it does have lines, ` +
        "but no rectangular text column, so there is nothing to compare their justification against. " +
        "This is not overset.",
    );
  }

  if (dropped.textMismatch > 0) {
    out.push(
      `${dropped.textMismatch} lines discarded: the length of text does not match the length of chars, ` +
        "i.e. a character and its coordinate have diverged. The LineMeasure contract promises equal lengths; " +
        "a mismatch means a flaw in the measurement layer, not in the document.",
    );
  }

  return out;
}

/* ─────────────────── applying fixes (W2) ─────────────────── */

/**
 * TASK 13's OBLIGATION #2, AND IT'S ABOUT DATA PRESERVATION, NOT TIDINESS.
 *
 * `apply_edits` ADDS the delta to the paragraph's existing tracking
 * (`para.tracking = para.tracking + item.delta`, `apply.jsx`). So two proposals
 * for ONE paragraph, both submitted, would fix it TWICE — silently, because no
 * report compares the intended tracking against the actual one.
 *
 * `proposeFixes` guarantees ("Invariant 1") that all proposals for one paragraph
 * carry the SAME delta, so any one of them can be taken. But relying on the
 * invariant silently isn't acceptable: if it ever breaks, the result is a
 * corrupted paragraph in the user's book. So a mismatch here is an exception with
 * named numbers, not "take the first one."
 */
export function dedupeTracking(fixes: readonly TrackingFix[]): TrackingFix[] {
  const byParagraph = new Map<string, TrackingFix>();
  for (const t of fixes) {
    const key = `${t.containerId} ${t.paragraphIndex}`;
    const seen = byParagraph.get(key);
    if (seen === undefined) {
      byParagraph.set(key, t);
      continue;
    }
    if (seen.delta !== t.delta) {
      throw new Error(
        `Two tracking proposals for one paragraph (${t.containerId}, paragraph ${t.paragraphIndex}) ` +
          `ask for different deltas: ${seen.delta} and ${t.delta}. apply_edits ADDS the delta, so ` +
          "applying both would correct the paragraph twice, and picking one at random would " +
          "quietly apply something other than what the audit showed. This is a violation of the proposeFixes invariant " +
          "(“all proposals for one paragraph carry the same delta”), not a state of the document.",
      );
    }
  }
  return [...byParagraph.values()];
}

/**
 * TWO FINDINGS ON THE SAME LINE PRODUCE THE SAME FIX — and this isn't a hypothesis.
 *
 * `hyphen-forbidden` and `hyphen-across-spread` measure ONE quantity (the fraction
 * of a word carried across the break, the `carried-fraction` scale in
 * `finding.ts`) and are fixed the same way — a soft hyphen before the same
 * fragment of the same word. A line that violates both rules produces two findings
 * with a LITERALLY identical `AcceptedEdit`, except for `requestId`.
 *
 * What would happen without this function: both fixes would go into the batch,
 * the first would land, the second would get `skipped` for an `expectedOld`
 * mismatch (because U+00AD is already there). So it's safe — but safe BY
 * ACCIDENT, through the reconciliation, not because anyone noticed the duplicate.
 * Worse: after the write is recorded, the second finding would be left without a
 * verdict, even though its defect was fixed by that very same insertion.
 *
 * So identical fixes are merged into ONE, and the findings that requested it all
 * remain — and all get a verdict once that single fix lands.
 *
 * AN OVERLAP THAT ISN'T A COINCIDENCE is impossible here by construction (this
 * tool's fixes are word fragments at the ENDS of different lines), but that's
 * exactly why it must be caught: if it ever appears, it means an addressing flaw,
 * not a new capability. `findConflicts` catches it on the already-merged batch.
 */
export function coalesceEdits(proposals: readonly Proposal[]): {
  edits: AcceptedEdit[];
  /** The `requestId` of a submitted fix -> all findings that requested it. */
  groups: Map<string, string[]>;
} {
  const edits: AcceptedEdit[] = [];
  const groups = new Map<string, string[]>();
  const byIdentity = new Map<string, string>();

  for (const p of proposals) {
    if (p.edit === undefined) continue;
    const e = p.edit;
    const identity = JSON.stringify([e.containerId, e.start, e.end, e.action, e.expectedOld, e.newText]);
    const owner = byIdentity.get(identity);
    if (owner !== undefined) {
      groups.get(owner)!.push(p.findingId);
      continue;
    }
    byIdentity.set(identity, e.requestId);
    groups.set(e.requestId, [p.findingId]);
    edits.push(e);
  }

  /*
   * The check lives HERE, not at the call site, and that's not a style choice. An
   * overlap that isn't a coincidence is unreachable through `proposeFixes` by
   * construction — so a check at the call site would be a line nothing could ever
   * execute, and the mutation of "remove it" would go unnoticed forever. Inside
   * the exported function it can instead be fed fixes directly and verified with a
   * test.
   */
  for (const { a, b } of findConflicts(edits)) {
    throw new Error(
      `Two edits overlap without being identical: ${a.requestId} [${a.start}; ${a.end}) ` +
        `and ${b.requestId} [${b.start}; ${b.end}) in ${a.containerId}. Such edits must not be written in one ` +
        "batch: the second would land on text already shifted by the first. This tool's edits " +
        "address word fragments at the ends of DIFFERENT lines, so an overlap means a flaw in addressing, " +
        "not a rare case in the document.",
    );
  }
  return { edits, groups };
}

/** Measures the named pages in windows. Any window failure is an exception: a re-measurement stitched together with holes is worse than none at all. */
async function measureWindows(pages: string[], pageWindow: number): Promise<MeasureResult> {
  const parts: MeasureResult[] = [];
  for (const window of pageWindows(pages, pageWindow)) {
    try {
      parts.push(
        parseMeasureResult(
          await runJsx<unknown>("composition_measure", { pages: window }, { timeoutMs: MEASURE_TIMEOUT_MS }),
        ),
      );
    } catch (e) {
      if (e instanceof IndesignError && e.kind === "busy") throw describeMeasureTimeout(window);
      throw e;
    }
  }
  return mergeResults(parts);
}

/* ────────────────────────── the tool itself ────────────────────────── */

/**
 * READ timeout. The document is unchanged, and the hint should point toward
 * narrowing the range, not toward hunting for a nonexistent modal dialog.
 */
export function describeMeasureTimeout(pages: readonly string[]): IndesignError {
  const from = pages[0] ?? "?";
  const to = pages[pages.length - 1] ?? "?";
  return new IndesignError(
    "busy",
    `InDesign did not respond while READING pages ${from}–${to}. ` +
      "This is a read only — the document was not changed.",
    `Narrow the range: pass pages or reduce pageWindow (default ${PAGE_WINDOW}). ` +
      "A full measurement of a 196-page book costs about two minutes, so a single window " +
      "that did not fit almost always means a heavy page rather than a hang. " +
      "If InDesign is nevertheless showing a modal dialog, close it.",
  );
}

/**
 * Finding-selection parameters — ONE description shared by two tools.
 *
 * `composition_apply` addresses findings by identifiers from `composition_audit`,
 * and the identifier depends on WHICH parameters selected them. Two independent
 * copies of this schema would diverge in defaults or description, and the
 * operator would get "finding not found" where it was really just selected
 * differently. So the schema is shared literally — the same object, not matching
 * text.
 */
const DETECTION_SCHEMA = {
  spacingMode: z
    .enum(["survey", "style-bounds", "ratio", "rank"])
    .default("survey")
    .describe(
      '"survey" (default) — flags nothing, shows the distribution; "style-bounds" — the bounds ' +
        'declared by the style (59% of lines on the measured book); "ratio" — your threshold from ' +
        'minRatio/maxRatio; "rank" — no selection, everything measured in descending order of strength.',
    ),
  minRatio: z.number().positive().optional().describe("A fraction, not a percentage: 0.8, not 80."),
  maxRatio: z.number().positive().optional().describe("A fraction, not a percentage: 1.33, not 133."),
  warnBandPct: z
    .number()
    .min(0)
    .max(50)
    .default(0)
    .describe("A warning band inside the justification bounds, in percentage points."),
  shortLastLineFraction: z.number().min(0).max(1).default(DEFAULT_SHORT_LAST_LINE_FRACTION),
  minWordChars: z.number().int().min(1).default(DEFAULT_MIN_WORD_CHARS),
  maxLadder: z.number().int().min(1).default(DEFAULT_MAX_LADDER),
  forbiddenWords: z
    .array(z.string())
    .optional()
    .describe("Words that must not be hyphenated. The comparison is case-sensitive."),
  riverMinRows: z.number().int().min(2).default(DEFAULT_MIN_ROWS),
  riverTolerancePt: z.number().min(0).default(DEFAULT_TOLERANCE_PT),
  riverMinChannelPt: z.number().min(0).default(0),
  riverJustifiedOnly: z.boolean().default(false),
  sentenceEnders: z
    /* `.length(1)`, not a bare `z.string()`: `judgeDashLine` asks
     * `sentenceEnders.has(last)`, where `last` is EXACTLY ONE character. A
     * multi-character string (e.g. "...") would silently never match — a
     * module that everywhere refuses silent data loss must not allow it
     * right here. */
    .array(z.string().length(1))
    .optional()
    .describe(
      "Characters after which a dash at the start of a line is treated as the start of a new sentence and is NOT " +
        "corrected. Default: . ! ? … : — closing quotes and brackets are transparent, the character " +
        "beneath them is what is examined. An empty array disables this exception entirely. Each element is " +
        "EXACTLY one character (e.g. pass an ellipsis as «…», not as «...»).",
    ),
  includeMasters: z
    .boolean()
    .default(false)
    .describe(
      "Include lines of master pages in the analysis. Not by default: page for them is the master's name, " +
        "not a page number, and an edit there changes the template rather than the text of the book.",
    ),
  pageWindow: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(PAGE_WINDOW)
    .describe("How many pages to measure per InDesign call."),
} as const;

export function registerCompositionTools(server: Tools): void {
  server.registerTool(
    "composition_audit",
    {
      title: "Composition audit",
      description:
        "Measures the document's composition and returns an ANALYSIS rather than a list: the base share, the distribution " +
        "of ratios with thresholds for a desired share, a breakdown by style, a separate list of what was " +
        "NOT measured, and findings grouped by scale of strength. Defect classes: tight and loose " +
        "lines, widows and orphans, short last lines, hyphen ladders, a hyphen across a spread, " +
        "corridors, and a dash torn from its word by a line break. To each finding it adds " +
        "a PROPOSED correction: paragraph tracking (with a computed amount and the share it " +
        "covers), a soft hyphen before a word, a non-breaking space before a dash, or an honest “instruction " +
        "only” where no automatic correction exists — for an orphan, a hyphen ladder and " +
        "a corridor. The tool never rewrites the author's text. The natural width of a space is " +
        "calibrated from the document itself — from the last lines of " +
        "paragraphs. The tool does NOT invent a density threshold: by default (spacingMode: \"survey\") " +
        "it shows the distribution and flags nothing, and you name the number yourself. The document is cut into " +
        "page windows, because a full measurement costs about two minutes. Changes nothing.",
      inputSchema: {
        pages: z
          .array(z.string())
          .optional()
          .describe('InDesign page names, e.g. ["12","13"]. Without this field — the whole document.'),
        ...DETECTION_SCHEMA,
        perDefectLimit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(5)
          .describe("How many of the worst findings to show per defect CLASS, not per scale."),
      },
    },
    async (args) => {
      const {
        pages,
        spacingMode,
        minRatio,
        maxRatio,
        warnBandPct,
        shortLastLineFraction,
        minWordChars,
        maxLadder,
        forbiddenWords,
        riverMinRows,
        riverTolerancePt,
        riverMinChannelPt,
        riverJustifiedOnly,
        includeMasters,
        sentenceEnders,
        perDefectLimit,
        pageWindow,
      } = args;

      /* The window where the call failed — so the hint can name the pages. */
      let failedWindow: string[] = [];

      try {
        /* Validation BEFORE measurement: otherwise the user would pay two minutes for
         * an argument error visible at a glance. */
        if (spacingMode === "ratio" && minRatio === undefined && maxRatio === undefined) {
          throw new Error(
            'composition_audit: spacingMode "ratio" requires minRatio or maxRatio. ' +
              'Run spacingMode: "survey" and take the number from spacing.thresholdsForShare.',
          );
        }

        const target =
          pages && pages.length > 0
            ? pages
            : (await runJsx<{ pages: string[] }>("composition_pages", {})).pages;

        const windows = pageWindows(target, pageWindow);
        const parts: MeasureResult[] = [];
        let stoppedAt: string | null = null;
        let stoppedReason: string | null = null;

        for (const window of windows) {
          failedWindow = window;
          try {
            parts.push(
              parseMeasureResult(
                await runJsx<unknown>(
                  "composition_measure",
                  { pages: window },
                  { timeoutMs: MEASURE_TIMEOUT_MS },
                ),
              ),
            );
          } catch (e) {
            /* One window's failure must not destroy what's already collected — but must
             * not pretend to be a full run either: the report shape stays the same,
             * the partial flag is there. */
            if (parts.length === 0) throw e;
            stoppedAt = window[0] ?? "?";
            stoppedReason = e instanceof Error ? e.message : String(e);
            break;
          }
        }

        const merged = mergeResults(parts);
        return ok(
          buildReport(merged, {
            spacingMode,
            minRatio,
            maxRatio,
            warnBandPct,
            shortLastLineFraction,
            minWordChars,
            maxLadder,
            forbiddenWords,
            riverMinRows,
            riverTolerancePt,
            riverMinChannelPt,
            riverJustifiedOnly,
            includeMasters,
            sentenceEnders,
            perDefectLimit,
            requestedPages: pages && pages.length > 0 ? pages : null,
            windows: windows.length,
            windowsDone: parts.length,
            stoppedAt,
            stoppedReason,
          }),
        );
      } catch (e) {
        if (e instanceof IndesignError && e.kind === "busy") {
          return fail(describeMeasureTimeout(failedWindow));
        }
        return fail(e);
      }
    },
  );

  server.registerTool(
    "composition_apply",
    {
      title: "Applying composition corrections",
      description:
        "Applies selected proposals from composition_audit as ONE undo step (Cmd+Z rolls back " +
        "the whole batch). Before writing it saves a copy of the document, and the path to the copy is returned even " +
        "when the write was interrupted. Invisible characters and text edits go by the same path as " +
        "a proofreader's corrections; only paragraph tracking is new. NOTE: an “invisible” correction changes " +
        "a real character in the TEXT — for a hyphen it is an INSERTED soft hyphen U+00AD, for a dash " +
        "at the start of a line it is an ordinary space REPLACED by a non-breaking U+00A0. The author's words are " +
        "not changed by this, but the story's character stream is, and everything that reads the text will see it: " +
        "search, export, spell checking, version comparison. Proposals of the manual kind are never applied " +
        "— they are an instruction only. AFTER the write the affected pages are measured AGAIN, and each " +
        "finding is reported as resolved (gone), still-present (remained) or displaced (a " +
        "new defect appeared nearby that was not there before the write): any correction recomposes the paragraph and " +
        "may carry the problem to an adjacent line, so a report of “N applied” without re-measurement would be " +
        "a lie about the one thing this tool exists for. The selection parameters must match " +
        "those the audit was run with — otherwise the finding identifiers will not be found (they are visible " +
        "in the unknownFindingIds field, they do not stay silent). The blocked and shortfall fields say why " +
        "proposals were not written and where what was written will knowingly fall short.",
      inputSchema: {
        pages: z
          .array(z.string())
          .min(1)
          .describe(
            "The pages that were in the audit — both the selection of findings and the RE-MEASUREMENT follow them. " +
              "Mandatory: measuring the whole document twice for the sake of a few edits would mean " +
              "four minutes of waiting.",
          ),
        findingIds: z
          .array(z.string())
          .min(1)
          .describe("Which findings to correct. Identifiers from composition_audit, unchanged."),
        undoName: z.string().default("Composition correction"),
        expectedDocName: EXPECTED_DOC_NAME_FIELD,
        maxTracking: z
          .number()
          .positive()
          .default(DEFAULT_MAX_TRACKING)
          .describe(
            `The tracking limit in units of 1/1000 em. The default ${DEFAULT_MAX_TRACKING} is a TYPESETTING ` +
              "CONVENTION, not a measurement of this document: nobody has measured how noticeable tracking is.",
          ),
        dryRun: z
          .boolean()
          .default(false)
          .describe(
            "Compute the proposals and show exactly what would be written, writing NOTHING. " +
              "There is no re-measurement in this mode — there is nothing to measure.",
          ),
        ...DETECTION_SCHEMA,
      },
    },
    async (args) => {
      const { pages, findingIds, undoName, maxTracking, dryRun, pageWindow, expectedDocName, ...detection } = args;
      /* What's being done right now — so the timeout hint doesn't confuse
       * "reading, document unchanged" with "writing, check the copy." */
      let phase: "before" | "write" | "after" = "before";
      let backupPath: string | null = null;

      try {
        /* Validation BEFORE measurement (the same as in composition_audit, final-review
         * minor 2): otherwise the user would pay two minutes for an argument error
         * visible at a glance. Without it the failure would happen only deep inside
         * detectAll/detectSpacing, AFTER the measurement. */
        if (detection.spacingMode === "ratio" && detection.minRatio === undefined && detection.maxRatio === undefined) {
          throw new Error(
            'composition_apply: spacingMode "ratio" requires minRatio or maxRatio. ' +
              'Run spacingMode: "survey" and take the number from spacing.thresholdsForShare.',
          );
        }

        const beforeMeasure = await measureWindows(pages, pageWindow);
        assertExpectedDoc(beforeMeasure.docName, expectedDocName);
        const before = analyse(beforeMeasure, detection);

        const chosen = new Set(findingIds);
        const byId = new Map(before.findings.map((f) => [f.id, f]));
        /*
         * Unknown identifiers do NOT pass silently. The most likely cause is
         * different selection parameters or a different page list than in the
         * audit; silently ignoring them would show "0 applied" and look like
         * "nothing needed fixing."
         */
        const unknownFindingIds = findingIds.filter((id) => !byId.has(id));
        const selected = before.findings.filter((f) => chosen.has(f.id));

        if (selected.length === 0) {
          return ok({
            docName: beforeMeasure.docName,
            applied: 0,
            unknownFindingIds,
            message:
              "None of the named findings is among those measured on these pages. Nothing was " +
              "written. The commonest reason is that the selection parameters (spacingMode, thresholds, " +
              "forbiddenWords, includeMasters) or the list of pages are not those the audit was run " +
              "with: a finding's identifier depends on them.",
          });
        }

        /*
         * TASK 13's OBLIGATION #1. Without container snapshots, no invisible fix
         * gets an address at all: `LineMeasure` doesn't carry absolute offsets
         * into the story text, and they can't be recovered from lines
         * (`propose.ts`, ProposeOptions.containers). The audit deliberately
         * doesn't read them — this tool pays that cost, and that's exactly why
         * invisible fixes are addressed here.
         */
        const read = await runJsx<{ docName: string; containers: ContainerSnapshot[] }>(
          "containers_read",
          {},
        );
        if (read.docName !== beforeMeasure.docName) {
          throw new IndesignError(
            "jsx-error",
            `The measurement was made in document “${beforeMeasure.docName}”, but the container texts arrived ` +
              `from “${read.docName}”. The active document changed mid-run.`,
            "Make the intended document active and repeat. Nothing has been changed.",
          );
        }

        /*
         * FULL CONTEXT, THEN FILTER (I1, final review).
         *
         * `proposeFixes` counts a tracking-direction conflict ("the paragraph
         * needs both tight and loose lines" — `paragraphDelta` in `propose.ts`)
         * against its OWN paragraph index, built from whatever it's given. Passing
         * `selected` here (only the findings the operator chose) would hide from
         * this check any finding in the same paragraph the operator didn't choose
         * — the conflict would become invisible, and tracking would go into a
         * paragraph that actually needs opposite directions. Second consequence:
         * `paragraphDelta` takes `Math.min` by magnitude across EVERYTHING it
         * sees — fewer findings on input can only INCREASE the computed delta.
         *
         * So the context is `before.findings` (everything the audit saw too), and
         * the operator's selection is applied AFTER: `proposeFixes` returns
         * exactly one `Proposal` per input finding, in the same order
         * (`propose.ts:803`), so filtering by `chosen` preserves order and doesn't
         * touch anything downstream — `coalesceEdits`/`dedupeTracking`/`blocked`
         * and the other derivations work with the result exactly as before.
         */
        const proposals = proposeFixes(before.findings, before.analysed, {
          containers: read.containers,
          maxTracking,
        }).filter((p) => chosen.has(p.findingId));

        /* First merge identical fixes (two findings on the same line requesting
         * literally the same insertion) — the overlap is caught there too — and
         * only then order them. */
        const { edits: unique, groups: editGroups } = coalesceEdits(proposals);
        /* OBLIGATION #3: invisible fixes go through orderForApply. Fixes of the two
         * hyphenation classes INSERT a character and shift every following offset
         * in the same story; without sorting by descending `start`, every fix
         * after the first in a container breaks. The `line-start-dash` fix
         * replaces one character with another and shifts nothing itself — but it
         * rides in the same batch, so it needs the sort just as much as the rest. */
        const edits = orderForApply(unique);
        /* OBLIGATION #2: one delta per paragraph — apply_edits ADDS it. */
        const tracking = dedupeTracking(proposals.flatMap((p) => (p.tracking ? [p.tracking] : [])));

        /* OBLIGATION #4: refused and insufficient proposals are visible, not hidden. */
        const blocked = proposals
          .filter((p) => p.blocked !== undefined)
          .map((p) => ({ findingId: p.findingId, defect: p.defect, kind: p.kind, reason: p.blocked! }));
        const shortfalls = proposals
          .filter((p) => p.shortfall !== undefined)
          .map((p) => ({ findingId: p.findingId, defect: p.defect, ...p.shortfall! }));
        const manual = proposals
          .filter((p) => p.kind === "manual")
          .map((p) => ({ findingId: p.findingId, defect: p.defect, description: p.description }));

        /*
         * WHAT'S SUBMITTED FOR WRITING is an INTENT, not a result.
         *
         * Findings for which at least one write went into the batch. The
         * re-measurement is NOT yet driven by these: `apply_edits` can perfectly
         * well return a fix as `skipped` (the text changed after the plan was
         * built) or `failed` (a locked story), and then NOTHING was done for that
         * finding. Who it really was is decided by the write report, below.
         */
        const submittedParagraphs = new Set(tracking.map((t) => `${t.containerId} ${t.paragraphIndex}`));
        const attempted = proposals
          .filter(
            (p) =>
              p.edit !== undefined ||
              (p.tracking !== undefined &&
                submittedParagraphs.has(`${p.scope.containerId} ${p.scope.paragraphIndex}`)),
          )
          .map((p) => p.findingId);

        const nothingToWrite = {
          docName: beforeMeasure.docName,
          pages: beforeMeasure.pages,
          selected: selected.length,
          unknownFindingIds,
          willWrite: { edits: edits.length, trackingParagraphs: tracking.length, findings: attempted.length },
          attempted,
          manual,
          blocked,
          shortfalls,
        };

        if (edits.length === 0 && tracking.length === 0) {
          return ok({
            ...nothingToWrite,
            applied: 0,
            message:
              "Among the chosen findings there is not one with an automatic correction: everything is either manual " +
              "(an instruction, not a write) or blocked (the reason is named on each). The document was not " +
              "changed and no copy was made.",
          });
        }

        if (dryRun) {
          return ok({
            ...nothingToWrite,
            dryRun: true,
            edits,
            tracking,
            message:
              "Dry run: NOTHING was written and no copy was made. The edits and tracking fields are " +
              "exactly what would go into apply_edits, in the same order.",
          });
        }

        phase = "write";
        const report = await runWrite<
          ApplyReport & {
            trackingApplied: { containerId: string; paragraphIndex: number; delta: number }[];
            trackingFailed: { containerId: string; paragraphIndex: number; reason: string }[];
          }
        >({
          handler: "apply_edits",
          params: {
            expectedDocName: beforeMeasure.docName,
            stamp: backupStamp(),
            undoName,
            edits,
            tracking,
          },
          timeoutMs: APPLY_TIMEOUT_MS,
        });
        backupPath = report.backupPath;

        /*
         * WHAT WAS ACTUALLY WRITTEN — and this is what drives the re-measurement.
         *
         * This used to hold `attempted`, i.e. INTENT, and that was a real flaw,
         * not pedantry: a fix returned as `skipped` or `failed` still got a
         * verdict, and could get "resolved" — because ANOTHER fix in the same
         * batch recomposed the paragraph and the finding disappeared on its own.
         * So `verificationCounts` overstated success — exactly what the comment
         * below, and this whole task, warns against.
         *
         * `requestId` equals `findingId` (invariant 2 in `propose.ts`), so no
         * translator is needed between the write report and the finding's
         * address.
         */
        /* A fix that landed closes ALL findings that requested it: merged
         * duplicates are the same insertion, not skipped work. */
        const writtenByEdit = new Set(
          report.applied.flatMap((a) => editGroups.get(a.requestId) ?? [a.requestId]),
        );
        const trackedParagraphs = new Set(
          report.trackingApplied.map((t) => `${t.containerId} ${t.paragraphIndex}`),
        );
        const written = proposals
          .filter(
            (p) =>
              (p.edit !== undefined && writtenByEdit.has(p.findingId)) ||
              (p.tracking !== undefined &&
                trackedParagraphs.has(`${p.scope.containerId} ${p.scope.paragraphIndex}`)),
          )
          .map((p) => p.findingId);
        /* Submitted but not written. Silence about them isn't an option: without this
         * list the gap between attempted and written would look like lost
         * findings. */
        const notWritten = attempted.filter((id) => !written.includes(id));

        /*
         * RE-MEASUREMENT. The same pages, the same detector parameters —
         * otherwise "new defect" would just mean "measured a different spot." The
         * condition is declared in `verify.ts`'s header, and enforced EXACTLY
         * here: `pages` and `detection` are the same variables that went into the
         * "before" measurement.
         *
         * A re-measurement failure does NOT hide the write: the copy is already
         * made, the fixes already landed, and the report must say so plainly, not
         * fail with an error that leads the reader to think nothing happened.
         */
        phase = "after";
        let verification: ReturnType<typeof verifyFixes> = [];
        let verificationError: string | null = null;
        try {
          const afterMeasure = await measureWindows(pages, pageWindow);
          /* `before.cal` — the same reference as the "before" measurement (I3, final
           * review): the re-measurement is NOT recalibrated from the just-tracked
           * text. See the comment on `analyse`. */
          verification = verifyFixes(
            before.findings,
            analyse(afterMeasure, detection, before.cal).findings,
            written,
          );
        } catch (e) {
          verificationError = e instanceof Error ? e.message : String(e);
        }

        const counts = { resolved: 0, "still-present": 0, displaced: 0 };
        for (const v of verification) counts[v.outcome]++;

        return ok({
          docName: beforeMeasure.docName,
          backupPath: report.backupPath,
          backupsRemoved: report.backupsRemoved,
          backupRotationError: report.backupRotationError,
          pages: beforeMeasure.pages,
          unknownFindingIds,
          /* Intent and result — SEPARATE fields. One number instead of two would hide
           * exactly the difference the re-measurement exists to show. */
          attempted,
          written,
          notWritten,
          write: {
            applied: report.applied,
            skipped: report.skipped,
            failed: report.failed,
            trackingApplied: report.trackingApplied,
            trackingFailed: report.trackingFailed,
            oversetBefore: report.oversetBefore,
            oversetAfter: report.oversetAfter,
            pageCountBefore: report.pageCountBefore,
            pageCountAfter: report.pageCountAfter,
          },
          manual,
          blocked,
          shortfalls,
          verification,
          verificationCounts: counts,
          verificationError,
          note:
            verificationError !== null
              ? "THE RE-MEASUREMENT DID NOT HAPPEN, but the write did: the copy is in backupPath, what was applied is in " +
                "write.applied and write.trackingApplied. The reason is in verificationError. Run " +
                "composition_audit over the same pages to see the consequences."
              : `resolved ${counts.resolved}, still-present ${counts["still-present"]}, ` +
                `displaced ${counts.displaced}. A verdict is carried ONLY by those findings whose write ` +
                "actually landed (written); those submitted but not written (notWritten — skipped or failed " +
                "in write) do NOT get a verdict, otherwise a neighbouring edit in the same batch could " +
                "write them somebody else's “resolved”. “displaced” is NOT a fault of the tool but a " +
                "measured consequence: a correction recomposes the paragraph and may carry a defect " +
                "to an adjacent line. “still-present” alongside a non-empty shortfalls is to be expected — " +
                "the tracking knowingly fell short of the whole deviation. A single Cmd+Z rolls back the whole batch. " +
                "NOTE: an invisible correction changes the text's character stream. For hyphens that is " +
                "an INSERTED U+00AD, for a dash at the start of a line an ordinary space REPLACED by " +
                "a non-breaking U+00A0. The author's words are not changed, the character stream is. For a dash " +
                "it may be the PRECEDING line that becomes loose after the write (the pair “word + dash” " +
                "stopped breaking and moved down whole) — that is an expected consequence, not a failure.",
        });
      } catch (e) {
        if (e instanceof IndesignError && e.kind === "busy" && phase === "write") {
          return fail(describeApplyTimeout());
        }
        /*
         * BELT AND SUSPENDERS, and it's said outright, because the branch looks
         * like a net that never fires. `backupPath` is assigned only AFTER
         * `runWrite` returns, and everything after that which can throw already
         * sits inside the re-measurement's own try/catch. So there is currently NO
         * reachable path here — and the review correctly noticed that.
         *
         * The branch stays for one reason: the only consequence of removing it is
         * an error with no path to the copy, i.e. a user with a changed book and
         * no hint of where to recover it from. The cost of keeping it is five
         * lines; the cost of the gap is 196 pages. The normal "write aborted" path
         * doesn't lead here — it goes through `fatalError` in `runWrite`, and the
         * copy path there carries the `hint` of that `IndesignError`.
         */
        if (backupPath !== null && e instanceof Error) {
          return fail(
            new IndesignError(
              "jsx-error",
              `The write happened, and then a failure occurred: ${e.message}`,
              `A copy of the document from before the edits was saved: ${backupPath}. The edits are already in the document — ` +
                "a single Cmd+Z will roll back the whole batch.",
            ),
          );
        }
        return fail(e);
      }
    },
  );
}

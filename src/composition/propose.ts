/**
 * W1. A proposed fix for every composition finding. Pure TypeScript,
 * writes nothing and reads nothing from InDesign.
 *
 * WHAT'S DECIDED HERE, AND WHY THIS WAY
 * ================================
 * Ten defect classes, four kinds of fix (user decision from 2026-08-04: all
 * four). Mapping one to the other is declared in **one single place**, and
 * declared as `FIX_KIND`, not in prose.
 *
 * It was derived NOT from the plan — the plan was written before even one
 * detector existed — but from what the detectors ACTUALLY MEASURE. Every row
 * of the table is named next to its class below. Three conclusions diverge
 * from the plan, and all three are named outright so they can be challenged:
 *
 * 1. **The tracking direction for `loose`/`tight` is the opposite of the
 *    plan.** The plan said "a loose line — negative tracking, to tighten the
 *    text up." That's true for a PARAGRAPH and false for a LINE: a loose
 *    line already has too much inter-word air, and negative tracking adds
 *    more of it, because narrower letters leave the spaces even more room.
 *    What's needed is the opposite — spread the letters apart so the glyph
 *    width absorbs the excess. The value `detect-spacing.ts` measures is
 *    exactly that excess: `strength` on the `air-fraction` scale — "excess
 *    inter-word air as a share of the measure" (`finding.ts`).
 * 2. **`orphan` has no tracking fix at all.** An orphan is the FIRST line of
 *    a paragraph left alone as the last line of a frame. Neither a shorter
 *    nor a longer paragraph pulls its first line out of the frame: it's the
 *    break that holds the line, not its length. Hence `manual` here, and
 *    that's not caution, it's arithmetic.
 * 3. **`short-last-line` gets tracking, not just an instruction.** The plan
 *    assigned it to editorial decisions ("shorten the text"). But the defect
 *    is MECHANICALLY the same as a widow's — "the last line is too short and
 *    stands alone" — and is cured by the same move: take width away from the
 *    paragraph at this line's expense, so it pulls into the previous one.
 *    That's why both classes go through the same `requiredDelta` branch, with
 *    the same arithmetic and the same denominator. An editorial fix is left
 *    to the operator only when tracking falls short; `shortfall` says so,
 *    right in the description itself.
 *
 *    WHAT THIS ARGUMENT DOESN'T REST ON IS A SHARED SCALE, though the
 *    temptation was there: the fact that `widow` and `short-last-line` sit on
 *    the same `emptiness` scale (`finding.ts`) does NOT by itself mean a
 *    shared fix. The counterexample sits in this same file: `loose` and
 *    `tight` also share one `air-fraction` scale, and their fixes are
 *    OPPOSITE. A shared scale speaks to comparability of numbers, not to a
 *    method of treatment.
 *
 * THE «text» KIND IS NEVER EMITTED — and that too is a decision, not a gap.
 * The kind stays in `FixKind` because the user chose it and the review layer
 * distinguishes it; but no detector measures anything from which you could
 * derive WHICH word to replace and WITH WHAT. The suggestion "shorten the
 * paragraph by a word" is an instruction, i.e. `manual`, and calling it
 * `text` would promise a write that doesn't exist.
 *
 * WHAT THIS MODULE DOES NOT DO: IT DOES NOT RANK
 * ====================================
 * Proposals come back IN THE ORDER OF THE INPUT FINDINGS, one to one. There
 * is no order of their own here, and there can't be: `Finding.strength` is
 * only comparable within a scale (`finding.ts`), and `detectAll` sorts the
 * scales themselves alphabetically precisely as a refusal to rank between
 * them. Inventing an order for PROPOSALS would smuggle that cross-class scale
 * in through the back door. The order is set by whoever passes the findings
 * in.
 *
 * WHAT TASK 14 GETS FROM THIS (re-measuring `resolved` / `still-present` /
 * `displaced`)
 * ==============================================================================
 * - `findingId` — EXACTLY `Finding.id`, there's no second address system.
 *   For a river this is paired with the channel coordinate as
 *   `detect-rivers.ts` assembled it;
 * - `scope` — the container, paragraph, and page that get recomposed. This is
 *   exactly the scope that has to be re-measured, and exactly where
 *   `displaced` can show up;
 * - `before` — `measured` and `strength` before the write. Without them
 *   "stayed the same" can't be told apart from "stayed the same but at half
 *   strength";
 * - `alsoInParagraph` — other findings in THE SAME paragraph. A fix
 *   recomposes the whole paragraph, so each of them can become `resolved` or
 *   `displaced`, even if nobody submitted it. This is that constant of the
 *   phase ("any fix recomposes the paragraph") written down mechanically;
 * - `shortfall` — how much of what's needed the proposal actually covers. A
 *   finding where `coverage` is 0.12 will legitimately stay
 *   `still-present` after the write, not due to a failure;
 * - `blocked` — why there's no write. An empty `edit`/`tracking` with no
 *   reason would look like "nothing needed."
 *
 * TWO INVARIANTS TASK 14 IS ENTITLED TO RELY ON — AND ONE OBLIGATION OF ITS
 * OWN, WITHOUT WHICH IT WILL CORRUPT DATA
 * ======================================================================
 * **Invariant 1: one tracking value per paragraph.** `apply_edits` ADDS the
 * delta to the paragraph's existing tracking
 * (`para.tracking = para.tracking + item.delta`), so two proposals for the
 * same paragraph, both applied, would double the fix. So every proposal for
 * one paragraph carries the SAME delta, and duplicates can be dropped by the
 * pair (container, paragraph), taking any one.
 *
 * **Invariant 2: `edit.requestId` equals `findingId`.** `ApplyReport.applied`
 * carries exactly `requestId`, so the re-measurement keeps the same address
 * with no translator needed.
 *
 * **OBLIGATION: edits must pass through `orderForApply`**
 * (`src/corrections/planner.ts:332-344`) before being submitted to
 * `apply_edits`. This isn't style, it's data preservation. Every invisible
 * character INSERTS one character, i.e. shifts every following position in
 * the same story; `orderForApply` groups by container and sorts by
 * DESCENDING `start` for exactly this reason, and `apply.jsx:85` relies on
 * that directly. Submitting `proposals.map((p) => p.edit)` as-is means
 * corrupting every edit after the first one in a container. The `expectedOld`
 * check saves some of them (they become `skipped`), but only some: wherever
 * the shifted range happens to cover the same text, the edit silently lands
 * in the wrong place. Sorting here, inside `proposeFixes`, isn't possible —
 * the signature returns proposals one per finding, in the findings' order,
 * and write order is a property of the batch.
 */

import type { AcceptedEdit, ContainerSnapshot } from "../corrections/types.js";
import { precedingWord } from "./detect-dashes.js";
import { wordTail } from "./detect-hyphens.js";
import { isMeasurable } from "./measurable.js";
/*
 * Address arithmetic lives in `propose-locate.ts` (split out 2026-08-05: this
 * file had grown past 1000 lines). The dividing line isn't size, it's the
 * cost of a mistake: there, an off-by-one-character error means a write to
 * the wrong spot in the book; here, an inaccuracy in the explanation text.
 */
import {
  locateDashSpace,
  locateWord,
  no,
  paragraphKey,
  SOFT_HYPHEN,
  SPACE,
  type Attempt,
  type Paragraph,
} from "./propose-locate.js";
import type { DefectClass, Finding, LineMeasure } from "./types.js";

export type FixKind = "invisible" | "tracking" | "text" | "manual";

export interface TrackingFix {
  containerId: string;
  paragraphIndex: number;
  /** InDesign tracking units (1/1000 em). Negative — tightening. */
  delta: number;
}

/** How far short a bounded proposal falls of what's needed. */
export interface Shortfall {
  /** How many tracking units would close the deviation completely. */
  requiredDelta: number;
  /** How much is actually proposed — after the limit and after the paragraph's shared delta. */
  appliedDelta: number;
  /** `|applied| / |required|`, within (0; 1). */
  coverage: number;
}

export interface Proposal {
  /** EXACTLY `Finding.id`. There's no second address system. */
  findingId: string;
  defect: DefectClass;
  kind: FixKind;
  description: string;
  /** What exactly gets recomposed if this proposal is applied. */
  scope: { containerId: string; paragraphIndex: number; page: string };
  /** State BEFORE the write — the comparison baseline for Task 14's re-measurement. */
  before: { measured: number; strength: number };
  /** Other findings in the same paragraph: the fix will affect them too. */
  alsoInParagraph: string[];
  /** A plain text edit — via the same path as a proofreader's corrections. */
  edit?: AcceptedEdit;
  /** The one genuinely new write of the phase. */
  tracking?: TrackingFix;
  shortfall?: Shortfall;
  /**
   * Why there's no write. Filled in only for kinds that CAN be a write
   * (`tracking`, `invisible`): for `manual`, the absence of a write is the
   * definition itself.
   */
  blocked?: string;
}

export interface ProposeOptions {
  /**
   * The limit tracking won't exceed, in units of 1/1000 em.
   *
   * **A CONVENTION, NOT A MEASUREMENT OF THIS BOOK** — stated just as
   * directly as `detect-hyphens.ts` states it about `maxLadder` and
   * `detect-rivers.ts` about `minRows`.
   * See `DEFAULT_MAX_TRACKING`.
   */
  maxTracking?: number;
  /**
   * Container snapshots (`containers_read`) — the ONLY source of absolute
   * offsets in a story's text.
   *
   * Without them there's nowhere to place an invisible character:
   * `LineMeasure` carries the address (container, paragraph, line) and the
   * line's text, but not the offset within the container's text, while
   * `AcceptedEdit` requires exactly `start`/`end`. They can't be recovered
   * from lines alone — a paragraph with no composed line at all is skipped
   * by the measurement layer (`src/jsx/composition.jsx`,
   * `paraLines.length === 0`), so paragraph numbering can have gaps, and
   * narrowing by page cuts the sample further still.
   *
   * Without this field, proposals with `kind: "invisible"` are returned with
   * NO `edit` and with an explanation in `blocked` — the finding's kind
   * doesn't depend on whether a snapshot is present.
   */
  containers?: readonly ContainerSnapshot[];
}

/**
 * The default tracking limit, units of 1/1000 em.
 *
 * **THIS IS A TYPESETTING CONVENTION, NOT A MEASUREMENT.** There's no number
 * about tracking's visibility anywhere in `docs/measured-facts-phase3.md` —
 * nobody has measured it, and I can't measure it: that requires a human eye
 * on a printed page, not a measurement run. 20/1000 em is the traditional
 * limit for "unnoticeable" line-tightening in book typesetting; at this
 * book's 11.5 pt size that's 0.23 pt per character.
 *
 * WHAT CAN STILL BE SAID ABOUT THIS NUMBER, AND IT IS MEASURED. The book's
 * worst line (paragraph 6, line 1) carries "ten spaces of 10.87 pt each —
 * 108.7 pt of 'air' in a 368.5 pt column"
 * (`docs/measured-facts-phase3.md:316-317`; a space's natural width is
 * 2.645 pt, so the excess is ≈82.2 pt). That same line has **60 characters
 * and 10 spaces** (`docs/measured-facts-phase3.md:310`), i.e. 50 non-space
 * ones — and those are exactly what absorb the excess (see `trackedChars`).
 * By this module's formula that's `1000 × 82.2 / (50 × 11.5)` = **143
 * units**, i.e. seven times the limit; even across all 60 characters it
 * would come to 119, i.e. six times. The conclusion that has to travel with
 * this number: **for the crudest spacing, tracking is not a fix within any
 * reasonable limit**, and that's exactly why `shortfall` is a field, not a
 * footnote, and exactly why the shortfall also goes into the proposal's own
 * text.
 *
 * NUMBERS CORRECTED IN ROUND 2. The first draft wrote "on the order of 70
 * characters" and "≈100 units": 70 was estimated, not taken from the facts,
 * and contradicted the table at line 310. The conclusion only gets stronger
 * after the correction, but a wrong number in a comment that advertises
 * itself as measured is exactly what got this branch pulled from review
 * before.
 *
 * The default is safe in the same sense Task 9 left its own: at worst it
 * under-corrects, and Task 14's re-measurement shows that.
 */
export const DEFAULT_MAX_TRACKING = 20;

/**
 * FROM DEFECT TO FIX KIND — the complete map, no defaults.
 *
 * `Record<DefectClass, …>`, not `Partial`: a new class in `DefectClass` won't
 * compile until it's given a kind. The same idiom as `STRENGTH_SCALE`
 * (`finding.ts`), and for the same reason — otherwise this knowledge would
 * live in prose.
 *
 * JUSTIFIED BY CLASS, from what the detector ACTUALLY MEASURES:
 *
 * - `loose` → **tracking (+)**. `strength` is the excess inter-word air as a
 *   share of the measure (`air-fraction` scale). Spreading the letters by
 *   exactly this excess is direct arithmetic, not a guess: see
 *   `requiredDelta`.
 * - `tight` → **tracking (−)**. The mirror: the same quantity is short of
 *   zero, and tightening the letters gives the spaces room back.
 * - `widow` → **tracking (−)**. `measured` is how much of the measure the
 *   last line fills (`emptiness` scale). Squeezing the paragraph by exactly
 *   this line's width means pulling it into the previous frame. The value is
 *   computed directly.
 * - `short-last-line` → **tracking (−)**. The same scale and the same
 *   arithmetic; `finding.ts` states outright that these two classes measure
 *   one quantity.
 * - `orphan` → **manual**. The `paragraph-share` scale, and it's about the
 *   BREAK, not paragraph length: the paragraph's first line stays at the
 *   bottom of the frame regardless of whether the paragraph is shorter or
 *   longer. The fix lives in InDesign's Keep Options, which `LineMeasure`
 *   doesn't carry at all.
 * - `hyphen-across-spread`, `hyphen-forbidden` → **invisible**. Both classes
 *   measure ONE quantity — the fraction of the word after the break
 *   (`carried-fraction`) — and are cured the same way: a soft hyphen U+00AD
 *   BEFORE the word disables the whole word's hyphenation, and it moves
 *   whole. The author's words aren't changed.
 * - `hyphen-ladder` → **manual**. `strength` is the RUN LENGTH in lines. It
 *   says the ladder exists, and doesn't say WHICH of the hyphens is at
 *   fault; picking one would mean inventing a ranking inside the run that
 *   nobody has measured.
 * - `river` → **manual**. `detect-rivers.ts` says so itself: "in a justified
 *   paragraph inter-word spaces can't be changed at all — those are cured by
 *   rewriting." Rivers are also judged in unjustified paragraphs, where
 *   tracking doesn't move inter-word gaps, so there's no single mechanical
 *   answer.
 * - `line-start-dash` → **invisible**. A non-breaking space U+00A0 in place
 *   of a regular one makes the "word + dash" pair unbreakable, so the dash
 *   no longer starts a line. The author's words aren't changed. Unlike a
 *   soft hyphen, this is a REPLACEMENT of one character, not an insertion,
 *   so the fix doesn't shift later positions.
 */
export const FIX_KIND: Record<DefectClass, FixKind> = {
  loose: "tracking",
  tight: "tracking",
  widow: "tracking",
  "short-last-line": "tracking",
  orphan: "manual",
  "hyphen-across-spread": "invisible",
  "hyphen-forbidden": "invisible",
  "hyphen-ladder": "manual",
  river: "manual",
  "line-start-dash": "invisible",
};

/**
 * A non-breaking space and a regular one. Written as code points, not as a
 * literal: in the source text they look identical, and confusing them by eye
 * is exactly the way to corrupt an edit that must not happen here.
 */
const NBSP = String.fromCharCode(0x00a0);

/**
 * A forced line break (Shift+Enter). In ExtendScript's `contents` this is
 * `\n` (`normalize.ts:16-17`), and there are 44 of them in one story in the
 * book (`src/jsx/composition.jsx`). It breaks a LINE, not a paragraph.
 */
const FORCED_LINE_BREAK = "\n";

/**
 * TWO DENOMINATORS, AND THAT'S NOT AN OVERSIGHT
 * ================================
 * Both functions count characters that carry advance (control characters,
 * `ch === null`, are never counted: InDesign gives them a synthetic width
 * unrelated to the typeface — `types.ts`, comment on `CharMeasure.ch`). They
 * differ in whether the denominator includes the INTER-WORD SPACE, and they
 * differ precisely because the two tasks are different.
 *
 * `trackedNonSpaceChars` — for `loose`/`tight`. The quantity being closed
 * here is the EXCESS OF INTER-WORD AIR in a JUSTIFIED line, i.e. a line whose
 * width equals the measure and will still equal the measure after the fix.
 * Tracking added to a space is taken right back by the justification solver
 * the same instant — the line's total width is fixed, so only what isn't a
 * space gets wider:
 *
 *     air_after = air_before − (N − n) × d,
 *
 * where N is all characters that carry advance, n is the inter-word spaces.
 * The denominator is exactly `N − n`. The measured scale of the error: line
 * 6/1 of the book has 60 characters and 10 spaces
 * (`docs/measured-facts-phase3.md:310`), i.e. spaces are 17%, and counting
 * across all characters would systematically UNDER-correct by roughly that
 * much.
 *
 * `trackedChars` — for `widow`/`short-last-line`. There the quantity is
 * different: the width of the paragraph's CONTENT at the DESIRED spacing,
 * i.e. how much room the paragraph will take once the line recomposes.
 * Justification doesn't hold it fixed — that's exactly what's changing —
 * and a space within it is an ordinary character, carrying tracking on a par
 * with letters. Hence the full denominator here.
 *
 * In short: in the first case the line's width is FIXED and the space is a
 * free variable; in the second the content's width is exactly what we're
 * moving, and the space is part of the content.
 *
 * "Space" means U+0020, exactly as in `spaceGaps` (`calibrate.ts:61`), the
 * one place this block declares what an inter-word space is.
 */
function trackedChars(line: LineMeasure): number {
  let n = 0;
  for (const c of line.chars) if (c.ch !== null) n++;
  return n;
}

/** The same, minus inter-word spaces — see the comment on `trackedChars`. */
function trackedNonSpaceChars(line: LineMeasure): number {
  let n = 0;
  for (const c of line.chars) if (c.ch !== null && c.ch !== " ") n++;
  return n;
}

/**
 * Points a tracking delta of `gaps` will add/remove, over `pt` point size GAPS.
 *
 * The argument is specifically gaps, not characters: tracking adds space
 * AFTER every character, so `n` characters on a line drive `n − 1` gaps,
 * because the addition after the last glyph pushes nothing anymore. Whoever
 * counts the gaps decides how many there are — see `requiredDelta`.
 */
function deltaForPoints(points: number, gaps: number, pointSize: number): number {
  return (1000 * points) / (gaps * pointSize);
}

function indexParagraphs(findings: readonly Finding[], lines: readonly LineMeasure[]): Map<string, Paragraph> {
  const out = new Map<string, Paragraph>();
  const get = (containerId: string, paragraphIndex: number): Paragraph => {
    const key = paragraphKey(containerId, paragraphIndex);
    let p = out.get(key);
    if (p === undefined) {
      p = { byIndex: new Map(), findingIds: [] };
      out.set(key, p);
    }
    return p;
  };
  for (const l of lines) get(l.containerId, l.paragraphIndex).byIndex.set(l.lineInParagraph, l);
  for (const f of findings) get(f.containerId, f.paragraphIndex).findingIds.push(f.id);
  return out;
}

/**
 * How many tracking units would close this finding completely. A FRACTIONAL
 * number, not yet bounded — rounding and clamping happen downstream, by
 * whoever assembles the paragraph.
 *
 * This is the one and only place the arithmetic lives: a tracking unit is
 * 1/1000 em, i.e. every character gets `delta/1000 × pointSize` points.
 * From that, `delta = 1000 × points / (chars × pointSize)` in both cases
 * below — but "chars" is DIFFERENT in the two cases, and exactly why is
 * explained in the comment on `trackedChars`.
 */
function requiredDelta(f: Finding, para: Paragraph): Attempt<number> {
  const line = para.byIndex.get(f.lineInParagraph);
  if (line === undefined) {
    return no(
      "Line not found among the measured lines: a proposal for a line nobody measured " +
        "would be a guess.",
    );
  }
  if (!isMeasurable(line)) {
    return no(
      "Line is not measurable (a rotated frame, or a paragraph with no glyphs at all) \u2014 " +
        "all of its horizontal geometry is invalid.",
    );
  }
  const pointSize = line.pointSize;
  if (pointSize === null || !(pointSize > 0)) {
    return no(
      "Mixed point size within the paragraph: a tracking unit is a fraction of point size, so " +
        "there's nothing to convert it into points with.",
    );
  }
  if (!(line.columnWidth > 0)) {
    return no("Paragraph measure is not positive \u2014 there's nothing to compute the deviation in points from.");
  }

  if (f.defect === "loose" || f.defect === "tight") {
    /*
     * `strength` on the `air-fraction` scale — excess air as a share of the
     * measure (`finding.ts`). Zero there means "air was NOT measured":
     * `detectSpacing` sets it exactly when `airFraction` returned null.
     *
     * A `Finding` CONTRACT DEBT, named here because it can't be fixed from
     * this spot. The fix's MAGNITUDE comes from `strength`, i.e. from
     * `|airFraction|` — a quantity that sums ALL gaps in the line. The SIGN
     * comes from `f.defect`, and `detectSpacing` derives that from
     * `spacingRatio`, i.e. from the MEDIAN space width. The sum and the
     * median can disagree in sign: a line with a few very wide gaps and
     * mostly narrow ones gives a median < 1 ("tight") with a positive air
     * excess. Then the proposal pulls in the wrong direction. `Finding`
     * doesn't carry air's sign (`strength` is non-negative by contract), so
     * there's nothing here to recover it from — that's a fix for the
     * detector layer, not this file. The consequence is bounded: the error
     * never exceeds `maxTracking` units and requires a line with a very
     * skewed gap distribution.
     */
    if (!(f.strength > 0)) {
      return no(
        "Excess inter-word air not measured (the style isn't calibrated, or the line " +
          "has no usable space at all), so there's nothing to compute tracking from.",
      );
    }
    /*
     * A FORCED LINE BREAK — TRACKING HERE CURES THE SYMPTOM, NOT THE DEFECT.
     *
     * Measured (`docs/measured-facts-phase3.md:317-319`): the book's most
     * loosely spaced line (paragraph 6, line 1, ratio 4.11) "ends with a
     * `\n` character — a forced line break. This is a known InDesign trap:
     * a forced break inside a justified paragraph STRETCHES THE PRECEDING
     * LINE TO ITS FULL WIDTH."
     *
     * WHY THIS ISN'T THE SAME AS "the correction is under one tracking
     * unit" — a review correction, and one that matters. The first draft of
     * this comment said "however many letters you don't spread, the air
     * stays put" and equated the rejection with the `rounded < 1` case.
     * **That's an overstatement.** A forced-justified line is justified to
     * the very same fixed measure as any other, and the H&J solver
     * distributes between glyphs and inter-word air the same way regardless
     * of WHY the line got justified. So tracking here does reduce the air —
     * proportionally, as everywhere. `rounded < 1` is a literal no-op; this
     * isn't.
     *
     * THE REAL BASIS FOR THE REJECTION IS DIFFERENT, AND THAT ONE HOLDS:
     * tracking removes the SYMPTOM (visible looseness) while leaving the
     * DEFECT — a line that should never have been justified to the full
     * measure at all. The correct fix is removing the Shift+Enter (or
     * replacing it with a paragraph break), i.e. a text edit this tool
     * doesn't make. A proposal that makes the defect less visible and
     * thereby hides it from the next audit is worse than an honest
     * rejection: next time the line won't be the worst in the book anymore,
     * and the cause will still be sitting there.
     *
     * SETTLED EMPIRICALLY (Task 14, W2) — and the decision goes against the
     * mechanical argument. The question was: does air in a forced-justified
     * line drop under tracking. **It does, and by exactly the same law as an
     * ordinary line.**
     *
     * Measurement on the `__fixture_make_composition` fixture (11 pt size,
     * 240 pt measure, calibration FROZEN at zero tracking, because otherwise
     * tracking also moves the very last lines the natural width is taken
     * from):
     *
     * | Tracking | Forced line (18 non-space) | Ordinary line (42) |
     * |---|---|---|
     * | 0   | 142.134 pt (0.59223 of measure) | 36.658 pt (0.15274) |
     * | +10 | 140.264 pt (0.58443) | 32.148 pt (0.13395) |
     * | +20 | 138.394 pt (0.57664) | 27.638 pt (0.11516) |
     * | +40 | 134.654 pt (0.56106) | 18.618 pt (0.07757) |
     *
     * The drop is LINEAR in both, and in both it equals what this module's
     * formula predicts to within one character: 94.4% = 17/18 for the forced
     * line and 97.6% = 41/42 for the ordinary one. So the effective
     * denominator isn't `chars`, it's `chars − 1`: tracking adds space AFTER
     * every character, and the addition after the line's last glyph pushes
     * nothing anymore. The consequence for `requiredDelta` is a systematic
     * UNDER-correction of 1/chars (2% at the book's 50 characters, 5.6% at
     * 18).
     *
     * WHY THE FORMULA IS STILL LEFT AS-IS — and the PRIOR justification was
     * wrong. The first draft said "the direction is safe, and it shows up in
     * `shortfall`." The second half isn't true: `shortfall` is only filled
     * in when the `maxTracking` limit or the paragraph's shared delta
     * stepped in (see below, `coverage >= 0.999` gives `null`). When neither
     * did, coverage is computed as 1, `shortfall` doesn't exist at all, and
     * the 1/chars shortfall is NOT visible from outside AT ALL — it will
     * only show up as `still-present` at re-measurement. The real, and only,
     * reason to leave the formula alone is different: fixing the denominator
     * is a change in detector behavior, and making it in the same task that
     * first opens a write path into the document would mean shipping two
     * changes in one commit. This is debt, named as such, not a property.
     *
     * SO: the hypothesis "tracking doesn't work here" is DISPROVEN. The
     * rejection below stands purely on the "symptom versus cause" argument —
     * i.e. it's a matter of policy, not mechanics, and it should be
     * challenged as policy. A reviewer who said "such a line is still
     * justified to the same measure, so tracking will reduce the air" is
     * right on the mechanics: at +20 the air drops from 0.59223 to 0.57664
     * of the measure, i.e. by 2.6% of itself. That's the price of the
     * question — tracking doesn't give a noticeable relief here within
     * reasonable limits (closing the deviation completely would take ≈717
     * units), and it hides the defect.
     */
    if (line.text.includes(FORCED_LINE_BREAK)) {
      return no(
        "Line is justified to the full measure by a FORCED LINE BREAK (U+000A), not by lack of space: " +
          "InDesign stretches the line before a Shift+Enter. Tracking would remove the visible " +
          "looseness but leave the actual defect in place \u2014 a line that shouldn't have been justified at all. " +
          "Fixed by removing the forced break, which is a text edit.",
      );
    }
    const chars = trackedNonSpaceChars(line);
    if (chars === 0) return no("The line has no non-space character with advance width at all.");
    /*
     * DENOMINATOR IS `chars − 1`, not `chars`. Phase 3 debt, closed
     * 2026-08-05 in its own commit (which is exactly why it was deferred:
     * fixing the denominator is a change in detector behavior, and shipping
     * it alongside the first write path into the document would have been
     * an unnecessary risk).
     *
     * Basis — the measurement laid out in full in the comment above: the
     * drop in air from tracking is linear and matches what this formula
     * predicts to within exactly one character — 94.4% = 17/18 for a forced
     * line (18 non-space) and 97.6% = 41/42 for an ordinary one (42). With
     * the old denominator, `requiredDelta` systematically UNDER-shot by
     * 1/chars: 2% at 50 characters, 5.6% at 18. None of that was visible
     * from outside — `shortfall` is only filled in when the `maxTracking`
     * limit stepped in, and without that coverage was computed as 1.
     *
     * One character on a line means zero gaps, tracking physically affects
     * nothing: an honest rejection instead of division by zero.
     */
    if (chars === 1) {
      return no("The line has one character with advance width \u2014 there's nowhere for tracking to apply.");
    }
    const points = f.strength * line.columnWidth;
    /*
     * Zero strength here means exactly one thing: the detector couldn't name
     * a value to measure the fix by. Two cases, both from
     * `detect-spacing.ts`: `airFraction` wasn't measured at all, or the
     * line's spaces are INCONSISTENT and the median and the sum disagree
     * (strength is deliberately withdrawn, details in the finding's
     * `detail`). A zero delta would be a "do nothing" proposal presented as a
     * fix; it's more honest to say there's nothing to measure by.
     */
    if (!(points > 0)) {
      return no(
        "Deviation magnitude not measured (strength 0): either the natural space width isn't " +
          "calibrated for this style, or the line's spaces are non-uniform and the measured values " +
          "contradict each other. Tracking can't address this.",
      );
    }
    const sign = f.defect === "loose" ? 1 : -1;
    return { ok: true, value: sign * deltaForPoints(points, chars - 1, pointSize) };
  }

  /* `widow` and `short-last-line`: `measured` is how much of the measure
   * this line fills (`detect-lines.ts`). Exactly its width needs to be
   * removed, and it's taken from ALL characters of the paragraph — SPACES
   * INCLUDED, unlike the branch above. Why the denominators differ is
   * explained in the comment on `trackedChars`. */
  if (f.defect === "widow" || f.defect === "short-last-line") {
    const n = line.paragraphLineCount;
    let chars = 0;
    for (let i = 0; i < n; i++) {
      const l = para.byIndex.get(i);
      if (l === undefined) {
        return no(
          `Paragraph not fully measured: out of ${n} lines the sample is missing line ${i}. ` +
            "Tracking's denominator would come out too low, and the tracking itself too large.",
        );
      }
      chars += trackedChars(l);
    }
    if (chars === 0) return no("The paragraph has no character with advance width at all.");
    const points = f.measured * line.columnWidth;
    if (!(points > 0)) {
      return no("Line fill is not positive \u2014 there's nothing to pull into the previous line.");
    }
    /*
     * THE DENOMINATOR STAYS `chars` HERE, and that's not an oversight, it's
     * the limit of what's measured.
     *
     * The `chars − 1` fix above rests on the measurement of ONE line: there
     * the gaps are exactly one fewer than the characters. A paragraph of `n`
     * lines is a different case: the last character of EVERY line pushes
     * nothing, so the effective denominator is closer to `chars − n`, not
     * `chars − 1`. But that's reasoning, not a measurement: nobody has run
     * anything that would give the same precise ratio here as 17/18 and
     * 41/42 did for a line. And the lines themselves recompose after
     * tracking, so `n` changes during the fix.
     *
     * Carrying over what was measured for a different case would mean
     * substituting an analogy for a measurement. The error stays on the safe
     * side (under-correction), and that's stated, not hidden.
     */
    return { ok: true, value: -deltaForPoints(points, chars, pointSize) };
  }

  return no(`Defect class "${f.defect}" is not fixed by tracking.`);
}

/** The paragraph's shared delta, or the reason there isn't one. `null` — tracking wasn't requested here. */
function paragraphDelta(required: readonly number[], max: number): Attempt<number> | null {
  if (required.length === 0) return null;
  const positive = required.some((d) => d > 0);
  const negative = required.some((d) => d < 0);
  if (positive && negative) {
    return no(
      "This paragraph needs tracking in opposite directions (it has both tight and loose " +
        "lines). One value per paragraph can't fix both \u2014 the paragraph needs recomposing.",
    );
  }
  const sign = positive ? 1 : -1;
  /* The most cautious of what's needed, not the largest: better to
   * under-correct and repeat than to over-tighten the paragraph and ruin
   * neighboring lines. Whoever needs more sees it as a number in
   * `shortfall`. */
  const magnitude = Math.min(...required.map(Math.abs));
  const rounded = Math.round(magnitude);
  if (rounded < 1) {
    return no(
      "Required correction is smaller than one tracking unit (1/1000 em) \u2014 nothing to write.",
    );
  }
  return { ok: true, value: sign * Math.min(rounded, max) };
}

/** Percentage for the explanation text. */
function pct(x: number): string {
  return `${(x * 100).toFixed(0)}%`;
}

function signed(d: number): string {
  return d > 0 ? `+${d}` : String(d);
}

/**
 * A shortfall caveat, PASTED INTO THE DESCRIPTION ITSELF.
 *
 * Until now it lived only in the `shortfall` field, and a reader of the
 * description got an unconditional promise that the neighboring field then
 * contradicts. This is the same kind of falsehood the module already refuses
 * in the mirror case ("a correction under one tracking unit — nothing worth
 * writing"): a write that passes itself off as a fix. The only difference is
 * that there the proposal doesn't exist at all, while here it does and
 * covers, say, 12%.
 *
 * There is NO named threshold below which the proposal should be dropped,
 * and there can't be — nobody has measured one, and a made-up number would
 * cost exactly what Task 8 refused to pay. So the proposal stays, but tells
 * the truth about itself.
 */
function shortfallNote(s: Shortfall): string {
  return (
    ` NOTE: THIS WON'T BE ENOUGH — fully closing the deviation would take ${signed(s.requiredDelta)}, ` +
    `so the proposal covers about ${pct(s.coverage)}. The defect will most likely remain, ` +
    "and the re-measurement will correctly show still-present, not a failure."
  );
}

function describe(f: Finding, delta: number | null, word: string | null): string {
  switch (f.defect) {
    case "loose":
      return (
        `Spread the paragraph's letters with tracking ${delta === null ? "(value not computed)" : signed(delta)} ` +
        `(1/1000 em): the line carries ${pct(f.strength)} of the measure in excess inter-word air, and the width ` +
        "of the letters absorbs it, while the spaces shrink back toward their natural width."
      );
    case "tight":
      return (
        `Tighten the paragraph's letters with tracking ${delta === null ? "(value not computed)" : signed(delta)} ` +
        `(1/1000 em): the line is missing ${pct(f.strength)} of the measure for the spaces to return to ` +
        "their natural width."
      );
    case "widow":
      return (
        `Tighten the paragraph with tracking ${delta === null ? "(value not computed)" : signed(delta)} ` +
        `(1/1000 em), so the last line (${pct(f.measured)} of the measure) pulls into the previous frame ` +
        "instead of being left alone at the top of the column."
      );
    case "short-last-line":
      return (
        `Tighten the paragraph with tracking ${delta === null ? "(value not computed)" : signed(delta)} ` +
        `(1/1000 em), so the short final line (${pct(f.measured)} of the measure) pulls into ` +
        "the previous one. Beyond that it's an editorial decision \u2014 the tool doesn't rewrite the author's text."
      );
    case "orphan":
      return (
        "The paragraph's first line is left alone at the bottom of the column. Tracking of THIS paragraph almost certainly " +
        "won't move it: the line is held by the frame's seam, not by the paragraph's length, so a shorter paragraph leaves " +
        "the first line right where it was. There is exactly one exception, already covered by a different finding: a TWO-LINE " +
        "paragraph, tightened down to one line, stops being an orphan \u2014 but that same paragraph then produces " +
        "a widow, and tracking is proposed there instead (see alsoInParagraph). The general case " +
        "is fixed with InDesign's Keep Options ('keep with next N lines') or by editing " +
        "the preceding text; the measurement carries neither."
      );
    case "hyphen-across-spread":
      return (
        `Insert a soft hyphen (U+00AD) before the word "${word ?? "?"}": InDesign stops ` +
        "hyphenating that word at all, so the break at the page boundary disappears. The author's words are " +
        "not changed. Cost: a word that no longer breaks either carries whole onto the next page, " +
        "or leaves the previous line noticeably loose \u2014 and in a tight frame it can even " +
        "push the tail of the text into overset. The re-measurement will show it."
      );
    case "hyphen-forbidden":
      return (
        `Insert a soft hyphen (U+00AD) before the word "${word ?? "?"}", which the exceptions list ` +
        "forbids hyphenating: the mark disables hyphenation for the whole word. The author's words are not changed. " +
        "Cost is the same: an unbreakable word can leave the previous line loose."
      );
    case "hyphen-ladder":
      return (
        `Remove one of the ${f.measured} hyphens by hand, or rewrite the phrase. Which one — the measurement ` +
        "doesn't say: the finding's strength measures the LENGTH of the run, not which line is at fault, so " +
        "there's no automatic choice here."
      );
    case "river":
      return (
        "A river is removed by recomposing the paragraph: different hyphenation, different tracking, different " +
        "wording. There's no single automatic fix, and in a non-justified paragraph " +
        "the inter-word spaces don't move at all."
      );
    case "line-start-dash":
      return (
        `Replace the space before the dash with a non-breaking one (U+00A0): the dash will no longer be able to start ` +
        `a line and will stay with ${word === null ? "the previous line" : `the word "${word}"`}. ` +
        "The author's words are not changed. Cost: the non-breaking space does NOT pull the dash up \u2014 it " +
        "makes the pair 'word + dash' unbreakable. If the pair doesn't fit on the previous line, " +
        "the word slides down together with the dash, and the previous line is left noticeably " +
        "loose. The re-measurement will show this as displaced."
      );
  }
}

/**
 * A proposed fix for every finding — one to one, in THE SAME order. Writes
 * nothing and ranks nothing.
 *
 * `lines` is the very same sample the detectors worked on. It isn't decor
 * here: the geometry tracking is computed from comes from it, and the
 * paragraph stitched together for addressing an invisible character comes
 * from it too. A finding whose line isn't in the sample gets no write at all
 * — see `blocked`.
 */
export function proposeFixes(
  findings: readonly Finding[],
  lines: readonly LineMeasure[],
  opts: ProposeOptions = {},
): Proposal[] {
  const max = opts.maxTracking ?? DEFAULT_MAX_TRACKING;
  if (!Number.isFinite(max) || max <= 0) {
    throw new Error(
      `proposeFixes: maxTracking must be a positive number, got ${max}. ` +
        "A zero or negative limit would mean a proposal that changes nothing but presents " +
        `itself as a fix. Default is ${DEFAULT_MAX_TRACKING} (a convention, not a measurement).`,
    );
  }

  const paragraphs = indexParagraphs(findings, lines);

  /* Pass 1: what each finding needs on its own. */
  const attempts = new Map<string, Attempt<number>>();
  for (const f of findings) {
    if (FIX_KIND[f.defect] !== "tracking") continue;
    const para = paragraphs.get(paragraphKey(f.containerId, f.paragraphIndex))!;
    attempts.set(f.id, requiredDelta(f, para));
  }

  /* Pass 2: one delta per paragraph — otherwise `apply_edits` would add it twice. */
  const shared = new Map<string, Attempt<number>>();
  for (const [key, para] of paragraphs) {
    const wanted: number[] = [];
    for (const id of para.findingIds) {
      const a = attempts.get(id);
      if (a !== undefined && a.ok) wanted.push(a.value);
    }
    const d = paragraphDelta(wanted, max);
    if (d !== null) shared.set(key, d);
  }

  /* Pass 3: proposals in the findings' order. */
  return findings.map((f): Proposal => {
    const key = paragraphKey(f.containerId, f.paragraphIndex);
    const para = paragraphs.get(key)!;
    const kind = FIX_KIND[f.defect];
    const base = {
      findingId: f.id,
      defect: f.defect,
      kind,
      scope: { containerId: f.containerId, paragraphIndex: f.paragraphIndex, page: f.page },
      before: { measured: f.measured, strength: f.strength },
      alsoInParagraph: para.findingIds.filter((id) => id !== f.id),
    };

    if (kind === "tracking") {
      const own = attempts.get(f.id)!;
      const group = shared.get(key);
      if (!own.ok) {
        return { ...base, description: describe(f, null, null), blocked: own.blocked };
      }
      if (group === undefined || !group.ok) {
        return {
          ...base,
          description: describe(f, null, null),
          blocked: group === undefined ? "Paragraph's shared delta wasn't computed." : group.blocked,
        };
      }
      const delta = group.value;
      const coverage = Math.min(1, Math.abs(delta) / Math.abs(own.value));
      const shortfall: Shortfall | null =
        coverage >= 0.999
          ? null
          : {
              requiredDelta: Number(own.value.toFixed(1)),
              appliedDelta: delta,
              coverage: Number(coverage.toFixed(4)),
            };
      return {
        ...base,
        /* The shortfall goes INTO THE DESCRIPTION, not just into a field next
         * to it: otherwise the operator reads an unconditional promise that
         * the neighboring field then contradicts. */
        description: describe(f, delta, null) + (shortfall === null ? "" : shortfallNote(shortfall)),
        tracking: { containerId: f.containerId, paragraphIndex: f.paragraphIndex, delta },
        ...(shortfall === null ? {} : { shortfall }),
      };
    }

    if (kind === "invisible") {
      /* The "invisible character" kind is no longer a synonym for a soft
       * hyphen: two hyphenation classes put a U+00AD before the word, while
       * `line-start-dash` replaces the space with a U+00A0. The branch is by
       * defect CLASS, because `FIX_KIND` remains the one place the class is
       * mapped to a kind. */
      if (f.defect === "line-start-dash") {
        const found = locateDashSpace(f, para, opts.containers);
        if (!found.ok) {
          /* The word for the explanation is taken from the PREVIOUS line's text
           * if it exists: the operator needs to see what's being talked
           * about even when there's no address. */
          const prev = para.byIndex.get(f.lineInParagraph - 1);
          const word = prev === undefined ? "" : precedingWord(prev.text);
          return {
            ...base,
            description: describe(f, null, word.length > 0 ? word : null),
            blocked: found.blocked,
          };
        }
        return {
          ...base,
          /* Symmetric to the `blocked` branch above: an empty word (a line ending
           * on a punctuation mark, e.g. "said "go" ") is normalized to
           * `null`, otherwise `word ?? "?"` in `describe` won't catch it —
           * `??` only looks at `null`/`undefined`, and an empty string slips
           * past it. */
          description: describe(
            f,
            null,
            found.value.word.length > 0 ? found.value.word : null,
          ),
          edit: {
            requestId: f.id,
            candidateId: `${f.id}#0`,
            containerId: f.containerId,
            start: found.value.start,
            end: found.value.start + 1,
            expectedOld: SPACE,
            newText: NBSP,
            action: "replace",
          },
        };
      }

      const found = locateWord(f, para, opts.containers);
      /* The word for the explanation is taken from the finding's text even
       * when the fix couldn't be addressed: the operator needs to see which
       * word is meant. */
      const word = found.ok ? found.value.word : wordTail(f.lineText);
      if (!found.ok) {
        return {
          ...base,
          description: describe(f, null, word.length > 0 ? word : null),
          blocked: found.blocked,
        };
      }
      return {
        ...base,
        description: describe(f, null, word),
        edit: {
          /* requestId IS the finding's identifier: `ApplyReport.applied` carries
           * exactly it, so Task 14's re-measurement keeps the same address,
           * and no second key system appears. */
          requestId: f.id,
          candidateId: `${f.id}#0`,
          containerId: f.containerId,
          start: found.value.start,
          end: found.value.end,
          expectedOld: found.value.word,
          newText: SOFT_HYPHEN + found.value.word,
          action: "replace",
        },
      };
    }

    /* `manual` — the absence of a write here is the definition itself, so there's no `blocked`. */
    return { ...base, description: describe(f, null, null) };
  });
}

/**
 * The `character` family: local character formatting. Pure TypeScript —
 * does not talk to InDesign.
 *
 * The family exists because probe `H5` found material: hundreds of ranges with
 * a real deviation from the paragraph reference, plus 2 unused character
 * styles out of 7 declared.
 *
 * THE REAL NUMBER IS MEASURED (Task 10, `docs/measured-facts-phase5.md`,
 * "Run of the finished tool"): on the working book (198 pages) this
 * detector gave `rangesDeviating = 744` out of `rangesAudited = 3480`. This is NOT
 * the same number as the 449 from probe `H5` (`docs/measured-facts-phase5.md`, Question
 * 2) — the probe counted among 3137 BARE ranges (`characterStyle ===
 * "[None]"`), while `detectCharacter` walks ALL 3480 regardless of the
 * character style (see "SCALE LIVES UNDER CHARACTER STYLES" below) and
 * additionally excludes parent spreads. Two different populations — 744 and
 * 449 are not the same number from two measurements, but measurements of TWO DIFFERENT
 * things; substituting one for the other is not allowed.
 *
 * THE REFERENCE IS THE PARAGRAPH STYLE, NOT THE CHARACTER STYLE, AND THIS IS A MEASUREMENT, NOT A TASTE.
 * Probe `H5` showed that of the book's 5 used character styles, only ONE has a full
 * set of declared values, and `[None]` has none at all (`NOTHING` on all numeric
 * fields, `""` on `appliedFont`). "Deviation from the declared character style" as
 * a mechanism simply does not exist for this document — the only thing there is
 * to compare against is the paragraph style of the paragraph the range belongs to, and THIS IS EQUALLY TRUE
 * for a "bare" range and for a range under a character style: the latter
 * does not get a separate reference, it is measured against the same paragraph one.
 *
 * SCALE LIVES UNDER CHARACTER STYLES. Probe `H5`: 131 of 164 RANGES
 * with `scale != 100` lie EXACTLY under a character style. That is why this detector
 * walks ALL ranges of the document, regardless of `characterStyle` —
 * a "bare ranges only" filter would have seen 32 cases out of 164, i.e.
 * it would have missed the biggest cluster.
 */

import type { ParagraphMeasure } from "../layout/types.js";
import {
  UNUSED_STYLE_CAVEAT_KEY,
  type CharacterStyleCarrier,
  type RangeMeasure,
  type StylesMeasure,
  type StyleFinding,
} from "./types.js";

/** Range properties it makes sense to check against the paragraph reference. */
type RangeProperty = "pointSize" | "appliedFont" | "fontStyle" | "tracking" | "horizontalScale";

const RANGE_PROPERTIES: readonly RangeProperty[] = [
  "pointSize",
  "appliedFont",
  "fontStyle",
  "tracking",
  "horizontalScale",
];

/**
 * The `horizontalScale` reference is the LITERAL 100, not the style's declared value.
 *
 * Spelled out here explicitly, not silently: `horizontalScale` is NOT among the
 * fields of `StyleValues`/`declaredStyleValues` at all (the same limit already
 * documented for `ScaleMeasure` in `types.ts`), so there is simply nothing to
 * compare the range against a declared style value — all that's left is the
 * "unscaled" constant.
 */
const HORIZONTAL_SCALE_BASELINE = 100;

/**
 * The reference value of the property for the paragraph the range belongs to.
 *
 * `horizontalScale` is the sole exception: it is not part of `StyleValues`, so
 * for it the reference is `HORIZONTAL_SCALE_BASELINE`, not a read from the paragraph.
 */
function baselineFor(property: RangeProperty, para: ParagraphMeasure): number | string | null {
  if (property === "horizontalScale") return HORIZONTAL_SCALE_BASELINE;
  return para.declared[property];
}

/**
 * Finding text. The range's character style is mentioned only if it is
 * actually applied — `[None]` here is not information but noise.
 */
function buildDetail(
  range: RangeMeasure,
  property: RangeProperty,
  declared: number | string,
  actual: number | string,
): string {
  const styleNote = range.characterStyle === "[None]" ? "" : ` (character style "${range.characterStyle}")`;
  return (
    `Range ${range.rangeIndex} of the paragraph${styleNote}: ${property} = ${String(actual)}, ` +
    `the paragraph declares ${String(declared)}.`
  );
}

export interface CharacterResult {
  findings: StyleFinding[];
  /** How many `character-override` findings each property produced. */
  byProperty: Record<string, number>;
  /**
   * How many DIFFERENT ranges (not (range, property) pairs) have
   * AT LEAST ONE deviation from the paragraph reference.
   *
   * SINGLE SOURCE OF TRUTH (`styles_audit` review, round 3, Important 1):
   * previously the consumer tool (`src/tools/styles.ts`) counted this number
   * ITSELF, in a separate function that duplicated the property list and the
   * `horizontalScale` reference byte for byte. The duplication was not a safe
   * observation — it had already managed to mask an undercount: a test that
   * removed `tracking`/`horizontalScale` from the local copy of the list
   * would have passed green, because the guard "the sum of `byProperty` is never
   * less than `rangesDeviating`" only catches OVERCOUNTING, not UNDERCOUNTING. Counting here, in
   * the same loop as the detector itself, is the only way that cannot
   * diverge from `findings`/`byProperty` by construction.
   *
   * The dedup key is THREE fields: `containerId` + `paragraphIndex` +
   * `rangeIndex`. Two (without `rangeIndex`) are not enough: 485 of the
   * book's 2982 paragraphs have more than one range (`docs/measured-facts-
   * phase5.md`), and two DIFFERENT deviating ranges of one paragraph would give
   * the same `containerId#paragraphIndex` key, merging in the
   * count just as incorrectly as the old "by (range,
   * property)" count inflated them.
   *
   * Parent paragraphs (`para.isMaster`) are excluded — the same policy as
   * `paragraphsAudited`/`usage.defaultStyleApplied`/`scale.ratioMatches`,
   * carried through to this family as well.
   */
  rangesDeviating: number;
  /**
   * How many ranges ACTUALLY entered the check — the denominator of the ratio.
   *
   * I-3 of the final review, and this is the SAME defect that Task 6 already
   * closed with the `paragraphsAudited` field in `report.ts`, just via a third path.
   * `measure.ranges.length` (`characterBlock.rangesTotal` in the tool)
   * counts ALL ranges of the document, including those that sit on
   * parent spreads, and those whose paragraph was not found in the measurement;
   * `rangesDeviating` excludes both. An operator who divides one by
   * the other — and the block itself invites exactly that, placing both numbers side by side —
   * gets an UNDERSTATED ratio, understated more the more
   * parent spreads the document has.
   *
   * Counted in the same loop as `findings`/`byProperty`/
   * `rangesDeviating` — for the same reason named at
   * `rangesDeviating`: a separate count on the consumer side already
   * diverged from the detector once.
   */
  rangesAudited: number;
  /**
   * Character styles that are not in the text, but that SIT on a carrier outside
   * it: a list marker, numbering, a nested or GREP style, a
   * cross-reference block, a page number in a TOC style.
   *
   * THIS IS INVENTORY, NOT A FINDING. Such a style is applied — just not to the
   * text, and there is no defect in that whatsoever. But it must be visible to
   * the operator who just read "N unused styles": otherwise the style's
   * disappearance from that list would look like a tool bug.
   */
  stylesOnlyReferenced: {
    name: string;
    styleId: string;
    referencedBy: CharacterStyleCarrier[];
  }[];
}

/**
 * Local character formatting: ranges against the paragraph reference plus
 * unused character styles.
 *
 * `null` on EITHER side of the comparison (reference unavailable, range value
 * did not read) is not a deviation but "not compared" (spec §3); there is no
 * finding here.
 */
export function detectCharacter(measure: StylesMeasure): CharacterResult {
  const findings: StyleFinding[] = [];
  const byProperty: Record<string, number> = {};
  const stylesOnlyReferenced: CharacterResult["stylesOnlyReferenced"] = [];
  /* Deduplication of `rangesDeviating` by THREE fields — see the docstring of
   * `CharacterResult.rangesDeviating`. */
  const deviatingRangeKeys = new Set<string>();
  /* The denominator of the ratio — see the docstring of `CharacterResult.rangesAudited`. */
  let rangesAudited = 0;

  /* The key is the same one that addresses the paragraph: containerId + paragraphIndex. */
  const paragraphByKey = new Map<string, ParagraphMeasure>();
  for (const p of measure.paragraphs) {
    paragraphByKey.set(`${p.containerId}#${p.paragraphIndex}`, p);
  }

  for (const range of measure.ranges) {
    const para = paragraphByKey.get(`${range.containerId}#${range.paragraphIndex}`);
    /* The paragraph the range belongs to was not found in the measurement — there is
     * nothing to compare against, and this is "not compared", not a finding. */
    if (!para) continue;
    /* Parent paragraphs are outside the check (`styles_audit` review, round 3,
     * minor item 6) — the same policy already in effect for `usage`/`scale`. */
    if (para.isMaster) continue;

    /* The range reached the comparison — it is counted in the denominator REGARDLESS of
     * whether it produces a finding. The increment sits AFTER both `continue`
     * above and BEFORE the property loop: exactly the subset on which
     * `rangesDeviating` makes sense as a numerator. */
    rangesAudited += 1;

    for (const property of RANGE_PROPERTIES) {
      const declared = baselineFor(property, para);
      const actual = range[property];

      if (declared === null || actual === null) continue;
      /*
       * A direct `===`, NOT `differs()`/`EPSILON_PT` from `overrides.ts` (review of
       * Task 13, round 1, minor item 2). Today this is identical: `EPSILON_PT`
       * there equals 0, and an exact `===` is exactly a comparison with a tolerance of 0. But
       * if `EPSILON_PT` ever becomes nonzero (a document where measured
       * noise requires a tolerance), this family will silently diverge from `overrides.ts`
       * — the values here have not gone through the same tolerance calibration
       * described at `EPSILON_PT`.
       */
      if (declared === actual) continue;

      byProperty[property] = (byProperty[property] ?? 0) + 1;
      deviatingRangeKeys.add(`${range.containerId}#${range.paragraphIndex}#${range.rangeIndex}`);
      findings.push({
        family: "character",
        defect: "character-override",
        styleName: para.styleName,
        /*
         * .id of the PARAGRAPH style, not the character style. The reference for character-override is
         * the PARAGRAPH style (see the comment at the top of the file: a range's character style
         * mostly does not have its own full set of declared values),
         * so the style address here is the same one that addresses the paragraph.
         */
        styleId: para.styleId,
        page: para.page,
        containerId: range.containerId,
        paragraphIndex: range.paragraphIndex,
        detail: buildDetail(range, property, declared, actual),
      });
    }
  }

  for (const cs of measure.characterStyles) {
    /* `[None]` is not a real style but a sentinel for "no character style".
     * It ends up in `characterStyles` the same way `[No Paragraph Style]`
     * ends up in the list of paragraph styles (`styles.jsx` enumerates without
     * a filter), and that is exactly why the exception is here, not on the measurement side. */
    if (cs.name === "[None]") continue;
    if (cs.appliedRuns > 0) continue;

    /*
     * ZERO RANGES IS NOT YET UNUSED. The style may stand as a list
     * marker, numbering, a nested or GREP style, a cross-reference
     * block, a page number in the TOC — `textStyleRanges` sees none of these
     * places. Deleting such a style silently changes the
     * appearance of every paragraph that relies on it: the same breed as
     * `style-unused` before the split into leaf and base (`dependants.ts`), and the same
     * consequence — advice after which the layout breaks.
     *
     * The field may be absent (an older-format measurement, a hand-built
     * `StylesMeasure` in a test) — then it is read as "no carriers", i.e.
     * the behavior does not change.
     */
    const carriers = cs.referencedBy ?? [];
    if (carriers.length > 0) {
      stylesOnlyReferenced.push({ name: cs.name, styleId: cs.id, referencedBy: carriers });
      continue;
    }

    /* This finding has no address — the same reason as in `style-unused`
     * of the `usage` family: an unused style does not belong to any specific
     * paragraph or range. */
    findings.push({
      family: "character",
      defect: "character-style-unused",
      styleName: cs.name,
      /* Here, conversely, styleId is the id of the character style ITSELF: a finding about
       * the style itself being unused, it does not concern any paragraph. */
      styleId: cs.id,
      page: null,
      containerId: null,
      paragraphIndex: null,
      /* Short caveat + a key to the full text — the same reason as
       * in `inventory.ts`: the full text in every finding gave 85% of the whole
       * response increase (measured). The prohibition and where to look
       * stay here; the explanation of the mechanism — once in the response. */
      detail:
        `Character style "${cs.name}" is declared but not applied to any range of ` +
        `body text. Don't delete without checking tables and footnotes — ` +
        `${UNUSED_STYLE_CAVEAT_KEY}.`,
    });
  }

  return {
    findings,
    byProperty,
    rangesDeviating: deviatingRangeKeys.size,
    rangesAudited,
    stylesOnlyReferenced,
  };
}

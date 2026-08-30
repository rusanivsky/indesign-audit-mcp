/** One line character, with its left-edge coordinate in points. */
export interface CharMeasure {
  x: number;
  /**
   * The character itself. `null` — a control character: `\r`, U+000A, U+2028, U+2029.
   *
   * WARNING: `null` means "no printable glyph", NOT "no text". The corresponding
   * position in `LineMeasure.text` holds the real character — that's where to
   * look when you need the text, not the glyphs.
   */
  ch: string | null;
}

/**
 * One composed line.
 *
 * MEASURABILITY RULE (the only one; don't derive your own):
 * a line is measurable only when `!rotated` AND it has at least one `ch !== null`.
 *
 * Both conditions are needed, and each screens out its own class of traps,
 * measured on the book:
 * - `rotated` — 111 lines (2.1%) in frames rotated ±90°: zero width,
 *   a meaningless measure;
 * - "not a single glyph" — 484 lines (9.3%) of empty paragraphs: the FULL
 *   `columnWidth` at a width of 2.3–7.6 pt and NO flag that would point to them.
 *   They're marked neither `rotated` nor `isMaster` — only by this rule.
 *
 * Together that's 595 lines out of 5,193 (11.5%) that can't be put into any
 * denominator.
 */
export interface LineMeasure {
  containerId: string;
  page: string;
  /**
   * Номер розвороту, у якому лежить сторінка рядка; `-1` — не прочитався.
   *
   * Потрібен рівно одному правилу — `hyphen-across-spread`, — і саме тому, що
   * з `page` розворот вивести НЕ МОЖНА: це рядок, а на майстрах узагалі назва
   * майстра («B», «E»). Береться з InDesign (`page.parent.index`), а не
   * виводиться з парності номера.
   */
  spreadIndex: number;
  /** Paragraph index within the container — an address for tracking. */
  paragraphIndex: number;
  /** Line index within the paragraph, 0-based. */
  lineInParagraph: number;
  paragraphLineCount: number;
  /** Left line boundary, points. */
  left: number;
  /**
   * Right line boundary, points — `line.endHorizontalOffset`.
   *
   * WARNING, two measured traps:
   *
   * 1. THE HYPHEN GLYPH IS NOT INCLUDED HERE. When `endsWithHyphen`, the hyphen
   *    drawn by the composer sits to the RIGHT of `right`: 100 justified lines
   *    with a hyphen fall short of `columnWidth` by exactly 3.9099–3.9100 pt
   *    (11.5 pt size), while 1,403 justified lines without a hyphen hit it
   *    with ±0.001 pt precision. Whoever compares `right` to `columnWidth`
   *    without accounting for `endsWithHyphen` will read 6.7% of justified
   *    lines as "loose" by ~3.9 pt.
   * 2. A TRAILING SPACE IS INCLUDED HERE and legitimately hangs past the measure.
   *    That's exactly why 13 lines in the book "exceed" `columnWidth`
   *    (by up to 4.599 pt) — all 13 end with a space. Width must be checked
   *    against the right edge of the last NON-space glyph, not against `right`.
   */
  right: number;
  baseline: number;
  /**
   * Effective paragraph measure in points: frame width minus frame insets,
   * column gap, and paragraph indents; for the FIRST line of a paragraph,
   * `firstLineIndent` is also subtracted (17.5% of the book's lines are
   * exactly this).
   */
  columnWidth: number;
  styleName: string;
  /** `null` — mixed point size within the paragraph (InDesign returns NothingEnum). */
  pointSize: number | null;
  /**
   * The style's justification bounds in percent, as InDesign returns them:
   * 80 / 100 / 133.
   * `null` — a mixed value within the paragraph.
   */
  spacing: { min: number | null; desired: number | null; max: number | null };
  /**
   * The paragraph's justification as a string, e.g. "LEFT_ALIGN" or "LEFT_JUSTIFIED".
   *
   * Measured (docs/measured-facts-phase3.md): in non-justified paragraphs every
   * line trivially gives exactly a 1.000 space-width ratio and can never be
   * flagged. Without this field, detectors keep 50.2% of the book's lines
   * (2,608 of 5,193) in the denominator and understate the true share of
   * findings.
   */
  justification: string;
  /**
   * The line's text as `line.contents` returns it — with the REAL characters,
   * including the apostrophe U+2019, the dash U+2014, the non-breaking space
   * U+00A0, the ellipsis U+2026, and control characters in their places.
   * Length always equals `chars.length`.
   */
  text: string;
  chars: CharMeasure[];
  /**
   * The line ends with a hyphen: a literal hyphen, a soft hyphen, OR
   * (the main case) a word broken by the composer — the line's last character
   * and the next line's first character are both letters. InDesign's automatic
   * hyphenation is not a text character, so otherwise it wouldn't be visible
   * at all.
   *
   * MUST be accounted for in any comparison of `right` with `columnWidth`:
   * the drawn hyphen glyph is NOT included in `right`, so a hyphenated line
   * falls short of the measure by exactly ~3.91 pt (11.5 pt size) even while
   * being fully justified. See the comment on `right` for details.
   */
  endsWithHyphen: boolean;
  /** First or last line of its frame — needed for widow/orphan checks. */
  isFirstInFrame: boolean;
  isLastInFrame: boolean;
  /**
   * The line's frame is rotated (in this book — running heads and folios, ±90°).
   *
   * CRITICAL: when `rotated === true`, ALL of the line's horizontal geometry
   * is invalid — `left === right`, every `chars[].x` is the same, and
   * `columnWidth` was computed from an axis-aligned frame bounds and has no
   * bearing on the text. Such lines must be EXCLUDED from composition
   * analysis, not "corrected".
   */
  rotated: boolean;
  /** The frame's rotation angle in degrees; `rotated` is just `!== 0`. */
  rotationAngle: number;
  /** The line sits on a master page (running head, folio). */
  isMaster: boolean;
}

/**
 * Calibration of the natural space width, spec §4.2. The key everywhere is
 * `styleKey()`.
 *
 * Lives here, not in `calibrate.ts`: the type belongs to the block's shared
 * dictionary, Tasks 8–11 read it, and two separate declarations would
 * inevitably drift apart.
 */
export interface Calibration {
  /** Natural space width in points for a (style, size) pair. */
  natural: Map<string, number>;
  /** How many samples fell into the median after the ε-filter. */
  samples: Map<string, number>;
  /**
   * The fraction of samples within ±1% of the median — a stability metric.
   *
   * A fraction, and NOT the p05–p95 spread: on the book, outliers are 3.83%
   * at a p05 break point of 5%, meaning the percentile shape breaks from a
   * few extra bad samples and starts reporting "clean", while the fraction
   * simply shows 94%.
   */
  stability: Map<string, number>;
  /**
   * Pairs for which there weren't enough samples — lines of these styles are
   * NOT measured and don't make it into "clean". Pairs with a mixed point size
   * (`pointSize === null`) go here too: there's nothing to anchor their space
   * width to.
   *
   * Lines that aren't measurable (`isMeasurable`) never appear here at all —
   * they're outside composition analysis, not "unmeasured".
   */
  uncalibrated: string[];
}

/**
 * The composition defect class. The shared dictionary of Tasks 8–11:
 * detectors live in different files, but their report is one, so the list
 * must be one too.
 */
export type DefectClass =
  | "tight"
  | "loose"
  | "widow"
  | "orphan"
  | "short-last-line"
  | "hyphen-ladder"
  | "hyphen-across-spread"
  /** A word from the exclusion list was broken by hyphenation — the caller supplies the list. */
  | "hyphen-forbidden"
  | "river"
  /**
   * A dash mid-sentence became the first character of a line. Cured with a
   * non-breaking space before it; the exception is the start of a paragraph,
   * a line of dialogue, or a sentence.
   */
  | "line-start-dash";

/**
 * A finding's weight — exactly four DIFFERENT statements about the declared
 * standard:
 *
 * - `error` — the rule is violated: the line is past the declared bound;
 * - `warning` — the line is still within bounds, but already in the warning
 *   band (the band is supplied by the caller; without it this weight never
 *   occurs);
 * - `info` — the line was MEASURED and is within bounds, and both style
 *   bounds are known. This is an affirmative "standard held", not "nothing
 *   happened";
 * - `unrated` — no verdict, because the style bounds weren't measured
 *   (a mixed value in the paragraph, and `spacing.min`/`.max` are nullable
 *   INDEPENDENTLY, so it can be half-and-half too).
 *
 * `unrated` exists exactly because without it a line with unmeasured bounds
 * would get `warning` and be indistinguishable from one that was measured
 * and clean — the same "null = clean" substitution the module guards against
 * everywhere else.
 *
 * WARNING: weight is NOT a severity measure for sorting. At a measured
 * baseline share of 59.14% (docs/measured-facts-phase3.md), "bound violated"
 * by itself filters out almost nothing; ranking must be by the strength of
 * the deviation — see `Finding.strength`.
 *
 * INVENTORY AFTER FIVE DETECTORS (Task 11's decision, which the previous
 * three left open). Weight is VARIABLE in exactly two of ten classes —
 * `tight` and `loose` — and only where the standard is declared by the
 * DOCUMENT ITSELF. For the remaining eight classes no document declares
 * anything (`LineMeasure` carries neither `hyphenateLadderLimit`, nor Keep
 * Options, nor anything about corridors), and they always get `error`. The
 * field is kept because in `detectSpacing(…, { mode: "rank" })` mode it is
 * the ONLY signal for "line past the declared bound" — without it the report
 * layer would have to keep every `LineMeasure` together with `Calibration`
 * and recompute the bounds from scratch. The claim is checked by a test via
 * `SEVERITY_VARYING_CLASSES` in `detect.ts`; that's also where the condition
 * for retiring this field is named.
 */
export type Severity = "error" | "warning" | "info" | "unrated";

/**
 * One detector finding.
 *
 * `measured` is ALWAYS a number, and that's exactly why a line nobody
 * measured produces no finding at all: `null` is not allowed here, because
 * "not measured" and "measured zero" are different things, and a report with
 * a made-up number is worse than one with none.
 */
export interface Finding {
  /** A key for the line and defect, stable across runs — see `findingId`. */
  id: string;
  defect: DefectClass;
  severity: Severity;
  page: string;
  containerId: string;
  paragraphIndex: number;
  lineInParagraph: number;
  lineText: string;
  /** The measured value, in the defect's own units (for `tight`/`loose` —
   *  the ratio of space width to natural width). */
  measured: number;
  /**
   * The strength of the deviation — the KEY the detector used to order its
   * findings by. Non-negative; higher means worse.
   *
   * The field is mandatory, and that's a requirement of the report layer, not
   * a nicety. Task 12 slices the document into page batches and merges them;
   * without this field it could reconstruct the document's order only by
   * keeping every `LineMeasure` together with `Calibration` and
   * recomputing the strength from scratch. As long as strength was
   * `max(ratio, 1/ratio)`, it was derivable from `measured` — not anymore,
   * because `detectSpacing` ranks by excess air, which also depends on the
   * number of gaps and on the measure.
   *
   * ONLY COMPARABLE WITHIN THE SAME DEFECT CLASS: the strength of "loose" and
   * the strength of a "widow" measure different things. Merging five
   * detectors into one ordered report has no common scale, and Task 11 did
   * NOT invent one.
   *
   * The exact comparability boundary is recorded in code — `STRENGTH_SCALE`
   * in `finding.ts`: ten classes give seven scales, because some PAIRS of
   * classes measure the same quantity (the detectors themselves proved this).
   * It's fine to compare within a scale, not only within a class; across
   * scales — no. `detectAll` groups by scale exactly for this reason.
   */
  strength: number;
  /** A human-language explanation, with the style's reference bounds. */
  detail: string;
}

export interface MeasureResult {
  docName: string;
  pages: string[];
  lines: LineMeasure[];
  /**
   * Regions for which no composed lines exist.
   *
   * `overset` — the text is pushed out, there are physically no lines.
   * `text-path` — the text sits along a path: lines DO exist, but there's
   * nothing to measure them against. The entire composition measure rests on
   * a RECTANGULAR text column, and such a container has neither
   * `textFramePreferences` nor a meaningful column width (measured
   * 2026-08-18: the graphic owner's bounds are an axis-aligned rectangle, and
   * it does not equal the path's length). Until now, such a line silently
   * dropped out of the measurement, and `checked` shrank without explanation.
   */
  unmeasured: { containerId: string; reason: "overset" | "text-path" }[];
  measurementUnit: string;
}

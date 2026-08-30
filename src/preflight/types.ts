/**
 * Types for `preflight_document` — a wrapper over InDesign's native preflight.
 *
 * WHY A SEPARATE TOOL WHEN InDesign ALREADY HAS ONE. Because on its own its
 * result is MISLEADING: the `[Basic]` profile has 38 rules, of which SIX are enabled
 * (MEASURED 2026-08-07 on the working book). Disabled among others is
 * `ADBE_ImageResolution` — meaning "low resolution" is NOT caught
 * by default. A tool that reported only the errors would report "0" and be
 * formally right and practically harmful.
 *
 * So the unit of the report here is not an error, but a PAIR of “what was measured + what it was measured with”.
 * This is the same principle that gave Phase 6 the `checked`/`notCompared` counters:
 * zero findings can't be told apart from “wasn't asked” unless you say what was asked.
 */

/**
 * The ceiling on the list of CASES in the response.
 *
 * THE NUMBER IS DERIVED FROM A MEASUREMENT, not picked “with headroom”. The 2026-08-07 review
 * weighed the serialization of `ok()` on this very form of response:
 *
 * | cases | bytes  |
 * |---------:|--------:|
 * |        0 |   1 243 |
 * |       50 |  21 856 |
 * |      200 |  83 751 |
 * |     1000 | 413 700 |
 * |     3000 | 1 238 580 |
 *
 * Hence the cost of one case in THAT form: (83 751 − 21 856) / 150 = 412.6 B.
 *
 * The response form has since grown (`description`, `occurrenceCount`,
 * instrument counters), so the number was re-measured on THAT form, using the REAL text
 * of InDesign's Problem/Fix (“Image resolution: effective ppi is 96, minimum is
 * 250” + an 118-character hint):
 *
 * | cases | bytes |
 * |---------:|-------:|
 * |        0 |  2 681 |
 * |       50 | 26 497 |
 * |       96 | 48 485 |
 *
 * The cost of a case here is (48 485 − 2 681) / 96 = 477.1 B — i.e. more expensive than the 412.6 B
 * from the review, and it is this worse figure that is used.
 *
 * The limit at which Phase 4 already once knocked the tool out once is 78 KB; the target
 * here is half that, 40 KB (40 960 B). (40 960 − 2 681) / 477.1 = 80.2 → 80.
 *
 * Reaching hundreds of cases is possible by FOLLOWING the caveat's own advice: enable
 * `ADBE_ImageResolution` on a book with hundreds of images. In other words, without a ceiling the tool's
 * own advice would break the tool.
 */
export const MAX_PREFLIGHT_OCCURRENCES = 80;

/** State of a single profile rule. */
export interface PreflightRuleState {
  /** `ADBE_OversetText`, `ADBE_ImageResolution`, etc. */
  id: string;
  /**
   * `RULE_IS_DISABLED` disables the rule entirely. The other values
   * (`RETURN_AS_ERROR`, `RETURN_AS_WARNING`) mean “the rule is active”.
   */
  flag: string;
  enabled: boolean;
}

/** One specific violation case: level 3 in InDesign's flat array. */
export interface PreflightOccurrence {
  /**
   * The page name as given by InDesign. `null` — the violation is not tied to a
   * page (happens for document-level rules such as `MissingFonts`).
   */
  page: string | null;
  /** Object description: “Text Frame”, “Image”, etc. */
  object: string;
  /**
   * The fourth column of the row — the application's own solid description
   * (“Problem: …\nFix: …”). This is what says WHAT is wrong.
   *
   * `null` means “nothing is lost”: the description is EXACTLY reproducible from `details`
   * (`key: value` pairs joined with `\n` — the measured form). Carrying both
   * copies of the same text would double the response for zero
   * added information, and the ceiling above is counted in bytes.
   *
   * When the description CANNOT be reproduced from the pairs — in particular when there
   * are no pairs at all — it travels here verbatim. The tool's first revision dropped
   * this column: the row `[3, "Image", "12", "Problem: RGB у CMYK-документі", []]` produced
   * `{"page":"12","object":"Image","details":[]}`, i.e. the report looked complete,
   * while the one sentence describing the actual problem vanished.
   */
  description: string | null;
  /**
   * `key → value` pairs from InDesign: `Problem`, `Fix`, and similar.
   * Stored as-is — the tool has no right to translate or shorten them:
   * this is the application's own text, and it's exactly what the operator will search for in InDesign.
   */
  details: Array<{ key: string; value: string }>;
}

/** A rule that found something, with all of its cases. */
export interface PreflightFinding {
  /** Level 1 in the flat array: “TEXT”, “LINKS”, “COLOUR”. */
  category: string;
  /** Level 2: “Overset text”, “Missing fonts”. */
  rule: string;
  /**
   * The ACTUAL count of cases for this rule — independent of the ceiling.
   * Without it, `occurrences: []` after truncation can't be told apart from a rule that
   * genuinely has zero cases (which does happen: a document-level violation
   * arrives as level 2 with no level 3).
   */
  occurrenceCount: number;
  /** The list of cases; may be truncated by the `MAX_PREFLIGHT_OCCURRENCES` ceiling. */
  occurrences: PreflightOccurrence[];
}

/**
 * The raw measurement as returned by JSX. The `aggregatedResults` form was measured
 * on 2026-08-07 on a fixture with a deliberate overset:
 *
 * ```
 * ["Untitled-262", "[Basic]", [
 *   [1, "TEXT (1)",         "",  "",                   []],
 *   [2, "Overset text (1)", "",  "",                   []],
 *   [3, "Text Frame",       "1", "Problem: …\nFix: …", [["Problem", "…"], ["Fix", "…"]]]
 * ]]
 * ```
 *
 * This is a TREE FLATTENED INTO A LIST: the first column is depth. Without it the rows
 * would be indistinguishable, which is exactly why other wrappers hand this array back raw.
 */
export interface PreflightMeasure {
  docName: string;
  /** The profile that was USED to measure. May differ from the document's working profile. */
  profileName: string;
  /** The document's working profile — `doc.preflightOptions.preflightWorkingProfile`. */
  workingProfile: string;
  /** `true` means live preflight in the document has been turned off by the operator. */
  preflightOff: boolean;
  /** `PREFLIGHT_ALL_PAGES`, etc. */
  scope: string;
  rules: PreflightRuleState[];
  /** Flat rows of levels 1–3, in the order InDesign gave them. */
  rows: PreflightRow[];
  /** Names of all of the application's profiles — so the operator knows what there is to pick from. */
  availableProfiles: string[];
  /**
   * INSTRUMENT COUNTERS, not the document's. The same principle that gave Phase 6
   * `checked`/`notCompared`: without them, “0 violations” and “InDesign returned a shape
   * we don't understand” are byte-for-byte the same response.
   *
   * `false` means `aggregatedResults` arrived in a shape the parser wasn't
   * built for (not an array, or the third element isn't an array). The measured
   * shape of a clean document is `["Untitled-268", "[Basic]", []]`, i.e. an
   * empty row list with `shapeRecognised === true`.
   */
  shapeRecognised: boolean;
  /** How many rows came in from InDesign. */
  rowsSeen: number;
  /** How many of them were parsed. The difference is a silent loss, and it's visible in the report. */
  rowsParsed: number;
  /** The same, for the `key → value` pairs inside rows. */
  pairsSeen: number;
  pairsParsed: number;
  /**
   * Whether the process cleaned up after itself. An exception inside `remove()` is
   * deliberately swallowed (so as not to mask the original error), so without this
   * field, a process staying alive in the Preflight panel would have
   * one silent way to happen.
   */
  processRemoved: boolean;
  /**
   * WHETHER THE COMPLETENESS of the list is CONFIRMED — not “what `waitForProcess`
   * returned”. The difference matters: that call's value only makes it here when it's
   * boolean, and its measured polarity is furthermore INVERTED relative to the name — `true`
   * means “did NOT finish waiting” (see `src/jsx/preflight.jsx`).
   *
   * `true` in the ISSUED report means exactly one thing: **the COMPLETENESS of the list is
   * NOT confirmed**. The findings in such a report are individually genuine, and this is
   * exactly what the first `caveat` block shouts about. When the result couldn't be read,
   * there is no report at all: the measurement throws.
   *
   * WHY NOT “the wait didn't finish” — that wording would be false for
   * one of the two states that lead here. `true` is also set when
   * `waitForProcess` returned something NOT boolean: in that case whether it finished waiting is
   * unknown altogether, and `true` is the conservative choice. `waitPolarity` below tells
   * them apart, and `caveat` gives them DIFFERENT blocks.
   */
  waitTimedOut: boolean;
  /**
   * `null` — `waitForProcess` returned a genuine boolean, i.e. the polarity that
   * everything rests on. A string means the returned value was OUTSIDE `{true, false}`, and
   * its `typeof` is stored here alongside the value.
   *
   * In that case `waitTimedOut` above is forced to `true` — conservatively, because
   * that's exactly what “completeness not confirmed” means. Throwing instead would be wrong
   * in substance: the rows come from `aggregatedResults` and don't depend on
   * `waitForProcess`, so only COMPLETENESS is in doubt, not the truthfulness of the findings (the
   * same reasoning behind not throwing on signal 2).
   *
   * `typeof` here isn't cosmetic: without it, the string `"true"` and
   * `new Boolean(true)` would produce the same “true” in the report.
   */
  waitPolarity: string | null;
}

/** `[depth, caption, page, description, pairs]`. */
export type PreflightRow = [number, string, string, string, Array<[string, string]>];

export interface PreflightReport {
  docName: string;
  profileName: string;
  workingProfile: string;
  preflightOff: boolean;
  scope: string;
  availableProfiles: string[];
  rulesEnabled: number;
  rulesDisabled: number;
  /** By name: without this, “0 errors” is meaningless. */
  enabledRuleIds: string[];
  disabledRuleIds: string[];
  findings: PreflightFinding[];
  /** The count of CASES, not rules. Counted BEFORE the ceiling. */
  occurrenceCount: number;
  /**
   * Present only when the case list has been truncated by the ceiling. Silent truncation
   * would read as “this is all there is” — which is a different answer.
   */
  occurrencesTruncated: { shown: number; total: number } | null;
  /** Instrument counters from the measurement — see `PreflightMeasure`. */
  shapeRecognised: boolean;
  rowsSeen: number;
  rowsParsed: number;
  pairsSeen: number;
  pairsParsed: number;
  processRemoved: boolean;
  waitTimedOut: boolean;
  /** The raw value of `waitForProcess`, when it's NOT boolean — see `PreflightMeasure`. */
  waitPolarity: string | null;
  /**
   * A loud line that must be present in every response.
   *
   * Without it, “0 errors” reads as “the layout is clean”, when it only means
   * “zero under this profile's enabled rules”. This isn't politeness — it's the
   * difference between a tool and false reassurance.
   */
  caveat: string;
}

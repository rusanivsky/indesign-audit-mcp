/**
 * Phase 5 vocabulary. Lives apart from the detectors deliberately — the same reason
 * as in `src/layout/types.ts`: several tasks read the types, and two declarations
 * would inevitably diverge.
 */

import type { ParagraphMeasure, StyleValues } from "../layout/types.js";

/** Declared paragraph style: what the document itself states. */
export interface DeclaredStyle {
  /** Style `.id`. A key robust to identical names in different folders. */
  id: string;
  /** Name without the folder. Shown to a human; is NOT a key — see `id`. */
  name: string;
  /** Full path with folders, "/" separator. For a style outside folders === name. */
  path: string;
  /** Parent style name — for a human reading the report. */
  basedOn: string | null;
  /**
   * Parent style `.id` — the ONLY thing the chain can be resolved by.
   *
   * MEASURED with probe `H5` (docs/measured-facts-phase5.md, Question 6): several
   * of the book's styles declare `basedOn` with an identical name, and not all
   * references lead to the same style — because two styles with that name exist
   * in the document (different folders). Resolving by name is provably wrong.
   *
   * `null` for root styles, and there are TWO DIFFERENT KINDS of root, both measured:
   * `[No Paragraph Style]` THROWS "Invalid request on a root style.", while
   * `[Basic Paragraph]` throws nothing, but `basedOn.id` gives the string
   * `"undefined"`. Neither `try/catch` nor a check against `"undefined"` alone
   * covers both.
   */
  basedOnId: string | null;
  nextStyle: string | null;
  declared: StyleValues;
}

/**
 * Paragraph text scale.
 *
 * Entries are created ONLY for paragraphs where the scale differs from 100 —
 * otherwise the array would duplicate the whole document (2980 entries vs. ~150).
 *
 * `null` means "mixed within the paragraph": `horizontalScale` is a CHARACTER
 * property, so reading it from the paragraph would silently give the value of
 * the first range (the same trap already described for `pointSize` in
 * `IDMCP.charPropActual`).
 */
export interface ScaleMeasure {
  containerId: string;
  paragraphIndex: number;
  page: string | null;
  styleName: string;
  styleId: string;
  /**
   * The reference for this property is the LITERAL 100, not the style's
   * declared value, and that's spelled out here because otherwise it would
   * be inherited silently.
   *
   * `horizontalScale` is NOT among the 12 fields of `declaredStyleValues`
   * (`grep` across all core modules gives 0 hits), so there is simply nothing
   * to compare against a declared value. The consequence, measured with probe
   * `H5` (docs/measured-facts-phase5.md, Question 6): a paragraph style that
   * itself declares a scale ≠ 100 will produce an "override" on every one of
   * its ranges. On this book only one style out of 51 does that, and it is
   * used 0 times — so the zone is empty IN CONSEQUENCE, not in principle, and
   * on another document the number will change.
   */
  horizontalScale: number | null;
  verticalScale: number | null;
}

/**
 * A run of character formatting inside a paragraph (`paragraph.textStyleRanges`).
 *
 * The reference for comparison is the PARAGRAPH style, not the range's character
 * style, and this was measured with probe `H5`, not chosen: of the book's 5 used
 * character styles, only ONE has a full set of declared values, and `[None]` has
 * none at all (`NOTHING` on every numeric field, `""` on `appliedFont`). "Override
 * from the declared character style" simply does not exist as a mechanism for
 * this document — the only thing there is to compare against is the paragraph
 * style of the paragraph the range belongs to (the `containerId` + `paragraphIndex`
 * pair).
 *
 * The entry does NOT include a preview or other reading conveniences: ~3480 ranges
 * against ~2980 paragraphs — a volume justified only by the fact that it crosses
 * the bridge and never reaches the MCP response directly (only the findings
 * summary does).
 *
 * A LIMIT NAMED HONESTLY (Task 13 review, round 1, minor item 4): the source is
 * `story.paragraphs` (`styles.jsx`), so text in tables and footnotes never reaches
 * here at all — not as `RangeMeasure`, nor in the `CharacterStyleUsage` count
 * below. For `character-override` this is an undercount (some overrides go
 * unnoticed); for `character-style-unused` it is a potential FALSE CLAIM: a
 * character style used only in a table or footnote looks unused by this
 * measurement, though it is in fact alive.
 */
export interface RangeMeasure {
  containerId: string;
  paragraphIndex: number;
  rangeIndex: number;
  /** Name of the applied character style; "[None]" for a bare range. */
  characterStyle: string;
  pointSize: number | null;
  /**
   * The range's `appliedFont` — the SAME field as in `StyleValues`, but a
   * different source: `run.appliedFont` sometimes goes through
   * `characterStyle.appliedFont`, which is measured to be a STRING, not a `Font`
   * object (`typeof "string"`, `constructor String`, `.fontFamily` gives
   * `undefined` for all 8 styles of the document). Serialized via
   * `IDMCP.anyFontName`, which accepts both forms — `IDMCP.fontFamilyName` here
   * would silently give an empty column.
   */
  appliedFont: string | null;
  fontStyle: string | null;
  tracking: number | null;
  horizontalScale: number | null;
}

/**
 * Usage of a single character style: how many document ranges apply it.
 * `[None]` also ends up in this list (`doc.allCharacterStyles` is enumerated
 * without a filter — the same scheme as for paragraph styles in `styles.jsx`),
 * and that is exactly why `character.ts`, not `styles.jsx`, is responsible for
 * excluding `[None]` from `character-style-unused` (by `name`, not `id` — the
 * string "[None]" itself is measured to be a stable sentinel, unlike the
 * custom style names below).
 *
 * `id` is the COUNTING KEY, `name` is FOR A HUMAN ONLY (Task 13 review, round 1,
 * item 5). The same trap already found Critical in the neighboring `usage`
 * family (`styles/inventory.ts`): two character styles with an identical name —
 * one used, the other not — merge into a single row when counted BY NAME, and
 * the unused one disappears behind the used one (`styles.jsx` counts
 * `appliedRuns` by `.id` of `run.appliedCharacterStyle`, not by name).
 *
 * The traversal does not see tables or footnotes (the same limit as in
 * `RangeMeasure` above): a style used only there looks unused here.
 */
/**
 * A carrier on which a character style sits OUTSIDE the text. Read by a
 * separate pass over the document (`IDMCP.characterStyleCarriers`,
 * `src/jsx/styles.jsx`), because `textStyleRanges` sees none of these places.
 *
 * `carrier` is a string, not a closed enum, and that is deliberate: the list
 * of places where InDesign lets you attach a character style is longer than
 * what has been measured (this already includes list markers, numbering,
 * nested and GREP styles, cross-reference blocks, the page number and
 * separator in a TOC style). A new carrier must reach the report NAMED,
 * rather than being dropped by the type at the boundary.
 */
export interface CharacterStyleCarrier {
  carrier: string;
  count: number;
}

export interface CharacterStyleUsage {
  id: string;
  name: string;
  /** How many text ranges carry this style. NOT the whole usage. */
  appliedRuns: number;
  /**
   * Carriers outside the text. An empty array means "found none", not "did
   * not look": the measurement always fills the field.
   *
   * Optional ONLY for compatibility with calls that build `StylesMeasure`
   * by hand (tests and old fixtures). The detector must read it as "none" —
   * and that is exactly what it does.
   */
  referencedBy?: CharacterStyleCarrier[];
}

export interface StylesMeasure {
  docName: string;
  styles: DeclaredStyle[];
  /**
   * The SAME contract that Phase 4's `detectOverrides` consumes — deliberately.
   * It is exactly what lets the detector be reused without a single change.
   */
  paragraphs: ParagraphMeasure[];
  ranges: RangeMeasure[];
  characterStyles: CharacterStyleUsage[];
  scales: ScaleMeasure[];
  /**
   * How many paragraphs the story traversal found off the pages (the pasteboard).
   *
   * Measured on the working book: the story traversal gives 2980 paragraphs, the
   * frame traversal — 2976. The number is stated, not hidden: a silent
   * difference of four paragraphs would read as a measurement error.
   */
  paragraphsOffPage: number;
  /**
   * How many property reads failed while searching for character-style
   * carriers outside the text.
   *
   * Zero here means "we traversed everything we know how to", not "everything
   * is fine": the search only knows the carriers that have been measured
   * (markers, numbering, nested and GREP styles, cross-references, TOC). A
   * nonzero number means part of the document was not traversed, and
   * `character-style-unused` on this document may FALSELY call a style
   * unused — which is exactly why it reaches the response instead of
   * drowning in a catch.
   *
   * Optional for the sake of `StylesMeasure` assembled by hand in tests.
   */
  characterStyleCarrierFailures?: number;
}

/**
 * The response key under which the FULL caveat about tables and footnotes is
 * hoisted out.
 *
 * WHY A KEY, NOT TEXT IN EVERY FINDING (final-wave review, item 2). The first
 * draft of fix I-4 wrote the full caveat into the text of EVERY
 * `style-unused`/`character-style-unused` finding. Measured on the fixture:
 * 5 findings × 389 B = **1,785 B out of 2,103 B of the whole response
 * increase**, i.e. 85% of the growth was exactly the repetition of one
 * sentence. On the working book with 14 unused styles that is ≈5.5 KB, on a
 * document with 100 — ≈39 KB: exactly the class of per-paragraph bloat the
 * rest of the phase is written against.
 *
 * Now the full explanation of the mechanism (why the traversal doesn't see
 * tables) sits in the response ONCE, and the FINDING itself still carries a
 * caveat — short but concrete: "don't delete without checking tables and
 * footnotes." The review's condition ("the operator must see the caveat WHERE
 * THEY READ THE ADVICE") is not violated: the advice text still keeps both
 * the prohibition and where to look — only the explanation of the REASON is
 * hoisted out.
 */
export const UNUSED_STYLE_CAVEAT_KEY = "caveats.tablesAndFootnotes";

/**
 * Full caveat text. Lives here, not in the tool, so it cannot drift apart
 * from the short references in the detectors: one source for all three
 * places it's used (`inventory.ts`, `character.ts`, `tools/styles.ts`).
 */
export const UNUSED_STYLE_CAVEAT_TEXT =
  "style-unused and character-style-unused findings are NOT PERMISSION TO DELETE THE STYLE. The measurement goes over " +
  "story.paragraphs and does not reach table cells or footnotes, so a style used " +
  "ONLY there looks unused here although it is in fact alive. Before deleting, check " +
  "tables and footnotes by hand. The same limit understates every number of the character family — but there it is " +
  "an undercount, not a false claim. " +
  /*
   * УМОВА, ЗА ЯКОЇ СТИЛЬ НАЗВАНО ЛИСТКОМ, — тут, а не в кожній знахідці:
   * текст знахідки має власний бюджет байтів (є тест), і пояснення механізму
   * туди свідомо не кладуть.
   *
   * `classifyUnusedStyles` вважає стиль листком, коли ВСІ його нащадки теж
   * невживані, тобто мовчазно припускає, що видалятимуть УСЮ гілку. Оператор,
   * який видалив би лише названий стиль, дістав би саме те, від чого модуль
   * застерігає: `style.remove()` перечіпляє нащадків до діда.
   */
  "AND ON DELETING A BRANCH: a style is called unused only when its descendants are " +
  "unused too — that is the condition, not an extra. Delete the whole branch rather than " +
  "one style from its middle: removing a parent re-parents its children to the " +
  "grandparent and changes their formatting.";

/**
 * Built-in styles whose application in the layout is a finding.
 *
 * A LIMIT NAMED HONESTLY (final review, minor item 5): matching is done by
 * ENGLISH names. InDesign translates the names of built-in styles along with
 * the interface (`[Основний абзац]`, `[Немає абзацного стилю]`, etc.), so on a
 * localized build not a single paragraph will fall under this list, and the
 * `usage` family will silently return zeros — not "zero measured" but "nothing
 * recognized." The same applies to the `"[None]"` sentinel in `character.ts`.
 * This was NOT measured: the working book was run on an English build, and
 * no other one is at hand. So the limit is named, not "fixed" by guessing
 * translations — a made-up list of localized names would be worse than an
 * honestly named limit.
 */
export const DEFAULT_STYLE_NAMES = ["[Basic Paragraph]", "[No Paragraph Style]"];

export type StyleFamily = "usage" | "overrides" | "scale" | "character" | "hierarchy";
export type StyleDefect =
  /*
   * TWO DEFECTS INSTEAD OF ONE `style-unused`, and the difference between them
   * is not a nuance but the opposite VERDICT. Both mean "the style has zero
   * paragraphs"; they diverge on whether it can be deleted.
   *
   * `style-unused-leaf` — it can: neither a paragraph nor another style rests
   * on this style (adjusted for iterative cleanup, see `dependants.ts`).
   * `style-unused-base` — it CANNOT: paragraphs are zero, but this is an
   * abstract parent, and other styles depend on it.
   *
   * Why split (measured on the book on 2026-08-16): an undivided
   * `style-unused` named 14 styles, 9 of which were bases. Deleting by that
   * list would have bumped their children onto the GRANDPARENT, and 387
   * checklist paragraphs would have fallen into the exception. One shared
   * defect name read as "all 14 are excess" — i.e. the report invited exactly
   * the action it should have warned against.
   */
  | "style-unused-leaf"
  | "style-unused-base"
  | "default-style-applied"
  | "scaled-text"
  | "character-override"
  | "character-style-unused"
  | "styles-indistinguishable"
  | "based-on-missing";

/** A finding that has an address. A report line has no address — see `report.ts`. */
export interface StyleFinding {
  family: StyleFamily;
  defect: StyleDefect;
  styleName: string;
  /**
   * The `.id` of the style the finding concerns.
   *
   * `null` where the finding is not about one specific declared style (for
   * example, `styles-indistinguishable` describes a GROUP of two or more
   * styles at once — there simply is no single `id` that would name "the
   * same" style here).
   *
   * Within the `character` FAMILY, the same field means DIFFERENT things
   * depending on `defect`: for `character-override` it is the `.id` of the
   * PARAGRAPH style of the paragraph the range belongs to (the comparison
   * reference is the paragraph style, not the character style, see
   * `character.ts`), while for `character-style-unused` it is the `.id` of
   * the character style ITSELF. Whoever reads only this type, not
   * `character.ts`, must know about this discrepancy in advance: the field
   * does not guarantee "always the same kind of style" within one family.
   *
   * Without this field, a finding about two identically named styles is
   * indistinguishable: the document has a measured pair with the same name
   * where only one is unused, and `styleName` gives no way to say which one.
   */
  styleId: string | null;
  page: string | null;
  containerId: string | null;
  paragraphIndex: number | null;
  detail: string;
}

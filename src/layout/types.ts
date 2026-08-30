/**
 * Phase 4's shared vocabulary. Lives separately from the detectors on
 * purpose: Tasks 4–9 read these types, and two declarations would inevitably
 * drift apart — exactly as already accounted for in `src/composition/types.ts`.
 */

/**
 * The value of a paragraph or style property.
 *
 * `null` HAS EXACTLY ONE MEANING: "not compared" — the property is
 * unavailable or mixed within the paragraph. This is NOT "zero" and NOT "same
 * as the style". A paragraph with `null` goes into a separate report list,
 * not into "clean" (spec §3): making up a value here is the same class of
 * error as silently losing a correction.
 */
export interface StyleValues {
  firstLineIndent: number | null;
  leftIndent: number | null;
  rightIndent: number | null;
  spaceBefore: number | null;
  spaceAfter: number | null;
  pointSize: number | null;
  /**
   * A number OR an enum name — the only property like this in the set.
   *
   * With auto leading, InDesign returns `Leading.AUTO` (measured on the
   * working book: `typeof "object"`, `String(...)` → "AUTO"), and `map.jsx`
   * serializes it as the string "AUTO" (`IDMCP.numberOrEnumName`). Narrowing
   * the type to `number` would bring back the old defect: AUTO became `null`,
   * "AUTO vs AUTO" read as "mixed", and "AUTO vs 14" — a genuine override —
   * couldn't produce a finding at all.
   *
   * `differs()` in `overrides.ts` handles both forms: numbers go through
   * `EPSILON_PT`, everything else through exact `!==`.
   */
  leading: number | string | null;
  justification: string | null;
  appliedFont: string | null;
  fontStyle: string | null;
  tracking: number | null;
  listType: string | null;
}

/** A group of properties. Groups are NOT mixed in the report (spec §7.2). */
export type PropertyGroup = "indents" | "sizes" | "justification" | "font" | "lists" | "tracking";

/**
 * Which properties belong to which group.
 *
 * `tracking` is a SEPARATE group, and that's deliberate (spec §7.3):
 * Phase 3's `composition_apply` writes tracking as its correction mechanism.
 * If it lived under "sizes", the two tools would be at war — one fixing,
 * the other reporting the fix as a disease. The report must flag this group
 * explicitly.
 */
export const GROUP_PROPERTIES: Record<PropertyGroup, (keyof StyleValues)[]> = {
  indents: ["firstLineIndent", "leftIndent", "rightIndent", "spaceBefore", "spaceAfter"],
  sizes: ["pointSize", "leading"],
  justification: ["justification"],
  font: ["appliedFont", "fontStyle"],
  lists: ["listType"],
  tracking: ["tracking"],
};

export interface ParagraphMeasure {
  containerId: string;
  paragraphIndex: number;
  page: string | null;
  styleName: string;
  /**
   * The `.id` of the applied paragraph style — the report's KEY.
   *
   * The name can't be the key: probe H5 measured that the document contains
   * two different styles with the same name (565 paragraphs and 0), and
   * counting by name collapses them into one row, making the unused style
   * disappear from the report. The name stays — a human needs it — but no
   * longer as the key.
   */
  styleId: string;
  isMaster: boolean;
  declared: StyleValues;
  actual: StyleValues;
  /** The paragraph has a range with an applied character style — a legitimate deviation. */
  hasCharacterStyleRuns: boolean;
  preview: string;
}

export interface MasterItemRef {
  id: string;
  kind: string | null;
  /**
   * Whether the item contains an auto page-number marker.
   *
   * MEASURED (Task 7, a probe script outside the main H4 probe, live
   * InDesign 21.4.1.4): `character.contents === SpecialCharacters.AUTO_PAGE_NUMBER`
   * returns `true` — a direct identity comparison WORKS here (unlike
   * `page.appliedMaster === NothingEnum.NOTHING`, where the same `===` is
   * always `false`, see `docs/measured-facts-phase4.md`). This isn't a
   * fixture detail (`.label`, which Task 2's fixture uses only to make its
   * own reading easier) — it's a real InDesign trait, present on any document
   * with auto-numbering.
   *
   * Filled in only for the master page's own composition
   * (`PageMeasure.expectedMasterItems`, `src/jsx/map.jsx`). For "present on
   * the page" items (`PageMeasure.masterItems`) the field isn't needed — the
   * detector compares them only by `.id` — and it isn't filled in (stays
   * `undefined`).
   */
  isFolio?: boolean;
}

/**
 * An item that belongs to the document page itself (`page.pageItems`), not
 * to the master page.
 *
 * Needed for exactly one distinction (measured by Task 2, report, the section
 * "What was measured about master items"): an overridden master item
 * disappears from `masterPageItems` and shows up here, with
 * `overriddenMasterItemId` equal to the `.id` of the ORIGINAL master item
 * (the overridden item itself gets a NEW `.id` — compare by this field, not
 * by the `.id` of the record itself).
 */
export interface PageOwnItem {
  id: string;
  overriddenMasterItemId: string | null;
  /**
   * Whether THIS item itself contains an auto page-number marker.
   *
   * Needed for exactly one distinction that's impossible without it: an
   * overridden folio item where the layout artist replaced the auto-number
   * with manually typed text. The original on the master page is still
   * `isFolio`, the item on the page is still "overridden" — but the page
   * number is no longer there, and when the book recomposes it will go wrong
   * silently. Before this, that state went through as a plain
   * `master-item-overridden`, on par with a shifted decorative rule.
   */
  hasAutoPageNumber: boolean;
}

export interface PageMeasure {
  name: string;
  side: string | null;
  master: string | null;
  frameCount: number;
  /**
   * Master-page items that remain UNTOUCHED on this page
   * (`page.masterPageItems`), WITHOUT guides — their count is tracked
   * separately, in `guideCount`.
   */
  masterItems: MasterItemRef[];
  /**
   * How many of `page.masterPageItems` turned out to be guides (`Guide`).
   *
   * Guides aren't layout items: they're entirely absent from
   * `masterSpread.pageItems` (where `expectedMasterItems` comes from), so
   * `detectMasters` never sees them, before or after the filter. But there
   * are MANY of them: measured on the working book — a steady 45–46 per page,
   * 319 versus 10 real items across seven sampled pages, i.e. 97% of the
   * entire output. The count stays specifically because a silent
   * disappearance of a whole population would read as "there are no guides",
   * not as "they aren't being counted".
   */
  guideCount: number;
  /** NEW (Task 7): the page's own items — for recognizing overrides by identity. */
  pageItems: PageOwnItem[];
  /**
   * NEW (Task 7): the composition of the master page whose `.side` matches
   * this document page's (measured: `masterSpread.pages[k].side` returns the
   * same enum name as the document page — the pair is determined by string
   * comparison, not by blindly indexing `[0]`/`[1]`).
   *
   * ТРИ СТАНИ, А НЕ ДВА: масив із елементами — композиція відома; ПОРОЖНІЙ
   * масив — майстер-сторінка є й на ній справді нема елементів; `null` —
   * сторони не знайдено, композиція НЕВІДОМА. Доти два останні стани
   * збігалися в `[]`, а `[]` істинне, тож «невідомо» читалося як «нічого не
   * бракує».
   */
  expectedMasterItems: MasterItemRef[] | null;
}

export interface FrameMeasure {
  id: string;
  page: string | null;
  containerId: string;
  rotationAngle: number | null;
  previousFrameId: string | null;
  nextFrameId: string | null;
  overflows: boolean;
  isMaster: boolean;
}

export interface SpreadMeasure {
  index: number;
  /** Spread page names, in spread order. */
  pages: string[];
  /** Items sitting on the pasteboard — `parentPage === null`. */
  pasteboardItems: number;
}

export interface StoryMeasure {
  containerId: string;
  characters: number;
  frames: number;
  overflows: boolean;
}

export interface LayoutMeasure {
  docName: string;
  pages: PageMeasure[];
  spreads: SpreadMeasure[];
  stories: StoryMeasure[];
  frames: FrameMeasure[];
  paragraphs: ParagraphMeasure[];
  /**
   * How many story frames and paragraphs were left WITHOUT a page — i.e.
   * fell out of the measurement.
   *
   * Handoff §2.2: until now this kind of narrowing was silent — `checked`
   * shrank, and by exactly how much was never stated anywhere. This is
   * exactly the class of problem `masterSkipped` exists for in
   * `pagination.jsx`: the knowledge exists, the channel doesn't.
   *
   * Zero is printed the same way as nonzero: "0 without a page" and "137
   * without a page" are two different reports, and the reader must be able
   * to see which one they're looking at.
   *
   * Optional (`?`): `LayoutMeasure` fixtures written before this addition
   * don't have the fields, and `npm run typecheck` already covers the tests.
   */
  unplacedContainers?: number;
  unplacedParagraphs?: number;
  measurementUnit: string;
}

export type LayoutFamily = "overrides" | "masters";

export type LayoutDefect =
  | "style-override"
  | "manual-bullet"
  | "master-item-overridden"
  | "master-item-missing"
  | "master-none"
  /**
   * Композиція майстра для ЦІЄЇ сторони невідома — «не порівняно», не
   * «чисто». Окремий дефект, бо мовчання тут байт у байт збігалося з
   * перевіреною чистою сторінкою.
   */
  | "master-composition-unknown"
  | "folio-missing";

/**
 * A single `layout_audit` finding.
 *
 * ITS OWN TYPE, NOT `Finding` FROM PHASE 3 — and that's a spec §4.7 decision,
 * not taste. `Finding` has a fix-suggestion field because `composition_audit`
 * has a paired `composition_apply`. Here there's no write path at all.
 * Dragging along an empty field would also mean inheriting `Finding`'s known
 * contract hole: the magnitude comes from `|airFraction|` (a sum-like value),
 * the sign from the median `spacingRatio`, and the two can disagree on
 * direction.
 *
 * The `strength` and `severity` fields are deliberately ABSENT here: a
 * deviation from the declared style either exists or doesn't — there's no
 * scale for it, and inventing one just to match Phase 3 would mean adding a
 * number with no measurement behind it.
 */
export interface LayoutFinding {
  id: string;
  family: LayoutFamily;
  defect: LayoutDefect;
  /** For `overrides` — the group; for `masters` — `null`. */
  group: PropertyGroup | null;
  page: string | null;
  containerId: string | null;
  paragraphIndex: number | null;
  styleName: string | null;
  /** The style's `.id`. `null` in the same place as `styleName` — for findings in the `masters` family. */
  styleId: string | null;
  /** Property name or the master item's id. */
  property: string;
  declared: string | number | null;
  actual: string | number | null;
  detail: string;
}

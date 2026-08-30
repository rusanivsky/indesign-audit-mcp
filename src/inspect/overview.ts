/**
 * Shape of the `doc_overview` response: optional sections and a ceiling on
 * the story listing.
 *
 * WHY THIS MODULE EXISTS. `doc_overview` is the server's cheapest and most
 * frequently used tool ("start with indesign_status, then doc_overview"),
 * and on the working book it was UNUSABLE: 122,582 B of response, which the
 * client truncates. Measured 2026-08-16 (196 pages, 575 stories), the
 * breakdown by key:
 *
 *   stories          75,392 B   575 rows   ← 90% of the total
 *   pages             4,989 B   196 rows
 *   paragraphStyles   1,783 B    55 rows
 *   the rest           ~1,000 B
 *
 * So one section decides it, and it alone grows with the document's
 * content rather than with its schema. The tool's schema at the time was
 * `{}` — no way at all to narrow it, so there was no way for the operator
 * to work around the limit.
 *
 * AFTER THE CHANGE, the same book, the same instrument: **21,272 B**
 * (ceiling of 60 stories plus compact serialization). The `totals` numbers
 * remain complete.
 *
 * WHY TRUNCATION, NOT JUST A PARAMETER. The default must work: that's why
 * the ceiling sits on the listing, while the TOTALS are counted before it
 * and remain complete. The truncation is named (`storiesTruncated`), like
 * `valuesTruncated` in `layout_audit` and `detailTruncated` in
 * `styles_audit`: a silent cut would read as "this is all the stories",
 * and that is exactly where the tool would lie silently.
 *
 * Pure TypeScript — does not access InDesign.
 */

export interface RawStory {
  index: number;
  containerId: string;
  characters: number;
  words: number;
  preview: string;
  overflows: boolean;
}

export interface RawPage {
  name: string;
  frames: number;
}

export interface RawLink {
  name: string;
  status: string;
}

/** What the `doc_overview` handler in `src/jsx/inspect.jsx` returns. */
export interface RawOverview {
  name: string;
  saved: boolean;
  fullName: string | null;
  pageCount: number;
  spreadCount: number;
  pages: RawPage[];
  stories: RawStory[];
  paragraphStyles: string[];
  characterStyles: string[];
  fonts: string[];
  links: RawLink[];
}

export const OVERVIEW_SECTIONS = [
  "pages",
  "stories",
  "paragraphStyles",
  "characterStyles",
  "fonts",
  "links",
] as const;

export type OverviewSection = (typeof OVERVIEW_SECTIONS)[number];

/**
 * Default ceiling on the story listing.
 *
 * The number comes from MEASUREMENT, not from thin air: a story row weighs
 * ≈131 B (75,392 B for 575 rows), so 60 rows is ≈8 KB, and the whole
 * response on the book stays ≈16 KB against the 78 KB where the tool once
 * already broke. A normal-sized document (dozens of stories) never even
 * touches the ceiling.
 */
export const DEFAULT_MAX_STORIES = 60;

/**
 * The selection rule, named IN THE RESPONSE ITSELF. A truncated listing
 * without an explanation of WHAT exactly remains in it reads as "the first
 * ones in order" — and that is not the case.
 */
const SELECTION_RULE =
  "the most informative are shown: overset first, then by volume; the summaries below are complete";

export interface OverviewTotals {
  pages: number;
  stories: number;
  storyCharacters: number;
  storyWords: number;
  storiesOverset: number;
  storiesEmpty: number;
  paragraphStyles: number;
  characterStyles: number;
  fonts: number;
  links: number;
}

export interface ShapedOverview {
  name: string;
  saved: boolean;
  fullName: string | null;
  pageCount: number;
  spreadCount: number;
  sections: OverviewSection[];
  totals: OverviewTotals;
  pages?: RawPage[];
  stories?: RawStory[];
  storiesTruncated?: { shown: number; total: number; rule: string };
  paragraphStyles?: string[];
  characterStyles?: string[];
  fonts?: string[];
  links?: RawLink[];
}

export interface OverviewOptions {
  sections: readonly OverviewSection[];
  maxStories: number;
}

/**
 * Story order is ONE order, regardless of whether the ceiling kicked in.
 *
 * Sorting "only when we truncate" would mean having a branch that never
 * runs on a small document, i.e. one that breaks invisibly. The order is
 * complete and deterministic: overset first (the one state that is itself
 * a defect), then by volume, and equal by volume — by index.
 */
function byImportance(a: RawStory, b: RawStory): number {
  if (a.overflows !== b.overflows) return a.overflows ? -1 : 1;
  if (a.characters !== b.characters) return b.characters - a.characters;
  return a.index - b.index;
}

export function shapeOverview(raw: RawOverview, options: OverviewOptions): ShapedOverview {
  const wanted = new Set<OverviewSection>(options.sections);

  /*
   * TOTALS ARE FROM THE RAW MEASUREMENT, before any slicing and before the
   * section filter. So "the section was not requested" never turns into
   * "zero": the numbers stay in place even when the listing did not go
   * out at all.
   */
  const totals: OverviewTotals = {
    pages: raw.pages.length,
    stories: raw.stories.length,
    storyCharacters: raw.stories.reduce((sum, s) => sum + s.characters, 0),
    storyWords: raw.stories.reduce((sum, s) => sum + s.words, 0),
    storiesOverset: raw.stories.filter((s) => s.overflows).length,
    storiesEmpty: raw.stories.filter((s) => s.characters === 0).length,
    paragraphStyles: raw.paragraphStyles.length,
    characterStyles: raw.characterStyles.length,
    fonts: raw.fonts.length,
    links: raw.links.length,
  };

  const out: ShapedOverview = {
    name: raw.name,
    saved: raw.saved,
    fullName: raw.fullName,
    pageCount: raw.pageCount,
    spreadCount: raw.spreadCount,
    sections: OVERVIEW_SECTIONS.filter((s) => wanted.has(s)),
    totals,
  };

  if (wanted.has("pages")) out.pages = raw.pages;
  if (wanted.has("paragraphStyles")) out.paragraphStyles = raw.paragraphStyles;
  if (wanted.has("characterStyles")) out.characterStyles = raw.characterStyles;
  if (wanted.has("fonts")) out.fonts = raw.fonts;
  if (wanted.has("links")) out.links = raw.links;

  if (wanted.has("stories")) {
    /* Copy before sorting: the input array belongs to the caller, and a
     * repeat call on the same measurement must give the same result. */
    const ordered = [...raw.stories].sort(byImportance);
    out.stories = ordered.slice(0, options.maxStories);
    if (ordered.length > options.maxStories) {
      out.storiesTruncated = {
        shown: out.stories.length,
        total: ordered.length,
        rule: SELECTION_RULE,
      };
    }
  }

  return out;
}

/**
 * A3. Assembling the document map from the flat data of the `layout_measure`
 * handler. Pure TypeScript: no access to InDesign.
 *
 * THE HEADING TREE IS BUILT ONLY FROM EXPLICIT `headingStyles` (spec §5.1).
 * InDesign has no concept of a "heading level". It can only be derived from
 * paragraph styles, and which styles are headings is known by the operator,
 * not the document. Deriving the level from a style name or point size is
 * directly forbidden by spec §2: that is guessing, and it breaks on the
 * first document with a different naming convention.
 *
 * Without `headingStyles`, `headings: null` is returned — and this is NOT
 * an empty tree. `null` says "was not asked"; `[]` would say "looked and
 * did not find". Instead of a tree the operator gets `styleInventory` with
 * counts and pages of usage — exactly what they need to name the styles
 * themselves. The same shape as `spacingMode` in Phase 3: the default
 * measures everything and flags nothing.
 */

import type { LayoutMeasure } from "./types.js";

export interface StyleInventoryEntry {
  /**
   * Style's `.id` — the inventory key (round-1 review, I-4).
   *
   * Before the fix, `styleInventory` was keyed by `styleName`, and two
   * different used styles with the same name were merged into one entry
   * with a summed paragraph count and a combined page list — the very same
   * defect from probe H5 that Task 12 was made for as a whole was left
   * untouched here.
   */
  styleId: string;
  styleName: string;
  paragraphs: number;
  /** Pages of usage, in order of appearance, without repeats. */
  pages: string[];
  /** Point sizes that occur. `null` among them means mixed point size. */
  pointSizes: (number | null)[];
}

export interface HeadingNode {
  /** Style's position in `headingStyles`, 0 is the highest level. */
  level: number;
  styleName: string;
  /**
   * `.id` of the style that actually produced this heading.
   *
   * It travels alongside the name precisely because the name can be
   * AMBIGUOUS: in the working book two different styles were measured with
   * the same name «Основний текст L». When the operator named a level by
   * name, and there are two such styles in the document, the tree receives
   * paragraphs of both — and without this field there is no way to tell
   * them apart in the response. `styleInventory` has been keyed by `.id`
   * since the round-1 review (I-4); the migration had not reached here yet.
   */
  styleId: string;
  text: string;
  page: string | null;
  containerId: string;
  paragraphIndex: number;
}

export interface DocumentMap {
  docName: string;
  pageCount: number;
  pages: LayoutMeasure["pages"];
  spreads: LayoutMeasure["spreads"];
  stories: LayoutMeasure["stories"];
  frames: LayoutMeasure["frames"];
  styleInventory: StyleInventoryEntry[];
  /** `null` — `headingStyles` not given. NOT the same as an empty array. */
  headings: HeadingNode[] | null;
  /**
   * ЧОМУ ДВА ПЕРЕЛІКИ МОЖУТЬ РОЗІЙТИСЯ — сказано у відповіді, бо інакше це
   * читається як суперечність усередині одного виміру.
   */
  readThisFirst: string[];
}

export function buildMap(m: LayoutMeasure, headingStyles?: string[]): DocumentMap {
  const inventory = new Map<string, StyleInventoryEntry>();

  for (const p of m.paragraphs) {
    let entry = inventory.get(p.styleId);
    if (!entry) {
      entry = { styleId: p.styleId, styleName: p.styleName, paragraphs: 0, pages: [], pointSizes: [] };
      inventory.set(p.styleId, entry);
    }
    entry.paragraphs += 1;
    if (p.page !== null && !entry.pages.includes(p.page)) entry.pages.push(p.page);
    if (!entry.pointSizes.includes(p.actual.pointSize)) entry.pointSizes.push(p.actual.pointSize);
  }

  let headings: HeadingNode[] | null = null;
  if (headingStyles && headingStyles.length > 0) {
    headings = [];
    for (const p of m.paragraphs) {
      /*
       * BOTH `.id` AND the name are accepted — in exactly this order.
       *
       * Until now, matching used ONLY the name (`indexOf(p.styleName)`), and
       * this is the last unclosed part of the migration to `.id`:
       * `styleInventory` has been keyed by `.id` since the round-1 review
       * (I-4), but the parameter by which the operator names levels stayed
       * name-based. On a document with two identically-named styles (the
       * measured situation in the working book), name-based matching takes
       * paragraphs of BOTH, and there was no way to say "this one exactly".
       *
       * Switching to `.id` alone would be worse than the flaw: `.id` is an
       * opaque number, the operator names styles by name, and every
       * existing call would break. So the name remains the working path,
       * and `.id` is added as the EXACT way when the name is ambiguous;
       * `HeadingNode.styleId` says exactly what matched. `.id` is checked
       * first — if a document had a style whose NAME equals another
       * style's `.id`, the more precise key must win.
       */
      const byId = headingStyles.indexOf(p.styleId);
      const level = byId !== -1 ? byId : headingStyles.indexOf(p.styleName);
      if (level === -1) continue;
      headings.push({
        level,
        styleName: p.styleName,
        styleId: p.styleId,
        text: p.preview,
        page: p.page,
        containerId: p.containerId,
        paragraphIndex: p.paragraphIndex,
      });
    }
  }

  /*
   * `pages[].pageItems` І `frames[].page` ВІДПОВІДАЮТЬ НА РІЗНІ ПИТАННЯ.
   *
   * Перший — це `page.pageItems` самого InDesign: усе, що він відносить до
   * цієї сторінки. Другий — `parentPage` рамки, зведений через
   * `resolveContainerPage`. Для об'єкта, що лежить на монтажному столі й
   * налазить на сторінку, вони законно не збігаються: у переліку сторінки він
   * є, а `page` в нього `null`.
   *
   * Зміряно на живому документі 2026-08-26: рамка 24641 стоїть у
   * `pages[0].pageItems` і має `page: null` у `frames`. Це не суперечність
   * виміру — це дві різні властивості, але той, хто звіряє переліки, бачить
   * саме суперечність, якщо йому не сказати.
   */
  const readThisFirst = [
    "pages[].pageItems and frames[].page answer DIFFERENT questions and may disagree " +
      "for the same frame. pageItems is InDesign's own list of what it assigns to that " +
      "page; frames[].page is the frame's resolved parentPage. An object on the " +
      "pasteboard that overlaps a page appears in the first and has page: null in the " +
      "second. Neither is wrong — do not treat a mismatch as a measurement error.",
  ];

  return {
    readThisFirst,
    docName: m.docName,
    pageCount: m.pages.length,
    pages: m.pages,
    spreads: m.spreads,
    stories: m.stories,
    frames: m.frames,
    styleInventory: [...inventory.values()],
    headings,
  };
}

/**
 * The `usage` family: style usage. Pure TypeScript — does not talk to InDesign.
 */

import type { StyleUsage } from "../layout/summarise.js";
import type { ParagraphMeasure } from "../layout/types.js";
import { classifyUnusedStyles } from "./dependants.js";
import {
  DEFAULT_STYLE_NAMES,
  UNUSED_STYLE_CAVEAT_KEY,
  type DeclaredStyle,
  type StyleFinding,
} from "./types.js";

/**
 * How many paragraphs apply each style.
 *
 * Keyed by the style's .id, not by .name: two different styles with an identical
 * name are counted separately. Declared styles ALWAYS end up in the map,
 * even with zero: otherwise an unused style would disappear from the report, and "no
 * row" reads as "everything's fine." A style applied to a paragraph but
 * absent from the inventory is also counted — such a discrepancy is itself a
 * fact, and it cannot be hidden.
 *
 * The map's value type is `StyleUsage` from `layout/summarise.ts`, not its own
 * declaration: both were `{ styleName: string; paragraphs: number }`
 * verbatim, and TypeScript silently identified them (structural typing) —
 * exactly the trap the docstring in `layout/types.ts` warns against: "two
 * declarations would inevitably diverge" the moment someone changes one of the two.
 */
export function countUsage(
  styles: DeclaredStyle[],
  paragraphs: ParagraphMeasure[],
): Map<string, StyleUsage> {
  const counts = new Map<string, StyleUsage>();
  for (const s of styles) counts.set(s.id, { styleName: s.name, paragraphs: 0 });
  for (const p of paragraphs) {
    counts.set(p.styleId, {
      styleName: counts.get(p.styleId)?.styleName ?? p.styleName,
      paragraphs: (counts.get(p.styleId)?.paragraphs ?? 0) + 1,
    });
  }
  return counts;
}

export function detectUsage(
  styles: DeclaredStyle[],
  paragraphs: ParagraphMeasure[],
): StyleFinding[] {
  const counts = countUsage(styles, paragraphs);
  /* The classification is computed ONCE per call, not per style:
   * it computes a fixed point over the whole basedOn graph. */
  const classification = classifyUnusedStyles(
    styles,
    new Map([...counts].map(([id, u]) => [id, u.paragraphs])),
  );
  const findings: StyleFinding[] = [];

  for (const s of styles) {
    if (DEFAULT_STYLE_NAMES.indexOf(s.name) !== -1) continue;
    if ((counts.get(s.id)?.paragraphs ?? 0) > 0) continue;
    /*
     * This finding has NO ADDRESS — and that is exactly why Phase 5 does not use
     * LayoutFinding: there `page`, `containerId`, and `paragraphIndex` would have to be
     * left null and explained why.
     *
     * THE CAVEAT ABOUT TABLES AND FOOTNOTES STANDS IN THE FINDING'S TEXT ITSELF
     * (final-review I-4), not only in the measurement types. This is the phase's only
     * finding that directly invites a DESTRUCTIVE action — deleting a style — while
     * the measurement (`src/jsx/styles.jsx`) walks `story.paragraphs` and does not see
     * table cells or footnotes. A paragraph style used ONLY in a table
     * or footnote gives a firm "not applied to any paragraph" here —
     * a false claim, on the strength of which an operator would delete a live style. The limit was
     * documented only in `RangeMeasure` (`types.ts`), i.e. in a
     * neighboring family and in a file the operator would never reach.
     *
     * SHORT, NOT FULL (final-wave review, item 2): the full text with an
     * explanation of the mechanism repeated in EVERY finding gave 85% of
     * the whole response increase (measured: 1,785 B out of 2,103 B on a fixture with
     * five such findings). Here only the PROHIBITION itself remains, with the places
     * to look — while the explanation of the reason rides in the response ONCE, under
     * the `UNUSED_STYLE_CAVEAT_KEY` key.
     */
    /*
     * TWO DIFFERENT VERDICTS, and the choice between them is made by `classifyUnusedStyles`, not
     * this loop: "zero paragraphs" is the same in both, what differs is whether the
     * style holds up OTHER styles. A base deleted based on this report bumps its
     * children onto the grandparent and silently changes the layout (measured, see dependants.ts).
     */
    const base = classification.bases.get(s.id);
    findings.push({
      family: "usage",
      defect: base ? "style-unused-base" : "style-unused-leaf",
      styleName: s.name,
      /* .id of THIS EXACT style — the one that is UNUSED. Not counts.get(...), because
       * the count is keyed the same way, by s.id: here it's simply s.id directly. */
      styleId: s.id,
      page: null,
      containerId: null,
      paragraphIndex: null,
      detail: base
        ? `Style "${s.path}" is not applied to any paragraph, but it is a BASE style: ` +
          `styles built on it — ${String(base.dependantStyles)}, ` +
          `paragraphs under them — ${String(base.dependantParagraphs)}. ` +
          `Deleting it will re-parent them to the grandparent and change the layout — move the values into the descendants first.`
        : `Style "${s.path}" is declared but not applied to any body-text paragraph. ` +
          `Don't delete without checking tables and footnotes — ${UNUSED_STYLE_CAVEAT_KEY}.`,
    });
  }

  for (const p of paragraphs) {
    if (DEFAULT_STYLE_NAMES.indexOf(p.styleName) === -1) continue;
    findings.push({
      family: "usage",
      defect: "default-style-applied",
      styleName: p.styleName,
      /* .id of the built-in style applied to the paragraph itself. */
      styleId: p.styleId,
      page: p.page,
      containerId: p.containerId,
      paragraphIndex: p.paragraphIndex,
      detail: `Utility style "${p.styleName}" is applied in the layout.`,
    });
  }

  return findings;
}

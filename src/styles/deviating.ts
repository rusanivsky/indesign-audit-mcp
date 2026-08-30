/**
 * How many DIFFERENT paragraphs of a style deviate in at least something.
 *
 * `summariseByStyle` (`src/layout/summarise.ts`) counts deviating paragraphs PER
 * GROUP separately — and that is correct there. Phase 5's report ratio needs
 * a different number: a paragraph that overrides both indent and point size, counted
 * twice across two groups, has deviated ONCE. Without this merge the ratio
 * could exceed 100% — and precisely on the most common real case,
 * when a layout artist changed several properties together.
 */

import type { LayoutFinding } from "../layout/types.js";

/**
 * A paragraph's address in the document.
 *
 * The index (paragraphIndex) alone is not unique — it is local to the story
 * (containerId). Two paragraphs with the same index in different containers are different
 * paragraphs, so the address is formed by the pair (containerId, paragraphIndex).
 */
function paragraphKey(f: LayoutFinding): string {
  return `${f.containerId ?? ""}#${f.paragraphIndex ?? -1}`;
}

/**
 * Counts how many DIFFERENT paragraphs of each style deviate.
 *
 * The map's keys are styleId (not styleName), because a style is identified by its .id,
 * not by name: two different styles with an identical name can exist
 * in the document, and they must be counted separately.
 *
 * Findings where styleId === null or group === null are skipped,
 * since they are not about a paragraph mismatching its style.
 */
export function countDeviating(findings: LayoutFinding[]): Map<string, number> {
  // For each style we keep a set of unique paragraph addresses
  const seen = new Map<string, Set<string>>();

  for (const f of findings) {
    // Skip findings without a styleId or without a property group
    if (f.styleId === null || f.group === null) continue;

    // Get or create the set for this style
    let set = seen.get(f.styleId);
    if (!set) {
      set = new Set<string>();
      seen.set(f.styleId, set);
    }

    // Add the paragraph's address to the set
    set.add(paragraphKey(f));
  }

  // Convert the sets into counts (number of different paragraphs)
  const counts = new Map<string, number>();
  for (const [styleId, set] of seen) {
    counts.set(styleId, set.size);
  }

  return counts;
}

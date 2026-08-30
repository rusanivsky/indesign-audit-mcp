/**
 * Summary of style findings. Pure TypeScript.
 *
 * WHY THE SUMMARY IS THE DEFAULT (spec §4.4). Being threshold-free doesn't save
 * you from volume. Per Phase 3 measurements, the user's book was never run
 * through a typesetting proofread; if the layout artist adjusted indents and
 * point sizes by hand, there will be thousands of overrides. A flat list of
 * thousands of findings is as unusable as a list with a threshold picked out of
 * thin air would be: the tool would be technically correct and practically
 * useless.
 *
 * The shape is the same as `spacingMode: "survey"` from Phase 3, but the REASON
 * IS DIFFERENT: there the unknown was the threshold, here it's the volume.
 *
 * THE UNIT OF COUNT IS THE PARAGRAPH, NOT THE FINDING. A paragraph with both
 * `firstLineIndent` and `leftIndent` overridden produces two findings, but it's
 * one rejected paragraph. Counting findings would double-count exactly where
 * the layout artist changed several indents together — i.e. in the most common
 * real-world case.
 */

import type { LayoutFinding, PropertyGroup } from "./types.js";

/**
 * Why a group wasn't compared.
 *
 * - `unavailable` — the DECLARED value is unavailable (there's no reference,
 *   nothing to compare against);
 * - `mixed` — a reference exists, but the actual value is mixed within the
 *   paragraph;
 * - `character-style` — the group was muted by an applied character style
 *   (spec §7.1, rule 1).
 *
 * The third reason exists because rule 1 justifies the absence of a FINDING,
 * but not the absence of ACCOUNTING. Without it, a paragraph with a character
 * style would vanish from the report in three of six groups without a trace,
 * and the operator would read `groups: []`, `notCompared: []` as "no
 * deviations" — when in fact half the groups were never checked at all. That
 * is exactly what the phase's core constant forbids (spec §3): "what hasn't
 * been compared is not clean".
 */
export type NotComparedReason = "mixed" | "unavailable" | "character-style";

export interface NotComparedTally {
  styleId: string;
  styleName: string;
  group: PropertyGroup;
  reason: NotComparedReason;
  count: number;
}

/**
 * A cap on the number of DISTINCT (property, value) pairs within a single
 * group of a single style (final review, I-6).
 *
 * `values` grows for EVERY new pair — there was no cap here by construction,
 * and `styles_audit` has no `pages` parameter and always walks the whole
 * document. It only takes a style applied to a thousand paragraphs with
 * indents tweaked by hand differently for one report line to produce a
 * thousand entries. The measured 9,187 B default response is a fixture for 9
 * pages; it says nothing about 198 pages.
 *
 * THE NUMBER IS NOT MEASURED, and that's stated outright. 20 is deliberately
 * STRICTER than 50 (`MAX_DETAIL_ITEMS`), because this cap applies not once per
 * response but per (style, group) pair: with 51 styles and 6 groups, even 20
 * entries each is up to 6,120 lines. `values` here is a survey slice of "which
 * values occur", not an address listing; for addresses the operator goes to
 * `detail`, which has its own cap. The truncation is named via
 * `valuesTruncated`, never silent.
 */
export const MAX_GROUP_VALUES = 20;

export interface GroupSummary {
  group: PropertyGroup;
  /** How many PARAGRAPHS deviate, not how many findings. */
  deviating: number;
  /**
   * The actual values and how many findings for each, in ORDER OF FIRST
   * APPEARANCE. Truncated to `MAX_GROUP_VALUES` — see `valuesTruncated`.
   *
   * The order stays "by appearance" rather than "by descending count" on
   * purpose: sorting would change the field's existing contract, and silently
   * changing the order where the operator is used to reading the first value as
   * the first one encountered is the same category of quiet lie the cap was
   * written against. The consequence is named: the pairs ENCOUNTERED LATER are
   * truncated, not the rarest ones.
   */
  values: { property: string; actual: string; count: number }[];
  /** Present ONLY when there really were more pairs than the cap. */
  valuesTruncated?: { shown: number; total: number };
}

/** Style usage. The name travels alongside, because it's no longer the key. */
export interface StyleUsage {
  styleName: string;
  paragraphs: number;
}

export interface StyleSummary {
  styleId: string;
  styleName: string;
  paragraphs: number;
  groups: GroupSummary[];
  notCompared: { group: PropertyGroup; reason: NotComparedReason; count: number }[];
}

/** Paragraph address — the key for counting "how many paragraphs", not "how many findings". */
function paragraphKey(f: LayoutFinding): string {
  return `${f.containerId ?? ""}#${f.paragraphIndex ?? -1}`;
}

export function summariseByStyle(
  findings: LayoutFinding[],
  usage: Map<string, StyleUsage>,
  notCompared: NotComparedTally[],
): StyleSummary[] {
  const byId = new Map<string, StyleSummary>();
  /* style id → group → set of paragraph addresses */
  const paragraphsSeen = new Map<string, Map<PropertyGroup, Set<string>>>();
  /*
   * How many DISTINCT (property, value) pairs occurred in each group — counted
   * ALWAYS, even once the pair itself no longer fits into `values` because of
   * the cap. Without this set, `valuesTruncated.total` would have to be derived
   * from the length of the truncated array, i.e. lie about the very number the
   * field exists for.
   */
  const valueKeysSeen = new Map<GroupSummary, Set<string>>();

  for (const [styleId, u] of usage) {
    byId.set(styleId, { styleId, styleName: u.styleName, paragraphs: u.paragraphs, groups: [], notCompared: [] });
    paragraphsSeen.set(styleId, new Map());
  }

  for (const f of findings) {
    if (f.styleId === null || f.group === null) continue;
    let summary = byId.get(f.styleId);
    if (!summary) {
      summary = { styleId: f.styleId, styleName: f.styleName ?? "", paragraphs: 0, groups: [], notCompared: [] };
      byId.set(f.styleId, summary);
      paragraphsSeen.set(f.styleId, new Map());
    }

    let group = summary.groups.find((g) => g.group === f.group);
    if (!group) {
      group = { group: f.group, deviating: 0, values: [] };
      summary.groups.push(group);
      valueKeysSeen.set(group, new Set());
    }

    const seenForStyle = paragraphsSeen.get(f.styleId)!;
    let seen = seenForStyle.get(f.group);
    if (!seen) {
      seen = new Set();
      seenForStyle.set(f.group, seen);
    }
    seen.add(paragraphKey(f));
    group.deviating = seen.size;

    const actual = String(f.actual);
    valueKeysSeen.get(group)!.add(`${f.property}|${actual}`);
    const value = group.values.find((v) => v.property === f.property && v.actual === actual);
    if (value) value.count += 1;
    /* Cap I-6: a new pair is only added while there's room. Pairs already
     * added keep being counted — the LISTING is truncated, not the accounting
     * of what's already in it. `valueKeysSeen` above remembers the total. */
    else if (group.values.length < MAX_GROUP_VALUES) {
      group.values.push({ property: f.property, actual, count: 1 });
    }
  }

  /* The truncation is named ONCE, at the end, and only when it actually
   * happened (the same conditional pattern as `detailTruncated` in
   * `src/tools/styles.ts` and `candidatesTruncated` in the planner). */
  for (const [group, keys] of valueKeysSeen) {
    if (keys.size > group.values.length) {
      group.valuesTruncated = { shown: group.values.length, total: keys.size };
    }
  }

  for (const nc of notCompared) {
    const summary = byId.get(nc.styleId);
    if (!summary) continue;
    summary.notCompared.push({ group: nc.group, reason: nc.reason, count: nc.count });
  }

  return [...byId.values()];
}

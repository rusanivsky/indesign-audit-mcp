/**
 * Task 6. Override detector: paragraph vs. its own declared style.
 * Pure TypeScript — never touches InDesign.
 */

/**
 * Tolerance for comparing numbers in points.
 *
 * MEASURED (`docs/measured-facts-phase4.md`, Question 1), not calibrated:
 * of the document's 2990 paragraphs, 2981 give `delta === 0` bit-for-bit, and
 * nonzero discrepancies below 0.01 pt — exactly zero samples. There is no
 * noise band here on which a calibrated ε could be built: a paragraph either
 * matches the style exactly, or diverges immediately by an amount exceeding
 * 0.01 pt (a real override). This is exactly the case where the probe showed
 * exact equality.
 *
 * Question 5 of the same file proposes 0.01 pt as its OWN probe's
 * exploratory threshold for estimating volume — and explicitly warns that
 * this number does not carry over as a product constant into any other
 * file. Carrying it over here would mean ignoring that warning for a number
 * that calibrates nothing for `firstLineIndent` (there's no noise) and was
 * never measured at all for the other properties. Hence 0 here, backed by
 * measurement, not 0.01 as a default.
 *
 * QUESTION 1 ITSELF — the one this comment relies on — separately calls
 * 0.01 pt a "safe, conservative choice": on the measured document no real
 * match would fall into the uncertainty zone, and no real override would be
 * missed. This recommendation was CONSIDERED AND REJECTED, not overlooked:
 * it contradicts Question 5's own warning in that same file (the threshold
 * is exploratory, not for carrying over), and 0.01 pt swallows a real
 * override silently (a discrepancy in millimeters, 0.005 pt), whereas 0
 * fails loudly. Between "safe for this document" and "honest about the
 * measurement's limit," the latter was chosen.
 *
 * THE LIMIT OF THIS DECISION, named honestly: Question 1 measured noise only
 * for `firstLineIndent`. For the remaining numeric properties (`leftIndent`,
 * `rightIndent`, `spaceBefore`, `spaceAfter`, `pointSize`, `leading`,
 * `tracking`) ε = 0 is a CARRYOVER of one property's measurement onto the
 * others, not a measurement of each individually. If on another document one
 * of these properties produces noise below zero... more precisely, produces
 * a nonzero discrepancy that should be ignored — ε = 0 will fail LOUDLY (the
 * report floods with findings, visible immediately), rather than silently
 * swallowing a real override. A silent shortfall is worse than a loud
 * excess: values entered in millimeters produce odd points
 * (1 mm = 2.834645669 pt), and a 0.005 pt discrepancy is entirely real — a
 * 0.01 pt threshold would swallow it silently.
 */
export const EPSILON_PT = 0;

import type { NotComparedReason, NotComparedTally, StyleUsage } from "./summarise.js";
import { GROUP_PROPERTIES, type LayoutFinding, type ParagraphMeasure, type PropertyGroup, type StyleValues } from "./types.js";

export interface OverrideOptions {
  /**
   * Count master-page paragraphs.
   *
   * THE MASTER-PAGE POLICY IS DECLARED HERE, IN THE DETECTOR ITSELF, NOT IN
   * THE HANDLER ABOVE — this closes a Phase 3 debt item (spec §8). There,
   * `isMaster` was filtered by the Task 12 handler, so the detector taken on
   * its own silently counted running heads as ordinary text, and none of its
   * own tests caught this.
   *
   * Default `false`: a running head on a master diverges from the paragraph
   * style by construction, and without the filter every master would
   * produce findings the operator can't and shouldn't fix.
   */
  includeMasters?: boolean;
}

export interface OverrideResult {
  findings: LayoutFinding[];
  notCompared: NotComparedTally[];
  /** How many paragraphs EACH style has — the summary's denominator. Keyed by the style's `.id`. */
  paragraphCounts: Map<string, StyleUsage>;
}

/**
 * Groups muted by an applied character style (spec §7.1, rule 1).
 *
 * A character style legitimately changes font, weight, size, and tracking —
 * that's its purpose. It cannot change indents or justification: those are
 * paragraph-level. So exactly these three groups are muted, not all of them:
 * otherwise a paragraph with a single italicized word would become invisible
 * to the indent audit.
 *
 * "Muted" here means "produces no finding," NOT "doesn't exist." Every muted
 * group is accounted for in `notCompared` with reason `character-style` —
 * see `NotComparedReason` in `summarise.ts`.
 */
const CHARACTER_STYLE_GROUPS: PropertyGroup[] = ["sizes", "font", "tracking"];

/** Characters with which the layout artist substitutes the list marker. */
const MANUAL_BULLETS = ["-", "–", "—", "•", "*", "·"];

function differs(declared: unknown, actual: unknown): boolean {
  if (typeof declared === "number" && typeof actual === "number") {
    return Math.abs(declared - actual) > EPSILON_PT;
  }
  return declared !== actual;
}

function groupOf(property: keyof StyleValues): PropertyGroup {
  for (const [group, props] of Object.entries(GROUP_PROPERTIES)) {
    if (props.includes(property)) return group as PropertyGroup;
  }
  throw new Error(`Property ${property} does not belong to any group — GROUP_PROPERTIES is incomplete.`);
}

/**
 * Flags paragraphs that diverge from their own declared paragraph style.
 *
 * Three rules, without which the detector lies (spec §7.1):
 * 1. a character style mutes exactly `sizes`, `font`, `tracking` — a
 *    legitimate divergence, not an override; but the muted group goes into
 *    `notCompared` with reason `character-style`, not vanish without a trace;
 * 2. a mixed or unavailable value (`null` on either side of the comparison)
 *    is a separate `notCompared` category, not a finding;
 * 3. numbers are compared via `EPSILON_PT`, strings exactly.
 */
export function detectOverrides(
  paragraphs: ParagraphMeasure[],
  opts: OverrideOptions = {},
): OverrideResult {
  const findings: LayoutFinding[] = [];
  const paragraphCounts = new Map<string, StyleUsage>();
  /* style id|group|reason → count */
  const notComparedTally = new Map<string, NotComparedTally>();

  const tallyNotCompared = (
    styleId: string,
    styleName: string,
    group: PropertyGroup,
    reason: NotComparedReason,
  ) => {
    const key = `${styleId}|${group}|${reason}`;
    const existing = notComparedTally.get(key);
    if (existing) existing.count += 1;
    else notComparedTally.set(key, { styleId, styleName, group, reason, count: 1 });
  };

  for (const p of paragraphs) {
    if (p.isMaster && !opts.includeMasters) continue;

    const existingUsage = paragraphCounts.get(p.styleId);
    if (existingUsage) existingUsage.paragraphs += 1;
    else paragraphCounts.set(p.styleId, { styleName: p.styleName, paragraphs: 1 });

    /* Groups already accounted for as "not compared" for THIS paragraph — so a
     * paragraph with two mixed properties from the same group isn't counted
     * twice. */
    const countedGroups = new Set<PropertyGroup>();

    for (const property of Object.keys(GROUP_PROPERTIES).flatMap(
      (g) => GROUP_PROPERTIES[g as PropertyGroup],
    )) {
      const group = groupOf(property);

      /* A character style mutes the group — but it still needs to be ACCOUNTED FOR.
       * Rule 1 justifies the absence of a finding, not the absence of
       * accounting: without this line, a paragraph with a character style
       * would vanish from the report in three of the six groups without a
       * trace, and `groups: []` alongside `notCompared: []` would read as
       * "no divergences." The same `countedGroups` as below — so the
       * paragraph isn't counted twice for two properties of the group. */
      if (p.hasCharacterStyleRuns && CHARACTER_STYLE_GROUPS.includes(group)) {
        if (!countedGroups.has(group)) {
          countedGroups.add(group);
          tallyNotCompared(p.styleId, p.styleName, group, "character-style");
        }
        continue;
      }

      const declared = p.declared[property];
      const actual = p.actual[property];

      if (declared === null || actual === null) {
        if (!countedGroups.has(group)) {
          countedGroups.add(group);
          /* `declared` is checked FIRST, and this isn't ordering by taste.
           * A paragraph style cannot be mixed by construction (spec §3), so
           * an unavailable reference means exactly "value unavailable" —
           * regardless of what the actual value is. "Mixed" remains only for
           * the case where the reference EXISTS but the actual value
           * couldn't be read. */
          tallyNotCompared(p.styleId, p.styleName, group, declared === null ? "unavailable" : "mixed");
        }
        continue;
      }

      if (!differs(declared, actual)) continue;

      findings.push({
        id: `${p.containerId}#${p.paragraphIndex}:${property}`,
        family: "overrides",
        defect: "style-override",
        group,
        page: p.page,
        containerId: p.containerId,
        paragraphIndex: p.paragraphIndex,
        styleName: p.styleName,
        styleId: p.styleId,
        property,
        declared,
        actual,
        detail:
          `The paragraph deviates from the style "${p.styleName}": ${property} = ${actual}, ` +
          `the style declares ${declared}.`,
      });
    }

    /* A manual marker is a separate defect, and only in a paragraph of a
     * LIST style (spec §7.2). An ordinary paragraph starting with a dash is
     * direct speech, the most common construct in literary text. Without
     * this narrowing, the detector would produce a finding on every line of
     * dialogue. */
    const listType = p.declared.listType;
    if (listType !== null && listType !== "NO_LIST") {
      const head = p.preview.trimStart().charAt(0);
      if (MANUAL_BULLETS.includes(head)) {
        findings.push({
          id: `${p.containerId}#${p.paragraphIndex}:manual-bullet`,
          family: "overrides",
          defect: "manual-bullet",
          group: "lists",
          page: p.page,
          containerId: p.containerId,
          paragraphIndex: p.paragraphIndex,
          styleName: p.styleName,
          styleId: p.styleId,
          property: "manualBullet",
          declared: listType,
          actual: head,
          detail:
            `A paragraph of the list style "${p.styleName}" starts with the character "${head}" in the text — ` +
            `the bullet was typed by hand instead of using the list.`,
        });
      }
    }
  }

  return { findings, notCompared: [...notComparedTally.values()], paragraphCounts };
}

/**
 * Assembling the report: one row per style. Pure TypeScript.
 *
 * THE REPORT UNIT IS THE STYLE, AND THAT IS EXACTLY WHAT LIFTS THE PHASE'S THRESHOLD (spec §4.3).
 * `composition_audit` has a mandatory `spacingMode`, because no reference exists;
 * `layout_audit` has a survey form, because the VOLUME is unknown. Here neither
 * is needed: the book has 51 styles, not 2980 paragraphs, and the list fits
 * entirely.
 */

import { detectOverrides } from "../layout/overrides.js";
import { summariseByStyle, type GroupSummary, type NotComparedReason, type StyleUsage } from "../layout/summarise.js";
import type { LayoutFinding, PropertyGroup } from "../layout/types.js";
import { countDeviating } from "./deviating.js";
import { countUsage } from "./inventory.js";
import type { StylesMeasure } from "./types.js";

export interface StyleRow {
  /** The row key. The name is NOT a key — it can be non-unique in the document. */
  styleId: string;
  styleName: string;
  /**
   * Full path with folders. A disambiguator when the name is not unique (spec §3,
   * Tasks 12–14 amendment): two styles with the same name give two rows, and
   * only `styleId`/`path` tell the operator which one is meant.
   */
  path: string;
  basedOn: string | null;
  nextStyle: string | null;
  /**
   * How many paragraphs apply the style — from the FULL list, including
   * parent spreads. Answers the question "is the style used at all."
   *
   * NOT the ratio's denominator — see `paragraphsAudited`. A style used only on
   * parents (running head), gives a nonzero number here, even though none of these
   * paragraphs ever enters the `overrides` check.
   */
  paragraphs: number;
  /**
   * How many of `paragraphs` ENTERED the `overrides` check — i.e. how many
   * are not on parents (`detectOverrides` filters `isMaster` by
   * default, before generating findings). The ratio's DENOMINATOR.
   *
   * Deliberately SEPARATE from `paragraphs`, not derived from it by
   * a "before `countUsage`" filter: if `paragraphs` also counted only
   * non-parent ones, a style used exclusively on parents would show
   * `paragraphs: 0`, and `detectUsage` (the same `countUsage` count) would report
   * `style-unused` on it — the book's running-head style would look
   * completely undeclared in the layout. That is a lie worse than the one
   * this field fixes: both numbers must stay true at the same time.
   *
   * Equals 0 when the `overrides` family is disabled (`withOverrides: false`):
   * then NOTHING entered the check, and that is just as correct a zero as
   * a zero non-parent usage.
   */
  paragraphsAudited: number;
  /** How many DIFFERENT paragraphs deviate in at least something. A subset of `paragraphsAudited`. */
  deviating: number;
  /**
   * `deviating / paragraphsAudited`, or `null` when `paragraphsAudited === 0`.
   *
   * THE DENOMINATOR IS `paragraphsAudited`, NOT `paragraphs`. A style used only on
   * parents has `paragraphs > 0`, but none of these paragraphs went through the
   * check — counting the ratio against `paragraphs` would give `0 / 105 = 0`, and
   * the running-head style would look the healthiest in the document, though
   * in reality it was simply never compared. This is the SAME "0
   * instead of null" defect this field is written against — just via a third path
   * that no previous test covered.
   *
   * `null`, NOT 0 — and that is not pedantry. 0 out of 0 means "nobody applied it
   * (or nothing entered the check)," while 0 out of 134 (the measured `Пункт
   * чеклисту`) means "the style works as intended." Showing them the same way would
   * put the book's 14 unused styles in the same row as the document's
   * healthiest style.
   */
  ratio: number | null;
  groups: GroupSummary[];
  notCompared: { group: PropertyGroup; reason: NotComparedReason; count: number }[];
}

export interface StyleReport {
  rows: StyleRow[];
  /**
   * Raw override findings — for per-name `detail` in the tool.
   *
   * Returned from here rather than counted a second time in the tool: otherwise
   * `detectOverrides` would run twice on the same 2980 paragraphs, and the two
   * calls could diverge if someone ever passed different options.
   */
  overrideFindings: LayoutFinding[];
}

export interface ReportOptions {
  /** Whether to count the `overrides` family. Yes by default. */
  withOverrides?: boolean;
}

export function buildReport(measure: StylesMeasure, opts: ReportOptions = {}): StyleReport {
  const withOverrides = opts.withOverrides !== false;

  /*
   * `includeMasters` is NOT passed — i.e. the `false` default applies, and
   * parent paragraphs drop out of the count. This is deliberate.
   *
   * THE PREVIOUS VERSION OF THIS COMMENT WAS WRONG and nearly cost the
   * phase a silent defect. It claimed that "`styles_measure` does not measure
   * parents at all (`isMaster` is always false), so the filter here would mean
   * nothing." In fact `doc.stories` DOES CONTAIN the stories of parent
   * spreads — measured by Phase 4 (`docs/measured-facts-phase4.md`: 2998
   * paragraphs, of which non-master 2978) and covered by a test on the fixture
   * (`tests/integration/map.test.ts`). Had `isMaster` really stayed
   * hardcoded to `false`, the `includeMasters` flag would have stopped
   * filtering anything, and Phase 3's debt — a running head that deviates from
   * its paragraph style BY CONSTRUCTION — would have silently reopened.
   *
   * The policy regarding parents remains declared in the detector itself,
   * as Phase 4 closed it. Here it is simply not overridden.
   */
  const overrides = withOverrides
    ? detectOverrides(measure.paragraphs)
    : { findings: [] as LayoutFinding[], notCompared: [], paragraphCounts: new Map<string, StyleUsage>() };

  const summaries = summariseByStyle(overrides.findings, overrides.paragraphCounts, overrides.notCompared);
  /*
   * Usage is counted from the FULL list of paragraphs ALWAYS, regardless of
   * `withOverrides`: the inventory is a fact of the document, not a consequence of the
   * detector's work. Counting it from an empty list would show
   * every style as unused.
   */
  const usage = countUsage(measure.styles, measure.paragraphs);
  const deviating = countDeviating(overrides.findings);

  /*
   * EVERYTHING IS KEYED BY `styleId`. The name is just row content, for a human.
   *
   * Keying by name would merge two different styles with the same name into one
   * row, and the unused one would disappear from the report. This exact
   * trap is already closed in `countUsage`, `countDeviating`, and `summariseByStyle`
   * (Tasks 12, 3, 15) — here it is simply not reintroduced.
   */
  const meta = new Map(measure.styles.map((s) => [s.id, s]));
  const summaryById = new Map(summaries.map((s) => [s.styleId, s]));

  const ids = new Set<string>([...usage.keys(), ...summaryById.keys()]);
  const rows: StyleRow[] = [];

  for (const id of ids) {
    const u = usage.get(id);
    const paragraphs = u?.paragraphs ?? 0;
    /*
     * `overrides.paragraphCounts` is a READY number of non-master paragraphs: `detectOverrides`
     * itself fills it AFTER the `isMaster` filter (`overrides.ts`,
     * `if (p.isMaster && !opts.includeMasters) continue;` sits BEFORE the line
     * that increments `paragraphCounts`). So this is not an approximation — it is exactly
     * the subset of `paragraphs` that actually reached the comparison, and it is exactly
     * what `deviating` uses (findings are also generated only for these paragraphs).
     * When `withOverrides: false`, the map is empty — `paragraphsAudited` correctly
     * comes out 0 for every style.
     */
    const paragraphsAudited = overrides.paragraphCounts.get(id)?.paragraphs ?? 0;
    const dev = deviating.get(id) ?? 0;
    const m = meta.get(id);
    const s = summaryById.get(id);
    rows.push({
      styleId: id,
      /*
       * The name is taken from the inventory; for a "ghost" (a style used but
       * absent from the inventory) — from the usage count, which remembered the name
       * from the paragraph. An empty string remains the last fallback and
       * means "no name found," not "a nameless style."
       */
      styleName: m?.name ?? u?.styleName ?? s?.styleName ?? "",
      /*
       * The fallback chain is DELIBERATE: by declared style (`m?.path`), and for
       * a "ghost" — by the PARAGRAPH's name (`u?.styleName`), because a style outside
       * the inventory has no path at all — nobody declared the folders it
       * could be made of. An empty string is the last fallback,
       * for when even the name is missing.
       */
      path: m?.path ?? u?.styleName ?? "",
      basedOn: m?.basedOn ?? null,
      nextStyle: m?.nextStyle ?? null,
      paragraphs,
      paragraphsAudited,
      deviating: dev,
      /*
       * THE DENOMINATOR IS `paragraphsAudited`, NOT `paragraphs`. `null` when nothing
       * entered the check: `paragraphsAudited === 0` covers both
       * an unused style (0 of 0) and a style used only on parents (paragraphs
       * > 0, but paragraphsAudited 0), and a disabled `overrides` family (the map
       * empty for everyone). A zero here would read as "checked and clean."
       */
      ratio: paragraphsAudited === 0 ? null : dev / paragraphsAudited,
      groups: s?.groups ?? [],
      notCompared: s?.notCompared ?? [],
    });
  }

  return { rows: rows.sort((a, b) => b.paragraphs - a.paragraphs), overrideFindings: overrides.findings };
}

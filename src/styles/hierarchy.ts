/**
 * The `hierarchy` family: paragraph style inheritance chains (`basedOn`) and
 * pairs of styles that are indistinguishable by the measured property set. Pure
 * TypeScript — does not talk to InDesign.
 *
 * CHAINS ARE RESOLVED BY `id`, NEVER BY NAME. Measured with probe `H5`: 6
 * of the book's styles declare `basedOn` with an identical name, and there are
 * two styles with that name in the document (different folders). Five references
 * lead to one style, the sixth — to the other. Resolving by name is wrong in 1 case
 * out of 6, and that is exactly why the input here is `basedOnId`, not `basedOn`.
 *
 * TWO DIFFERENT KINDS OF ROOT. `basedOnId` gives `null` for a root style, but
 * the reason for that `null` is measured to differ for the two built-in styles: one throws
 * an exception when reading `.basedOn` in InDesign, the other does not, but returns the
 * string `"undefined"`. Both cases have already been reduced to `null` by the measurement
 * (`styles.jsx`) before the data reaches here, so a `=== null` check is
 * enough here — the source of the discrepancy is named in the comment on
 * `DeclaredStyle.basedOnId` (`types.ts`), not here.
 *
 * `nextStyle` IS NOT PART OF THE DETECTOR. Measured: 47 of the book's 51 styles
 * point `nextStyle` at themselves, meaningful cases — 2. This is not "no
 * material for the family" — it is "the `hierarchy` family has no
 * `nextStyle` sub-family", so the field remains in `DeclaredStyle`, but no
 * detector in this file reads it.
 */

import type { DeclaredStyle, StyleFinding } from "./types.js";

/**
 * Ceiling on the number of steps along the `basedOnId` chain. The deepest measured
 * chain of the book is 4 levels; 50 is a deliberate margin, not a number fitted to
 * the measurement: the guard must work against ANY document, not just this one.
 */
export const MAX_CHAIN_STEPS = 50;

/**
 * Chains plus a LIST OF THOSE THAT HIT THE CEILING.
 *
 * Final review, minor item 3: `maxChainDepth` silently hit 50, and
 * the operator saw the exact same number both for a document with a chain of 50
 * levels and for one with a chain of 500. The same principle already
 * in effect for `detail` (truncation is stated, never silent) is carried
 * through here too: `truncated` lists the `id`s of styles whose chain was cut off by the
 * CEILING, not by a root or a cycle.
 */
export interface ChainResolution {
  chains: Map<string, string[]>;
  /** `.id` of styles whose chain was cut off by the `MAX_CHAIN_STEPS` ceiling. */
  truncated: string[];
}

/**
 * The `basedOnId` chain from a style to the root, by `id`.
 *
 * Two independent guards against looping, and both are needed: the set of
 * visited `id`s catches a cycle that returns to an already-passed style
 * (the shortest and most likely case — style A refers to B, B — to
 * A); the step ceiling is a backup safeguard in case a chain is built
 * that the visited set does not cover. A `basedOnId` that leads nowhere
 * (no style with that `id` among those passed in) cuts off the chain just as
 * silently as its absence — this is `[No Paragraph Style]` among the measured
 * causes of `null` (see the comment on `DeclaredStyle.basedOnId`), not a measurement
 * error.
 */
export function resolveChainsDetailed(styles: DeclaredStyle[]): ChainResolution {
  const byId = new Map<string, DeclaredStyle>();
  for (const s of styles) byId.set(s.id, s);

  const chains = new Map<string, string[]>();
  const truncated: string[] = [];

  for (const start of styles) {
    const chain: string[] = [start.id];
    const visited = new Set<string>([start.id]);
    let current = start;
    let steps = 0;

    while (current.basedOnId !== null && steps < MAX_CHAIN_STEPS) {
      const parent = byId.get(current.basedOnId);
      if (!parent) break; /* basedOnId leads nowhere — a cutoff, not a crash. */
      if (visited.has(parent.id)) break; /* a cycle — a cutoff without hanging. */

      chain.push(parent.id);
      visited.add(parent.id);
      current = parent;
      steps += 1;
    }

    /*
     * The cutoff is specifically by the CEILING, not by a root, a broken reference, or a cycle.
     * The check must repeat ALL THREE conditions for continuing the loop, because
     * "the ceiling triggered" means exactly one thing: had the steps not run out, the
     * traversal would have taken one more step.
     *
     * A DEFECT FOUND BY WAVE REVIEW AND PROVEN BY EXECUTION: the previous
     * version checked only `basedOnId !== null` and `byId.has(...)`, but not
     * `visited.has(...)`, even though the comment above it claimed it
     * repeated the loop conditions. The consequence is measured: a `basedOn` ring of
     * exactly 51 styles gave `truncated.length === 51` — all 51 reported "hit
     * the ceiling," even though the chain was traversed FULLY (length 51, nothing
     * lost), and it was stopped by the visited set, not the ceiling. A ring of
     * 60, meanwhile, is genuinely truncated by the ceiling (51 of 60 traversed) —
     * i.e. these two cases do need to be told apart, and it is exactly
     * `visited` that does it.
     *
     * The shape of the error is the same one the phase kept catching: a comment described
     * the intent, the code did not carry it out, and the test checked a case too
     * short (a cycle of two nodes) for the difference to show.
     */
    if (steps >= MAX_CHAIN_STEPS && current.basedOnId !== null) {
      const next = byId.get(current.basedOnId);
      if (next && !visited.has(next.id)) truncated.push(start.id);
    }

    chains.set(start.id, chain);
  }

  return { chains, truncated };
}

/**
 * A compatible form for those who need only the chains themselves. A thin wrapper,
 * not a second implementation: the single traversal lives in `resolveChainsDetailed`.
 */
export function resolveChains(styles: DeclaredStyle[]): Map<string, string[]> {
  return resolveChainsDetailed(styles).chains;
}

/**
 * Two styles whose declared value sets (`JSON.stringify(declared)`)
 * fully match.
 *
 * THE WORDING IS PART OF THE CONTRACT, NOT DECORATION. Measured: one of the two
 * groups found in the book — two different styles that declare the same
 * `justification` and the remaining 11 properties identically — is most likely NOT
 * a duplicate, but a pair of styles that the 12 properties of `declaredStyleValues` fail to
 * distinguish (font panel, colors, OpenType features and more remain
 * outside the measurement). A detector that called this a "duplicate" would, on this
 * book, have lied at least once out of two, so that word and its
 * derivatives ("duplicate", "copy", "clone", "identical", "the same") are deliberately
 * kept out of here — only "indistinguishable by N properties" with a list of these
 * properties, so a human can decide for themselves whether it is a duplicate or a blind
 * spot of the measurement. Specific style names are deliberately not named here:
 * books and the style names in them will change, but the module will not.
 */
function buildIndistinguishableFinding(group: DeclaredStyle[]): StyleFinding {
  const sample = group[0];
  if (!sample) throw new Error("an empty group cannot produce a finding");

  const properties = Object.keys(sample.declared);
  const paths = group.map((s) => s.path);

  return {
    family: "hierarchy",
    defect: "styles-indistinguishable",
    styleName: group.map((s) => s.name).join(" / "),
    /*
     * null is deliberate: the finding is about a GROUP (two or more styles at once, just as
     * styleName above — joined with " / "), not about one declared
     * style. There is no single .id here that would name "the same" style — see the
     * docstring of StyleFinding.styleId.
     */
    styleId: null,
    page: null,
    containerId: null,
    paragraphIndex: null,
    detail:
      `Styles "${paths.join("\", \"")}" are indistinguishable by ${properties.length} ` +
      `measured properties (${properties.join(", ")}): only the ` +
      `declared set of properties was compared, not the document as a whole.`,
  };
}

/**
 * A `basedOnId` that does not resolve to any style in the list.
 *
 * Unlike a root (`basedOnId === null`, measured and explained in
 * `DeclaredStyle`), this is a reference to an `id` that simply does not
 * exist among the passed-in styles — a separate finding, not a root.
 */
function buildMissingParentFinding(style: DeclaredStyle): StyleFinding {
  return {
    family: "hierarchy",
    defect: "based-on-missing",
    styleName: style.name,
    /* .id of the style WHOSE basedOnId leads nowhere — not .basedOnId (that one
     * doesn't point to any real style, which makes it unusable as an address). */
    styleId: style.id,
    page: null,
    containerId: null,
    paragraphIndex: null,
    detail:
      `Style "${style.path}" declares basedOnId "${String(style.basedOnId)}", ` +
      `which is not among the document's declared styles.`,
  };
}

/**
 * Two findings of the family: `styles-indistinguishable` (groups with identical
 * `JSON.stringify(declared)`) and `based-on-missing`. `nextStyle` is
 * deliberately absent here — see the comment at the top of the file.
 */
export function detectHierarchy(styles: DeclaredStyle[]): StyleFinding[] {
  const findings: StyleFinding[] = [];

  const byId = new Map<string, DeclaredStyle>();
  for (const s of styles) byId.set(s.id, s);

  for (const s of styles) {
    if (s.basedOnId !== null && !byId.has(s.basedOnId)) {
      findings.push(buildMissingParentFinding(s));
    }
  }

  /*
   * AN ASSUMPTION, NAMED EXPLICITLY: `JSON.stringify(s.declared)` as the group key
   * relies on a stable key order of the `declared` object. This is
   * safe precisely because `declared` always comes from ONE measurement
   * function (`IDMCP.declaredStyleValues`), which returns fields in the
   * same order every time. If `declared` is ever assembled differently — from
   * several sources or dynamically — this assumption needs to be re-checked.
   *
   * THE CONSEQUENCE OF BREAKAGE, given as a number, because without it the line above is
   * just a fact, and it's easy to read as "nothing terrible" (that is exactly how the review
   * deferred this item "for triage"). A broken assumption gives FALSE
   * LENIENCY, not a false finding: two genuinely indistinguishable styles
   * whose `declared` was assembled in a different key order will produce different
   * JSON strings, end up in DIFFERENT groups, each will remain length 1, and
   * the `continue` above will discard both. The family stays silent,
   * `styles-indistinguishable` does not appear — and silence is indistinguishable from "no
   * duplicates." This is the worst class of failure for an audit: a tool that reports
   * "clean" exactly where it should have reported otherwise. The danger is not
   * abstract — `Style Group 1/Основний текст L` and `Стилі книги/Основний текст L`
   * in the working book are exactly such a pair (see the `style-unused` session), and
   * deleting the wrong one of the two already cost 387 paragraphs landing in the exception once.
   *
   * A cheap guard, should the assumption ever become uncertain: sort the keys
   * when building the key (`JSON.stringify(s.declared, Object.keys(s.declared).sort())`).
   * Today that is an extra pass per style with no measured
   * grounds for it, so it is not done — but that is the change to make
   * here, not to go looking for a flaw in the detector.
   */
  const groups = new Map<string, DeclaredStyle[]>();
  for (const s of styles) {
    const key = JSON.stringify(s.declared);
    const existing = groups.get(key);
    if (existing) existing.push(s);
    else groups.set(key, [s]);
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    findings.push(buildIndistinguishableFinding(group));
  }

  return findings;
}

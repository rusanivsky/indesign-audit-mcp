import { runRules, type TypographyRule } from "./engine.js";
import { UK_RULES } from "./rules-uk.js";

/**
 * B4. Normalizing edit text in the context of the seam.
 *
 * Overrides the Phase 1 global constant ("new is written verbatim"). The user
 * wants a hyphen to become a dash when edits are applied, not as a separate pass.
 *
 * Why in CONTEXT, not in isolation: a double space at the junction of the edit and
 * existing text is only visible together with the neighboring characters. This is
 * exactly the artifact that possible-stray-space currently only warns about.
 */

export interface SeamNormalization {
  ruleId: string;
  title: string;
  before: string;
  after: string;
}

export interface SeamResult {
  /** The text that will actually land in the document. */
  writeText: string;
  /** What exactly changed compared to the `new` field. Empty — nothing. */
  normalizations: SeamNormalization[];
}

export function normalizeAtSeam(args: {
  contextBefore: string;
  newText: string;
  contextAfter: string;
  rules?: TypographyRule[];
}): SeamResult {
  const { contextBefore, newText, contextAfter } = args;
  if (newText.length === 0) return { writeText: "", normalizations: [] };

  /*
   * The seam does NOT run language rules — and the filter sits AFTER `args.rules`, not
   * only as a default: the seam has no language dimension at all (three strings, not
   * a container with `appliedLanguage` ranges), so there's nowhere to get the gate from.
   * Without this line, a corrector's edit inside a Russian quote would silently
   * get «проєкт» — exactly the silent overwrite of a foreign language that
   * all of Phase 11 was built against. The same conservative default already in effect
   * below for needs-review.
   */
  const rules = (args.rules ?? UK_RULES).filter((r) => r.language === undefined);
  const probe = contextBefore + newText + contextAfter;
  const ns = contextBefore.length;
  const ne = ns + newText.length;

  const matches = runRules(probe, rules)
    /* Matches entirely inside the context — the document's business, not this edit's. */
    .filter((m) => m.start < ne && m.end > ns)
    /*
     * B4/I3 (final review): questionable (needs-review) matches are NOT
     * applied here — this is the same conservative default already in effect in
     * typography_apply (src/tools/typography.ts). Without this filter the seam
     * would silently rewrite the edit's text by rules such as
     * rangeDashWords (ALWAYS needs-review — «Київ-Львів» can't be told apart from
     * a compound word automatically) or dashSeparator, downgraded near a digit
     * («067 - 123» — a number break, not a dash). What is questionable for
     * typography_apply must not sneak through another entry point into the
     * same record.
     */
    .filter((m) => m.confidence === "high")
    .sort((a, b) => a.start - b.start || b.end - a.end);

  const normalizations: SeamNormalization[] = [];
  let out = "";
  let cursor = ns;

  for (const m of matches) {
    if (m.start < cursor && m.end > cursor) {
      /* The match starts in the context and extends into the edit — take only the tail. */
    } else if (m.start < cursor) {
      continue;
    }

    /*
     * DEVIATION FROM THE BRIEF: the replacement is NOT placed unconditionally at m.start
     * (that produced an asymmetry — clipping from the document/edit spread to the right
     * of newText incorrectly attributed the surviving character to newText instead of
     * the context).
     * Instead, the replacement characters are clipped from BOTH ends proportionally to
     * how many characters of the ORIGINAL match fall outside [ns, ne) on each
     * side. This is symmetric for the left and right seam and gives an exact result:
     * the "extra" character (the one that came from the edit) disappears, and the
     * document's character stays outside writeText untouched.
     */
    const leftLen = Math.max(0, ns - m.start);
    const rightLen = Math.max(0, m.end - ne);
    const from = Math.min(leftLen, m.replacement.length);
    const to = Math.max(from, m.replacement.length - rightLen);
    const piece = m.replacement.slice(from, to);

    const overlapStart = Math.max(m.start, cursor);
    const overlapEnd = Math.min(m.end, ne);
    if (overlapEnd <= overlapStart && piece.length === 0 && m.end <= cursor) continue;

    out += probe.slice(cursor, overlapStart);
    const replaced = probe.slice(overlapStart, overlapEnd);
    if (replaced !== piece) {
      normalizations.push({
        ruleId: m.ruleId,
        title: m.title,
        before: m.before,
        after: m.after,
      });
    }
    out += piece;
    cursor = Math.max(cursor, overlapEnd);
  }

  out += probe.slice(cursor, ne);
  return { writeText: out, normalizations };
}

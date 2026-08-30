/**
 * W2. Re-measuring after a write — the sole reason a write tool has any
 * right to exist.
 *
 * A PHASE CONSTANT, ENFORCED BY MACHINE
 * ================================
 * Any fix RECOMPOSES THE PARAGRAPH, and often the following ones too: tracking
 * changes content width, a soft hyphen forbids splitting the word. So a defect
 * can be not removed but MOVED — to the next line, to the next paragraph, past the
 * frame seam. A report of "applied 12" without a re-measurement is not a report: it says
 * a write happened, and stays silent about whether things got better.
 *
 * Hence exactly three verdicts, and the third is exactly the one a lying report hides:
 *  - `resolved` — the finding that was fixed disappeared;
 *  - `still-present` — it remains (and the "before/after" numbers say whether it at least weakened);
 *  - `displaced` — the defect did NOT exist before the write, and after the write it does.
 *
 * WHAT EXACTLY COUNTS AS `displaced`, AND WHY SO BROADLY
 * ================================================
 * Any finding whose identifier was not in `before`. The identifier is
 * `findingId` (`finding.ts:30`), i.e. `defect:container:paragraph:line`, and it
 * contains THE LINE NUMBER WITHIN THE PARAGRAPH. So the same visual defect, having shifted
 * down a line, arrives here under a new key — and that's not a flaw of the key, but exactly
 * what needs to be shown: "disappeared from line 2, appeared on line 3" is a
 * relocation of the defect, not a fix.
 *
 * The scope of the re-measurement is set by the caller: `before` and `after` must be
 * made on THE SAME sample of pages and with the same detector parameters.
 * Otherwise a "new" finding would only mean "we measured a different spot." This function
 * cannot check that itself — it only sees the findings — so the condition is
 * declared here and enforced in `composition_apply`.
 *
 * WHAT'S NOT HERE: findings that were NOT applied and disappeared anyway. They aren't
 * `resolved` — nobody fixed them — and not `displaced`, because they aren't new.
 * The silence about them is deliberate: taking credit for someone else's disappearance would mean counting
 * our own credit for a recomposition we didn't order.
 */

import type { Finding } from "./types.js";

export interface Verification {
  findingId: string;
  outcome: "resolved" | "still-present" | "displaced";
  detail: string;
}

/** A number for the report: short, but without rounding into a lie. */
function n(v: number): string {
  return Number.isFinite(v) ? String(Number(v.toFixed(4))) : String(v);
}

export function verifyFixes(
  before: readonly Finding[],
  after: readonly Finding[],
  applied: readonly string[],
): Verification[] {
  const appliedSet = new Set(applied);
  const beforeIds = new Set(before.map((f) => f.id));
  const afterById = new Map(after.map((f) => [f.id, f]));
  const out: Verification[] = [];

  /* A duplicate in `applied` must not double the report line, and the same for a duplicate in
   * `before`: a finding's address is unique, so a repeat is call-site noise. */
  const reported = new Set<string>();

  for (const f of before) {
    if (!appliedSet.has(f.id) || reported.has(f.id)) continue;
    reported.add(f.id);
    const still = afterById.get(f.id);
    if (still === undefined) {
      out.push({
        findingId: f.id,
        outcome: "resolved",
        detail:
          `Defect "${f.defect}" on p. ${f.page} (container ${f.containerId}, paragraph ` +
          `${f.paragraphIndex}, line ${f.lineInParagraph}) is gone: there's no finding at this address ` +
          "after the write. Check the displaced lines below — the defect may have moved, not disappeared.",
      });
      continue;
    }
    out.push({
      findingId: f.id,
      outcome: "still-present",
      /* The "before/after" numbers aren't decoration: without them "remains" can't be told apart from
       * "remains, but half as weak," and those are different conclusions for the operator. */
      detail:
        `Defect "${f.defect}" on p. ${f.page} remained after the fix. ` +
        `Strength ${n(f.strength)} → ${n(still.strength)}, measured ${n(f.measured)} → ` +
        `${n(still.measured)}. If the proposal had a shortfall, this is expected, ` +
        "not a failure: tracking was deliberately short of the full deviation.",
    });
  }

  for (const f of after) {
    if (beforeIds.has(f.id) || reported.has(f.id)) continue;
    reported.add(f.id);
    out.push({
      findingId: f.id,
      outcome: "displaced",
      detail:
        `New defect "${f.defect}" on p. ${f.page} (container ${f.containerId}, paragraph ` +
        `${f.paragraphIndex}, line ${f.lineInParagraph}), which didn't exist before the write — ` +
        "the fix recomposed the text and moved the problem here. " +
        `Strength ${n(f.strength)}, measured ${n(f.measured)}.`,
    });
  }
  return out;
}

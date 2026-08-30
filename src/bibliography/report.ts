import { MIN_RECORDS_FOR_UNIFORMITY } from "./uniformity.js";
import type { Finding, SkippedParagraph, UniformityFact, UniformityVerdict } from "./types.js";

/**
 * The warning is mandatory, not optional (spec §0.2).
 *
 * `dash-separator` in src/typography/rules-uk.ts:92 produces a LONG dash
 * U+2014 with high confidence. On the index, `typography_apply` with it would
 * turn zone separators into em dashes: the wrong mark, a "fixed" look, and a
 * re-audit that would no longer complain. In prose the rule is right — it just
 * doesn't know it landed inside a bibliographic entry.
 */
export const DASH_SEPARATOR_WARNING =
  "Bibliographic records were found in the document. Do NOT apply the dash-separator rule " +
  "from typography_apply: it produces a long dash U+2014, while description zones require a short U+2013.";

export const HEADINGS_WARNING =
  "A global dash replacement will also hit section headings: the heading style can be inconsistent " +
  "on its own (in the 2022 issue «УКРАЇНА В …» has 4 long dashes and 7 short ones). This tool " +
  "does NOT check headings — but a replacement would reach them anyway.";

const NEXT_STEP =
  "Fixing bib-nbsp-* findings reflows the text. After fixing them, run " +
  "composition_audit: it will show which lines got looser.";

export const UNIFORMITY_SILENT_WARNING =
  `Uniformity was NOT measured: there are fewer records than ${MIN_RECORDS_FOR_UNIFORMITY}. ` +
  "The uniformity field is empty for EXACTLY THIS reason, not because everything is uniform: on a small " +
  "sample a \"dominant form\" is chance, not a structural error. " +
  "The rules still work at full strength: the standard sets the norm, not the sample.";

export interface RuleGroup {
  ruleId: string;
  title: string;
  basis: string;
  total: number;
  /** A homogeneity diagnosis next to the number — what makes a large report readable. */
  verdict: UniformityVerdict | null;
  samples: Finding[];
  /**
   * `sampleSize` is CAPPED, just like `samples` (finding I1 of the final
   * review). It used to hold the FULL list: on the book that's 14,432 objects
   * and 5.73 MB of compact JSON, and `ok()` (src/tools/shared.ts:9) serializes
   * it with indentation on top of that. Spec §8 exists exactly so the report
   * doesn't turn into an unreadable wall of text — and capping `samples`
   * without capping `needsReview` didn't achieve that goal at all.
   */
  needsReview: Finding[];
  /** The FULL count of needs-review in the group — so truncation isn't silent. */
  needsReviewTotal: number;
}

/**
 * The skipped paragraph: how many, and WHICH ONES exactly.
 *
 * Spec §4 requires `{ reason, count, samples }` and says plainly why: "A silent
 * sample reads as 'everything was checked'." The code reduced this to bare
 * numbers (finding I2 of the final review) — on the book, 6,927 paragraphs were
 * silently dropped, and there was no way to verify from the report that none of
 * them was a real entry.
 */
export interface SkippedGroup {
  reason: string;
  count: number;
  /** `sampleSize` is capped precisely so it can be reviewed BY EYE. */
  samples: SkippedParagraph[];
}

export interface BibliographyReport {
  records: number;
  unparsed: number;
  skipped: SkippedGroup[];
  uniformity: UniformityFact[];
  groups: RuleGroup[];
  warnings: string[];
  nextStep: string;
}

/**
 * Which homogeneity phenomenon applies to which rule. A rule can catch
 * several phenomena; the group's verdict is the weakest among its facts.
 */
const VERDICT_FOR: Record<string, string[]> = {
  "bib-zone-separator": ["zone-separator"],
  "bib-range-dash": ["page-range-dash", "year-range-dash"],
  "bib-nbsp-initials": ["initials-spacing"],
};

/**
 * Determine the weakest verdict among those passed in, in order:
 * systematic > scattered > mixed (mixed is the weakest).
 */
function weakestVerdict(verdicts: (UniformityVerdict | null)[]): UniformityVerdict | null {
  const valid = verdicts.filter((v): v is UniformityVerdict => v !== null);
  if (valid.length === 0) return null;
  if (valid.includes("mixed")) return "mixed";
  if (valid.includes("scattered")) return "scattered";
  return "systematic";
}

export function buildReport(input: {
  findings: Finding[];
  uniformity: UniformityFact[];
  skipped: SkippedParagraph[];
  records: number;
  unparsed: number;
  sampleSize: number;
}): BibliographyReport {
  const byRule = new Map<string, Finding[]>();
  for (const f of input.findings) {
    const list = byRule.get(f.ruleId) ?? [];
    list.push(f);
    byRule.set(f.ruleId, list);
  }

  const groups: RuleGroup[] = [...byRule.entries()]
    .map(([ruleId, list]) => {
      const confident = list.filter((f) => f.confidence === "high");
      const needsReview = list.filter((f) => f.confidence === "needs-review");
      const uniformityIds = VERDICT_FOR[ruleId];
      const facts =
        uniformityIds === undefined
          ? []
          : uniformityIds
              .map((id) => input.uniformity.find((u) => u.id === id))
              .filter((f): f is UniformityFact => f !== undefined);
      return {
        ruleId,
        title: list[0]?.title ?? ruleId,
        basis: list[0]?.basis ?? "",
        total: list.length,
        verdict: weakestVerdict(facts.map((f) => f.verdict)),
        samples: confident.slice(0, input.sampleSize),
        needsReview: needsReview.slice(0, input.sampleSize),
        needsReviewTotal: needsReview.length,
      };
    })
    .sort((a, b) => b.total - a.total);

  const byReason = new Map<string, SkippedParagraph[]>();
  for (const s of input.skipped) {
    const list = byReason.get(s.reason) ?? [];
    list.push(s);
    byReason.set(s.reason, list);
  }
  const skipped: SkippedGroup[] = [...byReason.entries()]
    .map(([reason, list]) => ({
      reason,
      count: list.length,
      samples: list.slice(0, input.sampleSize),
    }))
    .sort((a, b) => b.count - a.count);

  const warnings: string[] = [];
  /*
   * Homogeneity silence must be EXPLAINED (spec §6, finding I3). Without
   * this line, a short list gets a report indistinguishable from "everything is
   * homogeneous": `uniformity: []` in both cases.
   */
  if (input.records > 0 && input.records < MIN_RECORDS_FOR_UNIFORMITY) {
    warnings.push(UNIFORMITY_SILENT_WARNING);
  }
  if (input.records > 0) {
    warnings.push(DASH_SEPARATOR_WARNING);
    warnings.push(HEADINGS_WARNING);
  }
  if (input.unparsed > input.records * 0.1) {
    warnings.push(
      `Failed to parse ${input.unparsed} records out of ${input.records}. The rest of the numbers can't be trusted ` +
        "— check recordPattern and recordDiscriminator.",
    );
  }

  return {
    records: input.records,
    unparsed: input.unparsed,
    skipped,
    uniformity: input.uniformity,
    groups,
    warnings,
    nextStep: NEXT_STEP,
  };
}

/**
 * Diagnostic for uniformity of usage forms in bibliography records.
 *
 * This module does NOT decide what is correct — the standard sets the norm (spec §0.1).
 *
 * It answers a question the standard cannot see: is the defect SYSTEMATIC or
 * SCATTERED. The difference between «16,154 errors» and «one substitution
 * that fixes 16,154 spots» is the difference between an unmanageable report
 * and a five-minute job.
 *
 * Deriving the NORM from the document would be wrong, and the proof is
 * empirical: in the 2022 edition the majority use the dash, in 2024 the
 * hyphen. A single detector would give opposite verdicts.
 *
 * THE COUNTING UNIT is a usage, not a record. A record with two separators
 * of different forms adds one unit to EACH form: this directly mirrors the
 * standard's own measurements (16,154 hyphens) and the fix action (correct
 * each hyphen individually).
 */

import { EN_DASH, FOREIGN_DASHES, H, UK_UPPER } from "./chars.js";
import type { ParsedRecord, UniformityFact, UniformityVerdict } from "./types.js";

/**
 * The minimum sample of records for the statistical significance of a
 * uniformity estimate.
 * Fewer than 30 records is a small bibliography (an article's reference
 * list), where a "dominant form" would be luck, not a structural error.
 */
export const MIN_RECORDS_FOR_UNIFORMITY = 30;

/**
 * Threshold for a systematic error: if the dominant form is present in
 * >=95% of usages, then a report about the spread can be relied on as a
 * basis for work.
 */
const SYSTEMATIC = 0.95;

/**
 * Threshold for a scattered error: if the dominant form is present in >=80%
 * of usages, this is a scattered spread — an error dispersed across the
 * document that needs attention. Below this threshold — an indeterminate
 * mixture with no clear dominant form.
 */
const SCATTERED = 0.8;

/**
 * Probe descriptor — a regex and a function for extracting ALL forms from
 * text.
 * A probe returns an empty array if the phenomenon is absent from the record.
 */
interface Probe {
  id: string;
  /**
   * Returns the list of forms used in the record.
   * Empty array if there are no occurrences.
   * A single record can have several usages: the zone separator appears
   * before the imprint data, pages, and notes — and each usage counts
   * separately.
   */
  formsOf: (text: string) => string[];
}

/**
 * Zone separator: period + space + dash/hyphen + space.
 * H — the horizontal-space constant, which excludes `\r` and `\n`.
 * Captures the separator character itself, for classifying its form.
 */
const zoneSeqPattern = `\\.${H}([${EN_DASH}${FOREIGN_DASHES}])${H}`;

/**
 * Page range: С. + numbers + dash/hyphen + numbers.
 * Captures the range's separator character.
 */
const pageRangePattern = `С\\.${H}*\\d+([${EN_DASH}${FOREIGN_DASHES}])\\d+`;

/**
 * Year range: 19** or 20** + dash/hyphen + 19** or 20**.
 *
 * The lookbehind `(?<!\d)` and lookahead `(?!\d)` rule out the case where
 * a "year" is actually a fragment of a longer number: without them
 * "11999–20255" would give a false match of "1999–2025" inside the digit
 * run.
 *
 * Captures the range's separator character itself — its form is exactly
 * what we measure.
 */
const yearRangePattern = `(?<!\\d)(?:19|20)\\d\\d([${EN_DASH}${FOREIGN_DASHES}])(?:19|20)\\d\\d(?!\\d)`;

/**
 * Gap between initials: «А. Б.» or «А.Б.» with no space.
 * Captures the space itself (may be empty).
 * Uses UK_UPPER from chars.ts — the single source of character classes.
 *
 * The space is `${H}?`, not the literal `" ?"` (finding M2). The literal
 * didn't match U+00A0, meaning a pair ALREADY protected by a non-breaking
 * space simply didn't exist for the probe: in an edition protected halfway,
 * only the unprotected side would be counted, the dominant share would come
 * out to 100%, and the verdict would read `systematic` — the exact opposite
 * of what's actually there. `H` (`[^\S\r\n]`) covers a regular space,
 * U+00A0, and the narrow non-breaking space alike, so both forms enter the
 * count and the discrepancy between them becomes visible.
 */
const initialsPattern = `[${UK_UPPER}]\\.(${H}?)[${UK_UPPER}]\\.`;

/**
 * Helper function for extracting ALL matches of a regex.
 * Unlike `exec()`, which returns only the first match, this function
 * extracts ALL matches and resets `lastIndex`, avoiding the classic
 * pitfalls of global regexes.
 */
function captureAll(pattern: string, text: string, captureGroup: number): string[] {
  const regex = new RegExp(pattern, "gu");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    const form = m[captureGroup];
    if (form !== undefined) {
      out.push(form);
    }
  }
  return out;
}

/**
 * The uniformity probes guaranteed by the standard.
 * Each probe may or may not turn up in a given record — that's not a
 * defect; the defect is a mixture of VARIANTS of the form used.
 *
 * The counting unit is a usage: a record with two separators of different
 * forms adds one unit to EACH form.
 */
const PROBES: Probe[] = [
  {
    id: "zone-separator",
    formsOf: (t) => captureAll(zoneSeqPattern, t, 1),
  },
  {
    id: "page-range-dash",
    formsOf: (t) => captureAll(pageRangePattern, t, 1),
  },
  {
    id: "year-range-dash",
    formsOf: (t) => captureAll(yearRangePattern, t, 1),
  },
  {
    id: "initials-spacing",
    formsOf: (t) => captureAll(initialsPattern, t, 1),
  },
];

/**
 * Deriving the uniformity verdict from the dominant form's share.
 *
 * - If >=95% — systematic: an error in the source attribution or generator.
 * - If >=80% — scattered: a manually dispersed error.
 * - Otherwise — mixed: no clear dominant form, cause undetermined.
 */
function verdictFor(share: number): UniformityVerdict {
  if (share >= SYSTEMATIC) return "systematic";
  if (share >= SCATTERED) return "scattered";
  return "mixed";
}

/**
 * Measures the uniformity of usage forms across a segment of records.
 *
 * Algorithm:
 * 1. Checks the sample size: fewer than 30 records — not measured at all
 *    (the report must say that it stayed silent, and why — `report.ts`).
 * 2. For each probe:
 *    - Extracts ALL forms from each record (not just the first).
 *    - Counts each form's frequency across usages.
 *    - Determines the dominant form and its share.
 *    - Emits a verdict: systematic / scattered / mixed.
 *
 * @param parsed Array of parsed bibliography records.
 * @returns Array of uniformity facts for each probe that had an occurrence.
 */
export function measureUniformity(parsed: ParsedRecord[]): UniformityFact[] {
  /*
   * A small sample isn't measured at all. A "dominant form" from four
   * records is chance, and a bibliography list at the end of an article
   * falls exactly into this case. The rules still work: the norm comes
   * from the standard, not the sample.
   */
  if (parsed.length < MIN_RECORDS_FOR_UNIFORMITY) return [];

  const out: UniformityFact[] = [];

  for (const probe of PROBES) {
    // Counting usage-form frequencies.
    const counts = new Map<string, number>();
    for (const p of parsed) {
      // Extracting ALL forms from the record — one record can have several usages.
      const forms = probe.formsOf(p.record.text);
      for (const form of forms) {
        counts.set(form, (counts.get(form) ?? 0) + 1);
      }
    }

    // If there are no occurrences in the sample, this probe isn't applicable for this book.
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    if (total === 0) continue;

    // Sorting by frequency descending.
    const forms = [...counts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count);

    // Dominant share.
    const dominantShare = (forms[0]?.count ?? 0) / total;

    // Emitting the uniformity fact.
    out.push({
      id: probe.id,
      forms,
      dominantShare,
      verdict: verdictFor(dominantShare),
    });
  }

  return out;
}

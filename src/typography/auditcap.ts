/**
 * A cap on the `auditOnly` list in the `typography_audit` response.
 *
 * WHY. MEASURED on the working book 2026-08-16 (196 pages), with the response-size
 * profiler (`scripts/measure-response-size.mjs`, i.e. without a mirror):
 * the `typography_audit` response was 101,204 B, of which `auditOnly` was 66,738 B for
 * 398 records, i.e. 86%. The client truncates such a response, and along with the
 * tail of the list, `spelling2019` and `piv2019`, which come below it, disappear.
 * There was no cap at all: `groups` is capped by `sampleSize`, but this list
 * grew with every finding. After the cap, the same book, the same measuring tool:
 * **15,220 B** for the whole response, of which `auditOnly` is 3,918 B.
 *
 * WHY THE CAP IS PER KIND SEPARATELY, NOT SHARED. In this book all 398
 * findings are `empty-paragraph`, and there isn't a single `tab-indent`, so a shared
 * cap of "the first 50 in document order" would look flawless here while
 * hiding a defect that would trigger on a different document: a manuscript brought in from
 * Word gives the opposite distribution, and the one tab indent among hundreds of empty
 * paragraphs would silently drop out of the list. Same species of bug as with
 * `page.textFrames` in Phase 10: an instrument whose blind spot this document doesn't
 * expose.
 *
 * THE COUNTS STAY COMPLETE. `counts` is computed from the whole list before
 * the cut — it, not the named locations, is what answers "how many
 * are there". This tool does NOT FIX these findings (that's a decision about paragraph styles,
 * not about text), so the full list of locations isn't an input to any action.
 *
 * Pure TypeScript — makes no calls into InDesign.
 */

/**
 * A finding row weighs ≈168 B (66,738 B for 398 records), so two kinds at
 * 25 each is ≈8 KB. The number comes from MEASUREMENT, not from a ceiling.
 */
export const MAX_AUDIT_ONLY_PER_KIND = 25;

export interface AuditOnlyTruncation {
  kind: string;
  shown: number;
  total: number;
}

export interface CappedAuditOnly<T> {
  items: T[];
  /** Full counts per kind — regardless of how many rows are shown. */
  counts: Record<string, number>;
  /** Appears only when a truncation actually happened. */
  truncated?: AuditOnlyTruncation[];
}

/**
 * Keeps the first `maxPerKind` findings of EACH kind, preserving document
 * order. Does not sort or regroup: a cut is a filter, not a different
 * sequence, so the reader sees the same locations as without the cap, just
 * fewer of them.
 */
export function capAuditOnly<T extends { kind: string }>(
  findings: readonly T[],
  maxPerKind: number,
): CappedAuditOnly<T> {
  const counts: Record<string, number> = {};
  for (const f of findings) counts[f.kind] = (counts[f.kind] ?? 0) + 1;

  const taken: Record<string, number> = {};
  const items: T[] = [];
  for (const f of findings) {
    const already = taken[f.kind] ?? 0;
    if (already >= maxPerKind) continue;
    taken[f.kind] = already + 1;
    items.push(f);
  }

  /*
   * The order of the truncated rows follows the first appearance of a kind in the INPUT
   * list, i.e. the same order as in `counts`. Object keys in JS preserve
   * insertion order for string keys, and that's exactly what we rely on here: otherwise
   * two runs on the same data would give answers that differ only in
   * order, and no test would say which one is correct.
   */
  const truncated = Object.keys(counts)
    .filter((kind) => counts[kind]! > maxPerKind)
    .map((kind) => ({ kind, shown: taken[kind] ?? 0, total: counts[kind]! }));

  return truncated.length > 0 ? { items, counts, truncated } : { items, counts };
}

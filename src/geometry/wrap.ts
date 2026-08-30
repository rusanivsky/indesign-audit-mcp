/**
 * The `wrap` family.
 *
 * A LIMIT NAMED OUT LOUD: on the working book there is NO text wrap at
 * all — `textWrapMode = NONE` on all 965 elements, read with the correct
 * instrument (`page.allPageItems`), i.e. 100% coverage and a genuine zero.
 *
 * This is NOT the same situation as `runningHead` in Phase 6: there the
 * "no material" conclusion was wrong because of the INSTRUMENT
 * (`page.textFrames` couldn't see master frames). Here the instrument is
 * already fixed and sees everything.
 *
 * So the family is proven EXCLUSIVELY by the fixture and mutants. The book
 * doesn't exercise it at all, and that's recorded in the spec, in the
 * tool's report, and at the entry point — a user decision from 2026-08-15.
 *
 * A LIMIT NAMED OUT LOUD (Task 10b, Ruling 6): spec §7 names a THIRD family
 * detector — «wrap on an element that nothing actually wraps» (i.e. a
 * geometric intersection of an object's bounding box with a text frame with
 * no real effect on typesetting at all). It is DELIBERATELY NOT
 * IMPLEMENTED: a bounding-box intersection doesn't mean text actually
 * reaches the object — the text flow may route around it via frame
 * threading, the frame may be empty, the object may sit in a column the
 * text doesn't occupy. A reliable answer needs knowledge of text flow that
 * geometry alone doesn't provide — the same reason §4.3 of the spec gave up
 * on role-based intersections. The detector goes into the report's
 * `notMeasured` (Task 11), not here.
 */
import { comparePageNames, EPSILON, type GeometryFinding, type ItemMeasure } from "./types.js";

/** `null` means "the type doesn't support wrap", not "disabled". */
function hasWrap(item: ItemMeasure): boolean {
  return item.wrapMode !== null && !item.wrapMode.includes("NONE");
}

type Offsets = [number, number, number, number];

/**
 * Comparing wrap offsets via EPSILON — no exact equality.
 *
 * `<=`, not `<`: every other family in this phase treats `<= EPSILON` as a
 * match (`frame.ts` — side alignment, `anchored.ts` — rule tolerance). One
 * character of convention drift broke nothing, but it made the convention
 * itself unreliable, and that kind of thing costs you somewhere other than
 * where you left it.
 */
function offsetsEqual(a: Offsets, b: Offsets): boolean {
  return (
    Math.abs(a[0] - b[0]) <= EPSILON &&
    Math.abs(a[1] - b[1]) <= EPSILON &&
    Math.abs(a[2] - b[2]) <= EPSILON &&
    Math.abs(a[3] - b[3]) <= EPSILON
  );
}

function formatOffsets(o: Offsets): string {
  return `[${o[0]}, ${o[1]}, ${o[2]}, ${o[3]}]`;
}

interface OffsetGroup {
  offsets: Offsets;
  items: ItemMeasure[];
}

/**
 * Splitting the population by offset value, via EPSILON.
 *
 * Groups are ordered by the FIRST occurrence of a value — that's needed
 * only for deterministic tie-breaking below, not for choosing the
 * majority.
 */
function groupByOffsets(bucket: ItemMeasure[]): OffsetGroup[] {
  const groups: OffsetGroup[] = [];
  for (const item of bucket) {
    const offsets = item.wrapOffsets as Offsets;
    const hit = groups.find((g) => offsetsEqual(g.offsets, offsets));
    if (hit === undefined) groups.push({ offsets, items: [item] });
    else hit.items.push(item);
  }
  return groups;
}

export function detectWrap(items: ItemMeasure[]): GeometryFinding[] {
  const nonPrinting: string[] = [];
  const hidden: string[] = [];
  /** Populations: elements with the same wrapMode (not NONE) whose offsets must match. */
  const populations = new Map<string, ItemMeasure[]>();

  for (const item of items) {
    if (!hasWrap(item)) continue;
    if (!item.layerPrintable) nonPrinting.push(item.page);
    if (!item.layerVisible) hidden.push(item.page);

    if (item.wrapOffsets !== null) {
      const key = item.wrapMode as string;
      const bucket = populations.get(key);
      if (bucket) bucket.push(item);
      else populations.set(key, [item]);
    }
  }

  const out: GeometryFinding[] = [];
  if (nonPrinting.length > 0) {
    out.push({
      family: "wrap",
      defect: "wrap-on-nonprinting",
      pages: [...new Set(nonPrinting)].sort(comparePageNames),
      count: nonPrinting.length,
      value: "non-printable layer",
      detail: "The object will not print, but the text wraps around empty space.",
    });
  }
  if (hidden.length > 0) {
    out.push({
      family: "wrap",
      defect: "wrap-on-hidden",
      pages: [...new Set(hidden)].sort(comparePageNames),
      count: hidden.length,
      value: "hidden layer",
      detail: "The object is invisible, but the text wraps around empty space.",
    });
  }

  /*
   * Inconsistent wrap offsets: within ONE population (same wrapMode, not
   * NONE) the offsets must match. A population of a single element can't
   * be a finding by construction — a discrepancy needs at least two
   * different values.
   *
   * REPORT THE DEFECT, NOT THE POPULATION (branch review, I1). Before
   * 2026-08-15, `count` equaled the size of the ENTIRE population, and
   * `pages` listed all of its pages: with 300 wrapped elements and one
   * outlier, the tool said `count: 300` and gave 300 pages — pointing the
   * finger at the norm, not the violator. Now ONLY the ones that diverge
   * from the majority are counted, and the majority value itself is named
   * in `value`.
   *
   * THE MAJORITY is the LARGEST group of values, not the first element of
   * the array. Element order in the measurement is a property of
   * InDesign's traversal, and treating it as the norm would mean that with
   * 1 correct and 299 incorrect elements, the 299 correct ones would
   * become "incorrect". A tie (two groups of equal size) is resolved by
   * first occurrence — deterministically and deliberately: when there's no
   * norm, any choice is arbitrary, and the only thing that can be promised
   * here is reproducibility.
   */
  for (const bucket of populations.values()) {
    if (bucket.length < 2) continue;
    const groups = groupByOffsets(bucket);
    if (groups.length < 2) continue;

    let majority = groups[0]!;
    for (const g of groups) {
      if (g.items.length > majority.items.length) majority = g;
    }

    const deviating = bucket.filter((i) => !offsetsEqual(i.wrapOffsets as Offsets, majority.offsets));
    /* `groups.length >= 2` already guarantees non-emptiness, but a silent empty
     * finding would be worse than a crash, so the check stays explicit. */
    if (deviating.length === 0) continue;

    const pages = [...new Set(deviating.map((i) => i.page))].sort(comparePageNames);
    out.push({
      family: "wrap",
      defect: "wrap-offsets-inconsistent",
      pages,
      count: deviating.length,
      value:
        `${bucket[0]!.wrapMode}: majority ${formatOffsets(majority.offsets)} ` +
        `(${majority.items.length} of ${bucket.length}), deviating ${deviating.length}, ` +
        `e.g. ${formatOffsets(deviating[0]!.wrapOffsets as Offsets)}`,
      detail:
        "Elements with the same wrap mode have different " +
        "textWrapOffset values — the setting around them will be inconsistent. Pages and " +
        "the count are ONLY for the elements that deviate from the majority.",
    });
  }

  return out;
}

/**
 * Whether the document has even one element with REAL wrap (not `NONE`).
 *
 * NOT the same as «`inventoryWrap()` non-empty» (Task 12 fix round 2,
 * review): `NONE` is also an inventory entry (`wrapMode !== null`), so the
 * inventory CAN be full of `NONE` entries while the wrap family has no
 * material for a verdict at all. The working book is exactly this case:
 * `textWrapMode = NONE` on all 965 elements, `inventoryWrap()` returns
 * `[{mode:"NONE", count:965}]` (non-empty), and THE FAMILY HAS NO MATERIAL
 * — the old criterion `inventoryWrap().length === 0` would have stayed
 * silent about this exactly when silence is most dangerous.
 */
export function hasWrapMaterial(items: ItemMeasure[]): boolean {
  return items.some(hasWrap);
}

export function inventoryWrap(items: ItemMeasure[]): { mode: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (item.wrapMode === null) continue;
    counts.set(item.wrapMode, (counts.get(item.wrapMode) ?? 0) + 1);
  }
  return [...counts].map(([mode, count]) => ({ mode, count })).sort((a, b) => b.count - a.count);
}

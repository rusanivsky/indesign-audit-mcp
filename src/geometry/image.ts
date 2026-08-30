/**
 * The `image` family.
 *
 * Report unit — the PAIR "what was measured + BY WHAT it was measured", the same
 * contract that makes `preflight_document` honest: a raw result is misleading unless
 * it says how it was obtained.
 *
 * The family also closes a named preflight blind spot: the rule
 * `ADBE_ImageResolution` in the `[Basic]` profile is DISABLED, and preflight
 * honestly says so in every response, but cannot measure it.
 */
import {
  comparePageNames,
  type GeometryFinding,
  type ItemMeasure,
} from "./types.js";

export interface GraphicRow {
  page: string;
  kind: "raster" | "vector" | "unknown";
  linkName: string | null;
  linkStatus: string | null;
  /** In plain language: exactly what was measured, and by what. For vector — why there's no ppi. */
  measured: string;
  effectivePpi: number | null;
  actualPpi: number | null;
  scale: string;
}

/** Link status that InDesign considers normal. */
const LINK_OK = "NORMAL";

/**
 * Link status that is NOT a defect and does not go into findings.
 *
 * Embedded graphics can neither disappear from disk nor go stale — there's nothing
 * to act on. It's visible in the inventory (`linkStatus` is set on every row there),
 * so this isn't silence, but the absence of a verdict where none is needed.
 */
const LINK_EMBEDDED = "LINK_EMBEDDED";

/**
 * What each abnormal link status actually means.
 *
 * Before 2026-08-15 (branch review) EVERYTHING that wasn't `NORMAL` or
 * `LINK_OUT_OF_DATE` was labeled "File not found" — `LINK_MISSING`,
 * `LINK_INACCESSIBLE`, and `LINK_EMBEDDED` alike. These are three different states
 * with three different actions: find the file, fix access (volume not mounted, no
 * permissions), do nothing. The same label would send someone to look for a file
 * that is right where it should be.
 */
const LINK_DEFECTS: Record<string, { defect: string; detail: string }> = {
  LINK_OUT_OF_DATE: {
    defect: "image-link-stale",
    detail: "The file on disk changed after it was placed — the document has the old version.",
  },
  LINK_MISSING: {
    defect: "image-link-broken",
    detail: "File not found at the saved path — printing will yield a low-quality substitute or a blank.",
  },
  LINK_INACCESSIBLE: {
    defect: "image-link-inaccessible",
    detail:
      "The file exists, but it could not be read: the volume isn't mounted, there's no permission, or " +
      "the network drive is unavailable. This is NOT \"file not found\" — there's no need to search for it.",
  },
};

function graphics(items: ItemMeasure[]): ItemMeasure[] {
  /*
   * ЩО НЕ ДРУКУЄТЬСЯ, ТЕ НЕ Є ДЕФЕКТОМ ДРУКУ.
   *
   * `layerVisible`/`layerPrintable` міряються, але їх читав лише `wrap.ts`.
   * Тож макет-заготовка 72 ppi, покладена на непринтований довідковий шар,
   * давала `image-low-resolution` за будь-якого `minPpi`, а зламане
   * посилання на такому ж шарі — `link-missing`.
   * Обґрунтування політики — виміряне, у `src/color/types.ts`: вісім
   * елементів форзаца в 100 % ціану на непринтованому шарі, і «детектор без
   * цього поля дав би вісім порушень на правильно зібраному файлі».
   *
   * Одне місце на обидва детектори: вони обидва ходять саме сюди.
   */
  return items.filter((i) => i.graphic !== null && i.layerVisible && i.layerPrintable);
}

/**
 * Low resolution.
 *
 * `minPpi` — A PARAMETER WITH NO DEFAULT: 300 for offset and 150 for digital —
 * a print shop's decision, not the tool's.
 *
 * Vector is skipped UNCONDITIONALLY. This isn't "no data" — it's a property:
 * PDF/EPS has no resolution at all, and requiring 300 ppi from them makes no sense.
 */
export function detectResolution(items: ItemMeasure[], minPpi: number): GeometryFinding[] {
  const groups = new Map<string, { pages: string[]; count: number }>();

  for (const item of graphics(items)) {
    const g = item.graphic!;
    if (g.kind !== "raster") continue;
    if (g.effectivePpi === null) continue;

    /* By the SMALLER of the two axes: non-uniform scaling gives different ppi along x and
     * y, and the average would hide a defect visible only on one axis. */
    const worst = Math.min(g.effectivePpi[0], g.effectivePpi[1]);
    if (worst >= minPpi) continue;

    const key = String(Math.round(worst));
    const rec = groups.get(key) ?? { pages: [], count: 0 };
    rec.count += 1;
    if (!rec.pages.includes(item.page)) rec.pages.push(item.page);
    groups.set(key, rec);
  }

  return [...groups].map(([value, rec]) => ({
    family: "image" as const,
    defect: "image-low-resolution",
    pages: [...rec.pages].sort(comparePageNames),
    count: rec.count,
    value: `${value} ppi`,
    detail: `Below the named threshold of ${minPpi} ppi.`,
  }));
}

/** Link states — DIFFERENT defects, because they call for different actions. */
export function detectLinks(items: ItemMeasure[]): GeometryFinding[] {
  /* Key — link STATE; inside — file name. Grouping by state, rather than
   * by "broken / stale", lets a new InDesign state get its own line instead
   * of someone else's label. */
  const byStatus = new Map<string, Map<string, { pages: string[]; count: number }>>();

  for (const item of graphics(items)) {
    const g = item.graphic!;
    /* Graphics with no link at all — that's not a "broken link". */
    if (g.linkStatus === null) continue;
    if (g.linkStatus === LINK_OK) continue;
    if (g.linkStatus === LINK_EMBEDDED) continue;

    const perName = byStatus.get(g.linkStatus) ?? new Map();
    const key = g.linkName ?? "(unnamed)";
    const rec = perName.get(key) ?? { pages: [], count: 0 };
    rec.count += 1;
    if (!rec.pages.includes(item.page)) rec.pages.push(item.page);
    perName.set(key, rec);
    byStatus.set(g.linkStatus, perName);
  }

  const out: GeometryFinding[] = [];
  for (const [status, perName] of byStatus) {
    /* An unknown state is NOT labeled by guesswork: the line names exactly what
     * InDesign said, verbatim. Guessing "file not found" would send someone to look
     * for a file that is right where it should be. */
    const known = LINK_DEFECTS[status];
    const defect = known?.defect ?? "image-link-abnormal";
    const detail =
      known?.detail ??
      `The link is in state ${status} — InDesign doesn't consider it normal. ` +
        "The tool doesn't interpret unknown states — it names the state as-is.";
    for (const [value, rec] of perName) {
      out.push({
        family: "image",
        defect,
        pages: [...rec.pages].sort(comparePageNames),
        count: rec.count,
        value,
        detail,
      });
    }
  }
  return out;
}

/** Inventory without a verdict: what exists, and by what it was measured. */
export function inventoryGraphics(items: ItemMeasure[]): GraphicRow[] {
  return graphics(items).map((item) => {
    const g = item.graphic!;
    const measured =
      g.kind === "vector"
        ? "vector — has no resolution by construction"
        : g.kind === "unknown"
          ? "graphic type not recognized — resolution was not assessed"
          : g.effectivePpi === null
            ? "raster, but resolution could not be read"
            : `raster, effective ${Math.min(...g.effectivePpi)} ppi vs actual ${
                g.actualPpi === null ? "?" : Math.min(...g.actualPpi)
              }`;
    return {
      page: item.page,
      kind: g.kind,
      linkName: g.linkName,
      linkStatus: g.linkStatus,
      measured,
      effectivePpi: g.effectivePpi === null ? null : Math.min(...g.effectivePpi),
      actualPpi: g.actualPpi === null ? null : Math.min(...g.actualPpi),
      scale: `${g.hScale.toFixed(1)}×${g.vScale.toFixed(1)} %`,
    };
  });
}

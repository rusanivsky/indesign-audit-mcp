/**
 * Color measurement types. A LEAF MODULE: imports nothing from `src/color/`,
 * so detector families can depend on it without forming a cycle
 * (a lesson from Phase 12, where the comparator had to be moved for exactly
 * this reason).
 */

export type ColorSpace = "CMYK" | "RGB" | "LAB" | "unknown";

/** InDesign distinguishes `MIXEDINK` and `MIXEDINKGROUP`; for the verdict — one. */
export type ColorModel = "PROCESS" | "SPOT" | "REGISTRATION" | "MIXEDINK" | "unknown";

/**
 * Color as the script sees it.
 *
 * `named: null` means an UNNAMED color — applied bypassing any swatch. InDesign
 * returns `name === ""` for it — an empty string, not a missing field:
 * 85 such fills in the working book (measurement H14 §4).
 */
export interface ColorRef {
  named: string | null;
  model: ColorModel;
  space: ColorSpace;
  /** `null` — the value didn't read; NOT the same as zero. */
  value: number[] | null;
  kind: "solid" | "gradient" | "none";
}

export type Surface =
  | "swatch"
  | "pageItem"
  | "textRange"
  | "paragraphRule"
  | "underline"
  | "strikeThrough"
  | "tableCell"
  | "tableStroke"
  | "styleDefinition"
  | "effect"
  | "gradientStop"
  | "link";

export type Role = "fill" | "stroke" | "effect" | "stop" | "definition";

export interface ColorSite {
  siteId: number;
  surface: Surface;
  role: Role;
  /** Constructor name of the carrier: GraphicLine, Rectangle, ParagraphStyle… */
  ownerKind: string;
  ownerName: string | null;
  /** `null` — master spread or pasteboard. */
  page: string | null;
  master: string | null;
  layer: string;
  /**
   * From `layer.printable`. NOT decoration: eight endpaper elements have 100%
   * cyan and sit on a layer with `printable = false` — a detector without this
   * field would report eight violations on a correctly built file (H14 §10).
   */
  printable: boolean;
  /**
   * From `layer.visible`. A hidden layer is NOT printed by default
   * ("Visible & Printable Layers") and doesn't make it into the PDF without
   * being explicitly turned on. Measured on the working book: the layer
   * `Нумерація` — visible=false, printable=true, 6 elements.
   */
  visible: boolean;
  /**
   * Whether this color actually puts ink on the sheet.
   *
   * MEASURED: 82 `GraphicLine` elements 340.2 × 0 pt in size and 2 `Polygon`
   * elements 0 × 0 pt have a fill of 76/48/66/70 (TAC 260) — and print NONE of
   * it, because a line has no interior. What prints is their stroke: `Black`
   * 0.4 pt. Without this field, `tac-over-limit` would have produced 84
   * findings on the working book, and all 84 would have been false.
   *
   * There's deliberately no parameter to turn this off: zero area holds no
   * ink under any print settings.
   */
  laysInk: boolean;
  color: ColorRef;
  /** −1 = not set, i.e. 100%. NOT zero. */
  tint: number;
  overprint: boolean | null;
  /** Only for text surfaces; `null` for everything else. */
  pointSize: number | null;
}

export interface SurfaceCounter {
  surface: Surface;
  seen: number;
  parsed: number;
  failed: number;
}

export interface LayerMeasure {
  name: string;
  printable: boolean;
  visible: boolean;
}

export interface LinkMeasure {
  name: string;
  ownerKind: string;
  page: string | null;
  space: string | null;
  profile: string | null;
  status: string | null;
  /**
   * ALWAYS `false` for placed graphics: the script sees `space`, not
   * ink in a pixel. The field exists so the response can say this out loud,
   * rather than staying silent (H14 §9).
   */
  inkMeasurable: boolean;
}

export interface ColorMeasure {
  docName: string;
  ms: number;
  inkCount: number;
  inkNames: string[];
  layers: LayerMeasure[];
  sites: ColorSite[];
  counters: SurfaceCounter[];
  links: LinkMeasure[];
}

export type Family = "tac" | "black" | "palette" | "space" | "overprint";

export interface ColorFinding {
  family: Family;
  rule: string;
  /** Color description — the report's grouping unit. */
  color: string;
  totalInk: number | null;
  count: number;
  surfaces: Surface[];
  pages: string[];
  pagesTotal: number;
  examples: string[];
}

/**
 * Components for display.
 *
 * Rounded to one decimal place, not `toFixed(2)`: InDesign returns 76.0400001
 * where the panel shows 76, and two decimal places would turn every report
 * line into noise. One decimal is the threshold below which ink on the sheet
 * is indistinguishable.
 */
export function formatComponents(value: number[] | null): string {
  if (value === null || value.length === 0) return "—";
  const parts: string[] = [];
  for (const v of value) {
    const rounded = Math.round(v * 10) / 10;
    parts.push(String(rounded));
  }
  return parts.join("/");
}

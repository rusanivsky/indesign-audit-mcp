/*
 * Render resolution calculation.
 *
 * THE PARAMETER IS PIXELS, NOT dpi, and not for convenience. The layout is vector, so it
 * has no "native" resolution — unlike a photo. So dpi is a property of the
 * VIEW, not of the document, and a default of "150 dpi" would be a constant
 * of one specific edition, baked into the tool. User's decision,
 * 2026-08-23, spec §4.
 *
 * The module is LEAF and dependency-free — which is exactly why the formula is proven
 * by execution, not by reading. The same step already taken for capPivStems.
 */

/** Below this — illegible. */
export const MIN_DPI = 36;
/** Above this — guaranteed wasted work: the client downsizes to ≈1568 px on the long edge. */
export const MAX_DPI = 300;
/** Default long edge in pixels: margin under the client's ceiling. */
export const DEFAULT_MAX_PX = 1400;

export interface ResolutionRequest {
  /** The long edge of the page OR spread, in points. */
  longEdgePt: number;
  maxPx?: number;
  dpi?: number;
}

export interface Resolution {
  /** What goes into exportResolution. */
  dpi: number;
  /** What was requested before clamping — so clamping is visible as a number. */
  requestedDpi: number;
  clamped: boolean;
}

export function resolveDpi(req: ResolutionRequest): Resolution {
  if (req.dpi !== undefined && req.maxPx !== undefined) {
    throw new Error(
      "dpi and maxPx were given together. They are mutually exclusive ways to state the " +
        "resolution: maxPx is how many pixels you need to see, dpi is an explicit override.",
    );
  }
  if (!Number.isFinite(req.longEdgePt) || req.longEdgePt <= 0) {
    throw new Error(`the long edge must be a positive number of points, got ${req.longEdgePt}`);
  }

  const requestedDpi =
    req.dpi !== undefined
      ? req.dpi
      : Math.round(((req.maxPx ?? DEFAULT_MAX_PX) * 72) / req.longEdgePt);

  const dpi = Math.min(MAX_DPI, Math.max(MIN_DPI, requestedDpi));
  return { dpi, requestedDpi, clamped: dpi !== requestedDpi };
}

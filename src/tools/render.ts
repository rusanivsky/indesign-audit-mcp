import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { runJsx } from "../bridge/runner.js";
import { readPngSize } from "../render/png-size.js";
import { DEFAULT_MAX_PX, resolveDpi } from "../render/resolution.js";
import { EXPECTED_DOC_NAME_FIELD, fail, okImage, type Tools } from "./shared.js";

/*
 * A safety ceiling, not a measurement. The hardest case — a real 196-page
 * book with 303 anchored objects and transparency — remains unmeasured
 * (spec §10.2). 120s is the same number already used by geometry_audit
 * and pagination_audit for comparable JSX passes.
 */
const RENDER_TIMEOUT_MS = 120_000;

interface RenderBounds {
  docName: string;
  page: string;
  spread: boolean;
  widthPt: number;
  heightPt: number;
  longEdgePt: number;
}

interface RenderExport {
  docName: string;
  path: string;
  bytes: number;
  dpi: number;
  strays: number;
}

/*
 * `-` is NOT among the component's allowed characters: it's the sole
 * separator between docName and page below, and if it stayed allowed inside
 * a component, the boundary would become indistinguishable. A real collision
 * example: ("Обкладинка-v1", "166") and ("Обкладинка", "v1-166") would,
 * without this rule, produce the same file «Обкладинка-v1-166.png».
 */
export function sanitizeComponent(s: string): string {
  return s.replace(/[^\p{L}\p{N}_]+/gu, "_");
}

/** The filename is deterministic: re-rendering overwrites rather than accumulates. */
export function renderPath(docName: string, page: string, spread: boolean): string {
  const doc = sanitizeComponent(docName.replace(/\.indd$/i, ""));
  const pg = sanitizeComponent(page);
  const suffix = spread ? "-spread" : "";
  return join(tmpdir(), `${doc}-${pg}${suffix}.png`);
}

export function registerRenderTools(server: Tools): void {
  server.registerTool(
    "page_render",
    {
      title: "Render of a page or a spread",
      description:
        "Returns ONE page or ONE spread as a raster, so the layout can be SEEN and not only " +
        "measured. It shows the PRINTED result: non-printing layers, guides, frame edges and " +
        "text-thread lines do NOT appear in the render. " +
        "DO NOT JUDGE COLOUR FROM THE RENDER: PNG forces RGB and there is no such thing as a " +
        "CMYK PNG — colour belongs to color_audit. The resolution is given in PIXELS of the " +
        "long edge (maxPx), because a vector layout has no native dpi; dpi remains an " +
        "explicit override.",
      inputSchema: {
        page: z
          .string()
          .describe('The page name as InDesign shows it (not the index) — e.g. "166".'),
        spread: z
          .boolean()
          .default(false)
          .describe("The whole spread instead of a single page. The long edge is taken from the spread."),
        maxPx: z
          .number()
          .positive()
          .optional()
          .describe(
            `The long edge in pixels. Defaults to ${DEFAULT_MAX_PX}. ` +
              "Mutually exclusive with dpi.",
          ),
        dpi: z
          .number()
          .positive()
          .optional()
          .describe("An explicit resolution override. Mutually exclusive with maxPx."),
        bleed: z.boolean().default(false).describe("Include the document bleed."),
        expectedDocName: EXPECTED_DOC_NAME_FIELD,
      },
    },
    async (args) => {
      try {
        const bounds = await runJsx<RenderBounds>(
          "render_bounds",
          {
            page: args.page,
            spread: args.spread,
            expectedDocName: args.expectedDocName,
          },
          { timeoutMs: RENDER_TIMEOUT_MS },
        );

        const res = resolveDpi({
          longEdgePt: bounds.longEdgePt,
          maxPx: args.maxPx,
          dpi: args.dpi,
        });

        const path = renderPath(bounds.docName, bounds.page, bounds.spread);
        const out = await runJsx<RenderExport>(
          "render_export",
          {
            page: bounds.page,
            spread: bounds.spread,
            dpi: res.dpi,
            bleed: args.bleed,
            path,
            /* Pinned to the MEASURED document, not to user input: if
             * expectedDocName isn't set, this guard is a no-op in BOTH calls,
             * and between them (~600 ms) the active InDesign window can change. Two
             * plausible-looking documents with the same name root — exactly
             * the case where rendering the wrong document isn't visible to the eye. */
            expectedDocName: bounds.docName,
          },
          { timeoutMs: RENDER_TIMEOUT_MS },
        );

        const pngBuffer = await readFile(path);
        /* ACTUAL pixels of the finished file, not the ones planned from maxPx — spec §4:
         * exportResolution=148 gave exactly 991×1398, not 1400. The discrepancy
         * is legitimate (bleed adds area beyond the trim, and resolveDpi rounds
         * maxPx to the nearest dpi) — the dpi math isn't broken, maxPx
         * was a TARGET, not a ceiling. */
        const pngSize = readPngSize(pngBuffer);
        const base64 = pngBuffer.toString("base64");
        return okImage(base64, "image/png", {
          docName: out.docName,
          page: bounds.page,
          spread: bounds.spread,
          dpi: res.dpi,
          requestedDpi: res.requestedDpi,
          clamped: res.clamped,
          widthPx: pngSize.widthPx,
          heightPx: pngSize.heightPx,
          widthPt: bounds.widthPt,
          heightPt: bounds.heightPt,
          bytes: out.bytes,
          strays: out.strays,
          path,
        });
      } catch (e) {
        return fail(e);
      }
    },
  );
}

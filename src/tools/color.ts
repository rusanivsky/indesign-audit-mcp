import { z } from "zod";
import { runJsx } from "../bridge/runner.js";
import { detectRegistrationApplied, detectRichBlackSmallText } from "../color/detect/black.js";
import {
  detectPaletteMiss,
  detectUnnamed,
  surveyPaletteDistance,
  type DistanceBucket,
} from "../color/detect/palette.js";
import { detectOverprintSuspicious } from "../color/detect/overprint.js";
import {
  detectNonCmyk,
  detectSpotApplied,
  detectUnexpectedInks,
} from "../color/detect/space.js";
import { detectTacOverLimit, surveyTac, type TacBucket } from "../color/detect/tac.js";
import { buildReport } from "../color/report.js";
import { selectSites } from "../color/sites.js";
import type { ColorFinding, ColorMeasure, ColorRef, Family } from "../color/types.js";
import { fail, ok, type Tools } from "./shared.js";

const FAMILIES = ["tac", "black", "palette", "space", "overprint"] as const;

/**
 * Defaults are DECLARED CONVENTIONS in the response, not measurements.
 *
 * `maxTotalInk = 300`: ISO 12647-2 for sheetfed offset on coated stock.
 * The document doesn't know its paper, so the number has to be a
 * parameter; but no default at all would leave the tool mute on an
 * ordinary call, and muteness is worse than a declared convention.
 */
export const DEFAULTS = {
  maxTotalInk: 300,
  richBlackMaxPointSize: 24,
  expectedInks: 4,
};

export interface AuditArgs {
  families?: readonly Family[];
  maxTotalInk?: number;
  richBlackMaxPointSize?: number;
  expectedInks?: number;
  paletteNearMissThreshold?: number;
  includeNonPrinting?: boolean;
  /** Ruling 6: a hidden layer is a reason not to print, SEPARATE from printable. */
  includeHidden?: boolean;
}

export interface Assembled {
  findings: ColorFinding[];
  families: Family[];
  maxTotalInk: number;
  richBlackMaxPointSize: number;
  expectedInks: number;
  includeNonPrinting: boolean;
  includeHidden: boolean;
  paletteThresholdNamed: boolean;
  sitesJudged: number;
  sitesSkippedNonPrinting: number;
  sitesSkippedHidden: number;
  sitesSkippedNoInk: number;
  /** Ruling 12: overprint couldn't be read on zero ink (overprint === null). */
  sitesOverprintUnknown: number;
  tacSurvey: TacBucket[] | null;
  paletteSurvey: DistanceBucket[] | null;
}

/**
 * Detector wiring, SEPARATED from MCP and from InDesign.
 *
 * The reason for the separation is a lesson from Phase 13: as long as the
 * wiring lived inside `registerTool`, the test weighed the report WITHOUT
 * it — i.e. not the response the tool actually hands back.
 */
export function assembleFindings(measure: ColorMeasure, args: AuditArgs): Assembled {
  const families: Family[] = [...(args.families ?? FAMILIES)];
  const wanted = new Set(families);
  const includeNonPrinting = args.includeNonPrinting ?? false;
  const includeHidden = args.includeHidden ?? false;
  const maxTotalInk = args.maxTotalInk ?? DEFAULTS.maxTotalInk;
  const richBlackMaxPointSize = args.richBlackMaxPointSize ?? DEFAULTS.richBlackMaxPointSize;
  const expectedInks = args.expectedInks ?? DEFAULTS.expectedInks;

  const judged = selectSites(measure.sites, { includeNonPrinting, includeHidden });
  const skipped = includeNonPrinting
    ? 0
    : measure.sites.filter((s) => !s.printable && s.color.kind === "solid").length;
  const skippedHidden = includeHidden
    ? 0
    : measure.sites.filter((s) => s.visible === false && s.color.kind === "solid").length;
  const skippedNoInk = measure.sites.filter(
    (s) => s.laysInk === false && s.color.kind === "solid",
  ).length;
  const overprintUnknown = measure.sites.filter(
    (s) => s.surface === "pageItem" && s.overprint === null,
  ).length;

  /* The palette is tuples of swatches from that same measurement, not a
   * separate source alongside it: otherwise the two lists would eventually drift apart. */
  const swatches: ColorRef[] = [];
  for (const s of measure.sites) {
    if (s.surface === "swatch" && s.color.kind === "solid" && s.color.value !== null) {
      swatches.push(s.color);
    }
  }

  const findings: ColorFinding[] = [];
  if (wanted.has("tac")) findings.push(...detectTacOverLimit(judged, maxTotalInk));
  if (wanted.has("black")) {
    findings.push(...detectRegistrationApplied(judged));
    findings.push(...detectRichBlackSmallText(judged, richBlackMaxPointSize));
  }
  if (wanted.has("palette")) {
    findings.push(...detectUnnamed(judged));
    if (args.paletteNearMissThreshold !== undefined) {
      findings.push(...detectPaletteMiss(judged, swatches, args.paletteNearMissThreshold));
    }
  }
  if (wanted.has("space")) {
    findings.push(...detectNonCmyk(judged));
    findings.push(...detectSpotApplied(judged));
    findings.push(...detectUnexpectedInks(measure, expectedInks));
  }
  if (wanted.has("overprint")) findings.push(...detectOverprintSuspicious(judged));

  return {
    findings,
    families,
    maxTotalInk,
    richBlackMaxPointSize,
    expectedInks,
    includeNonPrinting,
    includeHidden,
    paletteThresholdNamed: args.paletteNearMissThreshold !== undefined,
    sitesJudged: judged.length,
    sitesSkippedNonPrinting: skipped,
    sitesSkippedHidden: skippedHidden,
    sitesSkippedNoInk: skippedNoInk,
    sitesOverprintUnknown: overprintUnknown,
    tacSurvey: wanted.has("tac") ? surveyTac(judged) : null,
    paletteSurvey: wanted.has("palette") ? surveyPaletteDistance(judged, swatches) : null,
  };
}

/**
 * A ceiling with headroom. Walking eleven surfaces across 196 pages is
 * heavier than geometry_measure (744 ms for 965 elements), and the actual
 * time is written into the response so the ceiling can be narrowed by
 * MEASUREMENT, not by guesswork.
 */
const COLOR_TIMEOUT_MS = 240_000;

export function registerColorTools(server: Tools): void {
  server.registerTool(
    "color_audit",
    {
      title: "Colour audit for print",
      description:
        "A READ-ONLY colour audit from the standpoint of print fitness: ink coverage " +
        "above the declared limit, [Registration] used in content, rich black under " +
        "small point sizes, colours outside the palette, non-CMYK and spot inks, " +
        "overprint. " +
        "THE MAIN THING ABOUT THE RESPONSE: zero findings does NOT mean “the layout is clean” — it " +
        "means “on the measured surfaces, at the declared ink limit, nothing was " +
        "found”. The caveat field is built from the numbers of THIS run and names what " +
        "was measured with and what was not measured at all. " +
        "WHAT THE TOOL DOES NOT SEE: ink coverage INSIDE placed PSD, AI " +
        "and PDF files. The script gets a link's colour space, not the ink in a pixel; " +
        "a 400 % black inside an illustration is not found by this tool, and " +
        "such placements are listed by name in unmeasurableLinks. Overprint on " +
        "a zero ink (overprint-on-white) is on this version of InDesign sometimes " +
        "impossible to read at all — the caveat names how many places are exactly that. " +
        "It does not analyse the exported PDF and writes nothing to the document.",
      inputSchema: {
        families: z
          .array(z.enum(FAMILIES))
          .optional()
          .describe("Which families to count. Not named — all of them."),
        maxTotalInk: z
          .number()
          .positive()
          .optional()
          .describe(
            "The total ink coverage limit as a percentage. The default 300 (ISO " +
              "12647-2, sheet-fed offset on coated stock) is a CONVENTION, not a measurement: " +
              "the document knows neither the paper nor the print shop. For uncoated it is usually " +
              "260–280, for newsprint 240.",
          ),
        richBlackMaxPointSize: z
          .number()
          .positive()
          .optional()
          .describe(
            "The point size below which rich black is considered a defect because of a misregistration " +
              "halo. Default 24.",
          ),
        expectedInks: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "How many inks are in the job. Default 4. More inks than declared is " +
              "a finding; fewer is not (a single-colour job is not a defect).",
          ),
        paletteNearMissThreshold: z
          .number()
          .positive()
          .optional()
          .describe(
            "The near-miss threshold against a swatch, as a percentage of the largest " +
              "component. NO DEFAULT by design: the gap in the distribution is " +
              "a property of the particular edition. Not named — the palette family returns " +
              "the distribution of distances and the unnamed colours, but no verdict about a miss.",
          ),
        includeNonPrinting: z
          .boolean()
          .optional()
          .describe(
            "Whether to judge colours on non-printing layers. Default false: technical " +
              "marks on a printable=false layer do not go on press, and a verdict about them " +
              "would be untrue.",
          ),
        includeHidden: z
          .boolean()
          .optional()
          .describe(
            "Whether to judge colours on HIDDEN layers. Default false: " +
              "a hidden layer does not print by default and does not go into the PDF without " +
              "being explicitly switched on. Separate from includeNonPrinting: these are different reasons " +
              "for not printing, and the response should say which one it is.",
          ),
      },
    },
    async (args) => {
      try {
        const measure = await runJsx<ColorMeasure>("color_measure", {}, {
          timeoutMs: COLOR_TIMEOUT_MS,
        });
        const assembled = assembleFindings(measure, args);
        return ok(buildReport(measure, assembled.findings, assembled));
      } catch (err) {
        return fail(err);
      }
    },
  );
}

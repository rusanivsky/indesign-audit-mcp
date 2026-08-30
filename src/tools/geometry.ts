import { z } from "zod";
import { runJsx } from "../bridge/runner.js";
import { detectAnchorGeometry, inventoryAnchored, type AnchorRule } from "../geometry/anchored.js";
import { detectBleedShort, detectNearMiss, detectOffPage, surveyNearMiss } from "../geometry/frame.js";
import { detectLinks, detectResolution, inventoryGraphics } from "../geometry/image.js";
import { buildReport, type PopulationFamily } from "../geometry/report.js";
import type { Family, GeometryFinding, GeometryMeasure } from "../geometry/types.js";
import { detectWrap, hasWrapMaterial, inventoryWrap } from "../geometry/wrap.js";
import { fail, ok, type Tools } from "./shared.js";

const FAMILIES = ["frame", "image", "anchored", "wrap"] as const;

export function registerGeometryTools(server: Tools): void {
  server.registerTool(
    "geometry_audit",
    {
      title: "Audit of page-element geometry",
      description:
        "A READ-ONLY geometry audit: near misses against reference bounds, extending beyond " +
        "the declared bleed, images and links, anchored objects, text wrap. " +
        "It does NOT report “element outside the text column” — on a real edition 62 % of " +
        "elements lie outside the column deliberately.",
      inputSchema: {
        families: z
          .array(z.enum(FAMILIES))
          .optional()
          .describe("Which families to count. Not named — all of them."),
        nearMissThresholdPt: z
          .number()
          .positive()
          .optional()
          .describe(
            "The near-miss threshold in points. NO DEFAULT by design: " +
              "the gap in the distribution is a property of the particular edition. " +
              "Not named — the frame family returns only the survey distribution.",
          ),
        minPpi: z
          .number()
          .positive()
          .optional()
          .describe(
            "The effective resolution threshold. NO DEFAULT: 300 for offset and " +
              "150 for digital is decided by the print shop, not by the tool.",
          ),
        anchorRule: z
          .object({
            style: z.string(),
            edge: z.enum(["left", "right", "top", "bottom"]),
            alignsTo: z.enum(["column-start", "column-end"]),
            tolerance: z.number().positive().optional(),
            mirrored: z.boolean().optional(),
          })
          .optional()
          .describe(
            "The geometric rule for the population of anchors. NO DEFAULT: the rule of " +
              "a particular layout must not be a constant of the tool. " +
              "edge and alignsTo describe PAGE SPACE — “left” means left on the sheet, not " +
              "“inside”. For a rule tied to the OUTER margin that is not enough, because one " +
              "(edge, alignsTo) pair cannot describe both sides of a spread: on a verso the " +
              "outer margin is on the left, on a recto on the right. Set mirrored: true to say " +
              "the pair is named FOR A RECTO and both sides swap on a verso — without it such a " +
              "rule passes on versos and reports a full column-width offset on every recto.",
          ),
      },
    },
    async (args) => {
      try {
        const raw = await runJsx<GeometryMeasure>("geometry_measure", {}, {
          timeoutMs: 120_000,
        });

        /*
         * ЕЛЕМЕНТ БЕЗ ПРОЧИТАНИХ МЕЖ ВІДСІЮЄТЬСЯ ТУТ І РАХУЄТЬСЯ ВГОЛОС.
         *
         * Доти `geometry.jsx` за невдалого читання `geometricBounds` лишав
         * замовчування `[0, 0, 0, 0]` — ВИГАДАНИЙ прямокутник у куті сторінки,
         * поданий як вимір. Сусідній `pagination.jsx` цього прямо не робить і
         * пояснює чому: «нуль-прямокутник — це теж прямокутник; він відповідає
         * на питання „де рамка“ числами, яких ніхто не міряв».
         *
         * Наслідки простежувані: у `closestMiss` обидва списки країв містять
         * нуль, тож усі чотири сторони читаються як вирівняні, і елемент тихо
         * зникає з near-miss без жодного рядка в `notMeasured`; а якщо він
         * прив'язаний і підпадає під `anchorRule`, `detectAnchorGeometry`
         * натомість звітує зсув, що дорівнює цілому внутрішньому полю.
         *
         * Тепер JSX віддає `null`, а межа проходить рівно тут: детектори далі
         * працюють із незмінним типом, а число невиміряних називається.
         */
        const unreadable = raw.items.filter((i) => !Array.isArray(i.bounds) || i.bounds.length !== 4);
        const measure: GeometryMeasure = {
          ...raw,
          items: raw.items.filter((i) => Array.isArray(i.bounds) && i.bounds.length === 4),
        };

        const families: Family[] = [...(args.families ?? FAMILIES)];
        const wanted = new Set(families);
        const findings: GeometryFinding[] = [];

        if (wanted.has("frame")) {
          if (args.nearMissThresholdPt !== undefined) {
            findings.push(...detectNearMiss(measure.items, measure.pages, args.nearMissThresholdPt));
          }
          findings.push(...detectOffPage(measure.items, measure.pages));
          /* The question opposite to off-page, and practically more important: an
           * element that crosses the trim but falls short of the bleed leaves a white
           * strip at the edge. Needs no threshold — the reference is declared by the
           * document itself. */
          findings.push(...detectBleedShort(measure.items, measure.pages));
        }
        if (wanted.has("image")) {
          if (args.minPpi !== undefined) {
            findings.push(...detectResolution(measure.items, args.minPpi));
          }
          findings.push(...detectLinks(measure.items));
        }
        if (wanted.has("anchored")) {
          /* WITHOUT a type cast. `as AnchorRule | undefined` would hide a future
           * divergence between the zod schema and the `AnchorRule` type itself:
           * a field could be added to the type that the schema doesn't collect,
           * and the compiler would stay silent. Now it's a build error, not a
           * silent defect. */
          const rule: AnchorRule | undefined = args.anchorRule;
          findings.push(...detectAnchorGeometry(measure.items, measure.pages, rule));
        }
        if (wanted.has("wrap")) {
          findings.push(...detectWrap(measure.items));
        }

        /* Computed ONCE — both for the notMeasured verdict and for the
         * inventory itself below: the family inventories are the SINGLE source
         * of truth for whether the document has material, not a separate
         * assumption alongside.
         *
         * ONLY WHAT WAS REQUESTED IS COUNTED (branch review, I6): with
         * `families: ["frame"]`, the response used to still carry all three
         * inventories. */
        const anchoredInventory = wanted.has("anchored") ? inventoryAnchored(measure.items) : [];
        const graphicsInventory = wanted.has("image") ? inventoryGraphics(measure.items) : [];
        const wrapInventory = wanted.has("wrap") ? inventoryWrap(measure.items) : [];

        const emptyPopulations: PopulationFamily[] = [];
        if (wanted.has("anchored") && anchoredInventory.length === 0) emptyPopulations.push("anchored");
        if (wanted.has("image") && graphicsInventory.length === 0) emptyPopulations.push("image");
        /* NOT `wrapInventory.length === 0` (Round 2 of fixes, review):
         * `NONE` is also an inventory entry, so the inventory CAN be full and
         * still contain no material for a verdict — exactly the state of the
         * working book (`NONE` × 965). The criterion is "material for a
         * verdict", not "the field was read". */
        if (wanted.has("wrap") && !hasWrapMaterial(measure.items)) emptyPopulations.push("wrap");

        /* "No ppi" is a property of the vector (PDF/.ai throws on effectivePpi,
         * measured H13), not a measurement gap. It doesn't depend on whether the
         * user named minPpi: the fact itself — "there are N vectors whose
         * resolution can't be assessed in principle" — isn't a consequence of
         * the call parameter. But it does depend on whether the image family was
         * requested (I6): counting vectors for a response that carries no
         * graphics at all makes no sense. */
        const vectorGraphicsCount = wanted.has("image")
          ? measure.items.filter((i) => i.graphic !== null && i.graphic.kind === "vector").length
          : 0;

        /*
         * ONE payload, not a report plus two fields alongside (branch review, I2).
         * As long as `inventory` and `survey` were glued on here via spread, the
         * size measurement (both in the test and in the run script) weighed
         * `buildReport(...)` without them — that is, NOT the response the tool
         * actually returns. Now there's nothing else to weigh: `buildReport`
         * returns exactly what goes into `ok()`.
         */
        const report = buildReport(measure, findings, {
          families,
          /* The returned frames pertain only to the frame family's verdict. */
          rotatedExcluded: wanted.has("frame")
            ? measure.items.filter((i) => i.rotation !== 0).length
            : 0,
          unreadableBounds: unreadable.length,
          anchorRuleNamed: args.anchorRule !== undefined,
          resolutionThresholdNamed: args.minPpi !== undefined,
          vectorGraphicsCount,
          emptyPopulations,
          inventory: {
            anchored: anchoredInventory,
            graphics: graphicsInventory,
            wrap: wrapInventory,
          },
          survey:
            wanted.has("frame") && args.nearMissThresholdPt === undefined
              ? surveyNearMiss(measure.items, measure.pages)
              : null,
        });

        return ok(report);
      } catch (err) {
        return fail(err);
      }
    },
  );
}

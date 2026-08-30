import { z } from "zod";
import { runJsx } from "../bridge/runner.js";
import { buildMap } from "../layout/map.js";
import { detectMasters } from "../layout/masters.js";
import { detectOverrides } from "../layout/overrides.js";
import { summariseByStyle, type StyleUsage } from "../layout/summarise.js";
import type { LayoutMeasure, MasterItemRef } from "../layout/types.js";
import { fail, ok, type Tools } from "./shared.js";

/** Shared range field. Same shape as in `composition_audit`. */
const PAGES_FIELD = z
  .array(z.string())
  .optional()
  .describe('InDesign page names, e.g. ["12","13"]. Without this field — the whole document.');

/**
 * Layout-measure timeout.
 *
 * `runJsx`'s default is 30 s (`bridge/runner.ts:16`), and that alone made
 * `layout_measure` without `pages` unusable: not "slow" but guaranteed to
 * fail with −1712, no matter how long the operator waited. The 600 s figure
 * comes from a MEASUREMENT, not a guess: a full measure of the user's book
 * (198 pages, 2980 paragraphs) took **340 s**.
 *
 * WHY NOT CHUNKING — and this is the main thing the next person coming back
 * here should know. This originally had a loop over 25-page windows from
 * `layout/merge.ts`. A measurement on the live book disproved it:
 *
 *   5 pages — 17–50 s      20 pages — 62–117 s
 *   25 pages — 81 s        198 pages (all) — 340 s
 *
 * In other words, call cost barely depends on range size: ~36 s is the BASE
 * cost of any call, and eight chunks of 25 would have cost ~648 s against
 * 340 s for one call. Chunking here isn't an optimization, it's doubling the
 * price. (The spread within one size is also measured: Phase 4's numbers,
 * "5 pages, 3.4 s," no longer reproduce on this same book, and why is
 * unresolved.)
 *
 * What REMAINS unresolved, and why this is named rather than hidden: where
 * the base ~36 s comes from could not be found. Checked with probes and
 * ruled out: walking `masterPageItems` with `itemKind` (19 ms for 5 pages),
 * `getElements()` (21 ms), `parentTextFrames` over ALL 2980 document
 * paragraphs (714 ms), assembling the master's composition with
 * `hasAutoPageNumber` (39 ms), switching `measurementUnit` (0 ms). Together
 * these are a few percent of the observed time.
 *
 * THE SECOND LIMIT, measured in the same run and more important than the
 * first. A full `document_map` on this book **takes 476 s and returns
 * 459 KB** (198 pages, 100 spreads, 551 stories). The timeout no longer
 * kills the call — but 459 KB almost certainly won't fit in an MCP response:
 * Phase 4 already stumbled on exactly this, when 78 KB on THREE pages made
 * the tool unusable (`map.jsx`, the comment at the story loop). So the
 * default is honest now — it runs to completion and returns a number — but
 * the practically usable interface is still `pages`. The output can't be
 * trimmed here arbitrarily: what's excess on the full document is the
 * user's decision, not the model's.
 */
/*
 * THE THIRD LIMIT, MEASURED ON A SECOND BOOK — AND THE FIRST TIME THE FULL
 * DURATION OF THIS PASS IS KNOWN AT ALL.
 *
 * The 600,000 ms was calibrated on a 198-page book (476 s). On
 * «02 Зоряні Мрії 2022 Print 3 copy.indd» (592 pages) the pass takes
 * **928 s** — measured 2026-08-18: bootstrap.jsx 01:38:37 → result.json
 * 01:54:05, `ok: true`, 724 frames, 21,686 paragraphs, 15.7 MB.
 *
 * WHY THIS NUMBER DIDN'T EXIST BEFORE. The 2026-08-17 run gave "511 s" — but
 * that was the time BEFORE the crash on `rotationAngle`, not the pass's
 * duration. The pass never ran to completion on this book before, so
 * comparing 928 to 511 as "got slower" is invalid: these are different
 * quantities.
 *
 * HONESTY OF THE MEASUREMENT. The 928 s was taken from file mtimes, because
 * the osascript client gave up first (900 s call ceiling), while InDesign
 * carried the work through to completion and wrote the result. The number
 * is therefore accurate to the second, but it also includes loading the JSX
 * modules — so it's more an upper bound on the traversal itself.
 *
 * 1,800,000 is 1.94× over the measured value, the same order of margin
 * `a56fa2b` took for `styles` (2.7×). The number is MEASURED, not picked out
 * of thin air: that's exactly what the ledger insists on, after the
 * `styles` ceiling had to be moved a second time.
 */
export const LAYOUT_MEASURE_TIMEOUT_MS = 1_800_000;

/**
 * Layout measurement. One call — for both a range and the whole document.
 *
 * The debt was closed not by chunking but by an honest timeout: the
 * previously documented default (`pages` unset → "whole document") used to
 * hit the 30-second ceiling and return a timeout instead of an answer. The
 * tool description advised "set pages explicitly" — but advice in a
 * description doesn't make the default work.
 */
async function measureLayout(pages: string[] | undefined): Promise<LayoutMeasure> {
  return runJsx<LayoutMeasure>(
    "layout_measure",
    pages === undefined ? {} : { pages },
    { timeoutMs: LAYOUT_MEASURE_TIMEOUT_MS },
  );
}

export function registerMapTools(server: Tools): void {
  server.registerTool(
    "document_map",
    {
      title: "Document map",
      description:
        "The structure of pages in the range: side of the spread, applied parent, frames with " +
        "their threads and overset, an inventory of paragraph styles with counts and places of use. " +
        "The heading tree is built ONLY from an explicit headingStyles: InDesign has no notion of " +
        "a heading level, and the tool will not infer one from a style's name or point size. " +
        "Without headingStyles it returns an inventory of styles from which you name them yourself. " +
        "Without pages the whole document is measured, and that works but is expensive: measured on a 198-page " +
        "book — 476 s and a 459 KB response, which at that size may not fit back. " +
        "The cost barely depends on the size of the range (5 pages also take tens of seconds), " +
        "so pages saves the SIZE of the response above all. The practically usable interface is pages.",
      inputSchema: {
        pages: PAGES_FIELD,
        headingStyles: z
          .array(z.string())
          .optional()
          .describe(
            "Paragraph styles of headings in level order: the first is the highest. " +
              "The level is determined by POSITION in this array, not by the style's name. " +
              "Both a style's NAME and its .id from styleInventory are accepted — the name is more convenient, " +
              ".id is needed when the document has two different styles with the same name (by name " +
              "the paragraphs of both would be included). What actually matched is visible in headings[].styleId.",
          ),
      },
    },
    async ({ pages, headingStyles }) => {
      try {
        const measure = await measureLayout(pages);
        return ok(buildMap(measure, headingStyles));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "layout_audit",
    {
      title: "Layout consistency audit",
      description:
        "Paragraphs that depart from THEIR OWN declared paragraph style, and pages " +
        "detached from their own parent. There is no threshold here and none is needed: the reference is " +
        "declared by the document itself, so a divergence is a fact rather than a judgement. " +
        "By default a SUMMARY by style is returned, not a list of paragraphs: on " +
        "a document that has not been through a typesetting review there can be thousands of overrides, " +
        "and a flat list would be unusable. A by-name listing comes through detail. " +
        "In each summary row `groups[].values` (which actual values occur) " +
        "IS TRUNCATED to 20 distinct “property + value” pairs per group: this listing grew " +
        "with every new pair and by construction had no bound. When truncated, " +
        "`valuesTruncated: { shown, total }` appears alongside, where `total` is the FULL number of distinct pairs for " +
        "THIS style and THIS group; a silent truncation would read as “these are all the values”. " +
        "Only the LISTING is truncated: `deviating`, `paragraphs` and `count` of the pairs already shown " +
        "remain complete. For addresses go to `detail` — it has a ceiling of its own. " +
        "The tool writes nothing to the document and proposes no corrections — it only shows facts. " +
        "Without pages the whole document is measured, by the same path as document_map: on a 198-page " +
        "book that is 476 s (measured). The cost barely depends on the size of the range, " +
        "so pages saves the size of the response above all, not the time.",
      inputSchema: {
        pages: PAGES_FIELD,
        families: z
          .array(z.enum(["overrides", "masters"]))
          .default(["overrides", "masters"])
          .describe("Which finding families to count."),
        includeMasters: z
          .boolean()
          .default(false)
          .describe(
            "Count paragraphs on parent pages. Not by default: a running head departs " +
              "from its paragraph style by construction.",
          ),
        detail: z
          .object({
            styleId: z
              .string()
              .describe(
                "The paragraph style's `.id` — the same `styleId` field that marks every `styles` row " +
                  "in this tool's own response. NOT the name: two different styles may be " +
                  "called the same (measured by probe H5), and a filter by name would return the findings of " +
                  "BOTH, mixing a used style with an unused one.",
              ),
            group: z.enum(["indents", "sizes", "justification", "font", "lists", "tracking"]),
          })
          .optional()
          .describe(
            "A by-name listing of paragraphs for ONE (style by id, group) pair. Without this field " +
              "no listing is issued at all, however many findings there are.",
          ),
      },
    },
    async ({ pages, families, includeMasters, detail }) => {
      try {
        const measure = await measureLayout(pages);

        const overrides = families.includes("overrides")
          ? detectOverrides(measure.paragraphs, { includeMasters })
          : { findings: [], notCompared: [], paragraphCounts: new Map<string, StyleUsage>() };

        const masters = families.includes("masters")
          ? detectMasters(measure.pages, masterItemsOf(measure))
          : { findings: [], distribution: [] };

        /*
         * The summary gets EXACTLY `overrides.findings` — NEVER
         * `masters.findings`, and never a union of both. The summary counts
         * paragraphs by (style, property group); `masters` findings have
         * neither a paragraph style nor a group (both fields are `null` by
         * construction in `detectMasters`, `src/layout/masters.ts`) — they're
         * about the page and the master item, an entirely different
         * dimension.
         *
         * DO NOT RELY on `summariseByStyle` (`src/layout/
         * summarise.ts:64`) silently dropping findings with `styleName ===
         * null || group === null` on its own: that's an INTERNAL detail of
         * that module, not a contract, and that's exactly why a mutant that
         * mixes `masters.findings` in here passes the whole test suite
         * silently if only the shape of the response up top is checked — the
         * neighboring module's filter hides the bug here. The correctness of
         * this line rests on the explicit choice of what's passed as the
         * argument, not on what happens to the extra data if it's passed in
         * anyway.
         */
        const summary = summariseByStyle(
          overrides.findings,
          overrides.paragraphCounts,
          overrides.notCompared,
        );

        /*
         * Filter by `styleId`, NOT by `styleName` (round-1 review, I-3):
         * `styles` above already emits one row per `styleId`, and filtering
         * by name would be inconsistent next to that — the operator would
         * see two rows with the same name but have no way to ask for the
         * named listing of just ONE of them: filtering by name would hand
         * back the findings of both at once. A partial migration (summary by
         * id, detail by name) is worse than no migration: the mismatch is
         * silent.
         */
        const detailed =
          detail === undefined
            ? null
            : overrides.findings.filter(
                (f) => f.styleId === detail.styleId && f.group === detail.group,
              );

        return ok({
          docName: measure.docName,
          pages: measure.pages.map((p) => p.name),
          styles: summary,
          masters: { findings: masters.findings, distribution: masters.distribution },
          detail: detailed,
          totals: {
            overrideFindings: overrides.findings.length,
            masterFindings: masters.findings.length,
            notComparedGroups: overrides.notCompared.length,
            /*
             * §2.2: how many containers and paragraphs fell out of the
             * measurement because they couldn't be assigned a page. Sits
             * next to `notComparedGroups` for the same reason: zero findings
             * with a nonzero counter means "not looked at," not "matches."
             */
            unplacedContainers: measure.unplacedContainers ?? 0,
            unplacedParagraphs: measure.unplacedParagraphs ?? 0,
          },
        });
      } catch (e) {
        return fail(e);
      }
    },
  );
}

/**
 * Each master's composition (keyed by "name#side" pair): what it hands its
 * pages, for passing into `detectMasters`.
 *
 * Does NOT build a union over `PageMeasure.masterItems` (present items) —
 * that approach, proposed in the original brief, has an explicit limit: an
 * item removed from ALL pages applying the master would never end up in
 * such a union at all. Task 7 removed this problem at the measurement level:
 * `PageMeasure.expectedMasterItems` (`src/jsx/map.jsx`) already carries the
 * FULL composition of the master page matching the document page's `.side`
 * — a direct walk over `masterSpread.pageItems`, not a guess from present
 * items. What's left here is just to fold it into a map keyed by
 * `master#side`, which is what `detectMasters`/`lookupExpected`
 * (`src/layout/masters.ts`) tries first. All pages with the same
 * `(master, side)` see, by construction, the same composition, so it's
 * enough to take the first entry for each key.
 */
function masterItemsOf(m: LayoutMeasure): Map<string, MasterItemRef[] | null> {
  const byKey = new Map<string, MasterItemRef[] | null>();
  for (const pg of m.pages) {
    if (pg.master === null) continue;
    const key = pg.side !== null ? `${pg.master}#${pg.side}` : pg.master;
    if (!byKey.has(key)) byKey.set(key, pg.expectedMasterItems);
  }
  return byKey;
}

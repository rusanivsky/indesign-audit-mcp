#!/usr/bin/env node
/** A run of geometry_audit on the working book. READ-ONLY.
 *  npm run build && node scripts/run-book-phase13.mjs
 *
 * Round 1 (Task 14 review): buildReport() here must receive EXACTLY the
 * same options that src/tools/geometry.ts passes — vectorGraphicsCount
 * and emptyPopulations (computed from the same inventories), otherwise
 * this script measures a report the user would NEVER get from
 * geometry_audit, and the response size in the measured facts turns out
 * incomparable to the threshold taken on that same set of options
 * (Task 12, fixture). */
import { runJsx } from "../dist/bridge/runner.js";
import { detectNearMiss, detectOffPage, surveyNearMiss } from "../dist/geometry/frame.js";
import { detectLinks, inventoryGraphics } from "../dist/geometry/image.js";
import { inventoryAnchored } from "../dist/geometry/anchored.js";
import { detectWrap, hasWrapMaterial, inventoryWrap } from "../dist/geometry/wrap.js";
import { buildReport } from "../dist/geometry/report.js";

/*
 * The near-miss threshold for THIS RUN.
 *
 * Round 2 (branch review, I2): this script was passing only
 * detectOffPage + detectWrap into buildReport, meaning the phase's MAIN
 * detector — detectNearMiss — didn't participate in the measured
 * response size at all. A number that already exceeded the threshold
 * had been taken with the main detector disabled.
 *
 * The value comes from the survey breakdown of that same run, as spec
 * §4.1 expects: the gap in the book falls between 1 and 10 pt (46
 * elements under 1 pt, empty beyond that), so 1 pt is the boundary of a
 * natural gap, not a round number pulled from thin air. It changes
 * TOGETHER with the breakdown if the book changes.
 */
const NEAR_MISS_THRESHOLD_PT = 1;

const m = await runJsx("geometry_measure", {}, { timeoutMs: 300_000 });
console.log(`документ: ${m.docName}, елементів: ${m.items.length}, сторінок: ${m.pages.length}, ${m.ms} мс`);
console.log(`початок координат: ${m.rulerOrigin}, zeroPoint ${JSON.stringify(m.zeroPoint)}`);

const survey = surveyNearMiss(m.items, m.pages);
console.log("\nsurvey близьких промахів:", survey);
console.log(
  `\nблизькі промахи (поріг ${NEAR_MISS_THRESHOLD_PT} pt):`,
  detectNearMiss(m.items, m.pages, NEAR_MISS_THRESHOLD_PT),
);
console.log("\nвихід за виліт:", detectOffPage(m.items, m.pages));
console.log("\nобтікання:", inventoryWrap(m.items), detectWrap(m.items));
console.log("\nприв'язані:", inventoryAnchored(m.items).map((r) => `${r.style}: ${r.count}`));
console.log("\nграфіка:", inventoryGraphics(m.items));
console.log("\nлінки:", detectLinks(m.items));

/* Mirrors src/tools/geometry.ts (`anchoredInventory`/`graphicsInventory`/
 * `emptyPopulations`/`vectorGraphicsCount`) — not a separate, simplified
 * set of options. */
const anchoredInventory = inventoryAnchored(m.items);
const graphicsInventory = inventoryGraphics(m.items);

const emptyPopulations = [];
if (anchoredInventory.length === 0) emptyPopulations.push("anchored");
if (graphicsInventory.length === 0) emptyPopulations.push("image");
if (!hasWrapMaterial(m.items)) emptyPopulations.push("wrap");

const vectorGraphicsCount = m.items.filter(
  (i) => i.graphic !== null && i.graphic.kind === "vector",
).length;
console.log(`\nemptyPopulations: ${JSON.stringify(emptyPopulations)}, vectorGraphicsCount: ${vectorGraphicsCount}`);

/* The phase's MAIN detector — inside the findings set, not next to it. */
const findings = [
  ...detectNearMiss(m.items, m.pages, NEAR_MISS_THRESHOLD_PT),
  ...detectOffPage(m.items, m.pages),
  ...detectWrap(m.items),
  ...detectLinks(m.items),
];

const report = buildReport(m, findings, {
  families: ["frame", "image", "anchored", "wrap"],
  rotatedExcluded: m.items.filter((i) => i.rotation !== 0).length,
  anchorRuleNamed: false,
  resolutionThresholdNamed: false,
  vectorGraphicsCount,
  emptyPopulations,
  inventory: { anchored: anchoredInventory, graphics: graphicsInventory, wrap: inventoryWrap(m.items) },
  /* A threshold is given, so survey doesn't go into the response — exactly like in the tool. */
  survey: null,
});
console.log(`\nnotMeasured (${report.notMeasured.length} рядків):`);
for (const line of report.notMeasured) console.log(`  - ${line}`);
for (const line of report.caveats) console.log(`  caveat: ${line}`);

/*
 * THE SIZE — exactly what the tool returns.
 *
 * Round 2 (I2): the size was measured as
 * `JSON.stringify(buildReport(...))` compactly, while the tool returns
 * `ok(report)`, i.e. `JSON.stringify(data, null, 2)` — with indentation
 * and with the inventory/survey fields, which weren't in the
 * measurement at all. Now the exact same string that goes to the user
 * is measured.
 */
const payload = JSON.stringify(report, null, 2);
console.log(`\nобсяг ВІДПОВІДІ (як в ok(), з відступами): ${Buffer.byteLength(payload, "utf8")} Б`);
console.log(`  для порівняння, компактно: ${Buffer.byteLength(JSON.stringify(report), "utf8")} Б`);
console.log(`  знахідок: ${report.findings.length}, обрізано: ${JSON.stringify(report.truncated)}`);
console.log(`  інвентар графіки: ${report.inventory.graphics.length} рядків, обрізано: ${JSON.stringify(report.inventory.graphicsTruncated)}`);

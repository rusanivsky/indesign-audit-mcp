/**
 * CONTROL RUN FOR PHASE 10 ON THE WORKING BOOK — FULLY READ-ONLY.
 *
 * This can't be done through the MCP tool: the server runs from the
 * MAIN checkout, and the `runningHead` family currently only lives on
 * the branch. The script goes through the same bridge, but with THIS
 * tree's build.
 *
 * The expectation is stated BEFORE the run
 * (`docs/measured-facts-phase10.md`):
 *   head-wrong-chapter 0, head-missing 0, head-unexpected 0,
 *   head-side-stray 0, head-style-stray 1 (Proba Pro Light, master C).
 * A discrepancy is a reason to stop and measure, not to adjust the
 * expectation.
 *
 * Run: node scripts/control-run-h10.mjs   (the book must be OPEN)
 */
import { runJsx } from "../dist/bridge/runner.js";
import { chapterSpans, detectHeads } from "../dist/pagination/heads.js";

const PARAMS = {
  folioStyle: "Колонтитул v1",
  contentsNumberStyle: null,
  contentsTitleStyles: [],
  headingStyles: ["Назва розділу"],
  runningHeadStyles: ["Колонтитул v1", "Колонтитул v2"],
};

const EXPECTED = {
  "head-wrong-chapter": 0,
  "head-missing": 0,
  "head-unexpected": 0,
  "head-side-stray": 0,
  "head-style-stray": 1,
};

const measure = await runJsx("pagination_measure", PARAMS, { timeoutMs: 600_000 });

console.log("документ:", measure.docName);
console.log("сторінок:", measure.pages.length);
console.log("колонтитулів (тверджень):", measure.headFrames.length);
console.log("із них із майстра:", measure.headFrames.filter((h) => h.fromMaster).length);
console.log("переозначених:", measure.headFrames.filter((h) => !h.fromMaster).length);

const spans = chapterSpans(measure.headings, measure.pages);
console.log("\nпроміжки розділів:");
for (const s of spans) {
  console.log(`  «${s.titleRaw}» — с. ${s.startPage}, offset ${s.startOffset}..${s.endOffset}`);
}

const expectedByMaster = new Map();
for (const h of measure.headFrames) {
  if (h.fromMaster && h.masterName !== null && !h.empty) expectedByMaster.set(h.masterName, h.side);
}

const result = detectHeads(measure.pages, measure.headFrames, spans, {
  compareChapter: PARAMS.headingStyles.length > 0,
  expectedByMaster,
});

const counts = {};
for (const key of Object.keys(EXPECTED)) counts[key] = 0;
for (const f of result.findings) counts[f.defect] = (counts[f.defect] ?? 0) + 1;

console.log(`\nперевірено тверджень: ${result.checked}, не порівнювали: ${result.notCompared}`);
console.log("\nправило                | очікувано | фактично | вирок");
let allMatch = true;
for (const [key, want] of Object.entries(EXPECTED)) {
  const got = counts[key];
  const ok = got === want;
  if (!ok) allMatch = false;
  console.log(`${key.padEnd(22)} | ${String(want).padStart(9)} | ${String(got).padStart(8)} | ${ok ? "збіг" : "РОЗБІЖНІСТЬ"}`);
}

console.log("\nзнахідки:");
for (const f of result.findings) {
  console.log(`  [${f.defect}] с.${f.page} рамка ${f.frameId}: ${f.detail}`);
}

console.log(`\nПІДСУМОК: ${allMatch ? "усі п'ять збіглися з очікуванням" : "Є РОЗБІЖНІСТЬ — зупинитись і міряти"}`);

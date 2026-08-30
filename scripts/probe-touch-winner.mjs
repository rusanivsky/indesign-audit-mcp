#!/usr/bin/env node
/**
 * Зонд 2: коли маркер торкається ДВОХ сусідів — ланцюжка й глухого кута —
 * ХТО з них дає число?
 *
 * Зонд 1 (`probe-touch-marker.mjs`) довів, що нульовий дотик InDesign
 * зараховує. Звідси й відмова на семи сторінках книжки: колонцифра там
 * торкається і службового ланцюжка, і рамки декоративної лапки (історія з
 * однієї рамки — вести нема куди). Інструмент відмовляється, бо не може
 * обіцяти, хто виграє.
 *
 * ПИТАННЯ: а InDesign узагалі має тут правило? Якщо ланцюжок виграє
 * СТАБІЛЬНО — сім сторінок насправді безпечні, і відмова надто обережна.
 * Якщо виграє глухий кут або результат залежить від порядку — відмова
 * правильна, і лапку таки треба посунути.
 *
 * Розрізняч той самий: «2» = число взяте з ланцюжка, «3» = маркер не
 * розв'язався й надрукував поточну сторінку.
 *
 * Пробуємо ОБИДВА порядки накладання (z-order), бо це найімовірніший
 * прихований чинник.
 *
 *   npm run build && node scripts/probe-touch-winner.mjs
 */
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { runJsx } from "../dist/bridge/runner.js";

const dir = await mkdtemp(join(tmpdir(), "touch-winner-"));

/* deadFirst: чи створювати глухий кут ДО ланцюжка (нижче за z-order). */
const build = (deadFirst) => `
app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;
var doc = app.documents.add();
doc.documentPreferences.facingPages = false;
while (doc.pages.length < 4) doc.pages.add();

function mk(pageIdx, bounds) {
  var f = doc.pages[pageIdx].textFrames.add();
  f.geometricBounds = bounds;
  return f;
}

var deadFirst = ${deadFirst ? "true" : "false"};
var dead = null, chain = [];

function makeDead() {
  /* Глухий кут: одна рамка у власній історії. Праве ребро = 100. */
  dead = mk(2, [100, 40, 150, 100]);
  dead.contents = "x";
}
function makeChain() {
  /* Ланцюжок на всіх сторінках; на с.3 його ліве ребро = 300. */
  for (var i = 0; i < 4; i++) chain.push(mk(i, [100, 300, 150, 500]));
  for (var j = 0; j < chain.length - 1; j++) chain[j].nextTextFrame = chain[j + 1];
}
if (deadFirst) { makeDead(); makeChain(); } else { makeChain(); makeDead(); }

/* Піддослідна з маркером — торкається ОБОХ: ліве ребро 100 (= праве ребро
 * глухого кута), праве ребро 300 (= ліве ребро ланки). Площа перетину з
 * кожним — нуль, рівно як у книжці. */
var p = mk(2, [100, 100, 150, 300]);
p.contents = "P";
p.insertionPoints[-1].contents = SpecialCharacters.PREVIOUS_PAGE_NUMBER;

doc.exportFile(ExportFormat.PDF_TYPE, new File("${dir}/w.pdf"), false);
__result = {
  deadIndex: dead.index, chainIndex: chain[2].index, probeIndex: p.index,
  deadStoryId: Number(dead.parentStory.id), chainStoryId: Number(chain[2].parentStory.id), deadStoryFrames: dead.parentStory.textContainers.length,
  chainStoryFrames: chain[2].parentStory.textContainers.length
};
`;

const CLOSE = `app.activeDocument.close(SaveOptions.NO); __result = {closed: true};`;

const results = {};
for (const deadFirst of [true, false]) {
  const info = await runJsx("run_script", { script: build(deadFirst), undoName: "Зонд переможця: побудова" }, { timeoutMs: 300_000 });
  const pdf = await getDocument({ data: new Uint8Array(await readFile(join(dir, "w.pdf"))) }).promise;
  const text = (await (await pdf.getPage(3)).getTextContent()).items.map((i) => i.str).join("").replace(/\s+/gu, " ").trim();
  await runJsx("run_script", { script: CLOSE, undoName: "Зонд переможця: закриття" }, { timeoutMs: 120_000 });

  const num = (text.match(/P\s*(\d+)/u) ?? [])[1] ?? "?";
  results[deadFirst ? "глухий кут НИЖЧЕ ланцюжка" : "глухий кут ВИЩЕ ланцюжка"] = { printed: text, num, info };
  console.log(`${deadFirst ? "глухий кут ПЕРШИЙ" : "глухий кут ДРУГИЙ"}: P = ${num}  |  story.id глухого кута = ${info.deadStoryId}, ланцюжка = ${info.chainStoryId} → раніший (менший) = ${info.deadStoryId < info.chainStoryId ? "ГЛУХИЙ КУТ" : "ланцюжок"}`);
}
await rm(dir, { recursive: true, force: true });

const nums = Object.values(results).map((r) => r.num);
console.log("\n=== ВІДПОВІДЬ ===");
if (nums.every((n) => n === "2")) {
  console.log("Ланцюжок виграє В ОБОХ порядках — глухий кут маркерові не заважає.\nВідмова на семи сторінках НАДТО ОБЕРЕЖНА: вада в коді інструмента.");
} else if (nums.every((n) => n === "3")) {
  console.log("Глухий кут виграє В ОБОХ порядках — маркер не розв'язується.\nВідмова ПРАВИЛЬНА, і лапку таки треба посунути.");
} else {
  console.log(`Результат ЗАЛЕЖИТЬ ВІД ПОРЯДКУ (${nums.join(" / ")}) — отже надійно\nпообіцяти число неможливо, і відмова інструмента правильна.`);
}

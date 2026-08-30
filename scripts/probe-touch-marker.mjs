#!/usr/bin/env node
/**
 * Зонд: чи ЗАРАХОВУЄ InDesign ДОТИК із нульовою площею, коли маркер
 * «Продовження з с. X» шукає, з чиєї історії взяти число?
 *
 * НАВІЩО. Сім сторінок робочої книжки (101, 109, 153, 167, 171, 185, 195)
 * дістають від `pagination_apply` відмову `no-neighbour-frame`. Причина за
 * моделлю така: колонцифра там торкається ДВОХ сусідів — порожньої рамки
 * службового ланцюжка (дасть правильне число) і рамки декоративної лапки
 * «’’» (глухий кут: у її історії одна рамка). Виміряно на с. 101: праве ребро
 * лапки й ліве ребро колонцифри — те саме число 470.6 pt, тобто спільна
 * лінія й НУЛЬОВА площа перетину.
 *
 * ПИТАННЯ, ВІД ЯКОГО ЗАЛЕЖИТЬ, ДЕ ВАДА:
 *   - якщо InDesign нульовий дотик ЗАРАХОВУЄ — інструмент моделює його
 *     правильно, відмова є страховкою, і лагодити треба верстку (посунути
 *     лапку) або лишити ці сім колонцифр ручними;
 *   - якщо НЕ зараховує — інструмент відмовляє даремно, вада в коді, і сім
 *     сторінок полагодяться самі.
 *
 * ЯК МІРЯЄМО. Власна фікстура (книжки користувача НЕ чіпаємо):
 * ланцюжок порожніх рамок на 4 сторінках + три рамки-піддослідні на с. 3,
 * кожна з маркером PREVIOUS_PAGE_NUMBER:
 *
 *   A — ДОТИК: праве ребро A дорівнює лівому ребру ланки (площа перетину 0)
 *   B — СПРАВЖНЄ ПЕРЕКРИТТЯ з ланкою (контроль «має спрацювати»)
 *   C — БЕЗ КОНТАКТУ (контроль «не має спрацювати»)
 *
 * Розрізняч однозначний і виміряний Фазою 7: маркер, якому НЕ БУЛО на що
 * розв'язатись, друкує номер ПОТОЧНОЇ сторінки, а не порожнечу. Отже
 * «2» = розв'язався через ланцюжок, «3» = не розв'язався.
 *
 *   npm run build && node scripts/probe-touch-marker.mjs
 */
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { runJsx } from "../dist/bridge/runner.js";

const dir = await mkdtemp(join(tmpdir(), "touch-marker-"));

const BUILD = `
app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;
var doc = app.documents.add();
doc.documentPreferences.facingPages = false;
while (doc.pages.length < 4) doc.pages.add();

/* Ланцюжок: порожня рамка на КОЖНІЙ сторінці, зшита в порядку сторінок —
 * рівно те, що будує create-helper-thread. */
var chain = [];
for (var i = 0; i < 4; i++) {
  var f = doc.pages[i].textFrames.add();
  f.geometricBounds = [100, 100, 150, 300];
  chain.push(f);
}
for (var j = 0; j < chain.length - 1; j++) chain[j].nextTextFrame = chain[j + 1];

/* Три піддослідні на с. 3 (індекс 2). Кожна — ОКРЕМА історія з однією
 * рамкою, як рамка лапки в книжці. */
function probe(bounds, label) {
  var t = doc.pages[2].textFrames.add();
  t.geometricBounds = bounds;
  t.contents = label;
  t.insertionPoints[-1].contents = SpecialCharacters.PREVIOUS_PAGE_NUMBER;
  return t;
}
var link = chain[2].geometricBounds;   /* [100, 100, 150, 300] */

/* A: праве ребро = ліве ребро ланки. Спільна лінія, площа 0. */
probe([100, 40, 150, Number(link[1])], "A");
/* B: заходить у ланку на 50 pt по горизонталі й на 30 по вертикалі. */
probe([120, 250, 170, 400], "B");
/* C: жодного контакту — на 150 pt нижче. */
probe([300, 100, 350, 300], "C");

doc.exportFile(ExportFormat.PDF_TYPE, new File("${dir}/probe.pdf"), false);
__result = {
  docName: String(doc.name),
  chainStory: String(chain[0].parentStory.id),
  chainFrames: chain[0].parentStory.textContainers.length,
  aBounds: String(doc.pages[2].textFrames[-1].geometricBounds)
};
`;

const CLOSE = `app.activeDocument.close(SaveOptions.NO); __result = {closed: true};`;

const built = await runJsx("run_script", { script: BUILD, undoName: "Зонд дотику: побудова фікстури" }, { timeoutMs: 300_000 });
console.log("фікстура:", built.docName, "| ланцюжок: історія", built.chainStory, "із", built.chainFrames, "рамок");

const pdf = await getDocument({ data: new Uint8Array(await readFile(join(dir, "probe.pdf"))) }).promise;
const page3 = await (await pdf.getPage(3)).getTextContent();
const printed = page3.items.map((i) => i.str).join("").replace(/\s+/gu, " ").trim();

await runJsx("run_script", { script: CLOSE, undoName: "Зонд дотику: закриття" }, { timeoutMs: 120_000 });
await rm(dir, { recursive: true, force: true });

console.log("\nнадруковано на с.3:", JSON.stringify(printed));
const read = (label) => (printed.match(new RegExp(label + "\\s*(\\d+)", "u")) ?? [])[1] ?? "?";
const [a, b, c] = ["A", "B", "C"].map(read);
console.log(`  A (ДОТИК, площа 0)     → ${a}`);
console.log(`  B (справжнє перекриття) → ${b}`);
console.log(`  C (без контакту)        → ${c}`);

console.log("\n-- контролі --");
console.log(`B має дати 2 (розв'язався): ${b === "2" ? "так" : "НІ — дослід недійсний"}`);
console.log(`C має дати 3 (не розв'язався): ${c === "3" ? "так" : "НІ — дослід недійсний"}`);
if (b !== "2" || c !== "3") {
  console.log("\nКОНТРОЛІ НЕ ЗІЙШЛИСЬ — висновку про A робити НЕ МОЖНА.");
  process.exit(1);
}
console.log("\n=== ВІДПОВІДЬ ===");
console.log(a === "2"
  ? "InDesign ЗАРАХОВУЄ нульовий дотик → інструмент моделює правильно,\nвідмова на семи сторінках — страховка, а не вада коду."
  : a === "3"
    ? "InDesign нульовий дотик НЕ зараховує → рамка лапки насправді не є\nкандидатом, відмова зайва, вада В КОДІ."
    : `A дало «${a}» — не 2 і не 3; розбиратися окремо.`);

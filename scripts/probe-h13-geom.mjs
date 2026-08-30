#!/usr/bin/env node
/**
 * Прохід 2 зонда H13 — геометрія. ЧИТАЛЬНИЙ.
 *
 * Сирі записи (по одному на елемент) складаються у файл, а в консоль іде
 * тільки аналіз: 965 записів у stdout нечитабельні, а перепрогін через
 * InDesign коштує сеансу. Файл дає змогу переаналізувати ті самі числа без
 * повторного звернення до застосунку.
 *
 *   npm run build && node scripts/probe-h13-geom.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import { runJsx } from "../dist/bridge/runner.js";

const OUT = new URL("./probe-h13-geom.raw.json", import.meta.url);

const script = await readFile(new URL("./probe-h13-geom.jsx", import.meta.url), "utf8");
const res = await runJsx(
  "run_script",
  { script, undoName: "Зонд H13 геометрія (лише читання)" },
  { timeoutMs: 600_000 },
);

if (res.fatal) {
  console.error("ФАТАЛЬНО:", res.fatal);
  process.exit(1);
}

await writeFile(OUT, JSON.stringify(res, null, 1), "utf8");

const items = res.items;
const pct = (n) => `${n} (${((100 * n) / items.length).toFixed(1)} %)`;

console.log("=== H13 прохід 2 ===");
console.log("версія InDesign:", res.app.version, "| час обходу:", res.ms, "мс");
console.log("нотатки:", res.notes.join(" / "));
console.log("кинуло:", res.threw.length ? res.threw.slice(0, 10) : "нічого");
console.log("\n-- Питання 8: популяція --");
console.log(res.stats);

console.log("\n-- Питання 10: полоса набору, дзеркалення --");
const outLit = items.filter((i) => i.outLiteral).length;
const outMir = items.filter((i) => i.outMirrored).length;
console.log("за полосою за ЛІТЕРАЛЬНОГО читання left/right:", pct(outLit));
console.log("за полосою за ДЗЕРКАЛЬНОГО читання (verso міняє місцями):", pct(outMir));
/* Розкладка окремо по recto й verso: якщо поля дзеркальні, то за
 * літерального читання verso показуватиме масовий вихід, а recto — ні. */
for (const side of ["LEFT_HAND", "RIGHT_HAND"]) {
  const s = items.filter((i) => i.side === side);
  const l = s.filter((i) => i.outLiteral).length;
  const m = s.filter((i) => i.outMirrored).length;
  console.log(`  ${side}: усього ${s.length}, літерально за полосою ${l}, дзеркально ${m}`);
}

console.log("\n-- Питання 11: наскільки саме виходять --");
const outs = items.filter((i) => i.outLiteral && typeof i.maxOut === "number");
const buckets = { "≤0.01": 0, "≤0.1": 0, "≤1": 0, "≤5": 0, "≤20": 0, ">20": 0 };
for (const i of outs) {
  const v = i.maxOut;
  if (v <= 0.01) buckets["≤0.01"]++;
  else if (v <= 0.1) buckets["≤0.1"]++;
  else if (v <= 1) buckets["≤1"]++;
  else if (v <= 5) buckets["≤5"]++;
  else if (v <= 20) buckets["≤20"]++;
  else buckets[">20"]++;
}
console.log("розподіл найбільшого виходу за полосу, pt:", buckets);
console.log("за межі САМОЇ сторінки:", pct(items.filter((i) => i.offPage).length));

console.log("\n-- Питання 12: перетини й дотики --");
console.log("елементів, що з кимось перетинаються:", pct(items.filter((i) => i.hits).length));
const touching = items.filter((i) => i.touch);
console.log("елементів у ДОТИКУ (перетин рівно 0 по осі):", pct(touching.length));
const touchPages = [...new Set(touching.map((i) => i.pg))];
console.log("сторінки з дотиком:", touchPages.length, "→", touchPages.slice(0, 30).join(", "));

console.log("\n-- Питання 9: обтікання --");
console.log(res.stats.wrapModes, "| не-NONE:", res.stats.wrapNonNone);

console.log(`\nсирі записи: ${OUT.pathname}`);

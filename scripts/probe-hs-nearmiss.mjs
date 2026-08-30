#!/usr/bin/env node
/**
 * Прохід 2 зонда `HS` — ОФЛАЙН, по збережених числах першого проходу.
 * До InDesign не звертається взагалі.
 *
 * Питання одне: чи є «близький промах» між стилями окремим детектором —
 * тобто чи відокремлює вимір різницю, яку НЕ МОЖНА було задумати
 * (соті частки пункту), від різниці задуманої (кегль 11 проти 24).
 *
 *   node scripts/probe-hs-nearmiss.mjs
 */
import { readFile } from "node:fs/promises";

const raw = JSON.parse(await readFile(new URL("./probe-hs.raw.json", import.meta.url), "utf8"));
const m = raw.m;
const styles = m.styles;

const usageNoMaster = new Map();
for (const p of m.paragraphs) if (!p.isMaster) usageNoMaster.set(p.styleId, (usageNoMaster.get(p.styleId) ?? 0) + 1);
const used = styles.filter((s) => (usageNoMaster.get(s.id) ?? 0) > 0);

const NUM = ["pointSize", "leading", "firstLineIndent", "leftIndent", "rightIndent", "spaceBefore", "spaceAfter", "tracking"];

/* Усі числові розбіжності між парами ужитих стилів, відсортовані за
 * величиною. Питання не «скільки їх», а «де проходить розрив». */
const deltas = [];
for (let i = 0; i < used.length; i++) {
  for (let j = i + 1; j < used.length; j++) {
    for (const prop of NUM) {
      const x = used[i].declared[prop], y = used[j].declared[prop];
      if (typeof x === "number" && typeof y === "number" && x !== y) {
        deltas.push({ prop, d: Math.abs(x - y), a: used[i], b: used[j], x, y });
      }
    }
  }
}
deltas.sort((u, v) => u.d - v.d);

console.log("=== Зонд HS, прохід 2 (офлайн): близький промах між стилями ===");
console.log("ужитих стилів:", used.length, "| числових розбіжностей усього:", deltas.length);

console.log("\n-- Двадцять НАЙМЕНШИХ розбіжностей у документі --");
for (const e of deltas.slice(0, 20)) {
  console.log(`${e.d.toFixed(6).padStart(12)} pt  ${e.prop.padEnd(16)} «${e.a.name}» ${e.x} / «${e.b.name}» ${e.y}`);
}

/* Розрив шукається за відношенням сусідніх значень у відсортованому ряду:
 * якщо між k-м і (k+1)-м значенням стрибок на порядок, це і є природна
 * межа — той самий метод, яким Фаза 13 знайшла межу 1 pt проти 10 pt. */
console.log("\n-- Де саме проходить розрив (стрибки між сусідніми значеннями) --");
for (let k = 0; k + 1 < Math.min(deltas.length, 60); k++) {
  const lo = deltas[k].d, hi = deltas[k + 1].d;
  if (lo > 0 && hi / lo >= 5) {
    console.log(`  розрив ×${(hi / lo).toFixed(1)}: ${lo.toFixed(6)} pt → ${hi.toFixed(6)} pt  (нижче межі — ${k + 1} розбіжностей)`);
  }
}

/* Скільки знахідок дав би детектор при кількох порогах — і, головне,
 * скільки з них торкаються ОДНІЄЇ пари стилів (звіт про пару, не про
 * властивість, інакше одна помилка дає до восьми рядків). */
console.log("\n-- Скільки знахідок при кожному порозі --");
for (const t of [0.01, 0.1, 0.5, 1, 2]) {
  const hit = deltas.filter((e) => e.d <= t);
  const pairs = new Set(hit.map((e) => `${e.a.id}|${e.b.id}`));
  console.log(`поріг ≤ ${String(t).padEnd(5)} pt: розбіжностей ${String(hit.length).padStart(3)}, унікальних пар стилів ${pairs.size}`);
}

console.log("\n-- Пари під порогом 0.5 pt, повністю --");
const sub = deltas.filter((e) => e.d <= 0.5);
const byPair = new Map();
for (const e of sub) {
  const k = `«${e.a.name}» / «${e.b.name}»`;
  if (!byPair.has(k)) byPair.set(k, []);
  byPair.get(k).push(`${e.prop} ${e.x} проти ${e.y} (Δ ${e.d.toFixed(6)})`);
}
for (const [k, v] of byPair) console.log(`${k}\n    ${v.join("\n    ")}`);

/* Контроль: чи ті самі пари не є просто наслідком переведення міліметрів
 * у пункти. 1 mm = 2.834645669... pt; величина, кратна цьому з точністю
 * до 1e-9, — це «рівне» число в міліметрах, а не промах верстальника. */
console.log("\n-- Контроль: чи це артефакт переведення mm → pt --");
const MM = 2.834645669291339;
for (const e of sub) {
  const inMm = e.d / MM;
  console.log(`${e.prop.padEnd(16)} Δ ${e.d.toFixed(9)} pt = ${inMm.toFixed(9)} mm` +
    `${Math.abs(inMm - Math.round(inMm)) < 1e-6 ? "  ← РІВНЕ число міліметрів" : ""}`);
}

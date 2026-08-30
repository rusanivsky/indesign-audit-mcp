#!/usr/bin/env node
/**
 * Запускач зонда TextPath (§1 промпту сесії 4). ЛИШЕ ЧИТАННЯ.
 *
 *   npm run build && node scripts/probe-textpath.mjs
 *
 * Сирий результат лягає у файл поряд: перепрогін коштує сеансу InDesign,
 * тож числа мають пережити аналіз.
 */
import { readFile, writeFile } from "node:fs/promises";
import { runJsx } from "../dist/bridge/runner.js";

const OUT = new URL("./probe-textpath.raw.json", import.meta.url);

const script = await readFile(new URL("./probe-textpath.jsx", import.meta.url), "utf8");
const res = await runJsx(
  "run_script",
  { script, undoName: "Зонд TextPath (лише читання)" },
  { timeoutMs: 900_000 },
);

if (res.fatal) {
  console.error("ФАТАЛЬНО у JSX:", res.fatal);
}

await writeFile(OUT, JSON.stringify(res, null, 1), "utf8");

console.log("=== Зонд TextPath ===");
console.log("документ:", res.docName, "| сторінок:", res.pageCount, "| InDesign:", res.app?.version);
console.log("історій:", res.storyCount, "| контейнерів:", res.containerTotal, "| час:", res.ms, "мс");
console.log("нотатки:", (res.notes || []).join(" / "));
console.log("кинуло на рівні story:", res.threw?.length ? res.threw : "нічого");

console.log("\n-- Класи контейнерів --");
console.log(res.kinds);

console.log(`\n-- Підозрілі контейнери: ${res.suspects?.length ?? 0} --`);
for (const rec of res.suspects ?? []) {
  console.log(`\nstory:${rec.storyIndex} контейнер ${rec.containerIndex} — ${rec.kind.name} (ctor=${rec.kind.ctor}, reflect=${rec.kind.reflect})`);
  for (const p of rec.props) {
    console.log(`   ${p.ok ? "✓" : "✗"} ${p.prop.padEnd(34)} ${p.ok ? p.value : p.err}`);
  }
}

/* Зведення: які властивості кидають НА ВСІХ підозрілих, а які лише подекуди. */
const byProp = new Map();
for (const rec of res.suspects ?? []) {
  for (const p of rec.props) {
    if (!byProp.has(p.prop)) byProp.set(p.prop, { ok: 0, threw: 0 });
    byProp.get(p.prop)[p.ok ? "ok" : "threw"] += 1;
  }
}
console.log("\n-- Зведення по властивостях (ok / кинуло) --");
for (const [prop, n] of byProp) {
  const mark = n.threw === 0 ? "БЕЗПЕЧНА" : n.ok === 0 ? "КИДАЄ ЗАВЖДИ" : "КИДАЄ ПОДЕКУДИ";
  console.log(`   ${prop.padEnd(34)} ${String(n.ok).padStart(3)} / ${String(n.threw).padStart(3)}   ${mark}`);
}

#!/usr/bin/env node
/**
 * Зонд `HS` — блок `S`, узгодженість між РІЗНИМИ стилями. ЧИТАЛЬНИЙ.
 *
 * Викликає вже наявний обробник `styles_measure` (нового JSX фаза не
 * потребує: `IDMCP.declaredStyleValues` віддає всі 12 властивостей на стиль
 * ще з Фази 5). Сирі числа кладуться у файл, у консоль іде лише аналіз.
 *
 *   npm run build && node scripts/probe-hs.mjs
 *
 * ЗАДУМ ЗОНДА — ВБИТИ ДЕТЕКТОРИ ДО КОДУ, а не підтвердити задум. Фаза 13
 * так зняла два найочевидніші детектори (602 знахідки з нулем дефектів);
 * тут під тим самим підозрінням «наївна попарна різниця в одній
 * властивості».
 */
import { readFile, writeFile } from "node:fs/promises";
import { runJsx } from "../dist/bridge/runner.js";

const OUT = new URL("./probe-hs.raw.json", import.meta.url);

/* Прапорець читальності знімається ДО і ПІСЛЯ виміру: у цьому проєкті
 * читальність доводиться прапорцем на свіжовідкритому документі, а не
 * обіцянкою (Фаза 9, «читальність доведена прапорцем»). */
const flag = async () =>
  runJsx("run_script", {
    /* Два окремі факти, обидва виміряні на цьому зонді, а не вгадані:
     * (1) у ExtendScript (ES3) глобального JSON немає — серіалізує місток;
     * (2) `run_script` віддає `__result`, а НЕ значення останнього виразу
     *     (`src/jsx/run.jsx`). Трейлінг-вираз тихо дає null — тобто перша
     *     редакція цього зонда «доводила» читальність порожнечею. */
    script: "var d = app.documents[0]; __result = {name: String(d.name), modified: d.modified};",
    undoName: "Зонд HS: прапорець (лише читання)",
  }, { timeoutMs: 60_000 });

const before = await flag();
const t0 = Date.now();
const m = await runJsx("styles_measure", {}, { timeoutMs: 600_000 });
const ms = Date.now() - t0;
const after = await flag();

await writeFile(OUT, JSON.stringify({ before, after, ms, m }, null, 1), "utf8");

console.log("=== Зонд HS: блок S, узгодженість між різними стилями ===");
console.log("документ:", m.docName, "| styles_measure:", ms, "мс");
console.log("modified до:", JSON.stringify(before), "\nmodified після:", JSON.stringify(after));

const styles = m.styles;
const PROPS = Object.keys(styles[0].declared);

/* Ужиток за `.id`, НЕ за назвою — п'ять разів виловлена пастка Фази 5.
 * Абзаци батьківських сторінок рахуються окремо: решта текстових родин
 * проєкту їх відсіює, і родина блоку S муситиме вирішити те саме. */
const usage = new Map();
const usageNoMaster = new Map();
for (const p of m.paragraphs) {
  usage.set(p.styleId, (usage.get(p.styleId) ?? 0) + 1);
  if (!p.isMaster) usageNoMaster.set(p.styleId, (usageNoMaster.get(p.styleId) ?? 0) + 1);
}
const used = styles.filter((s) => (usageNoMaster.get(s.id) ?? 0) > 0);

console.log("\n-- Q1: популяція --");
console.log("абзацних стилів оголошено:", styles.length, "| ужито (без майстрів):", used.length);
console.log("символьних стилів:", m.characterStyles.length,
  "| з них ужитих:", m.characterStyles.filter((c) => c.appliedRuns > 0).length);
console.log("абзаців:", m.paragraphs.length, "| поза сторінками:", m.paragraphsOffPage);
const fams = new Map();
for (const s of used) {
  const f = s.declared.appliedFont;
  fams.set(f, (fams.get(f) ?? 0) + 1);
}
console.log("гарнітур серед ужитих стилів:", fams.size, "→", [...fams].map(([k, v]) => `${k}:${v}`).join(", "));
const folders = new Map();
for (const s of used) {
  const seg = s.path.split("/");
  const dir = seg.length > 1 ? seg.slice(0, -1).join("/") : "(корінь)";
  folders.set(dir, (folders.get(dir) ?? 0) + 1);
}
console.log("тек:", folders.size, "→", [...folders].map(([k, v]) => `${k}:${v}`).join(", "));

/* --- Q2: наївний попарний детектор --- */
const differ = (a, b) => PROPS.filter((p) => JSON.stringify(a.declared[p]) !== JSON.stringify(b.declared[p]));
const pairs = [];
for (let i = 0; i < used.length; i++) {
  for (let j = i + 1; j < used.length; j++) {
    const d = differ(used[i], used[j]);
    pairs.push({ a: used[i], b: used[j], d });
  }
}
const byDiffCount = {};
for (const p of pairs) byDiffCount[p.d.length] = (byDiffCount[p.d.length] ?? 0) + 1;

console.log("\n-- Q2: наївна попарна різниця (усі пари ужитих стилів) --");
console.log("усього пар:", pairs.length, "(n² від", used.length, "стилів)");
console.log("розподіл за числом розбіжних властивостей:", byDiffCount);
const near = pairs.filter((p) => p.d.length === 1);
console.log("ПАР, ЩО РІЗНЯТЬСЯ РІВНО ОДНІЄЮ властивістю:", near.length);
const byProp = {};
for (const p of near) byProp[p.d[0]] = (byProp[p.d[0]] ?? 0) + 1;
console.log("яка саме властивість розходиться:", byProp);
for (const p of near.slice(0, 12)) {
  console.log(`   «${p.a.name}» / «${p.b.name}» — ${p.d[0]}: ` +
    `${JSON.stringify(p.a.declared[p.d[0]])} проти ${JSON.stringify(p.b.declared[p.d[0]])}`);
}

/* --- Q3: пастка fontStyle поза межами однієї гарнітури --- */
console.log("\n-- Q3: хибні спрацювання fontStyle між РІЗНИМИ гарнітурами --");
const fsPairs = pairs.filter((p) => p.d.includes("fontStyle"));
const fsCross = fsPairs.filter((p) => p.a.declared.appliedFont !== p.b.declared.appliedFont);
console.log("пар із розбіжним fontStyle:", fsPairs.length, "| з них МІЖ РІЗНИМИ гарнітурами:", fsCross.length);
console.log("(усі", fsCross.length, "— хибні за виміром Фази 5: `SemiBold` Proba Pro проти `Semi Bold` ZT Neue Ralewe)");

/* --- Q4: чи виводиться групування «ці стилі МАЮТЬ узгоджуватись» --- */
console.log("\n-- Q4: три кандидати на партицію (чи derivable група) --");
const partitions = {
  "тека": (s) => { const g = s.path.split("/"); return g.length > 1 ? g.slice(0, -1).join("/") : "(корінь)"; },
  "спільний basedOn": (s) => s.basedOnId ?? "(корінь)",
  "перше слово назви": (s) => s.name.split(/[\s ]+/)[0],
};
for (const [label, keyFn] of Object.entries(partitions)) {
  const groups = new Map();
  for (const s of used) {
    const k = keyFn(s);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }
  const multi = [...groups.values()].filter((g) => g.length >= 2);
  const covered = multi.reduce((n, g) => n + g.length, 0);
  let within = 0;
  for (const g of multi) {
    for (let i = 0; i < g.length; i++) {
      for (let j = i + 1; j < g.length; j++) if (differ(g[i], g[j]).length === 1) within++;
    }
  }
  console.log(`${label}: груп ≥2 — ${multi.length}, охоплено стилів ${covered}/${used.length}, ` +
    `пар «різниця в одній властивості» ВСЕРЕДИНІ груп — ${within}`);
}

/* --- Q5: чи є природний розрив у числових розбіжностях --- */
console.log("\n-- Q5: розкладка числових розбіжностей (чи є природний розрив) --");
const NUM = ["pointSize", "leading", "firstLineIndent", "leftIndent", "rightIndent", "spaceBefore", "spaceAfter", "tracking"];
for (const prop of NUM) {
  const deltas = [];
  for (const p of pairs) {
    const x = p.a.declared[prop], y = p.b.declared[prop];
    if (typeof x === "number" && typeof y === "number" && x !== y) deltas.push(Math.abs(x - y));
  }
  if (!deltas.length) { console.log(`${prop}: розбіжностей нема`); continue; }
  deltas.sort((u, v) => u - v);
  const b = { "≤0.5": 0, "≤1": 0, "≤2": 0, "≤5": 0, ">5": 0 };
  for (const d of deltas) {
    if (d <= 0.5) b["≤0.5"]++; else if (d <= 1) b["≤1"]++;
    else if (d <= 2) b["≤2"]++; else if (d <= 5) b["≤5"]++; else b[">5"]++;
  }
  console.log(`${prop}: пар ${deltas.length}, мін ${deltas[0]}, макс ${deltas[deltas.length - 1]}, розкладка`, b);
}

/* --- Q6: майже одностайні властивості (детектор конвенції, O(n)) --- */
console.log("\n-- Q6: майже одностайні властивості — конвенція документа --");
for (const prop of PROPS) {
  const vals = new Map();
  for (const s of used) {
    const k = JSON.stringify(s.declared[prop]);
    if (!vals.has(k)) vals.set(k, []);
    vals.get(k).push(s.name);
  }
  const sorted = [...vals].sort((x, y) => y[1].length - x[1].length);
  const [topVal, topStyles] = sorted[0];
  const share = topStyles.length / used.length;
  const minority = used.length - topStyles.length;
  if (share >= 0.7 && minority > 0 && minority <= 5) {
    console.log(`${prop}: ${topStyles.length}/${used.length} мають ${topVal}, ` +
      `меншість ${minority} → ` +
      sorted.slice(1).map(([v, ss]) => `${v}: ${ss.join(", ")}`).join(" | "));
  } else {
    console.log(`${prop}: різних значень ${vals.size}, модальне ${topVal} у ${topStyles.length}/${used.length} — не конвенція`);
  }
}

console.log(`\nсирі числа: ${OUT.pathname}`);

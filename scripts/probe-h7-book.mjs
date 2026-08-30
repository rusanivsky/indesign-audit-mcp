/*
 * Зонд H7, Питання 1–3: запуск читального проходу по РОБОЧІЙ КНИЖЦІ й
 * зведення чисел.
 *
 * Через зібрану гілку (`npm run build`, далі `runJsx` з `dist/`), а НЕ через
 * `mcp__indesign__*`: сервер MCP запущено з основної теки репозиторію й
 * мовчки віддав би стару збірку.
 *
 * Скрипт нічого не змінює в документі. `doc.modified` друкується до й після —
 * якщо він змінився, це видно в звіті, а не приховано.
 *
 * Друкує результат І ПРИ ПРОВАЛІ: мовчазний вихід із нулем читався б як
 * «чисто».
 */
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { runJsx } from "../dist/bridge/runner.js";

const DOC = process.env.H7_DOC ?? "Book 260807-0100.indd";
const STYLE = process.env.H7_STYLE ?? "Колонтитул v1";
/* Сторінки з ДВОМА колонцифрами, вибрані з початку, середини й кінця книжки. */
const EXPORT_PAGES = process.env.H7_PAGES ?? "23,101,191";

/* `run_script` віддає скриптові ВЕСЬ об'єкт params (run.jsx: eval у своїй
 * області видимості), тож поля кладуться поруч зі script, а не всередину. */
const script = await readFile(new URL("./probe-h7-book.jsx", import.meta.url), "utf8");
const run = (extra, timeoutMs = 300_000) =>
  runJsx("run_script", { script, styleName: STYLE, undoName: "Зонд H7 (лише читання)", ...extra }, { timeoutMs });

/* ── ПОЗИТИВНИЙ КОНТРОЛЬ: той САМИЙ вимірювальний код по фікстурі, де
 * перекриття й сусіди свідомо є. На книжці `covered` вийшов 0 і гілка
 * «сусід → сторінка → оракул» не виконалась жодного разу, тож помилка саме
 * в ній дала б ті самі числа (рецензія, Important 3). ── */
console.log("=== ПОЗИТИВНИЙ КОНТРОЛЬ ВИМІРЮВАЛЬНОГО КОДУ ===");
const built = await run({ phase: "build-control" });
for (const n of built.notes ?? []) console.log(" ", n);
if (built.error) {
  console.log("ПОМИЛКА побудови контролю:", built.error);
  process.exit(1);
}
let control = null;
try {
  control = await run({ docName: built.control.docName });
  if (control.error) console.log("ПОМИЛКА виміру контролю:", control.error);
} finally {
  /* Прибирання ОБОВ'ЯЗКОВЕ й до будь-якого виходу: інакше 16-сторінковий
   * тимчасовий документ лишиться відкритим біля книжки користувача. */
  const closed = await run({ phase: "close", docName: built.control.docName });
  for (const n of closed.notes ?? []) console.log(" ", n);
  if (closed.error) console.log("ПОМИЛКА прибирання контролю:", closed.error);
}
/* КОНТРОЛЬ МУСИТЬ ГЕЙТИТИ ПРОГІН.
 *
 * Попередня редакція друкувала «КОНТРОЛЬ ПРОВАЛЕНО» й ішла далі міряти книжку з
 * нульовим кодом виходу, а якщо `control.error` був непорожній — жоден assert не
 * виконувався взагалі. Тобто вісім перевірок нічого не гейтили, і зламаний
 * вимірювальний код усе одно видав би «0 із 91» як факт (рецензія, №9). */
if (!control || control.error) {
  console.log("  КОНТРОЛЬ НЕ ВИКОНАВСЯ — вимірювальний код не перевірено, числа книжки нічого не означають");
  process.exit(3);
}
{
  const exp = built.control.expected;
  const agg = { total: 0, covered: 0, noOverlap: 0, overlapNoThread: 0, threadNoNeighbour: 0, neighbourWrongPage: 0, notOracle: 0 };
  for (const c of Object.values(control.q3.coverage)) for (const k of Object.keys(agg)) agg[k] += c[k];
  const gotPages = control.frames.filter((f) => f.covered).map((f) => f.page).sort();
  const wantPages = [...exp.coveredPages].sort();
  console.log(`  фікстура: рамок ${agg.total} (очікувано ${exp.total}), ПОКРИТО ${agg.covered} (очікувано ${exp.covered})`);
  console.log(`  покриті сторінки: ${JSON.stringify(gotPages)} (очікувано ${JSON.stringify(wantPages)})`);
  console.log(`  гілки: сусід не на тій сторінці ${agg.neighbourWrongPage}/${exp.neighbourWrongPage}, не ланцюжок ${agg.overlapNoThread}/${exp.overlapNoThread}, без перекриття ${agg.noOverlap}/${exp.noOverlap}`);
  const rot = control.frames.map((f) => `с.${f.page} ${f.rotationAngle}°:${f.covered ? "covered" : "ні"}`);
  console.log(`  за кутом повороту: ${rot.join(", ")}`);

  /* Гілка «два кути проти чотирьох»: рамка під 45° на с.15 перетинає
   * ланцюжкову ЛИШЕ чотирикутовим боксом. `twoCornerDiff > 0` означає, що
   * вердикт справді змінився б — тобто регресія назад на два кути впала б. */
  const diag = control.frames.find((f) => f.page === "15");
  console.log(`  розрізнення 2 проти 4 кутів (с.15, 45°): covered=${diag?.covered}, вердиктів змінив би дводіагональний бокс: ${diag?.twoCornerDiff}`);
  const r = (b) => (b ? `x ${b.x1.toFixed(1)}…${b.x2.toFixed(1)} y ${b.y1.toFixed(1)}…${b.y2.toFixed(1)}` : "—");
  console.log(`    бокс по 4 кутах: ${r(diag?.box)}`);
  console.log(`    бокс по 2 кутах: ${r(diag?.box2)}`);
  console.log(`    перекриває: ${JSON.stringify((diag?.overlaps ?? []).map((o) => o.kind))}`);
  console.log(`    смуга розміщення (виміряна, не вирахувана): ${JSON.stringify(built.control.diag.band)}`);

  /* Справжній assert: не лише covered, а й склад рамок і НАБІР покритих
   * сторінок. Інакше контроль пройшов би на іншій фікстурі з тим самим
   * числом покриттів (рецензія, НД-6). */
  const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  const checks = [
    ["рамок усього", agg.total === exp.total],
    ["покрито", agg.covered === exp.covered],
    ["НАБІР покритих сторінок", same(gotPages, wantPages)],
    ["сусід не на тій сторінці", agg.neighbourWrongPage === exp.neighbourWrongPage],
    ["перекриває, але не ланцюжок", agg.overlapNoThread === exp.overlapNoThread],
    ["без перекриття", agg.noOverlap === exp.noOverlap],
    ["гілку 45° вдалося побудувати", built.control.diag.built === true],
    ["гілка 45° розрізняє 2 і 4 кути", diag !== undefined && diag.covered === true && diag.twoCornerDiff > 0],
  ];
  const failed = checks.filter(([, pass]) => !pass).map(([name]) => name);
  if (failed.length > 0) {
    console.log(`  КОНТРОЛЬ ПРОВАЛЕНО — не збіглося: ${failed.join("; ")}`);
    console.log("  Прогін ЗУПИНЕНО: числа книжки виміряні неперевіреним кодом і нічого не означають");
    process.exit(3);
  }
  console.log("  КОНТРОЛЬ ПРОЙДЕНО — ненульове covered на тому самому коді, усі гілки збіглися");
}

console.log("\n=== ВИМІР НА КНИЖЦІ ===");
const res = await run({ docName: DOC, exportPages: EXPORT_PAGES, measureSaveACopy: true }, 600_000);

for (const n of res.notes ?? []) console.log(" ", n);
if (res.error) {
  console.log("ПОМИЛКА JSX:", res.error);
  process.exit(1);
}
console.log(`  InDesign ${res.app?.name} ${res.app?.version}`);

/* Повний дамп на диск: у консоль усе не влазить, а числа мають лишатись
 * перевіряльними після прогону. */
const dumpPath = join(tmpdir(), "h7-book.json");
await writeFile(dumpPath, JSON.stringify(res, null, 2), "utf8");
console.log(`  повний дамп: ${dumpPath}`);

console.log("\n=== ПИТАННЯ 1: розподіл рамок колонцифри по боках ===");
console.log(`  рамок зі стилем «${STYLE}» на сторінках документа: ${res.q1.totalFolioFrames}`);
console.log(`  таких рамок на БАТЬКІВСЬКИХ сторінках: ${res.q1.masterFolioFrames}`);
const mfp = res.q1.masterFolioPages ?? [];
const own = new Set(res.frames.map((f) => f.page));
const onlyMaster = mfp.filter((p) => !own.has(p));
console.log(`  сторінок, що дістають колонцифру з майстра (непереозначену): ${mfp.length}`);
console.log(`  з них БЕЗ власної рамки — тобто невидимих для інструмента: ${onlyMaster.length}${onlyMaster.length ? ` → ${onlyMaster.slice(0, 20).join(", ")}` : ""}`);
const oddOnly = onlyMaster.filter((p) => Number(p) % 2 === 1).length;
console.log(`  з невидимих: непарних (recto) ${oddOnly}, парних (verso) ${onlyMaster.length - oddOnly}`);
for (const d of res.q1.masterFolioDetail ?? []) {
  const t = d.paragraphs.map((p) => p.text).join("¶");
  const lit = d.paragraphs.flatMap((p) => p.literals.map((l) => l.value));
  const mk = d.paragraphs.flatMap((p) => p.markers.map((m) => m.kind));
  console.log(`    майстер «${d.master}» с.${d.page} ${d.side}: «${t}» літерали ${JSON.stringify(lit)} маркери ${JSON.stringify(mk)}`);
  console.log(`      шар «${d.layer}» visible=${d.layerVisible} printable=${d.layerPrintable}`);
  if (mk.length) console.log(`      перекриває: ${JSON.stringify(d.overlaps)}`);
}
console.log(`  ШАРИ ДОКУМЕНТА: ${(res.q1.layers ?? []).map((l) => `${l.name}[${l.visible ? "видимий" : "ПРИХОВАНИЙ"}${l.printable ? "" : ", не друкується"}]`).join(", ")}`);
for (const [side, n] of Object.entries(res.q1.sideTally)) {
  if (n > 0) console.log(`  ${side}: ${n}`);
}
const pagesBySide = {};
for (const f of res.frames) (pagesBySide[f.side] ??= []).push(f.page);
for (const [side, pages] of Object.entries(pagesBySide)) {
  const odd = pages.filter((p) => Number(p) % 2 === 1).length;
  console.log(`  ${side}: сторінок непарних ${odd}, парних ${pages.length - odd}`);
}
const anchored = res.frames.filter((f) => f.anchored === true).length;
const boxSource = {};
for (const f of res.frames) boxSource[f.box?.from ?? "null"] = (boxSource[f.box?.from ?? "null"] ?? 0) + 1;
console.log(`  прив'язаних рамок серед них: ${anchored}`);
console.log(`  джерело меж: ${JSON.stringify(boxSource)}`);
console.log(`  шари: ${JSON.stringify(res.frames.reduce((a, f) => ((a[f.layer] = (a[f.layer] ?? 0) + 1), a), {}))}`);

/* ── ПОХОДЖЕННЯ 91 РАМКИ — ВИМІРЯНЕ (рецензія, НД-2) ── */
console.log("\n=== ПОХОДЖЕННЯ 91 РАМКИ: переозначення чи намальована з нуля ===");
const ovTally = {};
for (const f of res.frames) {
  const key = f.overridden === true ? "overridden=true" : f.overridden === false ? "overridden=false" : `overridden=${f.overridden}`;
  ovTally[key] = (ovTally[key] ?? 0) + 1;
}
console.log(`  pageItem.overridden: ${JSON.stringify(ovTally)}`);
const withSource = res.frames.filter((f) => f.overriddenMaster && typeof f.overriddenMaster === "object");
console.log(`  з валідним overriddenMasterPageItem: ${withSource.length} із ${res.frames.length}`);
if (withSource.length) {
  const srcTally = {};
  for (const f of withSource) srcTally[`${f.overriddenMaster.master} / шар ${f.overriddenMaster.layer}`] = (srcTally[`${f.overriddenMaster.master} / шар ${f.overriddenMaster.layer}`] ?? 0) + 1;
  console.log(`  джерела: ${JSON.stringify(srcTally)}`);
}
const amTally = {};
for (const f of res.frames) amTally[String(f.appliedMaster)] = (amTally[String(f.appliedMaster)] ?? 0) + 1;
console.log(`  застосований майстер сторінки: ${JSON.stringify(amTally)}`);
const layerByOv = {};
for (const f of res.frames) {
  const k = `${f.overridden === true ? "переозначена" : "з нуля"} / шар ${f.layer}`;
  layerByOv[k] = (layerByOv[k] ?? 0) + 1;
}
console.log(`  шар × походження: ${JSON.stringify(layerByOv)}`);

/* ── CRITICAL 2: сторінки з ДВОМА колонцифрами ── */
const dbl = res.q1.doubleFolioPages ?? [];
console.log("\n=== СТОРІНКИ З ДВОМА КОЛОНЦИФРАМИ ===");
console.log(`  власна рамка + ЖИВИЙ майстровий елемент: ${dbl.length} сторінок → ${dbl.map((d) => d.page).join(", ")}`);
console.log(`  сторінок без живого майстрового елемента: ${own.size - dbl.length}`);
for (const d of dbl.slice(0, 3)) {
  for (const m of d.master) {
    const t = m.paragraphs.map((p) => p.text).join("¶");
    const lit = m.paragraphs.flatMap((p) => p.literals.map((l) => l.value));
    const mk = m.paragraphs.flatMap((p) => p.markers.map((x) => x.kind));
    console.log(`    с.${d.page}: ручна «${d.own.text}» шар «${d.own.layer}» кут ${d.own.rotation}, межі ${JSON.stringify(d.own.rel?.map((v) => +v.toFixed(1)))}`);
    console.log(`             майстрова «${t}» (${m.master}) шар «${m.layer}» кут ${m.rotation}, межі ${JSON.stringify(m.rel?.map((v) => +v.toFixed(1)))}, літерали ${JSON.stringify(lit)} маркери ${JSON.stringify(mk)}`);
    console.log(`             зсув майстрової від ручної: ${JSON.stringify(m.deltaFromOwn?.map((v) => +v.toFixed(1)))}`);
  }
}

if (res.bookPdfPath) {
  const pdf = await getDocument({ data: new Uint8Array(await readFile(res.bookPdfPath)) }).promise;
  console.log(`\n  === ЩО РЕАЛЬНО НАДРУКОВАНО (PDF сторінок ${res.bookPdfPages}) ===`);
  const wanted = res.bookPdfPages.split(",");
  for (let i = 1; i <= pdf.numPages; i++) {
    const items = (await (await pdf.getPage(i)).getTextContent()).items.map((it) => it.str.trim()).filter(Boolean);
    /* Колонцифра — короткий фрагмент із самих цифр і тире. Шукаємо саме їх,
     * щоб не тонути в основному тексті сторінки. */
    const folioLike = items.filter((s) => /\d/.test(s) && /^[\d\s–—-]{1,12}$/.test(s));
    console.log(`    сторінка книжки ${wanted[i - 1]}: фрагментів-колонцифр ${folioLike.length} → ${JSON.stringify(folioLike)}`);
  }
}

console.log("\n=== ПИТАННЯ 2: напрямок діапазону ===");
console.log(`  ${JSON.stringify(res.q2.orderTally)}`);
const byOrderSide = {};
for (const f of res.frames) {
  const key = `${f.side}/${f.order}`;
  (byOrderSide[key] ??= []).push(f.page);
}
for (const [key, pages] of Object.entries(byOrderSide)) {
  console.log(`  ${key}: ${pages.length} — сторінки ${pages.slice(0, 12).join(", ")}${pages.length > 12 ? " …" : ""}`);
}
const dirTally = {};
for (const f of res.frames) dirTally[String(f.direction)] = (dirTally[String(f.direction)] ?? 0) + 1;
console.log(`  напрямок за оракулом (ручне число проти власної сторінки): ${JSON.stringify(dirTally)}`);
const texts = {};
for (const f of res.frames) {
  const t = f.paragraphs.map((p) => p.text).join("¶").replace(/\d+/g, "N");
  texts[t] = (texts[t] ?? 0) + 1;
}
console.log(`  форми вмісту (цифри → N): ${JSON.stringify(texts)}`);

console.log("\n=== ПИТАННЯ 3: покриття маршруту A ===");
for (const [side, c] of Object.entries(res.q3.coverage)) {
  if (c.total === 0) continue;
  console.log(`  ${side}: усього ${c.total}, ПОКРИТО ${c.covered}`);
  console.log(
    `    не покрито: без перекриття ${c.noOverlap}, перекриває але не ланцюжок ${c.overlapNoThread}, ` +
    `ланцюжок без сусіда ${c.threadNoNeighbour}, сусід не на тій сторінці ${c.neighbourWrongPage}, ` +
    `оракул не будується ${c.notOracle}`,
  );
}
console.log(`  рамок, що перекривають ДВА+ ланцюжки: ${res.q3.framesOverlappingTwoOrMoreThreads}`);
console.log(`  рамок, де ланцюжки дають РІЗНІ сторінки: ${res.q3.framesWithConflictingNeighbourPages}`);

const uncovered = res.frames.filter((f) => !f.covered);
console.log(`\n  непокриті сторінки (${uncovered.length}): ${uncovered.map((f) => f.page).join(", ")}`);
const overlapHisto = {};
for (const f of res.frames) overlapHisto[f.overlapCount] = (overlapHisto[f.overlapCount] ?? 0) + 1;
console.log(`  розподіл кількості перекриттів: ${JSON.stringify(overlapHisto)}`);
const threadHisto = {};
for (const f of res.frames) threadHisto[f.threadedOverlaps] = (threadHisto[f.threadedOverlaps] ?? 0) + 1;
console.log(`  розподіл кількості ЛАНЦЮЖКОВИХ перекриттів: ${JSON.stringify(threadHisto)}`);

/* КОНТРОЛЬ до Питання 3. «Перекриття немає» саме по собі нічим не підперте:
 * зламаний вимір дав би той самий нуль. Відстань до найближчої рамки й до
 * найближчої ЛАНЦЮЖКОВОЇ рамки показує, наскільки саме не перекриває. */
const gaps = res.frames.map((f) => f.nearest?.gap).filter((g) => typeof g === "number").sort((a, b) => a - b);
const tGaps = res.frames.map((f) => f.nearestThread?.gap).filter((g) => typeof g === "number").sort((a, b) => a - b);
const q = (arr, i) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * i))].toFixed(1) : "—");
console.log("\n=== КОНТРОЛЬ: відстань до найближчої рамки, пт ===");
console.log(`  до будь-якої рамки: мін ${q(gaps, 0)}, медіана ${q(gaps, 0.5)}, макс ${q(gaps, 0.999)} (n=${gaps.length})`);
console.log(`  до ЛАНЦЮЖКОВОЇ рамки: мін ${q(tGaps, 0)}, медіана ${q(tGaps, 0.5)}, макс ${q(tGaps, 0.999)} (n=${tGaps.length})`);
console.log(`  рамок колонцифри, на сторінці яких ланцюжкових рамок немає взагалі: ${res.frames.filter((f) => !f.nearestThread).length}`);
/* Розкладка тих небагатьох перекриттів, що є: дотик чи справжній перетин, і з
 * чим саме. Без неї «7 перекриттів» нічого не каже про гілку `strict`. */
const ovKinds = {};
const ovStyles = {};
for (const f of res.frames) for (const o of f.overlaps) {
  ovKinds[o.kind] = (ovKinds[o.kind] ?? 0) + 1;
  ovStyles[`${o.style} / containers ${o.containers}`] = (ovStyles[`${o.style} / containers ${o.containers}`] ?? 0) + 1;
}
console.log(`  розкладка перекриттів за видом: ${JSON.stringify(ovKinds)} (touch = дотик у межах 0,01 пт, strict = площа > 0)`);
console.log(`  з чим саме перекривається: ${JSON.stringify(ovStyles)}`);
/* Пряма відповідь на «чи позначилась вада двох кутів на числах книжки» —
 * вимір, а не міркування про кути рамок (рецензія, НД-1). */
const tcd = res.frames.reduce((a, f) => a + (f.twoCornerDiff ?? 0), 0);
console.log(`  вердиктів перекриття, які змінив би ДВОКУТОВИЙ бокс: ${tcd} (0 = на цій книжці вада числа не міняє)`);
console.log(`  кути повороту: ${JSON.stringify(res.frames.reduce((a, f) => ((a[f.rotationAngle] = (a[f.rotationAngle] ?? 0) + 1), a), {}))}`);
console.log(`  рамок на сторінці (розподіл): ${JSON.stringify(res.frames.reduce((a, f) => ((a[f.framesOnPage] = (a[f.framesOnPage] ?? 0) + 1), a), {}))}`);

console.log("\n  приклад покритої рамки:");
console.log("   ", JSON.stringify(res.frames.find((f) => f.covered) ?? null).slice(0, 900));
console.log("  приклад НЕПОКРИТОЇ рамки:");
console.log("   ", JSON.stringify(uncovered[0] ?? null).slice(0, 900));

console.log("\n=== ВАРТІСТЬ saveACopy НА РЕАЛЬНІЙ КНИЖЦІ ===");
console.log(`  ${JSON.stringify(res.saveACopy)}`);
console.log("  ПРИЗНАЧЕННЯ — системна тимчасова тека, НЕ синхронізована тека книжки: вісь «розмір» виміряна, вісь «синхронізація» — ні");

console.log(`\n  час виміру: ${res.elapsedMs} мс; modified ${res.modifiedBefore} → ${res.modifiedAfter}`);

/*
 * Зонд H7, Питання 4–12: запуск і читання результату.
 *
 * JSX створює ВЛАСНІ тимчасові документи, ставить мічені рамки з маркерами й
 * експортує PDF. Тут PDF читається через pdfjs — бо саме PDF показує
 * РОЗВ'ЯЗАНЕ значення маркера, якого DOM не віддає (виміряно H6).
 *
 * Значення мітки обмежене з ДВОХ боків: «N4=⟨значення⟩#». H6 брав усе до
 * наступної мітки й тому залежав від того, що ще намалювалось поруч.
 *
 * Друкує результат І ПРИ ПРОВАЛІ. `&& echo "чисто"` мовчить, коли падає.
 */
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { runJsx } from "../dist/bridge/runner.js";

const script = await readFile(new URL("./probe-h7-markers.jsx", import.meta.url), "utf8");
const res = await runJsx("run_script", { script, phase: "main", undoName: "Зонд H7 (власна фікстура)" }, {
  timeoutMs: 600_000,
});

console.log("=== JSX ===");
for (const n of res.notes ?? []) console.log(" ", n);
console.log(`  InDesign ${res.app?.name} ${res.app?.version}`);

/* Другий виклик — скасування Питання 12. ОБОВ'ЯЗКОВИЙ, і саме тому стоїть
 * ПЕРЕД будь-яким виходом: він же й закриває тимчасовий документ, а JSX
 * лишає його відкритим навмисно (doc2 = null вимикає закриття у finally).
 * Перша редакція ставила `process.exit(1)` вище — і при помилці JSX
 * 68-сторінковий документ лишався б відкритим біля книжки користувача,
 * попри коментар, який твердив протилежне (рецензія, Important 7). */
let undoRes = null;
if (res.q12?.docName) {
  undoRes = await runJsx("run_script", {
    script, phase: "undo", docName: res.q12.docName, undoName: "Зонд H7 (скасування)",
  }, { timeoutMs: 300_000 });
  for (const n of undoRes.notes ?? []) console.log(" ", n);
  if (undoRes.error) console.log("ПОМИЛКА JSX (скасування):", undoRes.error);
  res.q12 = { ...res.q12, ...(undoRes.q12 ?? {}) };
}

if (res.error) {
  console.log("ПОМИЛКА JSX:", res.error);
  console.log("часткові дані DOM:", JSON.stringify(res.dom));
  process.exit(1);
}
await writeFile(join(tmpdir(), "h7-markers.json"), JSON.stringify(res, null, 2), "utf8");

const pdf = await getDocument({ data: new Uint8Array(await readFile(res.pdfPath)) }).promise;
let all = "";
for (let i = 1; i <= pdf.numPages; i++) {
  const content = await (await pdf.getPage(i)).getTextContent();
  all += content.items.map((it) => it.str).join("") + "\n";
}
await writeFile(join(tmpdir(), "h7-pdf.txt"), all, "utf8");

/* Значення = все між «МІТКА=» і найближчим «#». Обидві межі — у тій самій
 * рамці, тож чужий текст між ними опинитись не може. */
function valueOf(label) {
  const m = all.match(new RegExp(label.replace("=", "\\=") + "([^#\\n]*)#"));
  return m ? m[1].trim() : null;
}

const e = res.expected;
const ctrl = valueOf("CTRL=");
console.log("\n=== НЕГАТИВНИЙ КОНТРОЛЬ ===");
console.log(`  CTRL (AUTO_PAGE_NUMBER на с.${e.CTRL}): очікувано "${e.CTRL}", у PDF "${ctrl}"`);
const methodWorks = ctrl === e.CTRL;
console.log(`  МЕТОД ВИМІРУ ${methodWorks ? "ПРАЦЮЄ" : "ЗЛАМАНИЙ — решта чисел нічого не означає"}`);
if (!methodWorks) {
  console.log("  весь текст PDF:", JSON.stringify(all.slice(0, 3000)));
  process.exit(2);
}

const V = {};
for (const k of ["N4", "P4", "C4", "H5", "F10", "X10", "W9", "Z9", "V9", "U9", "Y9", "A7", "HID", "NPR", "M6", "O6", "S11", "T13", "E13", "T14", "R90", "R45", "T16"]) {
  V[k] = valueOf(`${k}=`);
}

console.log("\n=== ПИТАННЯ 4: чи існує NEXT_PAGE_NUMBER і чи дзеркальний ===");
console.log(`  перерахування: ${JSON.stringify(res.dom.markerNames)}`);
console.log(`  ланцюжок H1 лежить на сторінках ${JSON.stringify(res.dom.h1Pages)}`);
console.log(`  C4 контроль (AUTO на с.8): "${V.C4}" — очікувано "8"`);
console.log(`  N4 (NEXT на с.8, наступна рамка на с.9): "${V.N4}" — очікувано "9"`);
console.log(`  P4 (PREVIOUS на с.8, попередня рамка на с.7): "${V.P4}" — очікувано "7"`);

console.log("\n=== ПИТАННЯ 5: службовий ланцюжок на розірваному основному тексті ===");
console.log(`  H5 (с.7, службова попередня с.6, поруч ОКРЕМА історія): "${V.H5}" — «6» = працює, «7» = ні`);

console.log("\n=== ПИТАННЯ 6: ланцюжок із БАТЬКІВСЬКОЇ сторінки ===");
console.log(`  майстер: сторінок ${res.dom.masterPages}, рамок в історії ${res.dom.masterContainers}${res.dom.masterError ? `, ПОМИЛКА ${res.dom.masterError}` : ""}`);
console.log(`  M6 (с.19, майстрова попередня на с.18, БЕЗ override): "${V.M6}" — «18» = працює, «19» = поточна сторінка`);
console.log(`  O6 (с.23, той самий майстер, рамки ПЕРЕОЗНАЧЕНІ, переозначень ${res.dom.overridden}): "${V.O6}" — очікувано "22"`);
console.log(`  с.19 (без override): page.textFrames ${res.dom.page19_textFrames}, allPageItems-текстових ${res.dom.page19_allPageItems}, masterPageItems ${res.dom.page19_masterItems}, майстер «${res.dom.page19_appliedMaster}»`);
console.log(`  с.23 (з override):   page.textFrames ${res.dom.page23_textFrames}, allPageItems-текстових ${res.dom.page23_allPageItems}, masterPageItems ${res.dom.page23_masterItems}`);
console.log(`  ланцюжок майстрового елемента с.19 (без override): ${JSON.stringify(res.dom.page19_masterItemThread)}`);
console.log(`  ланцюжок переозначеної рамки с.23: ${JSON.stringify(res.dom.page23_overriddenThread)}`);

console.log("\n=== ПИТАННЯ 7: маркер у ПРИВ'ЯЗАНІЙ рамці ===");
console.log(`  прив'язка: parent «${res.dom.anchoredParent}», сторінка ${res.dom.anchoredPage}${res.dom.anchoredError ? `, ПОМИЛКА ${res.dom.anchoredError}` : ""}`);
console.log(`  A7 (с.10, попередня рамка ланцюжка на с.9): "${V.A7}" — очікувано "9"`);

console.log("\n=== ПИТАННЯ 8: прихований і непридатний до друку шар СЛУЖБОВОГО ланцюжка ===");
console.log(`  шар прихований: visible=${res.dom.hiddenLayerVisible}${res.dom.hiddenLayerError ? `, ПОМИЛКА ${res.dom.hiddenLayerError}` : ""}`);
console.log(`  HID (с.13, попередня рамка на с.12, шар ПРИХОВАНИЙ): "${V.HID}" — очікувано "12"`);
console.log(`  шар непридатний до друку: printable=${res.dom.npLayerPrintable}${res.dom.npLayerError ? `, ПОМИЛКА ${res.dom.npLayerError}` : ""}`);
console.log(`  NPR (с.17, попередня рамка на с.16, шар НЕ ДРУКУЄТЬСЯ): "${V.NPR}" — очікувано "16"`);

console.log("\n=== ПИТАННЯ 9: ЯКИЙ ЛАНЦЮЖОК ВИГРАЄ при перекритті ДВОХ ===");
const verdict = (got, x) => (got === x.helper ? "СЛУЖБОВИЙ" : got === x.main ? "ОСНОВНИЙ" : got === x.page ? "жоден (поточна сторінка)" : "щось третє");
console.log(`  W9 (с.9;  службовий→8,  основний→3;  основний ВИЩЕ,     службовий створено РАНІШЕ): "${V.W9}" — ${verdict(V.W9, e.W9)}`);
console.log(`  Z9 (с.11; службовий→10, основний→2;  службовий ВИЩЕ,    службовий створено РАНІШЕ): "${V.Z9}" — ${verdict(V.Z9, e.Z9)}`);
console.log(`  V9 (с.25; службовий→24, основний→21; службовий ВИЩЕ,    службовий створено ОСТАННІМ): "${V.V9}" — ${verdict(V.V9, e.V9)}`);
/* Дві гіпотези одразу: порядок у page.allPageItems (близький до порядку
 * накладання) і порядок СТВОРЕННЯ (id зростає монотонно). Друкуються обидві,
 * бо саме розбіжність між ними й показує, яка з них хибна. */
const winners = { W9: V.W9, Z9: V.Z9, V9: V.V9 };
for (const [tag, c] of Object.entries(res.dom.contested ?? {})) {
  const hi = c.allPageItemsOrder.indexOf(c.helperId);
  const mi = c.allPageItemsOrder.indexOf(c.mainId);
  const won = winners[tag] === e[tag].helper ? "службовий" : winners[tag] === e[tag].main ? "основний" : "?";
  const byOrder = hi < mi ? "службовий" : "основний";
  const byId = Number(c.helperId) < Number(c.mainId) ? "службовий" : "основний";
  console.log(
    `  ${tag} с.${c.page}: виграв ${won}; за порядком allPageItems раніше ${byOrder} (${hi} проти ${mi}); ` +
    `за id раніше створений ${byId} (#${c.helperId} проти #${c.mainId}) — ` +
    `${won === byId ? "id збігається" : "id НЕ збігається"}, ${won === byOrder ? "allPageItems збігається" : "allPageItems НЕ збігається"}`,
  );
}
const verdicts = [verdict(V.W9, e.W9), verdict(V.Z9, e.Z9), verdict(V.V9, e.V9)];
console.log(
  [V.W9, V.Z9, V.V9].some((x) => x === null)
    ? "  ВИСНОВОК: значення не прочиталось"
    : verdicts[0] === verdicts[1] && verdicts[1] === verdicts[2]
      ? `  ВИСНОВОК: переможець НЕ залежить ні від порядку накладання, ні від порядку створення — завжди ${verdicts[0]}`
      : `  ПРОМІЖНО: порядок накладання переможця НЕ визначає (${verdicts.join(" / ")}); три гіпотези розводить ДРУГЕ КОЛО нижче`,
);

console.log("\n=== ПИТАННЯ 10: рамка ланцюжка без сусіда в потрібному напрямку ===");
console.log(`  F10 (с.6, ПЕРША рамка ланцюжка, PREVIOUS): "${V.F10}" — «6» = поточна сторінка, "" = порожньо`);
console.log(`  X10 (с.5, ОСТАННЯ рамка ланцюжка, NEXT): "${V.X10}" — «5» = поточна сторінка, "" = порожньо`);

console.log("\n=== ПИТАННЯ 11: чи переживає символьне форматування заміну ===");
console.log(`  до заміни: ${JSON.stringify(res.dom.q11Before)}`);
console.log(`  після заміни: ${JSON.stringify(res.dom.q11After)}${res.dom.q11Error ? `, ПОМИЛКА ${res.dom.q11Error}` : ""}`);
console.log(`  S11 у PDF (с.15): "${V.S11}" — очікувано "15"`);

console.log("\n=== ПИТАННЯ 12: saveACopy + шар + 196 рамок одним кроком скасування ===");
console.log(`  ${JSON.stringify(res.q12)}`);
const q = res.q12;
console.log(`  запис: ${q.framesAfterWrite} рамок за ${q.msFrames} мс, saveACopy ${q.msSaveACopy} мс (${q.copyBytes} Б), разом ${q.msTotal} мс`);
console.log(`  наступний крок скасування названий: "${q.undoName}" (redo: "${q.redoName}")`);
if (q.framesAfterUndo === 0 && (q.layerNamesAfterUndo ?? []).indexOf("_folio-helper") === -1) {
  console.log(`  ВИСНОВОК: один doc.undo() (${q.msUndo} мс) прибрав і ${q.framesBeforeUndo} рамок, і шар — крок скасування ОДИН`);
} else if (q.undoName === "Зонд H7 (власна фікстура)") {
  /* НЕГАТИВНИЙ РЕЗУЛЬТАТ ІНСТРУМЕНТА, НЕ ЯВИЩА. `doc.undo()` зі скрипта
   * відмовляє, бо власний крок скасування виклику ще відкритий. Але ім'я
   * наступного кроку — це і є відповідь: шар, 196 рамок і saveACopy лежать
   * в ОДНОМУ кроці, і саме його зніме Cmd+Z користувача. */
  console.log(`  ВИСНОВОК: шар + ${q.framesBeforeUndo} рамок + saveACopy = ОДИН крок «${q.undoName}»`);
  console.log(`  ЗАСТЕРЕЖЕННЯ: сам doc.undo() зі скрипта не виконується (${q.undoError}) — крок ще відкритий; перевірено іменем кроку, не його виконанням`);
} else {
  console.log(`  ВИСНОВОК: після undo лишилось рамок ${q.framesAfterUndo}, шарів ${q.layersAfterUndo} (${JSON.stringify(q.layerNamesAfterUndo)})${q.undoError ? `, помилка ${q.undoError}` : ""} — крок НЕ один`);
}

console.log("\n=== ПИТАННЯ 9, ДРУГЕ КОЛО: три гіпотези розводяться двома випадками ===");
console.log(`  контейнери: ${JSON.stringify(res.dom.q9b)}${res.dom.q9bError ? ` ПОМИЛКА ${res.dom.q9bError}` : ""}`);
function who(got, x) {
  return got === x.helper ? "helper" : got === x.main ? "main" : got === x.page ? "жоден (поточна)" : "щось третє";
}
const wU = who(V.U9, e.U9), wY = who(V.Y9, e.Y9);
console.log(`  U9 (с.49; службовий 6 контейнерів ТОЧНО під міткою й створений ОСТАННІМ; основний 2 контейнери, дотик 2 пт): "${V.U9}" → ${wU}`);
console.log(`     передбачення: створений-раніше → main, більше-контейнерів → helper, більша-площа → helper`);
console.log(`  Y9 (с.59; службовий 3 контейнери ТОЧНО під міткою й створений ОСТАННІМ; основний 6 контейнерів, дотик 2 пт): "${V.Y9}" → ${wY}`);
console.log(`     передбачення: створений-раніше → main, більше-контейнерів → main, більша-площа → helper`);
/* Гіпотези оголошуються передбаченнями, і живими лишаються ті, чиї
 * передбачення збіглися з ОБОМА спостереженнями. Перша редакція перевіряла
 * три жорстко зашиті комбінації, тож пара (U9=main, Y9=helper) давала
 * `alive.length === 0` і друкувала «неоднозначність ЛИШАЄТЬСЯ» — тобто
 * протилежне до правди: така пара спростувала б УСІ три (рецензія, НД-6). */
const HYPOTHESES = [
  ["створений раніше", { U: "main", Y: "main" }],
  ["більше контейнерів", { U: "helper", Y: "main" }],
  ["більша площа перекриття", { U: "helper", Y: "helper" }],
];
const alive = HYPOTHESES.filter(([, p]) => p.U === wU && p.Y === wY).map(([name]) => name);
console.log(
  alive.length === 1
    ? `  ВИСНОВОК: лишається рівно одна гіпотеза — «${alive[0]}»`
    : alive.length === 0
      ? `  ВИСНОВОК: спостереження (U9=${wU}, Y9=${wY}) спростовує УСІ ТРИ гіпотези — правило не описане жодною з них`
      : `  ВИСНОВОК: узгоджених гіпотез ${alive.length} (${alive.join(", ")}) — неоднозначність ЛИШАЄТЬСЯ, висновок §2 має лишитись гіпотезою`,
);

console.log("\n=== ПИТАННЯ 15: маркер у ПОВЕРНУТІЙ рамці ===");
console.log(`  кути: ${JSON.stringify(res.dom.rotations)}${res.dom.q15Error ? ` ПОМИЛКА ${res.dom.q15Error}` : ""}`);
console.log(`  R90 (с.62, рамка −90°, попередня рамка ланцюжка на с.61): "${V.R90}" — очікувано "61"`);
console.log(`  R45 (с.64, рамка 45°, попередня рамка ланцюжка на с.63): "${V.R45}" — очікувано "63"`);

console.log("\n=== ПИТАННЯ 16: маркер УСЕРЕДИНІ ПЕРЕОЗНАЧЕНОГО майстрового елемента ===");
console.log(`  ${JSON.stringify(res.dom.q16)}${res.dom.q16Error ? ` ПОМИЛКА ${res.dom.q16Error}` : ""}`);
console.log(`  службовий ланцюжок на сторінках ${JSON.stringify(res.dom.h16Pages)}`);
console.log(`  T16 (с.67, ПЕРЕОЗНАЧЕНИЙ майстровий елемент над службовим ланцюжком): "${V.T16}" — «66-67» = працює, «67-67» = ні`);

console.log("\n=== ПИТАННЯ 13: маркер у НЕПЕРЕОЗНАЧЕНІЙ майстровій рамці над службовим ланцюжком ===");
console.log(`  службовий ланцюжок на сторінках ${JSON.stringify(res.dom.hm13Pages)}, майстрових елементів на с.29: ${res.dom.page29_masterItems}${res.dom.q13Error ? `, ПОМИЛКА ${res.dom.q13Error}` : ""}`);
console.log(`  геометрія (сторінко-відносні межі): майстрова ${JSON.stringify(res.dom.q13Geometry?.master)}, службова ${JSON.stringify(res.dom.q13Geometry?.helper)}, різниця ${JSON.stringify(res.dom.q13Geometry?.delta)}`);
console.log(`  T13 (с.29, майстрова рамка ⟨PREVIOUS⟩-⟨AUTO⟩, БЕЗ override): "${V.T13}" — «28-29» = працює, «29-29» = не розв'язується`);
console.log(`  E13 (с.35, ПОРОЖНІЙ службовий ланцюжок, звичайна документна рамка): "${V.E13}" — «34» = працює, «35» = ні`);
console.log(`  порожній ланцюжок: рамок в історії ${res.dom.emptyHelperContainers}, символів ${res.dom.emptyHelperChars}${res.dom.q13bError ? `, ПОМИЛКА ${res.dom.q13bError}` : ""}`);

console.log("\n=== ПИТАННЯ 14: чи можна ЗНЯТИ переозначення ===");
console.log(`  ${JSON.stringify(res.dom.q14)}${res.dom.q14Error ? ` ПОМИЛКА ${res.dom.q14Error}` : ""}`);
console.log(`  T14 (с.33, переозначено → змінено на «999» → removeOverride): "${V.T14}" — «32-33» = майстер повернувся, «999» = переозначення лишилось`);

console.log("\n=== ЗВЕДЕННЯ ===");
console.log(JSON.stringify(V));
console.log(`  дампи: ${join(tmpdir(), "h7-markers.json")}, ${join(tmpdir(), "h7-pdf.txt")}`);

/*
 * Зонд H6, Питання 1 і 2: запуск і читання результату.
 *
 * JSX створює власний тимчасовий документ, ставить мічені рамки з маркерами
 * й експортує PDF. Тут PDF читається через pdfjs — бо саме PDF показує
 * РОЗВ'ЯЗАНЕ значення маркера, якого DOM не віддає.
 */
import { readFile } from "node:fs/promises";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { runJsx } from "../dist/bridge/runner.js";

const script = await readFile(new URL("./probe-h6-markers.jsx", import.meta.url), "utf8");
const res = await runJsx("run_script", { script, undoName: "Зонд H6 (власна фікстура)" }, {
  timeoutMs: 300_000,
});

console.log("=== JSX ===");
if (res.placement) console.log("  розміщення:", JSON.stringify(res.placement));
for (const n of res.notes) console.log(" ", n);
if (res.error) {
  console.log("ПОМИЛКА JSX:", res.error);
  process.exit(1);
}

const pdf = await getDocument({ data: new Uint8Array(await readFile(res.pdfPath)) }).promise;
let all = "";
for (let i = 1; i <= pdf.numPages; i++) {
  const page = await pdf.getPage(i);
  const content = await page.getTextContent();
  all += content.items.map((it) => it.str).join("") + "\n";
}

/* pdfjs склеює фрагменти без роздільників, тож значення мітки — усе до
 * НАСТУПНОЇ мітки або кінця рядка, а не до пробілу. */
const LABELS = ["CTRL=", "A=", "B=", "C=", "VH=", "VN="];
function valueOf(label) {
  const stop = LABELS.filter((l) => l !== label).map((l) => l.replace("=", "\\=")).join("|");
  const m = all.match(new RegExp(label + "\\s*((?:(?!" + stop + ")[^\\n])*)"));
  return m ? m[1].trim() : null;
}

const ctrl = valueOf("CTRL=");
const expected = res.expected;

console.log("\n=== НЕГАТИВНИЙ КОНТРОЛЬ ===");
console.log(`  CTRL (AUTO_PAGE_NUMBER на с.${expected.CTRL}): очікувано "${expected.CTRL}", у PDF "${ctrl}"`);
const methodWorks = ctrl === expected.CTRL;
console.log(`  МЕТОД ВИМІРУ ${methodWorks ? "ПРАЦЮЄ" : "ЗЛАМАНИЙ — решта чисел нічого не означає"}`);

if (!methodWorks) process.exit(2);

console.log("\n=== ПИТАННЯ 1: PREVIOUS_PAGE_NUMBER ===");
for (const [key, label] of [
  ["A", "перекриває ланцюжкову рамку"],
  ["B", "не перекриває нічого"],
  ["C", "перекриває ОКРЕМУ історію (ланцюжок рветься)"],
]) {
  const got = valueOf(`${key}=`);
  const e = expected[key];
  let verdict;
  if (got === e.previousPage) verdict = "ПОПЕРЕДНЯ СТОРІНКА — маркер працює";
  else if (got === e.page) verdict = "поточна сторінка — маркер не спрацював";
  else verdict = "щось третє";
  console.log(`  ${key} (${label}): с.${e.page}, попередня ${e.previousPage} → у PDF "${got}" — ${verdict}`);
}

console.log("\n=== ПИТАННЯ 2: змінна Running Header ===");
console.log(`  VH (сторінка ${expected.VH} МАЄ заголовок): у PDF "${valueOf("VH=")}"`);
console.log(`  VN (сторінка ${expected.VN} НЕ має заголовка): у PDF "${valueOf("VN=")}"`);

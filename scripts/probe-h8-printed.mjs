/*
 * ДОКАЗ НАДРУКОВАНИМ ЧИСЛОМ (спек Фази 8, §8.1 п.6).
 *
 * У моделі маркер лишається спецсимволом, тож жоден вимір не відрізнить
 * правильно розв'язаний маркер від брехливого — InDesign не лишає порожнечі й
 * не попереджає, він друкує правдоподібне неправильне число (Питання 10 Фази 7).
 * Отже єдиний доказ у цій родині — PDF.
 *
 * ТРИ СТАНИ НА ОДНОМУ ДОКУМЕНТІ, кількість сторінок НЕ міняється:
 *   1) ЕТАЛОН   — ланцюжок цілий;
 *   2) ЗЛАМАНО  — з ланцюжка прибрано одну ланку (пропуск) або відшито одну
 *                 рамку (розпад);
 *   3) ПІСЛЯ    — той самий документ після `repair-helper-thread`.
 *
 * Приймається лише ПОСИМВОЛЬНИЙ збіг (1) і (3). Якби кількість сторінок
 * мінялась, збіг був би неможливий за побудовою й доказ нічого не вартий — саме
 * тому ламаємо ланцюжок, а не верстку.
 */
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { runJsx } from "../dist/bridge/runner.js";

const dir = await mkdtemp(join(tmpdir(), "h8-printed-"));

async function printed(pdfPath) {
  const pdf = await getDocument({ data: new Uint8Array(await readFile(pdfPath)) }).promise;
  const out = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const c = await (await pdf.getPage(i)).getTextContent();
    out.push(c.items.map((it) => it.str).join("").trim());
  }
  return out;
}

const BUILD = `
var out = {};
app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;
var doc = app.documents.add();
doc.documentPreferences.facingPages = true;
doc.documentPreferences.pagesPerDocument = 8;
while (doc.pages.length < 8) doc.pages.add();

function cornerBox(page) {
    var b = page.bounds;
    var y1 = Math.min(Number(b[0]), Number(b[2]));
    var x1 = Math.min(Number(b[1]), Number(b[3]));
    return [y1 + 40, x1 + 40, y1 + 80, x1 + 220];
}

var layer = doc.layers.add({ name: "_folio-helper" });
layer.visible = true;
layer.printable = false;
doc.activeLayer = layer;

var helper = [], prev = null;
for (var i = 0; i < doc.pages.length; i++) {
    var f = doc.pages[i].textFrames.add();
    f.itemLayer = layer;
    f.geometricBounds = cornerBox(doc.pages[i]);
    f.textWrapPreferences.textWrapMode = TextWrapModes.NONE;
    if (prev !== null) prev.nextTextFrame = f;
    prev = f;
    helper.push(f);
}

/* Колонцифра «⟨попередня⟩–⟨поточна⟩» ТОЧНО над службовою рамкою: саме через
 * перекриття маркер і розв'язується (§4.2). Шар — верстальний. */
var body = doc.layers[doc.layers.length - 1];
doc.activeLayer = body;
var st = doc.paragraphStyles.add({ name: "Kolontsyfra" });
for (var k = 0; k < doc.pages.length; k++) {
    var t = doc.pages[k].textFrames.add();
    t.itemLayer = body;
    t.geometricBounds = cornerBox(doc.pages[k]);
    t.insertionPoints[0].contents = SpecialCharacters.PREVIOUS_PAGE_NUMBER;
    t.insertionPoints[-1].contents = "-";
    t.insertionPoints[-1].contents = SpecialCharacters.AUTO_PAGE_NUMBER;
    t.paragraphs[0].appliedParagraphStyle = st;
    t.paragraphs[0].pointSize = 24;
}

doc.save(new File("${dir}/printed.indd"));
doc.exportFile(ExportFormat.PDF_TYPE, new File("${dir}/1-baseline.pdf"), false);
out.docName = String(doc.name);
/*
 * ID КОЛОНЦИФР — ДОНОРИ ГЕОМЕТРІЇ, І БЕЗ НИХ ДОКАЗ ХИБНИЙ.
 * Перша редакція цього зонда передавала ремонтові порожній перелік, і докладена
 * ланка лягала в куток сторінки (helperFallbackBounds), тобто НЕ перекривала
 * колонцифру — маркер друкував власну сторінку, і «ремонт не відновив числа»
 * було твердженням про ЗОНД, а не про ремонт. Інструмент донорів передає
 * завжди (measure.folioFrames), тож зонд мусить робити те саме.
 * Зворотних лапок тут немає навмисно: цей коментар живе ВСЕРЕДИНІ шаблонного
 * рядка .mjs, і перша ж лапка обірвала б його.
 */
out.folioIds = [];
for (var fo = 0; fo < doc.pages.length; fo++) {
    var pit = doc.pages[fo].allPageItems;
    for (var z = 0; z < pit.length; z++) {
        var lname = "";
        try { lname = String(pit[z].itemLayer.name); } catch (eL) { lname = ""; }
        if (lname !== "_folio-helper" && IDMCP.isTextFrameLike(pit[z])) out.folioIds.push(String(pit[z].id));
    }
}
__result = out;
`;

function breakScript(kind) {
  return `
var out = {};
var doc = app.activeDocument;
var layer = doc.layers.itemByName("_folio-helper");
var items = layer.pageItems.everyItem().getElements();
/* Ламаємо ЛАНКУ №5 (сторінка «5»), а не сторінку: кількість сторінок мусить
 * лишитись тією самою, інакше посимвольний збіг неможливий за побудовою. */
var victim = null;
for (var i = 0; i < items.length; i++) {
    var p = null;
    try { p = items[i].parentPage; } catch (e) { p = null; }
    if (p !== null && String(p.name) === "5") { victim = items[i]; break; }
}
if (victim === null) throw new Error("ланки на сторінці 5 не знайдено");
${
  kind === "gap"
    ? `victim.remove(); out.how = "ланку видалено — ПРОПУСК";`
    : `try { if (victim.previousTextFrame !== null) victim.previousTextFrame.nextTextFrame = null; } catch (e1) {}
   try { if (victim.nextTextFrame !== null) victim.nextTextFrame = null; } catch (e2) {}
   out.how = "ланку відшито — РОЗПАД";`
}
doc.save();
doc.exportFile(ExportFormat.PDF_TYPE, new File("${dir}/2-broken.pdf"), false);
__result = out;
`;
}

const EXPORT_AFTER = `
var doc = app.activeDocument;
doc.save();
doc.exportFile(ExportFormat.PDF_TYPE, new File("${dir}/3-repaired.pdf"), false);
__result = { ok: true };
`;

const CLOSE = `app.activeDocument.close(SaveOptions.NO); __result = { closed: true };`;

let failures = 0;
try {
  for (const kind of ["gap", "split"]) {
    const built = await runJsx("run_script", { script: BUILD, undoName: "H8 друк: побудова" }, { timeoutMs: 300_000 });
    const baseline = await printed(`${dir}/1-baseline.pdf`);

    const broke = await runJsx("run_script", { script: breakScript(kind), undoName: "H8 друк: злам" }, { timeoutMs: 300_000 });
    const broken = await printed(`${dir}/2-broken.pdf`);

    const rep = await runJsx(
      "pagination_repair_helper_thread",
      { expectedDocName: built.docName, stamp: "20260808-2200", folioFrameIds: built.folioIds },
      { timeoutMs: 300_000 },
    );
    await runJsx("run_script", { script: EXPORT_AFTER, undoName: "H8 друк: після ремонту" }, { timeoutMs: 300_000 });
    const repaired = await printed(`${dir}/3-repaired.pdf`);
    await runJsx("run_script", { script: CLOSE, undoName: "H8 друк: закриття" }, { timeoutMs: 120_000 });

    const sameBroken = JSON.stringify(baseline) === JSON.stringify(broken);
    const sameRepaired = JSON.stringify(baseline) === JSON.stringify(repaired);

    console.log(`\n=== ${kind.toUpperCase()} (${broke.how}) ===`);
    console.log("ЕТАЛОН :", baseline.join(" | "));
    console.log("ЗЛАМАНО:", broken.join(" | "));
    console.log("ПІСЛЯ  :", repaired.join(" | "));
    console.log(`ремонт: -${rep.removed.length} +${rep.created.length} зшито ${rep.restitched}`);
    console.log(`злам ЗМІНИВ числа: ${sameBroken ? "НІ — доказ порожній!" : "так"}`);
    console.log(`ремонт ПОВЕРНУВ числа посимвольно: ${sameRepaired ? "так" : "НІ"}`);
    if (sameBroken || !sameRepaired) failures += 1;
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log(`\nПІДСУМОК: ${failures === 0 ? "обидва стани доведено надрукованим числом" : `ПРОВАЛ у ${failures} стан(ах)`}`);
process.exit(failures === 0 ? 0 : 1);

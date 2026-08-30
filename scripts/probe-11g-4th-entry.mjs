/*
 * ЧЕТВЕРТИЙ ВХІД (C2) — ЗОНД НАДРУКОВАНОГО ЧИСЛА.
 *
 * НАПИСАНИЙ РЕЦЕНЗЕНТОМ ПЕРЕОГЛЯДУ 11В і перенесений у репозиторій Задачею 11Г
 * без зміни сценарію — поруч із `probe-11v-printed.mjs`, бо вимір, який довів
 * дефект, мусить лишитись переганяльним. Текст гіпотези нижче — його,
 * ПИСАНИЙ ДО ПРАВКИ, і саме тому описує звуження як наявне: без правки зонд
 * друкує «1–3», з правкою — «2–3» і відмову з причиною `helper-chain-winner`.
 *
 * Гіпотеза: правка ввела НОВЕ звуження, якого доти не було —
 *   `const permitted = request === "thread" ? mainLinks : links;`
 * (src/pagination/rewrite.ts). Доти `route: "thread"` рахував УСІ документні
 * зв'язки (`resolveMarkerPage`), тобто рівно те, що бачить InDesign. Тепер
 * службові зв'язки з переліку викидаються — а InDesign їх не викидає, і
 * виграє СТВОРЕНИЙ РАНІШЕ (Питання 9).
 *
 * Сценарій — послідовність, яку спек сам називає штатною:
 *   1) create-helper-thread будує ланцюжок (створений РАНІШЕ за все, що далі);
 *   2) оператор видаляє ОДНУ службову рамку (§4.8 називає штатною зворотною
 *      дією видалення цілого шару; видалення однієї — строго менше). Через це
 *      службовий сусід для колонцифри с.3 стає «1», а не «2»;
 *   3) оператор докладає верстку — основний ланцюжок, чия попередня рамка
 *      лежить на с.2 (саме заради цього між викликами й існує §4.5);
 *   4) replace-literals із route: "thread".
 *
 * Очікування гіпотези: оракул рахує лише основний ланцюжок («2» — збіг),
 * визнає придатною, пише маркер; InDesign розв'язує маркер зі СЛУЖБОВОЇ рамки
 * (створена раніше) і друкує «1». Тобто «2–3» стає «1–3».
 *
 * ВЛАСНИЙ ТИМЧАСОВИЙ ДОКУМЕНТ, закритий без збереження.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runJsx } from "file:///Users/designer/MCP/indesign-mcp/.claude/worktrees/project-styles-4a4347/dist/bridge/runner.js";
import { registerPaginationTools } from "file:///Users/designer/MCP/indesign-mcp/.claude/worktrees/project-styles-4a4347/dist/tools/pagination.js";
import { getDocument } from "file:///Users/designer/MCP/indesign-mcp/node_modules/pdfjs-dist/legacy/build/pdf.mjs";

const dir = await mkdtemp(join(tmpdir(), "idmcp-4th-"));
process.env.INDESIGN_MCP_HOME = join(dir, "home");

function applyHandler() {
  let captured = null;
  registerPaginationTools({
    registerTool(name, _cfg, h) {
      if (name === "pagination_apply") captured = h;
    },
  });
  if (!captured) throw new Error("pagination_apply не зареєстровано");
  return captured;
}

async function apply(docName, args) {
  const res = await applyHandler()({
    folio: { styleName: "Kolontsyfra", range: "backward" },
    expectedDocName: docName,
    ...args,
  });
  const text = res.content[0].text;
  return { isError: res.isError === true, text, data: res.isError ? null : JSON.parse(text) };
}

async function jsx(script, name) {
  return runJsx("run_script", { script, undoName: name }, { timeoutMs: 180_000 });
}

const path = join(dir, "D.indd");
const made = await jsx(
  `
var doc = app.documents.add();
doc.documentPreferences.facingPages = true;
doc.documentPreferences.pagesPerDocument = 8;
var st = doc.paragraphStyles.add({ name: "Kolontsyfra" });
var out = { docName: null, folios: [] };
for (var p = 0; p < doc.pages.length; p++) {
    var page = doc.pages[p];
    if (String(page.side).replace("PageSideOptions.", "") !== "RIGHT_HAND") continue;
    var b = page.bounds;
    var f = page.textFrames.add();
    f.geometricBounds = [b[0] + 40, b[1] + 40, b[0] + 64, b[1] + 200];
    f.contents = String(Number(page.name) - 1) + "\\u2013";
    f.insertionPoints[-1].contents = SpecialCharacters.AUTO_PAGE_NUMBER;
    f.paragraphs[0].appliedParagraphStyle = st;
    out.folios.push({ page: String(page.name), id: String(f.id) });
}
doc.save(new File(${JSON.stringify(path)}));
out.docName = doc.name;
__result = out;`,
  "Зонд 4: документ",
);
const docName = made.docName;

const report = { docName, steps: [] };

async function printed(tag) {
  const pdfPath = join(dir, `${tag}.pdf`);
  await jsx(
    `var doc = app.activeDocument;
if (doc.name !== ${JSON.stringify(docName)}) throw new Error("не той документ: " + doc.name);
doc.recompose();
doc.exportFile(ExportFormat.PDF_TYPE, new File(${JSON.stringify(pdfPath)}), false);
__result = 1;`,
    "Зонд 4: експорт",
  );
  const pdf = await getDocument({ data: new Uint8Array(await readFile(pdfPath)) }).promise;
  const out = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const c = await (await pdf.getPage(i)).getTextContent();
    const t = c.items.map((it) => ("str" in it ? it.str : "")).join("|");
    if (t.length > 0) out.push(`с.${i}: ${t}`);
  }
  return out;
}

try {
  report.before = await printed("before");

  /* 1) справжня операція будує ланцюжок */
  const built = await apply(docName, { operation: "create-helper-thread", dryRun: false });
  if (built.isError) throw new Error("ланцюжок не побудувався: " + built.text);
  report.steps.push({ built: built.data.helper });

  /* 2) оператор видаляє ОДНУ службову рамку — ту, що на с.2 */
  const dropped = await jsx(
    `var d = app.documents.itemByName(${JSON.stringify(docName)});
var lay = d.layers.itemByName("_folio-helper");
var killed = [];
if (lay.isValid) {
    var items = lay.pageItems;
    for (var i = items.length - 1; i >= 0; i--) {
        var pg = null;
        try { pg = items[i].parentPage; } catch (e) { pg = null; }
        if (pg !== null && String(pg.name) === "2") { killed.push(String(items[i].id)); items[i].remove(); }
    }
}
__result = { killed: killed, left: lay.isValid ? lay.pageItems.length : -1 };`,
    "Зонд 4: видалення однієї службової рамки",
  );
  report.steps.push({ droppedHelperFrameOnPage2: dropped });

  /* 3) оператор докладає верстку: основний ланцюжок с.2 -> с.3, створений
   *    ПІЗНІШЕ за службовий, і саме він лежить під колонцифрою с.3 */
  const main = await jsx(
    `var d = app.documents.itemByName(${JSON.stringify(docName)});
var p2 = d.pages.itemByName("2");
var p3 = d.pages.itemByName("3");
var b2 = p2.bounds, b3 = p3.bounds;
var lay0 = null;
for (var L = 0; L < d.layers.length; L++) {
    if (String(d.layers[L].name) !== "_folio-helper") { lay0 = d.layers[L]; break; }
}
if (lay0 === null) throw new Error("основного шару немає");
d.activeLayer = lay0;
var a = p2.textFrames.add();
a.itemLayer = lay0;
a.geometricBounds = [b2[0] + 100, b2[1] + 40, b2[0] + 140, b2[1] + 200];
var bfr = p3.textFrames.add();
/* точно під колонцифрою с.3 */
bfr.itemLayer = lay0;
bfr.geometricBounds = [b3[0] + 40, b3[1] + 40, b3[0] + 64, b3[1] + 200];
a.nextTextFrame = bfr;
a.contents = "текст, що ллється";
__result = { storyId: String(a.parentStory.id), aId: String(a.id), bId: String(bfr.id),
             layer: String(a.itemLayer.name), bLayer: String(bfr.itemLayer.name),
             containers: a.parentStory.textContainers.length };`,
    "Зонд 4: основний ланцюжок після службового",
  );
  report.steps.push({ mainThreadAddedAfter: main });

  /* який ланцюжок створено раніше — читаємо id історій */
  const orders = await jsx(
    `var d = app.documents.itemByName(${JSON.stringify(docName)});
var lay = d.layers.itemByName("_folio-helper");
var ids = [];
if (lay.isValid) {
    var items = lay.pageItems;
    for (var i = 0; i < items.length; i++) {
        try { ids.push({ frame: String(items[i].id), story: String(items[i].parentStory.id) }); } catch (e) {}
    }
}
__result = ids;`,
    "Зонд 4: порядок створення",
  );
  report.steps.push({ helperStories: orders });

  /* 4) replace-literals, route "thread" */
  const res = await apply(docName, {
    operation: "replace-literals",
    route: "thread",
    dryRun: false,
  });
  report.steps.push(
    res.isError
      ? { refused: res.text.slice(0, 400) }
      : {
          applied: res.data.applied,
          eligible: res.data.eligible,
          skipped: res.data.skipped,
          willWrite: res.data.willWrite,
        },
  );

  report.after = await printed("after");
  report.same = JSON.stringify(report.before) === JSON.stringify(report.after);
} finally {
  console.log(JSON.stringify(report, null, 2));
  await jsx(
    `var d = app.documents.itemByName(${JSON.stringify(docName)});
if (d.isValid) d.close(SaveOptions.NO);
__result = app.documents.length;`,
    "Зонд 4: закриття",
  );
  const open = await jsx(
    "var n=[];for(var i=0;i<app.documents.length;i++)n.push(app.documents[i].name);__result={count:app.documents.length,names:n};",
    "Зонд 4: перелік",
  );
  console.log("ВІДКРИТІ ДОКУМЕНТИ:", JSON.stringify(open));
  await rm(dir, { recursive: true, force: true });
}

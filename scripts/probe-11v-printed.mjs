/*
 * ЗАДАЧА 11В, CRITICAL C1 — ДОКАЗ НАДРУКОВАНИМ ЧИСЛОМ, А НЕ МОДЕЛЛЮ.
 *
 * Фінальна рецензія відтворила три входи, на яких `pagination_apply` записував
 * у документ число, ВІДМІННЕ від наявного, і доповідав бездоганний успіх:
 *
 *   | вхід | було  | стало | що доповів інструмент                       |
 *   | A    | 2–3   | 3–3   | applied: 3, skipped: []                      |
 *   | B    | 2–3   | 3–3   | applied: 3, skipped: [], balanced: true      |
 *   | C    | 2–3A  | 3–3A  | applied: 3, ignoredFolioFrames: [264]        |
 *
 * Тут ті самі три входи проганяються через СПРАВЖНІЙ інструмент, а розв'язані
 * значення читаються з PDF — бо в моделі маркер лишається спецсимволом, і
 * `pagination_measure` не знає, що InDesign надрукує на його місці. Саме на
 * цьому спіткнулося Питання 5 Фази 6.
 *
 * КОЖЕН ВХІД — СВІЙ ВЛАСНИЙ ТИМЧАСОВИЙ ДОКУМЕНТ, закритий без збереження.
 * Робоча книжка користувача не відкривається й не чіпається.
 *
 * Прогін: node scripts/probe-11v-printed.mjs   (після `npm run build`)
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runJsx } from "../dist/bridge/runner.js";
import { registerPaginationTools } from "../dist/tools/pagination.js";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const dir = await mkdtemp(join(tmpdir(), "idmcp-11v-"));
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

/**
 * Документ входу: 8 сторінок фейсинг, колонцифри «N–⟨AUTO⟩» на recto.
 *
 * Форма рамки — та сама, що в робочій книжці: РУЧНЕ число попередньої сторінки,
 * тире, автомаркер власної сторінки. Тобто «2–3» на сторінці 3.
 * `extraOnFirst` додає ДРУГУ колонцифру на ту саму сторінку — вхід C.
 */
async function makeDoc(tag, extraOnFirst) {
  const path = join(dir, `${tag}.indd`);
  const script = `
var doc = app.documents.add();
doc.documentPreferences.facingPages = true;
doc.documentPreferences.pagesPerDocument = 8;

var st = doc.paragraphStyles.add({ name: "Kolontsyfra" });
var out = { docName: null, marks: [] };

function folio(page, x, tail) {
    var b = page.bounds;
    var f = page.textFrames.add();
    f.geometricBounds = [b[0] + x, b[1] + 40, b[0] + x + 24, b[1] + 200];
    /* Ручне число попередньої сторінки + тире; автомаркер власної — окремо. */
    f.contents = String(Number(page.name) - 1) + "\\u2013";
    f.insertionPoints[-1].contents = SpecialCharacters.AUTO_PAGE_NUMBER;
    if (tail !== "") f.insertionPoints[-1].contents = tail;
    f.paragraphs[0].appliedParagraphStyle = st;
    out.marks.push({ page: String(page.name), frameId: String(f.id), tail: tail });
    return f;
}

for (var p = 0; p < doc.pages.length; p++) {
    var page = doc.pages[p];
    if (String(page.side).replace("PageSideOptions.", "") !== "RIGHT_HAND") continue;
    folio(page, 40, "");
    if (${extraOnFirst ? "true" : "false"} && p === 2) folio(page, 120, "B");
}

doc.save(new File(${JSON.stringify(path)}));
out.docName = doc.name;
__result = out;
`;
  const made = await runJsx("run_script", { script, undoName: `Зонд 11В: ${tag}` }, {
    timeoutMs: 180_000,
  });
  return made;
}

/** Надрукований текст кожної сторінки PDF — розв'язані значення маркерів. */
async function printed(docName, tag) {
  const path = join(dir, `${tag}.pdf`);
  await runJsx(
    "run_script",
    {
      script: `
var doc = app.activeDocument;
if (doc.name !== ${JSON.stringify(docName)}) throw new Error("не той документ: " + doc.name);
doc.recompose();
doc.exportFile(ExportFormat.PDF_TYPE, new File(${JSON.stringify(path)}), false);
__result = 1;`,
      undoName: "Зонд 11В: експорт",
    },
    { timeoutMs: 180_000 },
  );
  const pdf = await getDocument({ data: new Uint8Array(await readFile(path)) }).promise;
  const out = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const c = await (await pdf.getPage(i)).getTextContent();
    const t = c.items.map((it) => ("str" in it ? it.str : "")).join("|");
    if (t.length > 0) out.push(`с.${i}: ${t}`);
  }
  return out;
}

async function closeDoc(docName) {
  await runJsx(
    "run_script",
    {
      script: `
var d = app.documents.itemByName(${JSON.stringify(docName)});
if (d.isValid) d.close(SaveOptions.NO);
__result = app.documents.length;`,
      undoName: "Зонд 11В: закриття",
    },
    { timeoutMs: 60_000 },
  );
}

async function dropHelperLayer(docName) {
  return runJsx(
    "run_script",
    {
      script: `
var d = app.documents.itemByName(${JSON.stringify(docName)});
if (!d.isValid) throw new Error("документа немає");
var lay = d.layers.itemByName("_folio-helper");
var had = lay.isValid ? lay.pageItems.length : -1;
if (lay.isValid) lay.remove();
__result = had;`,
      undoName: "Зонд 11В: видалення службового шару",
    },
    { timeoutMs: 60_000 },
  );
}

const report = [];

async function scenario(tag, extraFolio, run) {
  const made = await makeDoc(tag, extraFolio);
  const docName = made.docName;
  try {
    const before = await printed(docName, `${tag}-before`);
    const said = await run(docName);
    const after = await printed(docName, `${tag}-after`);
    report.push({ tag, docName, before, after, said, same: JSON.stringify(before) === JSON.stringify(after) });
  } finally {
    await closeDoc(docName);
  }
}

/* ── ВХІД A: route "helper" без planId, ланцюжка немає ────────────────── */
await scenario("A", false, async (docName) => {
  const res = await apply(docName, { operation: "replace-literals", route: "helper", dryRun: false });
  return res.isError
    ? { refused: res.text.slice(0, 200) }
    : { applied: res.data.applied, eligible: res.data.eligible, skipped: res.data.skipped };
});

/* ── ВХІД B: route "auto" + planId, шар видалено між викликами ────────── */
await scenario("B", false, async (docName) => {
  const built = await apply(docName, { operation: "create-helper-thread", dryRun: false });
  if (built.isError) throw new Error("ланцюжок не побудувався: " + built.text);
  const removed = await dropHelperLayer(docName);
  const res = await apply(docName, {
    operation: "replace-literals",
    route: "auto",
    planId: built.data.planId,
    dryRun: false,
  });
  return res.isError
    ? { helperItemsRemoved: removed, refused: res.text.slice(0, 200) }
    : {
        helperItemsRemoved: removed,
        applied: res.data.applied,
        eligible: res.data.eligible,
        skipped: res.data.skipped,
      };
});

/* ── ВХІД C: route "auto" + planId, ДВІ колонцифри на одній сторінці ──── */
await scenario("C", true, async (docName) => {
  const built = await apply(docName, { operation: "create-helper-thread", dryRun: false });
  if (built.isError) throw new Error("ланцюжок не побудувався: " + built.text);
  const res = await apply(docName, {
    operation: "replace-literals",
    route: "auto",
    planId: built.data.planId,
    dryRun: false,
  });
  return res.isError
    ? { ignored: built.data.helper.ignoredFolioFrames, refused: res.text.slice(0, 200) }
    : {
        ignored: built.data.helper.ignoredFolioFrames,
        applied: res.data.applied,
        eligible: res.data.eligible,
        skipped: res.data.skipped,
      };
});

console.log(JSON.stringify(report, null, 2));

const status = await runJsx("status", {});
console.log("АКТИВНИЙ ДОКУМЕНТ ПІСЛЯ ЗОНДА:", JSON.stringify(status.activeDocument));
const open = await runJsx(
  "run_script",
  { script: "var n=[];for(var i=0;i<app.documents.length;i++)n.push(app.documents[i].name);__result={count:app.documents.length,names:n};", undoName: "Зонд 11В: перелік" },
  { timeoutMs: 60_000 },
);
console.log("ВІДКРИТІ ДОКУМЕНТИ:", JSON.stringify(open));

await rm(dir, { recursive: true, force: true });

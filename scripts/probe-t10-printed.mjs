/*
 * ЗАДАЧА 10, ДОКАЗ НАДРУКОВАНИМ ЧИСЛОМ.
 *
 * Питання 18 виміряло, що маркер друкує сторінку ПОПЕРЕДНЬОЇ РАМКИ ЛАНЦЮЖКА:
 * над ланцюжком лише з непарних сторінок мітка на с. 3 надрукувала «1», на
 * с. 5 — «3», на с. 7 — «5». Тут та сама конфігурація — колонцифри ЛИШЕ на
 * recto, як у робочій книжці, — але ланцюжок будує СПРАВЖНІЙ обробник
 * `pagination_create_helper_thread`. Якщо контракт §4.2 виконано, ті самі
 * мітки надрукують 2, 4 і 6.
 *
 * Розв'язані значення читаються з PDF, бо в `contents` маркер лишається
 * символом `` — та сама пастка, через яку Питання 5 читало структуру, а
 * не друк.
 *
 * ВЛАСНИЙ ТИМЧАСОВИЙ ДОКУМЕНТ, закритий без збереження. Робоча книжка
 * користувача не відкривається й не чіпається.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runJsx } from "../dist/bridge/runner.js";
import { runWrite } from "../dist/bridge/envelope.js";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const dir = await mkdtemp(join(tmpdir(), "idmcp-t10-printed-"));
const docPath = join(dir, "probe-t10.indd");
const pdfPath = join(dir, "probe-t10.pdf");

const make = `
var doc = app.documents.add();
doc.documentPreferences.facingPages = true;
doc.documentPreferences.pagesPerDocument = 8;
var out = { docName: null, folioFrameIds: [], marks: [] };

function boxOn(page) {
    var b = page.bounds;                 /* [y1, x1, y2, x2] у координатах розвороту */
    return [b[0] + 40, b[1] + 40, b[0] + 64, b[1] + 160];
}

/* Колонцифри ЛИШЕ на recto — рівно як усі 91 у робочій книжці. */
for (var p = 0; p < doc.pages.length; p++) {
    var page = doc.pages[p];
    /* String(page.side) віддає «RIGHT_HAND», без префікса перерахування —
       перевірено прогоном (перша редакція зонда відібрала нуль сторінок). */
    if (String(page.side).replace("PageSideOptions.", "") !== "RIGHT_HAND") continue;
    var f = page.textFrames.add();
    f.geometricBounds = boxOn(page);
    f.contents = "T" + String(page.name) + "=";
    f.insertionPoints[-1].contents = SpecialCharacters.PREVIOUS_PAGE_NUMBER;
    out.folioFrameIds.push(String(f.id));
    out.marks.push({
        markOnPage: String(page.name),
        pageMinusOne: p > 0 ? String(doc.pages[p - 1].name) : null
    });
}

doc.save(new File(${JSON.stringify(docPath)}));
out.docName = doc.name;
__result = out;
`;

const made = await runJsx("run_script", { script: make, undoName: "Зонд T10: підготовка" }, {
  timeoutMs: 180_000,
});
console.log("ПІДГОТОВЛЕНО:", JSON.stringify(made.marks));

try {
  const report = await runWrite({
    handler: "pagination_create_helper_thread",
    params: {
      expectedDocName: made.docName,
      stamp: "2026-08-08-probe",
      undoName: "Зонд T10: службовий ланцюжок",
      folioFrameIds: made.folioFrameIds,
    },
    timeoutMs: 300_000,
  });
  console.log(
    "ПОБУДОВАНО:",
    JSON.stringify({
      created: report.created,
      layerCreated: report.layerCreated,
      pages: report.frames.map((f) => f.page + ":" + f.source),
      ignored: report.ignoredFolioFrames,
      pageCountDelta: report.pageCountAfter - report.pageCountBefore,
      becameOverset: report.oversetAfter.filter((id) => !report.oversetBefore.includes(id)),
    }),
  );

  const exported = await runJsx(
    "run_script",
    {
      script: `var doc = app.activeDocument;
               doc.recompose();
               doc.exportFile(ExportFormat.PDF_TYPE, new File(${JSON.stringify(pdfPath)}), false);
               __result = ${JSON.stringify(pdfPath)};`,
      undoName: "Зонд T10: експорт",
    },
    { timeoutMs: 300_000 },
  );

  const pdf = await getDocument({ data: new Uint8Array(await readFile(exported)) }).promise;
  const printed = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const c = await (await pdf.getPage(i)).getTextContent();
    const text = c.items.map((it) => it.str).join("").trim();
    if (text) printed.push({ pdfPage: i, text });
  }
  console.log("НАДРУКОВАНО:", JSON.stringify(printed));
} finally {
  await runJsx(
    "run_script",
    {
      script: `var name = ${JSON.stringify(made.docName)};
               var n = 0;
               for (var i = app.documents.length - 1; i >= 0; i--) {
                 if (app.documents[i].name === name) { app.documents[i].close(SaveOptions.NO); n++; }
               }
               __result = n;`,
      undoName: "Зонд T10: закриття",
    },
    { timeoutMs: 120_000 },
  );
  await rm(dir, { recursive: true, force: true });
  const status = await runJsx("status", {}, { timeoutMs: 60_000 });
  console.log("ДОКУМЕНТІВ ПІСЛЯ:", status.documents.length);
}

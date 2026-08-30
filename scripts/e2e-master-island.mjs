/* An END-TO-END check of the foreign-master detector on a LIVE document.
 * The full chain: pagination_measure (InDesign) → detectMasterIslands →
 * the pagination_audit response. READ-ONLY; the file opens without a
 * window and closes WITHOUT SAVING. */
const BASE = "/Users/designer/MCP/indesign-mcp/.claude/worktrees/textpath-layout-exception-e1ac8b/dist";
const { runJsx } = await import(`${BASE}/bridge/runner.js`);
const { registerPaginationTools } = await import(`${BASE}/tools/pagination.js`);

const ФАЙЛ = process.argv[2];
const МІТКА = process.argv[3];

const open = `
var out = {};
var f = new File(${JSON.stringify(ФАЙЛ)});
if (!f.exists) { out.fatal = "файла немає"; }
else {
  var d = app.open(f, true);           /* with a window — tools operate on the active document */
  out.name = String(d.name);
  out.pages = d.pages.length;
  out.modified = d.modified;
}
__result = out;`;
const opened = await runJsx("run_script", { script: open, undoName: "Відкрити для перевірки (читання)" }, { timeoutMs: 300_000 });
if (opened.fatal) { console.error("ФАТАЛЬНО:", opened.fatal); process.exit(1); }
console.log(`[${МІТКА}] відкрито: ${opened.name}, ${opened.pages} с., modified=${opened.modified}`);

let handler = null;
registerPaginationTools({ registerTool(name, _cfg, h) { if (name === "pagination_audit") handler = h; } });

const res = await handler({
  folio: { styleNames: ["Колонтитул v1"] },
  runningHead: { styleNames: ["Колонтитул v1", "Колонтитул v2"] },
  headingStyles: ["Назва розділу"],
});
const data = JSON.parse(res.content[0].text);

const close = `
var out = {};
var d = app.documents.itemByName(${JSON.stringify(opened.name)});
if (d.isValid) { out.modifiedBefore = d.modified; d.close(SaveOptions.NO); out.closed = true; }
__result = out;`;
const closed = await runJsx("run_script", { script: close, undoName: "Закрити без збереження" }, { timeoutMs: 300_000 });
console.log(`[${МІТКА}] закрито без збереження: ${closed.closed}, modified перед закриттям=${closed.modifiedBefore}`);

const mi = data.masterIslands ?? [];
console.log(`[${МІТКА}] masterIslands: ${mi.length}`);
for (const c of mi) console.log(`    с.${c.page} ${c.side.replace("_HAND","")} «${c.master}» серед «${c.neighbourMaster}» (ряд ${c.runBefore}/${c.runAfter})`);
console.log(`[${МІТКА}] МІШЕНЬ с.188 знайдено: ${mi.some((c) => c.page === "188")}`);

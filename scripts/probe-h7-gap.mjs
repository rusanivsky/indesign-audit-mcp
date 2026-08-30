import { readFile } from "node:fs/promises";
import { runJsx } from "/Users/designer/MCP/indesign-mcp/.claude/worktrees/project-styles-4a4347/dist/bridge/runner.js";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const script = await readFile(new URL("./probe-h7-gap.jsx", import.meta.url), "utf8");
const r = await runJsx("run_script", { script, undoName: "Зонд 18: ланцюжок із пропуском" }, { timeoutMs: 180_000 });
console.log("СТРУКТУРА:", JSON.stringify(r.cases));

const pdf = await getDocument({ data: new Uint8Array(await readFile(r.pdf)) }).promise;
const printed = [];
for (let i = 1; i <= pdf.numPages; i++) {
  const c = await (await pdf.getPage(i)).getTextContent();
  printed.push({ pdfPage: i, text: c.items.map((it) => it.str).join("|").trim() });
}
console.log("НАДРУКОВАНО:", JSON.stringify(printed));

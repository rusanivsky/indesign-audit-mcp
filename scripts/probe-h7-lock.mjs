import { readFile } from "node:fs/promises";
import { runJsx } from "/Users/designer/MCP/indesign-mcp/.claude/worktrees/project-styles-4a4347/dist/bridge/runner.js";

const script = await readFile(new URL("./probe-h7-lock.jsx", import.meta.url), "utf8");
const r = await runJsx("run_script", { script, undoName: "Зонд 19: замок шару проти замка рамки" }, { timeoutMs: 180_000 });
for (const c of r.cases) console.log(JSON.stringify(c));
console.log("app.documents.length після зонда:", r.docsOpen);

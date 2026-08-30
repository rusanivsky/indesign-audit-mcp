/*
 * Запуск зонда H8. Шлях до `dist` — ЦІЄЇ гілки: MCP-інструменти показують код
 * ОСНОВНОЇ теки, тож перевіряти зміни worktree можна лише власною збіркою.
 */
import { readFile } from "node:fs/promises";
import { runJsx } from "../dist/bridge/runner.js";

const script = await readFile(new URL("./probe-h8-chain.jsx", import.meta.url), "utf8");
const r = await runJsx("run_script", { script, undoName: "Зонд H8: ремонт ланцюжка" }, { timeoutMs: 300_000 });
console.log(JSON.stringify(r, null, 2));

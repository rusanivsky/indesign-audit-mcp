#!/usr/bin/env node
/** Прохід 4 зонда H13 — правильна модель. ЧИТАЛЬНИЙ.
 *  npm run build && node scripts/probe-h13-model.mjs */
import { readFile } from "node:fs/promises";
import { runJsx } from "../dist/bridge/runner.js";
const script = await readFile(new URL("./probe-h13-model.jsx", import.meta.url), "utf8");
const r = await runJsx("run_script", { script, undoName: "Зонд H13 модель (лише читання)" }, { timeoutMs: 600_000 });
console.log(JSON.stringify(r, null, 1));

#!/usr/bin/env node
/** Домір resolve() — Задача 1 Фази 13. ЧИТАЛЬНИЙ.
 *  npm run build && node scripts/probe-h13-resolve.mjs */
import { readFile } from "node:fs/promises";
import { runJsx } from "../dist/bridge/runner.js";
const script = await readFile(new URL("./probe-h13-resolve.jsx", import.meta.url), "utf8");
const r = await runJsx("run_script", { script, undoName: "H13 домір resolve (лише читання)" }, { timeoutMs: 300_000 });
console.log(JSON.stringify(r, null, 1));

import { readFile } from "node:fs/promises";
import { runJsx } from "../dist/bridge/runner.js";

const script = await readFile(new URL("./probe-composition.jsx", import.meta.url), "utf8");
const result = await runJsx("run_script", { script, undoName: "Зонд H1 (лише читання)" }, {
  timeoutMs: 120_000,
});
console.log(JSON.stringify(result, null, 2));

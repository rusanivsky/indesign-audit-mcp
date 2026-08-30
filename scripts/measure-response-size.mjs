#!/usr/bin/env node
/**
 * The RESPONSE size of a tool on the active InDesign document.
 *
 *   npm run build && node scripts/measure-response-size.mjs doc_overview '{}'
 *
 * WHY NOT A MIRROR. Every previous measurement script in this
 * repository (`run-book-phase13.mjs`, `remeasure-h9.mjs`) reassembles
 * the response from the same modules — and the Phase 13 review already
 * caught what that leads to: the script measured a report WITHOUT
 * `inventory`/`survey`, i.e. a response the tool never actually
 * returns, and the threshold taken from that number was invalid.
 * There's no mirroring here: a collector stands in for `McpServer`, the
 * real `register*Tools` hands it the real handler, and the exact string
 * that would go into the MCP response is what gets measured.
 *
 * WHAT TO KNOW ABOUT ARGUMENTS. Zod defaults (`sampleSize: 10`,
 * `families: [...]`) are applied by the SDK during call validation, not
 * by the handler. The collector does no validation, so everything the
 * handler needs must be passed EXPLICITLY — otherwise the measured
 * response has `undefined` where a default would sit in real life. Same
 * rules as in the handler unit tests
 * (`tests/unit/tools-*-handler.test.ts`).
 *
 * THE RESPONSE CONTENTS ARE NOT PRINTED — only numbers: the response
 * itself can run to hundreds of kilobytes, and that's exactly why this
 * script exists.
 */
import { registerStatusTool } from "../dist/tools/status.js";
import { registerInspectTools } from "../dist/tools/inspect.js";
import { registerFindTools } from "../dist/tools/find.js";
import { registerCorrectionTools } from "../dist/tools/corrections.js";
import { registerPdfTools } from "../dist/tools/pdf.js";
import { registerRunTool } from "../dist/tools/run.js";
import { registerTypographyTools } from "../dist/tools/typography.js";
import { registerCompositionTools } from "../dist/tools/composition.js";
import { registerMapTools } from "../dist/tools/map.js";
import { registerPaginationTools } from "../dist/tools/pagination.js";
import { registerStyleTools } from "../dist/tools/styles.js";
import { registerPreflightTools } from "../dist/tools/preflight.js";
import { registerBibliographyTools } from "../dist/tools/bibliography.js";
import { registerSpellingTools } from "../dist/tools/spelling.js";
import { registerGeometryTools } from "../dist/tools/geometry.js";
import { registerColorTools } from "../dist/tools/color.js";

const handlers = new Map();
const collector = {
  registerTool(name, _config, handler) {
    handlers.set(name, handler);
  },
};

for (const register of [
  registerStatusTool,
  registerInspectTools,
  registerFindTools,
  registerCorrectionTools,
  registerPdfTools,
  registerRunTool,
  registerTypographyTools,
  registerCompositionTools,
  registerMapTools,
  registerPaginationTools,
  registerStyleTools,
  registerPreflightTools,
  registerBibliographyTools,
  registerSpellingTools,
  registerGeometryTools,
  registerColorTools,
]) {
  register(collector);
}

const [, , tool, argsJson = "{}", flag] = process.argv;

if (!tool) {
  console.log("інструменти:", [...handlers.keys()].sort().join(", "));
  process.exit(1);
}
if (!handlers.has(tool)) {
  console.error(`невідомий інструмент «${tool}»`);
  process.exit(2);
}

/*
 * A safeguard, not ceremony: this script runs while the user's working
 * layout is open in InDesign. Write paths (`*_apply`) must never end up
 * here at all, and a silent oversight would cost the document, not
 * just the measurement.
 */
if (/_apply$|^corrections_apply$/.test(tool) && flag !== "--allow-write") {
  console.error(`«${tool}» пише в документ. Свідомо: додайте --allow-write.`);
  process.exit(3);
}

const t0 = Date.now();
const res = await handlers.get(tool)(JSON.parse(argsJson));
const ms = Date.now() - t0;

const text = res.content[0].text;
const bytes = Buffer.byteLength(text, "utf8");

console.log(`інструмент:   ${tool} ${argsJson}`);
console.log(`час:          ${ms} мс`);
console.log(`помилка:      ${res.isError === true ? "ТАК" : "ні"}`);
console.log(`ВІДПОВІДЬ:    ${bytes} Б (${(bytes / 1024).toFixed(1)} КБ), ${text.length} знаків`);

if (res.isError === true) {
  console.log(`текст помилки: ${text.slice(0, 400)}`);
  process.exit(0);
}

/* A breakdown by top-level keys — so it's visible exactly what's heavy. */
const body = JSON.parse(text);
if (body !== null && typeof body === "object" && !Array.isArray(body)) {
  const rows = Object.entries(body)
    .map(([k, v]) => ({
      ключ: k,
      Б: Buffer.byteLength(JSON.stringify(v) ?? "null", "utf8"),
      елементів: Array.isArray(v) ? v.length : "",
    }))
    .sort((a, b) => b.Б - a.Б);
  console.table(rows);
}

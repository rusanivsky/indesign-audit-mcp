/*
 * PHASE 8 RUN ON A COPY OF THE WORKING BOOK (spec §8.5).
 *
 * Calls this branch's REGISTERED `pagination_apply` tool, not
 * `mcp__indesign__*`: the MCP server runs from the MAIN checkout, which
 * doesn't have Phase 8.
 *
 * DOCUMENT VERIFICATION COMES FIRST AND IS UNCONDITIONAL. The script
 * refuses to run if the active document isn't the one whose name was
 * passed in: the cost of a mistake is a structural change to the
 * user's live book.
 *
 * Usage: node scripts/run-book-phase8.mjs <operation> <docName> [--wet]
 *   operations: audit | create | repair
 * Without `--wet`, write operations run as a dry run.
 */
import { registerPaginationTools } from "../dist/tools/pagination.js";
import { runJsx } from "../dist/bridge/runner.js";

const [, , op, docName, wetFlag, planId] = process.argv;
if (!op || !docName) {
  console.error("Виклик: node scripts/run-book-phase8.mjs <audit|create|repair|replace> <docName> [--wet] [planId]");
  process.exit(2);
}
const dryRun = wetFlag !== "--wet";

const status = await runJsx("status", {}, { timeoutMs: 60_000 });
const active = status.activeDocument;
if (active !== docName) {
  console.error(`ВІДМОВА: активний документ «${active}», а просили «${docName}». Нічого не зроблено.`);
  process.exit(1);
}

function tool(name) {
  let captured = null;
  const fake = {
    registerTool(n, _cfg, h) {
      if (n === name) captured = h;
    },
  };
  registerPaginationTools(fake);
  if (!captured) throw new Error(`${name} не зареєстровано`);
  return captured;
}

const FOLIO = { styleName: "Колонтитул v1", range: "backward" };

let res;
const t0 = Date.now();
if (op === "audit") {
  res = await tool("pagination_audit")({ folio: { styleName: FOLIO.styleName } });
} else if (op === "replace") {
  if (!planId) {
    console.error('ВІДМОВА: "replace" вимагає planId від попереднього create/repair.');
    process.exit(2);
  }
  res = await tool("pagination_apply")({
    operation: "replace-literals",
    route: "auto",
    planId,
    folio: FOLIO,
    dryRun,
    expectedDocName: docName,
  });
} else {
  res = await tool("pagination_apply")({
    operation: op === "create" ? "create-helper-thread" : "repair-helper-thread",
    folio: FOLIO,
    dryRun,
    expectedDocName: docName,
  });
}
const ms = Date.now() - t0;

const data = JSON.parse(res.content[0].text);
console.log(JSON.stringify({ ok: !res.isError, ms, data }, null, 1));
process.exit(res.isError ? 1 : 0);

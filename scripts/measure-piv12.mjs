#!/usr/bin/env node
/**
 * Phase 12 Task 10: a run of the "piv" family (piv2019) on the REAL BOOK
 * through THIS BRANCH'S OWN build (dist/), not through mcp__indesign__*
 * (those look at the main checkout and, without this phase's code,
 * would give a false zero).
 *
 * Read-only. Mirrors what typography_audit does
 * (src/tools/typography.ts): containers_read → language_runs_read →
 * filter master-page containers → collectPivStems(audited, auditedLangs,
 * UK_LANGUAGE). No apply, no save, no fixture.
 *
 * NOT A FULL MIRROR: the real typography_audit always adds a `caveat`
 * (PIV2019_CAVEAT) to the piv2019 block in its response; this script
 * now adds it too (below), BUT the "812 bytes" measurement in
 * docs/measured-facts-phase12.md (Task 10) was recorded from a run
 * WITHOUT that field — the script's version at the time didn't have
 * it. 812 remains a valid MEASURED number for that specific part only.
 *
 * caveat is a LARGE, CHANGEABLE string (already revised twice during
 * this phase), so "full piv2019 block size" is not a constant but a
 * SNAPSHOT at the moment it was last counted (see
 * docs/measured-facts-phase12.md, section "Task 10", which names the
 * commit whose PIV2019_CAVEAT text the bytes quoted there correspond
 * to). If PIV2019_CAVEAT has been edited since — the old snapshot is
 * INVALID. To recompute:
 *   npm run build && node -e 'const {PIV2019_CAVEAT}=require("./dist/typography/piv2019.js");const b=Buffer.byteLength(JSON.stringify(PIV2019_CAVEAT),"utf8");console.log("caveat:",b,"| full block:",812+b)'
 */
import { runJsx } from "../dist/bridge/runner.js";
import { readLanguageRuns, assertLanguageCoverage } from "../dist/spelling/langruns.js";
import { UK_LANGUAGE, countLanguageRuns } from "../dist/typography/langgate.js";
import { collectPivStems, MAX_PIV_STEMS, PIV2019_CAVEAT } from "../dist/typography/piv2019.js";

async function main() {
  const before = await runJsx("status", {});
  console.log("=== Стан ДО ===");
  console.log(JSON.stringify(before, null, 2));

  const t0 = Date.now();

  const read = await runJsx("containers_read", {});
  const langs = await readLanguageRuns();
  assertLanguageCoverage(read.containers, langs);

  const audited = read.containers.filter((c) => !c.isMaster);
  const auditedIds = new Set(audited.map((c) => c.containerId));
  const auditedLangs = langs.filter((l) => auditedIds.has(l.containerId));

  const piv = collectPivStems(audited, auditedLangs, UK_LANGUAGE);

  const elapsedMs = Date.now() - t0;

  const response = {
    docName: read.docName,
    piv2019: {
      ukrainianRuns: countLanguageRuns(auditedLangs, UK_LANGUAGE),
      stems: piv.stems.slice(0, MAX_PIV_STEMS),
      stemsTruncated: Math.max(0, piv.stems.length - MAX_PIV_STEMS),
      wrongCount: piv.wrongCount,
      mixedCount: piv.mixedCount,
      skippedByLanguage: piv.skippedByLanguage,
      excludedNotNumeral: piv.excludedNotNumeral,
      caveat: PIV2019_CAVEAT,
    },
  };

  const bytes = Buffer.byteLength(JSON.stringify(response), "utf8");

  console.log("\n=== Відповідь piv2019 ===");
  console.log(JSON.stringify(response, null, 2));

  console.log("\n=== Метрики прогону ===");
  console.log("containers (усього):", read.containers.length);
  console.log("containers (без майстрових, audited):", audited.length);
  console.log("час прогону (мс):", elapsedMs);
  console.log("розмір відповіді (байт, лише piv2019+docName):", bytes);
  console.log("MAX_PIV_STEMS:", MAX_PIV_STEMS, "| основ у повному inventory (до обрізання):", piv.stems.length);

  const after = await runJsx("status", {});
  console.log("\n=== Стан ПІСЛЯ ===");
  console.log(JSON.stringify(after, null, 2));
}

main().catch((e) => {
  console.error("ПОМИЛКА:", e && e.stack ? e.stack : e);
  process.exit(1);
});

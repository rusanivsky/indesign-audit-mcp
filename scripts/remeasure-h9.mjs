#!/usr/bin/env node
/**
 * RE-MEASUREMENT for Phase 9 — debt item #2 from `docs/CONTINUE-HERE.md`.
 *
 * Why. The book-run numbers — `wordTypesTotal = 562`, `deviating = 70`,
 * response size 49,696 B — were taken BEFORE the final branch review
 * added a master-page filter and capped `languages[].pages`. Both
 * changes shift exactly these numbers, and by how much is unknown:
 * nobody measured how many of the book's 574 containers sit on master
 * pages. This script answers that by execution, not by estimate.
 *
 * FULLY READ-ONLY. Calls only `containers_read`, `language_runs_read`,
 * and `run_script` with a purely read-only body — exactly what
 * `spelling_audit` itself does. Writes nothing, saves nothing, closes
 * nothing. No need to make a copy of the book (the same conclusion as
 * for the Task 13 run).
 *
 * IMPORTANT: run this through THIS branch's `dist/`, not through the
 * MCP tools — they show the code from the main repository checkout, not
 * this worktree (the H3–H8 probe rule). That is:
 *
 *   npm run build && node scripts/remeasure-h9.mjs
 *
 * Requires macOS permission to control InDesign (System Settings →
 * Privacy & Security → Automation). Without it, the bridge throws "Not
 * authorized to control InDesign", and that's visible right away, not
 * as an empty result.
 */
import { runJsx } from "../dist/bridge/runner.js";
import { dictLangCode, dictPathsFor } from "../dist/spelling/dictpath.js";
import { assertLanguageCoverage, readLanguageRuns } from "../dist/spelling/langruns.js";
import { collectAudit, loadDictionarySource } from "../dist/tools/spelling.js";
import { buildReport } from "../dist/spelling/report.js";

const NO_LANGUAGE = "[No Language]";

const read = await runJsx("containers_read", {});
const langs = await readLanguageRuns();
assertLanguageCoverage(read.containers, langs);

const appRoot = await runJsx("run_script", {
  script: "__result = String(app.filePath.fsName);",
  undoName: "Читання шляху InDesign",
});

/* EXACTLY WHAT this re-measurement finds out: how many of the book's
 * containers sit on master pages and therefore are no longer included
 * in the audit. */
const masters = read.containers.filter((c) => c.isMaster);
const audited = read.containers.filter((c) => !c.isMaster);
const auditedIds = new Set(audited.map((c) => c.containerId));
const auditedLangs = langs.filter((l) => auditedIds.has(l.containerId));

const langNames = new Set();
for (const l of auditedLangs) {
  for (const r of l.runs) if (r.language !== NO_LANGUAGE) langNames.add(r.language);
}

const dicts = new Map();
const affs = new Map();
const sources = [];
const failedCodes = new Set();
for (const name of langNames) {
  const code = dictLangCode(name);
  if (code === null) continue;
  const loaded = loadDictionarySource(code, dictPathsFor(appRoot, code));
  if (loaded === null) { failedCodes.add(code); continue; }
  dicts.set(code, loaded.dict);
  affs.set(code, loaded.aff);
  sources.push({
    code,
    path: loaded.path,
    stems: loaded.stems,
    vintage: loaded.vintage,
    affixGroups: loaded.affixGroups,
    compoundRulesPresentNotApplied: loaded.compoundRulesPresentNotApplied,
  });
}

const languagesWithoutDictionary = [...langNames]
  .filter((name) => { const c = dictLangCode(name); return c === null || failedCodes.has(c); })
  .sort();

const collected = collectAudit(audited, auditedLangs, affs, dicts, {});

const otherFields = {
  docName: read.docName,
  dictionaries: sources,
  languagesWithoutDictionary,
  caveat: "(той самий текст, що в інструменті — тут скорочено не буде)",
  languages: collected.languages,
};
const otherFieldsBytes = Buffer.byteLength(JSON.stringify(otherFields, null, 2), "utf8");
const report = buildReport({
  language: collected.language,
  words: collected.words,
  otherFieldsBytes,
});
const full = { ...otherFields, ...report };

console.log("=== КОНТЕЙНЕРИ ===");
console.log(`усього ${read.containers.length}, з них МАЙСТЕРНИХ ${masters.length}, в аудиті ${audited.length}`);
console.log(`мовних діапазонів усього ${langs.reduce((s, l) => s + l.runs.length, 0)}, ` +
  `в аудиті ${auditedLangs.reduce((s, l) => s + l.runs.length, 0)}`);

console.log("\n=== ЧИСЛА, ЩО ПЕРЕВИМІРЮЮТЬСЯ (було 562 / 70 / 49 696 Б) ===");
console.log(`wordTypesTotal: ${report.wordTypesTotal}   (було 562)`);
console.log(`deviating:      ${report.deviating}   (було 70)`);
console.log(`розмір data:    ${Buffer.byteLength(JSON.stringify(full, null, 2), "utf8")} Б   (було 49 696, стеля 50 000)`);
console.log(`words (деталь): ${report.words.length}, wordsAll: ${report.wordsAll.length}, wordsNotCheckedAll: ${report.wordsNotCheckedAll.length}`);

console.log("\n=== ІНВЕНТАР МОВ (pages тепер обрізані, pageCount повний) ===");
for (const t of collected.languages) {
  console.log(`  ${t.language}: діапазонів ${t.ranges}, слів ${t.words}, ` +
    `частка ${(t.share * 100).toFixed(2)}%, сторінки ${JSON.stringify(t.pages)} з ${t.pageCount}`);
}

console.log("\n=== ЗНАХІДКИ РОДИНИ language ===");
for (const f of collected.language) {
  console.log(`  ${f.defect} с.${f.page} ${f.language} [${f.start},${f.end}) слів ${f.words}`);
}

console.log("\n=== СЛОВНИКИ ===");
for (const s of sources) {
  console.log(`  ${s.code}: основ ${s.stems}, груп SFX/PFX ${s.affixGroups.sfx}/${s.affixGroups.pfx}, ` +
    `складені правила присутні-не-застосовані: ${s.compoundRulesPresentNotApplied}`);
}
console.log(`  без словника: ${JSON.stringify(languagesWithoutDictionary)}`);
console.log(`\ntruncated: ${JSON.stringify(report.truncated)}`);

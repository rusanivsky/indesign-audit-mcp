#!/usr/bin/env node
/**
 * Зонд носіїв символьних стилів на ВЛАСНОМУ тимчасовому документі.
 *
 *   npm run build && node scripts/probe-carriers.mjs
 *
 * Через `dist/`, а не через MCP: сервер MCP запущено з основної теки
 * репозиторію й він НЕ бачить коду гілки (правило 7 у «Робочий документ
 * користувача»). Робочої книжки зонд не торкається — створює свій
 * документ і закриває його з SaveOptions.NO у `finally`.
 */
import { runJsx } from "../dist/bridge/runner.js";

const script = `
var out = { steps: [] };
var doc = app.documents.add(false);
try {
    var csBullet = doc.characterStyles.add();
    csBullet.name = "Lyshe_Marker";
    var pBullet = doc.paragraphStyles.add({ name: "Spysok" });
    try {
        pBullet.bulletsCharacterStyle = csBullet;
        out.steps.push("bulletsCharacterStyle: ПРИСВОЄНО -> " + String(pBullet.bulletsCharacterStyle.name));
    } catch (e1) { out.steps.push("bulletsCharacterStyle КИНУЛО: " + String(e1).substr(0, 90)); }

    var csNested = doc.characterStyles.add();
    csNested.name = "Lyshe_Vkladenyi";
    var pNested = doc.paragraphStyles.add({ name: "Z_Vkladenym" });
    try {
        pNested.nestedStyles.add({ appliedCharacterStyle: csNested, delimiter: ".", inclusive: true, repetition: 1 });
        out.steps.push("nestedStyles.add: ОК, len=" + pNested.nestedStyles.length +
            ", -> " + String(pNested.nestedStyles[0].appliedCharacterStyle.name));
    } catch (e2) { out.steps.push("nestedStyles.add КИНУЛО: " + String(e2).substr(0, 130)); }

    var csGrep = doc.characterStyles.add();
    csGrep.name = "Lyshe_Grep";
    var pGrep = doc.paragraphStyles.add({ name: "Z_Grep" });
    try {
        pGrep.nestedGrepStyles.add({ appliedCharacterStyle: csGrep, grepExpression: "\\\\d+" });
        out.steps.push("nestedGrepStyles.add: ОК, len=" + pGrep.nestedGrepStyles.length +
            ", -> " + String(pGrep.nestedGrepStyles[0].appliedCharacterStyle.name));
    } catch (e3) { out.steps.push("nestedGrepStyles.add КИНУЛО: " + String(e3).substr(0, 130)); }

    var scan = IDMCP.characterStyleCarriers(doc);
    var seen = {};
    for (var id in scan.carriers) {
        if (!scan.carriers.hasOwnProperty(id)) continue;
        var nm = "id " + id;
        for (var c = 0; c < doc.allCharacterStyles.length; c++) {
            if (String(doc.allCharacterStyles[c].id) === id) nm = String(doc.allCharacterStyles[c].name);
        }
        seen[nm] = scan.carriers[id];
    }
    out.scan = { failures: scan.failures, seen: seen };
} finally {
    doc.close(SaveOptions.NO);
}
__result = out;
`;

const res = await runJsx("run_script", { script, undoName: "Зонд носіїв" }, { timeoutMs: 120_000 });
console.log(JSON.stringify(res, null, 2));

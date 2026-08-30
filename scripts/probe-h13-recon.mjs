#!/usr/bin/env node
/**
 * Запуск розвідувального проходу зонда H13 (Фаза 13, блок D).
 *
 * ЧИТАЛЬНИЙ. Відкриває робочу книжку, якщо її ще не відкрито, і НЕ закриває
 * її та НЕ зберігає — рішення закривати лишається людині (правило
 * [[indesign-live-document-safety]]: не чіпати документа, якого не створював).
 *
 * ВАЖЛИВО: ганяти через `dist/` ЦІЄЇ гілки, а не через MCP-інструменти — вони
 * показують код основної теки репозиторію, а не цього worktree (правило
 * зондів H3–H12):
 *
 *   npm run build && node scripts/probe-h13-recon.mjs
 */
import { readFile } from "node:fs/promises";
import { runJsx } from "../dist/bridge/runner.js";

const DOC_NAME = "Book 260811-1645.indd";
const DOC_PATH =
  "/Users/designer/Library/CloudStorage/GoogleDrive-designer@example.com/My Drive/" +
  "KR/Production/Design/Book/03 Файли проєкту/Book 260811-1645.indd";

/* Відкриття — окремим кроком і НАЗВАНЕ вголос, щоб у журналі було видно, хто
 * саме відкрив документ. Якщо він уже відкритий, нічого не робиться. */
const openResult = await runJsx(
  "run_script",
  {
    script: `
      var name = ${JSON.stringify(DOC_NAME)};
      var path = ${JSON.stringify(DOC_PATH)};
      var existing = app.documents.itemByName(name);
      if (existing.isValid) {
        __result = { opened: false, reason: "вже відкрито", name: String(existing.name) };
      } else {
        var f = new File(path);
        if (!f.exists) { throw new Error("Файла немає: " + path); }
        var d = app.open(f);
        __result = { opened: true, name: String(d.name), modified: d.modified };
      }
    `,
    undoName: "H13: відкриття книжки (без змін)",
  },
  { timeoutMs: 180_000 },
);
console.log("ВІДКРИТТЯ:", JSON.stringify(openResult, null, 2));

const script = await readFile(new URL("./probe-h13-recon.jsx", import.meta.url), "utf8");
const result = await runJsx(
  "run_script",
  { script, undoName: "Зонд H13 розвідка (лише читання)" },
  { timeoutMs: 600_000 },
);
console.log(JSON.stringify(result, null, 2));

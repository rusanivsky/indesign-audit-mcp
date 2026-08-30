#!/usr/bin/env node
/**
 * Домір до зонда `HS`: прапорець читальності (правильно прочитаний) і
 * ПОВТОРНИЙ хронометраж `styles_measure`.
 *
 * Навіщо повторний: перший прогін зонда дав 132 539 мс, тоді як
 * `docs/measured-facts-phase5.md` («Прогін готового інструмента») фіксує
 * 10 860 мс на тій самій операції й тій самій книжці. Розбіжність у 12
 * разів — за правилом Фази 7 це ПІДОЗРА ДО ПРИЛАДУ, а не відкриття, і
 * доки вона не пояснена, жодне число зонда не можна класти в спек.
 */
import { runJsx } from "../dist/bridge/runner.js";

const flag = async (label) => {
  const r = await runJsx("run_script", {
    script: "var d = app.documents[0]; __result = {name: String(d.name), modified: d.modified, pages: d.pages.length};",
    undoName: "Домір HS: прапорець (лише читання)",
  }, { timeoutMs: 60_000 });
  console.log(label, JSON.stringify(r));
  return r;
};

await flag("прапорець ДО:      ");

for (const pass of [1, 2]) {
  const t = Date.now();
  const m = await runJsx("styles_measure", {}, { timeoutMs: 600_000 });
  console.log(`styles_measure прохід ${pass}: ${Date.now() - t} мс, ` +
    `стилів ${m.styles.length}, абзаців ${m.paragraphs.length}, діапазонів ${m.ranges.length}`);
}

await flag("прапорець ПІСЛЯ:   ");

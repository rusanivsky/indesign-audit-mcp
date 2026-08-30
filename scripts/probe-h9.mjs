/*
 * ЗОНД H9 — ВИМІР ПЕРЕД КОДОМ ФАЗИ 9 (спек §10, крок 1).
 *
 * Чотири питання, три з них ВОРОТА плану:
 *  1. ціна containers_read (текст уже покритий чинним інструментом — просто
 *     звірка, що вона прийнятна);
 *  2. ціна ДОДАТКОВОГО проходу по textStyleRanges для мовних діапазонів —
 *     запасного важеля в інтерфейсі немає (§9 спека), тож якщо вимір
 *     виявиться дорогим, це рішення з числом на руках, а не готовий параметр;
 *  3. поведінка app.userDictionaries — 60 словників, слова користувача
 *     української мови (мають бути ПЕРЕНОСАМИ з тильдами, а не винятками
 *     правопису — так стверджує спек §6, і це варто перевірити виконанням,
 *     а не переказом);
 *  4. ГОЛОВНІ ВОРОТА — скільки в книжці різних слово-типів. Якщо число таке,
 *     що звіт (навіть зведений до слово-типів із частотами) нечитальний,
 *     спек §9 каже переглядати задум родини `dictionary`, а не добудовувати.
 *
 * ЧИТАЄ, НЕ ПИШЕ. Жодного виклику apply/write. Документ користувача
 * (`Book 260811-1645.indd`, відкритий) читається лише через
 * containers_read і run_script із суто читальним ExtendScript.
 *
 * dist/ ЦІЄЇ гілки, не mcp__indesign__*: MCP-інструменти показують код
 * основної теки репозиторію, а не цього worktree (правило зондів H3–H8).
 */
import { runJsx } from "../dist/bridge/runner.js";

console.log("=== Зонд H9 ===");

// ПИТАННЯ 1 — ціна containers_read і склад контейнерів за kind
const t0 = Date.now();
const read = await runJsx("containers_read", {});
const tText = Date.now() - t0;

const chars = read.containers.reduce((s, c) => s + c.text.length, 0);
const byKind = read.containers.reduce((a, c) => ((a[c.kind] = (a[c.kind] ?? 0) + 1), a), {});
console.log(`ПИТАННЯ 1 — containers_read: ${tText} мс, ${read.containers.length} контейнерів, ${chars} символів`);
console.log(`  за kind:`, JSON.stringify(byKind));

// ПИТАННЯ 2 — ціна додаткового проходу по textStyleRanges (мовні діапазони)
const t1 = Date.now();
const runs = await runJsx(
  "run_script",
  {
    script: `
var doc = app.documents[0];
var st = doc.stories.everyItem().getElements();
var names = [], counts = [], total = 0;
for (var i = 0; i < st.length; i++) {
  var tsr = st[i].textStyleRanges.everyItem().getElements();
  for (var k = 0; k < tsr.length; k++) {
    total++;
    var nm; try { nm = String(tsr[k].appliedLanguage.name); } catch (e) { nm = "<err>"; }
    var at = -1;
    for (var q = 0; q < names.length; q++) { if (names[q] === nm) { at = q; break; } }
    if (at < 0) { names.push(nm); counts.push(1); } else { counts[at]++; }
  }
}
var out = [];
for (var q = 0; q < names.length; q++) out.push(names[q] + "=" + counts[q]);
__result = { total: total, languages: out };
`,
  },
  { timeoutMs: 120_000 },
);
const tLang = Date.now() - t1;
console.log(`ПИТАННЯ 2 — мовні діапазони: ${tLang} мс, ${runs.total} діапазонів`);
console.log(`  мови:`, JSON.stringify(runs.languages));

// ПИТАННЯ 3 — userDictionaries: скільки їх, і що саме в українському
const t2 = Date.now();
const ud = await runJsx(
  "run_script",
  {
    script: `
var out = { count: app.userDictionaries.length, ukrainian: null, mergeUserDictionary: null };
try { out.mergeUserDictionary = app.dictionaryPreferences.mergeUserDictionary; } catch (e) { out.mergeUserDictionaryErr = String(e); }
for (var i = 0; i < app.userDictionaries.length; i++) {
  if (app.userDictionaries[i].name === "Ukrainian") {
    var d = app.userDictionaries[i];
    var words = d.addedWords;
    var sample = [];
    for (var k = 0; k < words.length; k++) sample.push(words[k]);
    out.ukrainian = { addedWordsCount: words.length, addedWords: sample };
    break;
  }
}
__result = out;
`,
  },
  { timeoutMs: 60_000 },
);
const tUd = Date.now() - t2;
console.log(`ПИТАННЯ 3 — userDictionaries (${tUd} мс):`, JSON.stringify(ud, null, 2));

// ПИТАННЯ 4 — ВОРОТА: скільки різних слово-типів у книжці (груба верхня межа
// без розгортання афіксів — розгортача ще немає)
const text = read.containers.map((c) => c.text).join("\n");
const words =
  text
    .toLowerCase()
    .replace(/́/g, "")
    .replace(/[’ʼ‘`´]/g, "'")
    .match(/[\p{L}'-]+/gu) ?? [];
const types = new Set(words);
console.log(`ПИТАННЯ 4 — слів: ${words.length}, різних слово-типів: ${types.size}`);

const countByWord = new Map();
for (const w of words) countByWord.set(w, (countByWord.get(w) ?? 0) + 1);
const once = [...types].filter((w) => countByWord.get(w) === 1);
console.log(`  трапляються РАЗ: ${once.length} (кандидати на одрук)`);

// Ruling 1 (task-1-brief не пише book-words.json, Задача 2 його читає) —
// масив різних слово-типів (уже приведені форми: нижній регістр, без
// наголосу, з нормалізованим апострофом) іде у фікстуру.
const { writeFile } = await import("node:fs/promises");
const sortedTypes = [...types].sort();
await writeFile(
  new URL("../tests/fixtures/book-words.json", import.meta.url),
  JSON.stringify(sortedTypes, null, 2) + "\n",
  "utf8",
);
console.log(`  записано tests/fixtures/book-words.json: ${sortedTypes.length} слово-типів`);

console.log("=== Кінець зонда H9 ===");

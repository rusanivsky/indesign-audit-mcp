// scripts/regression-book.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/*
 * Task B (ruling R26). Before: the control number was addressed by key
 * NAME, and `глибоко()` (deep()) took the FIRST node with that name in a
 * DFS traversal of all passes. That broke in two ways:
 *
 *   1. Six names ("linksNormal", "inks", "words", …) were simply made up
 *      — no such keys ever exist in tool responses, though the values
 *      often matched by coincidence (the real field has a different
 *      name).
 *   2. `words` is a legitimate key in SEVERAL passes with DIFFERENT
 *      values: `overview.stories[0].words === 2` (the document's first
 *      story) and `spelling.languages[0].words === 31412` (the real
 *      number). DFS found the first one — 2 — and stopped there.
 *
 * Ruling R26: addressing by key name is irreparable in principle — no
 * traversal ordering resolves collision (2). So every control number now
 * carries an EXPLICIT address: a pass identifier (`m.passes[].id`) and a
 * path to the field INSIDE that pass's data (`m.passes[].data`). The name
 * stays a HUMAN-READABLE label — it no longer looks anything up.
 *
 * Three addresses were given directly by the brief: `unknownWordTypes` →
 * spelling.wordTypesTotal, `inks` → color.inkCount, `words` → spelling.
 * languages[0].words. The rest were derived by reading the `ok({…})`
 * literals in `src/tools/*.ts` (not the types in `src/<domain>/
 * report.ts` — those can diverge, and confusing the two already produced
 * a Critical in this block once before).
 *
 * FOUR control numbers had no path to a scalar — and that was discovered
 * by reading the code, not overlooked. Tasks H2-H4 addressed them by
 * name, and each got its OWN state rather than a shared "NO ADDRESS"
 * bucket:
 *
 *   overset      H2  — now a top-level field of the measurements
 *                      (`адресаКореня`/rootAddress); the computation
 *                      isn't duplicated, it counts the same place as
 *                      before.
 *   linksNormal  H3  — a named `лічильник` (counter) over the exact
 *                      array address: the predicate is spelled out
 *                      literally here, so this isn't a return to the
 *                      name-based lookup that R26 removed.
 *   maxTac       H4  — a `діркаСпроможності` (capability gap): no pass
 *                      measures this number at all, so it cannot be
 *                      fixed inside this script in principle. It doesn't
 *                      trip the gate, but it's printed every run.
 *   contentsNumbers  — a deliberate omission, declared in the config
 *                      itself (F7/R34/R29), not a decision of this
 *                      script.
 *
 * Discipline B1 ("path to a field", not "computation over a field")
 * stays in force exactly where it always was: `адреса()` (address())
 * can't compute. The counter is a separate, named kind of entry with a
 * single "field === value" predicate, with no operators and no nesting
 * (brief H3: "don't build a query language").
 */
const КОНТРОЛЬНІ = [
  /*
   * doc.pages.length, `src/jsx/inspect.jsx:71` (`pageCount: doc.pages.length`),
   * is returned literally by `ok(await runJsx("doc_overview", {}))` —
   * `src/tools/inspect.ts:16`. It goes through pass id "overview"
   * (`src/cli/run/plan.ts`, an always-run pass alongside status).
   */
  адреса("pages", 196, "overview", ["pageCount"]),

  /*
   * `doc_overview.links` is an array of `{name, status}`
   * (`src/jsx/inspect.jsx:57-60`). There's NOWHERE a scalar for "how many
   * status === NORMAL" — only an array of pairs. It can be computed with
   * a filter+length, but that's already a COMPUTATION over a field, not
   * a PATH to a field (B1) — and exactly this kind of filter-by-value is
   * the "neighboring field" that R26/B3 warns against addressing.
   * Measured (docs/measured-facts-cli.md:134): the value 6 happens to
   * match (all 6 links have status "NORMAL" at the time of the first
   * run), but that's a property of THIS run, not a guarantee of the
   * response's structure.
   */
  /*
   * H3. `doc_overview.links` is an array of `{name, status}`
   * (`src/jsx/inspect.jsx:57-60`). There's no scalar for "how many
   * status === NORMAL", but the array's address is exact and the
   * predicate is spelled out here literally — so this is a counter, not
   * a lookup. Measured: all 6 links have status NORMAL.
   */
  лічильник("linksNormal", 6, "overview", ["links"], "status", "NORMAL"),

  /* ColorReport.inkCount, `src/color/report.ts` (return report.inkCount),
   * is returned by `ok(buildReport(...))` — `src/tools/color.ts:240`. */
  адреса("inks", 4, "color", ["inkCount"]),

  /*
   * `color_audit` has no "maximum TAC" scalar — only a distribution over
   * buckets, `ColorReport.tacSurvey: TacBucket[]` (`{upTo, count}`,
   * `src/color/detect/tac.ts`). 240% is the UPPER BOUND of the last
   * non-empty bucket (docs/measured-facts-cli.md:136), not a field:
   * getting that number would mean walking the array and finding "the
   * last bucket with count > 0" — a computation, not a path.
   */
  діркаСпроможності(
    "maxTac",
    240,
    "жоден прохід не міряє максимум покриття фарби: color_audit віддає лише " +
      "перевищення порогу й розподіл по кошиках (ColorReport.tacSurvey), самого максимуму — ніде",
    "з кошиків виводиться лише МЕЖА: останній непорожній кошик — upTo 240, " +
      "тобто максимум > 200 і ≤ 240. Це не 240, а проміжок, що його містить",
  ),

  /*
   * H2 (ruling R42, `schemaVersion: 3`). `overset` is computed by
   * `oversetЗВимірів()` (oversetFromMeasurements()) from
   * `preflight.findings`, and until now that number lived ONLY in the
   * finished HTML — meaning there was nothing to compare two runs
   * against. Now it's written as a top-level field, and the address
   * became ordinary.
   *
   * A note on the type: the field holds a DISPLAY string, not a number —
   * `oversetЗВимірів()` returns a string and can give back "н/д" ("n/a")
   * when preflight wasn't measured. The comparison only extracts a
   * canonical integer ("0" → 0); "н/д" does not become a number and
   * falls out as a loud discrepancy. That's deliberate: "not measured"
   * must never read as "overset zero, clean" — exactly the substitution
   * that R46 stands against.
   */
  адресаКореня("overset", 0, ["overset"]),

  /*
   * `pagination_audit`: `PaginationReport.folio.checked` /
   * `.runningHead.checked` (`src/pagination/report.ts`, `toFamilyReport`),
   * are returned by `ok(buildReport({...}))` — `src/tools/
   * pagination.ts:785`. `checked` counts ASSERTIONS ABOUT A NUMBER (not
   * frames) and explicitly walks pages, including master pages (tool
   * description, `src/tools/pagination.ts:600-602`) — exactly what brief
   * BD describes: "computed by pagination_audit, which walks pages,
   * including master pages". After task A, `configs/example-book.json` carries
   * `folio`/`runningHead` in the CORRECT object shape (`{styleName}`/
   * `{styleNames}`), so these two passes no longer fail with an empty
   * shape (docs/measured-facts-cli.md §4.1). The actual values 131/50
   * will be verified by a SECOND live run — this is only the address.
   */
  адреса("folios", 131, "pagination", ["folio", "checked"]),
  адреса("runningHeads", 50, "pagination", ["runningHead", "checked"]),

  /*
   * The same `checked`, family `contents` (`PaginationReport.contents.
   * checked`) — the ADDRESS is real (the field exists in the response
   * schema via the same `toFamilyReport`), but `configs/example-book.json` does
   * NOT declare the `contents` family (there's no `pagination.contents`
   * key — only `folio`/`runningHead`/`headingStyles`). So
   * `PaginationReport.contents` will be `null` (the family was "not
   * asked for", not "empty" — `toFamilyReport(null) → null`). This is
   * NOT the same state as "no address" above (B3) — the address exists,
   * this edition's config simply doesn't request this subfamily.
   *
   * F7/R34 (updated): the non-declaration is now DELIBERATE and recorded
   * in the config itself — `pagination.contents.notApplicable` (task F2,
   * ruling R29). So this number no longer fails with "NOT FOUND" every
   * time: `свідомийПропуск` (deliberateSkip) below reads the config,
   * sees the declared reason, prints it verbatim, and doesn't count it
   * as a discrepancy. Remove the declaration from the config and it will
   * immediately return to being a discrepancy: there's a single basis
   * for the omission, and it lives in the config.
   */
  адреса("contentsNumbers", 35, "pagination", ["contents", "checked"]),

  /*
   * C3 (task C, run in parallel): `ExtrasMeasure.sequences[0].found` —
   * how many paragraphs of style "Нумерація питань" were found (not
   * parsed, not breaks — specifically `found`, `src/cli/measure/
   * extras.ts`). A single array entry, because the config has one rule
   * in `sequences.rules[]` (`configs/example-book.json`). Pass id "extras" (not
   * "sequences" — task C merges both families into ONE pass
   * `__cli_extras` under id "extras", `src/cli/run/plan.ts`,
   * `mergeCliExtras`; task C report,
   * `.superpowers/sdd/2026-08-16-preflight-cli/task-C-report.md`).
   */
  адреса("questionNumbers", 185, "extras", ["sequences", 0, "found"]),

  /* Given by the brief: LanguageTally.words (`src/spelling/types.ts:110`) —
   * "weight is counted in WORDS (splitWords)". `otherFields.languages`
   * in `src/tools/spelling.ts:303` (`languages: collected.languages`).
   * NOTE: `data.words` AT THE TOP LEVEL of the spelling pass is a
   * DIFFERENT field (`SpellingReport.words: WordTypeFinding[]`, a
   * budget-truncated list of word TYPES, not a number,
   * `src/spelling/report.ts:203`); this exact confusion is what the old
   * bug caught — the deep traversal hit "words" even EARLIER, in
   * "overview". */
  адреса("words", 31412, "spelling", ["languages", 0, "words"]),

  /* Given by the brief: SpellingReport.wordTypesTotal = sorted.length
   * (`src/spelling/report.ts:203`), `ok({...buildReport(...)})` —
   * `src/tools/spelling.ts:320-323`. */
  адреса("unknownWordTypes", 497, "spelling", ["wordTypesTotal"]),

  /*
   * ExtrasMeasure.emptyParagraphs — a mandatory top-level field
   * (`src/cli/measure/extras.ts`), pass "extras".
   *
   * RULING R43: the control number 398 → 416, and the derivation is
   * recorded, not fudged. 416 = 398 + 18 blank lines inside the table-
   * of-contents frames (style «Зміст Підрозділ»). Basis: the CLI
   * traversal deliberately walks ALL stories, and an empty paragraph in
   * the table of contents is still an empty paragraph.
   *
   * 398 is kept here as what the original measurement found, and how it
   * differs: if that measurement DELIBERATELY excluded the table-of-
   * contents blank lines (they're an intentional layout device), then
   * 416 will always look worse than reality — and the reader can
   * subtract these 18, since exactly which ones and where is named here.
   */
  адреса("emptyParagraphs", 416, "extras", ["emptyParagraphs"]),

  /* ExtrasMeasure.forcedBreaks.{total,inBodyText} — the same pass.
   * Task A fixed `configs/example-book.json`'s `extras.bodyTextStyles` and
   * measured EXACTLY 27 for inBodyText with both body styles combined
   * (brief BD, section "What just landed"). */
  адреса("forcedBreaksTotal", 401, "extras", ["forcedBreaks", "total"]),
  адреса("forcedBreaksInBody", 27, "extras", ["forcedBreaks", "inBodyText"]),
];

/** A single table entry with an explicit address (pass + path). */
function адреса(назва, очікувано, прохід, шлях) {
  return { вид: "адреса", назва, очікувано, прохід, шлях };
}

/**
 * H2. The address is at the ROOT of `measurements.json`, not inside a
 * pass.
 *
 * `overset` doesn't belong to any pass: it's computed by
 * `oversetЗВимірів()` from `preflight.findings` after all measurements
 * are done, and placed as a top-level field (`schemaVersion: 3`). The
 * computation is NOT duplicated — it counts the same place as before
 * (lesson R22: a counter computed twice eventually diverges); the only
 * change is that the result now survives into the artifact, and §4.2
 * names the artifact as the sole thing two runs are compared against.
 */
function адресаКореня(назва, очікувано, шлях) {
  return { вид: "корінь", назва, очікувано, прохід: null, шлях };
}

/**
 * H3. A named COUNTER over an array — and why this isn't a return to R26.
 *
 * R26 forbade looking up a number BY key NAME while traversing all
 * passes: a name addresses nothing, and the collision ("words" in two
 * passes with different values) is irreparable in principle. Here the
 * address remains an address — the pass and path are named exactly, as
 * in `адреса()` (address()) — it's just that the path ends in an array,
 * and the entry says WHICH field and WHICH value to count it by. Nothing
 * is guessed and nothing is looked up: `field` and `value` are named
 * right here, not derived from similarity.
 *
 * Generality is deliberately stopped exactly here (brief H3: "don't
 * build a query language"): a single "field === value" predicate, with
 * no operators, no nesting, no OR.
 */
function лічильник(назва, очікувано, прохід, шлях, поле, значення) {
  return { вид: "лічильник", назва, очікувано, прохід, шлях, поле, значення };
}

/**
 * H4 / ruling R42, THIRD state: CAPABILITY GAP.
 *
 * This is neither "no address found" nor "deliberately not requested":
 * NO pass measures this number at all. The state is deliberately
 * separate — R34/R42 require distinguishing a deliberate omission, a
 * lost measurement, and a capability gap, and until now the gap printed
 * under the same "NO ADDRESS" as an address that just wasn't derived,
 * i.e. it read as a script shortcoming rather than a limit of the
 * instrument.
 *
 * Counted SEPARATELY from discrepancies and doesn't trip the gate: this
 * can't be fixed inside the regression — it needs a new measurement in
 * the tool. But it can't be silent either: a control number from the
 * spec remains unmeasured.
 */
function діркаСпроможності(назва, очікувано, причина, межа) {
  return { вид: "дірка", назва, очікувано, прохід: null, шлях: null, причина, межа };
}

const шлях = process.argv[2];
if (шлях === undefined) {
  console.error("Вжиток: node scripts/regression-book.mjs <measurements.json> [конфіг.json]");
  process.exit(2);
}

const m = JSON.parse(readFileSync(шлях, "utf8"));

/* ==========================================================================
 * F7 / ruling R34: "deliberately not declared" is NOT "should exist and
 * doesn't".
 *
 * One control number — `contentsNumbers` = 35 — has a REAL address
 * (`pagination.contents.checked`), but it will NEVER be measured: ruling
 * R29 deliberately does not declare the `contents` subfamily (there's no
 * honest way to match table-of-contents levels in this layout; all 35
 * numbers are automatic anyway). Meaning the regression would fail
 * ALWAYS — and spec §6.4 names this directly: "a gate that's always red
 * is not a gate."
 *
 * THE SOURCE OF TRUTH FOR THE DIFFERENCE IS THE CONFIG ITSELF, not a
 * list in this script. After F2 it holds `"pagination": { "contents": {
 * "notApplicable": "…" } }`, and the script prints exactly that reason,
 * verbatim.
 *
 * WHERE THE CONFIG COMES FROM. As the second argument, and absent that —
 * `configs/example-book.json` NEXT TO THE SCRIPT ITSELF (not next to
 * `measurements.json`). Reason: this script is named `-maaam` and it
 * holds the control table for exactly one edition — that edition's
 * config lives in the same repository at a fixed path.
 * `measurements.json`, on the other hand, is written wherever the
 * operator points it (`--measurements`), and there may be no config next
 * to it at all.
 * ========================================================================== */

const шляхКонфіга =
  process.argv[3] ?? fileURLToPath(new URL("../configs/example-book.json", import.meta.url));

let конфіг = null;
let бідаЗКонфігом = null;
try {
  конфіг = JSON.parse(readFileSync(шляхКонфіга, "utf8"));
} catch (e) {
  бідаЗКонфігом = e instanceof Error ? e.message : String(e);
}

/** The same predicate as `isNotApplicable` in `src/cli/config/schema.ts`. */
function незастосовна(v) {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof v.notApplicable === "string" &&
    v.notApplicable.trim().length > 0
  );
}

/**
 * Whether the config declares that this number is NOT measured — and if
 * so, exactly where and why. `null` means "no basis to skip": then the
 * number is compared as usual, and a missing value stays a
 * DISCREPANCY.
 *
 * Two bases, both read from the very same address the control number
 * itself carries (task B): the pass identifier is the family name, and
 * the first step of the path inside the data is the subfamily name.
 *
 * THERE IS DELIBERATELY NO THIRD BASIS. The temptation is this:
 * `questionNumbers` lives on pass `extras` at path
 * `sequences[0].found`, so its TRUE family is `sequences` (both merged
 * into one pass, C1/R25). A rule of "the first path step names ANOTHER
 * family" would cover this case too — but it would also skip any field
 * whose name happens to collide with a family name. The cost of error
 * here is asymmetric (R34): too broad a skip HIDES a real lost
 * measurement, while too narrow a skip merely leaves a loud discrepancy
 * that a human will see. So: narrower.
 */
function свідомийПропуск(запис) {
  if (конфіг === null || запис.прохід === null) return null;
  const родини = конфіг.families;
  if (typeof родини !== "object" || родини === null) return null;

  const родина = родини[запис.прохід];
  if (родина === undefined) return null;
  if (незастосовна(родина)) {
    return { де: запис.прохід, причина: родина.notApplicable };
  }

  const підродина = запис.шлях[0];
  if (typeof підродина !== "string" || typeof родина !== "object" || родина === null) return null;
  if (незастосовна(родина[підродина])) {
    return { де: `${запис.прохід}.${підродина}`, причина: родина[підродина].notApplicable };
  }
  return null;
}

console.log("=== СТАН ДОКУМЕНТА, ЩО ВИМІРЯНО ===");
console.log(`Документ:            ${m.stamp.docName}`);
console.log(`Уже був відкритий:   ${m.stamp.wasAlreadyOpen ? "ТАК" : "ні"}`);
console.log(`Незбережені правки:  ${m.stamp.modified ? "ТАК" : "ні"}`);
console.log(`InDesign:            ${m.stamp.indesignVersion}, локаль ${m.stamp.locale}`);
console.log("");
if (m.stamp.modified) {
  console.log("УВАГА: документ має незбережені правки. Горизонтальних масштабів ≠ 100");
  console.log("буде 0, а не 66 — це НЕ розбіжність регресії, а інший стан документа.");
  console.log("");
}

let розбіжностей = 0;
let свідомихПропусків = 0;
/* R42, third state — counted separately from both of the previous ones. */
let дірокСпроможності = 0;
console.log("=== ЗВІРКА (за адресою: прохід.шлях, не за назвою) ===");
if (бідаЗКонфігом !== null) {
  /* Silence here would be the worst outcome: an unread config would
   * simply cancel every deliberate omission, and the "always red"
   * regression would come back with no explanation at all. */
  console.log(`УВАГА: конфіг «${шляхКонфіга}» не прочитано (${бідаЗКонфігом}).`);
  console.log("Свідомих пропусків не буде — кожне число звіряється, як до R34.");
  console.log("");
}
for (const запис of КОНТРОЛЬНІ) {
  const { назва, очікувано } = запис;
  const пропуск = свідомийПропуск(запис);
  if (пропуск !== null) {
    /*
     * R34: this does NOT count as a discrepancy — the measurement wasn't
     * lost, it was deliberately not requested. The reason is printed
     * VERBATIM from the config: otherwise the reader would have to take
     * the script's word for it.
     */
    свідомихПропусків++;
    console.log(
      `⊘ ${назва.padEnd(22)} очікувано ${String(очікувано).padStart(6)}  СВІДОМО НЕ ОГОЛОШЕНО (${пропуск.де})`,
    );
    console.log(`    причина з конфіга: ${пропуск.причина}`);
    continue;
  }
  if (запис.вид === "дірка") {
    /*
     * H4/R42: third state. Does NOT count as a discrepancy — it can't be
     * fixed inside the regression, it needs a new measurement in the
     * tool. But it can't be silent either: a control number from the
     * spec remains unmeasured, and the reader must see this every run.
     */
    дірокСпроможності++;
    console.log(
      `◐ ${назва.padEnd(22)} очікувано ${String(очікувано).padStart(6)}  НЕ МІРЯЄ ЖОДЕН ПРОХІД — ${запис.причина}`,
    );
    console.log(`    ${запис.межа}`);
    continue;
  }
  const факт =
    запис.вид === "корінь"
      ? знайтиВКорені(m, запис)
      : запис.вид === "лічильник"
        ? порахувати(m, запис)
        : знайти(m, запис);
  const знайдено = факт !== undefined;
  const збіг = знайдено && факт === очікувано;
  if (!збіг) розбіжностей++;
  const адресаТекст =
    запис.вид === "корінь"
      ? `корінь.${запис.шлях.join(".")}`
      : запис.вид === "лічильник"
        ? `${запис.прохід}.${запис.шлях.join(".")}[${запис.поле}=${запис.значення}]`
        : `${запис.прохід}.${запис.шлях.join(".")}`;
  const фактТекст = знайдено ? String(факт).padStart(6) : "НЕ ЗНАЙДЕНО".padStart(11);
  console.log(
    `${збіг ? "✓" : "✗"} ${назва.padEnd(22)} очікувано ${String(очікувано).padStart(6)}  фактично ${фактТекст}  (${адресаТекст})`,
  );
}

console.log("");
/*
 * R34: the summary names BOTH numbers separately, and the exit code is
 * computed ONLY from discrepancies. Collapsing them into one number
 * would mean either leaving the gate red forever (treating an omission
 * as a discrepancy) or hiding a real lost measurement behind the word
 * "omission" (treating a discrepancy as an omission).
 *
 * THREE NUMBERS KEPT SEPARATE, BECAUSE THEY ARE THREE DIFFERENT STATES
 * (R34/R42), and collapsing them into one would ruin each: a deliberate
 * omission counted as a discrepancy would leave the gate red forever; a
 * discrepancy counted as an omission would hide a real lost
 * measurement; a capability gap dumped into either pile would read as a
 * shortcoming that someone could "fix" here — but there's nowhere to
 * fix it, it needs a new measurement in the tool.
 *
 * WHAT TASKS H2-H4 CHANGED. Before them, exit code 0 was UNREACHABLE:
 * three numbers (`linksNormal`, `maxTac`, `overset`) had no address and
 * counted as discrepancies. Now `overset` lives as a top-level field
 * (H2), `linksNormal` is computed by a named counter at an exact
 * address (H3), and `maxTac` is recognized as a capability gap (H4) —
 * it doesn't trip the gate, but it's printed every run. So zero became
 * reachable, and that is the actual change: a gate that can never go
 * dark is not a gate (§6.4).
 */
const підсумокПропусків =
  `свідомих пропусків ${свідомихПропусків}, дірок спроможності ${дірокСпроможності}`;
if (розбіжностей === 0) {
  console.log(`РЕГРЕСІЯ: ПРОЙШЛА — розбіжностей 0, ${підсумокПропусків}.`);
  process.exit(0);
}
console.log(`РЕГРЕСІЯ: ВПАЛА — розбіжностей ${розбіжностей}, ${підсумокПропусків}.`);
process.exit(1);

/**
 * Fetches a value by its EXPLICIT address (pass + path) — no lookup by
 * key name. `undefined` means the address doesn't resolve (the pass is
 * missing, it's not `ok`, the data is `null`, or some path step hits
 * `null`/`undefined`/a primitive): this is a DISCREPANCY, not 0 and not
 * silence (R26 — an error must be loud).
 */
/** Walks the path. `undefined` means it broke off, and the reason doesn't matter. */
function пройтиШлях(вузол, шлях) {
  for (const крок of шлях) {
    if (вузол === null || typeof вузол !== "object") return undefined;
    вузол = вузол[крок];
  }
  return вузол;
}

/** The pass's data, or `undefined` if the pass is missing or failed. */
function даніПроходу(m, прохід) {
  const p = m.passes.find((p) => p.id === прохід);
  if (!p || !p.ok || p.data === null || p.data === undefined) return undefined;
  return p.data;
}

function знайти(m, { прохід, шлях }) {
  const дані = даніПроходу(m, прохід);
  if (дані === undefined) return undefined;
  const вузол = пройтиШлях(дані, шлях);
  return typeof вузол === "number" ? вузол : undefined;
}

/**
 * H2: a value from the ROOT of the measurements. The field holds a
 * display string, so a canonical integer in string form ("0") becomes a
 * number, but anything else ("н/д"/"n/a", "—") does NOT: it goes into
 * the discrepancy and prints as-is. Silently converting a non-numeric
 * display into zero would be exactly the substitution of "not measured"
 * for "clean" that R46 stands against.
 */
function знайтиВКорені(m, { шлях }) {
  const вузол = пройтиШлях(m, шлях);
  if (typeof вузол === "number") return вузол;
  if (typeof вузол === "string" && /^\d+$/.test(вузол)) return Number(вузол);
  /* A non-numeric display is returned AS-IS — so it prints verbatim
   * ("н/д"/"n/a") and explains itself, rather than hiding behind
   * "NOT FOUND". */
  return вузол;
}

/**
 * H3: how many entries of the array at the address have
 * `field === value`. `undefined` means the address didn't lead to an
 * array; this is a DISCREPANCY, not zero: an empty array and a missing
 * array are different things, and returning 0 for both would mean
 * saying "no NORMAL at all" where in fact "the links were never read".
 */
function порахувати(m, { прохід, шлях, поле, значення }) {
  const дані = даніПроходу(m, прохід);
  if (дані === undefined) return undefined;
  const вузол = пройтиШлях(дані, шлях);
  if (!Array.isArray(вузол)) return undefined;
  let n = 0;
  for (const запис of вузол) {
    if (запис !== null && typeof запис === "object" && запис[поле] === значення) n++;
  }
  return n;
}

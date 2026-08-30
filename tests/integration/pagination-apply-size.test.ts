import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerPaginationTools } from "../../src/tools/pagination.js";
import type { Tools } from "../../src/tools/shared.js";
import { assertFixtureActive, closeFixtureDoc, makePaginationFixtureDoc } from "./fixture-doc.js";

/*
 * ОБСЯГ ВІДПОВІДІ `pagination_apply` — СТОРОЖ, А НЕ ФОРМАЛЬНІСТЬ.
 *
 * Фаза 4 одного разу вивела інструмент з ладу відповіддю на 78 КБ: не
 * помилкою, а розміром. Це не теоретичний ризик, і `pagination_apply`
 * ризикованіший за `pagination_audit` — у нього три канали, що ростуть із
 * КІЛЬКІСТЮ РАМОК, а не з кількістю видів дефекту:
 *
 *   `skipped`     — зведено за причиною, стеля сторінок `MAX_GROUP_PAGES`;
 *   `willWrite`   — ПО ЗАПИСУ НА КОЖНУ придатну рамку, не зведено ніяк;
 *   `diffs`       — вимір «до» і «після» на мокрому прогоні.
 *
 * ПОРІГ БЕРЕТЬСЯ З ВИМІРУ, А НЕ ЗІ СТЕЛІ. Фаза 5 двічі за одну фазу поставила
 * поріг стелею (64 000 Б проти реальних ~6 750), і такий тест проходив
 * однаково із захистом і без нього — тобто не захищав нічого.
 *
 * ЧЕСНА МЕЖА ЦЬОГО ЧИСЛА: воно виміряне на ФІКСТУРІ (25 сторінок, 19
 * вердиктів, з них 4 придатні), а не на робочій книжці (196 сторінок, 160
 * рамок колонцифри — і 91 придатна там, тобто `willWrite` довший у 23 рази). На
 * книжці `willWrite` і `skipped` більші, і чекати від цього тесту, що він
 * упіймає перевищення ТАМ, не можна. Він ловить інше й достатньо цінне:
 * зростання, яке додає задача, — бо на тому самому вході число мусить лишитись
 * тим самим. Робочу книжку тут не міряв ніхто навмисно: вона доступна лише для
 * читання, і відкривати її заради числа задача не має права.
 *
 * ЩО РОБИТИ ПРИ ПЕРЕВИЩЕННІ. НЕ піднімати число мовчки — саме мовчазне
 * підняття перетворює сторожа на печатку. Порядок той самий, що застосували до
 * `MAX_PREFLIGHT_OCCURRENCES`: пояснити, ЩО саме додало байти, і або звести
 * новий канал (як `groupSkipped` звів пропуски за причиною, а Фаза 6 звела
 * однакові знахідки в один рядок — на книжці 33 437 → 733 Б), або підняти поріг
 * РАЗОМ із виміром і назвати нове число в коментарі нижче.
 */

const PARAMS = {
  folioStyles: ["Kolontsyfra"],
  contentsNumberStyle: "Zmist Cyfra",
  contentsTitleStyles: ["Zmist Rozdil"],
  headingStyles: ["Zagolovok"],
};

/*
 * ПОРІГ — ≈2× ВІД ВИМІРЯНОГО МАКСИМУМУ, і обидва числа стоять поруч навмисно.
 *
 * Виміряно 2026-08-08 цим самим тестом, на фікстурі Задачі 11Б:
 *
 *   сухий прогін `replace-literals` (skipped + willWrite)     2 708 Б
 *   мокрий прогін `replace-literals` (skipped + diffs)        2 123 Б
 *   сухий прогін `create-helper-thread` (skipped + helper)    2 296 Б
 *                                                            -------
 *   МАКСИМУМ                                                  2 708 Б
 *
 * ПЕРЕМІРЯНО 2026-08-08 (Задача 11Д), і числа РОЗІЙШЛИСЯ з записаними:
 *
 *   сухий прогін `replace-literals`                           1 925 Б
 *   мокрий прогін `replace-literals`                          1 943 Б
 *   сухий прогін `create-helper-thread`                       2 291 Б
 *                                                            -------
 *   МАКСИМУМ                                                  2 291 Б
 *
 * Із цих 1 925 Б **53 Б додала сама Задача 11Д** — `resolvedBy` у кожній правці
 * `willWrite` і лічильник `resolvedByHelper` (виміряно: той самий тест на
 * `aad0ce5` без правки дав 1 872 Б). Решта розбіжності з 2 708 Б стара, і
 * ПРИЧИНИ ЇЇ Я НЕ МІРЯВ: записані числа старші за Задачі 11В і 11Г, які міняли
 * саме те, скільки рамок фікстури виходить придатними, — а `willWrite` росте
 * з їхньою кількістю. Називати це поясненням без прогону на тому коміті було б
 * здогадом; тут лишається сам факт.
 *
 * Поріг не рухаю: 5 400 Б стереже КЛАС аварії (зростання в рази), і від
 * зменшення виміряного максимуму він не слабшає — навпаки, запас став 2,36×.
 * Мовчазне ж підняття порога заборонене нижче, і мовчазне лишання застарілого
 * ВИМІРУ в коментарі — та сама вада: сторож перетворюється на печатку.
 *
 * Поріг 5 400 Б = 1,99× від максимуму НА МОМЕНТ ЗАПИСУ. Саме МАКСИМУМ, а не сума: канали не
 * складаються — кожен виклик віддає одну відповідь, і сторож мусить бути один
 * на всі три, інакше найтонший із них ставав би найслабшою ланкою мовчки.
 *
 * ЗАПАС ТУТ ШИРШИЙ, НІЖ У `pagination_audit` (там 1,17× при 7 700 Б), і це
 * різниця вхідних, а не смаку: обсяг аудиту росте з кількістю ВИДІВ дефекту, і
 * кожна нова група додає власний `example` — тобто зростання там ступінчасте й
 * велике. Тут обсяг росте з кількістю РАМОК, а їх у фікстурі фіксована
 * кількість, тож 2× — це запас саме на нове ПОЛЕ у відповіді, а не на новий
 * стан фікстури.
 */
const MAX_RESPONSE_BYTES = 5_400;

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
type ApplyArgs = Record<string, unknown>;

let docName: string;
let dir: string;
let home: string;

function applyHandler(): (a: ApplyArgs) => Promise<ToolResult> {
  let captured: ((a: ApplyArgs) => Promise<ToolResult>) | null = null;
  const fake = {
    registerTool(name: string, _cfg: unknown, h: (a: ApplyArgs) => Promise<ToolResult>) {
      if (name === "pagination_apply") captured = h;
    },
  } as unknown as Tools;
  registerPaginationTools(fake);
  if (!captured) throw new Error("pagination_apply не зареєстровано");
  return captured;
}

/**
 * Міряється РІВНО ТОЙ РЯДОК, що їде клієнтові, а не `JSON.stringify` заново
 * розібраного об'єкта: між ними різниця в пробілах, і саме перший визначає,
 * влізе відповідь у контекст чи ні.
 */
async function applySize(args: ApplyArgs): Promise<{ size: number; body: string }> {
  await assertFixtureActive(docName);
  const res = await applyHandler()({
    folio: { styleNames: PARAMS.folioStyles, range: "backward" },
    expectedDocName: docName,
    ...args,
  });
  if (res.isError) throw new Error(`pagination_apply відмовився: ${res.content[0]!.text}`);
  return { size: res.content[0]!.text.length, body: res.content[0]!.text };
}

describe("обсяг відповіді pagination_apply", () => {
  /*
   * ФІКСТУРА СВІЖА НА КОЖЕН ТЕСТ, а не одна на всі три. Мокрий прогін
   * ЗАМІНЯЄ літерали, тобто наступний виклик на тому самому документі мав би
   * вже інший вхід (майже все — `alreadyAutomatic`), і виміряні числа
   * залежали б від порядку тестів. Сторож обсягу, чиє число залежить від
   * порядку, не сторож.
   */
  beforeEach(async () => {
    /* Скидання назви й `finally` на теки — з тієї самої причини, що в
     * `pagination-apply.test.ts`. */
    docName = "";
    dir = await mkdtemp(join(tmpdir(), "idmcp-pgn-size-"));
    home = await mkdtemp(join(tmpdir(), "idmcp-plans-size-"));
    process.env.INDESIGN_MCP_HOME = home;
    docName = await makePaginationFixtureDoc(dir);
    await assertFixtureActive(docName);
  }, 300_000);

  afterEach(async () => {
    delete process.env.INDESIGN_MCP_HOME;
    try {
      if (docName) await closeFixtureDoc(docName);
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  }, 120_000);

  it("сухий прогін replace-literals — найбільший канал, і він у межах порога", async () => {
    const { size, body } = await applySize({ operation: "replace-literals", route: "helper" });
    console.log(`  сухий прогін replace-literals: ${size} Б`);

    /*
     * НЕ ВАКУУМ, І ЦЕ ПЕРЕВІРЯЄТЬСЯ, А НЕ ОБІЦЯЄТЬСЯ. Відповідь мусить
     * СПРАВДІ нести обидва канали, що ростуть: інакше поріг стеріг би порожню
     * відповідь, і мутант «не віддавати skipped» проходив би зеленим просто
     * тому, що став МЕНШИМ.
     */
    const parsed = JSON.parse(body) as {
      skipped: { reason: string; count: number }[];
      willWrite: unknown[];
    };
    expect(parsed.skipped.length).toBeGreaterThan(0);
    expect(parsed.willWrite.length).toBeGreaterThan(0);

    expect(size).toBeLessThan(MAX_RESPONSE_BYTES);
  }, 180_000);

  it("ЗВЕДЕННЯ skipped за причиною справді відбувається — поріг цього не бачить", async () => {
    /*
     * ЗНАХІДКА ПРО САМ ТЕСТ, ВІДТВОРЕНА МУТАНТОМ, А НЕ ПРИПУЩЕНА.
     *
     * Крок 3 задачі вимагав довести, що поріг вище не вакуумний: прибрати
     * зведення `skipped` за причиною й переконатись, що тест ПАДАЄ. Прибрав
     * (по групі на кожен вердикт замість групи на причину) — і тест ПРОЙШОВ.
     * Виміряно на фікстурі: 2 708 → 3 561 Б, тобто +853 Б, +31 %. Зростання
     * справжнє, але до порога 5 400 Б йому далеко.
     *
     * І це не вада порога, а його межа, названа вголос. Поріг у 2× стереже
     * КЛАС аварії Фази 4 (відповідь на 78 КБ) — зростання в рази. Втрату
     * зведення на фікстурі з 19 вердиктів він упіймати не може В ПРИНЦИПІ:
     * зведення тут економить 15 записів проти 8, а на робочій книжці
     * економило б 91 проти 8 — саме там воно й коштує, і саме там його
     * втрату видно розміром. Опустити поріг до 1,2×, щоб цей мутант помер,
     * означало б зробити його таким, що його доводиться піднімати щозадачі,
     * тобто перетворити сторожа на печатку.
     *
     * Отже зведення стережеться ВЛАСТИВІСТЮ, а не байтами. Ця перевірка
     * мутанта вбиває, і вбиває однаково при будь-якому розмірі фікстури.
     */
    const { body } = await applySize({ operation: "replace-literals", route: "helper" });
    const skipped = (JSON.parse(body) as { skipped: { reason: string; count: number }[] }).skipped;

    /* Одна група на причину — рівно те, що робить `groupSkipped`. */
    const reasons = skipped.map((g) => g.reason);
    expect(new Set(reasons).size).toBe(reasons.length);

    /*
     * І ЗВЕДЕННЯ МУСИТЬ БУТИ НЕПОРОЖНІМ: якби кожна причина трапилась рівно
     * раз, рівність вище справджувалась би й БЕЗ зведення. На фікстурі
     * `oracle-mismatch` має 6 вердиктів — саме ця група й доводить, що
     * кілька вердиктів справді злилися в один рядок.
     */
    expect(skipped.some((g) => g.count > 1)).toBe(true);

    /* Сума груп дорівнює кількості непридатних — жоден вердикт не загублено
     * заради стислості (те саме рівняння, що стереже `reconciliation`). */
    const parsed = JSON.parse(body) as { total: number; eligible: number };
    expect(skipped.reduce((s, g) => s + g.count, 0)).toBe(parsed.total - parsed.eligible);
  }, 180_000);

  it("мокрий прогін replace-literals — канал diffs теж у межах", async () => {
    const { size, body } = await applySize({
      operation: "replace-literals",
      route: "helper",
      dryRun: false,
    });
    console.log(`  мокрий прогін replace-literals: ${size} Б`);

    /* Записано справді, інакше «мокрий» вимір був би сухим під іншою назвою. */
    const parsed = JSON.parse(body) as { applied: number; skipped: unknown[] };
    expect(parsed.applied).toBeGreaterThan(0);
    expect(parsed.skipped.length).toBeGreaterThan(0);

    expect(size).toBeLessThan(MAX_RESPONSE_BYTES);
  }, 300_000);

  it("сухий прогін create-helper-thread — друга операція теж під сторожем", async () => {
    /*
     * ДРУГА ОПЕРАЦІЯ МІРЯЄТЬСЯ ОКРЕМО: у неї власний блок `helper` і власний
     * `message`, тобто зростання тут не видно з першого тесту взагалі.
     */
    const { size, body } = await applySize({ operation: "create-helper-thread" });
    console.log(`  сухий прогін create-helper-thread: ${size} Б`);

    const parsed = JSON.parse(body) as { skipped: unknown[]; dryRun: boolean };
    expect(parsed.dryRun).toBe(true);
    expect(parsed.skipped.length).toBeGreaterThan(0);

    expect(size).toBeLessThan(MAX_RESPONSE_BYTES);
  }, 180_000);
});

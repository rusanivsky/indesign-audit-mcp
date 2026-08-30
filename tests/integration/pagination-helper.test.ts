import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runJsx } from "../../src/bridge/runner.js";
import { runWrite } from "../../src/bridge/envelope.js";
import { APPLY_TIMEOUT_MS } from "../../src/tools/corrections.js";
import type { PaginationMeasure } from "../../src/pagination/types.js";
import { assertFixtureActive, closeFixtureDoc, makePaginationFixtureDoc } from "./fixture-doc.js";

/*
 * СЛУЖБОВИЙ ЛАНЦЮЖОК (спек §4.2, §4.8) — і головне тут ОДНЕ ТВЕРДЖЕННЯ:
 *
 *   рамка створюється на КОЖНІЙ сторінці діапазону, а не лише на тих, де є
 *   колонцифра.
 *
 * ЦЕ НЕ ОБЕРЕЖНІСТЬ, А ВИМІР (Питання 18, 2026-08-08). Маркер друкує сторінку
 * ПОПЕРЕДНЬОЇ РАМКИ ЛАНЦЮЖКА, а не «поточна мінус один»: над ланцюжком лише з
 * непарних сторінок мітка на с. 3 надрукувала «1», на с. 5 — «3», на с. 7 —
 * «5». Усі 91 колонцифра робочої книжки стоять на recto, тож за правилом
 * «рамка там, де є колонцифра» ланцюжок ліг би на непарні, і с. 97 надрукувала
 * б «95–97». 91 брехливий маркер із 91, і кожен на вигляд правильний — тобто
 * рівно той режим відмови, який §3 називає гіршим за ручне число.
 *
 * Тому сторож нижче звіряє ланцюжок НЕ зі звіту обробника, а з самого
 * документа: `parentStory.textContainers` прочитані назад, по одному
 * контейнеру на КОЖНУ сторінку, у порядку сторінок. Звіт обробника — його
 * власне твердження про себе; документ — факт.
 *
 * БЕЗПЕКА — той самий режим, що в `pagination-apply.test.ts`: документ лише
 * через `__fixture_make_pagination`, `assertFixtureActive` перед кожним
 * записом, `expectedDocName` у кожному виклику, `afterEach` закриває фікстуру
 * навіть після падіння.
 */

const PARAMS = {
  folioStyles: ["Kolontsyfra"],
  contentsNumberStyle: "Zmist Cyfra",
  contentsTitleStyles: ["Zmist Rozdil"],
  headingStyles: ["Zagolovok"],
};

const LAYER = "_folio-helper";

interface HelperFrameReport {
  page: string;
  offset: number;
  frameId: string;
  /** Звідки взято прямокутник: з рамки колонцифри чи з меж самої сторінки. */
  source: "folio" | "page";
  folioFrameId: string | null;
}

interface HelperReport {
  docName: string;
  backupPath: string;
  layerName: string;
  layerCreated: boolean;
  layerFlagsBefore: { visible: boolean; printable: boolean } | null;
  created: number;
  frames: HelperFrameReport[];
  ignoredFolioFrames: { frameId: string; reason: string }[];
  oversetBefore: string[];
  oversetAfter: string[];
  pageCountBefore: number;
  pageCountAfter: number;
}

interface Bounds {
  y1: number;
  x1: number;
  y2: number;
  x2: number;
}

interface Inspection {
  pageNames: string[];
  layer: { exists: boolean; visible: boolean; printable: boolean; itemCount: number } | null;
  /** Скільки рамок службового шару лежить на кожній сторінці, у порядку сторінок. */
  perPage: number[];
  /** Назви сторінок контейнерів ланцюжка, у порядку самого ланцюжка. */
  chain: string[];
  frames: { page: string; bounds: Bounds; wrap: string; contents: string }[];
  /**
   * Межі рамок колонцифри, прочитані В ТОМУ САМОМУ ВИКЛИКУ, що й службові.
   *
   * ОДИНИЦІ — ЦЕ НЕ ПЕДАНТИЗМ, А ПРИЧИНА, ЧОМУ ЦЕ ПОЛЕ ТУТ. `pagination_measure`
   * фіксує міліметри на час виміру, а `run_script` читає в одиницях лінійки
   * документа (у фікстури — пункти): та сама рамка віддає 700 і 246,94.
   * Порівнювати вимір із виміром різних приладів не можна, тож обидві сторони
   * читаються одним.
   */
  folioBounds: { [id: string]: Bounds };
}

let docName: string;
let dir: string;

async function measure(): Promise<PaginationMeasure> {
  await assertFixtureActive(docName);
  return runJsx<PaginationMeasure>("pagination_measure", PARAMS, { timeoutMs: 180_000 });
}

async function runScript<T>(script: string): Promise<T> {
  await assertFixtureActive(docName);
  return runJsx<T>("run_script", { script, undoName: "Тест: підготовка/огляд" }, {
    timeoutMs: 60_000,
  });
}

async function create(params: Record<string, unknown> = {}): Promise<HelperReport> {
  await assertFixtureActive(docName);
  return runWrite<HelperReport>({
    handler: "pagination_create_helper_thread",
    params: {
      expectedDocName: docName,
      stamp: "2026-08-08-1200",
      undoName: "Тест: службовий ланцюжок",
      ...params,
    },
    timeoutMs: APPLY_TIMEOUT_MS,
  });
}

/**
 * ЧОМУ ФІКСТУРУ ДОВОДИТЬСЯ ГОТУВАТИ. Вона навмисно містить стан
 * `folio-helper-layer-hidden`: шар `_folio-helper` уже є, ПРИХОВАНИЙ, і на
 * ньому лежить чужий ланцюжок із двох рамок. Це другий рядок таблиці §4.9 і
 * прибирати його з фікстури не можна. Тому тести happy-path прибирають самі
 * РАМКИ (шар лишається — на ньому й перевіряється повернення прапорців), а
 * окремий тест перевіряє, що на НЕЗАЙМАНІЙ фікстурі обробник відмовляється.
 */
async function clearHelperItems(): Promise<number> {
  return runScript<number>(
    `var doc = app.activeDocument;
     var n = 0;
     var lay = doc.layers.itemByName(${JSON.stringify(LAYER)});
     if (lay.isValid) {
       var items = lay.pageItems;
       for (var i = items.length - 1; i >= 0; i--) { items[i].remove(); n++; }
     }
     __result = n;`,
  );
}

async function removeHelperLayer(): Promise<boolean> {
  return runScript<boolean>(
    `var doc = app.activeDocument;
     var lay = doc.layers.itemByName(${JSON.stringify(LAYER)});
     var had = lay.isValid;
     if (had) { var it = lay.pageItems; for (var i = it.length - 1; i >= 0; i--) it[i].remove(); lay.remove(); }
     __result = had;`,
  );
}

/**
 * Читання ФАКТУ з документа, незалежно від звіту обробника.
 *
 * Ланцюжок береться від рамки на ПЕРШІЙ сторінці: `textContainers` віддає
 * контейнери історії в порядку зшивання, тож саме тут видно і пропуск, і
 * порушений порядок, і незшиту рамку (вона дала б історію з одного
 * контейнера).
 */
async function inspect(folioIds: string[] = []): Promise<Inspection> {
  return runScript<Inspection>(
    `var doc = app.activeDocument;
     var out = { pageNames: [], layer: null, perPage: [], chain: [], frames: [], folioBounds: {} };
     var want = ${JSON.stringify(folioIds)};
     for (var q = 0; q < want.length; q++) {
       var it = doc.pageItems.itemByID(parseInt(want[q], 10));
       if (!it.isValid) continue;
       var gb = it.geometricBounds;
       out.folioBounds[String(want[q])] =
         { y1: Number(gb[0]), x1: Number(gb[1]), y2: Number(gb[2]), x2: Number(gb[3]) };
     }
     var lay = doc.layers.itemByName(${JSON.stringify(LAYER)});
     if (lay.isValid) {
       out.layer = {
         exists: true,
         visible: lay.visible === true,
         printable: lay.printable === true,
         itemCount: lay.pageItems.length
       };
     }
     var first = null;
     for (var p = 0; p < doc.pages.length; p++) {
       var page = doc.pages[p];
       out.pageNames.push(String(page.name));
       var here = 0;
       var frames = page.textFrames;
       for (var f = 0; f < frames.length; f++) {
         var lname = null;
         try { lname = String(frames[f].itemLayer.name); } catch (eL) { lname = null; }
         if (lname !== ${JSON.stringify(LAYER)}) continue;
         here++;
         if (first === null) first = frames[f];
         var g = frames[f].geometricBounds;
         out.frames.push({
           page: String(page.name),
           bounds: { y1: Number(g[0]), x1: Number(g[1]), y2: Number(g[2]), x2: Number(g[3]) },
           wrap: String(frames[f].textWrapPreferences.textWrapMode),
           contents: String(frames[f].contents)
         });
       }
       out.perPage.push(here);
     }
     if (first !== null) {
       var cs = first.parentStory.textContainers;
       for (var c = 0; c < cs.length; c++) {
         var pp = cs[c].parentPage;
         out.chain.push(pp === null || pp === undefined ? "(без сторінки)" : String(pp.name));
       }
     }
     __result = out;`,
  );
}

beforeEach(async () => {
  /* Скидання назви й `finally` на теку — з тієї самої причини, що в
   * `pagination-apply.test.ts`: створення могло дійти до `doc.save`, а міст
   * — здатися вже після нього. */
  docName = "";
  dir = await mkdtemp(join(tmpdir(), "idmcp-pgn-helper-"));
  docName = await makePaginationFixtureDoc(dir);
  await assertFixtureActive(docName);
}, 300_000);

afterEach(async () => {
  try {
    if (docName) await closeFixtureDoc(docName);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 120_000);

describe("pagination_create_helper_thread", () => {
  it("СТОРОЖ КОНТРАКТУ: рамка на КОЖНІЙ сторінці, ланцюжок суцільний і в порядку сторінок", async () => {
    /*
     * ЦЕ ГОЛОВНИЙ ТЕСТ ЗАДАЧІ. Він падає, щойно хтось звузить побудову до
     * «сторінок із колонцифрою» — тобто рівно до тієї конфігурації, яку
     * Питання 18 виміряло як брехливу.
     */
    await clearHelperItems();
    const before = await measure();
    const pageCount = before.pages.length;
    expect(pageCount).toBeGreaterThan(10);

    /* Рамок колонцифри у фікстурі помітно менше, ніж сторінок, — інакше
     * контракт не відрізнявся б від «рамка там, де колонцифра». */
    const folioPages = new Set(before.folioFrames.filter((f) => !f.fromMaster).map((f) => f.page));
    expect(folioPages.size).toBeLessThan(pageCount);

    const res = await create();
    expect(res.created).toBe(pageCount);

    const seen = await inspect();
    /* Рівно одна службова рамка на КОЖНІЙ сторінці — без пропусків і без пар. */
    expect(seen.perPage).toEqual(new Array(pageCount).fill(1));
    /* І всі вони — ОДНА історія, зшита в порядку сторінок. */
    expect(seen.chain).toEqual(seen.pageNames);
  });

  it("геометрія службової рамки точно збігається з межами колонцифри, обтікання NONE, вміст порожній", async () => {
    await clearHelperItems();
    const before = await measure();
    const folio = before.folioFrames.filter((f) => !f.fromMaster && f.bounds !== null);
    expect(folio.length).toBeGreaterThan(0);

    const res = await create({ folioFrameIds: folio.map((f) => f.id) });

    /* Сторінки з колонцифрою беруть її прямокутник; решта — межі сторінки. */
    const fromFolio = res.frames.filter((f) => f.source === "folio");
    expect(fromFolio.length).toBeGreaterThan(0);
    expect(res.frames.length).toBe(res.created);

    const seen = await inspect(fromFolio.map((f) => f.folioFrameId!));
    for (const f of seen.frames) {
      expect(f.contents).toBe("");
      /* `String(TextWrapModes.NONE)` віддає саме «NONE» — перевірено прогоном;
       * писати тут повну назву перерахування означало б звіряти з рядком, якого
       * InDesign не повертає. */
      expect(f.wrap).toBe("NONE");
    }

    /*
     * ЗБІГ ГЕОМЕТРІЇ ЗВІРЯЄТЬСЯ З РАМКОЮ КОЛОНЦИФРИ, А НЕ САМ ІЗ СОБОЮ.
     * Обидва прямокутники читані в одній системі координат (розворот), тож
     * різниця мусить бути нульовою з точністю до похибки представлення.
     */
    const checked: string[] = [];
    for (const item of fromFolio) {
      const src = seen.folioBounds[item.folioFrameId!]!;
      expect(src).toBeDefined();
      const got = seen.frames.find((f) => f.page === item.page)!;
      expect(got.bounds.y1).toBeCloseTo(src.y1, 3);
      expect(got.bounds.x1).toBeCloseTo(src.x1, 3);
      expect(got.bounds.y2).toBeCloseTo(src.y2, 3);
      expect(got.bounds.x2).toBeCloseTo(src.x2, 3);
      checked.push(item.page);
    }
    expect(checked.length).toBeGreaterThan(0);

    /*
     * І ЗБІГ МУСИТЬ БУТИ НЕ ТОТОЖНІСТЮ «САМ ІЗ СОБОЮ». Сторінки без колонцифри
     * дістають прямокутник із власних меж сторінки, тобто ІНШИЙ — без цієї
     * звірки мутант «завжди брати межі сторінки» лишився б живим на всіх
     * попередніх рядках.
     */
    const fallback = res.frames.filter((f) => f.source === "page");
    expect(fallback.length).toBeGreaterThan(0);
    const anyFolioBounds = seen.folioBounds[fromFolio[0]!.folioFrameId!]!;
    const anyFallback = seen.frames.find((f) => f.page === fallback[0]!.page)!;
    expect(anyFallback.bounds.y1).not.toBeCloseTo(anyFolioBounds.y1, 3);
  });

  it("обтікання NONE виставляється ЯВНО — навіть коли типове обтікання документа інше", async () => {
    /*
     * ЦЕЙ ТЕСТ ДОПИСАНО ПІСЛЯ ТОГО, ЯК МУТАНТ ВИЖИВ, і це знахідка про тест, а
     * не про код: із прибраним рядком `textWrapMode = NONE` усі вісім тестів
     * лишались зеленими, бо в щойно створеного документа типове обтікання й
     * так `NONE` — тобто перевірялось замовчування InDesign, а не наш запис.
     *
     * Стан нижче не вигаданий: `doc.textWrapPreferences` — це ОБ'ЄКТНЕ
     * ЗАМОВЧУВАННЯ документа, яке верстальник міняє, змінивши обтікання, коли
     * нічого не виділено. У такому документі службова рамка успадкувала б
     * обтікання й посунула б рядки основного тексту — рівно те, що §7 називає
     * гучною помилкою «службові рамки не сміють штовхати верстку».
     */
    await clearHelperItems();
    const wasDefault = await runScript<string>(
      `var doc = app.activeDocument;
       var before = String(doc.textWrapPreferences.textWrapMode);
       doc.textWrapPreferences.textWrapMode = TextWrapModes.BOUNDING_BOX_TEXT_WRAP;
       __result = before;`,
    );
    expect(wasDefault).toBe("NONE");

    await create();

    const seen = await inspect();
    expect(seen.frames.length).toBeGreaterThan(10);
    for (const f of seen.frames) expect(f.wrap).toBe("NONE");
  });

  it("шару немає — створюється printable = false, visible = true", async () => {
    /*
     * ВИМІРЯНО (Питання 8): прихований шар ГЛУШИТЬ маркер (13 замість 12), а
     * непридатний до друку — ні (16 із 16). Один клац по «оку» мовчки
     * перетворює кожну автоматичну колонцифру книжки на «N–N», тож напрямок
     * цих двох прапорців переставляти не можна.
     */
    await removeHelperLayer();
    const res = await create();

    expect(res.layerCreated).toBe(true);
    expect(res.layerFlagsBefore).toBeNull();

    const seen = await inspect();
    expect(seen.layer).not.toBeNull();
    expect(seen.layer!.visible).toBe(true);
    expect(seen.layer!.printable).toBe(false);
  });

  it("шар уже є з ІНШИМИ прапорцями — вони повертаються, а не лишаються чужими", async () => {
    /*
     * Фікстура створює `_folio-helper` саме таким, яким §4.8 забороняє:
     * `visible: false`. Це не вигаданий стан — приховування шару є звичкою
     * цього документа (у книжці саме так вимкнено зламану майстрову
     * колонцифру).
     */
    await clearHelperItems();
    const res = await create();

    expect(res.layerCreated).toBe(false);
    expect(res.layerFlagsBefore).toEqual({ visible: false, printable: false });

    const seen = await inspect();
    expect(seen.layer!.visible).toBe(true);
    expect(seen.layer!.printable).toBe(false);
  });

  it("на шарі вже є чужі елементи — відмова ДО копії й до будь-якого запису", async () => {
    /*
     * ВИМІРЯНО (Питання 9, 5 випадків із 5): виграє ланцюжок, СТВОРЕНИЙ
     * РАНІШЕ. Отже залишена під колонцифрою стара службова рамка перебила б
     * свіжий ланцюжок, і маркер узяв би число з неї; а самотня рамка
     * (Питання 10) мовчки друкує ВЛАСНУ сторінку. Обидва наслідки виглядають
     * правильними — тому тут відмова, а не «дозбираємо».
     */
    const seenBefore = await inspect();
    expect(seenBefore.layer!.itemCount).toBeGreaterThan(0);

    await expect(create()).rejects.toThrow(/_folio-helper/);

    /* Копії немає — відмова стоїть ПЕРЕД `saveACopy`. */
    await expect(stat(join(dir, "_backups"))).rejects.toThrow();

    const seenAfter = await inspect();
    expect(seenAfter.layer!.itemCount).toBe(seenBefore.layer!.itemCount);
  });

  it("відмовляється, якщо активний документ не той — до копії й до запису", async () => {
    await clearHelperItems();
    await expect(create({ expectedDocName: "Не той.indd" })).rejects.toThrow(/Не той\.indd/);
    await expect(stat(join(dir, "_backups"))).rejects.toThrow();

    const seen = await inspect();
    expect(seen.layer!.itemCount).toBe(0);
  });

  it("службові рамки не штовхають верстку — overset і кількість сторінок виміряні ДО й ПІСЛЯ", async () => {
    /*
     * §7: `becameOverset` непорожній після `create-helper-thread` — гучна
     * помилка. Захист працює лише тоді, коли вимір «після» справді зроблено:
     * обробник стартує з `null`, тож мутант, що прибирає вимір, обидві звірки
     * нижче валить (у фікстури overset-історій нуль, і плейсхолдер `[]` був би
     * побайтово однаковий із виміряним фактом).
     */
    await clearHelperItems();
    const before = await measure();
    const res = await create();

    expect(res.pageCountBefore).toBe(before.pages.length);
    expect(res.pageCountAfter).toBe(res.pageCountBefore);
    expect(res.oversetAfter).toEqual(res.oversetBefore);
    expect(res.oversetAfter.filter((id) => !res.oversetBefore.includes(id))).toEqual([]);
  });

  it("уся побудова — ОДИН крок скасування", async () => {
    await clearHelperItems();
    const res = await create();
    expect(res.created).toBeGreaterThan(10);

    await runJsx("__undo_once", { name: docName });

    const seen = await inspect();
    /* Одне Cmd+Z прибирає ВСІ рамки, а не останню. */
    expect(seen.layer!.itemCount).toBe(0);
  });
});

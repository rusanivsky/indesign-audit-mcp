import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FrameVerdict, RewritePlan } from "../../src/pagination/rewrite-types.js";
import type {
  ClaimFrame,
  PageRef,
  PaginationMeasure,
  ThreadLink,
} from "../../src/pagination/types.js";
import { HELPER_LAYER_NAME } from "../../src/pagination/topology.js";
import type { Tools } from "../../src/tools/shared.js";

/*
 * ГУЧНІ ПОМИЛКИ СІМНАДЦЯТОГО ІНСТРУМЕНТА (спек §7), перевірені там, де їх видно
 * — на підробленому містку, без InDesign.
 *
 * ЧОМУ САМЕ ТУТ, А НЕ В ІНТЕГРАЦІЙНОМУ ФАЙЛІ. §7 називає найімовірнішим
 * відмовним режимом фази ТИХУ БЕЗДІЯЛЬНІСТЬ: `eligible > 0`, `applied === 0` і
 * відповідь, яку читають як успіх. Щоб довести, що вона неможлива, потрібен
 * вхід, у якому запис ГАРАНТОВАНО не ліг, — а на живому документі такий вхід
 * доводиться інсценувати гонкою між виміром і записом. Підроблений `runWrite`
 * дає його точно й повторювано; живий документ дає його ж наприкінці
 * `tests/integration/pagination-apply.test.ts`, і саме пара з двох прогонів
 * закриває питання.
 *
 * `INDESIGN_MCP_HOME` перенаправлено в тимчасову теку: сховище планів (§4.5)
 * НЕ підмінюється — воно справжнє, бо саме воно і є каналом, який ця задача
 * зшиває.
 */

const { runJsxMock, runWriteMock } = vi.hoisted(() => ({
  runJsxMock: vi.fn(),
  runWriteMock: vi.fn(),
}));
vi.mock("../../src/bridge/runner.js", () => ({ runJsx: runJsxMock }));
vi.mock("../../src/bridge/envelope.js", () => ({ runWrite: runWriteMock }));

const { registerPaginationTools } = await import("../../src/tools/pagination.js");
const { saveRewritePlan, rewritePlanPath } = await import("../../src/pagination/store.js");

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
type AnyHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

function handler(): AnyHandler {
  let captured: AnyHandler | null = null;
  const fake = {
    registerTool(name: string, _cfg: unknown, h: AnyHandler) {
      if (name === "pagination_apply") captured = h;
    },
  } as unknown as Tools;
  registerPaginationTools(fake);
  if (!captured) throw new Error("pagination_apply не зареєстровано");
  return captured;
}

const DOC = "book.indd";

/** Розворот «96–97» — те, з чого складається робоча книжка. */
function pages(count = 4): PageRef[] {
  const out: PageRef[] = [];
  for (let i = 0; i < count; i++) {
    const name = String(96 + i);
    const sibling = i % 2 === 0 ? String(97 + i) : String(95 + i);
    out.push({
      name,
      offset: i,
      side: i % 2 === 0 ? "LEFT_HAND" : "RIGHT_HAND",
      spreadIndex: Math.floor(i / 2),
      spreadSiblings: [sibling],
      master: null,
    });
  }
  return out;
}

/**
 * Рамка колонцифри на recto з ручним числом попередньої сторінки.
 *
 * ПІД РАМКОЮ ЛЕЖИТЬ СЛУЖБОВА, І ЦЕ НЕ ПРИКРАСА ФІКСТУРИ. `replace-literals`
 * викликають ПІСЛЯ `create-helper-thread`, тобто у вимірі, де службовий
 * ланцюжок уже є: геометрія службової рамки збігається з колонцифрою точно
 * (§4.2), тож вона неодмінно в `overlaps`. Доти фікстура давала `overlaps: []`
 * — стан, у якому ланцюжка під рамкою НЕМАЄ, — і саме на ньому інструмент
 * доповідав придатність. Тобто цей файл теж освячував C1.
 */
function helperUnder(pageName: string): ThreadLink {
  return {
    storyId: "helper-story",
    /* Маркер `previous` дає сторінку ПОПЕРЕДНЬОЇ РАМКИ ланцюжка (H6, випадок C),
     * а ланцюжок суцільний — отже сусідню сторінку. */
    previousPage: String(Number(pageName) - 1),
    nextPage: String(Number(pageName) + 1),
    /* Службовий ланцюжок фаза додає в готовий документ ОСТАННІМ (Питання 9). */
    createdOrder: 9000,
    layerVisible: true,
    layerName: HELPER_LAYER_NAME,
    fromMaster: false,
  };
}

function recto(pageName: string, literal: number, over: Partial<ClaimFrame> = {}): ClaimFrame {
  return {
    id: `f${pageName}`,
    page: pageName,
    styleName: "Kolontsyfra",
    rotationAngle: -90,
    bounds: { y1: 0, x1: 0, y2: 10, x2: 10 },
    layerName: "Layer 1",
    layerVisible: true,
    layerPrintable: true,
    fromMaster: false,
    locked: false,
    layerLocked: false,
    overlaps: [helperUnder(pageName)],
    paragraphs: [
      {
        index: 0,
        styleName: null,
        text: `${literal}–￼`,
        literals: [literal],
        markers: [],
        literalOffsets: [0],
        baseline: 0,
        leading: 4,
      },
    ],
    ...over,
  };
}

function measure(over: Partial<PaginationMeasure> = {}): PaginationMeasure {
  return {
    docName: DOC,
    pages: pages(),
    folioFrames: [recto("97", 96), recto("99", 98)],
    contentsTitles: [],
    contentsNumbers: [],
    headings: [],
    /* Родину колонтитулів цей тест не оголошує — вимір за неї не платив. */
    headFrames: [],
    missingStyles: [],
    masterSkipped: { declared: [], undeclared: 0 },
    /* `null` — шару `_folio-helper` у документі немає. Це НЕ порожній
     * ланцюжок: той при наявному шарі є дефектом (спек Фази 8, §4.1). */
    helperChain: null,
    ...over,
  };
}

/** Звіт `pagination_create_helper_thread` із суцільним покриттям. */
function helperReport(over: Record<string, unknown> = {}) {
  /*
   * ДОНОР ГЕОМЕТРІЇ НАЗВАНИЙ ПОІМЕННО, бо покриття їде в оракул ДВОМА
   * одиницями: `offset` (на яких сторінках рамки стоять) і `folioFrameId` (під
   * якими саме колонцифрами вони лягли). Друге і є канал `ignoredFolioFrames`
   * (I2): рамка, що донора не мала, у плані придатною бути не може.
   */
  const donors: Record<number, string> = { 1: "f97", 3: "f99" };
  const frames = pages().map((p) => ({
    page: p.name,
    offset: p.offset,
    frameId: `h${p.offset}`,
    source: donors[p.offset] === undefined ? "page" : "folio",
    folioFrameId: donors[p.offset] ?? null,
  }));
  return {
    docName: DOC,
    backupPath: "/tmp/_backups/book 1.indd",
    backupsRemoved: 0,
    backupRotationError: null,
    layerName: "_folio-helper",
    layerCreated: true,
    layerFlagsBefore: null,
    created: frames.length,
    frames,
    ignoredFolioFrames: [],
    oversetBefore: [],
    oversetAfter: [],
    pageCountBefore: 4,
    pageCountAfter: 4,
    ...over,
  };
}

const BASE = {
  folio: { styleNames: ["Kolontsyfra"], range: "backward" },
  expectedDocName: DOC,
};

const CREATE = { ...BASE, operation: "create-helper-thread" };
const REPLACE = { ...BASE, operation: "replace-literals", route: "helper" };

/** Розбір відповіді з ГУЧНИМ поясненням, коли віддали не JSON, а текст помилки. */
const json = (res: ToolResult) => {
  try {
    return JSON.parse(res.content[0]!.text);
  } catch {
    throw new Error("очікували JSON-відповідь, а прийшло: " + res.content[0]!.text);
  }
};

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "idmcp-plans-"));
  process.env.INDESIGN_MCP_HOME = home;
  runJsxMock.mockReset();
  runWriteMock.mockReset();
  runJsxMock.mockResolvedValue(measure());
});

afterEach(async () => {
  delete process.env.INDESIGN_MCP_HOME;
  await rm(home, { recursive: true, force: true });
});

/* ── перехресні правила: відмова ДО виміру ────────────────────────────── */

it("replace-literals без route — відмова, і документ навіть не міряли", async () => {
  const res = await handler()({ ...BASE, operation: "replace-literals" });
  expect(res.isError).toBe(true);
  expect(res.content[0]!.text).toMatch(/route/);
  /* Вимір коштує прохід по всьому документу — за помилку в аргументах платити
   * ним не можна (той самий прецедент, що перевірка рівнів в аудиті). */
  expect(runJsxMock).not.toHaveBeenCalled();
});

it("create-helper-thread із route — відмова, а не мовчазне ігнорування", async () => {
  /* Параметр, який прийняли й не вжили, — брехня про те, що зроблено. */
  const res = await handler()({ ...CREATE, route: "auto" });
  expect(res.isError).toBe(true);
  expect(runJsxMock).not.toHaveBeenCalled();
});

it("create-helper-thread із planId — відмова: ця операція planId ВИДАЄ, а не споживає", async () => {
  const res = await handler()({ ...CREATE, planId: "folio-plan-1" });
  expect(res.isError).toBe(true);
  expect(runJsxMock).not.toHaveBeenCalled();
});

it("replace-literals із route auto без planId — відмова (§4.5)", async () => {
  /*
   * Розділення двох операцій купує спостережуваність ЦІНОЮ РОЗСИНХРОНУ. З
   * `route: "auto"` місце кожної службової рамки визначає повний аналіз
   * придатності; якщо другий виклик робить його вдруге й незалежно, він дістане
   * інший маршрут і напише маркери, що спираються на рамки, яких там немає.
   * Оракул цього не спіймає — він звіряє ЧИСЛО, а число сьогодні збігається.
   */
  const res = await handler()({ ...BASE, operation: "replace-literals", route: "auto" });
  expect(res.isError).toBe(true);
  expect(res.content[0]!.text).toMatch(/planId/);
  expect(runJsxMock).not.toHaveBeenCalled();
});

it("стилю немає в документі — ГУЧНА помилка, а не нуль знахідок", async () => {
  /* §7, перший рядок. Друкарська помилка в назві стилю інакше дає порожній
   * звіт, який читається як «усе чисто» — Фаза 5 ловила це п'ять разів. */
  runJsxMock.mockResolvedValue(measure({ missingStyles: ["Kolontsyfr"] }));
  const res = await handler()(CREATE);
  expect(res.isError).toBe(true);
  expect(res.content[0]!.text).toContain("Kolontsyfr");
  expect(runWriteMock).not.toHaveBeenCalled();
});

it("активний документ не той — відмова до будь-якого запису", async () => {
  const res = await handler()({ ...CREATE, expectedDocName: "інша.indd" });
  expect(res.isError).toBe(true);
  expect(runWriteMock).not.toHaveBeenCalled();
});

/* ── dryRun ───────────────────────────────────────────────────────────── */

it("dryRun за замовчуванням: без поля в виклику НІЧОГО не пишеться і плану немає", async () => {
  const res = await handler()(CREATE);
  const data = json(res);
  expect(res.isError).toBeUndefined();
  expect(data.dryRun).toBe(true);
  expect(runWriteMock).not.toHaveBeenCalled();
  /* Копії теж немає — сухий прогін не сміє лишати 16 МБ у теці користувача. */
  expect(data.backupPath).toBeNull();
  /* І `planId` теж: план описує ФАКТИЧНО побудований ланцюжок (§4.5), а
   * сухий прогін не побудував нічого. */
  expect(data.planId).toBeNull();
});

it("dryRun у replace-literals показує, що саме буде записано, і не пише", async () => {
  const res = await handler()(REPLACE);
  const data = json(res);
  expect(runWriteMock).not.toHaveBeenCalled();
  expect(data.eligible).toBe(2);
  expect(data.applied).toBeNull();
  expect(data.willWrite).toHaveLength(2);
});

/* ── I7: від чого залежить число, яке щойно пообіцяли ─────────────────── */

it("willWrite везе ДЖЕРЕЛО числа порамково, а не лише адресу правки", async () => {
  /*
   * СУХИЙ ПРОГІН — САМЕ ТЕ, ЩО ОПЕРАТОР ЧИТАЄ ПЕРЕД ТИМ, ЯК ВИРІШУВАТИ ДОЛЮ
   * СЛУЖБОВОГО ШАРУ, і доти порамкового джерела не було в ньому НІДЕ:
   * `groupSkipped` зводить пропуски за причиною, а правка везла лише адресу й
   * текст. §4.8 називає видалення шару `_folio-helper` штатною зворотною дією,
   * Питання 8 виміряло її ціну (прихований шар → у PDF 13 замість 12), і
   * дізнатися, які саме колонцифри від цього шару залежать, оператор не мав як.
   *
   * Тут під кожною рамкою лежить САМЕ службова (`helperUnder`) — стан після
   * `create-helper-thread`, тобто штатний вхід другої операції.
   */
  const data = json(await handler()(REPLACE));

  expect(data.willWrite.map((e: { resolvedBy: string }) => e.resolvedBy)).toEqual([
    "helper",
    "helper",
  ]);
  expect(data.resolvedByHelper).toBe(2);
  expect(data.message).toContain("_folio-helper");
});

it("під тими самими рамками ОСНОВНИЙ ланцюжок старший — джерело main, попередження зникає", async () => {
  /*
   * НЕГАТИВНИЙ КОНТРОЛЬ, БЕЗ ЯКОГО ПОПЕРЕДЖЕННЯ БУЛО Б НАПИСАНЕ «ЗАВЖДИ».
   * Основний ланцюжок, СТВОРЕНИЙ РАНІШЕ (Питання 9), перебиває службовий — і
   * тоді ці колонцифри службового шару справді не потребують.
   */
  const older = (pageName: string): ThreadLink => ({
    storyId: "main-story",
    previousPage: String(Number(pageName) - 1),
    nextPage: String(Number(pageName) + 1),
    createdOrder: 1,
    layerVisible: true,
    layerName: "Osnovnyi tekst",
    fromMaster: false,
  });
  runJsxMock.mockResolvedValue(
    measure({
      folioFrames: [
        recto("97", 96, { overlaps: [helperUnder("97"), older("97")] }),
        recto("99", 98, { overlaps: [helperUnder("99"), older("99")] }),
      ],
    }),
  );

  const data = json(await handler()(REPLACE));

  expect(data.eligible).toBe(2);
  expect(data.willWrite.map((e: { resolvedBy: string }) => e.resolvedBy)).toEqual(["main", "main"]);
  expect(data.resolvedByHelper).toBe(0);
  expect(data.message).not.toContain("_folio-helper");
});

it("лічильник рахує ПРИДАТНІ, а не всі рамки зі службовим переможцем", async () => {
  /*
   * ДОПИСАНО ПІСЛЯ ТОГО, ЯК МУТАНТ ВИЖИВ, і це знахідка про ТЕСТ, а не про код.
   * Мутант «рахувати `verdicts` замість `eligible`» не червонив НІЧОГО: у
   * решті фікстур кожна рамка зі службовим переможцем була ще й придатною, тож
   * обидва переліки збігались.
   *
   * Стан, у якому вони розходяться, штатний: рамка, під якою службовий
   * ланцюжок ВЕДЕ НЕ ТУДИ (`wrong-neighbour-page`), джерело має виміряне —
   * `helper`, — але не пишеться. Залежність від шару створює лише те, що
   * ЗАПИШЕТЬСЯ; порахувати й таку рамку означало б надрукувати «2 із 1»,
   * тобто число, більше за власну підставу.
   */
  runJsxMock.mockResolvedValue(
    measure({
      folioFrames: [
        recto("97", 96),
        recto("99", 98, { overlaps: [{ ...helperUnder("99"), previousPage: "42" }] }),
      ],
    }),
  );

  const data = json(await handler()(REPLACE));

  expect(data.eligible).toBe(1);
  expect(
    data.skipped.find((g: { reason: string }) => g.reason === "wrong-neighbour-page").count,
  ).toBe(1);
  expect(data.resolvedByHelper).toBe(1);
  expect(data.message).toContain("1 of 1");
});

it("мокрий прогін теж називає залежність — саме після запису шар і хочеться прибрати", async () => {
  /*
   * `willWrite` у мокрій відповіді немає взагалі, а рішення «шар більше не
   * потрібен» оператор ухвалює САМЕ ПІСЛЯ успішного запису. Тому лічильник і
   * попередження їдуть в обох відповідях, а не лише в сухій.
   */
  runWriteMock.mockResolvedValue({
    docName: DOC,
    backupPath: "/tmp/b.indd",
    applied: 2,
    failed: [],
    oversetBefore: [],
    oversetAfter: [],
    pageCountBefore: 4,
    pageCountAfter: 4,
  });

  const data = json(await handler()({ ...REPLACE, dryRun: false }));

  expect(data.applied).toBe(2);
  expect(data.resolvedByHelper).toBe(2);
  expect(data.message).toContain("_folio-helper");
});

/* ── тиха бездіяльність: головна гучна помилка фази ───────────────────── */

it("eligible > 0, а applied === 0 при dryRun:false — ГУЧНА помилка, не успішна відповідь", async () => {
  /*
   * НАЙІМОВІРНІШИЙ ВІДМОВНИЙ РЕЖИМ ФАЗИ (§7). Перший прогін Фази 6 дав «0
   * знахідок на 91 рамці», і це була неправда про книжку. Тут форма та сама:
   * обробник чесно віддає `applied: 0` і повний `failed`, а інструмент без цієї
   * перевірки віддав би 200 OK із нулем — тобто «нічого не треба було
   * робити» замість «нічого не вдалося».
   */
  runWriteMock.mockResolvedValue({
    docName: DOC,
    backupPath: "/tmp/_backups/book 1.indd",
    applied: 0,
    failed: [
      { frameId: "f97", page: "97", paragraphIndex: 0, error: "Текст абзацу змінився після виміру" },
      { frameId: "f99", page: "99", paragraphIndex: 0, error: "Рамка заблокована" },
    ],
    oversetBefore: [],
    oversetAfter: [],
    pageCountBefore: 4,
    pageCountAfter: 4,
  });

  const res = await handler()({ ...REPLACE, dryRun: false });

  expect(res.isError).toBe(true);
  const text = res.content[0]!.text;
  /* Помилка мусить назвати ЧИСЛА, шлях копії й бодай одну причину — інакше
   * оператор дізнається лише те, що «щось не так». */
  expect(text).toMatch(/2/);
  expect(text).toContain("/tmp/_backups/book 1.indd");
  expect(text).toMatch(/змінився/);
});

it("eligible === 0 при dryRun:false — це НЕ помилка, і запису не було", async () => {
  /*
   * Негативний контроль до попереднього: без нього гучна помилка могла б бути
   * написана як «завжди», і тест лишався б зеленим. Нуль придатних — законний
   * стан (§3: низьке покриття визначає обсяг користі, а не безпеки).
   */
  runJsxMock.mockResolvedValue(measure({ folioFrames: [recto("97", 42)] }));
  const res = await handler()({ ...REPLACE, dryRun: false });
  expect(res.isError).toBeUndefined();
  expect(json(res).eligible).toBe(0);
  expect(runWriteMock).not.toHaveBeenCalled();
});

it("частковий успіх (applied > 0 при непорожньому failed) помилкою НЕ є", async () => {
  runWriteMock.mockResolvedValue({
    docName: DOC,
    backupPath: "/tmp/b.indd",
    applied: 1,
    failed: [{ frameId: "f99", page: "99", paragraphIndex: 0, error: "Рамка заблокована" }],
    oversetBefore: [],
    oversetAfter: [],
    pageCountBefore: 4,
    pageCountAfter: 4,
  });
  const res = await handler()({ ...REPLACE, dryRun: false });
  expect(res.isError).toBeUndefined();
  const data = json(res);
  expect(data.applied).toBe(1);
  expect(data.failed).toHaveLength(1);
  expect(data.reconciliation.balanced).toBe(true);
});

/* ── зведення (§5.2) ──────────────────────────────────────────────────── */

it("reconciliation: total = eligible + Σ skipped, alreadyAutomatic ПОЗА рівнянням", async () => {
  /*
   * §5.2: другий запуск `replace-literals` на тій самій книжці імовірний, і
   * тоді вже переведені абзаци становитимуть велику частку. Порахувати їх у
   * `skipped` зробило б `balanced: false` на бездоганному прогоні; не рахувати
   * ніде — оператор не відрізнить «40 уже зроблено» від «40 загубилось».
   */
  const done = recto("101", 100);
  done.id = "f101";
  done.paragraphs[0] = {
    ...done.paragraphs[0]!,
    text: "￼–￼",
    literals: [],
    literalOffsets: [],
    markers: ["previous-page-number", "auto-page-number"],
  };
  const empty = recto("103", 102);
  empty.id = "f103";
  empty.paragraphs[0] = {
    ...empty.paragraphs[0]!,
    text: "",
    literals: [],
    literalOffsets: [],
    markers: [],
  };

  runJsxMock.mockResolvedValue(
    measure({
      pages: pages(8),
      folioFrames: [recto("97", 96), recto("99", 42), done, empty],
    }),
  );

  const data = json(await handler()(REPLACE));

  expect(data.total).toBe(2);
  expect(data.eligible).toBe(1);
  const skippedTotal = data.skipped.reduce((s: number, g: { count: number }) => s + g.count, 0);
  expect(skippedTotal).toBe(1);
  expect(data.total).toBe(data.eligible + skippedTotal);

  /* Обидва лічильники поза рівнянням — і вони РІЗНІ: «уже самооновний» і
   * «взагалі не твердження про сторінку» злиті в одне число сховали б, що саме
   * інструмент знайшов. */
  expect(data.alreadyAutomatic).toBe(1);
  expect(data.withoutClaim).toBe(1);
  expect(data.reconciliation.balanced).toBe(true);
});

it("майстрові абзаци без літералів рахуються ОКРЕМО від документних", async () => {
  /*
   * АРИФМЕТИКА, А НЕ ОХАЙНІСТЬ. `page.masterPageItems` дає запис на КОЖНУ
   * сторінку з тим майстром — ОДИН фізичний об'єкт приїздить у вимір стільки
   * разів, до скількох сторінок застосовано майстер (у фікстурі рамка `id=290`
   * так з'являється 13 разів). Три майстрові колонцифри робочої книжки несуть
   * `⟨PREVIOUS⟩–⟨AUTO⟩` без жодного літерала, тож у спільному лічильнику вони
   * дали б ~87 «уже переведених» абзаців, яких оператор не переводив і перевести
   * не може: крок 7 оракула майстрові рамки відкидає. Змішані в одне число, вони
   * зробили б `alreadyAutomatic` брехнею саме про те, заради чого §5.2 його й
   * завів — про обсяг зробленого.
   */
  const master = (page: string): ClaimFrame => {
    const f = recto(page, 0, { fromMaster: true });
    f.id = "m1";
    f.page = page;
    f.paragraphs = [
      {
        index: 0,
        styleName: null,
        text: "￼",
        literals: [],
        markers: ["auto-page-number"],
        literalOffsets: [],
        baseline: 0,
        leading: 4,
      },
    ];
    return f;
  };

  runJsxMock.mockResolvedValue(
    measure({ folioFrames: [recto("97", 96), master("96"), master("98")] }),
  );
  const data = json(await handler()(REPLACE));

  expect(data.alreadyAutomatic).toBe(0);
  expect(data.alreadyAutomaticFromMaster).toBe(2);
  /* І документний бік лічильника при цьому працює — інакше нуль вище був би
   * порожньою правдою. */
  expect(data.eligible).toBe(1);
});

it("reconciliation.balanced === false — ГУЧНА помилка (§7)", async () => {
  /*
   * Розбіжність вимагає РОЗБОРУ, а не повторного запуску. Вхід інсценовано з
   * боку обробника: він доповів більше правок, ніж йому подали, — тобто стан,
   * якого не буває, і саме тому його не можна віддати як успішну відповідь.
   */
  runWriteMock.mockResolvedValue({
    docName: DOC,
    backupPath: "/tmp/b.indd",
    applied: 7,
    failed: [],
    oversetBefore: [],
    oversetAfter: [],
    pageCountBefore: 4,
    pageCountAfter: 4,
  });
  const res = await handler()({ ...REPLACE, dryRun: false });
  expect(res.isError).toBe(true);
  expect(res.content[0]!.text).toMatch(/balanced|зведення/i);
});

/* ── §7: рамки не сміють штовхати верстку ─────────────────────────────── */

it("becameOverset непорожній — ГУЧНА помилка з іменем копії", async () => {
  runWriteMock.mockResolvedValue(helperReport({ oversetAfter: ["s7"] }));
  const res = await handler()({ ...CREATE, dryRun: false });
  expect(res.isError).toBe(true);
  expect(res.content[0]!.text).toContain("s7");
  expect(res.content[0]!.text).toContain("/tmp/_backups/book 1.indd");
});

it("ланцюжок із ПРОПУСКОМ (created ≠ сторінок) — ГУЧНА помилка", async () => {
  /*
   * СТОРОЖ КОНТРАКТУ §4.2 З БОКУ ІНСТРУМЕНТА. Виміряно (Питання 18): маркер
   * друкує сторінку ПОПЕРЕДНЬОЇ РАМКИ ЛАНЦЮЖКА, а не «поточна мінус один», тож
   * ланцюжок із пропуском бреше на КОЖНІЙ рамці, і кожна брехня виглядає
   * правильною. Мовчазно зберегти план поверх такого ланцюжка означало б
   * узаконити її.
   */
  const short = helperReport();
  short.frames = short.frames.slice(0, 3);
  short.created = 3;
  runWriteMock.mockResolvedValue(short);

  const res = await handler()({ ...CREATE, dryRun: false });
  expect(res.isError).toBe(true);
  expect(res.content[0]!.text).toMatch(/3.*4|4.*3/s);
  /* І плану немає: інакше `replace-literals` дістав би дозвіл писати. */
  await expect(readFile(join(home, "pagination-plans"), "utf8")).rejects.toThrow();
});

/* ── §4.5: дві операції, зшиті planId і chainOffsets ──────────────────── */

it("донором геометрії не буває рамка на ПРИХОВАНОМУ шарі (I4)", async () => {
  /*
   * Донор обирається ПО ОДНОМУ НА СТОРІНКУ, і перший виграє
   * (`pagination-write.jsx`). Прихована колонцифра, що трапилась першою,
   * забирала службову рамку собі — а ВИДИМА колонцифра тієї самої сторінки
   * лишалась без ланцюжка. Оракул приховану однаково відкидає
   * (`hidden-layer-frame`), тобто службова рамка під нею — витрачена дарма, і
   * витрачена коштом тієї, заради якої все й робиться. У фікстурі цей стан уже
   * є: `folio-dormant-duplicate` на с. «15».
   *
   * Перевіряється те, ЩО ПОЇХАЛО В ОБРОБНИК, а не відповідь інструмента:
   * `folioFrameIds` — єдиний канал, яким TypeScript керує вибором донора.
   */
  const dormant = recto("97", 96, { id: "f97-hidden", layerVisible: false });
  runJsxMock.mockResolvedValue(measure({ folioFrames: [dormant, recto("97", 96)] }));
  runWriteMock.mockResolvedValue(helperReport());

  await handler()({ ...CREATE, dryRun: false });

  const params = runWriteMock.mock.calls[0]![0].params as { folioFrameIds: string[] };
  expect(params.folioFrameIds).toEqual(["f97"]);
});

it("create-helper-thread видає planId, і план несе chainOffsets ЗІ ЗВІТУ", async () => {
  runWriteMock.mockResolvedValue(helperReport());
  const data = json(await handler()({ ...CREATE, dryRun: false }));

  expect(data.planId).toMatch(/^folio-plan-/);
  const plan = JSON.parse(await readFile(rewritePlanPath(data.planId), "utf8")) as RewritePlan;
  expect(plan.docName).toBe(DOC);
  /*
   * ФАКТИЧНЕ покриття, а не назване. Числа беруться з `report.frames[].offset`
   * — тобто з того, що обробник СПРАВДІ поставив, — і це єдиний канал, яким
   * покриття доїжджає до другої операції: службові рамки не належать до родини
   * `folio`, тож повторний `pagination_measure` їх не бачить.
   */
  expect(plan.chainOffsets).toEqual([0, 1, 2, 3]);
  expect(plan.verdicts.filter((v) => v.eligible)).toHaveLength(2);
});

it("план несе ДОПОВІДЕНЕ покриття, а не перераховане з кількості сторінок", async () => {
  /*
   * ЦЕЙ ТЕСТ ДОПИСАНО ПІСЛЯ ТОГО, ЯК МУТАНТ ВИЖИВ (мутант P у звіті Задачі 11):
   * `report.frames.map((f) => f.offset)` → `measure.pages.map((_, i) => i)`
   * лишив зеленими всі 35 тестів. Причина не в недбалості тестів, а в сторожі
   * поруч: гучна помилка «created ≠ сторінок» уже відкидає кожен звіт, де рамок
   * не стільки ж, скільки сторінок, — а справжній обробник кладе їх рівно по
   * одній на сторінку в порядку сторінок, тож два вирази збігаються на кожному
   * вході, який до цього рядка доходить.
   *
   * РІЗНИЦЯ ПРОТЕ НЕ КОСМЕТИЧНА, І ВХІД, ЩО ЇЇ ПОКАЗУЄ, ІСНУЄ: звіт, у якому
   * рамок стільки ж, скільки сторінок, але лежать вони не на тих сторінках.
   * `chainOffsets` мусить бути тим, що обробник ДОПОВІВ (§4.5: «фактичне
   * покриття, а не те, на яких мав би»), — інакше друга операція дістане
   * покриття, якого ніхто не будував, і оракул пообіцяє сусіда, якого немає.
   */
  const odd = helperReport();
  odd.frames = [
    { page: "96", offset: 0, frameId: "h0", source: "page", folioFrameId: null },
    { page: "97", offset: 1, frameId: "h1", source: "page", folioFrameId: null },
    { page: "98", offset: 2, frameId: "h2", source: "page", folioFrameId: null },
    /* Четверта рамка лягла НЕ на четверту сторінку — кількість зійшлася, а
     * покриття ні. */
    { page: "100", offset: 4, frameId: "h4", source: "page", folioFrameId: null },
  ];
  runWriteMock.mockResolvedValue(odd);

  const data = json(await handler()({ ...CREATE, dryRun: false }));
  const plan = JSON.parse(await readFile(rewritePlanPath(data.planId), "utf8")) as RewritePlan;
  expect(plan.chainOffsets).toEqual([0, 1, 2, 4]);
});

it("replace-literals МІРЯЄ придатність порамково, а не бере її з переліку сторінок", async () => {
  /*
   * C1, ГОЛОВНЕ. Доти придатність на маршруті `helper` спиралась на
   * `chainOffsets` — ПОСТОРІНКОВИЙ перелік, — і рамка, під якою службової
   * рамки немає, діставала «придатна», бо на її СТОРІНЦІ рамка нібито є.
   * Фінальна рецензія довела це надрукованим числом: «2–3» стало «3–3» при
   * `applied: 3`, `skipped: []`.
   *
   * Тепер відповідь дає вимір самої рамки. Дві колонцифри на одній сторінці —
   * той вхід, де дві одиниці розходяться найчистіше: службову рамку дістає
   * лише перша (`ignoredFolioFrames`), і між викликами ніхто нічого не робить.
   */
  const covered = recto("97", 96);
  const orphan = recto("97", 96, { id: "f97-b", overlaps: [] });
  runJsxMock.mockResolvedValue(measure({ folioFrames: [covered, orphan] }));

  const data = json(await handler()(REPLACE));

  expect(data.chainEvidence).toBe("measured");
  expect(data.eligible).toBe(1);
  expect(
    data.skipped.find((g: { reason: string }) => g.reason === "no-neighbour-frame").count,
  ).toBe(1);
  expect(data.willWrite.map((e: { frameId: string }) => e.frameId)).toEqual(["f97"]);
});

it("план іншого документа — відмова, і жодного запису", async () => {
  await saveRewritePlan({ planId: "folio-plan-alien", docName: "інша.indd", verdicts: [] });
  const res = await handler()({ ...REPLACE, planId: "folio-plan-alien", dryRun: false });
  expect(res.isError).toBe(true);
  expect(res.content[0]!.text).toContain("інша.indd");
  expect(runWriteMock).not.toHaveBeenCalled();
});

it("план ЗВІРЯЄТЬСЯ: абзац, якого в ньому немає, писати не можна (I3)", async () => {
  /*
   * §4.5 обіцяв, що другий виклик план «вимагає Й ЗВІРЯЄ». Звірки не було:
   * `RewritePlan.verdicts` зберігався на диск і НЕ ЧИТАВСЯ ніколи — з плану
   * бралися тільки `docName` і `chainOffsets`. Обіцянка в спеку не відповідала
   * коду, і поле, яке ніхто не читає, старіє мовчки.
   *
   * Звіряється рівно те, що зараз ЗАПИШЕТЬСЯ: кожен придатний вердикт мусить
   * мати в плані двійника з тим самим `current`. Порожній план — граничний
   * випадок того самого: оператор не схвалював жодного абзаца.
   */
  await saveRewritePlan({ planId: "folio-plan-bare", docName: DOC, verdicts: [] });
  const res = await handler()({
    ...BASE,
    operation: "replace-literals",
    route: "auto",
    planId: "folio-plan-bare",
    dryRun: false,
  });
  expect(res.isError).toBe(true);
  expect(res.content[0]!.text).toMatch(/absent from the plan/);
  expect(runWriteMock).not.toHaveBeenCalled();
});

it("план ЗВІРЯЄТЬСЯ: число в рамці змінили між викликами — відмова (I3)", async () => {
  /*
   * Саме той розсинхрон, проти якого §4.5 заводив план: між двома викликами
   * документ змінили. Оракул сам цього не спіймає — він звіряє число з
   * СУСІДОМ, і нове число сусідові теж може відповідати; розходиться воно з
   * тим, що оператор бачив і схвалив.
   *
   * НЕГАТИВНИЙ КОНТРОЛЬ ПОРУЧ: той самий план із правильними числами пропускає
   * запис. Без нього відмову можна було б написати як «завжди».
   */
  const asPlanned = (current: number): FrameVerdict[] => [
    {
      frameId: "f97",
      page: "97",
      paragraphIndex: 0,
      eligible: true,
      reason: null,
      current,
      expected: current,
      direction: "previous",
      route: "helper",
      resolvedBy: "helper",
    },
  ];
  runJsxMock.mockResolvedValue(measure({ folioFrames: [recto("97", 96)] }));
  runWriteMock.mockResolvedValue({
    docName: DOC,
    backupPath: "/tmp/b.indd",
    applied: 1,
    failed: [],
    oversetBefore: [],
    oversetAfter: [],
    pageCountBefore: 4,
    pageCountAfter: 4,
  });

  await saveRewritePlan({ planId: "folio-plan-drift", docName: DOC, verdicts: asPlanned(42) });
  const drifted = await handler()({
    ...BASE,
    operation: "replace-literals",
    route: "auto",
    planId: "folio-plan-drift",
    dryRun: false,
  });
  expect(drifted.isError).toBe(true);
  expect(drifted.content[0]!.text).toMatch(/in the plan 42, in the document 96/);
  expect(runWriteMock).not.toHaveBeenCalled();

  await saveRewritePlan({ planId: "folio-plan-same", docName: DOC, verdicts: asPlanned(96) });
  const ok = await handler()({
    ...BASE,
    operation: "replace-literals",
    route: "auto",
    planId: "folio-plan-same",
    dryRun: false,
  });
  expect(ok.isError).toBeUndefined();
  expect(json(ok).applied).toBe(1);
});

/* ── зведення й рівняння §5.2 — на переліку, якого оракул не віддає ────── */

const { groupSkipped, reconcile } = await import("../../src/tools/pagination.js");

function verdict(over: Partial<FrameVerdict> & { page: string }): FrameVerdict {
  return {
    frameId: `f-${over.page}`,
    paragraphIndex: 0,
    eligible: false,
    reason: "oracle-mismatch",
    current: 1,
    expected: 2,
    direction: "previous",
    route: null,
    resolvedBy: null,
    ...over,
  };
}

it("рівняння §5.2 ловить абзац, що випав ІЗ ЗВЕДЕННЯ, а не лише з лічильника", () => {
  /*
   * ЦЕЙ ТЕСТ ДОПИСАНО ПІСЛЯ ТОГО, ЯК МУТАНТ ВИЖИВ, і це знахідка про ТЕСТ, а не
   * про код. Мутант J: `const skipped = groups.reduce(...)` → `total − eligible`
   * — усі 63 тести лишились зеленими. Тобто перше рівняння §5.2 перевірялось
   * САМО СОБОЮ: обидві сторони рахували ті самі вердикти, і жоден вхід не міг їх
   * розвести.
   *
   * Стан, у якому вони розходяться, у типах є: `eligible: false` без причини
   * (`FrameVerdict` його забороняє, `groupSkipped` не має для нього імені
   * групи). `planRewrite` такого вердикту не віддає, тому й перевірити це можна
   * лише на прямому переліку — звідси експорт двох чистих функцій.
   *
   * Ціна помилки не косметична: така пачка зникла б із `skipped` мовчки,
   * оператор побачив би «total 91, eligible 40, skipped 50» і не мав би як
   * дізнатись, куди подівся 51-й.
   */
  const lost = verdict({ page: "97", reason: null });
  const seen = verdict({ page: "99" });

  const groups = groupSkipped([lost, seen]);
  expect(groups.reduce((s, g) => s + g.count, 0)).toBe(1);

  const bad = reconcile([lost, seen], groups, null, 0);
  expect(bad.total).toBe(2);
  expect(bad.eligible).toBe(0);
  expect(bad.skipped).toBe(1);
  expect(bad.balanced).toBe(false);

  /* Негативний контроль: без утраченого вердикту рівняння сходиться — інакше
   * `balanced` можна було б написати як `false` завжди. */
  const okGroups = groupSkipped([seen]);
  expect(reconcile([seen], okGroups, null, 0).balanced).toBe(true);
});

it("зведення обрізає перелік сторінок стелею 20 і НЕ мовчить про це", () => {
  /* Мовчазне обрізання читалося б як «це все», а на робочій книжці група
   * `folio-manual` має 91 сторінку. */
  const many = Array.from({ length: 25 }, (_, i) => verdict({ page: String(100 + i) }));
  const [group] = groupSkipped(many);
  expect(group!.count).toBe(25);
  expect(group!.pages).toHaveLength(20);
  expect(group!.pagesTruncated).toEqual({ shown: 20, total: 25 });
  /* І сума груп лишається ПОВНОЮ — обрізали перелік сторінок, не облік. */
  expect(reconcile(many, groupSkipped(many), null, 0).balanced).toBe(true);
});

/*
 * ЗНАХІДКА I8 — ЗВІТ МОВЧАВ ПРО ШАР НА ПОВТОРНОМУ ПРОГОНІ.
 *
 * ВІДТВОРЕНИЙ ВХІД, а не вигаданий: другий сухий прогін на копії робочої книжки
 * 2026-08-08 дав `alreadyAutomatic: 84`, `resolvedByHelper: 0` — і про шар
 * `_folio-helper` ані слова, хоча від нього залежали всі 84 маркери. Причина
 * структурна: вже переведена рамка (літералів немає) вердикту не дістає взагалі,
 * тож лічильник ПРИДАТНИХ нульовий за побудовою, а не тому, що шар не потрібен.
 */

/** Рамка, ВЖЕ переведена на маркер: літералів немає, маркер сусідньої сторінки є. */
function converted(pageName: string, over: Partial<ClaimFrame> = {}): ClaimFrame {
  return {
    ...recto(pageName, 0, over),
    id: `c${pageName}`,
    paragraphs: [
      {
        index: 0,
        styleName: null,
        text: "￼–￼",
        literals: [],
        markers: ["previous-page-number", "auto-page-number"],
        literalOffsets: [],
        baseline: 0,
        leading: 4,
      },
    ],
  };
}

it("I8: повторний прогін НЕ мовчить про шар, хоч resolvedByHelper дорівнює нулю", async () => {
  runJsxMock.mockResolvedValueOnce(
    measure({ folioFrames: [converted("97"), converted("99")] }),
  );

  const res = await handler()({
    operation: "replace-literals",
    route: "helper",
    folio: { styleNames: ["Kolontsyfra"], range: "backward" },
    dryRun: true,
    expectedDocName: DOC,
  });

  const data = JSON.parse(res.content[0]!.text) as Record<string, unknown>;
  /* Придатних немає — усі рамки вже переведені. Саме цей стан і мовчав. */
  expect(data.eligible).toBe(0);
  expect(data.resolvedByHelper).toBe(0);
  /* А ось це — відповідь, яка тепер є. */
  expect(data.alreadyAutomaticOverHelper).toBe(2);
  expect(String(data.message)).toContain("_folio-helper");
  expect(String(data.message)).toContain("“N–N”");
});

it("I8: стан шару їде ВИМІРОМ, тож не залежить від того, чи є вердикти", async () => {
  runJsxMock.mockResolvedValueOnce(
    measure({
      folioFrames: [converted("97")],
      helperChain: {
        layerName: HELPER_LAYER_NAME,
        layerVisible: true,
        layerPrintable: false,
        layerLocked: false,
        storyIds: ["helper-story"],
        frames: [],
        pagesWithoutFrame: ["98"],
      },
    }),
  );

  const res = await handler()({
    operation: "replace-literals",
    route: "helper",
    folio: { styleNames: ["Kolontsyfra"], range: "backward" },
    dryRun: true,
    expectedDocName: DOC,
  });

  const data = JSON.parse(res.content[0]!.text) as Record<string, unknown>;
  const layer = data.helperLayer as Record<string, unknown>;
  expect(layer).not.toBeNull();
  expect(layer.layerName).toBe(HELPER_LAYER_NAME);
  expect(layer.visible).toBe(true);
  /* `printable = false` — ШТАТНИЙ стан цього шару, не дефект (Питання 8). */
  expect(layer.printable).toBe(false);
  expect(layer.pagesWithoutFrame).toBe(1);
  expect(layer.chains).toBe(1);
});

it("I8: шару в документі немає — helperLayer дорівнює null, а не порожньому блоку", async () => {
  /* «Не будували» ≠ «збудували й воно порожнє»: та сама різниця, що між `null`
   * і `[]` у `ClaimFrame.overlaps`, яка вже коштувала фазі фікс-раунду. */
  runJsxMock.mockResolvedValueOnce(measure({ folioFrames: [converted("97")], helperChain: null }));

  const res = await handler()({
    operation: "replace-literals",
    route: "helper",
    folio: { styleNames: ["Kolontsyfra"], range: "backward" },
    dryRun: true,
    expectedDocName: DOC,
  });

  const data = JSON.parse(res.content[0]!.text) as Record<string, unknown>;
  expect(data.helperLayer).toBeNull();
});

it("побудова: helperLayer каже про шар, який ЩОЙНО створено, а не про вимір ДО неї", async () => {
  /*
   * ЗНАЙДЕНО ПРОГОНОМ НА КОПІЇ КНИЖКИ 2026-08-08. Перший мокрий
   * `create-helper-thread` віддав `helperLayer: null` одразу після того, як
   * створив шар зі 196 рамок: блок рахувався з `measure`, а вимір робиться ДО
   * побудови. Тобто звіт заперечував власну щойно виконану роботу — рівно той
   * клас, що знахідка I8.
   */
  runJsxMock.mockResolvedValueOnce(measure({ helperChain: null }));
  runWriteMock.mockResolvedValueOnce(
    helperReport({ layerName: HELPER_LAYER_NAME, layerCreated: true }),
  );

  const res = await handler()({
    operation: "create-helper-thread",
    folio: { styleNames: ["Kolontsyfra"], range: "backward" },
    dryRun: false,
    expectedDocName: DOC,
  });

  const data = JSON.parse(res.content[0]!.text) as Record<string, unknown>;
  const layer = data.helperLayer as Record<string, unknown> | null;
  expect(layer).not.toBeNull();
  expect(layer!.layerName).toBe(HELPER_LAYER_NAME);
  /* Прапорці обробник виставляє САМ і безумовно (§4.8), тож це не здогад. */
  expect(layer!.visible).toBe(true);
  expect(layer!.printable).toBe(false);
  expect(layer!.pagesWithoutFrame).toBe(0);
});

/* ── КЛЮЧ, ЯКИМ МУТУЮЧИЙ ІНСТРУМЕНТ ПИТАЄ ВИМІР ───────────────────────── */

/*
 * ДІРА, ЯКУ ЦЕЙ БЛОК ЗАКРИВАЄ (рецензія 2026-08-18, §2.4). Слова `folioStyles`
 * не було в `tests/` ЖОДНОГО разу — тобто ніщо не перевіряло, який ключ
 * `pagination_apply` шле у вимір. Помилка тут не гучна, а ТИХА за побудовою:
 * невідомий ключ давав порожній `folioFrames`, звідти `eligible.length === 0`,
 * а це в інструменті — не збій, а законна відповідь «придатних рамок немає».
 * Тобто гучна помилка §7 була недосяжна, і мутант «шли стару назву» пережив би
 * увесь набір.
 */

it("pagination_apply шле у вимір МНОЖИННИЙ ключ folioStyles", async () => {
  runJsxMock.mockResolvedValueOnce(measure());
  runWriteMock.mockResolvedValueOnce(helperReport());

  await handler()({ ...CREATE, dryRun: true });

  expect(runJsxMock).toHaveBeenCalled();
  const [handlerName, params] = runJsxMock.mock.calls[0] as [string, Record<string, unknown>];
  expect(handlerName).toBe("pagination_measure");
  expect(params.folioStyles).toEqual(["Kolontsyfra"]);
  /* Стара однина не має лишитись НІДЕ: саме її мовчазне ігнорування й
   * породило цей блок. */
  expect(params.folioStyle).toBeUndefined();
});

it("кілька стилів колонцифри доїжджають у вимір ПОВНІСТЮ, а не першим", async () => {
  /* Межу зняв `fc8f96d` заради розворотів, набраних двома стилями («Нумерація
   * L» / «Нумерація R»). Якщо дорогою лишиться лише перший, друга половина
   * книжки дасть нуль знахідок — і це прочитається як «чисто». */
  runJsxMock.mockResolvedValueOnce(measure());
  runWriteMock.mockResolvedValueOnce(helperReport());

  await handler()({
    operation: "create-helper-thread",
    folio: { styleNames: ["Нумерація L", "Нумерація R"], range: "backward" },
    dryRun: true,
    expectedDocName: DOC,
  });

  const [, params] = runJsxMock.mock.calls[0] as [string, Record<string, unknown>];
  expect(params.folioStyles).toEqual(["Нумерація L", "Нумерація R"]);
});

it("порожній перелік стилів — відмова ДО виміру, а не тиха бездіяльність", async () => {
  /*
   * ВОРОТА СТОЯТЬ В ОБРОБНИКУ, А НЕ ЛИШЕ В СХЕМІ, І ЦЕЙ ТЕСТ — ПРИЧИНА.
   * Перша його редакція покладалась на `FOLIO_OBJECT.min(1)` і ВПАЛА:
   * підроблений `registerTool` схему не прогонює, тож порожній перелік
   * доїжджав до виміру. У бойовому шляху zod його справді відкине — але
   * рівно те саме казали про `dryRun`, і саме тут це виявилось неправдою.
   *
   * Чому JSX не може лікувати цей клас сам: порожній масив приходить туди
   * ЗАКОННО, коли родину folio не оголошено взагалі (`pagination_audit`,
   * `folioArg?.styleNames ?? []`). У JSX стоять інші ворота — на переліку
   * КЛЮЧІВ (`IDMCP.rejectUnknownParams`), і вони ловлять стару однину.
   */
  const res = await handler()({
    operation: "create-helper-thread",
    folio: { styleNames: [], range: "backward" },
    dryRun: true,
    expectedDocName: DOC,
  });
  expect(res.isError).toBe(true);
  expect(runJsxMock).not.toHaveBeenCalled();
});

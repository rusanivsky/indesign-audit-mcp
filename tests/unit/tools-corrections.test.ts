import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ApplyReport, ContainerSnapshot, Plan, PlanItem } from "../../src/corrections/types.js";
import type { Tools } from "../../src/tools/shared.js";

/*
 * I4 (фінальна рецензія): обробники corrections_plan і corrections_apply не
 * були покриті жодним тестом — непокритими лишалися гілка конфліктів,
 * проводка busy → describeApplyTimeout, склейка annotateStyleWarnings і
 * ланцюг loadPlan → runJsx. Це чиста TypeScript-логіка: підміняємо міст до
 * InDesign (runJsx) і перехоплюємо обробники підробленим "сервером" — той
 * самий патерн, що в tests/unit/tools-pdf.test.ts.
 *
 * Тут же перевіряються I3 (пакетування ranges_inspect, чесний таймаут) і
 * T3 (дифи overset і сторінок у звіті).
 */
const { runJsxMock } = vi.hoisted(() => ({ runJsxMock: vi.fn() }));
vi.mock("../../src/bridge/runner.js", () => ({ runJsx: runJsxMock }));

const { IndesignError } = await import("../../src/bridge/errors.js");
const {
  registerCorrectionTools,
  withDiffs,
  attachAppliedWarnings,
  buildReportTable,
  STYLE_RANGE_BATCH,
  MAX_STYLE_RANGES,
} = await import("../../src/tools/corrections.js");

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
type AnyHandler = (args: any) => Promise<ToolResult>;

function captureHandlers(): Map<string, AnyHandler> {
  const handlers = new Map<string, AnyHandler>();
  const fakeServer = {
    registerTool: (name: string, _config: unknown, handler: AnyHandler) => {
      handlers.set(name, handler);
    },
  } as unknown as Tools;
  registerCorrectionTools(fakeServer);
  return handlers;
}

const dataOf = (r: ToolResult) => JSON.parse(r.content[0]!.text);

function container(text: string, over: Partial<ContainerSnapshot> = {}): ContainerSnapshot {
  return {
    containerId: "story:0",
    text,
    pageRuns: [{ start: 0, end: text.length, page: "1" }],
    oversetFrom: null,
    isMaster: false,
    kind: "text",
    ...over,
  };
}

const baseReport: ApplyReport = {
  backupPath: "/tmp/_backups/doc.indd",
  backupsRemoved: 0,
  backupRotationError: null,
  applied: [],
  skipped: [],
  failed: [],
  oversetBefore: [],
  oversetAfter: [],
  pageCountBefore: 10,
  pageCountAfter: 10,
};

/** Стандартний міст: читання контейнерів, інспекція стилів, застосування. */
function mockBridge(opts: {
  containers: ContainerSnapshot[];
  charStyles?: string[];
  paraStyles?: string[];
  report?: ApplyReport;
}) {
  const inspectCalls: { containerId: string; start: number; end: number }[][] = [];
  const applyCalls: any[] = [];
  runJsxMock.mockImplementation(async (handler: string, params: any) => {
    if (handler === "containers_read") return { docName: "test.indd", containers: opts.containers };
    if (handler === "ranges_inspect") {
      inspectCalls.push(params.ranges);
      return {
        results: params.ranges.map((r: any) => ({
          ...r,
          charStyles: opts.charStyles ?? ["Basic"],
          paraStyles: opts.paraStyles ?? ["Body"],
        })),
      };
    }
    if (handler === "apply_edits") {
      applyCalls.push(params);
      return opts.report ?? baseReport;
    }
    throw new Error(`несподіваний обробник ${handler}`);
  });
  return { inspectCalls, applyCalls };
}

let home: string;

beforeEach(async () => {
  runJsxMock.mockReset();
  home = await mkdtemp(join(tmpdir(), "idmcp-home-"));
  process.env.INDESIGN_MCP_HOME = home;
});

afterEach(async () => {
  delete process.env.INDESIGN_MCP_HOME;
  await rm(home, { recursive: true, force: true });
});

describe("corrections_plan (обробник)", () => {
  it("склеює попередження про стилі з кандидатами", async () => {
    mockBridge({
      containers: [container("Kyiv - stolytsia Ukrainy.")],
      charStyles: ["Basic", "Kursyv"],
      paraStyles: ["Body", "Zaholovok"],
    });
    const plan = captureHandlers().get("corrections_plan")!;

    const result = await plan({ requests: [{ id: "r1", action: "replace", old: "stolytsia", new: "misto" }], pageOffset: 0 });

    expect(result.isError).toBeFalsy();
    const data = dataOf(result);
    const item = data.items[0] as PlanItem;
    expect(item.status).toBe("unique");
    expect(item.candidates[0]!.warnings).toContain("multiple-char-styles");
    expect(item.candidates[0]!.warnings).toContain("multiple-para-styles");
  });

  it("зберігає план і повертає лічильники статусів", async () => {
    mockBridge({ containers: [container("Kyiv - stolytsia Ukrainy.")] });
    const plan = captureHandlers().get("corrections_plan")!;

    const data = dataOf(
      await plan({
        requests: [
          { id: "r1", action: "replace", old: "stolytsia", new: "misto" },
          { id: "r2", action: "replace", old: "nemaie takoho", new: "zovsim inshe" },
        ],
        pageOffset: 0,
      }),
    );

    expect(data.savedTo).toContain(home);
    expect(data.counts).toMatchObject({ unique: 1, not_found: 1 });
    expect(data.docName).toBe("test.indd");
  });

  /*
   * I3: annotateStyleWarnings слав УСІ діапазони одним викликом
   * ranges_inspect із дефолтним таймаутом 30 с. Виміряно на робочому макеті
   * користувача (196 сторінок, лише читання): ≈250 мс сталих + ≈4,6 мс на
   * діапазон, тобто одна пачка з 200 діапазонів — це ≈1,2 с.
   */
  describe("пакетування ranges_inspect (I3)", () => {
    /** N токенів, кожен по 50 входжень: рівно 50 кандидатів на кожен запит. */
    function manyTokens(n: number) {
      const tokens = Array.from({ length: n }, (_, i) => `w${String(i).padStart(2, "0")}z`);
      const text = tokens.flatMap((t) => Array.from({ length: 50 }, () => t)).join(" ");
      const requests = tokens.map((t, i) => ({ id: `r${i}`, action: "replace" as const, old: t, new: `${t}!` }));
      return { text, requests };
    }

    it("жодна пачка не перевищує ліміт, і разом вони покривають усі діапазони", async () => {
      const { text, requests } = manyTokens(5);
      const { inspectCalls } = mockBridge({ containers: [container(text)] });
      const plan = captureHandlers().get("corrections_plan")!;

      await plan({ requests, pageOffset: 0 });

      const total = inspectCalls.reduce((a, c) => a + c.length, 0);
      expect(total).toBe(250);
      expect(inspectCalls.length).toBe(Math.ceil(250 / STYLE_RANGE_BATCH));
      for (const call of inspectCalls) expect(call.length).toBeLessThanOrEqual(STYLE_RANGE_BATCH);
    });

    it("однакові діапазони з різних запитів інспектуються один раз", async () => {
      const text = Array.from({ length: 50 }, () => "kit").join(" ");
      const { inspectCalls } = mockBridge({ containers: [container(text)] });
      const plan = captureHandlers().get("corrections_plan")!;

      await plan({
        requests: [
          { id: "r1", action: "replace", old: "kit", new: "pes" },
          { id: "r2", action: "replace", old: "kit", new: "lys" },
        ],
        pageOffset: 0,
      });

      expect(inspectCalls.reduce((a, c) => a + c.length, 0)).toBe(50);
    });

    it("понад ліміт діапазонів інспекція обривається, але не мовчки", async () => {
      const { text, requests } = manyTokens(25);
      const { inspectCalls } = mockBridge({ containers: [container(text)] });
      const plan = captureHandlers().get("corrections_plan")!;

      const data = dataOf(await plan({ requests, pageOffset: 0 }));

      expect(inspectCalls.reduce((a, c) => a + c.length, 0)).toBe(MAX_STYLE_RANGES);
      expect(data.styleInspection).toEqual({ inspected: MAX_STYLE_RANGES, total: 1250 });
    });
  });

  it("таймаут читання не радить шукати модальне вікно, якого немає", async () => {
    runJsxMock.mockImplementation(async () => {
      throw new IndesignError("busy", "InDesign не відповідає", "Перевірте, чи не показує InDesign модальне вікно.");
    });
    const plan = captureHandlers().get("corrections_plan")!;

    const result = await plan({ requests: [{ id: "r1", action: "replace", old: "a", new: "b" }], pageOffset: 0 });

    expect(result.isError).toBe(true);
    const text = result.content[0]!.text;
    expect(text).toMatch(/document was not changed/i);
    expect(text).toMatch(/large document|fewer requests/i);
  });

  it("K1: contextBefore/contextAfter доходять крізь Zod до якірного шляху планувальника", async () => {
    // Те саме слово "знаннь" стоїть у тексті двічі — без контексту старий
    // глобальний пошук дав би "ambiguous". Контекст з PDF-анотації мусить
    // пройти крізь requestSchema незміненим і дати планувальнику розрізнити
    // місця складеним якорем (K1) — тобто рівно одного кандидата.
    const text =
      "Усе своє життя вона мріяла про знаннь і про спокій, бо знаннь мало варте.";
    mockBridge({ containers: [container(text)] });
    const plan = captureHandlers().get("corrections_plan")!;

    const result = await plan({
      requests: [
        {
          id: "r1",
          action: "replace",
          old: "ь",
          new: "я",
          contextBefore: "вона мріяла про знанн",
          contextAfter: " і про спокій",
        },
      ],
      pageOffset: 0,
    });

    expect(result.isError).toBeFalsy();
    const item = dataOf(result).items[0] as PlanItem;
    expect(item.status).toBe("unique");
    expect(item.candidates[0]!.matchText).toBe("ь");
  });
});

describe("corrections_apply (обробник)", () => {
  /*
   * Контейнери сюди НЕ передаються: їх задає mockBridge({ containers: [...] })
   * у кожному тесті окремо. Раніше перший параметр приймав їх дублікатом і
   * мовчки ігнорував — код читався так, ніби makePlan налаштовує контейнери,
   * хоча вплив мав лише mockBridge. Знайдено вмиканням noUnusedParameters
   * 2026-08-05.
   */
  async function makePlan(requests: any[]) {
    const handlers = captureHandlers();
    const data = dataOf(await handlers.get("corrections_plan")!({ requests, pageOffset: 0 }));
    return { handlers, planId: data.planId as string, items: data.items as PlanItem[] };
  }

  it("веде ланцюг loadPlan → runJsx: назва документа, порядок і очікуваний текст", async () => {
    const text = "Kyiv - stolytsia Ukrainy, i tse misto pomylka tut.";
    const { applyCalls } = mockBridge({ containers: [container(text)] });
    const { handlers, planId, items } = await makePlan(
      [
        { id: "r1", action: "replace", old: "Kyiv", new: "Lviv" },
        { id: "r2", action: "replace", old: "pomylka", new: "vypravleno" },
      ],
    );

    const result = await handlers.get("corrections_apply")!({
      planId,
      accept: items.map((i) => ({ requestId: i.id, candidateId: i.candidates[0]!.candidateId })),
      undoName: "Правки коректора",
    });

    expect(result.isError).toBeFalsy();
    expect(applyCalls).toHaveLength(1);
    const params = applyCalls[0]!;
    expect(params.expectedDocName).toBe("test.indd");
    expect(params.undoName).toBe("Правки коректора");
    // За спаданням офсетів у межах контейнера — інакше попередні позиції зсунулись би.
    expect(params.edits.map((e: any) => e.requestId)).toEqual(["r2", "r1"]);
    expect(params.edits[0]!.expectedOld).toBe("pomylka");
    expect(params.edits[0]!.newText).toBe("vypravleno");
  });

  it("правки, що перетинаються, відхиляються ДО будь-якого запису", async () => {
    const text = "Kyiv - stolytsia Ukrainy.";
    const { applyCalls } = mockBridge({ containers: [container(text)] });
    const { handlers, planId, items } = await makePlan(
      [
        { id: "r1", action: "replace", old: "Kyiv - stolytsia", new: "Lviv - misto" },
        { id: "r2", action: "replace", old: "stolytsia Ukrainy", new: "misto Ukrainy" },
      ],
    );

    const result = await handlers.get("corrections_apply")!({
      planId,
      accept: items.map((i) => ({ requestId: i.id, candidateId: i.candidates[0]!.candidateId })),
      undoName: "Тест",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/overlap one another/);
    expect(applyCalls).toHaveLength(0);
  });

  it("таймаут запису описується чесно: скрипт міг доїхати, копія в _backups/", async () => {
    const text = "Kyiv - stolytsia Ukrainy.";
    mockBridge({ containers: [container(text)] });
    const { handlers, planId, items } = await makePlan(
      [{ id: "r1", action: "replace", old: "Kyiv", new: "Lviv" }],
    );

    runJsxMock.mockImplementation(async (handler: string) => {
      if (handler === "apply_edits") {
        throw new IndesignError("busy", "InDesign не відповідає", "Закрийте модальне вікно.");
      }
      throw new Error(`несподіваний обробник ${handler}`);
    });

    const result = await handlers.get("corrections_apply")!({
      planId,
      accept: [{ requestId: "r1", candidateId: items[0]!.candidates[0]!.candidateId }],
      undoName: "Тест",
    });

    expect(result.isError).toBe(true);
    const out = result.content[0]!.text;
    expect(out).toMatch(/NOT aborted by that/);
    expect(out).toMatch(/_backups\//);
  });

  /*
   * Finding 2 (рецензія): нічого не забороняло accept із тим самим requestId
   * двічі (два різних candidateId). Якщо один потрапляв у report.applied, а
   * інший — у skipped/failed, buildReportTable виробляв ОДНОЧАСНО AppliedRow
   * і DisputedItem для того самого id; buildTable перевіряє byApplied
   * першим і продовжує — спірний рядок губився, і запит виглядав як чистий
   * успіх. Ловимо на вході, ДО будь-якого запису (applyCalls лишається
   * порожнім).
   */
  it("подвійний requestId в accept відхиляється ДО будь-якого запису", async () => {
    const text = "Kyiv - stolytsia Ukrainy.";
    const { applyCalls } = mockBridge({ containers: [container(text)] });
    const { handlers, planId, items } = await makePlan(
      [{ id: "r1", action: "replace", old: "Kyiv", new: "Lviv" }],
    );

    const result = await handlers.get("corrections_apply")!({
      planId,
      accept: [
        { requestId: "r1", candidateId: items[0]!.candidates[0]!.candidateId },
        { requestId: "r1", candidateId: items[0]!.candidates[0]!.candidateId },
      ],
      undoName: "Тест",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/is repeated in accept/);
    expect(applyCalls).toHaveLength(0);
  });

  /*
   * Finding 3 (рецензія): saveNextNumber виконується ПІСЛЯ runWrite, тобто
   * після того, як правки вже фізично лягли в документ. Якщо запис
   * лічильника впаде (диск, права доступу), увесь звіт — table, diffs,
   * applied warnings — не мав би губитися: втрата нумерації прикра, а
   * втрата звіту про вже виконаний запис — ні. Ламаємо збереження по-справжньому
   * (не мокаємо модуль): кладемо файл на місце теки numbering/, щоб
   * fs.mkdir(..., {recursive:true}) кинув EEXIST.
   */
  it("помилка збереження лічильника не губить звіт про вже виконаний запис", async () => {
    const text = "Kyiv - stolytsia Ukrainy.";
    mockBridge({ containers: [container(text)] });
    const { handlers, planId, items } = await makePlan(
      [{ id: "r1", action: "replace", old: "Kyiv", new: "Lviv" }],
    );
    const candidateId = items[0]!.candidates[0]!.candidateId;

    mockBridge({
      containers: [container(text)],
      report: { ...baseReport, applied: [{ requestId: "r1", candidateId }] },
    });

    // На місці теки numbering/ лежить звичайний файл — mkdir(recursive:true) кине EEXIST.
    await writeFile(join(home, "numbering"), "не тека");

    const data = dataOf(
      await handlers.get("corrections_apply")!({
        planId,
        accept: [{ requestId: "r1", candidateId }],
        undoName: "Тест",
      }),
    );

    expect(data.numberingError).toBeTruthy();
    expect(data.table).toBeTruthy();
    expect(data.table.entries).toHaveLength(1);
    expect(data.applied).toHaveLength(1);
  });

  it("невідомий planId повертається помилкою, а не винятком протоколу", async () => {
    mockBridge({ containers: [container("текст")] });
    const result = await captureHandlers().get("corrections_apply")!({
      planId: "nemaie-takoho-planu",
      accept: [],
      undoName: "Тест",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/not found/);
  });

  /*
   * T3: спек §4.5 називає «які story СТАЛИ overset» і «скільки сторінок
   * перебилося» головною практичною цінністю звіту, а ApplyReport віддавав
   * oversetBefore/After і pageCountBefore/After сирими — зміну легко проґавити.
   */
  it("звіт містить дифи overset і сторінок (T3)", async () => {
    const text = "Kyiv - stolytsia Ukrainy.";
    mockBridge({
      containers: [container(text)],
      report: {
        ...baseReport,
        oversetBefore: ["story:1", "story:2"],
        oversetAfter: ["story:2", "story:7"],
        pageCountBefore: 10,
        pageCountAfter: 12,
      },
    });
    const { handlers, planId, items } = await makePlan(
      [{ id: "r1", action: "replace", old: "Kyiv", new: "Lviv" }],
    );

    const data = dataOf(
      await handlers.get("corrections_apply")!({
        planId,
        accept: [{ requestId: "r1", candidateId: items[0]!.candidates[0]!.candidateId }],
        undoName: "Тест",
      }),
    );

    expect(data.diffs).toEqual({
      becameOverset: ["story:7"],
      noLongerOverset: ["story:1"],
      pageCountDelta: 2,
    });
  });

  /*
   * T-trim. Попередження про обрізку діапазону по межі абзацу мусить дійти
   * до оператора ОБОМА шляхами (брифінг, вимога 2): у corrections_plan воно
   * вже є на кандидаті (перевірено в planner.test.ts), а тут — що те саме
   * попередження не губиться в звіті corrections_apply, а йде разом із
   * конкретною застосованою правкою.
   */
  it("звіт corrections_apply несе попередження candidate.warnings для застосованих правок (T-trim)", async () => {
    const twoParagraphs = "Persha fraza abzatsu.\rDruhyi abzats tut.";
    mockBridge({ containers: [container(twoParagraphs)] });
    const { handlers, planId, items } = await makePlan(
      [{ id: "r1", action: "replace", old: "abzatsu. ", new: "abzatsu, " }],
    );
    const candidateId = items[0]!.candidates[0]!.candidateId;
    expect(items[0]!.candidates[0]!.warnings).toContain("possible-stray-space");

    // Перебудовуємо мок ЩЕ РАЗ — тепер із report.applied, що відповідає
    // прийнятому кандидату (заглушка apply_edits не знає про нього сама).
    mockBridge({
      containers: [container(twoParagraphs)],
      report: { ...baseReport, applied: [{ requestId: "r1", candidateId }] },
    });

    const data = dataOf(
      await handlers.get("corrections_apply")!({
        planId,
        accept: [{ requestId: "r1", candidateId }],
        undoName: "Тест",
      }),
    );

    expect(data.applied).toHaveLength(1);
    expect(data.applied[0]!.warnings).toContain("clamped-to-paragraph");
    expect(data.applied[0]!.warnings).toContain("possible-stray-space");
  });
});

describe("attachAppliedWarnings (T-trim)", () => {
  function plan(candidates: Partial<Record<string, unknown>>[]): any {
    return {
      planId: "p1",
      createdAt: "now",
      docName: "t.indd",
      items: [
        {
          id: "r1",
          status: "unique",
          request: { id: "r1", action: "replace", old: "x", new: "y" },
          candidates,
          suggestions: [],
        },
      ],
    };
  }

  it("бере warnings кандидата за requestId+candidateId і додає до applied", () => {
    const p = plan([{ candidateId: "r1#0", warnings: ["clamped-to-paragraph", "possible-stray-space"] }]);
    const outcome = withDiffs({ ...baseReport, applied: [{ requestId: "r1", candidateId: "r1#0" }] });

    const out = attachAppliedWarnings(outcome, p);

    expect(out.applied[0]!.warnings).toEqual(["clamped-to-paragraph", "possible-stray-space"]);
  });

  it("кандидат без попереджень — порожній масив, а не відсутнє поле", () => {
    const p = plan([{ candidateId: "r1#0", warnings: [] }]);
    const outcome = withDiffs({ ...baseReport, applied: [{ requestId: "r1", candidateId: "r1#0" }] });

    const out = attachAppliedWarnings(outcome, p);

    expect(out.applied[0]!.warnings).toEqual([]);
  });
});

describe("withDiffs (T3)", () => {
  it("без змін дає порожні списки й нульовий діф", () => {
    const out = withDiffs({ ...baseReport, oversetBefore: ["story:1"], oversetAfter: ["story:1"] });
    expect(out.diffs).toEqual({ becameOverset: [], noLongerOverset: [], pageCountDelta: 0 });
  });

  it("від'ємний діф сторінок — текст ущільнився", () => {
    const out = withDiffs({ ...baseReport, pageCountBefore: 12, pageCountAfter: 10 });
    expect(out.diffs.pageCountDelta).toBe(-2);
  });

  it("сирі поля лишаються на місці — звіт нічого не втрачає", () => {
    const out = withDiffs({ ...baseReport, oversetAfter: ["story:3"], pageCountAfter: 11 });
    expect(out.oversetBefore).toEqual([]);
    expect(out.oversetAfter).toEqual(["story:3"]);
    expect(out.pageCountBefore).toBe(10);
    expect(out.pageCountAfter).toBe(11);
  });
});

function plan(): Plan {
  return {
    planId: "p1",
    createdAt: "2026-08-04T10:00:00.000Z",
    docName: "Книга.indd",
    items: [
      {
        id: "r1", status: "unique", suggestions: [],
        request: { id: "r1", action: "replace", old: "знаннь", new: "знання" },
        candidates: [{
          candidateId: "r1#0", containerId: "story:1", start: 10, end: 16, page: "12",
          contextBefore: "", matchText: "знаннь", contextAfter: "",
          warnings: [], writeText: "знання", normalizations: [],
        }],
      },
      {
        id: "r2", status: "already_applied", suggestions: [], candidates: [],
        request: { id: "r2", action: "replace", old: "мамо", new: "мамою" },
        appliedAt: {
          containerId: "story:1", start: 40, end: 45, page: "13",
          contextBefore: "", matchText: "мамою", contextAfter: "",
        },
      },
      {
        id: "r3", status: "not_found", suggestions: [], candidates: [],
        request: { id: "r3", action: "replace", old: "нема", new: "є" },
      },
    ],
  };
}

const emptyReport = {
  backupPath: "/tmp/копія.indd", backupsRemoved: 0, backupRotationError: null,
  oversetBefore: [], oversetAfter: [], pageCountBefore: 1, pageCountAfter: 1,
};

describe("buildReportTable", () => {
  it("внесена правка бере сторінку й тексти з кандидата плану", () => {
    const report: ApplyReport = {
      ...emptyReport,
      applied: [{ requestId: "r1", candidateId: "r1#0" }],
      skipped: [], failed: [],
    };
    const { table } = buildReportTable(plan(), report, ["r1"], 100);
    expect(table.entries).toHaveLength(1);
    expect(table.entries[0]).toMatchObject({
      number: 100, kind: "applied", page: "12", before: "знаннь", after: "знання",
    });
  });

  it("skipped стає спірним із причиною text-changed", () => {
    const report: ApplyReport = {
      ...emptyReport,
      applied: [],
      skipped: [{ requestId: "r1", candidateId: "r1#0", reason: "текст змінився", expected: "знаннь", actual: "знання" }],
      failed: [],
    };
    const { table } = buildReportTable(plan(), report, ["r1"], 1);
    expect(table.entries[0]!.kind).toBe("disputed");
    expect(table.entries[0]!.reason).toBe("text-changed");
  });

  it("failed стає спірним із причиною write-failed", () => {
    const report: ApplyReport = {
      ...emptyReport,
      applied: [], skipped: [],
      failed: [{ requestId: "r1", candidateId: "r1#0", reason: "шар заблоковано" }],
    };
    const { table } = buildReportTable(plan(), report, ["r1"], 1);
    expect(table.entries[0]!.reason).toBe("write-failed");
    expect(table.entries[0]!.explanation).toContain("заблокован");
  });

  it("already_applied не спірна і не внесена — третій вид", () => {
    const report: ApplyReport = { ...emptyReport, applied: [], skipped: [], failed: [] };
    const { table } = buildReportTable(plan(), report, ["r2"], 1);
    expect(table.entries[0]!.kind).toBe("already-applied");
    expect(table.entries[0]!.page).toBe("13");
  });

  it("неподані пункти плану йдуть у notSubmitted, а не в спірні", () => {
    const report: ApplyReport = {
      ...emptyReport,
      applied: [{ requestId: "r1", candidateId: "r1#0" }], skipped: [], failed: [],
    };
    const { table } = buildReportTable(plan(), report, ["r1"], 1);
    expect(table.notSubmitted.sort()).toEqual(["r2", "r3"]);
    expect(table.counts.disputed).toBe(0);
  });

  it("баланс сходиться: кожен поданий запит рівно в одному списку", () => {
    const report: ApplyReport = {
      ...emptyReport,
      applied: [{ requestId: "r1", candidateId: "r1#0" }], skipped: [], failed: [],
    };
    const { reconciliation } = buildReportTable(plan(), report, ["r1", "r3"], 1);
    expect(reconciliation.balanced).toBe(true);
    expect(reconciliation.missing).toEqual([]);
  });

  /*
   * Finding 1 (рецензія): пункт плану ambiguous несе кілька кандидатів, і
   * оператор explicit обирає один candidateId через accept. Якщо
   * pushDisputed ігнорує candidateId зі звіту й бере candidates[0], спірний
   * рядок покаже сторінку й текст ЧУЖОГО кандидата — на великій книзі це
   * веде оператора не туди.
   */
  it("спірний рядок бере сторінку й текст із ОБРАНОГО кандидата, а не candidates[0]", () => {
    const p: Plan = {
      planId: "p2",
      createdAt: "2026-08-04T10:00:00.000Z",
      docName: "Книга.indd",
      items: [
        {
          id: "r1", status: "ambiguous", suggestions: [],
          request: { id: "r1", action: "replace", old: "мама", new: "мамо" },
          candidates: [
            {
              candidateId: "r1#0", containerId: "story:1", start: 5, end: 9, page: "5",
              contextBefore: "", matchText: "мама-нульова", contextAfter: "",
              warnings: [], writeText: "мамо-нульова", normalizations: [],
            },
            {
              candidateId: "r1#1", containerId: "story:2", start: 20, end: 24, page: "50",
              contextBefore: "", matchText: "мама-обрана", contextAfter: "",
              warnings: [], writeText: "мамо-обрана", normalizations: [],
            },
          ],
        },
      ],
    };

    const failedReport: ApplyReport = {
      ...emptyReport,
      applied: [], skipped: [],
      failed: [{ requestId: "r1", candidateId: "r1#1", reason: "шар заблоковано" }],
    };
    const { table: failedTable } = buildReportTable(p, failedReport, ["r1"], 1);
    expect(failedTable.entries[0]!.page).toBe("50");
    expect(failedTable.entries[0]!.before).toBe("мама-обрана");

    const skippedReport: ApplyReport = {
      ...emptyReport,
      applied: [], failed: [],
      skipped: [{ requestId: "r1", candidateId: "r1#1", reason: "текст змінився", expected: "мама-обрана", actual: "щось інше" }],
    };
    const { table: skippedTable } = buildReportTable(p, skippedReport, ["r1"], 1);
    expect(skippedTable.entries[0]!.page).toBe("50");
    expect(skippedTable.entries[0]!.before).toBe("мама-обрана");
  });
});

/*
 * expectedDocName — необов'язковий параметр, доданий 2026-08-05 на рішення
 * користувача. Ланцюжок «вимір → звірка → apply.jsx:263» і без нього не давав
 * записати правку в чужий документ; чого бракувало — можливості сказати
 * НАПЕРЕД, який документ мається на увазі. Якщо активною була робоча книжка
 * користувача, інструменти спокійно працювали з нею, і дізнатися про це можна
 * було лише постфактум, із docName у відповіді.
 *
 * Перевіряється саме те, що легко зробити неправильно: не «функція звірки
 * кидає помилку» (це тривіально), а що інструмент кличе її ДО запису — тобто
 * apply_edits не дістає жодного виклику. Тест із самою лише перевіркою
 * isError проходив би й тоді, коли документ уже зіпсовано, а помилку віддано
 * після.
 */
describe("expectedDocName (запобіжник виклику)", () => {
  it("чужа назва зупиняє corrections_apply ДО запису: apply_edits не викликано", async () => {
    const text = "Kyiv - stolytsia Ukrainy.";
    const { applyCalls } = mockBridge({ containers: [container(text)] });
    const handlers = captureHandlers();
    const data = dataOf(
      await handlers.get("corrections_plan")!({
        requests: [{ id: "r1", action: "replace", old: "Kyiv", new: "Lviv" }],
        pageOffset: 0,
      }),
    );
    const items = data.items as PlanItem[];

    const result = await handlers.get("corrections_apply")!({
      planId: data.planId,
      accept: items.map((i) => ({ requestId: i.id, candidateId: i.candidates[0]!.candidateId })),
      undoName: "Правки коректора",
      expectedDocName: "чужа-книжка.indd",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("чужа-книжка.indd");
    expect(result.content[0]!.text).toContain("test.indd");
    /* Головне твердження тесту: до запису не дійшло взагалі. */
    expect(applyCalls).toHaveLength(0);
  });

  it("правильна назва не заважає: запис відбувається як завжди", async () => {
    const text = "Kyiv - stolytsia Ukrainy.";
    const { applyCalls } = mockBridge({ containers: [container(text)] });
    const handlers = captureHandlers();
    const data = dataOf(
      await handlers.get("corrections_plan")!({
        requests: [{ id: "r1", action: "replace", old: "Kyiv", new: "Lviv" }],
        pageOffset: 0,
      }),
    );
    const items = data.items as PlanItem[];

    const result = await handlers.get("corrections_apply")!({
      planId: data.planId,
      accept: items.map((i) => ({ requestId: i.id, candidateId: i.candidates[0]!.candidateId })),
      undoName: "Правки коректора",
      expectedDocName: "test.indd",
    });

    expect(result.isError).toBeFalsy();
    expect(applyCalls).toHaveLength(1);
  });

  it("без параметра поведінка не змінюється — зворотна сумісність", async () => {
    const text = "Kyiv - stolytsia Ukrainy.";
    const { applyCalls } = mockBridge({ containers: [container(text)] });
    const handlers = captureHandlers();
    const data = dataOf(
      await handlers.get("corrections_plan")!({
        requests: [{ id: "r1", action: "replace", old: "Kyiv", new: "Lviv" }],
        pageOffset: 0,
      }),
    );
    const items = data.items as PlanItem[];

    const result = await handlers.get("corrections_apply")!({
      planId: data.planId,
      accept: items.map((i) => ({ requestId: i.id, candidateId: i.candidates[0]!.candidateId })),
      undoName: "Правки коректора",
    });

    expect(result.isError).toBeFalsy();
    expect(applyCalls).toHaveLength(1);
  });
});

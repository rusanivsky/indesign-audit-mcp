import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LineMeasure, MeasureResult } from "../../src/composition/types.js";
import type { Tools } from "../../src/tools/shared.js";
import { line } from "./helpers/composition.js";

/*
 * Рецензія: сам обробник `composition_audit` не мав жодного юніта — виклик
 * `composition_pages`, цикл вікон, облік `windowsDone`, гілка перерваного
 * прогону, перевірка `ratio` до виміру й проводка busy → describeMeasureTimeout
 * досягались лише через живий InDesign. Це чиста TypeScript-логіка: підміняємо
 * міст (`runJsx`) і перехоплюємо обробник підробленим «сервером» — той самий
 * патерн, що в tests/unit/tools-corrections.test.ts.
 */
const { runJsxMock } = vi.hoisted(() => ({ runJsxMock: vi.fn() }));
vi.mock("../../src/bridge/runner.js", () => ({ runJsx: runJsxMock }));

const { IndesignError } = await import("../../src/bridge/errors.js");
const { registerCompositionTools, PAGE_WINDOW } = await import("../../src/tools/composition.js");

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
type AnyHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

function auditHandler(): AnyHandler {
  let captured: AnyHandler | null = null;
  const fakeServer = {
    registerTool: (name: string, _config: unknown, handler: AnyHandler) => {
      if (name === "composition_audit") captured = handler;
    },
  } as unknown as Tools;
  registerCompositionTools(fakeServer);
  if (captured === null) throw new Error("composition_audit не зареєстровано");
  return captured;
}

/** Zod-замовчування підробленим сервером не застосовуються — задаємо явно. */
const ARGS = {
  spacingMode: "survey",
  warnBandPct: 0,
  shortLastLineFraction: 0.15,
  minWordChars: 4,
  maxLadder: 2,
  riverMinRows: 4,
  riverTolerancePt: 0,
  riverMinChannelPt: 0,
  riverJustifiedOnly: false,
  includeMasters: false,
  perDefectLimit: 5,
  pageWindow: PAGE_WINDOW,
} as const;

const dataOf = (r: ToolResult) => JSON.parse(r.content[0]!.text);
const textOf = (r: ToolResult) => r.content[0]!.text;

/**
 * Вимір одного вікна: по одному рядку на кожну замовлену сторінку.
 *
 * `paragraphIndex` виводиться з НОМЕРА СТОРІНКИ, а не з позиції у вікні, і це
 * не дрібниця: адреса рядка — це (контейнер, абзац, рядок), тож нумерація від
 * нуля в кожному вікні дала б однакові адреси в різних вікнах, і злиття
 * законно склеїло б їх в один рядок. Перша редакція цієї фікстури мала саме цю
 * ваду, і тест на кількість рядків її й показав.
 */
function windowResult(pages: string[]): MeasureResult {
  const lines: LineMeasure[] = pages.map((page) =>
    line({ spaceWidth: 2.6, isLast: false, page, paragraphIndex: Number(page) }),
  );
  return { docName: "Книга.indd", pages, lines, unmeasured: [], measurementUnit: "points" };
}

/** Стандартна відповідь моста: перелік сторінок + вимір кожного вікна. */
function respondWith(pageNames: string[]): void {
  runJsxMock.mockImplementation(async (handler: string, params: { pages?: string[] }) => {
    if (handler === "composition_pages") return { docName: "Книга.indd", pages: pageNames };
    if (handler === "composition_measure") return windowResult(params.pages ?? []);
    throw new Error(`несподіваний обробник ${handler}`);
  });
}

const pageNames = (n: number): string[] => Array.from({ length: n }, (_, i) => String(i + 1));

beforeEach(() => {
  runJsxMock.mockReset();
});

describe("composition_audit — режим «весь документ»", () => {
  it("бере перелік сторінок у composition_pages, а не в doc_overview", async () => {
    respondWith(pageNames(3));
    await auditHandler()({ ...ARGS });

    const handlers = runJsxMock.mock.calls.map((c) => c[0]);
    expect(handlers).toContain("composition_pages");
    expect(handlers).not.toContain("doc_overview");
  });

  it("ріже документ на вікна заданого розміру й міряє кожне окремо", async () => {
    respondWith(pageNames(5));
    const r = dataOf(await auditHandler()({ ...ARGS, pageWindow: 2 }));

    const measured = runJsxMock.mock.calls
      .filter((c) => c[0] === "composition_measure")
      .map((c) => (c[1] as { pages: string[] }).pages);
    expect(measured).toEqual([["1", "2"], ["3", "4"], ["5"]]);
    expect(r.scope.windows).toBe(3);
    expect(r.scope.windowsDone).toBe(3);
    expect(r.scope.partial).toBe(false);
    expect(r.scope.requestedPages).toBeNull();
    expect(r.scope.linesReturned).toBe(5);
  });

  it("веде вимір із власним таймаутом вікна, а не з типовим таймаутом моста", async () => {
    respondWith(pageNames(2));
    await auditHandler()({ ...ARGS });

    const call = runJsxMock.mock.calls.find((c) => c[0] === "composition_measure")!;
    expect((call[2] as { timeoutMs: number }).timeoutMs).toBeGreaterThan(30_000);
  });
});

describe("composition_audit — явний перелік сторінок", () => {
  it("не питає переліку сторінок і міряє саме замовлені", async () => {
    respondWith([]);
    const r = dataOf(await auditHandler()({ ...ARGS, pages: ["12", "13"] }));

    expect(runJsxMock.mock.calls.map((c) => c[0])).not.toContain("composition_pages");
    expect(r.scope.requestedPages).toEqual(["12", "13"]);
    expect(r.warnings.join(" ")).toMatch(/narrowed/i);
  });

  it("порожній перелік означає «весь документ», а не «жодної сторінки»", async () => {
    respondWith(pageNames(2));
    const r = dataOf(await auditHandler()({ ...ARGS, pages: [] }));

    expect(runJsxMock.mock.calls.map((c) => c[0])).toContain("composition_pages");
    expect(r.scope.requestedPages).toBeNull();
  });
});

describe("composition_audit — перерваний прогін", () => {
  it("зберігає зібране, позначає partial і називає сторінку зупинки", async () => {
    runJsxMock.mockImplementation(async (handler: string, params: { pages?: string[] }) => {
      if (handler === "composition_pages") return { docName: "Книга.indd", pages: pageNames(5) };
      const pages = params.pages ?? [];
      if (pages[0] === "3") {
        throw new IndesignError("busy", "InDesign не відповів", "Закрийте вікно.");
      }
      return windowResult(pages);
    });

    const r = dataOf(await auditHandler()({ ...ARGS, pageWindow: 2 }));
    expect(r.scope.partial).toBe(true);
    expect(r.scope.stoppedAt).toBe("3");
    expect(r.scope.windows).toBe(3);
    expect(r.scope.windowsDone).toBe(1);
    expect(r.scope.stoppedReason).toMatch(/не відповів/);
    /* Форма звіту та сама — споживач не мусить розгалужуватись. */
    expect(r.findingsByScale).toBeDefined();
    expect(r.spacing.baseRate).toBeDefined();
    expect(r.warnings.join(" ")).toMatch(/INCOMPLETE/);
  });

  it("збій ПЕРШОГО вікна не вдає часткового успіху", async () => {
    runJsxMock.mockImplementation(async (handler: string) => {
      if (handler === "composition_pages") return { docName: "Книга.indd", pages: pageNames(4) };
      throw new IndesignError("busy", "InDesign не відповів", "Закрийте вікно.");
    });

    const r = await auditHandler()({ ...ARGS, pageWindow: 2 });
    expect(r.isError).toBe(true);
  });
});

describe("composition_audit — помилки", () => {
  it("таймаут ЧИТАННЯ каже, що документ не змінено, і називає вікно", async () => {
    runJsxMock.mockImplementation(async (handler: string) => {
      if (handler === "composition_pages") return { docName: "Книга.indd", pages: pageNames(4) };
      throw new IndesignError("busy", "InDesign не відповів", "Закрийте вікно.");
    });

    const r = await auditHandler()({ ...ARGS, pageWindow: 2 });
    const text = textOf(r);
    expect(r.isError).toBe(true);
    expect(text).toMatch(/READING/);
    expect(text).toMatch(/document was not changed/i);
    /* Підказка мусить називати сторінки, на яких стало, а не «десь у документі». */
    expect(text).toMatch(/1–2/);
    /* І вести до звуження діапазону, а не до пошуку неіснуючого вікна. */
    expect(text).toMatch(/pageWindow|Звузьте/);
  });

  it("режим ratio без меж падає ДО того, як щось поміряно", async () => {
    respondWith(pageNames(20));
    const r = await auditHandler()({ ...ARGS, spacingMode: "ratio" });

    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/minRatio|maxRatio/);
    expect(runJsxMock).not.toHaveBeenCalled();
  });

  it("зіпсована структура від JSX стає помилкою з іменем поля, а не тихим NaN", async () => {
    runJsxMock.mockImplementation(async (handler: string, params: { pages?: string[] }) => {
      if (handler === "composition_pages") return { docName: "Книга.indd", pages: ["1"] };
      const r = windowResult(params.pages ?? []) as unknown as {
        lines: Record<string, unknown>[];
      };
      delete r.lines[0]!.columnWidth;
      return r;
    });

    const r = await auditHandler()({ ...ARGS });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/columnWidth/);
  });

  it("вікна з різних документів не зшиваються мовчки", async () => {
    let call = 0;
    runJsxMock.mockImplementation(async (handler: string, params: { pages?: string[] }) => {
      if (handler === "composition_pages") return { docName: "А.indd", pages: pageNames(4) };
      const res = windowResult(params.pages ?? []);
      res.docName = call++ === 0 ? "А.indd" : "Б.indd";
      return res;
    });

    const r = await auditHandler()({ ...ARGS, pageWindow: 2 });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/different documents/i);
  });
});

/**
 * Раунд виправлень 1 Задачі 10 Фази 4. Рецензент прогнав мутанти, що прибирають
 * `includeMasters` з `lineOpts`/`hyphenOpts`/`riverOpts`/`spacingOptionsOf` в
 * `analyse()` і з окремого `riverOpts` у `buildReport()` (той, що живить
 * `surveyRivers`) — усі вижили. Причина: наявні тести на `includeMasters`
 * (`tools-composition.test.ts`, `tools-composition-apply.test.ts`) проганяють
 * лише шлях `lineOpts` через знахідку `short-last-line`; три з чотирьох
 * об'єктів опцій не перевіряються НА РІВНІ ІНСТРУМЕНТА взагалі.
 *
 * Тести нижче будують фікстуру, де майстер-рядки дають дефект КОЖНОГО класу —
 * переносу, коридору, щільності, — і звіряють, що звіт `composition_audit`
 * бачить їх рівно тоді, коли `includeMasters: true`. Мутант, що прибирає
 * прокидання прапорця для однієї родини, провалює рівно її тест.
 */
describe("composition_audit — includeMasters доходить до КОЖНОГО детектора (Раунд 1)", () => {
  /** Один вимір на всю фікстуру — сторінка "1", ігнорує параметри запиту. */
  function respondWithLines(lines: LineMeasure[]): void {
    runJsxMock.mockImplementation(async (handler: string) => {
      if (handler === "composition_pages") return { docName: "Книга.indd", pages: ["1"] };
      if (handler === "composition_measure") {
        return { docName: "Книга.indd", pages: ["1"], lines, unmeasured: [], measurementUnit: "points" };
      }
      throw new Error(`несподіваний обробник ${handler}`);
    });
  }

  /** Усі дефекти, які звіт узагалі показав, пласким списком. */
  function defectsOf(r: ReturnType<typeof dataOf>): string[] {
    return (r.findingsByScale as { defects: { defect: string }[] }[]).flatMap((g) =>
      g.defects.map((d) => d.defect),
    );
  }

  it("детектор переносу (hyphenOpts у analyse()) — мутант 1", async () => {
    /* Драбина з трьох переносів підряд (поріг ARGS.maxLadder = 2), уся на
     * майстер-сторінці. `endsWithHyphen: false` на четвертому рядку розриває
     * прогін, як і в детекторному тесті. */
    const ladder = [0, 1, 2, 3].map((i) =>
      line({
        spaceWidth: 3.2,
        isLast: false,
        isMaster: true,
        containerId: "story:hyphen",
        paragraphIndex: 0,
        lineInParagraph: i,
        paragraphLineCount: 4,
        endsWithHyphen: i < 3,
      }),
    );

    respondWithLines(ladder);
    const off = dataOf(await auditHandler()({ ...ARGS, includeMasters: false }));
    expect(defectsOf(off)).not.toContain("hyphen-ladder");

    respondWithLines(ladder);
    const on = dataOf(await auditHandler()({ ...ARGS, includeMasters: true }));
    expect(defectsOf(on)).toContain("hyphen-ladder");
  });

  it("детектор коридорів (riverOpts у analyse(), режим survey) — мутант 2", async () => {
    /* Чотири рядки (ARGS.riverMinRows = 4) з проміжками, що перекриваються по
     * вертикалі, і зростаючою baseline — той самий патерн, що в
     * detect-rivers.test.ts, увесь на майстер-сторінці. */
    const corridor = [
      { gap: 50, baseline: 100 },
      { gap: 51, baseline: 112 },
      { gap: 50.5, baseline: 124 },
      { gap: 50.8, baseline: 136 },
    ].map(({ gap, baseline }, i) =>
      line({
        spaceWidth: 3.2,
        isLast: false,
        isMaster: true,
        containerId: "story:river",
        paragraphIndex: 1,
        lineInParagraph: i,
        paragraphLineCount: 8,
        gapsAt: [gap],
        baseline,
      }),
    );

    respondWithLines(corridor);
    const off = dataOf(await auditHandler()({ ...ARGS, includeMasters: false, spacingMode: "survey" }));
    expect(defectsOf(off)).not.toContain("river");

    respondWithLines(corridor);
    const on = dataOf(await auditHandler()({ ...ARGS, includeMasters: true, spacingMode: "survey" }));
    expect(defectsOf(on)).toContain("river");
  });

  it("детектор щільності (spacingOptionsOf) — мутант 3", async () => {
    /* Три калібрувальні кінцеві рядки того самого стилю плюс один невиключений
     * рядок за верхньою межею (той самий патерн, що в detect-spacing.test.ts,
     * «рядок за верхньою межею стилю — розріджений»), усі на майстер-сторінці. */
    const calibration = [0, 1, 2].map((i) =>
      line({
        spaceWidth: 3.2,
        isLast: true,
        isMaster: true,
        containerId: "story:spacing",
        paragraphIndex: i,
      }),
    );
    const outlier = line({
      spaceWidth: 4.5,
      isLast: false,
      isMaster: true,
      containerId: "story:spacing",
      paragraphIndex: 3,
    });
    const fixture = [...calibration, outlier];

    respondWithLines(fixture);
    const off = dataOf(
      await auditHandler()({ ...ARGS, includeMasters: false, spacingMode: "style-bounds" }),
    );
    expect(defectsOf(off)).not.toContain("loose");

    respondWithLines(fixture);
    const on = dataOf(
      await auditHandler()({ ...ARGS, includeMasters: true, spacingMode: "style-bounds" }),
    );
    expect(defectsOf(on)).toContain("loose");
  });

  it("surveyRivers у buildReport() рахує майстра в judged, не в excluded.master — мутант 4", async () => {
    /* Мінімальна фікстура: один вимірний майстер-рядок. Не потрібен коридор —
     * `riverJustifiedOnly: false` у ARGS означає, що судиться будь-який
     * вимірний рядок, коридор тут узагалі ні до чого. Мутант 4 живить окремий
     * `riverOpts`, який ОБРОБНИК (не `analyse()`) готує спеціально для
     * surveyRivers у buildReport() — саме тому findings тут не показові: вони
     * йдуть із riverOpts в analyse(), уже виправленого раніше, а це поле живе
     * окремо. */
    const master = { ...line({ spaceWidth: 2.6, isLast: false }), isMaster: true };

    respondWithLines([master]);
    const on = dataOf(await auditHandler()({ ...ARGS, includeMasters: true, spacingMode: "survey" }));
    expect(on.surveys.rivers.judged).toBe(1);
    expect(on.surveys.rivers.excluded.master).toBe(0);
  });
});

import { describe, expect, it, vi } from "vitest";
import type { Tools } from "../../src/tools/shared.js";

/*
 * `expectedDocName` у `typography_apply` і `composition_apply`.
 *
 * Третій інструмент запису, `corrections_apply`, покритий у
 * `tools-corrections.test.ts` — там уже є мокнутий міст і план, тож
 * переносити його сюди означало б дублювати інфраструктуру заради симетрії.
 *
 * ЧОМУ ЦЕЙ ФАЙЛ ІСНУЄ ОКРЕМО. Параметр додано в три інструменти одним рухом
 * 2026-08-05, і при цьому звірка в `typography_apply` спершу лягла НЕ ТУДИ —
 * у `typography_audit`, читальний інструмент, який параметра взагалі не має.
 * Компілятор це проковтнув би не завжди, але тест, який дивиться лише на
 * `isError`, — проковтнув би завжди: помилку віддали б, а от чи ДО запису,
 * з нього не видно. Тому тут перевіряється саме те, що `apply_edits` не
 * дістає ЖОДНОГО виклику.
 */
const { runJsxMock, runWriteMock } = vi.hoisted(() => ({
  runJsxMock: vi.fn(),
  runWriteMock: vi.fn(),
}));
vi.mock("../../src/bridge/runner.js", () => ({ runJsx: runJsxMock }));
vi.mock("../../src/bridge/envelope.js", () => ({ runWrite: runWriteMock }));

const { registerTypographyTools } = await import("../../src/tools/typography.js");
const { registerCompositionTools } = await import("../../src/tools/composition.js");

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
type AnyHandler = (args: any) => Promise<ToolResult>;

function handlersOf(register: (s: Tools) => void): Map<string, AnyHandler> {
  const handlers = new Map<string, AnyHandler>();
  register({
    registerTool: (name: string, _c: unknown, h: AnyHandler) => handlers.set(name, h),
  } as unknown as Tools);
  return handlers;
}

const MEASURED_DOC = "фікстура.indd";

/*
 * `oversetBefore`/`oversetAfter` — МАСИВИ ідентифікаторів, не лічильники:
 * `withDiffs` (`tools/corrections.ts:123`) будує з них Set і фільтрує. Числа
 * тут давали падіння всередині звіту, тобто тест скаржився б на щось зовсім
 * інше, ніж перевіряє.
 */
const WRITE_REPORT = {
  applied: [],
  skipped: [],
  failed: [],
  backupPath: "/tmp/фікстура-копія.indd",
  oversetBefore: [] as string[],
  oversetAfter: [] as string[],
  pageCountBefore: 1,
  pageCountAfter: 1,
};

const STORY_TEXT = 'Він сказав "привіт" мамі.\r';

/** Мінімальний вимір: одна історія, один рядок — знахідок не треба. */
function mockMeasure() {
  runJsxMock.mockImplementation(async (handler: string) => {
    if (handler === "containers_read") {
      return {
        docName: MEASURED_DOC,
        containers: [
          {
            containerId: "story:0",
            text: STORY_TEXT,
            pageRuns: [{ start: 0, end: 26, page: "1" }],
            oversetFrom: null,
            isMaster: false,
            kind: "text",
          },
        ],
      };
    }
    /*
     * Другий міст typography_apply/typography_audit тепер завжди читають:
     * гейт правопису 2019 стоїть на ПРАВИЛІ (scanContainers.ts), а не на
     * прапорці. Без цього мока readLanguageRuns() улучив би в
     * `несподіваний обробник` нижче, і обидва «щасливі» тести цього файлу
     * впали б не через те, що перевіряють.
     */
    if (handler === "language_runs_read") {
      return {
        docName: MEASURED_DOC,
        containers: [
          {
            containerId: "story:0",
            runs: [{ start: 0, end: STORY_TEXT.length, language: "Ukrainian" }],
          },
        ],
      };
    }
    if (handler === "composition_measure") {
      /* Усі п'ять полів MeasureResult: parseMeasureResult перевіряє структуру
       * й на неповній кидає власну помилку — тоді тест скаржився б на мок, а
       * не на звірку документа. */
      return {
        docName: MEASURED_DOC,
        pages: ["1"],
        lines: [],
        unmeasured: [],
        measurementUnit: "points",
      };
    }
    throw new Error(`несподіваний обробник ${handler}`);
  });
}

describe("expectedDocName — typography_apply", () => {
  it("чужа назва зупиняє ДО запису: runWrite не викликано", async () => {
    mockMeasure();
    runWriteMock.mockReset();
    const h = handlersOf(registerTypographyTools).get("typography_apply")!;

    const r = await h({
      ruleIds: ["quotes-uk"],
      includeNeedsReview: false,
      undoName: "Тест",
      expectedDocName: "чужа-книжка.indd",
    });

    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain("чужа-книжка.indd");
    expect(r.content[0]!.text).toContain(MEASURED_DOC);
    expect(runWriteMock).not.toHaveBeenCalled();
  });

  it("правильна назва запису не заважає", async () => {
    mockMeasure();
    runWriteMock.mockReset();
    runWriteMock.mockResolvedValue(WRITE_REPORT);
    const h = handlersOf(registerTypographyTools).get("typography_apply")!;

    const r = await h({
      ruleIds: ["quotes-uk"],
      includeNeedsReview: false,
      undoName: "Тест",
      expectedDocName: MEASURED_DOC,
    });

    expect(r.isError).toBeFalsy();
    expect(runWriteMock).toHaveBeenCalledTimes(1);
  });

  /*
   * Контрольний тест: без нього два попередні проходили б і на інструменті,
   * що не пише НІКОЛИ, — тобто перевіряли б порожнечу.
   */
  it("контроль: без параметра запис відбувається", async () => {
    mockMeasure();
    runWriteMock.mockReset();
    runWriteMock.mockResolvedValue(WRITE_REPORT);
    const h = handlersOf(registerTypographyTools).get("typography_apply")!;

    const r = await h({ ruleIds: ["quotes-uk"], includeNeedsReview: false, undoName: "Тест" });

    expect(r.isError).toBeFalsy();
    expect(runWriteMock).toHaveBeenCalledTimes(1);
  });
});

/*
 * ЧОМУ ТУТ, А НЕ В ОКРЕМОМУ ФАЙЛІ. Ця сценка ділить з іменем файла лише
 * мокнутий міст (runJsxMock) — сама перевірка про `expectedDocName` тут ні
 * до чого. `typography_audit` не мала ЖОДНОГО автоматизованого покриття:
 * `tools-expected-doc.test.ts` фетчить лише `typography_apply`, а
 * `tests/integration/typography-spelling2019.test.ts` викликає
 * `scanContainers`/`collectVariantPairs` НАПРЯМУ, обходячи сам зареєстрований
 * інструмент. Обробник виконувався рівно один раз — руками, під час виміру.
 * Найцінніша перевірка тут — що `ukrainianRuns` рахує `auditedLangs`
 * (діапазони НЕ майстер-контейнерів), а не `langs` (усі): підміна одного на
 * інше в обробнику (typography.ts) НЕ ловиться типами (обидва —
 * `ContainerLanguage[]`), тільки числом, і саме цей факт треба довести
 * виконанням, а не переказом.
 */
const AUDIT_DOC = "фікстура-аудит.indd";
/* «прое» перед «к» — гейтоване правило uk2019-proiekt; «ефір» і «етер» —
 * обидві форми однієї варіантної пари. Увесь текст — ОДИН український
 * діапазон, тож жоден зі збігів не перетинає межу мови. */
const AUDIT_TEXT = 'У проекті є ефір, а не етер.\r';
/* Майстровий контейнер несе СВІЙ український діапазон — саме він і має
 * зникнути з ukrainianRuns після фільтра на не-майстрові контейнери. Якби
 * фільтра не було (підміна auditedLangs → langs), цей діапазон долічився б. */
const MASTER_TEXT = 'Розділ.\r';

function mockMeasureForAudit() {
  runJsxMock.mockImplementation(async (handler: string) => {
    if (handler === "containers_read") {
      return {
        docName: AUDIT_DOC,
        containers: [
          {
            containerId: "story:0",
            text: AUDIT_TEXT,
            pageRuns: [{ start: 0, end: AUDIT_TEXT.length, page: "1" }],
            oversetFrom: null,
            isMaster: false,
            kind: "text",
          },
          {
            containerId: "master:0",
            text: MASTER_TEXT,
            pageRuns: [{ start: 0, end: MASTER_TEXT.length, page: "1" }],
            oversetFrom: null,
            isMaster: true,
            kind: "text",
          },
        ],
      };
    }
    if (handler === "language_runs_read") {
      return {
        docName: AUDIT_DOC,
        containers: [
          {
            containerId: "story:0",
            runs: [{ start: 0, end: AUDIT_TEXT.length, language: "Ukrainian" }],
          },
          {
            containerId: "master:0",
            runs: [{ start: 0, end: MASTER_TEXT.length, language: "Ukrainian" }],
          },
        ],
      };
    }
    throw new Error(`несподіваний обробник ${handler}`);
  });
}

describe("typography_audit — spelling2019", () => {
  it("усі п'ять полів присутні, ukrainianRuns рахує лише не-майстрові контейнери, пара — mixed", async () => {
    mockMeasureForAudit();
    const h = handlersOf(registerTypographyTools).get("typography_audit")!;

    const r = await h({ sampleSize: 10 });

    expect(r.isError).toBeFalsy();
    const body = JSON.parse(r.content[0]!.text);
    const s = body.spelling2019;

    /* Позитив: усі п'ять полів справді є в ключі, а не лише деякі. */
    expect(Object.keys(s).sort()).toEqual(
      ["caveat", "mixedCount", "pairs", "skippedByLanguage", "ukrainianRuns"].sort(),
    );

    /*
     * Твердження про фільтр: story:0 несе ОДИН український діапазон,
     * master:0 — ще один. `ukrainianRuns` мусить дорівнювати 1 (лише
     * story:0) — позитив, що не-майстровий діапазон порахований, і водночас
     * негатив, що майстровий — ні (інакше було б 2). Підміна
     * `auditedLangs` → `langs` у typography.ts (typography_audit) ловить це
     * число, не тип: `langs` тут теж `ContainerLanguage[]`.
     */
    expect(s.ukrainianRuns).toBe(1);
    /* Жоден збіг у цій фікстурі не перетинає межу мови — весь текст лежить в
     * одному діапазоні. */
    expect(s.skippedByLanguage).toBe(0);

    /* Позитив: пара, вжита ОБОМА формами, повертається mixed: true. */
    const pair = s.pairs.find((p: { pairId: string }) => p.pairId === "ефір/етер");
    expect(pair).toBeDefined();
    expect(pair.mixed).toBe(true);
    expect(s.mixedCount).toBeGreaterThanOrEqual(1);
    expect(typeof s.caveat).toBe("string");
    expect(s.caveat.length).toBeGreaterThan(0);
  });
});

describe("expectedDocName — composition_apply", () => {
  it("чужа назва зупиняє ДО запису: runWrite не викликано", async () => {
    mockMeasure();
    runWriteMock.mockReset();
    const h = handlersOf(registerCompositionTools).get("composition_apply")!;

    const r = await h({
      pages: ["1"],
      findingIds: ["будь-що"],
      undoName: "Тест",
      maxTracking: 20,
      dryRun: false,
      pageWindow: 20,
      spacingMode: "survey",
      expectedDocName: "чужа-книжка.indd",
    });

    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain("чужа-книжка.indd");
    expect(runWriteMock).not.toHaveBeenCalled();
  });

  /*
   * Тут контроль інший: із правильною назвою виклик має дійти ДАЛІ звірки —
   * до скарги на невідомий findingId. Саме це доводить, що звірка не блокує
   * законний шлях, і водночас не вимагає підробляти цілий вимір із знахідками.
   */
  it("правильна назва пропускає далі — скарга вже про findingIds, не про документ", async () => {
    mockMeasure();
    runWriteMock.mockReset();
    const h = handlersOf(registerCompositionTools).get("composition_apply")!;

    const r = await h({
      pages: ["1"],
      findingIds: ["немає-такої-знахідки"],
      undoName: "Тест",
      maxTracking: 20,
      dryRun: false,
      pageWindow: 20,
      spacingMode: "survey",
      expectedDocName: MEASURED_DOC,
    });

    expect(r.content[0]!.text).not.toContain("чужа-книжка.indd");
    expect(r.content[0]!.text).toMatch(/немає-такої-знахідки|findingId|знахідк/i);
    expect(runWriteMock).not.toHaveBeenCalled();
  });
});

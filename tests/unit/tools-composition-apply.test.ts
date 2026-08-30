import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Proposal } from "../../src/composition/propose.js";
import type { AcceptedEdit } from "../../src/corrections/types.js";
import type { LineMeasure, MeasureResult } from "../../src/composition/types.js";
import type { Tools } from "../../src/tools/shared.js";
import { line } from "./helpers/composition.js";

/*
 * Обробник `composition_apply` — єдиний у фазі, що ПИШЕ. Живий InDesign для
 * його логіки не потрібен і шкідливий: тут перевіряються рівно ті рішення, які
 * приймає TypeScript до й після запису — чотири обов'язки Задачі 13, вибір
 * «що взагалі писати», перемір і поведінка на збоях. Міст (`runJsx`) і конверт
 * запису (`runWrite`) підмінені, як у tools-composition-handler.test.ts.
 */
const { runJsxMock, runWriteMock } = vi.hoisted(() => ({
  runJsxMock: vi.fn(),
  runWriteMock: vi.fn(),
}));
vi.mock("../../src/bridge/runner.js", () => ({ runJsx: runJsxMock }));
vi.mock("../../src/bridge/envelope.js", () => ({ runWrite: runWriteMock }));

const { registerCompositionTools, dedupeTracking, analyse, coalesceEdits } = await import(
  "../../src/tools/composition.js"
);

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
type AnyHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

function applyHandler(): AnyHandler {
  let captured: AnyHandler | null = null;
  const fakeServer = {
    registerTool: (name: string, _config: unknown, handler: AnyHandler) => {
      if (name === "composition_apply") captured = handler;
    },
  } as unknown as Tools;
  registerCompositionTools(fakeServer);
  if (captured === null) throw new Error("composition_apply не зареєстровано");
  return captured;
}

const body = (r: ToolResult) => JSON.parse(r.content[0]!.text);

/** Zod-замовчування підробленим сервером не застосовуються — задаємо явно. */
const ARGS = {
  undoName: "Тест",
  maxTracking: 20,
  dryRun: false,
  spacingMode: "survey" as const,
  warnBandPct: 0,
  shortLastLineFraction: 0.15,
  minWordChars: 4,
  maxLadder: 3,
  riverMinRows: 3,
  riverTolerancePt: 1.5,
  riverMinChannelPt: 0,
  riverJustifiedOnly: false,
  includeMasters: false,
  pageWindow: 20,
};

const DOC = "kniha.indd";

type Opts = Parameters<typeof line>[0];
const ln = (over: Partial<Opts> = {}): LineMeasure =>
  line({ spaceWidth: 3.2, isLast: false, page: "12", columnWidth: 200, ...over });

/**
 * Абзац із двох рядків, останній із яких закороткий (одне слово «аб» — 10 пт
 * із 200, тобто 5%), — це `short-last-line`, тобто ТРЕКІНГОВЕ виправлення.
 * Саме воно потрібне, щоб перевірити дедуплікацію й перемір без знімків тексту.
 */
function shortLastParagraph(paragraphIndex: number, containerId = "story:0"): LineMeasure[] {
  const common = { containerId, paragraphIndex, paragraphLineCount: 2 };
  return [
    ln({ ...common, lineInParagraph: 0, words: 7 }),
    ln({ ...common, lineInParagraph: 1, words: 1, endsParagraph: true }),
  ];
}

function measureOf(lines: LineMeasure[]): MeasureResult {
  return { docName: DOC, pages: ["12"], lines, unmeasured: [], measurementUnit: "points" };
}

const WRITE_OK = {
  backupPath: "/шлях/копія.indd",
  backupsRemoved: 0,
  backupRotationError: null,
  applied: [],
  skipped: [],
  failed: [],
  trackingApplied: [{ containerId: "story:0", paragraphIndex: 0, delta: -5 }],
  trackingFailed: [],
  oversetBefore: [],
  oversetAfter: [],
  pageCountBefore: 1,
  pageCountAfter: 1,
};

/** Черга відповідей моста: composition_measure (до), containers_read, composition_measure (після). */
function bridge(before: MeasureResult, containers: unknown[], after: MeasureResult): void {
  let measures = 0;
  runJsxMock.mockImplementation(async (handler: string) => {
    if (handler === "containers_read") return { docName: DOC, containers };
    if (handler === "composition_measure") return measures++ === 0 ? before : after;
    throw new Error(`несподіваний обробник ${handler}`);
  });
}

beforeEach(() => {
  runJsxMock.mockReset();
  runWriteMock.mockReset();
  runWriteMock.mockResolvedValue(WRITE_OK);
});

/*
 * `analyse` — спільний конвеєр аудиту й застосування. Доти його відсів жив
 * усередині `buildReport` і не мав жодного прямого тесту: мутаційний прогін
 * показав, що ні порядок фільтрів, ні те, ПО ЯКИХ рядках калібрується документ,
 * не перевіряв ніхто. Обидва питання не косметичні — від них залежить, які
 * саме знахідки народяться, тобто які ідентифікатори побачить оператор.
 */
describe("analyse — відсів рядків до детекторів", () => {
  const DETECTION = {
    spacingMode: "survey" as const,
    warnBandPct: 0,
    shortLastLineFraction: 0.15,
    minWordChars: 4,
    maxLadder: 3,
    riverMinRows: 3,
    riverTolerancePt: 1.5,
    riverMinChannelPt: 0,
    riverJustifiedOnly: false,
    includeMasters: false,
  };

  /** Короткий кінцевий рядок: сам собою це знахідка `short-last-line`. */
  const shortLast = (over: Partial<Opts> = {}) =>
    ln({ lineInParagraph: 1, paragraphLineCount: 2, words: 1, endsParagraph: true, ...over });

  it("рядок майстер-сторінки не доходить до детекторів і не породжує знахідки", () => {
    const master = { ...shortLast(), isMaster: true };
    const a = analyse(measureOf([master]), DETECTION);

    expect(a.dropped.master).toBe(1);
    expect(a.analysed).toEqual([]);
    expect(a.findings).toEqual([]);
  });

  it("із includeMasters той самий рядок судиться нарівні з рештою", () => {
    const master = { ...shortLast(), isMaster: true };
    const a = analyse(measureOf([master]), { ...DETECTION, includeMasters: true });

    expect(a.dropped.master).toBe(0);
    expect(a.findings.map((f) => f.defect)).toEqual(["short-last-line"]);
  });

  it("зіпсований МАЙСТЕР лічиться майстром, а не розсинхроном — порядок фільтрів значущий", () => {
    /*
     * Майстер — рішення про ОБСЯГ, розсинхрон text/chars — сигнал про якість
     * даних У МЕЖАХ обсягу. Зворотний порядок скаржився б на дані, яких і не
     * збирався судити.
     */
    const brokenMaster = { ...shortLast(), isMaster: true, text: "розсинхрон" };
    expect(brokenMaster.text.length).not.toBe(brokenMaster.chars.length);

    const off = analyse(measureOf([brokenMaster]), DETECTION);
    expect(off.dropped).toEqual({ master: 1, textMismatch: 0 });

    /* А коли майстри в обсязі — той самий рядок лічиться саме розсинхроном. */
    const on = analyse(measureOf([brokenMaster]), { ...DETECTION, includeMasters: true });
    expect(on.dropped).toEqual({ master: 0, textMismatch: 1 });
  });

  it("калібрування бере ширину пробілу ЛИШЕ з відсіяної вибірки", () => {
    /*
     * Останні рядки абзаців — єдине джерело природної ширини пробілу. Якби
     * калібрування рахувалося по НЕвідсіяних рядках, пробіли колонтитулів
     * (інший набір, інша виключка) зсунули б медіану всього документа.
     */
    const body = [0, 1, 2].map((p) =>
      shortLast({ paragraphIndex: p, words: 4, spaceWidth: 3 }),
    );
    const masters = [3, 4, 5].map((p) => ({
      ...shortLast({ paragraphIndex: p, words: 4, spaceWidth: 9 }),
      isMaster: true,
    }));

    const clean = analyse(measureOf([...body, ...masters]), DETECTION);
    const dirty = analyse(measureOf([...body, ...masters]), { ...DETECTION, includeMasters: true });

    expect(clean.cal.natural.get("Основний текст@10")).toBe(3);
    /* Із майстрами медіана з'їжджає — саме цього відсів і не допускає. */
    expect(dirty.cal.natural.get("Основний текст@10")).not.toBe(3);
  });
});

describe("dedupeTracking — обов'язок №2 Задачі 13", () => {
  it("дві пропозиції на один абзац дають ОДИН запис: apply_edits ДОДАЄ дельту", () => {
    const out = dedupeTracking([
      { containerId: "story:0", paragraphIndex: 3, delta: -7 },
      { containerId: "story:0", paragraphIndex: 3, delta: -7 },
    ]);
    expect(out).toEqual([{ containerId: "story:0", paragraphIndex: 3, delta: -7 }]);
  });

  it("різні абзаци того самого контейнера лишаються обидва", () => {
    expect(
      dedupeTracking([
        { containerId: "story:0", paragraphIndex: 3, delta: -7 },
        { containerId: "story:0", paragraphIndex: 4, delta: -7 },
      ]),
    ).toHaveLength(2);
  });

  it("однаковий абзац у РІЗНИХ контейнерах не склеюється", () => {
    expect(
      dedupeTracking([
        { containerId: "story:0", paragraphIndex: 3, delta: -7 },
        { containerId: "story:1", paragraphIndex: 3, delta: -7 },
      ]),
    ).toHaveLength(2);
  });

  it("розбіжні дельти на один абзац — виняток, а не «візьмемо першу»", () => {
    expect(() =>
      dedupeTracking([
        { containerId: "story:0", paragraphIndex: 3, delta: -7 },
        { containerId: "story:0", paragraphIndex: 3, delta: -9 },
      ]),
    ).toThrow(/-7 and -9/);
  });

  it("порожній вхід — порожній вихід", () => {
    expect(dedupeTracking([])).toEqual([]);
  });
});

describe("composition_apply — вибір знахідок", () => {
  it("невідомий ідентифікатор НЕ мовчить і нічого не пише", async () => {
    const lines = shortLastParagraph(0);
    bridge(measureOf(lines), [], measureOf(lines));
    const r = body(await applyHandler()({ ...ARGS, pages: ["12"], findingIds: ["немає-такої"] }));

    expect(r.unknownFindingIds).toEqual(["немає-такої"]);
    expect(r.applied).toBe(0);
    expect(runWriteMock).not.toHaveBeenCalled();
    /*
     * І НЕ ЧИТАЄ ТЕКСТИ КОНТЕЙНЕРІВ. `containers_read` бере `story.contents` по
     * всіх story (на книжці — 549 контейнерів, ~217 тис. символів); платити за це
     * тоді, коли виправляти вже нема чого, немає жодних підстав. Мутаційний
     * прогін показав, що без цієї перевірки рання гілка взагалі не потрібна.
     */
    expect(runJsxMock.mock.calls.map((c) => c[0])).not.toContain("containers_read");
  });

  it("самі лише manual-знахідки не породжують запису", async () => {
    /* Перший рядок абзацу, що є останнім у фреймі, — це сирота, тобто manual. */
    const orphan = ln({
      containerId: "story:0",
      paragraphIndex: 0,
      lineInParagraph: 0,
      paragraphLineCount: 3,
      isLastInFrame: true,
    });
    const lines = [orphan, ...shortLastParagraph(1)];
    bridge(measureOf(lines), [], measureOf(lines));
    const r = body(
      await applyHandler()({ ...ARGS, pages: ["12"], findingIds: ["orphan:story:0:0:0"] }),
    );

    expect(r.applied).toBe(0);
    expect(r.manual.map((m: { findingId: string }) => m.findingId)).toEqual(["orphan:story:0:0:0"]);
    expect(runWriteMock).not.toHaveBeenCalled();
  });
});

/*
 * I1 (фінальна рецензія). `proposeFixes` виявляє конфлікт напряму трекінгу
 * («у цьому абзаці потрібні протилежні напрями») за ВЛАСНИМ індексом абзаців,
 * побудованим із того, що йому подали. Вада: composition_apply подавав туди
 * лише ОБРАНІ оператором знахідки (`selected`), тож знахідка того самого
 * абзацу, яку оператор не обрав, ховала конфлікт від перевірки — трекінг ішов
 * би в абзац, де насправді потрібні протилежні напрями. Виправлення: контекст
 * для `proposeFixes` — ПОВНИЙ `before.findings`, а відбір оператора
 * застосовується ПІСЛЯ, фільтром по `findingId`.
 */
describe("composition_apply — I1: конфлікт напряму трекінгу видно навіть при частковому виборі", () => {
  /*
   * Один абзац, два рядки:
   *  - рядок 0 (не останній): широкий міжслівний проміжок (4,5 пт при
   *    природних 3,2) — style-bounds дає "loose" (max 133% → 3,2×1,33=4,256,
   *    141% > межі), тобто ПОЗИТИВНИЙ трекінг;
   *  - рядок 1 (останній, endsParagraph): одне коротке слово — "short-last-line",
   *    тобто НЕГАТИВНИЙ трекінг (та сама арифметика, що й widow).
   * Протилежні знаки в одному абзаці — рівно той конфлікт, який мусить
   * заблокувати запис.
   */
  const conflictParagraph = (): LineMeasure[] => {
    const common = { containerId: "story:0", paragraphIndex: 0, paragraphLineCount: 2 };
    return [
      ln({ ...common, lineInParagraph: 0, words: 7, spaceWidth: 4.5 }),
      ln({ ...common, lineInParagraph: 1, words: 1, endsParagraph: true }),
    ];
  };
  /* Калібрувальна вибірка — ОКРЕМИЙ контейнер, щоб не зачепити адреси
   * знахідок вище: три останні рядки абзаців із природним пробілом 3,2 пт
   * (той самий, що дає `ln` за замовчуванням для нетрекованих рядків). */
  const calibrationLines = (): LineMeasure[] =>
    [0, 1, 2].map((paragraphIndex) =>
      ln({
        containerId: "story:calib",
        paragraphIndex,
        paragraphLineCount: 1,
        lineInParagraph: 0,
        endsParagraph: true,
        words: 3,
        spaceWidth: 3.2,
      }),
    );

  const LOOSE_ID = "loose:story:0:0:0";
  const SHORT_ID = "short-last-line:story:0:0:1";

  it("передумова: аудит по ВСІХ знахідках абзацу бачить конфлікт (обидві blocked)", () => {
    const lines = [...calibrationLines(), ...conflictParagraph()];
    const before = analyse(measureOf(lines), { ...ARGS, spacingMode: "style-bounds" });
    const ids = before.findings.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining([LOOSE_ID, SHORT_ID]));
  });

  it("вибір ЛИШЕ loose-знахідки все одно бачить конфлікт і блокує запис (регресія I1)", async () => {
    const lines = [...calibrationLines(), ...conflictParagraph()];
    bridge(measureOf(lines), [], measureOf(lines));

    const r = body(
      await applyHandler()({
        ...ARGS,
        spacingMode: "style-bounds",
        pages: ["12"],
        findingIds: [LOOSE_ID],
      }),
    );

    expect(r.blocked).toHaveLength(1);
    expect(r.blocked[0].findingId).toBe(LOOSE_ID);
    expect(r.blocked[0].reason).toContain("opposite directions");
    expect(r.applied).toBe(0);
    expect(runWriteMock).not.toHaveBeenCalled();
  });

  it("вибір ОБОХ знахідок абзацу теж блокує запис (регресія в інший бік)", async () => {
    const lines = [...calibrationLines(), ...conflictParagraph()];
    bridge(measureOf(lines), [], measureOf(lines));

    const r = body(
      await applyHandler()({
        ...ARGS,
        spacingMode: "style-bounds",
        pages: ["12"],
        findingIds: [LOOSE_ID, SHORT_ID],
      }),
    );

    expect(r.blocked.map((b: { findingId: string }) => b.findingId).sort()).toEqual(
      [LOOSE_ID, SHORT_ID].sort(),
    );
    for (const b of r.blocked) {
      expect(b.reason).toContain("opposite directions");
    }
    expect(r.applied).toBe(0);
    expect(runWriteMock).not.toHaveBeenCalled();
  });
});

describe("composition_apply — запис і перемір", () => {
  const ID = "short-last-line:story:0:0:1";

  it("пише трекінг ОДНИМ записом на абзац і звітує resolved, коли знахідка зникла", async () => {
    const before = measureOf(shortLastParagraph(0));
    /* Після запису абзац перекомпонувався в один рядок — знахідки більше немає.
     * Однорядковий абзац `detectLines` не судить узагалі. */
    const after = measureOf([
      ln({ paragraphIndex: 0, lineInParagraph: 0, paragraphLineCount: 1, words: 8, endsParagraph: true }),
    ]);
    bridge(before, [], after);

    const r = body(await applyHandler()({ ...ARGS, pages: ["12"], findingIds: [ID] }));

    expect(runWriteMock).toHaveBeenCalledTimes(1);
    const params = runWriteMock.mock.calls[0]![0].params;
    expect(params.expectedDocName).toBe(DOC);
    expect(params.tracking).toHaveLength(1);
    expect(params.edits).toEqual([]);
    expect(r.verification).toEqual([
      { findingId: ID, outcome: "resolved", detail: expect.any(String) },
    ]);
    expect(r.verificationCounts).toEqual({ resolved: 1, "still-present": 0, displaced: 0 });
    expect(r.backupPath).toBe("/шлях/копія.indd");
  });

  it("новий дефект після запису звітується як displaced — константа фази", async () => {
    const before = measureOf(shortLastParagraph(0));
    /* Абзац лишився дворядковим, а поруч з'явився ще один такий самий. */
    const after = measureOf([...shortLastParagraph(0), ...shortLastParagraph(1)]);
    bridge(before, [], after);

    const r = body(await applyHandler()({ ...ARGS, pages: ["12"], findingIds: [ID] }));

    expect(r.verificationCounts).toEqual({ resolved: 0, "still-present": 1, displaced: 1 });
    expect(r.verification.find((v: { outcome: string }) => v.outcome === "displaced").findingId).toBe(
      "short-last-line:story:0:1:1",
    );
    expect(r.note).toContain("displaced 1");
  });

  it("збій ПЕРЕМІРУ не ховає того, що запис уже стався", async () => {
    let measures = 0;
    runJsxMock.mockImplementation(async (handler: string) => {
      if (handler === "containers_read") return { docName: DOC, containers: [] };
      if (handler === "composition_measure") {
        if (measures++ === 0) return measureOf(shortLastParagraph(0));
        throw new Error("InDesign закрив документ");
      }
      throw new Error(`несподіваний обробник ${handler}`);
    });

    const r = body(await applyHandler()({ ...ARGS, pages: ["12"], findingIds: [ID] }));

    expect(r.backupPath).toBe("/шлях/копія.indd");
    expect(r.verificationError).toContain("InDesign закрив документ");
    expect(r.verification).toEqual([]);
    expect(r.note).toContain("THE RE-MEASUREMENT DID NOT HAPPEN");
  });

  it("dryRun показує майбутню пачку й НЕ пише нічого", async () => {
    const lines = shortLastParagraph(0);
    bridge(measureOf(lines), [], measureOf(lines));

    const r = body(
      await applyHandler()({ ...ARGS, dryRun: true, pages: ["12"], findingIds: [ID] }),
    );

    expect(r.dryRun).toBe(true);
    expect(r.tracking).toHaveLength(1);
    expect(runWriteMock).not.toHaveBeenCalled();
  });

  it("документ, що змінився між виміром і читанням контейнерів, зупиняє запис", async () => {
    runJsxMock.mockImplementation(async (handler: string) => {
      if (handler === "containers_read") return { docName: "інший.indd", containers: [] };
      if (handler === "composition_measure") return measureOf(shortLastParagraph(0));
      throw new Error(`несподіваний обробник ${handler}`);
    });

    const r = await applyHandler()({ ...ARGS, pages: ["12"], findingIds: [ID] });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain("The active document changed");
    expect(runWriteMock).not.toHaveBeenCalled();
  });
});

describe("composition_apply — обов'язок №3: правки йдуть через orderForApply", () => {
  /*
   * Дві невидимі правки в ОДНОМУ контейнері. Кожна ВСТАВЛЯЄ один символ, тобто
   * зсуває всі наступні абсолютні зсуви в тій самій story. `orderForApply`
   * сортує за СПАДАННЯМ `start` саме тому, і `apply.jsx` на це прямо спирається.
   * Подати їх у порядку знахідок означало б зіпсувати другу правку.
   */
  const SNAPSHOT = "текст міжнародний далі\rінший міжнародний кінець";

  it("дві правки в одному контейнері подаються за СПАДАННЯМ start", async () => {
    const para = (paragraphIndex: number, first: string, last: boolean) => [
      ln({
        paragraphIndex,
        lineInParagraph: 0,
        paragraphLineCount: 2,
        wordList: [first, "міжнарод"],
        endsWithHyphen: true,
      }),
      ln({
        paragraphIndex,
        lineInParagraph: 1,
        paragraphLineCount: 2,
        wordList: ["ний", last ? "кінець" : "далі"],
        endsParagraph: !last,
      }),
    ];
    const lines = [...para(0, "текст", false), ...para(1, "інший", true)];
    bridge(measureOf(lines), [{ containerId: "story:0", text: SNAPSHOT }], measureOf(lines));

    const r = body(
      await applyHandler()({
        ...ARGS,
        dryRun: true,
        forbiddenWords: ["міжнародний"],
        pages: ["12"],
        findingIds: ["hyphen-forbidden:story:0:0:0", "hyphen-forbidden:story:0:1:0"],
      }),
    );

    expect(r.edits).toHaveLength(2);
    /* Порядок знахідок — 6, потім 29; порядок ЗАПИСУ мусить бути зворотний. */
    expect(r.edits.map((e: { start: number }) => e.start)).toEqual([29, 6]);
    expect(SNAPSHOT.slice(29, 37)).toBe("міжнарод");
    expect(SNAPSHOT.slice(6, 14)).toBe("міжнарод");
  });

  it("записана НЕВИДИМА правка теж підлягає переміру, а не лише трекінг", async () => {
    /*
     * Мутаційний прогін показав прогалину: жоден юніт не доводив, що знахідка,
     * виправлена м'яким переносом, узагалі потрапляє у перемір. Прибрати
     * `p.edit !== undefined` зі списку спробуваних можна було непомітно —
     * тобто записати правку й нічого про її наслідок не сказати.
     */
    const lines = [
      ln({ paragraphIndex: 0, lineInParagraph: 0, paragraphLineCount: 2, wordList: ["текст", "міжнарод"], endsWithHyphen: true }),
      ln({ paragraphIndex: 0, lineInParagraph: 1, paragraphLineCount: 2, wordList: ["ний", "далі"] }),
    ];
    /* Після запису слово перейшло цілим — переносу більше немає. */
    const after = measureOf([
      ln({ paragraphIndex: 0, lineInParagraph: 0, paragraphLineCount: 2, wordList: ["текст"] }),
      ln({ paragraphIndex: 0, lineInParagraph: 1, paragraphLineCount: 2, wordList: ["міжнародний", "далі"] }),
    ]);
    bridge(measureOf(lines), [{ containerId: "story:0", text: "текст міжнародний далі" }], after);
    runWriteMock.mockResolvedValue({
      ...WRITE_OK,
      applied: [{ requestId: "hyphen-forbidden:story:0:0:0" }],
      trackingApplied: [],
    });

    const r = body(
      await applyHandler()({
        ...ARGS,
        forbiddenWords: ["міжнародний"],
        pages: ["12"],
        findingIds: ["hyphen-forbidden:story:0:0:0"],
      }),
    );

    expect(runWriteMock.mock.calls[0]![0].params.edits).toHaveLength(1);
    expect(r.attempted).toEqual(["hyphen-forbidden:story:0:0:0"]);
    expect(r.verification).toEqual([
      { findingId: "hyphen-forbidden:story:0:0:0", outcome: "resolved", detail: expect.any(String) },
    ]);
  });
});

describe("composition_apply — обов'язок №2 у зборі: дедуплікація справді ввімкнена", () => {
  it("дві знахідки ОДНОГО абзацу дають один запис трекінгу, а не два", async () => {
    /*
     * Останній рядок дворядкового абзацу, що є ПЕРШИМ у своєму фреймі й водночас
     * закороткий, — це одразу вісяк і короткий кінцевий рядок. Обидва класи
     * лікуються трекінгом ТОГО САМОГО абзацу; подати обидва означало б додати
     * дельту двічі, бо `apply_edits` її ДОДАЄ.
     */
    const lines = [
      ln({ paragraphIndex: 0, lineInParagraph: 0, paragraphLineCount: 2, words: 7 }),
      ln({
        paragraphIndex: 0,
        lineInParagraph: 1,
        paragraphLineCount: 2,
        words: 1,
        isFirstInFrame: true,
        endsParagraph: true,
      }),
    ];
    bridge(measureOf(lines), [], measureOf(lines));

    const r = body(
      await applyHandler()({
        ...ARGS,
        dryRun: true,
        pages: ["12"],
        findingIds: ["widow:story:0:0:1", "short-last-line:story:0:0:1"],
      }),
    );

    expect(r.selected).toBe(2);
    expect(r.tracking).toHaveLength(1);
    /* Обидві знахідки лишаються «спробуваними» — трекінг абзацу лікує обидві. */
    expect(r.attempted.sort()).toEqual(["short-last-line:story:0:0:1", "widow:story:0:0:1"]);
  });
});

describe("composition_apply — перемір звітує лише про те, що справді робили", () => {
  it("знахідка з blocked не потрапляє в перемір, навіть якщо зникла сама", async () => {
    /* Абзац із трекінгом (пишемо) плюс сирота (manual, не пишемо). */
    const orphan = ln({
      containerId: "story:1",
      paragraphIndex: 0,
      lineInParagraph: 0,
      paragraphLineCount: 3,
      isLastInFrame: true,
    });
    const before = measureOf([...shortLastParagraph(0), orphan]);
    /* Після запису зникли ОБИДВІ — але сироту ніхто не виправляв. */
    const after = measureOf([
      ln({ paragraphIndex: 0, lineInParagraph: 0, paragraphLineCount: 1, words: 8, endsParagraph: true }),
    ]);
    bridge(before, [], after);

    const r = body(
      await applyHandler()({
        ...ARGS,
        pages: ["12"],
        findingIds: ["short-last-line:story:0:0:1", "orphan:story:1:0:0"],
      }),
    );

    expect(r.attempted).toEqual(["short-last-line:story:0:0:1"]);
    expect(r.verification.map((v: { findingId: string }) => v.findingId)).toEqual([
      "short-last-line:story:0:0:1",
    ]);
    expect(r.manual).toHaveLength(1);
  });
});

/*
 * ПЕРЕДУМОВА, ОГОЛОШЕНА В ЗАГОЛОВКУ `verify.ts`: вимір «до» і «після» мусить
 * бути зроблений на ОДНІЙ вибірці сторінок і ОДНАКОВИМИ параметрами детекторів.
 * Сама `verifyFixes` цього перевірити не може — вона бачить лише знахідки, — тож
 * умову виконує `composition_apply`. Мутаційний прогін показав, що виконання
 * ніхто не перевіряв: і «міряти після по інших сторінках», і «міряти після
 * іншим spacingMode» лишали 760 тестів зеленими, хоча кожне з них ФАБРИКУЄ
 * вердикти з нічого.
 */
describe("перемір робиться тим самим інструментом, що й вимір «до»", () => {
  /** Абзаци з пробілами в кінцевих рядках — без них калібрування не відбудеться. */
  const calibrationParagraphs = (from: number) =>
    [from, from + 1, from + 2].flatMap((p) => [
      ln({ paragraphIndex: p, lineInParagraph: 0, paragraphLineCount: 2, words: 7 }),
      ln({ paragraphIndex: p, lineInParagraph: 1, paragraphLineCount: 2, words: 4, endsParagraph: true }),
    ]);

  it("вимір ПІСЛЯ йде по ТИХ САМИХ сторінках", async () => {
    const lines = shortLastParagraph(0);
    bridge(measureOf(lines), [], measureOf(lines));

    await applyHandler()({ ...ARGS, pages: ["12", "13", "14"], findingIds: ["short-last-line:story:0:0:1"] });

    const measured = runJsxMock.mock.calls
      .filter((c) => c[0] === "composition_measure")
      .map((c) => (c[1] as { pages: string[] }).pages);
    expect(measured).toHaveLength(2);
    expect(measured[1]).toEqual(measured[0]);
    expect(measured[0]).toEqual(["12", "13", "14"]);
  });

  it("вимір ПІСЛЯ судиться тими самими параметрами детекторів", async () => {
    /*
     * Документ, у якому режим щільності справді щось міняє: у `survey` знахідок
     * tight/loose немає взагалі, у `rank` їх дістає кожен виміряний виключений
     * не-останній рядок. Якби перемір раптом судив «після» іншим режимом, ця
     * різниця повернулася б як пачка неіснуючих `displaced`.
     */
    /*
     * У «після» додано ще й рядок МАЙСТЕР-сторінки, який сам собою є знахідкою.
     * Він тут не для повноти: без нього перемір, що судить «після» з
     * includeMasters: true, дав би той самий результат, і підміна параметра
     * лишилася б непоміченою.
     */
    const masterDefect = {
      ...ln({ paragraphIndex: 9, lineInParagraph: 1, paragraphLineCount: 2, words: 1, endsParagraph: true }),
      isMaster: true,
    };
    const before = measureOf([...shortLastParagraph(0), ...calibrationParagraphs(1), masterDefect]);
    const after = measureOf([
      ln({ paragraphIndex: 0, lineInParagraph: 0, paragraphLineCount: 1, words: 8, endsParagraph: true }),
      ...calibrationParagraphs(1),
      masterDefect,
    ]);
    bridge(before, [], after);

    /* Докази, що фікстура справді розрізняє обидва параметри — інакше тест
     * нічого не варт: він проходив би й на зламаному коді. */
    expect(analyse(after, { ...ARGS, spacingMode: "rank" }).findings.length).toBeGreaterThan(
      analyse(after, ARGS).findings.length,
    );
    expect(analyse(after, { ...ARGS, includeMasters: true }).findings.length).toBeGreaterThan(
      analyse(after, ARGS).findings.length,
    );

    const r = body(
      await applyHandler()({ ...ARGS, pages: ["12"], findingIds: ["short-last-line:story:0:0:1"] }),
    );

    expect(r.verificationCounts.resolved).toBe(1);
    /* Жодного «нового дефекту»: між двома вимірами не змінився ніхто, крім документа. */
    expect(r.verificationCounts.displaced).toBe(0);
  });
});

/*
 * I3 (фінальна рецензія). `calibrate()` бере природну ширину пробілу з
 * ОСТАННІХ рядків абзаців переданої вибірки. Трекінг фізично розсуває
 * міжслівні проміжки на трекованих абзацах, тож перемір, що калібрується
 * ЗАНОВО з ЩОЙНО ЗАПИСАНОГО тексту, може підмінити медіану свого styleKey —
 * і тим сфабрикувати displaced/resolved там, де жоден рядок насправді не
 * змінювався. Виправлення: перемір «після» використовує ТЕ САМЕ калібрування,
 * що й вимір «до» (`analyse(after, detection, before.cal)`), а не рахує його
 * заново.
 */
describe("composition_apply — I3: перемір «після» не калібрується заново з трекованого тексту", () => {
  /** Три однорядкові абзаци — чисті калібрувальні зразки, без побічних знахідок. */
  const calibParagraphs = (from: number, spaceWidth: number): LineMeasure[] =>
    [from, from + 1, from + 2].map((paragraphIndex) =>
      ln({ paragraphIndex, paragraphLineCount: 1, lineInParagraph: 0, endsParagraph: true, words: 3, spaceWidth }),
    );
  /** Рядок-«канарка»: сам не трекований і не вибраний, лише СВІДОК калібрування. */
  const canary = (spaceWidth: number): LineMeasure =>
    ln({ paragraphIndex: 5, lineInParagraph: 0, paragraphLineCount: 2, words: 4, spaceWidth });
  const CANARY_ID = "loose:story:0:5:0";
  const detection = { ...ARGS, spacingMode: "style-bounds" as const };

  const beforeLines = [...shortLastParagraph(0), canary(4.0), ...calibParagraphs(20, 3.2)];
  /* «Після»: абзац 0 переписаний в ОДИН рядок (short-last-line зник по-справжньому),
   * канарка НЕ змінилась, а калібрувальні зразки звужені до 2,0 пт — так, як
   * виглядав би трекований текст цього самого styleKey. */
  const afterLines = [
    /* `spaceWidth` тут теж 2,0 — інакше сім проміжків восьмислівного рядка
     * (природної ширини 3,2) переважили б у медіані три калібрувальні абзаци й
     * замаскували зсув, який фікстура має довести. */
    ln({
      paragraphIndex: 0,
      lineInParagraph: 0,
      paragraphLineCount: 1,
      words: 8,
      spaceWidth: 2.0,
      endsParagraph: true,
    }),
    canary(4.0),
    ...calibParagraphs(20, 2.0),
  ];

  it("передумова: свіже калібрування «після» справді породжує нову знахідку на незмінній канарці", () => {
    const beforeAnalysis = analyse(measureOf(beforeLines), detection);
    const freshAfter = analyse(measureOf(afterLines), detection);
    const frozenAfter = analyse(measureOf(afterLines), detection, beforeAnalysis.cal);

    /* Канарка (4,0 пт): відношення до природних 3,2 = 1,25 — у межах 80–133%,
     * знахідки немає. Відношення до фальшивих (з трекованого тексту) 2,0 =
     * 2,0 — далеко за межею 133%, "loose". Якби фікстура НЕ розрізняла два
     * калібрування, тест нічого не довів би. */
    expect(freshAfter.findings.some((f) => f.id === CANARY_ID)).toBe(true);
    expect(frozenAfter.findings.some((f) => f.id === CANARY_ID)).toBe(false);
  });

  it("перемір composition_apply використовує калібрування «до» — канарка НЕ стає displaced", async () => {
    bridge(measureOf(beforeLines), [], measureOf(afterLines));

    const r = body(
      await applyHandler()({
        ...detection,
        pages: ["12"],
        findingIds: ["short-last-line:story:0:0:1"],
      }),
    );

    expect(r.verificationCounts.resolved).toBe(1);
    expect(r.verificationCounts.displaced).toBe(0);
    expect(r.verification.map((v: { findingId: string }) => v.findingId)).not.toContain(CANARY_ID);
  });
});

describe("параметри виклику доходять до місця призначення", () => {
  it("undoName їде в apply_edits, а не губиться дорогою", async () => {
    const lines = shortLastParagraph(0);
    bridge(measureOf(lines), [], measureOf(lines));

    await applyHandler()({
      ...ARGS,
      undoName: "Моя власна назва кроку",
      pages: ["12"],
      findingIds: ["short-last-line:story:0:0:1"],
    });

    expect(runWriteMock.mock.calls[0]![0].params.undoName).toBe("Моя власна назва кроку");
  });

  it("maxTracking справді обмежує дельту, а не лишається декорацією", async () => {
    const lines = shortLastParagraph(0);
    bridge(measureOf(lines), [], measureOf(lines));

    const tight = body(
      await applyHandler()({
        ...ARGS,
        dryRun: true,
        maxTracking: 3,
        pages: ["12"],
        findingIds: ["short-last-line:story:0:0:1"],
      }),
    );
    expect(tight.tracking[0].delta).toBe(-3);

    const loose = body(
      await applyHandler()({
        ...ARGS,
        dryRun: true,
        maxTracking: 100,
        pages: ["12"],
        findingIds: ["short-last-line:story:0:0:1"],
      }),
    );
    /* Межа більша за потрібне — дельта стає повною. */
    expect(loose.tracking[0].delta).toBe(-45);
    /* Недобір при цьому не зникає ЗОВСІМ, і це не вада тесту: лишається
     * округлення дельти до цілої одиниці (45 замість 45,45), тобто покриття
     * 0,99, а не 1. Саме тому нижче перевіряється покриття, а не порожнеча. */
    expect(loose.shortfalls[0].coverage).toBeGreaterThan(0.98);
    expect(tight.shortfalls[0].coverage).toBeLessThan(0.1);
  });
});

describe("перемір керується ЗАПИСАНИМ, а не поданим", () => {
  const ID = "short-last-line:story:0:0:1";

  it("правка, яку InDesign віддав як skipped, вердикту НЕ дістає", async () => {
    /*
     * Найтонша з вад, знайдених рецензією. Пачка з двох правок: одна лягла,
     * друга — skipped (текст змінився після побудови плану). Перекомпоновка
     * від ПЕРШОЇ прибирає й другу знахідку. Якби перемір ішов за наміром,
     * skipped-знахідка дістала б чужий «resolved», і verificationCounts
     * завищив би успіх — рівно те єдине число, заради чесності якого існує
     * весь інструмент.
     */
    const para = (paragraphIndex: number, first: string, last: boolean) => [
      ln({ paragraphIndex, lineInParagraph: 0, paragraphLineCount: 2, wordList: [first, "міжнарод"], endsWithHyphen: true }),
      ln({ paragraphIndex, lineInParagraph: 1, paragraphLineCount: 2, wordList: ["ний", last ? "кінець" : "далі"], endsParagraph: !last }),
    ];
    const before = measureOf([...para(0, "текст", false), ...para(1, "інший", true)]);
    /* Після запису обидві знахідки зникли. */
    const after = measureOf([
      ln({ paragraphIndex: 0, lineInParagraph: 0, paragraphLineCount: 1, wordList: ["текст"], endsParagraph: true }),
    ]);
    bridge(before, [{ containerId: "story:0", text: "текст міжнародний далі\rінший міжнародний кінець" }], after);

    runWriteMock.mockResolvedValue({
      ...WRITE_OK,
      /* Лягла лише друга за порядком запису (start 29 — абзац 1). */
      applied: [{ requestId: "hyphen-forbidden:story:0:1:0" }],
      skipped: [
        {
          requestId: "hyphen-forbidden:story:0:0:0",
          candidateId: "hyphen-forbidden:story:0:0:0#0",
          reason: "Текст у документі змінився після побудови плану.",
          expected: "міжнарод",
          actual: "міжнаро",
        },
      ],
      trackingApplied: [],
    });

    const r = body(
      await applyHandler()({
        ...ARGS,
        forbiddenWords: ["міжнародний"],
        pages: ["12"],
        findingIds: ["hyphen-forbidden:story:0:0:0", "hyphen-forbidden:story:0:1:0"],
      }),
    );

    expect(r.attempted.sort()).toEqual(["hyphen-forbidden:story:0:0:0", "hyphen-forbidden:story:0:1:0"]);
    expect(r.written).toEqual(["hyphen-forbidden:story:0:1:0"]);
    expect(r.notWritten).toEqual(["hyphen-forbidden:story:0:0:0"]);
    /* Вердикт лише в записаної; skipped зникла з переміру, а не стала resolved. */
    expect(r.verification.map((v: { findingId: string }) => v.findingId)).toEqual([
      "hyphen-forbidden:story:0:1:0",
    ]);
    expect(r.verificationCounts.resolved).toBe(1);
    /* І сама причина пропуску мусить бути видна оператору. */
    expect(r.write.skipped).toHaveLength(1);
    expect(r.write.skipped[0].reason).toContain("змінився");
  });

  it("трекінг, що впав, вердикту не дістає — рахується trackingApplied, а не поданий", async () => {
    const lines = shortLastParagraph(0);
    const after = measureOf([
      ln({ paragraphIndex: 0, lineInParagraph: 0, paragraphLineCount: 1, words: 8, endsParagraph: true }),
    ]);
    bridge(measureOf(lines), [], after);
    runWriteMock.mockResolvedValue({
      ...WRITE_OK,
      trackingApplied: [],
      trackingFailed: [{ containerId: "story:0", paragraphIndex: 0, reason: "заблокована story" }],
    });

    const r = body(await applyHandler()({ ...ARGS, pages: ["12"], findingIds: [ID] }));

    expect(r.attempted).toEqual([ID]);
    expect(r.written).toEqual([]);
    expect(r.notWritten).toEqual([ID]);
    expect(r.verification).toEqual([]);
    expect(r.verificationCounts).toEqual({ resolved: 0, "still-present": 0, displaced: 0 });
    expect(r.write.trackingFailed).toHaveLength(1);
  });

  it("правка, на якій запис КИНУВ виняток, теж видно у звіті й теж без вердикту", async () => {
    /*
     * `failed` — не те саме, що `skipped`: там текст розійшовся з планом, тут
     * запис кинув виняток (заблокована story, заблокований шар, фрейм на
     * заблокованому майстрі). Пачка через це не переривається, тож єдиний спосіб
     * дізнатися про втрату — побачити її у звіті.
     */
    const lines = [
      ln({ paragraphIndex: 0, lineInParagraph: 0, paragraphLineCount: 2, wordList: ["текст", "міжнарод"], endsWithHyphen: true }),
      ln({ paragraphIndex: 0, lineInParagraph: 1, paragraphLineCount: 2, wordList: ["ний", "далі"] }),
    ];
    bridge(measureOf(lines), [{ containerId: "story:0", text: "текст міжнародний далі" }], measureOf(lines));
    runWriteMock.mockResolvedValue({
      ...WRITE_OK,
      applied: [],
      failed: [
        {
          requestId: "hyphen-forbidden:story:0:0:0",
          candidateId: "hyphen-forbidden:story:0:0:0#0",
          reason: "заблокований шар",
        },
      ],
      trackingApplied: [],
    });

    const r = body(
      await applyHandler()({
        ...ARGS,
        forbiddenWords: ["міжнародний"],
        pages: ["12"],
        findingIds: ["hyphen-forbidden:story:0:0:0"],
      }),
    );

    expect(r.write.failed).toHaveLength(1);
    expect(r.write.failed[0].reason).toContain("заблокований шар");
    expect(r.written).toEqual([]);
    expect(r.notWritten).toEqual(["hyphen-forbidden:story:0:0:0"]);
    expect(r.verification).toEqual([]);
  });
});

describe("coalesceEdits — дві знахідки на одному рядку просять ту саму вставку", () => {
  const edit = (over: Partial<AcceptedEdit> = {}): AcceptedEdit => ({
    requestId: "a",
    candidateId: "a#0",
    containerId: "story:0",
    start: 10,
    end: 18,
    expectedOld: "міжнарод",
    newText: "­міжнарод",
    action: "replace",
    ...over,
  });
  const prop = (findingId: string, e: AcceptedEdit): Proposal => ({
    findingId,
    defect: "hyphen-forbidden",
    kind: "invisible",
    description: "",
    scope: { containerId: e.containerId, paragraphIndex: 0, page: "12" },
    before: { measured: 0.5, strength: 0.5 },
    alsoInParagraph: [],
    edit: e,
  });

  it("однакові правки зводяться в одну, а обидві знахідки лишаються при ній", () => {
    const { edits, groups } = coalesceEdits([
      prop("hyphen-across-spread:story:0:0:0", edit({ requestId: "hyphen-across-spread:story:0:0:0" })),
      prop("hyphen-forbidden:story:0:0:0", edit({ requestId: "hyphen-forbidden:story:0:0:0" })),
    ]);

    expect(edits).toHaveLength(1);
    expect(edits[0]!.requestId).toBe("hyphen-across-spread:story:0:0:0");
    expect(groups.get("hyphen-across-spread:story:0:0:0")).toEqual([
      "hyphen-across-spread:story:0:0:0",
      "hyphen-forbidden:story:0:0:0",
    ]);
  });

  it("різні правки не склеюються", () => {
    const { edits } = coalesceEdits([
      prop("a", edit({ requestId: "a" })),
      prop("b", edit({ requestId: "b", start: 40, end: 48 })),
    ]);
    expect(edits).toHaveLength(2);
  });

  it("пропозиції без правки не потрапляють у пачку", () => {
    const { edits, groups } = coalesceEdits([
      { ...prop("m", edit()), edit: undefined, kind: "manual" },
    ]);
    expect(edits).toEqual([]);
    expect(groups.size).toBe(0);
  });

  it("перетин, що НЕ є збігом, зупиняє пачку до будь-якого запису", () => {
    /*
     * Через `proposeFixes` такого не буває: його правки — уламки слів на кінцях
     * РІЗНИХ рядків. Саме тому перевірка й живе всередині `coalesceEdits`, де
     * її можна подати правками прямо: у місці виклику вона була б рядком, який
     * ніщо не здатне виконати, і зникнення її ніхто б не помітив.
     */
    expect(() =>
      coalesceEdits([
        prop("a", edit({ requestId: "a", start: 10, end: 18 })),
        prop("b", edit({ requestId: "b", start: 14, end: 22, expectedOld: "народний" })),
      ]),
    ).toThrow(/overlap/);
  });

  it("суміжні правки (кінець одної = початок другої) перетином НЕ вважаються", () => {
    /* `end` ексклюзивний, тож [10;18) і [18;26) не перекриваються. */
    const { edits } = coalesceEdits([
      prop("a", edit({ requestId: "a", start: 10, end: 18 })),
      prop("b", edit({ requestId: "b", start: 18, end: 26, expectedOld: "наступне" })),
    ]);
    expect(edits).toHaveLength(2);
  });

  it("однакові правки в РІЗНИХ контейнерах не склеюються й не конфліктують", () => {
    const { edits } = coalesceEdits([
      prop("a", edit({ requestId: "a", containerId: "story:0" })),
      prop("b", edit({ requestId: "b", containerId: "story:1" })),
    ]);
    expect(edits).toHaveLength(2);
  });
});

/*
 * OPEN-B (раунд 2 рецензії Задачі 14). `coalesceEdits` сама по собі покрита
 * юнітами вище — вона чиста функція. Але НІЧОГО на рівні самого обробника не
 * доводило, що зведений `editGroups` справді керує тим, кому дістається
 * вердикт: заміна `report.applied.flatMap((a) => editGroups.get(a.requestId)
 * ?? [a.requestId])` на `report.applied.map((a) => a.requestId)` проходила
 * весь юніт-набір без жодного падіння.
 *
 * СПРАВЖНІЙ ТРИГЕР, названий у щоденнику задачі: `hyphen-forbidden` і
 * `hyphen-across-spread` можуть спрацювати на ОДНОМУ рядку — рядок одночасно
 * останній у своєму фреймі (наступний рядок абзацу вже на іншій сторінці) і
 * несе слово зі списку заборонених переносів. Обидва правила рахують ТОЙ САМИЙ
 * уламок слова, тож `proposeFixes` дає буквально однакову правку для двох
 * РІЗНИХ знахідок, і `coalesceEdits` зводить їх в одну.
 */
describe("OPEN-B: зведена правка (coalesceEdits) лишає вердикт ОБОМ знахідкам, а не лише власнику", () => {
  const A = "hyphen-across-spread:story:0:0:0";
  const F = "hyphen-forbidden:story:0:0:0";

  /* Рядок 0: останній у фреймі, наступний рядок того самого абзацу — уже на
   * сторінці 13. `wordList` розриває слово «міжнародний» на «міжнарод» + «ний»,
   * і воно ж стоїть у `forbiddenWords`, тож обидва правила бачать той самий
   * уламок. */
  const lines = [
    ln({
      paragraphIndex: 0,
      lineInParagraph: 0,
      paragraphLineCount: 2,
      wordList: ["текст", "міжнарод"],
      endsWithHyphen: true,
      isLastInFrame: true,
      page: "12",
    }),
    ln({
      paragraphIndex: 0,
      lineInParagraph: 1,
      paragraphLineCount: 2,
      wordList: ["ний", "далі"],
      page: "13",
    }),
  ];
  const CONTAINERS = [{ containerId: "story:0", text: "текст міжнародний далі" }];

  it("обидві знахідки справді зводяться в ОДНУ правку (передумова тесту, а не гіпотеза)", async () => {
    bridge(measureOf(lines), CONTAINERS, measureOf(lines));

    const dry = body(
      await applyHandler()({
        ...ARGS,
        dryRun: true,
        forbiddenWords: ["міжнародний"],
        pages: ["12"],
        findingIds: [A, F],
      }),
    );

    expect(dry.selected).toBe(2);
    expect(dry.edits).toHaveLength(1);
    expect([A, F]).toContain(dry.edits[0].requestId);
  });

  it("InDesign повертає ОДИН applied під requestId власника — вердикт дістають ОБИДВІ знахідки", async () => {
    /*
     * Це РІВНО той мутант, що вижив: підміна `editGroups.get(a.requestId) ??
     * [a.requestId]` на `[a.requestId]` лишила б без вердикту ту знахідку, чий
     * requestId НЕ обрав `coalesceEdits` за власника зведеної правки. Owner
     * дізнаємось із сухого прогону — той самий шлях, яким його бачить
     * оператор, а не здогад про порядок findingIds.
     */
    bridge(measureOf(lines), CONTAINERS, measureOf(lines));
    const dry = body(
      await applyHandler()({
        ...ARGS,
        dryRun: true,
        forbiddenWords: ["міжнародний"],
        pages: ["12"],
        findingIds: [A, F],
      }),
    );
    const owner = dry.edits[0].requestId as string;

    bridge(measureOf(lines), CONTAINERS, measureOf(lines));
    runWriteMock.mockResolvedValue({
      ...WRITE_OK,
      applied: [{ requestId: owner }],
      trackingApplied: [],
    });

    const r = body(
      await applyHandler()({
        ...ARGS,
        forbiddenWords: ["міжнародний"],
        pages: ["12"],
        findingIds: [A, F],
      }),
    );

    expect(r.attempted.slice().sort()).toEqual([A, F].slice().sort());
    /* Головна перевірка задачі: ОБИДВІ знахідки, не лише `owner`. */
    expect(r.written.slice().sort()).toEqual([A, F].slice().sort());
    expect(r.notWritten).toEqual([]);
    expect(
      r.verification.map((v: { findingId: string }) => v.findingId).slice().sort(),
    ).toEqual([A, F].slice().sort());
  });
});

describe("composition_apply — обов'язок №4: blocked і shortfall видно", () => {
  it("невидиме виправлення без знімка свого контейнера звітує причину, а не мовчить", async () => {
    /* Рядок із переносом і словом у списку заборонених дає hyphen-forbidden,
     * тобто невидиме виправлення. `containers_read` віддає порожній список —
     * адресувати правку нема з чого, і причина мусить бути названа.
     *
     * Причина тут саме «серед переданих знімків немає контейнера», а не
     * «передайте opts.containers»: цей інструмент знімки читає ЗАВЖДИ, тож
     * другого повідомлення `propose.ts` він не породжує за побудовою. */
    const common = { containerId: "story:0", paragraphIndex: 0, paragraphLineCount: 2 };
    const lines = [
      ln({ ...common, lineInParagraph: 0, wordList: ["текст", "міжнарод"], endsWithHyphen: true }),
      ln({ ...common, lineInParagraph: 1, wordList: ["ний", "далі"], endsParagraph: true }),
    ];
    bridge(measureOf(lines), [], measureOf(lines));

    const r = body(
      await applyHandler()({
        ...ARGS,
        forbiddenWords: ["міжнародний"],
        pages: ["12"],
        findingIds: ["hyphen-forbidden:story:0:0:0"],
      }),
    );

    expect(r.applied).toBe(0);
    expect(r.blocked).toHaveLength(1);
    expect(r.blocked[0].reason).toContain("story:0");
    expect(runWriteMock).not.toHaveBeenCalled();
  });

  it("недобір трекінгу видно числом: пропозиція, що покриває менше за потрібне", async () => {
    /*
     * Абзац із 22 символів просування при кеглі 10: щоб утягнути кінцевий рядок
     * (10 пт із 200), потрібно ≈45 одиниць трекінгу, а межа — 20. Тобто запис
     * буде, і його свідомо НЕ ВИСТАЧИТЬ — саме про це поле shortfall.
     */
    const lines = shortLastParagraph(0);
    bridge(measureOf(lines), [], measureOf(lines));

    const r = body(
      await applyHandler()({
        ...ARGS,
        dryRun: true,
        pages: ["12"],
        findingIds: ["short-last-line:story:0:0:1"],
      }),
    );

    expect(r.shortfalls).toHaveLength(1);
    expect(r.shortfalls[0].appliedDelta).toBe(-20);
    expect(Math.abs(r.shortfalls[0].requiredDelta)).toBeGreaterThan(20);
    expect(r.shortfalls[0].coverage).toBeLessThan(1);
  });
});

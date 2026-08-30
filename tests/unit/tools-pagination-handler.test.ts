import { expect, it, vi } from "vitest";
import type { PaginationMeasure } from "../../src/pagination/types.js";
import type { Tools } from "../../src/tools/shared.js";

/*
 * Той самий патерн, що в tools-styles-handler.test.ts: місток підмінено,
 * обробник викликається напряму, живий InDesign не залучається.
 */
const { runJsxMock } = vi.hoisted(() => ({ runJsxMock: vi.fn() }));
vi.mock("../../src/bridge/runner.js", () => ({ runJsx: runJsxMock }));

const { registerPaginationTools } = await import("../../src/tools/pagination.js");

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
type AnyHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

function handler(): AnyHandler {
  let captured: AnyHandler | null = null;
  const fake = {
    registerTool(name: string, _cfg: unknown, h: AnyHandler) {
      if (name === "pagination_audit") captured = h;
    },
  } as unknown as Tools;
  registerPaginationTools(fake);
  if (!captured) throw new Error("pagination_audit не зареєстровано");
  return captured;
}

function measure(over: Partial<PaginationMeasure> = {}): PaginationMeasure {
  return {
    docName: "d.indd",
    pages: [
      { name: "2", offset: 1, side: "LEFT_HAND", spreadIndex: 1, spreadSiblings: ["3"], master: null },
      { name: "3", offset: 2, side: "RIGHT_HAND", spreadIndex: 1, spreadSiblings: ["2"], master: null },
    ],
    folioFrames: [],
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

const FOLIO = { folio: { styleName: "Kolontsyfra" } };

it("жодної родини не оголошено — відмова, а не марний прохід по документу", async () => {
  runJsxMock.mockReset();
  const res = await handler()({});
  expect(res.isError).toBe(true);
  expect(runJsxMock).not.toHaveBeenCalled();
});

it("відсутній стиль — ГУЧНА помилка, а не нуль знахідок", async () => {
  /* Друкарська помилка в назві стилю інакше дає порожній звіт, який
   * читається як «усе чисто» — відмовний режим, який Фаза 5 ловила п'ять
   * разів. */
  runJsxMock.mockReset();
  runJsxMock.mockResolvedValue(measure({ missingStyles: ["nemaie-takoho"] }));
  const res = await handler()(FOLIO);
  expect(res.isError).toBe(true);
  expect(res.content[0]!.text).toContain("nemaie-takoho");
});

it("родина без оголошення дорівнює null, оголошена без знахідок — звіту з нулями", async () => {
  runJsxMock.mockReset();
  runJsxMock.mockResolvedValue(measure());
  const res = await handler()(FOLIO);
  const data = JSON.parse(res.content[0]!.text);
  expect(data.contents).toBeNull();
  expect(data.folio).toEqual({ checked: 0, deviating: 0, notCompared: 0, groups: [] });
});

it("майстрова рамка ОГОЛОШЕНОГО стилю доїжджає у звіт, а не гине мовчки", async () => {
  /*
   * Гучний канал до рішення §4.1 «майстрова рамка бере участь лише як
   * колонцифра». Сценарій відмови повний: видання з шаблонним змістом дає
   * родину contents із самими нулями — форму, яку і людина, і §3 читають як
   * «усе чисто». Тут вимір каже, що 40 рядків змісту лежать на батьківських,
   * і це має бути ВИДНО у відповіді інструмента, а не лише у вимірі.
   */
  runJsxMock.mockReset();
  runJsxMock.mockResolvedValue(
    measure({
      masterSkipped: {
        declared: [{ styleName: "Zmist Rozdil", role: "title", frames: 40 }],
        undeclared: 83,
      },
    }),
  );
  const res = await handler()({
    ...FOLIO,
    contents: { numberStyle: "Zmist Cyfra", levelMap: [{ contentsStyle: "Zmist Rozdil", headingStyles: ["Zagolovok"] }] },
  });
  const data = JSON.parse(res.content[0]!.text);
  expect(data.masterSkipped).toEqual([{ styleName: "Zmist Rozdil", role: "title", frames: 40 }]);
  /* Родина при цьому порожня — саме та форма, яку поле рятує від хибного
   * прочитання. */
  expect(data.contents.checked).toBe(0);
  /*
   * `undeclared` у відповідь НЕ їде: на книжці таких рамок сотні, а форма
   * відповіді тут обчислений примус (§5.2), не смак.
   *
   * ПЕРЕВІРЯЄМО ВІДСУТНІСТЬ КЛЮЧА, А НЕ ПІДРЯДКА. Доти тут стояло
   * `JSON.stringify(data)).not.toContain("83")` — перевірка, яка впала б на
   * сторінці з назвою «83» або на `checked: 183`, тобто карала б за дані, а
   * не за форму. Ключ шукається рекурсивно, бо саме поява ключа будь-де у
   * відповіді й була б порушенням.
   */
  const hasKey = (node: unknown, key: string): boolean => {
    if (Array.isArray(node)) return node.some((v) => hasKey(v, key));
    if (node === null || typeof node !== "object") return false;
    const obj = node as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(obj, key)) return true;
    return Object.values(obj).some((v) => hasKey(v, key));
  };
  expect(hasKey(data, "undeclared")).toBe(false);
  /* Негативний контроль: сам пошук працює — ключ, який у відповіді Є,
   * знаходиться. Інакше перевірка була б порожньою правдою. */
  expect(hasKey(data, "masterSkipped")).toBe(true);
});

it("порожній masterSkipped присутній у відповіді — «дивились» ≠ «не дивились»", async () => {
  runJsxMock.mockReset();
  runJsxMock.mockResolvedValue(measure());
  const res = await handler()(FOLIO);
  const data = JSON.parse(res.content[0]!.text);
  expect(data.masterSkipped).toEqual([]);
});

it("перетин рівнів відхиляється ДО виміру", async () => {
  /* Той самий заголовок спожили б двічі, і обидва рівні дали б хибні числа. */
  runJsxMock.mockReset();
  const res = await handler()({
    contents: {
      numberStyle: "N",
      levelMap: [
        { contentsStyle: "A", headingStyles: ["H1"] },
        { contentsStyle: "B", headingStyles: ["H1"] },
      ],
    },
  });
  expect(res.isError).toBe(true);
  expect(res.content[0]!.text).toContain("H1");
  expect(runJsxMock).not.toHaveBeenCalled();
});

it("detail для неоголошеної родини — відмова, а не тихий порожній перелік", async () => {
  runJsxMock.mockReset();
  const res = await handler()({ ...FOLIO, detail: { family: "contents" } });
  expect(res.isError).toBe(true);
  expect(runJsxMock).not.toHaveBeenCalled();
});

it("колонцифра зі зсувом доходить до звіту як folio-stale", async () => {
  runJsxMock.mockReset();
  runJsxMock.mockResolvedValue(
    measure({
      folioFrames: [
        {
          id: "f1", page: "3", styleName: "Kolontsyfra", rotationAngle: -90,
          paragraphs: [
            { index: 0, styleName: null, text: "9–￼", literals: [9], markers: ["auto-page-number"], literalOffsets: [0], baseline: 1, leading: 4 },
          ],
          /* Поля Фази 7. `overlaps: []` — «перевірили, не перекриває»: для
           * родини `folio` таблиця перекриттів будується завжди, тож `null`
           * («не рахували») тут був би станом, якого вимір не віддає. Маркера
           * сусідньої сторінки в рамці немає, отже детектори §4.9 мовчать, і
           * знахідкою лишається саме `folio-stale`. */
          bounds: { y1: 0, x1: 0, y2: 10, x2: 10 },
          layerName: "Layer 1", layerVisible: true, layerPrintable: true,
          fromMaster: false, locked: false, layerLocked: false, overlaps: [],
        },
      ],
    }),
  );
  const res = await handler()(FOLIO);
  const data = JSON.parse(res.content[0]!.text);
  /* deviating рахує лише дефекти ЧИСЛА: folio-manual поруч є, але він каже
   * про спосіб набору, а не про помилку, і в deviating не входить. */
  expect(data.folio.deviating).toBe(1);
  const defects = data.folio.groups.map((g: { defect: string }) => g.defect);
  expect(defects).toContain("folio-stale");
  expect(defects).toContain("folio-manual");
  const stale = data.folio.groups.find((g: { defect: string }) => g.defect === "folio-stale");
  /* Пояснення живе в example: зведення не сміє його з'їсти. */
  expect(stale.example.actual).toBe("2");
  expect(stale.count).toBe(1);
});

/*
 * ОБВ'ЯЗКА РОДИНИ `runningHead` У САМОМУ ІНСТРУМЕНТІ.
 *
 * Доти вона не мала жодного тесту: детектор перевірявся юнітами, збір —
 * інтеграційними, а те, що інструмент передає стилі у вимір і будує
 * очікування з майстрів, не перевіряв ніхто. Саме тут живуть два рішення
 * фази, які найлегше зламати мовчки.
 */
const HEAD_FRAME = {
  id: "h1",
  page: "2",
  styleName: "Kolontytul",
  fromMaster: true,
  masterName: "K",
  side: "LEFT_HAND" as const,
  text: "Розділ перший",
  empty: false,
  overset: false,
  appearance: { font: "F", pointSize: 10, fillValue: "CMYK:0,0,0,100" },
};

const HEADING = {
  styleName: "Zagolovok",
  text: "Розділ другий",
  page: "2",
  order: 0,
};

it("runningHead можна оголосити САМОСТІЙНО, і стилі доїжджають у вимір", async () => {
  runJsxMock.mockReset();
  runJsxMock.mockResolvedValue(measure({ headFrames: [HEAD_FRAME] }));
  const res = await handler()({ runningHead: { styleNames: ["Kolontytul"] } });
  expect(res.isError).toBeFalsy();
  expect(runJsxMock.mock.calls[0]![1]).toMatchObject({ runningHeadStyles: ["Kolontytul"] });
  const report = JSON.parse(res.content[0]!.text) as { runningHead: { checked: number } | null };
  expect(report.runningHead).not.toBeNull();
});

it("без headingStyles правило про розділ НЕ мовчить — воно звітує notCompared", async () => {
  /*
   * Нуль знахідок, не відрізнимий від «перевірено й чисто», — той самий
   * відмовний режим, який Фаза 5 ловила п'ять разів.
   */
  runJsxMock.mockReset();
  runJsxMock.mockResolvedValue(measure({ headFrames: [HEAD_FRAME] }));
  const res = await handler()({ runningHead: { styleNames: ["Kolontytul"] } });
  const report = JSON.parse(res.content[0]!.text) as {
    runningHead: { checked: number; notCompared: number };
  };
  expect(report.runningHead.notCompared).toBe(1);
  expect(report.runningHead.checked).toBe(0);
});

it("з headingStyles родина таки порівнює й знаходить чужий розділ", async () => {
  runJsxMock.mockReset();
  runJsxMock.mockResolvedValue(measure({ headFrames: [HEAD_FRAME], headings: [HEADING] }));
  const res = await handler()({
    runningHead: { styleNames: ["Kolontytul"] },
    headingStyles: ["Zagolovok"],
    detail: { family: "runningHead" },
  });
  const report = JSON.parse(res.content[0]!.text) as {
    runningHead: { checked: number; deviating: number };
    detail: { defect: string }[] | null;
  };
  expect(report.runningHead.checked).toBe(1);
  expect(report.runningHead.deviating).toBe(1);
  expect(report.detail!.map((d) => d.defect)).toContain("head-wrong-chapter");
});

it("очікування «тут має бути колонтитул» будується з МАЙСТРІВ, а не з номера сторінки", async () => {
  /*
   * Рішення користувача на виміряному стані: у книжці 78 сторінок майстра
   * «Шаблон інтерв'ю» свідомо без колонтитула. Сторінка «3» тут має ІНШИЙ
   * майстер, ніж той, що дає колонтитул, — отже head-missing на ній не
   * виникає. Правило за номером сторінки доповіло б про неї.
   */
  runJsxMock.mockReset();
  const m = measure({ headFrames: [HEAD_FRAME], headings: [HEADING] });
  m.pages[0]!.master = "K";
  m.pages[1]!.master = "F-інтерв'ю";
  m.pages[1]!.side = "LEFT_HAND";
  runJsxMock.mockResolvedValue(m);
  const res = await handler()({
    runningHead: { styleNames: ["Kolontytul"] },
    headingStyles: ["Zagolovok"],
    detail: { family: "runningHead" },
  });
  const report = JSON.parse(res.content[0]!.text) as { detail: { defect: string }[] | null };
  expect(report.detail!.map((d) => d.defect)).not.toContain("head-missing");
});

it("сторінка ПІД ТИМ САМИМ майстром без колонтитула дає head-missing", async () => {
  /*
   * Позитивна половина попереднього тесту, і без неї він нічого не тримав:
   * мутант «expectedByMaster завжди порожній» проходив зеленим, бо
   * «head-missing немає» істинне й тоді, коли правило не працює взагалі.
   * Негативне твердження без позитивного — перевірка, що не може впасти.
   */
  runJsxMock.mockReset();
  const m = measure({ headFrames: [HEAD_FRAME], headings: [HEADING] });
  m.pages[0]!.master = "K";
  m.pages[1]!.master = "K";
  m.pages[1]!.side = "LEFT_HAND";
  runJsxMock.mockResolvedValue(m);
  const res = await handler()({
    runningHead: { styleNames: ["Kolontytul"] },
    headingStyles: ["Zagolovok"],
    detail: { family: "runningHead" },
  });
  const report = JSON.parse(res.content[0]!.text) as { detail: { defect: string; page: string }[] | null };
  const missing = report.detail!.filter((d) => d.defect === "head-missing");
  expect(missing).toHaveLength(1);
  expect(missing[0]!.page).toBe("3");
});

it("detail для runningHead без оголошеної родини — відмова", async () => {
  runJsxMock.mockReset();
  const res = await handler()({ ...FOLIO, detail: { family: "runningHead" } });
  expect(res.isError).toBe(true);
  expect(runJsxMock).not.toHaveBeenCalled();
});

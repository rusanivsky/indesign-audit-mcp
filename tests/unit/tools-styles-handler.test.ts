import { expect, it, vi } from "vitest";
import type { StyleValues } from "../../src/layout/types.js";
import type { CharacterStyleUsage, DeclaredStyle, RangeMeasure, ScaleMeasure, StylesMeasure } from "../../src/styles/types.js";
import { serialise, type Tools } from "../../src/tools/shared.js";

/*
 * Той самий патерн, що в tests/unit/tools-map-handler.test.ts: місток
 * підмінено, обробник викликається напряму через registerTool-пастку, живий
 * InDesign сюди не залучається взагалі.
 *
 * ПАСТКА 2 (та сама, що вже названа коментарем у tools-map-handler.test.ts):
 * підроблений `registerTool` НЕ прогонює аргументи через zod, тож
 * замовчування схеми (`families`) тут НЕ застосовуються самі — виклик
 * `handler({})` дає `families === undefined`, не список за замовчуванням.
 * Там, де тест мусить спертися саме на замовчування, він читає схему поля
 * напряму й кличе `.parse(undefined)` — той самий патерн, що вже усталений
 * у tests/unit/tools-map.test.ts; в усіх інших тестах `families` передається
 * явно, щоб тіло обробника проходило успішним шляхом до кінця, а не падало
 * на `families.includes` (рецензія кола 1, Дрібне п.1).
 */
const { runJsxMock } = vi.hoisted(() => ({ runJsxMock: vi.fn() }));
vi.mock("../../src/bridge/runner.js", () => ({ runJsx: runJsxMock }));

const { IndesignError } = await import("../../src/bridge/errors.js");
const { registerStyleTools, STYLES_MEASURE_TIMEOUT_MS } = await import("../../src/tools/styles.js");

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
type AnyHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

const ALL_FAMILIES = ["usage", "overrides", "scale", "character", "hierarchy"];

function stylesAuditHandler(): AnyHandler {
  let captured: AnyHandler | null = null;
  const fake = {
    registerTool(name: string, _cfg: unknown, handler: AnyHandler) {
      if (name === "styles_audit") captured = handler;
    },
  } as unknown as Tools;
  registerStyleTools(fake);
  if (!captured) throw new Error("styles_audit не зареєстровано");
  return captured;
}

/**
 * Замовчування поля `families` схеми, читане так само, як tests/unit/
 * tools-map.test.ts читає замовчування `layout_audit`: збір у масив, а не
 * nullable-змінна в замиканні — саме цей патерн уже пройшов typecheck у
 * проєкті.
 */
function stylesAuditFamiliesSchema(): { parse: (v?: unknown) => string[] } {
  return stylesAuditInputSchema().families as { parse: (v?: unknown) => string[] };
}

/**
 * Схема `detail` — для Important 3 (рецензія кола 2): `.refine()`, що
 * вимагає `group` для `family: "overrides"`, не мав жодного тесту. Той
 * самий доступ до конфігурації, що для `families`.
 */
function stylesAuditDetailSchema(): { safeParse: (v: unknown) => { success: boolean } } {
  return stylesAuditInputSchema().detail as { safeParse: (v: unknown) => { success: boolean } };
}

/**
 * Опис інструмента — те, що оператор (чи модель) читає ПЕРЕД викликом.
 * Доступ той самий, що вже вжитий для `inputSchema`: конфігурація, яку
 * `registerStyleTools` передає в `registerTool`.
 */
function stylesAuditDescription(): string {
  const configs: { name: string; description: string }[] = [];
  const fake = {
    registerTool(name: string, cfg: { description: string }) {
      configs.push({ name, description: cfg.description });
    },
  } as unknown as Tools;
  registerStyleTools(fake);
  const cfg = configs.find((c) => c.name === "styles_audit");
  if (!cfg) throw new Error("styles_audit не зареєстровано");
  return cfg.description;
}

function stylesAuditInputSchema(): Record<string, unknown> {
  const configs: { name: string; inputSchema: Record<string, unknown> }[] = [];
  const fake = {
    registerTool(name: string, cfg: { inputSchema: Record<string, unknown> }) {
      configs.push({ name, inputSchema: cfg.inputSchema });
    },
  } as unknown as Tools;
  registerStyleTools(fake);
  const cfg = configs.find((c) => c.name === "styles_audit");
  if (!cfg) throw new Error("styles_audit не зареєстровано");
  return cfg.inputSchema;
}

const EMPTY_VALUES: StyleValues = {
  firstLineIndent: null, leftIndent: null, rightIndent: null,
  spaceBefore: null, spaceAfter: null, pointSize: null, leading: null,
  justification: null, appliedFont: null, fontStyle: null, tracking: null, listType: null,
};

function style(name: string, id = name): DeclaredStyle {
  return {
    id, name, path: name, basedOn: null, basedOnId: null, nextStyle: null,
    declared: { ...EMPTY_VALUES, firstLineIndent: 0 },
  };
}

/** Абзац, що ВІДХИЛЯЄТЬСЯ від стилю за firstLineIndent (група `indents`). */
function deviant(styleName: string, index: number, styleId = styleName) {
  return {
    containerId: "story:1", paragraphIndex: index, page: "1", styleName, styleId,
    isMaster: false,
    declared: { ...EMPTY_VALUES, firstLineIndent: 0 },
    actual: { ...EMPTY_VALUES, firstLineIndent: 12 },
    hasCharacterStyleRuns: false, preview: "",
  };
}

/**
 * Абзац, що відхиляється у ДВОХ властивостях ОДНІЄЇ групи `indents`
 * (`leftIndent` і `rightIndent`) — Important 2, коло 2: `overridePropertyDeviations`
 * рахує пари (абзац, властивість), тож цей один абзац мусить дати 2, не 1.
 */
function deviantTwoProperties(styleName: string, index: number, styleId = styleName) {
  return {
    containerId: "story:1", paragraphIndex: index, page: "1", styleName, styleId,
    isMaster: false,
    declared: { ...EMPTY_VALUES, leftIndent: 0, rightIndent: 0 },
    actual: { ...EMPTY_VALUES, leftIndent: 5, rightIndent: 5 },
    hasCharacterStyleRuns: false, preview: "",
  };
}

/** Абзац напряму на службовому стилі — джерело `default-style-applied`. */
function defaultStyleParagraph(index: number, opts: { isMaster?: boolean; styleName?: string } = {}) {
  const styleName = opts.styleName ?? "[Basic Paragraph]";
  return {
    containerId: "story:1", paragraphIndex: index, page: String(index), styleName, styleId: styleName,
    isMaster: opts.isMaster ?? false,
    declared: { ...EMPTY_VALUES, firstLineIndent: 0 },
    actual: { ...EMPTY_VALUES, firstLineIndent: 0 },
    hasCharacterStyleRuns: false, preview: "",
  };
}

function measure(overrides: Partial<StylesMeasure> = {}): StylesMeasure {
  return {
    docName: "Test.indd",
    styles: [],
    paragraphs: [],
    ranges: [],
    characterStyles: [],
    scales: [],
    paragraphsOffPage: 0,
    ...overrides,
  };
}

const EMPTY_MEASURE = measure();

it("родини за замовчуванням — усі п'ять (поправка за Задачами 12–14)", () => {
  expect(stylesAuditFamiliesSchema().parse(undefined)).toEqual(ALL_FAMILIES);
});

it("вимір кличеться з власним таймаутом, не із замовчуванням містка", async () => {
  runJsxMock.mockReset();
  runJsxMock.mockResolvedValue(EMPTY_MEASURE);
  await stylesAuditHandler()({ families: ALL_FAMILIES });
  expect(runJsxMock).toHaveBeenCalledWith("styles_measure", {}, { timeoutMs: STYLES_MEASURE_TIMEOUT_MS });
});

it("помилка містка віддається як текст із підказкою, а не як виняток протоколу", async () => {
  runJsxMock.mockReset();
  runJsxMock.mockRejectedValue(new IndesignError("no-document", "Немає документа.", "Відкрийте документ."));
  const result = await stylesAuditHandler()({ families: ALL_FAMILIES });
  expect(result.isError).toBe(true);
  expect(result.content[0]!.text).toContain("Відкрийте документ");
});

it("параметра pages немає — аудит стилів на діапазоні систематично брехав би", async () => {
  runJsxMock.mockReset();
  runJsxMock.mockResolvedValue(EMPTY_MEASURE);
  await stylesAuditHandler()({ pages: ["1", "2"], families: ALL_FAMILIES });
  expect(runJsxMock).toHaveBeenCalledWith("styles_measure", {}, { timeoutMs: STYLES_MEASURE_TIMEOUT_MS });
});

it("названа одна родина — решта не рахується, навіть коли матеріал для них є", async () => {
  runJsxMock.mockReset();
  const m = measure({
    styles: [style("A"), style("Unused")],
    paragraphs: [deviant("A", 0), defaultStyleParagraph(1)],
    characterStyles: [{ id: "cs1", name: "Симв", appliedRuns: 0 } satisfies CharacterStyleUsage],
    scales: [
      { containerId: "story:1", paragraphIndex: 0, page: "1", styleName: "A", styleId: "A", horizontalScale: 96, verticalScale: 100 } satisfies ScaleMeasure,
    ],
  });
  runJsxMock.mockResolvedValue(m);
  const result = await stylesAuditHandler()({ families: ["scale"] });
  const body = JSON.parse(result.content[0]!.text) as {
    scale: { groups: unknown[] } | null;
    character: unknown;
    hierarchy: unknown;
    usage: unknown;
    findings: unknown[];
    totals: Record<string, unknown>;
  };
  expect(body.scale?.groups).toHaveLength(1);
  /* "Unused" дав би usage-знахідку, абзац 1 — default-style-applied, невживаний
   * символьний стиль — character-знахідку — жодна не мала б з'явитись. */
  expect(body.findings).toHaveLength(0);
  expect(body.usage).toBeNull();
  expect(body.character).toBeNull();
  expect(body.hierarchy).toBeNull();
  expect(body.totals.usageUnusedStyles).toBeNull();
  expect(body.totals.usageDefaultStyleApplied).toBeNull();
});

it("detail адресує overrides за styleId, а не за назвою (поправка §2) — два однойменні стилі розрізняються", async () => {
  runJsxMock.mockReset();
  const m = measure({
    styles: [style("Header", "id1"), style("Header", "id2")],
    paragraphs: [deviant("Header", 0, "id1"), deviant("Header", 1, "id2")],
  });
  runJsxMock.mockResolvedValue(m);
  const result = await stylesAuditHandler()({
    families: ALL_FAMILIES,
    detail: { family: "overrides", styleId: "id1", group: "indents" },
  });
  const body = JSON.parse(result.content[0]!.text) as { detail: { styleId: string; containerId: string | null }[] };
  expect(body.detail).toHaveLength(1);
  expect(body.detail[0]!.styleId).toBe("id1");
});

/*
 * Important 5 (рецензія кола 1): раніше `detail` умів лише `overrides` —
 * для `scale`/`character` числа були непридатні до дії, бо способу дійти
 * до конкретного місця не існувало. Тепер `detail.family` покриває всі
 * чотири поабзацні/подіапазонні класи.
 */
it("detail адресує scale за styleId — поіменні місця масштабованого тексту", async () => {
  runJsxMock.mockReset();
  const m = measure({
    scales: [
      { containerId: "story:1", paragraphIndex: 0, page: "1", styleName: "A", styleId: "A", horizontalScale: 96, verticalScale: 100 } satisfies ScaleMeasure,
      { containerId: "story:1", paragraphIndex: 1, page: "1", styleName: "B", styleId: "B", horizontalScale: 96, verticalScale: 100 } satisfies ScaleMeasure,
    ],
  });
  runJsxMock.mockResolvedValue(m);
  const result = await stylesAuditHandler()({
    families: ALL_FAMILIES,
    detail: { family: "scale", styleId: "A" },
  });
  const body = JSON.parse(result.content[0]!.text) as { detail: { styleId: string; paragraphIndex: number | null }[] };
  expect(body.detail).toHaveLength(1);
  expect(body.detail[0]!.paragraphIndex).toBe(0);
});

it("detail адресує character за styleId — поіменні діапазони локального форматування", async () => {
  runJsxMock.mockReset();
  const m = measure({
    styles: [style("A")],
    paragraphs: [
      {
        containerId: "story:1", paragraphIndex: 0, page: "1", styleName: "A", styleId: "A",
        isMaster: false,
        declared: { ...EMPTY_VALUES, firstLineIndent: 0, pointSize: 11 },
        actual: { ...EMPTY_VALUES, firstLineIndent: 0, pointSize: 11 },
        hasCharacterStyleRuns: false, preview: "",
      },
    ],
    ranges: [
      {
        containerId: "story:1", paragraphIndex: 0, rangeIndex: 0, characterStyle: "[None]",
        pointSize: 17, appliedFont: null, fontStyle: null, tracking: null, horizontalScale: null,
      } satisfies RangeMeasure,
    ],
  });
  runJsxMock.mockResolvedValue(m);
  const result = await stylesAuditHandler()({
    families: ALL_FAMILIES,
    detail: { family: "character", styleId: "A" },
  });
  const body = JSON.parse(result.content[0]!.text) as { detail: { styleId: string; paragraphIndex: number | null }[] };
  expect(body.detail).toHaveLength(1);
  expect(body.detail[0]!.paragraphIndex).toBe(0);
});

/*
 * Important 1 (рецензія кола 2): `characterRangesDeviating` мусить рахувати
 * РІЗНІ діапазони, не пари (діапазон, властивість). Один діапазон, що
 * відхиляється у ДВОХ властивостях (pointSize і appliedFont), — та сама
 * фікстура, яку стара версія тесту (одна властивість на діапазон) не
 * могла розрізнити від правильної семантики.
 */
it("characterRangesDeviating рахує РІЗНІ діапазони, не пари (діапазон, властивість)", async () => {
  runJsxMock.mockReset();
  const m = measure({
    styles: [style("A")],
    paragraphs: [
      {
        containerId: "story:1", paragraphIndex: 0, page: "1", styleName: "A", styleId: "A",
        isMaster: false,
        declared: { ...EMPTY_VALUES, firstLineIndent: 0, pointSize: 11, appliedFont: "Proba Pro" },
        actual: { ...EMPTY_VALUES, firstLineIndent: 0, pointSize: 11, appliedFont: "Proba Pro" },
        hasCharacterStyleRuns: false, preview: "",
      },
    ],
    ranges: [
      {
        /* ОДИН діапазон, ДВІ властивості відхиляються одразу. */
        containerId: "story:1", paragraphIndex: 0, rangeIndex: 0, characterStyle: "[None]",
        pointSize: 17, appliedFont: "Apple Symbols", fontStyle: null, tracking: null, horizontalScale: null,
      } satisfies RangeMeasure,
    ],
  });
  runJsxMock.mockResolvedValue(m);
  const result = await stylesAuditHandler()({ families: ALL_FAMILIES });
  const body = JSON.parse(result.content[0]!.text) as {
    character: { rangesDeviating: number; byProperty: Record<string, number> } | null;
  };
  /* Один діапазон — rangesDeviating === 1, не 2 (стара лічба за
   * (діапазон, властивість) роздула б число рівно так, як роздувала його
   * стара лічба зонда H5: 864 пари проти 449 місць. ОБИДВА ці числа —
   * ЗОНДОВІ й міряні на ВУЖЧІЙ популяції (3137 голих діапазонів, тоді як
   * детектор ходить по всіх 3480 і виключає батьківські), тож вони тут
   * лише як МОТИВАЦІЯ форми лічби, а не як очікуване значення. У текст
   * для оператора їх повертати не можна — саме звідти їх прибрала
   * фінальна рецензія (I-1, I-2). */
  expect(body.character?.rangesDeviating).toBe(1);
  /* byProperty лишається розкладом за властивістю — сума 2, і це не
   * суперечність: rangesDeviating рахує МІСЦЯ, byProperty рахує ВІДХИЛЕННЯ. */
  expect(body.character?.byProperty.pointSize).toBe(1);
  expect(body.character?.byProperty.appliedFont).toBe(1);
  const byPropertySum = Object.values(body.character?.byProperty ?? {}).reduce((a, b) => a + b, 0);
  expect(byPropertySum).toBeGreaterThanOrEqual(body.character?.rangesDeviating ?? 0);
});

/*
 * Important 2 (рецензія кола 2): `overridePropertyDeviations` рахує пари
 * (абзац, ВЛАСТИВІСТЬ), не (абзац, група) — стара назва `overridePairs` і
 * коментар «(абзац, група)» самі містили дефект, проти якого писався фікс
 * Important 3 кола 1. Один абзац, що відхиляється в leftIndent і
 * rightIndent (обидві — група `indents`), дає 2.
 */
it("overridePropertyDeviations рахує пари (абзац, властивість) — leftIndent+rightIndent дають 2, не 1", async () => {
  runJsxMock.mockReset();
  const m = measure({
    styles: [style("A")],
    paragraphs: [deviantTwoProperties("A", 0)],
  });
  runJsxMock.mockResolvedValue(m);
  const result = await stylesAuditHandler()({ families: ALL_FAMILIES });
  const body = JSON.parse(result.content[0]!.text) as {
    styles: { styleName: string; deviating: number }[];
    totals: { overridePropertyDeviations: number | null };
  };
  expect(body.totals.overridePropertyDeviations).toBe(2);
  /* Абзац лишається ОДНИМ — deviating рахує РІЗНІ абзаци, не властивості. */
  expect(body.styles.find((r) => r.styleName === "A")!.deviating).toBe(1);
});

it("detail адресує usage (default-style-applied) за styleId службового стилю; батьківський абзац виключений (Дрібне п.2)", async () => {
  runJsxMock.mockReset();
  const m = measure({
    paragraphs: [
      defaultStyleParagraph(0),
      defaultStyleParagraph(1),
      defaultStyleParagraph(2, { isMaster: true }),
    ],
  });
  runJsxMock.mockResolvedValue(m);
  const result = await stylesAuditHandler()({
    families: ALL_FAMILIES,
    detail: { family: "usage", styleId: "[Basic Paragraph]" },
  });
  const body = JSON.parse(result.content[0]!.text) as {
    detail: { paragraphIndex: number | null }[];
    usage: { defaultStyleApplied: number } | null;
    totals: { usageDefaultStyleApplied: number | null };
  };
  expect(body.detail).toHaveLength(2);
  expect(body.detail.map((d) => d.paragraphIndex).sort()).toEqual([0, 1]);
  expect(body.usage?.defaultStyleApplied).toBe(2);
  expect(body.totals.usageDefaultStyleApplied).toBe(2);
});

/*
 * CRITICAL (рецензія кола 1). Другий цикл detectUsage видає
 * default-style-applied НА КОЖЕН абзац зі службовим стилем — межа за
 * побудовою була за кількістю АБЗАЦІВ, не стилів. Тест відтворює саме цей
 * клас (не character-override, як у попередній версії тесту обсягу) і
 * перевіряє, що сума рахується, а сирого переліку 700 адрес немає.
 */
it("родина usage не роздуває відповідь навіть коли абзаців на службовому стилі сотні", async () => {
  runJsxMock.mockReset();
  const paragraphs: StylesMeasure["paragraphs"] = [];
  for (let i = 0; i < 700; i++) paragraphs.push(defaultStyleParagraph(i));
  const m = measure({ paragraphs });
  runJsxMock.mockResolvedValue(m);
  const result = await stylesAuditHandler()({ families: ALL_FAMILIES });
  const body = JSON.parse(result.content[0]!.text) as {
    findings: unknown[];
    totals: { usageDefaultStyleApplied: number };
  };
  expect(body.totals.usageDefaultStyleApplied).toBe(700);
  expect(body.findings).toHaveLength(0);
  expect(result.content[0]!.text.length).toBeLessThan(20_000);
});

/*
 * Тест на ОБСЯГ, не лише на вміст (поправка §5). Фаза 4 вже спіткнулася,
 * коли 78 КБ на трьох сторінках зробили інструмент непридатним. Тут 600
 * діапазонів, кожен із реальним відхиленням pointSize від абзацного
 * еталона, — на робочій книжці таких СОТНІ (449 зонда H5 міряно на
 * вужчій популяції — самих лише голих діапазонів; число інструмента не
 * виміряне); якби `character` віддавала їх
 * поіменно за замовчуванням, відповідь розпухла б рівно так само.
 */
it("родина character не роздуває відповідь навіть коли відхилень сотні", async () => {
  runJsxMock.mockReset();
  const paragraphs: StylesMeasure["paragraphs"] = [];
  const ranges: RangeMeasure[] = [];
  for (let i = 0; i < 600; i++) {
    paragraphs.push({
      containerId: "story:1", paragraphIndex: i, page: String(i), styleName: "A", styleId: "A",
      isMaster: false,
      declared: { ...EMPTY_VALUES, firstLineIndent: 0, pointSize: 11 },
      actual: { ...EMPTY_VALUES, firstLineIndent: 0, pointSize: 11 },
      hasCharacterStyleRuns: false, preview: "",
    });
    ranges.push({
      containerId: "story:1", paragraphIndex: i, rangeIndex: 0, characterStyle: "[None]",
      pointSize: 17, appliedFont: null, fontStyle: null, tracking: null, horizontalScale: null,
    });
  }
  const m = measure({ styles: [style("A")], paragraphs, ranges });
  runJsxMock.mockResolvedValue(m);
  const result = await stylesAuditHandler()({ families: ALL_FAMILIES });
  const body = JSON.parse(result.content[0]!.text) as { character: { rangesDeviating: number } | null };
  /* Сума ВИМІРЯНА (родина рахує факт), але поіменного переліку 600 адрес у
   * відповіді немає — рівно те рішення, яке рятує обсяг. */
  expect(body.character?.rangesDeviating).toBe(600);
  expect(result.content[0]!.text.length).toBeLessThan(20_000);
});

/*
 * ТРИ МУТАНТИ, ЯКІ НЕ ЛОВИЛИСЬ (рецензія кола 1) — закриті нижче.
 */

/** Мутант: totals.findings як подвійна лічба по родинах — головна вимога §3 без сторожа. */
it("totals — фіксований набір ключів, кожен своя одиниця, без спільної суми", async () => {
  runJsxMock.mockReset();
  const m = measure({
    styles: [style("A"), style("Unused")],
    paragraphs: [deviant("A", 0), defaultStyleParagraph(1)],
    characterStyles: [{ id: "cs1", name: "Симв", appliedRuns: 0 } satisfies CharacterStyleUsage],
    scales: [
      { containerId: "story:1", paragraphIndex: 0, page: "1", styleName: "A", styleId: "A", horizontalScale: 96, verticalScale: 100 } satisfies ScaleMeasure,
    ],
  });
  runJsxMock.mockResolvedValue(m);
  const result = await stylesAuditHandler()({ families: ALL_FAMILIES });
  const body = JSON.parse(result.content[0]!.text) as { totals: Record<string, unknown> };
  expect(Object.keys(body.totals).sort()).toEqual(
    [
      "declaredStyles",
      "usedStyles",
      "paragraphs",
      "paragraphsOffPage",
      "usageUnusedBaseStyles",
      "usageUnusedLeafStyles",
      "usageUnusedStyles",
      "usageDefaultStyleApplied",
      "overridePropertyDeviations",
      "scaleParagraphs",
      "characterRangesDeviating",
      "hierarchyStylesInChains",
    ].sort(),
  );
});

/**
 * Мутанти: `buildReport(measure)` без `{ withOverrides }` (замовчування
 * `true` з'їдає прапорець) і `buildReport` з порожнім списком абзаців,
 * коли `overrides` вимкнено (стиль виглядав би невживаним). Один тест
 * ловить обидва — рекомендація рецензії.
 */
it("родина overrides вимкнена — deviating/ratio нульові, а вжиток усе одно рахується з повного списку", async () => {
  runJsxMock.mockReset();
  const m = measure({ styles: [style("A")], paragraphs: [deviant("A", 0)] });
  runJsxMock.mockResolvedValue(m);
  const result = await stylesAuditHandler()({ families: ["scale"] });
  const body = JSON.parse(result.content[0]!.text) as {
    styles: { styleName: string; deviating: number; ratio: number | null }[];
    totals: { usedStyles: number };
  };
  const row = body.styles.find((r) => r.styleName === "A")!;
  expect(row.deviating).toBe(0);
  expect(row.ratio).toBeNull();
  expect(body.totals.usedStyles).toBe(1);
});

/*
 * РЕЦЕНЗІЯ КОЛА 2 — нові тести нижче.
 */

/*
 * CRITICAL: `detail` не мав стелі — саме той виклик, по який оператор
 * піде, побачивши суму в сотні діапазонів, розпух би так само, як дефолтна відповідь
 * розпухла б без фіксу кола 1. Стеля — MAX_DETAIL_ITEMS (50, той самий
 * порядок, що MAX_CANDIDATES_PER_REQUEST у src/corrections/planner.ts).
 * Обрізання НАЗВАНЕ через detailTruncated, не мовчазне.
 */
/*
 * Дрібне п.1 (рецензія кола 3): попередня фікстура (80 записів) і поріг
 * (30 000) не пробивались одне одним — зняття стелі цілком (мутант A) не
 * порушувало б розмірну межу, лише `toHaveLength(50)` ловив мутанта.
 * 150 записів без стелі — ≈43 КБ (виміряно серіалізацією); поріг 20 000
 * лежить МІЖ обрізаною відповіддю (≈15–16 КБ) і неурізаною (≈43 КБ), тож
 * тепер сама розмірна перевірка теж падає, якщо стелю прибрати.
 */
it("detail обрізається до стелі; обрізання назване через detailTruncated, не мовчазне", async () => {
  runJsxMock.mockReset();
  const scales: ScaleMeasure[] = [];
  for (let i = 0; i < 150; i++) {
    scales.push({
      containerId: "story:1", paragraphIndex: i, page: String(i), styleName: "A", styleId: "A",
      horizontalScale: 96, verticalScale: 100,
    });
  }
  const m = measure({ scales });
  runJsxMock.mockResolvedValue(m);
  const result = await stylesAuditHandler()({
    families: ALL_FAMILIES,
    detail: { family: "scale", styleId: "A" },
  });
  const body = JSON.parse(result.content[0]!.text) as {
    detail: unknown[];
    detailTruncated?: { shown: number; total: number };
  };
  expect(body.detail).toHaveLength(50);
  expect(body.detailTruncated).toEqual({ shown: 50, total: 150 });
  /* Обсяг — не лише зміст: тепер поріг справді МІЖ обрізаним і неурізаним. */
  expect(result.content[0]!.text.length).toBeLessThan(20_000);
});

/*
 * M3 (рецензія кола 3): стеля мусить триматись РОЗТАШУВАННЯМ коду
 * (`.slice()` один раз, після `switch`), а не тим, що кожна гілка сама
 * про неї подбала. Попередній набір тестів будив стелю лише для `scale` —
 * мутант, що переносить `.slice()` в один конкретний `case`, лишався
 * непоміченим для решти родин. Тут — та сама перевірка для `character`.
 */
it("detail обрізається до стелі й для НЕ-scale родини (character) — стеля не прив'язана до однієї гілки", async () => {
  runJsxMock.mockReset();
  const paragraphs: StylesMeasure["paragraphs"] = [];
  const ranges: RangeMeasure[] = [];
  for (let i = 0; i < 80; i++) {
    paragraphs.push({
      containerId: "story:1", paragraphIndex: i, page: String(i), styleName: "A", styleId: "A",
      isMaster: false,
      declared: { ...EMPTY_VALUES, pointSize: 11 },
      actual: { ...EMPTY_VALUES, pointSize: 11 },
      hasCharacterStyleRuns: false, preview: "",
    });
    ranges.push({
      containerId: "story:1", paragraphIndex: i, rangeIndex: 0, characterStyle: "[None]",
      pointSize: 17, appliedFont: null, fontStyle: null, tracking: null, horizontalScale: null,
    });
  }
  const m = measure({ styles: [style("A")], paragraphs, ranges });
  runJsxMock.mockResolvedValue(m);
  const result = await stylesAuditHandler()({
    families: ALL_FAMILIES,
    detail: { family: "character", styleId: "A" },
  });
  const body = JSON.parse(result.content[0]!.text) as {
    detail: unknown[];
    detailTruncated?: { shown: number; total: number };
  };
  expect(body.detail).toHaveLength(50);
  expect(body.detailTruncated).toEqual({ shown: 50, total: 80 });
});

/*
 * Important 2 (рецензія кола 3): одиниця `detail` тепер названа В
 * ВІДПОВІДІ (`detailUnit`), не лише в описі. Для `character` вона мусить
 * прямо пояснювати, чому `detailTruncated.total` (пари діапазон+властивість)
 * не збігається з `characterRangesDeviating` (різні діапазони) у зведенні.
 */
it("detailUnit називає одиницю в самій відповіді; для character вона відрізняється від зведення", async () => {
  runJsxMock.mockReset();
  const m = measure({
    styles: [style("A")],
    paragraphs: [
      {
        containerId: "story:1", paragraphIndex: 0, page: "1", styleName: "A", styleId: "A",
        isMaster: false,
        declared: { ...EMPTY_VALUES, pointSize: 11, appliedFont: "Proba Pro" },
        actual: { ...EMPTY_VALUES, pointSize: 11, appliedFont: "Proba Pro" },
        hasCharacterStyleRuns: false, preview: "",
      },
    ],
    ranges: [
      {
        /* ОДИН діапазон, ДВІ властивості — 1 запис у characterRangesDeviating,
         * 2 записи в detail (пари діапазон+властивість). */
        containerId: "story:1", paragraphIndex: 0, rangeIndex: 0, characterStyle: "[None]",
        pointSize: 17, appliedFont: "Apple Symbols", fontStyle: null, tracking: null, horizontalScale: null,
      } satisfies RangeMeasure,
    ],
  });
  runJsxMock.mockResolvedValue(m);
  const result = await stylesAuditHandler()({
    families: ALL_FAMILIES,
    detail: { family: "character", styleId: "A" },
  });
  const body = JSON.parse(result.content[0]!.text) as {
    detail: unknown[];
    detailUnit?: string;
    character: { rangesDeviating: number } | null;
  };
  expect(body.detailUnit).toContain("property");
  expect(body.detail).toHaveLength(2);
  expect(body.character?.rangesDeviating).toBe(1);
  /* Одиниці розходяться — detail.length (пари) БІЛЬШИЙ за rangesDeviating (місця). */
  expect(body.detail.length).toBeGreaterThan(body.character?.rangesDeviating ?? 0);
});

it("detailUnit присутнє й для родин, де detail і зведення в тій самій одиниці (scale — абзац)", async () => {
  runJsxMock.mockReset();
  const m = measure({
    scales: [
      { containerId: "story:1", paragraphIndex: 0, page: "1", styleName: "A", styleId: "A", horizontalScale: 96, verticalScale: 100 } satisfies ScaleMeasure,
    ],
  });
  runJsxMock.mockResolvedValue(m);
  const result = await stylesAuditHandler()({
    families: ALL_FAMILIES,
    detail: { family: "scale", styleId: "A" },
  });
  const body = JSON.parse(result.content[0]!.text) as { detailUnit?: string };
  expect(body.detailUnit).toBe("paragraph");
});

it("detail БЕЗ обрізання — detailTruncated відсутнє взагалі, а не {shown: N, total: N}", async () => {
  runJsxMock.mockReset();
  const m = measure({
    scales: [
      { containerId: "story:1", paragraphIndex: 0, page: "1", styleName: "A", styleId: "A", horizontalScale: 96, verticalScale: 100 } satisfies ScaleMeasure,
    ],
  });
  runJsxMock.mockResolvedValue(m);
  const result = await stylesAuditHandler()({
    families: ALL_FAMILIES,
    detail: { family: "scale", styleId: "A" },
  });
  const body = JSON.parse(result.content[0]!.text) as { detailTruncated?: unknown };
  expect(body.detailTruncated).toBeUndefined();
});

/*
 * Дрібне п.4 (рецензія кола 2): раніше `detail.family`, не запитаний у
 * `families`, тихо давав `[]` — невідрізнюване від «місць немає». Тепер це
 * явна відмова з поясненням.
 */
it("detail.family, не запитаний у families, — явна відмова, а не тихий порожній перелік", async () => {
  runJsxMock.mockReset();
  const result = await stylesAuditHandler()({
    families: ["usage"],
    detail: { family: "scale", styleId: "A" },
  });
  expect(result.isError).toBe(true);
  expect(result.content[0]!.text).toContain("scale");
  expect(result.content[0]!.text).toContain("families");
  /* Місток НЕ мав викликатись — суперечність ловиться до runJsx. */
  expect(runJsxMock).not.toHaveBeenCalled();
});

/*
 * Дрібне п.2 (рецензія кола 2): жоден попередній тест не торкався
 * ratioMatches/ratioUnavailable/scale.paragraphs — мутант «повернути 0»
 * виживав би. Фікстура дає РЕАЛЬНИЙ збіг підтверджувального детектора
 * (sizeRatio === leadRatio ≠ 1) і РЕАЛЬНИЙ noRatio (leading відсутній).
 */
it("scale.paragraphs/ratioMatches/ratioUnavailable рахуються з реальних даних, не заглушка 0", async () => {
  runJsxMock.mockReset();
  const m = measure({
    scales: [
      { containerId: "story:1", paragraphIndex: 0, page: "1", styleName: "A", styleId: "A", horizontalScale: 96, verticalScale: 100 } satisfies ScaleMeasure,
    ],
    paragraphs: [
      /* sizeRatio = 11/10 = 1.1, leadRatio = 15.4/14 = 1.1 — збіг, отже matches. */
      {
        containerId: "story:1", paragraphIndex: 0, page: "1", styleName: "B", styleId: "B",
        isMaster: false,
        declared: { ...EMPTY_VALUES, pointSize: 10, leading: 14 },
        actual: { ...EMPTY_VALUES, pointSize: 11, leading: 15.4 },
        hasCharacterStyleRuns: false, preview: "",
      },
      /* leading відсутнє (null) з обох боків — noRatio. */
      deviant("C", 1),
    ],
  });
  runJsxMock.mockResolvedValue(m);
  const result = await stylesAuditHandler()({ families: ALL_FAMILIES });
  const body = JSON.parse(result.content[0]!.text) as {
    scale: { paragraphs: number; ratioMatches: number; ratioUnavailable: number } | null;
  };
  expect(body.scale?.paragraphs).toBe(1);
  expect(body.scale?.ratioMatches).toBe(1);
  expect(body.scale?.ratioUnavailable).toBeGreaterThan(0);
});

/*
 * Important 3 (рецензія кола 2): `.refine()`, що вимагає `group` для
 * `family: "overrides"`, не мав жодного тесту — зняти його дає ТИХО
 * порожній `detail`, не помилку. Підроблений `registerTool` схему не
 * прогонює, тож перевіряємо саму схему напряму (`safeParse`), той самий
 * доступ до конфігурації, що вже вжитий для замовчування `families`.
 */
it("схема detail: family «overrides» без group не проходить валідацію", () => {
  const schema = stylesAuditDetailSchema();
  expect(schema.safeParse({ family: "overrides", styleId: "id1" }).success).toBe(false);
  expect(schema.safeParse({ family: "overrides", styleId: "id1", group: "indents" }).success).toBe(true);
});

it("схема detail: family «scale»/«character»/«usage» без group проходить (group для них не обов'язковий)", () => {
  const schema = stylesAuditDetailSchema();
  expect(schema.safeParse({ family: "scale", styleId: "id1" }).success).toBe(true);
  expect(schema.safeParse({ family: "character", styleId: "id1" }).success).toBe(true);
  expect(schema.safeParse({ family: "usage", styleId: "id1" }).success).toBe(true);
});

/*
 * Дрібне п.3 (рецензія кола 3): перевірка `families.includes(detail.family)`
 * стояла ПОЗА `try` — будь-який неочікуваний виняток при її обчисленні
 * (наприклад, `families` виявиться не масивом — підроблений `registerTool`
 * не прогонює zod, тож таке в принципі можливе) пішов би як REJECT
 * проміса, тобто виняток протоколу, а не текстова `fail()`-відповідь.
 * `families: null` — той самий клас несправності: `.includes` на `null`
 * кидає TypeError синхронно, ще до `runJsx`.
 */
/*
 * ФІНАЛЬНА РЕЦЕНЗІЯ, I-3. `rangesTotal` рахував ВСІ діапазони виміру
 * (батьківські включно), а `rangesDeviating` батьківських виключав — блок
 * сам запрошував поділити одне на друге й дістати ЗАНИЖЕНУ частку. Жоден
 * тест `rangesTotal` не перевіряв узагалі.
 *
 * Фікстура: два абзаци з діапазоном, що відхиляється, один з них
 * батьківський. Стара форма показала б 2 і 1 (частка 50 % замість 100 %);
 * нова додає `rangesAudited: 1` — знаменник, на який частку рахувати можна.
 */
it("блок character дає rangesAudited — знаменник, а не лише rangesTotal з іншої популяції", async () => {
  runJsxMock.mockReset();
  const basePara = {
    containerId: "story:1", page: "1", styleName: "A", styleId: "A",
    declared: { ...EMPTY_VALUES, pointSize: 11 },
    actual: { ...EMPTY_VALUES, pointSize: 11 },
    hasCharacterStyleRuns: false, preview: "",
  };
  const m = measure({
    styles: [style("A")],
    paragraphs: [
      { ...basePara, paragraphIndex: 0, isMaster: false },
      { ...basePara, paragraphIndex: 1, isMaster: true },
    ],
    ranges: [
      { containerId: "story:1", paragraphIndex: 0, rangeIndex: 0, characterStyle: "[None]", pointSize: 17, appliedFont: null, fontStyle: null, tracking: null, horizontalScale: null },
      { containerId: "story:1", paragraphIndex: 1, rangeIndex: 0, characterStyle: "[None]", pointSize: 17, appliedFont: null, fontStyle: null, tracking: null, horizontalScale: null },
    ],
  });
  runJsxMock.mockResolvedValue(m);
  const result = await stylesAuditHandler()({ families: ALL_FAMILIES });
  const body = JSON.parse(result.content[0]!.text) as {
    character: { rangesTotal: number; rangesAudited: number; rangesDeviating: number } | null;
  };
  expect(body.character?.rangesTotal).toBe(2);
  expect(body.character?.rangesAudited).toBe(1);
  expect(body.character?.rangesDeviating).toBe(1);
  /* Частка, порахована ЧЕСНО, дає 1, а не 0,5 — саме те число, заради
   * якого поле й додане. */
  expect(body.character!.rangesDeviating / body.character!.rangesAudited).toBe(1);
});

/*
 * Дрібне п.3: `maxChainDepth` мовчки впирався в стелю 50. Тепер, коли
 * стеля спрацювала, відповідь це КАЖЕ; коли ні — поля немає взагалі (той
 * самий умовний патерн, що `detailTruncated`).
 */
it("maxChainDepth, що вперся в стелю, супроводжується chainDepthTruncated", async () => {
  runJsxMock.mockReset();
  const styles: DeclaredStyle[] = [{ ...style("Корінь", "0") }];
  for (let i = 1; i < 100; i += 1) {
    styles.push({ ...style(`Рівень ${i}`, String(i)), basedOn: String(i - 1), basedOnId: String(i - 1) });
  }
  runJsxMock.mockResolvedValue(measure({ styles }));
  const result = await stylesAuditHandler()({ families: ALL_FAMILIES });
  const body = JSON.parse(result.content[0]!.text) as {
    hierarchy: { maxChainDepth: number; chainDepthTruncated?: { limit: number; stylesAffected: number } } | null;
  };
  expect(body.hierarchy?.maxChainDepth).toBe(50);
  expect(body.hierarchy?.chainDepthTruncated).toEqual({ limit: 50, stylesAffected: 49 });
});

it("короткі ланцюжки — chainDepthTruncated відсутнє взагалі", async () => {
  runJsxMock.mockReset();
  runJsxMock.mockResolvedValue(measure({
    styles: [style("Корінь", "0"), { ...style("Дитя", "1"), basedOn: "Корінь", basedOnId: "0" }],
  }));
  const result = await stylesAuditHandler()({ families: ALL_FAMILIES });
  const body = JSON.parse(result.content[0]!.text) as {
    hierarchy: { chainDepthTruncated?: unknown } | null;
  };
  expect(body.hierarchy?.chainDepthTruncated).toBeUndefined();
});

/*
 * I-6: обидві структури дефолтної відповіді, що не мали стелі за
 * побудовою, тепер обрізаються, і обрізання видно В САМІЙ відповіді.
 * Тест іде через обробник навмисно: стеля в модулі нічого не варта, якщо
 * інструмент її не пропускає нагору.
 */
it("дефолтна відповідь: scale.groups і styles[].groups[].values обрізаються, обрізання назване", async () => {
  runJsxMock.mockReset();
  const scales: ScaleMeasure[] = [];
  for (let i = 0; i < 60; i += 1) {
    scales.push({
      containerId: `story:${i}`, paragraphIndex: 0, page: "1", styleName: "A", styleId: "A",
      horizontalScale: 90 + i * 0.0001, verticalScale: 100,
    });
  }
  const paragraphs: StylesMeasure["paragraphs"] = [];
  for (let i = 0; i < 60; i += 1) {
    paragraphs.push({
      containerId: "story:1", paragraphIndex: i, page: "1", styleName: "A", styleId: "A",
      isMaster: false,
      declared: { ...EMPTY_VALUES, firstLineIndent: 0 },
      actual: { ...EMPTY_VALUES, firstLineIndent: i + 1 },
      hasCharacterStyleRuns: false, preview: "",
    });
  }
  runJsxMock.mockResolvedValue(measure({ styles: [style("A")], paragraphs, scales }));
  const result = await stylesAuditHandler()({ families: ALL_FAMILIES });
  const body = JSON.parse(result.content[0]!.text) as {
    scale: { groups: unknown[]; groupsTruncated?: { shown: number; total: number } } | null;
    styles: { styleId: string; groups: { values: unknown[]; valuesTruncated?: { shown: number; total: number } }[] }[];
  };
  expect(body.scale?.groups).toHaveLength(50);
  expect(body.scale?.groupsTruncated).toEqual({ shown: 50, total: 60 });
  const indents = body.styles.find((r) => r.styleId === "A")!.groups.find((g) => g.values.length > 0)!;
  expect(indents.values).toHaveLength(20);
  expect(indents.valuesTruncated).toEqual({ shown: 20, total: 60 });
});

/* Дрібне п.4: перелік стилів групи масштабу — за id, з назвою поруч. */
it("scale.groups[].styles адресує стилі за id, а не за назвою", async () => {
  runJsxMock.mockReset();
  const m = measure({
    scales: [
      { containerId: "story:1", paragraphIndex: 0, page: "1", styleName: "Однакова", styleId: "id1", horizontalScale: 96, verticalScale: 100 },
      { containerId: "story:1", paragraphIndex: 1, page: "1", styleName: "Однакова", styleId: "id2", horizontalScale: 96, verticalScale: 100 },
    ],
  });
  runJsxMock.mockResolvedValue(m);
  const result = await stylesAuditHandler()({ families: ALL_FAMILIES });
  const body = JSON.parse(result.content[0]!.text) as {
    scale: { groups: { styles: { styleId: string; styleName: string }[] }[] } | null;
  };
  expect(body.scale?.groups[0]!.styles).toEqual([
    { styleId: "id1", styleName: "Однакова" },
    { styleId: "id2", styleName: "Однакова" },
  ]);
});

/*
 * I-2: `detailTotalNote` каже про ОБЛАСТЬ ВИЗНАЧЕННЯ там, де оператор
 * читає числа. Опис раніше стверджував, що `total` для `character` буде
 * БІЛЬШИМ за зведення — неправда при будь-якому styleId, крім виродженого
 * «весь документ на одному стилі».
 */
it("detailTotalNote називає область визначення total — один стиль, не документ", async () => {
  runJsxMock.mockReset();
  runJsxMock.mockResolvedValue(measure({
    scales: [{ containerId: "story:1", paragraphIndex: 0, page: "1", styleName: "A", styleId: "A", horizontalScale: 96, verticalScale: 100 }],
  }));
  const result = await stylesAuditHandler()({
    families: ALL_FAMILIES,
    detail: { family: "scale", styleId: "A" },
  });
  const body = JSON.parse(result.content[0]!.text) as { detailTotalNote?: string };
  expect(body.detailTotalNote).toContain("THE REQUESTED STYLE");
  expect(body.detailTotalNote).toContain("the whole document");
});

/*
 * РЕЦЕНЗІЯ ФІНАЛЬНОЇ ХВИЛІ, п.2. Повне застереження про таблиці й виноски
 * мусить з'явитись у відповіді РІВНО ОДИН раз, скільки б невживаних
 * стилів документ не мав. Перша редакція фіксу I-4 вписувала його в текст
 * КОЖНОЇ знахідки: виміряно 389 Б на знахідку, 1 785 Б з 2 103 Б усього
 * приросту на фікстурі з п'ятьма такими знахідками.
 *
 * 40 невживаних стилів — свідомо більше, ніж 14 на робочій книжці: стара
 * форма дала б тут ≈15,6 КБ самих лише повторень і пробила б поріг
 * обсягу нижче; нова коштує 389 Б один раз.
 */
it("повне застереження про таблиці й виноски — РІВНО один раз на відповідь, не в кожній знахідці", async () => {
  runJsxMock.mockReset();
  const styles: DeclaredStyle[] = [];
  for (let i = 0; i < 40; i += 1) {
    /* firstLineIndent різний навмисно: інакше 40 однакових наборів
     * `declared` дали б ще й одну знахідку `styles-indistinguishable`, і
     * тест міряв би не те, що збирався. */
    styles.push({ ...style(`Невживаний ${i}`, `id${i}`), declared: { ...EMPTY_VALUES, firstLineIndent: i } });
  }
  runJsxMock.mockResolvedValue(measure({
    styles,
    characterStyles: [{ id: "cs1", name: "Симв", appliedRuns: 0 } satisfies CharacterStyleUsage],
  }));
  const result = await stylesAuditHandler()({ families: ALL_FAMILIES });
  const text = result.content[0]!.text;
  const body = JSON.parse(text) as {
    findings: { detail: string }[];
    caveats?: { tablesAndFootnotes: string };
  };

  /* 40 абзацних + 1 символьний — усі несуть КОРОТКУ заборону з ключем. */
  expect(body.findings).toHaveLength(41);
  for (const f of body.findings) {
    expect(f.detail).toContain("Don't delete");
    expect(f.detail).toContain("caveats.tablesAndFootnotes");
  }

  /* А повне пояснення механізму — рівно одне входження в усій відповіді. */
  const caveat = body.caveats!.tablesAndFootnotes;
  expect(caveat).toContain("story.paragraphs");
  expect(text.split("story.paragraphs").length - 1).toBe(1);

  /*
   * ОБСЯГ — САМОРАХОВАНИЙ, не абсолютний поріг. Абсолютне число тут було б
   * оманливе: 40 оголошених стилів дають ще й 40 рядків `styles`, і саме
   * вони, а не застереження, роблять цю відповідь великою. Тому тест
   * будує ту саму відповідь у СТАРІЙ формі (повне застереження в кожній
   * знахідці) і міряє різницю — так поріг не треба вгадувати, а мутант,
   * що повертає повторення, падає на власному вимірі.
   */
  const inlined = JSON.parse(text) as typeof body;
  for (const f of inlined.findings) f.detail = `${f.detail} ${caveat}`;
  /* ТИМ САМИМ серіалізатором, що й `ok()` (`serialise`, не власний
   * `JSON.stringify(..., null, 2)`): інакше «стара форма» важиться в
   * форматі, якого інструмент не віддає, і різниця вимірює відступи
   * замість повторень застереження. */
  const inlinedBytes = Buffer.byteLength(serialise(inlined), "utf8");
  const actualBytes = Buffer.byteLength(text, "utf8");
  /* 41 знахідка × ≈389 Б ≈ 16 КБ економії; 14 КБ — з запасом на дрейф
   * формулювання, але далеко вище будь-якого шуму серіалізації. */
  expect(inlinedBytes - actualBytes).toBeGreaterThan(14_000);
});

it("невживаних стилів немає — поля caveats немає взагалі, воно не коштує нічого", async () => {
  runJsxMock.mockReset();
  runJsxMock.mockResolvedValue(measure({
    styles: [style("A")],
    paragraphs: [deviant("A", 0)],
  }));
  const result = await stylesAuditHandler()({ families: ALL_FAMILIES });
  const body = JSON.parse(result.content[0]!.text) as { caveats?: unknown };
  expect(body.caveats).toBeUndefined();
});

/*
 * ПРОГАЛИНА, ЗНАЙДЕНА РЕЦЕНЗІЄЮ ХВИЛІ. Застереження I-4 стоїть у ЧОТИРЬОХ
 * місцях (текст знахідки абзацного стилю, текст знахідки символьного,
 * опис інструмента, README), але тестами трималися лише два перші —
 * мутант, що вихолощує абзац з ОПИСУ, виживав. Для єдиної знахідки фази,
 * яка веде до руйнівної дії, така асиметрія неприпустима: опис — це те,
 * що модель читає ПЕРЕД тим, як порадити оператору видалити стиль.
 *
 * Перевіряються саме змістовні складники, а не одне гасло: заборона,
 * ОБИДВА місця (таблиці й виноски) і ключ на повне пояснення.
 */
it("опис інструмента несе застереження I-4: заборона, таблиці, виноски, ключ на повний текст", () => {
  const d = stylesAuditDescription();
  expect(d).toContain("IS NOT PERMISSION TO DELETE THE STYLE");
  expect(d).toContain("TABLE");
  expect(d).toContain("FOOTNOTE");
  expect(d).toContain("caveats.tablesAndFootnotes");
  /* Межа названа не лише для абзацних стилів: та сама сліпа зона занижує
   * числа родини character, і опис мусить це казати. */
  expect(d).toContain("characterRangesDeviating");
});

/* Опис мусить називати й другу відому межу — локалізовану збірку. */
it("опис інструмента несе межу локалізованого InDesign", () => {
  const d = stylesAuditDescription();
  expect(d).toContain("ENGLISH");
  expect(d).toContain("[No Paragraph Style]");
});

it("families не масив (несправний вхід) — виняток на самій перевірці все одно йде як fail(), не reject", async () => {
  runJsxMock.mockReset();
  const handler = stylesAuditHandler();
  await expect(
    handler({ families: null, detail: { family: "scale", styleId: "x" } }),
  ).resolves.toMatchObject({ isError: true });
});

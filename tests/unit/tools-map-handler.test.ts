import { describe, expect, it, vi } from "vitest";
import type { StyleUsage } from "../../src/layout/summarise.js";
import type { LayoutMeasure } from "../../src/layout/types.js";
import type { Tools } from "../../src/tools/shared.js";

/*
 * Раунд виправлень 1 (Задача 8, Critical): жоден тест — ні юніт, ні
 * інтеграційний — не викликав обробник `document_map` напряму; усі
 * перехресні перевірки зверталися до `runJsx("layout_measure", ...)` в обхід
 * нього. Більшість мутантів обробника (`src/tools/map.ts`) ловляться живим
 * `document_map` через `toolHandler` у `tests/integration/map.test.ts` —
 * саме туди й перенесено перевірки, чиї назви обіцяють цю живу звірку.
 *
 * Одна гілка обробника лишається структурно недоступною для живого виклику:
 * `catch (e) { return fail(e) }`. Щоб її спричинити насправді, `runJsx`
 * мусив би кинути виняток — а єдиний безпечний спосіб змусити ЖИВИЙ виклик
 * InDesign кинути виняток тут (без відкриття невідомого стану чи ризику для
 * робочого документа користувача) не існує: `pages`/`headingStyles` не
 * впливають на жоден шлях, що падає в живому `layout_measure`, а закриття
 * документів чи зупинка InDesign — поза межами того, що дозволено робити в
 * цій сесії. Тому катч-гілка — єдина частина обробника, перевірена тут, а не
 * в інтеграційному наборі, тим самим підміненим мостом (`runJsx`), що й у
 * tests/unit/tools-composition-handler.test.ts і tests/unit/tools-corrections.test.ts
 * (той самий, уже усталений у проєкті патерн, а не новий винахід).
 */
const { runJsxMock } = vi.hoisted(() => ({ runJsxMock: vi.fn() }));
vi.mock("../../src/bridge/runner.js", () => ({ runJsx: runJsxMock }));

/*
 * Раунд виправлень 1 (Задача 9, Important): рецензент довів мутанта, що
 * підмішує `masters.findings` у виклик `summariseByStyle` поруч із
 * `overrides.findings` — весь набір (863 юніт, 7 інтеграційних) пройшов, бо
 * `summariseByStyle` (`src/layout/summarise.ts:64`) сама мовчки відкидає
 * знахідки з `styleName === null || group === null`, а в `masters`-знахідок
 * обидва поля завжди `null`. Тобто правильність цього стику трималась на
 * внутрішній деталі СУСІДНЬОГО модуля, а не на самому обробнику. Тут
 * `summariseByStyle` підмінено (`vi.mock`, той самий патерн, що для
 * `runJsx` вище), а `detectOverrides`/`detectMasters` лишаються справжніми —
 * щоб перевірити РІВНО те, що першим аргументом у `summariseByStyle` іде
 * `overrides.findings`, і нічого понад це, незалежно від того, чи
 * `summariseByStyle` сама щось фільтрує.
 */
const { summariseByStyleMock } = vi.hoisted(() => ({ summariseByStyleMock: vi.fn(() => []) }));
vi.mock("../../src/layout/summarise.js", () => ({ summariseByStyle: summariseByStyleMock }));

const { IndesignError } = await import("../../src/bridge/errors.js");
const { registerMapTools, LAYOUT_MEASURE_TIMEOUT_MS } = await import("../../src/tools/map.js");

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
type AnyHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

function documentMapHandler(): AnyHandler {
  let captured: AnyHandler | null = null;
  const fakeServer = {
    registerTool: (name: string, _config: unknown, handler: AnyHandler) => {
      if (name === "document_map") captured = handler;
    },
  } as unknown as Tools;
  registerMapTools(fakeServer);
  if (captured === null) throw new Error("document_map не зареєстровано");
  return captured;
}

function layoutAuditHandler(): AnyHandler {
  let captured: AnyHandler | null = null;
  const fakeServer = {
    registerTool: (name: string, _config: unknown, handler: AnyHandler) => {
      if (name === "layout_audit") captured = handler;
    },
  } as unknown as Tools;
  registerMapTools(fakeServer);
  if (captured === null) throw new Error("layout_audit не зареєстровано");
  return captured;
}

describe("document_map — гілка помилки (мутант catch → return ok({}))", () => {
  it("помилку runJsx повертає як fail(e), а не як мовчазний ok({})", async () => {
    runJsxMock.mockImplementation(async () => {
      throw new IndesignError("busy", "InDesign не відповідає", "Перевірте, чи не показує InDesign модальне вікно.");
    });
    const handler = documentMapHandler();

    const result = await handler({});

    /* `ok({})` дав би isError === undefined і текст "{}" — жодної ознаки
     * помилки. `fail(e)` для IndesignError додає підказку "Що зробити:". */
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/InDesign не відповідає/);
    expect(result.content[0]!.text).toMatch(/What to do:/);
    expect(result.content[0]!.text).not.toBe("{}");
  });

  it("звичайну (не IndesignError) помилку теж повертає як isError, а не ковтає", async () => {
    runJsxMock.mockImplementation(async () => {
      throw new Error("щось пішло не так у мосту");
    });
    const handler = documentMapHandler();

    const result = await handler({});

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("щось пішло не так у мосту");
  });
});

/*
 * Ті самі два мутанти (catch → мовчазний ok({}) / поглинання помилки), той
 * самий підмінений `runJsx` (Пастка 1 з брифінгу задачі 9) — тепер для
 * `layout_audit`. Замовчування zod (`families`, `includeMasters`) підробленим
 * `registerTool` НЕ застосовуються (Пастка 2) — тому в аргументах усе задано
 * явно, хоча для самого катч-шляху це й не критично: виняток кидається на
 * `await runJsx(...)`, ще до першого звернення до `families`.
 */
describe("layout_audit — гілка помилки (мутант catch → return ok({}))", () => {
  it("помилку runJsx повертає як fail(e), а не як мовчазний ok({})", async () => {
    runJsxMock.mockImplementation(async () => {
      throw new IndesignError("busy", "InDesign не відповідає", "Перевірте, чи не показує InDesign модальне вікно.");
    });
    const handler = layoutAuditHandler();

    const result = await handler({
      pages: undefined,
      families: ["overrides", "masters"],
      includeMasters: false,
      detail: undefined,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/InDesign не відповідає/);
    expect(result.content[0]!.text).toMatch(/What to do:/);
    expect(result.content[0]!.text).not.toBe("{}");
  });

  it("звичайну (не IndesignError) помилку теж повертає як isError, а не ковтає", async () => {
    runJsxMock.mockImplementation(async () => {
      throw new Error("щось пішло не так у мосту");
    });
    const handler = layoutAuditHandler();

    const result = await handler({
      pages: undefined,
      families: ["overrides", "masters"],
      includeMasters: false,
      detail: undefined,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("щось пішло не так у мосту");
  });
});

describe("layout_audit — у зведення йдуть РІВНО overrides.findings, без masters.findings", () => {
  it("summariseByStyle отримує лише знахідки родини overrides", async () => {
    summariseByStyleMock.mockClear();

    /*
     * Мінімальний, але СПРАВЖНІЙ `LayoutMeasure`: один абзац, чий
     * `firstLineIndent` розходиться зі стилем (справжня знахідка
     * `detectOverrides`, group "indents"), і одна сторінка без
     * батьківської (справжня знахідка `detectMasters`, `master-none`,
     * group null). `detectOverrides`/`detectMasters` тут НЕ підмінені —
     * лише `summariseByStyle`, тож обидві знахідки — продукт реальної
     * логіки детекторів, не вигадані дані.
     */
    const declared = {
      firstLineIndent: 12,
      leftIndent: 0,
      rightIndent: 0,
      spaceBefore: 0,
      spaceAfter: 0,
      pointSize: 11,
      leading: 14,
      justification: "LEFT_JUSTIFIED",
      appliedFont: "Test Font",
      fontStyle: "Regular",
      tracking: 0,
      listType: "NO_LIST",
    };
    /*
     * Анотовано типом (рецензія кола 1, C-2): БЕЗ цього літерал не змушує
     * компілятор помітити відсутнє поле, і саме тому цей тест раніше
     * проходив на зламаній гілці — `styleId` бракувало, `p.styleId` ішов
     * у `detectOverrides` як `undefined`, і жоден тип цього не бачив, бо
     * `runJsxMock` — нетипізований `vi.fn()`, а сам літерал без анотації.
     */
    const measure: LayoutMeasure = {
      docName: "mock-doc",
      measurementUnit: "POINTS",
      spreads: [],
      stories: [],
      frames: [],
      pages: [
        { name: "1", side: null, master: null, frameCount: 0, masterItems: [], guideCount: 0, pageItems: [], expectedMasterItems: [] },
      ],
      paragraphs: [
        {
          containerId: "story:0",
          paragraphIndex: 0,
          page: "1",
          styleName: "Test",
          styleId: "test-style-id",
          isMaster: false,
          declared,
          actual: { ...declared, firstLineIndent: 24 },
          hasCharacterStyleRuns: false,
          preview: "abc",
        },
      ],
    };
    runJsxMock.mockImplementation(async () => measure);
    const handler = layoutAuditHandler();

    await handler({
      pages: undefined,
      families: ["overrides", "masters"],
      includeMasters: false,
      detail: undefined,
    });

    expect(summariseByStyleMock).toHaveBeenCalledTimes(1);
    /*
     * `!` і `as unknown as`: мок оголошено без сигнатури, тож TS виводить
     * `mock.calls[0]` як ПОРОЖНІЙ кортеж `[]` — пряме приведення до трьох
     * елементів він відхиляє (TS2352, «типи недостатньо перетинаються»), і
     * радить саме подвійне приведення. `!` окремо: під
     * `noUncheckedIndexedAccess` індекс дає `| undefined`, а тут він
     * безпечний — рядком вище перевірено, що виклик рівно один.
     */
    const [findingsArg] = summariseByStyleMock.mock.calls[0]! as unknown as [
      { family: string; group: string | null; styleName: string | null }[],
      Map<string, StyleUsage>,
      unknown[],
    ];

    /* Знахідка masters (master-none) МУСИТЬ існувати в реальних детекторах —
     * інакше тест довів би лише те, що масив порожній, а не те, що обробник
     * її відфільтрував. */
    expect(findingsArg).toHaveLength(1);
    expect(findingsArg[0]!.family).toBe("overrides");
    expect(findingsArg.some((f) => f.family === "masters")).toBe(false);
  });
});

/*
 * Таймаут виміру (борг закрито 2026-08-05).
 *
 * Замовчування `runJsx` — 30 с, і саме воно робило `layout_measure` без
 * `pages` непрацездатним: документоване «весь документ» гарантовано падало з
 * −1712. Виміряно на живій книжці: повний вимір 198 сторінок — 340 с.
 *
 * Тут перевіряється РІВНО те, що можна перевірити без InDesign: що обробник
 * передає власний таймаут, а не покладається на замовчування, і що виклик
 * ОДИН. Друге не формальність — попередня редакція цього коду різала документ
 * на вікна по 25 сторінок, і вимір показав, що вісім таких порцій коштують
 * ~648 с проти 340 с одним викликом: базова вартість виклику (~36 с) майже не
 * залежить від розміру діапазону, тож порційність подвоювала ціну.
 */
describe("layout_measure: власний таймаут, один виклик", () => {
  function captureCalls(): { calls: { params: any; opts: any }[] } {
    const calls: { params: any; opts: any }[] = [];
    runJsxMock.mockImplementation(async (handler: string, params: any, opts: any) => {
      calls.push({ params, opts });
      if (handler !== "layout_measure") throw new Error(`несподіваний обробник ${handler}`);
      return {
        docName: "книжка.indd",
        measurementUnit: "points",
        pages: [],
        spreads: [],
        stories: [],
        frames: [],
        paragraphs: [],
      };
    });
    return { calls };
  }

  it("без pages: рівно один виклик, із таймаутом більшим за 30-секундне замовчування", async () => {
    const { calls } = captureCalls();
    await documentMapHandler()({});

    expect(calls).toHaveLength(1);
    expect(calls[0]!.params).toEqual({});
    expect(calls[0]!.opts?.timeoutMs).toBe(LAYOUT_MEASURE_TIMEOUT_MS);
    expect(LAYOUT_MEASURE_TIMEOUT_MS).toBeGreaterThan(30_000);
  });

  it("із pages таймаут той самий — довгим може бути й діапазон", async () => {
    const { calls } = captureCalls();
    await documentMapHandler()({ pages: ["12", "13"] });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.params).toEqual({ pages: ["12", "13"] });
    expect(calls[0]!.opts?.timeoutMs).toBe(LAYOUT_MEASURE_TIMEOUT_MS);
  });

  it("layout_audit іде тим самим шляхом — таймаут не лише в document_map", async () => {
    const { calls } = captureCalls();
    await layoutAuditHandler()({
      pages: undefined,
      families: ["overrides", "masters"],
      includeMasters: false,
      detail: undefined,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.opts?.timeoutMs).toBe(LAYOUT_MEASURE_TIMEOUT_MS);
  });
});

import { expect, it, describe, vi } from "vitest";
import type { GeometryMeasure, ItemMeasure, PageMeasure } from "../../src/geometry/types.js";
import type { Tools } from "../../src/tools/shared.js";

/*
 * ШОВ МІЖ ВИМІРОМ І ЗВІТОМ — ТРИ МУТАЦІЇ, ЩО ПЕРЕЖИЛИ ВЕСЬ НАБІР.
 *
 * `src/tools/geometry.ts` не мав тестового файла зовсім, і мутаційна проба
 * 2026-08-26 показала, що це не дрібниця: три семантичні зміни в ньому
 * лишили всі 2750 тестів зеленими.
 *
 *   1. `!hasWrapMaterial(measure.items)` → `wrapInventory.length === 0`.
 *      Це ДОСЛІВНО та вада, яку колись уже знайшли й виправили (коментар над
 *      рядком: «Round 2 of fixes, review»): `NONE` — теж запис інвентарю, тож
 *      інвентар буває повним, не маючи матеріалу для вироку. Саме такий стан
 *      і має робоча книжка: `NONE` × 965. Виправлення не мало регресійного
 *      тесту, тож поверталося б мовчки.
 *   2. `i.rotation !== 0` → `=== 0`: лічильник повернутих рамок,
 *      виключених з вироку, ставав своєю протилежністю.
 *   3. `kind === "vector"` → `"raster"`: вектори й растри мінялися місцями.
 *
 * Родинна риса всіх трьох: вони не в детекторі й не у звіті (там тести є, і
 * там мутації ловилися по 5–6 тестами), а в ПРОВОДЦІ між ними. Тому цей файл
 * ганяє справжній обробник на підробленому містку, а не окрему функцію.
 */

const { runJsxMock } = vi.hoisted(() => ({ runJsxMock: vi.fn() }));
vi.mock("../../src/bridge/runner.js", () => ({ runJsx: runJsxMock }));

const { registerGeometryTools } = await import("../../src/tools/geometry.js");

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
type AnyHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

function handler(): AnyHandler {
  let captured: AnyHandler | null = null;
  const fake = {
    registerTool(name: string, _cfg: unknown, h: AnyHandler) {
      if (name === "geometry_audit") captured = h;
    },
  } as unknown as Tools;
  registerGeometryTools(fake);
  if (!captured) throw new Error("geometry_audit не зареєстровано");
  return captured;
}

function page(over: Partial<PageMeasure> = {}): PageMeasure {
  return {
    name: "1",
    side: "right",
    width: 400,
    height: 600,
    margins: { top: 40, bottom: 40, inside: 50, outside: 30, columnCount: 1, columnGutter: 12 },
    bleed: { top: 8, bottom: 8, inside: 8, outside: 8 },
    ...over,
  };
}

function item(over: Partial<ItemMeasure> = {}): ItemMeasure {
  return {
    itemId: 1,
    page: "1",
    side: "right",
    type: "TextFrame",
    parentKind: "Page",
    anchored: false,
    inGroup: false,
    layer: "Текст",
    layerVisible: true,
    layerPrintable: true,
    locked: false,
    rotation: 0,
    bounds: [100, 100, 200, 200],
    wrapMode: "NONE",
    wrapOffsets: null,
    anchorStyle: null,
    graphic: null,
    ...over,
  };
}

function measure(items: ItemMeasure[]): GeometryMeasure {
  return {
    docName: "к.indd",
    units: "points",
    traversal: "page.allPageItems",
    rulerOrigin: "PAGE_ORIGIN",
    zeroPoint: [0, 0],
    ms: 5,
    pages: [page()],
    items,
  };
}

async function run(items: ItemMeasure[], args: Record<string, unknown> = {}) {
  runJsxMock.mockReset();
  runJsxMock.mockResolvedValue(measure(items));
  const res = await handler()({ families: ["frame", "image", "anchored", "wrap"], ...args });
  const first = res.content[0];
  if (!first) throw new Error("відповідь без вмісту");
  return JSON.parse(first.text) as Record<string, unknown>;
}

describe("geometry_audit — проводка виміру у звіт", () => {
  it("wrap із самими NONE — це «нема матеріалу», а не «інвентар порожній»", async () => {
    /* Мутація 1. `NONE` — теж запис інвентарю, тож перевірка довжини
     * інвентарю сказала б «матеріал є» там, де судити нема чого. */
    const r = await run([item({ wrapMode: "NONE" }), item({ itemId: 2, wrapMode: "NONE" })]);
    /* Звіряємося з ТОЧНИМ реченням порожньої популяції, а не зі словом
     * «wrap»: воно є в notMeasured і з іншої причини (третій детектор родини
     * свідомо не реалізовано), тож широке твердження зеленіло б і на мутації. */
    const notMeasured = (r.notMeasured ?? []) as string[];
    expect(
      notMeasured.some((n) => n.includes("Text wrap isn't applied to any element")),
      "родину wrap не названо порожньою популяцією",
    ).toBe(true);
  });

  it("ПОЗИТИВНИЙ БЛИЗНЮК: справжній обтік порожньою популяцією не називають", async () => {
    const r = await run([item({ wrapMode: "BOUNDING_BOX_TEXT_WRAP", wrapOffsets: [5, 5, 5, 5] })]);
    const notMeasured = (r.notMeasured ?? []) as string[];
    expect(notMeasured.some((n) => n.includes("Text wrap isn't applied to any element"))).toBe(
      false,
    );
  });

  it("повернені рамки рахуються ті, що ПОВЕРНЕНІ", async () => {
    /* Мутація 2: `=== 0` замість `!== 0` перекидала лічильник у протилежність,
     * а звітний шар цього не бачив — він приймає число готовим. */
    const r = await run([
      item({ itemId: 1, rotation: -90 }),
      item({ itemId: 2, rotation: -90 }),
      item({ itemId: 3, rotation: 0 }),
    ]);
    expect(JSON.stringify(r.notMeasured)).toMatch(/2 rotated frame/u);
  });

  it("вектори рахуються як вектори, а не як растри", async () => {
    /* Мутація 3. Вектор не має ppi ЗА ПОБУДОВОЮ, і саме про це звіт говорить
     * окремим реченням; переплутані місцями, вони давали б його про растри. */
    const g = (kind: "raster" | "vector") => ({
      kind,
      effectivePpi: kind === "raster" ? ([300, 300] as [number, number]) : null,
      actualPpi: kind === "raster" ? ([300, 300] as [number, number]) : null,
      space: "CMYK",
      hScale: 100,
      vScale: 100,
      linkName: `${kind}.ai`,
      linkStatus: "NORMAL",
    });
    const r = await run([
      item({ itemId: 1, type: "PDF", graphic: g("vector") }),
      item({ itemId: 2, type: "Image", graphic: g("raster") }),
      item({ itemId: 3, type: "Image", graphic: g("raster") }),
    ]);
    expect(JSON.stringify(r.notMeasured)).toMatch(/1 vector image/u);
  });

  it("НЕГАТИВНИЙ КОНТРОЛЬ: без жодного вектора речення про вектори не з'являється", async () => {
    const r = await run([item({ itemId: 1, type: "TextFrame" })]);
    expect(JSON.stringify(r.notMeasured)).not.toMatch(/vector image\(s\) was not assessed/u);
  });
});

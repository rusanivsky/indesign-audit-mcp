import { describe, expect, it } from "vitest";
import { detectNearMiss, surveyNearMiss } from "../../src/geometry/frame.js";
import type { ItemMeasure, PageMeasure } from "../../src/geometry/types.js";

function page(): PageMeasure {
  return {
    name: "9", side: "right", width: 500, height: 700,
    margins: { top: 50, bottom: 60, inside: 80, outside: 90, columnCount: 1, columnGutter: 12 },
    bleed: { top: 8.5, bottom: 8.5, inside: 0, outside: 8.5 },
  };
}

function item(over: Partial<ItemMeasure>): ItemMeasure {
  return {
    itemId: 1, page: "9", side: "right", type: "TextFrame", parentKind: "Spread",
    anchored: false, inGroup: false, layer: "Шар 1", layerVisible: true,
    layerPrintable: true, locked: false, rotation: 0,
    bounds: [50, 80, 640, 410], wrapMode: "NONE", wrapOffsets: null, anchorStyle: null, graphic: null,
    ...over,
  };
}

describe("detectNearMiss", () => {
  it("знаходить промах на 0,05 pt повз ліву межу полоси", () => {
    const found = detectNearMiss([item({ bounds: [50, 79.95, 640, 410] })], [page()], 1);
    expect(found).toHaveLength(1);
    expect(found[0]!.defect).toBe("frame-near-miss");
  });

  it("НЕ знаходить елемент, що лежить точно на межі", () => {
    /* Позитивний близнюк до попереднього — правило спеку Фази 9 §8, яке
     * план Фази 11 порушив тричі. */
    expect(detectNearMiss([item({ bounds: [50, 80, 640, 410] })], [page()], 1)).toHaveLength(0);
  });

  it("НЕ знаходить грубий вихід за полосу — 62 % книжки лежить так навмисно", () => {
    expect(detectNearMiss([item({ bounds: [50, 10, 640, 410] })], [page()], 1)).toHaveLength(0);
  });

  it("виключає повернені рамки з вироку", () => {
    /* 91 рамка книжки має rotationAngle −90, і geometricBounds для них —
     * осеорієнтований габарит, а не рамка. 9,4 % популяції. */
    const rotated = item({ bounds: [50, 79.95, 640, 410], rotation: -90 });
    expect(detectNearMiss([rotated], [page()], 1)).toHaveLength(0);
  });

  it("не рахує промах, менший за EPSILON, — це похибка InDesign, не промах", () => {
    expect(detectNearMiss([item({ bounds: [50, 80 - 1e-9, 640, 410] })], [page()], 1)).toHaveLength(0);
  });

  /*
   * СТОРОЖ formatPt (рецензія хвилі виправлень, 2026-08-15).
   *
   * Мутант `formatPt` → `value.toFixed(2)` виживав на всьому наборі: усі
   * наявні тести беруть промах 0,05 pt, а там обидві гілки дають однакове
   * «0.05 pt». Смуга, заради якої formatPt і заведено, — це промахи МЕНШІ за
   * 0,01, і на книжці вона не порожня: розкладка дає ≤0.01 → 15 елементів.
   *
   * `EPSILON = 0,001`, тож детектор такий промах ЗНАХОДИТЬ, і з toFixed(2)
   * користувач бачив би рядок «0.00 pt» — тобто число, яке читається рівно
   * як «промаху немає», у знахідці про промах.
   */
  it("СТОРОЖ formatPt: промах 0,005 pt не сміє показуватись як «0.00 pt»", () => {
    const found = detectNearMiss([item({ bounds: [50, 80 - 0.005, 640, 410] })], [page()], 1);
    expect(found).toHaveLength(1);
    /* Головне твердження: рядок не читається як нуль. */
    expect(found[0]!.value).not.toBe("0.00 pt");
    expect(Number.parseFloat(found[0]!.value)).toBeGreaterThan(0);
    expect(found[0]!.value).toBe("0.0050 pt");
  });

  it("СТОРОЖ formatPt: два різні промахи під 0,01 не схлопуються в один рядок", () => {
    /* Друга половина тієї ж вади. Ключ групування — сам рядок значення, тож
     * із toFixed(2) промахи 0,002 і 0,003 дають ОДНАКОВИЙ ключ «0.00» і
     * зводяться в ОДНУ знахідку з count 2: дві різні величини стають однією,
     * та ще й неіснуючою. Числа взяті так, щоб округлення до сотих справді
     * їх злило (0,008 округлилось би до «0.01» і злиття не показало б). */
    const a = item({ bounds: [50, 80 - 0.002, 640, 410], page: "9" });
    const b = item({ bounds: [50, 80 - 0.003, 640, 410], page: "11", itemId: 2 });
    const p2 = { ...page(), name: "11" };
    const found = detectNearMiss([a, b], [page(), p2], 1);
    expect(found).toHaveLength(2);
    expect(new Set(found.map((f) => f.value))).toEqual(new Set(["0.0020 pt", "0.0030 pt"]));
  });

  it("позитивний близнюк: промах від 0,01 і більше лишається на двох знаках", () => {
    /* Інакше сторожі вище проходили б і на коді, що завжди дає чотири знаки,
     * — а 11,3386 pt у кожному рядку звіту було б шумом, не точністю. */
    const found = detectNearMiss([item({ bounds: [50, 79.95, 640, 410] })], [page()], 1);
    expect(found[0]!.value).toBe("0.05 pt");
  });

  it("зводить однакові промахи різних сторінок в один рядок", () => {
    const a = item({ bounds: [50, 79.95, 640, 410], page: "9" });
    const b = item({ bounds: [50, 79.95, 640, 410], page: "11", itemId: 2 });
    const p2 = { ...page(), name: "11" };
    const found = detectNearMiss([a, b], [page(), p2], 1);
    expect(found).toHaveLength(1);
    expect(found[0]!.count).toBe(2);
    expect(found[0]!.pages).toEqual(["9", "11"]);
  });
});

describe("surveyNearMiss", () => {
  it("віддає розкладку, щоб поріг називав користувач, а не інструмент", () => {
    const rows = surveyNearMiss(
      [item({ bounds: [50, 79.95, 640, 410] }), item({ bounds: [50, 10, 640, 410], itemId: 2 })],
      [page()],
    );
    const total = rows.reduce((s, r) => s + r.count, 0);
    expect(total).toBe(2);
  });

  it("виключає повернені рамки з розкладки — той самий гейт, що в detectNearMiss", () => {
    /* Той самий факт, що й у detectNearMiss вище: geometricBounds повернутої
     * рамки — осеорієнтований габарит, а не рамка, тож судити про промах
     * повз еталонну межу за ним не можна. surveyNearMiss — окрема функція з
     * власною копією гейта, і власний тест на неї потрібен окремо. */
    const rotated = item({ bounds: [50, 79.95, 640, 410], rotation: -90 });
    const rows = surveyNearMiss([rotated], [page()]);
    const total = rows.reduce((s, r) => s + r.count, 0);
    expect(total).toBe(0);
  });
});

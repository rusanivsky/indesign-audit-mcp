import { describe, expect, it } from "vitest";
import { detectWrap, hasWrapMaterial, inventoryWrap } from "../../src/geometry/wrap.js";
import { EPSILON, type ItemMeasure } from "../../src/geometry/types.js";

function item(over: Partial<ItemMeasure>): ItemMeasure {
  return {
    itemId: 1, page: "5", side: "right", type: "Rectangle", parentKind: "Spread",
    anchored: false, inGroup: false, layer: "Шар 1", layerVisible: true,
    layerPrintable: true, locked: false, rotation: 0,
    bounds: [0, 0, 50, 50], wrapMode: "BOUNDING_BOX_TEXT_WRAP",
    wrapOffsets: [9, 9, 9, 9],
    anchorStyle: null, graphic: null,
    ...over,
  };
}

describe("detectWrap", () => {
  it("обтікання на непридатному до друку шарі — знахідка", () => {
    /* Об'єкт не друкується, а текст обтікає порожнє місце. */
    const found = detectWrap([item({ layerPrintable: false })]);
    expect(found).toHaveLength(1);
    expect(found[0]!.defect).toBe("wrap-on-nonprinting");
  });

  it("обтікання на схованому шарі — окрема знахідка", () => {
    const found = detectWrap([item({ layerVisible: false })]);
    expect(found).toHaveLength(1);
    expect(found[0]!.defect).toBe("wrap-on-hidden");
  });

  it("звичайне обтікання на друкованому видимому шарі — не знахідка", () => {
    expect(detectWrap([item({})])).toHaveLength(0);
  });

  it("NONE на непридатному до друку шарі — не знахідка", () => {
    /* Позитивний близнюк: сам по собі непридатний до друку шар нічого не
     * означає, значення має ПОЄДНАННЯ з увімкненим обтіканням. */
    expect(detectWrap([item({ wrapMode: "NONE", layerPrintable: false })])).toHaveLength(0);
  });

  it("тип без підтримки обтікання (wrapMode === null) знахідкою не є", () => {
    expect(detectWrap([item({ wrapMode: null, layerPrintable: false })])).toHaveLength(0);
  });

  it("зводить однакові дефекти різних сторінок в один рядок — count і pages", () => {
    /* Одиниця звіту — ГРУПА, не елемент (принцип фази). Два елементи з
     * ОДНИМ дефектом на РІЗНИХ сторінках мусять дати один рядок з count=2
     * і pages з обома сторінками, впорядкованими comparePageNames. */
    const a = item({ layerPrintable: false, page: "11", itemId: 1 });
    const b = item({ layerPrintable: false, page: "9", itemId: 2 });
    const found = detectWrap([a, b]);
    expect(found).toHaveLength(1);
    expect(found[0]!.count).toBe(2);
    expect(found[0]!.pages).toEqual(["9", "11"]);
  });

  it("дедублікує pages, але не count, коли два елементи на ОДНІЙ сторінці", () => {
    /* Позитивний близнюк до попереднього: pages не повторює сторінку, а
     * count і далі рахує елементи, не сторінки. */
    const a = item({ layerVisible: false, page: "9", itemId: 1 });
    const b = item({ layerVisible: false, page: "9", itemId: 2 });
    const found = detectWrap([a, b]);
    expect(found).toHaveLength(1);
    expect(found[0]!.count).toBe(2);
    expect(found[0]!.pages).toEqual(["9"]);
  });

  describe("wrap-offsets-inconsistent (Задача 10б)", () => {
    it("дві рамки того самого режиму з РІЗНИМИ відступами — одна знахідка", () => {
      const a = item({ page: "11", itemId: 1, wrapOffsets: [9, 9, 9, 9] });
      const b = item({ page: "9", itemId: 2, wrapOffsets: [12, 9, 9, 9] });
      const found = detectWrap([a, b]);
      const mismatch = found.filter((f) => f.defect === "wrap-offsets-inconsistent");
      expect(mismatch).toHaveLength(1);
      /* Нічия 1:1 — більшості немає. Розв'язується першою появою, тож
       * порушником названо `b`, і саме ЙОГО сторінка стоїть у pages. */
      expect(mismatch[0]!.count).toBe(1);
      expect(mismatch[0]!.pages).toEqual(["9"]);
    });

    it("I1: звітується ДЕФЕКТ, а не популяція — 1 відхилений із 5, а не всі 5", () => {
      /*
       * Рецензія гілки, I1. До 2026-08-15 `count` дорівнював розміру всієї
       * популяції, а `pages` перелічували всі її сторінки: при 300 обтічних
       * елементах і одному відхиленому інструмент казав `count: 300` і давав
       * 300 сторінок — показував пальцем на норму замість порушника.
       */
      const norm = [1, 2, 3, 4].map((n) =>
        item({ page: String(n), itemId: n, wrapOffsets: [9, 9, 9, 9] }),
      );
      const deviant = item({ page: "77", itemId: 77, wrapOffsets: [12, 9, 9, 9] });
      const found = detectWrap([...norm, deviant]);
      const mismatch = found.filter((f) => f.defect === "wrap-offsets-inconsistent");
      expect(mismatch).toHaveLength(1);
      expect(mismatch[0]!.count).toBe(1);
      expect(mismatch[0]!.pages).toEqual(["77"]);
      /* Значення більшості мусить бути НАЗВАНЕ — інакше користувач бачить,
       * що щось розійшлося, але не бачить, із чим саме. */
      expect(mismatch[0]!.value).toContain("[9, 9, 9, 9]");
      expect(mismatch[0]!.value).toContain("4 of 5");
    });

    it("I1: більшість визначається РОЗМІРОМ групи, а не порядком у вимірі", () => {
      /*
       * Той самий сценарій, але відхилений елемент стоїть ПЕРШИМ. Тест, у
       * якому більшість завжди йде першою, пропустив би мутанта «за норму
       * береться bucket[0]»: порядок елементів у вимірі — властивість обходу
       * InDesign, а не джерело норми. Тут при виборі bucket[0] знахідка мала
       * б count: 4 і чотири сторінки норми.
       */
      const deviant = item({ page: "77", itemId: 77, wrapOffsets: [12, 9, 9, 9] });
      const norm = [1, 2, 3, 4].map((n) =>
        item({ page: String(n), itemId: n, wrapOffsets: [9, 9, 9, 9] }),
      );
      const found = detectWrap([deviant, ...norm]);
      const mismatch = found.filter((f) => f.defect === "wrap-offsets-inconsistent");
      expect(mismatch).toHaveLength(1);
      expect(mismatch[0]!.count).toBe(1);
      expect(mismatch[0]!.pages).toEqual(["77"]);
      expect(mismatch[0]!.value).toContain("majority [9, 9, 9, 9]");
    });

    it("I1: два відхилені на одній сторінці — count рахує елементи, pages не дублює", () => {
      const norm = [1, 2, 3].map((n) =>
        item({ page: String(n), itemId: n, wrapOffsets: [9, 9, 9, 9] }),
      );
      const d1 = item({ page: "77", itemId: 77, wrapOffsets: [12, 9, 9, 9] });
      const d2 = item({ page: "77", itemId: 78, wrapOffsets: [15, 9, 9, 9] });
      const found = detectWrap([...norm, d1, d2]);
      const mismatch = found.filter((f) => f.defect === "wrap-offsets-inconsistent");
      expect(mismatch).toHaveLength(1);
      expect(mismatch[0]!.count).toBe(2);
      expect(mismatch[0]!.pages).toEqual(["77"]);
    });

    it("позитивний близнюк: дві рамки того самого режиму з ОДНАКОВИМИ відступами — не знахідка", () => {
      const a = item({ page: "11", itemId: 1, wrapOffsets: [9, 9, 9, 9] });
      const b = item({ page: "9", itemId: 2, wrapOffsets: [9, 9, 9, 9] });
      const found = detectWrap([a, b]);
      expect(found.filter((f) => f.defect === "wrap-offsets-inconsistent")).toHaveLength(0);
    });

    it("розбіжність МЕНША за EPSILON — не знахідка (епсилон не марний)", () => {
      const a = item({ page: "11", itemId: 1, wrapOffsets: [9, 9, 9, 9] });
      const b = item({ page: "9", itemId: 2, wrapOffsets: [9 + EPSILON / 10, 9, 9, 9] });
      const found = detectWrap([a, b]);
      expect(found.filter((f) => f.defect === "wrap-offsets-inconsistent")).toHaveLength(0);
    });

    it("позитивний близнюк: розбіжність БІЛЬША за EPSILON — знахідка є", () => {
      const a = item({ page: "11", itemId: 1, wrapOffsets: [9, 9, 9, 9] });
      const b = item({ page: "9", itemId: 2, wrapOffsets: [9 + EPSILON * 10, 9, 9, 9] });
      const found = detectWrap([a, b]);
      expect(found.filter((f) => f.defect === "wrap-offsets-inconsistent")).toHaveLength(1);
    });

    it("елемент із wrapOffsets === null серед решти — ані знахідки, ані падіння", () => {
      const a = item({ page: "11", itemId: 1, wrapOffsets: [9, 9, 9, 9] });
      const b = item({ page: "9", itemId: 2, wrapOffsets: [9, 9, 9, 9] });
      const c = item({ page: "7", itemId: 3, wrapOffsets: null });
      expect(() => detectWrap([a, b, c])).not.toThrow();
      const found = detectWrap([a, b, c]);
      expect(found.filter((f) => f.defect === "wrap-offsets-inconsistent")).toHaveLength(0);
    });

    it("популяція з одного елемента знахідкою бути не може за побудовою", () => {
      const a = item({ page: "11", itemId: 1, wrapOffsets: [9, 9, 9, 9] });
      const found = detectWrap([a]);
      expect(found.filter((f) => f.defect === "wrap-offsets-inconsistent")).toHaveLength(0);
    });

    it("елементи РІЗНИХ режимів із різними відступами — не знахідка (популяції різні)", () => {
      const a = item({
        page: "11", itemId: 1, wrapMode: "BOUNDING_BOX_TEXT_WRAP", wrapOffsets: [9, 9, 9, 9],
      });
      const b = item({
        page: "9", itemId: 2, wrapMode: "JUMP_OBJECT_TEXT_WRAP", wrapOffsets: [12, 9, 9, 9],
      });
      const found = detectWrap([a, b]);
      expect(found.filter((f) => f.defect === "wrap-offsets-inconsistent")).toHaveLength(0);
    });
  });
});

describe("inventoryWrap", () => {
  it("рахує режими, зокрема NONE", () => {
    const rows = inventoryWrap([item({}), item({ wrapMode: "NONE", itemId: 2 })]);
    expect(rows.find((r) => r.mode === "NONE")!.count).toBe(1);
    expect(rows.find((r) => r.mode === "BOUNDING_BOX_TEXT_WRAP")!.count).toBe(1);
  });

  it("накопичує кілька елементів одного режиму, а не фіксує 1", () => {
    const rows = inventoryWrap([
      item({ itemId: 1 }),
      item({ itemId: 2 }),
      item({ itemId: 3 }),
    ]);
    expect(rows.find((r) => r.mode === "BOUNDING_BOX_TEXT_WRAP")!.count).toBe(3);
  });

  it("типи без підтримки обтікання в інвентар не потрапляють", () => {
    expect(inventoryWrap([item({ wrapMode: null })])).toHaveLength(0);
  });
});

/*
 * Раунд виправлень 2 (рецензія): критерій «wrap не має матеріалу» МУСИТЬ
 * бути «немає елемента зі справжнім обтіканням», а не «inventoryWrap()
 * порожній» — NONE теж запис інвентаря. Робоча книжка — рівно граничний
 * випадок: `textWrapMode = NONE` на всіх елементах, inventoryWrap() НЕ
 * порожній, а матеріалу для вироку немає.
 */
describe("hasWrapMaterial — критерій «матеріал для вироку», не «інвентар непорожній» (Раунд 2)", () => {
  it("книжковий стан: усі елементи NONE — матеріалу немає", () => {
    const items = [item({ wrapMode: "NONE" }), item({ wrapMode: "NONE", itemId: 2 })];
    expect(hasWrapMaterial(items)).toBe(false);
  });

  it("тип без підтримки обтікання (wrapMode null) серед NONE — і далі немає матеріалу", () => {
    const items = [
      item({ wrapMode: "NONE" }),
      item({ wrapMode: null, itemId: 2 }),
    ];
    expect(hasWrapMaterial(items)).toBe(false);
  });

  it("позитивний близнюк: бодай один елемент зі справжнім обтіканням — матеріал Є", () => {
    const items = [
      item({ wrapMode: "NONE" }),
      item({ wrapMode: "BOUNDING_BOX_TEXT_WRAP", itemId: 2 }),
    ];
    expect(hasWrapMaterial(items)).toBe(true);
  });

  it("порожній документ (items === []) — матеріалу немає, без падіння", () => {
    expect(hasWrapMaterial([])).toBe(false);
  });

  it("НЕ те саме, що inventoryWrap().length === 0: книжковий стан дає непорожній інвентар, але hasWrapMaterial===false", () => {
    const items = [item({ wrapMode: "NONE" }), item({ wrapMode: "NONE", itemId: 2 })];
    /* Негативний контроль до самого приладу: якби inventoryWrap() тут теж
     * був порожнім, наступне твердження не довело б нічого — обидва
     * критерії дали б однакову відповідь випадково. */
    expect(inventoryWrap(items).length).toBeGreaterThan(0);
    expect(hasWrapMaterial(items)).toBe(false);
  });
});

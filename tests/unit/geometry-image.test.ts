import { describe, expect, it } from "vitest";
import { detectLinks, detectResolution, inventoryGraphics } from "../../src/geometry/image.js";
import type { GraphicMeasure, ItemMeasure } from "../../src/geometry/types.js";

function withGraphic(g: Partial<GraphicMeasure>, type = "Image"): ItemMeasure {
  return {
    itemId: 1, page: "2", side: "left", type, parentKind: "Rectangle",
    anchored: false, inGroup: false, layer: "Шар 1", layerVisible: true,
    layerPrintable: true, locked: false, rotation: 0,
    bounds: [0, 0, 100, 100], wrapMode: null, wrapOffsets: null, anchorStyle: null,
    graphic: {
      kind: "raster", effectivePpi: [451, 451], actualPpi: [300, 300], space: "CMYK",
      hScale: 66.47, vScale: 66.47, linkName: "Mother_1.psd", linkStatus: "NORMAL",
      ...g,
    },
  };
}

describe("detectResolution", () => {
  it("растр нижче порога — знахідка", () => {
    const low = withGraphic({ effectivePpi: [72, 72] });
    const found = detectResolution([low], 300);
    expect(found).toHaveLength(1);
    expect(found[0]!.defect).toBe("image-low-resolution");
  });

  it("растр вище порога — не знахідка", () => {
    expect(detectResolution([withGraphic({})], 300)).toHaveLength(0);
  });

  it("ВЕКТОР знахідкою не є ніколи — у нього немає ppi за побудовою", () => {
    /* Виміряно H13: у типа PDF (а .ai імпортується саме ним) властивостей
     * effectivePpi/actualPpi/space НЕМАЄ, звернення кидає. «Немає ppi» —
     * властивість, не дефект. Код, що цього не знає, падає на кожній
     * книжці з векторним логотипом. */
    const vector = withGraphic(
      { kind: "vector", effectivePpi: null, actualPpi: null, space: null },
      "PDF",
    );
    expect(detectResolution([vector], 300)).toHaveLength(0);
  });

  it("рахує за МЕНШОЮ з двох осей — неоднорідний масштаб не сміє ховати дефект", () => {
    const anis = withGraphic({ effectivePpi: [600, 100] });
    expect(detectResolution([anis], 300)).toHaveLength(1);
  });

  it("растр РІВНО на порозі — не знахідка (межа)", () => {
    /* Мутант >= → > пропускає саме цю точку: 300>300 хибне, тож растр рівно
     * на порозі перестав би пропускатись і потрапив би у знахідки. */
    const atThreshold = withGraphic({ effectivePpi: [300, 300] });
    expect(detectResolution([atThreshold], 300)).toHaveLength(0);
  });

  it("растр на волосину нижче порога — знахідка", () => {
    const justBelow = withGraphic({ effectivePpi: [299.9, 299.9] });
    const found = detectResolution([justBelow], 300);
    expect(found).toHaveLength(1);
    expect(found[0]!.defect).toBe("image-low-resolution");
  });

  it("гілкування за типом НЕЗАЛЕЖНЕ від перевірки null: kind !== raster пропускається, навіть якщо effectivePpi якимось чином заповнено", () => {
    /* Реальний обробник JSX заповнює effectivePpi лише для kind === "raster",
     * тож перевірка `g.effectivePpi === null` сама собою відсіює вектор і в
     * production. Але тип GraphicMeasure цього не гарантує — нічого не
     * забороняє мати kind: "vector" з непорожнім effectivePpi (наприклад,
     * майбутня зміна обробника). Гейт за kind — це ЗАХИСТ від такого стану,
     * не дублювання перевірки null, і мусить перевірятися ОКРЕМО. */
    const vectorWithPpi = withGraphic(
      { kind: "vector", effectivePpi: [72, 72], actualPpi: [72, 72], space: null },
      "PDF",
    );
    expect(detectResolution([vectorWithPpi], 300)).toHaveLength(0);
  });

  it("kind \"unknown\" з непорожнім effectivePpi — той самий гейт, для нерозпізнаного типу", () => {
    const unknownWithPpi = withGraphic(
      { kind: "unknown", effectivePpi: [72, 72], actualPpi: [72, 72], space: null },
      "Unknown",
    );
    expect(detectResolution([unknownWithPpi], 300)).toHaveLength(0);
  });
});

describe("detectLinks", () => {
  it("зламаний лінк — знахідка", () => {
    const found = detectLinks([withGraphic({ linkStatus: "LINK_MISSING" })]);
    expect(found).toHaveLength(1);
    expect(found[0]!.defect).toBe("image-link-broken");
  });

  it("змінений лінк — окрема знахідка, не та сама", () => {
    const found = detectLinks([withGraphic({ linkStatus: "LINK_OUT_OF_DATE" })]);
    expect(found).toHaveLength(1);
    expect(found[0]!.defect).toBe("image-link-stale");
  });

  it("NORMAL — не знахідка", () => {
    expect(detectLinks([withGraphic({})])).toHaveLength(0);
  });

  it("вбудована графіка без лінка знахідкою не є", () => {
    expect(detectLinks([withGraphic({ linkStatus: null, linkName: null })])).toHaveLength(0);
  });

  /*
   * Рецензія гілки (дрібниця 4): усе, що не NORMAL і не LINK_OUT_OF_DATE,
   * підписувалось «Файл не знайдено». LINK_MISSING, LINK_INACCESSIBLE і
   * LINK_EMBEDDED — три різні стани з трьома різними діями: шукати файл,
   * полагодити доступ, не робити нічого.
   */
  it("недоступний лінк — ОКРЕМИЙ дефект, не «файл не знайдено»", () => {
    const found = detectLinks([withGraphic({ linkStatus: "LINK_INACCESSIBLE" })]);
    expect(found).toHaveLength(1);
    expect(found[0]!.defect).toBe("image-link-inaccessible");
    /* Підпис не сміє відправляти шукати файл, який лежить на місці. */
    expect(found[0]!.detail).not.toMatch(/File not found/);
    expect(found[0]!.detail).toMatch(/isn't mounted|permission/);
  });

  it("вбудований лінк (LINK_EMBEDDED) дефектом не є — діяти нема чого", () => {
    expect(detectLinks([withGraphic({ linkStatus: "LINK_EMBEDDED" })])).toHaveLength(0);
  });

  it("незнаний стан називається дослівно, а не тлумачиться здогадом", () => {
    const found = detectLinks([withGraphic({ linkStatus: "LINK_FUTURE_STATE" })]);
    expect(found).toHaveLength(1);
    expect(found[0]!.defect).toBe("image-link-abnormal");
    expect(found[0]!.detail).toContain("LINK_FUTURE_STATE");
    expect(found[0]!.detail).not.toMatch(/File not found/);
  });

  it("два різні ненормальні стани — дві окремі знахідки, не одна", () => {
    const found = detectLinks([
      withGraphic({ linkStatus: "LINK_MISSING", linkName: "зникле.tif" }),
      withGraphic({ linkStatus: "LINK_INACCESSIBLE", linkName: "недоступне.tif" }),
    ]);
    expect(found).toHaveLength(2);
    expect(new Set(found.map((f) => f.defect))).toEqual(
      new Set(["image-link-broken", "image-link-inaccessible"]),
    );
  });
});

describe("inventoryGraphics", () => {
  it("віддає пару «що виміряно + чим», зокрема для вектора", () => {
    const rows = inventoryGraphics([
      withGraphic({}),
      withGraphic({ kind: "vector", effectivePpi: null, actualPpi: null, space: null }, "PDF"),
    ]);
    expect(rows).toHaveLength(2);
    const vector = rows.find((r) => r.kind === "vector");
    expect(vector!.measured).toBe("vector — has no resolution by construction");
  });

  it("kind \"unknown\" не називається растром у measured", () => {
    /* Тернарник, що перевіряє лише === "vector", пропускає unknown у гілку
     * «растр, ефективна … ppi» — правдоподібна неправда: нерозпізнаний тип
     * видається за растр. */
    const rows = inventoryGraphics([
      withGraphic({ kind: "unknown", effectivePpi: null, actualPpi: null, space: null }, "Unknown"),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("unknown");
    expect(rows[0]!.measured).not.toContain("raster");
  });
});

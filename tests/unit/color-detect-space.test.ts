import { describe, expect, it } from "vitest";
import {
  detectNonCmyk,
  detectSpotApplied,
  detectUnexpectedInks,
} from "../../src/color/detect/space.js";
import { selectSites } from "../../src/color/sites.js";
import type { ColorMeasure, ColorRef, ColorSite } from "../../src/color/types.js";

const ALL = { includeNonPrinting: true, includeHidden: true };

const RGB: ColorRef = {
  named: "__rgb", model: "PROCESS", space: "RGB", value: [255, 0, 0], kind: "solid",
};
const SPOT: ColorRef = {
  named: "PANTONE 032", model: "SPOT", space: "CMYK", value: [0, 90, 86, 0], kind: "solid",
};
const DEFINITION: Partial<ColorSite> = {
  surface: "swatch", role: "definition", ownerKind: "Color", page: null, layer: "—",
};

function site(over: Partial<ColorSite> = {}): ColorSite {
  return {
    siteId: 1, surface: "pageItem", role: "fill", ownerKind: "Rectangle",
    ownerName: null, page: "5", master: null, layer: "01", printable: true,
    visible: true, laysInk: true,
    color: { named: "Black", model: "PROCESS", space: "CMYK", value: [0, 0, 0, 100], kind: "solid" },
    tint: -1, overprint: false, pointSize: null, ...over,
  };
}

describe("detectNonCmyk", () => {
  it("знаходить RGB у документі під офсет", () => {
    const found = detectNonCmyk([site({
      color: { named: null, model: "PROCESS", space: "RGB", value: [255, 0, 0], kind: "solid" },
    })]);
    expect(found).toHaveLength(1);
    expect(found[0]!.rule).toBe("non-cmyk-color");
  });

  it("знаходить Lab", () => {
    expect(detectNonCmyk([site({
      color: { named: "Lab", model: "PROCESS", space: "LAB", value: [50, 20, -30], kind: "solid" },
    })])).toHaveLength(1);
  });

  it("МОВЧИТЬ про CMYK — на цій книжці це всі 2417 діапазонів", () => {
    expect(detectNonCmyk([site()])).toEqual([]);
  });

  /*
   * Гейт зразка (спек §5.2): RGB-зразок у палітрі, не застосований до жодного
   * об'єкта, — не ужиток. Доти, доки цього гейта не було, позитивний доказ
   * усієї родини `space` на фікстурі спирався саме на це хибне спрацювання:
   * зразок `__rgb` створювався й нікуди не призначався.
   */
  it("МОВЧИТЬ про RGB-ЗРАЗОК у палітрі: визначення не є ужитком", () => {
    const definition = site({ ...DEFINITION, color: { ...RGB } });
    expect(detectNonCmyk(selectSites([definition], ALL))).toEqual([]);
  });

  it("той самий RGB, ЗАСТОСОВАНИЙ до об'єкта, — знахідка", () => {
    const applied = site({ color: { ...RGB } });
    expect(detectNonCmyk(selectSites([applied], ALL))).toHaveLength(1);
  });
});

describe("detectSpotApplied", () => {
  it("знаходить спотову фарбу", () => {
    const found = detectSpotApplied([site({
      color: { named: "PANTONE 032", model: "SPOT", space: "CMYK", value: [0, 90, 86, 0], kind: "solid" },
    })]);
    expect(found).toHaveLength(1);
    expect(found[0]!.rule).toBe("spot-applied");
  });

  it("МОВЧИТЬ про тріадний", () => {
    expect(detectSpotApplied([site()])).toEqual([]);
  });

  /* Гейт зразка (спек §5.2): спотовий зразок у палітрі — ще не п'ята форма на
   * машині. П'яту фарбу в документі доповідає окреме правило
   * `unexpected-ink-count`, і воно судить документ, а не місце. */
  it("МОВЧИТЬ про спотовий ЗРАЗОК у палітрі: визначення не є ужитком", () => {
    const definition = site({ ...DEFINITION, color: { ...SPOT } });
    expect(detectSpotApplied(selectSites([definition], ALL))).toEqual([]);
  });

  it("той самий спот, ЗАСТОСОВАНИЙ до об'єкта, — знахідка", () => {
    const applied = site({ color: { ...SPOT } });
    expect(detectSpotApplied(selectSites([applied], ALL))).toHaveLength(1);
  });
});

describe("detectUnexpectedInks", () => {
  const measure = {
    docName: "d", ms: 1, inkCount: 5,
    inkNames: ["Process Cyan", "Process Magenta", "Process Yellow", "Process Black", "PANTONE 032"],
    layers: [], sites: [], counters: [], links: [],
  } as ColorMeasure;

  it("п'ять фарб при заявлених чотирьох — знахідка з поіменним переліком", () => {
    const found = detectUnexpectedInks(measure, 4);
    expect(found).toHaveLength(1);
    expect(found[0]!.examples.join(" ")).toContain("PANTONE 032");
  });

  it("МОВЧИТЬ, коли фарб рівно стільки, скільки заявлено — стан цієї книжки", () => {
    expect(detectUnexpectedInks({ ...measure, inkCount: 4, inkNames: measure.inkNames.slice(0, 4) }, 4))
      .toEqual([]);
  });

  it("МОВЧИТЬ, коли фарб МЕНШЕ за заявлені: одноколірна робота — не дефект", () => {
    expect(detectUnexpectedInks({ ...measure, inkCount: 4, inkNames: measure.inkNames.slice(0, 4) }, 5))
      .toEqual([]);
  });
});

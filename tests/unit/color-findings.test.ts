import { describe, expect, it } from "vitest";
import { buildFindings } from "../../src/color/findings.js";
import type { ColorSite } from "../../src/color/types.js";

function site(over: Partial<ColorSite> = {}): ColorSite {
  return {
    siteId: 1, surface: "pageItem", role: "fill", ownerKind: "GraphicLine",
    ownerName: null, page: "17", master: null, layer: "01", printable: true,
    visible: true, laysInk: true,
    color: { named: null, model: "PROCESS", space: "CMYK", value: [76, 48, 66, 70], kind: "solid" },
    tint: -1, overprint: false, pointSize: null, ...over,
  };
}

describe("buildFindings", () => {
  it("зводить однакові кортежі в один рядок із лічильником", () => {
    const found = buildFindings([site(), site({ siteId: 2, page: "25" })], "tac", "правило");
    expect(found).toHaveLength(1);
    expect(found[0]!.count).toBe(2);
    expect(found[0]!.pages).toEqual(["17", "25"]);
  });

  it("різні кольори — різні рядки", () => {
    const other = site({
      siteId: 2,
      color: { named: null, model: "PROCESS", space: "CMYK", value: [0, 0, 0, 100], kind: "solid" },
    });
    expect(buildFindings([site(), other], "tac", "правило")).toHaveLength(2);
  });

  it("приклад рахується для СВОЄЇ групи, а не для першої-ліпшої", () => {
    const a = site({ ownerKind: "GraphicLine" });
    const b = site({
      siteId: 2, ownerKind: "Rectangle",
      color: { named: null, model: "PROCESS", space: "CMYK", value: [0, 0, 0, 100], kind: "solid" },
    });
    const found = buildFindings([a, b], "tac", "правило");
    const byColor = new Map(found.map((f) => [f.color, f.examples.join(",")]));
    expect(byColor.get("unnamed CMYK 76/48/66/70")).toBe("GraphicLine");
    expect(byColor.get("unnamed CMYK 0/0/0/100")).toBe("Rectangle");
  });

  it("кегль потрапляє в приклад текстового кортежу", () => {
    const found = buildFindings([site({ surface: "textRange", ownerKind: "Text", pointSize: 8 })], "black", "правило");
    expect(found[0]!.examples[0]).toBe("Text 8 pt");
  });

  it("порожній вхід дає порожній перелік, а не рядок із нулем", () => {
    expect(buildFindings([], "tac", "правило")).toEqual([]);
  });

  it("власний будівник прикладів заміщає замовчування", () => {
    const found = buildFindings([site()], "tac", "правило", (g) => [`своє: ${g.length}`]);
    expect(found[0]!.examples).toEqual(["своє: 1"]);
  });
});

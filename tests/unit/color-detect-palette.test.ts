import { describe, expect, it } from "vitest";
import {
  detectPaletteMiss,
  detectUnnamed,
  surveyPaletteDistance,
} from "../../src/color/detect/palette.js";
import type { ColorRef, ColorSite } from "../../src/color/types.js";

function ref(value: number[], named: string | null = null): ColorRef {
  return { named, model: "PROCESS", space: "CMYK", value, kind: "solid" };
}

function site(color: ColorRef, over: Partial<ColorSite> = {}): ColorSite {
  return {
    siteId: 1, surface: "pageItem", role: "fill", ownerKind: "GraphicLine",
    ownerName: null, page: "17", master: null, layer: "01", printable: true,
    visible: true, laysInk: true,
    color, tint: -1, overprint: false, pointSize: null, ...over,
  };
}

const PALETTE = [
  ref([0, 0, 0, 100], "Black"),
  ref([0, 9, 24, 0], "C=0 M=9 Y=24 K=0"),
  ref([1, 29, 18, 0], "C=1 M=29 Y=18 K=0"),
  ref([20, 100, 90, 10], "C=20 M=100 Y=90 K=10"),
];

describe("detectUnnamed", () => {
  it("знаходить колір, застосований повз зразок", () => {
    const found = detectUnnamed([site(ref([76, 48, 66, 70]))]);
    expect(found).toHaveLength(1);
    expect(found[0]!.rule).toBe("unnamed-color");
  });

  it("МОВЧИТЬ про іменований", () => {
    expect(detectUnnamed([site(ref([0, 0, 0, 100], "Black"))])).toEqual([]);
  });

  it("МОВЧИТЬ про визначення зразка: зразок за побудовою має ім'я й не є ужитком", () => {
    const def = site(ref([0, 0, 0, 100], "Black"), { surface: "swatch", role: "definition" });
    expect(detectUnnamed([def])).toEqual([]);
  });

  it("зводить 84 однакові в один рядок", () => {
    const many: ColorSite[] = [];
    for (let i = 0; i < 84; i++) many.push(site(ref([76, 48, 66, 70]), { siteId: i, page: String(i + 1) }));
    const found = detectUnnamed(many);
    expect(found).toHaveLength(1);
    expect(found[0]!.count).toBe(84);
  });
});

describe("detectPaletteMiss", () => {
  it("точний збіг зі зразком під безіменним кольором — окреме правило", () => {
    const found = detectPaletteMiss([site(ref([1, 29, 18, 0]))], PALETTE, 25);
    expect(found).toHaveLength(1);
    expect(found[0]!.rule).toBe("unnamed-duplicate-of-swatch");
  });

  it("виміряний промах 0/100/85/5 повз акцентний — близький промах", () => {
    const found = detectPaletteMiss([site(ref([0, 100, 85, 5]))], PALETTE, 25);
    expect(found).toHaveLength(1);
    expect(found[0]!.rule).toBe("near-miss-of-swatch");
    expect(found[0]!.examples[0]).toContain("C=20 M=100 Y=90 K=10");
  });

  it("МОВЧИТЬ про колір, у якого близького зразка немає — 76/48/66/70 не промах", () => {
    expect(detectPaletteMiss([site(ref([76, 48, 66, 70]))], PALETTE, 25)).toEqual([]);
  });

  it("МОВЧИТЬ, коли поріг вужчий за розбіжність: поріг задає людина", () => {
    expect(detectPaletteMiss([site(ref([0, 100, 85, 5]))], PALETTE, 5)).toEqual([]);
  });

  it("іменовані кольори не судяться взагалі — вони вже з палітри", () => {
    expect(detectPaletteMiss([site(ref([0, 100, 85, 5], "Свій"))], PALETTE, 25)).toEqual([]);
  });

  it("два РІЗНІ дублікати дістають кожен свій зразок у прикладі, а не спільний", () => {
    const dupA = site(ref([1, 29, 18, 0]));
    const dupB = site(ref([0, 9, 24, 0]), { siteId: 2 });
    const found = detectPaletteMiss([dupA, dupB], PALETTE, 25);
    const dups = found.filter((f) => f.rule === "unnamed-duplicate-of-swatch");
    expect(dups).toHaveLength(2);
    const byColor = new Map(dups.map((f) => [f.color, f.examples.join(" ")]));
    expect(byColor.get("unnamed CMYK 1/29/18/0")).toContain("C=1 M=29 Y=18 K=0");
    expect(byColor.get("unnamed CMYK 0/9/24/0")).toContain("C=0 M=9 Y=24 K=0");
  });
});

describe("surveyPaletteDistance", () => {
  it("розкладає відстані, щоб поріг брався з розриву, а не з голови", () => {
    const buckets = surveyPaletteDistance(
      [site(ref([1, 29, 18, 0])), site(ref([0, 100, 85, 5]), { siteId: 2 })],
      PALETTE,
    );
    const total = buckets.reduce((a, b) => a + b.count, 0);
    expect(total).toBe(2);
  });

  it("порожня палітра дає нуль вимірюваних відстаней, а не падіння", () => {
    expect(() => surveyPaletteDistance([site(ref([1, 2, 3, 4]))], [])).not.toThrow();
  });
});

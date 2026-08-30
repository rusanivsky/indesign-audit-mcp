import { describe, expect, it } from "vitest";
import { assembleFindings, DEFAULTS } from "../../src/tools/color.js";
import type { ColorMeasure, ColorSite } from "../../src/color/types.js";

function site(over: Partial<ColorSite> = {}): ColorSite {
  return {
    siteId: 1, surface: "pageItem", role: "fill", ownerKind: "GraphicLine",
    ownerName: null, page: "17", master: null, layer: "01", printable: true,
    visible: true, laysInk: true,
    color: { named: null, model: "PROCESS", space: "CMYK", value: [76, 48, 66, 70], kind: "solid" },
    tint: -1, overprint: false, pointSize: null, ...over,
  };
}

function measure(sites: ColorSite[]): ColorMeasure {
  return {
    docName: "d.indd", ms: 10, inkCount: 4,
    inkNames: ["Process Cyan", "Process Magenta", "Process Yellow", "Process Black"],
    layers: [], sites, counters: [], links: [],
  };
}

describe("assembleFindings", () => {
  it("рахує ЛИШЕ запитані родини", () => {
    const r = assembleFindings(measure([site()]), { families: ["space"] });
    expect(r.findings.every((f) => f.family === "space")).toBe(true);
  });

  it("без порога палітри віддає розкладку, але не вирок про промах", () => {
    const r = assembleFindings(measure([site()]), {});
    expect(r.paletteSurvey).not.toBeNull();
    expect(r.findings.some((f) => f.rule === "near-miss-of-swatch")).toBe(false);
  });

  it("недруковані кортежі не судяться й рахуються окремо", () => {
    const r = assembleFindings(measure([site({ printable: false })]), {});
    expect(r.sitesSkippedNonPrinting).toBe(1);
    expect(r.findings).toEqual([]);
  });

  it("замовчування межі фарби — 300, і воно потрапляє в параметри звіту", () => {
    expect(DEFAULTS.maxTotalInk).toBe(300);
    const r = assembleFindings(measure([site()]), {});
    expect(r.maxTotalInk).toBe(300);
  });

  it("зразки палітри беруться з кортежів surface=swatch, а не звідкись іще", () => {
    const swatch = site({
      siteId: 2, surface: "swatch", role: "definition",
      color: { named: "Акцент", model: "PROCESS", space: "CMYK", value: [20, 100, 90, 10], kind: "solid" },
    });
    const near = site({
      siteId: 3,
      color: { named: null, model: "PROCESS", space: "CMYK", value: [0, 100, 85, 5], kind: "solid" },
    });
    const r = assembleFindings(measure([swatch, near]), { paletteNearMissThreshold: 25 });
    expect(r.findings.some((f) => f.rule === "near-miss-of-swatch")).toBe(true);
  });

  // Ruling 6: прихований шар — причина не друкуватися, ОКРЕМА від недрукованого.
  it("приховані кортежі не судяться й рахуються ОКРЕМО від недрукованих", () => {
    const r = assembleFindings(measure([site({ visible: false })]), {});
    expect(r.sitesSkippedHidden).toBe(1);
    expect(r.sitesSkippedNonPrinting).toBe(0);
    expect(r.findings).toEqual([]);
  });

  // Ruling 8: геометрична неможливість лягти фарбою — окрема причина пропуску.
  it("кольори, що не лягають фарбою, рахуються окремо й не судяться", () => {
    const r = assembleFindings(measure([site({ laysInk: false })]), {});
    expect(r.sitesSkippedNoInk).toBe(1);
    expect(r.findings).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_PX, MAX_DPI, MIN_DPI, resolveDpi } from "../../src/render/resolution.js";

/* 240 мм = 680,31 pt; 340 мм = 963,78 pt — довгі сторони сторінки й розвороту
 * робочої книжки. Обидва числа зміряні, спек §4. */
const СТОРІНКА_PT = 680.31;
const РОЗВОРОТ_PT = 963.78;

describe("resolveDpi", () => {
  it("сторінка 170×240 при 1400 px дає 148 dpi", () => {
    expect(resolveDpi({ longEdgePt: СТОРІНКА_PT }).dpi).toBe(148);
    expect(resolveDpi({ longEdgePt: СТОРІНКА_PT, maxPx: DEFAULT_MAX_PX }).dpi).toBe(148);
  });

  it("РОЗВОРОТ при тому самому 1400 px дає 105 dpi — довга сторона береться з розвороту", () => {
    expect(resolveDpi({ longEdgePt: РОЗВОРОТ_PT }).dpi).toBe(105);
  });

  it("явний dpi має пріоритет і не рахується з пікселів", () => {
    const r = resolveDpi({ longEdgePt: СТОРІНКА_PT, dpi: 200 });
    expect(r.dpi).toBe(200);
    expect(r.clamped).toBe(false);
  });

  it("dpi і maxPx разом — помилка, а не мовчазний пріоритет", () => {
    expect(() => resolveDpi({ longEdgePt: СТОРІНКА_PT, dpi: 200, maxPx: 900 })).toThrow(/together/);
  });

  it("затиснення видно ЧИСЛОМ на обох межах", () => {
    const високий = resolveDpi({ longEdgePt: СТОРІНКА_PT, dpi: 1200 });
    expect(високий.dpi).toBe(MAX_DPI);
    expect(високий.requestedDpi).toBe(1200);
    expect(високий.clamped).toBe(true);

    const низький = resolveDpi({ longEdgePt: СТОРІНКА_PT, maxPx: 100 });
    expect(низький.dpi).toBe(MIN_DPI);
    expect(низький.clamped).toBe(true);
  });

  it("невід'ємність: нульова чи від'ємна довга сторона — помилка, а не Infinity", () => {
    expect(() => resolveDpi({ longEdgePt: 0, maxPx: 1400 })).toThrow(/long edge/);
    expect(() => resolveDpi({ longEdgePt: -5, maxPx: 1400 })).toThrow(/long edge/);
  });
});

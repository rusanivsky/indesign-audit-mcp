import { describe, expect, it } from "vitest";
import { comparePageNames, EPSILON } from "../../src/geometry/types.js";

describe("EPSILON", () => {
  it("більший за похибку подвійної точності, яку дає сам InDesign", () => {
    /* Виміряно H13: page.bounds тієї самої сторінки розходиться до 7,3e-12.
     * Епсилон мусить її покривати з великим запасом і при цьому лишатись
     * набагато меншим за найдрібніший ЗНАЧУЩИЙ промах (0,01 pt). */
    expect(EPSILON).toBeGreaterThan(7.3e-12);
    expect(EPSILON).toBeLessThan(0.01);
  });
});

describe("comparePageNames", () => {
  it("упорядковує за числом, а не за рядком", () => {
    expect(["10", "9", "1"].sort(comparePageNames)).toEqual(["1", "9", "10"]);
  });

  it("нечислові назви йдуть після числових, між собою — за рядком", () => {
    expect(["ii", "10", "i", "2"].sort(comparePageNames)).toEqual(["2", "10", "i", "ii"]);
  });
});

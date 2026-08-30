import { describe, expect, it } from "vitest";
import { EN_DASH, FOREIGN_DASHES, NBSP, UK_UPPER } from "../../src/bibliography/chars.js";

describe("гомогліфи", () => {
  it("UK_UPPER приймає ЛАТИНСЬКУ I у слові «Iсторiя»", () => {
    /* Випуск 2022: 3996 латинських I проти 9 кириличних (спек §0.6). */
    expect(new RegExp(`^[${UK_UPPER}]`, "u").test("Iсторiя")).toBe(true);
  });

  it("UK_UPPER приймає й кириличну І", () => {
    expect(new RegExp(`^[${UK_UPPER}]`, "u").test("Історія")).toBe(true);
  });
});

describe("риски", () => {
  it("EN_DASH — саме U+2013", () => {
    expect(EN_DASH).toBe("–");
    expect(EN_DASH.charCodeAt(0)).toBe(0x2013);
  });

  it("FOREIGN_DASHES містить figure dash і мінус, а не лише дефіс", () => {
    /* Виміряно на випусках 2022/2023: U+2012 — 5 і 8, U+2212 — 0 і 3. */
    for (const ch of ["-", "‐", "‑", "‒", "—", "―", "−"]) {
      expect(new RegExp(`[${FOREIGN_DASHES}]`, "u").test(ch)).toBe(true);
    }
  });

  it("FOREIGN_DASHES НЕ містить U+2013 — це правильний знак, не чужий", () => {
    expect(new RegExp(`[${FOREIGN_DASHES}]`, "u").test(EN_DASH)).toBe(false);
  });

  it("NBSP — U+00A0", () => {
    expect(NBSP.charCodeAt(0)).toBe(0x00a0);
  });
});

import { describe, expect, it } from "vitest";
import { formatComponents } from "../../src/color/types.js";

describe("formatComponents", () => {
  it("CMYK показує чотири компоненти через скісну, без десяткових хвостів", () => {
    expect(formatComponents([76, 48, 66, 70])).toBe("76/48/66/70");
  });

  it("дробові компоненти округлює до десятої — 0,5 % фарби не читається на аркуші", () => {
    expect(formatComponents([76.04, 48, 66, 70.25])).toBe("76/48/66/70.3");
  });

  it("порожнє значення — це не нуль, а відсутність виміру", () => {
    expect(formatComponents(null)).toBe("—");
  });
});

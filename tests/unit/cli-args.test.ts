import { describe, expect, it } from "vitest";
import { EXIT, parseArgs } from "../../src/cli/audit.js";

describe("parseArgs", () => {
  it("читає --config і --out", () => {
    const a = parseArgs(["--config", "c.json", "--out", "r.html"]);
    expect(a.config).toBe("c.json");
    expect(a.out).toBe("r.html");
  });

  it("відмовляє без --config — мовчазного замовчування немає", () => {
    expect(() => parseArgs(["--out", "r.html"])).toThrow(/--config/);
  });

  it("відмовляє без --out", () => {
    expect(() => parseArgs(["--config", "c.json"])).toThrow(/--out/);
  });

  it("--restart-indesign типово вимкнено — це побічна дія на чужій машині", () => {
    expect(parseArgs(["--config", "c", "--out", "r"]).restartIndesign).toBe(false);
    expect(parseArgs(["--config", "c", "--out", "r", "--restart-indesign"]).restartIndesign).toBe(true);
  });

  /*
   * I2 (фінальна рецензія, Important): відмова сеансу радила «вкажіть
   * --doc на той, що вже відкритий» (`src/cli/run/session.ts`), а
   * `parseArgs` про такий прапорець не знав — із `strict: true` виконання
   * поради давало «Unknown option '--doc'» і код 2. Порада, яка НЕ МОЖЕ
   * спрацювати, — той самий клас, що R27 і що G2.
   */
  it("I2: --doc розбирається (спек §6.1) — порада відмови сеансу тепер виконувана", () => {
    expect(parseArgs(["--config", "c", "--out", "r"]).doc).toBeNull();
    expect(parseArgs(["--config", "c", "--out", "r", "--doc", "/т/книга.indd"]).doc).toBe(
      "/т/книга.indd",
    );
  });

  it("--measurements необов'язковий", () => {
    expect(parseArgs(["--config", "c", "--out", "r"]).measurements).toBeNull();
    expect(parseArgs(["--config", "c", "--out", "r", "--measurements", "m.json"]).measurements).toBe("m.json");
  });
});

describe("EXIT", () => {
  it("розрізняє чотири стани — інакше воротами не поставиш", () => {
    expect([EXIT.CLEAN, EXIT.CRITICAL, EXIT.CONFIG, EXIT.ENVIRONMENT]).toEqual([0, 1, 2, 3]);
  });
});

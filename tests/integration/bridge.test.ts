import { describe, it, expect } from "vitest";
import { runJsx } from "../../src/bridge/runner.js";

interface Status {
  version: string;
  documents: { name: string; pages: number }[];
  activeDocument: string | null;
  books: string[];
}

describe("міст до InDesign", () => {
  it("повертає версію запущеного InDesign", async () => {
    const status = await runJsx<Status>("status", {});
    expect(status.version).toMatch(/^\d+/);
    expect(Array.isArray(status.documents)).toBe(true);
  });

  it("правильно передає кирилицю і \\r (кінець абзацу InDesign) в обидва боки через echo", async () => {
    const payload = { проба: "Київ — столиця", paragraphEnd: "перший\rдругий", quote: 'він сказав "привіт"' };
    const echoed = await runJsx<typeof payload>("echo", payload);
    expect(echoed).toEqual(payload);
  });
});

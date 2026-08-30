import { describe, expect, it } from "vitest";
import { okImage } from "../../src/tools/shared.js";

describe("okImage", () => {
  it("кладе картинку ПЕРШИМ блоком, а числа — другим", () => {
    const r = okImage("QUJD", "image/png", { dpi: 148 });
    expect(r.content).toHaveLength(2);
    expect(r.content[0]).toEqual({ type: "image", data: "QUJD", mimeType: "image/png" });
    expect((r.content[1] as { type: string }).type).toBe("text");
    expect(JSON.parse(((r.content[1] as { text: string }).text))).toEqual({ dpi: 148 });
  });

  it("НЕ ламає ok(): сусідній помічник і далі віддає лише текст", async () => {
    const { ok } = await import("../../src/tools/shared.js");
    const r = ok({ a: 1 });
    expect(r.content).toHaveLength(1);
    expect((r.content[0] as { type: string }).type).toBe("text");
  });
});

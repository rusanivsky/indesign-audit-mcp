import { describe, it, expect } from "vitest";
import { classifyOsascriptFailure } from "../../src/bridge/errors.js";

describe("classifyOsascriptFailure", () => {
  it("розпізнає, що InDesign не запущено", () => {
    const e = classifyOsascriptFailure("execution error: ... (-600)", false);
    expect(e.kind).toBe("not-running");
    expect(e.hint).toContain("InDesign");
  });

  it("розпізнає відсутність дозволу на Автоматизацію", () => {
    const e = classifyOsascriptFailure("Not authorized to send Apple events (-1743)", false);
    expect(e.kind).toBe("no-permission");
    expect(e.hint).toContain("Automation");
  });

  it("таймаут трактує як зайнятий InDesign", () => {
    const e = classifyOsascriptFailure("", true);
    expect(e.kind).toBe("busy");
    expect(e.hint).toContain("modal");
  });

  /*
   * -1712 приходить із timedOut === false (це таймаут самого AppleScript, а не
   * наш kill процесу) і доти падав у "unknown" із сирим дампом stderr.
   */
  it("розпізнає таймаут AppleScript (-1712) як зайнятий InDesign", () => {
    const e = classifyOsascriptFailure(
      "execution error: Adobe InDesign 2026 got an error: AppleEvent timed out. (-1712)",
      false,
    );
    expect(e.kind).toBe("busy");
    expect(e.message).toContain("-1712");
    expect(e.hint).toContain("timeoutMs");
  });

  it("невідому помилку не приховує", () => {
    const e = classifyOsascriptFailure("щось інше", false);
    expect(e.kind).toBe("unknown");
    expect(e.message).toContain("щось інше");
  });
});

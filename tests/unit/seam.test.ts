import { describe, expect, it } from "vitest";
import { normalizeAtSeam } from "../../src/typography/seam.js";
import { regexRule } from "../../src/typography/rule.js";

describe("normalizeAtSeam", () => {
  it("править дефіс на тире всередині самої правки", () => {
    const r = normalizeAtSeam({
      contextBefore: "вона сказала: ",
      newText: "мама - це все",
      contextAfter: ", і замовкла",
    });
    expect(r.writeText).toBe("мама — це все");
    expect(r.normalizations.map((n) => n.ruleId)).toContain("dash-separator");
  });

  it("прибирає подвійний пробіл на шві ЗЛІВА", () => {
    const r = normalizeAtSeam({
      contextBefore: "слово ",
      newText: " нове",
      contextAfter: " далі",
    });
    expect(r.writeText).toBe("нове");
  });

  it("прибирає подвійний пробіл на шві СПРАВА", () => {
    const r = normalizeAtSeam({
      contextBefore: "слово ",
      newText: "нове ",
      contextAfter: " далі",
    });
    expect(r.writeText).toBe("нове");
  });

  it("не чіпає документ поза правкою", () => {
    const r = normalizeAtSeam({
      contextBefore: "тут  подвійний пробіл документа ",
      newText: "нове",
      contextAfter: " і   тут теж",
    });
    expect(r.writeText).toBe("нове");
    expect(r.normalizations).toEqual([]);
  });

  it("не лишає пробілу перед комою на шві", () => {
    const r = normalizeAtSeam({
      contextBefore: "слово",
      newText: " ",
      contextAfter: ", далі",
    });
    expect(r.writeText).toBe("");
  });

  it("на порожньому new нічого не робить", () => {
    const r = normalizeAtSeam({ contextBefore: "а  ", newText: "", contextAfter: "  б" });
    expect(r.writeText).toBe("");
    expect(r.normalizations).toEqual([]);
  });

  it("не з'їдає знак абзацу з контексту", () => {
    const r = normalizeAtSeam({
      contextBefore: "кінець абзацу\r",
      newText: "Початок",
      contextAfter: " далі",
    });
    expect(r.writeText).toBe("Початок");
  });

  it("кожна нормалізація має назву правила й текст до/після", () => {
    const r = normalizeAtSeam({
      contextBefore: "",
      newText: 'вона сказала "так"',
      contextAfter: "",
    });
    expect(r.normalizations.length).toBeGreaterThan(0);
    for (const n of r.normalizations) {
      expect(n.title.length).toBeGreaterThan(0);
      expect(n.before).not.toBe(n.after);
    }
  });

  it("НЕ застосовує needs-review збіг (географічний діапазон)", () => {
    const r = normalizeAtSeam({
      contextBefore: "",
      newText: "рейс Київ-Львів",
      contextAfter: "",
    });
    expect(r.writeText).toBe("рейс Київ-Львів");
    expect(r.normalizations).toEqual([]);
  });

  it("НЕ застосовує needs-review збіг (дефіс поряд із номером телефону)", () => {
    const r = normalizeAtSeam({
      contextBefore: "",
      newText: "тел. 067 - 123",
      contextAfter: "",
    });
    expect(r.writeText).toBe("тел. 067 - 123");
    expect(r.normalizations).toEqual([]);
  });

  it("ідемпотентна: повторний прогін нічого не міняє", () => {
    const first = normalizeAtSeam({
      contextBefore: "текст ",
      newText: "мама - це все",
      contextAfter: " далі",
    });
    const second = normalizeAtSeam({
      contextBefore: "текст ",
      newText: first.writeText,
      contextAfter: " далі",
    });
    expect(second.writeText).toBe(first.writeText);
    expect(second.normalizations).toEqual([]);
  });
});

describe("шов і мовні правила", () => {
  it("правило з мовою НЕ застосовується у шві, а безмовне — застосовується", () => {
    /* Позитивний близнюк у тому самому тесті: «мовне не спрацювало»
     * істинне й тоді, коли шов узагалі перестав нормалізувати. */
    const uk = regexRule({
      id: "test-uk", title: "тест", confidence: "high",
      language: "Ukrainian", find: /проект/gu, replace: "проєкт",
    });
    const dash = regexRule({
      id: "test-dash", title: "тест", confidence: "high",
      find: / - /gu, replace: " — ",
    });

    const r = normalizeAtSeam({
      contextBefore: "", newText: "проект - це", contextAfter: "", rules: [uk, dash],
    });
    expect(r.writeText).toBe("проект — це");
    expect(r.normalizations.map((n) => n.ruleId)).toEqual(["test-dash"]);
  });
});

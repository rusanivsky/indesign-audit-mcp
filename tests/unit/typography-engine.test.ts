import { describe, expect, it } from "vitest";
import { groupByRule, regexRule, rewrite, runRules } from "../../src/typography/engine.js";

const collapse = regexRule({
  id: "collapse-spaces",
  title: "Кілька пробілів → один",
  confidence: "high",
  find: /[ \t]{2,}/gu,
  replace: " ",
});

const dash = regexRule({
  id: "dash-separator",
  title: "Дефіс між пробілами → тире",
  confidence: "high",
  find: /(\s)-(\s)/gu,
  replace: "$1—$2",
});

describe("regexRule і runRules", () => {
  it("знаходить усі збіги правила", () => {
    const m = runRules("а  б   в", [collapse]);
    expect(m).toHaveLength(2);
    expect(m[0]!.ruleId).toBe("collapse-spaces");
  });

  it("несе текст до і після заміни", () => {
    const m = runRules("мама - це все", [dash]);
    expect(m[0]!.before).toBe(" - ");
    expect(m[0]!.after).toBe(" — ");
  });

  it("несе контекст навколо збігу", () => {
    const m = runRules("довгий текст перед мама - це все і далі текст", [dash]);
    expect(m[0]!.contextBefore).toContain("перед");
    expect(m[0]!.contextAfter).toContain("далі");
  });

  it("на тексті без збігів дає порожньо", () => {
    expect(runRules("нічого тут немає", [collapse, dash])).toEqual([]);
  });
});

describe("except і review", () => {
  it("except викидає збіг зовсім", () => {
    const rule = regexRule({
      id: "r",
      title: "t",
      confidence: "high",
      find: /-/gu,
      replace: "—",
      except: (m, text) => /\d/u.test(text[m.index - 1] ?? ""),
    });
    expect(runRules("1-2 та а-б", [rule])).toHaveLength(1);
  });

  it("review понижує впевненість, але збіг лишає", () => {
    const rule = regexRule({
      id: "r",
      title: "t",
      confidence: "high",
      find: /-/gu,
      replace: "—",
      review: (m, text) => /\d/u.test(text[m.start - 1] ?? ""),
    });
    const m = runRules("1-2 та а-б", [rule]);
    expect(m).toHaveLength(2);
    expect(m[0]!.confidence).toBe("needs-review");
    expect(m[1]!.confidence).toBe("high");
  });
});

describe("rewrite", () => {
  it("застосовує заміни й не зсуває наступні", () => {
    expect(rewrite("а  б   в", runRules("а  б   в", [collapse]))).toBe("а б в");
  });

  it("застосовує збіги різних правил разом", () => {
    const src = "мама  -  це все";
    const matches = runRules(src, [collapse, dash]);
    const out = rewrite(src, matches);
    expect(out).not.toContain("  ");
  });

  it("відкидає збіг, що перетинається з уже прийнятим", () => {
    const a = regexRule({ id: "a", title: "a", confidence: "high", find: /аб/gu, replace: "X" });
    const b = regexRule({ id: "b", title: "b", confidence: "high", find: /бв/gu, replace: "Y" });
    const src = "абв";
    const out = rewrite(src, runRules(src, [a, b]));
    // Перше правило виграє; друге відкидається, бо перетинається.
    expect(out).toBe("Xв");
  });

  it("на порожньому списку збігів повертає текст незмінним", () => {
    expect(rewrite("текст", [])).toBe("текст");
  });
});

describe("groupByRule", () => {
  it("групує за правилом і рахує всі збіги", () => {
    const src = "а  б   в    г";
    const g = groupByRule(runRules(src, [collapse]));
    expect(g).toHaveLength(1);
    expect(g[0]!.total).toBe(3);
  });

  it("показує обмежену вибірку, але повну кількість", () => {
    const src = "а  б  в  г  д  е  ж  з  и  к  л  м";
    const g = groupByRule(runRules(src, [collapse]), 3);
    expect(g[0]!.samples).toHaveLength(3);
    expect(g[0]!.total).toBeGreaterThan(3);
  });

  it("виносить сумнівні окремо і не рахує їх у вибірці", () => {
    const rule = regexRule({
      id: "r",
      title: "t",
      confidence: "high",
      find: /-/gu,
      replace: "—",
      review: (m, text) => /\d/u.test(text[m.start - 1] ?? ""),
    });
    const g = groupByRule(runRules("1-2 а-б в-г", [rule]));
    expect(g[0]!.needsReview).toHaveLength(1);
    expect(g[0]!.samples.every((s) => s.confidence === "high")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { rangeDashRule, zoneSeparatorRule } from "../../src/bibliography/rules-dstu.js";
import { parseRecord } from "../../src/bibliography/parse.js";
import type { BibRecord } from "../../src/bibliography/types.js";

const rec = (text: string): BibRecord => ({
  number: 50, text, containerId: "story:0", start: 100, end: 100 + text.length, page: "20",
});
const parse = (t: string) => parseRecord(rec(t));

const BASE =
  "50. Прізвище, Ім'я По батькові. Назва / І. П. Прізвище // Журнал";

describe("zoneSeparatorRule", () => {
  it("за 7.1 ловить дефіс замість тире", () => {
    const f = zoneSeparatorRule.check(parse(`${BASE}. - 2024. - С. 5-9.`), "7.1");
    expect(f.length).toBeGreaterThan(0);
    expect(f[0]?.suggested).toBe(". – ");
    expect(f[0]?.recordNumber).toBe(50);
    /* Офсети — у тексті КОНТЕЙНЕРА, тому зсунуті на record.start = 100. */
    expect(f[0]?.start).toBeGreaterThanOrEqual(100);
  });

  it("за 7.1 мовчить на правильному тире", () => {
    expect(zoneSeparatorRule.check(parse(`${BASE}. – 2024. – С. 5-9.`), "7.1")).toEqual([]);
  });

  it("довге тире U+2014 — ПОМИЛКА, а не варіант", () => {
    /* Саме цей знак поставив би dash-separator із typography_apply (спек §0.2). */
    const f = zoneSeparatorRule.check(parse(`${BASE}. — 2024. — С. 5-9.`), "7.1");
    expect(f.length).toBeGreaterThan(0);
  });

  it("за 8302 вимагає крапку, а не крапку з тире", () => {
    const f = zoneSeparatorRule.check(parse(`${BASE}. – 2024. – С. 5-9.`), "8302");
    expect(f.length).toBeGreaterThan(0);
    expect(f[0]?.suggested).toBe(". ");
  });

  it("НЕ чіпає граматичне тире", () => {
    const t = `50. Любовець, Н. І. Традиція (ХІІ ст. – перша третина ХХ ст.) / Н. І. Любовець // Вісник. – 2024. – С. 5-9.`;
    expect(zoneSeparatorRule.check(parse(t), "7.1")).toEqual([]);
  });

  it("підстава знахідки залежить від стандарту, а не завжди цитує 7.1", () => {
    const f71 = zoneSeparatorRule.check(parse(`${BASE}. - 2024. - С. 5-9.`), "7.1")[0];
    const f8302 = zoneSeparatorRule.check(parse(`${BASE}. – 2024. – С. 5-9.`), "8302")[0];
    expect(f71?.basis).toContain("7.1");
    expect(f8302?.basis).toContain("8302");
    expect(f8302?.basis).not.toContain("7.1");
  });

  it("НЕ чіпає «.-» у складних скороченнях", () => {
    /*
     * Спек §10.9: на двох випусках серії 394 і 395 таких збігів, і ВСІ законні
     * за ДСТУ 3582 — наук.-практ., іст.-краєзн., авт.-упоряд.
     */
    const t = `50. Прізвище, Ім'я. Назва : зб. матеріалів наук.-практ. конф. / авт.-упоряд. І. П. Прізвище // Вісник іст.-краєзн. т-ва. – 2024. – С. 5-9.`;
    expect(zoneSeparatorRule.check(parse(t), "7.1")).toEqual([]);
  });
});

describe("rangeDashRule", () => {
  it("ловить дефіс у діапазоні сторінок", () => {
    const f = rangeDashRule.check(parse(`${BASE}. – 2024. – С. 68-74.`), "7.1");
    expect(f).toHaveLength(1);
    expect(f[0]?.before).toBe("-");
  });

  it("ловить figure dash U+2012 і мінус U+2212, а не лише дефіс", () => {
    /* Виміряно на випусках 2022/2023: 1920‒1930-х, 1914−1923. */
    const a = rangeDashRule.check(parse(`${BASE}. – 2024. – С. 68‒74.`), "7.1");
    const b = rangeDashRule.check(parse(`${BASE}. – 2024. – С. 68−74.`), "7.1");
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it("мовчить на правильному короткому тире", () => {
    expect(rangeDashRule.check(parse(`${BASE}. – 2024. – С. 68–74.`), "7.1")).toEqual([]);
  });
});

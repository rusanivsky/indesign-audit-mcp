import { describe, expect, it } from "vitest";
import type { BibRecord } from "../../src/bibliography/types.js";
import { parseChicago } from "../../src/bibliography/parse-chicago.js";
import { CHICAGO_RULES } from "../../src/bibliography/rules-chicago.js";
import { CIP_CORRECT, CIP_RECORD } from "./fixtures/chicago-cip.js";

const rec = (text: string): BibRecord => ({
  number: 1,
  text,
  containerId: "story:245",
  start: 0,
  end: text.length,
  page: "4",
});

const run = (text: string, id: string) =>
  CHICAGO_RULES.filter((r) => r.id === id).flatMap((r) => r.check(parseChicago(rec(text))));

describe("правила Chicago, що потребують рішення людини", () => {
  it("chicago-extent НІКОЛИ не буває high", () => {
    /*
     * Chicago не має зони обсягу, але CIP-блок її законно має, і тут значення
     * навіть не число: це маркер номера сторінки U+0018, що складається у
     * «196». Видалити його автоматично означає знищити живий маркер.
     */
    const f = run(CIP_RECORD, "chicago-extent");
    expect(f).toHaveLength(1);
    expect(f[0]?.confidence).toBe("needs-review");
    expect(f[0]?.before).toBe("\u0018 p.");
  });

  it("chicago-publisher-caps НІКОЛИ не буває high", () => {
    /*
     * Ворота «зразок ≠ ужиток». У копірайті поруч стоїть та сама назва з
     * версалкою й знаком торговельної марки — це власна форма видавництва, а
     * не хиба набору.
     */
    const f = run(CIP_RECORD, "chicago-publisher-caps");
    expect(f).toHaveLength(1);
    expect(f[0]?.confidence).toBe("needs-review");
    expect(f[0]?.before).toBe("PUBLISHER");
    expect(f[0]?.suggested).toBe("Publisher");
  });

  it("видавець із однією великою літерою не є знахідкою", () => {
    expect(run(CIP_CORRECT, "chicago-publisher-caps")).toEqual([]);
  });

  it("абревіатура у назві видавця не робить її версалкою", () => {
    /* «MIT Press» — слово з великих літер поруч зі звичайним. Не домашній стиль. */
    const mit = "Surname, Firstname. Title. City: MIT Press, 2026.";
    expect(run(mit, "chicago-publisher-caps")).toEqual([]);
  });

  it("однолітерна назва не вважається версалкою", () => {
    /* `[A-Z]` сам по собі — ініціал чи літера, а не набір великими. */
    const single = "Surname, Firstname. Title. City: X, 2026.";
    expect(run(single, "chicago-publisher-caps")).toEqual([]);
  });

  it("жодне needs-review правило не потрапляє в набір high", () => {
    const all = CHICAGO_RULES.flatMap((r) => r.check(parseChicago(rec(CIP_RECORD))));
    const review = all
      .filter((f) => f.confidence === "needs-review")
      .map((f) => f.ruleId)
      .sort();
    expect(review).toEqual(["chicago-extent", "chicago-publisher-caps"]);
  });

  it("правильний запис і далі не дає ЖОДНОЇ знахідки, з усіма шістьма правилами", () => {
    const all = CHICAGO_RULES.flatMap((r) => r.check(parseChicago(rec(CIP_CORRECT))));
    expect(all.map((f) => f.ruleId)).toEqual([]);
  });
});

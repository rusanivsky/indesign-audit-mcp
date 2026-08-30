import { describe, expect, it } from "vitest";
import { loadJsxPagination } from "./helpers/load-jsx-pagination.js";

/**
 * ВОРОТА НА НЕВІДОМИЙ КЛЮЧ (§2.3 передачі).
 *
 * ІНЦИДЕНТ. `fc8f96d` перейменував `folioStyle` (рядок) на `folioStyles`
 * (масив). Викликач зі старим ключем отримував не помилку, а ПОРОЖНІЙ ЗВІТ:
 * `wantFolio` порожній → `declared` порожній → `missingStyles` порожній →
 * гейт `missingStyles.length > 0` не горить → `folioFrames: []` →
 * `checked: 0, deviating: 0`. Читається як «усе чисто».
 *
 * ЧОМУ НЕ «КИДАТИ НА ПОРОЖНЬОМУ МАСИВІ», ЯК ПРОСИЛА РЕЦЕНЗІЯ. Порожній масив —
 * ЗАКОННЕ значення: `src/tools/pagination.ts:715` шле `folioArg?.styleNames ??
 * []` саме тоді, коли родину `folio` не оголошено взагалі. Відмова на `[]`
 * поклала б `pagination_audit` на кожному виданні без колонцифр. Два випадки
 * розрізняє не порожнеча, а САМ КЛЮЧ — тому ворота тут, а не там.
 */
const ВІДОМІ = [
  "folioStyles",
  "contentsNumberStyle",
  "contentsTitleStyles",
  "headingStyles",
  "runningHeadStyles",
];

describe("IDMCP.rejectUnknownParams", () => {
  it("стара однина `folioStyle` — ГУЧНА відмова, і ключ названо", () => {
    const IDMCP = loadJsxPagination();
    expect(() =>
      IDMCP.rejectUnknownParams("pagination_measure", { folioStyle: "Kolontsyfra" }, ВІДОМІ),
    ).toThrow(/folioStyle/);
  });

  it("відмова називає і те, що приймається — інакше вона не вчить", () => {
    const IDMCP = loadJsxPagination();
    try {
      IDMCP.rejectUnknownParams("pagination_measure", { styleName: "X" }, ВІДОМІ);
      expect.unreachable("мала бути відмова");
    } catch (e) {
      const текст = String((e as Error).message);
      expect(текст).toMatch(/styleName/);
      expect(текст).toMatch(/folioStyles/);
      expect(текст).toMatch(/pagination_measure/);
      /* І чому це взагалі помилка, а не дрібниця. */
      expect(текст).toMatch(/clean/);
    }
  });

  it("ПОРОЖНІЙ масив проходить — це «родину не питали», а не помилка", () => {
    /* Негативний контроль до §2.3: саме тут рецензія хотіла відмову, і саме
     * ця відмова зламала б інструмент. */
    const IDMCP = loadJsxPagination();
    expect(() =>
      IDMCP.rejectUnknownParams(
        "pagination_measure",
        { folioStyles: [], contentsNumberStyle: null, contentsTitleStyles: [], headingStyles: [] },
        ВІДОМІ,
      ),
    ).not.toThrow();
  });

  it("повний чинний набір ключів проходить", () => {
    const IDMCP = loadJsxPagination();
    expect(() =>
      IDMCP.rejectUnknownParams(
        "pagination_measure",
        {
          folioStyles: ["Нумерація L", "Нумерація R"],
          contentsNumberStyle: null,
          contentsTitleStyles: [],
          headingStyles: ["Розділ"],
          runningHeadStyles: ["Колонтитул"],
        },
        ВІДОМІ,
      ),
    ).not.toThrow();
  });

  it("кілька невідомих одразу — усі в одному повідомленні", () => {
    const IDMCP = loadJsxPagination();
    try {
      IDMCP.rejectUnknownParams("pagination_measure", { folioStyle: "A", styles: ["B"] }, ВІДОМІ);
      expect.unreachable("мала бути відмова");
    } catch (e) {
      const текст = String((e as Error).message);
      expect(текст).toMatch(/folioStyle/);
      expect(текст).toMatch(/styles/);
    }
  });

  it("null і undefined params не кидають — «параметрів немає» це не помилка", () => {
    const IDMCP = loadJsxPagination();
    expect(() => IDMCP.rejectUnknownParams("x", null, ВІДОМІ)).not.toThrow();
    expect(() => IDMCP.rejectUnknownParams("x", undefined, ВІДОМІ)).not.toThrow();
  });

  it("успадкований ЕНУМЕРОВНИЙ ключ воротами НЕ рахується", () => {
    /*
     * ЦЕЙ ТЕСТ ПЕРЕПИСАНО ПІСЛЯ МУТАНТА, І САМЕ ЦЕ В НЬОМУ ГОЛОВНЕ.
     *
     * Перша редакція подавала звичайний літерал `{ folioStyles: [] }` і
     * стверджувала, що перевіряє пастку прототипу. Мутант «прибрати
     * `IDMCP.hasOwn`» її ПЕРЕЖИВ — бо в літерала успадкованих ЕНУМЕРОВНИХ
     * властивостей немає взагалі (`Object.prototype` весь неенумеровний), тож
     * `for…in` їх не віддає й без жодного захисту. Тест був зеленим і не
     * перевіряв нічого.
     *
     * Щоб пастка справді спрацювала, потрібен об'єкт, який УСПАДКОВУЄ
     * енумеровний ключ. Тоді без `hasOwn` цей ключ потрапляє в `unknown` і
     * ворота відмовляють на параметрі, якого викликач не передавав.
     *
     * Чи досяжне це в бойовому шляху? `params` приходить із `JSON.parse`,
     * тобто плоским об'єктом — ні. Захист лишається СВІДОМО оборонним, і
     * тепер це записано, а не мається на увазі.
     */
    const IDMCP = loadJsxPagination();
    function База(this: Record<string, unknown>) {}
    База.prototype.folioStyle = "Kolontsyfra";
    const params = new (База as unknown as new () => Record<string, unknown>)();
    params.folioStyles = ["Нумерація L"];

    /* Контроль приладу: ключ справді видно через for…in. */
    const видно: string[] = [];
    for (const k in params) видно.push(k);
    expect(видно).toContain("folioStyle");

    expect(() => IDMCP.rejectUnknownParams("pagination_measure", params, ВІДОМІ)).not.toThrow();
  });
});

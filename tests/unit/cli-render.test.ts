// tests/unit/cli-render.test.ts
import { describe, expect, it } from "vitest";
import { bi } from "../../src/cli/report/i18n.js";
import { dataKey, escapeHtml, renderRows } from "../../src/cli/report/render.js";

describe("escapeHtml", () => {
  it("знешкоджує кутові дужки з назв стилів", () => {
    expect(escapeHtml('Стиль <b> "лапка"')).toBe("Стиль &lt;b&gt; &quot;лапка&quot;");
  });

  it("не чіпає звичайного українського тексту", () => {
    expect(escapeHtml("Назва розділу")).toBe("Назва розділу");
  });

  it("екранує амперсанд ПЕРШИМ, інакше подвійне екранування", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });
});

describe("dataKey", () => {
  it("родина плюс номер", () => {
    expect(dataKey("color", 1)).toBe("color-1");
  });
});

describe("renderRows", () => {
  const рядки = [
    {
      pages: ["24", "67"],
      what: bi("Лапки не ті", "Wrong quotation marks"),
      evidence: bi("8 випадків", "8 occurrences"),
      fix: bi("Замінити", "Replace"),
    },
    {
      pages: ["149"],
      what: bi("Пробіл перед розривом", "Space before the break"),
      evidence: bi("1", "1"),
      fix: bi("Прибрати", "Remove"),
    },
  ];

  it("data-k унікальний у межах родини", () => {
    const html = renderRows("typography", рядки);
    const ключі = [...html.matchAll(/data-k="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ключі).size).toBe(ключі.length);
  });

  it("кожен рядок несе сторінки, доказ і дію", () => {
    const html = renderRows("typography", рядки);
    expect(html).toMatch(/24/);
    expect(html).toMatch(/8 випадків/);
    expect(html).toMatch(/Замінити/);
  });

  /*
   * Обидві мови їдуть у РОЗМІТКУ, а не підставляються скриптом: звіт,
   * відкритий без JavaScript або збережений друкарнею в PDF, мусить
   * лишитись читним. Видимий текст — українська (звіт відкривається нею),
   * англійська чекає в data-en.
   */
  it("несе ОБИДВІ мови: видима українська, англійська в data-en", () => {
    const html = renderRows("typography", рядки);
    expect(html).toMatch(/data-uk="Лапки не ті"/);
    expect(html).toMatch(/data-en="Wrong quotation marks"/);
    expect(html).toMatch(/>Лапки не ті</);
    expect(html).not.toMatch(/>Wrong quotation marks</);
  });

  it("небезпечний вміст екранується в ОБОХ атрибутах, не лише у видимому тексті", () => {
    const html = renderRows("x", [
      { pages: ["1"], what: bi("<b>", "<b>"), evidence: bi('"', '"'), fix: bi("", "") },
    ]);
    expect(html).not.toMatch(/data-uk="<b>"/);
    expect(html).toMatch(/data-uk="&lt;b&gt;"/);
    expect(html).toMatch(/data-en="&lt;b&gt;"/);
    expect(html).toMatch(/data-uk="&quot;"/);
  });

  it("небезпечний вміст із макета не ламає розмітки", () => {
    const html = renderRows("x", [
      { pages: ["1"], what: bi("<script>alert(1)</script>", "<script>alert(1)</script>"), evidence: bi("", ""), fix: bi("", "") },
    ]);
    expect(html).not.toMatch(/<script>alert/);
    expect(html).toMatch(/&lt;script&gt;/);
  });

  /*
   * R14 (рулінг координатора, ledger 2026-08-16): «Код стану» в
   * report.html пакує чекбокси ПОЗИЦІЙНО — за порядком DOM
   * (querySelectorAll), а не за data-k. Якщо два рендери тих самих
   * вимірів дадуть однакову кількість рядків у різному порядку, перенесене
   * зі стану позначення мовчки прив'яжеться не до тих пунктів.
   *
   * Тому: порядок рядків мусить бути стабільним для тих самих даних —
   * два виклики renderRows на тому самому вході дають ІДЕНТИЧНУ
   * послідовність data-k.
   */
  it("R14: два рендери тих самих даних дають ІДЕНТИЧНУ послідовність data-k", () => {
    const html1 = renderRows("typography", рядки);
    const html2 = renderRows("typography", рядки);
    const ключі1 = [...html1.matchAll(/data-k="([^"]+)"/g)].map((m) => m[1]);
    const ключі2 = [...html2.matchAll(/data-k="([^"]+)"/g)].map((m) => m[1]);
    expect(ключі2).toEqual(ключі1);
  });
});

/*
 * ЕКРАНУВАННЯ АПОСТРОФА — доти без жодного тесту.
 *
 * Проба 2026-08-26: рядок `.replace(/'/g, "&#39;")` можна було прибрати, і
 * ввесь набір лишався зеленим, тоді як прибирання сусіднього `"` ловилося
 * трьома тестами. У звіт потрапляє текст із макета — назви стилів і цитати, —
 * а українська типографіка рясніє апострофами.
 */
describe("escapeHtml — усі п'ять символів", () => {
  it.each([
    ["&", "&amp;"],
    ["<", "&lt;"],
    [">", "&gt;"],
    ['"', "&quot;"],
    ["'", "&#39;"],
  ])("екранує %s", (ch, expected) => {
    expect(escapeHtml(ch)).toBe(expected);
  });

  it("апостроф у справжній назві стилю", () => {
    expect(escapeHtml("Мар'яна")).toBe("Мар&#39;яна");
  });

  it("НЕГАТИВНИЙ КОНТРОЛЬ: звичайний текст не чіпається", () => {
    expect(escapeHtml("Розділ 3 — початок")).toBe("Розділ 3 — початок");
  });
});

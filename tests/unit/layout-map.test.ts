import { describe, expect, it } from "vitest";
import { buildMap } from "../../src/layout/map.js";
import type { LayoutMeasure } from "../../src/layout/types.js";
import { page, paragraph } from "./helpers/layout.js";

function measure(over: Partial<LayoutMeasure> = {}): LayoutMeasure {
  return {
    docName: "test.indd",
    pages: [page({ name: "1" })],
    spreads: [{ index: 0, pages: ["1"], pasteboardItems: 0 }],
    stories: [{ containerId: "story:0", characters: 100, frames: 1, overflows: false }],
    frames: [],
    paragraphs: [],
    measurementUnit: "POINTS",
    ...over,
  };
}

describe("інвентар стилів", () => {
  it("рахує абзаци кожного стилю й називає сторінки вжитку", () => {
    /* Різні стилі МУСЯТЬ мати різний styleId (I-4, рецензія кола 1) —
     * інакше «Osnovnyi» і «Zaholovok» злилися б в один запис інвентарю
     * під замовчуванням `paragraph()`, рівно той дефект, заради якого
     * зроблена Задача 12. */
    const m = measure({
      paragraphs: [
        paragraph({ index: 0, style: "Osnovnyi", page: "1" }),
        paragraph({ index: 1, style: "Osnovnyi", page: "2" }),
        paragraph({ index: 2, style: "Zaholovok", page: "1", styleId: "200" }),
      ],
    });
    const map = buildMap(m);
    const osnovnyi = map.styleInventory.find((s) => s.styleName === "Osnovnyi");
    expect(osnovnyi?.paragraphs).toBe(2);
    expect(osnovnyi?.pages).toEqual(["1", "2"]);
  });

  it(
    "два стилі з ОДНАКОВОЮ назвою й різними styleId НЕ зливаються в один запис " +
      "(I-4, рецензія кола 1: buildMap раніше ключувався styleName)",
    () => {
      const m = measure({
        paragraphs: [
          paragraph({ index: 0, style: "Однакова назва", styleId: "100", page: "1" }),
          paragraph({ index: 1, style: "Однакова назва", styleId: "200", page: "1" }),
        ],
      });
      const map = buildMap(m);
      const rows = map.styleInventory.filter((s) => s.styleName === "Однакова назва");
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.styleId).sort()).toEqual(["100", "200"]);
      expect(rows.every((r) => r.paragraphs === 1)).toBe(true);
    },
  );

  it("збирає pointSizes включно з null для мішаного кеглю", () => {
    const m = measure({
      paragraphs: [
        paragraph({ index: 0, style: "Osnovnyi", actual: { pointSize: 11 } }),
        paragraph({ index: 1, style: "Osnovnyi", actual: { pointSize: null } }),
        paragraph({ index: 2, style: "Osnovnyi", actual: { pointSize: 12 } }),
      ],
    });
    const map = buildMap(m);
    const osnovnyi = map.styleInventory.find((s) => s.styleName === "Osnovnyi");
    expect(osnovnyi?.pointSizes).toContain(11);
    expect(osnovnyi?.pointSizes).toContain(null);
    expect(osnovnyi?.pointSizes).toContain(12);
    expect(osnovnyi?.pointSizes).toHaveLength(3);
  });

  it("дедублює сторінки: два абзаци одного стилю на одній сторінці мають один запис у pages", () => {
    const m = measure({
      paragraphs: [
        paragraph({ index: 0, style: "Osnovnyi", page: "1" }),
        paragraph({ index: 1, style: "Osnovnyi", page: "1" }),
      ],
    });
    const map = buildMap(m);
    const osnovnyi = map.styleInventory.find((s) => s.styleName === "Osnovnyi");
    expect(osnovnyi?.paragraphs).toBe(2);
    expect(osnovnyi?.pages).toEqual(["1"]);
  });
});

describe("дерево заголовків", () => {
  it("без headingStyles дерева немає — лише інвентар", () => {
    const m = measure({ paragraphs: [paragraph({ style: "Rozdil" })] });
    expect(buildMap(m).headings).toBeNull();
  });

  it("рівень визначає ПОЗИЦІЯ стилю в headingStyles, а не назва й не кегль", () => {
    const m = measure({
      paragraphs: [
        paragraph({ index: 0, style: "Pidrozdil", preview: "Pidrozdil A", page: "1" }),
        paragraph({ index: 1, style: "Rozdil", preview: "Rozdil Odyn", page: "2" }),
      ],
    });
    const map = buildMap(m, ["Rozdil", "Pidrozdil"]);
    expect(map.headings).toEqual([
      { level: 1, styleName: "Pidrozdil", styleId: "100", text: "Pidrozdil A", page: "1", containerId: "story:0", paragraphIndex: 0 },
      { level: 0, styleName: "Rozdil", styleId: "100", text: "Rozdil Odyn", page: "2", containerId: "story:0", paragraphIndex: 1 },
    ]);
  });

  it("стиль поза headingStyles у дерево не потрапляє", () => {
    const m = measure({
      paragraphs: [paragraph({ style: "Osnovnyi" }), paragraph({ index: 1, style: "Rozdil" })],
    });
    expect(buildMap(m, ["Rozdil"]).headings).toHaveLength(1);
  });

  it("рівень — точний indexOf, а не пошук за підрядком: стиль RozdilPidrozdil не матчить Rozdil на позиції 0", () => {
    const m = measure({
      paragraphs: [
        paragraph({ index: 0, style: "Rozdil", preview: "Rozdil Odyn", page: "1" }),
        paragraph({ index: 1, style: "RozdilPidrozdil", preview: "RozdilPidrozdil Text", page: "2" }),
      ],
    });
    const map = buildMap(m, ["Rozdil", "RozdilPidrozdil"]);
    expect(map.headings).toHaveLength(2);
    expect(map.headings?.[0]).toEqual({
      level: 0,
      styleName: "Rozdil",
      styleId: "100",
      text: "Rozdil Odyn",
      page: "1",
      containerId: "story:0",
      paragraphIndex: 0,
    });
    expect(map.headings?.[1]).toEqual({
      level: 1,
      styleName: "RozdilPidrozdil",
      styleId: "100",
      text: "RozdilPidrozdil Text",
      page: "2",
      containerId: "story:0",
      paragraphIndex: 1,
    });
  });

  /*
   * Остання незакрита ділянка міграції на `.id` (final review, minor):
   * `styleInventory` ключується `.id` ще з рецензії кола 1 (I-4), а
   * `headingStyles` зіставлявся ЛИШЕ з назвою. Два різні стилі з однією
   * назвою — виміряна ситуація робочої книжки («Основний текст L» у двох
   * теках), — і назва тоді бере абзаци обох.
   */
  it("назва, спільна для двох РІЗНИХ стилів, бере абзаци обох — і styleId каже, які саме", () => {
    const m = measure({
      paragraphs: [
        paragraph({ index: 0, style: "Rozdil", styleId: "100", preview: "Zhyvyi", page: "1" }),
        paragraph({ index: 1, style: "Rozdil", styleId: "200", preview: "Dviinyk", page: "2" }),
      ],
    });
    const map = buildMap(m, ["Rozdil"]);
    expect(map.headings).toHaveLength(2);
    expect(map.headings?.map((h) => h.styleId)).toEqual(["100", "200"]);
  });

  it("той самий випадок, названий через .id, бере РІВНО один стиль", () => {
    /* Точний спосіб, заради якого поле й приймається. Тест червоніє, якщо
     * зіставлення за `.id` прибрати: лишиться іменне, і знайдеться 0 (бо
     * жоден styleName не дорівнює "200"), а не 1. */
    const m = measure({
      paragraphs: [
        paragraph({ index: 0, style: "Rozdil", styleId: "100", preview: "Zhyvyi", page: "1" }),
        paragraph({ index: 1, style: "Rozdil", styleId: "200", preview: "Dviinyk", page: "2" }),
      ],
    });
    const map = buildMap(m, ["200"]);
    expect(map.headings).toHaveLength(1);
    expect(map.headings?.[0]).toMatchObject({ level: 0, styleId: "200", text: "Dviinyk" });
  });

  it(".id перевіряється ПЕРШИМ — коли той самий абзац збігається обома ключами на РІЗНИХ рівнях", () => {
    /*
     * Патологічний, але можливий документ: у стилю «Rozdil» `.id` дорівнює
     * «200», а в документі є ще й стиль, НАЗВАНИЙ «200». Оператор перелічує
     * обидва, і вони опиняються на різних рівнях.
     *
     * ЛИШЕ ця форма розрізняє порядок перевірки. Перша редакція тесту брала
     * `headingStyles: ["200"]` — один елемент, тож обидва порядки давали
     * level 0, і мутант «назву першою» ВИЖИВ (прогнано, виявлено, форму
     * змінено). Тут `.id` стоїть на позиції 0, назва — на позиції 1, тож
     * відповідь відрізняється: 0 проти 1.
     *
     * Чому виграє `.id`: він точний і однозначний, назва — лише підказка.
     * Якщо оператор виписав саме ідентифікатор, він мав на увазі його.
     */
    const m = measure({
      paragraphs: [paragraph({ index: 0, style: "Rozdil", styleId: "200", preview: "Ident", page: "1" })],
    });
    const map = buildMap(m, ["200", "Rozdil"]);
    expect(map.headings).toHaveLength(1);
    expect(map.headings?.[0]!.level).toBe(0);
  });
});

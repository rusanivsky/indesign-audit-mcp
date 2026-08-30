import { describe, expect, it } from "vitest";
import { detectAnchorGeometry, inventoryAnchored } from "../../src/geometry/anchored.js";
import type { ItemMeasure, PageMeasure } from "../../src/geometry/types.js";

/**
 * Verso робочої книжки. `inside` = 79,37, `outside` = 90,71 — НА ОБОХ
 * сторонах однаково: виміряно 2026-08-15, `marginPreferences.left` є
 * внутрішнім полем і на recto, і на verso, обробник місцями їх не міняє.
 *
 * До 2026-08-15 тут стояло дзеркально (inside 90,71 / outside 79,37) —
 * числа книжки в ПЕРЕСТАВЛЕНИХ ролях, тобто сторінка, якої обробник видати
 * не може. Ліва межа колонки на цій verso = outside = 90,7087, і це рівно
 * те, що дає книжка (виміряно: 119 verso-рамок починаються від 90,7087,
 * нуль — від 79,3701).
 */
function page(): PageMeasure {
  return {
    name: "8", side: "left", width: 538.58, height: 623.62,
    margins: { top: 51, bottom: 60, inside: 79.37, outside: 90.71, columnCount: 1, columnGutter: 12 },
    bleed: { top: 8.5, bottom: 8.5, inside: 0, outside: 8.5 },
  };
}

function anchored(over: Partial<ItemMeasure>): ItemMeasure {
  return {
    itemId: 1, page: "8", side: "left", type: "TextFrame", parentKind: "Character",
    anchored: true, inGroup: false, layer: "Шар 1", layerVisible: true,
    layerPrintable: true, locked: false, rotation: 0,
    bounds: [88.9, 413.15, 108.9, 441.5], wrapMode: "NONE", wrapOffsets: null,
    anchorStyle: "Нумерація питань", graphic: null,
    ...over,
  };
}

describe("inventoryAnchored", () => {
  it("розділяє популяції за стилем — їх ТРИ, не одна", () => {
    /* Виміряно H13: 185 «Нумерація питань», 35 «Зміст Номер сторінки»,
     * 82 GraphicLine без стилю. Спільного правила в них нема. */
    const rows = inventoryAnchored([
      anchored({}),
      anchored({ itemId: 2, anchorStyle: "Зміст Номер сторінки" }),
      anchored({ itemId: 3, type: "GraphicLine", anchorStyle: null, bounds: [0, 0, 0, 340.2] }),
    ]);
    expect(rows).toHaveLength(3);
  });

  it("лінійка нульової висоти не ламає інвентар", () => {
    /* 82 з 303 прив'язаних книжки мають висоту РІВНО 0. Будь-яка перевірка,
     * що ділить на висоту, ламається саме тут. */
    const rows = inventoryAnchored([
      anchored({ type: "GraphicLine", anchorStyle: null, bounds: [0, 0, 0, 340.2] }),
    ]);
    expect(rows[0]!.count).toBe(1);
    expect(Number.isFinite(rows[0]!.sampleHeight)).toBe(true);
  });

  it("не-прив'язані елементи в інвентар не потрапляють", () => {
    expect(inventoryAnchored([anchored({ anchored: false })])).toHaveLength(0);
  });

  it("той самий стиль, різний тип конструктора — різні популяції", () => {
    /* Мутант, що прибере тип із ключа групування, звів би цю пару в одну
     * популяцію: TextFrame і GraphicLine з однаковим anchorStyle — це різні
     * речі, і звіт не має їх зливати. */
    const rows = inventoryAnchored([
      anchored({ itemId: 1, anchorStyle: "Той самий стиль", type: "TextFrame" }),
      anchored({ itemId: 2, anchorStyle: "Той самий стиль", type: "GraphicLine" }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.type).sort()).toEqual(["GraphicLine", "TextFrame"]);
  });
});

describe("detectAnchorGeometry", () => {
  it("без названого правила НЕ виносить жодного вироку", () => {
    /* Рішення користувача: голий параметр без замовчувань. Правило цієї
     * книжки в код не потрапляє. */
    expect(detectAnchorGeometry([anchored({})], [page()], undefined)).toHaveLength(0);
  });

  it("з названим правилом знаходить порушника", () => {
    const rule = { style: "Нумерація питань", edge: "right" as const, alignsTo: "column-start" as const };
    /* Ліва межа колонки на verso = outside = 90.71. Права межа рамки 441.5
     * від неї далеко — порушення. */
    const found = detectAnchorGeometry([anchored({})], [page()], rule);
    expect(found).toHaveLength(1);
    expect(found[0]!.defect).toBe("anchor-geometry");
  });

  it("з названим правилом мовчить про рамку, що правилу відповідає", () => {
    const rule = { style: "Нумерація питань", edge: "right" as const, alignsTo: "column-start" as const };
    /* Права межа рамки пристала до лівої межі колонки verso — а це 90,71
     * (outside), не 79,37: саме те число, з якого починаються 119 із 142
     * виміряних рамок verso робочої книжки. */
    const good = anchored({ bounds: [88.9, 62.36, 108.9, 90.71] });
    expect(detectAnchorGeometry([good], [page()], rule)).toHaveLength(0);
  });

  it("правило стосується ЛИШЕ названої популяції", () => {
    const rule = { style: "Нумерація питань", edge: "right" as const, alignsTo: "column-start" as const };
    const other = anchored({ anchorStyle: "Зміст Номер сторінки" });
    expect(detectAnchorGeometry([other], [page()], rule)).toHaveLength(0);
  });
});

/*
 * ПРАВИЛО ЗОВНІШНЬОГО ПОЛЯ НА ОБОХ СТОРОНАХ РОЗВОРОТУ.
 *
 * `edge` і `alignsTo` описують СТОРІНКОВИЙ простір, тож одна пара фізично не
 * може виразити правило, прив'язане до зовнішнього поля: на парній сторінці
 * воно ліворуч, на непарній — праворуч. Канонічне правило робочої книжки
 * («номер питання висить у зовнішньому полі»), задане як
 * {edge:"right", alignsTo:"column-start"}, проходило на парних і давало
 * розбіжність у цілу ширину шпальти на КОЖНІЙ непарній — тобто пів книжки
 * хибних знахідок, і жодного способу висловити правило інакше.
 *
 * `mirrored: true` каже: пара названа ДЛЯ ПАРНОЇ сторінки, на непарній обидва
 * боки міняються місцями (зміряно: columnEdges дає [40,320] на парній і
 * [80,360] на непарній).
 */
describe("дзеркалення правила на розвороті", () => {
  /* Симетричний макет: поля однакові, тож числа однієї сторони прямо
   * порівнянні з числами другої. */
  const сторінка = (name: string, side: "left" | "right"): PageMeasure => ({
    name, side, width: 400, height: 600,
    margins: { top: 40, bottom: 40, inside: 80, outside: 40, columnCount: 1, columnGutter: 12 },
    bleed: { top: 8, bottom: 8, inside: 0, outside: 8 },
  });

  /* typeArea для цього макета: x1 = 80, x2 = 400 − 40 = 360 на recto;
   * на verso дзеркально — x1 = 40, x2 = 320. */
  const рамка = (page: string, side: "left" | "right", x1: number, x2: number): ItemMeasure =>
    anchored({ page, side, bounds: [100, x1, 120, x2] });

  const правило = (mirrored: boolean) =>
    ({ style: "Нумерація питань", edge: "right", alignsTo: "column-start", mirrored }) as const;

  it("БЕЗ дзеркала непарна сторінка дає хибну знахідку в цілу шпальту", () => {
    /* Номер у зовнішньому полі recto: він ПРАВОРУЧ від шпальти, тобто його
     * лівий край лежить на правому краї шпальти (360). Правило, назване для
     * verso, шукає його ПРАВИЙ край на ЛІВОМУ краї (80). */
    const items = [рамка("9", "right", 360, 390)];
    const r = detectAnchorGeometry(items, [сторінка("9", "right")], правило(false));
    expect(r.length).toBeGreaterThan(0);
  });

  it("З дзеркалом та сама сторінка знахідки не дає", () => {
    const items = [рамка("9", "right", 360, 390)];
    const r = detectAnchorGeometry(items, [сторінка("9", "right")], правило(true));
    expect(r).toEqual([]);
  });

  it("З дзеркалом парна сторінка теж не дає — а правило те саме", () => {
    /* Номер у зовнішньому полі verso: він ЛІВОРУЧ від шпальти, його правий
     * край лежить на лівому краї шпальти (40). */
    const items = [рамка("8", "left", 10, 40)];
    const r = detectAnchorGeometry(items, [сторінка("8", "left")], правило(true));
    expect(r).toEqual([]);
  });

  it("НЕГАТИВНИЙ КОНТРОЛЬ: справді зсунуту рамку дзеркало не ховає", () => {
    /* Інакше mirrored став би способом вимкнути родину. */
    const items = [рамка("8", "left", 10, 95)];
    const r = detectAnchorGeometry(items, [сторінка("8", "left")], правило(true));
    expect(r.length).toBeGreaterThan(0);
  });

  it("замовчування — БЕЗ дзеркала: наявні виклики поведінки не міняють", () => {
    const без = detectAnchorGeometry(
      [рамка("9", "right", 360, 390)],
      [сторінка("9", "right")],
      { style: "Нумерація питань", edge: "right", alignsTo: "column-start" },
    );
    const явно = detectAnchorGeometry(
      [рамка("9", "right", 360, 390)],
      [сторінка("9", "right")],
      правило(false),
    );
    expect(без).toEqual(явно);
  });
});

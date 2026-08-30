import { describe, expect, it } from "vitest";
import { bleedBox, columnEdges, pageBox, referenceEdges, typeArea } from "../../src/geometry/reference.js";
import type { PageMeasure } from "../../src/geometry/types.js";

/**
 * Числа — з виміру робочої книжки, щоб тест говорив про реальний документ.
 *
 * `inside`/`outside` ОДНАКОВІ на обох сторонах — і це не спрощення фікстури,
 * а виміряний факт (2026-08-15): `marginPreferences.left` = 79,3701 — це
 * внутрішнє поле на ОБОХ сторонах, `.right` = 90,7087 — зовнішнє, InDesign
 * місцями їх не міняє. До 2026-08-15 ця фікстура міняла їх сама й тим
 * зашивала у власний вхід ту саму помилку, яку мала ловити: обмін тут плюс
 * згортання в `typeArea()` давали тотожність, і `verso[1]` виходив 79,3701
 * замість 90,7087.
 */
function page(side: "left" | "right"): PageMeasure {
  return {
    name: side === "left" ? "8" : "9",
    side,
    width: 538.582677165354,
    height: 623.622047244095,
    margins: {
      top: 51.0236220472441,
      bottom: 60.5763779527559,
      inside: 79.3700787401575,
      outside: 90.7086614173228,
      columnCount: 1,
      columnGutter: 12,
    },
    bleed: { top: 8.50393700787402, bottom: 8.50393700787402, inside: 0, outside: 8.50393700787402 },
  };
}

/**
 * Фіктивна сторінка для тестування дедублікації через EPSILON.
 * Вильіт контролює відстань між межами, які можуть зливатися.
 */
function pageWithBleed(bleedTop: number): PageMeasure {
  return {
    name: "test",
    side: "right",
    width: 100,
    height: 100,
    margins: {
      top: 10,
      bottom: 10,
      inside: 10,
      outside: 10,
      columnCount: 1,
      columnGutter: 0,
    },
    bleed: { top: bleedTop, bottom: 0, inside: 0, outside: 0 },
  };
}

describe("typeArea", () => {
  it("будується від (0,0) сторінки, а не від page.bounds", () => {
    /* Пастка H13: page.bounds recto починається з x = 538.58, і змішування
     * двох просторів дало 545 із 546 елементів «за полосою». */
    const a = typeArea(page("right"));
    expect(a[0]).toBeCloseTo(51.0236, 3);
    expect(a[1]).toBeGreaterThanOrEqual(0);
    expect(a[1]).toBeLessThan(538.6);
  });

  it("дзеркалить поля: inside на recto ліворуч, на verso праворуч", () => {
    const recto = typeArea(page("right"));
    const verso = typeArea(page("left"));
    const W = 538.582677165354;

    /* Числа звірені з книжкою (2026-08-15): найширша рамка основного тексту
     * починається на recto від 79,3701, на verso — від 90,7087, і симетрично
     * закінчується. Нуль контрприкладів на 196 сторінках. */
    expect(recto[1]).toBeCloseTo(79.3701, 3); // recto ліворуч — inside
    expect(verso[1]).toBeCloseTo(90.7087, 3); // verso ліворуч — outside
    expect(W - recto[3]).toBeCloseTo(90.7087, 3); // recto праворуч — outside
    expect(W - verso[3]).toBeCloseTo(79.3701, 3); // verso праворуч — inside

    /* НЕГАТИВНИЙ КОНТРОЛЬ до всіх чотирьох чисел вище: дзеркалення мусить
     * бути ВИДИМИМ. Якщо обмін повернути в geometry.jsx (композиція стане
     * тотожністю) або прибрати з typeArea(), сторони збіжаться — і саме цей
     * рядок почервоніє першим, ще до конкретних чисел. */
    expect(Math.abs(recto[1] - verso[1])).toBeCloseTo(11.3386, 3);
  });
});

describe("bleedBox", () => {
  it("береться з ОГОЛОШЕНОГО в документі вильоту, не з константи", () => {
    const b = bleedBox(page("left"));
    expect(b[0]).toBeCloseTo(-8.5039, 3);
    /* Зсередини виліт нульовий — виміряно H13. Плашка, що доходить рівно до
     * корінця, знахідкою бути не сміє. */
    expect(b[3]).toBeCloseTo(538.582677165354, 3);
  });
});

describe("columnEdges", () => {
  it("одна колонка дає дві межі", () => {
    expect(columnEdges(page("right"))).toHaveLength(2);
  });

  it("три колонки дають шість меж із урахуванням середника", () => {
    const p = page("right");
    p.margins.columnCount = 3;
    const edges = columnEdges(p);
    expect(edges).toHaveLength(6);
    /* Межі впорядковані й не повторюються. */
    expect([...edges].sort((a, b) => a - b)).toEqual(edges);
  });
});

describe("referenceEdges", () => {
  it("збирає межі полоси, колонок, аркуша й вильоту без дублікатів", () => {
    const r = referenceEdges(page("right"));
    expect(r.vertical.length).toBeGreaterThan(0);
    expect(new Set(r.vertical).size).toBe(r.vertical.length);
    expect(new Set(r.horizontal).size).toBe(r.horizontal.length);
  });

  it("дедублікує межи через EPSILON: вильіт 1e-5 дає менше меж, ніж 0.002", () => {
    /* Два варіанти однієї сторінки з різними вильотами:
     * - 1e-5: межа вильоту -1e-5 й межа аркуша 0 різняться на 1e-5 < EPSILON → зливаються
     * - 0.002: межа вильоту -0.002 й межа аркуша 0 різняться на 0.002 > EPSILON → не зливаються
     */
    const pSmall = pageWithBleed(1e-5);
    const pLarge = pageWithBleed(0.002);
    const rSmall = referenceEdges(pSmall);
    const rLarge = referenceEdges(pLarge);
    /* Без дедублікації обидва мали б 5 меж: -X, 0, 10, 90, 100
     * З дедублікацією через EPSILON:
     * - pSmall: -1e-5 і 0 зливаються → 4 межи
     * - pLarge: -0.002 і 0 не зливаються → 5 меж
     */
    expect(rSmall.horizontal.length).toBeLessThan(rLarge.horizontal.length);
  });
});

describe("pageBox", () => {
  it("це рівно аркуш від нуля", () => {
    expect(pageBox(page("left"))).toEqual([0, 0, 623.622047244095, 538.582677165354]);
  });
});

import { describe, expect, it } from "vitest";
import { calibrate, spaceWidths, spacingRatio, styleKey } from "../../src/composition/calibrate.js";
import type { LineMeasure } from "../../src/composition/types.js";
import { line } from "./helpers/composition.js";

/** Останній рядок абзацу, що недобирає до міри рівно `shortfall` пунктів. */
function lastLine(opts: {
  spaceWidth: number;
  shortfall: number;
  size?: number;
  style?: string;
}): LineMeasure {
  const l = line({ spaceWidth: opts.spaceWidth, isLast: true, size: opts.size, style: opts.style });
  /* Без кінцевого пробілу right — це і є правий край останнього гліфа. */
  l.columnWidth = l.right + opts.shortfall;
  return l;
}

describe("styleKey", () => {
  it("розрізняє однаковий стиль у різних кеглях", () => {
    expect(styleKey("Основний", 10)).not.toBe(styleKey("Основний", 12));
  });

  it("мішаний кегль має власний ключ, а не вдає якийсь один", () => {
    expect(styleKey("Основний", null)).not.toBe(styleKey("Основний", 10));
  });
});

describe("spaceWidths", () => {
  it("міряє відстань від пробілу до наступного символа", () => {
    /* closeTo, бо 13,2 − 10 у подвійній точності дає 3,1999999999999993. */
    expect(spaceWidths(line({ spaceWidth: 3.2, isLast: true }))).toEqual([expect.closeTo(3.2, 9)]);
  });

  it("ігнорує пробіл, за яким іде керівний символ", () => {
    const l = line({ spaceWidth: 3.2, isLast: true });
    l.chars[l.chars.length - 1]!.ch = null;
    l.chars.splice(2, 0, { x: l.chars[2]!.x, ch: " " });
    expect(spaceWidths(l).every((w) => w > 0)).toBe(true);
  });

  it("не рахує пробіл, який стоїть останнім у рядку", () => {
    const l = line({ spaceWidth: 3.2, isLast: true });
    l.chars.push({ x: l.right, ch: " " });
    expect(spaceWidths(l)).toEqual([expect.closeTo(3.2, 9)]);
  });

  it("непридатний до виміру рядок не дає жодного зразка", () => {
    expect(spaceWidths(line({ spaceWidth: 3.2, isLast: true, rotated: true }))).toEqual([]);
    expect(spaceWidths(line({ spaceWidth: 3.2, isLast: true, empty: true }))).toEqual([]);
  });

  it("рамку під довільним кутом відсіює саме правило придатності, а не w > 0", () => {
    /* Тут координати варіюються й ширини пробілів додатні, тож фільтр w > 0
     * такий рядок пропустив би. Ловить його лише isMeasurable. */
    const l = line({ spaceWidth: 3.2, isLast: true, rotationAngle: 30 });
    expect(l.chars.filter((c) => c.ch === " ")).toHaveLength(1);
    expect(spaceWidths(l)).toEqual([]);
  });
});

describe("calibrate", () => {
  it("бере ширину пробілу лише з ОСТАННІХ рядків абзаців", () => {
    /* Не останніх рядків тут БІЛЬШІСТЬ, і пробіли в них розтягнуті. Якби
     * фільтр зник, медіана пішла б за ними на 6,0 — саме тому їх п'ять, а не
     * два: при двох медіана лишалась би 3,2 і фільтр не мав би покриття. */
    const cal = calibrate([
      line({ spaceWidth: 6.0, isLast: false }),
      line({ spaceWidth: 6.0, isLast: false }),
      line({ spaceWidth: 6.0, isLast: false }),
      line({ spaceWidth: 6.0, isLast: false }),
      line({ spaceWidth: 6.0, isLast: false }),
      line({ spaceWidth: 3.2, isLast: true }),
      line({ spaceWidth: 3.2, isLast: true }),
      line({ spaceWidth: 3.2, isLast: true }),
    ]);
    expect(cal.natural.get(styleKey("Основний текст", 10))).toBeCloseTo(3.2, 5);
    expect(cal.samples.get(styleKey("Основний текст", 10))).toBe(3);
  });

  it("бере медіану, тому одиничний викид не зсуває калібрування", () => {
    const cal = calibrate([
      line({ spaceWidth: 3.2, isLast: true }),
      line({ spaceWidth: 3.2, isLast: true }),
      line({ spaceWidth: 3.3, isLast: true }),
      line({ spaceWidth: 99.0, isLast: true }),
    ]);
    expect(cal.natural.get(styleKey("Основний текст", 10))!).toBeLessThan(4);
  });

  it("стиль без достатньої кількості зразків позначається невідкаліброваним", () => {
    const cal = calibrate([line({ spaceWidth: 3.2, isLast: true, style: "Заголовок" })], 3);
    expect(cal.natural.has(styleKey("Заголовок", 10))).toBe(false);
    expect(cal.uncalibrated).toContain(styleKey("Заголовок", 10));
  });

  it("калібрує кожну пару (стиль, кегль) окремо", () => {
    const cal = calibrate([
      line({ spaceWidth: 3.2, isLast: true, style: "A", size: 10 }),
      line({ spaceWidth: 3.2, isLast: true, style: "A", size: 10 }),
      line({ spaceWidth: 3.2, isLast: true, style: "A", size: 10 }),
      line({ spaceWidth: 4.8, isLast: true, style: "A", size: 15 }),
      line({ spaceWidth: 4.8, isLast: true, style: "A", size: 15 }),
      line({ spaceWidth: 4.8, isLast: true, style: "A", size: 15 }),
    ]);
    expect(cal.natural.get(styleKey("A", 10))).toBeCloseTo(3.2, 5);
    expect(cal.natural.get(styleKey("A", 15))).toBeCloseTo(4.8, 5);
  });

  /* ——— виміряні пастки, яких код брифінгу не тримав ——— */

  it("останній рядок, що дотягує до міри, у вибірку не йде (абзац 86: пробіли 53%)", () => {
    const clean = [
      line({ spaceWidth: 3.2, isLast: true }),
      line({ spaceWidth: 3.2, isLast: true }),
      line({ spaceWidth: 3.2, isLast: true }),
    ];
    const contaminated = [
      line({ spaceWidth: 1.7, isLast: true, fillsMeasure: true }),
      line({ spaceWidth: 1.7, isLast: true, fillsMeasure: true }),
      line({ spaceWidth: 1.7, isLast: true, fillsMeasure: true }),
    ];
    const cal = calibrate([...clean, ...contaminated]);
    const key = styleKey("Основний текст", 10);
    expect(cal.natural.get(key)).toBeCloseTo(3.2, 5);
    expect(cal.samples.get(key)).toBe(3);
  });

  it("останній рядок, ширший за міру через кінцевий пробіл, теж відкидається (абзац 130)", () => {
    /* Гліфи дотягують до міри рівно, за неї звисає кінцевий пробіл 0,2505 пт. */
    const l = line({ spaceWidth: 2.14, isLast: true, fillsMeasure: true, trailingSpace: 0.2505 });
    expect(l.right - l.left).toBeGreaterThan(l.columnWidth);
    const cal = calibrate([
      line({ spaceWidth: 3.2, isLast: true }),
      line({ spaceWidth: 3.2, isLast: true }),
      line({ spaceWidth: 3.2, isLast: true }),
      l,
    ]);
    expect(cal.samples.get(styleKey("Основний текст", 10))).toBe(3);
  });

  it("ε міряється в ширинах пробілу — абсолютна константа 2 пт розійшлася б із ним", () => {
    /* Недобір 2,2 пт менший за одну природну ширину 3,2 пт → рядок виключений,
     * хоча абсолютний поріг 2 пт визнав би його справжнім останнім. */
    const tooTight = lastLine({ spaceWidth: 3.2, shortfall: 2.2 });
    /* Недобір 4,5 пт більший за ширину пробілу → рядок справжній. */
    const genuine = lastLine({ spaceWidth: 3.2, shortfall: 4.5 });
    const cal = calibrate([
      lastLine({ spaceWidth: 3.2, shortfall: 50 }),
      lastLine({ spaceWidth: 3.2, shortfall: 50 }),
      genuine,
      tooTight,
    ]);
    expect(cal.samples.get(styleKey("Основний текст", 10))).toBe(3);
  });

  it("той самий ε у більшому кеглі відкидає більший недобір", () => {
    /* Кегль 14: природний пробіл 4,8 пт, тож недобір 4,5 пт — уже замалий,
     * тоді як при кеглі 10 (пробіл 3,2 пт) той самий недобір ще годиться. */
    const cal = calibrate([
      lastLine({ spaceWidth: 4.8, shortfall: 50, size: 14 }),
      lastLine({ spaceWidth: 4.8, shortfall: 50, size: 14 }),
      lastLine({ spaceWidth: 4.8, shortfall: 50, size: 14 }),
      lastLine({ spaceWidth: 4.8, shortfall: 4.5, size: 14 }),
    ]);
    expect(cal.samples.get(styleKey("Основний текст", 14))).toBe(3);
  });

  it("повернуті рамки й порожні абзаци не потрапляють у жоден знаменник", () => {
    const cal = calibrate([
      line({ spaceWidth: 3.2, isLast: true }),
      line({ spaceWidth: 3.2, isLast: true }),
      line({ spaceWidth: 3.2, isLast: true }),
      line({ spaceWidth: 9.9, isLast: true, rotated: true, style: "Колонтитул v1" }),
      line({ spaceWidth: 9.9, isLast: true, empty: true, style: "Порожній" }),
      line({ spaceWidth: 9.9, isLast: true, rotationAngle: 30, style: "Під кутом" }),
    ]);
    const key = styleKey("Основний текст", 10);
    expect(cal.natural.get(key)).toBeCloseTo(3.2, 5);
    expect(cal.samples.get(key)).toBe(3);
    /* Непридатні стилі не з'являються ні в «чисто», ні в «невідкалібровано» —
     * їхні рядки взагалі поза аналізом набору. */
    expect(cal.uncalibrated).not.toContain(styleKey("Колонтитул v1", 10));
    expect(cal.uncalibrated).not.toContain(styleKey("Порожній", 10));
    expect(cal.uncalibrated).not.toContain(styleKey("Під кутом", 10));
  });

  it("мішаний кегль не калібрується — ширина пробілу не приписана жодному кеглю", () => {
    const cal = calibrate([
      line({ spaceWidth: 3.2, isLast: true, size: null }),
      line({ spaceWidth: 3.2, isLast: true, size: null }),
      line({ spaceWidth: 3.2, isLast: true, size: null }),
    ]);
    expect(cal.natural.size).toBe(0);
    expect(cal.uncalibrated).toContain(styleKey("Основний текст", null));
  });

  it("стійкість — частка зразків у межах ±1% від медіани", () => {
    const lines = Array.from({ length: 19 }, () => line({ spaceWidth: 3.2, isLast: true }));
    lines.push(line({ spaceWidth: 1.4, isLast: true }));
    const cal = calibrate(lines);
    expect(cal.stability.get(styleKey("Основний текст", 10))).toBeCloseTo(0.95, 6);
  });

  it("стійкість чистої вибірки дорівнює одиниці", () => {
    const cal = calibrate([
      line({ spaceWidth: 3.2, isLast: true }),
      line({ spaceWidth: 3.21, isLast: true }),
      line({ spaceWidth: 3.19, isLast: true }),
    ]);
    expect(cal.stability.get(styleKey("Основний текст", 10))).toBe(1);
  });
});

describe("spacingRatio", () => {
  it("розріджений рядок дає коефіцієнт більший за одиницю", () => {
    const cal = calibrate([
      line({ spaceWidth: 3.2, isLast: true }),
      line({ spaceWidth: 3.2, isLast: true }),
      line({ spaceWidth: 3.2, isLast: true }),
    ]);
    expect(spacingRatio(line({ spaceWidth: 4.8, isLast: false }), cal)).toBeCloseTo(1.5, 2);
  });

  it("невідкалібрований стиль дає null, а не вигадане число", () => {
    const cal = calibrate([]);
    expect(spacingRatio(line({ spaceWidth: 4.8, isLast: false }), cal)).toBeNull();
  });

  it("рядок без жодного пробілу дає null", () => {
    const cal = calibrate([
      line({ spaceWidth: 3.2, isLast: true }),
      line({ spaceWidth: 3.2, isLast: true }),
      line({ spaceWidth: 3.2, isLast: true }),
    ]);
    expect(spacingRatio(line({ spaceWidth: 3.2, isLast: false, words: 1 }), cal)).toBeNull();
  });

  it("непридатний до виміру рядок дає null, а не хибне «чисто»", () => {
    const cal = calibrate([
      line({ spaceWidth: 3.2, isLast: true }),
      line({ spaceWidth: 3.2, isLast: true }),
      line({ spaceWidth: 3.2, isLast: true }),
    ]);
    expect(spacingRatio(line({ spaceWidth: 9.9, isLast: false, rotated: true }), cal)).toBeNull();
    expect(spacingRatio(line({ spaceWidth: 9.9, isLast: false, empty: true }), cal)).toBeNull();
  });
});

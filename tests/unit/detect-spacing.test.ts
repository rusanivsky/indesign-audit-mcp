import { describe, expect, it } from "vitest";
import { calibrate } from "../../src/composition/calibrate.js";
import {
  airFraction,
  boundSide,
  detectSpacing,
  spacingVerdict,
  surveySpacing,
} from "../../src/composition/detect-spacing.js";
/* `findingId` переїхав у спільний `finding.ts` (Задача 11). */
import { findingId } from "../../src/composition/finding.js";
import type { LineMeasure } from "../../src/composition/types.js";
import { calibrate as calibrateExact, styleKey } from "../../src/composition/calibrate.js";

/**
 * Окреме калібрування з ТОЧНИМИ двійковими числами: природна ширина 4 пт.
 * Потрібне межовим тестам — відношення 6/4 = 1,5 і 2/4 = 0,5 представлені
 * точно, тож «рівно на межі» справді означає рівність, а не близькість.
 */
const calExact = calibrateExact([
  line({ spaceWidth: 4, isLast: true }),
  line({ spaceWidth: 4, isLast: true }),
  line({ spaceWidth: 4, isLast: true }),
]);
/** Стиль, чиї оголошені межі стоять рівно на 50/150%. */
const boundsAt = { min: 50, desired: 100, max: 150 };
import { line } from "./helpers/composition.js";

/**
 * Калібрувальна вибірка: три останні рядки абзаців із пробілом 3,2 пт.
 * Природна ширина стилю «Основний текст»@10 виходить 3,2 пт, тож межі 80/133
 * лягають на 2,56 і 4,256 пт.
 */
const base = [
  line({ spaceWidth: 3.2, isLast: true }),
  line({ spaceWidth: 3.2, isLast: true }),
  line({ spaceWidth: 3.2, isLast: true }),
];
const cal = calibrate(base);

/** Режим брифінгу — межі, оголошені самим стилем. */
const STYLE = { mode: "style-bounds" } as const;

describe("detectSpacing — межі стилю", () => {
  it("рядок за верхньою межею стилю — розріджений, severity error", () => {
    /* max 133% → 3,2 × 1,33 = 4,256; беремо 4,5. */
    const f = detectSpacing([...base, line({ spaceWidth: 4.5, isLast: false })], cal, STYLE);
    expect(f).toHaveLength(1);
    expect(f[0]!.defect).toBe("loose");
    expect(f[0]!.severity).toBe("error");
    expect(f[0]!.measured).toBeCloseTo(1.406, 2);
  });

  it("рядок за нижньою межею — щільний", () => {
    /* min 80% → 3,2 × 0,8 = 2,56; беремо 2,4. */
    const f = detectSpacing([...base, line({ spaceWidth: 2.4, isLast: false })], cal, STYLE);
    expect(f).toHaveLength(1);
    expect(f[0]!.defect).toBe("tight");
    expect(f[0]!.severity).toBe("error");
    expect(f[0]!.measured).toBeCloseTo(0.75, 3);
  });

  it("рядок у попереджувальній смузі — severity warning, не error", () => {
    /* Смуга 10 в. п. усередині меж: попереджаємо від 1,33 − 0,10 = 1,23. */
    const f = detectSpacing([...base, line({ spaceWidth: 4.0, isLast: false })], cal, {
      mode: "style-bounds",
      warnBandPct: 10,
    });
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("warning");
    expect(f[0]!.defect).toBe("loose");
  });

  it("без смуги той самий рядок не дає знахідки взагалі", () => {
    expect(detectSpacing([...base, line({ spaceWidth: 4.0, isLast: false })], cal, STYLE)).toEqual(
      [],
    );
  });

  it("щільна смуга теж працює й дає warning", () => {
    /* 3,2 × 0,85 = 2,72 — усередині меж, але в смузі 10 в. п. від 0,80. */
    const f = detectSpacing([...base, line({ spaceWidth: 2.72, isLast: false })], cal, {
      mode: "style-bounds",
      warnBandPct: 10,
    });
    expect(f).toHaveLength(1);
    expect(f[0]!.defect).toBe("tight");
    expect(f[0]!.severity).toBe("warning");
  });

  it("нормальний рядок не дає знахідки", () => {
    expect(detectSpacing([...base, line({ spaceWidth: 3.3, isLast: false })], cal, STYLE)).toEqual(
      [],
    );
  });

  it("пояснення називає і виміряне, і поріг, і межі стилю", () => {
    const f = detectSpacing([...base, line({ spaceWidth: 4.5, isLast: false })], cal, STYLE);
    expect(f[0]!.detail).toContain("141%");
    expect(f[0]!.detail).toContain("133%");
    expect(f[0]!.detail).toContain("80–133%");
    expect(f[0]!.detail).toContain("Основний текст");
  });
});

describe("detectSpacing — що поза знаменником", () => {
  it("останні рядки абзаців не перевіряються — вони не виключаються", () => {
    expect(detectSpacing([...base, line({ spaceWidth: 9.9, isLast: true })], cal, STYLE)).toEqual(
      [],
    );
  });

  it("невиключений абзац не перевіряється — його пробіли тривіально природні", () => {
    /* Виміряно: усі 27 рядків LEFT_ALIGN дають рівно 1,000 і не можуть бути
     * позначені ніколи. Тут пробіл навмисно шалений — якби фільтр виключки
     * зник, знахідка з'явилась би. */
    const wild = line({ spaceWidth: 9.9, isLast: false, justification: "LEFT_ALIGN" });
    expect(detectSpacing([...base, wild], cal, STYLE)).toEqual([]);
    expect(detectSpacing([...base, wild], cal, { mode: "ratio", maxRatio: 1.05 })).toEqual([]);
  });

  it("решта виключок (RIGHT/CENTER/FULLY_JUSTIFIED) у знаменнику лишається", () => {
    for (const j of ["RIGHT_JUSTIFIED", "CENTER_JUSTIFIED", "FULLY_JUSTIFIED"]) {
      const f = detectSpacing(
        [...base, line({ spaceWidth: 4.5, isLast: false, justification: j })],
        cal,
        STYLE,
      );
      expect(f, j).toHaveLength(1);
    }
  });

  it("невідкалібрований рядок не дає ні знахідки, ні хибного «чисто»", () => {
    const f = detectSpacing([line({ spaceWidth: 9.9, isLast: false, style: "Невідомий" })], cal, {
      mode: "style-bounds",
    });
    expect(f).toEqual([]);
    /* І він не потрапляє в знаменник як «чистий». */
    const s = surveySpacing([line({ spaceWidth: 9.9, isLast: false, style: "Невідомий" })], cal);
    expect(s.measured).toBe(0);
    expect(s.notMeasured).toBe(1);
  });

  it("непридатний до виміру рядок не дає знахідки й не рахується чистим", () => {
    const bad = [
      line({ spaceWidth: 9.9, isLast: false, rotated: true }),
      line({ spaceWidth: 9.9, isLast: false, rotationAngle: 30 }),
      line({ spaceWidth: 9.9, isLast: false, empty: true }),
    ];
    expect(detectSpacing([...base, ...bad], cal, STYLE)).toEqual([]);
    expect(surveySpacing(bad, cal).excluded.notMeasurable).toBe(3);
    expect(surveySpacing(bad, cal).measured).toBe(0);
  });

  it("мішані межі стилю — вердикту немає, а не «чисто»", () => {
    /* InDesign віддає null, коли межі виключки в межах абзацу мішані. Це
     * «не виміряно»: у режимі меж стилю міряти нічим, у режимі порогу — є чим. */
    const mixed = line({
      spaceWidth: 4.5,
      isLast: false,
      spacing: { min: null, desired: null, max: null },
    });
    expect(detectSpacing([...base, mixed], cal, STYLE)).toEqual([]);
    const f = detectSpacing([...base, mixed], cal, { mode: "ratio", maxRatio: 1.33 });
    expect(f).toHaveLength(1);
    /* Довідка про межі стилю чесно каже, що їх не виміряно. */
    expect(f[0]!.detail).toContain("?–?%");
  });

  it("один бік меж відомий — цей бік перевіряється, другий ні", () => {
    const halfKnown = { min: null, desired: 100, max: 133 };
    const loose = line({ spaceWidth: 4.5, isLast: false, spacing: halfKnown });
    const tight = line({ spaceWidth: 2.4, isLast: false, spacing: halfKnown });
    expect(detectSpacing([...base, loose], cal, STYLE)).toHaveLength(1);
    expect(detectSpacing([...base, tight], cal, STYLE)).toEqual([]);
  });
});

describe("detectSpacing — поріг задає виклик", () => {
  it("пороги перекриваються параметром виклику", () => {
    const f = detectSpacing([...base, line({ spaceWidth: 3.5, isLast: false })], cal, {
      mode: "ratio",
      maxRatio: 1.05,
    });
    expect(f).toHaveLength(1);
    expect(f[0]!.defect).toBe("loose");
    /* Межі стилю лишились довідкою в поясненні, а не критерієм. */
    expect(f[0]!.detail).toContain("80–133%");
    expect(f[0]!.detail).toContain("threshold 105%");
  });

  it("заданий лише верхній поріг — нижній бік не перевіряється зовсім", () => {
    const f = detectSpacing([...base, line({ spaceWidth: 0.5, isLast: false })], cal, {
      mode: "ratio",
      maxRatio: 2.0,
    });
    expect(f).toEqual([]);
  });

  it("режим ratio без жодного порога — помилка, а не тихе замовчування", () => {
    expect(() => detectSpacing(base, cal, { mode: "ratio" })).toThrow(/minRatio|maxRatio/);
  });

  it("поріг ratio відсіює хвіст там, де межі стилю позначають половину", () => {
    /* Мініатюра виміряного розподілу: 1,03 / 1,40 / 1,79 / 2,82. Межі стилю
     * позначають три з чотирьох (виміряна базова частка 59,14%), поріг 2,5 —
     * лише хвіст. */
    const corpus = [
      ...base,
      line({ spaceWidth: 3.3, isLast: false, containerId: "story:1" }),
      line({ spaceWidth: 4.5, isLast: false, containerId: "story:2" }),
      line({ spaceWidth: 5.73, isLast: false, containerId: "story:3" }),
      line({ spaceWidth: 9.03, isLast: false, containerId: "story:4" }),
    ];
    expect(detectSpacing(corpus, cal, STYLE)).toHaveLength(3);
    expect(detectSpacing(corpus, cal, { mode: "ratio", maxRatio: 2.5 })).toHaveLength(1);
  });
});

describe("detectSpacing — ранжування", () => {
  it("найсильніше відхилення — першим", () => {
    const f = detectSpacing(
      [
        ...base,
        line({ spaceWidth: 4.5, isLast: false, containerId: "story:1" }),
        line({ spaceWidth: 9.6, isLast: false, containerId: "story:2" }),
        line({ spaceWidth: 5.0, isLast: false, containerId: "story:3" }),
      ],
      cal,
      STYLE,
    );
    expect(f.map((x) => x.containerId)).toEqual(["story:2", "story:3", "story:1"]);
  });

  it("щільний рядок може стояти вище за розріджений — міряється сила, не бік", () => {
    /* 0,5 від природного — це відхилення вдвічі, а 1,4 — лише в 1,4 раза. */
    const f = detectSpacing(
      [
        ...base,
        line({ spaceWidth: 4.48, isLast: false, containerId: "story:1" }),
        line({ spaceWidth: 1.6, isLast: false, containerId: "story:2" }),
      ],
      cal,
      STYLE,
    );
    expect(f.map((x) => x.defect)).toEqual(["tight", "loose"]);
  });

  it("за рівного відхилення порядок визначає ключ — прогін відтворюваний", () => {
    const f = detectSpacing(
      [
        ...base,
        line({ spaceWidth: 4.5, isLast: false, containerId: "story:9" }),
        line({ spaceWidth: 4.5, isLast: false, containerId: "story:1" }),
        line({ spaceWidth: 4.5, isLast: false, containerId: "story:5" }),
      ],
      cal,
      STYLE,
    );
    expect(f.map((x) => x.measured)).toEqual([f[0]!.measured, f[0]!.measured, f[0]!.measured]);
    expect(f.map((x) => x.containerId)).toEqual(["story:1", "story:5", "story:9"]);
  });

  it("сила відхилення міряє ПОВІТРЯ в рядку, а не відношення пробілу", () => {
    /* Виміряний найгірший випадок книжки описаний саме так: «десять пробілів
     * по 10,87 пт — це 108,7 пт повітря на 368,5 пт колонки, майже 30% рядка».
     * Рядок A: десять проміжків удвічі ширших → 16% міри повітря.
     * Рядок B: ОДИН проміжок учетверо ширший → 4,8% міри.
     * Відношення поставило б B першим (4,0 проти 2,0), повітря ставить A. */
    const a = line({ spaceWidth: 6.4, words: 11, isLast: false, containerId: "story:1" });
    const b = line({ spaceWidth: 12.8, isLast: false, containerId: "story:2" });
    expect(airFraction(a, cal)).toBeCloseTo(0.16, 6);
    expect(airFraction(b, cal)).toBeCloseTo(0.048, 6);
    const f = detectSpacing([...base, a, b], cal, STYLE);
    expect(f.map((x) => x.measured.toFixed(1))).toEqual(["2.0", "4.0"]);
    expect(f.map((x) => x.containerId)).toEqual(["story:1", "story:2"]);
  });

  it("щільний бік теж міряється повітрям — знак не важить, величина важить", () => {
    const l = line({ spaceWidth: 1.6, isLast: false });
    expect(airFraction(l, cal)).toBeCloseTo(-0.008, 9);
  });

  it("ключ ранжування їде РАЗОМ зі знахідкою й дорівнює модулю повітря", () => {
    /* Без цього поля шар звіту не звів би пачки сторінок у порядок документа,
     * не зберігши всі LineMeasure й калібрування — тобто саме ту роботу, яку
     * детектор йому лишає, він виконати б не зміг. Із старою метрикою сила
     * виводилась із `measured`; із повітрям — уже ні. */
    const a = line({ spaceWidth: 6.4, words: 11, isLast: false, containerId: "story:1" });
    const b = line({ spaceWidth: 12.8, isLast: false, containerId: "story:2" });
    const f = detectSpacing([...base, a, b], cal, STYLE);
    expect(f.map((x) => x.strength)).toEqual([
      expect.closeTo(0.16, 6),
      expect.closeTo(0.048, 6),
    ]);
    /* Порядок відтворюється з самих лише знахідок — LineMeasure не потрібні. */
    const shuffled = [...f].reverse();
    shuffled.sort((x, y) => y.strength - x.strength);
    expect(shuffled.map((x) => x.containerId)).toEqual(["story:1", "story:2"]);
  });

  it("сила невід'ємна й для щільного боку", () => {
    const f = detectSpacing([...base, line({ spaceWidth: 1.6, isLast: false })], cal, STYLE);
    expect(f[0]!.strength).toBeCloseTo(0.008, 9);
  });

  it("сила НЕ ВИМІРЯНА віддає null, а не нуль — це різні твердження", () => {
    /* Нуль тут читався б як «рядок ідеально природний». */
    expect(airFraction(line({ spaceWidth: 4.5, isLast: false, style: "Невідомий" }), cal)).toBeNull();
    expect(airFraction(line({ spaceWidth: 4.5, isLast: false, words: 1 }), cal)).toBeNull();
    expect(airFraction(line({ spaceWidth: 4.5, isLast: false, columnWidth: 0 }), cal)).toBeNull();
    expect(airFraction(line({ spaceWidth: 4.5, isLast: false, columnWidth: -1 }), cal)).toBeNull();
  });

  it("невиміряна сила не вигадується у знахідці, і це видно в поясненні", () => {
    const f = detectSpacing([...base, line({ spaceWidth: 4.5, isLast: false, columnWidth: 0 })], cal, STYLE);
    expect(f).toHaveLength(1);
    expect(f[0]!.strength).toBe(0);
    expect(f[0]!.detail).toContain("not measured");
  });

  it("вага не є ключем сортування: warning із більшим відхиленням стоїть вище", () => {
    /* Стиль із власними межами 80/300 — рядок 2,5 ще в межах, але в смузі. */
    const wide = line({
      spaceWidth: 8.0,
      isLast: false,
      containerId: "story:1",
      spacing: { min: 80, desired: 100, max: 300 },
    });
    const narrow = line({ spaceWidth: 4.48, isLast: false, containerId: "story:2" });
    const f = detectSpacing([...base, wide, narrow], cal, {
      mode: "style-bounds",
      warnBandPct: 100,
    });
    expect(f.map((x) => x.severity)).toEqual(["warning", "error"]);
    expect(f[0]!.measured).toBeCloseTo(2.5, 3);
  });
});

describe("detectSpacing — режим ранжування без відбору", () => {
  /* Вимір вимагає «ранжувати за силою відхилення, а межі стилю тримати як
   * довідкове значення … не як критерій відбору». Обидва інші режими ВІДБИРАЮТЬ. */

  it("не потребує жодного порога й не кидає помилки", () => {
    expect(() => detectSpacing(base, cal, { mode: "rank" })).not.toThrow();
  });

  it("віддає знахідку на КОЖЕН виміряний рядок, включно з бездоганним", () => {
    const f = detectSpacing(
      [
        ...base,
        line({ spaceWidth: 3.3, isLast: false, containerId: "story:1" }) /* 103% — чистий */,
        line({ spaceWidth: 4.5, isLast: false, containerId: "story:2" }),
        line({ spaceWidth: 2.4, isLast: false, containerId: "story:3" }),
      ],
      cal,
      { mode: "rank" },
    );
    expect(f).toHaveLength(3);
    /* «Двадцять найгірших рядків документа» = .slice(0, 20). */
    expect(f.slice(0, 2).map((x) => x.containerId)).toEqual(["story:2", "story:3"]);
  });

  it("бік береться з відношення, а вага — з меж стилю як довідки", () => {
    const f = detectSpacing(
      [
        ...base,
        line({ spaceWidth: 4.5, isLast: false, containerId: "story:1" }) /* 141% — поза */,
        line({ spaceWidth: 3.3, isLast: false, containerId: "story:2" }) /* 103% — у межах */,
        line({ spaceWidth: 3.0, isLast: false, containerId: "story:3" }) /* 94% — у межах */,
      ],
      cal,
      { mode: "rank" },
    );
    const by = new Map(f.map((x) => [x.containerId, x]));
    expect(by.get("story:1")).toMatchObject({ defect: "loose", severity: "error" });
    expect(by.get("story:2")).toMatchObject({ defect: "loose", severity: "info" });
    expect(by.get("story:3")).toMatchObject({ defect: "tight", severity: "info" });
  });

  it("невиміряні межі дають unrated, а не «в межах»", () => {
    /* Без окремої ваги рядок із мішаними межами був би нерозрізненний від
     * виміряного й чистого — та сама підміна «null = чисто», тільки у вазі. */
    const f = detectSpacing(
      [
        ...base,
        line({
          spaceWidth: 4.5,
          isLast: false,
          containerId: "story:1",
          spacing: { min: null, desired: null, max: null },
        }),
        line({
          spaceWidth: 4.5,
          isLast: false,
          containerId: "story:2",
          spacing: { min: 80, desired: 100, max: null },
        }),
        line({ spaceWidth: 3.3, isLast: false, containerId: "story:3" }),
      ],
      cal,
      { mode: "rank" },
    );
    const by = new Map(f.map((x) => [x.containerId, x.severity]));
    expect(by.get("story:1")).toBe("unrated");
    /* Одна межа теж не дає права сказати «у межах»: 141% могло б порушувати
     * верхню, якби її виміряли. */
    expect(by.get("story:2")).toBe("unrated");
    expect(by.get("story:3")).toBe("info");
  });

  it("вага рівно на межі — error, а не info (нестроге порівняння)", () => {
    const loose = detectSpacing([line({ spaceWidth: 6, isLast: false, spacing: boundsAt })], calExact, {
      mode: "rank",
    });
    expect(loose[0]!.measured).toBe(1.5);
    expect(loose[0]!.severity).toBe("error");

    const tight = detectSpacing([line({ spaceWidth: 2, isLast: false, spacing: boundsAt })], calExact, {
      mode: "rank",
    });
    expect(tight[0]!.measured).toBe(0.5);
    expect(tight[0]!.severity).toBe("error");
  });

  it("рядок рівно на природній ширині боку не має й не ранжується", () => {
    /* 3,2 пт — та сама ширина, з якої взято калібрування, тобто рівно 1,000. */
    const f = detectSpacing([...base, line({ spaceWidth: 3.2, isLast: false })], cal, {
      mode: "rank",
    });
    expect(f).toEqual([]);
  });

  it("пояснення чесно каже, що відбору не було", () => {
    const f = detectSpacing([...base, line({ spaceWidth: 4.5, isLast: false })], cal, {
      mode: "rank",
    });
    expect(f[0]!.detail).toContain("no selection was applied");
    expect(f[0]!.detail).not.toContain("threshold");
    expect(f[0]!.detail).toContain("80–133%");
  });

  it("ранжування без відбору не змішується з відбором за порогом", () => {
    const corpus = [...base, line({ spaceWidth: 3.3, isLast: false })];
    expect(detectSpacing(corpus, cal, { mode: "rank" })).toHaveLength(1);
    expect(detectSpacing(corpus, cal, STYLE)).toEqual([]);
  });
});

describe("boundSide — ЄДИНИЙ предикат «за межею»", () => {
  it("порівняння нестрогі з обох боків: вимір рахує «≥133% або ≤80%»", () => {
    expect(boundSide(1.5, { min: 0.5, max: 1.5 })).toBe("loose");
    expect(boundSide(0.5, { min: 0.5, max: 1.5 })).toBe("tight");
    expect(boundSide(1.4999, { min: 0.5, max: 1.5 })).toBeNull();
    expect(boundSide(0.5001, { min: 0.5, max: 1.5 })).toBeNull();
  });

  it("невиміряний бік не порівнюється ні з чим", () => {
    expect(boundSide(99, { min: 0.5, max: null })).toBeNull();
    expect(boundSide(0.01, { min: null, max: 1.5 })).toBeNull();
    expect(boundSide(99, { min: null, max: null })).toBeNull();
  });

  it("той самий предикат живить відбір, ранжування й огляд", () => {
    /* Три виклики того самого рядка через три різні шляхи — і всі троє
     * погоджуються, що він рівно на межі, тобто за нею. */
    const l = line({ spaceWidth: 6, isLast: false, spacing: boundsAt });
    expect(boundSide(1.5, { min: 0.5, max: 1.5 })).toBe("loose");
    expect(detectSpacing([l], calExact, { mode: "style-bounds" })).toHaveLength(1);
    expect(detectSpacing([l], calExact, { mode: "rank" })[0]!.severity).toBe("error");
    expect(surveySpacing([l], calExact).bounds.outsideKnown).toBe(1);
  });
});

describe("detectSpacing — межа порівнюється включно", () => {
  it("рядок РІВНО на верхній межі вважається порушенням (вимір рахує «≥133%»)", () => {
    const l = line({ spaceWidth: 4.5, isLast: false });
    const exact = surveySpacing([...base, l], cal).ratios[0]!;
    expect(detectSpacing([...base, l], cal, { mode: "ratio", maxRatio: exact })).toHaveLength(1);
  });

  it("рядок РІВНО на нижній межі теж вважається порушенням", () => {
    const l = line({ spaceWidth: 2.4, isLast: false });
    const exact = surveySpacing([...base, l], cal).ratios[0]!;
    const f = detectSpacing([...base, l], cal, { mode: "ratio", minRatio: exact });
    expect(f).toHaveLength(1);
    expect(f[0]!.defect).toBe("tight");
  });
});

describe("findingId", () => {
  it("id знахідки стабільний між прогонами", () => {
    const input = [...base, line({ spaceWidth: 4.5, isLast: false })];
    expect(detectSpacing(input, cal, STYLE)[0]!.id).toBe(
      detectSpacing(input, cal, STYLE)[0]!.id,
    );
  });

  it("різні рядки дістають різні id", () => {
    const f = detectSpacing(
      [
        ...base,
        line({ spaceWidth: 4.5, isLast: false, containerId: "story:1" }),
        line({ spaceWidth: 4.5, isLast: false, containerId: "story:1", paragraphIndex: 7 }),
        line({
          spaceWidth: 4.5,
          isLast: false,
          containerId: "story:1",
          paragraphIndex: 7,
          lineInParagraph: 3,
          paragraphLineCount: 9,
        }),
      ],
      cal,
      STYLE,
    );
    expect(new Set(f.map((x) => x.id)).size).toBe(3);
  });

  it("клас дефекту входить у ключ — один рядок не має двох однакових id", () => {
    const l = line({ spaceWidth: 4.5, isLast: false });
    expect(findingId(l, "loose")).not.toBe(findingId(l, "tight"));
  });
});

describe("surveySpacing", () => {
  it("кожен рядок потрапляє рівно в одну категорію, знаменник — виключені рядки", () => {
    const s = surveySpacing(
      [
        ...base /* три останні рядки абзаців */,
        line({ spaceWidth: 9.9, isLast: true, rotated: true }) /* непридатний І останній */,
        line({ spaceWidth: 9.9, isLast: false, justification: "LEFT_ALIGN" }),
        line({ spaceWidth: 9.9, isLast: false, style: "Невідомий" }),
        line({ spaceWidth: 4.5, isLast: false, containerId: "story:1" }),
        line({ spaceWidth: 3.3, isLast: false, containerId: "story:2" }),
        line({ spaceWidth: 2.4, isLast: false, containerId: "story:3" }),
      ],
      cal,
    );
    expect(s.measured).toBe(3);
    /* Непридатність перевіряється ПЕРШОЮ — рядок повернутої рамки не має бути
     * зарахований в «останні рядки абзаців». */
    expect(s.excluded).toEqual({ notMeasurable: 1, paragraphFinal: 3, notJustified: 1 });
    expect(s.notMeasured).toBe(1);
    expect(s.measured + s.notMeasured + 1 + 3 + 1).toBe(9);
  });

  it("віддає ГОТОВУ базову частку, а не самі лише доданки", () => {
    const s = surveySpacing(
      [
        ...base,
        line({ spaceWidth: 4.5, isLast: false, containerId: "story:1" }),
        line({ spaceWidth: 3.3, isLast: false, containerId: "story:2" }),
        line({ spaceWidth: 2.4, isLast: false, containerId: "story:3" }),
      ],
      cal,
    );
    expect(s.bounds.outsideKnown).toBe(2);
    expect(s.bounds.known).toBe(3);
    /* Головне: частка порахована ТУТ, а не лишена читачеві коментаря. */
    expect(s.bounds.baseRate).toBeCloseTo(2 / 3, 9);
  });

  it("базова частка на порожньому знаменнику — NaN, а не нуль", () => {
    const s = surveySpacing(
      [
        ...base,
        line({
          spaceWidth: 4.5,
          isLast: false,
          spacing: { min: null, desired: null, max: null },
        }),
      ],
      cal,
    );
    expect(s.bounds.known).toBe(0);
    expect(s.bounds.baseRate).toBeNaN();
  });

  it("рядок рівно на межі стилю рахується як поза межами", () => {
    const s = surveySpacing([line({ spaceWidth: 6, isLast: false, spacing: boundsAt })], calExact);
    expect(s.ratios).toEqual([1.5]);
    expect(s.bounds.outsideKnown).toBe(1);
    const t = surveySpacing([line({ spaceWidth: 2, isLast: false, spacing: boundsAt })], calExact);
    expect(t.bounds.outsideKnown).toBe(1);
  });

  it("перцентилі рахуються по відсортованих відношеннях", () => {
    const s = surveySpacing(
      [
        ...base,
        line({ spaceWidth: 4.5, isLast: false, containerId: "story:1" }),
        line({ spaceWidth: 3.3, isLast: false, containerId: "story:2" }),
        line({ spaceWidth: 2.4, isLast: false, containerId: "story:3" }),
      ],
      cal,
    );
    expect(s.ratios).toEqual([...s.ratios].sort((a, b) => a - b));
    expect(s.percentiles.p50).toBeCloseTo(1.031, 2);
    expect(s.percentiles.max).toBeCloseTo(1.406, 2);
  });

  it("рядок з НЕВИМІРЯНИМИ межами стилю не зараховується як «у межах»", () => {
    /* Та сама хиба «null як чисто», яку детектор ловить поверхом нижче: без
     * окремого лічильника такий рядок мовчки розбавляв би базову частку —
     * єдине число, за яким людина обирає поріг. */
    const mixed = line({
      spaceWidth: 9.9,
      isLast: false,
      containerId: "story:9",
      spacing: { min: null, desired: null, max: null },
    });
    const s = surveySpacing(
      [...base, line({ spaceWidth: 4.5, isLast: false, containerId: "story:1" }), mixed],
      cal,
    );
    expect(s.measured).toBe(2);
    expect(s.bounds.unknown).toBe(1);
    expect(s.bounds.known).toBe(1);
    expect(s.bounds.outsideKnown).toBe(1);
    expect(s.bounds.baseRate).toBe(1);
  });

  it("ОДНОСТОРОННІ межі теж не потрапляють у знаменник — боки нуллабельні окремо", () => {
    /* Рядок, у якого виміряна лише нижня межа, не може бути розрідженим
     * НІКОЛИ, тож у спільному знаменнику він розбавляв би саме частку
     * розріджених. Але й не губиться: він у partial/outsidePartial. */
    const oneSided = line({
      spaceWidth: 9.9,
      isLast: false,
      containerId: "story:9",
      spacing: { min: 80, desired: 100, max: null },
    });
    const tightOneSided = line({
      spaceWidth: 1.0,
      isLast: false,
      containerId: "story:8",
      spacing: { min: 80, desired: 100, max: null },
    });
    const s = surveySpacing(
      [...base, line({ spaceWidth: 4.5, isLast: false, containerId: "story:1" }), oneSided, tightOneSided],
      cal,
    );
    expect(s.measured).toBe(3);
    expect(s.bounds).toMatchObject({
      known: 1,
      partial: 2,
      unknown: 0,
      outsideKnown: 1,
      /* 309% не позначене нічим — верхньої межі не виміряно;
       * 31% позначене, бо нижня межа є. */
      outsidePartial: 1,
    });
    expect(s.bounds.baseRate).toBe(1);
  });

  it("розбивка за стилями — те, без чого Задача 12 не покаже, де саме проблема", () => {
    const s = surveySpacing(
      [
        ...base,
        line({ spaceWidth: 4.5, isLast: false, containerId: "story:1" }),
        line({ spaceWidth: 3.3, isLast: false, containerId: "story:2" }),
        line({
          spaceWidth: 9.9,
          isLast: false,
          containerId: "story:3",
          spacing: { min: null, desired: null, max: null },
        }),
      ],
      cal,
    );
    const key = styleKey("Основний текст", 10);
    const s1 = s.byStyle.get(key)!;
    expect(s1.measured).toBe(3);
    expect(s1.bounds).toMatchObject({ known: 2, unknown: 1, outsideKnown: 1 });
    expect(s1.bounds.baseRate).toBe(0.5);
  });

  it("класифікація експортована — Задача 12 не виводить знаменник заново", () => {
    expect(spacingVerdict(line({ spaceWidth: 3.2, isLast: true }), cal).kind).toBe(
      "paragraph-final",
    );
    expect(
      spacingVerdict(line({ spaceWidth: 3.2, isLast: false, rotated: true }), cal).kind,
    ).toBe("not-measurable");
    const v = spacingVerdict(line({ spaceWidth: 4.5, isLast: false }), cal);
    expect(v.kind).toBe("ratio");
    if (v.kind === "ratio") expect(v.styleKey).toBe(styleKey("Основний текст", 10));
  });

  it("порожня вибірка дає NaN, а не нуль — нуль читався б як «усе природне»", () => {
    const s = surveySpacing([], cal);
    expect(s.measured).toBe(0);
    expect(s.percentiles.p50).toBeNaN();
    expect(s.percentiles.max).toBeNaN();
  });
});

/**
 * Задача 10 Фази 4: борг закритий — політика щодо `isMaster` тепер оголошена
 * САМЕ ТУТ, у детекторі, а не лише в обробнику `composition_audit` нагорі.
 */
describe("detectSpacing — includeMasters", () => {
  it("за замовчуванням рядки батьківських сторінок НЕ рахуються", () => {
    /* Той самий рядок, що дав `loose` у першому тесті файлу, тепер з isMaster. */
    const f = detectSpacing(
      [...base, line({ spaceWidth: 4.5, isLast: false, isMaster: true })],
      cal,
      STYLE,
    );
    expect(f).toEqual([]);
  });

  it("includeMasters: true їх повертає", () => {
    const f = detectSpacing(
      [...base, line({ spaceWidth: 4.5, isLast: false, isMaster: true })],
      cal,
      { ...STYLE, includeMasters: true },
    );
    expect(f.length).toBeGreaterThan(0);
  });
});

/*
 * Узгодженість сили зі знаком (борг Фази 3, закрито 2026-08-05).
 *
 * `defect` береться з МЕДІАНИ ширин пробілів (`spacingRatio`), а `strength` —
 * із СУМИ (`airFraction`). На рівномірно виключеному рядку це та сама
 * відповідь, і виміряно на книжці користувача (сторінки 40-49, режим rank):
 * 59 знахідок, розходжень 0. Але це властивість набору, а не контракту:
 * рядок із кількох вузьких пробілів і одного дуже широкого дає медіану
 * «щільно» при сумарному НАДЛИШКУ повітря — тобто знахідка казала б одне, а
 * сила міряла б протилежне.
 *
 * Фікстура тут зібрана вручну, а не через `line()`: конструктор дає всім
 * проміжкам однакову ширину (`spaceWidth`), тобто неоднорідний рядок ним
 * побудувати неможливо за задумом.
 */
describe("detectSpacing — сила проти знаку", () => {
  /** Рядок із заданими ширинами пробілів; між ними — по одній літері. */
  function unevenLine(gaps: number[]): LineMeasure {
    const LETTER = 5;
    const chars: { x: number; ch: string | null }[] = [];
    let x = 0;
    chars.push({ x, ch: "а" });
    x += LETTER;
    for (const g of gaps) {
      chars.push({ x, ch: " " });
      x += g;
      chars.push({ x, ch: "а" });
      x += LETTER;
    }
    return {
      containerId: "story:0",
      page: "1",
      paragraphIndex: 0,
      lineInParagraph: 0,
      paragraphLineCount: 2,
      left: 0,
      right: x,
      columnWidth: 200,
      isLast: false,
      endsParagraph: false,
      endsWithHyphen: false,
      empty: false,
      rotated: false,
      rotationAngle: 0,
      isLastInFrame: false,
      isMaster: false,
      styleName: "Osnovnyi",
      pointSize: 10,
      justification: "LEFT_JUSTIFIED",
      spacing: { min: 80, desired: 100, max: 133 },
      baseline: 0,
      isFirstInFrame: false,
      text: "а" + gaps.map(() => " а").join(""),
      chars,
    } as unknown as LineMeasure;
  }

  it("неоднорідний рядок: медіана каже одне, сума — протилежне, сила знімається", () => {
    /*
     * Природна ширина пробілу калібрується з ОСТАННІХ рядків абзаців; тут її
     * задає окремий рівний рядок із пробілами по 4 пт. Досліджуваний рядок має
     * пробіли 3, 3, 3, 30: медіана 3 (< 4 → «щільно»), а сума 39 проти
     * 4 × 4 = 16 → повітря НАДЛИШОК, тобто знак протилежний.
     */
    const natural = { ...unevenLine([4, 4, 4]), isLast: true, endsParagraph: true, lineInParagraph: 1 };
    const target = unevenLine([3, 3, 3, 30]);
    const cal = calibrate([natural, target]);

    const findings = detectSpacing([target], cal, { mode: "rank" });
    expect(findings).toHaveLength(1);
    const f = findings[0]!;

    expect(f.defect).toBe("tight");
    expect(f.strength).toBe(0);
    expect(f.detail).toMatch(/INCONSISTENT/);
    expect(f.detail).toMatch(/opposite/);
  });

  it("рівномірний рядок сили не втрачає — знімається саме розходження, не будь-що", () => {
    const natural = { ...unevenLine([4, 4, 4]), isLast: true, endsParagraph: true, lineInParagraph: 1 };
    const target = unevenLine([8, 8, 8]);
    const cal = calibrate([natural, target]);

    const findings = detectSpacing([target], cal, { mode: "rank" });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.defect).toBe("loose");
    expect(findings[0]!.strength).toBeGreaterThan(0);
    expect(findings[0]!.detail).not.toMatch(/INCONSISTENT/);
  });
});

import { describe, expect, it } from "vitest";
import { detectTacOverLimit, surveyTac } from "../../src/color/detect/tac.js";
import { selectSites } from "../../src/color/sites.js";
import type { ColorSite } from "../../src/color/types.js";

const ALL = { includeNonPrinting: true, includeHidden: true };

function site(value: number[], over: Partial<ColorSite> = {}): ColorSite {
  return {
    siteId: 1, surface: "pageItem", role: "fill", ownerKind: "GraphicLine",
    ownerName: null, page: "17", master: null, layer: "01", printable: true,
    visible: true, laysInk: true,
    color: { named: null, model: "PROCESS", space: "CMYK", value, kind: "solid" },
    tint: -1, overprint: false, pointSize: null, ...over,
  };
}

describe("detectTacOverLimit", () => {
  it("знаходить виміряний на книжці 260 при межі 250", () => {
    const found = detectTacOverLimit([site([76, 48, 66, 70])], 250);
    expect(found).toHaveLength(1);
    expect(found[0]!.totalInk).toBe(260);
    expect(found[0]!.rule).toBe("tac-over-limit");
  });

  it("МОВЧИТЬ про той самий колір при межі 300 — межа задається людиною", () => {
    expect(detectTacOverLimit([site([76, 48, 66, 70])], 300)).toEqual([]);
  });

  it("рівно на межі — не знахідка: 300 при межі 300 припустимі", () => {
    expect(detectTacOverLimit([site([100, 100, 100, 0])], 300)).toEqual([]);
  });

  it("84 однакові кортежі дають ОДИН рядок із лічильником, а не 84 рядки", () => {
    const many: ColorSite[] = [];
    for (let i = 0; i < 84; i++) many.push(site([76, 48, 66, 70], { siteId: i, page: String(i + 1) }));
    const found = detectTacOverLimit(many, 250);
    expect(found).toHaveLength(1);
    expect(found[0]!.count).toBe(84);
  });

  it("відтінок ураховано: 260 під 50 % — це 130, і при межі 250 не знахідка", () => {
    expect(detectTacOverLimit([site([76, 48, 66, 70], { tint: 50 })], 250)).toEqual([]);
  });

  /*
   * Гейт зразка (спек §5.2), НЕГАТИВНИЙ БЛИЗНЮК до тесту нижче.
   *
   * Доведено виконанням зібраного інструмента: без цього гейта документ, у
   * якому колір є ТІЛЬКИ в палітрі, віддавав знахідку «tac-over-limit
   * [Registration] CMYK 100/100/100/100, totalInk 400, сторінки [монтажний
   * стіл]». `[Registration]` є в КОЖНОМУ документі InDesign і не видаляється,
   * тобто хибною була відповідь на будь-якому файлі світу. Гейт живе в
   * selectSites — тому й доводиться через нього, а не повз.
   */
  it("МОВЧИТЬ про TAC 400 у ВИЗНАЧЕННІ зразка [Registration] — визначення не ужиток", () => {
    const definition = site([100, 100, 100, 100], {
      surface: "swatch", role: "definition", ownerKind: "Color",
      ownerName: "Registration", page: null, layer: "—",
      color: {
        named: "Registration", model: "REGISTRATION", space: "CMYK",
        value: [100, 100, 100, 100], kind: "solid",
      },
    });
    expect(detectTacOverLimit(selectSites([definition], ALL), 300)).toEqual([]);
  });

  it("той самий TAC 400 НА ОБ'ЄКТІ — знахідка: мовчить гейт зразка, а не правило", () => {
    const applied = site([100, 100, 100, 100]);
    const found = detectTacOverLimit(selectSites([applied], ALL), 300);
    expect(found).toHaveLength(1);
    expect(found[0]!.totalInk).toBe(400);
  });

  it("RGB не судиться межею фарби взагалі", () => {
    const rgb = site([0, 0, 0], {
      color: { named: null, model: "PROCESS", space: "RGB", value: [0, 0, 0], kind: "solid" },
    });
    expect(detectTacOverLimit([rgb], 1)).toEqual([]);
  });
});

describe("surveyTac", () => {
  it("розкладає за діапазонами й показує форму сигналу", () => {
    const buckets = surveyTac([
      site([0, 0, 0, 100]),
      site([76, 48, 66, 70], { siteId: 2 }),
      site([100, 100, 100, 100], { siteId: 3 }),
    ]);
    const total = buckets.reduce((acc, b) => acc + b.count, 0);
    expect(total).toBe(3);
    expect(buckets[buckets.length - 1]!.upTo).toBeNull();
    expect(buckets[buckets.length - 1]!.count).toBe(1);
  });

  it("порожній вхід дає всі діапазони з нулями, а не порожній масив", () => {
    const buckets = surveyTac([]);
    expect(buckets.length).toBeGreaterThan(0);
    for (const b of buckets) expect(b.count).toBe(0);
  });
});

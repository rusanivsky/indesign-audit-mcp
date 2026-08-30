import { describe, expect, it } from "vitest";
import { groupSites, isJudgeable, isUsage, pagesOf, selectSites } from "../../src/color/sites.js";
import type { ColorSite } from "../../src/color/types.js";

function site(over: Partial<ColorSite> = {}): ColorSite {
  return {
    siteId: 1,
    surface: "pageItem",
    role: "fill",
    ownerKind: "GraphicLine",
    ownerName: null,
    page: "17",
    master: null,
    layer: "01 · Фон",
    printable: true,
    visible: true,
    laysInk: true,
    color: { named: null, model: "PROCESS", space: "CMYK", value: [76, 48, 66, 70], kind: "solid" },
    tint: -1,
    overprint: false,
    pointSize: null,
    ...over,
  };
}

describe("isJudgeable", () => {
  it("суцільний колір із прочитаним значенням судиться", () => {
    expect(isJudgeable(site())).toBe(true);
  });

  it("«None» не судиться — це відсутність кольору, а не колір", () => {
    expect(isJudgeable(site({
      color: { named: "None", model: "PROCESS", space: "unknown", value: null, kind: "none" },
    }))).toBe(false);
  });

  it("градієнт сам по собі не судиться — судяться його точки окремими кортежами", () => {
    expect(isJudgeable(site({
      color: { named: "Захід", model: "PROCESS", space: "unknown", value: null, kind: "gradient" },
    }))).toBe(false);
  });
});

describe("isUsage", () => {
  it("зразок у палітрі ужитком НЕ є — спек §5.2", () => {
    expect(isUsage(site({ surface: "swatch", role: "definition" }))).toBe(false);
  });

  it("той самий колір на об'єкті — ужиток", () => {
    expect(isUsage(site())).toBe(true);
  });

  it("визначення СТИЛЮ лишається ужитком: стиль лягає на кожен свій ужиток", () => {
    expect(isUsage(site({ surface: "styleDefinition", role: "definition" }))).toBe(true);
  });
});

describe("selectSites", () => {
  /*
   * Гейт зразка. `[Registration]` = 100/100/100/100 є в КОЖНОМУ документі
   * InDesign і не видаляється; без цього рядка інструмент доповідав би
   * tac-over-limit 400 % на будь-якому файлі світу — доведено виконанням.
   */
  it("викидає ВИЗНАЧЕННЯ зразка: [Registration] є в кожному документі й не видаляється", () => {
    const registration = site({
      siteId: 2, surface: "swatch", role: "definition", ownerKind: "Color",
      ownerName: "Registration", page: null, layer: "—",
      color: {
        named: "Registration", model: "REGISTRATION", space: "CMYK",
        value: [100, 100, 100, 100], kind: "solid",
      },
    });
    const kept = selectSites([site(), registration], {
      includeNonPrinting: true,
      includeHidden: true,
    });
    expect(kept.map((s) => s.siteId)).toEqual([1]);
  });

  it("жоден параметр не повертає зразків: визначення не стає ужитком за прапорцем", () => {
    const registration = site({ surface: "swatch", role: "definition" });
    expect(selectSites([registration], { includeNonPrinting: true, includeHidden: true }))
      .toEqual([]);
  });

  it("за замовчуванням викидає недруковані шари — інакше форзац дає вісім хибних", () => {
    const kept = selectSites([site(), site({ siteId: 2, printable: false })], {
      includeNonPrinting: false,
      includeHidden: false,
    });
    expect(kept.map((s) => s.siteId)).toEqual([1]);
  });

  it("з includeNonPrinting віддає і недруковані — свідомий вибір людини", () => {
    const kept = selectSites([site(), site({ siteId: 2, printable: false })], {
      includeNonPrinting: true,
      includeHidden: false,
    });
    expect(kept.map((s) => s.siteId)).toEqual([1, 2]);
  });

  it("за замовчуванням викидає приховані шари — вони не друкуються й не йдуть у PDF", () => {
    const kept = selectSites([site(), site({ siteId: 2, visible: false })], {
      includeNonPrinting: false,
      includeHidden: false,
    });
    expect(kept.map((s) => s.siteId)).toEqual([1]);
  });

  it("з includeHidden судить і приховані — свідомий вибір людини", () => {
    const kept = selectSites([site(), site({ siteId: 2, visible: false })], {
      includeNonPrinting: false,
      includeHidden: true,
    });
    expect(kept.map((s) => s.siteId)).toEqual([1, 2]);
  });

  it("несудні кортежі викидає завжди, незалежно від шару", () => {
    const none = site({
      siteId: 3,
      color: { named: "None", model: "PROCESS", space: "unknown", value: null, kind: "none" },
    });
    expect(selectSites([none], { includeNonPrinting: true, includeHidden: true })).toEqual([]);
  });

  it("заливка об'єкта нульової площі не судиться — лінія не має нутра", () => {
    const kept = selectSites([site(), site({ siteId: 2, laysInk: false })], {
      includeNonPrinting: false, includeHidden: false,
    });
    expect(kept.map((s) => s.siteId)).toEqual([1]);
  });

  it("жоден параметр не повертає колір, що не лягає фарбою — це фізика, не намір", () => {
    const kept = selectSites([site({ laysInk: false })], {
      includeNonPrinting: true, includeHidden: true,
    });
    expect(kept).toEqual([]);
  });
});

describe("groupSites", () => {
  it("однакове значення з різних сторінок — одна група", () => {
    const groups = groupSites([site({ page: "17" }), site({ siteId: 2, page: "25" })]);
    expect(groups.size).toBe(1);
    expect([...groups.values()][0]).toHaveLength(2);
  });

  it("той самий колір під іншим відтінком — РІЗНІ групи: фарби лягає різно", () => {
    const groups = groupSites([site(), site({ siteId: 2, tint: 40 })]);
    expect(groups.size).toBe(2);
  });

  it("іменований і безіменний із тим самим значенням — різні групи", () => {
    const named = site({
      siteId: 2,
      color: { named: "Лінія", model: "PROCESS", space: "CMYK", value: [76, 48, 66, 70], kind: "solid" },
    });
    expect(groupSites([site(), named]).size).toBe(2);
  });
});

describe("pagesOf", () => {
  it("сторінки впорядковані числом, а не рядком: 9 перед 17", () => {
    expect(pagesOf([site({ page: "17" }), site({ siteId: 2, page: "9" })])).toEqual(["9", "17"]);
  });

  it("майстер називається своїм іменем, а не порожнім місцем", () => {
    expect(pagesOf([site({ page: null, master: "A-Основна" })])).toEqual(["master A-Основна"]);
  });

  it("однакові сторінки не дублюються", () => {
    expect(pagesOf([site({ page: "17" }), site({ siteId: 2, page: "17" })])).toEqual(["17"]);
  });
});

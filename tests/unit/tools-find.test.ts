import { describe, it, expect } from "vitest";
import { styleWarnings, registerFindTools, type RangeStyleInfo } from "../../src/tools/find.js";
import type { Tools } from "../../src/tools/shared.js";

const info = (over: Partial<RangeStyleInfo> = {}): RangeStyleInfo => ({
  containerId: "story:0",
  start: 0,
  end: 10,
  charStyles: ["[None]"],
  paraStyles: ["Body"],
  ...over,
});

/*
 * T1 (тріаж фінальної рецензії): саме styleWarnings вирішує, чи попередити
 * користувача про запис через межу стилю, і вона не була покрита жодним
 * тестом — хоча це чистий TypeScript без InDesign.
 */
describe("styleWarnings", () => {
  it("один символьний і один абзацний стиль — попереджати нема про що", () => {
    expect(styleWarnings(info())).toEqual([]);
  });

  it("два символьні стилі — попередження про символьні", () => {
    expect(styleWarnings(info({ charStyles: ["[None]", "Kursyv"] }))).toEqual([
      "multiple-char-styles",
    ]);
  });

  it("два абзацні стилі — попередження про абзацні", () => {
    expect(styleWarnings(info({ paraStyles: ["Body", "Zaholovok"] }))).toEqual([
      "multiple-para-styles",
    ]);
  });

  it("обидві межі перетнуто — обидва попередження", () => {
    const w = styleWarnings(info({ charStyles: ["a", "b"], paraStyles: ["c", "d"] }));
    expect(w).toEqual(["multiple-char-styles", "multiple-para-styles"]);
  });

  it("порожні списки стилів (порожній діапазон) попереджень не дають", () => {
    expect(styleWarnings(info({ charStyles: [], paraStyles: [] }))).toEqual([]);
  });
});

/*
 * T2: опис інструмента обіцяв сторінку й контекст для ОБОХ режимів, а
 * grep-режим віддає сирий {containerId, start, end, text} без docName, page і
 * contextBefore/After (див. src/jsx/find.jsx, handlers.grep_find). Розбіжність
 * форми відповіді успадкована з плану й лишається у Фазі 2 — до реальності
 * приводиться саме ОПИС.
 */
describe("опис інструмента text_find (T2)", () => {
  function descriptionOf(): string {
    let description = "";
    const fakeServer = {
      registerTool: (_name: string, config: { description: string }) => {
        description = config.description;
      },
    } as unknown as Tools;
    registerFindTools(fakeServer);
    return description;
  }

  it("не обіцяє сторінку й контекст для grep-режиму", () => {
    const d = descriptionOf();
    // Обіцянка «повертає сторінку … і контекст» без застереження про grep —
    // це саме те, чого grep-режим не віддає.
    expect(d).toMatch(/grep/i);
    expect(d).toMatch(/no\s+(docName|page)|only\s+.*plain|plain mode/i);
  });

  it("прямо називає поля, які повертає grep-режим", () => {
    const d = descriptionOf();
    expect(d).toContain("containerId");
    expect(d).toContain("start");
    expect(d).toContain("end");
  });
});

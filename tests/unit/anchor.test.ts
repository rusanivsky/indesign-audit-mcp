import { describe, expect, it } from "vitest";
import {
  buildWordAnchor,
  findAnchorRanges,
  needsAnchor,
  SHORT_EDIT_MAX,
} from "../../src/corrections/anchor.js";

describe("needsAnchor", () => {
  it("вмикається на однобуквених і дволітерних правках", () => {
    expect(needsAnchor("ь")).toBe(true);
    expect(needsAnchor("ся")).toBe(true);
    expect(needsAnchor(" ь ")).toBe(true);
  });

  it("не вмикається на довших фрагментах", () => {
    expect(needsAnchor("життя")).toBe(false);
    expect(SHORT_EDIT_MAX).toBe(2);
  });
});

describe("buildWordAnchor", () => {
  it("відновлює слово цілком і позицію літери в ньому", () => {
    const anchor = buildWordAnchor({
      markedText: "ь",
      contextBefore: "усе своє життя вона мріяла про знанн",
      contextAfter: " і про спокій",
    });
    expect(anchor).not.toBeNull();
    expect(anchor!.word).toBe("знаннь");
    expect(anchor!.offsetInWord).toBe(5);
    expect(anchor!.length).toBe(1);
  });

  it("бере сусідні слова з обох боків", () => {
    const anchor = buildWordAnchor({
      markedText: "ь",
      contextBefore: "вона мріяла про знанн",
      contextAfter: " і про спокій",
    });
    expect(anchor!.before).toEqual(["мріяла", "про"]);
    expect(anchor!.after).toEqual(["і", "про"]);
  });

  it("повертає null, коли контексту немає зовсім", () => {
    expect(buildWordAnchor({ markedText: "ь", contextBefore: "", contextAfter: "" })).toBeNull();
  });
});

describe("findAnchorRanges", () => {
  const source =
    "Мати казала: знання — це сила. Усе своє життя вона мріяла про знаннь і про спокій, " +
    "бо знаннь без спокою мало варте.";

  it("знаходить рівно одне місце, коли сусіди унікальні", () => {
    const anchor = buildWordAnchor({
      markedText: "ь",
      contextBefore: "вона мріяла про знанн",
      contextAfter: " і про спокій",
    })!;
    const ranges = findAnchorRanges(source, anchor);
    expect(ranges).toHaveLength(1);
    expect(source.slice(ranges[0]!.start, ranges[0]!.end)).toBe("ь");
    // Саме те входження, що після «мріяла про», а не те, що після «бо».
    expect(source.slice(0, ranges[0]!.start)).toContain("мріяла про знанн");
  });

  it("повертає кілька діапазонів, коли сусіди не розрізняють місця", () => {
    const anchor = buildWordAnchor({
      markedText: "ь",
      contextBefore: "знанн",
      contextAfter: "",
    })!;
    expect(findAnchorRanges(source, anchor).length).toBeGreaterThan(1);
  });

  it("повертає порожньо, коли слова в документі немає", () => {
    const anchor = buildWordAnchor({
      markedText: "ь",
      contextBefore: "цілковит",
      contextAfter: " спокій",
    })!;
    expect(findAnchorRanges(source, anchor)).toEqual([]);
  });

  it("не плутає слово зі своїм префіксом", () => {
    const text = "знан і знання поруч";
    const anchor = buildWordAnchor({
      markedText: "н",
      contextBefore: "зна",
      contextAfter: " і знання",
    })!;
    const ranges = findAnchorRanges(text, anchor);
    expect(ranges).toHaveLength(1);
    expect(ranges[0]!.start).toBe(3);
  });
});

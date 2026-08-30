import { describe, expect, it } from "vitest";
import {
  countLanguageRuns,
  fullyInLanguage,
  mergedRuns,
  UK_LANGUAGE,
} from "../../src/typography/langgate.js";
import type { ContainerLanguage } from "../../src/spelling/types.js";

const c = (id: string, runs: Array<[number, number, string]>): ContainerLanguage => ({
  containerId: id,
  runs: runs.map(([start, end, language]) => ({ start, end, language })),
});

describe("mergedRuns", () => {
  it("СКЛЕЮЄ сусідні діапазони однієї мови", () => {
    /* language_runs_read будує діапазони з textStyleRanges, а ті рвуться на
     * БУДЬ-ЯКІЙ зміні оформлення — на півжирному слові посеред речення теж.
     * Без склеювання гейт «цілком усередині» відкинув би законний збіг, що
     * перетнув межу НАКРЕСЛЕННЯ, а не мови. */
    const m = mergedRuns([c("story:0", [[0, 5, "Ukrainian"], [5, 12, "Ukrainian"]])]);
    expect(m.get("story:0")).toEqual([{ start: 0, end: 12, language: "Ukrainian" }]);
  });

  it("НЕ склеює діапазони різних мов", () => {
    const m = mergedRuns([c("story:0", [[0, 5, "Ukrainian"], [5, 12, "Russian"]])]);
    expect(m.get("story:0")).toHaveLength(2);
  });

  it("НЕ склеює однакові мови через розрив", () => {
    const m = mergedRuns([c("story:0", [[0, 5, "Ukrainian"], [7, 12, "Ukrainian"]])]);
    expect(m.get("story:0")).toHaveLength(2);
  });
});

describe("fullyInLanguage", () => {
  const runs = mergedRuns([c("story:0", [[0, 10, "Ukrainian"], [10, 20, "Russian"]])])
    .get("story:0");

  it("збіг ЦІЛКОМ усередині української — пропускає", () => {
    expect(fullyInLanguage(runs, 2, 6, UK_LANGUAGE)).toBe(true);
  });

  it("збіг ЦІЛКОМ усередині російської — відкидає (а український — пропускає)", () => {
    /* Позитивний близнюк стоїть у ТОМУ САМОМУ тесті: «в російському немає»
     * істинне й тоді, коли гейт не працює взагалі (борг Фази 10). */
    expect(fullyInLanguage(runs, 12, 16, UK_LANGUAGE)).toBe(false);
    expect(fullyInLanguage(runs, 2, 6, UK_LANGUAGE)).toBe(true);
  });

  it("збіг НА МЕЖІ мов відкидається, хоч і починається в українській", () => {
    expect(fullyInLanguage(runs, 8, 12, UK_LANGUAGE)).toBe(false);
    expect(fullyInLanguage(runs, 8, 10, UK_LANGUAGE)).toBe(true);
  });

  it("контейнера без діапазонів немає — відкидає, а не пропускає мовчки", () => {
    expect(fullyInLanguage(undefined, 0, 1, UK_LANGUAGE)).toBe(false);
  });
});

describe("countLanguageRuns", () => {
  it("рахує СКЛЕЄНІ діапазони, не сирі", () => {
    const langs = [
      c("story:0", [[0, 5, "Ukrainian"], [5, 12, "Ukrainian"], [12, 20, "Russian"]]),
      c("story:1", [[0, 4, "Ukrainian"]]),
    ];
    expect(countLanguageRuns(langs, UK_LANGUAGE)).toBe(2);
  });

  it("мови, якої немає, — нуль (і українська при цьому не нуль)", () => {
    const langs = [c("story:0", [[0, 5, "Ukrainian"]])];
    expect(countLanguageRuns(langs, "Vietnamese")).toBe(0);
    expect(countLanguageRuns(langs, UK_LANGUAGE)).toBe(1);
  });
});

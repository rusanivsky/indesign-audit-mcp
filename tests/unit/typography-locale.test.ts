import { describe, expect, it } from "vitest";
import { familyOf, LOCALE_FAMILY, sameFamily } from "../../src/typography/locale.js";
import {
  allRuleIds,
  crossLocaleApplies,
  inForeignLocale,
  observedLanguages,
  rulesFor,
} from "../../src/typography/packs.js";
import { scanContainers } from "../../src/tools/typography.js";
import type { ContainerLanguage } from "../../src/spelling/types.js";
import type { ContainerSnapshot } from "../../src/corrections/types.js";

/* The names are the ones InDesign 21.5.1.73 actually returns — measured, not
 * invented (docs/measured-facts-bilingual.md M4). */
describe("familyOf — against the measured InDesign names", () => {
  it("regional English variants all collapse to one family", () => {
    for (const n of ["English: UK", "English: USA", "English: Canadian",
                     "English: USA Medical", "English: USA Legal"]) {
      expect(familyOf(n), n).toBe("English");
    }
  });

  it("a name without a colon is its own family — which is why Ukrainian is unchanged", () => {
    expect(familyOf("Ukrainian")).toBe("Ukrainian");
    expect(LOCALE_FAMILY.uk).toBe("Ukrainian");
  });

  it("[No Language] is a real value and its own family", () => {
    expect(familyOf("[No Language]")).toBe("[No Language]");
    expect(sameFamily("[No Language]", "English: USA")).toBe(false);
  });

  it("both English locales share one family — the school is not the language", () => {
    expect(LOCALE_FAMILY["en-US"]).toBe(LOCALE_FAMILY["en-GB"]);
  });
});

describe("inForeignLocale — unknown means ALLOW, not deny", () => {
  const runs = (language: string) => [{ start: 0, end: 100, language }];

  it("Ukrainian text is foreign to an English rule", () => {
    expect(inForeignLocale(runs("Ukrainian"), 5, 10, "en-US")).toBe(true);
  });

  it("English text is foreign to a Ukrainian rule", () => {
    expect(inForeignLocale(runs("English: UK"), 5, 10, "uk")).toBe(true);
  });

  it("the two English schools are NOT foreign to each other", () => {
    expect(inForeignLocale(runs("English: UK"), 5, 10, "en-US")).toBe(false);
  });

  it("[No Language] is never foreign — otherwise every unlabelled document goes silent", () => {
    expect(inForeignLocale(runs("[No Language]"), 5, 10, "uk")).toBe(false);
  });

  it("a family we have no pack for is not foreign either", () => {
    expect(inForeignLocale(runs("Thai"), 5, 10, "uk")).toBe(false);
  });

  it("no ranges at all means allow", () => {
    expect(inForeignLocale(undefined, 5, 10, "uk")).toBe(false);
  });

  it("a match crossing a range boundary is not judged foreign", () => {
    const mixed = [{ start: 0, end: 10, language: "Ukrainian" },
                   { start: 10, end: 20, language: "English: UK" }];
    expect(inForeignLocale(mixed, 5, 15, "uk")).toBe(false);
  });
});

/*
 * REGRESSION on the hazard the live measurement exposed
 * (docs/measured-facts-bilingual.md M5): a NEW InDesign document defaults to
 * `English: USA`, so a Ukrainian book nobody relabelled is English throughout.
 * Without the multi-family guard, `locale: "uk"` on such a book would skip every
 * quote and dash match and report a confident zero.
 */
describe("crossLocaleApplies — the guard against a confident zero", () => {
  const lang = (...names: string[]): ContainerLanguage[] => [{
    containerId: "story:0",
    runs: names.map((language, i) => ({ start: i * 10, end: i * 10 + 10, language })),
  }];

  it("a document labelled only English does NOT engage the skip", () => {
    expect(crossLocaleApplies(lang("English: USA", "English: USA"))).toBe(false);
  });

  it("a document labelled only Ukrainian does not engage it either", () => {
    expect(crossLocaleApplies(lang("Ukrainian"))).toBe(false);
  });

  it("a genuinely bilingual document DOES engage it", () => {
    expect(crossLocaleApplies(lang("Ukrainian", "English: UK"))).toBe(true);
  });

  it("[No Language] beside one real family is not bilingual", () => {
    expect(crossLocaleApplies(lang("Ukrainian", "[No Language]"))).toBe(false);
  });
});

describe("scanContainers — the guard in force end to end", () => {
  const snap = (text: string): ContainerSnapshot => ({
    containerId: "story:0",
    text,
    pageRuns: [{ start: 0, end: text.length, page: "1" }],
    isMaster: false,
  } as ContainerSnapshot);

  const TEXT = 'вона сказала "привіт" і пішла';

  it("Ukrainian quotes still fire on a book mislabelled English throughout", () => {
    const langs: ContainerLanguage[] = [{
      containerId: "story:0",
      runs: [{ start: 0, end: TEXT.length, language: "English: USA" }],
    }];
    const r = scanContainers([snap(TEXT)], rulesFor("uk"), langs);
    expect(r.matches.some((m) => m.ruleId === "quotes-uk")).toBe(true);
    expect(r.skippedByLocale).toBe(0);
  });

  it("but in a truly bilingual document the foreign range IS protected", () => {
    const mixed = `${TEXT} and then "hello" here`;
    const langs: ContainerLanguage[] = [{
      containerId: "story:0",
      runs: [
        { start: 0, end: TEXT.length, language: "Ukrainian" },
        { start: TEXT.length, end: mixed.length, language: "English: USA" },
      ],
    }];
    const r = scanContainers([snap(mixed)], rulesFor("uk"), langs);
    expect(r.skippedByLocale).toBeGreaterThan(0);
    for (const m of r.matches) expect(m.start).toBeLessThan(TEXT.length);
  });
});

describe("packs", () => {
  it("every locale resolves to a non-empty pack", () => {
    for (const l of ["uk", "en-US", "en-GB"] as const) {
      expect(rulesFor(l).length).toBeGreaterThan(5);
    }
  });

  it("allRuleIds covers every pack and has no duplicates", () => {
    const all = allRuleIds();
    expect(new Set(all).size).toBe(all.length);
    for (const l of ["uk", "en-US", "en-GB"] as const) {
      for (const r of rulesFor(l)) expect(all).toContain(r.id);
    }
  });
});

describe("observedLanguages — so a zero reads as a zero", () => {
  it("reports the raw name, its family and the run count, busiest first", () => {
    const langs: ContainerLanguage[] = [{
      containerId: "story:0",
      runs: [
        { start: 0, end: 10, language: "English: USA" },
        { start: 10, end: 20, language: "Ukrainian" },
        { start: 20, end: 30, language: "English: USA" },
      ],
    }];
    const seen = observedLanguages(langs);
    expect(seen[0]).toEqual({ name: "English: USA", family: "English", runs: 2 });
    expect(seen[1]).toEqual({ name: "Ukrainian", family: "Ukrainian", runs: 1 });
  });
});

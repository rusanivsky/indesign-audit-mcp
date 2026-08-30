import { describe, expect, it } from "vitest";
import { dictLangCode, dictPathsFor } from "../../src/spelling/dictpath.js";

describe("dictPathsFor", () => {
  it("будує шлях від кореня застосунку", () => {
    const s = dictPathsFor("/Applications/Adobe InDesign 2026", "uk_UA");
    expect(s.dicPath).toBe(
      "/Applications/Adobe InDesign 2026/Resources/Dictionaries/LILO/Linguistics/Providers/"
      + "Plugins2/AdobeHunspellPlugin.bundle/Contents/SharedSupport/Dictionaries/uk_UA/uk_UA.dic",
    );
    expect(s.affPath.endsWith("/uk_UA.aff")).toBe(true);
  });

  it("працює й для бета-збірки — шлях НЕ зашитий", () => {
    const s = dictPathsFor("/Applications/Adobe InDesign 2026 (Beta)", "uk_UA");
    expect(s.dicPath.startsWith("/Applications/Adobe InDesign 2026 (Beta)/")).toBe(true);
  });

  it("vintage тільки для українського словника", () => {
    const uk = dictPathsFor("/Applications/Adobe InDesign 2026", "uk_UA");
    expect(uk.vintage).toBe("spell-uk, © 1999–2009");
  });

  it("vintage дорівнює null для інших мов", () => {
    const de = dictPathsFor("/Applications/Adobe InDesign 2026", "de_DE");
    expect(de.vintage).toBeNull();

    const en = dictPathsFor("/Applications/Adobe InDesign 2026", "en_US");
    expect(en.vintage).toBeNull();
  });
});

describe("dictLangCode", () => {
  it("зіставляє назву мови InDesign із кодом словника", () => {
    expect(dictLangCode("Ukrainian")).toBe("uk_UA");
    expect(dictLangCode("English: USA")).toBe("en_US");
  });

  it("для [No Language] віддає null — словника НЕМАЄ, і це не помилка", () => {
    expect(dictLangCode("[No Language]")).toBeNull();
  });

  it("для незнаної мови віддає null, а не вгадує", () => {
    expect(dictLangCode("Klingon")).toBeNull();
  });

  it("не піддається prototype pollution — constructor повертає null", () => {
    expect(dictLangCode("constructor")).toBeNull();
    expect(dictLangCode("toString")).toBeNull();
    expect(dictLangCode("hasOwnProperty")).toBeNull();
  });

  it("override переозначує вбудовані зіставлення", () => {
    const override = { "Ukrainian": "uk_override", "Custom": "xx_YY" };
    expect(dictLangCode("Ukrainian", override)).toBe("uk_override");
    expect(dictLangCode("Custom", override)).toBe("xx_YY");
  });

  it("override дозволяє явно повернути null", () => {
    const override = { "Ukrainian": null };
    expect(dictLangCode("Ukrainian", override)).toBeNull();
  });

  it("без override вбудовані зіставлення й далі працюють", () => {
    expect(dictLangCode("English: UK")).toBe("en_GB");
  });
});

/*
 * Тут стояв describe("availableDictCodes") — прибрано разом із самою
 * функцією (dictpath.ts): вона не мала жодного продакшн-споживача, а її
 * питання «чи є тека мови» вже точніше закрите `loadDictionarySource`,
 * чиї межі ENOENT / решта-помилок перевіряє tests/unit/spelling-tool.test.ts.
 * Побічно це прибрало й залежність юніт-набору від точного шляху
 * встановлення InDesign у цьому файлі.
 */

/*
 * П'ЯТЬ АНГЛІЙСЬКИХ НАЗВ, А НЕ ДВІ.
 *
 * `src/typography/locale.ts` зафіксував вимір `app.languagesWithVendors`
 * (2026-08-25) і прямо застеріг: ворота на буквальному «English: USA»
 * замовкли б на Medical і Legal. Ця мапа саме такою й була, тож абзац із
 * `English: Canadian` діставав null, кожне його слово ставало
 * `word-not-checked`, а воно рахується в `deviating` — коректний англійський
 * текст роздувáв число відхилень, і причина не називалася.
 */
describe("усі англійські назви InDesign мають словник", () => {
  it.each([
    ["English: USA", "en_US"],
    ["English: USA Medical", "en_US"],
    ["English: USA Legal", "en_US"],
    ["English: UK", "en_GB"],
    ["English: Canadian", "en_GB"],
  ])("%s → %s", (name, code) => {
    expect(dictLangCode(name, {})).toBe(code);
  });

  it("НЕГАТИВНИЙ КОНТРОЛЬ: [No Language] словника не має — це стан, а не хиба", () => {
    /* Без цього мапа, що віддає щось на будь-яку назву, склала б усі
     * перевірки вище й підсунула б англійський словник чужому текстові. */
    expect(dictLangCode("[No Language]", {})).toBeNull();
    expect(dictLangCode("Klingon", {})).toBeNull();
  });
});

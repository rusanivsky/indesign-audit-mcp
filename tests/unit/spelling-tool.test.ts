import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { parseAff } from "../../src/spelling/aff.js";
import { buildDictionary } from "../../src/spelling/dic.js";
import { collectAudit, loadDictionarySource } from "../../src/tools/spelling.js";

const aff = parseAff(["WORDCHARS -'"].join("\n"));
const dicts = new Map([["uk_UA", buildDictionary("1\nслово", aff)]]);
const affs = new Map([["uk_UA", aff]]);
const c = (text: string) =>
  ({ containerId: "story:0", text, pageRuns: [{ start: 0, end: text.length, page: "1" }],
     oversetFrom: null, isMaster: false, kind: "text" as const });

describe("collectAudit", () => {
  it("родина language вимикається параметром", () => {
    const t = "слово жабуринка";
    const langs = [{ containerId: "story:0", runs: [
      { start: 0, end: t.length, language: "[No Language]" },
    ] }];
    const r = collectAudit([c(t)], langs, affs, dicts, { family: "dictionary" });
    expect(r.language).toEqual([]);
    expect(r.words.length).toBeGreaterThan(0);
  });

  it("родина dictionary вимикається параметром", () => {
    const t = "слово жабуринка";
    const langs = [{ containerId: "story:0", runs: [
      { start: 0, end: t.length, language: "[No Language]" },
    ] }];
    const r = collectAudit([c(t)], langs, affs, dicts, { family: "language" });
    expect(r.words).toEqual([]);
    expect(r.language.length).toBeGreaterThan(0);
  });

  it("без family працюють обидві", () => {
    const t = "слово жабуринка";
    const langs = [{ containerId: "story:0", runs: [
      { start: 0, end: t.length, language: "Ukrainian" },
    ] }];
    const r = collectAudit([c(t)], langs, affs, dicts, {});
    expect(r.words).toHaveLength(1);
  });

  /*
   * Рецензія T8 (progress.md, «T8 ПЕРЕВІДКРИТО»): інвентар — обов'язкова
   * частина результату collectAudit, НЕЗАЛЕЖНО від family. Без нього
   * неможливо зрозуміти, чому слова діапазону не перевірялись (двомовне
   * видання), і саме тому buildReport (report.ts) СВІДОМО його не несе —
   * інвентар мусить дійти до відповіді інструмента якимось ІНШИМ шляхом.
   */
  it("languages (інвентар) віддається ЗАВЖДИ, навіть коли family = 'dictionary'", () => {
    const t = "слово";
    const langs = [{ containerId: "story:0", runs: [
      { start: 0, end: t.length, language: "Ukrainian" },
    ] }];
    const r = collectAudit([c(t)], langs, affs, dicts, { family: "dictionary" });
    expect(r.languages).toHaveLength(1);
    expect(r.languages[0]).toMatchObject({ language: "Ukrainian", words: 1 });
  });

  it("languageDictionaries прокидається аж до detectUnknown і tallyLanguages", () => {
    /* «Czech» немає у вбудованій таблиці dictpath.ts — без override слово
     * дістало б word-not-checked, а не word-unknown/чисто. */
    const t = "slovo";
    const langs = [{ containerId: "story:0", runs: [
      { start: 0, end: t.length, language: "Czech" },
    ] }];
    const csAffs = new Map([["cs_CZ", aff]]);
    const csDicts = new Map([["cs_CZ", buildDictionary("1\nslovo", aff)]]);

    const withoutOverride = collectAudit([c(t)], langs, csAffs, csDicts, {});
    expect(withoutOverride.words[0]).toMatchObject({ defect: "word-not-checked" });

    const withOverride = collectAudit([c(t)], langs, csAffs, csDicts, {
      languageDictionaries: { Czech: "cs_CZ" },
    });
    expect(withOverride.words).toEqual([]);
  });
});

describe("loadDictionarySource", () => {
  it("ENOENT (файла немає) — вимірений стан, повертає null", () => {
    const src = {
      dicPath: "/tmp/spelling-does-not-exist-xyz/x.dic",
      affPath: "/tmp/spelling-does-not-exist-xyz/x.aff",
      vintage: null,
    };
    expect(loadDictionarySource("xx_XX", src)).toBeNull();
  });

  it("не-ENOENT помилка кидається з контекстом, а не ковтається як «немає словника»", () => {
    /* Директорія замість файлу дає EISDIR, не ENOENT: та сама межа, що
     * відрізняє «файла справді немає» від «щось інше пішло не так» —
     * зіпсований файл чи баг у власному parseAff/buildDictionary (Задача
     * 16, Крок 3). Тест червоніє, якщо catch знову ковтає все підряд. */
    const dir = tmpdir();
    const src = { dicPath: dir, affPath: dir, vintage: null };
    expect(() => loadDictionarySource("xx_XX", src)).toThrow("xx_XX");
  });
});

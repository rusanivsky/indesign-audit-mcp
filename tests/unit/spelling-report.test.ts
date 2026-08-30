import { describe, expect, it } from "vitest";
import { buildReport, SMALL_FIELDS_SAFETY_MARGIN_BYTES } from "../../src/spelling/report.js";
import { serialise } from "../../src/serialise.js";

const w = (word: string, count: number) =>
  ({ defect: "word-unknown" as const, word, count, pages: ["1"], pageCount: 1, language: "Ukrainian" });

/** Той самий формат, яким `buildReport` рахує байти поля (report.ts,
 * `fieldBytes`), і той самий, яким `ok()` віддає відповідь. */
const fieldBytes = (key: string, value: unknown) =>
  Buffer.byteLength(serialise({ [key]: value }), "utf8");

describe("buildReport", () => {
  it("сортує за частотою ВГОРУ — одрук трапляється раз", () => {
    const r = buildReport({ language: [], words: [w("часте", 47), w("рідке", 1), w("середнє", 5)] });
    expect(r.words.map((x) => x.word)).toEqual(["рідке", "середнє", "часте"]);
  });

  it("word-unknown НЕ рахується відхиленням, language-none — рахується", () => {
    const r = buildReport({
      language: [{ defect: "language-none", containerId: "story:0", page: "31",
                   language: "[No Language]", start: 0, end: 5, words: 2, sample: "аб" }],
      words: [w("жабуринка", 1)],
    });
    expect(r.deviating).toBe(1);
  });

  it("обрізання ДЕТАЛІ НАЗИВАЄТЬСЯ, а не мовчить — бюджет БАЙТІВ, не число рядків", () => {
    /* П'ять однаково довгих рядків (той самий формат "слN", N — одна
     * цифра). Бюджет — рівно на: фіксовані поля (language + запас) + повні
     * голі списки (обидва все одно мусять вміститись повністю) + перші три
     * ДЕТАЛЬНІ рядки. Тест червоніє, якщо стелю знову рахувати рядками чи
     * компактними символами замість справжніх байтів (Задача 16, Крок 2;
     * формула бюджету — раунд 2). */
    const words = Array.from({ length: 5 }, (_, i) => w(`сл${i}`, i + 1));
    const languageBytes = fieldBytes("language", []);
    const bareBytesFull = Buffer.byteLength(
      serialise({ wordsAll: words.map((x) => x.word), wordsNotCheckedAll: [] }),
      "utf8",
    );
    const budget =
      languageBytes + SMALL_FIELDS_SAFETY_MARGIN_BYTES + bareBytesFull + fieldBytes("words", words.slice(0, 3));
    const r = buildReport({ language: [], words, maxResponseBytes: budget });
    expect(r.words).toHaveLength(3);
    expect(r.wordsAll).toHaveLength(5); // голі списки лишаються повними
    expect(r.truncated).toMatchObject({ shown: 3, total: 5, wordsAllShown: 5, wordsAllTotal: 5 });
  });

  it("бюджет обрізає САМЕ найчастотніші рядки — вони йдуть останніми", () => {
    const words = Array.from({ length: 5 }, (_, i) => w(`сл${i}`, i + 1));
    const languageBytes = fieldBytes("language", []);
    const bareBytesFull = Buffer.byteLength(
      serialise({ wordsAll: words.map((x) => x.word), wordsNotCheckedAll: [] }),
      "utf8",
    );
    const budget =
      languageBytes + SMALL_FIELDS_SAFETY_MARGIN_BYTES + bareBytesFull + fieldBytes("words", words.slice(0, 3));
    const r = buildReport({ language: [], words, maxResponseBytes: budget });
    expect(r.words.map((x) => x.count)).toEqual([1, 2, 3]);
  });

  it("ПОВНОТА не залежить від деталі — усі слово-типи є в wordsAll/wordsNotCheckedAll, навіть коли words обрізано до нуля", () => {
    /* Бюджету вистачає РІВНО на фіксовані поля й повні голі списки, нуль —
     * на деталь. Тест червоніє, якщо wordsAll/wordsNotCheckedAll теж
     * обрізати замість того, щоб лишати повними, доки бюджет дозволяє. */
    const words = [
      ...Array.from({ length: 5 }, (_, i) => w(`уаа${i}`, 1)),
      { defect: "word-not-checked" as const, word: "нб0", count: 1, pages: ["1"], pageCount: 1, language: "[No Language]" },
      { defect: "word-not-checked" as const, word: "нб1", count: 1, pages: ["1"], pageCount: 1, language: "[No Language]" },
    ];
    const languageBytes = fieldBytes("language", []);
    const bareBytesFull = Buffer.byteLength(
      JSON.stringify(
        { wordsAll: ["уаа0", "уаа1", "уаа2", "уаа3", "уаа4"], wordsNotCheckedAll: ["нб0", "нб1"] },
        null,
        2,
      ),
      "utf8",
    );
    const budget = languageBytes + SMALL_FIELDS_SAFETY_MARGIN_BYTES + bareBytesFull; // нуль на words
    const r = buildReport({ language: [], words, maxResponseBytes: budget });
    expect(r.words).toHaveLength(0);
    expect(r.wordsAll.sort()).toEqual(["уаа0", "уаа1", "уаа2", "уаа3", "уаа4"]);
    expect(r.wordsNotCheckedAll.sort()).toEqual(["нб0", "нб1"]);
    expect(r.wordsAll.length + r.wordsNotCheckedAll.length).toBe(r.wordTypesTotal);
    expect(r.truncated?.note).not.toMatch(/isn't/);
  });

  it("СТЕЛЯ виграє над ПОВНОТОЮ на крайньому випадку — бюджету бракує навіть на голі списки, truncated називає це прямо", () => {
    /* Раунд 2 рецензії: на непомірно великому виданні навіть wordsAll/
     * wordsNotCheckedAll можуть не влізти в бюджет. Це МАЄ бути видно —
     * тест червоніє, якщо бюджет продовжує вважати голі списки недоторканими
     * (тобто повертає їх повністю попри замалий бюджет), або якщо truncated
     * не називає, що саме вирізано. */
    const words = Array.from({ length: 20 }, (_, i) => w(`слово${String(i).padStart(2, "0")}`, 1));
    const wordsAllFull = words.map((x) => x.word);
    const languageBytes = fieldBytes("language", []);
    const halfBareBytes = Buffer.byteLength(
      serialise({ wordsAll: wordsAllFull.slice(0, 10), wordsNotCheckedAll: [] }),
      "utf8",
    );
    // Бюджету вистачить лише на ПОЛОВИНУ голого списку — навіть повний
    // wordsAll (20 слів) не влізе.
    const budget = languageBytes + SMALL_FIELDS_SAFETY_MARGIN_BYTES + halfBareBytes;
    const r = buildReport({ language: [], words, maxResponseBytes: budget });

    expect(r.words).toHaveLength(0);
    expect(r.wordsAll.length).toBeGreaterThan(0);
    expect(r.wordsAll.length).toBeLessThan(20);
    expect(r.truncated).not.toBeNull();
    expect(r.truncated?.wordsAllShown).toBe(r.wordsAll.length);
    expect(r.truncated?.wordsAllTotal).toBe(20);
    expect(r.truncated?.note).toMatch(/isn't/);
  });

  it("без обрізання поле truncated дорівнює null, а не нулям", () => {
    const r = buildReport({ language: [], words: [w("а", 1)] });
    expect(r.truncated).toBeNull();
  });

  it("language-stray НЕ рахується відхиленням", () => {
    const r = buildReport({
      language: [{ defect: "language-stray", containerId: "story:0", page: "66",
                   language: "Vietnamese", start: 0, end: 1, words: 0, sample: "" }],
      words: [],
    });
    expect(r.deviating).toBe(0);
  });

  it("word-not-checked рахується відхиленням", () => {
    const r = buildReport({
      language: [],
      words: [{ defect: "word-not-checked", word: "хтозна", count: 1, pages: ["12"], pageCount: 1, language: "[No Language]" }],
    });
    expect(r.deviating).toBe(1);
  });
});

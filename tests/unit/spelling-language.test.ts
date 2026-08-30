import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  LANGUAGE_READ_ERROR,
  assertLanguageCoverage,
  assertNoLanguageReadErrors,
} from "../../src/spelling/langruns.js";
import { detectLanguage, tallyLanguages } from "../../src/spelling/language.js";
import { parseAff } from "../../src/spelling/aff.js";

const container = (id: string, text: string) =>
  ({ containerId: id, text, pageRuns: [], oversetFrom: null, isMaster: false, kind: "text" as const });

describe("assertLanguageCoverage", () => {
  it("мовчить, коли діапазони покривають увесь текст", () => {
    expect(() => assertLanguageCoverage(
      [container("story:0", "абвг")],
      [{ containerId: "story:0", runs: [{ start: 0, end: 4, language: "Ukrainian" }] }],
    )).not.toThrow();
  });

  it("КИДАЄ, коли для контейнера не прийшло діапазонів", () => {
    expect(() => assertLanguageCoverage([container("story:0", "абвг")], []))
      .toThrow(/story:0/);
  });

  it("КИДАЄ, коли діапазони не покривають увесь текст", () => {
    expect(() => assertLanguageCoverage(
      [container("story:0", "абвг")],
      [{ containerId: "story:0", runs: [{ start: 0, end: 2, language: "Ukrainian" }] }],
    )).toThrow(/2.*4|покрив/);
  });

  /*
   * Рецензія (Finding 2): порівняння лише СУМИ довжин діапазонів пропускає
   * розрив і перекриття, що взаємно скасовуються в сумі. Обидва приклади
   * нижче навмисно дають правильну суму — щоб довести, що перевірка сум САМА
   * ПО СОБІ їх не ловить, і потрібна саме перевірка суцільності курсора.
   */
  it("КИДАЄ, коли перший діапазон не починається з нуля (сума при цьому збігається)", () => {
    // текст довжиною 3, діапазон [1,4) — довжина теж 3, стара перевірка суми це пропустила б
    expect(() => assertLanguageCoverage(
      [container("story:0", "абв")],
      [{ containerId: "story:0", runs: [{ start: 1, end: 4, language: "Ukrainian" }] }],
    )).toThrow(/story:0/);
  });

  it("КИДАЄ, коли діапазони перекриваються (сума при цьому збігається)", () => {
    // [0,3) і [2,3): сума 3+1=4 = довжина тексту, але діапазон 2 починається
    // РАНІШЕ, ніж закінчився діапазон 1, — курсор розійшовся.
    expect(() => assertLanguageCoverage(
      [container("story:0", "абвг")],
      [{
        containerId: "story:0",
        runs: [
          { start: 0, end: 3, language: "Ukrainian" },
          { start: 2, end: 3, language: "Ukrainian" },
        ],
      }],
    )).toThrow(/story:0/);
  });
});

describe("assertNoLanguageReadErrors", () => {
  it("мовчить, коли всі мови прочитані успішно", () => {
    expect(() => assertNoLanguageReadErrors([
      { containerId: "story:0", runs: [{ start: 0, end: 4, language: "Ukrainian" }] },
    ])).not.toThrow();
  });

  it("[No Language] — легітимне значення, а не помилка читання: НЕ кидає", () => {
    expect(() => assertNoLanguageReadErrors([
      { containerId: "story:0", runs: [{ start: 0, end: 4, language: "[No Language]" }] },
    ])).not.toThrow();
  });

  it("КИДАЄ на сигнальному рядку помилки читання, а не тихо приймає його за дані", () => {
    expect(() => assertNoLanguageReadErrors([
      { containerId: "story:5", runs: [{ start: 0, end: 4, language: LANGUAGE_READ_ERROR }] },
    ])).toThrow(/story:5/);
  });
});

/* Один Aff і для Ukrainian, і для English: USA — жоден із наявних тестів
 * нижче не перевіряє відмінність меж слова між мовами, тож той самий набір
 * правил на обох ключах карти зберігає їхню поведінку дослівно такою, як
 * була до Кроку "affs: Map". [No Language] і Vietnamese не мають запису в
 * карті (dictLangCode повертає null) — вони йдуть через DEFAULT_WORD_AFF,
 * чий набір WORDCHARS ("-'") збігається з aff2, тож і це не міняє жодного
 * наявного результату. */
const aff2 = parseAff(["WORDCHARS -'"].join("\n"));
const affs2 = new Map([["uk_UA", aff2], ["en_US", aff2]]);
const c = (id: string, text: string) =>
  ({ containerId: id, text, pageRuns: [{ start: 0, end: text.length, page: "1" }],
     oversetFrom: null, isMaster: false, kind: "text" as const });

describe("сигнальний рядок помилки читання — одне значення у двох мовах", () => {
  it("літерал у spelling.jsx збігається з константою LANGUAGE_READ_ERROR", () => {
    /*
     * ExtendScript не може імпортувати константу з TypeScript, тож значення
     * живе двома копіями: `LANGUAGE_READ_ERROR` (langruns.ts) і три літерали
     * в catch-гілках spelling.jsx. Копії ніщо не зв'язувало, а розходження
     * було б НЕВИДИМИМ у найгірший спосіб: `assertNoLanguageReadErrors`
     * просто перестав би спрацьовувати, і збій читання appliedLanguage знову
     * став би невідрізненним від штатних даних — рівно та відмова, заради
     * якої окремий рядок і заводили. Тест читає сам файл JSX.
     */
    const jsx = readFileSync("src/jsx/spelling.jsx", "utf8");
    const literals = [...jsx.matchAll(/catch \(e\) \{ \w+ = "([^"]+)";/g)].map((m) => m[1]);
    /* Три гілки: story, виноска, комірка таблиці. Якщо їх стане менше —
     * значить, catch десь прибрали, і це теж треба побачити. */
    expect(literals).toHaveLength(3);
    for (const lit of literals) expect(lit).toBe(LANGUAGE_READ_ERROR);
  });
});

describe("tallyLanguages", () => {
  it("рахує СЛОВА, не діапазони й не символи", () => {
    /* Один діапазон Ukrainian на 3 слова проти двох діапазонів English по 0 слів.
     * Лічба діапазонів дала б English 2 : Ukrainian 1 — тобто навпаки. */
    const containers = [c("story:0", "один два три\r\r")];
    const langs = [{ containerId: "story:0", runs: [
      { start: 0, end: 12, language: "Ukrainian" },
      { start: 12, end: 13, language: "English: USA" },
      { start: 13, end: 14, language: "English: USA" },
    ] }];
    const t = tallyLanguages(containers, langs, affs2);
    expect(t[0]).toMatchObject({ language: "Ukrainian", words: 3, ranges: 1 });
    expect(t[1]).toMatchObject({ language: "English: USA", words: 0, ranges: 2 });
  });

  it("паралельний переклад НЕ дає знахідок — обидві мови просто в інвентарі", () => {
    /* Уточнення користувача: два тексти поряд, другий перекладає перший. */
    const containers = [c("story:0", "одне два три"), c("story:1", "one two three")];
    const langs = [
      { containerId: "story:0", runs: [{ start: 0, end: 12, language: "Ukrainian" }] },
      { containerId: "story:1", runs: [{ start: 0, end: 13, language: "English: USA" }] },
    ];
    expect(detectLanguage(containers, langs, affs2)).toEqual([]);
    expect(tallyLanguages(containers, langs, affs2)).toHaveLength(2);
  });

  it("несе сторінки — у двомовному макеті це головне", () => {
    const containers = [c("story:0", "слово")];
    const langs = [{ containerId: "story:0", runs: [
      { start: 0, end: 5, language: "Ukrainian" },
    ] }];
    const t = tallyLanguages(containers, langs, affs2)[0]!;
    expect(t.pages).toEqual(["1"]);
    expect(t.pageCount).toBe(1);
  });

  it("мова, що живе лише в OVERSET, відноситься на ОСТАННЮ розміщену сторінку", () => {
    /* Той самий борг, що в spelling/unknown.ts, і той самий спільний pageAt
     * (types.ts): інвентар мов теж називає сторінки, і для тексту за межею
     * розміщених рамок фолбек вирішує все. Історія розміщена на 10 і 11,
     * англійська вставка лежить ЗА кінцем останнього run — правильно "11".
     * Копія з `[0]` дала б "10". */
    const t = "слово слово oneword";
    const placedEnd = "слово слово ".length;
    const containers = [{
      containerId: "story:0",
      text: t,
      pageRuns: [
        { start: 0, end: 6, page: "10" },
        { start: 6, end: placedEnd, page: "11" },
      ],
      oversetFrom: placedEnd,
      isMaster: false,
      kind: "text" as const,
    }];
    const langs = [{ containerId: "story:0", runs: [
      { start: 0, end: placedEnd, language: "Ukrainian" },
      { start: placedEnd, end: t.length, language: "English: USA" },
    ] }];
    const tally = tallyLanguages(containers, langs, affs2);
    expect(tally.find((x) => x.language === "English: USA")).toMatchObject({ pages: ["11"] });
  });

  it("share — саме ЧАСТКА СЛІВ, а не діапазонів чи символів", () => {
    /* Число, яке людина читає як «скільки в книжці цієї мови». Досі його не
     * перевіряв жоден тест (відкладена дрібниця T8): частка, порахована по
     * діапазонах, дала б тут 0,5 на кожну мову замість 3/4 і 1/4. */
    const containers = [c("story:0", "один два три"), c("story:1", "one")];
    const langs = [
      { containerId: "story:0", runs: [{ start: 0, end: 12, language: "Ukrainian" }] },
      { containerId: "story:1", runs: [{ start: 0, end: 3, language: "English: USA" }] },
    ];
    const t = tallyLanguages(containers, langs, affs2);
    expect(t.find((x) => x.language === "Ukrainian")!.share).toBeCloseTo(0.75, 10);
    expect(t.find((x) => x.language === "English: USA")!.share).toBeCloseTo(0.25, 10);
    expect(t.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1, 10);
  });

  it("документ без жодного слова дає share 0, а не ділення на нуль", () => {
    const containers = [c("story:0", "\r")];
    const langs = [{ containerId: "story:0", runs: [
      { start: 0, end: 1, language: "Vietnamese" },
    ] }];
    expect(tallyLanguages(containers, langs, affs2)[0]!.share).toBe(0);
  });

  it("список сторінок мови обрізається до MAX_PAGES_LISTED, pageCount лишає повне число", () => {
    /* Дзеркало обрізання в рядку слова, і саме воно тримає стелю відповіді:
     * інвентар лежить у службовій частині, яку бюджет report.ts РЕЗЕРВУЄ, а
     * не ріже (фінальна рецензія гілки: шість мов по 900 сторінок давали
     * 83 004 Б при стелі 50 000). Тест червоніє, якщо межу знову знімуть. */
    const text = "слово ".repeat(10).trimEnd();
    const containers = [{
      containerId: "story:0",
      text,
      pageRuns: Array.from({ length: 10 }, (_, i) => (
        { start: i * 6, end: (i + 1) * 6, page: String(i + 1) })),
      oversetFrom: null, isMaster: false, kind: "text" as const,
    }];
    const langs = [{ containerId: "story:0", runs: Array.from({ length: 10 }, (_, i) => (
      { start: i * 6, end: Math.min((i + 1) * 6, text.length), language: "Ukrainian" })) }];
    const t = tallyLanguages(containers, langs, affs2)[0]!;
    expect(t.pages).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(t.pageCount).toBe(10);
  });

  it("перші шість — це перші за НОМЕРОМ, а не за порядком контейнерів", () => {
    /* Виміряно на книжці 2026-08-14: без сортування рядок дав
     * ["13","22","14","15","16","17"], бо порядок вставляння в Set — це
     * порядок КОНТЕЙНЕРІВ, а історії не йдуть за сторінками. Поки
     * показувались усі сторінки, це не важило; після обрізання до шести
     * порядок став самою відповіддю на «де ця мова живе». Контейнери тут
     * навмисно подані в НЕ-сторінковому порядку. */
    const order = ["13", "22", "14", "3", "16", "17", "9"];
    const containers = order.map((p, i) => ({
      containerId: `story:${i}`,
      text: "слово",
      pageRuns: [{ start: 0, end: 5, page: p }],
      oversetFrom: null, isMaster: false, kind: "text" as const,
    }));
    const langs = containers.map((c) => (
      { containerId: c.containerId, runs: [{ start: 0, end: 5, language: "Ukrainian" }] }));
    const t = tallyLanguages(containers, langs, affs2)[0]!;
    expect(t.pages).toEqual(["3", "9", "13", "14", "16", "17"]);
    expect(t.pageCount).toBe(7);
  });

  it("нечислові назви сторінок не ламають порядок і йдуть після числових", () => {
    /* pageAt віддає "?" коли сторінкових діапазонів немає; бувають і римські
     * номери. Порівняння чисел як рядків поставило б "10" перед "9". */
    const order = ["10", "?", "9", "ii"];
    const containers = order.map((p, i) => ({
      containerId: `story:${i}`,
      text: "слово",
      pageRuns: [{ start: 0, end: 5, page: p }],
      oversetFrom: null, isMaster: false, kind: "text" as const,
    }));
    const langs = containers.map((c) => (
      { containerId: c.containerId, runs: [{ start: 0, end: 5, language: "Ukrainian" }] }));
    expect(tallyLanguages(containers, langs, affs2)[0]!.pages).toEqual(["9", "10", "?", "ii"]);
  });

  it("languageDictionaries (override) прокидається до affFor і міняє межі слова", () => {
    /* «Czech» немає у вбудованому зіставленні dictpath.ts. Без override
     * діапазон ріжеться DEFAULT_WORD_AFF (дефіс — WORDCHARS): «dobre-slovo»
     * лишиться ОДНИМ словом. З override на cs_CZ, чий Aff дефіс не приймає,
     * розпадеться на два. */
    const affCs = parseAff(["WORDCHARS '"].join("\n"));
    const affs = new Map([["cs_CZ", affCs]]);
    const containers = [c("story:0", "dobre-slovo")];
    const langs = [{ containerId: "story:0", runs: [
      { start: 0, end: 11, language: "Czech" },
    ] }];

    expect(tallyLanguages(containers, langs, affs)[0]).toMatchObject({ words: 1 });
    expect(
      tallyLanguages(containers, langs, affs, { Czech: "cs_CZ" })[0],
    ).toMatchObject({ words: 2 });
  });

  it("межі слова йдуть мовою ДІАПАЗОНУ, не мовою документа: 'well-known' — два слова англійською, не одне українською", () => {
    /* WORDCHARS різниться по мові (як і в родині dictionary, unknown.ts):
     * en_US не приймає дефіс за частину слова, uk_UA (тут узятий тим самим
     * aff2, що й в інших тестах) — приймає. Різати англійський діапазон
     * українськими межами означало б міряти дюйми сантиметрами: 'well-known'
     * порахувалось би одним словом замість двох, і саме ЦЕ число потрапляє
     * в інвентар, яким людина судить про книжку. */
    const affEn = parseAff(["WORDCHARS '"].join("\n"));
    const affs = new Map([["uk_UA", aff2], ["en_US", affEn]]);
    const containers = [c("story:0", "слово"), c("story:1", "well-known")];
    const langs = [
      { containerId: "story:0", runs: [{ start: 0, end: 5, language: "Ukrainian" }] },
      { containerId: "story:1", runs: [{ start: 0, end: 10, language: "English: USA" }] },
    ];
    const t = tallyLanguages(containers, langs, affs);
    expect(t.find((x) => x.language === "English: USA")).toMatchObject({ words: 2 });
  });
});

describe("detectLanguage", () => {
  it("language-none — на діапазоні ЗІ СЛОВАМИ", () => {
    const containers = [c("story:0", "текст без мови")];
    const langs = [{ containerId: "story:0", runs: [
      { start: 0, end: 14, language: "[No Language]" },
    ] }];
    const f = detectLanguage(containers, langs, affs2);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ defect: "language-none", words: 3, page: "1" });
  });

  it("[No Language] БЕЗ слів знахідки не дає — перевіряти там нема чого", () => {
    const containers = [c("story:0", "слово\r")];
    const langs = [{ containerId: "story:0", runs: [
      { start: 0, end: 5, language: "Ukrainian" },
      { start: 5, end: 6, language: "[No Language]" },
    ] }];
    expect(detectLanguage(containers, langs, affs2)).toEqual([]);
  });

  it("language-stray — мова, що НІДЕ в документі не несе слів", () => {
    /* Виміряний випадок: с. 66, Vietnamese на одному знаку абзацу. */
    const containers = [c("story:0", "слово\r")];
    const langs = [{ containerId: "story:0", runs: [
      { start: 0, end: 5, language: "Ukrainian" },
      { start: 5, end: 6, language: "Vietnamese" },
    ] }];
    const f = detectLanguage(containers, langs, affs2);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ defect: "language-stray", words: 0, language: "Vietnamese" });
  });

  it("коротка вставка ЗІ СЛОВАМИ знахідки не дає — це цитата, не дефект", () => {
    /* Уточнення користувача: короткі англійські вставки бувають цитатами. */
    const containers = [c("story:0", "слово ok")];
    const langs = [{ containerId: "story:0", runs: [
      { start: 0, end: 6, language: "Ukrainian" },
      { start: 6, end: 8, language: "English: USA" },
    ] }];
    expect(detectLanguage(containers, langs, affs2)).toEqual([]);
  });

  it("мова зі словами В ІНШОМУ місці не є stray на порожньому діапазоні", () => {
    /* Ключова відмінність від «чужа мова без слів»: тут English НЕСЕ слова
     * деінде в документі, тож його поява на знаку абзацу — не блукач. */
    const containers = [c("story:0", "слово\r"), c("story:1", "one two")];
    const langs = [
      { containerId: "story:0", runs: [
        { start: 0, end: 5, language: "Ukrainian" },
        { start: 5, end: 6, language: "English: USA" }] },
      { containerId: "story:1", runs: [{ start: 0, end: 7, language: "English: USA" }] },
    ];
    expect(detectLanguage(containers, langs, affs2)).toEqual([]);
  });
});

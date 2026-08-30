import { describe, expect, it } from "vitest";
import { parseAff } from "../../src/spelling/aff.js";
import { buildDictionary } from "../../src/spelling/dic.js";
import { detectUnknown } from "../../src/spelling/unknown.js";

const aff = parseAff(["WORDCHARS -'"].join("\n"));
const dict = buildDictionary("2\nстіл\nслово", aff);
const dicts = new Map([["uk_UA", dict]]);
const affs = new Map([["uk_UA", aff]]);

const c = (text: string) =>
  ({ containerId: "story:0", text, pageRuns: [{ start: 0, end: text.length, page: "7" }],
     oversetFrom: null, isMaster: false, kind: "text" as const });
const uk = (len: number) =>
  [{ containerId: "story:0", runs: [{ start: 0, end: len, language: "Ukrainian" }] }];

describe("detectUnknown", () => {
  it("діапазон РІЖЕТЬСЯ правилами своєї мови, не мови документа", () => {
    /* Англійська вставка з дефісом. Український `Aff` лишає дефіс усередині
     * слова; англійський, у якого дефіс не WORDCHARS, розділив би на два.
     * Тест червоніє, якщо різка йде однією мовою на весь документ. */
    const enAff = parseAff("WORDCHARS '");
    const t = "well-known";
    const langs = [{ containerId: "story:0", runs: [
      { start: 0, end: t.length, language: "English: USA" },
    ] }];
    const f = detectUnknown([c(t)], langs, new Map([["en_US", enAff]]), new Map());
    expect(f.map((x) => x.word)).toEqual(["well", "known"]);
  });

  it("мова без словника ріжеться запасним Aff і дає word-not-checked", () => {
    const t = "cokolwiek";
    const langs = [{ containerId: "story:0", runs: [
      { start: 0, end: t.length, language: "Polish" },
    ] }];
    const f = detectUnknown([c(t)], langs, new Map(), new Map());
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ defect: "word-not-checked", word: "cokolwiek" });
  });

  it("одиниця звіту — СЛОВО-ТИП, не входження", () => {
    const t = "жабуринка слово жабуринка жабуринка";
    const f = detectUnknown([c(t)], uk(t.length), affs, dicts);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ defect: "word-unknown", word: "жабуринка", count: 3 });
  });

  it("сторінки не дублюються", () => {
    const t = "жабуринка жабуринка";
    expect(detectUnknown([c(t)], uk(t.length), affs, dicts)[0]!.pages).toEqual(["7"]);
  });

  it("список сторінок у рядку обрізається до MAX_PAGES_LISTED, pageCount лишає повне число", () => {
    /* Слово на десяти сторінках. MAX_PAGES_LISTED = 6 (types.ts) — рядок
     * показує лише перші 6, pageCount каже правду про решту. Тест червоніє,
     * якщо обмеження на pages зняти (Задача 16, Крок 1). */
    const word = "жабуринка ";
    const t = word.repeat(10);
    const pageRuns = Array.from({ length: 10 }, (_, i) => ({
      start: i * word.length, end: i * word.length + word.length, page: String(i + 1),
    }));
    const container = { containerId: "story:0", text: t, pageRuns,
      oversetFrom: null, isMaster: false, kind: "text" as const };
    const f = detectUnknown([container], uk(t.length), affs, dicts);
    expect(f).toHaveLength(1);
    expect(f[0]!.pages).toHaveLength(6);
    expect(f[0]!.pageCount).toBe(10);
  });

  it("сторінки впорядковані числом, а не порядком появи, коли їх БІЛЬШЕ за MAX_PAGES_LISTED", () => {
    /* Той самий борг Фази 9, що спелінг2019.ts (types.ts, comparePageNames):
     * рівно 6 чи менше сторінок не відрізнить "сортувати потім різати" від
     * "різати потім сортувати" — тут вісім, у свідомо НЕчисловому порядку
     * появи, тож обидва порядки дають різний результат. */
    const word = "жабуринка ";
    const pageOrder = ["50", "3", "41", "2", "19", "7", "30", "1"];
    const t = word.repeat(pageOrder.length);
    const pageRuns = pageOrder.map((page, i) => ({
      start: i * word.length,
      end: i === pageOrder.length - 1 ? t.length : i * word.length + word.length,
      page,
    }));
    const container = { containerId: "story:0", text: t, pageRuns,
      oversetFrom: null, isMaster: false, kind: "text" as const };
    const f = detectUnknown([container], uk(t.length), affs, dicts);
    expect(f).toHaveLength(1);
    expect(f[0]!.pages).toEqual(["1", "2", "3", "7", "19", "30"]);
    expect(f[0]!.pageCount).toBe(8);
  });

  it("слово в OVERSET відноситься на ОСТАННЮ розміщену сторінку, не на першу", () => {
    /* Борг, відкладений рецензією Фази 9 «на тріаж». Мовні діапазони
     * (language_runs_read, spelling.jsx) читаються з story.textStyleRanges і
     * покривають ПОВНИЙ текст історії, разом з overset; pageRunsFor
     * (inspect.jsx) бачить лише РОЗМІЩЕНІ рамки. Тобто офсет в overset лежить
     * поза кожним run у НЕпорожньому pageRuns — і фолбек вирішує все.
     *
     * Тут історія розміщена на сторінках 10 і 11, а слово «жабуринка» лежить
     * ЗА кінцем останнього run. Правильна відповідь — "11": невидимий текст
     * логічно продовжує останню видиму сторінку. Копія pageAt у spelling/
     * повертала "10" — першу, — тоді як typography/spelling2019.ts на тому
     * самому слові вже повертав "11". Тест червоніє, якщо фолбек знову
     * стане `[0]`, і саме він розводить дві однаково правдоподібні
     * відповіді. */
    const t = "слово слово жабуринка";
    const placedEnd = "слово слово ".length;
    const container = {
      containerId: "story:0",
      text: t,
      pageRuns: [
        { start: 0, end: 6, page: "10" },
        { start: 6, end: placedEnd, page: "11" },
      ],
      oversetFrom: placedEnd,
      isMaster: false,
      kind: "text" as const,
    };
    const f = detectUnknown([container], uk(t.length), affs, dicts);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ word: "жабуринка", pages: ["11"] });
  });

  it("порожній pageRuns дає «?», а не падіння", () => {
    /* Другий, окремий стан: фолбек `.at(-1)` і `[0]` тут однаково undefined,
     * тож ця гілка НЕ розрізняє двох редакцій pageAt — вона лише доводить,
     * що контейнер без жодної розміщеної рамки не валить прохід. */
    const t = "жабуринка";
    const container = { containerId: "story:0", text: t, pageRuns: [],
      oversetFrom: 0, isMaster: false, kind: "text" as const };
    const f = detectUnknown([container], uk(t.length), affs, dicts);
    expect(f[0]!.pages).toEqual(["?"]);
  });

  it("слово зі словника знахідки не дає", () => {
    expect(detectUnknown([c("стіл слово")], uk(10), affs, dicts)).toEqual([]);
  });

  it("word-not-checked — коли для мови діапазону словника немає", () => {
    const t = "будь-що";
    const langs = [{ containerId: "story:0", runs: [
      { start: 0, end: t.length, language: "[No Language]" },
    ] }];
    const f = detectUnknown([c(t)], langs, affs, dicts);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ defect: "word-not-checked", word: "будь-що" });
  });

  it("languageDictionaries (override) розв'язує мову поза вбудованою таблицею", () => {
    /* «Czech» немає у вбудованому зіставленні dictpath.ts — без override
     * дістав би word-not-checked, навіть маючи завантажений cs_CZ у dicts. */
    const t = "slovo";
    const langs = [{ containerId: "story:0", runs: [
      { start: 0, end: t.length, language: "Czech" },
    ] }];
    const csDicts = new Map([["cs_CZ", buildDictionary("1\nslovo", aff)]]);
    const csAffs = new Map([["cs_CZ", aff]]);

    const withoutOverride = detectUnknown([c(t)], langs, csAffs, csDicts);
    expect(withoutOverride).toHaveLength(1);
    expect(withoutOverride[0]).toMatchObject({ defect: "word-not-checked" });

    const withOverride = detectUnknown([c(t)], langs, csAffs, csDicts, { Czech: "cs_CZ" });
    expect(withOverride).toEqual([]);
  });

  it("апостроф нормалізується перед пошуком", () => {
    const d = new Map([["uk_UA", buildDictionary("1\nп'ять", aff)]]);
    expect(detectUnknown([c("п’ять")], uk(5), new Map([["uk_UA", aff]]), d)).toEqual([]);
  });

  it("великі й малі літери — один слово-тип", () => {
    const t = "Жабуринка жабуринка";
    const f = detectUnknown([c(t)], uk(t.length), affs, dicts);
    expect(f).toHaveLength(1);
    expect(f[0]!.count).toBe(2);
  });

  it("запис зберігає регістр ПЕРШОГО входження — велика літера першою", () => {
    /* Ключ бакета згорнутий у нижній регістр, але звіт читає людина, яка
     * шукатиме слово в книжці: «ойойой ×47» замість «Ойойой»
     * було б дезінформацією. Тест червоніє проти реалізації, що завжди
     * віддає нижній регістр. */
    const t = "Жабуринка жабуринка";
    const f = detectUnknown([c(t)], uk(t.length), affs, dicts);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ word: "Жабуринка", count: 2 });
  });

  it("запис зберігає регістр ПЕРШОГО входження — мала літера першою", () => {
    /* Дзеркальний випадок: пін саме на «перше побачене», а не на перевагу
     * великої літери. */
    const t = "жабуринка Жабуринка";
    const f = detectUnknown([c(t)], uk(t.length), affs, dicts);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ word: "жабуринка", count: 2 });
  });
});

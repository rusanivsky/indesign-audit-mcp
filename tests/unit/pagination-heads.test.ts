import { describe, expect, it } from "vitest";
import type { ChapterSpan } from "../../src/pagination/heads.js";
import {
  chapterSpans,
  detectHeads,
  headReference,
  normalizeTitle,
} from "../../src/pagination/heads.js";
import type { HeadFrame, HeadingRef, PageRef } from "../../src/pagination/types.js";

const page = (name: string, offset: number): PageRef => ({
  name,
  offset,
  side: offset % 2 === 0 ? "RIGHT_HAND" : "LEFT_HAND",
  spreadIndex: Math.floor(offset / 2),
  spreadSiblings: [],
  master: null,
});

describe("normalizeTitle", () => {
  it("складає регістр і зводить пробіли, тире НЕ чіпає", () => {
    /*
     * Виміряно H10-E: обидва стилі колонтитула мають ALL_CAPS, тож на аркуші
     * регістр однаковий, і порівнювати треба складеним. Тире — значуще:
     * коротке й довге в цій книжці різні знаки, і зводити їх означало б
     * вважати однаковими два різні набори.
     */
    expect(normalizeTitle("ПОЛОГИ —  ЗУСТРІЧ\r З МАЛЮКОМ")).toBe("пологи — зустріч з малюком");
  });
});

describe("chapterSpans", () => {
  it("СКЛЕЮЄ сусідні абзаци одного заголовка", () => {
    /*
     * Це і є пастка H10-C: прямий пошук трьох назв розділів по тексту книжки
     * дав НУЛЬ входжень, бо заголовок розбито на абзаци-рядки. Без склеювання
     * родина мовчить, і мовчання читається як «усе чисто».
     */
    const pages = [page("1", 0), page("2", 1), page("3", 2), page("4", 3)];
    const headings: HeadingRef[] = [
      { styleName: "Назва розділу", text: "Пологи —", page: "3", order: 0 },
      { styleName: "Назва розділу", text: "зустріч", page: "3", order: 1 },
      { styleName: "Назва розділу", text: "з малюком", page: "3", order: 2 },
    ];
    const spans = chapterSpans(headings, pages);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.titleRaw).toBe("Пологи — зустріч з малюком");
    expect(spans[0]!.title).toBe("пологи — зустріч з малюком");
    expect(spans[0]!.startOffset).toBe(2);
    expect(spans[0]!.endOffset).toBe(3);
  });

  it("два заголовки дають два проміжки, межа — сторінка ПЕРЕД наступним", () => {
    const pages = [page("1", 0), page("2", 1), page("3", 2), page("4", 3), page("5", 4)];
    const headings: HeadingRef[] = [
      { styleName: "Назва розділу", text: "Перший", page: "2", order: 0 },
      { styleName: "Назва розділу", text: "Другий", page: "4", order: 1 },
    ];
    const spans = chapterSpans(headings, pages);
    expect(spans.map((s) => [s.startOffset, s.endOffset])).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("заголовок БЕЗ сторінки (переповнений текст) проміжку не дає", () => {
    /*
     * `HeadingRef.page === null` означає «заголовок у переповненому тексті».
     * Вигадати йому сторінку означало б збудувати весь вирок на здогаді.
     */
    const pages = [page("1", 0), page("2", 1)];
    const headings: HeadingRef[] = [
      { styleName: "Назва розділу", text: "Загублений", page: null, order: 0 },
    ];
    expect(chapterSpans(headings, pages)).toEqual([]);
  });

  it("сторінки ДО першого заголовка не належать жодному проміжку", () => {
    const pages = [page("1", 0), page("2", 1), page("3", 2)];
    const headings: HeadingRef[] = [
      { styleName: "Назва розділу", text: "Розділ", page: "3", order: 0 },
    ];
    const spans = chapterSpans(headings, pages);
    expect(spans[0]!.startOffset).toBe(2);
    expect(spans.some((s) => s.startOffset === 0)).toBe(false);
  });

  it("два РІЗНІ стилі заголовка підряд на одній сторінці НЕ склеюються", () => {
    /*
     * Межа, названа спеком §6.2, тут закріплена тестом: склеювання вимагає
     * збігу і сторінки, І стилю. Інакше «Номер розділу» приклеївся б до
     * «Назви розділу» й еталон став би «1 Вагітність — це новий світ».
     */
    const pages = [page("1", 0), page("2", 1)];
    const headings: HeadingRef[] = [
      { styleName: "Номер розділу", text: "1", page: "2", order: 0 },
      { styleName: "Назва розділу", text: "Вагітність", page: "2", order: 1 },
    ];
    const spans = chapterSpans(headings, pages);
    expect(spans.map((s) => s.titleRaw)).toEqual(["1", "Вагітність"]);
  });
});

describe("HeadFrame — форма, яка не дає збрехати", () => {
  it("fillValue допускає null, і це ОКРЕМИЙ стан", () => {
    /*
     * Виміряно `H10-E`: фарба стилю `Колонтитул v2` має ПОРОЖНЮ назву. Якби
     * тип не дозволяв `null`, реалізація підставила б `""` — і два різні
     * неназвані кольори стали б «однаковими», тобто правило перетворилось би
     * на перевірку, яка не може впасти. Тип тут примушує написати гілку.
     */
    const h: HeadFrame = {
      id: "1",
      page: "2",
      styleName: "Колонтитул v1",
      fromMaster: true,
      masterName: "E-Розділ 1",
      side: "LEFT_HAND",
      text: "Розділ",
      empty: false,
      overset: false,
      appearance: { font: "Proba Pro\tRegular", pointSize: 10, fillValue: null },
    };
    expect(h.appearance.fillValue).toBeNull();
  });
});

const head = (over: Partial<HeadFrame> = {}): HeadFrame => ({
  id: "f1",
  page: "2",
  styleName: "Колонтитул v1",
  fromMaster: true,
  masterName: "E",
  side: "LEFT_HAND",
  text: "Розділ перший",
  empty: false,
  overset: false,
  appearance: { font: "Proba Pro\tRegular", pointSize: 10, fillValue: "CMYK:20,100,70,10" },
  ...over,
});

const SPANS: ChapterSpan[] = [
  { titleRaw: "Розділ перший", title: "розділ перший", startPage: "1", startOffset: 0, endOffset: 1 },
  { titleRaw: "Розділ другий", title: "розділ другий", startPage: "3", startOffset: 2, endOffset: 3 },
];

const PAGES = [page("1", 0), page("2", 1), page("3", 2), page("4", 3)];

const NO_EXPECT = { compareChapter: true, expectedByMaster: new Map<string, ReadonlySet<PageRef["side"]>>() };

describe("head-wrong-chapter", () => {
  it("колонтитул називає СВІЙ розділ — знахідки немає", () => {
    /* Регістр складається: на аркуші обидва стилі дають ALL_CAPS (H10-E). */
    const r = detectHeads(PAGES, [head({ page: "2", text: "РОЗДІЛ ПЕРШИЙ" })], SPANS, NO_EXPECT);
    expect(r.findings.filter((f) => f.defect === "head-wrong-chapter")).toEqual([]);
    expect(r.checked).toBe(1);
  });

  it("колонтитул називає ЧУЖИЙ розділ — знахідка з обома текстами", () => {
    const r = detectHeads(PAGES, [head({ page: "4", text: "Розділ перший" })], SPANS, NO_EXPECT);
    const f = r.findings.find((x) => x.defect === "head-wrong-chapter")!;
    expect(f.page).toBe("4");
    expect(f.claimed).toBe("Розділ перший");
    expect(f.actual).toBe("Розділ другий");
    expect(f.family).toBe("runningHead");
  });

  it("compareChapter: false — правило МОВЧИТЬ, а сторінка йде в notCompared", () => {
    /*
     * Стилів заголовків не оголосили: порівнювати нема з чим. Нуль знахідок
     * тут мусить бути відрізнимий від «перевірено й чисто» — інакше друкарська
     * помилка в назві стилю читається як «усе гаразд».
     */
    const r = detectHeads(PAGES, [head({ page: "4", text: "Розділ перший" })], SPANS, {
      compareChapter: false,
      expectedByMaster: new Map(),
    });
    expect(r.findings.filter((f) => f.defect === "head-wrong-chapter")).toEqual([]);
    expect(r.notCompared).toBe(1);
    expect(r.checked).toBe(0);
  });
});

describe("head-unexpected і head-missing", () => {
  const spans: ChapterSpan[] = [
    { titleRaw: "Розділ", title: "розділ", startPage: "3", startOffset: 2, endOffset: 3 },
  ];

  it("колонтитул поза будь-яким проміжком — head-unexpected", () => {
    const r = detectHeads(PAGES, [head({ page: "2", text: "Розділ" })], spans, NO_EXPECT);
    const f = r.findings.find((x) => x.defect === "head-unexpected")!;
    expect(f.page).toBe("2");
    expect(f.actual).toBeNull();
  });

  it("майстер дає колонтитул, сторінка його не має — head-missing", () => {
    /*
     * Очікування виводиться з МАЙСТРА, а не з номера сторінки: 78 сторінок
     * інтерв'ю в книжці свідомо без колонтитула (рішення користувача
     * 2026-08-14), і правило «сторінка всередині розділу» доповіло б про 39
     * verso-сторінок, поховавши справжні знахідки.
     */
    const pgs = [{ ...page("4", 3), master: "E" }];
    const r = detectHeads(pgs, [], spans, {
      compareChapter: true,
      expectedByMaster: new Map([["E", new Set(["LEFT_HAND"] as const)]]),
    });
    const f = r.findings.find((x) => x.defect === "head-missing")!;
    expect(f.page).toBe("4");
    expect(f.detail).toContain("E");
  });

  it("майстер БЕЗ колонтитула — head-missing НЕ виникає", () => {
    const pgs = [{ ...page("4", 3), master: "F-інтерв'ю" }];
    const r = detectHeads(pgs, [], spans, {
      compareChapter: true,
      expectedByMaster: new Map([["E", new Set(["LEFT_HAND"] as const)]]),
    });
    expect(r.findings.filter((x) => x.defect === "head-missing")).toEqual([]);
  });

  it("порожня рамка рахується як ВІДСУТНІЙ колонтитул", () => {
    const pgs = [{ ...page("4", 3), master: "E" }];
    const r = detectHeads(pgs, [head({ page: "4", text: "", empty: true })], spans, {
      compareChapter: true,
      expectedByMaster: new Map([["E", new Set(["LEFT_HAND"] as const)]]),
    });
    expect(r.findings.some((x) => x.defect === "head-missing")).toBe(true);
  });

  it("переповнена рамка теж рахується як відсутній", () => {
    const pgs = [{ ...page("4", 3), master: "E" }];
    const r = detectHeads(pgs, [head({ page: "4", text: "Розділ", overset: true })], spans, {
      compareChapter: true,
      expectedByMaster: new Map([["E", new Set(["LEFT_HAND"] as const)]]),
    });
    expect(r.findings.some((x) => x.defect === "head-missing")).toBe(true);
  });

  it("бік майстра інший — сторінка того боку колонтитула не потребує", () => {
    /*
     * Майстер дає колонтитул на verso; recto його не має ЗА ПОБУДОВОЮ, і
     * рахувати це вадою означало б доповісти про половину книжки.
     */
    const pgs = [{ ...page("5", 4), master: "E", side: "RIGHT_HAND" as const }];
    const r = detectHeads(pgs, [], [{ titleRaw: "Розділ", title: "розділ", startPage: "5", startOffset: 4, endOffset: 4 }], {
      compareChapter: true,
      expectedByMaster: new Map([["E", new Set(["LEFT_HAND"] as const)]]),
    });
    expect(r.findings.filter((x) => x.defect === "head-missing")).toEqual([]);
  });
});

/** Сторінки, виведені з самих колонтитулів: назва → унікальний offset. */
const pagesFor = (hs: HeadFrame[]): PageRef[] => {
  const seen = new Map<string, PageRef>();
  for (const h of hs) {
    if (seen.has(h.page)) continue;
    seen.set(h.page, { ...page(h.page, seen.size), side: h.side, master: h.masterName });
  }
  return [...seen.values()];
};

const NO_CHAPTER = {
  compareChapter: false,
  expectedByMaster: new Map<string, ReadonlySet<PageRef["side"]>>(),
};

describe("еталон родини й дві розбіжності", () => {
  it("еталон — МОДА по знайдених колонтитулах, не константа верстки", () => {
    /*
     * §3.2 проєкту: еталон виводиться з документа. Константа «колонтитул на
     * verso» перевернулась би в першій же книжці, що ставить його інакше.
     */
    const hs = [
      head({ id: "a", side: "LEFT_HAND" }),
      head({ id: "b", side: "LEFT_HAND" }),
      head({ id: "c", side: "RIGHT_HAND" }),
    ];
    expect(headReference(hs).side).toBe("LEFT_HAND");
  });

  it("еталон — мода НАВІТЬ КОЛИ перший елемент не належить до неї", () => {
    /*
     * ЦЕЙ ТЕСТ ДОДАНО ПІСЛЯ ТОГО, ЯК МУТАНТ ВИЖИВ. Попередній ставив
     * більшість першою, тож «перший» і «мода» в ньому збігались, і підміна
     * моди на «взяти перший» проходила всі 21 тест зеленою. Мутант, якого
     * ніхто не вбиває, означає «правило не перевірене», а не «правильне».
     */
    const hs = [
      head({ id: "a", side: "RIGHT_HAND" }),
      head({ id: "b", side: "LEFT_HAND" }),
      head({ id: "c", side: "LEFT_HAND" }),
    ];
    expect(headReference(hs).side).toBe("LEFT_HAND");

    const big = { font: "Proba Pro\tLight", pointSize: 18, fillValue: "CMYK:0,0,0,100" };
    const norm = { font: "Proba Pro\tRegular", pointSize: 10, fillValue: "CMYK:20,100,70,10" };
    const sizes = [
      head({ id: "a", appearance: big }),
      head({ id: "b", appearance: norm }),
      head({ id: "c", appearance: norm }),
    ];
    const ref = headReference(sizes);
    expect(ref.pointSize).toBe(10);
    expect(ref.font).toBe("Proba Pro\tRegular");
    expect(ref.fillValue).toBe("CMYK:20,100,70,10");
  });

  it("бік-одинак — head-side-stray, одиниця звіту РАМКА", () => {
    const hs = [
      head({ id: "a", page: "2", side: "LEFT_HAND" }),
      head({ id: "a", page: "4", side: "LEFT_HAND" }),
      head({ id: "z", page: "5", side: "RIGHT_HAND" }),
    ];
    const r = detectHeads(pagesFor(hs), hs, [], NO_CHAPTER);
    const f = r.findings.filter((x) => x.defect === "head-side-stray");
    expect(f).toHaveLength(1);
    expect(f[0]!.frameId).toBe("z");
  });

  it("накреслення-одинак — head-style-stray, ОДНА знахідка на всі сторінки рамки", () => {
    /*
     * Це двійник знахідки, яку зонд знайшов на книжці: «Передмова» набрана
     * Proba Pro Light проти Regular у семи інших. Сторінки одного майстра
     * мусять дати ОДИН рядок звіту, інакше він тоне (спек §3).
     */
    const many = ["2", "4", "6", "8"].map((p) => head({ id: "e", page: p }));
    const light = { font: "Proba Pro\tLight", pointSize: 10, fillValue: "CMYK:20,100,70,10" };
    const hs = [
      ...many,
      head({ id: "c", page: "10", appearance: light }),
      head({ id: "c", page: "12", appearance: light }),
    ];
    const r = detectHeads(pagesFor(hs), hs, [], NO_CHAPTER);
    const f = r.findings.filter((x) => x.defect === "head-style-stray");
    expect(f).toHaveLength(1);
    expect(f[0]!.frameId).toBe("c");
    expect(f[0]!.detail).toContain("2");
  });

  it("ДВА РІЗНІ СТИЛІ порівнюються кожен зі своїм еталоном", () => {
    /*
     * ЗНАЙДЕНО КОНТРОЛЬНИМ ПРОГОНОМ НА КНИЖЦІ: правило давало 4 знахідки
     * замість 1, і три зайві — усі колонтитули стилю `Колонтитул v2`
     * (чеклисти), фарба яких світла, бо стоїть на кольоровій плашці. Правило
     * вимагало, щоб два різні ІМЕНОВАНІ стилі виглядали однаково — а стилі на
     * те й різні. Документ оголошує два, отже й еталонів два.
     */
    const v1 = { font: "Proba\tRegular", pointSize: 10, fillValue: "CMYK:20,100,70,10" };
    const v2 = { font: "Proba\tRegular", pointSize: 10, fillValue: "CMYK:2,8,23,0" };
    const hs = [
      head({ id: "a", page: "2", styleName: "Kolontytul v1", appearance: v1 }),
      head({ id: "b", page: "4", styleName: "Kolontytul v1", appearance: v1 }),
      head({ id: "c", page: "6", styleName: "Kolontytul v1", appearance: v1 }),
      head({ id: "d", page: "8", styleName: "Kolontytul v2", appearance: v2 }),
      head({ id: "e", page: "10", styleName: "Kolontytul v2", appearance: v2 }),
    ];
    const r = detectHeads(pagesFor(hs), hs, [], NO_CHAPTER);
    expect(r.findings.filter((x) => x.defect === "head-style-stray")).toEqual([]);
  });

  it("одинак ВСЕРЕДИНІ свого стилю знаходиться попри інший стиль поруч", () => {
    /* Негативний контроль до попереднього: групування по стилю не сміє
     * зробити правило сліпим — інакше воно перестало б ловити те, заради чого
     * існує (на книжці це «Передмова» в Light серед Regular). */
    const norm = { font: "Proba\tRegular", pointSize: 10, fillValue: "CMYK:20,100,70,10" };
    const light = { font: "Proba\tLight", pointSize: 10, fillValue: "CMYK:20,100,70,10" };
    const other = { font: "Proba\tRegular", pointSize: 10, fillValue: "CMYK:2,8,23,0" };
    const hs = [
      head({ id: "a", page: "2", styleName: "v1", appearance: norm }),
      head({ id: "b", page: "4", styleName: "v1", appearance: norm }),
      head({ id: "c", page: "6", styleName: "v1", appearance: light }),
      head({ id: "d", page: "8", styleName: "v2", appearance: other }),
    ];
    const r = detectHeads(pagesFor(hs), hs, [], NO_CHAPTER);
    const f = r.findings.filter((x) => x.defect === "head-style-stray");
    expect(f).toHaveLength(1);
    expect(f[0]!.frameId).toBe("c");
  });

  it("fillValue null НЕ дорівнює жодному fillValue — це notCompared", () => {
    /*
     * Виміряно H10-E: фарба стилю `Колонтитул v2` має порожню назву. Якби
     * null вважався значенням, дві різні неназвані фарби зійшлися б у
     * «однакові», і правило стало б перевіркою, яка не може впасти.
     */
    const hs = [
      head({ id: "a", page: "2" }),
      head({ id: "a", page: "4" }),
      head({
        id: "b",
        page: "6",
        appearance: { font: "Proba Pro\tRegular", pointSize: 10, fillValue: null },
      }),
    ];
    const r = detectHeads(pagesFor(hs), hs, [], NO_CHAPTER);
    expect(r.findings.filter((x) => x.defect === "head-style-stray")).toEqual([]);
    expect(r.notCompared).toBeGreaterThan(0);
  });

  it("усі колонтитули однакові — жодної знахідки про вигляд", () => {
    /* Негативний контроль: правило мусить уміти мовчати на чистому вході. */
    const hs = [head({ id: "a", page: "2" }), head({ id: "b", page: "4" })];
    const r = detectHeads(pagesFor(hs), hs, [], NO_CHAPTER);
    expect(r.findings).toEqual([]);
  });
});

/*
 * МАЙСТЕР-РОЗВОРОТ МАЄ ДВІ СТОРІНКИ, А В МАПІ ЛЕЖАЛА ОДНА СТОРОНА.
 *
 * `expectedByMaster` ключується іменем майстер-РОЗВОРОТУ, і `Map.set` у циклі
 * просто затирав попереднє значення: майстер із колонтитулом і на верстці, і
 * на звороті лишав ту сторону, що трапилася останньою. Далі
 * `expectSide !== p.side` пропускав КОЖНУ сторінку другої сторони, тож
 * head-missing на них не спрацьовував ніколи.
 *
 * Це саме той клас тихої втрати, заради якого існує master-island: сторінка,
 * з якої колонтитул перевизначили й видалили, не давала жодної знахідки.
 */
describe("майстер із колонтитулами на ОБОХ сторонах", () => {
  const обидві = new Map<string, ReadonlySet<PageRef["side"]>>([
    ["E", new Set(["LEFT_HAND", "RIGHT_HAND"] as const)],
  ]);

  const сторінка = (name: string, side: PageRef["side"]): PageRef =>
    ({ name, side, master: "E", spreadIndex: 0, spreadSiblings: [], offset: Number(name) }) as PageRef;

  it("head-missing спрацьовує на ОБОХ сторонах, а не лише на останній побаченій", () => {
    const pages = [сторінка("12", "LEFT_HAND"), сторінка("13", "RIGHT_HAND")];
    const r = detectHeads(pages, [], [], { compareChapter: false, expectedByMaster: обидві });
    const missing = r.findings.filter((f) => f.defect === "head-missing").map((f) => f.page);
    expect(missing.sort()).toEqual(["12", "13"]);
  });

  it("НЕГАТИВНИЙ КОНТРОЛЬ: сторона, якої в майстра немає, знахідки не дає", () => {
    /* Інакше правка звелася б до «очікуємо колонтитул скрізь», і родина
     * почала б звітувати про 78 сторінок майстра, свідомо лишених без
     * колонтитула (рішення користувача 2026-08-14). */
    const лише = new Map<string, ReadonlySet<PageRef["side"]>>([
      ["E", new Set(["LEFT_HAND"] as const)],
    ]);
    const pages = [сторінка("12", "LEFT_HAND"), сторінка("13", "RIGHT_HAND")];
    const r = detectHeads(pages, [], [], { compareChapter: false, expectedByMaster: лише });
    expect(r.findings.filter((f) => f.defect === "head-missing").map((f) => f.page)).toEqual(["12"]);
  });
});

/*
 * ТРИ ВАДИ РОДИНИ КОЛОНТИТУЛІВ, УСІ — «СУДИМО НЕ ТЕ, ЩО БАЧИМО».
 */
describe("колонтитули: діапазони й сторони", () => {
  const стор = (name: string, offset: number, side: PageRef["side"] = "LEFT_HAND"): PageRef =>
    ({ name, side, master: "E", spreadIndex: 0, spreadSiblings: [], offset }) as PageRef;

  const голова = (over: Partial<HeadFrame>): HeadFrame =>
    ({
      id: "f1", page: "12", side: "LEFT_HAND", text: "Розділ", styleName: "Колонтитул v1",
      empty: false, overset: false, fromMaster: true, masterName: "E",
      appearance: { font: null, pointSize: null, fillValue: null },
      ...over,
    }) as HeadFrame;

  it("порожній перелік діапазонів не робить УСІ колонтитули зайвими", () => {
    /* Заголовки можуть усі сидіти на майстрах, які pagination.jsx свідомо не
     * бере в перелік: тоді spans === [] і кожен колонтитул падав у
     * head-unexpected із причиною, якої не існує. */
    const r = detectHeads(
      [стор("12", 11)],
      [голова({ page: "12" })],
      [],
      { compareChapter: true, expectedByMaster: new Map() },
    );
    expect(r.findings.map((f) => f.defect)).not.toContain("head-unexpected");
    expect(r.notCompared).toBeGreaterThan(0);
  });

  it("відхилення сторони видно, навіть коли воно НЕ перше в групі", () => {
    /* Односторонній майстер прикладається до сторінок обох сторін, тож група
     * однієї рамки буває змішаною. Дивилися на group[0] — і відхилення, що
     * стояло далі, не бачили зовсім. */
    const heads = [
      голова({ id: "f1", page: "12", side: "LEFT_HAND" }),
      голова({ id: "f1", page: "14", side: "LEFT_HAND" }),
      голова({ id: "f1", page: "17", side: "RIGHT_HAND" }),
    ];
    const pages = [стор("12", 11), стор("14", 13), стор("17", 16, "RIGHT_HAND")];
    const r = detectHeads(pages, heads, [], {
      compareChapter: false,
      expectedByMaster: new Map(),
    });
    const stray = r.findings.find((f) => f.defect === "head-side-stray");
    expect(stray, "відхилення сторони не помічене").toBeDefined();
    expect(stray!.page).toBe("17");
    expect(stray!.detail).toContain("17");
  });
});

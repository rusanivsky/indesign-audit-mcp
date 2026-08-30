import { describe, expect, it } from "vitest";
import { buildReport, type BuildReportInput } from "../../src/pagination/report.js";
import { MAX_GROUP_PAGES } from "../../src/pagination/report.js";
import {
  MAX_PAGINATION_DETAIL_ITEMS,
  type FamilyResult,
  type PaginationDefect,
  type PaginationFinding,
} from "../../src/pagination/types.js";

function finding(defect: PaginationDefect, n: number): PaginationFinding {
  return {
    id: `f-${n}`,
    family: defect.startsWith("folio") ? "folio" : "contents",
    defect,
    page: String(n),
    frameId: null,
    paragraphIndex: null,
    claimed: null,
    actual: null,
    detail: "…",
  };
}

function result(findings: PaginationFinding[], checked = 10, notCompared = 0): FamilyResult {
  return { checked, notCompared, findings };
}

const EMPTY: BuildReportInput = {
  docName: "d.indd",
  folio: null,
  contents: null,
      runningHead: null,
  missingStyles: [],
  masterSkipped: [], masterIslands: [],
  detailFamily: null,
};

describe("buildReport", () => {
  it("родина без оголошення дає null, а не порожній звіт", () => {
    const r = buildReport({ ...EMPTY });
    expect(r.folio).toBeNull();
    expect(r.contents).toBeNull();
  });

  it("родина без знахідок дає звіт із нулями — це ІНШИЙ стан, ніж null", () => {
    /* Без цієї різниці оператор не відрізнить «не питали» від «шукали й не
     * знайшли». Правило Фази 4 (document_map.headings). */
    const r = buildReport({ ...EMPTY, folio: result([], 99, 0) });
    expect(r.folio).toEqual({ checked: 99, deviating: 0, notCompared: 0, groups: [] });
  });

  it("deviating рахує знахідки, а checked лишається незалежним числом", () => {
    const r = buildReport({
      ...EMPTY,
      folio: result([finding("folio-stale", 1), finding("folio-stale", 2)], 99, 3),
    });
    expect(r.folio).toMatchObject({ checked: 99, deviating: 2, notCompared: 3 });
  });

  it("contents-manual теж не розбіжність — рядок ще не переведено на посилання", () => {
    /* Зонд H6 виміряв: зміст переводять на перехресні посилання просто зараз
     * (35 із ~60 рядків). Літеральне число там не «хибне» — воно ще не
     * переведене, і саме це треба сказати, не назвавши дефектом. */
    const r = buildReport({
      ...EMPTY,
      contents: result([finding("contents-manual", 1), finding("contents-stale", 2)], 60),
    });
    expect(r.contents!.deviating).toBe(1);
    expect(r.contents!.groups).toHaveLength(2);
  });

  it("folio-manual НЕ рахується в deviating — це факт, а не дефект числа", () => {
    /* Рамка без автомаркера може мати цілком правильні числа. Змішати це з
     * розбіжністю означало б доповісти дефект там, де його немає. */
    const r = buildReport({
      ...EMPTY,
      folio: result([finding("folio-manual", 1), finding("folio-stale", 2)], 99),
    });
    expect(r.folio!.deviating).toBe(1);
    expect(r.folio!.groups).toHaveLength(2);
  });

  it("detail без запиту дорівнює null, скільки б знахідок не було", () => {
    const r = buildReport({ ...EMPTY, folio: result([finding("folio-stale", 1)]) });
    expect(r.detail).toBeNull();
    expect(r.detailTruncated).toBeNull();
  });

  it("detail обрізається стелею й КАЖЕ про це", () => {
    /* Мовчазне обрізання читалося б як «це все, що є». */
    const many = Array.from({ length: 60 }, (_, i) => finding("folio-stale", i));
    const r = buildReport({ ...EMPTY, folio: result(many), detailFamily: "folio" });
    expect(r.detail).toHaveLength(MAX_PAGINATION_DETAIL_ITEMS);
    expect(r.detailTruncated).toEqual({ shown: 50, total: 60 });
  });

  it("detail без обрізання не вигадує detailTruncated", () => {
    const few = Array.from({ length: 3 }, (_, i) => finding("folio-stale", i));
    const r = buildReport({ ...EMPTY, folio: result(few), detailFamily: "folio" });
    expect(r.detail).toHaveLength(3);
    expect(r.detailTruncated).toBeNull();
  });

  it("detail для НЕоголошеної родини — помилка, а не тихий порожній перелік", () => {
    /* «Порожньо» і «родину не рахували» — різні стани; тихий [] злив би їх. */
    expect(() => buildReport({ ...EMPTY, detailFamily: "contents" })).toThrow(/contents/);
  });

  it("folio-unparsable НЕ рахується в deviating — це «не порівнювали», а не «розійшлося»", () => {
    /*
     * Та сама рамка інакше потрапляла у ДВА протилежні лічильники одразу:
     * `notCompared` у detectFolio і `deviating` тут. Знахідка не твердить про
     * число нічого (`claimed: null`) — вона каже «назва сторінки не число».
     *
     * ЧОМУ ЦЕ СТАЛО ВАЖИТИ: третє джерело рамок (§4.1) породжує знахідку НА
     * РАМКУ, тож сторінка з римською назвою під майстровою колонцифрою дає
     * дві. Без цієї правки `deviating` ріс би від ДЖЕРЕЛА рамок, а не від
     * стану верстки.
     */
    const r = buildReport({
      ...EMPTY,
      folio: result(
        [finding("folio-unparsable", 1), finding("folio-unparsable", 1), finding("folio-stale", 2)],
        99,
        2,
      ),
    });
    expect(r.folio!.deviating).toBe(1);
    /* Знахідки при цьому НЕ зникли: обидві лишились у групі з count 2. */
    const group = r.folio!.groups.find((g) => g.defect === "folio-unparsable")!;
    expect(group.count).toBe(2);
    expect(r.folio!.notCompared).toBe(2);
  });

  it("masterSkipped доїжджає у звіт — інакше сліпота §4.1 лишається мовчазною", () => {
    /*
     * Сценарій відмови, заради якого поле існує: видання з шаблонним змістом
     * (і рядки, і заголовки на батьківських сторінках) дає порожню родину
     * contents, тобто форму, яку читають як «усе чисто». Поле стоїть поруч із
     * missingStyles і робить ту саму роботу: не дає нулю збрехати.
     */
    const r = buildReport({
      ...EMPTY,
      contents: result([], 0, 0),
      masterSkipped: [{ styleName: "Зміст Розділ", role: "title", frames: 40 }],
    });
    expect(r.contents).toEqual({ checked: 0, deviating: 0, notCompared: 0, groups: [] });
    expect(r.masterSkipped).toEqual([{ styleName: "Зміст Розділ", role: "title", frames: 40 }]);
  });

  it("порожній masterSkipped — це «дивились і не пропустили», тож поле є завжди", () => {
    expect(buildReport({ ...EMPTY }).masterSkipped).toEqual([]);
  });

  it("missingStyles потрапляють у звіт, а не гинуть мовчки", () => {
    const r = buildReport({ ...EMPTY, missingStyles: ["Немає-такого"] });
    expect(r.missingStyles).toEqual(["Немає-такого"]);
  });
});

describe("зведення однакових знахідок", () => {
  it("91 однаковий дефект дає ОДИН рядок із лічильником", () => {
    /* Виміряно на робочій книжці: родина folio давала 91 знахідку
     * folio-manual і 33 437 Б, щоб сказати одну річ. */
    const many = Array.from({ length: 91 }, (_, i) => ({
      ...finding("folio-manual", i),
      page: String(i + 1),
    }));
    const r = buildReport({ ...EMPTY, folio: result(many, 91) });
    expect(r.folio!.groups).toHaveLength(1);
    expect(r.folio!.groups[0]!.count).toBe(91);
  });

  it("перелік сторінок обрізається стелею й КАЖЕ про це", () => {
    const many = Array.from({ length: 91 }, (_, i) => ({
      ...finding("folio-manual", i),
      page: String(i + 1),
    }));
    const r = buildReport({ ...EMPTY, folio: result(many, 91) });
    const g = r.folio!.groups[0]!;
    expect(g.pages).toHaveLength(MAX_GROUP_PAGES);
    expect(g.pagesTruncated).toEqual({ shown: MAX_GROUP_PAGES, total: 91 });
  });

  it("без обрізання не вигадує pagesTruncated", () => {
    const few = [1, 2, 3].map((i) => ({ ...finding("folio-stale", i), page: String(i) }));
    const g = buildReport({ ...EMPTY, folio: result(few) }).folio!.groups[0]!;
    expect(g.pages).toEqual(["1", "2", "3"]);
    expect(g.pagesTruncated).toBeNull();
  });

  it("count рахує ЗНАХІДКИ, а pages — різні сторінки: це різні величини", () => {
    /* Дві знахідки на одній сторінці не мають подвоювати перелік сторінок,
     * але мають рахуватись у count. */
    const two = [finding("folio-stale", 1), finding("folio-stale", 2)].map((f) => ({
      ...f,
      page: "7",
    }));
    const g = buildReport({ ...EMPTY, folio: result(two) }).folio!.groups[0]!;
    expect(g.count).toBe(2);
    expect(g.pages).toEqual(["7"]);
  });

  it("зведення зберігає ПОЯСНЕННЯ — інакше воно зникло б разом із переліком", () => {
    const g = buildReport({ ...EMPTY, folio: result([finding("folio-stale", 1)]) }).folio!.groups[0]!;
    expect(g.example.detail).toBeTruthy();
    expect(g.example.defect).toBe("folio-stale");
  });

  it("різні дефекти лишаються різними рядками", () => {
    const mixed = [finding("folio-stale", 1), finding("folio-manual", 2)];
    const r = buildReport({ ...EMPTY, folio: result(mixed) });
    expect(r.folio!.groups.map((g) => g.defect).sort()).toEqual(["folio-manual", "folio-stale"]);
  });
});

describe("третя родина — runningHead", () => {
  const empty = { checked: 0, notCompared: 0, findings: [] };

  it("родина, яку оголосили, потрапляє у звіт і не чіпає лічильників сусідніх", () => {
    const r = buildReport({
      docName: "d",
      folio: null,
      contents: null,
      runningHead: { checked: 3, notCompared: 1, findings: [] },
      missingStyles: [],
      masterSkipped: [], masterIslands: [],
      detailFamily: null,
    });
    expect(r.runningHead).not.toBeNull();
    expect(r.runningHead!.checked).toBe(3);
    expect(r.runningHead!.notCompared).toBe(1);
    expect(r.folio).toBeNull();
    expect(r.contents).toBeNull();
  });

  it("родина, якої не оголошували, дає null, а не порожній звіт", () => {
    /*
     * Порожній звіт читається як «усе чисто» — той самий відмовний режим,
     * який Фаза 5 ловила п'ять разів.
     */
    const r = buildReport({
      docName: "d",
      folio: empty,
      contents: null,
      runningHead: null,
      missingStyles: [],
      masterSkipped: [], masterIslands: [],
      detailFamily: null,
    });
    expect(r.runningHead).toBeNull();
  });

  it("detail для runningHead без оголошеної родини — ВІДМОВА, не порожній перелік", () => {
    expect(() =>
      buildReport({
        docName: "d",
        folio: empty,
        contents: null,
        runningHead: null,
        missingStyles: [],
        masterSkipped: [], masterIslands: [],
        detailFamily: "runningHead",
      }),
    ).toThrow(/runningHead/);
  });

  it("усі п'ять дефектів колонтитула рахуються РОЗБІЖНОСТЯМИ", () => {
    /*
     * Жоден із них не «не порівнювали» і не «зламається потім»: усі п'ять
     * видно на аркуші вже зараз — не той розділ, порожнє місце, зайвий
     * колонтитул, не той бік, не те накреслення.
     */
    const defects = [
      "head-wrong-chapter",
      "head-missing",
      "head-unexpected",
      "head-side-stray",
      "head-style-stray",
    ] as const;
    const findings = defects.map((d, i) => ({
      id: `runningHead:${i}`,
      family: "runningHead" as const,
      defect: d,
      page: "2",
      frameId: "f",
      paragraphIndex: null,
      claimed: null,
      actual: null,
      detail: "",
    }));
    const r = buildReport({
      docName: "d",
      folio: null,
      contents: null,
      runningHead: { checked: 5, notCompared: 0, findings },
      missingStyles: [],
      masterSkipped: [], masterIslands: [],
      detailFamily: null,
    });
    expect(r.runningHead!.deviating).toBe(5);
  });
});

import { describe, expect, it } from "vitest";
import { detectMasters } from "../../src/layout/masters.js";
import type { MasterItemRef, PageMeasure } from "../../src/layout/types.js";
import { page } from "./helpers/layout.js";

const FOLIO: MasterItemRef = { id: "m1", kind: "TextFrame" };
const RULE: MasterItemRef = { id: "m2", kind: "GraphicLine" };

/** Що дає батьківська «L»: фоліо і лінійка. */
const onMaster = new Map<string, MasterItemRef[]>([["L", [FOLIO, RULE]]]);

describe("від'єднання від батьківської", () => {
  it("сторінка з усіма елементами батьківської знахідки не дає", () => {
    const r = detectMasters([page({ name: "1", master: "L", masterItems: [FOLIO, RULE] })], onMaster);
    expect(r.findings).toEqual([]);
  });

  it("відсутній елемент батьківської — знахідка master-item-missing", () => {
    const r = detectMasters([page({ name: "4", master: "L", masterItems: [RULE] })], onMaster);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.defect).toBe("master-item-missing");
    expect(r.findings[0]!.property).toBe("m1");
    expect(r.findings[0]!.page).toBe("4");
  });

  it("сторінка без батьківської — знахідка master-none", () => {
    const r = detectMasters([page({ name: "3", master: null, masterItems: [] })], onMaster);
    expect(r.findings.map((f) => f.defect)).toEqual(["master-none"]);
  });

  it("сторінка без батьківської НЕ дає ще й master-item-missing на кожен елемент", () => {
    const r = detectMasters([page({ name: "3", master: null, masterItems: [] })], onMaster);
    expect(r.findings).toHaveLength(1);
  });
});

describe("розподіл батьківських", () => {
  it("віддає таблицею, а не діагнозом", () => {
    const r = detectMasters(
      [
        page({ name: "1", master: "L", masterItems: [FOLIO, RULE] }),
        page({ name: "2", master: "L", masterItems: [FOLIO, RULE] }),
        page({ name: "3", master: null, masterItems: [] }),
      ],
      onMaster,
    );
    expect(r.distribution).toEqual([
      { master: "L", pages: ["1", "2"] },
      { master: null, pages: ["3"] },
    ]);
  });

  it("рідкісна батьківська НЕ стає знахідкою сама по собі", () => {
    const r = detectMasters(
      [
        page({ name: "1", master: "L", masterItems: [FOLIO, RULE] }),
        page({ name: "2", master: "L", masterItems: [FOLIO, RULE] }),
        page({ name: "3", master: "Rozdil", masterItems: [] }),
      ],
      new Map([...onMaster, ["Rozdil", []]]),
    );
    expect(r.findings).toEqual([]);
  });
});

describe("невідома батьківська", () => {
  it("батьківська, склад якої невідомий, знахідок про елементи не породжує", () => {
    const r = detectMasters([page({ name: "9", master: "Nevidoma", masterItems: [] })], onMaster);
    expect(r.findings).toEqual([]);
  });
});

describe("перевизначення за ідентичністю (Крок 4)", () => {
  it("елемент, відсутній у masterItems, але перевизначений у pageItems — master-item-overridden, не master-item-missing", () => {
    const r = detectMasters(
      [
        page({
          name: "2",
          master: "L",
          masterItems: [RULE],
          pageItems: [{ id: "new-291", overriddenMasterItemId: "m1", hasAutoPageNumber: false }],
        }),
      ],
      onMaster,
    );
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.defect).toBe("master-item-overridden");
    expect(r.findings[0]!.property).toBe("m1");
    expect(r.findings[0]!.page).toBe("2");
  });

  it("сторонній перевизначений елемент (overriddenMasterItemId іншого id) не маскує справжнє видалення", () => {
    const r = detectMasters(
      [
        page({
          name: "5",
          master: "L",
          masterItems: [],
          pageItems: [{ id: "new-999", overriddenMasterItemId: "m2", hasAutoPageNumber: false }],
        }),
      ],
      onMaster,
    );
    /* m2 справді перевизначено — своя знахідка. m1 не на місці й не
     * перевизначений (overriddenMasterItemId стороннього запису — "m2", не
     * "m1") — це видалення, і воно НЕ повинне зникнути через те, що якийсь
     * інший елемент батьківської на сторінці перевизначений. */
    expect(r.findings).toHaveLength(2);
    const missing = r.findings.find((f) => f.defect === "master-item-missing");
    expect(missing?.property).toBe("m1");
    const overridden = r.findings.find((f) => f.defect === "master-item-overridden");
    expect(overridden?.property).toBe("m2");
  });
});

describe("фоліо (Крок 4, за виміром AUTO_PAGE_NUMBER)", () => {
  const FOLIO_MARKED: MasterItemRef = { id: "f1", kind: "TextFrame", isFolio: true };
  const onMasterWithFolio = new Map<string, MasterItemRef[]>([["F", [FOLIO_MARKED, RULE]]]);

  it("видалений елемент батьківської, позначений isFolio — folio-missing, не master-item-missing", () => {
    const r = detectMasters([page({ name: "4", master: "F", masterItems: [RULE] })], onMasterWithFolio);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.defect).toBe("folio-missing");
    expect(r.findings[0]!.property).toBe("f1");
  });

  /*
   * Борг Фази 4, закритий 2026-08-05. Раніше `folio-missing` покривав лише
   * «елемент батьківської повністю видалено», а стан «перевизначено, і
   * автономер замінено вручну вбитим текстом» ішов звичайним
   * `master-item-overridden` — нарівні зі зсунутою декоративною лінійкою.
   * Різниця істотна: елемент НА МІСЦІ й виглядає як фоліо, але номер у ньому
   * більше не автоматичний, тож при першому ж перекомпонуванні він стане
   * неправильним МОВЧКИ.
   *
   * Пара тестів тримає межу з обох боків: автономер лишився — звичайне
   * перевизначення; автономер зник — folio-missing. Один тест без другого
   * дозволив би детектору позначати будь-яке перевизначення фоліо.
   */
  it("перевизначене фоліо БЕЗ автономера — folio-missing, а не звичайне перевизначення", () => {
    const r = detectMasters(
      [
        page({
          name: "3",
          master: "F",
          masterItems: [RULE],
          pageItems: [{ id: "new-7", overriddenMasterItemId: "f1", hasAutoPageNumber: false }],
        }),
      ],
      onMasterWithFolio,
    );
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.defect).toBe("folio-missing");
    expect(r.findings[0]!.property).toBe("f1");
    expect(r.findings[0]!.actual).toBe("overridden-without-auto-number");
    /* Причина названа так, щоб оператор зрозумів, чому це гірше за
     * відсутній номер: неправильний номер видно не одразу. */
    expect(r.findings[0]!.detail).toMatch(/manually killed|recomposition/);
  });

  it("НЕ фоліо без автономера перевизначенням і лишається — правило не поширюється на все", () => {
    const r = detectMasters(
      [
        page({
          name: "8",
          master: "F",
          masterItems: [FOLIO_MARKED],
          /* RULE — це m2, не m1: у цьому describe фоліо має id "f1". */
          pageItems: [{ id: "new-8", overriddenMasterItemId: "m2", hasAutoPageNumber: false }],
        }),
      ],
      onMasterWithFolio,
    );
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.defect).toBe("master-item-overridden");
  });

  it("перевизначений елемент з isFolio лишається master-item-overridden, не folio-missing", () => {
    const r = detectMasters(
      [
        page({
          name: "2",
          master: "F",
          masterItems: [RULE],
          pageItems: [{ id: "new-1", overriddenMasterItemId: "f1", hasAutoPageNumber: true }],
        }),
      ],
      onMasterWithFolio,
    );
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.defect).toBe("master-item-overridden");
  });
});

describe("склад батьківської за боком сторінки (Крок 4)", () => {
  /*
   * Виміряно (Задача 7, живий InDesign): `masterSpread.pages[k].side` дає ту
   * саму назву enum, що й документна сторінка. Той самий майстер може мати
   * РІЗНИЙ склад на лівій і правій стороні розвороту (фоліо зліва й фоліо
   * справа — різні елементи, різні `.id`). Ключ мапи, що це відрізняє,
   * будує викликач (`${master}#${side}`) — детектор пробує його першим,
   * і лише якщо такого ключа немає, звертається до "голого" імені
   * батьківської (сумісність із рештою тестів файлу, де сторони не
   * розрізняються).
   */
  const LEFT_FOLIO: MasterItemRef = { id: "left-1", kind: "TextFrame", isFolio: true };
  const RIGHT_FOLIO: MasterItemRef = { id: "right-1", kind: "TextFrame", isFolio: true };
  const bySide = new Map<string, MasterItemRef[]>([
    ["B-L#LEFT_HAND", [LEFT_FOLIO]],
    ["B-L#RIGHT_HAND", [RIGHT_FOLIO]],
  ]);

  it("ліва сторінка звіряється лише зі своєю (лівою) композицією батьківської", () => {
    const r = detectMasters(
      [page({ name: "2", side: "LEFT_HAND", master: "B-L", masterItems: [LEFT_FOLIO] })],
      bySide,
    );
    /* left-1 на місці; right-1 сюди взагалі не входить у порівняння —
     * інакше сторінка LEFT_HAND хибно отримала б знахідку на елемент,
     * якого їй ніколи не належало. */
    expect(r.findings).toEqual([]);
  });

  it("права сторінка з відсутнім своїм фоліо — folio-missing, а не помилкова знахідка про лівий елемент", () => {
    const r = detectMasters(
      [page({ name: "3", side: "RIGHT_HAND", master: "B-L", masterItems: [] })],
      bySide,
    );
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.defect).toBe("folio-missing");
    expect(r.findings[0]!.property).toBe("right-1");
  });
});

/*
 * «СТОРОНИ НЕ ЗНАЙДЕНО» ЧИТАЛОСЯ ЯК «НІЧОГО НЕ БРАКУЄ».
 *
 * `map.jsx` не міг зіставити жодну сторінку майстра за стороною й віддавав
 * порожній масив, називаючи це у власному коментарі «чесним not found». Але
 * `[]` у TS ІСТИННЕ: `if (!expected) continue` не спрацьовував, цикл по
 * елементах ішов нуль разів, і сторінка діставала нуль знахідок — байт у байт
 * як перевірена й чиста. Колонцифра, видалена зі сторінки, у такому стані не
 * давала нічого.
 *
 * Тепер станів три: масив з елементами — композиція відома; порожній масив —
 * майстер є й елементів на ньому справді нема; `null` — невідомо.
 */
describe("невідома композиція майстра", () => {
  const сторінка = (over: Partial<PageMeasure> = {}): PageMeasure =>
    ({ name: "46", side: "LEFT_HAND", master: "B", masterItems: [], pageItems: [],
       expectedMasterItems: [], ...over }) as unknown as PageMeasure;

  it("null дає окрему знахідку, а не мовчання", () => {
    const r = detectMasters([сторінка()], new Map([["B#LEFT_HAND", null]]));
    const d = r.findings.map((f) => f.defect);
    expect(d).toContain("master-composition-unknown");
  });

  it("знахідка каже, що це «не порівняно», а не «нічого не бракує»", () => {
    const r = detectMasters([сторінка()], new Map([["B#LEFT_HAND", null]]));
    const f = r.findings.find((x) => x.defect === "master-composition-unknown")!;
    expect(f.detail).toMatch(/not compared/u);
    expect(f.page).toBe("46");
  });

  it("НЕГАТИВНИЙ КОНТРОЛЬ: порожній масив — це «елементів нема», і знахідки не дає", () => {
    /* Два стани мусять лишитися різними: якби правка звела їх докупи,
     * кожен майстер без елементів почав би звітувати про невідомість. */
    const r = detectMasters([сторінка()], new Map([["B#LEFT_HAND", []]]));
    expect(r.findings.map((f) => f.defect)).not.toContain("master-composition-unknown");
  });

  it("НЕГАТИВНИЙ КОНТРОЛЬ: майстер, про який вимір мовчить, лишається мовчазним", () => {
    /* `undefined` — не те саме, що `null`: про цей майстер не сказано нічого,
     * і вигадувати композицію не можна. */
    const r = detectMasters([сторінка()], new Map());
    expect(r.findings.map((f) => f.defect)).not.toContain("master-composition-unknown");
  });
});

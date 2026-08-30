import { describe, expect, it } from "vitest";
import { assertDisjointLevels, detectContents, type PlacedParagraph } from "../../src/pagination/contents.js";
import type { ClaimFrame, HeadingRef } from "../../src/pagination/types.js";

const LEVELS = [{ contentsStyle: "Zmist Rozdil", headingStyles: ["Zagolovok"] }];

/**
 * Поля Фази 7, які родина `contents` не читає взагалі.
 *
 * `overlaps: null` тут — не недбалість, а те, що віддає вимір: таблиця
 * перекриттів будується ЛИШЕ під родину `folio` (§4.2), тож для рамки змісту
 * стан чесно «не рахували». Поставити `[]` означало б написати у фікстуру
 * факт про верстку, якого ніхто не міряв.
 */
const CONTENTS_FRAME_FIELDS = {
  bounds: { y1: 0, x1: 0, y2: 10, x2: 10 },
  layerName: "Layer 1",
  layerVisible: true,
  layerPrintable: true,
  fromMaster: false,
  locked: false,
  layerLocked: false,
  overlaps: null,
};

function place(over: Partial<PlacedParagraph>): PlacedParagraph {
  return {
    frameId: "f", page: "8", spreadIndex: 4, styleName: "Zmist Rozdil",
    index: 0, literals: [], markers: [], text: "", baseline: 50, leading: 4,
    ...over,
  };
}

function pair(order: number, claimed: number[], markers: PlacedParagraph["markers"] = []) {
  return {
    title: place({ index: order, text: `nazva ${order}`, baseline: 50 + order * 10 }),
    number: place({
      frameId: "n", index: order, styleName: "Zmist Cyfra",
      literals: claimed, markers, baseline: 50 + order * 10,
    }),
  };
}

function heading(order: number, page: string | null): HeadingRef {
  return { styleName: "Zagolovok", text: `nazva ${order}`, page, order };
}

describe("detectContents", () => {
  it("НЕГАТИВНИЙ КОНТРОЛЬ: автоматичний рядок ПЕРЕВІРЕНО і він чистий", () => {
    /* Число як інстанс змінної — рядок уже переведено. Ані manual, ані
     * stale тут бути не сміє: посилання правильне за побудовою.
     *
     * notCompared === 0 — НЕ формальність, а суть різниці, і саме її
     * пропустила перша редакція тесту. Мутант («автоматичний рядок більше
     * не пропускається») тоді ВИЖИВ: рядок із посиланням має порожні
     * literals, тож його однаково ловила наступна гілка й теж не давала
     * знахідок. Але вона кладе його в notCompared, тобто каже «не
     * перевірено» про рядок, який насправді В ПОРЯДКУ. Без цього рядка
     * тесту гілка isAutomatic була мертвим кодом. */
    const r = detectContents([pair(0, [], ["text-variable"])], [heading(0, "48")], LEVELS, []);
    expect(r.findings).toEqual([]);
    expect(r.checked).toBe(1);
    expect(r.notCompared).toBe(0);
  });

  it("рядок БЕЗ числа взагалі — це notCompared, а не «в порядку»", () => {
    /* Протилежний бік тієї самої межі: порожній рядок без маркера нема з
     * чим звіряти, і мовчати про це не можна. */
    const r = detectContents([pair(0, [])], [heading(0, "48")], LEVELS, []);
    expect(r.findings).toEqual([]);
    expect(r.notCompared).toBe(1);
  });

  it("літеральне число з правильною сторінкою — manual, але НЕ stale", () => {
    /* Головне питання родини після зонда: не «чи правильне число», а «чи
     * переведено рядок». Число правильне ЗАРАЗ, але зламається. */
    const r = detectContents([pair(0, [48])], [heading(0, "48")], LEVELS, []);
    expect(r.findings.map((f) => f.defect)).toEqual(["contents-manual"]);
  });

  it("застаріле літеральне число дає і manual, і stale з обома значеннями", () => {
    const r = detectContents([pair(0, [48])], [heading(0, "51")], LEVELS, []);
    const stale = r.findings.find((f) => f.defect === "contents-stale");
    expect(stale!.claimed).toBe("48");
    expect(stale!.actual).toBe("51");
    expect(r.findings.map((f) => f.defect)).toContain("contents-manual");
  });

  it("розбіжність кількості ЗУПИНЯЄ рівень, а не дає N хибних знахідок", () => {
    /* Урок Фази 5: чисельник і знаменник із різних популяцій. Зсув на
     * одиницю зробив би «застарілими» обидві пари, хоча дефект один. */
    const r = detectContents(
      [pair(0, [48]), pair(1, [51])],
      [heading(0, "48"), heading(1, "51"), heading(2, "56")],
      LEVELS,
      [],
    );
    expect(r.findings.map((f) => f.defect)).toEqual(["contents-count-mismatch"]);
    expect(r.notCompared).toBe(2);
  });

  it("заголовок у переповненому тексті йде в notCompared, не в знахідки", () => {
    const r = detectContents([pair(0, [48])], [heading(0, null)], LEVELS, []);
    expect(r.findings.map((f) => f.defect)).toEqual(["contents-manual"]);
    expect(r.notCompared).toBe(1);
  });

  it("повернена рамка чисел дає власну знахідку, а не тихий пропуск", () => {
    const rotated: ClaimFrame = {
      id: "rot", page: "8", styleName: "Zmist Cyfra", rotationAngle: -90,
      paragraphs: [{ index: 0, styleName: null, text: "9", literals: [9], markers: [], literalOffsets: [0], baseline: 5, leading: 4 }],
      ...CONTENTS_FRAME_FIELDS,
    };
    const r = detectContents([], [], LEVELS, [rotated]);
    expect(r.findings.map((f) => f.defect)).toEqual(["contents-rotated-frame"]);
  });

  it("один стиль змісту може відповідати КІЛЬКОМ стилям заголовків", () => {
    const levels = [{ contentsStyle: "Zmist Rozdil", headingStyles: ["Zag A", "Zag B"] }];
    const r = detectContents(
      [pair(0, [48]), pair(1, [51])],
      [
        { styleName: "Zag A", text: "n0", page: "48", order: 0 },
        { styleName: "Zag B", text: "n1", page: "51", order: 1 },
      ],
      levels,
      [],
    );
    expect(r.findings.filter((f) => f.defect === "contents-stale")).toEqual([]);
    expect(r.checked).toBe(2);
  });

  it("МОНОТОННІСТЬ: спадання чисел ловиться без жодної міри схожості", () => {
    /* Замінює зіставлення назв (спек §4.5). 48, 51, 47 — 47 підозріле
     * незалежно від того, з якою назвою воно склало пару. */
    const r = detectContents(
      [pair(0, [48]), pair(1, [51]), pair(2, [47])],
      [heading(0, "48"), heading(1, "51"), heading(2, "47")],
      LEVELS,
      [],
    );
    expect(r.findings.map((f) => f.defect)).toContain("contents-out-of-order");
  });

  it("зростаючі числа монотонність не турбує", () => {
    const r = detectContents(
      [pair(0, [48]), pair(1, [51]), pair(2, [56])],
      [heading(0, "48"), heading(1, "51"), heading(2, "56")],
      LEVELS,
      [],
    );
    expect(r.findings.map((f) => f.defect)).not.toContain("contents-out-of-order");
  });
});

describe("assertDisjointLevels", () => {
  it("один стиль заголовка у двох рівнях — гучна помилка, не тиха розбіжність", () => {
    expect(() =>
      assertDisjointLevels([
        { contentsStyle: "A", headingStyles: ["H1"] },
        { contentsStyle: "B", headingStyles: ["H1", "H2"] },
      ]),
    ).toThrow(/H1/);
  });

  it("неперетинні рівні проходять", () => {
    expect(() =>
      assertDisjointLevels([
        { contentsStyle: "A", headingStyles: ["H1"] },
        { contentsStyle: "B", headingStyles: ["H2"] },
      ]),
    ).not.toThrow();
  });
});

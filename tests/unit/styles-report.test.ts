import { describe, expect, it } from "vitest";
import type { StyleValues } from "../../src/layout/types.js";
import { buildReport, type StyleRow } from "../../src/styles/report.js";
import type { DeclaredStyle, StylesMeasure } from "../../src/styles/types.js";

/** Рядки звіту з увімкненою родиною `overrides` — звичайний випадок. */
function rowsOf(m: StylesMeasure): StyleRow[] {
  return buildReport(m).rows;
}

const EMPTY: StyleValues = {
  firstLineIndent: null, leftIndent: null, rightIndent: null,
  spaceBefore: null, spaceAfter: null, pointSize: null, leading: null,
  justification: null, appliedFont: null, fontStyle: null, tracking: null, listType: null,
};

/** `id` окремим параметром — за замовчуванням дорівнює назві, як у решти родин Фази 5. */
function style(name: string, id = name): DeclaredStyle {
  return {
    id, name, path: name, basedOn: null, basedOnId: null, nextStyle: null,
    declared: { ...EMPTY, firstLineIndent: 0 },
  };
}

/**
 * Абзац, що ВІДХИЛЯЄТЬСЯ від стилю за firstLineIndent. `styleId` за
 * замовчуванням === назві. `isMaster` — четвертий параметр, за замовчуванням
 * `false`: більшість тестів звіту про батьківські не питають, і додавати
 * прапорець кожному виклику було б шумом.
 */
function deviant(styleName: string, index: number, styleId = styleName, isMaster = false) {
  return {
    containerId: "story:1", paragraphIndex: index, page: "1", styleName, styleId,
    isMaster,
    declared: { ...EMPTY, firstLineIndent: 0 },
    actual: { ...EMPTY, firstLineIndent: 12 },
    hasCharacterStyleRuns: false, preview: "",
  };
}

/** Абзац, що збігається зі стилем. `isMaster` — той самий сенс, що в `deviant`. */
function clean(styleName: string, index: number, styleId = styleName, isMaster = false) {
  return {
    containerId: "story:1", paragraphIndex: index, page: "1", styleName, styleId,
    isMaster,
    declared: { ...EMPTY, firstLineIndent: 0 },
    actual: { ...EMPTY, firstLineIndent: 0 },
    hasCharacterStyleRuns: false, preview: "",
  };
}

function measure(styles: DeclaredStyle[], paragraphs: StylesMeasure["paragraphs"]): StylesMeasure {
  return { docName: "Test.indd", styles, paragraphs, ranges: [], characterStyles: [], scales: [], paragraphsOffPage: 0 };
}

describe("buildReport", () => {
  it("частка 100 % — стиль, який перевизначають усі його абзаци", () => {
    const rows = rowsOf(measure([style("A")], [deviant("A", 0), deviant("A", 1)]));
    const a = rows.find((r) => r.styleName === "A")!;
    expect(a.paragraphs).toBe(2);
    expect(a.deviating).toBe(2);
    expect(a.ratio).toBe(1);
  });

  it("частка 0 % — стиль, який працює як задумано", () => {
    const rows = rowsOf(measure([style("A")], [clean("A", 0), clean("A", 1)]));
    const a = rows.find((r) => r.styleName === "A")!;
    expect(a.deviating).toBe(0);
    expect(a.ratio).toBe(0);
  });

  /*
   * Найважливіший тест форми. 0 з 0 — це НЕ нуль відсотків: невживаний стиль
   * не «працює бездоганно», його просто ніхто не застосовував. Плутати ці два
   * стани означало б показувати 14 невживаних стилів книжки в тому самому
   * рядку, що й `Пункт чеклисту` з його чесними 0 зі 134.
   */
  it("невживаний стиль дає ratio null, а не 0", () => {
    const rows = rowsOf(measure([style("A"), style("Unused")], [clean("A", 0)]));
    const unused = rows.find((r) => r.styleName === "Unused")!;
    expect(unused.paragraphs).toBe(0);
    expect(unused.ratio).toBeNull();
  });

  it("частка ніколи не перевищує 1, навіть коли абзац відхиляється у двох групах", () => {
    const both = {
      ...deviant("A", 0),
      declared: { ...EMPTY, firstLineIndent: 0, pointSize: 10 },
      actual: { ...EMPTY, firstLineIndent: 12, pointSize: 14 },
    };
    const rows = rowsOf(measure([style("A")], [both]));
    expect(rows.find((r) => r.styleName === "A")!.ratio).toBe(1);
  });

  it("рядок несе шлях, basedOn і nextStyle з інвентарю", () => {
    const withMeta: DeclaredStyle = {
      id: "x", name: "A", path: "Теки/A", basedOn: "Базовий", basedOnId: null, nextStyle: "Наступний", declared: EMPTY,
    };
    const rows = rowsOf(measure([withMeta], [clean("A", 0, "x")]));
    const a = rows.find((r) => r.styleName === "A")!;
    expect(a.path).toBe("Теки/A");
    expect(a.basedOn).toBe("Базовий");
    expect(a.nextStyle).toBe("Наступний");
  });

  it("рядки впорядковані за спаданням числа абзаців", () => {
    const rows = rowsOf(
      measure([style("Мало"), style("Багато")], [clean("Багато", 0), clean("Багато", 1), clean("Мало", 2)]),
    );
    expect(rows[0]!.styleName).toBe("Багато");
  });

  it("стиль, застосований до абзаців, але відсутній в інвентарі, все одно отримує рядок", () => {
    const rows = rowsOf(measure([style("A")], [clean("Привид", 0)]));
    expect(rows.find((r) => r.styleName === "Привид")).toBeDefined();
  });

  /*
   * Дрібне із рецензії: резерв `path` для стиля-привида (`m?.path ?? u?.styleName ?? ""`)
   * ніде раніше не перевірявся тестом. У стилю поза інвентарем ШЛЯХУ не існує
   * взагалі — теки, з яких він міг би складатися, ніхто не оголошував, —
   * тож резерв бере назву самого абзацу.
   */
  it("для стиля-привида path бере назву абзацу — окремого шляху в нього немає", () => {
    const rows = rowsOf(measure([style("A")], [clean("Привид", 0)]));
    expect(rows.find((r) => r.styleName === "Привид")!.path).toBe("Привид");
  });

  /*
   * CRITICAL із рецензії, коло 1: знаменник частки не може рахувати те,
   * чого чисельник структурно не бачить. `countUsage` (джерело `paragraphs`)
   * бере ПОВНИЙ список абзаців, а `detectOverrides` (джерело `deviating` і
   * findings) фільтрує `isMaster` ЩЕ ДО генерації знахідок. Стиль, ужитий
   * лише на батьківських, раніше показував би `ratio: 0` — «перевірили й
   * чисто» — хоча жоден його абзац НІКОЛИ не входив у перевірку. Це той
   * самий дефект «0 замість null», яким тестовано ratio невживаного стилю
   * вище, лише третім, раніше не покритим шляхом.
   */
  it("стиль, ужитий ЛИШЕ на батьківських — paragraphs > 0, але paragraphsAudited і ratio відбивають, що нічого не порівнювали", () => {
    const rows = rowsOf(
      measure([style("Колонтитул")], [
        clean("Колонтитул", 0, "Колонтитул", true),
        clean("Колонтитул", 1, "Колонтитул", true),
      ]),
    );
    const row = rows.find((r) => r.styleName === "Колонтитул")!;
    expect(row.paragraphs).toBe(2);
    expect(row.paragraphsAudited).toBe(0);
    expect(row.ratio).toBeNull();
  });

  it("стиль ужитий і на батьківських, і у верстці — paragraphsAudited менший за paragraphs, ratio рахується від меншого", () => {
    const rows = rowsOf(
      measure([style("A")], [
        clean("A", 0, "A", true), // батьківська — поза перевіркою
        clean("A", 1, "A", true), // батьківська — поза перевіркою
        deviant("A", 2, "A", false), // звичайний, відхилений
        clean("A", 3, "A", false), // звичайний, чистий
      ]),
    );
    const row = rows.find((r) => r.styleName === "A")!;
    expect(row.paragraphs).toBe(4);
    expect(row.paragraphsAudited).toBe(2);
    expect(row.deviating).toBe(1);
    expect(row.ratio).toBe(0.5);
  });

  /*
   * ГОЛОВНА ПОПРАВКА ЗА ЗАДАЧАМИ 12–14: ключ рядка — `styleId`, назва ключем
   * не є. Два різні стилі з однаковою назвою мусять дати ДВА рядки, і лише
   * `path`/`styleId` розрізняють їх — `styleName` в обох однаковий і нічого
   * не каже, який саме ужитий.
   */
  it("два стилі з однаковою назвою і різними id дають ДВА рядки, розрізнені за path", () => {
    const rows = rowsOf(
      measure(
        [style("Header", "id1"), style("Header", "id2")],
        [clean("Header", 0, "id1"), clean("Header", 1, "id1")],
      ),
    );
    const withId1 = rows.find((r) => r.styleId === "id1")!;
    const withId2 = rows.find((r) => r.styleId === "id2")!;
    expect(withId1.paragraphs).toBe(2);
    expect(withId1.ratio).toBe(0);
    expect(withId2.paragraphs).toBe(0);
    expect(withId2.ratio).toBeNull();
  });

  /*
   * Родину `overrides` вимкнено — і тоді частка мусить бути null, а НЕ 0.
   * Нуль тут означав би «перевіряли й не знайшли», тоді як насправді не
   * перевіряли взагалі. Це головна константа фази (спек §3) у формі, у якій
   * її найлегше порушити непомітно.
   */
  it("без родини overrides частка null, а не 0 — не порівняно не є чистим", () => {
    const rows = buildReport(measure([style("A")], [deviant("A", 0)]), { withOverrides: false }).rows;
    const a = rows.find((r) => r.styleName === "A")!;
    expect(a.paragraphs).toBe(1);
    expect(a.deviating).toBe(0);
    expect(a.ratio).toBeNull();
  });

  it("без родини overrides вжиток усе одно рахується — інвентар від детектора не залежить", () => {
    const rows = buildReport(measure([style("A"), style("Unused")], [clean("A", 0)]), { withOverrides: false }).rows;
    expect(rows.find((r) => r.styleName === "A")!.paragraphs).toBe(1);
    expect(rows.find((r) => r.styleName === "Unused")!.paragraphs).toBe(0);
  });

  it("звіт віддає й самі знахідки перевизначень — для поіменного detail", () => {
    const report = buildReport(measure([style("A")], [deviant("A", 0)]));
    expect(report.overrideFindings.length).toBeGreaterThan(0);
    expect(report.overrideFindings[0]!.styleName).toBe("A");
  });

  it("без родини overrides знахідок немає взагалі", () => {
    const report = buildReport(measure([style("A")], [deviant("A", 0)]), { withOverrides: false });
    expect(report.overrideFindings).toHaveLength(0);
  });
});

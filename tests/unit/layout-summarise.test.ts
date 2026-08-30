import { describe, expect, it } from "vitest";
import { MAX_GROUP_VALUES, summariseByStyle, type StyleUsage } from "../../src/layout/summarise.js";
import type { LayoutFinding } from "../../src/layout/types.js";

function finding(over: Partial<LayoutFinding> = {}): LayoutFinding {
  return {
    id: "f1",
    family: "overrides",
    defect: "style-override",
    group: "indents",
    page: "1",
    containerId: "story:0",
    paragraphIndex: 0,
    styleName: "Osnovnyi",
    styleId: "100",
    property: "firstLineIndent",
    declared: 12,
    actual: 0,
    detail: "",
    ...over,
  };
}

/** Мапа вжитку з одним стилем — id за замовчуванням "100", як у `finding()`. */
function usage(styleName: string, paragraphs: number, styleId = "100"): Map<string, StyleUsage> {
  return new Map([[styleId, { styleName, paragraphs }]]);
}

describe("зведення за стилями", () => {
  it("рахує кількість відхилень на групу", () => {
    const s = summariseByStyle(
      [finding({ id: "a" }), finding({ id: "b", paragraphIndex: 1 })],
      usage("Osnovnyi", 412),
      [],
    );
    expect(s[0]!.styleName).toBe("Osnovnyi");
    expect(s[0]!.styleId).toBe("100");
    expect(s[0]!.paragraphs).toBe(412);
    expect(s[0]!.groups.find((g) => g.group === "indents")?.deviating).toBe(2);
  });

  it("групує фактичні значення й рахує кожне окремо", () => {
    const s = summariseByStyle(
      [
        finding({ id: "a", actual: 0 }),
        finding({ id: "b", actual: 0, paragraphIndex: 1 }),
        finding({ id: "c", actual: 24, paragraphIndex: 2 }),
      ],
      usage("Osnovnyi", 100),
      [],
    );
    const indents = s[0]!.groups.find((g) => g.group === "indents");
    expect(indents?.values).toEqual([
      { property: "firstLineIndent", actual: "0", count: 2 },
      { property: "firstLineIndent", actual: "24", count: 1 },
    ]);
  });

  it("ОДИН абзац із двома відхиленнями в одній групі рахується як один", () => {
    const s = summariseByStyle(
      [
        finding({ id: "a", property: "firstLineIndent" }),
        finding({ id: "b", property: "leftIndent" }),
      ],
      usage("Osnovnyi", 100),
      [],
    );
    expect(s[0]!.groups.find((g) => g.group === "indents")?.deviating).toBe(1);
  });

  it("«не порівняно» не змішується з «відхиляється»", () => {
    const s = summariseByStyle(
      [finding()],
      usage("Osnovnyi", 100),
      [{ styleId: "100", styleName: "Osnovnyi", group: "sizes", reason: "mixed", count: 2 }],
    );
    expect(s[0]!.notCompared).toEqual([{ group: "sizes", reason: "mixed", count: 2 }]);
    expect(s[0]!.groups.find((g) => g.group === "sizes")).toBeUndefined();
  });

  it("стиль без жодного відхилення все одно потрапляє у зведення з нулем", () => {
    const s = summariseByStyle([], usage("Chystyi", 50, "200"), []);
    expect(s).toEqual([{ styleId: "200", styleName: "Chystyi", paragraphs: 50, groups: [], notCompared: [] }]);
  });

  it("контролює регресію: ключ абзаца MУСИТЬ включати containerId", () => {
    const s = summariseByStyle(
      [
        finding({ id: "a", paragraphIndex: 0, containerId: "story:0" }),
        finding({ id: "b", paragraphIndex: 0, containerId: "story:1" }),
      ],
      usage("Osnovnyi", 100),
      [],
    );
    expect(s[0]!.groups.find((g) => g.group === "indents")?.deviating).toBe(2);
  });

  it("контролює регресію: знахідки з group: null (masters) НЕ повинні потрапити в зведення", () => {
    const s = summariseByStyle(
      [
        finding({ id: "masters1", family: "masters", group: null, property: "master-ref", paragraphIndex: 0 }),
        finding({ id: "overrides1", family: "overrides", group: "indents", paragraphIndex: 1 }),
      ],
      usage("Osnovnyi", 100),
      [],
    );
    const indents = s[0]!.groups.find((g) => g.group === "indents");
    expect(indents?.deviating).toBe(1);
    expect(s[0]!.groups).toHaveLength(1);
  });

  /*
   * ВИМІРЯНО зондом H5 на робочій книжці: два різні стилі з однаковою назвою
   * «Основний текст L» — 565 абзаців і 0. Лічба за назвою зводила їх в один
   * рядок, і НЕВЖИВАНИЙ зникав зі звіту цілком. Імена тут навмисно
   * абстрактні: тест перевіряє механіку, а не конкретну книжку.
   */
  it("два стилі з ОДНАКОВОЮ назвою й різними id дають ДВА рядки", () => {
    const usageMap = new Map<string, StyleUsage>([
      ["100", { styleName: "Однакова назва", paragraphs: 565 }],
      ["200", { styleName: "Однакова назва", paragraphs: 0 }],
    ]);
    const rows = summariseByStyle([], usageMap, []);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.styleId).sort()).toEqual(["100", "200"]);
    expect(rows.every((r) => r.styleName === "Однакова назва")).toBe(true);
  });

  it("невживаний однойменний стиль НЕ зникає — саме він і був утрачений", () => {
    const usageMap = new Map<string, StyleUsage>([
      ["100", { styleName: "Однакова назва", paragraphs: 565 }],
      ["200", { styleName: "Однакова назва", paragraphs: 0 }],
    ]);
    const rows = summariseByStyle([], usageMap, []);
    expect(rows.find((r) => r.styleId === "200")!.paragraphs).toBe(0);
  });

  /*
   * I-6 ФІНАЛЬНОЇ РЕЦЕНЗІЇ. `values` росте на КОЖНУ нову пару
   * (властивість, значення) — стелі за побудовою не було жодної, а
   * `styles_audit` не має параметра сторінок і завжди йде по всьому
   * документу. Виміряні 9 187 Б дефолтної відповіді — це фікстура на 9
   * сторінок.
   *
   * 60 різних значень проти MAX_GROUP_VALUES = 20: перелік обрізано,
   * обрізання НАЗВАНЕ, а `total` називає ЗАГАЛ пар (60), не стелю —
   * інакше поле брехало б саме тим числом, заради якого існує.
   */
  it("перелік значень групи має стелю; обрізання назване через valuesTruncated", () => {
    const findings: LayoutFinding[] = [];
    for (let i = 0; i < 60; i += 1) {
      findings.push(finding({ id: `f${i}`, paragraphIndex: i, actual: i }));
    }
    const s = summariseByStyle(findings, usage("Osnovnyi", 60), []);
    const indents = s[0]!.groups.find((g) => g.group === "indents")!;
    expect(indents.values).toHaveLength(MAX_GROUP_VALUES);
    expect(indents.valuesTruncated).toEqual({ shown: MAX_GROUP_VALUES, total: 60 });
    /* Лічба АБЗАЦІВ не обрізається — обмежено перелік значень, не облік. */
    expect(indents.deviating).toBe(60);
  });

  it("пар менше за стелю — valuesTruncated відсутнє взагалі, а не {shown: N, total: N}", () => {
    const s = summariseByStyle([finding()], usage("Osnovnyi", 1), []);
    expect(s[0]!.groups[0]!.valuesTruncated).toBeUndefined();
  });

  /*
   * ПРОГАЛИНА, ЗНАЙДЕНА РЕЦЕНЗІЄЮ ХВИЛІ: усі тести стелі вище працюють на
   * ОДНОМУ стилі, тож ізоляція між стилями не була покрита нічим.
   * `valuesTruncated` існує рівно для того, щоб сказати оператору,
   * скільки значень він НЕ бачить, — і якби множина ключів була спільна
   * на всі стилі (ключ «назва групи» замість пари «стиль + група»),
   * стиль із трьома парами звітував би `total` з чужих стилів.
   *
   * Фікстура рецензента дослівно: A має 25 пар (стеля спрацьовує),
   * B має 3 (не спрацьовує). Мутант зі спільною множиною дав би B
   * `{ shown: 3, total: 28 }` — саме те число з чужого стилю.
   */
  it("valuesTruncated ізольоване між стилями — total не натягується з сусіднього стилю", () => {
    const findings: LayoutFinding[] = [];
    for (let i = 0; i < 25; i += 1) {
      findings.push(finding({ id: `a${i}`, styleId: "A", styleName: "A", paragraphIndex: i, actual: 1000 + i }));
    }
    for (let i = 0; i < 3; i += 1) {
      findings.push(finding({ id: `b${i}`, styleId: "B", styleName: "B", paragraphIndex: 100 + i, actual: 5000 + i }));
    }
    const usageMap = new Map<string, StyleUsage>([
      ["A", { styleName: "A", paragraphs: 25 }],
      ["B", { styleName: "B", paragraphs: 3 }],
    ]);
    const rows = summariseByStyle(findings, usageMap, []);
    const a = rows.find((r) => r.styleId === "A")!.groups.find((g) => g.group === "indents")!;
    const b = rows.find((r) => r.styleId === "B")!.groups.find((g) => g.group === "indents")!;

    expect(a.values).toHaveLength(MAX_GROUP_VALUES);
    expect(a.valuesTruncated).toEqual({ shown: MAX_GROUP_VALUES, total: 25 });
    /* У B пар менше за стелю — обрізання не було, поля немає взагалі, і
     * ЖОДНОГО «total: 28» із чужої лічби. */
    expect(b.values).toHaveLength(3);
    expect(b.valuesTruncated).toBeUndefined();
  });

  /*
   * Стеля обмежує ПЕРЕЛІК, а не облік уже доданих пар: значення, що
   * потрапило у `values` до вичерпання стелі, мусить лічитися далі. Мутант
   * «припинити рахувати count, щойно перелік заповнився» інакше вижив би.
   */
  it("уже доданa пара лічиться далі й після того, як стеля вичерпана", () => {
    const findings: LayoutFinding[] = [];
    /* Перша пара — 30 разів; далі 60 різних, які переповнюють стелю. */
    for (let i = 0; i < 30; i += 1) findings.push(finding({ id: `a${i}`, paragraphIndex: i, actual: 0 }));
    for (let i = 0; i < 60; i += 1) {
      findings.push(finding({ id: `b${i}`, paragraphIndex: 100 + i, actual: 1000 + i }));
    }
    const s = summariseByStyle(findings, usage("Osnovnyi", 90), []);
    const indents = s[0]!.groups.find((g) => g.group === "indents")!;
    expect(indents.values[0]).toEqual({ property: "firstLineIndent", actual: "0", count: 30 });
    expect(indents.valuesTruncated).toEqual({ shown: MAX_GROUP_VALUES, total: 61 });
  });
});

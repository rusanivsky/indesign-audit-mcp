import { describe, expect, it } from "vitest";
import type { ParagraphMeasure, StyleValues } from "../../src/layout/types.js";
import { countUsage, detectUsage } from "../../src/styles/inventory.js";
import { UNUSED_STYLE_CAVEAT_KEY, type DeclaredStyle } from "../../src/styles/types.js";

const EMPTY: StyleValues = {
  firstLineIndent: null, leftIndent: null, rightIndent: null,
  spaceBefore: null, spaceAfter: null, pointSize: null, leading: null,
  justification: null, appliedFont: null, fontStyle: null, tracking: null, listType: null,
};

function style(name: string, id = name, basedOnId: string | null = null): DeclaredStyle {
  return { id, name, path: name, basedOn: basedOnId, basedOnId, nextStyle: null, declared: EMPTY };
}

function para(styleName: string, styleId = styleName, index: number = 0): ParagraphMeasure {
  return {
    containerId: "story:1", paragraphIndex: index, page: "1", styleName, styleId,
    isMaster: false, declared: EMPTY, actual: EMPTY,
    hasCharacterStyleRuns: false, preview: "",
  };
}

describe("countUsage", () => {
  it("рахує абзаци кожного стилю", () => {
    const counts = countUsage([style("A"), style("B")], [para("A"), para("A", "A", 1), para("B", "B", 2)]);
    expect(counts.get("A")?.paragraphs).toBe(2);
    expect(counts.get("B")?.paragraphs).toBe(1);
  });

  it("оголошений і не вжитий стиль отримує 0, а не зникає з мапи", () => {
    const counts = countUsage([style("A"), style("Unused")], [para("A")]);
    expect(counts.get("Unused")?.paragraphs).toBe(0);
  });

  it("абзац зі стилем, якого немає в інвентарі, все одно рахується", () => {
    const counts = countUsage([style("A")], [para("Привид")]);
    expect(counts.get("Привид")?.paragraphs).toBe(1);
  });

  it("два стилі з однаковою назвою й різними id рахуються окремо", () => {
    const counts = countUsage(
      [style("Header", "id1"), style("Header", "id2")],
      [para("Header", "id1"), para("Header", "id1"), para("Header", "id2")],
    );
    expect(counts.get("id1")?.paragraphs).toBe(2);
    expect(counts.get("id2")?.paragraphs).toBe(1);
    expect(counts.get("id1")?.styleName).toBe("Header");
    expect(counts.get("id2")?.styleName).toBe("Header");
  });
});

describe("detectUsage", () => {
  it("невживаний стиль дає знахідку без адреси — її в нього немає", () => {
    const found = detectUsage([style("A"), style("Unused")], [para("A")]);
    const unused = found.filter((f) => f.defect === "style-unused-leaf");
    expect(unused).toHaveLength(1);
    expect(unused[0]!.styleName).toBe("Unused");
    expect(unused[0]!.styleId).toBe("Unused");
    expect(unused[0]!.page).toBeNull();
    expect(unused[0]!.containerId).toBeNull();
    expect(unused[0]!.paragraphIndex).toBeNull();
  });

  it("службовий стиль у верстці дає знахідку НА КОЖЕН абзац, бо адреса в неї є", () => {
    const found = detectUsage(
      [style("[Basic Paragraph]")],
      [para("[Basic Paragraph]", "[Basic Paragraph]", 0), para("[Basic Paragraph]", "[Basic Paragraph]", 7)],
    );
    const applied = found.filter((f) => f.defect === "default-style-applied");
    expect(applied).toHaveLength(2);
    expect(applied[0]!.paragraphIndex).toBe(0);
    expect(applied[1]!.paragraphIndex).toBe(7);
    expect(applied[0]!.styleId).toBe("[Basic Paragraph]");
  });

  it("службовий стиль, який НЕ вжито, не дає default-style-applied", () => {
    const found = detectUsage([style("[Basic Paragraph]"), style("A")], [para("A")]);
    expect(found.filter((f) => f.defect === "default-style-applied")).toHaveLength(0);
  });

  it("службовий стиль, який не вжито, ТАКОЖ не дає style-unused-leaf — це не занедбаність", () => {
    const found = detectUsage([style("[Basic Paragraph]"), style("A")], [para("A")]);
    expect(found.filter((f) => f.defect === "style-unused-leaf")).toHaveLength(0);
  });

  it("служ. стиль ПЕРЕД невживаним — обидва обробляються", () => {
    const found = detectUsage(
      [style("[Basic Paragraph]"), style("Unused")],
      [para("A")],
    );
    const unused = found.filter((f) => f.defect === "style-unused-leaf");
    expect(unused).toHaveLength(1);
    expect(unused[0]!.styleName).toBe("Unused");
  });

  it("звич. абзац ПЕРЕД служ. абзацом — служ. абзац відловлюється", () => {
    const found = detectUsage(
      [style("A"), style("[Basic Paragraph]")],
      [para("A"), para("[Basic Paragraph]", "[Basic Paragraph]", 1)],
    );
    const applied = found.filter((f) => f.defect === "default-style-applied");
    expect(applied).toHaveLength(1);
    expect(applied[0]!.paragraphIndex).toBe(1);
  });

  /*
   * ГОЛОВНИЙ ТЕСТ ЗАДАЧІ 15. `styleName` в обох однойменна — "Header" — і
   * НІЧОГО не каже, який із двох стилів невживаний. Лише `styleId` різнить
   * їх: "id1" ужитий тричі, "id2" — жодного разу. Якщо детектор віддасть
   * `styleId` ужитого стилю замість невживаного (мутант Кроку 5), саме цей
   * `expect` впаде — а `styleName` того НЕ покаже.
   */
  it("два стилі з однаковою назвою, один ужитий — рівно один дає style-unused-leaf, і styleId називає САМЕ невживаний", () => {
    const found = detectUsage(
      [style("Header", "id1"), style("Header", "id2")],
      [para("Header", "id1"), para("Header", "id1"), para("Header", "id1")],
    );
    const unused = found.filter((f) => f.defect === "style-unused-leaf");
    expect(unused).toHaveLength(1);
    expect(unused[0]!.styleName).toBe("Header");
    expect(unused[0]!.styleId).toBe("id2");
  });

  /*
   * I-4 ФІНАЛЬНОЇ РЕЦЕНЗІЇ — найважливіше з усього кола, бо це ЄДИНА
   * знахідка фази, що веде до руйнівної дії. Вимір іде по
   * `story.paragraphs` (`src/jsx/styles.jsx`) і не бачить ані комірок
   * таблиць, ані виносок, тож стиль, ужитий лише там, дістає тверде
   * «не застосовано до жодного абзацу» — формулювання, що прямо запрошує
   * видалити ЖИВИЙ стиль. Межа була задокументована лише в типах родини
   * `character` (`RangeMeasure`, `types.ts`) — тобто в сусідній родині й у
   * файлі, куди оператор ніколи не дійде.
   *
   * Перевірка навмисно вимагає КОНКРЕТНИХ слів, а не абстрактного
   * «можливі хибні спрацювання»: оператор мусить знати, ДЕ саме дивитися.
   */
  it("текст style-unused-leaf називає таблиці й виноски поіменно — застереження перед видаленням", () => {
    const found = detectUsage([style("Тільки в таблиці")], []);
    const unused = found.find((f) => f.defect === "style-unused-leaf")!;
    expect(unused.detail).toContain("tables");
    expect(unused.detail).toContain("footnotes");
    expect(unused.detail).toContain("Don't delete");
  });

  /*
   * Рецензія фінальної хвилі, п.2. Повне пояснення механізму НЕ
   * повторюється в кожній знахідці: виміряно 389 Б на знахідку, 1 785 Б з
   * 2 103 Б усього приросту відповіді. Тут — сторож проти повернення
   * повного тексту в текст знахідки: сам механізм («story.paragraphs»,
   * «не заходить») мусить лишатись в одному місці відповіді, а знахідка —
   * нести лише заборону й ключ.
   */
  it("текст style-unused-leaf НЕ повторює пояснення механізму — лише заборона й ключ", () => {
    const unused = detectUsage([style("Тільки в таблиці")], [])
      .find((f) => f.defect === "style-unused-leaf")!;
    expect(unused.detail).not.toContain("story.paragraphs і не заходить");
    expect(unused.detail).toContain(UNUSED_STYLE_CAVEAT_KEY);
    /* Бюджет знахідки: без пояснення механізму вона лишається короткою.
     * Мутант, що повертає повний текст, дає ≈494 Б і падає тут. */
    expect(Buffer.byteLength(unused.detail, "utf8")).toBeLessThan(300);
  });
});

/*
 * РОЗДІЛЕННЯ ВИРОКУ (2026-08-16). Раніше обидва випадки нижче давали той
 * самий `style-unused`, і звіт із 14 такими рядками читався як «усі 14
 * зайві». Знесення за цим списком на живій книжці перекинуло дітей на діда
 * й відправило 387 абзаців чеклістів у виключку. Тести тримають саме те,
 * що відрізняє один вирок від протилежного.
 */
describe("detectUsage: листок проти бази", () => {
  it("невживаний стиль із ЖИВОЮ дитиною — style-unused-base, а не leaf", () => {
    const found = detectUsage(
      [style("Чеклист 2", "base"), style("Підпункт", "kid", "base")],
      [para("Підпункт", "kid")],
    );
    expect(found.filter((f) => f.defect === "style-unused-leaf")).toHaveLength(0);
    const bases = found.filter((f) => f.defect === "style-unused-base");
    expect(bases).toHaveLength(1);
    expect(bases[0]!.styleId).toBe("base");
    expect(bases[0]!.styleName).toBe("Чеклист 2");
  });

  it("текст style-unused-base називає ЧИСЛА навантаження — інакше вирок не діє", () => {
    const found = detectUsage(
      [style("База", "base"), style("A", "a", "base"), style("B", "b", "a")],
      [para("A", "a"), para("B", "b", 1), para("B", "b", 2)],
    );
    const base = found.find((f) => f.defect === "style-unused-base")!;
    expect(base.detail).toContain("2"); /* стилів під нею */
    expect(base.detail).toContain("3"); /* абзаців під ними */
    expect(base.detail).toContain("grandparent");
  });

  it("style-unused-base НЕ несе застереження про таблиці — воно тут не до речі", () => {
    /* Заборона в бази інша: не «перевір таблиці», а «перенеси значення». */
    const found = detectUsage(
      [style("База", "base"), style("A", "a", "base")],
      [para("A", "a")],
    );
    const base = found.find((f) => f.defect === "style-unused-base")!;
    expect(base.detail).not.toContain(UNUSED_STYLE_CAVEAT_KEY);
    expect(base.detail).toContain("move");
  });

  it("мертва гілка Word знімається ЦІЛКОМ: усі три — листки, жодної бази", () => {
    const found = detectUsage(
      [style("Normal", "n"), style("heading 3", "h3", "n"), style("heading 4", "h4", "n"), style("Живий", "l")],
      [para("Живий", "l")],
    );
    expect(found.filter((f) => f.defect === "style-unused-base")).toHaveLength(0);
    expect(found.filter((f) => f.defect === "style-unused-leaf").map((f) => f.styleId).sort()).toEqual(
      ["h3", "h4", "n"],
    );
  });
});

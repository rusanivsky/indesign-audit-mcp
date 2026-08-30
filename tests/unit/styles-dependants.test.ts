import { describe, expect, it } from "vitest";
import type { StyleValues } from "../../src/layout/types.js";
import { classifyUnusedStyles } from "../../src/styles/dependants.js";
import type { DeclaredStyle } from "../../src/styles/types.js";

const EMPTY: StyleValues = {
  firstLineIndent: null, leftIndent: null, rightIndent: null,
  spaceBefore: null, spaceAfter: null, pointSize: null, leading: null,
  justification: null, appliedFont: null, fontStyle: null, tracking: null, listType: null,
};

function style(id: string, basedOnId: string | null = null, name = id): DeclaredStyle {
  return { id, name, path: name, basedOn: basedOnId, basedOnId, nextStyle: null, declared: EMPTY };
}

/** Ужиток: id → скільки абзаців. Стилі, яких тут немає, вважаються з нулем. */
function usage(pairs: Record<string, number>): Map<string, number> {
  return new Map(Object.entries(pairs));
}

describe("classifyUnusedStyles", () => {
  it("невживаний стиль без жодної дитини — ЛИСТОК, його можна знести", () => {
    const c = classifyUnusedStyles([style("A"), style("Сирота")], usage({ A: 5 }));
    expect(c.leaves.has("Сирота")).toBe(true);
    expect(c.bases.has("Сирота")).toBe(false);
  });

  it("невживаний стиль із ЖИВОЮ дитиною — БАЗА, зносити не можна", () => {
    /* Рівно випадок «Чеклист 2»: 0 абзаців на ньому, 253 під ним. */
    const c = classifyUnusedStyles(
      [style("Чеклист2"), style("Підпункт", "Чеклист2")],
      usage({ Підпункт: 253 }),
    );
    expect(c.bases.has("Чеклист2")).toBe(true);
    expect(c.leaves.has("Чеклист2")).toBe(false);
    expect(c.bases.get("Чеклист2")).toEqual({ dependantStyles: 1, dependantParagraphs: 253 });
  });

  it("вжитий стиль не потрапляє в жодну з множин", () => {
    const c = classifyUnusedStyles([style("A")], usage({ A: 1 }));
    expect(c.leaves.has("A")).toBe(false);
    expect(c.bases.has("A")).toBe(false);
  });

  it("навантаження бази рахується ТРАНЗИТИВНО, а не лише по прямих дітях", () => {
    /* Чеклист2 → Підпункт → Стрілка: знесення Чеклиста2 зачіпає обидва. */
    const c = classifyUnusedStyles(
      [style("Чеклист2"), style("Підпункт", "Чеклист2"), style("Стрілка", "Підпункт")],
      usage({ Підпункт: 253, Стрілка: 18 }),
    );
    expect(c.bases.get("Чеклист2")).toEqual({ dependantStyles: 2, dependantParagraphs: 271 });
  });

  it("база, чиї діти всі невживані ЛИСТКИ, сама стає листком — ітеративне обчищення", () => {
    /* Спадок Word: heading 3 і heading 4 стоять на Normal, усі три мертві.
     * Знісши дітей, Normal лишається без дітей — отже теж знімається. */
    const c = classifyUnusedStyles(
      [style("Normal"), style("heading3", "Normal"), style("heading4", "Normal"), style("Живий")],
      usage({ Живий: 10 }),
    );
    expect(c.leaves.has("heading3")).toBe(true);
    expect(c.leaves.has("heading4")).toBe(true);
    expect(c.leaves.has("Normal")).toBe(true);
    expect(c.bases.size).toBe(0);
  });

  it("одна ЖИВА дитина серед мертвих тримає всю гілку — база лишається базою", () => {
    const c = classifyUnusedStyles(
      [style("Корінь"), style("Мертва", "Корінь"), style("Жива", "Корінь")],
      usage({ Жива: 3 }),
    );
    expect(c.leaves.has("Мертва")).toBe(true);
    expect(c.leaves.has("Корінь")).toBe(false);
    expect(c.bases.get("Корінь")).toEqual({ dependantStyles: 1, dependantParagraphs: 3 });
  });

  it("ключ — `id`, не назва: два однойменні стилі класифікуються НЕЗАЛЕЖНО", () => {
    /* У книжці два різні стилі звуться «Основний текст L»: один із 429
     * абзацами, другий мертвий. Лічба за назвою сховала б мертвий за живим. */
    const c = classifyUnusedStyles(
      [style("id1", null, "Основний текст L"), style("id2", null, "Основний текст L")],
      usage({ id1: 429 }),
    );
    expect(c.leaves.has("id2")).toBe(true);
    expect(c.leaves.has("id1")).toBe(false);
  });

  it("`basedOnId` у нікуди не робить нікого базою", () => {
    const c = classifyUnusedStyles([style("Сирота"), style("A", "нема-такого")], usage({ A: 2 }));
    expect(c.leaves.has("Сирота")).toBe(true);
    expect(c.bases.size).toBe(0);
  });

  it("цикл basedOn не зациклює і не оголошується листком", () => {
    /* Обидва невживані, але кожен тримає іншого — консервативно НЕ листки. */
    const c = classifyUnusedStyles([style("X", "Y"), style("Y", "X")], usage({}));
    expect(c.leaves.size).toBe(0);
    expect(c.bases.has("X")).toBe(true);
    expect(c.bases.has("Y")).toBe(true);
  });

  it("стиль, що стоїть сам на собі, не зациклює обхід", () => {
    const c = classifyUnusedStyles([style("Сам", "Сам")], usage({}));
    expect(c.leaves.has("Сам")).toBe(false);
    expect(c.bases.get("Сам")?.dependantParagraphs).toBe(0);
  });

  it("база з нулем абзаців під собою все одно база — вона тримає СТИЛЬ, не текст", () => {
    /* Дитина невживана, але сама є базою живого онука — отже не знімається,
     * отже і батько не знімається. Абзаців у самої дитини нуль. */
    const c = classifyUnusedStyles(
      [style("Дід"), style("Батько", "Дід"), style("Онук", "Батько")],
      usage({ Онук: 7 }),
    );
    expect(c.bases.has("Дід")).toBe(true);
    expect(c.bases.get("Дід")).toEqual({ dependantStyles: 2, dependantParagraphs: 7 });
  });
});

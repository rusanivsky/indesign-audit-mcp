import { describe, expect, it } from "vitest";
import type { ContainerSnapshot } from "../../src/corrections/types.js";
import type { ContainerLanguage } from "../../src/spelling/types.js";
import { scanContainers, toEdits } from "../../src/tools/typography.js";
import { regexRule } from "../../src/typography/rule.js";
import { DASH_RULES, SPACING_RULES } from "../../src/typography/rules-uk.js";

const container = (id: string, text: string, page = "12"): ContainerSnapshot => ({
  containerId: id,
  text,
  pageRuns: [{ start: 0, end: text.length + 1, page }],
  oversetFrom: null,
  isMaster: false,
  kind: "text",
});

describe("scanContainers", () => {
  it("знаходить збіги в кількох контейнерах і називає сторінку", () => {
    const m = scanContainers(
      [container("story:0", "мама - це все", "12"), container("story:1", "тато - теж", "44")],
      DASH_RULES,
    ).matches;
    expect(m).toHaveLength(2);
    expect(m.map((x) => x.page).sort()).toEqual(["12", "44"]);
    expect(m.map((x) => x.containerId).sort()).toEqual(["story:0", "story:1"]);
  });

  it("на чистому тексті нічого не знаходить", () => {
    expect(scanContainers([container("story:0", "мама — це все")], DASH_RULES).matches).toEqual([]);
  });

  it("пропускає контейнери майстер-сторінок", () => {
    const c = { ...container("story:0", "мама - це"), isMaster: true };
    expect(scanContainers([c], DASH_RULES).matches).toEqual([]);
  });
});

const ukRule = regexRule({
  id: "test-uk",
  title: "тестове мовне правило",
  confidence: "high",
  language: "Ukrainian",
  find: /проект/gu,
  replace: "проєкт",
});

const langs = (id: string, runs: Array<[number, number, string]>): ContainerLanguage[] => [
  { containerId: id, runs: runs.map(([start, end, language]) => ({ start, end, language })) },
];

describe("scanContainers — мовний гейт", () => {
  it("збіг в українському діапазоні лишається, у російському — ні", () => {
    /* Обидва твердження в ОДНОМУ тесті навмисно: «у російському немає»
     * істинне й тоді, коли правило не працює взагалі (борг Фази 10). */
    const text = "проект тут. проект там.";
    const r = scanContainers(
      [container("story:0", text)],
      [ukRule],
      langs("story:0", [[0, 12, "Ukrainian"], [12, text.length + 1, "Russian"]]),
    );
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0]!.start).toBe(0);
    expect(r.skippedByLanguage).toBe(1);
  });

  it("збіг НА МЕЖІ мов відкидається й рахується, а не зникає мовчки", () => {
    const text = "проект";
    const r = scanContainers(
      [container("story:0", text)],
      [ukRule],
      langs("story:0", [[0, 3, "Ukrainian"], [3, text.length + 1, "Russian"]]),
    );
    expect(r.matches).toEqual([]);
    expect(r.skippedByLanguage).toBe(1);
  });

  it("правило З мовою без діапазонів КИДАЄ, а не пише мовчки", () => {
    expect(() => scanContainers([container("story:0", "проект")], [ukRule]))
      .toThrow(/test-uk/);
  });

  it("правила БЕЗ мови без діапазонів працюють, як працювали", () => {
    const r = scanContainers([container("story:0", "мама - це все")], DASH_RULES);
    expect(r.matches).toHaveLength(1);
    expect(r.skippedByLanguage).toBe(0);
  });
});

describe("toEdits", () => {
  it("перетворює збіг на правку з очікуваним старим текстом", () => {
    const m = scanContainers([container("story:0", "мама - це все")], DASH_RULES).matches;
    const edits = toEdits(m);
    expect(edits).toHaveLength(1);
    expect(edits[0]!.expectedOld).toBe(" - ");
    expect(edits[0]!.newText).toBe(" — ");
    expect(edits[0]!.containerId).toBe("story:0");
    expect(edits[0]!.action).toBe("replace");
  });

  it("дає кожній правці унікальний requestId", () => {
    const m = scanContainers([container("story:0", "а  б   в")], SPACING_RULES).matches;
    const ids = toEdits(m).map((e) => e.requestId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("порожню заміну (spaceBeforeBreak) віддає як action delete, а не replace з порожнім newText", () => {
    const m = scanContainers([container("story:0", "рядок   \rдалі")], SPACING_RULES).matches;
    const edits = toEdits(m);
    const del = edits.find((e) => e.newText === "");
    expect(del).toBeDefined();
    expect(del!.action).toBe("delete");
  });

  it("відкидає збіги, що перетинаються між собою", () => {
    const m = scanContainers(
      [container("story:0", "мама  -  це")],
      [...SPACING_RULES, ...DASH_RULES],
    ).matches;
    const edits = toEdits(m);
    for (let i = 0; i < edits.length; i++) {
      for (let j = i + 1; j < edits.length; j++) {
        const a = edits[i]!;
        const b = edits[j]!;
        if (a.containerId !== b.containerId) continue;
        expect(a.start < b.end && b.start < a.end).toBe(false);
      }
    }
  });
});

import { describe, expect, it } from "vitest";
import type { BibRecord } from "../../src/bibliography/types.js";
import { parseChicago } from "../../src/bibliography/parse-chicago.js";
import { CHICAGO_RULES } from "../../src/bibliography/rules-chicago.js";
import { CIP_CORRECT, CIP_RECORD } from "./fixtures/chicago-cip.js";

/* start is deliberately NOT zero: it proves offsets are container-relative. */
const START = 100;

const rec = (text: string): BibRecord => ({
  number: 1,
  text,
  containerId: "story:245",
  start: START,
  end: START + text.length,
  page: "4",
});

const run = (text: string, id: string) =>
  CHICAGO_RULES.filter((r) => r.id === id).flatMap((r) => r.check(parseChicago(rec(text))));

describe("правила Chicago, високої певності", () => {
  it("chicago-heading-comma: інверсоване ім'я вимагає коми", () => {
    const f = run(CIP_RECORD, "chicago-heading-comma");
    expect(f).toHaveLength(1);
    expect(f[0]?.before).toBe("Surname Firstname");
    expect(f[0]?.suggested).toBe("Surname, Firstname");
    expect(f[0]?.confidence).toBe("high");
    expect(f[0]?.zone).toBe("heading");
  });

  it("chicago-zone-separator ловить U+2014, а не лише приписаний ДСТУ U+2013", () => {
    /*
     * Вимір на живому записі: обидва тире там — U+2014. Патерн, писаний за
     * буквою стандарту, не знайшов би в документі нічого.
     */
    const f = run(CIP_RECORD, "chicago-zone-separator");
    expect(f).toHaveLength(2);
    expect(f.every((x) => x.suggested === ". ")).toBe(true);
  });

  it("chicago-colon-spacing: пробіл перед двокрапкою прибрано", () => {
    const f = run(CIP_RECORD, "chicago-colon-spacing");
    expect(f).toHaveLength(1);
    expect(f[0]?.before).toBe(" :");
    expect(f[0]?.suggested).toBe(":");
  });

  it("chicago-responsibility-repeat: повтор автора видаляється", () => {
    const f = run(CIP_RECORD, "chicago-responsibility-repeat");
    expect(f).toHaveLength(1);
    expect(f[0]?.before).toBe(" / Firstname Surname");
    expect(f[0]?.suggested).toBe("");
  });

  it("ЖОДНЕ правило не спрацьовує на вже правильному записі", () => {
    const all = CHICAGO_RULES.flatMap((r) => r.check(parseChicago(rec(CIP_CORRECT))));
    expect(all.map((f) => f.ruleId)).toEqual([]);
  });

  it("зсуви — у координатах КОНТЕЙНЕРА, і зріз збігається з before", () => {
    const container = "x".repeat(START) + CIP_RECORD;
    const all = CHICAGO_RULES.flatMap((r) => r.check(parseChicago(rec(CIP_RECORD))));
    expect(all.length).toBeGreaterThan(0);
    for (const f of all) expect(container.slice(f.start, f.end)).toBe(f.before);
  });

  it("нерозібраний запис не дає жодної знахідки", () => {
    const all = CHICAGO_RULES.flatMap((r) =>
      r.check(parseChicago(rec("Just words with no marks at all"))),
    );
    expect(all).toEqual([]);
  });

  it("кожне правило називає підставу", () => {
    for (const r of CHICAGO_RULES) {
      expect(r.basis).toMatch(/CMOS/u);
      expect(r.check.length).toBe(1);
    }
  });
});

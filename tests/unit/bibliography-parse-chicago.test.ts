import { describe, expect, it } from "vitest";
import type { BibRecord } from "../../src/bibliography/types.js";
import { parseChicago } from "../../src/bibliography/parse-chicago.js";
import { CIP_CORRECT, CIP_RECORD } from "./fixtures/chicago-cip.js";

const rec = (text: string): BibRecord => ({
  number: 1,
  text,
  containerId: "story:245",
  start: 0,
  end: text.length,
  page: "4",
});

const zone = (text: string, id: string): string | undefined =>
  parseChicago(rec(text)).zones.find((z) => z.id === id)?.text;

describe("parseChicago", () => {
  it("розбирає живу форму CIP-запису на зони", () => {
    const p = parseChicago(rec(CIP_RECORD));
    expect(p.unparsed).toBeNull();
    expect(zone(CIP_RECORD, "heading")).toBe("Surname Firstname.");
    expect(zone(CIP_RECORD, "title")).toBe("Title");
    expect(zone(CIP_RECORD, "place")).toBe("City");
    expect(zone(CIP_RECORD, "publisher")).toBe("PUBLISHER");
    expect(zone(CIP_RECORD, "year")).toBe("2026");
  });

  it("РОЗБИРАЧ НЕ СУДДЯ: бачить зону навіть із неправильною пунктуацією", () => {
    /*
     * `City :` з пробілом перед двокрапкою — саме те, на що поскаржиться
     * правило. Якби розбирач приймав лише правильну форму, правилу не було б
     * на що показати.
     */
    expect(zone(CIP_RECORD, "place")).toBe("City");
    expect(zone(CIP_CORRECT, "place")).toBe("City");
  });

  it("зона відповідальності — це повтор автора, і її видно окремо", () => {
    expect(zone(CIP_RECORD, "responsibility")).toBe(" / Firstname Surname");
    expect(zone(CIP_CORRECT, "responsibility")).toBeUndefined();
  });

  it("зсуви зон — у координатах ТЕКСТУ ЗАПИСУ", () => {
    for (const t of [CIP_RECORD, CIP_CORRECT]) {
      for (const z of parseChicago(rec(t)).zones) {
        expect(t.slice(z.start, z.end)).toBe(z.text);
      }
    }
  });

  it("тримає обсяг як зону разом із маркером номера сторінки", () => {
    /* Значення тут не число, а `\u0018`. Саме тому правило обсягу не сміє бути high. */
    expect(zone(CIP_RECORD, "extent")).toBe("\u0018 p.");
    expect(zone(CIP_CORRECT, "extent")).toBeUndefined();
  });

  it("абзац без жодного приписного знака лишається нерозібраним", () => {
    const p = parseChicago(rec("Surname Firstname and some words with no marks at all"));
    expect(p.unparsed).not.toBeNull();
    expect(p.zones).toEqual([]);
  });

  it("бачить URL як зону", () => {
    const withUrl = "Surname, Firstname. Title. City: Publisher, 2026. https://example.org/x";
    expect(zone(withUrl, "url")).toBe("https://example.org/x");
  });

  it("запис без заголовка не вигадує його", () => {
    const noHeading = "Title of a Work. City: Publisher, 2026.";
    expect(zone(noHeading, "heading")).toBeUndefined();
    expect(zone(noHeading, "place")).toBe("City");
  });
});

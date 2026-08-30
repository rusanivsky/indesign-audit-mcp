import { describe, it, expect } from "vitest";
import { loadJsxCore } from "./helpers/load-jsx-core.js";

/**
 * Мінімальні заглушки DOM InDesign. container-об'єкти позначені kind: "text",
 * щоб перевірити, що resolveContainer завжди повертає той самий тип (Important 2),
 * незалежно від того, story це, комірка таблиці чи виноска.
 */
function text(label: string) {
  return { kind: "text", label };
}

describe("IDMCP.resolveContainer", () => {
  const IDMCP = loadJsxCore();

  it("story:N повертає Text (той самий тип, що й cell/footnote), а не Story", () => {
    const storyText = text("story-0");
    const doc = { stories: [{ texts: [storyText] }] };

    const result = IDMCP.resolveContainer(doc, "story:0");

    expect(result).toBe(storyText);
    expect(result.kind).toBe("text");
  });

  it("резолвить комірку таблиці story:N/table:N/cell:R,C", () => {
    const cellText = text("cell-1-1");
    const doc = {
      stories: [
        {
          texts: [
            {
              tables: [
                {
                  columns: [{}, {}],
                  rows: [
                    { cells: [{}, {}] },
                    { cells: [{}, { texts: [cellText] }] },
                  ],
                },
              ],
              footnotes: [],
            },
          ],
        },
      ],
    };

    const result = IDMCP.resolveContainer(doc, "story:0/table:0/cell:1,1");

    expect(result).toBe(cellText);
    expect(result.kind).toBe("text");
  });

  it("резолвить виноску story:N/footnote:N", () => {
    const footnoteText = text("footnote-0");
    const doc = {
      stories: [{ texts: [{ tables: [], footnotes: [{ texts: [footnoteText] }] }] }],
    };

    const result = IDMCP.resolveContainer(doc, "story:0/footnote:0");

    expect(result).toBe(footnoteText);
  });

  it("кидає явну помилку на невідомий сегмент (одруківка footnotes замість footnote)", () => {
    const doc = { stories: [{ texts: [{ tables: [], footnotes: [{ texts: [text("f")] }] }] }] };

    expect(() => IDMCP.resolveContainer(doc, "story:0/footnotes:0")).toThrow(/unknown.*segment/i);
  });

  it("кидає явну помилку, якщо перший сегмент не story", () => {
    const doc = { stories: [{ texts: [{ tables: [{ columns: [], rows: [] }] }] }] };

    expect(() => IDMCP.resolveContainer(doc, "table:0")).toThrow(/story/i);
  });

  it("кидає явну помилку на cell без попереднього table", () => {
    const doc = { stories: [{ texts: [{ tables: [], footnotes: [] }] }] };

    expect(() => IDMCP.resolveContainer(doc, "story:0/cell:2,1")).toThrow(/table/i);
  });

  it("кидає явну помилку на індекс story поза діапазоном", () => {
    const doc = { stories: [{ texts: [text("only-story")] }] };

    expect(() => IDMCP.resolveContainer(doc, "story:99999")).toThrow(/out of range/i);
  });

  it("кидає явну помилку на нечисловий індекс story", () => {
    const doc = { stories: [{ texts: [text("s")] }] };

    expect(() => IDMCP.resolveContainer(doc, "story:abc")).toThrow(/index/i);
  });

  it("кидає явну помилку на від'ємний індекс table", () => {
    const doc = { stories: [{ texts: [{ tables: [{ columns: [], rows: [] }], footnotes: [] }] }] };

    expect(() => IDMCP.resolveContainer(doc, "story:0/table:-1")).toThrow(/index/i);
  });
});

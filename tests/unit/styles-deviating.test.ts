import { describe, expect, it } from "vitest";
import type { LayoutFinding } from "../../src/layout/types.js";
import { countDeviating } from "../../src/styles/deviating.js";

function finding(
  styleName: string,
  styleId: string,
  index: number,
  group: LayoutFinding["group"],
  property: string
): LayoutFinding {
  return {
    id: `${styleId}-${index}-${property}`,
    family: "overrides",
    defect: "style-override",
    group,
    page: "1",
    containerId: "story:1",
    paragraphIndex: index,
    styleName,
    styleId,
    property,
    declared: 0,
    actual: 1,
    detail: "",
  };
}

describe("countDeviating", () => {
  it("абзац, відхилений у двох групах, рахується ОДИН раз", () => {
    const counts = countDeviating([
      finding("A", "id-a", 0, "indents", "firstLineIndent"),
      finding("A", "id-a", 0, "sizes", "pointSize"),
    ]);
    expect(counts.get("id-a")).toBe(1);
  });

  it("абзац із двома знахідками в ОДНІЙ групі теж рахується один раз", () => {
    const counts = countDeviating([
      finding("A", "id-a", 0, "indents", "firstLineIndent"),
      finding("A", "id-a", 0, "indents", "leftIndent"),
    ]);
    expect(counts.get("id-a")).toBe(1);
  });

  it("різні абзаци рахуються окремо", () => {
    const counts = countDeviating([
      finding("A", "id-a", 0, "indents", "firstLineIndent"),
      finding("A", "id-a", 1, "indents", "firstLineIndent"),
    ]);
    expect(counts.get("id-a")).toBe(2);
  });

  it("однаковий індекс у РІЗНИХ контейнерах — це різні абзаци", () => {
    const a = finding("A", "id-a", 0, "indents", "firstLineIndent");
    const b = { ...finding("A", "id-a", 0, "indents", "firstLineIndent"), containerId: "story:2" };
    expect(countDeviating([a, b]).get("id-a")).toBe(2);
  });

  it("знахідки без стилю або без групи не рахуються — вони не про абзац проти стилю", () => {
    const orphan = { ...finding("A", "id-a", 0, "indents", "x"), styleId: null };
    expect(countDeviating([orphan]).size).toBe(0);
  });

  it("два РІЗНІ стилі з ОДНАКОВОЮ назвою і РІЗНИМИ id рахуються окремо", () => {
    const counts = countDeviating([
      finding("A", "id-a", 0, "indents", "firstLineIndent"),
      finding("A", "id-b", 0, "indents", "leftIndent"),
    ]);
    expect(counts.get("id-a")).toBe(1);
    expect(counts.get("id-b")).toBe(1);
    expect(counts.size).toBe(2);
  });
});

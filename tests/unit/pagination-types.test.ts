import { describe, expect, it } from "vitest";
import { MAX_PAGINATION_DETAIL_ITEMS, type PaginationFinding } from "../../src/pagination/types.js";

describe("типи pagination", () => {
  it("стеля detail названа числом, а не вгадується на місці", () => {
    expect(MAX_PAGINATION_DETAIL_ITEMS).toBe(50);
  });

  it("знахідка несе адресу, придатну для повторного пошуку", () => {
    const f: PaginationFinding = {
      id: "folio:97:39017:0:stale:94",
      family: "folio",
      defect: "folio-stale",
      page: "97",
      frameId: "39017",
      paragraphIndex: 0,
      claimed: "94",
      actual: "96",
      detail: "текст",
    };
    expect(f.id).toContain("folio");
    expect(f.claimed).not.toBe(f.actual);
  });
});

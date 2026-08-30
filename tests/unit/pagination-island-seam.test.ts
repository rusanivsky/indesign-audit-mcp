import { describe, expect, it, vi } from "vitest";
import type { PageRef, PaginationMeasure } from "../../src/pagination/types.js";
import type { Tools } from "../../src/tools/shared.js";

/*
 * ШОВ МІЖ ДЕТЕКТОРОМ І ІНСТРУМЕНТОМ — його не тримало НІЩО.
 *
 * Ворожа рецензія гілки довела виконанням: `masterIslands:
 * detectMasterIslands(measure.pages)` можна замінити на `masterIslands: []`,
 * і всі 2640 юніт-тестів лишаються зеленими. Чисту функцію перевіряв
 * `pagination-master-island.test.ts`, зшивання зі звітом —
 * `cli-sections.test.ts` (де кандидати подано РУКАМИ). Між ними була
 * порожнеча — тобто головний здобуток гілки можна було відрізати непомітно.
 *
 * Цей файл закриває саме шов: вимір із островом → відповідь інструмента.
 */

const { runJsxMock } = vi.hoisted(() => ({ runJsxMock: vi.fn() }));
vi.mock("../../src/bridge/runner.js", () => ({ runJsx: runJsxMock }));
vi.mock("../../src/bridge/envelope.js", () => ({ runWrite: vi.fn() }));

const { registerPaginationTools } = await import("../../src/tools/pagination.js");

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
type AnyHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

function handler(): AnyHandler {
  let captured: AnyHandler | null = null;
  registerPaginationTools({
    registerTool(name: string, _cfg: unknown, h: AnyHandler) {
      if (name === "pagination_audit") captured = h;
    },
  } as unknown as Tools);
  if (!captured) throw new Error("pagination_audit не зареєстровано");
  return captured;
}

/**
 * Сторінки з ОСТРОВОМ на с. 188 — та сама форма, що виміряна на робочої книжки:
 * ряд `J` з обох боків, одна сторінка `G` посередині.
 */
function pagesWithIsland(): PageRef[] {
  const masters: Record<number, string> = {};
  for (const n of [182, 184, 186, 190, 192]) masters[n] = "J-Розділ 3";
  masters[188] = "G-Без колонтитулів";
  const out: PageRef[] = [];
  let offset = 0;
  for (const name of [182, 184, 186, 188, 190, 192]) {
    out.push({
      name: String(name),
      offset: offset++,
      side: "LEFT_HAND",
      spreadIndex: offset,
      spreadSiblings: [],
      master: masters[name]!,
    });
  }
  return out;
}

function measure(pages: PageRef[]): PaginationMeasure {
  return {
    docName: "book.indd",
    pages,
    folioFrames: [],
    contentsTitles: [],
    contentsNumbers: [],
    headings: [],
    headFrames: [],
    missingStyles: [],
    masterSkipped: { declared: [], undeclared: 0 },
    helperChain: null,
  };
}

describe("шов: детектор острова → відповідь pagination_audit", () => {
  it("острів у ВИМІРІ доходить до відповіді інструмента", async () => {
    runJsxMock.mockReset();
    runJsxMock.mockResolvedValue(measure(pagesWithIsland()));

    const res = await handler()({ folio: { styleNames: ["Колонтитул v1"] } });
    const data = JSON.parse(res.content[0]!.text) as {
      masterIslands: Array<{ page: string; master: string; neighbourMaster: string }>;
    };

    expect(data.masterIslands).toHaveLength(1);
    expect(data.masterIslands[0]!.page).toBe("188");
    expect(data.masterIslands[0]!.master).toBe("G-Без колонтитулів");
    expect(data.masterIslands[0]!.neighbourMaster).toBe("J-Розділ 3");
  });

  it("рівний ряд БЕЗ острова дає порожньо — не «завжди щось знаходить»", async () => {
    const рівні = pagesWithIsland().map((p) => ({ ...p, master: "J-Розділ 3" }));
    runJsxMock.mockReset();
    runJsxMock.mockResolvedValue(measure(рівні));

    const res = await handler()({ folio: { styleNames: ["Колонтитул v1"] } });
    const data = JSON.parse(res.content[0]!.text) as { masterIslands: unknown[] };
    expect(data.masterIslands).toEqual([]);
  });

  it("острів НЕ робить прохід дефектним — це кандидат, не знахідка", async () => {
    /* Родини лишаються чистими: кандидат не сміє запалювати ворота. */
    runJsxMock.mockReset();
    runJsxMock.mockResolvedValue(measure(pagesWithIsland()));

    const res = await handler()({ folio: { styleNames: ["Колонтитул v1"] } });
    expect(res.isError).toBeUndefined();
    const data = JSON.parse(res.content[0]!.text) as {
      folio: { deviating: number } | null;
      masterIslands: unknown[];
    };
    expect(data.masterIslands).toHaveLength(1);
    expect(data.folio?.deviating).toBe(0);
  });
});

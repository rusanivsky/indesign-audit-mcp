import { describe, expect, it, vi } from "vitest";
import type { Tools } from "../../src/tools/shared.js";
import type { RawOverview } from "../../src/inspect/overview.js";

/*
 * Той самий патерн, що в tests/unit/tools-map-handler.test.ts: справжній
 * `registerInspectTools` віддає обробник підставному серверу, міст
 * (`runJsx`) підмінено. Перевіряється рівно те, що обробник робить із
 * виміром, — і, головне, ОБСЯГ того рядка, який пішов би в MCP-відповідь.
 */
const { runJsxMock } = vi.hoisted(() => ({ runJsxMock: vi.fn() }));
vi.mock("../../src/bridge/runner.js", () => ({ runJsx: runJsxMock }));

const { registerInspectTools } = await import("../../src/tools/inspect.js");
const { DEFAULT_MAX_STORIES, OVERVIEW_SECTIONS } = await import("../../src/inspect/overview.js");

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
type AnyHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

function handlerFor(tool: string): AnyHandler {
  let captured: AnyHandler | null = null;
  const fakeServer = {
    registerTool: (name: string, _config: unknown, handler: AnyHandler) => {
      if (name === tool) captured = handler;
    },
  } as unknown as Tools;
  registerInspectTools(fakeServer);
  if (captured === null) throw new Error(`${tool} не зареєстровано`);
  return captured;
}

function descriptionOf(tool: string): string {
  let captured: string | null = null;
  const fakeServer = {
    registerTool: (name: string, config: { description: string }) => {
      if (name === tool) captured = config.description;
    },
  } as unknown as Tools;
  registerInspectTools(fakeServer);
  if (captured === null) throw new Error(`${tool} не зареєстровано`);
  return captured;
}

function raw(storyCount: number): RawOverview {
  return {
    name: "Книжка.indd",
    saved: true,
    fullName: "/шлях/Книжка.indd",
    pageCount: 196,
    spreadCount: 100,
    pages: Array.from({ length: 196 }, (_, i) => ({ name: String(i + 1), frames: 5 })),
    stories: Array.from({ length: storyCount }, (_, i) => ({
      index: i,
      containerId: `story:${i}`,
      characters: 500 + i,
      words: 90,
      preview: "текст ".repeat(10).slice(0, 60),
      overflows: false,
    })),
    paragraphStyles: Array.from({ length: 55 }, (_, i) => `Стиль ${i}`),
    characterStyles: ["Напівжирний"],
    fonts: ["Proba Pro [installed]"],
    links: [{ name: "фото.psd", status: "NORMAL" }],
  };
}

const ALL = [...OVERVIEW_SECTIONS];

describe("doc_overview — обробник", () => {
  it("відповідь на книжці з 575 історіями лишається під 24 КБ", async () => {
    /*
     * Це і є перевірка самого числа DEFAULT_MAX_STORIES, а не лише того,
     * що обрізання сталося. ВИМІРЯНО на робочій книжці 2026-08-16
     * (`scripts/measure-response-size.mjs`, справжній обробник, живий
     * InDesign): було 122 582 Б і клієнт їх обрізав — стало 21 272 Б.
     * Поріг узято від того числа з запасом, а не з круглої стелі; тут
     * історії синтетичні, тож збіг до байта не очікується.
     */
    runJsxMock.mockReset();
    runJsxMock.mockResolvedValue(raw(575));
    const res = await handlerFor("doc_overview")({ sections: ALL, maxStories: DEFAULT_MAX_STORIES });
    const bytes = Buffer.byteLength(res.content[0]!.text, "utf8");
    expect(bytes, `відповідь важить ${bytes} Б`).toBeLessThan(24 * 1024);
  });

  it("без стелі та сама книжка дає відповідь, яку клієнт обрізає", async () => {
    /* Негативний близнюк до попереднього: інакше поріг проходив би й на
     * коді, що взагалі не має чого обрізати. */
    runJsxMock.mockReset();
    runJsxMock.mockResolvedValue(raw(575));
    const res = await handlerFor("doc_overview")({ sections: ALL, maxStories: 5000 });
    const bytes = Buffer.byteLength(res.content[0]!.text, "utf8");
    expect(bytes).toBeGreaterThan(60 * 1024);
  });

  it("міст викликається без параметрів — звуження робить обробник, не InDesign", async () => {
    runJsxMock.mockReset();
    runJsxMock.mockResolvedValue(raw(10));
    await handlerFor("doc_overview")({ sections: ALL, maxStories: 60 });
    expect(runJsxMock).toHaveBeenCalledWith("doc_overview", {});
  });

  it("числа totals переживають і обрізання, і відсутність розділів", async () => {
    runJsxMock.mockReset();
    runJsxMock.mockResolvedValue(raw(575));
    const res = await handlerFor("doc_overview")({ sections: [], maxStories: 1 });
    const body = JSON.parse(res.content[0]!.text) as {
      totals: { stories: number; pages: number };
      stories?: unknown;
    };
    expect(body.totals.stories).toBe(575);
    expect(body.totals.pages).toBe(196);
    expect(body.stories).toBeUndefined();
  });

  it("помилка виміру доходить як помилка, а не як порожній огляд", async () => {
    runJsxMock.mockReset();
    runJsxMock.mockRejectedValue(new Error("InDesign не відповів"));
    const res = await handlerFor("doc_overview")({ sections: ALL, maxStories: 60 });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain("не відповів");
  });

  it("опис інструмента називає поля відповіді — конвенція проєкту", () => {
    const d = descriptionOf("doc_overview");
    for (const field of ["totals", "storiesTruncated", "sections", "maxStories", "overset"]) {
      expect(d, `опис не називає ${field}`).toContain(field);
    }
  });
});

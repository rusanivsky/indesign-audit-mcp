import { describe, expect, it, vi, beforeEach } from "vitest";

/*
 * H1. Живий прогін 2026-08-17: прохід `extras` упав із
 * «InDesign не встиг відповісти за відведений AppleScript час (-1712)»,
 * і чотири контрольні числа §10 лишились невиміряними. Причина — не
 * повільний InDesign: `timeoutHintMs: 180_000`, оголошений у плані, до
 * виклику не доходив узагалі, тож діяв `DEFAULT_TIMEOUT = 30_000` мосту.
 *
 * Справжнє падіння юніт-тестом не відтворити: для нього потрібен живий
 * InDesign і прохід, що справді довший за 30 с. Тому тут перевіряється
 * рівно те, що в нашій владі, — що ОГОЛОШЕНИЙ у плані ліміт ДОХОДИТЬ до
 * мосту. Міст сам ліміт уже поважає (`runner.ts` виводить із нього
 * `with timeout of N seconds`, і це покрито `runner.test.ts`).
 */

const { runJsxMock } = vi.hoisted(() => ({ runJsxMock: vi.fn() }));
vi.mock("../../src/bridge/runner.js", () => ({ runJsx: runJsxMock }));

const { callTool, collectTools } = await import("../../src/cli/collect.js");
const { executePasses } = await import("../../src/cli/run/execute.js");
const { planPasses } = await import("../../src/cli/run/plan.js");
const { FAMILY_NAMES } = await import("../../src/cli/config/schema.js");
type ToolBox = import("../../src/cli/collect.js").ToolBox;
type AuditConfig = import("../../src/cli/config/schema.js").AuditConfig;
type EnvironmentStamp = import("../../src/cli/run/session.js").EnvironmentStamp;

const відбиток = {
  indesignVersion: "20.0", docName: "к.indd", docPath: "/т/к.indd",
  modified: false, wasAlreadyOpen: false, openDocumentCount: 1,
  dictionaryPath: null, locale: "uk", sessionUptimeMs: null,
  releaseSkippedReason: null,
} satisfies EnvironmentStamp;

/** Конфіг, у якому налаштовані рівно `extras` і `sequences` (вони йдуть одним проходом). */
function конфіг(): AuditConfig {
  return {
    edition: { title: "К", docPath: "/т/к.indd" },
    print: { minPpi: 300, maxTotalInk: 240, expectedInks: 4 },
    families: {
      ...Object.fromEntries(FAMILY_NAMES.map((f) => [f, { notApplicable: "ні" }])),
      extras: { bodyTextStyles: ["Основний"] },
      sequences: { rules: [] },
    },
  } as AuditConfig;
}

beforeEach(() => {
  runJsxMock.mockReset();
  runJsxMock.mockResolvedValue({});
});

describe("H1 — оголошений у плані таймаут доходить до мосту", () => {
  it("прохід extras кличе runJsx РІВНО з тим лімітом, що оголошений у плані", async () => {
    const { passes } = planPasses(конфіг());
    const extras = passes.find((p) => p.id === "extras");
    expect(extras).toBeDefined();

    await executePasses(collectTools(), [extras!], відбиток, [], {
      onProgress: () => {},
      onPartial: async () => {},
    });

    expect(runJsxMock).toHaveBeenCalledTimes(1);
    const [handler, , opts] = runJsxMock.mock.calls[0]!;
    expect(handler).toBe("__cli_extras");
    /* Джерело числа — сам план, не друга копія його тут (пастка
     * nearMissPt/nearMissThresholdPt). */
    expect(opts).toEqual({ timeoutMs: extras!.timeoutHintMs });
  });

  it("цей ліміт БІЛЬШИЙ за DEFAULT_TIMEOUT мосту — інакше перевірка нічого не доводила б", async () => {
    const { passes } = planPasses(конфіг());
    const extras = passes.find((p) => p.id === "extras")!;

    await executePasses(collectTools(), [extras], відбиток, [], {
      onProgress: () => {},
      onPartial: async () => {},
    });

    /* 30_000 — `DEFAULT_TIMEOUT` у `src/bridge/runner.ts`, той самий, під
     * яким прохід і падав. Живий вимір першого прогону — 21752 мс; після
     * задачі C обхід перейшов межу. */
    const [, , opts] = runJsxMock.mock.calls[0]!;
    expect((opts as { timeoutMs: number }).timeoutMs).toBeGreaterThan(30_000);
  });

  it("виклик без меж лишає мостові його власне замовчування — поведінка поза виконавцем проходів не змінилась", async () => {
    await callTool(collectTools(), "__cli_extras", { rules: [] });
    const [, , opts] = runJsxMock.mock.calls[0]!;
    expect(opts).toEqual({ timeoutMs: undefined });
  });

  /*
   * Тотожність збирача з MCP SDK (R24, задача E) не зачеплена: межі
   * виклику дістає ЛИШЕ синтетичний міст. Зареєстрований інструмент
   * кличеться одним позиційним аргументом — другий слот SDK віддає під
   * `RequestHandlerExtra` (`mcp.js:230-233`), і підсовувати туди свій
   * об'єкт було б відхиленням від того, що обробник бачить під сервером.
   */
  describe("канал ліміту не торкається зареєстрованих інструментів", () => {
    it("обробник справжнього інструмента дістає РІВНО один аргумент", async () => {
      let скільки = -1;
      const box: ToolBox = new Map([
        [
          "t",
          {
            inputSchema: {},
            handler: async function (...args: unknown[]) {
              скільки = args.length;
              return { content: [{ type: "text" as const, text: "{}" }] };
            },
          },
        ],
      ]);
      await callTool(box, "t", {}, { timeoutMs: 180_000 });
      expect(скільки).toBe(1);
    });

    it("обробник синтетичного мосту дістає другим аргументом межі виклику", async () => {
      let побачив: unknown = null;
      const box: ToolBox = new Map([
        [
          "b",
          {
            bridge: true,
            handler: async (_args, limits) => {
              побачив = limits;
              return { content: [{ type: "text" as const, text: "{}" }] };
            },
          },
        ],
      ]);
      await callTool(box, "b", {}, { timeoutMs: 180_000 });
      expect(побачив).toEqual({ timeoutMs: 180_000 });
    });
  });
});

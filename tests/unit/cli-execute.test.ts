import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { executePasses, reportedDocument } from "../../src/cli/run/execute.js";
import type { ToolBox } from "../../src/cli/collect.js";
import type { Pass } from "../../src/cli/run/plan.js";
import type { EnvironmentStamp } from "../../src/cli/run/session.js";

const відбиток = {
  indesignVersion: "20.0", docName: "к.indd", docPath: "/т/к.indd",
  modified: false, wasAlreadyOpen: false, openDocumentCount: 1,
  dictionaryPath: null, locale: "uk", sessionUptimeMs: null,
  releaseSkippedReason: null,
} satisfies EnvironmentStamp;

function прохід(id: string, tool: string): Pass {
  return { id, tool, args: {}, critical: false, timeoutHintMs: 1000 } as Pass;
}

function коробка(поведінка: Record<string, () => Promise<unknown>>) {
  return new Map(
    Object.entries(поведінка).map(([назва, fn]) => [
      назва,
      {
        handler: async () => ({ content: [{ type: "text" as const, text: JSON.stringify(await fn()) }] }),
      },
    ]),
  );
}

describe("executePasses", () => {
  it("виконує проходи послідовно й зберігає дані кожного", async () => {
    const box = коробка({ a: async () => ({ n: 1 }), b: async () => ({ n: 2 }) });
    const m = await executePasses(box as never, [прохід("x", "a"), прохід("y", "b")], відбиток, [], {
      onProgress: () => {},
      onPartial: async () => {},
    });
    expect(m.passes.map((p) => p.data)).toEqual([{ n: 1 }, { n: 2 }]);
    expect(m.passes.every((p) => p.ok)).toBe(true);
  });

  it("падіння проходу НЕ зупиняє решти — інакше десять хвилин пропадають", async () => {
    const box = коробка({ a: async () => { throw new Error("міст упав"); }, b: async () => ({ n: 2 }) });
    const m = await executePasses(box as never, [прохід("x", "a"), прохід("y", "b")], відбиток, [], {
      onProgress: () => {},
      onPartial: async () => {},
    });
    expect(m.passes[0]!.ok).toBe(false);
    expect(m.passes[0]!.error).toMatch(/міст упав/);
    expect(m.passes[1]!.ok).toBe(true);
  });

  it("пише проміжний стан ПІСЛЯ КОЖНОГО проходу, а не наприкінці", async () => {
    const box = коробка({ a: async () => ({}), b: async () => ({}) });
    const onPartial = vi.fn(async () => {});
    await executePasses(box as never, [прохід("x", "a"), прохід("y", "b")], відбиток, [], {
      onProgress: () => {},
      onPartial,
    });
    expect(onPartial).toHaveBeenCalledTimes(2);
  });

  it("доповідає поступ рядком на прохід", async () => {
    const рядки: string[] = [];
    const box = коробка({ a: async () => ({}) });
    await executePasses(box as never, [прохід("x", "a")], відбиток, [], {
      onProgress: (l) => рядки.push(l),
      onPartial: async () => {},
    });
    expect(рядки.join("\n")).toMatch(/x/);
  });

  /*
   * R28: запис проходу несе не лише число, а й параметри, якими міряли, —
   * і окремо перелік тих, що їх поставила схема інструмента. Без цього
   * звіт не має з чого сказати, які числа обрала людина.
   */
  describe("R28 — запис проходу несе аргументи й перелік замовчувань", () => {
    function коробкаЗіСхемою(): ToolBox {
      return new Map([
        [
          "a",
          {
            inputSchema: { pages: z.array(z.string()).optional(), pageWindow: z.number().default(20) },
            handler: async (args: Record<string, unknown>) => ({
              content: [{ type: "text" as const, text: JSON.stringify(args) }],
            }),
          },
        ],
      ]);
    }

    it("аргументи в записі — РОЗІБРАНІ (із замовчуванням), а не заплановані", async () => {
      const p: Pass = { ...прохід("x", "a"), args: {} };
      const m = await executePasses(коробкаЗіСхемою(), [p], відбиток, [], {
        onProgress: () => {},
        onPartial: async () => {},
      });
      expect(m.passes[0]!.args).toEqual({ pageWindow: 20 });
      expect(m.passes[0]!.defaulted).toEqual(["pageWindow"]);
    });

    it("названий людиною параметр у перелік замовчувань не потрапляє", async () => {
      const p: Pass = { ...прохід("x", "a"), args: { pageWindow: 20 } };
      const m = await executePasses(коробкаЗіСхемою(), [p], відбиток, [], {
        onProgress: () => {},
        onPartial: async () => {},
      });
      expect(m.passes[0]!.args).toEqual({ pageWindow: 20 });
      expect(m.passes[0]!.defaulted).toEqual([]);
    });

    /*
     * `measurements.json` — окремий артефакт, а не проміжний буфер (спек
     * §4.2): два прогони порівнюються саме ним. `args`/`defaulted` змінили
     * форму запису проходу, тож версія мусить це визнати — інакше споживач,
     * що повірив би в сталість форми при `schemaVersion === 1`, був би тихо
     * неправий.
     *
     * I5 (рулінг R42): 2 → 3, бо у форму додалось `overset` — контрольне
     * число §10, яке доти жило ЛИШЕ в готовому HTML, тобто два прогони
     * порівняти за ним було нічим.
     */
    it("зміна форми запису підняла schemaVersion до 3", async () => {
      const m = await executePasses(коробкаЗіСхемою(), [прохід("x", "a")], відбиток, [], {
        onProgress: () => {},
        onPartial: async () => {},
      });
      expect(m.schemaVersion).toBe(3);
    });

    /*
     * I5: сам виконавець `overset` НЕ вигадує — воно виводиться з відповіді
     * preflight уже після всіх проходів (`src/cli/audit.ts`). Записати тут
     * нуль означало б покласти у файл вимірів число, якого ніхто не міряв.
     */
    it("I5: executePasses НЕ вигадує overset — поле лишається невизначеним", async () => {
      const m = await executePasses(коробкаЗіСхемою(), [прохід("x", "a")], відбиток, [], {
        onProgress: () => {},
        onPartial: async () => {},
      });
      expect(m.overset).toBeUndefined();
    });

    it("прохід, що впав, лишає заплановані аргументи й порожній перелік", async () => {
      const box = коробка({ a: async () => { throw new Error("міст упав"); } });
      const p: Pass = { ...прохід("x", "a"), args: { pages: ["12"] } };
      const m = await executePasses(box as never, [p], відбиток, [], {
        onProgress: () => {},
        onPartial: async () => {},
      });
      expect(m.passes[0]!.ok).toBe(false);
      expect(m.passes[0]!.args).toEqual({ pages: ["12"] });
      expect(m.passes[0]!.defaulted).toEqual([]);
    });
  });
});

describe("reportedDocument", () => {
  it("віддає назву, коли прохід її назвав", () => {
    expect(reportedDocument({ docName: "к.indd" })).toBe("к.indd");
  });

  /*
   * «Не сказав» і «сказав інше» — різні стани, і плутати їх не можна: вимагати
   * назву від `status`, який міряє застосунок, а не документ, було б хибно.
   */
  it("віддає null, коли поля немає, воно порожнє або це не об'єкт", () => {
    expect(reportedDocument({ n: 1 })).toBeNull();
    expect(reportedDocument({ docName: "" })).toBeNull();
    expect(reportedDocument({ docName: 7 })).toBeNull();
    expect(reportedDocument(null)).toBeNull();
    expect(reportedDocument("к.indd")).toBeNull();
  });
});

describe("сторожа тотожності документа", () => {
  it("відкидає прохід, що виміряв ІНШИЙ документ", async () => {
    const box = коробка({ a: async () => ({ docName: "чужа.indd", emptyParagraphs: 5580 }) });
    const m = await executePasses(box as never, [прохід("extras", "a")], відбиток, [], {
      onProgress: () => {},
      onPartial: async () => {},
    });
    expect(m.passes[0]!.ok).toBe(false);
    expect(m.passes[0]!.error).toMatch(/чужа\.indd/);
    expect(m.passes[0]!.error).toMatch(/к\.indd/);
    /* Чужий вимір мусить зникнути ЦІЛКОМ: лишити його «з приміткою» означало
     * б, що число з іншої книжки все одно доїде до звіту. */
    expect(m.passes[0]!.data).toBeNull();
  });

  it("пропускає прохід, що виміряв той самий документ", async () => {
    const box = коробка({ a: async () => ({ docName: "к.indd", emptyParagraphs: 416 }) });
    const m = await executePasses(box as never, [прохід("extras", "a")], відбиток, [], {
      onProgress: () => {},
      onPartial: async () => {},
    });
    expect(m.passes[0]!.ok).toBe(true);
    expect(m.passes[0]!.data).toEqual({ docName: "к.indd", emptyParagraphs: 416 });
  });

  it("не чіпає прохід, який документа не називає", async () => {
    const box = коробка({ a: async () => ({ version: "20.0" }) });
    const m = await executePasses(box as never, [прохід("status", "a")], відбиток, [], {
      onProgress: () => {},
      onPartial: async () => {},
    });
    expect(m.passes[0]!.ok).toBe(true);
  });

  it("підміна одного проходу не зупиняє решти прогону", async () => {
    const box = коробка({
      a: async () => ({ docName: "чужа.indd" }),
      b: async () => ({ docName: "к.indd", n: 2 }),
    });
    const m = await executePasses(box as never, [прохід("x", "a"), прохід("y", "b")], відбиток, [], {
      onProgress: () => {},
      onPartial: async () => {},
    });
    expect(m.passes[0]!.ok).toBe(false);
    expect(m.passes[1]!.ok).toBe(true);
  });
});

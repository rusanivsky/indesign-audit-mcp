import { describe, expect, it } from "vitest";
import { z } from "zod";
import { callTool, callToolTraced, collectTools, type ToolBox } from "../../src/cli/collect.js";
import { PAGE_WINDOW } from "../../src/tools/composition.js";

describe("collectTools", () => {
  it("збирає обробники всіх читальних інструментів, не запускаючи сервера", () => {
    const tools = collectTools();
    expect(tools.has("color_audit")).toBe(true);
    expect(tools.has("geometry_audit")).toBe(true);
    expect(tools.has("preflight_document")).toBe(true);
    expect(tools.has("indesign_status")).toBe(true);
  });

  it("НЕ збирає мутуючих інструментів — прогін читальний за побудовою", () => {
    const tools = collectTools();
    expect(tools.has("typography_apply")).toBe(false);
    expect(tools.has("pagination_apply")).toBe(false);
    expect(tools.has("composition_apply")).toBe(false);
    expect(tools.has("corrections_apply")).toBe(false);
  });

  /*
   * R1 (передпольотний огляд плану Фази 15, задача 1): перелік реєстраторів
   * у первинному брифі був неповний. Без `indesign_run_jsx` задача 4
   * (`openSession`) не може відкрити й закрити документ; без `doc_overview`
   * немає першого проходу зі спек §4.3.
   */
  it("збирає indesign_run_jsx і doc_overview (R1 — доповнення переліку реєстраторів)", () => {
    const tools = collectTools();
    expect(tools.has("indesign_run_jsx")).toBe(true);
    expect(tools.has("doc_overview")).toBe(true);
  });

  /*
   * R2: `__cli_extras` — це обробник JSX (пише його задача 8), не
   * MCP-інструмент. Синтетичний запис лише маршрутизує виклик через
   * `runJsx`, щоб виконавець проходів (задача 6) лишався однорідним.
   */
  it("містить синтетичний запис __cli_extras (R2 — маршрутизація до runJsx)", () => {
    const tools = collectTools();
    expect(tools.has("__cli_extras")).toBe(true);
  });
});

describe("callTool", () => {
  it("розбирає JSON із текстового блоку", async () => {
    const fake: ToolBox = new Map([
      ["t", { handler: async () => ({ content: [{ type: "text" as const, text: '{"n":7}' }] }) }],
    ]);
    await expect(callTool<{ n: number }>(fake, "t", {})).resolves.toEqual({ n: 7 });
  });

  it("перетворює isError на виняток із текстом інструмента", async () => {
    const fake: ToolBox = new Map([
      [
        "t",
        {
          handler: async () => ({
            isError: true,
            content: [{ type: "text" as const, text: "нема документа" }],
          }),
        },
      ],
    ]);
    await expect(callTool(fake, "t", {})).rejects.toThrow("нема документа");
  });

  it("відмовляється від невідомої назви, а не віддає undefined", async () => {
    await expect(callTool(new Map(), "нема", {})).rejects.toThrow("нема");
  });

  /*
   * R24 (передпольотний огляд живого прогону, 13 проходів на книжці): три
   * проходи впали, бо збирач кликав обробник НАПРЯМУ, обминаючи крок MCP
   * SDK, де аргументи проганяються через `inputSchema` і `.default(...)`
   * застосовується. Тести нижче беруть СПРАВЖНІ схеми з `collectTools()`
   * (не вигадані форми) і підміняють лише обробник — щоб не смикати
   * InDesign — заглушкою, яка echo'є розібрані аргументи назад.
   */
  describe("R24 — параметри проходять через справжню inputSchema", () => {
    function spyOn(tools: ToolBox, name: string): ToolBox {
      const real = tools.get(name);
      if (real === undefined) throw new Error(`тест: інструмента «${name}» немає серед зібраних`);
      const spy: ToolBox = new Map(tools);
      spy.set(name, {
        inputSchema: real.inputSchema,
        handler: async (args) => ({ content: [{ type: "text" as const, text: JSON.stringify(args) }] }),
      });
      return spy;
    }

    it("composition_audit: pageWindow, не назване викликачем, отримує .default(PAGE_WINDOW), а не undefined", async () => {
      const tools = collectTools();
      const spy = spyOn(tools, "composition_audit");
      const result = await callTool<{ pageWindow: number }>(spy, "composition_audit", {});
      expect(result.pageWindow).toBe(PAGE_WINDOW);
    });

    /* families: z.array(z.enum(FAMILIES)).default([...FAMILIES]) — src/tools/styles.ts:249-252,
     * FAMILIES = ["usage", "overrides", "scale", "character", "hierarchy"] — src/tools/styles.ts:52. */
    it("styles_audit: families, не назване викликачем, отримує ПОВНИЙ типовий перелік родин, а не undefined", async () => {
      const tools = collectTools();
      const spy = spyOn(tools, "styles_audit");
      const result = await callTool<{ families: string[] }>(spy, "styles_audit", {});
      expect(result.families).toEqual(["usage", "overrides", "scale", "character", "hierarchy"]);
    });

    /* families: z.array(z.enum([...])).default(["overrides", "masters"]) — src/tools/map.ts:133-136. */
    it("layout_audit: families, не назване викликачем, отримує .default([\"overrides\",\"masters\"]), а не undefined", async () => {
      const tools = collectTools();
      const spy = spyOn(tools, "layout_audit");
      const result = await callTool<{ families: string[] }>(spy, "layout_audit", {});
      expect(result.families).toEqual(["overrides", "masters"]);
    });

    it("хибне поле дає зрозумілу відмову з назвою інструмента й поля, а не сирий ZodError", async () => {
      const tools = collectTools();
      const spy = spyOn(tools, "styles_audit");
      /* "not_a_real_family" не входить у z.enum(FAMILIES) із src/tools/styles.ts:52. */
      await expect(
        callTool(spy, "styles_audit", { families: ["not_a_real_family"] }),
      ).rejects.toThrow(/styles_audit/);
      await expect(
        callTool(spy, "styles_audit", { families: ["not_a_real_family"] }),
      ).rejects.toThrow(/families/);
    });

    /*
     * I7 (фінальна рецензія, Important) — ОЧІКУВАННЯ ПЕРЕВЕРНУТО НАВМИСНО.
     *
     * Було: «__cli_extras без inputSchema передає аргументи як є» — і саме
     * ця відсутність схеми лишала родини `extras`/`sequences` (шість із
     * чотирнадцяти контрольних чисел §10) без жодної звірки форми:
     * одруківка в КЛЮЧІ (`bodyTextStyle` замість `bodyTextStyles`) не
     * ловилась ані схемою, ані ступенем 2, ані JSX — і давала «Примусових
     * розривів: 402, з них в основному тексті 0».
     *
     * R24 №3 звучала «синтетичний запис не MCP-інструмент, схеми в нього
     * нема» — правда про ТРАНСПОРТ, помилково взята за правду про ФОРМУ
     * ВХОДУ. Форма в доміру є, її читає `src/jsx/cli-extras.jsx`, і тепер
     * вона названа в одному місці — `СХЕМА_CLI_EXTRAS`.
     */
    it("I7: __cli_extras несе схему, і незнаний ключ не доїжджає до JSX", async () => {
      const tools = collectTools();
      const entry = tools.get("__cli_extras");
      expect(entry?.inputSchema).toBeDefined();
      expect(Object.keys(entry!.inputSchema!).sort()).toEqual(["bodyTextStyles", "rules"]);

      /* Розбір той самий, що й для будь-якого інструмента: незнаний ключ
       * стрижеться (тотожність із MCP SDK, R24), а відмова на ньому —
       * робота ступеня 1, `.strict()` (див. cli-config-tool-schemas). */
      const spy: ToolBox = new Map([
        [
          "__cli_extras",
          {
            bridge: true as const,
            inputSchema: entry!.inputSchema!,
            handler: async (args: Record<string, unknown>) => ({
              content: [{ type: "text" as const, text: JSON.stringify(args) }],
            }),
          },
        ],
      ]);
      await expect(
        callTool(spy, "__cli_extras", { bodyTextStyle: ["Основний текст L"] }),
      ).resolves.toEqual({});
    });

    it("ВІДСУТНЯ схема — аргументи передаються без змін (вимога R24 №1)", async () => {
      const spy: ToolBox = new Map([
        [
          "t",
          {
            handler: async (args) => ({
              content: [{ type: "text" as const, text: JSON.stringify(args) }],
            }),
          },
        ],
      ]);
      const result = await callTool<{ anything: string }>(spy, "t", { anything: "мимо схеми" });
      expect(result.anything).toBe("мимо схеми");
    });
  });

  /*
   * R24, мінор M1: ПОРОЖНЯ схема (`inputSchema: {}`) — не те саме, що
   * відсутня. MCP SDK обгортає її в `z.object({})` ще на реєстрації
   * (`mcp.js:611` → `isZodRawShapeCompat` приймає `{}` як чинну сиру форму,
   * `mcp.js:850-853`), і розбір ВИКИДАЄ незнані ключі. Збирач раніше мав
   * скорочення `Object.keys(inputSchema).length === 0 → args як є`, тож
   * зонд рецензента `callTool(box, "indesign_status", {зайве: 1})` віддавав
   * обробникові `{"зайве": 1}`, а під MCP віддав би `{}`.
   */
  describe("M1 — порожня схема поводиться як під MCP SDK: викидає незнані ключі", () => {
    it("indesign_status (inputSchema: {}) отримує {} навіть коли викликач надіслав зайве поле", async () => {
      const tools = collectTools();
      const справжній = tools.get("indesign_status");
      expect(справжній?.inputSchema).toEqual({});
      const spy: ToolBox = new Map(tools);
      spy.set("indesign_status", {
        inputSchema: справжній?.inputSchema,
        handler: async (args) => ({ content: [{ type: "text" as const, text: JSON.stringify(args) }] }),
      });
      const побачив = await callTool<Record<string, unknown>>(spy, "indesign_status", { зайве: 1 });
      expect(побачив).toEqual({});
    });
  });

  /*
   * R24, мінор M2: SDK парсить асинхронно (`mcp.js:174`). Асинхронних
   * `refine` у `src/tools/` сьогодні нуль, тож схема нижче ВИГАДАНА — але
   * саме вона показує різницю: під `safeParse` zod кидає «Encountered
   * Promise during synchronous parse» замість того, щоб розібрати аргументи.
   */
  describe("M2 — схема з асинхронним уточненням розбирається, а не кидає рантайм-помилку", () => {
    function коробкаЗАсинхронноюСхемою(): ToolBox {
      return new Map([
        [
          "t",
          {
            inputSchema: {
              n: z.number().refine(async (v) => v > 0, "мусить бути додатним"),
            },
            handler: async (args: Record<string, unknown>) => ({
              content: [{ type: "text" as const, text: JSON.stringify(args) }],
            }),
          },
        ],
      ]);
    }

    it("чинне значення проходить крізь асинхронне уточнення", async () => {
      const результат = await callTool<{ n: number }>(коробкаЗАсинхронноюСхемою(), "t", { n: 7 });
      expect(результат.n).toBe(7);
    });

    it("нечинне значення дає ту саму зрозумілу відмову з назвою інструмента й поля", async () => {
      await expect(callTool(коробкаЗАсинхронноюСхемою(), "t", { n: -1 })).rejects.toThrow(
        /"t".*n — мусить бути додатним/s,
      );
    });
  });

  /*
   * R28: збирач мусить пам'ятати, ЯКІ ключі заповнив сам, — бо звіт друкує
   * їх окремо від тих, що обрала людина. Найважчий випадок — коли обидва
   * дають ТЕ САМЕ значення на виході; саме на ньому падає наївна
   * реалізація, що порівнює значення замість входу.
   */
  describe("R28 — слід аргументів розрізняє обране людиною й припущене інструментом", () => {
    function ехо(tools: ToolBox, name: string): ToolBox {
      const real = tools.get(name);
      if (real === undefined) throw new Error(`тест: інструмента «${name}» немає серед зібраних`);
      const spy: ToolBox = new Map(tools);
      spy.set(name, {
        inputSchema: real.inputSchema,
        handler: async (args) => ({ content: [{ type: "text" as const, text: JSON.stringify(args) }] }),
      });
      return spy;
    }

    it("pageWindow, названий людиною РІВНО тим самим числом, що й замовчування, замовчуванням НЕ вважається", async () => {
      const spy = ехо(collectTools(), "composition_audit");
      const мовчки = await callToolTraced<Record<string, unknown>>(spy, "composition_audit", {});
      const обрано = await callToolTraced<Record<string, unknown>>(spy, "composition_audit", {
        pageWindow: PAGE_WINDOW,
      });

      /* Обидва виклики дають ОДНАКОВЕ значення — інакше тест нічого не
       * доводив би: саме тому їх і плутають. */
      expect(мовчки.args.pageWindow).toBe(PAGE_WINDOW);
      expect(обрано.args.pageWindow).toBe(PAGE_WINDOW);
      expect(обрано.args).toEqual(мовчки.args);

      /* Розрізняє їх лише слід. */
      expect(мовчки.defaulted).toContain("pageWindow");
      expect(обрано.defaulted).not.toContain("pageWindow");
    });

    it("families, названі людиною тим самим повним переліком, що й замовчування, замовчуванням НЕ вважаються", async () => {
      const spy = ехо(collectTools(), "styles_audit");
      const типові = ["usage", "overrides", "scale", "character", "hierarchy"];
      const мовчки = await callToolTraced<Record<string, unknown>>(spy, "styles_audit", {});
      const обрано = await callToolTraced<Record<string, unknown>>(spy, "styles_audit", {
        families: типові,
      });

      expect(мовчки.args.families).toEqual(типові);
      expect(обрано.args.families).toEqual(типові);

      expect(мовчки.defaulted).toContain("families");
      expect(обрано.defaulted).not.toContain("families");
    });

    it("названий параметр, що НЕ збігається із замовчуванням, теж не потрапляє в перелік", async () => {
      const spy = ехо(collectTools(), "composition_audit");
      const слід = await callToolTraced<Record<string, unknown>>(spy, "composition_audit", {
        pageWindow: 3,
      });
      expect(слід.args.pageWindow).toBe(3);
      expect(слід.defaulted).not.toContain("pageWindow");
      /* Решта полів схеми замовчування таки дістала — перелік не порожній. */
      expect(слід.defaulted).toContain("perDefectLimit");
    });

    /* Запис без `inputSchema` — форма синтетичного `__cli_extras`. Сам він
     * тут не годиться: його обробник ходить у InDesign через `runJsx`. */
    it("запис без схеми не має чого замовчувати — перелік порожній", async () => {
      const spy: ToolBox = new Map([
        [
          "t",
          {
            handler: async (args: Record<string, unknown>) => ({
              content: [{ type: "text" as const, text: JSON.stringify(args) }],
            }),
          },
        ],
      ]);
      const слід = await callToolTraced<Record<string, unknown>>(spy, "t", { rules: [1] });
      expect(слід.defaulted).toEqual([]);
      expect(слід.args).toEqual({ rules: [1] });
    });

    it("callTool лишається тим самим викликом — це callToolTraced без сліду", async () => {
      const spy = ехо(collectTools(), "styles_audit");
      const крізьCallTool = await callTool<Record<string, unknown>>(spy, "styles_audit", {});
      const крізьTraced = await callToolTraced<Record<string, unknown>>(spy, "styles_audit", {});
      expect(крізьCallTool).toEqual(крізьTraced.data);
    });
  });
});

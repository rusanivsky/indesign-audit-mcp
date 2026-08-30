import { describe, expect, it, vi } from "vitest";
import { sanitizeComponent, renderPath } from "../../src/tools/render.js";

/*
 * ІМ'Я ФАЙЛА РАСТРА, І ЧОМУ ДЕФІС У НЬОМУ НЕ МОЖНА ДОЗВОЛЯТИ.
 *
 * Дефіс — ЄДИНИЙ роздільник між назвою документа й сторінкою, тож усередині
 * складника він робив би межу нерозрізненною. Коментар над `sanitizeComponent`
 * називає конкретну колізію: ("Обкладинка-v1", "166") і ("Обкладинка",
 * "v1-166") без цього правила дали б ОДИН файл «Обкладинка-v1-166.png» — і
 * растр однієї сторінки мовчки перезаписав би растр іншої.
 *
 * Мутаційна проба 2026-08-26: у клас дописано `-` (тобто дефіс став
 * дозволеним усередині складника) — і ВЕСЬ юніт-набір лишився зеленим, усі
 * 2737 тестів. `src/tools/render.ts` не мав тестового файла зовсім, а обидві
 * функції не експортувалися.
 */
describe("sanitizeComponent", () => {
  it("дефіс НЕ дозволений усередині складника — він роздільник", () => {
    expect(sanitizeComponent("Обкладинка-v1")).toBe("Обкладинка_v1");
  });

  it("саме та колізія, заради якої правило існує, не відтворюється", () => {
    const a = renderPath("Обкладинка-v1.indd", "166", false);
    const b = renderPath("Обкладинка.indd", "v1-166", false);
    expect(a).not.toBe(b);
  });

  it("літери й цифри будь-якої писемності лишаються", () => {
    /* `\p{L}`, а не [A-Za-z]: назви документів тут кирилицею. */
    expect(sanitizeComponent("Розділ7")).toBe("Розділ7");
    expect(sanitizeComponent("Chapter7")).toBe("Chapter7");
  });

  it("підкреслення лишається, решта злипається в одне підкреслення", () => {
    expect(sanitizeComponent("а  б")).toBe("а_б");
    expect(sanitizeComponent("а/б:в")).toBe("а_б_в");
    expect(sanitizeComponent("_")).toBe("_");
  });
});

describe("renderPath", () => {
  it("розширення .indd не потрапляє в ім'я растра", () => {
    expect(renderPath("Книжка.indd", "12", false)).toMatch(/Книжка-12\.png$/u);
  });

  it("розворот має власний суфікс — інакше перезаписав би сторінку", () => {
    const page = renderPath("Книжка.indd", "12", false);
    const spread = renderPath("Книжка.indd", "12", true);
    expect(spread).not.toBe(page);
    expect(spread).toMatch(/-spread\.png$/u);
  });

  it("ім'я детерміноване: повторний рендер перезаписує, а не накопичує", () => {
    expect(renderPath("Книжка.indd", "12", false)).toBe(renderPath("Книжка.indd", "12", false));
  });
});

/*
 * ПРИВ'ЯЗКА ДО ЗМІРЯНОГО ДОКУМЕНТА МІЖ ДВОМА ВИКЛИКАМИ.
 *
 * `page_render` робить ДВА виклики мосту: спершу `render_bounds`, потім
 * `render_export`. Між ними ~600 мс, і активне вікно InDesign за цей час може
 * змінитися. Тому експорт прив'язується до документа, який ЩОЙНО ЗМІРЯЛИ
 * (`bounds.docName`), а не до того, що назвав користувач: якби сюди йшов
 * `args.expectedDocName`, то без нього (а він необов'язковий) прив'язки не
 * було б ЗОВСІМ — і растр міг би приїхати з іншого документа з тим самим
 * коренем назви, чого оком не видно.
 *
 * Проба 2026-08-26: заміна `bounds.docName` на `args.expectedDocName` лишала
 * ввесь набір зеленим.
 */
describe("page_render прив'язує експорт до зміряного документа", () => {
  it("другий виклик мосту дістає docName ПЕРШОГО, а не аргумент користувача", async () => {
    const calls: { handler: string; params: Record<string, unknown> }[] = [];
    vi.resetModules();
    vi.doMock("../../src/bridge/runner.js", () => ({
      runJsx: (handler: string, params: Record<string, unknown>) => {
        calls.push({ handler, params });
        if (handler === "render_bounds") {
          return Promise.resolve({ docName: "ЗМІРЯНИЙ.indd", page: "1", spread: false,
            longEdgePt: 600 });
        }
        return Promise.resolve({ path: "/tmp/x.png", dpi: 72, strays: 0 });
      },
    }));
    const { registerRenderTools } = await import("../../src/tools/render.js");
    let handler: ((a: Record<string, unknown>) => Promise<unknown>) | null = null;
    registerRenderTools({
      registerTool(name: string, _c: unknown, h: (a: Record<string, unknown>) => Promise<unknown>) {
        if (name === "page_render") handler = h;
      },
    } as never);
    await handler!({ page: "1", expectedDocName: "ІНШИЙ.indd" }).catch(() => undefined);

    const exportCall = calls.find((c) => c.handler === "render_export");
    expect(exportCall, "експорт не викликано").toBeDefined();
    expect(exportCall!.params.expectedDocName).toBe("ЗМІРЯНИЙ.indd");
  });
});

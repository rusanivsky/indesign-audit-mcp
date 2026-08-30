import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { callTool, collectTools, type ToolBox } from "../../src/cli/collect.js";
import { validateConfig } from "../../src/cli/config/validate.js";
import { planPasses } from "../../src/cli/run/plan.js";

/*
 * КОНФІГ ВИДАННЯ ПРОТИ СПРАВЖНІХ СХЕМ ІНСТРУМЕНТІВ — а не проти схеми
 * конфіга. Саме цей розрив дав тиху недомірку першого живого прогону.
 *
 * `auditConfigSchema` вимагає від родини лише «об'єкт», тож
 * `"folio": "Колонтитул v1"` (рядок замість `{ styleName }`) і
 * `"runningHead": ["v1","v2"]` (масив замість `{ styleNames }`) вона
 * приймала мовчки. Форму родин знає ЛИШЕ `pagination_audit`
 * (`src/tools/pagination.ts:90-125, 620-640`), і до комміту `ce246af` (R24)
 * збирач її обминав — тобто неправильна форма приходила в інструмент як
 * `undefined` і родина не рахувалась узагалі.
 *
 * Тест іде ВИРОБНИЧИМ шляхом: справжній файл конфіга → `validateConfig` →
 * `planPasses` → `callTool` (де й живе `parseToolArgs`). Схема береться зі
 * зібраної коробки, обробник підмінено на echo — щоб не смикати InDesign.
 */
const КОРІНЬ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const конфіг = validateConfig(JSON.parse(readFileSync(join(КОРІНЬ, "configs/example-book.json"), "utf8")));

function echoЗамість(name: string): ToolBox {
  const коробка = collectTools();
  const справжній = коробка.get(name);
  if (справжній === undefined) throw new Error(`тест: інструмента «${name}» немає серед зібраних`);
  const spy: ToolBox = new Map(коробка);
  spy.set(name, {
    inputSchema: справжній.inputSchema,
    handler: async (args) => ({ content: [{ type: "text" as const, text: JSON.stringify(args) }] }),
  });
  return spy;
}

function аргументиРодини(id: string): Record<string, unknown> {
  const прохід = planPasses(конфіг).passes.find((p) => p.id === id);
  if (прохід === undefined) throw new Error(`тест: родини «${id}» немає серед проходів`);
  return прохід.args;
}

describe("configs/example-book.json — родина pagination у формі, яку справді приймає інструмент", () => {
  it("аргументи розбираються схемою pagination_audit — неправильна форма тут ВІДМОВЛЯЄ, а не мовчить", async () => {
    const args = аргументиРодини("pagination");
    await expect(callTool(echoЗамість("pagination_audit"), "pagination_audit", args)).resolves.toBeTruthy();
  });

  /*
   * `z.object(...)` СТРИЖЕ невідомі ключі мовчки (не `.strict()`), тож самої
   * успішної відповіді замало: ключ не тієї назви зник би без жодного слова.
   * Тому звіряємо перелік ключів ДО і ПІСЛЯ розбору.
   *
   * МЕЖА, НАЗВАНА ВГОЛОС: перевірка стосується САМЕ родини `pagination`.
   * (Раніше тут стояло: «`sequences` теж іде в pagination_audit, і його
   * `rules` схема стриже — окрема задача R25». Задача C виконала R25:
   * `sequences` тепер іде на `__cli_extras`, не на `pagination_audit`
   * (`src/cli/run/plan.ts`) — коментар лишено як історію рішення, не як
   * чинний факт.)
   */
  it("жодного ключа не з'їдено на розборі — стрижка тут дорівнює тихій недомірці", async () => {
    const args = аргументиРодини("pagination");
    const echoed = await callTool<Record<string, unknown>>(
      echoЗамість("pagination_audit"),
      "pagination_audit",
      args,
    );
    expect(Object.keys(echoed).sort()).toEqual(Object.keys(args).sort());
  });

  it("folio — об'єкт { styleNames }, а не рядок", () => {
    expect(аргументиРодини("pagination").folio).toEqual({ styleNames: ["Колонтитул v1"] });
  });

  it("runningHead — об'єкт { styleNames }, а не масив", () => {
    expect(аргументиРодини("pagination").runningHead).toEqual({
      styleNames: ["Колонтитул v1", "Колонтитул v2"],
    });
  });

  it("headingStyles — голий масив рядків", () => {
    expect(аргументиРодини("pagination").headingStyles).toEqual(["Назва розділу"]);
  });
});

/*
 * F2 (рулінг R29). Родину `contents` на ЦЬОМУ виданні оголошено
 * незастосовною: жодного чесного зіставлення рівнів змісту тут не існує
 * (п'ять зондів задачі A), а головне питання родини вже має відповідь —
 * усі 35 чисел автоматичні. Прийняття чинне ЛИШЕ доти, доки нео́голошення
 * ВИДНО у звіті, тому конфіг несе причину, а не тишу.
 */
describe("configs/example-book.json — pagination.contents оголошено незастосовною (R29)", () => {
  const родина = конфіг.families.pagination as Record<string, { notApplicable?: string }>;

  it("причина оголошена, непорожня і називає ТРИ речі: що, скільки, чому", () => {
    const причина = родина.contents?.notApplicable;
    expect(причина).toBeTypeOf("string");
    expect(причина).toMatch(/змісті/);
    expect(причина).toMatch(/35/);
    expect(причина).toMatch(/текстової змінної/);
  });

  it("службовий ключ НЕ доїжджає до pagination_audit", () => {
    // Інструмент про `notApplicable` не знає, а ступінь 1 після F1 звіряє
    // аргументи з `.strict()` — незнятий ключ став би відмовою.
    expect(аргументиРодини("pagination").contents).toBeUndefined();
  });

  it("причина потрапляє в skipped із назвою підродини — саме звідти її бере звіт", () => {
    expect(planPasses(конфіг).skipped).toContainEqual({
      family: "pagination",
      subfamily: "contents",
      reason: родина.contents!.notApplicable,
    });
  });
});

/*
 * A3. Основного тексту в книжці ДВА вжиті стилі, не один.
 *
 * Виміряно зондом на живому документі 2026-08-16 (196 сторінок, InDesign
 * 21.5.1.73), підрахунком по `doc.stories[].paragraphs`:
 * `Основний текст F` — 423 абзаци, `Основний текст L` — 429,
 * `Основний текст C` — 0 (визначений, не вжитий).
 *
 * Ціна недооголошення виміряна тим самим зондом, реплікою підрахунку з
 * `src/jsx/cli-extras.jsx:96-105`: сам лише `Основний текст L` дає
 * `forcedBreaks.inBodyText = 7`, обидва вжиті стилі — **27**, тобто рівно
 * контрольне число зі спека §10. Додавання невжитого `Основний текст C`
 * не міняє нічого (ті самі 27) — тому його й не оголошено: конфіг мусить
 * називати те, що в документі Є, а не те, що в ньому визначено.
 */
describe("configs/example-book.json — extras.bodyTextStyles називає ВЕСЬ основний текст", () => {
  it("оголошено обидва вжиті стилі й жодного невжитого", () => {
    expect(аргументиРодини("extras").bodyTextStyles).toEqual([
      "Основний текст F",
      "Основний текст L",
    ]);
  });
});

/*
 * C1/C5 (задача C): `sequences` у справжньому конфігу видання ходить на
 * `__cli_extras` через ЗЛИТИЙ прохід `extras` (обидві родини налаштовані
 * одночасно — `mergeCliExtras`, `src/cli/run/plan.ts`). Стиль — БАРЕ ім'я
 * «Нумерація питань», не повний шлях: висновок задачі A (`task-A-report.md`,
 * розділ A4) — повний шлях резолвиться в НІЩО ні в `pagination_audit`
 * (`missingStyles`), ні в `__cli_extras` (тихий нуль), бо зіставлення йде
 * порівнянням РЯДКІВ (`para.appliedParagraphStyle.name`), а не пошуком
 * об'єкта стилю.
 */
describe("configs/example-book.json — sequences.rules іде на __cli_extras разом із extras (C1)", () => {
  it("прохід extras несе І bodyTextStyles, І rules — окремого проходу sequences нема", () => {
    const passes = planPasses(конфіг).passes;
    const cliExtrasПроходи = passes.filter((p) => p.tool === "__cli_extras");
    expect(cliExtrasПроходи).toHaveLength(1);
    expect(cliExtrasПроходи[0]!.id).toBe("extras");
    expect(cliExtrasПроходи[0]!.args.rules).toEqual([
      { style: "Нумерація питань", mustBeSequential: true },
    ]);
    expect(passes.find((p) => p.id === "sequences")).toBeUndefined();
  });
});

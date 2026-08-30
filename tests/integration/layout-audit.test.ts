import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runJsx } from "../../src/bridge/runner.js";
import { registerMapTools } from "../../src/tools/map.js";
import type { Tools } from "../../src/tools/shared.js";
import {
  assertFixtureActive,
  closeFixtureDoc,
  makeLayoutFixtureDoc,
} from "./fixture-doc.js";

/*
 * Задача 9: інструмент `layout_audit`. Той самий запобіжник, що в
 * `tests/integration/map.test.ts` (Задача 8, рецензія 1): жоден тест не
 * звертається до `detectOverrides`/`detectMasters` напряму в обхід
 * `src/tools/map.ts` — усі перевірки йдуть через сам зареєстрований
 * обробник, підмінений `registerTool`, той самий патерн, що вже усталений
 * у `tests/integration/composition-apply.test.ts` і `map.test.ts`.
 *
 * Замовчування zod (`families`, `includeMasters`) підробленим сервером НЕ
 * застосовуються (задокументовано в composition-apply.test.ts:45, здобуто
 * Фазою 3) — тому в кожному виклику нижче всі поля схеми задані явно.
 */

let docName = "";

beforeAll(async () => {
  docName = await makeLayoutFixtureDoc();
});

afterAll(async () => {
  if (docName) await closeFixtureDoc(docName);
});

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
type AnyHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

function toolHandler(name: string): AnyHandler {
  let captured: AnyHandler | null = null;
  const fakeServer = {
    registerTool: (n: string, _c: unknown, handler: AnyHandler) => {
      if (n === name) captured = handler;
    },
  } as unknown as Tools;
  registerMapTools(fakeServer);
  if (captured === null) throw new Error(`${name} не зареєстровано`);
  return captured;
}

const body = (r: ToolResult) => JSON.parse(r.content[0]!.text);

interface StyleSummaryBody {
  styleId: string;
  styleName: string;
  paragraphs: number;
  groups: { group: string; deviating: number; values: unknown[] }[];
  notCompared: { group: string; reason: string; count: number }[];
}

interface AuditBody {
  docName: string;
  pages: string[];
  styles: StyleSummaryBody[];
  masters: { findings: { defect: string; page: string | null }[]; distribution: unknown[] };
  detail: unknown[] | null;
  totals: { overrideFindings: number; masterFindings: number; notComparedGroups: number };
}

it(
  "за замовчуванням (обидві родини, без detail): зведення за стилями, факти про батьківські, " +
    "детального переліку немає",
  async () => {
    await assertFixtureActive(docName);
    const result = body(
      await toolHandler("layout_audit")({
        pages: undefined,
        families: ["overrides", "masters"],
        includeMasters: false,
        detail: undefined,
      }),
    ) as AuditBody;

    expect(result.docName).toBe(docName);
    expect(result.detail).toBeNull();

    /* Зведення, не перелік: об'єкт на стиль, а не на абзац. */
    const osnovnyi = result.styles.find((s) => s.styleName === "Osnovnyi");
    expect(osnovnyi).toBeDefined();
    const groupNames = new Set(osnovnyi!.groups.map((g) => g.group));
    expect(groupNames).toContain("indents");
    expect(groupNames).toContain("sizes");

    /* Абзац із мішаним кеглем — «не порівняно», не серед знахідок (детектор
     * Задачі 6, той самий факт, що вже перевірено на рівні detectOverrides,
     * тепер видно крізь сам обробник). */
    expect(osnovnyi!.notCompared.some((n) => n.group === "sizes" && n.reason === "mixed")).toBe(true);

    /* Родина masters дає власні факти — від'єднання від батьківської,
     * бачені раніше в map.test.ts через detectMasters напряму. */
    expect(result.masters.findings.some((f) => f.page === "2" && f.defect === "master-item-overridden")).toBe(
      true,
    );
    expect(result.masters.findings.some((f) => f.page === "3" && f.defect === "master-none")).toBe(true);
    expect(result.masters.findings.some((f) => f.page === "4" && f.defect === "folio-missing")).toBe(true);

    expect(result.totals.overrideFindings).toBeGreaterThan(0);
    expect(result.totals.masterFindings).toBeGreaterThan(0);
    expect(result.totals.notComparedGroups).toBeGreaterThan(0);
  },
);

it("families: ['overrides'] не рахує masters узагалі (родини не змішуються)", async () => {
  await assertFixtureActive(docName);
  const result = body(
    await toolHandler("layout_audit")({
      pages: undefined,
      families: ["overrides"],
      includeMasters: false,
      detail: undefined,
    }),
  ) as AuditBody;

  expect(result.masters.findings).toEqual([]);
  expect(result.masters.distribution).toEqual([]);
  expect(result.totals.masterFindings).toBe(0);
  /* overrides тим часом рахується як завжди. */
  expect(result.totals.overrideFindings).toBeGreaterThan(0);
});

it("families: ['masters'] не рахує overrides узагалі", async () => {
  await assertFixtureActive(docName);
  const result = body(
    await toolHandler("layout_audit")({
      pages: undefined,
      families: ["masters"],
      includeMasters: false,
      detail: undefined,
    }),
  ) as AuditBody;

  expect(result.styles).toEqual([]);
  expect(result.totals.overrideFindings).toBe(0);
  expect(result.totals.notComparedGroups).toBe(0);
  /* masters тим часом рахується як завжди. */
  expect(result.totals.masterFindings).toBeGreaterThan(0);
});

it("detail фільтрує РІВНО за парою (styleId, група) — без нього переліку немає взагалі", async () => {
  await assertFixtureActive(docName);
  const withoutDetail = body(
    await toolHandler("layout_audit")({
      pages: undefined,
      families: ["overrides", "masters"],
      includeMasters: false,
      detail: undefined,
    }),
  ) as AuditBody;
  expect(withoutDetail.detail).toBeNull();

  /*
   * `styleId`, НЕ жорстко вписана назва (рецензія кола 1, I-3): `detail`
   * тепер адресує стиль за `.id`, тим самим полем, яким уже позначено
   * кожен рядок `styles` у відповіді цього ж виклику. Беремо id рядка
   * «Osnovnyi» ЗВІДТИ, а не вгадуємо число фікстури напряму.
   */
  const osnovnyi = withoutDetail.styles.find((s) => s.styleName === "Osnovnyi");
  expect(osnovnyi, "стиль Osnovnyi відсутній у зведенні").toBeDefined();

  const withDetail = body(
    await toolHandler("layout_audit")({
      pages: undefined,
      families: ["overrides", "masters"],
      includeMasters: false,
      detail: { styleId: osnovnyi!.styleId, group: "indents" },
    }),
  ) as AuditBody;

  expect(withDetail.detail).not.toBeNull();
  const list = withDetail.detail as { styleName: string; styleId: string; group: string }[];
  expect(list.length).toBeGreaterThan(0);
  for (const f of list) {
    expect(f.styleId).toBe(osnovnyi!.styleId);
    expect(f.group).toBe("indents");
  }
});

it("includeMasters доходить до detectOverrides: із ним у зведенні рахується більше абзаців", async () => {
  await assertFixtureActive(docName);
  const withoutMasters = body(
    await toolHandler("layout_audit")({
      pages: undefined,
      families: ["overrides"],
      includeMasters: false,
      detail: undefined,
    }),
  ) as AuditBody;
  const withMasters = body(
    await toolHandler("layout_audit")({
      pages: undefined,
      families: ["overrides"],
      includeMasters: true,
      detail: undefined,
    }),
  ) as AuditBody;

  /*
   * Не звіряємо МНОЖИНУ назв стилів: фоліо батьківської (mLeft/mRight/
   * single-marker) і абзац f2 сторінки "5" (без явного appliedParagraphStyle)
   * використовують той самий стиль за замовчуванням документа — тому назви
   * стилів у "без батьківських" і "з батьківськими" фактично збігаються
   * (виміряно тут-таки: перша версія цього тесту звіряла розмір множини назв
   * і впала — 3 проти 3). Надійна, не вгадана ознака "includeMasters дійшло
   * до детектора" — сумарна кількість абзаців, порахованих у styles: вона
   * зростає рівно на кількість абзаців батьківських сторінок, незалежно від
   * того, під яким стилем вони йдуть.
   */
  const totalParagraphs = (b: AuditBody) => b.styles.reduce((sum, s) => sum + s.paragraphs, 0);
  expect(totalParagraphs(withMasters)).toBeGreaterThan(totalParagraphs(withoutMasters));
});

it("діапазон pages справді звужує вибірку (мутант: pages не доходить до runJsx)", async () => {
  await assertFixtureActive(docName);
  const result = body(
    await toolHandler("layout_audit")({
      pages: ["1"],
      families: ["overrides", "masters"],
      includeMasters: false,
      detail: undefined,
    }),
  ) as AuditBody;

  expect(result.pages).toEqual(["1"]);
  /* Сторінка "1" не має жодного дефекту батьківської (контроль, як і в
   * map.test.ts) — на звуженому діапазоні їх не повинно бути й тут. */
  expect(result.masters.findings).toEqual([]);
});

describe("layout_audit нічого не змінює в документі", () => {
  it("сигнатура вмісту до і після виклику збігається побайтово", async () => {
    /*
     * Той самий патерн ізоляції, що в map.test.ts («layout_measure нічого не
     * змінює», Раунд виправлень 2): ВЛАСНА фікстура, на якій жоден інший тест
     * ще не викликав жодного обробника, а не спільна `docName` — інакше
     * ідемпотентний запис міг би вже забруднити знімок "до" раніше.
     * `__fixture_modified` із чернетки брифінгу цього завдання в кодовій базі
     * НЕ існує (перевірено: лише `__fixture_signature`, і саме з цієї причини —
     * див. коментар у map.test.ts про монотонний прапорець `modified`).
     */
    const isolatedName = await makeLayoutFixtureDoc();
    try {
      await assertFixtureActive(isolatedName);
      const before = await runJsx("__fixture_signature", {});
      await toolHandler("layout_audit")({
        pages: undefined,
        families: ["overrides", "masters"],
        includeMasters: false,
        detail: undefined,
      });
      const after = await runJsx("__fixture_signature", {});
      expect(after).toEqual(before);
    } finally {
      await closeFixtureDoc(isolatedName);
    }
  });
});

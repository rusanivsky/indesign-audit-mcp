import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runJsx } from "../../src/bridge/runner.js";
import { registerPaginationTools } from "../../src/tools/pagination.js";
import type { Tools } from "../../src/tools/shared.js";
import type { PaginationMeasure } from "../../src/pagination/types.js";
import { assertFixtureActive, closeFixtureDoc } from "./fixture-doc.js";

/*
 * РЕМОНТ СЛУЖБОВОГО ЛАНЦЮЖКА НА ЖИВОМУ INDESIGN (спек Фази 8, §4.3).
 *
 * ТОЙ САМИЙ РЕЖИМ БЕЗПЕКИ, ЩО В `pagination-apply.test.ts`: документ
 * створюється лише фікстурним обробником і закривається `closeFixtureDoc` за
 * ТОЧНОЮ назвою; у кожному виклику передається `expectedDocName`; `afterEach`
 * закриває фікстуру навіть після падіння тесту.
 *
 * ОДИН СТАН НА ДОКУМЕНТ — фікстура ланцюжка інакше не вміє: «цілий ланцюжок» і
 * «ланцюжок із пропуском» взаємовиключні за побудовою. Тому документ тут
 * створюється в КОЖНОМУ тесті й закривається одразу.
 *
 * ФІКСТУРА ЗБЕРІГАЄТЬСЯ НА ДИСК (`dir`): `doc.saveACopy` потребує файла — тека
 * копій виводиться з `doc.fullName.parent`, а в незбереженого документа її
 * немає, і обробник відмовляється ДО будь-якої зміни.
 */

const PARAMS = {
  folioStyles: ["Kolontsyfra"],
  contentsNumberStyle: null,
  contentsTitleStyles: [],
  headingStyles: [],
};

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

function applyHandler(): (a: Record<string, unknown>) => Promise<ToolResult> {
  let captured: ((a: Record<string, unknown>) => Promise<ToolResult>) | null = null;
  const fake = {
    registerTool(name: string, _cfg: unknown, h: (a: Record<string, unknown>) => Promise<ToolResult>) {
      if (name === "pagination_apply") captured = h;
    },
  } as unknown as Tools;
  registerPaginationTools(fake);
  if (!captured) throw new Error("pagination_apply не зареєстровано");
  return captured;
}

let docName: string | null = null;
let dir: string | null = null;

async function makeState(state: string): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), "phase8-repair-"));
  const made = await runJsx<{ docName: string; pages: number }>(
    "__fixture_make_helper_chain",
    { state, dir },
    { timeoutMs: 180_000 },
  );
  docName = made.docName;
  await assertFixtureActive(docName);
  return docName;
}

async function repair(over: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const res = await applyHandler()({
    operation: "repair-helper-thread",
    folio: { styleNames: PARAMS.folioStyles, range: "backward" },
    expectedDocName: docName!,
    dryRun: false,
    ...over,
  });
  const data = JSON.parse(res.content[0]!.text) as Record<string, unknown>;
  if (res.isError) throw new Error(`Ремонт відмовився: ${res.content[0]!.text}`);
  return data;
}

async function chain(): Promise<NonNullable<PaginationMeasure["helperChain"]>> {
  const m = await runJsx<PaginationMeasure>("pagination_measure", PARAMS, { timeoutMs: 180_000 });
  if (m.helperChain === null) throw new Error("шару немає — вимір не бачить ланцюжка");
  return m.helperChain;
}

/** Порядок сторінок так, як їх бачить сам ЛАНЦЮЖОК, а не обхід шару. */
function chainOrder(c: NonNullable<PaginationMeasure["helperChain"]>): (number | null)[] {
  return c.frames.slice().sort((a, b) => a.orderInStory - b.orderInStory).map((f) => f.pageOffset);
}

afterEach(async () => {
  if (docName !== null) await closeFixtureDoc(docName);
  docName = null;
  if (dir !== null) await rm(dir, { recursive: true, force: true });
  dir = null;
});

describe("repair-helper-thread на живому документі", () => {
  it("докладає бракуючу ланку й ставить її на своє місце в ланцюжку", async () => {
    await makeState("helper-chain-gap");
    const before = await chain();
    expect(before.pagesWithoutFrame).toEqual(["4"]);

    const r = await repair();
    const created = (r.repaired as Record<string, unknown>).created as { source: string }[];
    expect(created).toHaveLength(1);
    /*
     * `source: "folio"` — НЕ КОСМЕТИКА, І ЦЕ ДОВЕДЕНО НАДРУКОВАНИМ ЧИСЛОМ.
     * Зонд `H8` викликав обробник із порожнім переліком донорів, і докладена
     * ланка лягла в куток сторінки замість того, щоб накрити колонцифру:
     * ланцюжок вийшов суцільний, звіт бездоганний, а на аркуші сторінка й далі
     * друкувала «5–5» замість «4–5». Тобто ремонт полагодив ЛАНЦЮЖОК і не
     * полагодив ЧИСЛО. Ця перевірка стереже, щоб інструмент і далі передавав
     * донорів.
     */
    expect(created[0]!.source).toBe("folio");

    const after = await chain();
    expect(after.pagesWithoutFrame).toEqual([]);
    expect(chainOrder(after)).toEqual([0, 1, 2, 3, 4, 5]);
  }, 300_000);

  it("прибирає ДРУГУ рамку зі сторінки — виміряний вхід «2–3» → «3–3»", async () => {
    await makeState("helper-chain-duplicate-on-page");
    expect((await chain()).frames).toHaveLength(7);

    const r = await repair();
    const removed = (r.repaired as Record<string, unknown>).removed as { reason: string }[];
    expect(removed).toHaveLength(1);
    expect(removed[0]!.reason).toBe("duplicate-on-page");

    const after = await chain();
    expect(after.frames).toHaveLength(6);
    expect(chainOrder(after)).toEqual([0, 1, 2, 3, 4, 5]);
  }, 300_000);

  it("прибирає рамку-сироту поза сторінками", async () => {
    await makeState("helper-chain-orphan-frame");
    expect((await chain()).frames.filter((f) => f.page === null)).toHaveLength(1);

    const r = await repair();
    const removed = (r.repaired as Record<string, unknown>).removed as { reason: string }[];
    expect(removed).toHaveLength(1);
    expect(removed[0]!.reason).toBe("orphan");

    expect((await chain()).frames.filter((f) => f.page === null)).toEqual([]);
  }, 300_000);

  it("перезшиває перетасований ланцюжок у порядок сторінок", async () => {
    await makeState("helper-chain-unordered");
    expect(chainOrder(await chain())).not.toEqual([0, 1, 2, 3, 4, 5]);

    await repair();
    expect(chainOrder(await chain())).toEqual([0, 1, 2, 3, 4, 5]);
  }, 300_000);

  it("зшиває РОЗПАЛИЙ ланцюжок в один — стан після дублювання сторінки", async () => {
    /*
     * Головний стан фази: рамка є на кожній сторінці, порядок головної історії
     * монотонний, а ланцюжків ДВА (виміряно, `H8` Питання 2). Ремонт мусить
     * звести їх в один, інакше відколота ланка й далі друкуватиме власну
     * сторінку.
     */
    await makeState("helper-chain-split");
    const before = await chain();
    expect(before.storyIds).toHaveLength(2);
    expect(before.pagesWithoutFrame).toEqual([]);

    await repair();

    const after = await chain();
    expect(after.storyIds).toHaveLength(1);
    expect(chainOrder(after)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  }, 300_000);

  it("повертає видимість шару — прихований глушить розв'язання маркерів", async () => {
    await makeState("helper-chain-hidden-layer");
    expect((await chain()).layerVisible).toBe(false);

    const r = await repair();
    const before = (r.repaired as Record<string, unknown>).layerFlagsBefore as {
      visible: boolean;
    };
    expect(before.visible).toBe(false);

    const after = await chain();
    expect(after.layerVisible).toBe(true);
    /* `printable = false` — ШТАТНИЙ стан цього шару, ремонт його не міняє. */
    expect(after.layerPrintable).toBe(false);
  }, 300_000);

  it("ВІДМОВЛЯЄТЬСЯ цілком, коли на шарі лежить чужа робота", async () => {
    /*
     * Ім'я `_folio-helper` не є власністю інструмента, тож непорожня рамка на
     * ньому могла опинитись законно. Вибіркове прибирання лишило б ланцюжок
     * напівполагодженим, а звіт — неправдою; тому відмова стосується ВСІЄЇ
     * операції, і копії при цьому не створюється.
     */
    await makeState("helper-chain-foreign-item");
    const framesBefore = (await chain()).frames.length;

    const res = await applyHandler()({
      operation: "repair-helper-thread",
      folio: { styleNames: PARAMS.folioStyles, range: "backward" },
      expectedDocName: docName!,
      dryRun: false,
    });
    expect(res.isError).toBe(true);
    /* Перелік винних елементів їде в ТЕКСТІ помилки, а не полем відповіді:
     * поле було б завжди порожнім, а порожній масив читається як «перевірили й
     * не знайшли». */
    expect(res.content[0]!.text).toContain("must NOT delete");
    expect(res.content[0]!.text).toContain("is NOT empty");

    /* Документ не змінено — саме це й означає «відмова цілком». */
    expect((await chain()).frames).toHaveLength(framesBefore);
  }, 300_000);

  it("ІДЕМПОТЕНТНІСТЬ: другий і третій прогони не міняють НІЧОГО", async () => {
    /*
     * Критерій приймання §4.3, і він не косметичний: повний цикл
     * розшивання-зшивання створює НОВУ історію (виміряно, Питання 4б,
     * `256 → 469`), тож ремонт без цієї перевірки щоразу міняв би `story.id`,
     * ставив документові `modified` і клав крок скасування — за нічого.
     */
    await makeState("helper-chain-gap");
    const first = await repair();
    expect(((first.repaired as Record<string, unknown>).created as unknown[]).length).toBe(1);

    for (const pass of [2, 3]) {
      const again = await repair();
      const rep = again.repaired as Record<string, unknown>;
      expect({ pass, ...rep as object }).toMatchObject({
        pass,
        removed: [],
        created: [],
        restitched: 0,
      });
    }
  }, 300_000);

  it("на ЦІЛОМУ ланцюжку перший же прогін дає нулі", async () => {
    await makeState("helper-chain-complete");
    const r = await repair();
    const rep = r.repaired as Record<string, unknown>;
    expect(rep.removed).toEqual([]);
    expect(rep.created).toEqual([]);
    expect(rep.restitched).toBe(0);
  }, 300_000);

  it("сухий прогін НЕ змінює документа й не створює копії", async () => {
    await makeState("helper-chain-gap");
    const before = await chain();

    const res = await applyHandler()({
      operation: "repair-helper-thread",
      folio: { styleNames: PARAMS.folioStyles, range: "backward" },
      expectedDocName: docName!,
      dryRun: true,
    });
    const data = JSON.parse(res.content[0]!.text) as Record<string, unknown>;
    expect(data.backupPath).toBeNull();
    expect(data.planId).toBeNull();
    const will = data.willRepair as Record<string, unknown>;
    expect(will.createdTotal).toBe(1);
    /* «Ще не міряли»: скільки зв'язків перепишеться, до запису невідомо. */
    expect(will.restitched).toBeNull();

    const after = await chain();
    expect(after.frames).toHaveLength(before.frames.length);
    expect(after.pagesWithoutFrame).toEqual(before.pagesWithoutFrame);
  }, 300_000);

  it("ремонт видає planId — після нього покриття ІНШЕ, ніж було", async () => {
    await makeState("helper-chain-gap");
    const r = await repair();
    expect(typeof r.planId).toBe("string");
    expect(String(r.planId).length).toBeGreaterThan(0);
  }, 300_000);
});

/*
 * ОДИН КРОК СКАСУВАННЯ — ВЛАСТИВІСТЬ, ЯКУ ФАЗА 7 ЛИШИЛА «НА РУКИ».
 *
 * §4.4 вимагає, щоб УСЯ операція була одним кроком: дві обгортки означали б, що
 * перше Cmd+Z лишає ланцюжок із пропуском — рівно той стан, який Питання 18
 * виміряло як брехливий. Довести це можна лише виконанням, і `doc.undo()` з
 * ОКРЕМОГО виклику (поза власним кроком) працює — на відміну від виклику
 * всередині нього, який кидає (Питання 12 Фази 7).
 *
 * Беремо стан, у якому ремонт робить ТРИ різні речі — прибирає рамку, лишає
 * покриття повним і перезшиває ланцюжок: якби кроків скасування було кілька,
 * одне undo повернуло б лише останню з них.
 */
describe("один крок скасування", () => {
  it("одне undo відкочує ВЕСЬ ремонт, а не його частину", async () => {
    await makeState("helper-chain-duplicate-on-page");

    const before = await chain();
    expect(before.frames).toHaveLength(7);
    const beforeIds = before.frames.map((f) => f.frameId).sort();

    const r = await repair();
    const rep = r.repaired as Record<string, unknown>;
    expect((rep.removed as unknown[]).length).toBe(1);
    expect(rep.restitched).toBe(5);
    expect((await chain()).frames).toHaveLength(6);

    const undone = await runJsx<{ undone: boolean; undoNameBefore: string }>(
      "__undo_once",
      { name: docName },
      { timeoutMs: 180_000 },
    );
    /*
     * НА ВЕРШИНІ СТЕКА МУСИТЬ ЛЕЖАТИ САМЕ НАША ОПЕРАЦІЯ, і перевіряти це треба
     * окремо: без цього тест був би зеленим і тоді, коли одне undo відкотило
     * ЩОСЬ ІНШЕ, а стан рамок збігся випадково.
     */
    expect(undone.undoNameBefore).toBe("Repair of the helper chain");

    const after = await chain();
    /* Рамка повернулась — отже прибирання й перезшивання лежали в ОДНОМУ кроці. */
    expect(after.frames).toHaveLength(7);
    expect(after.frames.map((f) => f.frameId).sort()).toEqual(beforeIds);
  }, 300_000);
});

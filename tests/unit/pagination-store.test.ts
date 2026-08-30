import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadRewritePlan,
  newRewritePlanId,
  rewritePlanPath,
  saveRewritePlan,
} from "../../src/pagination/store.js";
import type { RewritePlan } from "../../src/pagination/rewrite-types.js";

/*
 * СХОВИЩЕ РІШЕННЯ МІЖ ДВОМА ОПЕРАЦІЯМИ (спек §4.5).
 *
 * `create-helper-thread` і `replace-literals` — окремі виклики, і між ними
 * може змінитися все: оператор посунув рамку, InDesign перекомпонував
 * сторінку, СЕРВЕР ПЕРЕЗАПУСТИВСЯ. Тому план живе на диску, а не в пам'яті, —
 * рівно як `src/corrections/store.ts`, названий у спеку прецедентом.
 *
 * ЧОГО ЦЕЙ ФАЙЛ СТЕРЕЖЕ НАСАМПЕРЕД: план, прочитаний для ЧУЖОГО документа,
 * гірший за відсутній. Оракул звіряє ЧИСЛО, а число сьогодні збігається —
 * тобто розсинхрон він не спіймає (§4.5). Ловити його мусить саме читання.
 */

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "idmcp-home-pgn-"));
  process.env.INDESIGN_MCP_HOME = home;
});

afterEach(async () => {
  delete process.env.INDESIGN_MCP_HOME;
  await rm(home, { recursive: true, force: true });
});

const plan: RewritePlan = {
  planId: "folio-plan-test",
  docName: "kniha.indd",
  chainOffsets: [0, 1, 2, 3],
  verdicts: [
    {
      frameId: "101",
      page: "3",
      paragraphIndex: 0,
      eligible: true,
      reason: null,
      current: 2,
      expected: 2,
      direction: "previous",
      route: "helper",
      resolvedBy: "helper",
    },
    {
      frameId: "102",
      page: "4",
      paragraphIndex: 0,
      eligible: false,
      reason: "oracle-mismatch",
      current: 42,
      expected: 3,
      direction: "next",
      route: null,
      resolvedBy: null,
    },
  ],
};

describe("сховище плану переписування", () => {
  it("збережений план читається назад без втрат", async () => {
    const path = await saveRewritePlan(plan);
    expect(path).toBe(rewritePlanPath(plan.planId));

    /*
     * Саме `toEqual` цілого плану, а не вибірка полів: `chainOffsets` — це
     * ФАКТИЧНЕ покриття службового ланцюжка, тобто єдиний канал, яким рішення
     * першої операції доїжджає до другої (§4.5). Вибіркова звірка пропустила б
     * його втрату мовчки, а оракул тоді взяв би НАЗВАНИЙ контракт §4.2 замість
     * того, що збудували насправді.
     */
    expect(await loadRewritePlan(plan.planId, "kniha.indd")).toEqual(plan);
  });

  it("loadPlan із чужим docName кидається, а не повертає план", async () => {
    await saveRewritePlan(plan);
    await expect(loadRewritePlan(plan.planId, "insha-knyha.indd")).rejects.toThrow(
      /kniha\.indd/,
    );
  });

  it("невідомий план — помилка, що називає шлях і як побудувати заново", async () => {
    await expect(loadRewritePlan("nemaie", "kniha.indd")).rejects.toThrow(/nemaie/);
  });

  it("planId із роздільником шляху відхиляється, а не читає чужий файл", async () => {
    expect(() => rewritePlanPath("../../etc/passwd")).toThrow(/planId/);
    await expect(loadRewritePlan("..", "kniha.indd")).rejects.toThrow(/planId/);
  });

  it("план corrections НЕ читається як план фази 7 — інша тека й інша форма", async () => {
    /*
     * `src/corrections/store.ts` кладе свої плани в `plans/` під тим самим
     * форматом імені. Спільна тека означала б, що `loadRewritePlan("plan-…")`
     * поверне об'єкт ІНШОЇ форми з правильним `docName` — тобто `verdicts`
     * буде `undefined`, і впаде це аж у викликача, з повідомленням, з якого
     * причини не видно.
     */
    await mkdir(join(home, "plans"), { recursive: true });
    await writeFile(
      join(home, "plans", "folio-plan-test.json"),
      JSON.stringify({ planId: "folio-plan-test", docName: "kniha.indd", items: [] }),
      "utf8",
    );
    await expect(loadRewritePlan("folio-plan-test", "kniha.indd")).rejects.toThrow(/nemaie|not found/i);

    /* І навіть покладений у ПРАВИЛЬНУ теку чужий за формою файл не пролізе. */
    await mkdir(join(home, "pagination-plans"), { recursive: true });
    await writeFile(
      rewritePlanPath("chuzhyi"),
      JSON.stringify({ planId: "chuzhyi", docName: "kniha.indd", items: [] }),
      "utf8",
    );
    await expect(loadRewritePlan("chuzhyi", "kniha.indd")).rejects.toThrow(/verdicts/);
  });

  it("newRewritePlanId дає ім'я, яке приймає rewritePlanPath", () => {
    const id = newRewritePlanId();
    expect(() => rewritePlanPath(id)).not.toThrow();
    expect(id).toMatch(/^folio-plan-/);
  });
});

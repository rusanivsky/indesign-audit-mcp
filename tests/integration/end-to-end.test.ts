import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runJsx } from "../../src/bridge/runner.js";
import { assertFixtureActive, closeFixtureDoc } from "./fixture-doc.js";
import { buildPlan, orderForApply } from "../../src/corrections/planner.js";
import { newPlanId } from "../../src/corrections/store.js";
import { toAcceptedEdits } from "../../src/tools/corrections.js";
import type { ApplyReport, ContainerSnapshot } from "../../src/corrections/types.js";

/*
 * УВАГА щодо безпеки. Та сама, що й у tests/integration/corrections.test.ts
 * (найближчий сусід цього файлу за прийомами безпеки — це не окремий обхід
 * правил, а той самий підхід, застосований до наскрізного сценарію). У
 * користувача в InDesign може бути відкритий реальний робочий макет. Тому:
 *   - фікстура створюється й закривається лише через __fixture_make_saved /
 *     closeFixtureDoc(docName) — за точною назвою;
 *   - перед кожним кроком, що спирається на активний документ (читання чи
 *     запис), викликається assertFixtureActive;
 *   - apply_edits і __undo_once отримують ім'я документа фікстури явно —
 *     обробники відмовляться діяти на будь-якому іншому документі;
 *   - afterAll закриває фікстуру навіть після падіння тесту.
 *
 * Виправлення проти брифінгу (задокументовано в task-10-report.md,
 * "Обов'язкові виправлення понад брифінг", пункт 1): брифінг передував
 * запобіжнику Task 8 і викликав apply_edits без expectedDocName та
 * __undo_once без name — обидва параметри тепер обов'язкові, обробники
 * кидають виняток без них. Тут вони передаються в кожному виклику.
 * Перетворення кандидата плану на AcceptedEdit узято з toAcceptedEdits
 * (src/tools/corrections.ts) — тієї самої функції, яку викликає
 * corrections_apply, — а не переписане власною копією тут-таки.
 */

let docName: string;
let dir: string;
let home: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "idmcp-e2e-"));
  home = await mkdtemp(join(tmpdir(), "idmcp-e2e-home-"));
  process.env.INDESIGN_MCP_HOME = home;
  docName = await runJsx<string>("__fixture_make_saved", { dir });
});

afterAll(async () => {
  if (docName) await closeFixtureDoc(docName);
  delete process.env.INDESIGN_MCP_HOME;
  await rm(dir, { recursive: true, force: true });
  await rm(home, { recursive: true, force: true });
});

describe("наскрізний цикл правки: план -> застосування -> копія -> один undo", () => {
  it("від запиту до зміненого документа з копією і одним undo", async () => {
    await assertFixtureActive(docName);
    const read = await runJsx<{ docName: string; containers: ContainerSnapshot[] }>(
      "containers_read",
      {},
    );
    expect(read.docName).toBe(docName);

    const plan = buildPlan({
      planId: newPlanId(),
      docName: read.docName,
      requests: [{ id: "r1", action: "replace", old: "pomylka", new: "vypravlennia" }],
      containers: read.containers,
    });

    expect(plan.items[0]!.status).toBe("unique");
    const cand = plan.items[0]!.candidates[0]!;

    const edits = toAcceptedEdits(plan, [{ requestId: "r1", candidateId: cand.candidateId }]);

    await assertFixtureActive(docName);
    const report = await runJsx<ApplyReport>("apply_edits", {
      expectedDocName: docName,
      stamp: "e2e",
      undoName: "E2E",
      edits: orderForApply(edits),
    });

    expect(report.applied).toHaveLength(1);
    expect(report.skipped).toHaveLength(0);
    expect(report.failed).toHaveLength(0);
    expect(existsSync(report.backupPath)).toBe(true);

    await assertFixtureActive(docName);
    const after = await runJsx<{ containers: ContainerSnapshot[] }>("containers_read", {});
    expect(after.containers.some((c) => c.text.includes("vypravlennia"))).toBe(true);

    /* Одне скасування — і документ повертається в початковий стан:
     * доводить, що вся пачка (тут — одна правка) лягла одним кроком історії. */
    await assertFixtureActive(docName);
    await runJsx("__undo_once", { name: docName });

    await assertFixtureActive(docName);
    const restored = await runJsx<{ containers: ContainerSnapshot[] }>("containers_read", {});
    expect(restored.containers.some((c) => c.text.includes("pomylka"))).toBe(true);
    expect(restored.containers.some((c) => c.text.includes("vypravlennia"))).toBe(false);
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { savePlan, loadPlan, newPlanId, planPath } from "../../src/corrections/store.js";
import type { Plan } from "../../src/corrections/types.js";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "idmcp-home-"));
  process.env.INDESIGN_MCP_HOME = home;
});

afterEach(async () => {
  delete process.env.INDESIGN_MCP_HOME;
  await rm(home, { recursive: true, force: true });
});

const plan: Plan = {
  planId: "p-test",
  createdAt: "2026-07-28T10:00:00.000Z",
  docName: "kniha.indd",
  items: [],
};

describe("сховище планів", () => {
  it("зберігає план у ~/.indesign-mcp/plans", async () => {
    const path = await savePlan(plan);
    expect(path).toBe(planPath("p-test"));
    expect(path.startsWith(join(home, "plans"))).toBe(true);
  });

  it("читає збережений план назад без втрат", async () => {
    await savePlan(plan);
    expect(await loadPlan("p-test")).toEqual(plan);
  });

  it("зрозуміло повідомляє про невідомий план", async () => {
    await expect(loadPlan("nemaie")).rejects.toThrow(/nemaie/);
  });

  /*
   * planId приходить у corrections_apply як звичайний рядок від моделі й
   * підставляється просто у шлях файлу. Без перевірки "../.." вивів би читання
   * і запис за межі теки станів — тобто в чужі файли користувача.
   */
  it("не пускає planId за межі теки планів", () => {
    expect(() => planPath("../../evil")).toThrow(/planId/);
    expect(() => planPath("pidteka/plan")).toThrow(/planId/);
    expect(() => planPath("")).toThrow(/planId/);
  });

  it("не втрачає ідентифікатори, які видає newPlanId", () => {
    expect(() => planPath(newPlanId())).not.toThrow();
  });
});

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Plan } from "./types.js";

function stateDir(): string {
  return process.env.INDESIGN_MCP_HOME ?? join(homedir(), ".indesign-mcp");
}

/*
 * planId arrives in corrections_apply as a plain string and gets substituted
 * into a file path. We only allow "flat" names with no path separators or
 * dot-dot segments, so that neither reading nor writing can escape the plans directory.
 */
const PLAN_ID = /^[A-Za-z0-9._-]+$/;

export function planPath(planId: string): string {
  if (!PLAN_ID.test(planId) || planId === "." || planId === "..") {
    throw new Error(
      `Invalid planId "${planId}": only Latin letters, digits, dots, hyphens, and underscores are allowed.`,
    );
  }
  return join(stateDir(), "plans", `${planId}.json`);
}

export async function savePlan(plan: Plan): Promise<string> {
  const path = planPath(plan.planId);
  await mkdir(join(stateDir(), "plans"), { recursive: true });
  await writeFile(path, JSON.stringify(plan, null, 2), "utf8");
  return path;
}

export async function loadPlan(planId: string): Promise<Plan> {
  /* planId validation stays outside the try, so its error doesn't turn into a "not found". */
  const path = planPath(planId);
  try {
    return JSON.parse(await readFile(path, "utf8")) as Plan;
  } catch {
    throw new Error(
      `Plan "${planId}" not found at ${path}. Rebuild it via corrections_plan.`,
    );
  }
}

export function newPlanId(): string {
  return `plan-${new Date().toISOString().replace(/[:.]/g, "-")}`;
}

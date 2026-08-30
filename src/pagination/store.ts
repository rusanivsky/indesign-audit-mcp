/**
 * HANDING THE VERDICT OFF BETWEEN TWO OPERATIONS (spec §4.5). The precedent
 * is named in the spec itself — `src/corrections/store.ts`, and the form
 * here is the same.
 *
 * WHY DISK AT ALL, NOT MEMORY. `create-helper-thread` and
 * `replace-literals` are separate MCP calls, and the server can restart
 * between them. An in-memory plan wouldn't survive every pair of calls, and
 * a silent loss of the plan would look like "the operator didn't pass
 * `planId`".
 *
 * WHAT THIS CHANNEL ACTUALLY CLOSES, AND WHAT IT ONLY CLOSED IN WORDS.
 * Splitting the two operations buys observability at the price of
 * desynchronization: between the calls the operator can move a frame, and
 * InDesign can recompose the page.
 *
 * ONE CLAIM FROM §4.5 TURNED OUT FALSE, AND THIS IS MEASURED. The channel
 * was justified on the grounds that "the utility frames don't belong to the
 * `folio` family, so a repeat `pagination_measure` won't see them". They
 * indeed don't become CLAIM frames — but in `ClaimFrame.overlaps` the folios
 * are all visible, every one (the geometry matches exactly, §4.2), and the
 * final review measured this on the live document: `overlaps: 1`,
 * `previousPage` correct. So ACTUAL coverage lives in the measurement
 * itself — and lives in the right unit, PER-FRAME, whereas `chainOffsets`
 * carried it per-page. This exact difference is what C1 rested on.
 *
 * SO ELIGIBILITY IS NO LONGER TAKEN FROM THE PLAN, and the plan got the job
 * §4.5 actually promised it: it's VERIFIED AGAINST. `verdicts` used to be
 * stored and never read; now every paragraph about to be written to must
 * have a twin in the plan with the same number (`assertPlanStillHolds`,
 * `src/tools/pagination.ts`).
 *
 * `chainOffsets` and `chainFolioFrameIds` stay in the plan as PROVENANCE —
 * its own verdicts were built from exactly these, and without them the plan
 * can't be read by eye.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RewritePlan } from "./rewrite-types.js";

function stateDir(): string {
  return process.env.INDESIGN_MCP_HOME ?? join(homedir(), ".indesign-mcp");
}

/*
 * A SEPARATE FOLDER, NOT SHARED WITH `corrections`. The name format there
 * and here is the same ("plan-" + timestamp), so in one shared folder a
 * corrections plan and a pagination plan would differ only in CONTENTS.
 * Read as a `RewritePlan`, a corrections plan would yield
 * `verdicts === undefined` with a valid `docName` — i.e. it would fail all
 * the way up at the caller, not at the actual cause.
 */
const PLANS_SUBDIR = "pagination-plans";

/*
 * `planId` arrives at `pagination_apply` as a plain string and gets
 * substituted into the file path. Only "flat" names with no path separators
 * or dot-dot traversal are allowed — the same rule as in
 * `src/corrections/store.ts`.
 */
const PLAN_ID = /^[A-Za-z0-9._-]+$/;

export function rewritePlanPath(planId: string): string {
  if (!PLAN_ID.test(planId) || planId === "." || planId === "..") {
    throw new Error(
      `Invalid planId "${planId}": only Latin letters, digits, dots, hyphens, and underscores are allowed.`,
    );
  }
  return join(stateDir(), PLANS_SUBDIR, `${planId}.json`);
}

export async function saveRewritePlan(plan: RewritePlan): Promise<string> {
  const path = rewritePlanPath(plan.planId);
  await mkdir(join(stateDir(), PLANS_SUBDIR), { recursive: true });
  await writeFile(path, JSON.stringify(plan, null, 2), "utf8");
  return path;
}

/**
 * SHAPE VERIFICATION — BEFORE DOCUMENT VERIFICATION, and both are mandatory.
 *
 * Shape: the file on disk outlives any code change and any outside hand. A
 * silent `verdicts === undefined` would go into the write loop and yield
 * zero corrections — i.e. "nothing matched" instead of "wrong plan", and §7
 * calls silent inaction that reads as success the phase's most likely
 * failure mode.
 */
function assertRewritePlan(value: unknown, planId: string, path: string): RewritePlan {
  const plan = value as Partial<RewritePlan> | null;
  if (plan === null || typeof plan !== "object" || !Array.isArray(plan.verdicts)) {
    throw new Error(
      `File ${path} is not a folio-rewrite plan: it has no verdicts array. ` +
        `Rebuild the plan via pagination_apply with operation: "create-helper-thread".`,
    );
  }
  if (typeof plan.docName !== "string" || typeof plan.planId !== "string") {
    throw new Error(
      `File ${path} is not a folio-rewrite plan: docName or planId is missing (verdicts is present).`,
    );
  }
  if (plan.planId !== planId) {
    throw new Error(
      `The plan at ${path} calls itself "${plan.planId}", but it was read as "${planId}".`,
    );
  }
  return plan as RewritePlan;
}

/**
 * `expectedDocName` — A MANDATORY ARGUMENT, not an optional check.
 *
 * A check that can be forgotten gets forgotten. The cost here is named by
 * measurement: the plan was built for one specific document, and the one
 * active in InDesign may well turn out to be a different one — which is
 * exactly why `expectedDocName` is mandatory both at the tool level (§5.1)
 * and inside the JSX handler.
 */
export async function loadRewritePlan(
  planId: string,
  expectedDocName: string,
): Promise<RewritePlan> {
  /* Validation of `planId` — OUTSIDE the `try`, so its error doesn't turn into "not found". */
  const path = rewritePlanPath(planId);

  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new Error(
      `Plan "${planId}" not found at ${path}. ` +
        `Rebuild it via pagination_apply with operation: "create-helper-thread".`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Plan "${planId}" at ${path} cannot be read as JSON.`);
  }

  const plan = assertRewritePlan(parsed, planId, path);

  if (plan.docName !== expectedDocName) {
    throw new Error(
      `Plan "${planId}" was built for document "${plan.docName}", ` +
        `but is being asked to apply to "${expectedDocName}". ` +
        "Nothing was changed: the route of every helper frame was determined by that specific document.",
    );
  }
  return plan;
}

/**
 * The `folio-plan-` prefix is deliberately DIFFERENT from `plan-` used for
 * corrections: the folder already separates them physically, and a
 * different prefix separates them again in a file listing, when the
 * operator is looking at the folder by eye.
 */
export function newRewritePlanId(): string {
  return `folio-plan-${new Date().toISOString().replace(/[:.]/g, "-")}`;
}

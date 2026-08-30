import { z } from "zod";
import { IndesignError } from "../bridge/errors.js";
import { runWrite } from "../bridge/envelope.js";
import { runJsx } from "../bridge/runner.js";
import { LIVE_WRITE_MARKER } from "../bridge/heartbeat.js";
import { explain, reconcile, type DisputeReason, type DisputedItem, type Reconciliation } from "../corrections/disputed.js";
import { readNextNumber, saveNextNumber } from "../corrections/numbering.js";
import { buildPlan, findConflicts, orderForApply } from "../corrections/planner.js";
import { loadPlan, newPlanId, savePlan } from "../corrections/store.js";
import { buildTable, renderMarkdown, type AlreadyAppliedRow, type AppliedRow, type CorrectionsTable } from "../corrections/table.js";
import type {
  AcceptedEdit,
  ApplyOutcome,
  ApplyReport,
  ContainerSnapshot,
  CorrectionRequest,
  Plan,
  Warning,
} from "../corrections/types.js";
import type { SeamNormalization } from "../typography/seam.js";
import { inspectRanges, styleWarnings, type RangeStyleInfo } from "./find.js";
import { assertExpectedDoc, EXPECTED_DOC_NAME_FIELD, fail, ok, type Tools } from "./shared.js";

/*
 * Writing to a 194-page document is noticeably slower than reading, and
 * the general 30s in runJsx is calibrated for reading. More importantly: when
 * osascript is killed on timeout, the script INSIDE InDesign keeps
 * running — for a handler that writes, this means corrections can
 * land even after the tool has already reported an error. That's why this
 * has both a larger limit and a separate message (see describeApplyTimeout).
 */
export const APPLY_TIMEOUT_MS = 180_000;

/*
 * I3. `annotateStyleWarnings` used to send ALL candidate ranges in a single
 * `ranges_inspect` call with a 30s overall timeout — on a large document this
 * is a timeout that gets classified as `busy` and sends the user hunting for a
 * modal dialog that doesn't exist.
 *
 * Numbers MEASURED on the user's working layout (196 pages, 549 frames,
 * read-only): `ranges_inspect` costs ≈250ms fixed plus ≈4.6ms per
 * range (10 → 425ms, 50 → 637ms, 200 → 1342ms, 500 → 2662ms).
 *
 * STYLE_RANGE_BATCH = 200 → ≈1.3s per batch at the measured rate, i.e.
 * more than a twentyfold margin to the 30s timeout. The margin is needed:
 * ranges in table cells and footnotes resolve by rescanning all of the
 * story's tables (Task 7 debt), so for them the per-range cost is an order of
 * magnitude above what was measured on story text — even a batch ten times
 * slower (≈9s) stays within the timeout.
 *
 * MAX_STYLE_RANGES = 1000 caps not a single batch but the whole operation: 5
 * batches, ≈6s at the measured rate. Beyond that, style warnings are not
 * collected, and the plan says so explicitly via the `styleInspection` field —
 * silent truncation here would be the same disease as the global
 * `already_applied`.
 */
export const STYLE_RANGE_BATCH = 200;
export const MAX_STYLE_RANGES = 1000;

const requestSchema = z.object({
  id: z.string(),
  action: z.enum(["replace", "delete", "insert"]).default("replace"),
  old: z.string().describe("What to replace. For insert — the anchor text AFTER which to insert."),
  new: z.string().default("").describe("What to replace it with. For delete — an empty string."),
  pageHint: z.number().int().optional(),
  note: z.string().optional().describe("The proofreader's original comment."),
  contextBefore: z
    .string()
    .optional()
    .describe("The context preceding the text selected in the PDF annotation. Needed to anchor short (1-2 letter) edits."),
  contextAfter: z
    .string()
    .optional()
    .describe("The context following the text selected in the PDF annotation. Needed to anchor short (1-2 letter) edits."),
});

export interface StyleInspection {
  /** How many unique ranges actually went through inspection. */
  inspected: number;
  /** How many there were. The difference means some candidates have no style warnings. */
  total: number;
}

/**
 * Adds style-overlap warnings to candidates. Identical ranges from
 * different requests are inspected once; the rest go in batches of
 * STYLE_RANGE_BATCH, capped at MAX_STYLE_RANGES total.
 */
async function annotateStyleWarnings(plan: Plan): Promise<StyleInspection> {
  const unique = new Map<string, { containerId: string; start: number; end: number }>();
  for (const item of plan.items) {
    for (const c of item.candidates) {
      unique.set(`${c.containerId}:${c.start}:${c.end}`, {
        containerId: c.containerId,
        start: c.start,
        end: c.end,
      });
    }
  }

  const all = [...unique.values()];
  const ranges = all.slice(0, MAX_STYLE_RANGES);
  const byKey = new Map<string, RangeStyleInfo>();
  for (let i = 0; i < ranges.length; i += STYLE_RANGE_BATCH) {
    const infos = await inspectRanges(ranges.slice(i, i + STYLE_RANGE_BATCH));
    for (const info of infos) byKey.set(`${info.containerId}:${info.start}:${info.end}`, info);
  }

  for (const item of plan.items) {
    for (const c of item.candidates) {
      const info = byKey.get(`${c.containerId}:${c.start}:${c.end}`);
      if (info) c.warnings.push(...styleWarnings(info));
    }
  }
  return { inspected: ranges.length, total: all.length };
}

/**
 * T3. Spec §4.5 calls "which stories BECAME overset" and "how many pages
 * shifted" the report's main practical value, but the handler used to return
 * oversetBefore/After and pageCountBefore/After raw — to see the change you
 * had to diff the two lists by eye. The diffs are computed here, in
 * TypeScript, not in JSX: all the logic stays outside InDesign and is covered
 * by unit tests. The raw fields stay in place — the report loses nothing.
 */
export function withDiffs(report: ApplyReport): ApplyOutcome {
  const before = new Set(report.oversetBefore);
  const after = new Set(report.oversetAfter);
  return {
    ...report,
    diffs: {
      becameOverset: report.oversetAfter.filter((id) => !before.has(id)),
      noLongerOverset: report.oversetBefore.filter((id) => !after.has(id)),
      pageCountDelta: report.pageCountAfter - report.pageCountBefore,
    },
  };
}

export interface AppliedEditWithWarnings {
  requestId: string;
  candidateId: string;
  warnings: Warning[];
  /** B4: exactly what typographic normalization changed before writing. */
  normalizations: SeamNormalization[];
}

/**
 * T-trim (brief, requirement 2): candidate warnings (candidate.warnings —
 * the same mechanism as in-overset or multiple-char-styles) must reach the
 * operator not only in the dry run (corrections_plan) but also in the
 * corrections_apply report, where you can see WHAT EXACTLY was applied. The
 * source of warnings here is a single one — the plan, which already carried
 * them from buildPlan and annotateStyleWarnings; here they are only matched
 * to the specific applied correction by (requestId, candidateId). There is no
 * separate warning computation.
 */
export function attachAppliedWarnings(
  outcome: ApplyOutcome,
  plan: Plan,
): ApplyOutcome & { applied: AppliedEditWithWarnings[] } {
  const byKey = new Map<string, { warnings: Warning[]; normalizations: SeamNormalization[] }>();
  for (const item of plan.items) {
    for (const c of item.candidates) {
      byKey.set(`${item.id}::${c.candidateId}`, {
        warnings: c.warnings,
        normalizations: c.normalizations,
      });
    }
  }
  return {
    ...outcome,
    applied: outcome.applied.map((a) => ({
      ...a,
      warnings: byKey.get(`${a.requestId}::${a.candidateId}`)?.warnings ?? [],
      normalizations: byKey.get(`${a.requestId}::${a.candidateId}`)?.normalizations ?? [],
    })),
  };
}

/**
 * Converts user-selected (requestId, candidateId) pairs into corrections to
 * write. `expectedOld` is EXACTLY the text that was in the document during
 * the dry run (`matchText`), and `newText` is the `new` field AFTER
 * typographic normalization in the seam's context (B4, `Candidate.writeText`).
 * Normalization is computed during the dry run and shown in the plan — here
 * it's only taken as-is, so the plan and the write can never diverge.
 */
export function toAcceptedEdits(
  plan: Plan,
  accept: { requestId: string; candidateId: string }[],
): AcceptedEdit[] {
  const edits: AcceptedEdit[] = [];
  for (const a of accept) {
    const item = plan.items.find((i) => i.id === a.requestId);
    if (!item) throw new Error(`The plan contains no request “${a.requestId}”.`);
    const cand = item.candidates.find((c) => c.candidateId === a.candidateId);
    if (!cand) throw new Error(`Request “${a.requestId}” has no candidate “${a.candidateId}”.`);
    edits.push({
      requestId: item.id,
      candidateId: cand.candidateId,
      containerId: cand.containerId,
      start: cand.start,
      end: cand.end,
      expectedOld: cand.matchText,
      newText: item.request.action === "delete" ? "" : cand.writeText,
      action: item.request.action,
    });
  }
  return edits;
}

/**
 * The applied report carries only {requestId, candidateId}; the page, found
 * text, and writeText live on the plan's candidates. Both are already at hand
 * inside corrections_apply, so the table is built by merging, without any
 * call to InDesign.
 */
export function buildReportTable(
  plan: Plan,
  report: ApplyReport,
  submittedIds: string[],
  startNumber: number,
): { table: CorrectionsTable; reconciliation: Reconciliation } {
  const submitted = new Set(submittedIds);
  const itemById = new Map(plan.items.map((i) => [i.id, i]));
  const candidateOf = (requestId: string, candidateId: string) =>
    itemById.get(requestId)?.candidates.find((c) => c.candidateId === candidateId);

  const applied: AppliedRow[] = report.applied.map((a) => {
    const c = candidateOf(a.requestId, a.candidateId);
    return {
      requestId: a.requestId,
      page: c?.page ?? "?",
      before: c?.matchText ?? "",
      after: c?.writeText ?? "",
      ...(itemById.get(a.requestId)?.request.note === undefined
        ? {}
        : { note: itemById.get(a.requestId)!.request.note! }),
    };
  });

  const disputed: DisputedItem[] = [];
  /*
   * candidateId is passed for report.skipped/failed — there an ambiguous plan
   * item has several candidates, and the operator explicitly chose one of
   * them (accept.candidateId). Without this, the disputed-correction row would
   * show the page and text of the FIRST candidate in the plan, not the one
   * actually being written — on a 196-page book this sends the operator to
   * the wrong place. For the not_found/ambiguous plan statuses (paths below),
   * candidateId is unknown altogether — there candidates[0] remains the only
   * available source.
   */
  const pushDisputed = (requestId: string, reason: DisputeReason, detail?: string, candidateId?: string) => {
    const item = itemById.get(requestId);
    const candidate =
      (candidateId !== undefined ? item?.candidates.find((c) => c.candidateId === candidateId) : undefined) ??
      item?.candidates[0];
    disputed.push({
      number: 0, // buildTable overwrites this
      requestId,
      page: candidate?.page ?? null,
      reason,
      explanation: explain(reason, detail),
      ...(item?.request.note === undefined ? {} : { note: item.request.note }),
      ...(candidate?.matchText === undefined ? {} : { markedText: candidate.matchText }),
    });
  };

  for (const s of report.skipped) pushDisputed(s.requestId, "text-changed", `Expected “${s.expected}”, found “${s.actual}”.`, s.candidateId);
  for (const f of report.failed) pushDisputed(f.requestId, "write-failed", f.reason, f.candidateId);

  const alreadyApplied: AlreadyAppliedRow[] = [];
  const accounted = new Set([
    ...report.applied.map((a) => a.requestId),
    ...report.skipped.map((s) => s.requestId),
    ...report.failed.map((f) => f.requestId),
  ]);

  for (const item of plan.items) {
    if (!submitted.has(item.id) || accounted.has(item.id)) continue;
    if (item.status === "already_applied") {
      alreadyApplied.push({
        requestId: item.id,
        page: item.appliedAt?.page ?? null,
        text: item.appliedAt?.matchText ?? item.request.new,
        ...(item.request.note === undefined ? {} : { note: item.request.note }),
      });
    } else if (item.status === "not_found") {
      pushDisputed(item.id, "not-found");
    } else {
      pushDisputed(item.id, "ambiguous-anchor");
    }
  }

  const order = plan.items.filter((i) => submitted.has(i.id)).map((i) => i.id);
  const notSubmitted = plan.items.filter((i) => !submitted.has(i.id)).map((i) => i.id);

  const table = buildTable({ startNumber, order, applied, disputed, alreadyApplied, notSubmitted });
  const reconciliation = reconcile({
    requestIds: order,
    appliedIds: [...applied.map((a) => a.requestId), ...alreadyApplied.map((a) => a.requestId)],
    disputedIds: disputed.map((d) => d.requestId),
  });
  return { table, reconciliation };
}

/** "2026-07-28T14:32" → "2026-07-28-1432", as in the spec. */
export function backupStamp(now: Date = new Date()): string {
  return now.toISOString().slice(0, 16).replace("T", "-").replace(":", "");
}

/**
 * A timeout specifically during the write is a special case. runJsx kills
 * osascript, but the script inside InDesign doesn't stop, so a silent
 * "failed" here would be a lie: corrections may have been applied. The
 * message must say this outright and point to where the backup copy is.
 */
export function describeApplyTimeout(): IndesignError {
  return new IndesignError(
    "busy",
    `InDesign did not respond within ${Math.round(APPLY_TIMEOUT_MS / 1000)} s while WRITING the edits. ` +
      "The call was aborted on the server side, but the script inside InDesign is NOT aborted by that — " +
      "the edits may have been applied fully or partially after this error.",
    "Do not run corrections_apply again until you have inspected the document by eye in InDesign. " +
      "A copy of the document from before the edits was saved in the _backups/ folder next to the document itself — " +
      "if the state of the document is not acceptable, go back to it. " +
      "If InDesign is showing a modal dialog, close it.",
  );
}

/**
 * I3. A timeout at the dry-run step is a READ timeout, and the generic hint
 * "close the modal dialog" leads the user the wrong way: on a large layout
 * there's no dialog, just a long read. Here we tell the truth: the document is
 * unchanged (this is a read), the most likely cause is document size and
 * request count, and only at the end — a modal dialog as a less likely cause.
 */
export function describePlanTimeout(): IndesignError {
  return new IndesignError(
    "busy",
    "InDesign did not respond within the allotted time while READING the document for the dry run. " +
      "This is a read only — the document was not changed.",
    "The likeliest cause is a very large document or too many requests at once: " +
      "split the list of edits into smaller batches (fewer requests per call) and repeat. " +
      "If InDesign is nevertheless showing a modal dialog, close it.",
  );
}

export function registerCorrectionTools(server: Tools): void {
  server.registerTool(
    "corrections_plan",
    {
      title: "Dry run of the edits",
      description:
        "Builds a plan of edits without writing to the document. For each request it shows the status (unique / ambiguous / not_found / already_applied), the places found with their context and page, and warnings about overset, a master page, a footnote, a table and a crossing of styles. If old ran into a paragraph boundary, the write range is clamped to that boundary (so as not to destroy the paragraph) — clamped-to-paragraph warns about this, and possible-stray-space additionally fires when the clamped edge borders a space in new: an extra space may then remain at the junction with the end-of-paragraph character. For already_applied it shows in appliedAt the single place where new already stands. No more than 50 candidates per request: if there were more matches, candidatesTruncated holds the full count — narrow old down. The styleInspection field says for how many ranges style warnings were actually gathered. Changes nothing.",
      inputSchema: {
        requests: z.array(requestSchema).min(1),
        pageOffset: z
          .number()
          .int()
          .default(0)
          .describe(
            "By how much the layout's numbering runs ahead of the PDF's numbering. If page 5 in the PDF is page 7 in the layout, give 2. Affects only the order of candidates; the search always covers the whole document.",
          ),
      },
    },
    async ({ requests, pageOffset }) => {
      try {
        const read = await runJsx<{ docName: string; containers: ContainerSnapshot[] }>(
          "containers_read",
          {},
        );
        const plan = buildPlan({
          planId: newPlanId(),
          docName: read.docName,
          requests: requests as CorrectionRequest[],
          containers: read.containers,
          pageOffset,
        });
        const styleInspection = await annotateStyleWarnings(plan);
        const path = await savePlan(plan);

        const summary = {
          planId: plan.planId,
          savedTo: path,
          docName: plan.docName,
          styleInspection,
          counts: {
            unique: plan.items.filter((i) => i.status === "unique").length,
            ambiguous: plan.items.filter((i) => i.status === "ambiguous").length,
            not_found: plan.items.filter((i) => i.status === "not_found").length,
            already_applied: plan.items.filter((i) => i.status === "already_applied").length,
          },
          items: plan.items,
        };
        return ok(summary);
      } catch (e) {
        if (e instanceof IndesignError && e.kind === "busy") return fail(describePlanTimeout());
        return fail(e);
      }
    },
  );

  server.registerTool(
    "corrections_apply",
    {
      title: "Applying the edits",
      description:
        "Applies a previously built plan. It first reconciles that the active document is the one the plan was built for, then saves a copy of the document in _backups/, disables InDesign's dialogs, makes all the edits as a single undo step and verifies the actual text before each write. Before writing, the `new` field passes through the typographic rules in the context of the seam (B4) — a hyphen between words becomes a dash, double spaces at the junction with existing text collapse, and so on; it is the normalised text that is written, and exactly the same is shown in corrections_plan in advance. It returns a report listing what was applied (each entry carries the same warnings its candidate had in the plan — in particular clamped-to-paragraph and possible-stray-space if the range was clamped at a paragraph boundary — and normalizations, if typographic normalisation changed anything in the written text), what was skipped (the anchor text changed), what failed (an exception during the write — a locked layer or story), and in diffs — which stories BECAME overset (becameOverset), which stopped being so (noLongerOverset) and by how much the page count moved (pageCountDelta). Separately it returns a ready-to-display table (table and tableMarkdown) with continuous entry numbering, shared across all batches for this document and between server runs (the numbering is kept on disk, not in memory) — applied edits, disputed ones (with a reason and an explanation) and already applied ones are split across three sections. Plan items that were not among accept go into a separate notSubmitted list rather than among the disputed. The reconciliation field confirms that every submitted request landed in exactly one section — balanced: false signals a silently lost edit and calls for investigation, not for another run.",
      inputSchema: {
        planId: z.string(),
        accept: z
          .array(z.object({ requestId: z.string(), candidateId: z.string() }))
          .describe("Which candidates exactly to apply. For ambiguous ones the chosen candidateId must be given."),
        undoName: z.string().default("Proofreader's edits"),
        expectedDocName: EXPECTED_DOC_NAME_FIELD,
      },
    },
    async ({ planId, accept, undoName, expectedDocName }) => {
      try {
        const plan = await loadPlan(planId);
        assertExpectedDoc(plan.docName, expectedDocName);

        /*
         * A duplicate requestId in accept (two different candidateId values
         * for the same request) could otherwise silently produce BOTH an
         * AppliedRow and a DisputedItem for the same id: buildTable checks
         * byApplied first and continues, so the disputed row gets lost and the
         * request looks like a clean success. We catch this at the input, before
         * any write to the document — the same principle as the overlap check
         * below.
         */
        const requestIdCounts = new Map<string, number>();
        for (const a of accept) requestIdCounts.set(a.requestId, (requestIdCounts.get(a.requestId) ?? 0) + 1);
        const duplicatedRequestIds = [...requestIdCounts.entries()].filter(([, n]) => n > 1).map(([id]) => id);
        if (duplicatedRequestIds.length > 0) {
          throw new Error(
            `A requestId is repeated in accept: ${duplicatedRequestIds.join(", ")}. ` +
              "Each request may be submitted only once — choose one candidateId for each requestId.",
          );
        }

        const edits = toAcceptedEdits(plan, accept);

        const conflicts = findConflicts(edits);
        if (conflicts.length > 0) {
          throw new Error(
            `The edits overlap one another: ${conflicts
              .map((c) => `${c.a.requestId} ↔ ${c.b.requestId}`)
              .join(", ")}. Remove one from each pair.`,
          );
        }

        let report: ApplyReport;
        try {
          report = await runWrite<ApplyReport>({
            handler: "apply_edits",
            params: {
              /* The document name was fixed during corrections_plan: a plan
               * built for a different document must not apply to the one
               * currently open. */
              expectedDocName: plan.docName,
              stamp: backupStamp(),
              undoName,
              edits: orderForApply(edits),
            },
            timeoutMs: APPLY_TIMEOUT_MS,
          });
        } catch (e) {
          /*
           * A2. runWrite throws "busy" in TWO different places, and only one
           * of them is the same write timeout that describeApplyTimeout()
           * describes:
           *  - assertNoLiveWrite (heartbeat.ts) throws "busy" BEFORE the
           *    osascript call, when the previous call is most likely still
           *    physically writing to the document. No timeout has just
           *    happened here — this call hasn't even touched InDesign — so
           *    the text of describeApplyTimeout() ("did not respond within N
           *    s during the WRITE") would be a lie. The assertNoLiveWrite
           *    message already names the handler, the document, and the
           *    reason not to retry — better than describeApplyTimeout would.
           *  - runJsx inside runWrite throws "busy" when osascript was
           *    genuinely killed on timeout — this is the scenario
           *    describeApplyTimeout() was written for.
           * The difference isn't visible via e.kind (both are "busy"), so we
           * look at a characteristic fragment of the heartbeat-check message.
           *
           * THE FRAGMENT IS IMPORTED, NOT RETYPED. Until 2026-08-26 this line
           * spelled out "a write is already in progress" — a string that exists
           * nowhere else in the repository, so `!includes(...)` was ALWAYS true
           * and both branches took the timeout path: exactly the mislabelling
           * the comment above says it prevents, telling the operator that a
           * backup copy exists for a call that never touched InDesign.
           */
          if (
            e instanceof IndesignError &&
            e.kind === "busy" &&
            !e.message.includes(LIVE_WRITE_MARKER)
          ) {
            throw describeApplyTimeout();
          }
          throw e;
        }

        const submittedIds = accept.map((a) => a.requestId);
        const startNumber = await readNextNumber(plan.docName);
        const { table, reconciliation } = buildReportTable(plan, report, submittedIds, startNumber);

        /*
         * runWrite above has already physically written the corrections into
         * the document — the most costly part for the operator. Just like
         * backupRotationError (backup rotation is cosmetic, not a safeguard),
         * persisting the running number counter is also cosmetic: losing the
         * numbering is annoying (the next batch will restart the count), but
         * throwing from here outward would mean losing the entire report of
         * the write ALREADY PERFORMED — table, diffs, applied warnings — even
         * though the book has already changed. So the error goes out as a
         * field in the response, not as an exception.
         */
        let numberingError: string | null = null;
        try {
          await saveNextNumber(plan.docName, table.nextNumber);
        } catch (e) {
          numberingError = e instanceof Error ? e.message : String(e);
        }

        return ok({
          ...attachAppliedWarnings(withDiffs(report), plan),
          table,
          tableMarkdown: renderMarkdown(table),
          reconciliation,
          numberingError,
        });
      } catch (e) {
        return fail(e);
      }
    },
  );
}

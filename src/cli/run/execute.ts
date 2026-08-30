import { callToolTraced, type ToolBox } from "../collect.js";
import type { Pass, SkippedFamily } from "./plan.js";
import type { EnvironmentStamp } from "./session.js";

export interface PassResult {
  id: string;
  tool: string;
  ok: boolean;
  elapsedMs: number;
  data: unknown;
  error: string | null;
  /**
   * The arguments the pass actually ran with — already past the tool's
   * schema, i.e. with defaults filled in. On a pass that failed — the
   * planned arguments (`Pass.args`): parsing may never have reached the
   * end, and inventing a parsed form here would mean recording a
   * measurement that never happened.
   */
  args: Record<string, unknown>;
  /**
   * Keys from `args` whose value came from the tool's schema, not the
   * config (ruling R28). The report prints them separately — spec §5.4
   * forbids a "default" that nobody can see. A pass that failed leaves the
   * list empty: no default was OBSERVED there, not "there were none".
   */
  defaulted: string[];
}

export interface Measurements {
  /**
   * Version of the artifact's shape. `measurements.json` is a separate
   * artifact, not an intermediate buffer (spec §4.2): two runs are compared
   * BY it, not by the finished HTML. So any change to its shape bumps this
   * number.
   *
   * 1 → 2 (R28): `PassResult` gained `args` (the pass's parsed arguments)
   * and `defaulted` (keys whose value came from the tool's schema). The
   * change was ADDITIVE — no field was removed — but a consumer who
   * believed `schemaVersion === 1` described a fixed shape would be
   * silently wrong.
   *
   * 2 → 3 (I5, ruling R42): `overset` appeared — the control number of
   * §10, which until then lived ONLY in the finished HTML, meaning there
   * was nothing to compare two runs by.
   */
  schemaVersion: 3;
  startedAt: string;
  stamp: EnvironmentStamp;
  skipped: SkippedFamily[];
  passes: PassResult[];
  /**
   * I5/R42: overset as computed by `overset()` in `src/cli/audit.ts` — the
   * ONE place it's computed. Optional because `executePasses` doesn't know
   * it: it's derived from the preflight response only AFTER all passes,
   * and inventing a value here would mean recording a measurement that
   * never happened.
   */
  overset?: string;
}

export interface ExecuteOpts {
  onProgress(line: string): void;
  /** Incremental write: a failure on the ninth pass doesn't destroy the other eight. */
  onPartial(m: Measurements): Promise<void>;
}

/**
 * Passes are SEQUENTIAL: the bridge controls a single global application,
 * and parallel calls would fight over the active document.
 *
 * A pass that fails doesn't stop the rest. A full run takes 10-20 minutes,
 * and throwing away nine successful passes because of a tenth is the most
 * expensive possible reaction to a failure.
 */
/**
 * The document name the pass reported ABOUT ITSELF.
 *
 * `null` means "this pass doesn't say", not "it matched": `status`
 * measures the application, not the document, and demanding a name from it
 * would be wrong. The difference between "didn't say" and "said something
 * else" here is the same as between a missing measurement and a regression
 * mismatch (R34/R42) — and the two must not be confused.
 */
export function reportedDocument(data: unknown): string | null {
  if (data === null || typeof data !== "object") return null;
  const v = (data as Record<string, unknown>)["docName"];
  return typeof v === "string" && v.length > 0 ? v : null;
}

export async function executePasses(
  box: ToolBox,
  passes: Pass[],
  stamp: EnvironmentStamp,
  skipped: SkippedFamily[],
  opts: ExecuteOpts,
): Promise<Measurements> {
  const m: Measurements = {
    schemaVersion: 3,
    startedAt: new Date().toISOString(),
    stamp,
    skipped,
    passes: [],
  };

  for (const p of passes) {
    const started = Date.now();
    opts.onProgress(`▶ ${p.id} (${p.tool})…`);
    try {
      /*
       * H1: `timeoutHintMs`, declared in the plan, now actually reaches the
       * call — before this it went nowhere, and the `extras` pass (a
       * synthetic bridge call with no tool of its own, and hence no limit
       * of its own) would time out at the bridge's `DEFAULT_TIMEOUT` of 30
       * seconds even though the plan declared 180. Entries for real tools
       * ignore this limit: each of them keeps its own limit next to its own
       * `runJsx` (see `collect.ts`, `ToolEntry`).
       */
      const trace = await callToolTraced<unknown>(box, p.tool, p.args, {
        timeoutMs: p.timeoutHintMs,
      });

      /*
       * DOCUMENT IDENTITY — ONE RULE FOR ALL PASSES, RIGHT HERE.
       *
       * Measured on a live run on 2026-08-17: a second document was opened
       * mid-run. `composition` has its own guard and refused; `extras` had
       * none of its own — and returned `ok: true` with numbers from the
       * OTHER book (format 175×250 instead of 190×220, bleed 0 instead of
       * 3mm, 5580 empty paragraphs instead of 416). No error occurred at
       * all: the numbers just weren't from the right place.
       *
       * So the check lives at the one point where EVERY pass gets recorded,
       * rather than as a ninth per-tool copy of the rule: a new pass gets
       * it for free the moment it starts naming its document. A pass that
       * doesn't report `docName` (`status` measures the application, not
       * the document) stays unchecked — there's nothing to silently
       * compare against.
       *
       * `throw` is deliberate: there's already a branch below that records
       * a pass as `ok: false` with a reason and does NOT stop the rest of
       * the run. A measurement from the wrong document is discarded
       * entirely — leaving it "with a note" would mean a number from the
       * other book still reaches the report.
       */
      const reportedName = reportedDocument(trace.data);
      if (reportedName !== null && reportedName !== stamp.docName) {
        throw new Error(
          `The pass measured document "${reportedName}", but the run is going over "${stamp.docName}". ` +
            "The active document changed mid-run; this pass's measurement was discarded, " +
            "because it belongs to a different layout.",
        );
      }

      m.passes.push({
        id: p.id, tool: p.tool, ok: true, elapsedMs: Date.now() - started,
        data: trace.data, error: null, args: trace.args, defaulted: trace.defaulted,
      });
      opts.onProgress(`✓ ${p.id} — ${Date.now() - started} ms`);
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      m.passes.push({
        id: p.id, tool: p.tool, ok: false, elapsedMs: Date.now() - started,
        data: null, error: text, args: p.args, defaulted: [],
      });
      opts.onProgress(`✗ ${p.id} — ${text}`);
    }
    await opts.onPartial(m);
  }

  return m;
}

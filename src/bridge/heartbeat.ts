import { mkdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { IndesignError } from "./errors.js";

/**
 * A2. A heartbeat against a measured trap: on a timeout, osascript is killed,
 * but the script INSIDE InDesign keeps running. A second call on top of a
 * live first one duplicates the edits, and no check before writing catches
 * this — by the time the second write happens, the text has already been
 * changed by the first.
 *
 * The writing handler touches the file while it works. Before a new write,
 * the MCP checks its freshness and refuses to write on top.
 */

/**
 * How long without a touch counts as a sign the handler is no longer alive.
 * The handler touches the file after every edit; on a 196-page book, a single
 * edit doesn't come anywhere near this threshold, not even within an order of
 * magnitude.
 */
export const HEARTBEAT_STALE_MS = 20_000;

export interface HeartbeatFile {
  startedAt: number;
  touchedAt: number;
  handler: string;
  docName: string;
  /**
   * Phase 3, W2, round 2. `"copy"` — the trace is written before
   * `doc.saveACopy` (`IDMCP.withHeartbeat`, `_core.jsx`) and never updated
   * again after that: inside this single synchronous ExtendScript call there
   * is nothing to touch the file with, and on a 196-page book on a
   * cloud-synced folder, the copy can take longer than HEARTBEAT_STALE_MS.
   * `"edits"` — the trace updates at the usual rhythm of the edit cycle (once
   * per edit/tracking pass), and the 20-second threshold stays valid. A
   * missing field (an old trace, or another write handler that doesn't set
   * the phase) reads as `"edits"` — i.e. conservatively, on a short bond: the
   * extension applies only where the phase is stated explicitly.
   */
  phase?: "copy" | "edits";
}

function stateDir(): string {
  return process.env.INDESIGN_MCP_HOME ?? join(homedir(), ".indesign-mcp");
}

export function heartbeatPath(): string {
  return join(stateDir(), "write.heartbeat.json");
}

/**
 * THE PHRASE THAT TELLS A REFUSED WRITE APART FROM A TIMED-OUT ONE.
 *
 * `runWrite` throws kind "busy" in two places that mean opposite things: here,
 * BEFORE InDesign is touched at all (the previous write is still live, nothing
 * has been changed and no copy has been made), and inside `runJsx` when
 * osascript was genuinely killed mid-write (the edits may have landed and a copy
 * DOES exist). `kind` cannot separate them, so `corrections_apply` looks at the
 * message — and it used to look for "a write is already in progress", a string
 * that appears NOWHERE in this file. The test was therefore always true, and
 * every refused write was relabelled as a timeout: the operator was told the
 * edits "may have been applied" and that a copy "was saved in _backups/", both
 * false for a call that never reached InDesign, while the real hint — the
 * running handler, the document, the elapsed time, and the path to delete —
 * was discarded.
 *
 * Exported as a constant so the thrower and the reader cannot drift apart
 * again; `tests/unit/heartbeat-marker.test.ts` pins that they still agree.
 */
export const LIVE_WRITE_MARKER = "is already running a write";

/**
 * A touch from the future is also treated as stale: otherwise a broken clock,
 * or a file left over from another machine, would lock out writes forever.
 * This threshold does NOT extend for the "copy" phase — a broken clock is
 * suspect regardless of phase, and extending trust in it would weaken the
 * safeguard exactly where the phase doesn't help verify anything.
 *
 * `copyPhaseStaleMs` — the threshold for the "copy" phase, set by the CALLER
 * (`assertNoLiveWrite`, from there `runWrite`): it's the very same
 * `APPLY_TIMEOUT_MS` the call is already waiting on, not a new number invented
 * here. If the caller passed something SMALLER than the usual threshold (a
 * caller bug or a default), `Math.max` guarantees the "copy" phase never
 * becomes STRICTER than a regular write — an extension, not a narrowing, is
 * what this field exists for.
 */
/**
 * By how many times the "copy" phase's threshold exceeds the timeout the
 * caller waits on.
 *
 * PHASE 3 DEBT, CLOSED 2026-08-05. Until then there was no multiplier, i.e.
 * the threshold equaled exactly `APPLY_TIMEOUT_MS` — the same timeout the
 * client waits on. That symmetry looked tidy and was wrong by construction:
 *
 *   1. the first call's client gives up after 180 s and returns control;
 *   2. the user naturally tries again;
 *   3. the first call's trace is now ≈ 180 s old — exactly at the threshold;
 *   4. if this document's `doc.saveACopy` takes longer (a large book on a
 *      cloud volume — exactly the case the "copy" phase was introduced for),
 *      the trace is judged stale, and the second write lands ON TOP of the
 *      live first one.
 *
 * In other words, the safeguard failed exactly in the situation it existed
 * for: the threshold fired at the same time as the most likely retry. The
 * multiplier breaks that coincidence — after the client gives up, the trace
 * stays valid for a good while longer.
 *
 * WHAT THE MULTIPLIER DOESN'T CLOSE, and this is stated rather than left
 * unsaid: a copy that takes longer than `APPLY_TIMEOUT_MS × COPY_PHASE_SLACK`
 * (180 s × 4 = 12 min by default) creates the same gap. Closing it fully by
 * time alone is impossible in principle — the trace carries no "process is
 * alive" signal, only age. The cost of the multiplier is that after a truly
 * dead script (an InDesign crash that prevented `finally` from firing), a
 * write stays blocked for up to 12 minutes; that's exactly why the
 * `assertNoLiveWrite` message names the trace's path and says outright that it
 * can be deleted.
 */
export const COPY_PHASE_SLACK = 4;

/** How long to wait before re-reading a trace that did not parse (see readHeartbeat). */
const RETRY_MS = 25;

export function isStale(
  hb: HeartbeatFile,
  now: number = Date.now(),
  copyPhaseStaleMs: number = HEARTBEAT_STALE_MS,
): boolean {
  const age = now - hb.touchedAt;
  if (age < 0) return -age > HEARTBEAT_STALE_MS;
  const bound =
    hb.phase === "copy"
      ? Math.max(HEARTBEAT_STALE_MS, copyPhaseStaleMs * COPY_PHASE_SLACK)
      : HEARTBEAT_STALE_MS;
  return age > bound;
}

/**
 * ENSURES THE DIRECTORY THE TRACE LIVES IN, AND THAT IS NOT HOUSEKEEPING.
 *
 * Nothing on the write path ever created `<stateDir>` — only the audit/plan
 * paths did, as a side effect of `mkdir`ing their own SUBdirectories. So on a
 * fresh install, or with `INDESIGN_MCP_HOME` pointed somewhere new, the first
 * tool to run could well be `typography_apply`, which reaches `runWrite`
 * without touching disk first.
 *
 * ExtendScript then fails SILENTLY: `File.open("w")` RETURNS FALSE when the
 * parent folder is missing — it does not throw — so `withHeartbeat`'s writer
 * skipped its body on every touch, `file.remove()` in `finally` no-opped, and
 * no trace was ever written. `assertNoLiveWrite` read ENOENT, returned `null`,
 * and let a second write start on top of a live first one: precisely the
 * duplicate-edit trap this whole module exists to prevent, disabled by a
 * missing directory and reporting nothing.
 */
export async function ensureHeartbeatDir(path: string = heartbeatPath()): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
}

export async function readHeartbeat(path: string): Promise<HeartbeatFile | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    /* Genuinely absent — and only THIS is "no write is in progress". */
    return null;
  }

  const shaped = parseHeartbeat(raw);
  if (shaped) return shaped;

  /*
   * THE FILE EXISTS BUT DOES NOT PARSE, AND THAT IS NOT THE SAME AS ABSENT.
   *
   * The JSX writer is not atomic: `File.open("w")` TRUNCATES immediately, then
   * writes, then closes. Between truncate and write the file on disk is zero
   * bytes. `apply_edits` touches the trace once per edit — hundreds of times on
   * a 196-page batch — so a second call landing inside one of those windows is
   * not exotic.
   *
   * Until 2026-08-26 this branch returned `null`, i.e. reported "no write in
   * progress" at the exact moment a write was most certainly in progress.
   *
   * One re-read settles the ordinary case: the window is microseconds wide, so
   * a trace caught mid-touch is whole again almost immediately, and we get the
   * real handler and document name back.
   */
  await new Promise((r) => setTimeout(r, RETRY_MS));
  try {
    const again = parseHeartbeat(await readFile(path, "utf8"));
    if (again) return again;
  } catch {
    /* Vanished between the two reads — the handler finished and cleaned up. */
    return null;
  }

  /*
   * Still unparseable. Fall back to the file's OWN mtime, which the truncate
   * itself updated: staleness can still be judged, so a genuinely abandoned
   * empty trace ages out normally instead of blocking writes forever, while a
   * fresh one correctly refuses. The names are unknown and say so rather than
   * being invented.
   */
  try {
    const { mtimeMs } = await stat(path);
    return {
      startedAt: mtimeMs,
      touchedAt: mtimeMs,
      handler: "(unreadable trace)",
      docName: "(unknown)",
      phase: "edits",
    };
  } catch {
    return null;
  }
}

/** The shape check, split out so both read attempts apply exactly the same one. */
function parseHeartbeat(raw: string): HeartbeatFile | null {
  try {
    const parsed = JSON.parse(raw) as Partial<HeartbeatFile>;
    if (typeof parsed.touchedAt !== "number" || typeof parsed.handler !== "string") return null;
    return {
      startedAt: parsed.startedAt ?? parsed.touchedAt,
      touchedAt: parsed.touchedAt,
      handler: parsed.handler,
      docName: parsed.docName ?? "?",
      /* Anything other than exactly "copy" reads as a "normal" trace — old traces
       * without this field at all, and unknown values alike, do NOT get the
       * extended threshold. */
      phase: parsed.phase === "copy" ? "copy" : "edits",
    };
  } catch {
    return null;
  }
}

/**
 * `copyPhaseStaleMs` — the threshold the CALLER supplies for the "copy"
 * phase (`runWrite` passes in the same `timeoutMs` it's already waiting on
 * for the JSX response — `APPLY_TIMEOUT_MS` on the tools' side). The default
 * is `HEARTBEAT_STALE_MS`, so without an explicit value the behavior is the
 * same as before the phase existed.
 */
export async function assertNoLiveWrite(
  path: string,
  now: number = Date.now(),
  copyPhaseStaleMs: number = HEARTBEAT_STALE_MS,
): Promise<void> {
  const hb = await readHeartbeat(path);
  if (!hb || isStale(hb, now, copyPhaseStaleMs)) return;

  const seconds = Math.round((now - hb.startedAt) / 1000);
  throw new IndesignError(
    "busy",
    `InDesign ${LIVE_WRITE_MARKER} "${hb.handler}" into document "${hb.docName}" ` +
      `(running for ${seconds} s). Not starting a new write: the previous call may have been cut off ` +
      "by a server-side timeout, but the script inside InDesign does not stop when that happens — " +
      "it keeps writing.",
    "A second write on top of a live first one would duplicate the edits. Wait for it to finish and " +
      "check the document by eye, " +
      `or delete ${path} if you're sure InDesign isn't doing anything anymore. ` +
      (hb.phase === "copy"
        ? "The trace says the call is currently making a COPY of the document — this is one synchronous " +
          "InDesign call, during which there's nothing to update the trace with, so the lock will last longer than " +
          "usual. On a large book in a cloud folder, the copy can take minutes."
        : ""),
  );
}

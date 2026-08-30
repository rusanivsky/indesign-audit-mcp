import { IndesignError } from "./errors.js";
import { assertNoLiveWrite, ensureHeartbeatDir, heartbeatPath } from "./heartbeat.js";
import { runJsx } from "./runner.js";

/**
 * A2. The single entry point for operations that WRITE to the document. It provides:
 *  - refusal to start a write on top of a live write (heartbeat);
 *  - passing the heartbeat path into the handler itself;
 *  - turning a fatalError from the report into an error that NAMES the backup path.
 *
 * Reads do not go through this envelope — they need none of this.
 */
export async function runWrite<T extends { backupPath?: string; fatalError?: string }>(args: {
  handler: string;
  params: Record<string, unknown>;
  timeoutMs: number;
}): Promise<T> {
  const path = heartbeatPath();
  /*
   * A2 / Phase 3, W2, round 2. `args.timeoutMs` is the same time this
   * call already waits for a JSX reply (every caller passes
   * `APPLY_TIMEOUT_MS` from `src/tools/corrections.ts` here). We pass it as the
   * staleness bound for the "copy" phase: a heartbeat written before `doc.saveACopy`
   * won't get a chance to refresh while the copy is in progress, and the copy can't
   * take longer than the very same timeout the call itself is bounded by — so we're not
   * inventing a new number here, just forwarding the one that already exists. There's no
   * circular import: heartbeat.ts doesn't know about corrections.ts at all, the value
   * arrives as a parameter from the caller, which already needs it anyway.
   */
  /*
   * The directory FIRST, and before the refusal check rather than after it.
   * ExtendScript's `File.open("w")` returns false — silently — when the parent
   * folder is missing, so without this the whole heartbeat mechanism degrades
   * into a no-op on a fresh install and every duplicate-write guard below it
   * becomes decorative. Cheap, idempotent, and it must not be conditional on
   * anything the check decides.
   */
  await ensureHeartbeatDir(path);

  await assertNoLiveWrite(path, undefined, args.timeoutMs);

  const result = await runJsx<T>(
    args.handler,
    { ...args.params, heartbeatPath: path },
    { timeoutMs: args.timeoutMs },
  );

  if (result.fatalError) {
    /*
     * ЗВІТ ЇДЕ РАЗОМ ІЗ ПОМИЛКОЮ, А НЕ ВИКИДАЄТЬСЯ.
     *
     * `apply.jsx` будує один спільний об'єкт саме для цього випадку: при
     * виключенні всередині `withUndo` він повертає його ж, із уже
     * накопиченими applied/skipped/failed. Доти все це гинуло тут, і на
     * пакеті з 40 правок, де падає 23-тя, оператор діставав одне речення
     * «якісь правки могли лягти» замість двадцяти двох відомих requestId.
     */
    throw new IndesignError(
      "jsx-error",
      `Write "${args.handler}" was cut off: ${result.fatalError}`,
      result.backupPath
        ? `A copy of the document before edits was saved: ${result.backupPath}. ` +
          "Some edits may have landed — the partial report is attached to this error " +
          "and names them; check the document by eye before running again."
        : "There is no document copy — the exception happened before it was created.",
      result,
    );
  }
  return result;
}

/**
 * A second dimension layered on top of `containers_read` (inspect.jsx): the
 * language of the text, not the text itself. Read via a separate bridge call at
 * the SAME offsets — so the seam between the two calls must be checked
 * explicitly, not silently trusted.
 */
import { runJsx } from "../bridge/runner.js";
import type { ContainerSnapshot } from "../corrections/types.js";
import type { ContainerLanguage } from "./types.js";

export async function readLanguageRuns(): Promise<ContainerLanguage[]> {
  const r = await runJsx<{ docName: string; containers: ContainerLanguage[] }>(
    "language_runs_read",
    {},
  );
  assertNoLanguageReadErrors(r.containers);
  return r.containers;
}

/**
 * The sentinel string for a read failure on `appliedLanguage` in spelling.jsx —
 * NOT the same as the legitimate `"[No Language]"` (that's what InDesign calls a
 * run whose language was deliberately left unassigned). Task 7 review: if the
 * catch returns the same string as the normal "no language set" case, a
 * property-read failure (a bug, a stale object reference, an unusual InDesign
 * state) becomes indistinguishable from ordinary data — and downstream
 * `language-none` would show the user a fabricated layout defect that never
 * existed.
 */
export const LANGUAGE_READ_ERROR = "[Language read error]";

/**
 * Throws loudly the moment the error sentinel string turns up among the runs.
 * On the real book (2336 runs) it never fired ONCE — so a loud failure costs
 * nothing today, and instead guarantees that the first REAL occurrence will be
 * noticed rather than silently counted as a defect.
 */
export function assertNoLanguageReadErrors(langs: ContainerLanguage[]): void {
  for (const c of langs) {
    c.runs.forEach((run, i) => {
      if (run.language === LANGUAGE_READ_ERROR) {
        throw new Error(
          `Internal inconsistency: failed to read appliedLanguage for ` +
            `container "${c.containerId}", range #${i} (characters ${run.start}–${run.end}). ` +
            `This is NOT "no language set" — a property read failed; nothing was changed.`,
        );
      }
    });
  }
}

/**
 * The seam between TWO bridge calls. Precedent — assertNoBreakAnswersMatch
 * (src/tools/bibliography.ts:94): there, a shorter answer array SILENTLY meant
 * "not protected" and produced thousands of false findings with no visible
 * cause. Here it's the same: a container with no language runs would silently
 * mean "language unknown" for its entire text.
 *
 * Review (Finding 2): comparing only the SUM of run lengths misses a gap and an
 * overlap that cancel each other out in the sum — and the cursor offset after
 * such a pair would shift every later offset in the container. So instead we
 * check CONTIGUITY: the first run must start at 0, and each subsequent one
 * must start exactly where the previous one ended.
 */
export function assertLanguageCoverage(
  containers: ContainerSnapshot[],
  langs: ContainerLanguage[],
): void {
  const byId = new Map(langs.map((l) => [l.containerId, l]));
  for (const c of containers) {
    if (c.text.length === 0) continue;
    const l = byId.get(c.containerId);
    if (!l) {
      throw new Error(
        `Internal inconsistency: language_runs_read returned no ranges for ` +
          `container "${c.containerId}" (${c.text.length} characters). ` +
          `The language of this text cannot be verified; nothing was changed.`,
      );
    }

    let cursor = 0;
    for (const r of l.runs) {
      if (r.start !== cursor) {
        throw new Error(
          `Internal inconsistency: language ranges of container "${c.containerId}" are not contiguous — ` +
            `range [${r.start}, ${r.end}) should have started at ${cursor}. The offsets of the two ` +
            `bridge calls diverged; the report would be shifted.`,
        );
      }
      cursor = r.end;
    }

    if (cursor !== c.text.length) {
      throw new Error(
        `Internal inconsistency: language ranges of container "${c.containerId}" ` +
          `cover ${cursor} characters out of ${c.text.length}. The offsets of the two ` +
          `bridge calls diverged; the report would be shifted.`,
      );
    }
  }
}

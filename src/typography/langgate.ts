/**
 * Language gate for typography rules. The source of the runs is
 * `readLanguageRuns()` (`src/spelling/langruns.ts`, Phase 9): it reads
 * `appliedLanguage` at the SAME offsets as `containers_read`, and covers
 * stories, footnotes, and table cells with the same `containerId`.
 *
 * The seam between the two bridge calls is checked by
 * `assertLanguageCoverage()` — already written and already tested; we don't
 * duplicate it here.
 */
import type { ContainerLanguage, LanguageRun } from "../spelling/types.js";

/**
 * InDesign's English name for the Ukrainian language. On a LOCALIZED build
 * this string won't match anything, and the whole family silently returns
 * zeros — the same class of limitation already named in Phase 5 for `usage`.
 * That's exactly why the tool's response carries `ukrainianRuns`: a zero must
 * read as a zero.
 */
export const UK_LANGUAGE = "Ukrainian";

/**
 * Each container's runs, MERGED by language.
 *
 * `language_runs_read` (src/jsx/spelling.jsx) builds runs from
 * `textStyleRanges`, and those break on ANY formatting change — including a
 * bold word in the middle of a Ukrainian sentence. Without merging, the
 * "fully inside a run" gate would reject matches that crossed a STYLE
 * boundary rather than a language one, and a word split by that same
 * boundary would count as two halves, neither of which is a full match.
 */
export function mergedRuns(langs: ContainerLanguage[]): Map<string, LanguageRun[]> {
  const out = new Map<string, LanguageRun[]>();
  for (const c of langs) {
    const merged: LanguageRun[] = [];
    for (const r of c.runs) {
      const last = merged.at(-1);
      if (last !== undefined && last.language === r.language && last.end === r.start) {
        last.end = r.end;
        continue;
      }
      merged.push({ start: r.start, end: r.end, language: r.language });
    }
    out.set(c.containerId, merged);
  }
  return out;
}

/**
 * Whether `[start, end)` lies ENTIRELY inside a single run of this language.
 * A match that crosses a language boundary is false: half the replacement
 * would land in a different language. A container with no runs (`undefined`)
 * is also false: "unknown" here means "don't touch", not "allowed".
 */
export function fullyInLanguage(
  runs: LanguageRun[] | undefined,
  start: number,
  end: number,
  language: string,
): boolean {
  if (runs === undefined) return false;
  for (const r of runs) {
    if (r.language !== language) continue;
    if (start >= r.start && end <= r.end) return true;
  }
  return false;
}

/** How many MERGED runs of this language are in the given containers. */
export function countLanguageRuns(langs: ContainerLanguage[], language: string): number {
  let n = 0;
  for (const list of mergedRuns(langs).values()) {
    for (const r of list) if (r.language === language) n++;
  }
  return n;
}

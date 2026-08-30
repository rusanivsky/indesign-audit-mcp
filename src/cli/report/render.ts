// src/cli/report/render.ts
import { DEFAULT_LANG, type Bi } from "./i18n.js";

/**
 * Escaping is MANDATORY: style names and quotations from the layout go into the
 * report. A 150 pt quotation mark, or a style containing `<`, must not break the
 * tracker, which is already debugged.
 *
 * The ampersand goes FIRST — otherwise what is already escaped gets escaped twice.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Unique by construction: family plus its ordinal within the family. */
export function dataKey(family: string, n: number): string {
  return `${family}-${n}`;
}

/**
 * Both languages on one element, plus the default one as visible text.
 *
 * The visible text is NOT left for the script to fill in. A report opened with
 * JavaScript disabled — or saved to PDF by a print shop that never runs it —
 * must still read as a finished document rather than as empty cells.
 */
export function biCell(b: Bi): string {
  return `data-uk="${escapeHtml(b.uk)}" data-en="${escapeHtml(b.en)}">${escapeHtml(b[DEFAULT_LANG])}`;
}

/**
 * A bilingual run of text for a slot that the template fills with a token.
 *
 * The visible side is the default language, so a report opened without
 * JavaScript still reads as a finished document; the other language rides
 * along in the attribute and the button swaps them.
 */
export function biSpan(b: Bi): string {
  return `<span ${biCell(b)}</span>`;
}

export interface ReportRow {
  pages: string[];
  what: Bi;
  evidence: Bi;
  fix: Bi;
}

/**
 * R14 (coordinator's ruling): the “state code” in report.html packs the
 * checkboxes POSITIONALLY — by DOM order (querySelectorAll), not by data-k. So
 * the row order must be STABLE for the same input data: row i+1 of the `rows`
 * array always yields `dataKey(family, i + 1)`, because we walk `rows` with
 * `.map` — that is ARRAY order, given EXPLICITLY by the caller, not the
 * iteration order of a Set/Map/object's keys (none of which is used here). The
 * caller (Task 12) that assembles `rows` is responsible for its own stability;
 * here it is guaranteed by the absence of unpredictable sources of order.
 */
export function renderRows(family: string, rows: ReportRow[]): string {
  return rows
    .map((r, i) => {
      const pages = r.pages
        .map((p) => `<span class="pg">${escapeHtml(p)}</span>`)
        .join(" ");
      return (
        `<tr>` +
        `<td class="chk"><input type="checkbox" data-k="${escapeHtml(dataKey(family, i + 1))}"></td>` +
        `<td class="pages">${pages}</td>` +
        `<td class="what"><strong ${biCell(r.what)}</strong><span ${biCell(r.evidence)}</span></td>` +
        `<td class="fix" ${biCell(r.fix)}</td>` +
        `</tr>`
      );
    })
    .join("\n");
}

import type { DisputedItem } from "./disputed.js";

/**
 * K5. Corrections table with running numbering tied to the InDesign page.
 *
 * The format that used to be assembled by one-off Node scripts becomes the standard output.
 * The main rule: numbering is SHARED between applied and disputed items and does not reset
 * between batches — the user refers to "#234" in later comments.
 */

export interface AppliedRow {
  requestId: string;
  /** InDesign page, not PDF. */
  page: string;
  before: string;
  after: string;
  note?: string;
}

export interface AlreadyAppliedRow {
  requestId: string;
  page: string | null;
  /** Text already present in the document. */
  text: string;
  note?: string;
}

export interface TableEntry {
  number: number;
  requestId: string;
  page: string | null;
  kind: "applied" | "disputed" | "already-applied";
  before: string;
  after: string;
  note?: string;
  reason?: string;
  explanation?: string;
}

export interface CorrectionsTable {
  entries: TableEntry[];
  /** The number the next batch will start from. */
  nextNumber: number;
  counts: { applied: number; disputed: number; alreadyApplied: number };
  /**
   * Plan items the operator did not submit in this batch. They are not disputed —
   * they simply aren't in the batch. Calling them disputed would devalue that bucket.
   */
  notSubmitted: string[];
}

export function buildTable(args: {
  startNumber: number;
  /** Request identifiers in the SAME order the user submitted them. */
  order: string[];
  applied: AppliedRow[];
  disputed: DisputedItem[];
  alreadyApplied?: AlreadyAppliedRow[];
  /**
   * Plan items the operator did not submit in this batch. Optional —
   * older calls (before K5+) don't pass it.
   */
  notSubmitted?: string[];
}): CorrectionsTable {
  const alreadyApplied = args.alreadyApplied ?? [];
  const notSubmitted = args.notSubmitted ?? [];
  const byApplied = new Map(args.applied.map((a) => [a.requestId, a]));
  const byDisputed = new Map(args.disputed.map((d) => [d.requestId, d]));
  const byAlreadyApplied = new Map(alreadyApplied.map((aa) => [aa.requestId, aa]));

  const entries: TableEntry[] = [];
  let n = args.startNumber;

  for (const id of args.order) {
    const a = byApplied.get(id);
    if (a) {
      entries.push({
        number: n++,
        requestId: id,
        page: a.page,
        kind: "applied",
        before: a.before,
        after: a.after,
        ...(a.note === undefined ? {} : { note: a.note }),
      });
      continue;
    }
    const d = byDisputed.get(id);
    if (d) {
      entries.push({
        number: n++,
        requestId: id,
        page: d.page,
        kind: "disputed",
        before: d.markedText ?? "",
        after: "",
        ...(d.note === undefined ? {} : { note: d.note }),
        reason: d.reason,
        explanation: d.explanation,
      });
      continue;
    }
    const aa = byAlreadyApplied.get(id);
    if (aa) {
      entries.push({
        number: n++,
        requestId: id,
        page: aa.page,
        kind: "already-applied",
        before: aa.text,
        after: aa.text,
        ...(aa.note === undefined ? {} : { note: aa.note }),
      });
      continue;
    }
    /* A request that ended up in none of the lists is a silent lost correction,
     * the most expensive pipeline bug. Throw, don't skip. */
    throw new Error(
      `Request "${id}" ended up in none of applied, disputed, or already-applied. ` +
        "Every request must end up in exactly one list.",
    );
  }

  return {
    entries,
    nextNumber: n,
    counts: {
      applied: entries.filter((e) => e.kind === "applied").length,
      disputed: entries.filter((e) => e.kind === "disputed").length,
      alreadyApplied: entries.filter((e) => e.kind === "already-applied").length,
    },
    notSubmitted,
  };
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

export function renderMarkdown(table: CorrectionsTable): string {
  const lines: string[] = [];
  const applied = table.entries.filter((e) => e.kind === "applied");
  const disputed = table.entries.filter((e) => e.kind === "disputed");

  lines.push("### Applied fixes", "");
  lines.push("| No. | Page | Before | After |");
  lines.push("|---|---|---|---|");
  for (const e of applied) {
    lines.push(`| ${e.number} | ${e.page ?? "?"} | ${escapeCell(e.before)} | ${escapeCell(e.after)} |`);
  }

  if (disputed.length > 0) {
    lines.push("", "### Needs attention", "");
    lines.push("| No. | Page | Fragment | Why not applied |");
    lines.push("|---|---|---|---|");
    for (const e of disputed) {
      lines.push(
        `| ${e.number} | ${e.page ?? "?"} | ${escapeCell(e.before)} | ${escapeCell(e.explanation ?? "")} |`,
      );
    }
  }

  const already = table.entries.filter((e) => e.kind === "already-applied");
  if (already.length > 0) {
    lines.push("", "### Already in the document", "");
    lines.push("| No. | Page | Text |");
    lines.push("|---|---|---|");
    for (const e of already) {
      lines.push(`| ${e.number} | ${e.page ?? "?"} | ${escapeCell(e.before)} |`);
    }
  }
  if (table.notSubmitted.length > 0) {
    lines.push("", `Not submitted in this batch: ${table.notSubmitted.join(", ")}.`);
  }

  lines.push("", `Next number: ${table.nextNumber}.`);
  return lines.join("\n");
}

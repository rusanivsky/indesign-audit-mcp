/**
 * The bucket of disputed corrections (K3). The phase's rule: no request may
 * vanish silently. It's either applied, or it sits here with a recorded
 * reason.
 */

export type DisputeReason =
  /** The composite anchor found more than one place — writing blindly isn't safe. */
  | "ambiguous-anchor"
  /** Several edits compete for the same range of text. */
  | "competing-edits"
  /** The note proposes several variants, and there's not enough context to choose. */
  | "unresolved-variants"
  /** The annotation arrived with no marked text and no context. */
  | "empty-context"
  /** The edit is technically applicable but wrong in meaning. */
  | "editor-mistake"
  /** There's no place for the edit in the document. */
  | "not-found"
  /** The anchor text changed between building the plan and writing it. */
  | "text-changed"
  /** The write threw an exception: a locked layer, story, or master page. */
  | "write-failed";

const TEXTS: Record<DisputeReason, string> = {
  "ambiguous-anchor":
    "The edit's location isn't unambiguous: the word together with its neighbors occurs more than once. Mark the location more specifically.",
  "competing-edits": "Several edits compete for the same sentence — a decision is needed on which to keep.",
  "unresolved-variants":
    "The editor proposed several variants, and the paragraph's context gives no grounds to choose one. Pick one variant by hand.",
  "empty-context": "The annotation carries neither marked text nor context — there is nothing to search for. Add detail to the note or drop the item.",
  "editor-mistake":
    "The edit was deliberately not applied: the editor made a mistake, and the proposed replacement would break the text. The item is closed; no need to revisit.",
  "not-found": "The text to be replaced is not in the document. Find the location by hand or refine the wording.",
  "text-changed":
    "The text at this location changed after the plan was built, so nothing was written: what was supposed to be replaced no longer matches. Rebuild the plan via corrections_plan.",
  "write-failed":
    "The write at this location threw an exception — most likely a locked layer, a locked story, or a frame on a locked master page. Remove the lock in InDesign and retry.",
};

export function explain(reason: DisputeReason, detail?: string): string {
  const base = TEXTS[reason];
  return detail ? `${base} ${detail}` : base;
}

export interface DisputedItem {
  /** A running number, shared with the table of applied corrections (K5). */
  number: number;
  requestId: string;
  /** The InDesign page, not the PDF one. null if no location was found. */
  page: string | null;
  reason: DisputeReason;
  explanation: string;
  /** The editor's original note, if there was one. */
  note?: string;
  /** The text the editor marked, if any. */
  markedText?: string;
}

export interface Reconciliation {
  balanced: boolean;
  /** Requests that ended up in neither the applied nor the disputed list. */
  missing: string[];
  /** Requests that ended up in both lists, or that occur more than once in one list. */
  duplicated: string[];
  /** Ids from the result lists that aren't among the input requests. */
  unknown: string[];
}

/**
 * Balance reconciliation: every input request must be found exactly once,
 * summed across both result lists. This is a safeguard against a correction
 * silently getting lost — the pipeline's costliest mistake, because it's
 * invisible in both the report and the document.
 */
export function reconcile(args: {
  requestIds: string[];
  appliedIds: string[];
  disputedIds: string[];
}): Reconciliation {
  const requestIdSet = new Set(args.requestIds);
  const missing: string[] = [];
  const duplicated: string[] = [];
  const unknown: string[] = [];

  // Count each id's occurrences across both lists
  const counts = new Map<string, number>();
  for (const id of args.appliedIds) {
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  for (const id of args.disputedIds) {
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  // Check every input request
  for (const id of args.requestIds) {
    const count = counts.get(id) ?? 0;
    if (count === 0) missing.push(id);
    else if (count > 1) duplicated.push(id);
  }

  // Look for unknown ids — present in the results but not in the requests
  for (const id of counts.keys()) {
    if (!requestIdSet.has(id)) unknown.push(id);
  }

  return {
    balanced: missing.length === 0 && duplicated.length === 0 && unknown.length === 0,
    missing,
    duplicated,
    unknown,
  };
}

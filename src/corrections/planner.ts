import { findOccurrences, findOccurrencesWithTrim, findClosest } from "./matcher.js";
import { isMatchWhitespace } from "./normalize.js";
import { buildWordAnchor, findAnchorRanges, needsAnchor, type WordAnchor } from "./anchor.js";
import { normalizeAtSeam } from "../typography/seam.js";
import type {
  AcceptedEdit,
  AppliedPlace,
  Candidate,
  ContainerSnapshot,
  CorrectionRequest,
  Plan,
  PlanItem,
  Warning,
} from "./types.js";

const CONTEXT = 40;

/**
 * How many candidates per request make it into the plan (I3).
 *
 * Measured on the user's working layout (196 pages, 549 containers,
 * read-only): `ranges_inspect` costs ≈250 ms fixed + ≈4.6 ms per range
 * (10 → 425 ms, 50 → 637 ms, 200 → 1342 ms, 500 → 2662 ms). Each candidate is
 * one range, so without a cap a short `old` produces thousands of ranges, an
 * overall 30 s timeout, and a plan a human wouldn't review anyway.
 *
 * 50 is the ceiling of usefulness for a human: a list to PICK one
 * candidateId from is never longer than that; more than 50 matches means the
 * request needs narrowing, not scrolling through. The full found count isn't
 * hidden — it goes into `candidatesTruncated.total`.
 */
export const MAX_CANDIDATES_PER_REQUEST = 50;

function pageAt(snapshot: ContainerSnapshot, index: number): string {
  for (const run of snapshot.pageRuns) {
    if (index >= run.start && index < run.end) return run.page;
  }
  return snapshot.pageRuns.at(-1)?.page ?? "?";
}

/**
 * A match's range is [start, end), so its last character has index end - 1.
 * Characters with index >= oversetFrom are invisible, so a match touches
 * overset if and only if end - 1 >= oversetFrom, i.e. end > oversetFrom.
 * Checking start alone (as before) missed a match that starts in visible
 * text and ends past the boundary — and writing exactly that match would
 * partially land in invisible text.
 */
function warningsFor(snapshot: ContainerSnapshot, end: number): Warning[] {
  const w: Warning[] = [];
  if (snapshot.oversetFrom !== null && end > snapshot.oversetFrom) w.push("in-overset");
  if (snapshot.isMaster) w.push("on-master-page");
  if (snapshot.kind === "footnote") w.push("in-footnote");
  if (snapshot.kind === "table") w.push("in-table-cell");
  return w;
}

/**
 * T-trim (the brief, requirement 4 — precision). Two separate warnings, see
 * the comment on Warning in types.ts:
 *  - clamped-to-paragraph: fires from the mere fact of trimming
 *    (headTrimmed or tailTrimmed), regardless of what's written.
 *  - possible-stray-space: fires only when the trimmed edge BORDERS a
 *    whitespace edge of what will ACTUALLY land in the document at this
 *    spot — writtenText. For delete, writtenText is always "" (see
 *    toAcceptedEdits, tools/corrections.ts), so a stray space can't
 *    originate from there, even if the request's `new` field has something
 *    written in it.
 */
function paragraphClampWarnings(
  headTrimmed: boolean,
  tailTrimmed: boolean,
  writtenText: string,
): Warning[] {
  if (!headTrimmed && !tailTrimmed) return [];
  const w: Warning[] = ["clamped-to-paragraph"];
  const startsWithSpace = writtenText.length > 0 && isMatchWhitespace(writtenText.charCodeAt(0));
  const endsWithSpace =
    writtenText.length > 0 && isMatchWhitespace(writtenText.charCodeAt(writtenText.length - 1));
  if ((headTrimmed && startsWithSpace) || (tailTrimmed && endsWithSpace)) {
    w.push("possible-stray-space");
  }
  return w;
}

function collectCandidates(
  requestId: string,
  needle: string,
  writtenText: string,
  containers: ContainerSnapshot[],
): Candidate[] {
  const out: Candidate[] = [];
  for (const snapshot of containers) {
    for (const m of findOccurrencesWithTrim(snapshot.text, needle)) {
      const seam = normalizeAtSeam({
        contextBefore: snapshot.text.slice(Math.max(0, m.start - CONTEXT), m.start),
        newText: writtenText,
        contextAfter: snapshot.text.slice(m.end, m.end + CONTEXT),
      });
      out.push({
        candidateId: `${requestId}#${out.length}`,
        containerId: snapshot.containerId,
        start: m.start,
        end: m.end,
        page: pageAt(snapshot, m.start),
        contextBefore: snapshot.text.slice(Math.max(0, m.start - CONTEXT), m.start),
        matchText: snapshot.text.slice(m.start, m.end),
        contextAfter: snapshot.text.slice(m.end, m.end + CONTEXT),
        warnings: [
          ...warningsFor(snapshot, m.end),
          ...paragraphClampWarnings(m.headTrimmed, m.tailTrimmed, writtenText),
        ],
        writeText: seam.writeText,
        normalizations: seam.normalizations,
      });
    }
  }
  return out;
}

/**
 * K1. For short `old` values (one or two letters), a text search produces
 * thousands of matches. If the request carries context from the PDF, build
 * a composite anchor and search with that instead.
 */
function collectByAnchor(
  request: CorrectionRequest,
  writtenText: string,
  containers: ContainerSnapshot[],
): Candidate[] | null {
  if (!needsAnchor(request.old)) return null;
  if (request.contextBefore === undefined && request.contextAfter === undefined) return null;

  const anchor: WordAnchor | null = buildWordAnchor({
    markedText: request.old,
    contextBefore: request.contextBefore ?? "",
    contextAfter: request.contextAfter ?? "",
  });
  if (!anchor) return null;

  const out: Candidate[] = [];
  for (const snapshot of containers) {
    for (const r of findAnchorRanges(snapshot.text, anchor)) {
      const seam = normalizeAtSeam({
        contextBefore: snapshot.text.slice(Math.max(0, r.start - CONTEXT), r.start),
        newText: writtenText,
        contextAfter: snapshot.text.slice(r.end, r.end + CONTEXT),
      });
      out.push({
        candidateId: `${request.id}#${out.length}`,
        containerId: snapshot.containerId,
        start: r.start,
        end: r.end,
        page: pageAt(snapshot, r.start),
        contextBefore: snapshot.text.slice(Math.max(0, r.start - CONTEXT), r.start),
        matchText: snapshot.text.slice(r.start, r.end),
        contextAfter: snapshot.text.slice(r.end, r.end + CONTEXT),
        warnings: warningsFor(snapshot, r.end),
        writeText: seam.writeText,
        normalizations: seam.normalizations,
      });
    }
  }
  return out;
}

/**
 * Spec §4.2: `already_applied` means "`new` is already sitting AT THE
 * correction's location." After the correction is applied, its location can
 * no longer be found via `old` (it's not there anymore), and the request
 * carries no context of its own, so the only thing that can identify the
 * "location" here is `new` itself: the location exists if and only if `new`
 * occurs in the document EXACTLY ONCE. Multiple occurrences mean pointing at
 * "the same" location is impossible — and this is exactly where the old
 * global search used to break: across 547 stories, any short `new` ("і",
 * "та", "не") was bound to be found somewhere, the rule fired falsely, and
 * the correction silently went unapplied. `not_found` with hints is the
 * loud, safe side.
 *
 * pageHint is deliberately NOT used for narrowing: spec §4.2 explicitly
 * forbids narrowing the search with it, so that a numbering offset doesn't
 * produce false statuses.
 */
function appliedPlace(containers: ContainerSnapshot[], newText: string): AppliedPlace | undefined {
  let found: AppliedPlace | undefined;
  for (const snapshot of containers) {
    for (const m of findOccurrences(snapshot.text, newText)) {
      if (found) return undefined;
      found = {
        containerId: snapshot.containerId,
        start: m.start,
        end: m.end,
        page: pageAt(snapshot, m.start),
        contextBefore: snapshot.text.slice(Math.max(0, m.start - CONTEXT), m.start),
        matchText: snapshot.text.slice(m.start, m.end),
        contextAfter: snapshot.text.slice(m.end, m.end + CONTEXT),
      };
    }
  }
  return found;
}

/** Closer to pageHint sorts higher. Without pageHint, document order is preserved. */
function rankByPageHint(candidates: Candidate[], pageHint?: number): Candidate[] {
  if (pageHint === undefined) return candidates;
  return [...candidates].sort((a, b) => {
    const da = Math.abs(Number(a.page) - pageHint);
    const db = Math.abs(Number(b.page) - pageHint);
    const sa = Number.isNaN(da) ? Number.MAX_SAFE_INTEGER : da;
    const sb = Number.isNaN(db) ? Number.MAX_SAFE_INTEGER : db;
    return sa - sb;
  });
}

function buildItem(
  request: CorrectionRequest,
  containers: ContainerSnapshot[],
  pageOffset: number,
): PlanItem {
  // The PDF page number is shifted to layout numbering only for ranking purposes;
  // the search still runs over the whole document.
  const hint = request.pageHint === undefined ? undefined : request.pageHint + pageOffset;
  // T-trim: what will ACTUALLY land in the document at the correction's spot — as in toAcceptedEdits.
  const writtenText = request.action === "delete" ? "" : request.new;
  // K1: for a short old (one or two letters) with context from the PDF, search with a composite
  // anchor. null means "this path doesn't apply" — then we fall back to the regular path;
  // an empty array means "the path applies, but nothing was found" — and this
  // stays an empty array rather than being replaced by the regular search (`??`
  // substitutes collectCandidates only for null/undefined, not for []).
  const byAnchor = collectByAnchor(request, writtenText, containers);
  const collected = byAnchor ?? collectCandidates(request.id, request.old, writtenText, containers);
  const ranked = rankByPageHint(collected, hint);
  // Truncate AFTER ranking — the plan keeps the candidates closest to
  // the page the corrector named, not the first ones in document order.
  const candidates = ranked.slice(0, MAX_CANDIDATES_PER_REQUEST);
  const truncated =
    ranked.length > candidates.length
      ? { shown: candidates.length, total: ranked.length }
      : undefined;

  if (candidates.length === 1) {
    return { id: request.id, status: "unique", request, candidates, suggestions: [] };
  }
  if (candidates.length > 1) {
    return {
      id: request.id,
      status: "ambiguous",
      request,
      candidates,
      suggestions: [],
      ...(truncated ? { candidatesTruncated: truncated } : {}),
    };
  }

  // No matches. If the new text is already sitting AT the correction's location — it's already been applied.
  if (request.new.length > 0) {
    /*
     * B4. `new` is no longer written verbatim, so the document holds its
     * NORMALIZED form. Comparing against the raw `new` alone would give
     * not_found, and re-running the plan would duplicate the correction.
     *
     * KNOWN LIMITATION (deliberately accepted, Task 13 review, round 2):
     * this call passes contextBefore/contextAfter as "" — at this step there
     * is no real location in the document yet (that's exactly what's being
     * searched for), so there's nowhere to pull the real seam context from.
     * For rules sensitive to context (chiefly matchQuotes in rules-uk.ts —
     * quote-nesting depth is counted from the start of the line, on the
     * assumption "we're at the top nesting level"), this assumption may not
     * match what's actually around this location in the document: the quote
     * character normalization picks here may differ from what the same call
     * would give with the real context during
     * collectCandidates/collectByAnchor. This is NOT a threat to integrity:
     * if `normalized` fails to find the location because of this, the code
     * below falls back to the raw `appliedPlace(containers, request.new)`,
     * and if that fails too — to the ordinary not_found branch with hints
     * (the same "loud and safe" safeguard as elsewhere in this file). The
     * worst outcome is that a correction with quotes that has genuinely
     * already been applied is occasionally reported as not_found instead of
     * already_applied, and a human checks manually; this cannot produce a
     * silent duplicate entry. A full fix would require either threading the
     * real seam context through the entire already_applied search
     * (inverting the order "find the location first, then compute the seam"
     * into "compute the seam for every location candidate"), or speculative
     * context reconstruction — both are out of scope for this task.
     */
    const normalized = normalizeAtSeam({
      contextBefore: "",
      newText: request.new,
      contextAfter: "",
    }).writeText;

    const place =
      appliedPlace(containers, normalized) ??
      (normalized === request.new ? undefined : appliedPlace(containers, request.new));
    if (place) {
      return {
        id: request.id,
        status: "already_applied",
        request,
        candidates: [],
        suggestions: [],
        appliedAt: place,
      };
    }
  }

  const suggestions = containers.flatMap((c) => findClosest(c.text, request.old));
  suggestions.sort((a, b) => b.score - a.score);
  return {
    id: request.id,
    status: "not_found",
    request,
    candidates: [],
    suggestions: suggestions.slice(0, 3),
  };
}

export function buildPlan(args: {
  planId: string;
  docName: string;
  requests: CorrectionRequest[];
  containers: ContainerSnapshot[];
  /** How far the layout's numbering leads the PDF's numbering. Defaults to 0. */
  pageOffset?: number;
}): Plan {
  const pageOffset = args.pageOffset ?? 0;
  return {
    planId: args.planId,
    createdAt: new Date().toISOString(),
    docName: args.docName,
    items: args.requests.map((r) => buildItem(r, args.containers, pageOffset)),
  };
}

/**
 * Corrections are applied in descending offset order within a container, so
 * earlier positions don't shift after each replacement.
 */
export function orderForApply(edits: AcceptedEdit[]): AcceptedEdit[] {
  const byContainer = new Map<string, AcceptedEdit[]>();
  for (const e of edits) {
    const list = byContainer.get(e.containerId) ?? [];
    list.push(e);
    byContainer.set(e.containerId, list);
  }
  const out: AcceptedEdit[] = [];
  for (const list of byContainer.values()) {
    out.push(...list.sort((a, b) => b.start - a.start));
  }
  return out;
}

export function findConflicts(edits: AcceptedEdit[]): { a: AcceptedEdit; b: AcceptedEdit }[] {
  const conflicts: { a: AcceptedEdit; b: AcceptedEdit }[] = [];
  for (let i = 0; i < edits.length; i++) {
    for (let j = i + 1; j < edits.length; j++) {
      const a = edits[i]!;
      const b = edits[j]!;
      if (a.containerId !== b.containerId) continue;
      if (a.start < b.end && b.start < a.end) conflicts.push({ a, b });
    }
  }
  return conflicts;
}

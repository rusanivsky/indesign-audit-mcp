import { z } from "zod";
import { runWrite } from "../bridge/envelope.js";
import { IndesignError } from "../bridge/errors.js";
import { runJsx } from "../bridge/runner.js";
import {
  assertDisjointLevels,
  detectContents,
  flattenFrames,
  pairByBaseline,
  type LevelMapping,
} from "../pagination/contents.js";
import { detectFolio } from "../pagination/folio.js";
import { chapterSpans, detectHeads } from "../pagination/heads.js";
import { detectHelperChain } from "../pagination/helper-chain.js";
import {
  documentThreadLinks,
  helperChainWins,
  HELPER_LAYER_NAME,
} from "../pagination/topology.js";
import { detectMasterIslands } from "../pagination/master-island.js";
import { buildReport, MAX_GROUP_PAGES, type FamilyName } from "../pagination/report.js";
import type {
  FolioRange,
  FrameVerdict,
  MarkerDirection,
  RewritePlan,
  SkipReason,
} from "../pagination/rewrite-types.js";
import { planRewrite, type RouteRequest } from "../pagination/rewrite.js";
import { loadRewritePlan, newRewritePlanId, saveRewritePlan } from "../pagination/store.js";
import type {
  ClaimFrame,
  FamilyResult,
  PageRef,
  PaginationMeasure,
} from "../pagination/types.js";
import { APPLY_TIMEOUT_MS, backupStamp } from "./corrections.js";
import { assertExpectedDoc, fail, ok, type Tools } from "./shared.js";

/**
 * Timeout for the numbering measurement.
 *
 * **THERE IS HEADROOM, AND IT'S MEASURED ON THE REAL BOOK** (2026-08-08, A/B on
 * one document in one session, `docs/measured-facts-phase7.md`, section «Час виміру»):
 * the code before Task 3F — median **6,038 ms**, after — **3,341 ms**. That's 2.8%
 * of this ceiling; even the worst observed run didn't reach 7 seconds.
 *
 * **A WRONG NUMBER STOOD HERE TWICE, AND THE SECOND WAS WORSE THAN THE FIRST.**
 * First «820 ms, 0.7% of the ceiling» from Phase 6 — Task 3 couldn't reproduce it.
 * Then **183,450 / 74,201 / 122,793 ms**, which grew into the conclusion "the
 * already-merged `pagination_audit` times out every other run" and a whole fix
 * round. A run on the real book showed that THAT number was the wrong one: 20–36
 * times higher than everything the same code gives on the same document. It
 * couldn't be reproduced; most likely someone measured the wrong call path (an
 * MCP server started from the MAIN checkout serves `main`'s code) or InDesign was
 * busy with someone else's mutating test suite.
 *
 * The moral for whoever comes to change this number next: a 20x gap from the
 * previous measurement is grounds to suspect the INSTRUMENT, not a discovery.
 * Check a new measurement against the old one before acting on it.
 *
 * The Task 3F speedup here is real, though — **−45% on the book**, more than the
 * synthetic rig's −30.8%. The most expensive item was re-parsing the master on
 * every page instead of once.
 *
 * **THE NUMBER HERE IS DELIBERATELY UNCHANGED.** The ceiling stays a ceiling, not
 * a measured time: getting close to it is itself a finding, not a reason to quietly
 * raise the constant. A decision on a new value is made AFTER a run on a copy of
 * the working book, since only that measures what the ceiling exists for.
 */
export const PAGINATION_MEASURE_TIMEOUT_MS = 120_000;

/**
 * The shared BASE for the `folio` field — without `.optional()` and without
 * `.describe()`.
 *
 * It's the base that's exported, not a ready-made audit field, and that's not a
 * matter of taste but a requirement of spec §5.1. Two tools require opposite
 * things from this field:
 *
 * - `pagination_audit` — `FOLIO_OBJECT.optional()`: a family that wasn't
 *   declared equals `null` ("wasn't asked about"), not an empty report ("looked
 *   and found nothing"). The Phase 4–6 convention;
 * - `pagination_apply` — `FOLIO_OBJECT.extend({ range })`: there's nowhere to
 *   write blind, so the family is required, plus a range direction.
 *
 * **`.optional()` MUST NOT move here.** Making the base optional would also make
 * `folio` optional in `pagination_apply`; removing `.optional()` from the audit's
 * usage would make the family required there too, and then the "no family
 * declared" check below becomes unreachable, the "contents-only audit" path
 * dies, and the convention breaks silently — the schema would accept the call
 * without explaining itself. Both mistakes are guarded by
 * `tests/unit/pagination-schema.test.ts`.
 */
/**
 * THERE CAN BE SEVERAL FOLIO STYLES, AND THAT'S MEASURED, NOT ASSUMED.
 *
 * Until now the field was singular (`styleName: string`), because in the book
 * everything was built on, the folio has one style. The second edition showed
 * the limit right away: «02 Зоряні Мрії» (592 pp.) sets folios in TWO
 * styles — «Нумерація L» and «Нумерація R», one per side of the spread. Only
 * one could be named, meaning half the book would be checked and reported as a
 * verified family — a silent narrowing of scope, the same class as R44 and R46.
 * So the family had to be declared unsupported entirely instead.
 *
 * There is ONE shape for both tools (`pagination_audit` and `pagination_apply`
 * share this object): two shapes of the same thing is exactly the pair that has
 * already grown divergences in this project. Nothing changes downstream: it all
 * works by the ROLE of `folio`, not by a specific name, so several names fall
 * into the same role map with no exceptions.
 */
export const FOLIO_OBJECT = z.object({
  styleNames: z
    .array(z.string())
    .min(1)
    .describe(
      "Paragraph styles of the folio text. Several of them when spreads are set in different " +
        "styles (e.g. «Нумерація L» and «Нумерація R»).",
    ),
});

const FOLIO_SCHEMA = FOLIO_OBJECT.optional().describe(
  "The folio family: page numbers. Without this field the family is not counted at all and in " +
    "the response equals null (“not asked”), rather than an empty report (“looked and found nothing”).",
);

const CONTENTS_SCHEMA = z
  .object({
    numberStyle: z.string().describe("Paragraph style of the frames holding the contents page numbers."),
    levelMap: z
      .array(
        z.object({
          contentsStyle: z.string().describe("Style of the contents line at this level."),
          headingStyles: z
            .array(z.string())
            .min(1)
            .describe(
              "Heading styles in the book body corresponding to this level. AN ARRAY, because " +
                "the correspondence is not one-to-one: headings of one level may have been set in " +
                "different styles.",
            ),
        }),
      )
      .min(1)
      .describe(
        "Level correspondence. There is no separate list of contents-line styles: it is already " +
          "given by the contentsStyle fields. One heading style MUST NOT belong to two " +
          "levels — otherwise the same heading would be consumed twice and both levels would produce " +
          "false numbers.",
      ),
  })
  .optional()
  .describe("The contents family: numbers in the table of contents. Without this field the family equals null.");

/* ── seventeenth tool: internal types and counters (§5.1, §5.2) ──── */

/** One claim-paragraph edit — exactly what the JSX handler consumes. */
interface FolioMarkerEdit {
  frameId: string;
  page: string;
  paragraphIndex: number;
  /** A MEASURED character offset, not a number the handler would look up itself (§4.1). */
  charOffset: number;
  expectedLiteral: string;
  expectedParagraphText: string;
  direction: MarkerDirection;
  /**
   * WHOSE CHAIN GIVES THE NUMBER this edit promised (I7). The measured winner of
   * resolution, not the requested route — see `FrameVerdict.resolvedBy`.
   *
   * IT RIDES RIGHT HERE, ON THE EDIT, AND THAT'S A CHOICE, NOT CONVENIENCE.
   * `willWrite` is what the operator reads before deciding the fate of the
   * `_folio-helper` layer (§4.8 calls removing it the standard rollback action,
   * Question 8 measured the cost: a hidden layer → 13 instead of 12 in the PDF).
   * The promise that "`willWrite` is exactly what goes to the handler" stays
   * literal this way: the field travels together with the edit instead of being
   * glued onto the response on the side. The cost is named out loud — THE
   * HANDLER DOESN'T READ IT and doesn't have to: it replaces a character at
   * `charOffset` and doesn't reason about chains. Splitting the two shapes of one
   * edit would create a place where they could silently drift apart.
   *
   * NOT `| null`, AND THAT'S AN INVARIANT, NOT OPTIMISM: edits are only born from
   * ELIGIBLE verdicts, and eligibility in `replace-literals` is proven per-frame
   * (`chain.kind === "measured"`), i.e. after resolution, which always has a
   * winner. A violation is caught by an exception in `editsFor`, not by `!`.
   */
  resolvedBy: "main" | "helper";
}

/** Shared by both JSX reports: exactly what `diffs` are computed from (§4.6). */
interface WriteDiffFields {
  backupPath: string;
  oversetBefore: string[];
  oversetAfter: string[];
  pageCountBefore: number;
  pageCountAfter: number;
}

interface HelperFrameReport {
  page: string;
  offset: number;
  frameId: string;
  source: "folio" | "page";
  folioFrameId: string | null;
}

interface HelperThreadReport extends WriteDiffFields {
  docName: string;
  layerName: string;
  layerCreated: boolean;
  layerFlagsBefore: { visible: boolean; printable: boolean } | null;
  created: number;
  frames: HelperFrameReport[];
  ignoredFolioFrames: { frameId: string; reason: string }[];
}

/** The repair handler's report (Phase 8 spec, §5.3). */
interface RepairThreadReport extends WriteDiffFields {
  docName: string;
  layerName: string;
  layerFlagsBefore: { visible: boolean; printable: boolean };
  removed: { frameId: string; page: string | null; reason: string }[];
  created: { page: string; offset: number; frameId: string; source: string }[];
  /**
   * How many chain links were REWRITTEN.
   *
   * `0` means "the chain was already what the repair would have made it," not
   * "nothing worked": the handler first checks the order, and when it's intact
   * it doesn't touch the chain at all. This isn't an optimization — a full
   * unthread/rethread cycle creates a NEW story (measured, Question 4b), so an
   * empty run would otherwise change `story.id` every time and mark the document
   * `modified` for nothing.
   *
   * When a repair IS needed, ALL links are rewritten, not just the broken ones:
   * partial rethreading is impossible — assigning `nextTextFrame` to an
   * already-threaded frame throws (Question 3).
   */
  restitched: number;
  framesAfter: number;
}

interface ReplaceLiteralsReport extends WriteDiffFields {
  docName: string;
  applied: number;
  failed: { frameId: string; page: string; paragraphIndex: number; error: string }[];
}

/**
 * A twin of `withDiffs` (`src/tools/corrections.ts`) — kept separate on purpose,
 * because that one is typed on the corrections `ApplyReport`, which Phase 7's
 * handlers don't return. The result shape must stay the same: §5.2 names the
 * `diffs` field the same way for every write tool, and they must not diverge.
 */
function folioDiffs(r: WriteDiffFields): {
  becameOverset: string[];
  noLongerOverset: string[];
  pageCountDelta: number;
} {
  const before = new Set(r.oversetBefore);
  const after = new Set(r.oversetAfter);
  return {
    becameOverset: r.oversetAfter.filter((id) => !before.has(id)),
    noLongerOverset: r.oversetBefore.filter((id) => !after.has(id)),
    pageCountDelta: r.pageCountAfter - r.pageCountBefore,
  };
}

export interface SkipGroup {
  reason: SkipReason;
  count: number;
  pages: string[];
  pagesTruncated: { shown: number; total: number } | null;
}

/**
 * Skips, grouped by reason.
 *
 * THE CEILING IS `MAX_GROUP_PAGES` (20), NOT `MAX_PAGINATION_DETAIL_ITEMS` (50),
 * and §5.2 says so directly: this describes `DefectGroup`, whose ceiling is 20.
 * Truncation is NEVER silent (`pagesTruncated`) — a silent truncation would read
 * as "that's everything," and on the working book a group can easily have 91
 * pages.
 *
 * AN `eligible: false` VERDICT WITH NO REASON FALLS HERE AND GOES NOWHERE ELSE —
 * ON PURPOSE. The `FrameVerdict` type doesn't allow that state ("`null` ONLY
 * when `eligible === true`"), and inventing a group name for it would mean
 * making up a reason nobody established. But a paragraph can't be silently lost
 * either — which is exactly why `reconcile` sums FROM THE GROUPED GROUPS: a loss
 * here immediately breaks the §5.2 equation, and §7 turns that into a loud
 * error. The safety net lives there, not here.
 *
 * Exported for the test's sake: the "grouping + equation" pair is checked
 * against an input list that `planRewrite` cannot supply — otherwise the
 * equation would stay a tautology (proven by mutant J in the Task 11 report).
 */
export function groupSkipped(verdicts: FrameVerdict[]): SkipGroup[] {
  const byReason = new Map<SkipReason, FrameVerdict[]>();
  for (const v of verdicts) {
    if (v.eligible || v.reason === null) continue;
    const bucket = byReason.get(v.reason);
    if (bucket === undefined) byReason.set(v.reason, [v]);
    else bucket.push(v);
  }
  const groups: SkipGroup[] = [];
  for (const [reason, list] of byReason) {
    const seen: string[] = [];
    for (const v of list) if (!seen.includes(v.page)) seen.push(v.page);
    const shown = seen.slice(0, MAX_GROUP_PAGES);
    groups.push({
      reason,
      count: list.length,
      pages: shown,
      pagesTruncated:
        seen.length > MAX_GROUP_PAGES ? { shown: shown.length, total: seen.length } : null,
    });
  }
  return groups;
}

/**
 * Paragraphs WITHOUT literals — two different states, and they must not be
 * merged.
 *
 * `alreadyAutomatic` (§5.2) — "already converted": no literals, marker present.
 * A second `replace-literals` run on the same book is plausible, and then these
 * paragraphs would make up the majority; counting them in `skipped` would make
 * `balanced: false` fire on a flawless run, and not counting them anywhere means
 * the operator can't tell "40 already done" from "40 lost."
 *
 * `withoutClaim` — no literals and no marker, i.e. the paragraph makes NO claim
 * about a page at all (in the fixture this is, for example, «Poza majstrovoiu
 * storinkoiu»). Counting it in `alreadyAutomatic` would mean reporting work
 * nobody did.
 *
 * MASTER FRAMES ARE COUNTED SEPARATELY, AND THAT'S ARITHMETIC, NOT TIDINESS.
 * `page.masterPageItems` gives an entry for EVERY page with that master, so the
 * working book's three master folios (`⟨PREVIOUS⟩–⟨AUTO⟩`, zero literals) would
 * add ~87 "already converted" paragraphs to a shared counter — paragraphs the
 * operator never converted and cannot convert (§4.4, step 7 discards them).
 * Mixed into one number, they would turn `alreadyAutomatic` into a lie about how
 * much work was actually done.
 */
function countWithoutLiterals(frames: ClaimFrame[]): {
  alreadyAutomatic: number;
  withoutClaim: number;
  alreadyAutomaticFromMaster: number;
} {
  let alreadyAutomatic = 0;
  let withoutClaim = 0;
  let alreadyAutomaticFromMaster = 0;
  for (const f of frames) {
    for (const p of f.paragraphs) {
      if (p.literals.length > 0) continue;
      if (p.markers.length === 0) {
        if (!f.fromMaster) withoutClaim++;
        continue;
      }
      if (f.fromMaster) alreadyAutomaticFromMaster++;
      else alreadyAutomatic++;
    }
  }
  return { alreadyAutomatic, withoutClaim, alreadyAutomaticFromMaster };
}

/**
 * THE HELPER LAYER'S STATE IN THE REPORT — A MEASUREMENT, NOT DERIVED FROM
 * VERDICTS (finding I8).
 *
 * REPRODUCED INPUT: a second dry run on the book gave `alreadyAutomatic: 84`,
 * `resolvedByHelper: 0` — not a word about the `_folio-helper` layer, even
 * though all 84 markers depend on it. Root cause: an already-converted frame
 * gets NO verdict at all (no literals, nothing for the oracle to check), so the
 * counter is zero BY CONSTRUCTION, not because the layer isn't needed.
 *
 * NOT FIXED WITH A SECOND COUNTER. A counter that can legitimately be zero is
 * the same channel that already lied once; adding another one next to it would
 * mean relying on the same construction. Hence this is a relay of the
 * MEASUREMENT itself: it can't become zero just because a frame didn't make it
 * into the plan.
 *
 * `null` — there's no layer in the document. Not an "empty layer": the
 * difference between "never built" and "built and it's empty" must be shown by
 * this report the same way the measurement itself shows it.
 */
function helperLayerBlock(measure: PaginationMeasure): {
  layerName: string;
  visible: boolean;
  printable: boolean;
  locked: boolean;
  frames: number;
  pagesWithoutFrame: number;
  chains: number;
} | null {
  const c = measure.helperChain;
  if (c === null) return null;
  return {
    layerName: c.layerName,
    visible: c.layerVisible,
    printable: c.layerPrintable,
    locked: c.layerLocked,
    frames: c.frames.length,
    pagesWithoutFrame: c.pagesWithoutFrame.length,
    chains: c.storyIds.length,
  };
}

/**
 * ALREADY-AUTOMATIC FRAMES WHOSE NUMBER IS KEPT BY THE HELPER CHAIN.
 *
 * The other half of the answer to I8, and the one `resolvedByHelper` doesn't
 * give: that counts ELIGIBLE verdicts, and a frame with no literals has no
 * verdict.
 *
 * The winner is computed by the same `helperChainWins` as
 * `FrameVerdict.resolvedBy` — two independent predicates about the winner would
 * sooner or later diverge, and the field would start contradicting the counter
 * (the same reasoning that made Phase 7 fold `helperChainWins` into one function
 * for two questions).
 *
 * The conditions are narrowed on purpose: master frames don't count (writing
 * into them isn't possible, and the marker there doesn't see a chain underneath
 * it — Question 13), nor do frames with literals (they're NOT yet converted;
 * `resolvedByHelper` counts them via their verdict).
 */
function countAlreadyAutomaticOverHelper(frames: ClaimFrame[]): number {
  let n = 0;
  for (const f of frames) {
    if (f.fromMaster) continue;
    if (f.paragraphs.some((p) => p.literals.length > 0)) continue;
    /* THE DIRECTION IS TAKEN FROM THE FRAME ITSELF, not set as a constant: after
     * `dir` appeared in `helperChainWins` (filtering out dead ends depends on
     * direction), hardcoding "previous" would mean counting a frame whose marker
     * is for the NEXT page under the wrong rule. */
    const hasPrevious = f.paragraphs.some((p) => p.markers.includes("previous-page-number"));
    const hasNext = f.paragraphs.some((p) => p.markers.includes("next-page-number"));
    if (!hasPrevious && !hasNext) continue;
    const links = documentThreadLinks(f);
    if (links === null || links.length === 0) continue;
    if (helperChainWins(links, hasPrevious ? "previous" : "next")) n += 1;
  }
  return n;
}

/**
 * Edits from eligible verdicts.
 *
 * NUMBERS AREN'T SEARCHED FOR HERE — they take the MEASURED `literalOffsets[0]`
 * offset and the measured paragraph text. A handler that looked up the literal
 * itself would drift from the measurement `eligible` is built on (§4.1); and
 * "14" → "144" leaves the same characters at the same offset, so a narrow check
 * isn't enough — hence the whole paragraph text travels along too.
 *
 * An eligible verdict with `literals.length !== 1` is impossible (oracle step
 * 1), but a silent `!` here would turn a broken "verdict ↔ measurement" pair
 * into `undefined` in the edit, i.e. a write at offset `NaN`. Hence — an
 * exception.
 */
function editsFor(measure: PaginationMeasure, verdicts: FrameVerdict[]): FolioMarkerEdit[] {
  const edits: FolioMarkerEdit[] = [];
  for (const v of verdicts) {
    if (!v.eligible) continue;
    const frame = measure.folioFrames.find((f) => f.id === v.frameId && !f.fromMaster);
    const para = frame?.paragraphs[v.paragraphIndex];
    /*
     * `resolvedBy === null` is checked here for the same reason as everywhere
     * else: in an eligible verdict from a per-frame run the resolution winner
     * always exists (I7). `null` would mean the edit was born from a PREDICTED
     * verdict — i.e. that `replace-literals` writes on a promise instead of a
     * measurement, and that was exactly C1. A silent `!` would turn such a
     * broken pair into `undefined` in the report, i.e. a silent loss of the only
     * warning about dependency on the helper layer.
     */
    if (
      frame === undefined ||
      para === undefined ||
      para.literals.length !== 1 ||
      v.resolvedBy === null
    ) {
      throw new Error(
        `Internal mismatch between plan and measurement: frame ${v.frameId}, paragraph ${v.paragraphIndex}. ` +
          "Nothing has been changed.",
      );
    }
    edits.push({
      frameId: frame.id,
      page: frame.page,
      paragraphIndex: v.paragraphIndex,
      charOffset: para.literalOffsets[0]!,
      expectedLiteral: String(para.literals[0]!),
      expectedParagraphText: para.text,
      direction: v.direction!,
      resolvedBy: v.resolvedBy,
    });
  }
  return edits;
}

/**
 * I3: THE PLAN IS FINALLY VERIFIED, AS §4.5 PROMISED.
 *
 * Until now `RewritePlan.verdicts` was saved to disk and NEVER READ back: the
 * second call only took `docName` and `chainOffsets` from the plan. Meanwhile
 * §4.5 said the plan "requires AND verifies" — a promise with no code behind
 * it.
 *
 * WHAT EXACTLY IS VERIFIED, AND WHY NOT MORE. The plan's verdicts are a
 * PREDICTION made before the chain existed; the fresh verdicts are a PER-FRAME
 * MEASUREMENT made after. These two lists legitimately diverge in route and
 * eligibility, so demanding they be equal would mean failing on every flawless
 * run. What must stay unchanged is something else — the NUMBER the operator saw
 * in the plan and approved.
 *
 * So the guard is narrowed to what's about to be WRITTEN: every eligible
 * verdict must have a twin in the plan with the same `current`. Two failure
 * modes:
 *   - the plan has NO such paragraph — the plan never approved it;
 *   - the plan has a different `current` — the number in the frame changed
 *     between calls.
 * Paragraphs no longer present in the fresh measurement (already converted, now
 * in `alreadyAutomatic`) don't trip the guard: nobody's about to write into
 * them, and failing on a repeat run would mean punishing the previous run's
 * success.
 */
function assertPlanStillHolds(
  plan: RewritePlan,
  fresh: FrameVerdict[],
  planId: string,
): void {
  const planned = new Map<string, FrameVerdict>();
  for (const v of plan.verdicts) planned.set(`${v.frameId}#${v.paragraphIndex}`, v);

  const drifted: string[] = [];
  for (const v of fresh) {
    if (!v.eligible) continue;
    const was = planned.get(`${v.frameId}#${v.paragraphIndex}`);
    if (was === undefined) {
      drifted.push(`p. ${v.page}, frame ${v.frameId}, paragraph ${v.paragraphIndex}: absent from the plan`);
    } else if (was.current !== v.current) {
      drifted.push(
        `p. ${v.page}, frame ${v.frameId}, paragraph ${v.paragraphIndex}: ` +
          `in the plan ${was.current}, in the document ${v.current}`,
      );
    }
  }
  if (drifted.length === 0) return;

  throw new IndesignError(
    "jsx-error",
    `Plan “${planId}” diverged from the document on ${drifted.length} asserting paragraph(s), ` +
      `and every one of them is among those about to be written to: ${drifted.slice(0, 5).join("; ")}` +
      `${drifted.length > 5 ? "; …" : ""}. Nothing has been changed and no copy was made.`,
    "The document was changed between the two calls. Re-measure (pagination_audit), rebuild " +
      "the chain and review the dry run before writing.",
  );
}

/**
 * §7, fourth line: helper frames must not push the layout.
 *
 * Loud AFTER the write, because it isn't visible before then — diffs are born
 * from the "before" and "after" measurement (§4.6). The error must carry the
 * copy's path: the change is already in the document, and the operator needs
 * something to check it against.
 *
 * `pageCountDelta` is included together with `becameOverset`, and that's the
 * same requirement, not an extension: "pushed the layout" is measured by two
 * quantities, §4.6 requires both, and stopping at one would leave the other
 * measured and unread.
 */
function assertLayoutUntouched(
  diffs: { becameOverset: string[]; pageCountDelta: number },
  backupPath: string,
  what: string,
): void {
  if (diffs.becameOverset.length === 0 && diffs.pageCountDelta === 0) return;
  throw new IndesignError(
    "jsx-error",
    `${what} shifted the layout: stories reflowed [${diffs.becameOverset.join(", ")}], ` +
      `the page count changed by ${diffs.pageCountDelta}. ` +
      "This is forbidden (§7): the change is already in the document.",
    `A copy from before the changes was saved: ${backupPath}. Undo the operation with a single Cmd+Z in InDesign and ` +
      "compare it against the copy before repeating.",
  );
}

export function registerPaginationTools(server: Tools): void {
  server.registerTool(
    "pagination_audit",
    {
      title: "Manual cross-references to pages",
      description:
        "A read-only audit of text that ASSERTS SOMETHING ABOUT A PAGE and is keyed by hand: " +
        "folios and numbers in the table of contents. Writes nothing to the document. " +
        "THE MAIN THING TO UNDERSTAND HERE: a “manual” finding (folio-manual, " +
        "contents-manual) is NOT A WRONG NUMBER. It says the number was typed by hand and so " +
        "will not update on the next recomposition, while its automatic neighbours " +
        "will. The number may well be correct right now. That is why such " +
        "findings are NOT counted in `deviating` — they sit separately in `findings`. " +
        "FIVE defects are excluded from `deviating`, not two: alongside the “manual” pair there are " +
        "folio-unparsable (the page name is not a number, so there was nothing to reconcile against — " +
        "such a frame is already counted in notCompared, and counting it as a deviation as well " +
        "would mean reporting a defect instead of “not checked”), " +
        "folio-dormant-duplicate (a frame on a hidden layer: it does not print today) and " +
        "folio-marker-unmeasured (frame overlaps were NOT COUNTED, because its own bounds are " +
        "unknown, so the neighbouring page's marker inside it was not checked — that is “not " +
        "compared”, neither “clean” nor “diverged”). " +
        "The folio rule has TWO parts and both are needed: (1) every literal " +
        "number must equal the number of its own page or of the adjacent page of the same " +
        "spread; (2) a literal number must not equal what an automatic marker would yield in " +
        "the same frame. The first part alone lets through a frame that slid to the wrong " +
        "side of the spread (there a manual number legitimately equals its own page); the second " +
        "alone lets through a systematic offset. The reference is taken from the DOCUMENT — the " +
        "composition of a spread is known to InDesign itself, so the rule works even on a book with the folio on " +
        "verso. " +
        "Pairs of “title ↔ number” in the contents are built GEOMETRICALLY, along the baseline: " +
        "there is no structural link between them in the document (they lie in different stories). " +
        "The tolerance is half the smaller leading of the pair — again from the document, not a " +
        "constant. Two titles within the tolerance of one number yield contents-ambiguous rather than a " +
        "guess. Numbers in the contents must BE NON-DECREASING in line order — a decrease yields " +
        "contents-out-of-order; this is not a similarity measure but a fact: contents follow the book's order. " +
        "A COUNT MISMATCH (contents-count-mismatch) IS OFTEN LEGITIMATE rather than a defect: " +
        "the contents are deliberately incomplete, some headings are left out of them. Measured on a " +
        "real book: 34 lines with numbers against 42 subheadings in the body — the normal " +
        "state of that layout. The finding says “order-based matching stopped”, not “something " +
        "is broken”: it stops because with differing counts a shift of one position " +
        "would make EVERY following line stale. First check whether the difference is " +
        "expected, and only then look for a defect. " +
        "WHAT THE TOOL DOES NOT DO: it does not match the TEXT of contents titles against headings " +
        "(contents are abridged on purpose, and there is nothing from which to measure a similarity threshold), so " +
        "swapping two adjacent lines with nearby pages is not caught. It does not " +
        "see tables and footnotes. It does not see orphaned cross-reference marks outside " +
        "a folio frame: the tool does not know which page the reference IS SUPPOSED to point at. " +
        "There is no runningHead family — the measured book turned out to have no running head carrying a chapter title; " +
        "should one be needed, it should be made with a MATCH_PARAGRAPH_STYLE_TYPE text " +
        "variable, which carries the heading across by itself, leaving nothing to audit. " +
        "A family that is not declared equals null (“not asked”), not an empty report " +
        "(“looked and found nothing”). The checked/deviating/notCompared counters are always present: without " +
        "them a zero finding count cannot be told apart from “never measured”. " +
        "ANOTHER PLACE WHERE ZERO DOES NOT MEAN “CLEAN”: masterSkipped. Frames on " +
        "parent (master) pages are counted ONLY as folios — for contents and " +
        "headings they are invisible, because a single master object would multiply into as many " +
        "phantom lines as there are pages the master is applied to. If a style you declared " +
        "was found on a parent page, it is listed here by name: an empty report for the " +
        "contents family alongside a non-empty masterSkipped means not “there are no defects” but " +
        "“the contents lie where the tool does not look”. " +
        "checked COUNTS ASSERTIONS, NOT FRAMES: a master folio visible from 40 " +
        "pages yields 40 assertions about 40 different pages. " +
        "THE INTEGRITY OF THE HELPER CHAIN IS THE FOURTH CHECK OF THE folio FAMILY, and it " +
        "fires BEFORE the numbers go wrong. If the document contains a layer named " +
        "_folio-helper (built by pagination_apply), four properties are checked, " +
        "because they break in different ways: a frame exists on EVERY page (folio-helper-chain-gap " +
        "— a single missing link shifts the folios on all following pages, because the marker " +
        "takes its number from the page of the PREVIOUS FRAME, not from “current minus one”); the order of " +
        "the links matches the order of the pages (folio-helper-chain-unordered); the layer is VISIBLE " +
        "(folio-helper-chain-hidden — a hidden layer SUPPRESSES resolution, and every " +
        "automatic folio silently becomes “N–N”; being non-printable has no such " +
        "effect and is the intended state); and all links are stitched into ONE chain " +
        "(folio-helper-chain-split). THE LAST MATTERS MORE THAN THE OTHER THREE: it was measured that " +
        "duplicating a page in InDesign copies the helper frame but does NOT stitch the copy in — " +
        "the frame is on the page, the order is unbroken, so the remaining checks stay silent while " +
        "the numbers have already slipped. To repair all four — pagination_apply with " +
        "operation: repair-helper-thread. " +
        "IF THE LAYER IS NOT IN THE DOCUMENT, these checks are SILENT: no chain was built, " +
        "so there is nothing to break — that is not “clean” but “nothing to report”.",
      inputSchema: {
        folio: FOLIO_SCHEMA,
        contents: CONTENTS_SCHEMA,
        headingStyles: z
          .array(z.string())
          .optional()
          .describe(
            "Heading styles in the book body. Needed by the contents family in order to know the ACTUAL " +
              "page of a heading. InDesign has no notion of a “heading level”, so the " +
              "tool does not guess it — the same precedent as headingStyles in document_map.",
          ),
        runningHead: z
          .object({ styleNames: z.array(z.string()).min(1) })
          .optional()
          .describe(
            "The running-head family (the chapter title at the top of a page). styleNames — the styles " +
              "it is set in. NOTE, MEASURED: a style name does NOT distinguish a running head from " +
              "a folio — the same style can carry both (on the working book that is exactly " +
              "the case on three masters). The tool filters the folio out itself, by CONTENT: " +
              "a frame holding a numbering special character, or nothing but digits and dashes, is not considered a " +
              "running head. The price of this: a running head consisting of a number alone is invisible to the " +
              "family. The “wrong chapter” rule additionally needs headingStyles — without them " +
              "it does not fall silent unnoticed but reports notCompared.",
          ),
        detail: z
          .object({ family: z.enum(["folio", "contents", "runningHead"]) })
          .optional()
          .describe(
            "A by-name listing of one family's findings, truncated by a ceiling. Without this field " +
              "detail equals null. The family MUST be declared — otherwise the tool " +
              "refuses rather than handing back a quiet empty listing.",
          ),
      },
    },
    async (args) => {
      try {
        const folioArg = args.folio as { styleNames: string[] } | undefined;
        const contentsArg = args.contents as
          | { numberStyle: string; levelMap: LevelMapping[] }
          | undefined;
        const headingStyles = (args.headingStyles as string[] | undefined) ?? [];
        const headArg = args.runningHead as { styleNames: string[] } | undefined;
        const detailFamily = (args.detail as { family: FamilyName } | undefined)?.family ?? null;

        if (folioArg === undefined && contentsArg === undefined && headArg === undefined) {
          return fail(
            new Error(
              "No family has been declared. The measurement costs a pass over the whole document, and " +
                "all it can return is emptiness — declare at least one of the three TOP-LEVEL " +
                "parameters, each of which is an OBJECT, not a bare name and not a list of names:\n" +
                '  folio: { "styleNames": ["<paragraph style of the page numbers>"] }\n' +
                '  runningHead: { "styleNames": ["<paragraph style of the running head>"] }\n' +
                '  contents: { "numberStyle": "<style of the contents page numbers>", ' +
                '"levelMap": [{ "contentsStyle": "<style of the contents line>", ' +
                '"headingStyles": ["<matching heading style in the body>"] }] }\n' +
                "There is NO parameter named “families”, and a family cannot be requested by name alone: " +
                "the styles carrying it differ per edition and the tool does not guess them. " +
                "A parameter this tool does not know is DISCARDED WITHOUT AN ERROR, so a misspelt name " +
                "produces this very message again — compare what you sent against the three shapes above. " +
                "The style names in the document are listed by doc_overview (paragraphStyles).",
            ),
          );
        }

        /* Validation BEFORE the measurement: failing here costs exactly nothing, and
         * overlapping levels would otherwise give two equally plausible wrong
         * numbers. */
        if (contentsArg !== undefined) assertDisjointLevels(contentsArg.levelMap);

        if (detailFamily === "folio" && folioArg === undefined) {
          return fail(new Error("detail was requested for the folio family, but that family is not declared."));
        }
        if (detailFamily === "contents" && contentsArg === undefined) {
          return fail(new Error("detail was requested for the contents family, but that family is not declared."));
        }
        if (detailFamily === "runningHead" && headArg === undefined) {
          return fail(new Error("detail was requested for the runningHead family, but that family is not declared."));
        }

        const titleStyles = contentsArg?.levelMap.map((l) => l.contentsStyle) ?? [];

        const measure = await runJsx<PaginationMeasure>(
          "pagination_measure",
          {
            folioStyles: folioArg?.styleNames ?? [],
            contentsNumberStyle: contentsArg?.numberStyle ?? null,
            contentsTitleStyles: titleStyles,
            headingStyles,
            runningHeadStyles: headArg?.styleNames ?? [],
          },
          { timeoutMs: PAGINATION_MEASURE_TIMEOUT_MS },
        );

        /*
         * A missing style is a LOUD error, not silence. A typo in the name
         * would otherwise give zero findings, which reads as "all clean" —
         * exactly the failure mode Phase 5 caught five times.
         */
        if (measure.missingStyles.length > 0) {
          return fail(
            new Error(
              `The document contains none of the declared styles: ${measure.missingStyles.join(", ")}. ` +
                "Nothing was measured: an empty report here would read as “everything is clean”.",
            ),
          );
        }

        /*
         * The same class as `missingStyles`, and the same loudness. A style
         * declared by two families works in only one — and the other returns
         * zero findings, which reads as "all clean." The style exists, so
         * `missingStyles` stays silent about it by construction.
         */
        const conflicts = measure.conflictingStyles ?? [];
        if (conflicts.length > 0) {
          const list = conflicts
            .map((c) => `“${c.style}” (acts as ${c.kept}, also declared as ${c.alsoDeclared})`)
            .join("; ");
          return fail(
            new Error(
              `One style is declared by two families: ${list}. ` +
                "The losing family would return zero findings, and that would read as “everything is clean”.",
            ),
          );
        }

        let folio: FamilyResult | null = null;
        if (folioArg !== undefined) {
          folio = detectFolio(measure.pages, measure.folioFrames);
          /*
           * THE FOURTH DETECTOR FLOWS INTO THE FAMILY WITHOUT TOUCHING THE
           * COUNTERS (Phase 8 spec, §4.2).
           *
           * `checked`/`notCompared` count NUMBER CLAIMS, and are per-frame; the
           * unit for chain integrity is the page and the document. Adding them
           * there would mean counting a claim that doesn't exist. They land in
           * `deviating` on their own, since they aren't in `NON_DEVIATIONS`.
           *
           * A BOUNDARY NAMED OUT LOUD: findings ride the `folio` family, so an
           * audit of `contents` alone doesn't check chain integrity. This is the
           * inherited Phase 4–6 convention ("an undeclared family = null, not an
           * empty report"); breaking it for the sake of one detector would make
           * the `folio` family effectively mandatory.
           */
          folio.findings.push(...detectHelperChain(measure.helperChain));
        }

        let contents: FamilyResult | null = null;
        if (contentsArg !== undefined) {
          const titles = flattenFrames(measure.contentsTitles, measure.pages);
          const numbers = flattenFrames(measure.contentsNumbers, measure.pages);
          const paired = pairByBaseline(titles, numbers);
          const rotated = measure.contentsNumbers.filter((f) => f.rotationAngle !== 0);
          const detected = detectContents(
            paired.pairs,
            measure.headings,
            contentsArg.levelMap,
            rotated,
          );
          contents = {
            checked: detected.checked,
            notCompared: detected.notCompared,
            /* Matching findings (unpaired, ambiguous, different spreads) and the
             * detector's own findings are one list: to the operator these are
             * all reasons why a contents line needs attention. */
            findings: [...paired.findings, ...detected.findings],
          };
        }

        let runningHead: FamilyResult | null = null;
        if (headArg !== undefined) {
          const spans = chapterSpans(measure.headings, measure.pages);
          /*
           * THE EXPECTATION "THERE SHOULD BE A RUNNING HEAD HERE" IS DERIVED
           * FROM THE MEASUREMENT, not from a "page is inside a section" rule.
           *
           * A user decision (2026-08-14) on the measured state: 78 pages of the
           * «Шаблон інтерв'ю» master are deliberately without a running head. A
           * rule based on page number would have reported 39 verso pages and
           * buried the real findings. The tool can't know the intent — so it
           * doesn't decide on the layout artist's behalf.
           */
          /*
           * НАКОПИЧУЄМО СТОРОНИ, А НЕ ЗАТИРАЄМО. Ключ — ім'я майстер-РОЗВОРОТУ,
           * а розворот має дві сторінки: майстер із колонтитулом і на верстці, і
           * на звороті доти лишав ту сторону, що трапилася в циклі останньою, і
           * head-missing на всіх сторінках другої сторони мовчав.
           */
          const expectedByMaster = new Map<string, Set<PageRef["side"]>>();
          for (const h of measure.headFrames) {
            if (h.fromMaster && h.masterName !== null && !h.empty) {
              const sides = expectedByMaster.get(h.masterName) ?? new Set<PageRef["side"]>();
              sides.add(h.side);
              expectedByMaster.set(h.masterName, sides);
            }
          }
          runningHead = detectHeads(measure.pages, measure.headFrames, spans, {
            /* Without heading styles there's nothing to compare the text against — and
             * the rule doesn't stay silent then, it reports notCompared (spec §7). */
            compareChapter: headingStyles.length > 0,
            expectedByMaster,
          });
        }

        return ok(
          buildReport({
            docName: measure.docName,
            folio,
            contents,
            runningHead,
            missingStyles: measure.missingStyles,
            /*
             * A LOUD CHANNEL, NOT A FAILURE, and that's a choice, not an
             * oversight. A frame in a declared style sitting on a parent page is
             * a legitimate layout state (templated contents), so failing here
             * would forbid auditing whole editions. But silence isn't an option
             * either: without this field `contents: { checked: 0, … }` reads as
             * "all clean." `undeclared` deliberately stays in the measurement —
             * see `masterSkipped` in `PaginationReport`.
             */
            masterSkipped: measure.masterSkipped.declared,
            /*
             * A FOREIGN MASTER — UNCONDITIONALLY, not per-family, and it costs
             * nothing extra.
             *
             * The incident this detector exists for (p. 188 of the working book, a
             * forgotten master-page reassignment) doesn't belong to any of the
             * three families: it CREATES a state where the `runningHead` family
             * stays silent legitimately — there are no expectations, because a
             * foreign master promises nothing. Putting it under `runningHead`
             * would mean turning the detector on exactly where people already
             * look, and leaving it blind for editions that have no running heads
             * at all.
             *
             * `measure.pages` already contains the applied master
             * (`src/jsx/pagination.jsx:1303`), so this costs no extra call into
             * InDesign — unlike `document_map`, which the original plan pointed
             * to, and which takes 928 s on a 592-page document.
             */
            masterIslands: detectMasterIslands(measure.pages),
            detailFamily,
          }),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "pagination_apply",
    {
      title: "Manual folios → automatic markers",
      description:
        "WRITES to the document. Replaces a MANUAL number in the folio with an automatic marker for the adjacent " +
        "page (⟨previous⟩ or ⟨next⟩) so that the folio updates itself on every " +
        "recomposition. " +
        "THE MAIN THING TO UNDERSTAND HERE: THE REPLACEMENT DOES NOT MAKE THE FOLIO CORRECT — IT MAKES " +
        "IT SELF-UPDATING. A wrong number is REJECTED by the tool, not repaired: the existing manual number is itself " +
        "the oracle. The tool computes which page the marker will resolve to, and if that does not equal " +
        "what stands in the frame NOW, the frame is left alone (reason — oracle-mismatch). That is, " +
        "after a successful run NOTHING changes on the printed sheet; all that changes is the way the " +
        "number gets there. Skewed numbering cannot be repaired with this tool. " +
        "ANOTHER THING TO UNDERSTAND BEFORE THE FIRST WRITE: AFTER THE REPLACEMENT, pagination_audit IS " +
        "BLIND TO THAT FRAME FOREVER. The audit produces findings only where the paragraph CONTAINS A LITERAL " +
        "NUMBER, and the replacement removes precisely that. If the story is later broken apart, the marker will start " +
        "showing the current page and will print a plausible “121–121” — with no gap and no " +
        "warning (measured). Detectability is held by THREE detectors of the folio family, which work " +
        "on MARKERS rather than literals: folio-marker-unbound (the marker has nothing to resolve against), " +
        "folio-marker-cross-spread (it resolved, but the pair of numbers is not two pages of one " +
        "spread) and folio-dormant-duplicate (a frame with a marker on a hidden layer: today it " +
        "does not print, and switching the layer on would give a second, wrong folio). So do not " +
        "take them out of use: without them this operation is harmful. " +
        "TWO SEPARATE OPERATIONS, AND THE ORDER BETWEEN THEM IS MANDATORY. " +
        "create-helper-thread builds the HELPER CHAIN: empty frames on a separate layer " +
        "_folio-helper, stitched into a single story in page order, each exactly beneath the folio. " +
        "That is a structural change to the document. It returns a planId. " +
        "replace-literals writes the markers themselves and, for the auto route, REQUIRES that planId. The split " +
        "exists so that a structural change cannot hide behind a text edit; the planId exists so that " +
        "the second operation rests on the chain ACTUALLY built rather than recomputing the decision " +
        "afresh — between the calls the operator could have moved a frame and InDesign could have recomposed " +
        "the page, and the oracle will NOT catch it, because it reconciles the number, and the number matches today. " +
        "THE ROUTE IS A PROPERTY OF THE FRAME, NOT A GLOBAL SWITCH. Where a folio overlaps " +
        "a frame of the main text chain, the marker will take its number from THAT ONE (measured: the chain " +
        "created earlier wins — neither stacking order nor the area of overlap has any effect), " +
        "so the route there is forced to thread, and if the oracle does not agree on it, the frame is " +
        "skipped: a helper frame will not save it. Where there is no overlap — helper. " +
        "COVERAGE OF THE helper ROUTE IS COMPLETE ONLY AT THE MOMENT OF THE OPERATION, NOT FOREVER: a page " +
        "added later will not receive a helper frame, and the marker on it will start to lie. After " +
        "adding pages the chain must be rebuilt. The thread route is fragile to changes in the " +
        "STRUCTURE of stories (not to recomposition). " +
        "THE _folio-helper LAYER MUST REMAIN VISIBLE. Measured: a hidden helper-chain " +
        "layer SUPPRESSES marker resolution, whereas being non-printable (printable = false) does not. " +
        "That is, one click on the “eye” silently turns every automatic folio in the book into " +
        "“N–N”, and it will look exactly as it always did. The tool creates the layer precisely as " +
        "printable = false, visible = true and returns these flags if the layer already exists with others. " +
        "There is deliberately no inverse operation: the layer is deleted in InDesign with a single action. " +
        "WHAT THE TOOL DOES NOT DO. It does not write into master folios (one master object " +
        "multiplied across all pages — a write would change them all at once), so a broken master " +
        "folio stays broken. It does not touch frames on HIDDEN layers: the benefit is zero " +
        "(they do not print) and the replacement would take from them their last literal signal. It does not " +
        "touch locked frames, single-sided documents, spreads not made of two pages, " +
        "frames with several literals, or pages whose name is not the canonical decimal " +
        "form of their own number (“096” would put “096” on the sheet instead of “96”). Every skip is " +
        "named with a reason in skipped — zero eligible frames is a legitimate state here, not a failure. " +
        "SAFETY. dryRun = TRUE by default, and that is a departure from the other writing " +
        "tools: those are preceded by an audit showing every match, whereas the notions of route and " +
        "eligibility are introduced by this phase itself. expectedDocName is MANDATORY — unlike the other " +
        "tools. Before any write a backup copy is made in _backups/ next to the " +
        "document; the whole operation is ONE undo step. " +
        "LOUD ERRORS RATHER THAN QUIET ZEROS: no declared style; the chain came out with a gap " +
        "(fewer frames than pages); helper frames shifted the layout; eligible frames exist yet " +
        "zero were written; the reconciliation does not balance.",
      inputSchema: {
        operation: z
          .enum(["create-helper-thread", "replace-literals", "repair-helper-thread"])
          .describe(
            "create-helper-thread — build the helper chain and issue a planId (a structural " +
              "change to the document). replace-literals — write markers in place of manual numbers. These are " +
              "SEPARATE CALLS, each with its own undo step and copy: merged, they " +
              "would make the structural change go unnoticed. " +
              "repair-helper-thread — restore an ALREADY EXISTING chain after the page count has " +
              "changed: remove surplus frames (a second one on a page, orphans off the pages), " +
              "add the missing ones, re-stitch in page order, restore the layer flags. " +
              "Idempotent: a second run in a row yields zeros. It CANNOT build from scratch — " +
              "for that use create-helper-thread.",
          ),
        folio: FOLIO_OBJECT.extend({
          range: z
            .enum(["backward", "forward"])
            .describe(
              "The folio range convention, and THERE IS DELIBERATELY NO DEFAULT HERE. backward — " +
                "the manual number names the PREVIOUS page (“96–⟨auto⟩” on p. 97). forward — " +
                "the NEXT one. Both conventions are equally valid and cannot be derived from the document; a book with " +
                "the opposite one would get oracle-mismatch on every frame, i.e. zero edits and " +
                "no harm — but a silent default here would mean quietly refusing to fix " +
                "half of all books.",
            ),
        }).describe(
          "The folio family. MANDATORY, unlike in pagination_audit: there is nowhere to write blindly.",
        ),
        route: z
          .enum(["thread", "helper", "auto"])
          .optional()
          .describe(
            "ONLY for replace-literals; for create-helper-thread it is an error. auto derives the " +
              "route from the layout frame by frame and REQUIRES a planId. thread and helper are a documented " +
              "override, an emergency exit, not an equal alternative: forcing helper does not undo " +
              "the fact that the main chain beats the helper one wherever there is an overlap. " +
              "NONE OF THE THREE ESTABLISHES ELIGIBILITY IN ADVANCE. Eligibility is proven FRAME BY FRAME, " +
              "from the frame's own overlaps: whether beneath it lies a frame the marker will take its number from. " +
              "That is why helper without a planId is safe — it does not trust the contract “a frame on every " +
              "page” but measures; yet it will also yield zero eligible frames until a chain exists. " +
              "RESOLUTION IS COMPUTED OVER ONE AND THE SAME SET OF OVERLAPS IN ALL THREE CASES: " +
              "InDesign takes the number from the chain CREATED EARLIER, and computing it more narrowly would mean " +
              "promising a number that will not be on the sheet. A request for thread is expressed as a REFUSAL " +
              "after resolution: when the helper chain turns out to be the winner, the frame goes into " +
              "skipped with the reason helper-chain-winner rather than being rewritten without it. " +
              "THE ROUTE IS AN OVERRIDE, NOT THE SOURCE OF THE NUMBER: whose chain physically supplies the number " +
              "is stated by a separate resolvedBy field in each willWrite edit (and the " +
              "resolvedByHelper counter). That is what must be read before removing the " +
              "_folio-helper layer: under route: thread the number may perfectly well come from the helper chain.",
          ),
        planId: z
          .string()
          .optional()
          .describe(
            "The plan from create-helper-thread. MANDATORY for replace-literals with route: auto. " +
              "It is a SNAPSHOT APPROVED BY THE OPERATOR, and it IS RECONCILED: the document name, and then " +
              "every paragraph about to be written to. If a paragraph is absent from the plan, or the number in it " +
              "differs — refusal, without a write and without a copy: the document was changed between the calls. " +
              "Eligibility is NOT taken from the plan — it is measured afresh, frame by frame.",
          ),
        dryRun: z
          .boolean()
          .default(true)
          .describe(
            "TRUE by default: show exactly what would be done, writing nothing and making " +
              "no copy. To write, set it to false EXPLICITLY.",
          ),
        undoName: z
          .string()
          .optional()
          .describe("Name of the undo step. Without it — a name derived from the operation."),
        expectedDocName: z
          .string()
          .describe(
            "Name of the document to write to. MANDATORY — unlike the other writing " +
              "tools, where the field is optional and, when omitted, does nothing. To a new entry " +
              "point that argument (“making it mandatory would break existing calls”) does not " +
              "apply, and the price of silence is a structural change to the user's live book.",
          ),
      },
    },
    async (args) => {
      try {
        const operation = args.operation as
          | "create-helper-thread"
          | "replace-literals"
          | "repair-helper-thread";
        const folioArg = args.folio as { styleNames: string[]; range: FolioRange };
        const route = args.route as RouteRequest | undefined;
        const planId = args.planId as string | undefined;
        /*
         * `!== false`, NOT `as boolean`, AND THIS ISN'T PARANOIA — IT WAS FOUND
         * BY A TEST.
         *
         * The `true` default is declared in the schema, and `zod` really does
         * apply it — but only on the path that goes through the schema. The
         * first run of `tests/unit/tools-pagination-apply.test.ts` called the
         * handler around the schema (the mocked `registerTool` doesn't run it),
         * and `dryRun` arrived as `undefined`: meaning the tool WENT AHEAD AND
         * WROTE where the operator asked for nothing to be written.
         *
         * The rule that follows from this, and it's wider than this file: the
         * safe value must be the one that results from the field's ABSENCE, at
         * EVERY layer, not just the one declaring the default. Exactly one value
         * is allowed to write — an explicit `false`.
         */
        const dryRun = args.dryRun !== false;
        const undoName = args.undoName as string | undefined;
        const expectedDocName = args.expectedDocName as string;

        /*
         * CROSS-FIELD RULES — BEFORE THE MEASUREMENT. A measurement costs a
         * pass over the whole document; it can't be spent paying for an argument
         * error visible at a glance (the same precedent as `assertDisjointLevels`
         * in the audit). Each of these is a failure, not silent ignoring: a
         * parameter accepted and then unused is a lie about what was done.
         */
        /*
         * FOLIO STYLES — HERE, NOT ONLY IN THE SCHEMA, AND THE REASON IS
         * MEASURED.
         *
         * The same lesson as `dryRun` below: the safe value must result from the
         * field's ABSENCE at EVERY layer, not just the one declaring the schema.
         * `FOLIO_OBJECT` really does require `.min(1)`, but not every path goes
         * through the schema — the mocked `registerTool` in
         * `tests/unit/tools-pagination-apply.test.ts` doesn't run it, and that's
         * exactly where this was caught (the "empty style list" test).
         *
         * WHAT THE ABSENCE OF THIS GATE WOULD HAVE COST. `styleNames ===
         * undefined` (a caller using the old `styleName` shape) gives
         * `folioStyles: undefined`, and `JSON.stringify` drops that key
         * entirely — meaning NOTHING arrives in the JSX, `folioFrames` is empty,
         * `eligible.length === 0`, and the tool returns SUCCESS: "No eligible
         * frames, that's not a failure." The §7 loud error becomes unreachable
         * by construction, and a mutating tool silently does nothing.
         */
        if (!Array.isArray(folioArg?.styleNames) || folioArg.styleNames.length === 0) {
          return fail(
            new Error(
              "folio.styleNames must be a non-empty list of folio paragraph styles. " +
                "An empty or absent list would yield zero eligible frames, and that would " +
                "come back as the SUCCESS “there are no eligible frames” — that is, as silent inaction.",
            ),
          );
        }

        if (operation === "replace-literals" && route === undefined) {
          return fail(
            new Error(
              'operation: "replace-literals" requires route ("auto", "thread" or "helper"). ' +
                "The route determines where the marker takes its number from, and a default here would mean " +
                "silently choosing on the operator's behalf.",
            ),
          );
        }
        if (operation === "repair-helper-thread" && route !== undefined) {
          return fail(
            new Error(
              'route applies only to operation: "replace-literals". Repairing the chain has no ' +
                "route: it restores a frame on EVERY page regardless of which " +
                "route each folio will later take.",
            ),
          );
        }
        if (operation === "repair-helper-thread" && planId !== undefined) {
          return fail(
            new Error(
              'operation: "repair-helper-thread" ISSUES a planId, it does not consume one. A plan passed in ' +
                "here would silently go unused, and after the repair the coverage is different anyway — which is exactly why " +
                "the operation issues a NEW plan.",
            ),
          );
        }
        if (operation === "create-helper-thread" && route !== undefined) {
          return fail(
            new Error(
              'route applies only to operation: "replace-literals". Building the helper ' +
                "chain has no route: it builds a frame on EVERY page regardless of " +
                "which route each folio will later take.",
            ),
          );
        }
        if (operation === "create-helper-thread" && planId !== undefined) {
          return fail(
            new Error(
              'operation: "create-helper-thread" ISSUES a planId, it does not consume one. A plan passed in ' +
                "here would silently go unused — and a second chain in the document is forbidden in any case.",
            ),
          );
        }
        if (operation === "replace-literals" && route === "auto" && planId === undefined) {
          return fail(
            new Error(
              'route: "auto" requires a planId from a preceding call to ' +
                'operation: "create-helper-thread". The plan is a SNAPSHOT APPROVED BY THE OPERATOR, and ' +
                "it is reconciled before the write: every paragraph about to be written to must " +
                "have a twin in the plan carrying the same number. Without it, “let the tool " +
                "decide” would be a decision nobody ever saw. Eligibility is NOT taken from the plan " +
                "— it is measured afresh, frame by frame; that is why helper and thread do not require a " +
                "plan, while auto requires review rather than safety.",
            ),
          );
        }

        const measure = await runJsx<PaginationMeasure>(
          "pagination_measure",
          {
            folioStyles: folioArg.styleNames,
            contentsNumberStyle: null,
            contentsTitleStyles: [],
            headingStyles: [],
          },
          { timeoutMs: PAGINATION_MEASURE_TIMEOUT_MS },
        );

        /* The same loud channel as in the audit, and for the same reason: a typo
         * in a style name would give zero eligible frames, i.e. "nothing needed
         * doing" instead of "looked for the wrong thing." */
        if (measure.missingStyles.length > 0) {
          return fail(
            new Error(
              `The document does not contain the declared style: ${measure.missingStyles.join(", ")}. ` +
                "Nothing was measured and nothing changed: an empty report here would read as “everything is already automatic”.",
            ),
          );
        }

        assertExpectedDoc(measure.docName, expectedDocName);

        const counters = countWithoutLiterals(measure.folioFrames);
        /*
         * I8: HELPER LAYER STATE RIDES IN EVERY RESPONSE, not just where some
         * counter is nonzero. It's computed ONCE here, because there are five
         * response branches, and they must not diverge.
         */
        const helperLayer = helperLayerBlock(measure);
        const alreadyAutomaticOverHelper = countAlreadyAutomaticOverHelper(measure.folioFrames);

        if (operation === "repair-helper-thread") {
          /*
           * REPAIR MEASURES, IT DOESN'T PREDICT, and that's exactly why there's
           * no `"contract"` branch here. `create-helper-thread` has to promise
           * ahead of time — the chain doesn't exist yet by construction. Here it
           * DOES exist, and its state is already in the measurement
           * (`helperChain`), so a dry run shows exactly what will happen.
           */
          const chain = measure.helperChain;
          if (chain === null) {
            return fail(
              new Error(
                `The layer "${HELPER_LAYER_NAME}" is not in the document — there is nothing to repair. ` +
                  'The helper chain is built by operation: "create-helper-thread"; a repair ' +
                  "restores an existing one. An empty report here would read as “everything is intact”.",
              ),
            );
          }

          /*
           * THE GEOMETRY DONOR IS NEVER A FRAME THE ORACLE WOULD REJECT ANYWAY —
           * the same I4 rule as in the build step: a hidden folio is absent from
           * the sheet, and the donor is chosen one per page, first one wins.
           */
          const folioFrameIds = measure.folioFrames
            .filter((f) => !f.fromMaster && f.bounds !== null && f.layerVisible)
            .map((f) => f.id);

          /* Exactly what needs doing is computed from the MEASUREMENT, per frame. */
          const seenOffsets = new Set<number>();
          const willRemove: { frameId: string; page: string | null; reason: string }[] = [];
          for (const f of chain.frames) {
            if (f.pageOffset === null) {
              willRemove.push({ frameId: f.frameId, page: f.page, reason: "orphan" });
              continue;
            }
            if (seenOffsets.has(f.pageOffset)) {
              willRemove.push({ frameId: f.frameId, page: f.page, reason: "duplicate-on-page" });
              continue;
            }
            seenOffsets.add(f.pageOffset);
          }
          const willCreate = chain.pagesWithoutFrame.slice();

          if (dryRun) {
            return ok({
              docName: measure.docName,
              operation,
              route: null,
              dryRun: true,
              backupPath: null,
              planId: null,
              helperLayer,
              alreadyAutomaticOverHelper,
              willRepair: {
                removed: willRemove,
                created: willCreate.slice(0, MAX_GROUP_PAGES),
                createdTruncated:
                  willCreate.length > MAX_GROUP_PAGES
                    ? { shown: MAX_GROUP_PAGES, total: willCreate.length }
                    : null,
                createdTotal: willCreate.length,
                /*
                 * `null` — "NOT MEASURED YET." How many links will be rewritten
                 * is unknown before the write: the handler decides this by
                 * checking the actual link order, and rewrites none of them if
                 * the chain is already intact. Putting a number here would mean
                 * promising something nobody established.
                 */
                restitched: null,
                layerFlagsBefore: { visible: chain.layerVisible, printable: chain.layerPrintable },
              },
              diffs: null,
              reconciliation: {
                balanced:
                  chain.frames.length - willRemove.length + willCreate.length ===
                  measure.pages.length,
              },
              message:
                "Dry run of the repair: NOTHING was changed and no copy was made. " +
                `Remove ${willRemove.length}, add ${willCreate.length}, ` +
                `chains on the layer at present ${chain.storyIds.length} (there should be 1). ` +
                (chain.layerVisible
                  ? ""
                  : "THE LAYER IS HIDDEN — that is exactly why the folios print “N–N”; the repair will restore visibility. "),
            });
          }

          const report = await runWrite<RepairThreadReport>({
            handler: "pagination_repair_helper_thread",
            params: {
              expectedDocName: measure.docName,
              stamp: backupStamp(),
              undoName: undoName ?? "Repair of the helper chain",
              folioFrameIds,
            },
            timeoutMs: APPLY_TIMEOUT_MS,
          });

          /*
           * THE §4.2 CONTRACT GUARD, AND IT MEASURES AGAIN RATHER THAN TRUSTING
           * THE REPORT.
           *
           * The same guard as in `create-helper-thread`, but here it must be
           * stricter: repair changes the chain in three places, and "as many
           * frames as pages" is no longer enough — a duplicated page was
           * measured as a state where there are exactly as many frames as
           * needed, yet the chain split into two (Question 2).
           */
          const after = await runJsx<PaginationMeasure>(
            "pagination_measure",
            {
              folioStyles: folioArg.styleNames,
              contentsNumberStyle: null,
              contentsTitleStyles: [],
              headingStyles: [],
            },
            { timeoutMs: PAGINATION_MEASURE_TIMEOUT_MS },
          );
          const chainAfter = after.helperChain;
          const stillBroken =
            chainAfter === null ||
            chainAfter.pagesWithoutFrame.length > 0 ||
            chainAfter.storyIds.length !== 1 ||
            !chainAfter.layerVisible;
          if (stillBroken) {
            throw new IndesignError(
              "jsx-error",
              "After the repair the chain REMAINED broken: " +
                (chainAfter === null
                  ? "the layer is gone"
                  : `pages without a link ${chainAfter.pagesWithoutFrame.length}, ` +
                    `chains ${chainAfter.storyIds.length}, layer ` +
                    `${chainAfter.layerVisible ? "visible" : "HIDDEN"}`) +
                ". The marker takes its number from the page of the PREVIOUS FRAME, so in such a state " +
                "every folio lies while looking correct. The plan was NOT saved.",
              `A copy from before the changes was saved: ${report.backupPath}. Undo the repair with a single Cmd+Z ` +
                "and check that nobody else's work is sitting on the layer.",
            );
          }

          const diffs = folioDiffs(report);
          assertLayoutUntouched(diffs, report.backupPath, "Repair of the helper chain");

          /*
           * A PLAN IS ISSUED, because after the repair the coverage is
           * DIFFERENT, and that's exactly what `replace-literals` with
           * `route: "auto"` needs. It's built from the same actual coverage the
           * guard just checked.
           */
          const chainOffsets = chainAfter.frames
            .filter((f) => f.pageOffset !== null)
            .map((f) => f.pageOffset!)
            .sort((a, b) => a - b);
          const verdicts = planRewrite(
            after.pages,
            after.folioFrames,
            folioArg.range,
            "auto",
            { offsets: chainOffsets, folioFrameIds },
          );
          const plan: RewritePlan = {
            planId: newRewritePlanId(),
            docName: after.docName,
            verdicts,
            chainOffsets,
            chainFolioFrameIds: folioFrameIds,
          };
          const planPath = await saveRewritePlan(plan);

          return ok({
            docName: measure.docName,
            operation,
            route: null,
            dryRun: false,
            backupPath: report.backupPath,
            planId: plan.planId,
            planPath,
            helperLayer: helperLayerBlock(after),
            alreadyAutomaticOverHelper: countAlreadyAutomaticOverHelper(after.folioFrames),
            repaired: {
              removed: report.removed,
              created: report.created,
              restitched: report.restitched,
              framesAfter: report.framesAfter,
              layerFlagsBefore: report.layerFlagsBefore,
            },
            diffs,
            reconciliation: { balanced: report.framesAfter === after.pages.length },
            message:
              `The chain has been repaired: removed ${report.removed.length}, added ` +
              `${report.created.length}, links rewritten ${report.restitched}. ` +
              `Now ${report.framesAfter} links on ${after.pages.length} pages, one ` +
              "chain, layer visible. A REPEAT RUN MUST YIELD ZEROS — if it does not, " +
              "something else is breaking the chain. " +
              (report.layerFlagsBefore.visible
                ? ""
                : "THE LAYER WAS HIDDEN and has been restored to visible: until now every automatic " +
                  "folio was printing “N–N”. "),
          });
        }

        if (operation === "create-helper-thread") {
          /*
           * THE HANDLER TAKES GEOMETRY FROM THE LIVE FRAME — only `id`s travel
           * here. Frames with `bounds === null` aren't submitted: nobody
           * measured their coordinates, and the page will get its own-bounds
           * frame anyway.
           */
          /*
           * THE GEOMETRY DONOR IS NEVER A FRAME THE ORACLE WOULD REJECT ANYWAY
           * (I4). `layerVisible === false` is `hidden-layer-frame` in step 7 and
           * `folio-dormant-duplicate` in §4.9 — a frame that isn't on the sheet.
           * The donor is chosen ONE PER PAGE, first one wins
           * (`pagination-write.jsx`), so a hidden frame encountered first used
           * to claim the helper frame for itself — while the VISIBLE folio on
           * that same page was left without a chain and (after C1) would get an
           * honest but entirely unnecessary rejection. The fixture already has
           * this state: `folio-dormant-duplicate` on page «15».
           */
          const folioFrameIds = measure.folioFrames
            .filter((f) => !f.fromMaster && f.bounds !== null && f.layerVisible)
            .map((f) => f.id);

          if (dryRun) {
            /* The chain doesn't exist yet BY CONSTRUCTION, so there's nowhere to get a
             * per-frame proof from: the oracle predicts based on the NAMED §4.2
             * contract — exactly what the handler is about to build. The
             * prediction is declared explicitly, because silence here means the
             * strictest reading ("prove it per frame"). */
            const preview = planRewrite(
              measure.pages,
              measure.folioFrames,
              folioArg.range,
              "auto",
              "contract",
            );
            return ok({
              docName: measure.docName,
              operation,
              route: null,
              dryRun: true,
              backupPath: null,
              planId: null,
              chainEvidence: "contract",
              willBuild: {
                frames: measure.pages.length,
                fromFolioGeometry: folioFrameIds.length,
                pages: measure.pages.slice(0, MAX_GROUP_PAGES).map((p) => p.name),
                pagesTruncated:
                  measure.pages.length > MAX_GROUP_PAGES
                    ? { shown: MAX_GROUP_PAGES, total: measure.pages.length }
                    : null,
              },
              helperLayer,
              alreadyAutomaticOverHelper,
              total: preview.length,
              alreadyAutomatic: counters.alreadyAutomatic,
              alreadyAutomaticFromMaster: counters.alreadyAutomaticFromMaster,
              withoutClaim: counters.withoutClaim,
              eligible: preview.filter((v) => v.eligible).length,
              applied: null,
              skipped: groupSkipped(preview),
              failed: [],
              diffs: null,
              reconciliation: reconcile(preview, groupSkipped(preview), null, 0),
              message:
                "Dry run: NOTHING was built, no copy was made, no planId was issued. " +
                "Eligibility was counted against the STATED contract “a frame on every page” — " +
                "after a real build it is counted afresh, against the actual coverage.",
            });
          }

          const report = await runWrite<HelperThreadReport>({
            handler: "pagination_create_helper_thread",
            params: {
              expectedDocName: measure.docName,
              stamp: backupStamp(),
              undoName: undoName ?? "Helper chain of folios",
              folioFrameIds,
            },
            timeoutMs: APPLY_TIMEOUT_MS,
          });

          /*
           * THE §4.2 CONTRACT GUARD ON THE TOOL'S SIDE, and it must run BEFORE
           * the plan is saved.
           *
           * Measured (Question 18): the marker prints the page of the
           * PREVIOUS FRAME IN THE CHAIN, not "current minus one." A chain with a
           * gap therefore lies on EVERY frame, and every lie looks correct. A
           * plan saved on top of such a chain would give `replace-literals`
           * permission to write that lie.
           */
          if (report.created !== measure.pages.length) {
            throw new IndesignError(
              "jsx-error",
              `The helper chain came out with a GAP: frames ${report.created}, ` +
                `but pages ${measure.pages.length}. The marker takes its number from the page of the PREVIOUS ` +
                "FRAME of the chain, so a gap shifts the numbers on every frame while leaving them " +
                "looking correct. The plan was NOT saved.",
              `A copy from before the changes was saved: ${report.backupPath}. Undo the build with a single Cmd+Z, ` +
                "delete the _folio-helper layer and repeat.",
            );
          }

          const diffs = folioDiffs(report);
          assertLayoutUntouched(diffs, report.backupPath, "Helper chain");

          /*
           * ACTUAL coverage — from what the handler REALLY placed, not from
           * what it should have. And it's TWO-FOLD, because there are two units:
           *
           *   `chainOffsets`      — which PAGES the helper frames sit on
           *                         (that's where the chain neighbor is taken from);
           *   `chainFolioFrameIds` — under exactly which FOLIOS they landed.
           *
           * The second one is the channel for `ignoredFolioFrames` (I2). The
           * handler gives a helper frame only to the FIRST folio on a page and
           * reports the rest by name; until now that knowledge went nowhere, and
           * the plan promised eligibility to frames that have no chain under
           * them. Confusing these two units was exactly C1.
           */
          const chainOffsets = report.frames.map((f) => f.offset);
          const chainFolioFrameIds = report.frames
            .map((f) => f.folioFrameId)
            .filter((id): id is string => id !== null);
          const verdicts = planRewrite(
            measure.pages,
            measure.folioFrames,
            folioArg.range,
            "auto",
            { offsets: chainOffsets, folioFrameIds: chainFolioFrameIds },
          );

          const plan: RewritePlan = {
            planId: newRewritePlanId(),
            docName: measure.docName,
            verdicts,
            chainOffsets,
            chainFolioFrameIds,
          };
          const planPath = await saveRewritePlan(plan);

          return ok({
            docName: measure.docName,
            operation,
            route: null,
            dryRun: false,
            backupPath: report.backupPath,
            planId: plan.planId,
            planPath,
            chainEvidence: "report",
            helper: {
              layerName: report.layerName,
              layerCreated: report.layerCreated,
              layerFlagsBefore: report.layerFlagsBefore,
              created: report.created,
              fromFolioGeometry: report.frames.filter((f) => f.source === "folio").length,
              ignoredFolioFrames: report.ignoredFolioFrames,
            },
            /*
             * FROM THE WRITE REPORT, NOT FROM THE MEASUREMENT — AND THIS WAS
             * FOUND BY A RUN ON THE BOOK.
             *
             * `helperLayer` is computed from `measure`, and the measurement here
             * was taken BEFORE the build, when the layer didn't exist yet. So
             * the very first wet run on a copy of the book returned
             * `helperLayer: null` right after creating a layer of 196 frames —
             * i.e. the report contradicted the work it had just done.
             *
             * This is exactly the same class as finding I8: the layer block
             * must tell the truth in EVERY response, not just where the
             * measurement happened to land at the right moment. A second
             * measurement isn't taken for this (it costs a pass over the whole
             * document) — everything needed is already in the handler's report,
             * and it sets the flags itself, unconditionally (§4.8), so
             * `visible: true, printable: false` here isn't a guess.
             *
             * `pagesWithoutFrame: 0` isn't a guess either: the guard above
             * throws if `report.created !== measure.pages.length`, so this line
             * can only be reached with full coverage.
             */
            helperLayer: {
              layerName: report.layerName,
              visible: true,
              printable: false,
              locked: false,
              frames: report.created,
              pagesWithoutFrame: 0,
              chains: 1,
            },
            alreadyAutomaticOverHelper,
            total: verdicts.length,
            alreadyAutomatic: counters.alreadyAutomatic,
            alreadyAutomaticFromMaster: counters.alreadyAutomaticFromMaster,
            withoutClaim: counters.withoutClaim,
            eligible: verdicts.filter((v) => v.eligible).length,
            /*
             * `null`, NOT 0, AND THIS ISN'T PEDANTRY. This operation doesn't
             * replace literals at all; a zero here would read as "tried and
             * failed" and would also make the §7 loud error "eligible > 0 but
             * applied === 0" unreachable — it would fire on EVERY successful
             * build.
             */
            applied: null,
            skipped: groupSkipped(verdicts),
            failed: [],
            diffs,
            reconciliation: reconcile(verdicts, groupSkipped(verdicts), null, 0),
            message:
              `Chain built: ${report.created} frames on layer "${report.layerName}". ` +
              "THE LAYER MUST REMAIN VISIBLE — a hidden one suppresses marker resolution. " +
              /*
               * I2: `ignoredFolioFrames` used to live in the response and lead
               * nowhere — the same class as `masterSkipped`: the knowledge
               * exists, the channel doesn't. Now it leads to TWO places: by name
               * into the oracle's `skipped` (since coverage is passed per
               * frame), and here, into words, because the operator must see the
               * number of skipped folios BEFORE the second call. This isn't a
               * loud error: two folios on a page is a legitimate layout state
               * (29 of them on the working book).
               */
              (report.ignoredFolioFrames.length > 0
                ? `${report.ignoredFolioFrames.length} folio(s) did NOT get a helper frame ` +
                  "(see helper.ignoredFolioFrames) — on those the marker has nothing to resolve against, " +
                  "and replace-literals will skip them. "
                : "") +
              `Next: pagination_apply with operation "replace-literals", route "auto" and planId "${plan.planId}".`,
          });
        }

        /* ── replace-literals ────────────────────────────────────────── */

        /*
         * ELIGIBILITY HERE ISN'T TAKEN FROM THE PLAN AND ISN'T TAKEN FROM THE
         * CONTRACT — IT'S PROVEN PER FRAME, from the fresh measurement's
         * `overlaps` (C1).
         *
         * §4.5 justified the `planId → chainOffsets` channel by saying "helper
         * frames don't belong to the folio family, so a re-measurement doesn't
         * see them." Half of that claim is wrong, and this is measured (final
         * review, probe 3): helper frames indeed don't become CLAIM frames, but
         * in `ClaimFrame.overlaps` they're all visible to the folio — `overlaps:
         * 1`, `previousPage` is correct, because the geometry matches exactly.
         * So the thing supposedly unknowable any other way is actually in the
         * measurement, and in the RIGHT unit — per frame.
         *
         * What the plan gives instead — I3: it's finally VERIFIED (below), as
         * §4.5 promised.
         */
        const verdicts = planRewrite(measure.pages, measure.folioFrames, folioArg.range, route!);

        if (planId !== undefined) {
          /* Document verification — inside: the plan was built for a specific
           * document, and a different one could well be the active one (§4.5). */
          const plan = await loadRewritePlan(planId, expectedDocName);
          assertPlanStillHolds(plan, verdicts, planId);
        }

        const eligible = verdicts.filter((v) => v.eligible);
        const edits = editsFor(measure, verdicts);

        /*
         * HOW MANY NUMBERS THE HELPER LAYER KEEPS — ONE NUMBER FOR THE WHOLE
         * RESPONSE, and it isn't here for symmetry with `willWrite` (I7).
         *
         * `willWrite` exists ONLY in a dry run, whereas the operator's decision
         * that "the layer is no longer needed" is made exactly AFTER a
         * successful write — once the frames already carry markers and there
         * are no more manual numbers that would reveal breakage. §4.8 calls
         * removing the layer the standard rollback action; Question 8 measured
         * its cost (`visible = false` → 13 instead of 12 in the PDF, i.e.
         * "N–N" on every such folio). So the counter rides in both responses,
         * not just the one with a per-frame list.
         *
         * ELIGIBLE verdicts are counted, not all of them: dependency on the
         * layer is created by exactly what's about to be written.
         */
        const resolvedByHelper = eligible.filter((v) => v.resolvedBy === "helper").length;
        /*
         * The warning APPEARS ONLY WHEN TRUE. Written "always," it would become
         * noise exactly where the main chain is older and the layer really can
         * be removed — and §7 forbids turning a loud error into a habit.
         */
        /*
         * TWO TERMS, AND THE SECOND ONE CLOSES I8. The first — frames that will
         * be written NOW (from verdicts). The second — frames CONVERTED EARLIER:
         * they have no verdict at all, so on a repeat run the first term is
         * zero, and without the second the report would stay silent about the
         * layer all the book's markers depend on. That's exactly what was
         * measured on the second run: 84 automatic frames with
         * `resolvedByHelper: 0`.
         */
        const helperDependent = resolvedByHelper + alreadyAutomaticOverHelper;
        const helperWarning =
          helperDependent === 0
            ? ""
            : ` ${helperDependent} folio(s) take their number from the HELPER chain: ` +
              `${resolvedByHelper} of ${eligible.length} that will be written now, and ` +
              `${alreadyAutomaticOverHelper} converted earlier. The _folio-helper layer ` +
              "MUST NOT be removed or hidden: it was measured (Question 8) that a hidden layer " +
              "suppresses resolution, and these folios will silently become “N–N”. Being non-printable " +
              "(printable = false) has no such effect.";

        const head = {
          docName: measure.docName,
          operation,
          route: route!,
          planId: planId ?? null,
          chainEvidence: "measured",
          total: verdicts.length,
          alreadyAutomatic: counters.alreadyAutomatic,
          alreadyAutomaticFromMaster: counters.alreadyAutomaticFromMaster,
          withoutClaim: counters.withoutClaim,
          eligible: eligible.length,
          resolvedByHelper,
          helperLayer,
          alreadyAutomaticOverHelper,
          skipped: groupSkipped(verdicts),
        };

        if (dryRun) {
          return ok({
            ...head,
            dryRun: true,
            backupPath: null,
            applied: null,
            failed: [],
            diffs: null,
            /* Exactly what goes to the handler, in the same order. */
            willWrite: edits,
            reconciliation: reconcile(verdicts, head.skipped, null, 0),
            message:
              "Dry run: NOTHING was written and no copy was made. Every number in " +
              "expectedLiteral matches what the marker will print — otherwise the frame would be in " +
              "skipped." + helperWarning,
          });
        }

        if (eligible.length === 0) {
          /*
           * NOT AN ERROR, and it's important to distinguish this from the
           * silence below. Zero eligible is a legitimate state (§3: low
           * coverage bounds the scope of BENEFIT, not of safety), and every
           * rejection here is given a named reason in `skipped`.
           */
          return ok({
            ...head,
            dryRun: false,
            backupPath: null,
            applied: 0,
            failed: [],
            diffs: null,
            reconciliation: reconcile(verdicts, head.skipped, 0, 0),
            message:
              "There are no eligible frames — nothing was written and no copy was made. This is not a failure: " +
              "the reason for every refusal is named in skipped.",
          });
        }

        const report = await runWrite<ReplaceLiteralsReport>({
          handler: "pagination_replace_literals",
          params: {
            expectedDocName: measure.docName,
            stamp: backupStamp(),
            undoName: undoName ?? "Automatic folios",
            edits,
          },
          timeoutMs: APPLY_TIMEOUT_MS,
        });

        /*
         * THE PHASE'S MOST LIKELY FAILURE MODE (§7), AND IT COMES FIRST.
         *
         * Silent inaction that reads as success: the handler honestly returns
         * `applied: 0` and a full `failed`, and without this check the tool
         * would return a normal response with a zero — i.e. "nothing needed
         * doing" instead of "nothing worked." Phase 6's first run gave
         * "0 findings on 91 frames," and that was a lie about the book.
         */
        if (report.applied === 0) {
          const reasons = report.failed
            .slice(0, 5)
            .map((f) => `p. ${f.page}, frame ${f.frameId}: ${f.error}`)
            .join("; ");
          throw new IndesignError(
            "jsx-error",
            `There were ${eligible.length} eligible frames, and NOT ONE was written. This is not “there was nothing ` +
              `to do” but the failure of all ${report.failed.length} write attempts. ` +
              `Reasons: ${reasons}${report.failed.length > 5 ? "; …" : ""}`,
            `A copy from before the changes was saved: ${report.backupPath}. The likeliest reason is that the document ` +
              "changed between the measurement and the write: re-measure (pagination_audit) and repeat.",
          );
        }

        const diffs = folioDiffs(report);
        assertLayoutUntouched(diffs, report.backupPath, "Writing markers");

        const reconciliation = reconcile(verdicts, head.skipped, report.applied, report.failed.length);
        if (!reconciliation.balanced) {
          /*
           * §7: a discrepancy demands INVESTIGATION, not a re-run. Re-running on
           * a document where something has already landed is the fastest way to
           * turn a confusing state into an irreversible one.
           */
          throw new IndesignError(
            "jsx-error",
            "The reconciliation does not balance (reconciliation.balanced === false): " +
              `total ${reconciliation.total}, eligible ${reconciliation.eligible}, ` +
              `skipped ${reconciliation.skipped}, applied ${reconciliation.applied}, ` +
              `failed ${reconciliation.failed}. Some paragraphs were lost from the accounting.`,
            `A copy from before the changes was saved: ${report.backupPath}. Do NOT repeat the write: first ` +
              "find out which paragraphs fell out of the accounting.",
          );
        }

        return ok({
          ...head,
          dryRun: false,
          backupPath: report.backupPath,
          applied: report.applied,
          failed: report.failed,
          diffs,
          reconciliation,
          message:
            `Wrote ${report.applied} marker(s). Not one number on the sheet changed — ` +
            "what changed is the way it gets there. Check at least a few pages by eye: " +
            "the literal-based audit is blind to these frames from now on, they are guarded only by the marker " +
            "detectors." + helperWarning,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );
}

/**
 * The §5.2 summary — and the ONLY place that verifies no paragraph was lost.
 *
 * ONE UNIT EVERYWHERE — THE CLAIM PARAGRAPH (§4.4). Mixing frames with
 * paragraphs here would mean returning `balanced: false` for no actual loss,
 * i.e. turning the §7 loud error into noise people learn to ignore.
 *
 * `applied === null` means "this operation doesn't replace literals"
 * (`create-helper-thread`), not "replaced zero." The second equation then simply
 * has no sides, and demanding it hold would mean inventing a loss where nothing
 * was taken in the first place.
 */
export function reconcile(
  verdicts: FrameVerdict[],
  groups: SkipGroup[],
  applied: number | null,
  failed: number,
): {
  balanced: boolean;
  total: number;
  eligible: number;
  skipped: number;
  applied: number | null;
  failed: number;
} {
  const total = verdicts.length;
  const eligible = verdicts.filter((v) => v.eligible).length;
  /*
   * THE SUM COMES FROM THE GROUPED GROUPS, NOT FROM `total − eligible`, AND
   * THAT'S EXACTLY WHAT MAKES THE FIRST EQUATION A CHECK RATHER THAN A
   * TAUTOLOGY. The operator reads `skipped` as a list of groups; if the
   * grouping drops a reason (e.g. a verdict with `eligible: false` and
   * `reason: null`), a whole batch would vanish from the list, and the
   * difference of two counters wouldn't notice — it counts the same verdicts.
   */
  const skipped = groups.reduce((sum, g) => sum + g.count, 0);
  const balanced =
    total === eligible + skipped && (applied === null || eligible === applied + failed);
  return { balanced, total, eligible, skipped, applied, failed };
}

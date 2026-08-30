/**
 * The Phase 7 ORACLE (spec §4.4): whether a manual number can be replaced by
 * an automatic marker so that NOTHING on the sheet changes. Pure TypeScript.
 *
 * THE END-TO-END PRINCIPLE (§3): the tool must never write a number different
 * from what's in the frame right now. Existing manual numbers are a ready-made
 * oracle: compute which page the marker would resolve to, and if that isn't
 * equal to the existing number, the frame is NOT TOUCHED. So this module's job
 * isn't "convert as much as possible," it's REJECT AS PRECISELY AS POSSIBLE:
 * low coverage bounds the scope of benefit, not of safety, whereas a false
 * "eligible" is a lying marker in the book, and §3 calls that a worse failure
 * mode than a manual number (a manual number gets caught by the audit, a
 * lying marker looks correct).
 *
 * THE GATE IS THE ORACLE ITSELF, PER FRAME (§3.1). There is no, and cannot be,
 * a separate precondition of "only work when `deviating === 0`": the audit's
 * rule (`literal ∈ {own} ∪ siblings`) is strictly weaker than the oracle's rule
 * (`literal === the specific neighbor on the required side`), and a measured
 * counterexample exists — a frame «97» on recto p. 97 satisfies the audit, but
 * the oracle expects 96 and rejects it.
 *
 * THE UNIT IS THE CLAIM PARAGRAPH, as in Phase 6's findings (`folio-manual` is
 * generated per paragraph). Phase 6's counters don't change because of this:
 * `checked` and `notCompared` count FRAMES, and "aligning" them to paragraphs
 * would mean breaking an already-merged tool for the sake of cosmetics.
 */

import { pageNumber } from "./folio.js";
import type { FolioRange, FrameVerdict, MarkerDirection, SkipReason } from "./rewrite-types.js";
import {
  documentThreadLinks,
  helperChainWins,
  mainThreadLinks,
  resolveFromLinks,
} from "./topology.js";
import type { ClaimFrame, ClaimParagraph, PageRef } from "./types.js";

/**
 * What the operator is asking for. `"auto"` derives the route from the layout
 * (§4.2); `"thread"` and `"helper"` remain a forced-document override — an
 * emergency exit, not an equal alternative.
 */
export type RouteRequest = "thread" | "helper" | "auto";

/**
 * The marker direction from the page side and the DECLARED range convention
 * (§4.3).
 *
 * Mirroring is a PARAMETER, NOT A FACT OF THIS BOOK (§3.2). "On recto the
 * manual number is on the left" is this layout's convention: a book that
 * prints a forward range on recto is mirrored relative to the §4.3 table, and
 * on it a tool with `backward` hardcoded would produce `oracle-mismatch` on
 * 100% of frames. The measurement (Question 2) CONFIRMS the `backward` value
 * for this book — 91 out of 91 — it doesn't generate the rule.
 *
 * `SINGLE_SIDED` never reaches here: step 2 rejects it earlier, because a
 * single-sided document has no spread side at all.
 */
function directionFor(side: "LEFT_HAND" | "RIGHT_HAND", range: FolioRange): MarkerDirection {
  const backward: MarkerDirection = side === "RIGHT_HAND" ? "previous" : "next";
  if (range === "backward") return backward;
  return backward === "previous" ? "next" : "previous";
}

/**
 * An ordered, deduplicated list. Factored out HERE, not into
 * `helperChainNeighbour`, for the same reason `nameCount` lives in
 * `PageIndex`: the neighbor lookup runs for EVERY frame, and a `Set` + `sort`
 * there would cost exactly what the neighboring docstring already opted out
 * of.
 */
function sortedUnique(offsets: readonly number[]): number[] {
  return [...new Set(offsets)].sort((a, b) => a - b);
}

/**
 * THE HELPER CHAIN CONTRACT (§4.2, "THE HELPER CHAIN MUST BE UNBROKEN"): the
 * `offset` of pages where the chain builder is REQUIRED to place a helper
 * frame. The list is ORDERED and deduplicated — exactly the shape
 * `helperChainNeighbour` consumes.
 *
 * "EVERY PAGE OF THE RANGE" — AND HERE THE RANGE IS THE WHOLE DOCUMENT, NOT A
 * SUBSET. The `pages[]` measurement is produced by looping over `doc.pages`
 * with no filter at all (`src/jsx/pagination.jsx`), so today "the range" and
 * "all measured pages" are the same thing, and the difference is invisible
 * anywhere. Writing "range" here while the code means "all measured" would
 * allow it to be read as a SUBrange: then on the subrange's first page the
 * oracle would promise the page name `offset − 1`, for which no helper frame
 * gets created — the same lie, just at the boundaries.
 *
 * THIS IS A NAMED ORACLE ASSUMPTION, NOT CONVENIENCE. The oracle on the
 * `helper` route must predict the number BEFORE the chain exists, so it
 * inevitably relies on the rule that builds it. The rule "a frame wherever
 * there's a folio" would give a chain on odd pages only on this book (all 91
 * folios are on recto), and a frame on p. 97 would print "95–97": 91 lying
 * markers out of 91, each looking correct (§3, the worse failure mode).
 *
 * THIS IS NO LONGER DERIVED, IT'S MEASURED (Question 18, 2026-08-08): over a
 * chain built from odd pages only, the marker on p. 3 printed "1," on p. 5 —
 * "3," on p. 7 — "5." In all three cases what's printed is the page of the
 * PREVIOUS FRAME IN THE CHAIN, not `offset − 1`.
 */
export function helperChainOffsets(pages: PageRef[]): number[] {
  return sortedUnique(pages.map((p) => p.offset));
}

/**
 * The page that the `direction` marker will resolve to in a helper chain
 * threaded across the `sortedChainOffsets` pages.
 *
 * PRECONDITION: the list is ordered and deduplicated. Normalization is done by
 * `helperChainOffsets` (or `buildPageIndex` for a list supplied from outside)
 * — ONCE per document, not once per frame.
 *
 * THIS IS NOT "`offset ± 1`," AND THIS IS EXACTLY WHERE THE 91-FRAME BUG
 * LIVED. A measured boundary (H6, case C, recorded for `ThreadLink`; confirmed
 * by Question 18 on a chain with a gap): `PREVIOUS_PAGE_NUMBER` gives the
 * `previousPage` page — i.e. the page of the PREVIOUS FRAME IN THE CHAIN. The
 * two quantities coincide exactly when the chain is unbroken — which is why
 * this looks up the neighbor IN THE CHAIN ITSELF, not arithmetic over
 * `offset`.
 *
 * `null` — there's no previous (next) frame in the chain at all.
 */
export function helperChainNeighbour(
  sortedChainOffsets: readonly number[],
  byOffset: ReadonlyMap<number, PageRef>,
  page: PageRef,
  direction: MarkerDirection,
): PageRef | null {
  const here = sortedChainOffsets.indexOf(page.offset);
  if (here === -1) return null;
  const neighbour = sortedChainOffsets[here + (direction === "previous" ? -1 : 1)];
  if (neighbour === undefined) return null;
  return byOffset.get(neighbour) ?? null;
}

/**
 * Pages reduced to what the oracle asks for. Built ONCE per `planRewrite`
 * call, not per frame: otherwise `nameCount` would cost O(n²) on a book with
 * as many frames as pages.
 */
export interface PageIndex {
  byName: Map<string, PageRef>;
  byOffset: Map<number, PageRef>;
  /** How many pages carry this name. More than one — see `ambiguous-page-name`. */
  nameCount: Map<string, number>;
  /** Exactly what the oracle knows about the helper chain. */
  chain: ChainIndex;
}

/**
 * WHAT THE ORACLE KNOWS ABOUT THE HELPER CHAIN — and this is a decision about
 * the CLAIM UNIT, not about call-site convenience.
 *
 * `"measured"` (the default, i.e. what results from the field's ABSENCE) — the
 * chain either lies under this frame or it doesn't, and the answer comes from
 * this frame's own measurement. This is the only state in which WRITING is
 * allowed: InDesign's physics ties marker resolution to the FRAME the folio
 * overlaps, not to the page it sits on.
 *
 * `"contract"` — the chain doesn't exist yet BY CONSTRUCTION (a
 * `create-helper-thread` dry run), so there's nowhere to get a per-frame proof
 * from; the oracle predicts based on the named §4.2 contract, "a frame on
 * EVERY page."
 *
 * The object is the ACTUAL coverage from the builder's report, and it too is
 * per-frame: `offsets` says which pages have frames (that's where the chain
 * neighbor is taken from), `folioFrameIds` says under exactly which folios
 * they landed. The second one is the channel for `ignoredFolioFrames`: a folio
 * that didn't get a helper frame (two on the same page, a hidden layer,
 * unreadable bounds) used to silently get "eligible."
 *
 * WHY THE DEFAULT IS SPECIFICALLY `"measured"`. The rule is wider than this
 * file and already cost the phase a round (`dryRun`): the safe value must be
 * the one that results from the field's ABSENCE. A prediction is a promise
 * about the document's future state; a silent promise is only allowed where
 * nobody writes anything.
 */
export type ChainForecast =
  | "contract"
  | { readonly offsets: readonly number[]; readonly folioFrameIds: readonly string[] };

type ChainIndex =
  | { kind: "measured" }
  | { kind: "contract"; offsets: number[] }
  | { kind: "report"; offsets: number[]; covered: Set<string> };

/**
 * THE ONLY PLACE `chainOffsets` IS BORN, AND THIS IS THE MAIN FIX FROM REVIEW
 * `bd3c602`.
 *
 * Until now the contract guard checked the oracle's promise against its OWN
 * FRESH CALL to `helperChainOffsets(pages)`, not against the list the oracle
 * had actually used. Both sides of the identity were taken from different
 * places, and the reviewer demonstrated by execution that a mutation could be
 * slipped between them: narrow the contract **at the call site**
 * (`helperChainOffsets(pages.filter(recto))`) AND remove the step 6 check —
 * `1260 passed`, complete silence, i.e. literally "91 lying markers out of
 * 91."
 *
 * So the construction is factored into a function called by both
 * `planRewrite` and the test: there's simply no second build path, and there's
 * nowhere left to narrow the list unnoticed by the guard.
 *
 * A PREDICTION IS A PARAMETER, AND WITHOUT ONE THERE ISN'T ONE (§4.5). Until
 * now the default was the named §4.2 contract, and that very default carried
 * C1: where the chain was ALREADY built, the oracle would still answer from
 * the per-page list — i.e. about the page — to a question about the FRAME.
 * The field's absence now means `"measured"`: prove it per frame, or refuse.
 */
export function buildPageIndex(pages: PageRef[], forecast?: ChainForecast): PageIndex {
  const nameCount = new Map<string, number>();
  for (const p of pages) nameCount.set(p.name, (nameCount.get(p.name) ?? 0) + 1);
  let chain: ChainIndex;
  if (forecast === undefined) {
    chain = { kind: "measured" };
  } else if (forecast === "contract") {
    chain = { kind: "contract", offsets: helperChainOffsets(pages) };
  } else {
    chain = {
      kind: "report",
      offsets: sortedUnique(forecast.offsets),
      covered: new Set(forecast.folioFrameIds),
    };
  }
  return {
    byName: new Map(pages.map((p) => [p.name, p])),
    byOffset: new Map(pages.map((p) => [p.offset, p])),
    nameCount,
    chain,
  };
}

/**
 * The verdict for ONE claim paragraph — the §4.4 seven steps, in their order.
 *
 * STEP ORDER IS PART OF THE RULE, NOT FORMATTING. Cheap rejections come first,
 * and `oracle-mismatch` stands BEFORE the marker check, so that a frame with a
 * wrong number isn't diagnosed as a topology problem and doesn't send the
 * operator off to fix a chain nobody broke.
 */
function verdictFor(
  index: PageIndex,
  frame: ClaimFrame,
  para: ClaimParagraph,
  range: FolioRange,
  request: RouteRequest,
): FrameVerdict {
  const base = { frameId: frame.id, page: frame.page, paragraphIndex: para.index };
  /*
   * Fields are filled in AS THEY GET ESTABLISHED, not with "zeros just in
   * case": `expected: null` in a skip means "the expected number was never
   * computed," and that's exactly what makes it useful to the operator. The
   * `expected === current` invariant applies ONLY to eligible verdicts.
   */
  const skip = (reason: SkipReason, known: Partial<FrameVerdict> = {}): FrameVerdict => ({
    ...base,
    eligible: false,
    reason,
    current: null,
    expected: null,
    direction: null,
    route: null,
    resolvedBy: null,
    ...known,
  });

  /* Step 1. Literals. Zero never reaches here (see `planRewrite`) — that's
   * `alreadyAutomatic`, a separate counter outside `total` and outside both
   * §5.2 equations. More than one — which one to replace is unknown. */
  if (para.literals.length > 1) return skip("multiple-literals");
  const current = para.literals[0]!;

  /*
   * The frame's own page is looked up BY NAME, because `ClaimFrame` doesn't
   * carry another key. Everything that CAN be matched by `offset` (§4.4 step
   * 3) is matched by it below.
   *
   * TWO SAME-NAMED PAGES ARE INDISTINGUISHABLE, BUT DETECTABLE, AND THAT
   * DIFFERENCE IS DECISIVE. A `Map` keeps the LAST of the same-named pages, so
   * the frame would be checked against the wrong spread — and `side`,
   * `offset`, and `spreadSiblings` would all come from there too. Reproduced by
   * review `f5d3509` (PROBE A): a frame on the first "97" with literal 42 gave
   * `eligible: true`, while 96 would have printed. Until now this was called
   * "indistinguishable on input" and left at that — wrongly: you can't tell
   * them apart, but you CAN refuse, and refusal here is the only safe side
   * (§3).
   */
  if ((index.nameCount.get(frame.page) ?? 0) > 1) return skip("ambiguous-page-name", { current });
  const pg = index.byName.get(frame.page);
  if (pg === undefined) return skip("page-unmeasured", { current });

  /* Step 2. Side. */
  if (pg.side === "SINGLE_SIDED") return skip("single-sided", { current });
  const direction = directionFor(pg.side, range);

  /* Step 3. Neighbor. Both bounds come from `spreadSiblings`, i.e. from the
   * spread composition InDesign itself knows: "±1" arithmetic here would be a
   * constant of this layout, not a reference derived from the document
   * (§3.2). */
  if (pg.spreadSiblings.length === 0) return skip("no-siblings", { current, direction });
  if (pg.spreadSiblings.length > 1) return skip("spread-not-pair", { current, direction });

  /*
   * THE NEIGHBOR IS TAKEN BY `offset`, AND THIS IS NOT AN OPTIMIZATION.
   * `spreadSiblings` gives NAMES, and a name map overwrites the pages of two
   * sections with identical names (`detectFolio` builds exactly such a map) —
   * meaning choosing a neighbor by name could give a page from a different
   * part of the book, and the oracle would be checking a number against the
   * wrong spread.
   *
   * DIRECTION DETERMINES WHICH NEIGHBOR EXACTLY, not the spread composition.
   * Until now this was a deliberate divergence from the spec; a lead decision
   * for the phase (`7f3d610`) folded it into §4.3 as a rule: the oracle asks
   * what will be PRINTED (the neighbor by `offset`), while `spreadSiblings`
   * remains the source for the detector that asks what SHOULD have been
   * named. So the number the marker prints is set by `offset`, not by spread
   * membership.
   * Under `backward` (this book's convention) both rules are IDENTICAL: in a
   * two-page spread the recto neighbor on the left is page `offset − 1`, the
   * verso neighbor on the right is `offset + 1`, and a spread that isn't
   * two-page is already rejected by step 3. Under `forward` there's no
   * identity at all: a forward range names the page ACROSS the gutter, and the
   * §4.3 wording doesn't work for it.
   */
  const target = pg.offset + (direction === "previous" ? -1 : 1);
  const sibling = index.byOffset.get(target);
  if (sibling === undefined) {
    /*
     * A NEGATIVE `offset` MEANS "THE PAGE DOESN'T EXIST," not "wasn't
     * measured," and the two must not be confused: `offset` is absolute and
     * 0-based, so no document has a page at −1 (the frame sits on the book's
     * first page, and the marker looks backward). Everything else really is
     * "wasn't measured": whether the page exists and simply didn't make it
     * into the measurement is something the oracle can't see from here, and a
     * second answer can't be invented. This is about what the OPERATOR reads:
     * a reason nobody established is the same reproach §4.4 levels at
     * `no-siblings`.
     */
    const reason = target < 0 ? "no-neighbour-page" : "page-unmeasured";
    return skip(reason, { current, direction });
  }

  /* Step 4. The neighbor's name doesn't parse («iv», «Дод-3» are legitimate
   * names). The same blind spot as `folio-unparsable`, and the same parsing
   * function. */
  const expected = pageNumber(sibling.name);
  if (expected === null) return skip("unparsable-page-name", { current, direction });

  /* Step 5. CHECKING AGAINST THE EXISTING NUMBER — the oracle proper. The
   * reason is INFORMATIVE, not an alarm about a broken audit: the oracle's
   * rule is strictly stronger than the audit's rule, so a divergence between
   * two different rules is normal (§3.1). */
  if (current !== expected) return skip("oracle-mismatch", { current, expected, direction });

  /*
   * THE ORACLE COMPARES A NUMBER, BUT WHAT'S ON THE SHEET IS A STRING.
   * `pageNumber` accepts `/^\d+$/`, so the name «096» gives 96, literal 96
   * matches — and the frame would come out eligible, even though "096" would
   * have printed instead of "96" (review `f5d3509`, PROBE B; a section
   * numbering style of «001, 002, 003» is a standard InDesign choice). The
   * same root cause as in `ambiguous-page-name`.
   *
   * WHAT THE MARKER ACTUALLY PRINTS FOR A NON-NUMERIC NAME FORM IS NOT
   * MEASURED. So this is a rejection, not a guess: the condition is
   * over-rejecting (any name that isn't the canonical decimal form of its own
   * number), and that's the correct side to err on — §3 allows losing
   * coverage and doesn't allow writing a number different from the existing
   * one.
   */
  if (sibling.name !== String(expected)) {
    return skip("non-canonical-page-name", { current, expected, direction });
  }

  /*
   * A MASTER FRAME IS REJECTED BEFORE TOPOLOGY, NOT AFTER IT — and this was
   * MOVED by this very fix, together with C1.
   *
   * Until now the rejection stood in step 7, next to the locks, and rested on
   * step 6 skipping the master frame anyway: the `helper` branch accepted it
   * from the per-page list. Since eligibility is now proven PER FRAME, a
   * master frame has nothing to prove it with — it's physically absent from
   * the document page, and it will never have overlaps. Leaving the rejection
   * further down would mean reporting `no-neighbour-frame`, i.e. sending the
   * operator off to fix a chain its frame has nothing to do with — exactly the
   * reproach §4.4 levels at `no-siblings`.
   *
   * AFTER STEP 5, NOT BEFORE IT: the rule "a wrong number gets diagnosed
   * first" still holds, so a master frame with a foreign number still gets
   * `oracle-mismatch`. The underlying cause hasn't changed —
   * `page.masterPageItems` gives an entry for EVERY page with that master, and
   * the entry's `id` is the `id` of the object itself, one for all entries
   * (`src/jsx/pagination.jsx`). Without this rejection, one physical object
   * would give TWO eligible verdicts with the SAME `frameId` and different
   * `expected` (review `f5d3509`, PROBE H: 96 and 98) — a self-contradicting
   * plan, with nothing for the write handler to choose between. And a write,
   * had it gone through, would have changed every page with that master at
   * once.
   *
   * On this book the cause is inert (three master folios carry
   * `⟨PREVIOUS⟩–⟨AUTO⟩` with no literal at all, meaning they get no verdict in
   * the first place) — but inertness here is a property of the BOOK, not of
   * the rule.
   *
   * `route` in this skip stays `null` ON PURPOSE: there's never a route for a
   * frame that isn't on a document page, and naming one would mean reporting
   * something established that nobody established.
   */
  if (frame.fromMaster) return skip("master-frame", { current, expected, direction });

  /*
   * A HIDDEN FRAME IS REJECTED RIGHT HERE, NEXT TO THE MASTER, AND THIS WAS
   * MOVED together with C1. Until now the condition stood last in step 7, and
   * rested on the same fact: a hidden frame passed topology anyway — the
   * `helper` branch accepted it from the per-page list. From now on a
   * per-frame proof is unreachable for it — and not by accident, but BY OUR
   * OWN DECISION: a hidden folio can no longer be the geometry donor for a
   * helper frame (I4), so it will never have a chain underneath it. Leaving
   * the rejection further down would mean reporting `no-neighbour-frame` —
   * i.e. naming the consequence of our own choice as the cause, and sending
   * the operator off to fix a chain instead of being told about the layer.
   *
   * TASK 11'S ANSWER TO TASK 9'S FINDING. The oracle used to accept the
   * fixture's frame `id=1473` as eligible — page «15», layer `Numeratsiia`,
   * `visible: false`, content «14–⟨previous⟩», `current === expected === 14`,
   * i.e. flawless BY THE NUMBER. §4.9 calls that same frame
   * `folio-dormant-duplicate` — a "dormant landmine." Two parts of the system
   * silently disagreed.
   *
   * FIRST, SELF-SUFFICIENT GROUND: ZERO BENEFIT, NONZERO COST. A hidden frame
   * doesn't print — there's no point making it self-updating (§1 launched the
   * phase for the sake of the SHEET). The cost is named in §4.9's first
   * paragraph: after the replacement this frame's audit is blind forever,
   * since findings are only generated inside
   * `if (para.literals.length > 0)`. So the replacement strips the literal
   * signal from a frame the system has already flagged as a defect.
   *
   * SECOND, INDEPENDENT GROUND: NOT MEASURED. Question 8 measured a hidden
   * HELPER CHAIN layer; nobody measured the reverse configuration — a marker
   * in a hidden frame over a VISIBLE chain. §3 allows losing coverage and
   * doesn't allow writing a number nobody vouches for.
   *
   * `layerPrintable` DOES NOT ENTER HERE: it's measured that `printable =
   * false` doesn't break resolution (16 out of 16). That's exactly what the
   * helper layer is built on (§4.8), so extending the condition to the second
   * flag would mean rejecting every frame the phase itself prepares.
   *
   * `route` here, like for the master frame, stays `null`: the frame will
   * never get a route, and naming one would mean reporting something
   * established that nobody established.
   */
  if (!frame.layerVisible) {
    return skip("hidden-layer-frame", { current, expected, direction });
  }


  /*
   * Step 6. Marker resolution — and ROUTE first, because it's a property of
   * the FRAME (§4.2), not a global switch.
   *
   * THREE STATES FOR `overlaps`, `?? []` IS FORBIDDEN. `null` means "not
   * counted," and such a frame cannot be eligible under any route: under
   * `thread`, it's unknown where the marker resolves; under `helper`, it's
   * unknown whether the frame overlaps the main chain, which the helper chain
   * can't outrank anyway.
   */
  const links = documentThreadLinks(frame);
  if (links === null) return skip("overlaps-unmeasured", { current, expected, direction });

  /*
   * OVERLAPPING THE MAIN CHAIN FORCES `thread` REGARDLESS OF WHAT THE OPERATOR
   * ASKED FOR, and that's not arbitrary, it's measured: the chain CREATED
   * EARLIER wins (Question 9, 5 out of 5 cases; neither z-order, nor container
   * count, nor overlap area matters), and the phase adds the helper chain to
   * the finished document LAST. So wherever a folio overlaps the main text,
   * the marker takes its number from that chain, and `helper` as a request
   * changes nothing — promising otherwise would mean writing a marker whose
   * number is determined by a chain other than the one we were looking at.
   *
   * "THE MAIN CHAIN," NOT JUST "A DOCUMENT CHAIN" — AND THIS IS EXACTLY WHERE
   * THE C1 HOLE WAS. A helper frame is created with geometry that EXACTLY
   * matches the folio's bounds (§4.2), so once the chain is built, it's
   * necessarily present in `overlaps`. Because of that, the condition
   * "`links.length > 0` → `thread`" gave the opposite of what was intended:
   * the `helper` branch stayed reachable EXACTLY WHEN the measurement had just
   * proven there was NO helper frame under this frame — and that's precisely
   * where the oracle used to accept the frame as eligible off the PER-PAGE
   * list. Reproduced by a printed number across three inputs ("2–3" → "3–3"
   * with `applied: 3`, `skipped: []`), two of them on a sanctioned
   * `route: "auto"` with a valid `planId`. The route is now derived from WHAT
   * EXACTLY lies underneath the frame.
   *
   * Master overlaps never reach here at all: `documentThreadLinks` filters
   * them out, because a master's chain doesn't resolve for a document page
   * (Questions 6 and 13). Arithmetic makes this decisive — on the working
   * book 90 out of 91 frames have overlaps, ALL of them master ones.
   */
  const mainLinks = mainThreadLinks(links);
  const route: "thread" | "helper" =
    mainLinks.length > 0 || request === "thread" ? "thread" : "helper";

  /*
   * THE WINNER IS A SEPARATE QUANTITY FROM THE ROUTE, AND THIS IS FIX I7.
   *
   * `route` above is derived from the PRESENCE of the main chain; InDesign
   * makes the CHAIN CREATED EARLIER the winner (Question 9). They diverge in a
   * state assembled from the spec's own standard actions — the helper chain is
   * built first (§4.5), then the layout is added — and in that case an
   * eligible frame used to report `thread` where the number actually came from
   * the helper chain. The number itself stayed measured and correct; it was
   * the field that was wrong, and wrong on the most expensive side: §4.8 calls
   * removing the `_folio-helper` layer the standard rollback action, and
   * Question 8 measured its cost (a hidden layer → 13 instead of 12 in the
   * PDF, i.e. "N–N").
   *
   * NOTHING NEEDS TO BE COMPUTED: the answer is already given by
   * `helperChainWins`, introduced by fix C2. Until now it was called in only
   * one branch and its result discarded.
   *
   * `null` until resolution has happened: the question of a winner only makes
   * sense AFTER that (an empty list of winners isn't "the main chain").
   */
  let resolvedBy: "main" | "helper" | null = null;

  if (route === "thread" || index.chain.kind === "measured") {
    /*
     * THE PER-FRAME PROOF IS THE SAME ONE FOR BOTH ROUTES, and this isn't
     * branches merged for brevity. The route answers the question of WHERE the
     * number comes from; only this frame's own measurement answers whether it
     * ACTUALLY comes from there. Once built, a helper chain resolves through
     * the exact same mechanism as the main one — the only difference is who
     * created it.
     */
    /*
     * WHAT'S COUNTED IS EXACTLY WHAT INDESIGN COUNTS — ALL DOCUMENT
     * OVERLAPS, and this is RESTORED by fix C2. Until now this held
     * `permitted = request === "thread" ? mainLinks : links`: a side clause
     * added for the sake of an honest route report. The effect was the
     * opposite — InDesign resolves the marker over ALL overlaps (measured,
     * Question 9: the one created earlier wins), while the oracle, on a
     * `thread` request, discarded helper links from the count and thereby
     * reasoned about a DIFFERENT document. Reproduced by a printed number: p.
     * 3 "2–3" became "1–3" with `applied: 1` and a report with no complaint at
     * all (re-review `11В`).
     *
     * The operator's request is expressed below — as a REJECTION AFTER
     * resolution.
     */
    const resolved = resolveFromLinks(links, direction);
    /*
     * `null` here is one value for FIVE reasons: no overlaps at all; two
     * different chains as winners; the winner's layer is HIDDEN; two frames of
     * the same chain with different neighbors; and a winner that exists, is
     * unambiguous and visible, but is itself the FIRST IN ITS OWN CHAIN, i.e.
     * its `previousPage` is empty (`topology.ts`, `only ?? null` — reproduced
     * by review `bd3c602`, probe P4). All five mean "there's no neighboring
     * frame for the marker to take a number from," exactly as §4.9 folds them
     * into one defect.
     */
    if (resolved === null) return skip("no-neighbour-frame", { current, expected, direction, route });
    /*
     * RESOLUTION HAPPENED — so a winner exists, is unambiguous and measured,
     * and can be named out loud starting exactly here. The same predicate as
     * in the rejection below: one question, one function, otherwise two places
     * would start answering differently about the winner.
     */
    resolvedBy = helperChainWins(links, direction) ? "helper" : "main";
    /*
     * A `route: "thread"` REQUEST IS INCOMPATIBLE WITH THE DOCUMENT'S STATE —
     * and this is a REJECTION, not a different count (C2).
     *
     * The operator asked to take the number from the MAIN chain, and
     * resolution has just been measured: the helper-layer chain won. There's
     * no honest answer here other than one of two — report a route the
     * operator didn't ask for, or say the request can't be fulfilled. The
     * third option, which used to stand here — recount without helper links —
     * gives a number DIFFERENT from what will actually be printed, i.e. exactly
     * the failure mode §3 calls worse than a manual number.
     *
     * BEFORE THE PAGE CHECK, NOT AFTER: when the request is unfulfillable,
     * "neighbor isn't on that page" would send the operator off to fix a chain
     * they never asked about — the same reproach §4.4 levels at `no-siblings`.
     *
     * THIS DOESN'T APPLY UNDER `auto` AND `helper` ON PURPOSE: there, no
     * request about the number's source was made, and the frame honestly gets
     * the helper chain's measured number (§4.2 split the routes precisely for
     * this).
     */
    if (request === "thread" && resolvedBy === "helper") {
      return skip("helper-chain-winner", { current, expected, direction, route, resolvedBy });
    }
    /*
     * Comparison BY NAME is all `resolveMarkerPage` gives
     * (`ThreadLink.previousPage`/`nextPage` are page names). The same
     * limitation as the own-page lookup above: in a book with two same-named
     * pages, matching names doesn't prove matching pages.
     */
    if (resolved !== sibling.name) {
      return skip("wrong-neighbour-page", { current, expected, direction, route, resolvedBy });
    }
  } else {
    /*
     * THE ONLY BRANCH WHERE THE ORACLE PREDICTS — AND IT'S ONLY REACHABLE
     * WHERE NOBODY WRITES ANYTHING. Only an explicitly declared
     * `ChainForecast` leads here, i.e. `create-helper-thread`: the chain
     * doesn't exist yet BY CONSTRUCTION, there's nowhere to get a per-frame
     * proof from, and this operation doesn't touch folios at all.
     * `replace-literals` never silently lands here — its `chain` is always
     * `"measured"`.
     *
     * STEP 6 ALSO RUNS FOR `helper`, AND THIS IS THE MAIN FIX FROM REVIEW
     * `f5d3509`. Until now the `helper` route was accepted WITHOUT a check, on
     * the premise "the chain is threaded in page order, so the marker will
     * resolve to exactly `offset ± 1`" — a claim that directly contradicts
     * this very project's own measurement: the marker gives the page of the
     * PREVIOUS FRAME IN THE CHAIN (H6, case C). The two quantities coincide
     * only for an UNBROKEN chain, and on this book the divergence would have
     * been total — 91 lying markers out of 91.
     *
     * THE PREDICTION IS ALSO PER FRAME, AND THIS IS THE CHANNEL FOR
     * `ignoredFolioFrames` (I2). The chain builder gives a helper frame only to
     * the FIRST folio on a page and reports the rest by name — and until now
     * the oracle accepted all of them as eligible. The report carries two
     * units here separately: `offsets` (which pages have frames) and
     * `covered` (under exactly which folios they landed).
     *
     * TWO STATES, TWO REASONS, AND BOTH ARE NOW REACHABLE. Until now they
     * stood as one condition — with an unbroken chain, "no previous frame"
     * could never happen (the book's edge was already rejected by step 3), so
     * a separate branch would have been dead code. Since chain coverage can be
     * SUPPLIED (`buildPageIndex`, §4.5), both states occur on a chain with a
     * gap, and folding them into one reason would mean reporting "neighbor
     * isn't on that page" to the operator where there's no neighbor at all —
     * exactly the reproach §4.4 levels at `no-siblings`.
     *
     * A MUTANT KILLS THIS CONDITION, and that's a measurement, not a promise:
     * remove it, and the test "a chain WITH A GAP → rejection, not a
     * prediction" turns red. Until now it could be removed with impunity
     * (`1260 passed`), because `chainOffsets` was by construction equal to the
     * `offset` of every measured page.
     */
    if (index.chain.kind === "report" && !index.chain.covered.has(frame.id)) {
      return skip("no-neighbour-frame", { current, expected, direction, route });
    }
    const neighbour = helperChainNeighbour(index.chain.offsets, index.byOffset, pg, direction);
    if (neighbour === null) {
      return skip("no-neighbour-frame", { current, expected, direction, route });
    }
    if (neighbour.offset !== sibling.offset) {
      return skip("wrong-neighbour-page", { current, expected, direction, route });
    }
  }

  /*
   * Step 7. TWO LOCKS, AND NEITHER OF THEM IS ANY LONGER "AN INDESIGN
   * PHYSICAL BAN" — the earlier split ("two InDesign bans and one policy of
   * ours") was disproven by Task 11B's measurement (Question 19). Replacing a
   * character goes through WITHOUT EXCEPTION both when `frame.locked ===
   * true` and with a locked layer, at both levels of interaction; the locks
   * are real, though — `geometricBounds` and `remove()` on the same frame
   * throw `Object is locked.`. InDesign protects the page item, not its text.
   *
   * THE STEP'S OTHER TWO REJECTIONS — `master-frame` and
   * `hidden-layer-frame` — MOVED UP, to step 5: step 6's per-frame proof is
   * unreachable for both (one doesn't exist on a document page, the other is
   * deliberately never a geometry donor), and leaving them here would mean
   * reporting about the chain instead of origin and layer. The locks stayed:
   * a locked frame CAN be a donor, so it can have a helper frame underneath it
   * and does reach step 7 — which is exactly why it learns about the lock.
   *
   * Both stay last for the same reason as before: a frame with a wrong number
   * must get `oracle-mismatch`, not "unlock it and try again."
   */
  if (frame.locked) return skip("locked-frame", { current, expected, direction, route, resolvedBy });
  /*
   * THE SECOND LOCK, AND IT ISN'T A DUPLICATE OF THE FIRST — measured
   * (Question 19, state C): a frame on a locked layer has
   * `frame.locked === false`, meaning the condition above does NOT catch it,
   * and writing into it goes through. It was exactly this state that let Task
   * 11 accidentally prove a locked layer doesn't protect its content.
   *
   * AFTER `locked`, NOT BEFORE: a frame with both locks must name the one the
   * operator can see on the element itself. A layer lock isn't visible on the
   * frame, and naming it first would mean sending the operator to the layers
   * panel for a lock whose removal alone unlocks nothing.
   */
  if (frame.layerLocked) {
    return skip("locked-layer-frame", { current, expected, direction, route, resolvedBy });
  }

  return { ...base, eligible: true, reason: null, current, expected, direction, route, resolvedBy };
}

/**
 * The eligibility plan: one verdict per CLAIM PARAGRAPH WITH LITERALS.
 *
 * A PARAGRAPH WITH NO LITERALS GETS NO VERDICT AT ALL — that's
 * `alreadyAutomatic`, a separate counter outside `total` and outside both
 * §5.2 equations, not `skipped`. A second run on the same book is plausible,
 * and then already-converted paragraphs would make up the majority: counting
 * them in `skipped` would make `reconciliation.balanced === false` fire on a
 * flawless run.
 *
 * This counter is computed by the CALLER (`pagination_apply`), which already
 * has `frames` in hand: the signature returns the verdicts themselves, and
 * adding a second output just for one number would turn the plan into a pair
 * that's easy to pull apart.
 *
 * `forecast` is OPTIONAL, AND ITS ABSENCE MEANS THE STRICTEST READING:
 * eligibility is proven PER FRAME, from the frame's own `overlaps`. A
 * prediction (`"contract"` or the actual coverage from the builder's report)
 * is declared explicitly and is only allowed where nobody writes anything —
 * otherwise the oracle would be answering about a PAGE to a question about a
 * FRAME (C1).
 */
export function planRewrite(
  pages: PageRef[],
  frames: ClaimFrame[],
  range: FolioRange,
  route: RouteRequest,
  forecast?: ChainForecast,
): FrameVerdict[] {
  const index = buildPageIndex(pages, forecast);
  const verdicts: FrameVerdict[] = [];

  for (const frame of frames) {
    for (const para of frame.paragraphs) {
      if (para.literals.length === 0) continue;
      verdicts.push(verdictFor(index, frame, para, range, route));
    }
  }

  return verdicts;
}

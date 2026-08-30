/**
 * Phase 7 types — replacing hand-typed folios with automatic markers.
 *
 * `src/pagination/types.ts` describes the MEASUREMENT (what's in the document right now);
 * this file describes the PLAN (what to do about that measurement). The plan's unit is
 * `FrameVerdict`: one frame, one verdict of "eligible / why not", so the operator
 * sees the reason for a refusal just as clearly as the refusal itself (the same convention
 * as `SkipReason | null` in `PaginationFinding.claimed`/`actual`).
 */

/**
 * The direction the MARKER ITSELF DECLARES — not a book-wide convention (spec §4.9).
 *
 * `PREVIOUS_PAGE_NUMBER` and `NEXT_PAGE_NUMBER` are different InDesign special-character
 * types, and which one sits in a frame is visible only from the marker itself, not
 * from which side of the spread the book's folio is on. Guessing the direction
 * from the page's side is the exact same mistake `PageRef.spreadSiblings` already
 * ruled out for the reference: a constant that doesn't carry over to a different layout.
 */
export type MarkerDirection = "previous" | "next";

/**
 * The folio range convention. A parameter with no default (spec §4.3).
 *
 * "The left number gives the previous page" and "the right number gives the next" are
 * equally valid layout conventions, and neither can be derived from the document.
 * No default: a silent default here would mean quietly refusing to fix
 * half the books that chose the opposite convention.
 */
export type FolioRange = "backward" | "forward";

/**
 * Why a frame was NOT rewritten with an automatic marker.
 *
 * Each reason is a separate MEASURED detector boundary (Task 6), not a guess:
 * - `multiple-literals` — the frame has more than one literal number; which
 *   one to replace is unknown without an operator.
 * - `single-sided` — a page with no partner in the spread: `PageRef.side`
 *   doesn't give `spreadSiblings`, and there's nothing to check the marker's direction against.
 * - `no-siblings` — the page exists, but `spreadSiblings` is empty.
 * - `spread-not-pair` — the spread exists, but doesn't consist of two pages
 *   (a single first/last page of a section).
 * - `unparsable-page-name` — the page name isn't a number (a section): the
 *   same blind spot as `folio-unparsable` in `PaginationDefect`.
 * - `oracle-mismatch` — the actual text diverged from what the measurement saw,
 *   between measurement and write; the same check `corrections_apply` runs
 *   before every write (spec §4.1) — here it failed.
 * - `no-neighbour-frame` — the marker has nothing to resolve against. FIVE STATES ON
 *   THE `thread` ROUTE AND TWO ON `helper`, not one, and the docstring here was
 *   found narrower than the code three times over (review `f5d3509`, m4 — it said
 *   "one"; review `bd3c602`, M3 — it said "four", the fifth state was reproduced by probe P4).
 *   On `thread` (`resolveMarkerPage`, `src/pagination/topology.ts`):
 *   1) there are no document overlaps at all — `ClaimFrame.overlaps` is empty
 *   (H6, case B), or every overlap is a master's;
 *   2) TWO DIFFERENT chains came out tied as winners with the same `createdOrder`;
 *   3) the winner's layer IS HIDDEN (a hidden layer mutes the marker — Question 8);
 *   4) two frames of THE SAME chain name different neighbours;
 *   5) the winner exists, is unambiguous and visible, but it's the FIRST FRAME OF ITS
 *   CHAIN, so `previousPage` is empty — the operator sees the neighbouring frame and
 *   reads "there's no neighbouring frame", and that's exactly what m4 was complaining about.
 *   On `helper` there are ALSO TWO reasons, and fix C1 added them.
 *   6) PER-FRAME, and it's the most common one: there's NO helper frame under this frame.
 *   Until now this state didn't exist at all — eligibility on `helper` relied
 *   on `chainOffsets`, i.e. a per-page list, and a frame with no chain
 *   underneath it came out "eligible". Three reproduced inputs: no chain at
 *   all (`route: "helper"` with no plan); the `_folio-helper` layer deleted between
 *   calls (the standard rollback action, §4.8); TWO FOLIOS ON ONE PAGE —
 *   only the first gets a helper frame (`ignoredFolioFrames`), and here between
 *   calls NOTHING happens. The printed number changed: "2–3" → "3–3".
 *   7) FORECAST, and reachable only in `create-helper-thread` (`ChainForecast`):
 *   in the helper chain's coverage there's NO frame before this page (after it),
 *   or the folio itself isn't in the coverage. The first is a chain
 *   WITH A GAP; the second is the same folio from `ignoredFolioFrames`, just
 *   predicted ahead of time.
 *   All seven §4.9 collapses into one defect, and all seven mean the same thing —
 *   there's no neighbouring frame for the marker to take its number from. This does NOT
 *   mean the marker will print nothing: it's measured (Question 18) that a marker with no
 *   previous frame prints its OWN page. Which is worse — the frame would come out looking
 *   correct, so the refusal here is mandatory, not cosmetic.
 *   But the docstring is also what shows the operator what to do, whereas "`overlaps`
 *   is empty" would send them looking for a neighbouring frame where flipping on a layer
 *   is actually all that's needed.
 *   `overlaps === null` doesn't belong here: that means "overlaps weren't
 *   counted" (not a folio, or `bounds === null`), not "there's no neighbour" — otherwise
 *   the gap would get a falsely named reason.
 * - `wrong-neighbour-page` — the overlapping frame exists, but its `ThreadLink` doesn't
 *   lead to the page that `FolioRange` expects.
 * - `helper-chain-winner` — ONLY on `route: "thread"`: the marker will resolve, and
 *   it's measured WHICH chain wins — the HELPER layer's chain, `_folio-helper`, while
 *   the operator asked for a number from the MAIN one. The request is incompatible with
 *   the document's state, and this is the only honest answer: reporting a route nobody
 *   asked for isn't allowed, and recounting without helper links is exactly what fix C2 did.
 *   THIS IS A REPLACEMENT OF THE NARROWING, NOT AN ADDITION TO IT. Until now the oracle
 *   on `thread` counted a NARROWER set of links than InDesign does (`permitted = mainLinks`)
 *   — and wherever a helper frame was OLDER than the main one, it wrote a marker whose
 *   number the helper chain determines. Reproduced with the printed number on the live
 *   document: p. 3 "2–3" → "1–3" with `applied: 1` and a flawless report (review 11В).
 *   That same frame used to get `no-neighbour-frame` — a reason that's substantively
 *   false: there IS a neighbouring frame under it, and the marker will resolve against it.
 *   THIS REASON NEVER OCCURS UNDER `auto` OR `helper`: there, nobody asked about the
 *   source of the number, and the frame honestly gets the helper chain's measured number.
 * - `locked-frame` — `ClaimFrame.locked === true`: a lock on THE ELEMENT ITSELF.
 *   THIS IS OUR POLICY, NOT A PHYSICAL PROHIBITION, and the earlier wording
 *   ("you physically can't write, InDesign will refuse") HAS BEEN DISPROVED BY MEASUREMENT
 *   (Question 19, states B and B2): with `frame.locked === true`, replacing a character
 *   via `characters.itemByRange(...).contents` goes through without an exception, both
 *   with default interaction and with `NEVER_INTERACT` — i.e. via exactly the path
 *   `pagination-write.jsx` writes through. The lock, meanwhile, is real: on that same
 *   frame `geometricBounds` and `remove()` throw `Object is locked.`. InDesign
 *   protects the page item, not its text.
 *   THE POLICY STAYS, AND ITS OWN JUSTIFICATION IS SEPARATE: the layout artist sets
 *   the lock so the element won't be touched, and §3 doesn't let the tool quietly
 *   overstep an expectation the user has every right to treat as a guarantee.
 * - `locked-layer-frame` — `ClaimFrame.layerLocked === true`: a lock on THE LAYER.
 *   A SECOND LOCK, AND IT IS NOT A DUPLICATE OF THE FIRST. Measured (Question 19, state C):
 *   a frame on a locked layer has `frame.locked === false`, meaning `locked-frame`
 *   does NOT catch it, and the write goes through — Task 11 measured this unintentionally
 *   (`applied: 1`, `failed: []`) and left it as a fact; Task 11Б verified it with its
 *   own probe and closed it.
 *   WHY A SEPARATE REASON, NOT SHARED WITH `locked-frame`. The operator sees one
 *   reason in the report, and it must lead to the lock that's actually there:
 *   a layer lock isn't visible on the frame itself, and "unlock the frame" would
 *   send them to the wrong place. The same split as between the frame's `layerVisible`
 *   and the overlapping frame's `layerVisible` (§4.8).
 *   A FRAME WITH BOTH LOCKS GETS `locked-frame`: the lock that's named is the one
 *   visible on the element. The second reason isn't lost — it becomes visible on the
 *   next plan, once the first lock is removed.
 * - `hidden-layer-frame` — `ClaimFrame.layerVisible === false`. THE ONLY REASON
 *   HERE THAT IS OUR POLICY RATHER THAN A FACT ABOUT THE DOCUMENT, and it was added
 *   by Task 11 to resolve a finding from Task 9: the oracle judged as eligible
 *   fixture frame `id=1473` (page "15", layer `Numeratsiia`,
 *   `visible: false`, contents "14–⟨previous⟩") with a perfect `current === expected
 *   === 14`, while §4.9 calls that exact same state the defect
 *   `folio-dormant-duplicate`. Two parts of the system silently disagreed about
 *   the same frame, and §4.9 demanded that this be settled out loud.
 *   FIRST JUSTIFICATION, SELF-SUFFICIENT: the benefit is zero, the cost isn't.
 *   A hidden frame doesn't print — making it self-updating changes NOTHING on the
 *   printed page, and §1 is the whole reason the phase exists in the first place. The
 *   cost is named in §4.9's first paragraph: after the replacement, `pagination_audit`
 *   is blind on this frame FOREVER (findings are only born
 *   inside `if (para.literals.length > 0)`), meaning the replacement STRIPS
 *   the literal signal from a frame the system itself already classifies as a
 *   dormant landmine.
 *   SECOND JUSTIFICATION, INDEPENDENT: NOT MEASURED. Question 8 measured a
 *   hidden layer OF THE HELPER CHAIN (it mutes resolution: PDF shows 13 instead
 *   of 12). Nobody measured the reverse configuration — a marker in a frame on a
 *   hidden layer sitting ABOVE a VISIBLE chain. The precedent for behaviour here
 *   is the same as for `non-canonical-page-name`: not measured → refuse, don't guess.
 *   `layerPrintable` is NOT part of this: it's measured (Question 8) that
 *   `printable = false` doesn't break resolution (16 of 16). Two boolean fields of
 *   identical shape behave oppositely, and they must not be confused (§4.8).
 *
 * `locked-layer-frame` is ALSO NOT NAMED BY SPEC §4.4 — and that's a second
 * divergence, declared just as openly. §4.4 couldn't have named it: it was written
 * before Question 19 measured that a layer lock leaves `frame.locked === false` and
 * doesn't stop the write. The spec isn't wrong here — it simply didn't know the
 * fact; but leaving the state without a reason would mean silently rewriting a
 * frame the layout artist locked, and §3 puts a false "eligible" above literal
 * adherence to the list.
 *
 * THE SIX REASONS BELOW ARE NOT NAMED BY SPEC §4.4 EITHER, AND THIS IS A
 * DIVERGENCE, NOT AN ADDITION BY TASTE. §4.4's seven steps give exactly nine
 * reasons above (the tenth, `locked-layer-frame`, is the divergence just named),
 * and none of them cover the state "THERE IS NO MEASUREMENT" — and that state
 * exists in Phase 6's types and is reachable
 * (`ClaimFrame.overlaps === null`, measured on the fixture). Three outcomes
 * were possible, and §3 forbids two of them: naming the unmeasured as one of the
 * existing reasons (`no-neighbour-frame`'s docstring directly excludes this — the
 * gap would get a falsely named reason), or not returning a verdict at all (the
 * paragraph would vanish from `total`, meaning `reconciliation.balanced` would stay
 * silent about the loss). What's left is the third: its own channel for "we didn't
 * compare it", exactly as Phase 6 introduced
 * `folio-marker-unmeasured` instead of folding an unmeasured frame into
 * `folio-marker-unbound`.
 *
 * REVIEW `f5d3509` ADDED FOUR OF THE SIX — and each one closes a REPRODUCED
 * input on which the oracle judged as eligible a frame that must not be touched. §3
 * puts this above literal adherence to the spec's list: a false "eligible" is
 * a marker that lies in the printed book — a worse failure mode than a hand-typed number.
 *
 * - `page-unmeasured` — the needed page isn't in `pages[]`: either the frame's
 *   own page, or the neighbouring page the expected number is taken from.
 *   There's nothing to compare against, so the frame can't be eligible. Both states
 *   are exactly "wasn't measured": whether the page exists in the document and
 *   just didn't make it into the measurement is something the oracle can't see from
 *   here, and inventing a second answer isn't allowed.
 * - `no-neighbour-page` — the neighbour by `offset` has a NEGATIVE index, meaning
 *   no such page exists in any document (the frame sits on the book's very first
 *   page, and the marker looks backward). Until now this was `page-unmeasured`,
 *   a reason nobody ever established — the very same objection §4.4 itself raises
 *   against `no-siblings` (review `f5d3509`, m3).
 * - `ambiguous-page-name` — there's more than one page named
 *   `ClaimFrame.page`. The frame's own page is looked up BY NAME (`ClaimFrame`
 *   carries no other key), and `Map` keeps the last of the same-named pages, so the
 *   frame would be checked against the wrong spread: `side`, `offset`, and
 *   `spreadSiblings` would all come from there. Reproduced by review `f5d3509`
 *   (PROBE A): a frame on the first "97" with literal
 *   42 gave `eligible: true`, and 96 would have been printed. There's no way to tell
 *   two same-named pages apart, but DETECTING a duplicate is possible, and that
 *   detectability is exactly what lets it refuse instead of guessing.
 * - `non-canonical-page-name` — the neighbouring page's name doesn't match the
 *   decimal spelling of its own number: "096" gives `pageNumber` 96, literal 96
 *   matches, and the frame came out eligible — but on the printed page, instead of
 *   "96" it would say "096" (PROBE B; a section numbering style of "001, 002, 003"
 *   is a standard InDesign choice). SAME ROOT AS `ambiguous-page-name`: the oracle
 *   compares a NUMBER, while a STRING sits on the printed page. What the marker
 *   actually prints for a non-numeric form of the name is NOT MEASURED, so this
 *   is an over-refusal, and it's the correct side to err on.
 * - `master-frame` — `ClaimFrame.fromMaster === true`. You can't write into
 *   a non-overridden master element (a write, if it went through, would change
 *   EVERY page with this master), but the decisive fact is different: `page.masterPageItems`
 *   gives one entry for EVERY page with that master, and an entry's `id` is the
 *   `id` of the same underlying object, one for all entries. Without this reason,
 *   a single physical object gave two ELIGIBLE verdicts with the same `frameId`
 *   and different `expected` values
 *   (PROBE H: 96 and 98) — a plan that contradicts itself, with the write handler
 *   having nothing to choose between them by.
 * - `overlaps-unmeasured` — `ClaimFrame.overlaps === null`, meaning nobody
 *   counted overlaps for this frame (its own `bounds` are unknown). Not permissible
 *   on ANY route: under `thread` it's unknown where the marker resolves, and
 *   under `helper` it's unknown whether the helper chain overrides the main one
 *   (§4.2) — and that's exactly why `frame.overlaps ?? []` is forbidden here.
 */
export type SkipReason =
  | "multiple-literals"
  | "single-sided"
  | "no-siblings"
  | "spread-not-pair"
  | "unparsable-page-name"
  | "oracle-mismatch"
  | "no-neighbour-frame"
  | "wrong-neighbour-page"
  | "helper-chain-winner"
  | "locked-frame"
  | "locked-layer-frame"
  | "hidden-layer-frame"
  | "page-unmeasured"
  | "no-neighbour-page"
  | "ambiguous-page-name"
  | "non-canonical-page-name"
  | "master-frame"
  | "overlaps-unmeasured";

/**
 * The verdict for a single frame: whether it's eligible for an automatic marker, and
 * exactly why. `eligible === false` with no `reason` would be an unexplained refusal —
 * the same failure mode `PaginationFinding.detail` doesn't allow itself
 * anywhere else in the project.
 */
export interface FrameVerdict {
  frameId: string;
  page: string;
  paragraphIndex: number;
  eligible: boolean;
  /** null ONLY when `eligible === true` — an eligible frame has nothing to explain. */
  reason: SkipReason | null;
  /** The number currently in place. */
  current: number | null;
  /**
   * The number that should result. Equals `current` for every eligible frame —
   * the marker doesn't change WHAT the folio shows, only HOW it shows it
   * (automatically instead of by hand), so a mismatch between `expected` and `current`
   * on an eligible frame would be a sign of a bug in the plan, not the intent.
   */
  expected: number | null;
  direction: MarkerDirection | null;
  /**
   * WHICH ROUTE WAS FORCED — i.e. what eligibility was proven against, NOT who
   * supplied the number. That second question is answered by `resolvedBy` below, and
   * conflating the two isn't safe: finding I7 was caused by exactly this mix-up.
   *
   * `"thread"` — there's a MAIN chain under the frame, so a `helper` request changes
   * nothing (§4.2: whichever was created earlier wins, and the phase always lays the
   * helper frame down last), or the operator requested `thread` via a document-wide override.
   * `"helper"` — there's no main chain under the frame.
   *
   * `null` — the route was never established: the frame was rejected before topology
   * (a master item, hidden, a malformed number).
   */
  route: "thread" | "helper" | null;
  /**
   * WHO WON RESOLUTION — i.e. whose chain physically supplies the number that will
   * print. `"main"` — the chain outside the `_folio-helper` layer, `"helper"` — the
   * helper one.
   *
   * THIS IS A SEPARATE FIELD, NOT A REFINEMENT OF `route`, AND ITS OWN JUSTIFICATION
   * IS SEPARATE (finding I7 from review `11g`). `route` is derived from the PRESENCE of a
   * main chain under the frame, while InDesign makes the winner whichever chain was
   * CREATED EARLIER (Question 9). These two values diverge in a state assembled entirely
   * from the spec's own standard actions: the helper chain is built first (§4.5), then
   * the layout is filled in — and at that point a frame with `route: "thread"` gets its
   * number from the HELPER chain. The number itself is measured and correct; only the
   * field would be wrong.
   *
   * WHY THIS ISN'T COSMETIC. §4.8 calls removing the `_folio-helper` layer the standard
   * rollback action, and Question 8 measured the cost: `visible = false` — and the PDF
   * shows 13 instead of 12, meaning every such folio silently becomes "N–N". An operator
   * reading `thread` draws the natural conclusion "this frame doesn't need the helper
   * layer". So the field was leading straight to the very action the phase calls
   * the most dangerous one.
   *
   * THE ANSWER ISN'T INVENTED, IT'S ALREADY COMPUTED: it's `helperChainWins`
   * (`src/pagination/topology.ts`), which the oracle calls on the `thread` route.
   * The set the winner is counted over is the same one InDesign counts over
   * (Question 20: master links don't compete at all, so
   * `documentThreadLinks` is a model of the physics, not a narrowing).
   *
   * `null` — THE WINNER WAS NEVER ESTABLISHED, and there are two such states: resolution
   * never happened (`no-neighbour-frame` and everything rejected earlier), or the verdict
   * is entirely FORECAST — the `ChainForecast` branch, where by construction there's no
   * chain yet. Both mean the same thing: nobody measured it. Writing `main` there
   * would mean reporting as established something nobody established — the same
   * convention as `expected: null` on a skip.
   */
  resolvedBy: "main" | "helper" | null;
}

/**
 * A rewrite plan for a single document: a list of verdicts, one per
 * folio frame. `planId` — so that applying the plan (a future task)
 * can verify it's executing exactly the plan that was just built, not a
 * stale plan from a different run against a document that has since changed.
 */
export interface RewritePlan {
  planId: string;
  docName: string;
  verdicts: FrameVerdict[];
  /**
   * The ACTUAL coverage of the helper chain — the `offset` of pages where
   * `create-helper-thread` REALLY placed a frame, not the ones where it should have
   * (§4.2, §4.5).
   *
   * Optional, because a plan with no helper chain (route `thread`) doesn't need it
   * at all. But when a chain was built, this is the ONLY channel through which the
   * actual coverage reaches the second operation: helper frames don't belong to
   * the `folio` family, so a repeat `pagination_measure` can't see them, and
   * `planRewrite` without this field would trust §4.2's NAMED contract instead of
   * what was actually built. Consumed by `buildPageIndex`
   * (`src/pagination/rewrite.ts`) — and that's exactly where it makes step 6 on the
   * `helper` route reachable.
   */
  chainOffsets?: number[];
  /**
   * THE SECOND UNIT OF THAT SAME COVERAGE — the `id`s of the FOLIOS under which a
   * helper frame actually landed.
   *
   * `chainOffsets` says which PAGES the frames sit on; that's the list a
   * chain neighbour is taken from. But eligibility is a claim about a FRAME, and
   * that's exactly the gap C1 lived in: the handler gives a helper frame only to the
   * FIRST folio on a page (`ignoredFolioFrames`), while the per-page list still
   * said "there's a frame on this page" regardless. Two folios on one page
   * — a state where the operator does NOTHING between calls, yet the printed
   * number of the second one changes ("2–3A" → "3–3A").
   *
   * Consumed by `buildPageIndex` as part of `ChainForecast`
   * (`src/pagination/rewrite.ts`) — and only in `create-helper-thread`:
   * `replace-literals` MEASURES eligibility rather than predicting it.
   */
  chainFolioFrameIds?: string[];
}

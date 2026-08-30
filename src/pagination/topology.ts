/**
 * Phase 7 topology: whether two frames overlap, and which page a marker
 * resolves to as a result. Pure TypeScript — which is exactly why it's tested without InDesign.
 *
 * NO RULE HERE IS DERIVED BY REASONING. Every answer rests on
 * `docs/measured-facts-phase7.md` (probe H7) and is named at its own line:
 * a touch counts as an overlap — Question 3; the one created earlier wins —
 * Question 9; a master chain doesn't resolve — Questions 6 and 13;
 * a hidden layer silences the marker — Question 8.
 */

import type { MarkerDirection } from "./rewrite-types.js";
import type { ClaimFrame, FrameGeometry, ThreadLink } from "./types.js";

/**
 * Bounds-comparison tolerance, mm. A twin of `IDMCP.BOUNDS_EPSILON_MM`
 * (`src/jsx/pagination.jsx`), and the value must stay identical: if it diverges
 * here, TypeScript would start answering about overlap differently than the measurement that
 * produced `ClaimFrame.overlaps` in the first place.
 *
 * Two copies of the same constant is not an oversight: JSX runs in ES3, without modules, and
 * cannot import this one. They have no shared home, so the link is a cross-reference
 * by NAME (a line number silently goes stale — §4.9).
 */
export const BOUNDS_EPSILON_MM = 0.01;

/**
 * The helper layer's name. A twin of `IDMCP.HELPER_LAYER_NAME`
 * (`src/jsx/pagination-write.jsx`) — and, like `BOUNDS_EPSILON_MM`, the twin is
 * DELIBERATE: JSX runs in ES3, without modules, and cannot import the constant;
 * they have no shared home, so the link is held by a cross-reference by
 * NAME.
 *
 * THIS IS A CONSTANT OF THE TOOL, NOT OF THIS LAYOUT, and it doesn't violate §3.2: the layer with
 * this name is created by `pagination_apply` itself, i.e. the tool is recognizing its own
 * work, not guessing someone else's. A reference derived from the document is
 * impossible here by construction — in a document where the chain doesn't exist yet, there's nothing
 * to recognize.
 *
 * BUT THE NAME IS NOT A PROPERTY OF THE TOOL, and the price of that is stated out loud (M7
 * of re-review `11В`). A user's layer given the same name is treated as a helper, and
 * up to now that has cost a NUMBER: under `route: "thread"` its links were discarded from
 * the count, i.e. the oracle was counting something other than what InDesign counts (C2). Since the
 * count cannot be narrowed, the price is bounded to the REPORT and to COVERAGE: under `auto` and `helper`
 * the number stays measured; under `thread` the frame gets `helper-chain-winner`
 * where there might not have been a refusal. This is the one side of the error §3 allows.
 *
 * THE FLIP SIDE OF THAT SAME LIMIT — a frame on a layer whose name could not
 * be read (`src/jsx/pagination.jsx`, default `""`): it is treated as
 * the main one. That consequence is also only about the report, and is also named at its own line.
 */
export const HELPER_LAYER_NAME = "_folio-helper";

/**
 * Links that CAN produce a number NOT through the helper chain.
 *
 * The split is needed exactly where the route is born: the helper frame
 * sits exactly under the folio (§4.2), so it is necessarily present in `overlaps`, and
 * without this filter "there's a document overlap" would mean "there's a main
 * chain" — a claim that's false in precisely the one case the
 * `helper` route exists for.
 */
export function mainThreadLinks(links: readonly ThreadLink[]): ThreadLink[] {
  return links.filter((l) => l.layerName !== HELPER_LAYER_NAME);
}

/**
 * Whether two frames overlap. **A touch COUNTS.**
 *
 * THIS IS A TWIN OF `IDMCP.boundsTouch`, NOT AN IDEAL GEOMETRIC PREDICATE, and
 * the difference is decisive here. Adobe describes marker resolution as "touches or
 * overlaps", and the measurement confirmed it with a number: of the 7 existing contacts between the folio and
 * the chain on the working book, `touch` gives **7**, `strict` (intersection area > 0) gives
 * **0** (H7, Question 3). Strict inequalities would give zero overlaps exactly where
 * InDesign sees them, i.e. the silent death of route A on EVERY book — and
 * would diverge from `ClaimFrame.overlaps`, which is built exclusively on `IDMCP.boundsTouch`.
 *
 * The shape of the condition is also deliberately repeated from the twin (splitting by
 * axis, not a conjunction of intersections): given the same numbers, two different forms give the same
 * answer, but only an identical form can be checked against the original by reading.
 */
export function rectsOverlap(
  a: FrameGeometry,
  b: FrameGeometry,
  epsilon: number = BOUNDS_EPSILON_MM,
): boolean {
  if (a.x2 < b.x1 - epsilon) return false;
  if (b.x2 < a.x1 - epsilon) return false;
  if (a.y2 < b.y1 - epsilon) return false;
  if (b.y2 < a.y1 - epsilon) return false;
  return true;
}

/**
 * Overlaps that CAN give the marker a document page, or `null` if
 * overlaps weren't counted at all.
 *
 * THREE STATES ARE PRESERVED, AND THIS IS THE ONE PLACE WHERE THEY ARE STILL DISTINGUISHABLE.
 * `null` means "NOT CHECKED" (the frame's own `bounds` are unknown), `[]` means
 * "checked, doesn't overlap". `resolveMarkerPage` collapses both to `null`
 * (there's no page either way), so the caller that needs the difference —
 * the §4.9 detector — reads it from here: `null` leads to `notCompared`, `[]` leads to
 * `folio-marker-unbound`. Writing `?? []` here would mean inventing a defect about
 * a frame nobody measured.
 *
 * MASTER LINKS ARE FILTERED OUT, and that's the same kind of refusal, not a relaxation:
 * a chain that lives on a master does NOT resolve for a document page
 * AT ALL — the neighboring frame sits on the master page (Question 6), and a marker in an
 * unoverridden master frame doesn't see a document chain underneath it either
 * (Question 13). Arithmetic makes this decisive: on the working book, overlaps
 * reached 90 of 91 folio frames, ALL of them masters; if they were counted, the phase
 * would force the `thread` route on 90 frames and fix one out of 91,
 * reporting 90 legitimate skips (§4.2).
 *
 * The data isn't discarded on input, though: master links stay in
 * `ClaimFrame.overlaps`, flagged, because a different edition might have a document
 * chain there, and only whoever can see both can tell the difference.
 */
export function documentThreadLinks(frame: ClaimFrame): ThreadLink[] | null {
  if (frame.overlaps === null) return null;
  return frame.overlaps.filter((l) => !l.fromMaster);
}

/**
 * The page marker `dir` resolves to, or `null` if it doesn't
 * resolve, or resolves ambiguously.
 *
 * Here `null` is ONE VALUE FOR FIVE REASONS, and that's deliberate: all five mean
 * "there's no page", and all five are led by §4.9 into a single defect,
 * `folio-marker-unbound`. Per the code below: `links.length === 0`;
 * `stories.size > 1`; `!l.layerVisible`; `pages.size !== 1`; and **`only ?? null`
 * — the winner exists, is unambiguous and visible, but is itself FIRST IN ITS OWN CHAIN**,
 * i.e. `previousPage` is empty (reproduced by review `bd3c602`, trial P4;
 * before that the docstrings counted four). The one reason the caller must
 * distinguish BEFORE the call is "wasn't checked" (`documentThreadLinks(frame) === null`),
 * because it leads not to a defect but to `notCompared`.
 */
export function resolveMarkerPage(frame: ClaimFrame, dir: MarkerDirection): string | null {
  const links = documentThreadLinks(frame);
  if (links === null) return null;
  return resolveFromLinks(links, dir);
}

/**
 * LINKS THAT WIN RESOLUTION — i.e. CREATED EARLIER THAN ALL THE OTHERS.
 *
 * Measured (H7, Question 9, 5 out of 5 cases, lower value = earlier). Three
 * alternatives were rejected by MEASUREMENT, not reasoning: stacking order (`Z9`
 * vs. `V9`, i.e. `bringToFront` doesn't work as a control mechanism), more
 * containers (`U9`, 6 vs. 2), and a larger overlap area (`U9` — 17.5×
 * larger, `Y9`). The order within the array itself is the order the page's frames were walked in,
 * i.e. a quantity the measurement declared to have no effect, so taking the first element is
 * not allowed.
 *
 * Consequence for the phase: the helper chain is added to the finished document
 * LAST, so the main text always beats it wherever the folio
 * overlaps it (§4.2).
 *
 * SPLIT OUT INTO ITS OWN FUNCTION BECAUSE THE WINNER IS NEEDED BY TWO DIFFERENT QUESTIONS:
 * "which page does the marker resolve to" (below) and "whose chain does it
 * resolve through" (`helperChainWins`). Before, the second question was substituted with
 * narrowing the INPUT — and that's exactly what substituted the document the oracle reasons about (C2).
 */
/**
 * Links that take part in the contest for the number at all.
 *
 * SHARED BETWEEN BOTH QUESTIONS ABOUT THE WINNER, and this isn't an optimization but a requirement
 * that `helperChainWins`'s docstring states directly: two independent predicates about
 * the winner will eventually diverge, and the `resolvedBy` field will start contradicting
 * the number itself. THAT IS EXACTLY WHAT HAPPENED when the filtering lived only in
 * `resolveFromLinks`: a `replace-literals` dry run on the book gave
 * `eligible: 91`, but `resolvedByHelper: 84` — for seven frames the number was already
 * being taken by the helper chain, while the report named the main one.
 */
function liveLinks(links: readonly ThreadLink[], dir: MarkerDirection): ThreadLink[] {
  const suppliesPage = (l: ThreadLink): boolean =>
    (dir === "previous" ? l.previousPage : l.nextPage) !== null;
  const liveStories = new Set(links.filter(suppliesPage).map((l) => l.storyId));
  return links.filter((l) => liveStories.has(l.storyId) || !l.layerVisible);
}

function resolutionWinners(links: readonly ThreadLink[]): ThreadLink[] {
  /*
   * ПОРОЖНІЙ ВХІД — НЕ ПОМИЛКА ВИКЛИКАЧА, А ДОСЯЖНИЙ СТАН.
   *
   * `links[0]!` тут падав `TypeError: Cannot read properties of undefined`.
   * `helperChainWins` стереже ВЛАСНИЙ вхід (`links.length === 0`), але передає
   * сюди результат `liveLinks(...)`, який буває порожнім і на непорожньому
   * вході: коли жодна перехресна ланка не дає сторінки в потрібному напрямку,
   * а всі ланки — на видимому шарі. `resolveFromLinks` цей самий випадок
   * стереже явно (`alive.length === 0`), `helperChainWins` — ні.
   *
   * Виміряно на робочій книжці: колонцифра торкається одноблокової історії
   * (декоративна лапка 150 pt) на сторінках 101, 109, 153, 167, 171, 185, 195,
   * а в одноблокової історії `previousPage === null`. Після `replace-literals`
   * у таких колонцифр немає літералів, тож `countAlreadyAutomaticOverHelper`
   * їх відбирає — і падіння траплялося ПІСЛЯ того, як `repair-helper-thread`
   * уже записав у документ і зберіг план: оператор бачив сирий `TypeError` і
   * читав успішний ремонт як провал.
   *
   * Сторожа поставлено тут, а не в тому одному виклику: порожній список
   * переможців не має — це властивість самої функції, а не окремого шляху.
   */
  if (links.length === 0) return [];

  let earliest = links[0]!.createdOrder;
  for (const l of links) if (l.createdOrder < earliest) earliest = l.createdOrder;
  return links.filter((l) => l.createdOrder === earliest);
}

/**
 * Whether the marker resolves through the HELPER chain — a question about the WINNER, not
 * about the presence of a helper frame under the folio.
 *
 * THERE IS ONE CALLER — THE ORACLE, AFTER RESOLUTION — and the answer goes from there to TWO
 * places: into the refusal for `route: "thread"` (`helper-chain-winner`) and into the
 * `FrameVerdict.resolvedBy` field, which tells the operator the source of the number (I7).
 * There is one computation involved: two independent predicates about the winner would
 * eventually diverge, and the field would start contradicting the refusal.
 *
 * This is the same honesty requirement that used to be met by narrowing the input (`permitted`).
 * The difference is fundamental: narrowing forced the oracle to count the WRONG SET — not the one
 * InDesign counts (it resolves the marker over ALL overlaps, Question 9) — i.e. to
 * reason about a different document and silently write a number that won't appear on the sheet
 * (C2, reproduced in print: "2–3" → "1–3"). The question about the winner
 * is asked AFTER resolution and changes nothing in the count.
 *
 * `some`, NOT `every`, AND THE GUARANTEE HERE IS STRONGER THAN "A REFUSAL ONLY COSTS
 * COVERAGE" (M11 of re-review `11g`; the earlier wording read as though
 * `every` would cost a NUMBER). It wouldn't: **no choice of quantifier can
 * change the number that gets printed**, and that's a property of the CALL SITE, not
 * of good intentions. The function is called after `resolved` has already been computed, and neither of
 * its two consequences interferes with that count — one leads to `skip`, the other
 * to a report field:
 *   - `true` → under `thread` the frame is refused (nothing changes on the sheet),
 *     under `auto`/`helper` `resolvedBy` says "helper";
 *   - `false` → the frame gets the marker, whose number is that same `resolved`, i.e.
 *     measured over the full set of overlaps, and `resolvedBy` says "main".
 * So what's at stake is only coverage versus report honesty, and that's exactly why measuring
 * InDesign's behavior in the state "winners of one chain on different layers" is NOT
 * NEEDED for §3: §3 talks about the number, and the number here doesn't depend on the quantifier.
 * Measuring will be needed if and only if someone wants to RELAX the refusal
 * for the sake of coverage on a book.
 *
 * The side chosen is the same one §3 names as the only one allowed: one
 * helper winner is enough to say "the request is incompatible" and for `resolvedBy`
 * to name the helper layer.
 *
 * `false` on an empty list — there's no resolution there either, and the question about
 * the winner doesn't arise; the caller reaches this line only with a non-empty
 * resolution.
 */
export function helperChainWins(links: readonly ThreadLink[], dir: MarkerDirection): boolean {
  if (links.length === 0) return false;
  /* THE SAME SET AS IN `resolveFromLinks` — see `liveLinks`. A dead end
   * created earlier doesn't "win" anything: InDesign skips it, and the report
   * must say the same thing the number does. */
  return resolutionWinners(liveLinks(links, dir)).some((l) => l.layerName === HELPER_LAYER_NAME);
}

/**
 * The same resolution, but over an EXPLICITLY NAMED subset of links.
 *
 * Split out of `resolveMarkerPage` for the sake of one caller — the oracle, which must
 * resolve the marker over the same set InDesign itself sees, while
 * being able to name that set out loud (`documentThreadLinks` has already filtered out masters).
 *
 * NARROWING THIS SET FOR THE SAKE OF THE OPERATOR'S REQUEST IS FORBIDDEN — that was exactly C2:
 * `route: "thread"` discarded helper links from the count, while InDesign doesn't
 * discard them. The route's request is expressed as a REFUSAL after resolution
 * (`helperChainWins`), not as a different count before it.
 *
 * Master links don't reach this point: `documentThreadLinks` already filtered them out.
 */
export function resolveFromLinks(
  links: readonly ThreadLink[],
  dir: MarkerDirection,
): string | null {
  if (links.length === 0) return null;

  /*
   * A DEAD END DROPS OUT BEFORE THE CONTEST, IT DOESN'T WIN IT.
   *
   * The rule "the one created earliest wins" (H7, Question 9) was measured on
   * a contest between TWO GENUINE chains. The case "the earliest one can't
   * give a number at all" wasn't covered by that measurement, and the code used to
   * treat it as a dead end — i.e. a `no-neighbour-frame` refusal.
   *
   * RE-MEASURED 2026-08-16 WITH A PRINTED NUMBER
   * (`scripts/probe-touch-winner.mjs`: fixture, PDF export, reading the
   * text). A dead-end frame with `story.id = 243` against a chain with
   * `story.id = 266` — the dead end was created EARLIER — and the marker still
   * printed the chain's number. Both creation orders gave the same result.
   * So InDesign SKIPS the dead end.
   *
   * THE FILTER APPLIES ONLY TO VISIBLE ONES. What InDesign does when a dead end
   * sits on a HIDDEN layer hasn't been measured — and a hidden frame, as measured by
   * Question 8, silences resolution. So a hidden link stays in the
   * contest and then runs into its own visibility check below:
   * conservative behavior where there's no measurement.
   *
   * The cost of the bug on the working book is seven pages (101, 109, 153, 167, 171,
   * 185, 195), where the folio touches the frame of a decorative quote mark «’’»
   * (150 pt, a one-frame story). They stayed manual for no reason.
   *
   * FILTERING GOES BY STORY, NOT BY INDIVIDUAL LINK, and the boundary here follows exactly the
   * boundary of what was measured. The experiment pitted TWO DIFFERENT stories against each other — a dead one and a live one.
   * The case "two frames of the SAME chain, one of which has no neighbor" wasn't
   * covered, and there the rule "a divergence means `null`" applied (and
   * still applies): which of two frames of the same story wins was not resolved by measurement.
   * So only a story where NO link gives a number at all is treated as dead;
   * a story where one link gives one and the other doesn't stays fully in the contest
   * and then runs into the `pages.size !== 1` check below. The first version of
   * this fix filtered links one at a time and thereby silently changed behavior
   * in the unmeasured case — an existing test caught that.
   */
  const alive = liveLinks(links, dir);
  if (alive.length === 0) return null;

  const winners = resolutionWinners(alive);

  /*
   * EQUAL `createdOrder` ON DIFFERENT CHAINS — a reachable state, and the
   * Question 9 rule doesn't order it. `createdOrder` is `Number(story.id)`, and
   * for a non-numeric `id` the measurement puts 0 (`IDMCP.threadLink`, the `isNaN` branch),
   * so two different chains can both land on zero. Guessing the winner is forbidden:
   * a fifty-fifty chance of printing the wrong number.
   */
  const stories = new Set(winners.map((l) => l.storyId));
  if (stories.size > 1) return null;

  const pages = new Set<string | null>();
  for (const l of winners) {
    /*
     * A HIDDEN LAYER ON THE OVERLAPPING FRAME SILENCES THE MARKER — measured (Question 8),
     * unlike `printable = false`, which does not break resolution. There is deliberately NO silent
     * fallback to the next chain here: what InDesign does
     * when the winner is hidden and a visible chain lies underneath it hasn't been
     * measured, and a guess would produce a number nobody stands behind.
     */
    if (!l.layerVisible) return null;
    pages.add(dir === "previous" ? l.previousPage : l.nextPage);
  }

  /*
   * Several frames of the SAME chain (identical `storyId`, hence identical `createdOrder`)
   * have nothing to order them by — which of two neighboring frames wins was not
   * resolved by measurement. A single unambiguous answer is accepted; a divergence is not. A `null` in
   * the set counts on equal footing: "there's no neighbor" versus "the neighbor is on 6" is also
   * a divergence, not a reason to take whichever one exists.
   */
  if (pages.size !== 1) return null;
  const [only] = [...pages];
  return only ?? null;
}

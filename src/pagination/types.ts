/**
 * Phase 6 types — `pagination_audit`.
 *
 * One model for two families (the third, `runningHead`, was ruled out by
 * probe H6 — see the comment at `PaginationDefect`): somewhere in the document
 * there's a CLAIM ABOUT A PAGE, typed by hand, and it has diverged from fact.
 * The report's unit is one claim (spec §4.3).
 *
 * THE CROSS-CUTTING PRINCIPLE (spec §3, user rule 2026-08-06): the reference
 * is either DERIVED from the document, or DECLARED by the operator. There is
 * and can be no constant of one particular layout in these types — that's
 * exactly why `PageRef` carries `spreadSiblings` (InDesign knows the spread's
 * makeup) and `ClaimParagraph` carries `leading` (the tolerance is derived
 * from it).
 */

/**
 * The ceiling on a named list. The same one as `MAX_DETAIL_ITEMS` in Phase 5,
 * and for the same reason: a list without a ceiling grows with the document,
 * and SILENT truncation would read as "that's everything there is."
 */
export const MAX_PAGINATION_DETAIL_ITEMS = 50;

/** A page and the makeup of its spread. The `folio` family's reference is taken from here. */
export interface PageRef {
  /**
   * The name as InDesign gives it, NOT an index. Sections give «iv», «A-1»,
   * «Дод-3» — all legitimate names a number can't be derived from.
   */
  name: string;
  /** Absolute index in the document, 0-based. */
  offset: number;
  side: "LEFT_HAND" | "RIGHT_HAND" | "SINGLE_SIDED";
  spreadIndex: number;
  /**
   * Names of the OTHER pages of the same spread, in order of appearance.
   *
   * This is the reference for the folio rule: "a hand-typed number must equal
   * the adjacent page" asks nothing and is portable, because InDesign itself
   * knows the spread's makeup. The constant "left = right minus 1" would flip
   * on a book with the folio on the verso.
   */
  spreadSiblings: string[];
  master: string | null;
}

/**
 * Kinds of NON-literal content that can stand in place of a typed number.
 *
 * `text-variable` — not `SpecialCharacters`, but an instance of a text
 * variable, and this is the THIRD kind of content the first draft of these
 * types didn't know about. Measured by probe H6 (2026-08-07): the numbers in
 * this book's table of contents are exactly instances of the
 * `XREF_PAGE_NUMBER_TYPE` variable in anchored frames, 35 of them. Without
 * this variant such a paragraph would look empty (`literals` empty, `markers`
 * empty), and the tool couldn't say the one thing that matters: this line is
 * ALREADY automatic.
 */
export type MarkerKind =
  | "auto-page-number"
  | "section-marker"
  | "next-page-number"
  | "previous-page-number"
  | "text-variable";

/**
 * Frame bounds in DOCUMENT-SPREAD coordinates, mm: [y1, x1, y2, x2] —
 * InDesign's order.
 *
 * "Document" isn't a redundant qualifier. A frame from `page.masterPageItems`
 * returns `geometricBounds` in MASTER-spread coordinates, and the measurement
 * reduces them to document coordinates (Question 17). The discrepancy equals
 * a whole page width, meaning without the reduction the first page's folio
 * frame would lie outside its own spread and overlap nothing.
 */
export interface FrameGeometry {
  y1: number;
  x1: number;
  y2: number;
  x2: number;
}

/**
 * The frame's links in its thread. This is exactly where the answer to "which
 * page will the marker resolve to" comes from: PREVIOUS_PAGE_NUMBER gives the
 * `previousPage` page, not "current minus one" — a boundary measured by probe
 * H6, case C.
 */
export interface ThreadLink {
  storyId: string;
  previousPage: string | null;
  nextPage: string | null;
  /**
   * `story.id` of the frame that owns the thread. Measured (probe H7,
   * Question 9, 5 of 5 cases): when two threads overlap, the one CREATED
   * EARLIER wins — stacking order (z-order) has no effect at all. A smaller
   * value = created earlier.
   *
   * To be honest: whether it's `story.id` itself, or something merely
   * monotonic with it, the measurement didn't distinguish. `story.id` is used
   * because it's what was actually measured.
   */
  createdOrder: number;
  /**
   * Layer visibility of the OVERLAPPED frame, not this one's own.
   *
   * Without this field `folio-marker-unbound` can't be counted at all: §4.9
   * requires catching the case "the SERVICE thread's layer is hidden," and
   * `overlaps` is the only window into the overlapped frame, and it's
   * deliberately lightweight (it doesn't embed a full `ClaimFrame`). A hidden
   * layer MUTES the marker (Question 8), so the frame prints a false number —
   * that's `deviating`, unlike a hidden layer on the frame ITSELF, which
   * yields `folio-dormant-duplicate`.
   */
  layerVisible: boolean;
  /**
   * The layer name of the OVERLAPPED frame — and it alone distinguishes a
   * SERVICE frame from a main-text frame.
   *
   * WITHOUT THIS FIELD THE `helper` BRANCH WAS REACHABLE EXACTLY WHEN THERE
   * IS NO SERVICE FRAME UNDER THE FOLIO. A service frame is created with
   * geometry that EXACTLY matches the folio's bounds (§4.2), so when it
   * exists it inevitably lands in `overlaps`. The route was chosen as "there
   * is a document overlap → `thread`," and the frame the thread genuinely
   * sits under went to `thread`, while `helper` got exactly the frame under
   * which there is nothing. There the oracle judged it eligible too — on the
   * basis of the PAGE-BY-PAGE `chainOffsets` listing. Reproduced by the
   * printed number (final review, three entries): «2–3» became «3–3» with
   * `applied: 3`, `skipped: []`.
   *
   * The value is checked against `HELPER_LAYER_NAME`
   * (`src/pagination/topology.ts`), the twin of `IDMCP.HELPER_LAYER_NAME` in
   * `src/jsx/pagination-write.jsx`. An empty string — the layer didn't read;
   * this is read as "NOT a service frame" (see the default in
   * `IDMCP.threadLink`).
   */
  layerName: string;
  /**
   * The origin of the OVERLAPPED frame, NOT the claim frame.
   *
   * TWO IDENTICALLY-NAMED FIELDS SIDE BY SIDE, AND THEY MUST NOT BE CONFUSED,
   * just like `layerVisible` here and `layerVisible` on `ClaimFrame`:
   * - `ClaimFrame.fromMaster` — where the folio frame ITSELF came from (you
   *   can't write into it);
   * - `ThreadLink.fromMaster` — where the frame the folio OVERLAPS came from
   *   (its thread doesn't resolve for the document page).
   *
   * §4.2, the subsection "an overlap here means an overlap with the DOCUMENT
   * thread": the forced route to `thread` exists only because the main
   * thread outranks the service one. A master's thread outranks nothing —
   * Question 6 (the neighboring frame sits on the master page, there's no
   * document page to resolve against) and Question 13 (a marker on an
   * unoverridden master frame doesn't see the document thread beneath it).
   *
   * The arithmetic makes this decisive: a third source of frames added
   * master overlaps, and on the working book **90 of 91** folio frames got
   * an overlap, every single one a master one. Without this field the phase
   * would have forced `thread` on 90 frames, the oracle wouldn't have
   * matched on a dead thread, and `pagination_apply` would have fixed ONE
   * frame out of 91, reporting 90 legitimate misses.
   *
   * The data isn't discarded on input, though: master overlaps still remain
   * in `overlaps`, just flagged. A different edition may have a document
   * thread there, and only someone who can see both can tell them apart.
   *
   * CLOSED WITH A FIXTURE (the `folio-master-thread` state,
   * `src/jsx/_fixtures.jsx`).
   *
   * There used to be a TODO here — the only one in the codebase — and it was
   * GOING STALE without being resolved. It said: only that the field
   * distinguishes `true` from `false` was verified, while the scenario the
   * field exists for (an overlap with a master THREAD that doesn't resolve
   * for the document page, Questions 6 and 13) wasn't covered by a fixture
   * and rested on the H7 MEASUREMENT. That was true exactly at the moment it
   * was written (`49faac5`); four commits later `7edf2b7` added two THREADED
   * frames on the parent spread (`mthreadV` → `mthreadR`) and a document
   * folio on page «17» right under the right-hand one of them.
   *
   * Proof by execution, not by reading:
   * `tests/integration/pagination-measure.test.ts` takes that folio's
   * `overlaps`, filters by `fromMaster`, and asserts exactly two things —
   * such an overlap is EXACTLY ONE, and its `previousPage` equals **«A»**,
   * i.e. the MASTER page, not the document's. This is the state "a thread
   * exists, but doesn't resolve for the document page," which had been
   * missing.
   *
   * What remains true: this state doesn't occur on the working book — all
   * 83 master overlaps there are the running head — so a run on the book
   * does NOT prove it. The fixture does.
   */
  fromMaster: boolean;
}

export interface ClaimParagraph {
  index: number;
  /**
   * The style of the PARAGRAPH ITSELF, not the frame.
   *
   * A frame's role is determined by its first paragraph's style — but a
   * table-of-contents line's level is a property of the PARAGRAPH. Measured
   * on the working book 2026-08-07: one contents frame holds all three
   * levels (`Зміст Розділ`, `Зміст Підрозділ`, `Зміст Пункти`), and while the
   * style was taken from the frame, all 80 of its paragraphs were counted as
   * the first one's level — the "Зміст Розділ" level got 13 lines instead of
   * 4. This didn't surface on the fixture, because there every heading was
   * its own frame.
   */
  styleName: string | null;
  /**
   * Text with markers replaced by U+FFFC. For DISPLAY, not for counting
   * numbers: a marker in raw text looks like an ordinary character, and a
   * regex over it would count an automatic number as a manual one.
   */
  text: string;
  /**
   * Literal integers in order of appearance — ONLY hand-typed ones. These are
   * exactly what's checked; the difference from `markers` is the essence of
   * both families: `literals` without `markers` means "typed by hand, will
   * break," `markers` without `literals` means "updates itself."
   */
  literals: number[];
  markers: MarkerKind[];
  /**
   * CHARACTER offsets of the literals, in the same order as `literals`.
   *
   * NOT string offsets. Measured by H7: «6–⟨marker⟩» collapses into the
   * string `"6EN_DASH￼"`, where the marker sits at position 8 of the STRING
   * and at position 2 among CHARACTERS. The write goes through
   * `paragraph.characters[i]`, so a string offset would miss.
   *
   * Without them the write handler would have to search for the number ON
   * ITS OWN, independent of the measurement the oracle is built on — a gap
   * `corrections_apply` closes by reconciling the actual text before every
   * write (spec §4.1).
   */
  literalOffsets: number[];
  /**
   * The baseline of the first line in SPREAD coordinates, mm. null — there
   * are no lines.
   *
   * A CAVEAT THAT MUST LIVE HERE, NOT IN THE TASK'S REPORT. For a frame with
   * `fromMaster: true` this is a coordinate of the MASTER spread:
   * `IDMCP.recordBounds` reduces `bounds` to document coordinates, but NOT
   * `baseline`. Today this doesn't surface (`baseline` is only read by the
   * `contents` family, which master frames never reach, by §4.1's decision),
   * and the error here is smaller than the one blocker B1 fixed: it equals
   * `dy`, i.e. zero whenever the document page sits at the same height in its
   * spread as the master. But the field is public and sits in the
   * measurement's response — the very first consumer outside `contents`
   * (§4.9, Task 6) will silently get a foreign coordinate system.
   */
  baseline: number | null;
  /**
   * Leading in mm. null — Auto: the tolerance can't be computed, and the pair
   * then isn't built at all (`contents-unpaired`), rather than getting a
   * tolerance of 0.
   */
  leading: number | null;
}

export interface ClaimFrame {
  id: string;
  page: string;
  styleName: string;
  /**
   * ≠ 0 makes baselines incomparable: in a rotated frame they sit in a
   * rotated coordinate system. The folio doesn't care, but the number column
   * would silently drift — so this is a separate finding, not a silent skip
   * (spec §4.7).
   *
   * A BOUNDARY, NAMED OUT LOUD, SO IT ISN'T REDISCOVERED. The angle IS
   * measured, but the `folio` family doesn't USE it anywhere yet: `bounds`
   * is taken from `geometricBounds`, i.e. from a bounding box computed from
   * TWO corners. For multiples of 90° (all 91 frames in the book are −90°)
   * it's exact; for an arbitrary angle it's UNDERSTATED, and an overlap then
   * disappears silently — exactly the failure mode §3 is against. Spec §8
   * requires a `folio-rotated` fixture state and a bounding box from FOUR
   * corners; that's Task 6, not Task 3.
   */
  rotationAngle: number;
  paragraphs: ClaimParagraph[];
  /**
   * `null` — BOUNDS UNKNOWN, and that's a state, not a zero.
   *
   * Occurs for a master item for which no master page was found, i.e. there's
   * nothing to reduce its coordinates to document-spread coordinates against
   * (the measured case — a GROUP's sheet outside master pages; docstring of
   * `IDMCP.masterPageOriginOf`). Previously a zero rectangle `{0,0,0,0}` went
   * here — "visible in the report," but still a RECTANGLE: a §4.9 detector
   * asking about coordinates would get numbers nobody measured.
   *
   * Together with this field `overlaps` is also `null`: there's nothing to
   * count an overlap against.
   */
  bounds: FrameGeometry | null;
  /** Layer. Needed so as not to write into a locked one and to find `_folio-helper`. */
  layerName: string;
  /**
   * A hidden layer MUTES the marker (measured, Question 8) — but means the
   * opposite for a frame versus for a service thread (§4.9): the frame
   * ITSELF being hidden means "not lying today" (`folio-dormant-duplicate`,
   * not an error); a hidden service thread the frame draws its number from
   * means "the number is false" (`folio-marker-unbound`).
   */
  layerVisible: boolean;
  /**
   * Measured (Question 8): `printable = false` does NOT break marker
   * resolution, unlike `visible = false`. That's exactly why the
   * `_folio-helper` service layer is created as `printable = false, visible
   * = true` — unfit for print, but visible. Two boolean fields of identical
   * shape, side by side, behave oppositely; they must not be confused (spec
   * §4.8).
   */
  layerPrintable: boolean;
  /**
   * The frame came from `page.masterPageItems`, not from `allPageItems`. You
   * can't write into it; you need to see it — otherwise it would disappear
   * just as unoverridden master elements disappeared from the `runningHead`
   * family (see the comment at `PaginationDefect`).
   */
  fromMaster: boolean;
  /**
   * `frame.locked` — the lock on the ELEMENT ITSELF. `SkipReason:
   * "locked-frame"` (spec §4.4, step 7).
   *
   * NOT "an InDesign physical prohibition," and this is measured, not
   * hearsay (Question 19, states B and B2): with `frame.locked === true`,
   * replacing a character via
   * `characters.itemByRange(...).contents` goes through WITHOUT AN
   * EXCEPTION, at both levels of interaction. The lock is real —
   * `geometricBounds` and `remove()` on that same frame throw `Object is
   * locked.` — but it protects the page item, not its text. So a refusal on
   * this field is OUR policy, and the right one: the layout artist sets the
   * lock, and is entitled to treat it as a guarantee.
   */
  locked: boolean;
  /**
   * `frame.itemLayer.locked` — the LAYER's lock, and it's a SECOND,
   * INDEPENDENT flag. `SkipReason: "locked-layer-frame"`.
   *
   * WHY A SEPARATE FIELD, NOT `locked ||= layer.locked`. Measured (Question
   * 19, state C): a frame on a locked layer has `frame.locked === false`. So
   * until now the measurement never saw this state at all, the oracle judged
   * such a frame eligible, and a write into it went through (Task 11
   * measured `applied: 1`). Merging the two flags into one field would rob
   * the report of the answer to WHICH lock fired — the operator would go
   * remove a lock from the frame that isn't there. The same confusion as
   * between a frame's `layerVisible` and the overlapped one's `layerVisible`
   * (§4.8), and it already cost the phase a round.
   */
  layerLocked: boolean;
  /**
   * The frames THIS frame overlaps, with their thread links.
   *
   * THREE STATES, NOT TWO, AND TWO OF THEM USED TO BE ONE:
   * - a non-empty array — overlaps exactly these frames;
   * - `[]` — checked among frames with KNOWN bounds and overlaps none of
   *   them. The marker will then show the current page (H6, case B), i.e.
   *   the frame is unfit — that's a fact about the layout;
   * - `null` — NOT CHECKED. Either the frame doesn't belong to the `folio`
   *   family (the overlap table is only built for it), or its own `bounds
   *   === null`.
   *
   * WHY "AMONG FRAMES WITH KNOWN BOUNDS," NOT JUST "OVERLAPS NOTHING." The
   * page's overlap table is built from ALL of its frames, including those
   * whose `bounds === null`, and `IDMCP.boundsTouch`
   * (`src/jsx/pagination.jsx:517`) returns `false` the moment either side is
   * `null`. So a neighbor without document coordinates silently drops out of
   * the comparison. This state is reachable and measured on the fixture,
   * page «2», two entries side by side: a sheet from a master group
   * (`bounds: null`, `overlaps: null`) and a frame with reduced bounds that
   * returns `[]`. The broader phrasing ("checked ALL") is impossible here by
   * construction: about a frame without coordinates you physically can't say
   * "doesn't overlap," you can only say "unknown."
   *
   * Until now both "didn't check" cases returned `[]`, a value
   * byte-identical to a measured fact, and §4.9 would have reported "no
   * dormant duplicates" on the strength of a check that never happened. The
   * type is nullable here precisely so the compiler forces the caller to
   * write the branch.
   */
  overlaps: ThreadLink[] | null;
}

export interface HeadingRef {
  styleName: string;
  text: string;
  /** null — a heading in overset text: there's no page, in `notCompared`. */
  page: string | null;
  /** Order in the document. Matching within a level goes by exactly this. */
  order: number;
}

/**
 * A master frame skipped by the `contents` and `headings` families.
 *
 * A frame from `page.masterPageItems` participates ONLY as a folio (spec
 * §4.1) — the right decision, because otherwise one running head would
 * multiply into as many phantom headings as pages the master is applied to.
 * But without this record it's SILENT, and silence here is worse than an
 * error: an edition with templated contents (both lines and headings on
 * parent pages) would produce
 * `contents: { checked: 0, deviating: 0, notCompared: 0, groups: [] }` — a
 * shape read as "all clean."
 */
export interface MasterSkip {
  styleName: string;
  /** The role DECLARED by this call. `folio` is impossible here — it's never skipped. */
  role: "number" | "title" | "heading";
  /**
   * The number of CLAIMS, not layout objects: one running head on 40 pages
   * gives 40. That's exactly how many phantom lines it would have given the
   * contents, so the number describes the size of what was skipped, not the
   * number of frames in the document.
   *
   * THE CLAIM UNIT DIFFERS BY ROLE, because the collection itself differs:
   * `number` and `title` are collected PER FRAME (by the first paragraph's
   * style), so the unit is a (page × frame) pair; `heading` is collected PER
   * PARAGRAPH, so the unit is a (page × paragraph) pair. A master frame with
   * two headings on 5 pages gives 10, and that's exactly the 10 phantom
   * headings it would have given.
   */
  frames: number;
}

/**
 * One link of the service thread.
 *
 * `page === null` — the frame doesn't belong to any page (the pasteboard,
 * after layout edits). This isn't "unknown," it's a FACT: such a link
 * doesn't hold the thread together — there's no page for the marker to
 * resolve to — and the repair removes it.
 */
export interface HelperFrameRef {
  frameId: string;
  page: string | null;
  pageOffset: number | null;
  /**
   * `story.id` of the thread the frame is stitched into.
   *
   * A FRAME STITCHED INTO THE WRONG THREAD ISN'T EXOTIC — IT'S THE MOST
   * COMMON BREAKAGE. Measured (`H8`, Question 2): `page.duplicate()` copies
   * the service frame along with the page, but does NOT stitch the copy —
   * the result is a second story with one container. Without this field
   * such a state is invisible: the frame exists on the page, and the main
   * story's order stays monotonic.
   */
  storyId: string;
  /**
   * Position among the story's `textContainers`, 0-based. `−1` — the position
   * wasn't established (the frame wasn't found among its own story's
   * containers; a theoretical state, but "wasn't measured" must be
   * distinguishable from "first" here).
   */
  orderInStory: number;
}

/**
 * THE STATE OF THE SERVICE THREAD — a measurement, not derived from verdicts
 * (Phase 8 spec, §4.1).
 *
 * WHY THIS CAN'T BE DERIVED FROM `ClaimFrame.overlaps`. A service frame is
 * genuinely visible bottom-up: under a folio it inevitably lands in
 * `overlaps` (measured, Phase 7 Question 20 — the geometry matches exactly),
 * and that's exactly what the per-frame proof of eligibility rests on. But a
 * page WITHOUT a folio never enters that measurement at all, and on the book
 * that's exactly how it broke: 167 frames for 196 pages, missing precisely
 * where there's no folio. So with the data available, the question "is there
 * a link on EVERY page" can't even be asked.
 *
 * THE TRAVERSAL MUST BE LINEAR, AND THIS IS A MEASUREMENT, NOT TASTE (`H8`,
 * Question 7b): on 100 pages the quadratic form (each frame's position looked
 * up separately) costs **4,231 ms**, the linear one (the story's containers
 * walked once into an `id → position` table) — **257 ms**. On a 196-page book
 * that's 16 seconds versus half a second, i.e. the difference between unfit
 * and acceptable.
 */
export interface HelperChainMeasure {
  layerName: string;
  /**
   * Measured (Phase 7 Question 8): `false` MUTES marker resolution — every
   * automatic folio silently becomes "N–N".
   */
  layerVisible: boolean;
  /**
   * Measured in the same place: `false` does NOT break resolution, and this
   * is the NORMAL state for this layer. Two boolean fields of identical
   * shape behave oppositely; they must not be confused.
   */
  layerPrintable: boolean;
  layerLocked: boolean;
  /** The stories the layer's frames are stitched into. More than one — the thread fell apart. */
  storyIds: string[];
  frames: HelperFrameRef[];
  /**
   * Names of pages with NO frame of this layer at all.
   *
   * A BOUNDARY, NAMED OUT LOUD: this is "no layer frame," not "no THREAD
   * LINK." A page covered by a frame that sits on the layer but isn't
   * stitched into the thread does NOT land here — `folio-helper-chain-split`
   * catches it via `storyIds`. The split is deliberate: one number can't
   * honestly mean two different things, and the measured breakage (page
   * duplication) produces exactly a second one.
   */
  pagesWithoutFrame: string[];
}

/**
 * The running head's appearance — exactly what `ClaimFrame` doesn't carry.
 *
 * A SEPARATE TYPE, NOT FIELDS ON `ClaimFrame`: no rule needs font and color
 * for the folio, and adding them there would mean paying the measurement
 * cost for 160 frames for the sake of 50.
 */
export interface HeadAppearance {
  font: string | null;
  pointSize: number | null;
  /**
   * The color's VALUE, not its name: `"CMYK:20,100,70,10"`.
   *
   * Measured (`H10-E`): the `Колонтитул v2` style's ink has an EMPTY name.
   * Comparing by name would make two different unnamed colors look the
   * same — a check that could never fail. `null` — couldn't be read; this
   * leads to `notCompared`, not a defect.
   */
  fillValue: string | null;
}

/**
 * One running-head CLAIM — "what THIS page will print."
 *
 * The same unit as the other families' `FamilyResult.checked`: a master
 * frame is one object, visible from N pages, and each showing is a separate
 * claim.
 *
 * BUT `id` IS SHARED across all N (measured in Phase 7:
 * `masterPageItems` returns the master's element, not a copy), and that's
 * exactly what grouping the master's defects into ONE finding instead of
 * thirteen rests on. Measured `H10-B`: one master frame feeds up to 13
 * pages.
 */
export interface HeadFrame {
  id: string;
  page: string;
  styleName: string;
  fromMaster: boolean;
  /** The master page's name — so there's somewhere to fix the finding. */
  masterName: string | null;
  side: PageRef["side"];
  /** The frame's glued-together contents, whitespace collapsed. */
  text: string;
  empty: boolean;
  overset: boolean;
  appearance: HeadAppearance;
}

export interface PaginationMeasure {
  docName: string;
  pages: PageRef[];
  folioFrames: ClaimFrame[];
  contentsTitles: ClaimFrame[];
  contentsNumbers: ClaimFrame[];
  headings: HeadingRef[];
  /**
   * Running heads. An EMPTY ARRAY if `runningHeadStyles` wasn't declared —
   * the family wasn't asked for, and the measurement didn't pay for it.
   */
  headFrames: HeadFrame[];
  /**
   * A LOUD CHANNEL AGAINST THE BLIND SPOT NAMED IN §4.1.
   *
   * `declared` is exactly the blind spot: the operator declared this style,
   * and a frame with it sits on a parent page and won't land in the report.
   * `undeclared` — the rest of the master frames (running heads, service
   * labels); they weren't searched for, so this isn't a blind spot, but their
   * count is a NEGATIVE CONTROL for a zero in `declared`: "there are master
   * frames here at all, and none of them is yours."
   *
   * One master frame lands in EXACTLY ONE of the two numbers: a frame that
   * contributed even one missed declared heading isn't counted in
   * `undeclared`, otherwise the same claim would be both a blind spot and its
   * own negative control.
   */
  masterSkipped: { declared: MasterSkip[]; undeclared: number };
  /**
   * `null` — there is NO `_folio-helper` layer in the document AT ALL, i.e.
   * no thread was ever built and there's nothing to break.
   *
   * THIS IS NOT "A THREAD OF ZERO FRAMES": that, with the layer present, IS
   * a defect. The same lesson as `ClaimFrame.overlaps` (`null` vs `[]`),
   * which already cost the phase a fix round — "wasn't measured" is never
   * returned as a value byte-identical to a measured fact. The tempting
   * patch `helperChain ?? empty` would produce as many "missing" findings on
   * EVERY document without the layer as it has pages.
   */
  helperChain: HelperChainMeasure | null;
  /**
   * Declared styles that don't exist in the document. A LOUD error, not
   * silence: a typo in a style name otherwise gives zero findings, read as
   * "all clean" — exactly the failure mode Phase 5 caught five times.
   */
  missingStyles: string[];
  /**
   * Styles declared by TWO families at once.
   *
   * `declared` holds one role per style name, and the whole split below
   * branches on exactly that. So a style named in both `folio.styleNames`
   * and `headingStyles` loses one of its roles — and `missingStyles` stays
   * silent about it, because the style exists. Before 2026-08-18 the winner
   * was the LAST `want()` call, i.e. code order, not a user decision; now
   * the first role stays, and the fact of the collision goes here.
   *
   * Optional (`?`): `PaginationMeasure` fixtures written before this
   * addition don't have the field, and `npm run typecheck` already sees the
   * tests.
   */
  conflictingStyles?: Array<{ style: string; kept: string; alsoDeclared: string }>;
}

export type PaginationDefect =
  | "folio-stale"
  | "folio-duplicates-auto"
  | "folio-unparsable"
  /**
   * ДВІ ОДНОЙМЕННІ СТОРІНКИ — «НЕ ПОРІВНЯНО», не «розійшлося».
   *
   * Секція, що починає нумерацію заново, дає дві сторінки «3». `Map` лишає
   * ОСТАННЮ, тож рамка на першій судилася б проти сусідів, сторони й офсету
   * другої: і хибне спрацювання, і пропуск, і в обох випадках звіт відсилає
   * редактора не на ту сторінку.
   *
   * Розрізнити їх не можна, ВИЯВИТИ — можна, і `rewrite.ts` цей самий стан
   * уже відмовляється переписувати (`ambiguous-page-name`), називаючи в
   * коментарі саме `detectFolio` як місце, де мапа будується так само.
   * У `NON_DEVIATIONS` з тієї ж причини, що й `folio-unparsable`, і з тим
   * самим `claimed: null`.
   */
  | "folio-ambiguous-page-name"
  | "folio-manual"
  /**
   * Three Phase 7 defects — marker frames instead of hand-typed numbers (spec §4.9).
   *
   * In `deviating`, NOT in `NON_DEVIATIONS`: the frame prints, and the
   * printed number is wrong RIGHT NOW, not only after the next recompose.
   */
  | "folio-marker-unbound"
  | "folio-marker-cross-spread"
  /**
   * "THIS FRAME WASN'T MEASURED BY THE DETECTOR" — a separate channel,
   * because silence here reads as "clean."
   *
   * `ClaimFrame.overlaps === null` means "overlaps were NOT COUNTED" (the
   * frame's own `bounds` are unknown), and §4.9 forbids turning this into
   * `folio-marker-unbound`: that would be an INVENTED defect. But silence
   * here is a refusal of the same kind, just in the other direction: before
   * this finding, a frame whose topology nobody measured was byte-identical
   * in the response to a checked, clean one (measured by a review probe,
   * `14c503b`: `checked = 1, notCompared = 0, findings = 0`).
   *
   * In `NON_DEVIATIONS`, and for the same reason as `folio-unparsable`: both
   * say "not compared," not "diverged," and both have `claimed: null`. The
   * finding does NOT touch the counters: `checked` for the frame is already
   * counted, and `checked` and `notCompared` are mutually exclusive per
   * frame (§4.9, the arithmetic sidebar), so a third `notCompared` would
   * count one frame twice.
   */
  | "folio-marker-unmeasured"
  /**
   * In `NON_DEVIATIONS` (`src/pagination/report.ts`), like `folio-manual`:
   * a frame on a hidden layer doesn't print, so the number is correct
   * TODAY and will break once the layer is turned on tomorrow — the same
   * class as "will break later," not "wrong now."
   */
  | "folio-dormant-duplicate"
  /**
   * FOUR SERVICE-THREAD INTEGRITY DEFECTS (Phase 8 spec, §4.2).
   *
   * In `deviating`, not in `NON_DEVIATIONS`, and the basis is measured:
   * a hidden layer MUTES resolution (Phase 7 Question 8, 13 instead of 12
   * in the PDF), and a gap gives the marker the PREVIOUS FRAME's page
   * (Question 18), i.e. it shifts every following one. Both mean a wrong
   * number on the sheet RIGHT NOW.
   *
   * THE COST OF THIS CHOICE IS NAMED, NOT LEFT UNSAID: on a freshly built
   * thread, where no folio has been converted yet, `deviating` will say
   * "diverged" where the sheet is in fact still whole. This is an
   * over-refusal — the one side of the error §3 allows. The alternative (a
   * class that depends on whether any frames have been converted) is
   * explicitly rejected: a defect with a variable class reads worse than
   * one with a constant class.
   *
   * THE NAMES ARE `folio-helper-chain-*`, NOT `folio-helper-layer-hidden`:
   * the latter is already taken by a Phase 7 fixture STATE
   * (`tests/integration/pagination-fixture.test.ts`) with a completely
   * different meaning — a folio whose thread sits on a hidden layer, i.e.
   * an instance of `folio-marker-unbound`.
   *
   * `folio-helper-chain-split` WAS ADDED BY MEASUREMENT, NOT BY DESIGN, and
   * it's the most important of the four: the phase's brief named three
   * properties, and probe `H8` (Question 2) showed that
   * `page.duplicate()` — a normal operator action — leaves a frame on
   * EVERY page and a monotonic main-story order, meaning the other two
   * detectors stay silent while the numbers have already drifted.
   */
  | "folio-helper-chain-gap"
  | "folio-helper-chain-unordered"
  | "folio-helper-chain-hidden"
  | "folio-helper-chain-split"
  | "contents-stale"
  | "contents-unpaired"
  | "contents-ambiguous"
  | "contents-rotated-frame"
  | "contents-cross-spread"
  | "contents-count-mismatch"
  | "contents-out-of-order"
  /*
   * There is no `runningHead` family, and no room has been reserved for it
   * here.
   *
   * THE PREMISE TURNED OUT TO BE WRONG; THE DECISION ITSELF DID NOT. Probe H6
   * measured (Question 5) that there's no running head with a chapter name in
   * the book. Probe H7 (2026-08-07, Question 1) showed that there IS one —
   * on the verso of parent pages `E`, `D`, `J`.
   *
   * TWO DIFFERENT BLIND SPOTS, AND THEY MUST NOT BE CONFUSED:
   * - anchored frames aren't seen by `page.textFrames`, but `allPageItems`
   *   DOES see them (Phase 6 measured 3 versus 11 on one page — exactly why
   *   the pass was switched to `allPageItems`);
   * - unoverridden master elements are seen by NEITHER `page.textFrames`
   *   NOR `page.allPageItems`. A separate source is needed —
   *   `page.masterPageItems`.
   *
   * Probe H6 walked `page.textFrames` (`scripts/probe-h6-book.jsx:60,79`, no
   * call to `allPageItems` at all), so the running head was invisible to it
   * for the SECOND reason. That same second blind spot hid 40 verso pages.
   *
   * For Phase 6 the decision stands: a readable running-head audit was never
   * in its scope. But "there's no material" here must be read as "the
   * measurement didn't see it" — otherwise the next phase would inherit a
   * false fact.
   *
   * A dead variant that nothing constructs would read as an unfinished
   * function, not a deliberate decision.
   */
  | "contents-manual"
  /*
   * Five Phase 10 defects — the running head (spec §4.4).
   *
   * THEIR REPORT UNIT DIFFERS, and that's not an inconsistency.
   * `head-style-stray` and `head-side-stray` are about the MASTER FRAME, the
   * rest are about the page. One master frame feeds up to 13 pages (measured
   * `H10-B`), so a per-page report of a master's defect would give 13
   * identical lines for one cause that's fixed in one place.
   */
  | "head-wrong-chapter"
  | "head-missing"
  | "head-unexpected"
  | "head-side-stray"
  | "head-style-stray";

export interface PaginationFinding {
  id: string;
  family: "folio" | "contents" | "runningHead";
  defect: PaginationDefect;
  page: string | null;
  frameId: string | null;
  paragraphIndex: number | null;
  /** What the text claims. */
  claimed: string | null;
  /** What actually is. */
  actual: string | null;
  detail: string;
}

/**
 * The result for one family.
 *
 * The counters are MANDATORY: without them, zero findings can't be told
 * apart from "wasn't measured." `notCompared` is a separate number precisely
 * because "wasn't checked" isn't "clean."
 */
export interface FamilyResult {
  /**
   * The number of CHECKED CLAIMS, not frames in the layout — and after the
   * third source of frames (§4.1) this is no longer the same number.
   *
   * A master frame is ONE object, visible from N pages, and each showing is
   * a separate claim ("what THIS page will print"), so it's counted
   * separately too. Measured on the working book: `folioFrames` grew from 91
   * to 160, of which 69 come from only 2–3 master OBJECTS. Reading
   * `checked: 158` as "158 folios checked in the layout" is a mistake; the
   * correct reading is "158 claims about pages were checked."
   */
  checked: number;
  notCompared: number;
  findings: PaginationFinding[];
}

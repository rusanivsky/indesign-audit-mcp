/*
 * Measurement for `pagination_audit` (Phase 6).
 *
 * WHY A SEPARATE HANDLER, NOT `layout_measure`. That one takes 340,000 ms on
 * the real book (198 pages, Phase 5 measurement), because it walks every frame,
 * story, and paragraph. Here only pages, spread composition, and frames of
 * DECLARED roles are needed — orders of magnitude fewer. Phase 5 already paid
 * for this decision and got ≈30x (10,860 ms vs 340,000).
 */

/*
 * Spread composition — the REFERENCE for the `folio` family.
 *
 * This is exactly where "neighboring page" comes from, and exactly why the
 * rule needs neither a parameter nor a constant of this layout: InDesign
 * itself knows the spread composition. A constant "left = right minus 1"
 * would flip in a book with the folio on verso (spec §3).
 */
IDMCP.spreadSiblings = function (page) {
    var siblings = page.parent.pages;
    var total = siblings.length;
    var ownId = page.id;
    var out = [];
    for (var i = 0; i < total; i++) {
        var sib = siblings[i];
        if (sib.id !== ownId) out.push(String(sib.name));
    }
    return out;
};

IDMCP.PAGINATION_SPECIALS = [
    ["auto-page-number", SpecialCharacters.AUTO_PAGE_NUMBER],
    ["section-marker", SpecialCharacters.SECTION_MARKER],
    ["next-page-number", SpecialCharacters.NEXT_PAGE_NUMBER],
    ["previous-page-number", SpecialCharacters.PREVIOUS_PAGE_NUMBER]
];

/*
 * Comparison by IDENTITY, not via String().
 *
 * `String(ch.contents)` for an auto-marker gives the string "AUTO_PAGE_NUMBER" —
 * measured in Phase 4 (`src/layout/types.ts`). Comparing via String
 * happens to work for one marker and silently breaks on others.
 */
IDMCP.styleNameOf = function (para) {
    try { return String(para.appliedParagraphStyle.name); } catch (e) { return null; }
};

IDMCP.classifyChar = function (ch) {
    var list = IDMCP.PAGINATION_SPECIALS;
    for (var i = 0; i < list.length; i++) {
        if (ch.contents === list[i][1]) return list[i][0];
    }
    return null;
};

/*
 * The claim-frame's paragraph.
 *
 * WHY `literals` IS A SEPARATE FIELD instead of being parsed from the text
 * later: the marker looks like a plain character in the text, and a regex
 * over the text would count an AUTOMATIC number as manual. This exact
 * difference is the essence of both families.
 *
 * THE THIRD KIND OF CONTENT — an instance of a text variable (spec §4.6a). It
 * doesn't equal any `SpecialCharacters` and doesn't produce digits in the
 * text, so without a separate check a paragraph containing it would look
 * EMPTY, and the tool couldn't say the most important thing: the line is
 * already automatic. Measured on the book — that's exactly how its 35 table-
 * of-contents numbers are set.
 */
IDMCP.claimParagraph = function (para, index) {
    var text = "";
    var markers = [];
    var chars = para.characters;
    /*
     * OFFSET IN THE STRING ≠ CHARACTER INDEX, and that's exactly why the
     * position is collected here rather than extracted from the string
     * afterward.
     *
     * `character.contents` returns the ENUM NAME not only for markers, but
     * also for typographic characters: measured on the fixture (Task 3), the
     * frame «8–9» gives the characters ["8", "EN_DASH", "9"], i.e. the string
     * "8EN_DASH9" — the literal 9 sits at position 8 of the STRING and at
     * position 2 among CHARACTERS. The same holds on the working book for
     * «6–⟨marker⟩» (probe H7).
     *
     * The write handler addresses characters (`paragraph.characters[i]`), so
     * the offset must be per-character: a string offset would rewrite the
     * wrong character — precisely where a literal sits AFTER a special
     * character.
     *
     * `charAtPos[position in string] = character index`. A character that
     * contributed an empty string shares its position with the next one, and
     * "last one wins" is correct here: the position ends up holding the
     * character that actually started the digit run.
     */
    var charAtPos = {};
    /* `chars.length` is a DOM access, and in the loop header it would cost
     * once per EVERY character of the paragraph. */
    var charCount = chars.length;
    for (var i = 0; i < charCount; i++) {
        charAtPos[text.length] = i;
        var kind = IDMCP.classifyChar(chars[i]);
        if (kind === null) {
            text += String(chars[i].contents);
        } else {
            markers.push(kind);
            text += "￼";
        }
    }

    var variableCount = 0;
    try { variableCount = para.textVariableInstances.length; } catch (eV) { variableCount = 0; }
    for (var v = 0; v < variableCount; v++) markers.push("text-variable");

    /*
     * Iteration via `exec`, not `match`: `match` returns only the numbers
     * themselves, and the offset would then have to be found by a SECOND,
     * independent parse — exactly the gap between measurement and write that
     * spec §4.1 closes with a cross-check. The regex is the same; only the
     * iteration method changes.
     */
    var literals = [];
    var literalOffsets = [];
    var re = /\d+/g;
    var mm;
    while ((mm = re.exec(text)) !== null) {
        literals.push(parseInt(mm[0], 10));
        var at = charAtPos[mm.index];
        /* `undefined` here is impossible by construction (a digit is the
         * contribution of exactly one character), but a silent `undefined`
         * in the offsets array would be the worst possible outcome: the
         * write would land at position NaN. */
        literalOffsets.push(at === undefined ? mm.index : at);
    }

    var baseline = null;
    var leading = null;
    try {
        if (para.lines.length > 0) {
            baseline = para.lines[0].baseline;
            var lead = para.lines[0].leading;
            /* Auto leading arrives as an enum, not a number. A tolerance can't be
             * computed from it, so the pair isn't built at all in that case —
             * this is `notCompared`, not a tolerance of 0. */
            if (typeof lead === "number") leading = lead;
        }
    } catch (eL) {
        baseline = null;
    }

    return {
        index: index,
        /* The style of the paragraph ITSELF: the table-of-contents line's level is
         * a property of the paragraph, not of the frame that contains it. */
        styleName: IDMCP.styleNameOf(para),
        text: text,
        literals: literals,
        literalOffsets: literalOffsets,
        markers: markers,
        baseline: baseline,
        leading: leading
    };
};

/*
 * All text frames on the page, INCLUDING ANCHORED ONES.
 *
 * `page.textFrames` does NOT SEE anchored ones — measured with probe H6: on
 * p. 8 of the real book, one versus nine, and there are no groups there. In
 * this book, exactly the most interesting things are anchored: question
 * numbers, checklist rule lines, and table-of-contents numbers. A pass over
 * `page.textFrames` would report "no findings" — not an empty result, but
 * silent blindness (spec §4.2a).
 *
 * `constructor.name` is NOT used here: map.jsx already measured that
 * accessing an InDesign collection can return the generic wrapper «PageItem»
 * instead of the real type. We distinguish by the presence of `.paragraphs`.
 */
IDMCP.isTextFrameLike = function (item) {
    var paras = null;
    try { paras = item.paragraphs; } catch (eP) { return false; }
    if (paras === null) return false;
    try { return paras.length >= 0; } catch (eC) { return false; }
};

/*
 * THE THIRD SOURCE OF FRAMES — `page.masterPageItems`, and without it the
 * pass is blind.
 *
 * Measured with probe H7 (Questions 1 and 6): `allPageItems` does NOT SEE
 * UN-OVERRIDDEN elements of the parent page — on p. 19 of the real book it
 * returned 1 while `masterPageItems: 1`. Under this blindness lay 40 even
 * pages, all the book's running heads, and three parent AUTOMATIC folios.
 *
 * THIS IS A SECOND BLIND SPOT, NOT THE SAME AS THE FIRST. `page.textFrames`
 * doesn't see anchored frames, but `allPageItems` DOES SEE them — that's
 * exactly why Phase 6 switched to it. An un-overridden parent element is
 * invisible in NEITHER of them.
 *
 * Deduplication by `.id` is mandatory, not just-in-case: a re-overridden
 * element, per the Task 2 measurement (`_fixtures.jsx`, comment at
 * `__fixture_make_layout`), disappears from `masterPageItems` and appears in
 * `pageItems` — but relying on that "usually" is not safe, and a doubled
 * frame would produce a doubled finding at the same spot.
 */
/*
 * MASTER-PARSE CACHE, and it is not a just-in-case optimization.
 *
 * Master elements are the SAME OBJECTS for every page the master is applied
 * to: `page.masterPageItems` returns the master's own elements, not copies
 * (measured, Question 17: on fixture pages «1» and «3» the same frame comes
 * back with the same `.id`, and its `parentPage` is the MASTER page). So
 * group expansion, the "is this a text frame?" check, raw `geometricBounds`,
 * and the frame's ROLE (paragraph count + style of the first) are identical
 * across all pages for one master element, and without a cache they were
 * recomputed on every one: 196 times instead of once on the book, **57% of
 * all DOM accesses** (counter, spec §4.1).
 *
 * WHAT EXACTLY IS CACHED — FIVE THINGS, AND NONE OF THEM IS TEXT.
 * `leaves` (group expansion), `rawBounds`, `pageOrigin`, `role` (the pair
 * "paragraph count + style of the first", i.e. the decision about the
 * frame's ROLE), and `headSkips` (the list of this frame's PARAGRAPH styles
 * declared as `heading`). The `role` field used to be called `text` — and
 * the comment right here had to refute that ("none of them is text"); when a
 * name needs a comment to refute it, it's cheaper to change the name. An
 * earlier edit of this comment said "the master is parsed once" — and that
 * was OVER-PROMISING: the character-by-character `claimParagraph` parse for
 * master folio frames still runs on EVERY page.
 *
 * WHY TEXT IS NOT CACHED — A DECISION MADE BY MEASUREMENT, NOT CONVENIENCE.
 * Book-density rig (Task 3G, 100 pages, 76 with a master; A/B interleaved
 * within ONE session on one build, so build order couldn't substitute for
 * the conclusion):
 *
 *   - ROLE cache (this one): DOM accesses 2,719 → 2,608 (−4.1%), `styleNameOf`
 *     790 → 716. THE TIME WIN IS NOT VISIBLE: 650 → 698 ms, i.e. within
 *     session drift (±20%) and even in the direction opposite the counter.
 *     The counter reproduces to the unit, the time does not, and this
 *     measurement doesn't earn the right to say "it got faster";
 *   - an additional cache of the PARAGRAPHS THEMSELVES: 2,608 → 2,497
 *     (−4.3%), `claimParagraph` 84 → 47, time 619 → 533 ms (−14%, the same
 *     direction across all three pairs). Output stays byte-identical
 *     throughout — signature 116,461,718 on every run.
 *
 * So the win is real, and it was REJECTED not for lack of a number, but for
 * its cost: `claimParagraph` is page-independent ONLY AS LONG AS the
 * measurement records the marker's KIND, not its value. The §4.9 detectors
 * (Task 6) ask exactly "which page will THIS page's marker resolve to," and
 * the first such field would let an `.id`-keyed cache silently freeze the
 * answer across all pages — the same class of failure §3 stands against, and
 * exactly the trap the earlier comment fell into. There's nothing to pay
 * this cost with: the pass on the book takes 3,341 ms out of a 120,000
 * ceiling (2.8%), so speed isn't scarce here. The numbers live on in
 * `docs/measured-facts-phase7.md` — if the margin ever disappears, the
 * decision is revisited with them, not from scratch.
 *
 * WHAT THE CACHE ALSO DOES NOT DO: it does not cache the `page.masterPageItems`
 * LIST ITSELF. This is deliberate — an element re-overridden on a specific
 * page DISAPPEARS from this list (Task 2 measurement, comment at
 * `__fixture_make_layout`), so a cache of the list keyed by master name would
 * silently hand back the frame to a page where it has already been
 * re-overridden.
 *
 * It lives for exactly one pass — created inside the handler, not in
 * `IDMCP`: a cache that outlived the call would hand the next run frames
 * from a closed document.
 */
/*
 * THE OBJECT'S OWN KEY, NOT AN INHERITED ONE — AND THIS IS NOT OVERCAUTION.
 *
 * Paragraph style names come from the user's document, i.e. they are
 * ARBITRARY strings, and it's exactly them that become dictionary keys here.
 * A style named `constructor`, `toString`, or `valueOf` turns `obj[name]`
 * from `undefined` into a function from the prototype. Reproduced by
 * executing in node: `{}["constructor"]` → `function`, and on that the
 * skipped frame's index turned into a function, `masterSkipped.declared[skipAt]`
 * became `undefined`, and `.frames += 1` threw a `TypeError` — i.e. the
 * WHOLE measurement crashed.
 *
 * `Object.prototype.hasOwnProperty.call`, not `obj.hasOwnProperty(...)`: the
 * latter breaks itself on a style named `hasOwnProperty` (there a string
 * «folio» would already sit, not a function) — i.e. it would fix every name
 * except its own.
 */
IDMCP.hasOwn = function (obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
};

/*
 * AN UNKNOWN KEY IN THE PARAMETERS — A LOUD FAILURE, NOT SILENT IGNORING.
 *
 * THE INCIDENT. Commit `fc8f96d` renamed `folioStyle` (a string) to
 * `folioStyles` (an array). A caller with the old key got not an error but an
 * EMPTY REPORT: `wantFolio` empty → `declared` empty → `missingStyles` empty
 * → the `missingStyles.length > 0` gate doesn't fire → `folioFrames: []` →
 * `checked: 0, deviating: 0`. Reads as "all clean."
 *
 * WHY NOT "THROW ON AN EMPTY ARRAY," AS THE REVIEW SUGGESTED. Because an
 * empty array is a LEGITIMATE value: `src/tools/pagination.ts:714` sends
 * `folioArg?.styleNames ?? []` exactly when the `folio` family isn't declared
 * at all ("wasn't asked about"). Throwing on `[]` would take down
 * `pagination_audit` on every edition where folios aren't described. The
 * schema really does reject an empty array INSIDE `folio`, but it isn't the
 * schema that reaches the JSX.
 *
 * What distinguishes these two cases isn't emptiness but THE KEY ITSELF. So
 * the gate stands on the list of keys, and it's broader than one case: it
 * catches `folioStyle`, `styleName`, and any other form that fell behind the
 * code — including ones that don't exist yet.
 */
IDMCP.rejectUnknownParams = function (where, params, knownKeys) {
    if (params === null || params === undefined) return;
    var known = {};
    for (var k = 0; k < knownKeys.length; k++) known[knownKeys[k]] = true;
    var unknown = [];
    for (var name in params) {
        if (!IDMCP.hasOwn(params, name)) continue;
        if (known[name] === true) continue;
        unknown.push(name);
    }
    if (unknown.length === 0) return;
    throw new Error(
        "Unknown parameters in \"" + where + "\": " + unknown.join(", ") +
        ". Known: " + knownKeys.join(", ") +
        ". Silently ignoring them would give an empty report that reads as \"clean\"."
    );
};

IDMCP.newMasterCache = function () {
    return { leaves: {}, rawBounds: {}, pageOrigin: {}, role: {}, headSkips: {} };
};

/*
 * Expansion of ONE master element down to text frames.
 *
 * `expand` is NOT a cosmetic flag, and turning it on for both sources is not
 * allowed. `page.allPageItems` is already recursive: expanding each of its
 * NON-text elements again means walking the same branch as many times as it
 * has ancestors — and on a deep page that's quadratic, not linear. The
 * result doesn't change at all in that case: deduplication by `.id` drops the
 * repeats, so the cost would be pure waste.
 *
 * `masterPageItems`, by contrast, is FLAT — a group arrives there as a group,
 * and without expansion the text inside it isn't visible. So only this one
 * gets expanded, and by exactly one level (`allPageItems` inside a group is
 * already recursive).
 */
IDMCP.collectMasterInto = function (item, out, expand) {
    if (IDMCP.isTextFrameLike(item)) {
        var id;
        try { id = String(item.id); } catch (eI) { return; }
        out.push({ frame: item, id: id });
        return;
    }
    if (!expand) return;
    var inner = null;
    try { inner = item.allPageItems; } catch (eG) { inner = null; }
    if (inner === null) return;
    var innerCount = -1;
    try { innerCount = inner.length; } catch (eGC) { innerCount = -1; }
    for (var k = 0; k < innerCount; k++) IDMCP.collectMasterInto(inner[k], out, false);
};

IDMCP.pageFrameRecords = function (page, cache) {
    var out = [];
    var seen = {};

    function push(item, id, fromMaster) {
        if (seen[id] === true) return;
        seen[id] = true;
        out.push({ frame: item, id: id, fromMaster: fromMaster });
    }

    var all = null;
    try { all = page.allPageItems; } catch (eA) { all = null; }
    if (all) {
        var allCount = all.length;
        for (var i = 0; i < allCount; i++) {
            var item = all[i];
            if (!IDMCP.isTextFrameLike(item)) continue;
            var id;
            try { id = String(item.id); } catch (eI) { continue; }
            push(item, id, false);
        }
    }

    var mast = null;
    try { mast = page.masterPageItems; } catch (eM) { mast = null; }
    if (mast) {
        var mastCount = mast.length;
        for (var k = 0; k < mastCount; k++) {
            var top = mast[k];
            var tid;
            try { tid = String(top.id); } catch (eT) { continue; }
            var leaves = cache.leaves[tid];
            if (leaves === undefined) {
                leaves = [];
                IDMCP.collectMasterInto(top, leaves, true);
                cache.leaves[tid] = leaves;
            }
            for (var L = 0; L < leaves.length; L++) push(leaves[L].frame, leaves[L].id, true);
        }
    }

    return out;
};

/*
 * Bounds in SPREAD coordinates, mm — on the condition that the pass has set
 * `rulerOrigin = SPREAD_ORIGIN` (see handler).
 *
 * InDesign's order is [y1, x1, y2, x2]; normalized via min/max because the
 * order is guaranteed by InDesign, not by us, and a flipped pair would
 * silently produce "no overlap" instead of an error.
 *
 * WHICH SPREAD EXACTLY — DEPENDS ON THE FRAME, AND THIS IS A TRAP FOR THE
 * CALLER. For a frame from `page.masterPageItems` this is the MASTER's
 * spread, not the document's: zero sits at the corner of whichever spread
 * the element BELONGS TO (measured, Question 17). The difference equals a
 * whole page width — 215.9 mm on the book's first page. `recordBounds`
 * reconciles it, and only it; whoever calls `frameBounds` directly on a
 * master frame gets a silent error of a whole page. This function
 * deliberately stays a raw instrument: reconciliation needs the PAGE it's
 * viewed from, and the frame doesn't know it.
 */
IDMCP.frameBounds = function (frame) {
    var g;
    try { g = frame.geometricBounds; } catch (eB) { return null; }
    var a = Number(g[0]), b = Number(g[1]), c = Number(g[2]), d = Number(g[3]);
    if (isNaN(a) || isNaN(b) || isNaN(c) || isNaN(d)) return null;
    return {
        y1: Math.min(a, c),
        x1: Math.min(b, d),
        y2: Math.max(a, c),
        x2: Math.max(b, d)
    };
};

/** The page's top-left corner in the coordinates of ITS spread. */
IDMCP.pageOriginOf = function (page) {
    var b;
    try { b = page.bounds; } catch (eB) { return null; }
    var y = Number(b[0]), x = Number(b[1]);
    if (isNaN(y) || isNaN(x)) return null;
    return { y1: y, x1: x };
};

/*
 * The corner of the MASTER page that the master element belongs to.
 *
 * `null` means "the element has no master page" — then there's NOTHING TO
 * RECONCILE against, and no reconciliation is more correct than another.
 *
 * WHAT EXACTLY TRIGGERS THIS BRANCH — MEASURED, NOT DEDUCED. Here (and in
 * two neighboring spots) it used to say "an element crossing the master's
 * spine." That's FALSE: a probe on a 4-page fixture, four states, each one's
 * `parentPage` —
 *
 *   a frame CROSSING the master spread's spine        «A»    (not null!)
 *   a frame on the master's pasteboard                 null   (never reaches
 *                                                              the code: it
 *                                                              isn't in
 *                                                              `page.masterPageItems`
 *                                                              at all)
 *   a GROUP's leaf within the master page's bounds     «A»
 *   a GROUP's leaf outside the master pages            null   ← THIS ONE
 *
 * So the branch is triggered by GROUP EXPANSION (`collectMasterInto`): the
 * group itself is assigned to the master page and arrives in
 * `page.masterPageItems`, but its leaf, lying outside the master pages,
 * belongs to nobody. On the same probe, such a leaf produced 2 records with
 * `bounds === null` (one for each of the two verso pages the master is
 * applied to), while the frame crossing the spine produced 4 records with
 * reconciled bounds and no `null` at all.
 *
 * What the caller does with this — see `recordBounds`: not raw bounds
 * masquerading as reconciled ones, but a `null` that's visible in the report.
 */
IDMCP.masterPageOriginOf = function (frame) {
    var pg = null;
    try { pg = frame.parentPage; } catch (eP) { return null; }
    /* Truthiness, not `===`: on DOM objects the `===` operator sometimes
     * THROWS («TextFrame.===() cannot work with instances of this class») —
     * measured 2026-08-18, see `IDMCP.resolveContainerPage` in `inspect.jsx`. */
    if (!pg) return null;
    return IDMCP.pageOriginOf(pg);
};

/*
 * RECORD BOUNDS, RECONCILED TO THE DOCUMENT SPREAD.
 *
 * MEASURED (Question 17, three states, `docs/measured-facts-phase7.md`):
 * with `SPREAD_ORIGIN`, zero sits at the corner of the spread the element
 * BELONGS TO, and for `page.masterPageItems` that's the MASTER's spread. Raw
 * numbers from the book's first page: a master frame from the right master
 * page returned `x = [245.9 … 295.9]`, while its actual place on document
 * page «1» is `x = [30 … 80]`. The 215.9 mm discrepancy is exactly a whole
 * page width.
 *
 * The axes coincide ONLY as long as the page's position in its spread equals
 * the master page's position in the master spread. They diverge at least
 * three times: the book's first page (recto alone, position 0 vs. 1) and the
 * third page of a three-page spread (position 2 vs. 1). `SINGLE_SIDED`
 * coincides.
 *
 * The reference is taken FROM THE DOCUMENT, not from a layout constant
 * (§3.2): the offset is the difference between two pages' corners, both from
 * `page.bounds`. Neither page width nor the number of pages in a spread is
 * needed here, so the rule carries over to any edition.
 */
IDMCP.recordBounds = function (rec, pageOrigin, cache) {
    if (rec.fromMaster !== true) return IDMCP.frameBounds(rec.frame);

    var raw = cache.rawBounds[rec.id];
    if (raw === undefined) {
        raw = IDMCP.frameBounds(rec.frame);
        cache.rawBounds[rec.id] = raw;
    }
    if (raw === null) return null;

    var origin = cache.pageOrigin[rec.id];
    if (origin === undefined) {
        origin = IDMCP.masterPageOriginOf(rec.frame);
        cache.pageOrigin[rec.id] = origin;
    }

    /*
     * NOTHING TO RECONCILE AGAINST — THIS IS `null`, NOT A SILENT ZERO OFFSET.
     *
     * This used to be `dy = dx = 0`, and two DIFFERENT causes merged into one
     * silent branch: "the element has no master page" (the measured case — a
     * GROUP's leaf outside the master pages, see the `masterPageOriginOf`
     * docstring) and "the document page's `page.bounds` failed to read."
     * Both returned raw master coordinates DISGUISED as document ones.
     *
     * What this cost: on a page at position 0 (the book's first page — recto
     * alone), a frame from the right master page drifts by a whole page
     * width — 215.9 mm, Question 17 measurement. That is, outside its own
     * spread: it has zero overlaps, and §4.9 reports "no sleeping duplicates"
     * exactly where they exist. This is the same failure mode B1 just fixed —
     * only quieter.
     *
     * WHAT `null` BY ITSELF DID NOT DO, AND THIS WAS PROVEN BY A PROBE. An
     * earlier edit of this comment promised that downstream "`boundsTouch(null,
     * …)` honestly says 'overlap unknown'." `boundsTouch` is NOT CALLED AT ALL
     * when the frame's own bounds are unknown (`claimFrame` doesn't enter the
     * loop), and the answer that went out was `overlaps: []` — a value
     * byte-identical to "we checked and there are no overlaps." So the
     * loudness now isn't in that function, but in the shape of the answer:
     * `claimFrame` returns `bounds: null` and `overlaps: null`, i.e. "didn't
     * count," not "none."
     */
    if (origin === null || pageOrigin === null) return null;
    var dy = pageOrigin.y1 - origin.y1;
    var dx = pageOrigin.x1 - origin.x1;
    /* A copy, not `raw` itself: the object from the cache is shared across all
     * pages, and returning it outward would mean handing one structure to
     * several results at once. */
    return { y1: raw.y1 + dy, x1: raw.x1 + dx, y2: raw.y2 + dy, x2: raw.x2 + dx };
};

/*
 * Record bounds with memoization within a PAGE: each frame's
 * `geometricBounds` is read exactly once, no matter how many times it's
 * needed — both as the claim-frame's own bounds and as a row of the overlap
 * table.
 */
IDMCP.boundsAt = function (records, memo, at, pageOrigin, cache) {
    if (memo[at] !== undefined) return memo[at];
    var b = IDMCP.recordBounds(records[at], pageOrigin, cache);
    memo[at] = b;
    return b;
};

/*
 * Tolerance of 0.01 mm. Touching is counted deliberately: Adobe describes
 * marker resolution as «touches or overlaps», and on the working book all 7
 * existing contacts between a folio and the chain are exactly `touch` (H7,
 * Question 3), i.e. a strict comparison would give zero overlaps where
 * InDesign sees them.
 */
IDMCP.BOUNDS_EPSILON_MM = 0.01;

IDMCP.boundsTouch = function (a, b) {
    if (a === null || b === null) return false;
    var eps = IDMCP.BOUNDS_EPSILON_MM;
    if (a.x2 < b.x1 - eps) return false;
    if (b.x2 < a.x1 - eps) return false;
    if (a.y2 < b.y1 - eps) return false;
    if (b.y2 < a.y1 - eps) return false;
    return true;
};

/* `total` comes from outside, because the caller has already read
 * `containers.length` for its own loop — reading it a second time on every
 * call would mean paying for the same answer twice.
 *
 * THERE IS DELIBERATELY NO NUMBER AT THIS LINE. It used to say "8,707
 * accesses," but that figure is from the Task 3F brief, and it covers
 * `containers.length` AND `frame.id` TOGETHER; that same task's own counter
 * gave 780 → 784 for `containerPageName`, i.e. the 8,707 doesn't apply to
 * this line. A wrong number in a comment is the same kind of finding as
 * wrong code. */
IDMCP.containerPageName = function (containers, at, total) {
    if (at < 0) return null;
    if (at >= total) return null;
    try {
        /* A frame in OVERSET text has no page — this is `null`, not a guess about
         * a neighboring page. */
        var pg = IDMCP.parentPageOf(containers[at]);
        if (!pg) return null;
        return String(pg.name);
    } catch (eP) { return null; }
};

/*
 * `ThreadLink` — SEVEN fields, and each has its own consumer.
 *
 * `previousPage`/`nextPage` are exactly the NEIGHBOR IN THE THREAD, not
 * "current ± 1": the distinction was measured by probe H6 (case C).
 * `createdOrder` was measured with H7 (Question 9, 5 cases out of 5): when
 * two threads overlap, the one CREATED EARLIER wins — a smaller value means
 * earlier; stacking order has no effect at all. `layerVisible` — the layer
 * of the OVERLAPPED frame: hidden MUTES the marker (Question 8), and without
 * this field `folio-marker-unbound` can't be counted.
 *
 * `layerName` — the NAME of that same layer, and it's read from the same
 * `frame.itemLayer` as `layerVisible`, so it costs zero extra accesses.
 * Without it, the SERVICE frame `_folio-helper`, which sits exactly under
 * the folio, is indistinguishable from a main-text frame — and this exact
 * indistinguishability was hole C1: the route was chosen as "there's a
 * document overlap → thread," so the `helper` branch stayed reachable
 * EXACTLY WHEN there is no service frame under the folio. The unit of the
 * claim became the PAGE where InDesign's physics demands the FRAME.
 *
 * `fromMaster` — the origin of the OVERLAPPED frame, and it arrives FROM
 * OUTSIDE, because it can't be derived from within: a master frame's
 * `parentPage` returns the master's page, but the same answer also occurs
 * for a document frame on a different page. The source of truth is the same
 * tag that `pageFrameRecords` collected the frame with. Why the field exists
 * at all — see `ThreadLink.fromMaster` in `src/pagination/types.ts` and spec
 * §4.2: without it, the phase would force the `thread` route on 90 frames
 * out of 91 through chains InDesign will never execute.
 */
IDMCP.threadLink = function (frame, fromMaster) {
    var storyId = "";
    var createdOrder = 0;
    var previousPage = null;
    var nextPage = null;
    var layerVisible = true;

    /* `frame.id` is a DOM access, and inside the loop over containers it would
     * cost as many times as there are frames in the chain. */
    var frameId = null;
    try { frameId = frame.id; } catch (eF) { frameId = null; }

    var story = null;
    try { story = frame.parentStory; } catch (eS) { story = null; }
    /* Truthiness, not `===`: on DOM objects the `===` operator sometimes
     * THROWS («TextFrame.===() cannot work with instances of this class») —
     * measured 2026-08-18, see `IDMCP.resolveContainerPage` in `inspect.jsx`. */
    if (story) {
        /* `story.id` was read TWICE for the same answer — once for the string,
         * once for the number. Read it once. */
        var rawStoryId = null;
        try { rawStoryId = story.id; } catch (eI) { rawStoryId = null; }
        if (rawStoryId !== null) {
            storyId = String(rawStoryId);
            createdOrder = Number(rawStoryId);
            if (isNaN(createdOrder)) createdOrder = 0;
        }
        try {
            var containers = story.textContainers;
            var total = containers.length;
            var at = -1;
            for (var i = 0; i < total; i++) {
                if (containers[i].id === frameId) { at = i; break; }
            }
            if (at >= 0) {
                previousPage = IDMCP.containerPageName(containers, at - 1, total);
                nextPage = IDMCP.containerPageName(containers, at + 1, total);
            }
        } catch (eC) {
            previousPage = null;
            nextPage = null;
        }
    }

    var layer = null;
    var layerName = "";
    try { layer = frame.itemLayer; } catch (eL) { layer = null; }
    /* Truthiness, not `===`: on DOM objects the `===` operator sometimes
     * THROWS («TextFrame.===() cannot work with instances of this class») —
     * measured 2026-08-18, see `IDMCP.resolveContainerPage` in `inspect.jsx`. */
    if (layer) {
        try { layerVisible = layer.visible === true; } catch (eV) { layerVisible = true; }
        /*
         * DEFAULT ON FAILURE — AN EMPTY STRING, NOT THE SERVICE LAYER'S NAME.
         * An unreadable layer must read as "this is not our service frame":
         * the opposite default would give the frame the right to hand over a
         * number from a chain about which the only known fact is that it
         * couldn't be read.
         *
         * WHAT THIS DEFAULT EXACTLY COSTS — named here, not just as intent
         * (M6 of review 11B). It does NOT affect THE NUMBER via ANY route:
         * resolution is computed over the FULL set of overlaps (C2), and
         * `layerName` decides only how the link is NAMED. There are exactly
         * two consequences, both about the report: `verdict.route` will
         * report `thread` where the frame is physically a service one, and a
         * `route: "thread"` request will NOT get the `helper-chain-winner`
         * rejection — i.e. a frame can be overwritten by a marker whose
         * number comes from a chain named under the wrong name. The number
         * itself stays measured throughout.
         *
         * WHY NOT `null` AS A THIRD STATE ("wasn't read"): that would change
         * the type of `ThreadLink.layerName` and every reader of it, and the
         * FREQUENCY of this failure HAS NEVER BEEN MEASURED BY ANYONE — it
         * was observed exactly zero times on the fixture and on the book.
         * Introducing a third state for an unmeasured input would mean
         * paying for a guess.
         */
        try { layerName = String(layer.name); } catch (eNm) { layerName = ""; }
    }

    return {
        storyId: storyId,
        previousPage: previousPage,
        nextPage: nextPage,
        createdOrder: createdOrder,
        layerVisible: layerVisible,
        layerName: layerName,
        fromMaster: fromMaster === true
    };
};

/*
 * `siblings` — all of the page's frames with bounds already computed, so
 * that each one's `geometricBounds` is read ONCE per page, not once per
 * pair. Across 196 pages, the difference between O(n) and O(n²) InDesign
 * accesses is the difference between seconds and minutes.
 */
IDMCP.claimFrame = function (rec, paras, pageName, styleName, ownBounds, siblings) {
    var frame = rec.frame;
    var frameId = rec.id;

    var paragraphs = [];
    var pcount = paras.length;
    for (var i = 0; i < pcount; i++) {
        paragraphs.push(IDMCP.claimParagraph(paras[i], i));
    }
    var rotation = 0;
    try { rotation = frame.rotationAngle; } catch (eR) { rotation = 0; }

    var layerName = "";
    var layerVisible = true;
    var layerPrintable = true;
    /*
     * `layerLocked` IS READ HERE, NOT DERIVED FROM `locked`: measured
     * (Question 19, state C) that a frame on a LOCKED layer has
     * `frame.locked === false`. Two independent locks, two fields.
     *
     * DEFAULTING TO `false` ON FAILURE — deliberately the same as for
     * `locked`: a frame with an unreadable layer must not be silently
     * dropped, because that would take away usable frames from the book due
     * to an instrument error. Refusing here would cost more than a miss: a
     * locked layer is a rare state, while an unreadable `itemLayer` occurs on
     * group leaves outside the master pages.
     */
    var layerLocked = false;
    /* `frame.itemLayer` was resolved THREE TIMES for the same three properties
     * of one layer. Resolve it once. */
    var layer = null;
    try { layer = frame.itemLayer; } catch (eLy) { layer = null; }
    /* Truthiness, not `===`: on DOM objects the `===` operator sometimes
     * THROWS («TextFrame.===() cannot work with instances of this class») —
     * measured 2026-08-18, see `IDMCP.resolveContainerPage` in `inspect.jsx`. */
    if (layer) {
        try { layerName = String(layer.name); } catch (eN) { layerName = ""; }
        try { layerVisible = layer.visible === true; } catch (eV) { layerVisible = true; }
        try { layerPrintable = layer.printable === true; } catch (eP) { layerPrintable = true; }
        try { layerLocked = layer.locked === true; } catch (eK2) { layerLocked = false; }
    }

    var locked = false;
    try { locked = frame.locked === true; } catch (eK) { locked = false; }

    /*
     * `null` — "DIDN'T COUNT," AND THAT'S A DIFFERENT STATE FROM "DOESN'T
     * OVERLAP ANYTHING."
     *
     * Both states used to return `[]`, i.e. a value byte-identical to the
     * measured fact. We didn't count in two cases, and neither of them is
     * "no overlaps":
     *
     *   - `siblings === null` — not a folio family. The overlap table is
     *     built only under `folio` (see the comment at `boundsTable`), so
     *     for a table-of-contents line the question simply wasn't asked;
     *   - `ownBounds === null` — the frame's own bounds are unknown (a
     *     group's leaf outside the master pages, see `recordBounds`).
     *     There's nothing to compare.
     *
     * The cost of the error is exactly here: §4.9 reads `overlaps` to say
     * whether the marker will resolve, and on `[]` it reports "no sleeping
     * duplicates" — exactly the failure mode §3 stands against. `null`
     * doesn't allow that: the type in `ClaimFrame` is nullable, and the
     * caller must write the branch.
     */
    var overlaps = null;
    if (ownBounds !== null && siblings !== null && siblings !== undefined) {
        overlaps = [];
        for (var s = 0; s < siblings.length; s++) {
            if (siblings[s].id === frameId) continue;
            if (!IDMCP.boundsTouch(ownBounds, siblings[s].bounds)) continue;
            overlaps.push(IDMCP.threadLink(siblings[s].frame, siblings[s].fromMaster));
        }
    }

    return {
        id: frameId,
        page: pageName,
        styleName: styleName,
        rotationAngle: rotation,
        paragraphs: paragraphs,
        /*
         * `null`, not a zero-rectangle. A zero-rectangle is still a
         * rectangle: it answers the question "where is the frame" with
         * numbers nobody measured, and the §4.9 detector, which will ask
         * about its coordinates, gets an answer instead of a refusal. `null`
         * takes that answer away.
         */
        bounds: ownBounds,
        layerName: layerName,
        layerVisible: layerVisible,
        layerPrintable: layerPrintable,
        fromMaster: rec.fromMaster === true,
        locked: locked,
        layerLocked: layerLocked,
        overlaps: overlaps
    };
};

/*
 * SERVICE-CHAIN STATE (Phase 8 spec, §4.1).
 *
 * `null` — the layer DOESN'T EXIST AT ALL. This is not an empty chain: a
 * document without the layer is the vast majority of documents, and the
 * detector stays silent on `null`. Returning an empty structure here would
 * mean giving every such document as many "missing" findings as it has
 * pages.
 *
 * THE LAYER NAME IS A TWIN of `IDMCP.HELPER_LAYER_NAME` (`pagination-write.jsx`)
 * and `HELPER_LAYER_NAME` (`src/pagination/topology.ts`). JSX runs in ES3
 * with no modules and can't import the constant, so the link is held by a
 * cross-reference BY NAME (a line number would silently go stale).
 *
 * THREE PASSES, AND EXACTLY THREE — THIS IS A MEASUREMENT, NOT A STYLE
 * CHOICE (`H8`, Question 7b). The natural form "for each frame, find its
 * position among its story's containers" is quadratic, and on 100 pages
 * costs 4,231 ms versus 257 ms for the linear one — on a 196-page book that's
 * 16 seconds versus half a second. So each story's containers are walked
 * EXACTLY ONCE, into an `id → position` table, and frames afterward only
 * read from it.
 */
IDMCP.measureHelperChain = function (doc) {
    var layerName = IDMCP.HELPER_LAYER_NAME;
    /*
     * LOUD, NOT SILENT. The constant lives in `pagination-write.jsx`, which
     * comes AFTER this file in `CORE_MODULES`; by call time both are loaded,
     * so `undefined` here would mean the module order changed. Without this
     * check, `itemByName(undefined)` would return an invalid layer, we'd
     * return `null`, and the whole integrity detector would silently switch
     * off — i.e. the very same silent failure the entire phase is built
     * against.
     */
    if (typeof layerName !== "string" || layerName.length === 0) {
        throw new Error(
            "IDMCP.HELPER_LAYER_NAME is not defined at the moment the helper chain is measured — " +
                "the module load order changed (CORE_MODULES, src/bridge/runner.ts). " +
                "Without this name, the integrity detector would silently turn off."
        );
    }
    var layer = doc.layers.itemByName(layerName);
    var exists = false;
    try { exists = layer.isValid === true; } catch (eL) { exists = false; }
    if (!exists) return null;

    /*
     * Pages also go through `getElements()`, and for the same reason as the
     * frames below: `doc.pages[pi]` re-resolves the collection on every
     * access. Names are taken FROM HERE, not from `frame.parentPage.name` —
     * the same value, but on a hundred frames that's a hundred extra DOM
     * accesses.
     */
    var pageEls = doc.pages.everyItem().getElements();
    var pageIndexById = {};
    var pageNames = [];
    for (var pi = 0; pi < pageEls.length; pi++) {
        pageIndexById[String(pageEls[pi].id)] = pi;
        pageNames.push(String(pageEls[pi].name));
    }

    /*
     * PASS 1: the layer's frames, their page, and their story.
     *
     * `everyItem().getElements()`, NOT `items[i]` — AND THIS IS A
     * MEASUREMENT, NOT A STYLE CHOICE. Indexing a collection re-resolves it
     * on EVERY access: on 100 pages the same walk costs 773 ms via
     * `layer.pageItems[i]` and 22 ms via a single `getElements()` (measured
     * 2026-08-08, `docs/measured-facts-phase8.md`, Question 7c). The 35x
     * difference makes every other optimization of this pass immaterial.
     */
    var recs = [];
    var storyFirstItem = {};
    var storyOrderSeen = [];
    var covered = {};
    var items = layer.pageItems.everyItem().getElements();
    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!IDMCP.isTextFrameLike(it)) continue;

        var pageName = null, pageOffset = null;
        try {
            var host = IDMCP.parentPageOf(it);
            if (host !== null && host !== undefined) {
                var at = pageIndexById[String(host.id)];
                if (at !== undefined) {
                    pageName = pageNames[at];
                    pageOffset = at;
                    covered[at] = true;
                }
            }
        } catch (eP) { pageName = null; pageOffset = null; }

        var storyId = "";
        try {
            var story = it.parentStory;
            storyId = String(story.id);
            if (storyFirstItem[storyId] === undefined) {
                storyFirstItem[storyId] = story;
                storyOrderSeen.push(storyId);
            }
        } catch (eS) { storyId = ""; }

        recs.push({ frameId: String(it.id), page: pageName, pageOffset: pageOffset, storyId: storyId });
    }

    /* PASS 2: each story's containers — ONCE, into a table. */
    var orderById = {};
    for (var s = 0; s < storyOrderSeen.length; s++) {
        var cs = null;
        try { cs = storyFirstItem[storyOrderSeen[s]].textContainers; } catch (eC) { cs = null; }
        if (cs === null) continue;
        for (var c = 0; c < cs.length; c++) {
            var cid = null;
            try { cid = String(cs[c].id); } catch (eI) { cid = null; }
            if (cid !== null) orderById[cid] = c;
        }
    }

    /* PASS 3: assembly. `−1` — the position wasn't set; this is not "first." */
    var frames = [];
    for (var r = 0; r < recs.length; r++) {
        var pos = orderById[recs[r].frameId];
        frames.push({
            frameId: recs[r].frameId,
            page: recs[r].page,
            pageOffset: recs[r].pageOffset,
            storyId: recs[r].storyId,
            orderInStory: pos === undefined ? -1 : pos
        });
    }

    var without = [];
    for (var p = 0; p < pageNames.length; p++) {
        if (covered[p] !== true) without.push(pageNames[p]);
    }

    var visible = true, printable = false, locked = false;
    try { visible = layer.visible === true; } catch (eV) { visible = true; }
    try { printable = layer.printable === true; } catch (ePr) { printable = false; }
    try { locked = layer.locked === true; } catch (eLo) { locked = false; }

    return {
        layerName: layerName,
        layerVisible: visible,
        layerPrintable: printable,
        layerLocked: locked,
        storyIds: storyOrderSeen,
        frames: frames,
        pagesWithoutFrame: without
    };
};

/*
 * A RUNNING HEAD, NOT A FOLIO — and CONTENT distinguishes them, not the
 * style name.
 *
 * Measured (`H10-A`, 2026-08-14): on masters `E`, `D`, `J` the style
 * `Колонтитул v1` carries BOTH kinds of frame — on verso the section title,
 * on recto `⟨PREVIOUS⟩–⟨AUTO⟩`. This is exactly why Phase 6 recorded
 * "`Колонтитул v1` is a folio," the backlog recorded "running heads are set
 * in `Колонтитул v1`," and both were right: what was wrong was the
 * assumption that the style name determines the role.
 *
 * A frame with ANY page-numbering special character is NOT a running head.
 * The comparison is via `IDMCP.classifyChar`, i.e. by IDENTITY:
 * `String(ch.contents)` for an auto-marker gives the string
 * "AUTO_PAGE_NUMBER" and happens to work for one marker, silently breaking
 * on others (learned in Phase 4).
 *
 * Returns `null` when the frame turns out to be a folio.
 */
IDMCP.headClaim = function (rec, paras, pageName, styleName, page) {
    var i, c, chs;
    if (paras === null) return null;

    for (i = 0; i < paras.length; i++) {
        try { chs = paras[i].characters; } catch (eChars) { continue; }
        /* A 60-character ceiling: a running head is a line, not a text, and
         * reading the whole frame character-by-character on every page of
         * the book is too expensive. */
        for (c = 0; c < chs.length && c < 60; c++) {
            if (IDMCP.classifyChar(chs[c]) !== null) return null;
        }
    }

    var text = "";
    try { text = String(rec.frame.contents); } catch (eText) { text = ""; }
    text = text.replace(/\s+/g, " ").replace(/^ +/, "").replace(/ +$/, "");

    /*
     * A SECOND DISCRIMINATOR, AND ONE ALONE ISN'T ENOUGH — measured by
     * execution (Task 6, fixture): the frame «8–9» slipped into running
     * heads, because a manual folio literal does NOT CONTAIN any special
     * characters at all. On the working book there are 91 such frames —
     * exactly the manual literals the `folio` family exists for, and all of
     * them are set in the same style as the running head.
     *
     * A line made only of digits, spaces, and dashes is a folio.
     *
     * A LIMIT, NAMED OUT LOUD: a running head consisting ONLY of a number
     * (a year in a yearbook's running head, a volume number) is invisible to
     * this family. The cost is named deliberately: the opposite choice would
     * give this book 91 false "running heads," and the family would drown in
     * its own noise before the first real finding.
     */
    /*
     * THE DASH SITS LAST IN THE CLASS, AND THAT POSITION IS THE WHOLE RULE.
     *
     * Written as `[0-9\s-‐-―]` the plain hyphen lands between `\s` and
     * `‐`, where it is read as a RANGE OPERATOR that has already been consumed:
     * the intended `‐`–`―` range never forms, and U+2011, U+2012, U+2013 and
     * U+2014 all fall OUT of the class while the regex still compiles and still
     * looks right. The class then matches U+2010 and U+2015 only — two dashes
     * nobody sets — so the guard reads as working while doing nothing.
     *
     * Measured 2026-08-26: `/^[0-9\s-‐-―]+$/.test("8–9")` is FALSE. That is the
     * en dash, the one this publisher sets in a folio range by rule, and «8–9»
     * is the exact frame the comment above names as the reason this line exists.
     * Every such folio was therefore returned as a running head.
     *
     * `tests/integration/pagination-heads.test.ts:82` always had the dash last
     * and so always built the range correctly — the test and the code it guards
     * disagreed, which is why a green suite never showed this.
     */
    if (text !== "" && /^[0-9\s‐-―-]+$/.test(text)) return null;

    var look = { font: null, pointSize: null, fillValue: null };
    try { look.font = String(paras[0].characters[0].appliedFont.name); } catch (eFont) { }
    /*
     * FONT SIZE IS READ IN POINTS, AND THE UNIT IS SWITCHED LOCALLY FOR THAT.
     *
     * The handler deliberately works in MILLIMETERS (page geometry), but
     * `scriptPreferences.measurementUnit` overrides text attributes too:
     * measured by execution — a 10 pt style came back as 3.5278, i.e. the
     * same font size in millimeters. The rule itself wasn't broken by this
     * (the same units are compared, the ratio is preserved), but the REPORT
     * would tell the operator "size 6.35 vs. 3.53" — a number that doesn't
     * appear on any InDesign palette. The family speaks about the printed
     * sheet, so the numbers must be the ones the typesetter actually sees.
     */
    var prevSizeUnit = app.scriptPreferences.measurementUnit;
    try {
        app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;
        try { look.pointSize = paras[0].characters[0].pointSize; } catch (eSize) { }
    } finally {
        app.scriptPreferences.measurementUnit = prevSizeUnit;
    }
    /*
     * THE SWATCH'S VALUE, NOT ITS NAME. Measured (`H10-E`): the
     * `Колонтитул v2` style's swatch has an EMPTY name, so comparing by name
     * would treat two different unnamed colors as identical — i.e. it would
     * be a check that can never fail. If it couldn't be read — `null`, and
     * that means "wasn't compared."
     */
    try {
        var col = paras[0].characters[0].fillColor;
        look.fillValue = String(col.space) + ":" + String(col.colorValue);
    } catch (eFill) { look.fillValue = null; }

    var overset = false;
    try { overset = rec.frame.overflows === true; } catch (eOver) { }

    var masterName = null;
    try { masterName = String(page.appliedMaster.name); } catch (eMaster) { masterName = null; }

    return {
        id: String(rec.id),
        page: pageName,
        styleName: styleName,
        fromMaster: rec.fromMaster === true,
        masterName: masterName,
        side: String(page.side),
        text: text,
        empty: text === "",
        overset: overset,
        appearance: look
    };
};

IDMCP.handlers.pagination_measure = function (params) {
    var previousUnit = app.scriptPreferences.measurementUnit;
    /* A new document's ruler defaults to picas, and scripts default to
     * AUTO_VALUE. Without pinning units, baselines and leading would arrive
     * in different scales, and the "half the leading" tolerance would
     * silently drift. */
    app.scriptPreferences.measurementUnit = MeasurementUnits.MILLIMETERS;

    /*
     * The ruler's origin — the SPREAD, otherwise the `bounds` of the two
     * pages in one spread lie in different coordinate systems and overlap is
     * computed at random (measured in Task 2, comment at
     * `__fixture_make_layout`).
     *
     * READ, COMPARE, AND WRITE ONLY IF NEEDED. `viewPreferences` is
     * DOCUMENT state, not application state: during an audit the user has
     * their working book open, and an unconditional write would mark it as
     * modified for the sake of a value it already holds (SPREAD_ORIGIN is
     * the typical case).
     *
     * We deliberately do NOT touch `horizontalMeasurementUnits`/
     * `verticalMeasurementUnits`: `app.scriptPreferences.measurementUnit`
     * overrides them for scripts, which has already been proven by
     * execution — Phase 6's baselines arrive in mm with untouched ruler
     * units (`pagination-measure`, the test «базові лінії й інтерліньяж
     * виміряно в міліметрах»). An extra write to the user's document
     * wouldn't buy anything.
     *
     * A RISK, NAMED OUT LOUD: ON TIMEOUT THE RULER CAN BE LEFT FOREIGN.
     * `rulerOrigin` is DOCUMENT state, i.e. the user's book, and Phase 6 had
     * no such risk at all (it wrote nothing to the document). On timeout
     * AppleScript is cut off (`src/bridge/runner.ts:88-115`), while the
     * handler inside InDesign may still be running; if the process is killed
     * before reaching `finally`, the book stays in `SPREAD_ORIGIN` instead of
     * its own `PAGE_ORIGIN`.
     *
     * WHY THE WRITE IS KEPT ANYWAY. Without it, overlaps are computed at
     * random, i.e. the tool would return plausible-looking wrong numbers —
     * a worse failure mode than §3 allows. The consequence of the failure
     * here is NOT destructive and is fully reversible: one VIEW setting
     * changes, the document's content isn't touched, and it's reverted with
     * two clicks (Вигляд → Лінійки) or by the next successful pass. The cost
     * is named, not concealed; the decision is acceptable.
     *
     * ЗМІРЯНО 2026-08-26, І ЦЕ ЗНІМАЄ НАЙЧАСТІШЕ ЗАПЕРЕЧЕННЯ. Рецензія
     * припускала, що запис `rulerOrigin` робить документ ЗМІНЕНИМ, тобто що
     * читальний аудит спричиняє питання «зберегти зміни?». Перевірено на
     * тимчасовому документі живого InDesign 21.5.1.73, зі зміною значення
     * по-справжньому (PAGE_ORIGIN → SPREAD_ORIGIN):
     *
     *     modified після PAGE_ORIGIN      = false
     *     modified після зміни на SPREAD  = false
     *     modified після відновлення      = false
     *     КОНТРОЛЬ: після додавання рамки = true
     *
     * Негативний контроль обов'язковий: без нього три `false` могли б
     * означати, що `modified` тут просто не працює. Отже `viewPreferences`
     * не бруднить документ, питання про збереження не виникає, і єдиний
     * лишений наслідок — той, що вже названо вище: на таймауті лінійка може
     * лишитися чужою, поки користувач не поверне її двома кліками.
     *
     * Супутнє: `geometry_measure` більше не залежить від лінійки взагалі —
     * він зводить рамки до початку власної сторінки, — тож наслідок «чужа
     * лінійка псує сусідній інструмент» теж закрито.
     */
    var doc = null;
    var previousOrigin = null;

    try {
        doc = IDMCP.activeDoc();
        try {
            previousOrigin = doc.viewPreferences.rulerOrigin;
            /*
             * COMPARISON BY IDENTITY WORKS HERE — VERIFIED BY EXECUTION
             * (Question 17b). The review assumed the branch was dead by
             * analogy with `NothingEnum` below (`String()` is mandatory
             * there). The measurement disproved that: after writing
             * `SPREAD_ORIGIN`, reading gives `v === RulerOrigin.SPREAD_ORIGIN`
             * → `true`, after `PAGE_ORIGIN` → `false`; `Number(v)` equals
             * 1380143983 and 1380143215. So it's exactly this branch that
             * saves the user's book from an unnecessary write — it must not
             * be removed.
             */
            if (previousOrigin === RulerOrigin.SPREAD_ORIGIN) {
                previousOrigin = null;
            } else {
                doc.viewPreferences.rulerOrigin = RulerOrigin.SPREAD_ORIGIN;
            }
        } catch (eOrigin) { previousOrigin = null; }

        IDMCP.rejectUnknownParams("pagination_measure", params, [
            "folioStyles",
            "contentsNumberStyle",
            "contentsTitleStyles",
            "headingStyles",
            "runningHeadStyles"
        ]);

        var wantFolio = params.folioStyles || [];
        var wantNumber = params.contentsNumberStyle || null;
        var wantTitles = params.contentsTitleStyles || [];
        var wantHeadings = params.headingStyles || [];

        /* Styles are taken from `allParagraphStyles`: the plain collection doesn't
         * see styles inside groups (in the working book they sit in the
         * group «Стилі книги»). A style that's declared but missing is a
         * LOUD error, not silence: otherwise a typo in the name gives zero
         * findings, which reads as "all clean." */
        var declared = {};
        var known = {};
        var allStyles = doc.allParagraphStyles;
        var styleCount = allStyles.length;
        for (var s = 0; s < styleCount; s++) {
            known[String(allStyles[s].name)] = true;
        }
        /*
         * ONE ROLE PER STYLE NAME — AND A COLLISION IS NOW AUDIBLE.
         *
         * `declared` holds exactly one role per name, and the consumer below
         * (`var role = … declared[styleName]`) branches on exactly that. So
         * a style named in both `folio.styleNames` and `headingStyles`
         * USED TO silently lose its folio role: the last `want()` won,
         * `missingStyles` didn't fire (the style does exist after all), and
         * the folio family produced zero. A list instead of a single value
         * (`fc8f96d`) made such a collision practically reachable rather than
         * theoretical.
         *
         * Making the role plural here can't be done in one line — the whole
         * distribution below rests on a single value, including the master-
         * frame gate. So the minimal honest fix: THE ROLE STAYS THE FIRST ONE
         * (not the last, as it was — `want()`'s order isn't a user decision),
         * and the fact of the collision itself travels to the report as a
         * separate field. No silent state is left.
         *
         * Running heads aren't part of this — they're in a separate
         * `headStyles` map (see the comment below), so a folio+runningHead
         * pair is NOT a conflict.
         */
        var conflictingStyles = [];
        function want(name, role) {
            if (name === null || name === undefined) return;
            if (IDMCP.hasOwn(declared, name)) {
                if (declared[name] !== role) {
                    conflictingStyles.push({ style: name, kept: declared[name], alsoDeclared: role });
                }
                return;
            }
            declared[name] = role;
        }
        for (var wf = 0; wf < wantFolio.length; wf++) want(wantFolio[wf], "folio");
        want(wantNumber, "number");
        for (var t = 0; t < wantTitles.length; t++) want(wantTitles[t], "title");
        for (var h = 0; h < wantHeadings.length; h++) want(wantHeadings[h], "heading");

        /*
         * RUNNING HEADS LIVE IN A SEPARATE MAP, NOT AS ANOTHER ROLE IN
         * `declared`, and the reason is MEASURED, not stylistic.
         *
         * On masters `E`, `D`, `J` of the working book the style
         * `Колонтитул v1` carries BOTH kinds of frame: on verso — the
         * section title, on recto — the folio `⟨PREVIOUS⟩–⟨AUTO⟩` (probe
         * `H10-A`, 2026-08-14). So one role per style name is impossible
         * here by construction: `want()` would overwrite `folio` with the
         * `head` role, and declaring the running-head family would SILENTLY
         * kill the folio family on the same book.
         *
         * CONTENT (`IDMCP.headClaim`) distinguishes the frames, not the
         * style name. It's exactly because of this assumption — "the style
         * name determines the role" — that the project's documents
         * contradicted each other for three phases in a row.
         */
        var wantHeads = params.runningHeadStyles || [];
        var headStyles = {};
        for (var hh = 0; hh < wantHeads.length; hh++) headStyles[wantHeads[hh]] = true;

        var missingStyles = [];
        for (var dn in declared) {
            if (IDMCP.hasOwn(declared, dn) && known[dn] !== true) missingStyles.push(dn);
        }
        /* A declared and missing running-head style is the same kind of LOUD
         * error. A duplicate check is needed because the same style can be
         * declared as both a folio and a running head (see the comment
         * above). */
        for (var hm = 0; hm < wantHeads.length; hm++) {
            if (known[wantHeads[hm]] === true) continue;
            var already = false;
            for (var ms = 0; ms < missingStyles.length; ms++) {
                if (missingStyles[ms] === wantHeads[hm]) { already = true; break; }
            }
            if (!already) missingStyles.push(wantHeads[hm]);
        }

        var pages = [];
        var folioFrames = [];
        var headFrames = [];
        var contentsTitles = [];
        var contentsNumbers = [];
        var headings = [];
        var headingOrder = 0;

        /*
         * COUNTER OF SKIPPED MASTER FRAMES — A LOUD CHANNEL TO THE DECISION
         * BELOW (spec §4.1, "A master frame participates ONLY as a folio").
         *
         * The decision itself is correct and doesn't break Phase 6, but
         * WITHOUT THIS FIELD IT IS SILENT. The failure scenario is complete,
         * not hypothetical: an edition with a templated table of contents,
         * where both the TOC lines and the source headings sit on parent
         * pages, gives `contents: { checked: 0, deviating: 0, notCompared: 0,
         * groups: [] }` — a shape that both a human and §3 read as "all
         * clean." The intermediate case (lines on the master, headings in
         * the body) is loud, but names the WRONG CAUSE:
         * `contents-count-mismatch` sends you looking for missing lines
         * instead of instrument blindness.
         *
         * WHAT IT COSTS — TWO DIFFERENT ANSWERS, AND THEY MUST NOT BE MERGED.
         * The PER-FRAME half (roles `number`/`title`) costs zero DOM
         * accesses: both the style and the role are already computed for the
         * skip decision itself (measured in Task 3G on the book-density rig:
         * `tries` 2,719 vs. 2,719). The PER-PARAGRAPH half (role `heading`)
         * DOES cost accesses: each master frame's paragraph styles are read
         * once per master OBJECT (cached afterward as `headSkips`), not once
         * per page. MEASURED with a `styleNameOf` call counter, three runs
         * per side, zero spread: 107 without this half versus 114 with it —
         * i.e. +7 across the whole pass on the 10-page fixture. Seven is
         * exactly the number of PARAGRAPHS across the fixture's six master
         * objects (1+2+1+1+1+1): the cost grows with the master, not with
         * the number of pages it's applied to. We pay for what would
         * otherwise stay silent: the review proved by execution that without
         * this, a heading declared as the second paragraph of a master frame
         * disappeared from the measurement without ever showing up in
         * `declared`.
         *
         * TWO DIFFERENT NUMBERS, AND THEY MUST NOT BE MERGED:
         * - `declared` — the styles DECLARED by this call. This is the
         *   blindness itself: what the operator was looking for sits on the
         *   parent and never reaches the report;
         * - `undeclared` — the rest of the master frames (running heads,
         *   service labels). They weren't searched for, they're not
         *   blindness, but their count says "master frames do exist here,"
         *   which is a negative control for zero in `declared`, not silence.
         *
         * `frames` counts CLAIMS, not objects: one running head applied to
         * 40 pages gives 40. That's exactly how many phantom lines it would
         * have given the table of contents, i.e. the number here describes
         * the magnitude of what was skipped, not the number of frames in the
         * layout. THE UNIT OF THE CLAIM DIFFERS BY ROLE, because the
         * collection itself differs: for `number`/`title` it's a "page ×
         * frame" pair (the family collects per-frame), for `heading` it's
         * "page × paragraph" (the family collects per-paragraph). A frame
         * with two headings across 5 pages gives 10, and that's exactly how
         * many phantom lines it would have produced.
         */
        var masterSkipped = { declared: [], undeclared: 0 };
        var masterSkippedAt = {};

        /* `hasOwn`, not `skipAt === undefined`: index 0 is legitimate (hence not
         * truthiness), and a style named `constructor` would return a
         * FUNCTION from the prototype — and `masterSkipped.declared[function]`
         * would give `undefined`, and `.frames += 1` would crash the whole
         * measurement with a `TypeError`. Reproduced by execution, see the
         * `IDMCP.hasOwn` docstring. */
        function noteMasterSkip(styleName, role) {
            if (!IDMCP.hasOwn(masterSkippedAt, styleName)) {
                masterSkippedAt[styleName] = masterSkipped.declared.length;
                masterSkipped.declared.push({
                    styleName: styleName,
                    role: role,
                    frames: 1
                });
                return;
            }
            masterSkipped.declared[masterSkippedAt[styleName]].frames += 1;
        }

        /* Headings are searched for PER-PARAGRAPH in every frame on the page, i.e.
         * this is the pass's longest loop. When the `contents` family isn't
         * declared, it would produce an empty list anyway — so it doesn't
         * run at all. */
        var wantsHeadings = wantHeadings.length > 0;
        var mcache = IDMCP.newMasterCache();

        var docPages = doc.pages;
        var pageCount = docPages.length;
        for (var p = 0; p < pageCount; p++) {
            var page = docPages[p];
            var pname = String(page.name);
            var master = null;
            try {
                /* Comparing with NothingEnum on READ is always false — measured in
                 * Phase 4, hence via String(). */
                var m = page.appliedMaster;
                if (m !== null && m !== undefined) {
                    var mn = String(m.name);
                    if (mn !== "" && mn !== "$ID/NothingEnum.NOTHING") master = mn;
                }
            } catch (eM) { master = null; }

            pages.push({
                name: pname,
                offset: p,
                side: String(page.side).replace("PageSideOptions.", ""),
                spreadIndex: page.parent.index,
                spreadSiblings: IDMCP.spreadSiblings(page),
                master: master
            });

            var records = IDMCP.pageFrameRecords(page, mcache);
            var pageOrigin = IDMCP.pageOriginOf(page);
            /* A bounds memo, parallel to `records`: each page frame's
             * `geometricBounds` is read exactly once, rather than separately
             * for the claim-frame's own bounds and separately for a row of
             * the overlap table. */
            var recBounds = [];
            /*
             * The overlap table is built ONLY under the `folio` family, and
             * this isn't a random-guess saving: `overlaps` has exactly two
             * consumers, and both are folio. §4.2 uses the overlap to decide
             * a folio frame's route, §4.9 uses it to say whether its marker
             * resolves. No `contents`-family detector touches `overlaps` at
             * all.
             *
             * WHAT MUST NOT BE DONE: narrowing the table to frames of the
             * DECLARED family. Route A is built on an overlap with the MAIN
             * chain's frame, and that frame never belongs to the declared
             * family — such a narrowing would kill the whole route, not
             * speed up the pass.
             */
            var boundsTable = null;

            for (var fi = 0; fi < records.length; fi++) {
                var rec = records[fi];
                var paras = null;
                /* 0, not −1: −1 looked like a sentinel for "not counted yet," but no
                 * path checked it and none left it in place. Zero is the
                 * same value as an empty frame's, i.e. the safest possible
                 * choice if a path without an assignment ever shows up. */
                var pcount = 0;
                var styleName = null;

                /*
                 * THE MASTER FRAME'S ROLE DECISION IS CACHED, THE PARAGRAPHS
                 * THEMSELVES ARE NOT, and the boundary runs exactly here (see
                 * the cache at `newMasterCache`).
                 *
                 * The role is derived from the paragraph count and the style
                 * of the FIRST one, and a master frame is the SAME OBJECT for
                 * every page the master is applied to (measured, Question
                 * 17: the same `.id`, `parentPage` is the master's page). So
                 * the answer is identical across all pages by construction,
                 * not just "usually."
                 *
                 * The win was MEASURED (Task 3G, book-density rig, 100 pages,
                 * 76 with a master): `styleNameOf` 790 → 716 (−9.4%), DOM
                 * accesses 2,719 → 2,608 (−4.1%). For a SKIPPED master frame
                 * the saving is total — `rec.frame.paragraphs` isn't read at
                 * all on repeat pages.
                 */
                var mrole = undefined;
                if (rec.fromMaster === true) mrole = mcache.role[rec.id];
                if (mrole === undefined) {
                    try { paras = rec.frame.paragraphs; } catch (eF) { continue; }
                    pcount = paras.length;
                    /* The frame's role is determined by the style of the FIRST paragraph: a
                     * claim-frame is homogeneous by construction (a folio, a
                     * number, a table-of-contents line). */
                    if (pcount > 0) styleName = IDMCP.styleNameOf(paras[0]);
                    if (rec.fromMaster === true) {
                        mrole = { pcount: pcount, styleName: styleName };
                        mcache.role[rec.id] = mrole;
                    }
                } else {
                    pcount = mrole.pcount;
                    styleName = mrole.styleName;
                }
                if (pcount === 0) continue;
                if (styleName === null) continue;
                /* `hasOwn`, not a plain index: a style named «toString» would fetch a
                 * FUNCTION from an empty object, and `role` would then be
                 * compared against strings, never matching — i.e. a declared
                 * style would behave as undeclared, and vice versa. */
                var role = IDMCP.hasOwn(declared, styleName) ? declared[styleName] : undefined;

                /*
                 * A MASTER FRAME BELONGS ONLY TO THE `folio` FAMILY, and this
                 * is a deliberate decision, not an oversight.
                 *
                 * A master frame is ONE object, visible from N pages. For a
                 * folio, the question is exactly per-page ("what will THIS
                 * page print"), so N records there are N distinct claims:
                 * the 29 sleeping duplicates of §4.9 were made from exactly
                 * this, and that's exactly why `folioFrames` on the book grew
                 * from 91 to 160.
                 *
                 * The `contents` family, by contrast, builds ONE continuous
                 * ordered list of lines and headings, matching them by order
                 * (§4.5). The same master heading, collected once for every
                 * page sharing its master, would not preserve data but
                 * MULTIPLY it — 40 phantom lines from one running head, and
                 * then a `contents-count-mismatch` and an offset that makes
                 * every subsequent line stale.
                 *
                 * THE GATE HAS TWO PARTS, AND ONE ALONE ISN'T ENOUGH. This
                 * `if` rejects the master frame by ROLE, i.e. it lets a folio
                 * frame through — while headings are collected
                 * PER-PARAGRAPH after it. The second part sits at that loop
                 * (`rec.fromMaster === true` before it), and without it a
                 * heading inside a master FOLIO frame would multiply
                 * per-page despite this comment.
                 *
                 * A LIMIT, NAMED OUT LOUD — AND NOT ONLY IN THE COMMENT. A
                 * table-of-contents line or heading that lives on a parent
                 * page is invisible to the `contents` family. This book has
                 * none (the TOC is anchored frames in the body), and the
                 * running head on masters `E`, `D`, `J` was carved out of the
                 * phase's §2 together with the whole `runningHead` family. In
                 * ANOTHER edition they will exist — and that's exactly why
                 * every such skip is counted below and reaches the response
                 * as the `masterSkipped` field: the comment is read by
                 * whoever opens this file, and the report by whoever sees
                 * zeros in the `contents` family.
                 */
                if (rec.fromMaster === true) {
                    /*
                     * HEADINGS ARE PER-PARAGRAPH, SO ACCOUNTING FOR THEIR
                     * SKIP IS PER-PARAGRAPH TOO. This is exactly the hole
                     * found by the review through execution: the counter
                     * looked at the style of the FIRST paragraph, and for the
                     * `headings` family the first paragraph decides nothing —
                     * a heading there is a paragraph inside a shared story
                     * (see the loop below). A style declared as the SECOND
                     * paragraph of a master frame produced an empty
                     * `declared` and a `+1` in `undeclared`, which doesn't
                     * reach the response — i.e. the channel stayed silent
                     * exactly where it should have shouted.
                     *
                     * The list is cached by `.id`: a master element is ONE
                     * object across all of its pages (Question 17), and its
                     * paragraphs' styles don't depend on the page by
                     * construction. On repeat pages the loop doesn't run at
                     * all, i.e. per-paragraph accounting costs reading styles
                     * ONCE per master object, not once per page.
                     */
                    var hskips = null;
                    if (wantsHeadings) {
                        hskips = mcache.headSkips[rec.id];
                        if (hskips === undefined) {
                            if (paras === null) {
                                try { paras = rec.frame.paragraphs; } catch (eFH) { continue; }
                            }
                            hskips = [];
                            for (var hs = 0; hs < pcount; hs++) {
                                var hsStyle = IDMCP.styleNameOf(paras[hs]);
                                if (hsStyle === null) continue;
                                if (!IDMCP.hasOwn(declared, hsStyle)) continue;
                                if (declared[hsStyle] !== "heading") continue;
                                hskips.push(hsStyle);
                            }
                            mcache.headSkips[rec.id] = hskips;
                        }
                        for (var hk = 0; hk < hskips.length; hk++) {
                            noteMasterSkip(hskips[hk], "heading");
                        }
                    }

                    /*
                     * A RUNNING HEAD PASSES THIS GATE ON EQUAL FOOTING WITH A
                     * FOLIO — and for the same reason the gate exists at all.
                     *
                     * The gate rejects master frames because the `contents`
                     * family builds a CONTINUOUS list, and the same master
                     * line, collected once per page, would multiply. The
                     * question about a running head is per-page, exactly
                     * like a folio's: "what will THIS page print." Measured
                     * (`H10-B`): 50 pages of the book get their running head
                     * exactly from the master, and re-overridden ones are
                     * ZERO, i.e. without this exception the family wouldn't
                     * see a single running head at all and would silently say
                     * "all clean" across the whole book.
                     *
                     * FOUND BY EXECUTION, not by reading: the fixture
                     * returned zero master running heads despite a correctly
                     * applied master, and the cause was exactly here.
                     */
                    if (role !== "folio" && !(styleName !== null && headStyles[styleName] === true)) {
                        /*
                         * The `number` and `title` families are collected
                         * PER-FRAME by the style of the first paragraph — so
                         * accounting for their skip is per-frame too, exactly
                         * matching the collection itself. The `heading` role
                         * isn't counted a second time here: the per-paragraph
                         * loop above already counted it, and the first
                         * paragraph in it isn't special.
                         */
                        if (role === "number" || role === "title") {
                            noteMasterSkip(styleName, role);
                        } else if (hskips === null || hskips.length === 0) {
                            /*
                             * No declared style claimed this frame — i.e. it
                             * isn't blindness but a negative control
                             * ("master frames do exist here"). A frame that
                             * DID contribute a skipped heading must not be
                             * counted here: it's already in `declared`, and
                             * one claim must not land in both numbers.
                             */
                            masterSkipped.undeclared += 1;
                        }
                        continue;
                    }
                }

                /* The cache above gave the ROLE, but not the paragraphs: a frame that
                 * makes it here is parsed character by character, and it's
                 * exactly the paragraph objects that `claimParagraph` needs.
                 * Reading is deliberately deferred to this point — a skipped
                 * master frame (the branch above) doesn't pay for it at all. */
                if (paras === null) {
                    try { paras = rec.frame.paragraphs; } catch (eF2) { continue; }
                }

                if (role === "folio" || role === "number" || role === "title") {
                    if (role === "folio" && boundsTable === null) {
                        boundsTable = [];
                        for (var bi = 0; bi < records.length; bi++) {
                            boundsTable.push({
                                id: records[bi].id,
                                frame: records[bi].frame,
                                fromMaster: records[bi].fromMaster,
                                bounds: IDMCP.boundsAt(records, recBounds, bi, pageOrigin, mcache)
                            });
                        }
                    }
                    var siblings = null;
                    if (role === "folio") siblings = boundsTable;
                    var claim = IDMCP.claimFrame(
                        rec, paras, pname, styleName,
                        IDMCP.boundsAt(records, recBounds, fi, pageOrigin, mcache),
                        siblings
                    );
                    if (role === "folio") folioFrames.push(claim);
                    else if (role === "number") contentsNumbers.push(claim);
                    else contentsTitles.push(claim);
                }

                /*
                 * INDEPENDENT OF `role`, not a branch within it: the same
                 * frame can be declared as both a folio and a running head
                 * (the style is shared in the book). `headClaim` returns
                 * `null` for a frame with a page-numbering special
                 * character — it is exactly what distinguishes the two
                 * roles.
                 */
                if (styleName !== null && headStyles[styleName] === true) {
                    var hclaim = IDMCP.headClaim(rec, paras, pname, styleName, page);
                    if (hclaim !== null) headFrames.push(hclaim);
                }

                /* Headings are collected PER-PARAGRAPH, not per-frame: in the book's
                 * body, a heading is a paragraph inside a shared story.
                 *
                 * `rec.fromMaster` is MANDATORY HERE, and its absence was a
                 * defect, not a matter of taste. The gate above rejects a
                 * master frame by ROLE, i.e. it lets a folio frame through —
                 * and this loop didn't check `fromMaster` at all. Proven by
                 * execution: a second paragraph in the heading style inside a
                 * master FOLIO frame produced 5 phantom headings from ONE
                 * object on the fixture (one for each page with that
                 * master) — exactly the multiplication §4.1 exists to
                 * forbid, and exactly the reason the comment above names. The
                 * skip itself doesn't stay silent here: it's counted
                 * per-paragraph in `masterSkipped`. */
                if (rec.fromMaster === true) continue;
                if (!wantsHeadings) continue;
                for (var pi = 0; pi < pcount; pi++) {
                    var pStyle = IDMCP.styleNameOf(paras[pi]);
                    /* `hasOwn` here is for the same reason as in three other spots: `pStyle`
                     * is an arbitrary string from the document, and
                     * `declared["constructor"]` would return a FUNCTION from
                     * the prototype. Today comparing it against a string
                     * literal rejects it just the same, i.e. no harm done —
                     * but this was the last surviving indexed lookup out of
                     * four identical ones, and this exact form is what would
                     * get copied to a place where it matters (at
                     * `masterSkippedAt[…].frames += 1` the same form crashed
                     * the WHOLE measurement with a `TypeError`). */
                    if (pStyle === null) continue;
                    if (!IDMCP.hasOwn(declared, pStyle)) continue;
                    if (declared[pStyle] !== "heading") continue;
                    var hpage = pname;
                    try {
                        /* A heading in OVERSET text has no page —
                         * this is `notCompared`, not a finding. */
                        if (paras[pi].lines.length === 0) hpage = null;
                    } catch (eH) { hpage = null; }
                    headings.push({
                        styleName: pStyle,
                        text: String(paras[pi].contents).replace(/[\r\n]+$/, ""),
                        page: hpage,
                        order: headingOrder
                    });
                    headingOrder += 1;
                }
            }
        }

        return {
            docName: String(doc.name),
            pages: pages,
            folioFrames: folioFrames,
            headFrames: headFrames,
            contentsTitles: contentsTitles,
            contentsNumbers: contentsNumbers,
            headings: headings,
            missingStyles: missingStyles,
            /* Styles declared by two families at once: the role stays the FIRST one,
             * the second doesn't apply. An empty array is also an answer. */
            conflictingStyles: conflictingStyles,
            masterSkipped: masterSkipped,
            /* Service-chain state — UNCONDITIONALLY, not per family: it's one
             * measurement for two tools, and both consume this block (spec
             * §4.1). A document without the layer costs one `itemByName` call
             * here and returns `null`. */
            helperChain: IDMCP.measureHelperChain(doc)
        };
    } finally {
        /* Order is the reverse of setting it. `previousOrigin !== null` means
         * "we actually wrote" — see the comment above. */
        if (doc && previousOrigin) {
            try { doc.viewPreferences.rulerOrigin = previousOrigin; } catch (eRestore) { }
        }
        app.scriptPreferences.measurementUnit = previousUnit;
    }
};

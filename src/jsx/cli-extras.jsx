/*
 * Measures that none of the twenty-two tools provide (spec §4.4).
 * This is the ONE place where the CLI has its own measurement code, and it
 * duplicates nothing — which is exactly why it's allowed.
 *
 * A TRAP that cost time in previous phases: `page.allPageItems` does NOT see
 * un-overridden master elements, and `page.textFrames` does NOT see anchored
 * objects. So paragraphs are traversed via `story.paragraphs`, not via pages.
 *
 * A SECOND TRAP (found by this file's review): the task brief called for
 * `IDMCP.pageOf(para)` — there is no such function in `_core.jsx`. Instead,
 * `IDMCP.pageNameFor(frame)` (`inspect.jsx`) takes a FRAME, not a paragraph,
 * and already contains a fallback path for anchored objects. The bridge from
 * paragraph → frame is `para.parentTextFrames[0]`, the same technique used in
 * `map.jsx:573` and `styles.jsx:190`: the array can be empty (a paragraph in
 * a table, or not yet placed on any frame), so the length is checked FIRST.
 */
IDMCP.cliPageOfPara = function (para) {
    try {
        var frames = para.parentTextFrames;
        if (frames && frames.length > 0) return IDMCP.pageNameFor(frames[0]);
    } catch (e) { /* parentTextFrames is absent on this type of story container */ }
    return "pasteboard";
};

/*
 * C2/C4 (the `sequences` family, spec §4.4, ruling R25): checking the sequence
 * of style numbers (e.g. "Question numbering", 185 paragraphs on the live
 * document).
 *
 * A TRAP found by a probe on the live document on 2026-08-16, NOT guessed:
 * `doc.stories` is NOT traversed in page order. The first numbering block
 * sits on pp. 26-29, immediately followed in `doc.stories` by a block on
 * pp. 173-180, then 157-161, and so on backwards. The "correct" order for
 * reading numbers is the page (`page.documentOffset`, a zero-indexed position
 * in `doc.pages`) and the frame's vertical position ON the page
 * (`geometricBounds[0]`, "top"): the same probe showed paragraphs "8","7","9"
 * on one page with `top` 195, 35, 339 — i.e. top to bottom this is "7,8,9",
 * while `story.paragraphs`' traversal order gives "8,7,9". Without this
 * sort, the check would find breaks where there are none: not in the layout,
 * but in the order the code traverses it in.
 *
 * `offset`/`top` default to `Number.MAX_VALUE`/`0`: a paragraph off the page
 * (on the pasteboard) sorts to the VERY END, rather than silently dropping
 * out of consideration.
 */
IDMCP.cliSequenceOrderKey = function (para) {
    var key = { offset: Number.MAX_VALUE, top: 0 };
    try {
        var frames = para.parentTextFrames;
        if (frames && frames.length > 0) {
            var pg = IDMCP.parentPageOf(frames[0]);
            if (pg) key.offset = pg.documentOffset;
            /* Bounding box — via the CARRIER: text along a path has no
             * `geometricBounds`, and a raw read would throw, leaving `top` at
             * zero, i.e. placing such a paragraph at the very top of the page
             * instead of its real spot. */
            var carrier = IDMCP.pageItemOf(frames[0]);
            if (carrier) {
                var gb = carrier.geometricBounds;
                key.top = gb[0];
            }
        }
    } catch (e) { /* pasteboard or a container without a page — stays at the end */ }
    return key;
};

/*
 * Number parsing — ONLY the leading digits from the start of the text
 * (leading spaces and NBSPs are discarded). A non-standard form ("12a",
 * "Question 12", "12.") is DELIBERATELY NOT parsed more cleverly: the task
 * spec explicitly says a homegrown parser would misparse such a form, and
 * the list of breaks will SHOW this to the human (who will recognize the
 * notation themselves), rather than hiding it behind a "sequential/not"
 * verdict. A paragraph with no leading digit at all returns `null` — a
 * separate "unparsed" state, not zero and not a silent skip.
 */
IDMCP.cliParseSequenceNumber = function (text) {
    var trimmed = String(text).replace(/^[\s ]+/, "");
    var m = trimmed.match(/^([0-9]+)/);
    if (!m) return null;
    return parseInt(m[1], 10);
};

/*
 * Measures ONE `sequences.rules[]` rule: how many paragraphs of the style
 * were found, how many numbers parsed, and where the sequence breaks.
 *
 * THE "1 is always the start of a new segment" HEURISTIC: on the live
 * document the numbers RESTART from 1 twelve times (by section, lengths
 * 11/15/15/15/26/15/15/18/17/17/11/10 = 185) — this was measured by a
 * probe, not assumed. Without this heuristic, every such restart would read
 * as 185 false breaks in a perfectly sound layout. The cost: a genuine
 * DUPLICATE value of "1" right after another "1" won't be caught by this
 * check — an acceptable trade-off for "a list of breaks, not a verdict"
 * (the task spec).
 *
 * `restarts` (fix round 1, Minor 5): how many times the heuristic FIRED —
 * i.e. how many times "1" occurred in the sequence, including the very
 * first paragraph. Without this number, restarts are invisible to the
 * report's reader: "no breaks" reads as "one continuous numbering", when in
 * fact 12 segments were checked independently of one another.
 */
IDMCP.cliMeasureSequence = function (doc, rule) {
    var styleName = rule && rule.style;
    var items = [];
    var unparsed = [];
    for (var s = 0; s < doc.stories.length; s++) {
        var paras = doc.stories[s].paragraphs;
        for (var p = 0; p < paras.length; p++) {
            var para = paras[p];
            var st;
            try { st = para.appliedParagraphStyle.name; } catch (eSt) { continue; }
            if (st !== styleName) continue;
            var txt = String(para.contents);
            var page = IDMCP.cliPageOfPara(para);
            var num = IDMCP.cliParseSequenceNumber(txt);
            if (num === null) {
                unparsed.push({ page: page, text: txt });
                continue;
            }
            var order = IDMCP.cliSequenceOrderKey(para);
            items.push({ number: num, page: page, offset: order.offset, top: order.top });
        }
    }
    items.sort(function (a, b) {
        if (a.offset !== b.offset) return a.offset - b.offset;
        return a.top - b.top;
    });

    var breaks = [];
    var restarts = 0;
    var previous = null;
    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (it.number === 1) restarts++;
        if (previous === null || it.number === 1) {
            /* The very first paragraph, or a legitimate numbering restart. */
            previous = it.number;
            continue;
        }
        if (it.number === previous + 1) {
            previous = it.number;
        } else {
            /* The page — the one where the break was FOUND (the next number), not the
             * one where the expected continuation should have been: that's
             * exactly where the human will go to look. */
            breaks.push({ prev: previous, next: it.number, page: it.page });
            previous = it.number;
        }
    }

    return {
        style: styleName,
        found: items.length + unparsed.length,
        parsed: items.length,
        restarts: restarts,
        breaks: breaks,
        unparsed: unparsed
    };
};

/*
 * UNITS ARE FORCED TO POINTS FOR THE WHOLE TRAVERSAL — not just for the new
 * pageFormat/bleed block. Proven by execution in THIS project, not from
 * memory: `pagination.jsx:955-961` — "a 10 pt style came through as 3.5278"
 * without forcing (a mm ruler); the same comment explains that
 * `scriptPreferences.measurementUnit` overrides ALL measured script
 * properties, not just geometric bounds — this applies equally to
 * `para.pointSize` and `item.strokeWeight`, which earlier in this file were
 * read WITHOUT forcing. That is, `smallestPointSize.pt` and `thinnestStrokePt`
 * before this fix were labeled "pt" but actually came out in the DOCUMENT's
 * ruler units (millimeters, for the working book) — exactly the same trap
 * that geometry.jsx and pagination.jsx each already document separately.
 *
 * One switch for the whole traversal (as in geometry.jsx), not one per
 * property: cheaper, and doesn't change the logic of the remaining fields
 * (horizontalScale is a percentage, not a measurement, and has no unit).
 */
IDMCP.handlers["__cli_extras"] = function (params) {
    var doc = IDMCP.activeDoc();
    var out = {
        /* A pass must name the document it measured: without this, an active
         * document swap mid-run is invisible both during the run and later in
         * the report. Checks the name against `executePasses` — one rule for
         * all passes. */
        docName: String(doc.name),
        horizontalScaleOffenders: [],
        emptyParagraphs: 0,
        forcedBreaks: { total: 0, inBodyText: 0 },
        smallestPointSize: null,
        thinnestStrokePt: null,
        pasteboardItems: [],
        /* Elements whose page could NOT BE DETERMINED — separate from those known
         * to be on the pasteboard. Zero prints the same as non-zero: "0
         * undetermined" and "137 undetermined" are two different reports. */
        unresolvedItems: 0,
        pageFormat: { width: 0, height: 0, units: "pt" },
        bleed: { top: 0, bottom: 0, inside: 0, outside: 0 }
    };

    var previousUnit = app.scriptPreferences.measurementUnit;
    app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;
    try {
        /*
         * R19: regression-checklist rows (spec §10) that appear in no tool's
         * response at all. `geometry_audit` measures the format and bleed
         * INTERNALLY (`GeometryMeasure`), but doesn't surface it in the
         * report (`GeometryReport`, src/tools/geometry.ts:155) — reaching in
         * there and changing another phase's already-reviewed report is
         * undesirable. This is not duplication: it's a new number, available
         * NOWHERE else.
         *
         * Property names are VERIFIED, not from memory:
         *   dp.pageWidth / dp.pageHeight          — executable lines in
         *     _fixtures.jsx (2607-2608, 2795), not documentation;
         *   dp.documentBleed*Offset (four fields) — the same literal line of
         *     code that already went through review and a run in
         *     geometry.jsx:54-58.
         *
         * The unit is STATED explicitly in `units`, and we do NOT convert it
         * ourselves: a conversion with an unstated unit already produced a
         * silent bug once (C2, Phase 9).
         */
        var dp = doc.documentPreferences;
        out.pageFormat = { width: dp.pageWidth, height: dp.pageHeight, units: "pt" };
        out.bleed = {
            top: dp.documentBleedTopOffset,
            bottom: dp.documentBleedBottomOffset,
            inside: dp.documentBleedInsideOrLeftOffset,
            outside: dp.documentBleedOutsideOrRightOffset
        };

        var bodyStyles = {};
        var names = params && params.bodyTextStyles ? params.bodyTextStyles : [];
        for (var n = 0; n < names.length; n++) bodyStyles[names[n]] = true;

        var scaleBuckets = {};
        for (var s = 0; s < doc.stories.length; s++) {
            var paras = doc.stories[s].paragraphs;
            for (var p = 0; p < paras.length; p++) {
                var para = paras[p];
                var txt = String(para.contents);
                if (txt.replace(/[\r\n\s]/g, "") === "") out.emptyParagraphs++;

                var breaks = txt.split("\n").length - 1;
                if (breaks > 0) {
                    out.forcedBreaks.total += breaks;
                    var st = para.appliedParagraphStyle.name;
                    if (bodyStyles[st]) out.forcedBreaks.inBodyText += breaks;
                }

                var hs = para.horizontalScale;
                if (typeof hs === "number" && Math.abs(hs - 100) > 0.01) {
                    var page = IDMCP.cliPageOfPara(para);
                    var key = page + "|" + para.appliedParagraphStyle.name + "|" + hs;
                    if (!scaleBuckets[key]) {
                        scaleBuckets[key] = { page: page, style: para.appliedParagraphStyle.name, scale: hs, count: 0 };
                    }
                    scaleBuckets[key].count++;
                }

                var ps = para.pointSize;
                if (typeof ps === "number" && (out.smallestPointSize === null || ps < out.smallestPointSize.pt)) {
                    out.smallestPointSize = { pt: ps, style: para.appliedParagraphStyle.name, page: IDMCP.cliPageOfPara(para) };
                }
            }
        }
        for (var k in scaleBuckets) if (scaleBuckets.hasOwnProperty(k)) out.horizontalScaleOffenders.push(scaleBuckets[k]);

        /*
         * C1/C2 (the `sequences` family): `params.rules` is present only when
         * the `sequences` family IS CONFIGURED (the planner
         * `src/cli/run/plan.ts` merges the `extras` family's
         * `bodyTextStyles` and the `sequences` family's `rules` into ONE pass
         * when both are configured at the same time — see the comment at
         * `mergeCliExtras`). A missing key means not "zero rules" but "the
         * family wasn't asked about" — so `out.sequences` does NOT appear in
         * the result at all (an optional field, `src/cli/measure/extras.ts`),
         * rather than an empty array.
         *
         * A SEPARATE traversal of `doc.stories`, not folded into the loop
         * above: a different quantity (a number, not scale/point size), a
         * different style (not "the whole document"), and mixing two
         * unrelated measurements in one loop body would complicate both
         * without simplifying either.
         */
        if (params && params.rules && params.rules.length > 0) {
            var seqResults = [];
            for (var r = 0; r < params.rules.length; r++) {
                seqResults.push(IDMCP.cliMeasureSequence(doc, params.rules[r]));
            }
            out.sequences = seqResults;
        }

        var layerCounts = {};
        for (var i = 0; i < doc.allPageItems.length; i++) {
            var it = doc.allPageItems[i];
            /* `.isValid` — FIRST, before any other property: reading a property of an
             * invalid object throws (measured in earlier phases). */
            try {
                if (it.isValid === false) continue;
            } catch (eValid) { continue; }
            try {
                if (it.strokeWeight > 0 && (out.thinnestStrokePt === null || it.strokeWeight < out.thinnestStrokePt)) {
                    out.thinnestStrokePt = it.strokeWeight;
                }
            } catch (eStroke) { /* a property that THROWS on this type — deliberately skipped */ }
            try {
                /*
                 * Pasteboard: the element belongs to the spread but doesn't
                 * sit on a page.
                 *
                 * "COULD NOT DETERMINE" ≠ "DEFINITELY OFF-PAGE" (review
                 * 2026-08-18 §2.6). Until now the condition was a plain
                 * `!parentPageOf(it)`, and `parentPageOf` returns `null` both
                 * when the read THREW — i.e. an element about which all that's
                 * known is "reading it failed" ended up in `pasteboardItems`
                 * as if proven off-page, and the counter silently inflated.
                 * `pageResolution` separates these two states, and only the
                 * first is counted here.
                 *
                 * The second doesn't disappear: it goes into its own
                 * `unresolvedItems` field. There is NO silent state left —
                 * that was exactly the flaw.
                 */
                var res = IDMCP.pageResolution(it);
                if (!res.resolved) {
                    out.unresolvedItems++;
                } else if (!res.page) {
                    var ln = it.itemLayer.name;
                    layerCounts[ln] = (layerCounts[ln] || 0) + 1;
                }
            } catch (ePasteboard) { /* a property that THROWS on this type — deliberately skipped */ }
        }
        for (var l in layerCounts) if (layerCounts.hasOwnProperty(l)) out.pasteboardItems.push({ layer: l, count: layerCounts[l] });
    } finally {
        /* Restoration is UNCONDITIONAL, even if the read inside the try throws —
         * otherwise the user's document is left in points after the handler
         * fails. */
        app.scriptPreferences.measurementUnit = previousUnit;
    }

    return out;
};

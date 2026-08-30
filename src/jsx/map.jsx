/* Reading the map and properties. READ ONLY: no writes to the document. */

/*
 * The property value in the form it must be handed outward.
 *
 * Used both for the "declared" value (a style is always a singleton — there's
 * no such thing as mixed there), and for paragraph (not character) properties
 * of the "actual" value — they too are read directly, without mixing (measured
 * below, in IDMCP.actualStyleValues). For character properties of the "actual"
 * value it's determined separately by IDMCP.charPropActual, not by this
 * function itself.
 */
IDMCP.propValue = function (value) {
    if (typeof value === "number" && isFinite(value)) return value;
    if (typeof value === "string") return value;
    return null;
};

/* An enum is handed back by name, not as an object: String(Justification.LEFT_JUSTIFIED)
 * in ExtendScript gives a readable name ("LEFT_JUSTIFIED"), and the same has
 * been confirmed on live InDesign for PageSideOptions and ListType. But CAUTION:
 * this function only works for TRUE enum values. For Font objects
 * (appliedFont) it does NOT work — measured below, there's a separate function. */
IDMCP.enumName = function (value) {
    if (value === null || value === undefined) return null;
    var s = String(value);
    return s === "[object Object]" ? null : s;
};

/*
 * A number stays a number, an enum comes back by name. A serializer for
 * properties that InDesign hands back as EITHER a number OR an enum value; in
 * Phase 4 there's exactly one such property — `leading`.
 *
 * MEASURED on the user's working book (198 pages, a read-only probe,
 * `doc.modified` false → false before and after): under auto leading,
 * `paragraph.leading` and `style.leading` hand back `Leading.AUTO` —
 * `typeof "object"`, `String(...)` gives the readable "AUTO". Through the
 * general-purpose IDMCP.propValue (number-or-string, else null) this turned
 * into `null`, i.e. "not compared", and produced TWO different lies at once:
 *
 *   - 10 of 51 paragraph styles declare AUTO; 128 paragraphs have AUTO in
 *     both the style and the paragraph — their leading is identical and
 *     clean, yet the report called them "mixed";
 *   - 35 paragraphs have style AUTO with a numeric paragraph leading — a
 *     GENUINE override that the tool could never surface as a finding, since
 *     both sides of the comparison became `null`.
 *
 * `leading` can't be passed straight through IDMCP.enumName: for numeric
 * leading, `String(14)` would give the string "14", and comparing it with the
 * number 14 from the style would produce a false finding on every paragraph.
 * Hence this specific pair of checks, not just one.
 */
IDMCP.numberOrEnumName = function (value) {
    if (typeof value === "number" && isFinite(value)) return value;
    return IDMCP.enumName(value);
};

/*
 * The font name from a Font object.
 *
 * Measured on live InDesign (verifying a correction from the briefing):
 * String(font) for a Font object doesn't give a readable name — it gives
 * literally "[object Font]" for ANY font — meaning that if passed through
 * IDMCP.enumName, appliedFont would give the same unreadable constant for
 * every paragraph, and no comparison of declared vs. actual font would ever
 * work. Instead we read .fontFamily directly — a string, the same at the
 * style, paragraph, and individual-range level (verified: "Minion Pro" at
 * all three).
 */
IDMCP.fontFamilyName = function (value) {
    if (value === null || value === undefined) return null;
    try {
        if (value.fontFamily !== undefined && value.fontFamily !== null) return String(value.fontFamily);
    } catch (e) {
        /* falls through to null below */
    }
    return null;
};

/*
 * The "declared" value — from the paragraph style. A style is a singleton by
 * definition: there's no such thing as mixed inside it (spec §3), so every
 * property is read directly, without walking textStyleRanges.
 */
IDMCP.declaredStyleValues = function (style) {
    return {
        firstLineIndent: IDMCP.propValue(style.firstLineIndent),
        leftIndent: IDMCP.propValue(style.leftIndent),
        rightIndent: IDMCP.propValue(style.rightIndent),
        spaceBefore: IDMCP.propValue(style.spaceBefore),
        spaceAfter: IDMCP.propValue(style.spaceAfter),
        pointSize: IDMCP.propValue(style.pointSize),
        leading: IDMCP.numberOrEnumName(style.leading),
        justification: IDMCP.enumName(style.justification),
        appliedFont: IDMCP.fontFamilyName(style.appliedFont),
        fontStyle: IDMCP.propValue(style.fontStyle),
        tracking: IDMCP.propValue(style.tracking),
        listType: IDMCP.enumName(style.bulletsAndNumberingListType)
    };
};

/*
 * Whether pointSize/leading/tracking/appliedFont/fontStyle is mixed inside
 * the paragraph — and what its value is if it isn't.
 *
 * These five properties are character-level: character formatting in
 * ExtendScript lets them differ within a single paragraph (measured:
 * assigning a different pointSize to two character ranges inside ONE
 * paragraph gives paragraph.textStyleRanges.length === 3, each range with its
 * own pointSize). The main correction from the briefing, confirmed again:
 * reading para.pointSize on a mixed paragraph does NOT give
 * NothingEnum.NOTHING and does NOT throw — it quietly returns the pointSize
 * of the FIRST range, typeof stays "number". So the only reliable way to
 * detect mixing is to compare the property's value across all of the
 * paragraph's textStyleRanges yourself, rather than relying on an InDesign
 * sentinel.
 *
 * `extractFn` turns a range's raw value into a comparable, serializable form
 * (IDMCP.propValue for numbers/strings, IDMCP.numberOrEnumName for leading,
 * IDMCP.fontFamilyName for appliedFont) — so the comparison runs on the value
 * we actually hand outward, not on the raw ExtendScript object. For leading
 * this is also the only way to avoid collapsing two different states into
 * one: without it, both "every range is AUTO" and "the ranges differ" would
 * give the same `null`.
 */
IDMCP.charPropActual = function (para, propName, extractFn) {
    var runs = para.textStyleRanges;
    if (runs.length === 0) return extractFn(para[propName]);
    var first = extractFn(runs[0][propName]);
    for (var i = 1; i < runs.length; i++) {
        if (extractFn(runs[i][propName]) !== first) return null;
    }
    return first;
};

/*
 * The "actual" value — from the paragraph.
 *
 * Paragraph (not character) properties — firstLineIndent, leftIndent,
 * rightIndent, spaceBefore, spaceAfter, justification, listType — are read
 * directly, with no check for mixing. Measured: trying to assign a DIFFERENT
 * value of these properties to two character ranges inside ONE paragraph
 * (without \r) doesn't create new textStyleRanges (there's still just one)
 * and doesn't produce a mixed state — the last assignment quietly overwrites
 * the property for the WHOLE paragraph ("last write wins"). So by
 * construction these properties can never be mixed within a single paragraph,
 * and para.<property> always gives a single true value.
 *
 * Character-level properties — pointSize, leading, tracking, appliedFont,
 * fontStyle — can be mixed (see IDMCP.charPropActual above) and go through
 * it.
 */
IDMCP.actualStyleValues = function (para) {
    return {
        firstLineIndent: IDMCP.propValue(para.firstLineIndent),
        leftIndent: IDMCP.propValue(para.leftIndent),
        rightIndent: IDMCP.propValue(para.rightIndent),
        spaceBefore: IDMCP.propValue(para.spaceBefore),
        spaceAfter: IDMCP.propValue(para.spaceAfter),
        justification: IDMCP.enumName(para.justification),
        listType: IDMCP.enumName(para.bulletsAndNumberingListType),
        pointSize: IDMCP.charPropActual(para, "pointSize", IDMCP.propValue),
        leading: IDMCP.charPropActual(para, "leading", IDMCP.numberOrEnumName),
        tracking: IDMCP.charPropActual(para, "tracking", IDMCP.propValue),
        appliedFont: IDMCP.charPropActual(para, "appliedFont", IDMCP.fontFamilyName),
        fontStyle: IDMCP.charPropActual(para, "fontStyle", IDMCP.propValue)
    };
};

/* Whether the paragraph has at least one range with a character style
 * applied. A character style is a legitimate deviation from the paragraph
 * style (spec §7.1, rule 1); without this flag the detector would produce a
 * finding on every emphasized word. */
IDMCP.hasCharacterStyleRuns = function (para) {
    var runs = para.textStyleRanges;
    for (var i = 0; i < runs.length; i++) {
        var cs = runs[i].appliedCharacterStyle;
        if (cs && String(cs.name) !== "[None]") return true;
    }
    return false;
};

/*
 * The reliable type of a page/master item (Rectangle/TextFrame/Oval/…).
 *
 * MEASURED on the user's working book (fixing a Phase 4 merge blocker;
 * 198 pages, a read-only probe through the REAL `runJsx` bridge, not a
 * replica; `doc.modified` false → false before and after): `item.constructor.name`,
 * taken DIRECTLY from the item the way the collection hands it back
 * (`masterPageItems[k]`, `pageItems[k]`, `matchedMasterPage.pageItems[k]`),
 * gave "PageItem" for ALL 170 elements of the document without exception —
 * whether it's a frame, a rectangle, or an oval. This is InDesign's wrapper
 * (the shared base type of a page item), not the true type. Instead,
 * `item.getElements()[0].constructor.name` on those same 170 elements gave
 * the TRUE types: Rectangle ×22, TextFrame ×46, Oval ×102 — and exactly
 * those 46 TextFrame had `.texts` (see IDMCP.hasAutoPageNumber below), while
 * the remaining 124 (22 Rectangle + 102 Oval) threw on the mere access to
 * `.texts`. The `__fixture_make_layout` fixture, before this fix, only had
 * TextFrame on masters — so neither defect (this one, nor the one in
 * hasAutoPageNumber) reproduced on it, and both survived to Phase 4's final
 * review.
 *
 * `instanceof TextFrame` doesn't work either — measured with the same probe:
 * it gave "not TextFrame" for all 170 elements without exception.
 *
 * getElements() itself can throw on elements where it's unavailable — hence
 * the try/catch and the fallback path through .constructor directly (lower
 * quality, but better than null).
 */
IDMCP.itemKind = function (item) {
    try {
        var el = item.getElements()[0];
        var ctor = el.constructor;
        if (ctor && ctor.name) return String(ctor.name);
    } catch (e) {
        /* falls through to the fallback path below */
    }
    try {
        var ctorFallback = item.constructor;
        if (ctorFallback && ctorFallback.name) return String(ctorFallback.name);
    } catch (e2) {
        /* neither path managed to determine the type */
    }
    return null;
};

/*
 * Whether the item contains an auto-page-number marker (folio).
 *
 * MEASURED (Task 7, a separate probe script outside the main H4 probe, live
 * InDesign 21.4.1.4): for a character inserted via
 * `insertionPoint.contents = SpecialCharacters.AUTO_PAGE_NUMBER`, reading it
 * back as `character.contents` gives an Enumerator (typeof "object"), and a
 * DIRECT IDENTITY comparison
 * `character.contents === SpecialCharacters.AUTO_PAGE_NUMBER` gives `true` —
 * unlike `page.appliedMaster === NothingEnum.NOTHING` (always `false`, per
 * Task 2's measurement), here `===` against the sentinel WORKS.
 * `String(character.contents)` for this character gives the string
 * "AUTO_PAGE_NUMBER" (confirmed as a second, independent check). The frame
 * level (`item.contents`), by contrast, gives a control character
 * (`""`), unsuitable for a direct comparison against the constant —
 * so the check runs character by character, not against the frame's whole
 * contents.
 *
 * This is NOT a fixture artifact (`.label`, which Task 2's fixture uses only
 * to make reading its own result easier) — it's a real InDesign property,
 * applicable to any document with automatic page numbering.
 */
/*
 * PHASE 4 MERGE BLOCKER (fixed here). On the user's working book this line
 * threw "Object does not support the property or method 'texts'" — and,
 * crucially, THIS VERY inner try/catch (below) DID NOT CATCH IT. Re-running
 * an exact replica of this code on all 170 elements of the book's master
 * pages produced "escaped the inner catch" 124 out of 124 times (exactly the
 * Rectangle+Oval elements — the same 124 that lack .texts), and only 46
 * (TextFrame) actually had .texts. So try/catch in ExtendScript here is NOT
 * a protection by itself: an error from accessing a nonexistent property on
 * a DOM element flies past the LOCAL catch and is only caught by the OUTER
 * one (the overall handler), not here. The only reliable protection is to
 * not touch `.texts` at all until the item's type has been checked in
 * advance via IDMCP.itemKind (which takes the type from getElements()[0],
 * not from the wrapper — see the comment on it). The try/catch below remains
 * a SECOND line of defense, not the only one.
 */
IDMCP.hasAutoPageNumber = function (item) {
    try {
        if (IDMCP.itemKind(item) !== "TextFrame") return false;
        if (!item.texts || item.texts.length === 0) return false;
        var chars = item.texts[0].characters;
        for (var i = 0; i < chars.length; i++) {
            if (chars[i].contents === SpecialCharacters.AUTO_PAGE_NUMBER) return true;
        }
    } catch (e) {
        return false; /* second line of defense — don't rely on it alone */
    }
    return false;
};

/*
 * DEBT (measured on the user's working book, not a merge blocker, not an
 * implementation defect). A call WITHOUT `params.pages` (i.e. "the whole
 * document") on a real 198-page book DOES NOT finish within the
 * AppleScript bridge's timeout. Measured times on this same book: 5 pages —
 * 3.4s; 11 pages — 5.8s; 20 pages — 6.7s. Extrapolated to 198 pages — about a
 * minute, already past the limit.
 *
 * This is NOT a defect: spec §5.1 deliberately makes the range (`pages`) the
 * primary interface, with "the whole document" as a loop over ranges on the
 * MCP side, not a single call here. But defaulting `params.pages` (== null ==
 * "all pages") semantically promises "the whole document", and it's exactly
 * this path that fails on a large book. Callers (`document_map`,
 * `layout_audit`) should call this out in the tool description: on a large
 * book `pages` should be set explicitly, not left to the default.
 */
IDMCP.handlers.layout_measure = function (params) {
    var previousUnit = app.scriptPreferences.measurementUnit;
    app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;
    try {
        var doc = IDMCP.activeDoc();
        var wanted = (params && params.pages) ? params.pages : null;

        var pages = [];
        for (var i = 0; i < doc.pages.length; i++) {
            var pg = doc.pages[i];
            if (wanted && IDMCP.indexOf(wanted, String(pg.name)) === -1) continue;
            /* Don't read this via `=== NothingEnum.NOTHING` — measured (both by Task 2
             * and again here): for a page without a master this expression
             * always gives false, i.e. falsely says "there is a master".
             * Instead, `pg.appliedMaster` for such a page is falsy (typeof
             * "object", String(...) === "null"), and `master && master.isValid`
             * short-circuits to false without touching .isValid — that's
             * exactly what a probe on live InDesign confirmed. */
            var master = pg.appliedMaster;
            var masterItems = [];
            /*
             * DEBT (measured on the user's working book, not a merge blocker).
             * `pg.masterPageItems` includes GUIDES — on this book's checked
             * pages that's `Guide ×501` out of ~48 page items, only 2 of which
             * are NOT guides. `matchedMasterPage.pageItems` (from which
             * `expectedMasterItems` below is counted) does NOT include
             * guides — there it's exactly 170 elements: Rectangle 22, TextFrame
             * 46, Oval 102. This asymmetry between InDesign's two collections
             * is a measurement, not a guess.
             *
             * This is HARMLESS for `detectMasters`/`layout_audit`: the
             * detector goes from `expectedMasterItems` (guide-free) to this
             * same `masterItems`, looking for a MATCH by `.id` — the stray
             * guides in `masterItems` simply never match any expected element
             * and are silently ignored, producing no defects.
             *
             * But for `document_map`, which shows `masterItems` to a human
             * directly, this made the output nearly unreadable on the real
             * book.
             *
             * CLOSED. The criterion is `IDMCP.itemKind(item) === "Guide"`
             * (the same reliable type via `getElements()`, not the collection
             * wrapper). The filter was added in `dfe5679`, the `guideCount`
             * counter — 2026-08-05, at the user's decision. This paragraph
             * remains as a description of the MEASUREMENT behind the
             * decision; the debt itself is no longer open.
             */
            var mpi = pg.masterPageItems;
            var guideCount = 0;
            for (var k = 0; k < mpi.length; k++) {
                /* kind — via IDMCP.itemKind, NOT directly through mpi[k].constructor.
                 * Two measured facts stack up here: (1) String(constructor)
                 * for a constructor function hands back the function's full
                 * body ("function TextFrame() {\n    [native code]\n}\n"), not
                 * a name — constructor.name gives a ready-made string instead;
                 * (2) on the user's working book, mpi[k].constructor.name,
                 * taken DIRECTLY (without getElements()[0]), gave "PageItem"
                 * for ALL elements without exception — this is the
                 * collection's wrapper, not the true type (the detailed
                 * measurement is at IDMCP.itemKind, above). */
                var mKind = IDMCP.itemKind(mpi[k]);
                /* Guides don't go into the list, but they ARE counted. They aren't layout
                 * elements: `masterSpread.pageItems` (where `expectedMasterItems`
                 * comes from) doesn't have them at all, so they were already
                 * invisible to `detectMasters` — but in `masterItems` they made
                 * up 137 of 143 elements across three pages of the book, i.e.
                 * the map was 96% made of them.
                 *
                 * The counter was added 2026-08-05, at the user's decision.
                 * Simply discarding them wasn't enough: the number of guides
                 * is itself a fact about the layout (measured on the working
                 * book: a steady 45–46 on EVERY page, 319 against 10 genuine
                 * elements across seven sample pages), and a whole population
                 * silently vanishing reads as "there are none", not as
                 * "they're not shown". */
                if (mKind === "Guide") { guideCount++; continue; }
                masterItems.push({
                    id: String(mpi[k].id),
                    kind: mKind
                });
            }

            /*
             * NEW (Task 7). The page's own items — needed to tell
             * "overridden" apart from "deleted" by IDENTITY, not by count (the
             * count-based comparison from the briefing draft was disproved by
             * Task 1's probe, Question 3: `masterPageItems.length` and
             * `appliedMaster.pageItems.length` are different object
             * populations, and the "less than" condition structurally never
             * holds). An overridden master item disappears from
             * `masterPageItems` and reappears here, in `page.pageItems`, with
             * a NEW own `.id`, while `.overriddenMasterPageItem.id` gives the
             * `.id` of the ORIGINAL on the master (measured by Task 2, task
             * report: 264 → 291). On a non-overridden item, accessing
             * `.overriddenMasterPageItem` throws a TypeError — that's exactly
             * what the try/catch below confirms, not some separate value
             * comparison.
             */
            var pageItemsOut = [];
            var pgItems = pg.pageItems;
            for (var pit = 0; pit < pgItems.length; pit++) {
                var pgItem = pgItems[pit];
                var overriddenId = null;
                try {
                    overriddenId = String(pgItem.overriddenMasterPageItem.id);
                } catch (eOv) {
                    overriddenId = null; /* not an overridden item */
                }
                pageItemsOut.push({
                    id: String(pgItem.id),
                    overriddenMasterItemId: overriddenId,
                    /* The same function that gives isFolio for master items — otherwise
                     * the two sides of the comparison would be measuring
                     * different things. It also already knows not to fail on
                     * non-text elements (fix for the Phase 4 blocker). */
                    hasAutoPageNumber: IDMCP.hasAutoPageNumber(pgItem)
                });
            }

            var pgSide = IDMCP.enumName(pg.side);
            var pgMasterName = (master && master.isValid) ? String(master.name) : null;

            /*
             * NEW (Task 7). The makeup of the master itself — by the MASTER
             * SPREAD PAGE that matches the SIDE of the current document page
             * (measured on live InDesign: `masterSpread.pages[k].side`
             * gives the same enum name, LEFT_HAND/RIGHT_HAND, as the document
             * page — the pair is matched by comparing strings, not blindly by
             * index `[0]`/`[1]`, since relying on index order without
             * checking isn't safe). The same master can have a DIFFERENT
             * makeup on its left and right sides (a folio on the left and a
             * folio on the right are different elements with different
             * `.id`s), so this field is counted SEPARATELY for each document
             * page, not once for the master as a whole.
             */
            var expectedMasterItems = [];
            if (pgMasterName !== null && pgSide !== null) {
                var matchedMasterPage = null;
                /*
                 * Fix round 1, Important 1. A ONE-SIDED master (a real case —
                 * a section half-title): after deleting the second page of
                 * the spread, `master.pages.length === 1`, and `.side` of
                 * this single page is `SINGLE_SIDED` (measured on live
                 * InDesign), NOT LEFT_HAND/RIGHT_HAND. Comparing it against
                 * the document page's side would be pointless: the equality
                 * would never hold, and `matchedMasterPage` would stay `null`
                 * for EVERY page that applies such a master (regardless of
                 * side) — meaning a genuine, existing composition would
                 * silently turn into "not found". A single page applies
                 * regardless of the document page's side, and that's exactly
                 * why this path does NOT touch `.side` or `master.pages[1]`
                 * at all (accessing the nonexistent `pages[1]` gives an
                 * object with `isValid === false`, and reading any property
                 * off it throws — verified).
                 */
                if (master.pages.length === 1) {
                    matchedMasterPage = master.pages[0];
                } else {
                    for (var mp = 0; mp < master.pages.length; mp++) {
                        if (IDMCP.enumName(master.pages[mp].side) === pgSide) {
                            matchedMasterPage = master.pages[mp];
                            break;
                        }
                    }
                }
                /* matchedMasterPage === null: no page of the master has the same side
                 * as the document page (and the master isn't one-sided). On
                 * a facingPages document this never happened per Question 4's
                 * measurement, but making up a composition instead of an
                 * honest "not found" isn't acceptable — expectedMasterItems
                 * stays an empty array. */
                /*
                 * NULL, НЕ ПОРОЖНІЙ МАСИВ. Коментар вище зве це «чесним not
                 * found», але порожній масив цього не каже: у TS `[]` —
                 * ІСТИННЕ, тож `if (!expected) continue` не спрацьовує, цикл
                 * по елементах іде нуль разів, і сторінка дістає нуль
                 * знахідок — байт у байт як перевірена й чиста. Тобто
                 * «композиції не знайдено» читалося як «нічого не бракує».
                 * `null` — окремий стан, і саме його чекає `detectMasters`.
                 */
                if (!matchedMasterPage) expectedMasterItems = null;
                if (matchedMasterPage) {
                    var mstItems = matchedMasterPage.pageItems;
                    for (var mi2 = 0; mi2 < mstItems.length; mi2++) {
                        var mstItem = mstItems[mi2];
                        /* kind — via IDMCP.itemKind, not directly through
                         * mstItem.constructor.name: the same wrapper defect
                         * as in masterItems above (the detailed measurement is
                         * at IDMCP.itemKind). */
                        expectedMasterItems.push({
                            id: String(mstItem.id),
                            kind: IDMCP.itemKind(mstItem),
                            isFolio: IDMCP.hasAutoPageNumber(mstItem)
                        });
                    }
                }
            }

            pages.push({
                name: String(pg.name),
                side: pgSide,
                master: pgMasterName,
                frameCount: pg.textFrames.length,
                masterItems: masterItems,
                guideCount: guideCount,
                pageItems: pageItemsOut,
                expectedMasterItems: expectedMasterItems
            });
        }

        /* Spreads: makeup, and whether the page sits on the pasteboard.
         * Spec §5.1. A spread isn't decoration on the map: it's exactly what
         * makes a recto/verso shift visible, because an odd page count
         * changes THE MAKEUP OF SPREADS itself, not a single page's
         * properties. */
        var spreads = [];
        for (var sp = 0; sp < doc.spreads.length; sp++) {
            var spread = doc.spreads[sp];
            var names = [];
            var touchesWanted = !wanted;
            for (var spp = 0; spp < spread.pages.length; spp++) {
                var spName = String(spread.pages[spp].name);
                names.push(spName);
                if (wanted && IDMCP.indexOf(wanted, spName) !== -1) touchesWanted = true;
            }
            /* A spread stays WHOLE in the map if even one of its pages falls
             * inside the range. A spread can't be trimmed at the range
             * boundary: half a spread doesn't show the recto/verso shift that
             * spreads are in the map for in the first place. */
            if (!touchesWanted) continue;
            /* Items that sit not on a page but on the pasteboard: for them
             * parentPage === null. Such an item doesn't print and is
             * therefore invisible to any page-by-page check — the map must
             * name them as a number, or else they don't exist for the
             * operator. */
            var pasteboard = 0;
            for (var pi = 0; pi < spread.pageItems.length; pi++) {
                if (!IDMCP.parentPageOf(spread.pageItems[pi])) pasteboard++;
            }
            spreads.push({ index: sp, pages: names, pasteboardItems: pasteboard });
        }

        /* Stories: overset, and how many frames are in the chain. */
        /*
         * Stories are narrowed by the same `wanted` set as frames with
         * paragraphs.
         *
         * WHY THIS ISN'T COSMETIC (measured with a live run on the user's
         * book after the Phase 4 merge): without the filter, the loop went
         * over ALL stories in the document regardless of the range. On a
         * request for THREE pages that gave 552 stories and 39,967 bytes —
         * 51% of the whole response — which meant `document_map` didn't fit
         * into the MCP response at all. So the tool's primary interface (a
         * page range) was unusable exactly where it's needed: on a large
         * book.
         *
         * A story stays in if AT LEAST ONE of its frames sits on a requested
         * page. A story entirely outside the range doesn't make it into the
         * output.
         */
        var stories = [];
        for (var st = 0; st < doc.stories.length; st++) {
            var story = doc.stories[st];
            if (wanted) {
                var touches = false;
                var sc = story.textContainers;
                for (var sci = 0; sci < sc.length; sci++) {
                    var scPage = IDMCP.parentPageOf(sc[sci]);
                    if (scPage && IDMCP.indexOf(wanted, String(scPage.name)) !== -1) { touches = true; break; }
                }
                if (!touches) continue;
            }
            stories.push({
                containerId: "story:" + st,
                characters: story.contents.length,
                frames: story.textContainers.length,
                overflows: story.overflows
            });
        }

        /* Frames, chains, overset. */
        /*
         * NARROWING COUNTERS (§2.2 of the 2026-08-18 review). A container or
         * paragraph that couldn't be assigned a page DROPS OUT of the
         * measurement — and until now this happened silently: `checked` got
         * smaller, and by exactly how much was never said anywhere. This is
         * exactly the class of problem `masterSkipped` exists for in
         * `pagination.jsx`: the knowledge exists, the channel doesn't.
         *
         * The numbers aren't developer diagnostics — they're part of the
         * measurement: "0 pages undetermined" and "137 undetermined" are two
         * different reports, and the reader must be able to see which one
         * they're looking at.
         */
        var unplaced = 0;
        var unplacedParagraphs = 0;
        var frames = [];
        for (var s = 0; s < doc.stories.length; s++) {
            var containers = doc.stories[s].textContainers;
            for (var c = 0; c < containers.length; c++) {
                var fr = containers[c];
                /*
                 * The CARRIER of a page item's properties isn't always the
                 * container itself (`IDMCP.pageItemOf`, inspect.jsx): for text
                 * on a path, it's its graphic owner. Only what EVERY story
                 * container has stays raw here (id, chain, overflows —
                 * measured by the 2026-08-18 probe); geometry and page go
                 * through the carrier. This is exactly where the pass failed
                 * two times in a row.
                 */
                var res = IDMCP.resolveContainerPage(fr);
                var carrier = res.carrier;
                var pageName = res.page ? String(res.page.name) : null;
                if (pageName === null) unplaced++;
                if (wanted && (pageName === null || IDMCP.indexOf(wanted, pageName) === -1)) continue;
                frames.push({
                    id: String(fr.id),
                    page: pageName,
                    containerId: "story:" + s,
                    rotationAngle: carrier ? IDMCP.propValue(carrier.rotationAngle) : null,
                    previousFrameId: fr.previousTextFrame ? String(fr.previousTextFrame.id) : null,
                    nextFrameId: fr.nextTextFrame ? String(fr.nextTextFrame.id) : null,
                    overflows: fr.overflows,
                    isMaster: IDMCP.isMasterParent(carrier ? carrier.parent : fr.parent)
                });
            }
        }

        /* Paragraphs: declared and actual, separately. */
        var paragraphs = [];
        for (var s2 = 0; s2 < doc.stories.length; s2++) {
            var paras = doc.stories[s2].paragraphs;
            for (var p = 0; p < paras.length; p++) {
                var par = paras[p];
                var style = par.appliedParagraphStyle;
                var firstFrame = par.parentTextFrames.length ? par.parentTextFrames[0] : null;
                /* Carrier and page — ONE resolve per paragraph. There are 21,686 of
                 * them on «Book B», so every extra DOM access gets
                 * multiplied by that figure. */
                var ffRes = IDMCP.resolveContainerPage(firstFrame);
                var ffCarrier = ffRes.carrier;
                var pName = ffRes.page ? String(ffRes.page.name) : null;
                if (firstFrame && pName === null) unplacedParagraphs++;
                if (wanted && (pName === null || IDMCP.indexOf(wanted, pName) === -1)) continue;
                var text = String(par.contents);
                var containerIdForPara = "story:" + s2;
                /*
                 * `styleId` is the report's key (Task 12). The name is NOT
                 * the key: the H5 probe measured that the document contains
                 * two different styles with the same name — one used, the
                 * other not — and counting by name merges them into a single
                 * row, which makes the UNUSED style vanish from the report
                 * entirely. The same approach as in styles.jsx.
                 *
                 * The fallback when reading `.id` fails is NOT an empty
                 * string (round-1 review, M-6): an empty string would itself
                 * be an ordinary key, and two paragraphs from different
                 * failed reads would merge into one report row — exactly the
                 * defect this task exists to fix, just rarer. Instead, a
                 * unique sentinel keyed to the paragraph's address:
                 * collisions between different paragraphs become
                 * structurally impossible.
                 */
                var styleId = "";
                try { styleId = String(style.id); } catch (eStyleId) { styleId = "unresolved:" + containerIdForPara + "#" + p; }
                paragraphs.push({
                    containerId: containerIdForPara,
                    paragraphIndex: p,
                    page: pName,
                    styleName: String(style.name),
                    styleId: styleId,
                    isMaster: ffCarrier ? IDMCP.isMasterParent(ffCarrier.parent) : false,
                    declared: IDMCP.declaredStyleValues(style),
                    actual: IDMCP.actualStyleValues(par),
                    hasCharacterStyleRuns: IDMCP.hasCharacterStyleRuns(par),
                    preview: text.substr(0, 40)
                });
            }
        }

        return {
            docName: String(doc.name),
            pages: pages,
            spreads: spreads,
            stories: stories,
            frames: frames,
            paragraphs: paragraphs,
            /* How many containers and paragraphs were left WITHOUT a page. Zero
             * is also an answer, and that's exactly why the fields are
             * unconditional rather than appearing only when there's
             * something to complain about. */
            unplacedContainers: unplaced,
            unplacedParagraphs: unplacedParagraphs,
            measurementUnit: "POINTS"
        };
    } finally {
        app.scriptPreferences.measurementUnit = previousUnit;
    }
};

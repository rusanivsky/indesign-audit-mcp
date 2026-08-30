/*
 * The geometry_measure handler is the SINGLE document traversal for all four
 * families of the geometry_audit tool.
 *
 * INSTRUMENT is the per-page page.allPageItems. Measured in H13, and this is
 * the third case in a row where the obvious instrument turns out to be
 * wrong:
 *   page.textFrames            573  (doesn't see anchored items — Phase 6)
 *   page.pageItems             618  (doesn't see the contents of groups)
 *   doc.pageItems.everyItem()  780  (sees NEITHER groups NOR anchored
 *                                    items: 303 anchored objects give ZERO)
 *   page.allPageItems          965  ← correct
 * The cost of correct is 744ms for 196 pages.
 *
 * UNITS are forced to points. geometricBounds returns units in the
 * DOCUMENT's ruler: in the working book they're millimeters, and the same
 * element gives 34.25 without forcing versus 97.09 with it forced. This is
 * the same trap that took down C2 in Phase 9. Restoration happens in
 * finally, unconditionally.
 *
 * READ-ONLY. The only assignment in the whole file is measurementUnit, and
 * it targets the APPLICATION, not the document.
 */
IDMCP.handlers.geometry_measure = function (params) {
    var doc = IDMCP.activeDoc();
    var previousUnit = app.scriptPreferences.measurementUnit;
    app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;

    var out = {
        docName: String(doc.name),
        units: "points",
        traversal: "page.allPageItems",
        rulerOrigin: "?",
        zeroPoint: [0, 0],
        ms: 0,
        pages: [],
        items: []
    };

    try {
        /* COORDINATE ORIGIN, read and named. geometricBounds silently returns
         * different numbers in a document where the ruler zero point has
         * been moved — and no check catches this, because all the numbers
         * stay plausible. The risk is named explicitly in the phase's
         * measured facts; here it stops being invisible. A READ, not an
         * assignment.
         *
         * It sits INSIDE the try block, so the unit restoration in finally
         * stays unconditional. */
        try { out.rulerOrigin = String(doc.viewPreferences.rulerOrigin); } catch (eRo) {}
        try {
            var zp = doc.zeroPoint;
            out.zeroPoint = [zp[0], zp[1]];
        } catch (eZp) {}

        var t0 = new Date().getTime();
        var dp = doc.documentPreferences;
        var bleedTop = dp.documentBleedTopOffset;
        var bleedBottom = dp.documentBleedBottomOffset;
        var bleedInside = dp.documentBleedInsideOrLeftOffset;
        var bleedOutside = dp.documentBleedOutsideOrRightOffset;

        var pages = doc.pages.everyItem().getElements();
        for (var i = 0; i < pages.length; i++) {
            var p = pages[i];
            var rawSide = String(p.side);
            var side = "single";
            if (rawSide === "LEFT_HAND") side = "left";
            else if (rawSide === "RIGHT_HAND") side = "right";

            /* SIZE is taken PER PAGE, from `page.bounds`, not once from
             * `documentPreferences`. InDesign allows different page sizes
             * within one document (the Page tool), and a document-wide size
             * stamped onto every page would produce FABRICATED pageBox,
             * bleedBox, and typeArea on every non-standard-size page —
             * silently and plausibly.
             *
             * `page.bounds` is in the SPREAD's coordinate space (measured
             * in H13, and mixing spaces there was exactly what produced 545
             * out of 546 elements "outside the type area"), so only
             * DIFFERENCES — width and height — are taken from here. No
             * coordinate from this space travels any further. */
            var pb = p.bounds;
            var pageWidth = pb[3] - pb[1];
            var pageHeight = pb[2] - pb[0];

            var mp = p.marginPreferences;
            /* RENAMING, NOT SWAPPING. MEASURED on the working book on 2026-08-15
             * (196 pages, margins identical on all of them:
             * top 51.0236 | left 79.3701 | bottom 60.5764 | right 90.7087):
             *
             *   recto (RIGHT_HAND): frame's left edge = mp.left  128 times,
             *                       = mp.right   0 times;
             *                       right edge = W − mp.right 107, = W − mp.left 0;
             *   verso (LEFT_HAND):  frame's left edge = mp.right 119 times,
             *                       = mp.left    0 times;
             *                       right edge = W − mp.left 132, = W − mp.right 0.
             *
             * Zero counterexamples in EITHER direction: `marginPreferences.left`
             * is the INSIDE margin on BOTH sides, `right` is the outside
             * one. InDesign does NOT swap them itself, so there's nothing to
             * swap here either — this is just naming what's already there.
             *
             * Mirroring (the fact that inside on verso sits on the RIGHT) is
             * done by exactly one place — typeArea() in
             * src/geometry/reference.ts. Swapping HERE and collapsing THERE
             * composed to the identity: no mirroring happened at all,
             * despite both places declaring it in comments. */
            var inside = mp.left;
            var outside = mp.right;

            out.pages.push({
                name: String(p.name),
                side: side,
                width: pageWidth,
                height: pageHeight,
                margins: {
                    top: mp.top, bottom: mp.bottom,
                    inside: inside, outside: outside,
                    columnCount: mp.columnCount, columnGutter: mp.columnGutter
                },
                bleed: {
                    top: bleedTop, bottom: bleedBottom,
                    inside: bleedInside, outside: bleedOutside
                }
            });

            /*
             * ПОЧАТОК КООРДИНАТ САМОЇ СТОРІНКИ, у ТІЙ САМІЙ системі, у якій
             * читаються рамки. Далі рамки зводяться до нього, тож положення
             * лінійки перестає впливати на числа взагалі.
             *
             * Доти обробник лінійку лише ЧИТАВ і називав у відповіді, а всі
             * споживачі (`src/geometry/reference.ts`) рахують у власному
             * просторі сторінки від (0,0). Досить документа в SPREAD_ORIGIN —
             * і кожен елемент на ПРАВІЙ сторінці розвороту з'їжджав на цілу
             * ширину сторінки. Стан не гіпотетичний: `pagination_measure`
             * САМ ставить SPREAD_ORIGIN і при таймауті лишає його таким.
             * Виміряно (фаза 13): рамка правого майстра давала x = [245.9 …
             * 295.9] замість [30 … 80] — рівно ширина сторінки.
             *
             * Зведення краще за встановлення PAGE_ORIGIN: воно нічого не
             * пише в документ, тобто читальний інструмент лишається читальним.
             */
            var pageOrigin = [0, 0];
            try {
                var pb = p.bounds;
                pageOrigin = [pb[0], pb[1]];
            } catch (ePb) {}

            var items = p.allPageItems;
            for (var k = 0; k < items.length; k++) {
                out.items.push(IDMCP.geometryItem(items[k], String(p.name), side, pageOrigin));
            }
        }
        out.ms = new Date().getTime() - t0;
    } finally {
        app.scriptPreferences.measurementUnit = previousUnit;
    }

    return out;
};

/* Measuring a single element. Factored out separately so the traversal
 * stays readable, and so every risky access has its own try — a
 * measurement that fails entirely because of one property on one element
 * is useless. */
IDMCP.geometryItem = function (it, pageName, side, pageOrigin) {
    var rec = {
        itemId: -1, page: pageName, side: side, type: "?", parentKind: "?",
        anchored: false, inGroup: false, layer: "", layerVisible: true,
        layerPrintable: true, locked: false, rotation: 0,
        bounds: null, wrapMode: null, wrapOffsets: null,
        anchorStyle: null, graphic: null
    };

    try { rec.itemId = it.id; } catch (e0) {}
    try { rec.type = String(it.constructor.name); } catch (e1) {}

    var pk = "?";
    try { pk = String(it.parent.constructor.name); } catch (e2) {}
    rec.parentKind = pk;
    /* An anchored object is one whose parent is TEXT. Measured in H13: the
     * book has 303 of these, and the document-level traversal sees zero of
     * them. */
    if (pk === "Character" || pk === "InsertionPoint" || pk === "Text" ||
        pk === "Story" || pk === "Paragraph" || pk === "Word") {
        rec.anchored = true;
    }
    if (pk === "Group") rec.inGroup = true;

    try {
        var b = it.geometricBounds;
        /* Зводимо до початку сторінки — див. коментар коло pageOrigin вище.
         * Без аргументу (старі виклики) зведення тотожне. */
        var oy = pageOrigin ? pageOrigin[0] : 0;
        var ox = pageOrigin ? pageOrigin[1] : 0;
        rec.bounds = [b[0] - oy, b[1] - ox, b[2] - oy, b[3] - ox];
    } catch (e3) {}

    try { rec.rotation = it.rotationAngle; } catch (e4) {}

    try {
        var lay = it.itemLayer;
        rec.layer = String(lay.name);
        rec.layerVisible = lay.visible;
        rec.layerPrintable = lay.printable;
    } catch (e5) {}

    try { rec.locked = it.locked; } catch (e6) {}

    /* Not every type has wrap — a throw means "not supported", not "turned
     * off", and these two states can't be collapsed into one value. */
    try { rec.wrapMode = String(it.textWrapPreferences.textWrapMode); } catch (e7) {}

    /* Wrap offsets use the same defensive pattern as wrapMode above: a type
     * without wrap support throws on textWrapOffset the same way it does on
     * textWrapMode. textWrapOffset returns four numbers [top, left, bottom,
     * right] in ruler units, and the ruler is already forced to points for
     * the whole traversal (see the file header) — no separate forcing is
     * needed here.
     *
     * MEASURED (a live run through the bridge, not indesign_run_jsx
     * directly): when wrapMode === NONE, textWrapOffset is
     * NothingEnum.NOTHING, and INDEXING DOESN'T ALWAYS THROW — in this
     * environment it silently returns undefined for each of the four
     * elements instead of raising an exception (unlike an isolated direct
     * probe on a freshly created object, where the same indexing does
     * throw). A plain try/catch is NOT ENOUGH here: without an explicit
     * type check, rec.wrapOffsets silently becomes [null,null,null,null] —
     * an array, not null — which breaks the field's contract (the "wrap not
     * applicable" property must be a SINGLE null, not an array of unusable
     * values). */
    try {
        var wo = it.textWrapPreferences.textWrapOffset;
        var offs = [wo[0], wo[1], wo[2], wo[3]];
        if (typeof offs[0] === "number" && typeof offs[1] === "number" &&
            typeof offs[2] === "number" && typeof offs[3] === "number") {
            rec.wrapOffsets = offs;
        }
    } catch (e7b) {}

    /* The paragraph style is needed only for anchored objects, and only to
     * split the populations. GraphicLine has no .paragraphs and throws —
     * the book has 82 of these out of 303, so this is the normal case, not
     * an edge case. */
    if (rec.anchored) {
        try {
            if (it.paragraphs.length > 0) {
                rec.anchorStyle = String(it.paragraphs[0].appliedParagraphStyle.name);
            }
        } catch (e8) {}
    }

    rec.graphic = IDMCP.geometryGraphic(it);
    return rec;
};

/*
 * Measuring graphics. BRANCHING BY TYPE IS MANDATORY: the PDF type (and .ai
 * is imported as exactly that) HAS NO effectivePpi/actualPpi/space
 * properties — accessing them throws "Object does not support the property
 * or method". Measured in H13 on the book's two logos. Code that reads
 * effectivePpi in a loop over allGraphics fails on every book with a
 * vector logo.
 *
 * "A vector has no ppi" is a PROPERTY, not a defect and not a missing
 * measurement.
 */
IDMCP.geometryGraphic = function (it) {
    var type = "?";
    try { type = String(it.constructor.name); } catch (e0) { return null; }
    if (type !== "Image" && type !== "PDF" && type !== "EPS" && type !== "WMF" &&
        type !== "PICT" && type !== "ImportedPage") {
        return null;
    }

    var kind = "unknown";
    if (type === "Image") kind = "raster";
    else if (type === "PDF" || type === "EPS" || type === "WMF" ||
             type === "PICT" || type === "ImportedPage") kind = "vector";

    var g = {
        kind: kind, effectivePpi: null, actualPpi: null, space: null,
        hScale: 0, vScale: 0, linkName: null, linkStatus: null
    };

    if (kind === "raster") {
        try { var ep = it.effectivePpi; g.effectivePpi = [ep[0], ep[1]]; } catch (e1) {}
        try { var ap = it.actualPpi; g.actualPpi = [ap[0], ap[1]]; } catch (e2) {}
        try { g.space = String(it.space); } catch (e3) {}
    }
    try { g.hScale = it.absoluteHorizontalScale; } catch (e4) {}
    try { g.vScale = it.absoluteVerticalScale; } catch (e5) {}
    try {
        var lk = it.itemLink;
        if (lk !== null) {
            g.linkName = String(lk.name);
            g.linkStatus = String(lk.status);
        }
    } catch (e6) {}
    return g;
};

/*
 * page_render handlers — the server's EYES. Read-only: no assignment into
 * the document. Everything written here belongs to the APPLICATION.
 *
 * WHY TWO HANDLERS, NOT ONE. The resolution is computed from the long side,
 * which only InDesign knows, and the formula must live in ONE place and be
 * covered by unit tests (src/render/resolution.ts). Computing it here too
 * would be duplication — exactly what gave the same bug in five places in
 * Phase 5. The price is a second pass through the bridge; it is measured
 * in Task 5, not assumed.
 *
 * NO withUndo. The wrapper is doScript(..., ENTIRE_SCRIPT), and its
 * rollback restores DOCUMENT state. It does not touch APPLICATION
 * preferences, so the only protection is the own finally below.
 */

/** Page by NAME, not by index: in editions with sections they diverge. */
IDMCP.pageByName = function (doc, name) {
    for (var i = 0; i < doc.pages.length; i++) {
        if (String(doc.pages[i].name) === String(name)) { return doc.pages[i]; }
    }
    return null;
};

IDMCP.assertExpectedDoc = function (doc, expected) {
    if (expected && String(doc.name) !== String(expected)) {
        throw new Error(
            "The active document is \"" + doc.name + "\", but this call is meant for \"" + expected +
            "\". Rendering the wrong document is not catchable by eye — both look correct."
        );
    }
};

IDMCP.handlers.render_bounds = function (params) {
    return IDMCP.withNoInteraction(function () {
        var doc = IDMCP.activeDoc();
        IDMCP.assertExpectedDoc(doc, params.expectedDocName);

        /* Ruler units on a fresh document are POINTS (measured: 40.16 × 56.69
         * for 170 × 240 mm). Forcing them is mandatory, as in geometry.jsx. */
        var prevUnit = app.scriptPreferences.measurementUnit;
        app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;
        try {
            var pg = IDMCP.pageByName(doc, params.page);
            if (!pg) { throw new Error("There is no page \"" + params.page + "\" in the document"); }

            var y1, x1, y2, x2;
            if (params.spread) {
                var pages = pg.parent.pages;
                for (var i = 0; i < pages.length; i++) {
                    var b = pages[i].bounds;
                    if (i === 0) { y1 = b[0]; x1 = b[1]; y2 = b[2]; x2 = b[3]; }
                    else {
                        if (b[0] < y1) { y1 = b[0]; }
                        if (b[1] < x1) { x1 = b[1]; }
                        if (b[2] > y2) { y2 = b[2]; }
                        if (b[3] > x2) { x2 = b[3]; }
                    }
                }
            } else {
                var pb = pg.bounds;
                y1 = pb[0]; x1 = pb[1]; y2 = pb[2]; x2 = pb[3];
            }

            var w = x2 - x1, h = y2 - y1;
            return {
                docName: String(doc.name),
                page: String(pg.name),
                spread: !!params.spread,
                widthPt: w,
                heightPt: h,
                longEdgePt: (w > h ? w : h),
                /* How many pages are actually in this spread. Needed by the test:
                 * "twice as wide" is an assumption about a specific fixture, and
                 * the spread may have 1 or 3 pages. The expectation must be
                 * derived from the document, not from trusting it. */
                pagesInSpread: pg.parent.pages.length
            };
        } finally {
            app.scriptPreferences.measurementUnit = prevUnit;
        }
    });
};

IDMCP.handlers.render_export = function (params) {
    return IDMCP.withNoInteraction(function () {
        var doc = IDMCP.activeDoc();
        IDMCP.assertExpectedDoc(doc, params.expectedDocName);

        var p = app.pngExportPreferences;
        /* USER'S PERSISTENT STATE. At the moment of measurement this held the
         * user's own manual export (res 170, pageString "166", bleeds true).
         * Writing without restoring destroys this permanently. */
        var saved = {
            res: p.exportResolution, q: p.pngQuality, cs: p.pngColorSpace,
            tb: p.transparentBackground, aa: p.antiAlias, bl: p.useDocumentBleeds,
            spr: p.exportingSpread, ps: p.pageString, rng: p.pngExportRange
        };
        try {
            /* WITHOUT EXPORT_RANGE pageString IS SILENTLY IGNORED, and InDesign
             * writes one file per page with a numeric suffix. On 196 pages
             * that's 196 files, and the first of them looks like a success. */
            p.pngExportRange = PNGExportRangeEnum.EXPORT_RANGE;
            p.pageString = String(params.page);
            p.exportingSpread = !!params.spread;
            p.exportResolution = params.dpi;
            p.pngQuality = PNGQualityEnum.HIGH;
            p.pngColorSpace = PNGColorSpaceEnum.RGB;
            p.transparentBackground = false;
            p.antiAlias = true;
            p.useDocumentBleeds = !!params.bleed;

            var f = new File(params.path);
            /* The name is deterministic, and a repeated render lands on the same
             * path. If the file was left over from a previous call (an hour
             * ago or a minute ago), a bare "if (!f.exists)" below cannot
             * distinguish a stale file from one just exported — it is true
             * in both cases. We delete it IN ADVANCE, so that f.exists after
             * exportFile means "the export really happened just now". The
             * price is losing a stale file if the export itself fails: that
             * is cheaper than silently returning a stale render. */
            if (f.exists) { f.remove(); }
            doc.exportFile(ExportFormat.PNG_FORMAT, f, false);
            if (!f.exists) { throw new Error("The export did not create a file: " + params.path); }

            /* Guard against §0.3: if the range ever stops working, InDesign
             * writes one file per page with a NUMERIC suffix (ctl_off.png,
             * ctl_off2.png, ctl_off3.png…), and the first of them looks
             * exactly like a success.
             *
             * WE DO NOT ENUMERATE THE FOLDER, AND THAT IS A MEASUREMENT, NOT A
             * STYLE CHOICE. The previous version called
             * `folder.getFiles(base + "*.png")`, and on the machine's own temp
             * folder — the default destination, 2 838 entries — that call took
             * 51,6 с (a bare `getFiles()` there: 58,7 с). The export itself is
             * 13 мс. So EVERY render blew the 30-second bridge timeout, and it
             * blew it in the guard, not in the work. Measured 2026-08-25 on
             * InDesign 21.5.1.73; `getFiles` is O(entries) with a very large
             * constant, and the mask does not help — it is applied after the
             * enumeration.
             *
             * The stray files form a CONTIGUOUS run starting at 2, so probing
             * names directly answers the same question in O(strays + 1) — one
             * `File.exists` in the normal case, where there are none. This also
             * removes the false positives the old mask had to filter out by
             * hand ("Doc-10.png" while rendering "Doc-1"): a name is only
             * examined if it is exactly the next member of the run. */
            var strays = 0;
            var folder = f.parent;
            var base = String(f.name).replace(/\.png$/i, "");
            for (var i = 2; i < 500; i++) {
                var probe = new File(folder.fsName + "/" + base + String(i) + ".png");
                if (!probe.exists) { break; }
                strays++;
            }

            return {
                docName: String(doc.name),
                path: String(params.path),
                bytes: f.length,
                dpi: params.dpi,
                strays: strays
            };
        } finally {
            p.exportResolution = saved.res; p.pngQuality = saved.q;
            p.pngColorSpace = saved.cs; p.transparentBackground = saved.tb;
            p.antiAlias = saved.aa; p.useDocumentBleeds = saved.bl;
            p.exportingSpread = saved.spr; p.pageString = saved.ps;
            p.pngExportRange = saved.rng;
        }
    });
};

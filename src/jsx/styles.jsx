/*
 * Measurement for `styles_audit` (Phase 5).
 *
 * WHY A SEPARATE HANDLER, NOT `layout_measure`. That one measures pages,
 * parent pages, frames, spreads, and stories — none of that is needed here,
 * and it costs ~36s baseline on any call (`src/tools/map.ts`,
 * LAYOUT_MEASURE_TIMEOUT_MS). A direct probe over the same paragraph
 * properties cost 267ms for the whole book. Task 1 decides the fork
 * "two paths or a shared paragraph mode" (spec §4.6).
 */

/* The style's full path including folders (groups). `allParagraphStyles`
 * flattens the folders, so two different folders can produce the same
 * `.name` — and the whole Phase 4 report is keyed exactly by name. We always
 * store the path; whether it becomes the key is a Task 1 decision.
 *
 * A STRUCTURAL stopping condition (`parent === doc`), NOT `constructor.name`:
 * map.jsx already measured that `constructor.name`, obtained via an InDesign
 * collection access, can return a generic wrapper instead of the real type
 * (`item.constructor.name` gave "PageItem" for all 170 document elements,
 * regardless of their actual class). Whether `style.parent` suffers from
 * this too — not measured; rather than guessing, we base the stopping
 * condition on a fact that does not depend on the constructor name at all:
 * the `.parent` chain for a style always and only bottoms out at the
 * document itself — the group folders (`ParagraphStyleGroup`/
 * `CharacterStyleGroup`) sit BETWEEN the style and the document, no matter
 * how deeply nested. */
IDMCP.stylePath = function (style, doc) {
    var parts = [String(style.name)];
    var node = style;
    for (var guard = 0; guard < 20; guard++) {
        var parent;
        try { parent = node.parent; } catch (e) { break; }
        if (!parent || parent === doc) break;
        var name;
        try { name = String(parent.name); } catch (e2) { break; }
        parts.unshift(name);
        node = parent;
    }
    return parts.join("/");
};

/* The related style's name, or null. `basedOn`/`nextStyle` can return
 * NothingEnum — and comparing it on READ is always false (measured in
 * Phase 4 for appliedMaster), so we check via String(...). */
IDMCP.relatedStyleName = function (value) {
    if (value === undefined || value === null) return null;
    var s;
    try { s = String(value.name); } catch (e) { return null; }
    if (s === "undefined" || s === "null" || s === "[No Paragraph Style]") return null;
    return s;
};

/*
 * The related style's `.id`, or null. The ONLY thing the chain can be
 * resolved by: probe H5 measured (docs/measured-facts-phase5.md, Question 6)
 * that on the actual book several styles declare basedOn with the same name,
 * but there are two styles with that name in the document (different
 * folders) — and not every basedOn reference points to the same one.
 * Resolving the chain by name is provably wrong; only `id` settles it.
 *
 * Two different kinds of root, both measured, and both must yield null:
 * `[No Paragraph Style]` THROWS "Invalid request on a root style." on
 * .basedOn; `[Basic Paragraph]` throws nothing, but .basedOn.id gives the
 * string "undefined". Neither try/catch nor a check for "undefined" alone
 * covers both.
 */
IDMCP.relatedStyleId = function (value) {
    if (value === undefined || value === null) return null;
    /* Symmetric with relatedStyleName: we don't count the value
     * "[No Paragraph Style]" as a "real" parent even when the .id call
     * itself neither throws nor gives "undefined" — otherwise basedOn: null
     * ("root") would disagree with basedOnId: "has an id" on the EXACT same
     * value. This branch isn't dead: a style can LEGALLY declare
     * basedOn: [No Paragraph Style] through the InDesign dialog, and .id on
     * it is a normal working string, not a sentinel. */
    var name = "";
    try { name = String(value.name); } catch (eName) { name = ""; }
    if (name === "[No Paragraph Style]") return null;
    var s;
    try { s = String(value.id); } catch (e) { return null; }
    if (s === "undefined" || s === "null" || s === "") return null;
    return s;
};

/*
 * The font family name from `appliedFont`, which comes in TWO DIFFERENT
 * types.
 *
 * MEASURED by probe H5: on a paragraph or a range it's a `Font` object
 * (needs `.fontFamily`), while on a character STYLE it's just a string
 * (`typeof "string"`, `constructor String`), and `.fontFamily` on it gives
 * `undefined` for all 8 styles in the document. IDMCP.fontFamilyName,
 * written for the first form, would leave the font-family column empty
 * SILENTLY.
 *
 * A SECOND CHANCE AFTER `.fontFamily` (Task 13 review, round 1, minor
 * item 1): the probe named TWO signs of the string form — `typeof "string"`
 * AND `constructor String` — while the first branch above checks only the
 * first. A `String` wrapper object (`typeof "object"`, `constructor
 * String`) passes neither the `typeof` check nor has `.fontFamily` — it
 * would fall into the same empty column this whole function is written
 * against. But `String(...)` on such a wrapper gives READABLE text (its
 * built-in `toString`/`valueOf`), not "[object ...]" — unlike a real
 * `Font`, where `String(...)` gives literally "[object Font]" (measured in
 * `map.jsx`, `IDMCP.fontFamilyName`). The difference between the two is
 * exactly the filter: we accept the second chance only if it does NOT start
 * with "[object".
 */
IDMCP.anyFontName = function (value) {
    if (value === undefined || value === null) return null;
    if (typeof value === "string") return value === "" ? null : String(value);
    var f;
    try { f = value.fontFamily; } catch (e) { f = undefined; }
    if (f !== undefined && f !== null) {
        var fs = String(f);
        if (fs !== "undefined" && fs !== "") return fs;
    }
    var s;
    try { s = String(value); } catch (e2) { return null; }
    if (s === "" || s === "undefined" || s.indexOf("[object") === 0) return null;
    return s;
};

/*
 * CARRIERS THROUGH WHICH A CHARACTER STYLE LIVES OUTSIDE THE TEXT.
 *
 * A character style's usage was counted only via `textStyleRanges` — i.e.
 * through text. But a style can be APPLIED without touching any range: as a
 * paragraph style's bullet marker, as a numbering number, as a nested
 * (including GREP) style, as a cross-reference format block, as a page
 * number in a table-of-contents style. In all these cases `appliedRuns = 0`,
 * and `character-style-unused` called the style unused — and deleting such a
 * style silently changes the appearance of every paragraph that relies on
 * it. The same breed of bug as `style-unused` in the `usage` family: "zero
 * paragraphs" ≠ "redundant".
 *
 * MEASURED ON THE LIVE BOOK 2026-08-16, not taken from documentation:
 *   - `bulletsCharacterStyle` and `numberingCharacterStyle` read on all 56
 *     paragraph styles and do NOT throw; when unset, they return the
 *     sentinel `[None]`, not null — so a name filter is mandatory;
 *   - `Text Semi Bold` is used as a bullet marker in THREE paragraph styles
 *     (the only live example in the book, and it's also the one saved from
 *     a false finding the moment its text usage disappears);
 *   - `Зміст Номер сторінки` is used in a cross-reference format block;
 *   - `nestedStyles`, `nestedLineStyles`, `nestedGrepStyles` are EMPTY on
 *     all 56 styles in the book, and `tocStyleEntries` is empty on the
 *     single table-of-contents style. The book gives no proof at all for
 *     these branches; only a fixture can prove them.
 *
 * Every read is in a try/catch, and EVERY failure is counted in `failures`:
 * a silent catch would turn blindness into "nothing found", and that is
 * exactly what this whole function is written against.
 */
IDMCP.characterStyleCarriers = function (doc) {
    var carriers = {};
    var failures = 0;

    function add(carrier, cs) {
        if (cs === undefined || cs === null) return;
        var name;
        try { name = String(cs.name); } catch (eName) { failures = failures + 1; return; }
        /* `[None]` — the sentinel for "no style set", not a style. The same
         * exception BY NAME as in character.ts. */
        if (name === "[None]") return;
        var id;
        try { id = String(cs.id); } catch (eId) { failures = failures + 1; return; }
        if (!carriers.hasOwnProperty(id)) carriers[id] = {};
        carriers[id][carrier] = (carriers[id].hasOwnProperty(carrier) ? carriers[id][carrier] : 0) + 1;
    }

    var nestedKinds = [
        ["nestedStyles", "nested"],
        ["nestedLineStyles", "nestedLine"],
        ["nestedGrepStyles", "nestedGrep"]
    ];

    var paraStyles = doc.allParagraphStyles;
    for (var i = 0; i < paraStyles.length; i++) {
        var st = paraStyles[i];
        try { add("bullets", st.bulletsCharacterStyle); } catch (e1) { failures = failures + 1; }
        try { add("numbering", st.numberingCharacterStyle); } catch (e2) { failures = failures + 1; }
        for (var n = 0; n < nestedKinds.length; n++) {
            try {
                var coll = st[nestedKinds[n][0]];
                for (var k = 0; k < coll.length; k++) {
                    try { add(nestedKinds[n][1], coll[k].appliedCharacterStyle); } catch (e3) { failures = failures + 1; }
                }
            } catch (e4) { failures = failures + 1; }
        }
    }

    try {
        var formats = doc.crossReferenceFormats;
        for (var f = 0; f < formats.length; f++) {
            try {
                var blocks = formats[f].buildingBlocks;
                for (var b = 0; b < blocks.length; b++) {
                    try { add("crossReference", blocks[b].appliedCharacterStyle); } catch (e5) { failures = failures + 1; }
                }
            } catch (e6) { failures = failures + 1; }
        }
    } catch (e7) { failures = failures + 1; }

    try {
        var tocs = doc.tocStyles;
        for (var t = 0; t < tocs.length; t++) {
            try {
                var entries = tocs[t].tocStyleEntries;
                for (var q = 0; q < entries.length; q++) {
                    try { add("tocPageNumber", entries[q].pageNumberStyle); } catch (e8) { failures = failures + 1; }
                    try { add("tocSeparator", entries[q].separatorStyle); } catch (e9) { failures = failures + 1; }
                }
            } catch (e10) { failures = failures + 1; }
        }
    } catch (e11) { failures = failures + 1; }

    return { carriers: carriers, failures: failures };
};

IDMCP.handlers.styles_measure = function () {
    var doc = IDMCP.activeDoc();
    var previousUnit = app.scriptPreferences.measurementUnit;
    app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;
    try {
        var out = { docName: String(doc.name), styles: [], paragraphs: [], ranges: [], characterStyles: [], scales: [], paragraphsOffPage: 0 };
        /*
         * Character style usage counter — key: the style's `.id`, value: the
         * number of ranges. Filled in the same pass as out.ranges, so as not
         * to walk all stories a second time.
         *
         * THE KEY IS `.id`, NOT THE NAME (Task 13 review, round 1, item 5):
         * the same trap already found as Critical in the neighboring usage
         * family (`styles/inventory.ts`) — two character styles with the
         * same name would merge into one row by count, and the unused one
         * would disappear behind the used one. `.id` is unique by
         * construction, the name is not.
         */
        var charStyleRunCounts = {};

        var all = doc.allParagraphStyles;
        for (var i = 0; i < all.length; i++) {
            var st = all[i];
            /* `.basedOn` and `.nextStyle` — THE PROPERTIES THEMSELVES, not reading
             * their fields — throw "Invalid request on a root style." for
             * [No Paragraph Style] (measured empirically here for both; the
             * brief documented it only for .basedOn). The guard is here, not
             * inside relatedStyleName/relatedStyleId: their try/catch only
             * wraps String(value.id)/.name — access to the property itself
             * happens BEFORE the call, as the argument. */
            var basedOnValue = null;
            try { basedOnValue = st.basedOn; } catch (eBasedOn) { basedOnValue = null; }
            var nextStyleValue = null;
            try { nextStyleValue = st.nextStyle; } catch (eNextStyle) { nextStyleValue = null; }
            out.styles.push({
                id: String(st.id),
                name: String(st.name),
                path: IDMCP.stylePath(st, doc),
                basedOn: IDMCP.relatedStyleName(basedOnValue),
                basedOnId: IDMCP.relatedStyleId(basedOnValue),
                nextStyle: IDMCP.relatedStyleName(nextStyleValue),
                declared: IDMCP.declaredStyleValues(st)
            });
        }

        var stories = doc.stories;
        for (var s = 0; s < stories.length; s++) {
            var story = stories[s];
            /*
             * INDEX, NOT `story.id` (round 1 review, I-5, fixing the plan's
             * own mistake). `IDMCP.resolveContainer` (_core.jsx) parses
             * "story:N" via `parseIndex` as an INDEX with bounds checking
             * against `doc.stories.length` — the same scheme as in
             * `map.jsx`, `composition.jsx`, `apply.jsx`, `find.jsx`,
             * `inspect.jsx`. Addressing by `.id` would either throw (id
             * larger than the story count) or silently point at a DIFFERENT
             * story. The project has one container addressing scheme —
             * index-based; it was `styles.jsx` that fell out of it, not the
             * rest of the files.
             */
            var containerId = "story:" + s;
            var paras = story.paragraphs;
            for (var p = 0; p < paras.length; p++) {
                var para = paras[p];
                var pageName = null;
                /* isMaster: the same scheme as map.jsx:582 — firstFrame.parent is a
                 * MasterSpread for text placed directly on the parent page.
                 * doc.stories CONTAINS stories from parent-page spreads
                 * (measured: docs/measured-facts-phase4.md — 2998 paragraphs
                 * vs. 2978 non-master), so without this field
                 * detectOverrides.includeMasters filters nothing, and a
                 * parent-page running head, which by construction deviates
                 * from the style, becomes a false finding. */
                var isMasterPara = false;
                try {
                    var frames = para.parentTextFrames;
                    var firstFrame = frames.length > 0 ? frames[0] : null;
                    var sfPage = firstFrame ? IDMCP.parentPageOf(firstFrame) : null;
                    if (sfPage) {
                        pageName = String(sfPage.name);
                    }
                    /* Through the CARRIER: for text on a path, `.parent` is the graphic
                     * owner (Oval/Spline), not a Spread or MasterSpread, so
                     * the raw call silently gave `false` even for text on a
                     * master. The same fix as in `map.jsx`. */
                    var mpCarrier = IDMCP.pageItemOf(firstFrame);
                    isMasterPara = mpCarrier ? IDMCP.isMasterParent(mpCarrier.parent) : false;
                } catch (e) { pageName = null; }
                if (pageName === null) out.paragraphsOffPage++;

                var styleName = "";
                var styleId = "";
                try { styleName = String(para.appliedParagraphStyle.name); } catch (e2) { styleName = ""; }
                /*
                 * `styleId` — the report's key. The name is NOT the key:
                 * measured (docs/measured-facts-phase5.md, Question 6) that
                 * on the actual book two different styles share the same
                 * name — one used, the other not — and counting by name
                 * merges them into one row, which makes the UNUSED style
                 * disappear from the report entirely — i.e. `style-unused`
                 * silently misses exactly the case it exists for. The
                 * `ParagraphMeasure` type will get this field via Task 12;
                 * it's already returned here.
                 *
                 * The fallback on failure is NOT an empty string (round 1
                 * review, M-6): an empty string would itself be a normal
                 * key, and two paragraphs from different failed reads would
                 * merge into one row — exactly the defect this task exists
                 * to fix. Instead, a sentinel built from the paragraph's
                 * address, unique by construction.
                 */
                try { styleId = String(para.appliedParagraphStyle.id); } catch (e3) { styleId = "unresolved:" + containerId + "#" + p; }

                out.paragraphs.push({
                    containerId: containerId,
                    paragraphIndex: p,
                    page: pageName,
                    styleName: styleName,
                    styleId: styleId,
                    isMaster: isMasterPara,
                    declared: IDMCP.declaredStyleValues(para.appliedParagraphStyle),
                    actual: IDMCP.actualStyleValues(para),
                    hasCharacterStyleRuns: IDMCP.hasCharacterStyleRuns(para),
                    preview: String(para.contents).substr(0, 40)
                });

                var h = IDMCP.charPropActual(para, "horizontalScale", IDMCP.propValue);
                var v = IDMCP.charPropActual(para, "verticalScale", IDMCP.propValue);
                if (h !== 100 || v !== 100) {
                    out.scales.push({
                        containerId: containerId,
                        paragraphIndex: p,
                        page: pageName,
                        styleName: styleName,
                        styleId: styleId,
                        horizontalScale: h,
                        verticalScale: v
                    });
                }

                /* The `character` family (Task 13): one entry per EACH textStyleRanges
                 * of the paragraph, regardless of whether a character style
                 * is applied to it or not — the detector checks everything
                 * against the paragraph baseline itself, there is no filter
                 * here on purpose (no `continue` by character style name: a
                 * "bare ranges only" filter would have missed 131 out of 164
                 * scale cases, see character.ts). */
                var runs = para.textStyleRanges;
                for (var r = 0; r < runs.length; r++) {
                    var run = runs[r];
                    var csName = "[None]";
                    try { csName = String(run.appliedCharacterStyle.name); } catch (eC) { csName = "[None]"; }
                    var csId = "none";
                    try { csId = String(run.appliedCharacterStyle.id); } catch (eCid) { csId = "none"; }
                    /* hasOwnProperty, not a bare `|| 0` (review, minor item 3):
                     * `charStyleRunCounts` is a plain object, Object.prototype
                     * is alive in ES3. A character style whose `.id` matches
                     * an inherited name ("constructor", "toString", etc.)
                     * would give NOT 0, but the inherited method itself —
                     * concatenation with a number instead of a count. */
                    charStyleRunCounts[csId] = (charStyleRunCounts.hasOwnProperty(csId) ? charStyleRunCounts[csId] : 0) + 1;
                    out.ranges.push({
                        containerId: containerId,
                        paragraphIndex: p,
                        rangeIndex: r,
                        characterStyle: csName,
                        pointSize: IDMCP.propValue(run.pointSize),
                        appliedFont: IDMCP.anyFontName(run.appliedFont),
                        fontStyle: IDMCP.propValue(run.fontStyle),
                        tracking: IDMCP.propValue(run.tracking),
                        horizontalScale: IDMCP.propValue(run.horizontalScale)
                    });
                }
            }
        }

        /* Character style inventory — the same scheme as for paragraph styles
         * (no filter on index 0): [None] ends up in the list the same way
         * [No Paragraph Style] ends up in the paragraph style list, and
         * character.ts makes the exception for it BY NAME (the sentinel
         * "[None]" was measured to be stable, unlike user style names).
         * Usage, though, is read by `.id` — the comment above
         * charStyleRunCounts explains why. */
        /* Carriers outside the text — a separate pass over the document, not
         * over stories: bullet markers, nested styles, cross-references,
         * table of contents. The explanation and measurement are at
         * IDMCP.characterStyleCarriers above. */
        var carrierScan = IDMCP.characterStyleCarriers(doc);
        out.characterStyleCarrierFailures = carrierScan.failures;

        var allCharStyles = doc.allCharacterStyles;
        for (var cs = 0; cs < allCharStyles.length; cs++) {
            var csStyleObj = allCharStyles[cs];
            var csStyleName = String(csStyleObj.name);
            var csStyleId = "none";
            try { csStyleId = String(csStyleObj.id); } catch (eCsId) { csStyleId = "unresolved:charStyle#" + cs; }
            var referencedBy = [];
            if (carrierScan.carriers.hasOwnProperty(csStyleId)) {
                var found = carrierScan.carriers[csStyleId];
                for (var carrier in found) {
                    if (!found.hasOwnProperty(carrier)) continue;
                    referencedBy.push({ carrier: carrier, count: found[carrier] });
                }
            }
            out.characterStyles.push({
                id: csStyleId,
                name: csStyleName,
                appliedRuns: charStyleRunCounts.hasOwnProperty(csStyleId) ? charStyleRunCounts[csStyleId] : 0,
                referencedBy: referencedBy
            });
        }

        return out;
    } finally {
        app.scriptPreferences.measurementUnit = previousUnit;
    }
};

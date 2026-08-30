/*
 * Handler for color_measure — the SINGLE document walk for all six families
 * of the color_audit tool.
 *
 * READ IN FULL. There is not a single document-property assignment in this file.
 *
 * WHY A WALK, NOT A RULE. Summing four numbers is trivial; the hard part is
 * finding WHERE color lives. MEASURED H14: an obvious loop over fillColor
 * of page items and text ranges reports "clean" and is wrong — it doesn't
 * see masters, paragraph rules, table cells, effect colors, and style
 * definitions. Three probe passes in a row turned out narrower than intended.
 *
 * EVERY property access is in its OWN try/catch: properties throw
 * on objects where they don't exist (graphic.space throws on .ai placed as PDF).
 *
 * (Text surfaces, rules, styles, effects, and gradients are added by pass B.)
 */
IDMCP.colorRef = function (c) {
    var ref = { named: null, model: "unknown", space: "unknown", value: null, kind: "none" };
    if (!c) return ref;

    var ctor = "";
    try { ctor = String(c.constructor.name); } catch (eC) {}
    if (ctor === "Gradient") {
        ref.kind = "gradient";
        try { ref.named = String(c.name) || null; } catch (eG) {}
        return ref;
    }

    var name = null;
    try { name = String(c.name); } catch (eN) { return ref; }
    /* An empty string is an UNNAMED color applied outside a swatch, not a
     * measurement gap: 85 such fills on the working book. */
    ref.named = name === "" ? null : name;
    if (name === "None") return ref;

    ref.kind = "solid";
    try { ref.model = String(c.model).replace("ColorModel.", ""); } catch (eM) {}
    try { ref.space = String(c.space).replace("ColorSpace.", ""); } catch (eS) {}
    try {
        var v = c.colorValue;
        var arr = [];
        for (var i = 0; i < v.length; i++) arr.push(v[i]);
        ref.value = arr;
    } catch (eV) {}
    return ref;
};

/*
 * Tint as a NUMBER or −1.
 *
 * Ruling 7, amendment 3. MEASURED: cellStyle.fillTint returns NOTHING
 * (an ExtendScript enumerator), not a number and not −1. A bare assignment would
 * carry it into totalInk, multiplication would give NaN, and `NaN > threshold`
 * equals false — meaning the finding would disappear SILENTLY. Anything
 * that isn't a number is reduced to −1 ("not set" = 100%).
 */
IDMCP.colorTint = function (owner, prop) {
    try {
        var t = owner[prop];
        if (typeof t === "number" && !isNaN(t)) return t;
    } catch (e) {}
    return -1;
};

/*
 * ALL surfaces the instrument knows about. The list must match the `Surface`
 * type (src/color/types.ts) — that's what tests/unit/color-jsx-guard.test.ts guards.
 */
IDMCP.COLOR_SURFACES = [
    "swatch", "pageItem", "textRange", "paragraphRule", "underline",
    "strikeThrough", "tableCell", "tableStroke", "styleDefinition",
    "effect", "gradientStop", "link"
];

/*
 * Counters are set up UPFRONT, not on first touch.
 *
 * A lazy counter can't say "none": a surface the walker never touched
 * is simply absent from the response, and the reader can't tell "there are
 * no tables in the book" apart from "tables aren't walked at all". On the
 * working book six of twelve surfaces disappeared this way.
 *
 * NOBODY produces `tableStroke`: the instrument doesn't read table strokes
 * (spec §3.2 item 7 requires them, and this is an acknowledged instrument
 * limit, not an oversight). That's exactly why it must still stand in the
 * response with `seen: 0` — an honest zero is what gets reported here;
 * the plan's Self-Review promised this mechanism, and the mechanism wasn't there.
 */
IDMCP.colorInitCounters = function (out) {
    for (var i = 0; i < IDMCP.COLOR_SURFACES.length; i++) {
        out.counters.push({
            surface: IDMCP.COLOR_SURFACES[i], seen: 0, parsed: 0, failed: 0
        });
    }
};

IDMCP.colorCounter = function (out, surface, field) {
    for (var i = 0; i < out.counters.length; i++) {
        if (out.counters[i].surface === surface) {
            out.counters[i][field] += 1;
            return;
        }
    }
    var rec = { surface: surface, seen: 0, parsed: 0, failed: 0 };
    rec[field] = 1;
    out.counters.push(rec);
};

IDMCP.colorSite = function (out, rec) {
    rec.siteId = out.sites.length + 1;
    out.sites.push(rec);
};

/*
 * An item's layer together with its printability and visibility.
 *
 * Without printable, the detector would report eight violations on a
 * correctly built endpaper (H14 §10). Ruling 6 added visible: the working
 * book's `Нумерація` layer has printable=true, visible=false and 6 items —
 * a hidden layer is not printed by default ("Visible & Printable
 * Layers") and doesn't make it into the PDF without being explicitly turned on.
 * These are TWO independent reasons not to print, so the fields can't be
 * merged into one.
 */
IDMCP.colorLayerOf = function (item) {
    var info = { layer: "?", printable: true, visible: true };
    try {
        /* Via the CARRIER: text on a path has no `itemLayer` (measured
         * 2026-08-18), but it DOES have a layer in reality — the one its
         * graphic owner sits on. Without this, the printable/visible gates
         * didn't apply to such text and the verdict came out wider than what prints. */
        var carrier = IDMCP.pageItemOf(item);
        var L = (carrier ? carrier : item).itemLayer;
        info.layer = String(L.name);
        info.printable = L.printable === true;
        info.visible = L.visible === true;
    } catch (eL) {}
    return info;
};

/*
 * A text surface's carrier: the page, master, and LAYER of the frame it sits in.
 *
 * Text, a paragraph rule, and a table cell have no layer of their own — the
 * frame has it. Without this, the printable/visible gates don't apply to them,
 * and the verdict comes out WIDER than what prints: a table on a service layer
 * (196 items of the working book sit on exactly such a layer) would be judged
 * as printed and wouldn't even land in sitesSkippedNonPrinting.
 *
 * `printable: true, visible: true` without a frame is a DELIBERATE "better
 * loud than silent" — the same policy as in `colorLaysInk`: overset text has
 * no frame, and color whose carrier can't be established must be judged, not
 * silently dropped. An error here produces an extra finding; the opposite
 * produces a silent loss.
 */
IDMCP.colorHostOf = function (frame) {
    var host = { page: null, master: null, layer: "?", printable: true, visible: true };
    /* Truthiness, not `===`: on DOM objects the `===` operator sometimes THROWS
     * ("TextFrame.===() cannot work with instances of this class") — measured
     * 2026-08-18, see `IDMCP.resolveContainerPage` in `inspect.jsx`. */
    if (!frame) return host;
    var w = IDMCP.colorPageOf(frame);
    var l = IDMCP.colorLayerOf(frame);
    return { page: w.page, master: w.master, layer: l.layer,
             printable: l.printable, visible: l.visible };
};

/* The first frame from the carrier's `prop` list, or null. Each access throws
 * separately: `parentTextFrames` doesn't exist on Table, `textContainers` — only on Story. */
IDMCP.colorFirstFrame = function (owner, prop) {
    try {
        var fs = owner[prop];
        if (fs && fs.length > 0) return fs[0];
    } catch (eFF) {}
    return null;
};

IDMCP.colorPageOf = function (item) {
    var info = { page: null, master: null };
    try {
        var p = IDMCP.parentPageOf(item);
        if (p) {
            info.page = String(p.name);
            try {
                var par = p.parent;
                if (String(par.constructor.name) === "MasterSpread") {
                    info.master = String(par.name);
                    info.page = null;
                }
            } catch (eM) {}
        }
    } catch (eP) {}
    return info;
};

/*
 * Whether the color lays ink.
 *
 * Ruling 8. MEASURED on the working book: 82 GraphicLine 340.2 × 0 pt and
 * 2 Polygon 0 × 0 pt have a TAC 260 fill and print nothing with it —
 * the line has no interior. Their stroke prints: Black 0.4 pt. Without this
 * field, tac-over-limit would give 84 findings on the working book, and all
 * 84 would be false. The 0.001 pt epsilon is the same one as in Phase 13:
 * comparing InDesign bounds without an epsilon is impossible (the same page
 * gives discrepancies up to 7.3e-12).
 *
 * `return true` in the catch branch is DELIBERATE. When the bounds can't be
 * read, the assumption "ink lays" keeps the finding visible; the opposite
 * would silently swallow it. What can't be measured must be loud, not
 * quietly disappear.
 */
IDMCP.colorLaysInk = function (item, role) {
    if (role === "fill") {
        try {
            var b = item.geometricBounds;
            var h = b[2] - b[0];
            var w = b[3] - b[1];
            if (h < 0) h = -h;
            if (w < 0) w = -w;
            return h > 0.001 && w > 0.001;
        } catch (e) { return true; }
    }
    if (role === "stroke") {
        try {
            var sw = item.strokeWeight;
            if (typeof sw === "number") return sw > 0;
        } catch (e2) {}
        return true;
    }
    return true;
};

IDMCP.handlers.color_measure = function () {
    var doc = IDMCP.activeDoc();
    var out = {
        docName: String(doc.name),
        ms: 0,
        inkCount: 0,
        inkNames: [],
        layers: [],
        sites: [],
        counters: [],
        links: []
    };
    IDMCP.colorInitCounters(out);
    var t0 = new Date().getTime();

    /* --- FILLS AND LAYERS: context without which the verdict is wrong --- */
    try {
        var inks = doc.inks;
        out.inkCount = inks.length;
        for (var ii = 0; ii < inks.length; ii++) {
            try { out.inkNames.push(String(inks[ii].name)); } catch (eIn) {}
        }
    } catch (eInks) {}

    try {
        var lys = doc.layers;
        for (var li = 0; li < lys.length; li++) {
            try {
                out.layers.push({
                    name: String(lys[li].name),
                    printable: lys[li].printable === true,
                    visible: lys[li].visible === true
                });
            } catch (eLy) {}
        }
    } catch (eLys) {}

    /* --- SWATCHES: definitions, not usages --- */
    var sw = doc.swatches;
    for (var si = 0; si < sw.length; si++) {
        IDMCP.colorCounter(out, "swatch", "seen");
        try {
            IDMCP.colorSite(out, {
                surface: "swatch", role: "definition",
                ownerKind: String(sw[si].constructor.name),
                ownerName: String(sw[si].name),
                page: null, master: null, layer: "—",
                printable: true, visible: true, laysInk: true,
                color: IDMCP.colorRef(sw[si]), tint: -1, overprint: null, pointSize: null
            });
            IDMCP.colorCounter(out, "swatch", "parsed");
        } catch (eSw) {
            IDMCP.colorCounter(out, "swatch", "failed");
        }
    }

    /* --- PAGE ITEMS --- */
    IDMCP.colorScanItems(out, doc.allPageItems);

    /*
     * --- MASTERS, A SEPARATE WALK ---
     * doc.allPageItems does NOT include master-spread items. This isn't a guess:
     * measurement H14 §6 showed that three of the four unnamed colors in text
     * and one of the two unnamed swatch duplicates live exactly here. The same
     * breed of trap that Phase 10 already paid for on page.textFrames.
     */
    try {
        var ms = doc.masterSpreads;
        for (var mi = 0; mi < ms.length; mi++) {
            try { IDMCP.colorScanItems(out, ms[mi].allPageItems); } catch (eMs) {}
        }
    } catch (eMss) {}

    /* --- TEXT, STYLES, GRADIENTS, EFFECTS (pass B) --- */
    IDMCP.colorScanStories(out, doc);
    IDMCP.colorScanStyles(out, doc);
    IDMCP.colorScanGradients(out, doc);
    try { IDMCP.colorScanEffects(out, doc.allPageItems); } catch (eFx) {}
    try {
        var msFx = doc.masterSpreads;
        for (var mfi = 0; mfi < msFx.length; mfi++) {
            try { IDMCP.colorScanEffects(out, msFx[mfi].allPageItems); } catch (eMf) {}
        }
    } catch (eMfs) {}

    /* --- PLACED GRAPHICS: an instrument limit, named out loud --- */
    try {
        var gs = doc.allGraphics;
        for (var gi = 0; gi < gs.length; gi++) {
            IDMCP.colorCounter(out, "link", "seen");
            var rec = {
                name: "(embedded)", ownerKind: "?", page: null,
                space: null, profile: null, status: null,
                /* ALWAYS false: the script sees the color space, not the ink on the pixel. */
                inkMeasurable: false
            };
            try { rec.ownerKind = String(gs[gi].constructor.name); } catch (e1) {}
            try { rec.name = String(gs[gi].itemLink.name); } catch (e2) {}
            try { rec.status = String(gs[gi].itemLink.status); } catch (e3) {}
            try { rec.space = String(gs[gi].space); } catch (e4) {}
            try { rec.profile = String(gs[gi].profile); } catch (e5) {}
            try {
                var gp = IDMCP.parentPageOf(gs[gi]);
                if (gp) rec.page = String(gp.name);
            } catch (e6) {}
            out.links.push(rec);
            IDMCP.colorCounter(out, "link", "parsed");
        }
    } catch (eGs) {}

    out.ms = new Date().getTime() - t0;
    return out;
};

/*
 * Walk over the item list. Shared between pages and masters — otherwise the
 * second copy would eventually drift from the first.
 *
 * Ruling 8: laysInk is only computed HERE (surface="pageItem") — a real
 * carrier's fill or stroke can have zero area/weight. All other surfaces
 * (text, styles, effects, gradients, swatches) always lay ink.
 */
IDMCP.colorScanItems = function (out, items) {
    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        IDMCP.colorCounter(out, "pageItem", "seen");
        var where = IDMCP.colorPageOf(it);
        var lay = IDMCP.colorLayerOf(it);
        var parsedAny = false;

        /*
         * Placed graphics (Image, PDF) STRUCTURALLY have no fillColor/
         * strokeColor — those properties belong to the container Rectangle,
         * which this same walk already read as a separate allPageItems item.
         * Accessing fillColor/strokeColor here throws "Object doesn't
         * support this graphic attribute" — MEASURED on the working book:
         * exactly 6 objects (4 Image — placed PSDs on pp. 2, 20, 96, 128;
         * 2 PDF — logo.ai on pp. 3, 196). This is "nothing to read", not
         * "failed to read" — the same category as a Rectangle with
         * fillColor=None, which this code already counts as parsed. We count it
         * immediately as parsed and don't enter the fill/stroke try at all —
         * otherwise the "failed" counter would silently lie about healthy
         * objects in every book with placed graphics.
         */
        var ownerCtor = "";
        try { ownerCtor = String(it.constructor.name); } catch (eCtor) {}
        if (ownerCtor === "Image" || ownerCtor === "PDF") {
            IDMCP.colorCounter(out, "pageItem", "parsed");
            continue;
        }

        try {
            var fill = IDMCP.colorRef(it.fillColor);
            if (fill.kind !== "none") {
                var ft = IDMCP.colorTint(it, "fillTint");
                var ofl = null;
                try { ofl = it.overprintFill === true; } catch (eOf) {}
                IDMCP.colorSite(out, {
                    surface: "pageItem", role: "fill",
                    ownerKind: String(it.constructor.name), ownerName: null,
                    page: where.page, master: where.master,
                    layer: lay.layer, printable: lay.printable, visible: lay.visible,
                    laysInk: IDMCP.colorLaysInk(it, "fill"),
                    color: fill, tint: ft, overprint: ofl, pointSize: null
                });
            }
            parsedAny = true;
        } catch (eF) {}

        try {
            var stroke = IDMCP.colorRef(it.strokeColor);
            if (stroke.kind !== "none") {
                var st = IDMCP.colorTint(it, "strokeTint");
                var ost = null;
                try { ost = it.overprintStroke === true; } catch (eOs) {}
                IDMCP.colorSite(out, {
                    surface: "pageItem", role: "stroke",
                    ownerKind: String(it.constructor.name), ownerName: null,
                    page: where.page, master: where.master,
                    layer: lay.layer, printable: lay.printable, visible: lay.visible,
                    laysInk: IDMCP.colorLaysInk(it, "stroke"),
                    color: stroke, tint: st, overprint: ost, pointSize: null
                });
            }
            parsedAny = true;
        } catch (eS) {}

        IDMCP.colorCounter(out, "pageItem", parsedAny ? "parsed" : "failed");
    }
};

/*
 * Text surfaces. One story gives FOUR different places where color lives, and
 * three of them are invisible to a loop over fillColor:
 *   textStyleRanges.fillColor / strokeColor  — the obvious one;
 *   ruleAboveColor / ruleBelowColor          — ONLY when the rule is turned on;
 *   underlineColor / strikeThroughColor      — likewise, gated by a flag.
 *
 * WHY GATED BY THE FLAG. A rule's color exists on every paragraph regardless
 * of whether the rule is turned on. Reporting it unconditionally would be
 * reporting a setting that doesn't lay on the sheet at all: on the working
 * book ruleAbove is turned on in ZERO paragraphs out of several thousand.
 *
 * Ruling 8: all surfaces here always lay ink (a glyph has area) —
 * laysInk: true everywhere, unlike colorScanItems.
 */
IDMCP.colorScanStories = function (out, doc) {
    var st = doc.stories;
    for (var i = 0; i < st.length; i++) {
        var story = st[i];

        var tsr;
        try { tsr = story.textStyleRanges; } catch (eT) { continue; }
        for (var j = 0; j < tsr.length; j++) {
            var r = tsr[j];
            IDMCP.colorCounter(out, "textRange", "seen");
            var host = IDMCP.colorHostOf(IDMCP.colorFirstFrame(r, "parentTextFrames"));

            var size = null;
            try { size = r.pointSize; } catch (eSz) {}
            var ok = false;

            try {
                var f = IDMCP.colorRef(r.fillColor);
                if (f.kind !== "none") {
                    var ft = IDMCP.colorTint(r, "fillTint");
                    IDMCP.colorSite(out, {
                        surface: "textRange", role: "fill", ownerKind: "Text", ownerName: null,
                        page: host.page, master: host.master,
                        layer: host.layer, printable: host.printable, visible: host.visible,
                        laysInk: true,
                        color: f, tint: ft, overprint: null, pointSize: size
                    });
                }
                ok = true;
            } catch (e2) {}

            try {
                var s = IDMCP.colorRef(r.strokeColor);
                if (s.kind !== "none") {
                    var st2 = IDMCP.colorTint(r, "strokeTint");
                    IDMCP.colorSite(out, {
                        surface: "textRange", role: "stroke", ownerKind: "Text", ownerName: null,
                        page: host.page, master: host.master,
                        layer: host.layer, printable: host.printable, visible: host.visible,
                        laysInk: true,
                        color: s, tint: st2, overprint: null, pointSize: size
                    });
                }
                ok = true;
            } catch (e4) {}

            /*
             * Underline and strikethrough — ONLY when the flag is turned on.
             *
             * TWO nested try blocks, not one: the outer one guards reading the
             * flag itself, the inner one guards reading the color. A single shared
             * catch would raise `failed` even when the flag itself failed to read,
             * i.e. BEFORE `seen` — and a surface with `seen: 0, failed: N` is
             * invisible to unreadSurfaces (`seen > 0 && parsed === 0`) and stays
             * silent about its own blind spot. `failed` now only rises AFTER `seen`.
             */
            try {
                if (r.underline === true) {
                    IDMCP.colorCounter(out, "underline", "seen");
                    try {
                        var uc = IDMCP.colorRef(r.underlineColor);
                        if (uc.kind !== "none") {
                            IDMCP.colorSite(out, {
                                surface: "underline", role: "stroke", ownerKind: "Text",
                                ownerName: null, page: host.page, master: host.master,
                                layer: host.layer, printable: host.printable, visible: host.visible,
                                laysInk: true,
                                color: uc, tint: -1, overprint: null, pointSize: size
                            });
                        }
                        IDMCP.colorCounter(out, "underline", "parsed");
                    } catch (eUc) {
                        IDMCP.colorCounter(out, "underline", "failed");
                    }
                }
            } catch (e5) {}

            try {
                if (r.strikeThru === true) {
                    IDMCP.colorCounter(out, "strikeThrough", "seen");
                    try {
                        var sc = IDMCP.colorRef(r.strikeThroughColor);
                        if (sc.kind !== "none") {
                            IDMCP.colorSite(out, {
                                surface: "strikeThrough", role: "stroke", ownerKind: "Text",
                                ownerName: null, page: host.page, master: host.master,
                                layer: host.layer, printable: host.printable, visible: host.visible,
                                laysInk: true,
                                color: sc, tint: -1, overprint: null, pointSize: size
                            });
                        }
                        IDMCP.colorCounter(out, "strikeThrough", "parsed");
                    } catch (eSc) {
                        IDMCP.colorCounter(out, "strikeThrough", "failed");
                    }
                }
            } catch (e6) {}

            IDMCP.colorCounter(out, "textRange", ok ? "parsed" : "failed");
        }

        /* Paragraph rules. */
        var ps;
        try { ps = story.paragraphs; } catch (eP) { ps = null; }
        if (ps) {
            for (var k = 0; k < ps.length; k++) {
                var p = ps[k];
                var pHost = IDMCP.colorHostOf(IDMCP.colorFirstFrame(p, "parentTextFrames"));

                /* The same two nested try blocks, for the same reason as above:
                 * `failed` has no right to rise before `seen`. */
                try {
                    if (p.ruleAbove === true) {
                        IDMCP.colorCounter(out, "paragraphRule", "seen");
                        try {
                            var ra = IDMCP.colorRef(p.ruleAboveColor);
                            if (ra.kind !== "none") {
                                IDMCP.colorSite(out, {
                                    surface: "paragraphRule", role: "stroke", ownerKind: "Paragraph",
                                    ownerName: "ruleAbove", page: pHost.page, master: pHost.master,
                                    layer: pHost.layer, printable: pHost.printable,
                                    visible: pHost.visible, laysInk: true,
                                    color: ra, tint: -1, overprint: null, pointSize: null
                                });
                            }
                            IDMCP.colorCounter(out, "paragraphRule", "parsed");
                        } catch (eRa) {
                            IDMCP.colorCounter(out, "paragraphRule", "failed");
                        }
                    }
                } catch (e8) {}

                try {
                    if (p.ruleBelow === true) {
                        IDMCP.colorCounter(out, "paragraphRule", "seen");
                        try {
                            var rb = IDMCP.colorRef(p.ruleBelowColor);
                            if (rb.kind !== "none") {
                                IDMCP.colorSite(out, {
                                    surface: "paragraphRule", role: "stroke", ownerKind: "Paragraph",
                                    ownerName: "ruleBelow", page: pHost.page, master: pHost.master,
                                    layer: pHost.layer, printable: pHost.printable,
                                    visible: pHost.visible, laysInk: true,
                                    color: rb, tint: -1, overprint: null, pointSize: null
                                });
                            }
                            IDMCP.colorCounter(out, "paragraphRule", "parsed");
                        } catch (eRb) {
                            IDMCP.colorCounter(out, "paragraphRule", "failed");
                        }
                    }
                } catch (e9) {}
            }
        }

        /*
         * Tables.
         *
         * The carrier is taken THE SAME WAY as for text and paragraph rules.
         * As long as a cell was hard-coded as being born with
         * `layer: "?", printable: true, visible: true`, a table on a service
         * layer would be judged as printed and wouldn't even land in
         * sitesSkippedNonPrinting — exactly the defect the gates are written
         * against. We look for the frame first on the table itself, then in
         * the story's containers: Table may not have `parentTextFrames`.
         */
        var tbs;
        try { tbs = story.tables; } catch (eTb) { tbs = null; }
        if (tbs) {
            var storyFrame = IDMCP.colorFirstFrame(story, "textContainers");
            for (var t = 0; t < tbs.length; t++) {
                var cells;
                try { cells = tbs[t].cells; } catch (eCs) { continue; }
                var tFrame = IDMCP.colorFirstFrame(tbs[t], "parentTextFrames");
                if (!tFrame) tFrame = storyFrame;
                var tHost = IDMCP.colorHostOf(tFrame);
                for (var c = 0; c < cells.length; c++) {
                    IDMCP.colorCounter(out, "tableCell", "seen");
                    try {
                        var cf = IDMCP.colorRef(cells[c].fillColor);
                        if (cf.kind !== "none") {
                            var cft = IDMCP.colorTint(cells[c], "fillTint");
                            IDMCP.colorSite(out, {
                                surface: "tableCell", role: "fill", ownerKind: "Cell",
                                ownerName: null, page: tHost.page, master: tHost.master,
                                layer: tHost.layer, printable: tHost.printable,
                                visible: tHost.visible,
                                laysInk: true,
                                color: cf, tint: cft, overprint: null, pointSize: null
                            });
                        }
                        IDMCP.colorCounter(out, "tableCell", "parsed");
                    } catch (e11) {
                        IDMCP.colorCounter(out, "tableCell", "failed");
                    }
                }
            }
        }
    }
};

/*
 * Style definitions. Color in a style has neither a page nor a layer — it
 * lives in the DEFINITION and lays wherever the style is used. That's why
 * printable/visible/laysInk are always true here: a style can't be unprinted,
 * hidden, or inkless — that's a property of usage, not of the definition.
 *
 * Ruling 7, amendments 1–2: TableStyle and CellStyle property names were
 * taken from a live probe, not guessed from the documentation.
 *   TableStyle does NOT have bodyRegionFillColor/headerRegionFillColor — they
 *   simply don't exist in the DOM; a bare read would silently give nothing, and
 *   styleDefinition would look "clean" even though the table style had a black
 *   row fill.
 *   CellStyle does NOT have strokeColor (only four EdgeStrokeColor); fillColor
 *   can be null (that's normal, colorRef(null) gives kind:"none").
 */
IDMCP.colorScanStyles = function (out, doc) {
    var groups = [
        { list: doc.allParagraphStyles, kind: "ParagraphStyle",
          props: ["fillColor", "strokeColor", "ruleAboveColor", "ruleBelowColor",
                  "underlineColor", "strikeThroughColor"] },
        { list: doc.allCharacterStyles, kind: "CharacterStyle",
          props: ["fillColor", "strokeColor", "underlineColor", "strikeThroughColor"] },
        { list: doc.allObjectStyles, kind: "ObjectStyle",
          props: ["fillColor", "strokeColor"] },
        { list: doc.allCellStyles, kind: "CellStyle",
          props: ["fillColor", "topEdgeStrokeColor", "bottomEdgeStrokeColor",
                  "leftEdgeStrokeColor", "rightEdgeStrokeColor"] },
        { list: doc.allTableStyles, kind: "TableStyle",
          props: ["topBorderStrokeColor", "bottomBorderStrokeColor",
                  "leftBorderStrokeColor", "rightBorderStrokeColor",
                  "startRowFillColor", "endRowFillColor",
                  "startColumnFillColor", "endColumnFillColor"] }
    ];

    for (var g = 0; g < groups.length; g++) {
        var list;
        try { list = groups[g].list; } catch (eL) { continue; }
        if (!list) continue;
        for (var i = 0; i < list.length; i++) {
            IDMCP.colorCounter(out, "styleDefinition", "seen");
            var parsed = false;
            var nm = "?";
            try { nm = String(list[i].name); } catch (eN) {}
            var size = null;
            try { size = list[i].pointSize; } catch (eSz) {}
            for (var p = 0; p < groups[g].props.length; p++) {
                try {
                    var ref = IDMCP.colorRef(list[i][groups[g].props[p]]);
                    if (ref.kind !== "none") {
                        IDMCP.colorSite(out, {
                            surface: "styleDefinition", role: "definition",
                            ownerKind: groups[g].kind,
                            ownerName: nm + " · " + groups[g].props[p],
                            page: null, master: null, layer: "—",
                            printable: true, visible: true, laysInk: true,
                            color: ref, tint: -1, overprint: null,
                            /* The style's point size is needed for the black family: rich black,
                             * specified IN THE STYLE, lays on every one of its usages. */
                            pointSize: (typeof size === "number") ? size : null
                        });
                    }
                    parsed = true;
                } catch (eP) {}
            }
            IDMCP.colorCounter(out, "styleDefinition", parsed ? "parsed" : "failed");
        }
    }
};

/*
 * Shadow colors.
 *
 * Ruling 9. MEASURED, and each of the three would have cost a silent bug:
 *  1. String(mode) returns "NONE", not "ShadowMode.NONE" — comparing against
 *     the string NEVER works, and an effect tuple would be born for
 *     every object (1128 phantoms on the working book). Compare against the
 *     enum value ShadowMode.NONE, not the string.
 *  2. innerShadow/outerGlow/innerGlow THROW on access, even though
 *     reflect.properties lists them: reflection describes the DOM's schema, not
 *     accessibility. Only one family with color remains — dropShadow.
 *  3. The effect lives on FOUR carriers (object, fill, stroke, content).
 *     A shadow cast only on the fill is invisible to a walk over
 *     transparencySettings.
 *
 * laysInk: true always — the shadow is drawn AROUND the object and has its own
 * area regardless of whether the carrier itself has area (Ruling 8).
 */
IDMCP.colorScanEffects = function (out, items) {
    var carriers = ["transparencySettings", "fillTransparencySettings",
                    "strokeTransparencySettings", "contentTransparencySettings"];
    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var where = IDMCP.colorPageOf(it);
        var lay = IDMCP.colorLayerOf(it);
        for (var c = 0; c < carriers.length; c++) {
            /*
             * `seen` rises BEFORE any exit, and counts the CARRIERS that were
             * read — exactly what Ruling 9's mitigation promised. As long as it
             * stood after the ShadowMode.NONE check, it counted only
             * actual shadows, and a failed read gave `failed` WITHOUT `seen` —
             * a state invisible to unreadSurfaces (`seen > 0 && parsed === 0`).
             *
             * A carrier with no shadow counts as `parsed`: it WAS READ, and the
             * read said "there's no shadow". That's the same category as a
             * Rectangle with fillColor=None in colorScanItems — "nothing to
             * read", not "failed to read". Otherwise a document with no shadow at
             * all (i.e. almost every one) would report the `effect` surface as
             * unread.
             */
            IDMCP.colorCounter(out, "effect", "seen");
            var fx;
            try {
                fx = it[carriers[c]].dropShadowSettings;
            } catch (eC) {
                IDMCP.colorCounter(out, "effect", "failed");
                continue;
            }
            try {
                if (fx.mode === ShadowMode.NONE) {
                    IDMCP.colorCounter(out, "effect", "parsed");
                    continue;
                }
                var ref = IDMCP.colorRef(fx.effectColor);
                if (ref.kind !== "none") {
                    IDMCP.colorSite(out, {
                        surface: "effect", role: "effect",
                        ownerKind: String(it.constructor.name),
                        ownerName: carriers[c] + ".dropShadow",
                        page: where.page, master: where.master,
                        layer: lay.layer, printable: lay.printable, visible: lay.visible,
                        laysInk: true,
                        color: ref, tint: -1, overprint: null, pointSize: null
                    });
                }
                IDMCP.colorCounter(out, "effect", "parsed");
            } catch (eK) {
                IDMCP.colorCounter(out, "effect", "failed");
            }
        }
    }
};

/*
 * Gradient stops: the gradient itself has no color, its stops do.
 * laysInk: true — a gradient definition, like a swatch, has no geometry.
 */
IDMCP.colorScanGradients = function (out, doc) {
    var gr;
    try { gr = doc.gradients; } catch (eG) { return; }
    for (var i = 0; i < gr.length; i++) {
        var stops;
        try { stops = gr[i].gradientStops; } catch (eS) { continue; }
        var nm = "?";
        try { nm = String(gr[i].name); } catch (eN) {}
        for (var s = 0; s < stops.length; s++) {
            IDMCP.colorCounter(out, "gradientStop", "seen");
            try {
                var ref = IDMCP.colorRef(stops[s].stopColor);
                if (ref.kind !== "none") {
                    IDMCP.colorSite(out, {
                        surface: "gradientStop", role: "stop", ownerKind: "GradientStop",
                        ownerName: nm, page: null, master: null,
                        layer: "—", printable: true, visible: true, laysInk: true,
                        color: ref, tint: -1, overprint: null, pointSize: null
                    });
                }
                IDMCP.colorCounter(out, "gradientStop", "parsed");
            } catch (eR) {
                IDMCP.colorCounter(out, "gradientStop", "failed");
            }
        }
    }
};

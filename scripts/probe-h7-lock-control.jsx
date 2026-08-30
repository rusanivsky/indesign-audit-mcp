/*
 * КОНТРОЛЬ до Питання 19: чи справді замок накладено.
 * Якщо `range.contents` проходить при `frame.locked === true`, є дві гіпотези:
 * (1) замок не наклався; (2) замок наклався, але текстовий запис його не
 * стосується. Розрізняє їх ГЕОМЕТРІЯ: посунути замкнену рамку InDesign не дає.
 */
var doc = app.documents.add();
var out = { cases: [] };

try {
    doc.documentPreferences.pagesPerDocument = 2;
    app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;

    var openLayer = doc.layers.item(0);
    openLayer.name = "L_open";
    var lockLayer = doc.layers.add();
    lockLayer.name = "L_locked";

    var plan = [
        { id: "A", layer: "open", frameLock: false },
        { id: "B", layer: "open", frameLock: true },
        { id: "C", layer: "locked", frameLock: false },
        { id: "D", layer: "locked", frameLock: true }
    ];
    var built = [];
    var i;
    for (i = 0; i < plan.length; i++) {
        var pg = doc.pages[0];
        var b = pg.bounds;
        var y1 = b[0] + 40 + i * 40;
        var x1 = b[1] + 40;
        var f = pg.textFrames.add();
        f.geometricBounds = [y1, x1, y1 + 24, x1 + 120];
        f.itemLayer = (plan[i].layer === "locked") ? lockLayer : openLayer;
        f.contents = "42";
        built.push({ spec: plan[i], frame: f, y1: y1, x1: x1 });
    }
    lockLayer.locked = true;
    for (i = 0; i < built.length; i++) {
        if (built[i].spec.frameLock) built[i].frame.locked = true;
    }

    for (i = 0; i < built.length; i++) {
        var frame = built[i].frame;
        var spec = built[i].spec;
        var lockedNow = frame.locked === true;
        var layerLockedNow = frame.itemLayer.locked === true;

        /* КОНТРОЛЬ 1: геометрія. */
        var gBefore = frame.geometricBounds;
        var gThrew = null;
        try {
            frame.geometricBounds = [gBefore[0] + 10, gBefore[1] + 10, gBefore[2] + 10, gBefore[3] + 10];
        } catch (eG) { gThrew = String(eG.message); }
        var gAfter = frame.geometricBounds;
        var gMoved = (String(gAfter[0]) !== String(gBefore[0]));

        /* КОНТРОЛЬ 2: видалення. */
        var dThrew = null;
        var dGone = false;
        try {
            frame.remove();
        } catch (eD) { dThrew = String(eD.message); }
        try { dGone = !(frame.isValid === true); } catch (eV) { dGone = true; }

        out.cases.push({
            id: spec.id,
            frameLocked: lockedNow,
            layerLocked: layerLockedNow,
            geometryThrew: gThrew,
            geometryMoved: gMoved,
            removeThrew: dThrew,
            removed: dGone
        });
    }
} finally {
    doc.close(SaveOptions.NO);
}

out.docsOpen = app.documents.length;
__result = out;

/* Домір resolve() — Задача 1 Фази 13. ЛИШЕ ЧИТАННЯ.
 * Питання: що означає ДРУГЕ число пари, яку віддає resolve(). */
var DOC_NAME = "Book 260811-1645.indd";
var prev = app.scriptPreferences.measurementUnit;
app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;
var out = { rows: [], zeroPoint: null, rulerOrigin: null };
try {
    var doc = app.documents.itemByName(DOC_NAME);
    if (!doc.isValid) throw new Error("Документ не відкрито.");
    out.zeroPoint = [doc.zeroPoint[0], doc.zeroPoint[1]];
    out.rulerOrigin = String(doc.viewPreferences.rulerOrigin);
    var pages = ["8", "9", "96", "97"];
    for (var i = 0; i < pages.length; i++) {
        var p = doc.pages.itemByName(pages[i]);
        var items = p.allPageItems;
        for (var k = 0; k < items.length && k < 3; k++) {
            var it = items[k];
            try {
                var b = it.geometricBounds;               /* [y1, x1, y2, x2] */
                var rp = it.resolve(AnchorPoint.TOP_LEFT_ANCHOR, CoordinateSpaces.PAGE_COORDINATES);
                var rs = it.resolve(AnchorPoint.TOP_LEFT_ANCHOR, CoordinateSpaces.SPREAD_COORDINATES);
                var rb = it.resolve(AnchorPoint.BOTTOM_RIGHT_ANCHOR, CoordinateSpaces.PAGE_COORDINATES);
                out.rows.push({
                    pg: String(p.name), side: String(p.side), t: String(it.constructor.name),
                    geomTopLeft: [b[1], b[0]],            /* [x, y] — щоб порівнювати однаково */
                    geomBottomRight: [b[3], b[2]],
                    resolvePageTopLeft: [rp[0][0], rp[0][1]],
                    resolvePageBottomRight: [rb[0][0], rb[0][1]],
                    resolveSpreadTopLeft: [rs[0][0], rs[0][1]]
                });
            } catch (e2) {
                out.rows.push({
                    pg: String(p.name), side: String(p.side), t: String(it.constructor.name),
                    resolveError: String(e2)
                });
            }
        }
    }
} catch (e) { out.fatal = String(e); }
finally { app.scriptPreferences.measurementUnit = prev; }
__result = out;

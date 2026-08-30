/* Зонд H13, прохід 3 — СИСТЕМА КООРДИНАТ. ЛИШЕ ЧИТАННЯ.
 *
 * Навіщо. Прохід 2 дав абсурд: 545 із 546 елементів на recto «за полосою
 * набору». Абсурд у ПРИЛАДІ, а не в книжці — правило Фази 7: розбіжність,
 * що суперечить очевидному, це підозра до приладу.
 *
 * Гіпотеза: `page.bounds` віддає координати РОЗВОРОТУ (recto починається з
 * x = 538.58), а `geometricBounds` елемента — координати від початку ЙОГО
 * сторінки, бо `rulerOrigin = PAGE_ORIGIN`. Змішування двох просторів дає
 * рівно таку картину.
 *
 * Цей прохід НІЧОГО не класифікує. Він друкує сирі числа двох сторінок —
 * однієї verso й однієї recto — щоб простір було ВИДНО, а не виведено.
 * Заразом міряє, чи змінює `rulerOrigin` показання `geometricBounds`:
 * якщо ні, простір елементів не залежить від налаштування перегляду і
 * правило можна писати без нього.
 */

var DOC_NAME = "Book 260811-1645.indd";
var SAMPLE_PAGES = ["8", "9", "96", "97"]; /* дві пари verso/recto */

var previousUnit = app.scriptPreferences.measurementUnit;
app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;

var out = { notes: [], threw: [], pages: [] };
function threw(w, e) { out.threw.push(w + ": " + String(e)); }

try {
    var doc = app.documents.itemByName(DOC_NAME);
    if (!doc.isValid) throw new Error("Документ не відкрито.");
    out.modifiedBefore = doc.modified;
    out.rulerOrigin = String(doc.viewPreferences.rulerOrigin);

    for (var i = 0; i < SAMPLE_PAGES.length; i++) {
        var p = doc.pages.itemByName(SAMPLE_PAGES[i]);
        if (!p.isValid) { threw("page " + SAMPLE_PAGES[i], "невалідна"); continue; }
        var mp = p.marginPreferences;
        var rec = {
            name: String(p.name),
            side: String(p.side),
            bounds: [p.bounds[0], p.bounds[1], p.bounds[2], p.bounds[3]],
            margins: { top: mp.top, left: mp.left, bottom: mp.bottom, right: mp.right,
                       columnCount: mp.columnCount, columnGutter: mp.columnGutter },
            spreadIndex: p.parent.index,
            indexInSpread: -1,
            items: []
        };
        try {
            var sp = p.parent.pages.everyItem().getElements();
            for (var s = 0; s < sp.length; s++) if (sp[s].id === p.id) rec.indexInSpread = s;
        } catch (e0) { threw("indexInSpread", e0); }

        var items = p.allPageItems;
        for (var k = 0; k < items.length && k < 14; k++) {
            var it = items[k];
            var r = {};
            try { r.t = String(it.constructor.name); } catch (e1) { r.t = "?"; }
            try { r.pk = String(it.parent.constructor.name); } catch (e2) { r.pk = "?"; }
            try { var b = it.geometricBounds; r.b = [b[0], b[1], b[2], b[3]]; } catch (e3) { r.bThrew = String(e3); }
            try { r.rot = it.rotationAngle; } catch (e4) { r.rot = null; }
            try { r.lay = String(it.itemLayer.name); r.print = it.itemLayer.printable; } catch (e5) { r.lay = null; }
            /* Незалежний вимір того самого положення ІНШИМ приладом:
             * resolve() у координатах розвороту. Якщо два прилади дають різні
             * числа — простір справді не той, що здається. */
            try {
                var anchor = it.resolve([[AnchorPoint.TOP_LEFT_ANCHOR], CoordinateSpaces.SPREAD_COORDINATES])[0];
                r.spreadTopLeft = [anchor[0], anchor[1]];
            } catch (e6) { r.resolveThrew = String(e6); }
            try {
                var pAnchor = it.resolve([[AnchorPoint.TOP_LEFT_ANCHOR], CoordinateSpaces.PAGE_COORDINATES])[0];
                r.pageTopLeft = [pAnchor[0], pAnchor[1]];
            } catch (e7) { r.resolvePageThrew = String(e7); }
            try { if (it.texts.length > 0) r.text = String(it.texts[0].contents).substr(0, 24); } catch (e8) { /* нема */ }
            rec.items.push(r);
        }
        rec.itemCount = items.length;
        out.pages.push(rec);
    }

    out.modifiedAfter = doc.modified;
} catch (fatal) {
    out.fatal = String(fatal) + (fatal.line ? (" (рядок " + fatal.line + ")") : "");
} finally {
    app.scriptPreferences.measurementUnit = previousUnit;
}

__result = out;

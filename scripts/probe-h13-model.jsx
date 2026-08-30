/* Зонд H13, прохід 4 — ПРАВИЛЬНА МОДЕЛЬ. ЛИШЕ ЧИТАННЯ.
 *
 * Прохід 3 виміряв головне: `geometricBounds` віддає координати ВЛАСНОЇ
 * СТОРІНКИ елемента, а `page.bounds` — координати РОЗВОРОТУ. Тобто полосу
 * набору треба будувати від (0,0), а не від `page.bounds`. Цей прохід
 * перебудовує класифікацію на цій моделі й доміряє те, що прохід 2 залишив
 * без відповіді.
 *
 * ПИТАННЯ:
 *  13. Що таке 303 прив'язані об'єкти — за стилем абзацу, шаром, розміром.
 *      Родина `anchored` існує заради них, а журнал верстки називає 185.
 *  14. Чи є прилад, НЕЗАЛЕЖНИЙ від rulerOrigin — `resolve()` з явним
 *      CoordinateSpaces. Якщо є, правило не залежить від налаштування
 *      перегляду, яке користувач може змінити мишею.
 *  15. Стан шару `_folio-helper` у робочій книжці. Точка входу вважає, що
 *      операцію Фази 7 до книжки ще НЕ застосовано.
 *  16. Що таке 91 повернений елемент (для них geometricBounds безглуздий).
 *  17. Класифікація проти полоси на ПРАВИЛЬНІЙ моделі, з розкладкою за
 *      величиною виходу — чи лишається сигнал після виправлення приладу.
 */

var DOC_NAME = "Book 260811-1645.indd";

var previousUnit = app.scriptPreferences.measurementUnit;
app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;

var out = { notes: [], threw: [], q13: {}, q14: {}, q15: {}, q16: {}, q17: {} };
function threw(w, e) { if (out.threw.length < 30) out.threw.push(w + ": " + String(e)); }

try {
    var doc = app.documents.itemByName(DOC_NAME);
    if (!doc.isValid) throw new Error("Документ не відкрито.");
    out.modifiedBefore = doc.modified;
    out.rulerOrigin = String(doc.viewPreferences.rulerOrigin);
    out.zeroPoint = [doc.zeroPoint[0], doc.zeroPoint[1]];

    /* --- Питання 15: шар _folio-helper ---------------------------------- */
    var layerNames = [];
    var layers = doc.layers.everyItem().getElements();
    for (var L = 0; L < layers.length; L++) {
        layerNames.push({ name: String(layers[L].name), visible: layers[L].visible,
                          printable: layers[L].printable, locked: layers[L].locked });
    }
    out.q15.layers = layerNames;

    var pages = doc.pages.everyItem().getElements();

    var anchoredByStyle = {}, anchoredByLayer = {}, anchoredSizes = {};
    var rotatedByType = {}, rotatedAngles = {};
    var helperFrames = 0, helperStoryIds = {};
    var outBuckets = { "≤0.01": 0, "≤0.1": 0, "≤1": 0, "≤3": 0, "≤10": 0, ">10": 0 };
    var outByType = {}, insideCount = 0, totalClassified = 0;
    var offPageBuckets = { "≤0.01": 0, "≤0.1": 0, "≤1": 0, "≤3": 0, "≤10": 0, ">10": 0 };
    var resolveOk = 0, resolveMismatch = 0, resolveSample = [];

    for (var i = 0; i < pages.length; i++) {
        var p = pages[i];
        var mp = p.marginPreferences;
        var side = String(p.side);
        var pw = doc.documentPreferences.pageWidth, ph = doc.documentPreferences.pageHeight;

        /* Полоса набору В КООРДИНАТАХ СТОРІНКИ. Для розворотної верстки
         * InDesign тримає left/right ЯК inside/outside: на verso їх треба
         * поміняти місцями. Перевіряється числом нижче, не вірою. */
        var mLeft = (side === "LEFT_HAND") ? mp.right : mp.left;
        var mRight = (side === "LEFT_HAND") ? mp.left : mp.right;
        var area = { y1: mp.top, x1: mLeft, y2: ph - mp.bottom, x2: pw - mRight };

        var items = p.allPageItems;
        for (var k = 0; k < items.length; k++) {
            var it = items[k];
            var tn = "?", pk = "?", b = null;
            try { tn = String(it.constructor.name); } catch (e1) {}
            try { pk = String(it.parent.constructor.name); } catch (e2) {}
            try { var bb = it.geometricBounds; b = [bb[0], bb[1], bb[2], bb[3]]; } catch (e3) { continue; }

            var layName = null;
            try { layName = String(it.itemLayer.name); } catch (e4) {}

            /* --- Питання 15 --- */
            if (layName === "_folio-helper") {
                helperFrames++;
                try { helperStoryIds[String(it.parentStory.id)] = (helperStoryIds[String(it.parentStory.id)] || 0) + 1; }
                catch (e5) { threw("parentStory", e5); }
            }

            /* --- Питання 13 --- */
            if (pk === "Character" || pk === "InsertionPoint" || pk === "Text" ||
                pk === "Story" || pk === "Paragraph" || pk === "Word") {
                var st = "(не текст)";
                try {
                    if (it.texts && it.texts.length > 0 && it.paragraphs.length > 0) {
                        st = String(it.paragraphs[0].appliedParagraphStyle.name);
                    }
                } catch (e6) { st = "(кинуло)"; }
                anchoredByStyle[st] = (anchoredByStyle[st] || 0) + 1;
                anchoredByLayer[String(layName)] = (anchoredByLayer[String(layName)] || 0) + 1;
                var sz = (Math.round((b[3] - b[1]) * 10) / 10) + "×" + (Math.round((b[2] - b[0]) * 10) / 10);
                anchoredSizes[sz] = (anchoredSizes[sz] || 0) + 1;
            }

            /* --- Питання 16 --- */
            var rot = 0;
            try { rot = it.rotationAngle; } catch (e7) {}
            if (rot !== 0) {
                rotatedByType[tn] = (rotatedByType[tn] || 0) + 1;
                rotatedAngles[String(rot)] = (rotatedAngles[String(rot)] || 0) + 1;
            }

            /* --- Питання 14: незалежний від rulerOrigin прилад ------------ */
            if (resolveSample.length < 5) {
                try {
                    var r = it.resolve([AnchorPoint.TOP_LEFT_ANCHOR], CoordinateSpaces.PAGE_COORDINATES);
                    resolveOk++;
                    var rx = r[0][0], ry = r[0][1];
                    var agrees = (Math.abs(rx - b[1]) < 0.01) && (Math.abs(ry - b[0]) < 0.01);
                    if (!agrees) resolveMismatch++;
                    resolveSample.push({ t: tn, pg: String(p.name), geom: [b[0], b[1]],
                                         resolved: [ry, rx], agrees: agrees });
                } catch (e8) { threw("resolve", e8); }
            }

            /* --- Питання 17 --- */
            totalClassified++;
            var dTop = area.y1 - b[0], dLeft = area.x1 - b[1];
            var dBot = b[2] - area.y2, dRight = b[3] - area.x2;
            var maxOut = Math.max(dTop, Math.max(dLeft, Math.max(dBot, dRight)));
            if (maxOut <= 0.001) { insideCount++; }
            else {
                if (maxOut <= 0.01) outBuckets["≤0.01"]++;
                else if (maxOut <= 0.1) outBuckets["≤0.1"]++;
                else if (maxOut <= 1) outBuckets["≤1"]++;
                else if (maxOut <= 3) outBuckets["≤3"]++;
                else if (maxOut <= 10) outBuckets["≤10"]++;
                else outBuckets[">10"]++;
                outByType[tn] = (outByType[tn] || 0) + 1;
            }
            var offMax = Math.max(-b[0], Math.max(-b[1], Math.max(b[2] - ph, b[3] - pw)));
            if (offMax > 0.001) {
                if (offMax <= 0.01) offPageBuckets["≤0.01"]++;
                else if (offMax <= 0.1) offPageBuckets["≤0.1"]++;
                else if (offMax <= 1) offPageBuckets["≤1"]++;
                else if (offMax <= 3) offPageBuckets["≤3"]++;
                else if (offMax <= 10) offPageBuckets["≤10"]++;
                else offPageBuckets[">10"]++;
            }
        }
    }

    out.q13 = { byStyle: anchoredByStyle, byLayer: anchoredByLayer, sizes: anchoredSizes };
    out.q14 = { resolveOk: resolveOk, mismatch: resolveMismatch, sample: resolveSample };
    out.q15.helperFrames = helperFrames;
    out.q15.helperStories = helperStoryIds;
    out.q16 = { byType: rotatedByType, angles: rotatedAngles };
    out.q17 = { totalClassified: totalClassified, inside: insideCount,
                outBuckets: outBuckets, outByType: outByType, offPageBuckets: offPageBuckets };

    out.modifiedAfter = doc.modified;
} catch (fatal) {
    out.fatal = String(fatal) + (fatal.line ? (" (рядок " + fatal.line + ")") : "");
} finally {
    app.scriptPreferences.measurementUnit = previousUnit;
}

__result = out;

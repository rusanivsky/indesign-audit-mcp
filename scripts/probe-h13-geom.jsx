/* Зонд H13, прохід 2 — ГЕОМЕТРІЯ (Фаза 13, блок D).
 *
 * ЛИШЕ ЧИТАННЯ. Ті самі гарантії, що в проході 1: жодного add()/remove()/
 * override()/save()/close(), єдине присвоєння — одиниці ЗАСТОСУНКУ, з
 * відновленням у finally, `doc.modified` до й після.
 *
 * ЩО ЗМІНИЛОСЬ ПРОТИ ПРОХОДУ 1, І ЧОМУ ЦЕ ГОЛОВНЕ. Прохід 1 ходив
 * `doc.pageItems.everyItem()` — 780 елементів. Посторінковий `allPageItems`
 * дає 965 у документній частині, а прив'язаних об'єктів у книжці, за
 * журналом верстки, 185. Тобто перший прилад НЕ БАЧИВ ні вмісту груп, ні
 * прив'язаних. Цей прохід ходить `page.allPageItems` і перевіряє це числом.
 *
 * ПИТАННЯ:
 *  8.  Скільки елементів бачить правильний прилад, і скільки з них
 *      прив'язані / у групах / повернені.
 *  9.  Обтікання правильним приладом — чи справді в книжці нуль.
 *  10. Полоса набору: чи дзеркаляться поля (inside/outside) на verso й recto,
 *      чи стоять літерально ліворуч/праворуч. Вирішується виміром положення
 *      рамок, а не читанням назви властивості.
 *  11. Скільки рамок виходить за полосу набору, за обріз, за виліт — і
 *      скільки з цього СВІДОМЕ (повнополосні плашки).
 *  12. Перетини й дотики: скільки пар елементів на сторінці перетинаються, і
 *      яка величина перетину. Сім сторінок дотику з Фази 8 мають знайтись.
 */

var DOC_NAME = "Book 260811-1645.indd";

var previousUnit = app.scriptPreferences.measurementUnit;
app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;

var out = { app: { version: String(app.version) }, notes: [], threw: [], items: [] };
function say(s) { out.notes.push(String(s)); }
function threw(where, e) { if (out.threw.length < 40) out.threw.push(where + ": " + String(e)); }

try {
    var doc = app.documents.itemByName(DOC_NAME);
    if (!doc.isValid) throw new Error("Документ «" + DOC_NAME + "» не відкрито.");
    out.modifiedBefore = doc.modified;

    var pages = doc.pages.everyItem().getElements();
    var t0 = new Date().getTime();

    var stats = {
        total: 0, byType: {}, byParentKind: {}, anchored: 0, inGroup: 0,
        rotated: 0, wrapNonNone: 0, wrapModes: {}, invisibleLayer: 0,
        nonPrintingLayer: 0, locked: 0, boundsThrew: 0
    };

    for (var i = 0; i < pages.length; i++) {
        var p = pages[i];
        var pb;
        try { pb = p.bounds; } catch (eB) { threw("page.bounds", eB); continue; }
        var mp = p.marginPreferences;
        var side = String(p.side); /* LEFT_HAND / RIGHT_HAND / SINGLE_SIDED */

        /* Полоса набору в КООРДИНАТАХ РОЗВОРОТУ — те саме простір, що й
         * geometricBounds елементів. Питання 10 саме про те, чи `left`
         * означає «ліворуч» чи «зсередини». Обидва варіанти рахуються, і
         * далі порівнюються з фактом. */
        var literal = {
            y1: pb[0] + mp.top, x1: pb[1] + mp.left,
            y2: pb[2] - mp.bottom, x2: pb[3] - mp.right
        };
        var mirrored = (String(side) === "LEFT_HAND")
            ? { y1: pb[0] + mp.top, x1: pb[1] + mp.right, y2: pb[2] - mp.bottom, x2: pb[3] - mp.left }
            : literal;

        var items;
        try { items = p.allPageItems; } catch (eA) { threw("page.allPageItems", eA); continue; }

        var pageRecs = [];
        for (var k = 0; k < items.length; k++) {
            var it = items[k];
            var rec = { pg: String(p.name), side: side };
            stats.total++;

            try { rec.t = String(it.constructor.name); } catch (e1) { rec.t = "?"; }
            stats.byType[rec.t] = (stats.byType[rec.t] || 0) + 1;

            var pk = "?";
            try { pk = String(it.parent.constructor.name); } catch (e2) { threw("parent", e2); }
            rec.pk = pk;
            stats.byParentKind[pk] = (stats.byParentKind[pk] || 0) + 1;
            if (pk === "Character" || pk === "InsertionPoint" || pk === "Text" ||
                pk === "Story" || pk === "Paragraph" || pk === "Word") {
                rec.anchored = true; stats.anchored++;
            }
            if (pk === "Group") { rec.inGroup = true; stats.inGroup++; }

            try {
                var b = it.geometricBounds;
                rec.b = [b[0], b[1], b[2], b[3]];
            } catch (e3) { stats.boundsThrew++; threw("geometricBounds[" + rec.t + "]", e3); }

            try { rec.vb = null; var vb = it.visibleBounds; rec.vb = [vb[0], vb[1], vb[2], vb[3]]; }
            catch (e4) { /* мовчки: не в кожного типу є */ }

            try { rec.rot = it.rotationAngle; if (rec.rot !== 0) stats.rotated++; }
            catch (e5) { rec.rot = null; }

            try {
                var wm = String(it.textWrapPreferences.textWrapMode);
                rec.wrap = wm;
                stats.wrapModes[wm] = (stats.wrapModes[wm] || 0) + 1;
                if (wm.indexOf("NONE") === -1) stats.wrapNonNone++;
            } catch (e6) { rec.wrap = null; }

            try {
                var lay = it.itemLayer;
                rec.lay = String(lay.name);
                if (!lay.visible) { rec.layHidden = true; stats.invisibleLayer++; }
                if (!lay.printable) { rec.layNonPrint = true; stats.nonPrintingLayer++; }
            } catch (e7) { rec.lay = null; }

            try { if (it.locked) { rec.locked = true; stats.locked++; } } catch (e8) { /* нема */ }

            /* Класифікація проти полоси — обидві гіпотези одразу. */
            if (rec.b) {
                rec.outLiteral = (rec.b[0] < literal.y1 - 0.001) || (rec.b[1] < literal.x1 - 0.001) ||
                                 (rec.b[2] > literal.y2 + 0.001) || (rec.b[3] > literal.x2 + 0.001);
                rec.outMirrored = (rec.b[0] < mirrored.y1 - 0.001) || (rec.b[1] < mirrored.x1 - 0.001) ||
                                  (rec.b[2] > mirrored.y2 + 0.001) || (rec.b[3] > mirrored.x2 + 0.001);
                /* Наскільки саме виходить — щоб відрізнити мікродрейф від
                 * повнополосної плашки. Береться найбільший вихід. */
                var dTop = literal.y1 - rec.b[0], dLeft = literal.x1 - rec.b[1];
                var dBot = rec.b[2] - literal.y2, dRight = rec.b[3] - literal.x2;
                rec.maxOut = Math.max(dTop, Math.max(dLeft, Math.max(dBot, dRight)));
                /* За межі САМОЇ сторінки (не полоси). */
                rec.offPage = (rec.b[0] < pb[0] - 0.001) || (rec.b[1] < pb[1] - 0.001) ||
                              (rec.b[2] > pb[2] + 0.001) || (rec.b[3] > pb[3] + 0.001);
            }
            pageRecs.push(rec);
        }

        /* ПИТАННЯ 12: перетини попарно в межах сторінки. */
        for (var a = 0; a < pageRecs.length; a++) {
            for (var c = a + 1; c < pageRecs.length; c++) {
                var A = pageRecs[a], C = pageRecs[c];
                if (!A.b || !C.b) continue;
                var ovY = Math.min(A.b[2], C.b[2]) - Math.max(A.b[0], C.b[0]);
                var ovX = Math.min(A.b[3], C.b[3]) - Math.max(A.b[1], C.b[1]);
                if (ovY >= -0.001 && ovX >= -0.001) {
                    A.hits = (A.hits || 0) + 1; C.hits = (C.hits || 0) + 1;
                    /* Дотик — перетин рівно нульовий по одній з осей. */
                    if (Math.abs(ovY) < 0.001 || Math.abs(ovX) < 0.001) {
                        A.touch = (A.touch || 0) + 1; C.touch = (C.touch || 0) + 1;
                    }
                }
            }
        }
        for (var r = 0; r < pageRecs.length; r++) out.items.push(pageRecs[r]);
    }

    out.ms = new Date().getTime() - t0;
    out.stats = stats;
    out.modifiedAfter = doc.modified;
    say("Читальність: modified до=" + out.modifiedBefore + ", після=" + out.modifiedAfter);
} catch (fatal) {
    out.fatal = String(fatal) + (fatal.line ? (" (рядок " + fatal.line + ")") : "");
} finally {
    app.scriptPreferences.measurementUnit = previousUnit;
}

__result = out;

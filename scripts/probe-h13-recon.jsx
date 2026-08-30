/* Зонд H13, розвідувальний прохід (Фаза 13, блок D).
 *
 * ЛИШЕ ЧИТАННЯ. Жодного add()/remove()/override()/save()/close(), жодного
 * присвоєння властивості ДОКУМЕНТА. Єдине присвоєння —
 * app.scriptPreferences.measurementUnit (налаштування ЗАСТОСУНКУ), і воно
 * відновлюється у finally. `doc.modified` міряється до й після, обидва числа
 * їдуть у звіт.
 *
 * Документ адресується ЯВНО за назвою через app.documents.itemByName, а не
 * через app.activeDocument: правило [[indesign-live-document-safety]].
 *
 * НАВІЩО РОЗВІДКА ОКРЕМО ВІД ВИМІРУ. Повний подушний дамп геометрії на 196
 * сторінках може коштувати хвилини й повернути мегабайти — а скільки саме
 * елементів у книжці, ніхто не міряв. Цей прохід дає ЧИСЛА Й ЦІНУ, з яких
 * будується справжній вимір: скільки елементів, скільки коштує обхід, які
 * властивості взагалі читаються, а які кидають.
 *
 * ПИТАННЯ:
 *  1. Прилад обходу — чи бачить page.textFrames / page.pageItems /
 *     page.allPageItems / page.masterPageItems те саме. Фази 6, 8 і 10
 *     тричі спіткнулись саме тут.
 *  2. Ціна обходу — indexed проти everyItem().getElements() (Фаза 8
 *     виміряла 773 мс проти 22 мс на тому самому обході).
 *  3. Полоса набору — чи однакові поля на всіх сторінках, і в яких одиницях.
 *  4. Обтікання — чи є воно в книжці взагалі (матеріалу не виміряно НІКОЛИ).
 *  5. Зображення — effectivePpi/space/link, і чи кидає щось із них.
 *  6. Прив'язані об'єкти — скільки й що з них читається.
 *  7. Типи елементів — розподіл, щоб знати популяцію.
 */

var DOC_NAME = "Book 260811-1645.indd";

var previousUnit = app.scriptPreferences.measurementUnit;
app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;

var out = {
    app: { version: String(app.version) },
    notes: [],
    threw: [],
    q1: {}, q2: {}, q3: {}, q4: {}, q5: {}, q6: {}, q7: {}
};
function say(s) { out.notes.push(String(s)); }
function threw(where, e) { out.threw.push(where + ": " + String(e)); }

try {
    var doc = app.documents.itemByName(DOC_NAME);
    if (!doc.isValid) {
        throw new Error("Документ «" + DOC_NAME + "» не відкрито. Відкрийте його в InDesign.");
    }
    out.doc = { name: String(doc.name), pages: doc.pages.length, spreads: doc.spreads.length };
    out.modifiedBefore = doc.modified;

    /* ---- ПИТАННЯ 2 (спершу, бо його числа потрібні решті) ---------------- */
    var t0 = new Date().getTime();
    var allByEveryItem = doc.pageItems.everyItem().getElements();
    var t1 = new Date().getTime();
    out.q2.docPageItemsEveryItem = { count: allByEveryItem.length, ms: t1 - t0 };

    /* Той самий обхід посторінково — саме він природний для родини «рамка
     * проти полоси», бо полоса є властивістю СТОРІНКИ, не документа. */
    var t2 = new Date().getTime();
    var perPageAll = 0, perPageItems = 0, perPageText = 0, perPageMaster = 0;
    var pages = doc.pages.everyItem().getElements();
    var t3 = new Date().getTime();
    out.q2.pagesEveryItem = { count: pages.length, ms: t3 - t2 };

    /* ---- ПИТАННЯ 1 + 3: посторінково -------------------------------------- */
    var marginSigs = {};      /* підпис полів -> скільки сторінок */
    var pageDiffs = [];       /* сторінки, де прилади розійшлись найбільше */
    var pageBoundsSig = {};
    var t4 = new Date().getTime();
    for (var i = 0; i < pages.length; i++) {
        var p = pages[i];
        var nText = 0, nItems = 0, nAll = 0, nMaster = 0;
        try { nText = p.textFrames.length; } catch (e1) { threw("page.textFrames", e1); }
        try { nItems = p.pageItems.length; } catch (e2) { threw("page.pageItems", e2); }
        try { nAll = p.allPageItems.length; } catch (e3) { threw("page.allPageItems", e3); }
        try { nMaster = p.masterPageItems.length; } catch (e4) { threw("page.masterPageItems", e4); }
        perPageText += nText; perPageItems += nItems; perPageAll += nAll; perPageMaster += nMaster;

        if (nAll !== nItems || nAll !== nText) {
            pageDiffs.push({
                page: String(p.name), textFrames: nText, pageItems: nItems,
                allPageItems: nAll, masterPageItems: nMaster
            });
        }

        try {
            var mp = p.marginPreferences;
            var sig = [mp.top, mp.left, mp.bottom, mp.right, mp.columnCount, mp.columnGutter].join("|");
            marginSigs[sig] = (marginSigs[sig] || 0) + 1;
        } catch (e5) { threw("page.marginPreferences", e5); }

        try {
            var b = p.bounds; /* [y1, x1, y2, x2] */
            var bs = [b[0], b[1], b[2], b[3]].join("|");
            pageBoundsSig[bs] = (pageBoundsSig[bs] || 0) + 1;
        } catch (e6) { threw("page.bounds", e6); }
    }
    var t5 = new Date().getTime();
    out.q2.perPageLoopMs = t5 - t4;
    out.q1 = {
        sumTextFrames: perPageText,
        sumPageItems: perPageItems,
        sumAllPageItems: perPageAll,
        sumMasterPageItems: perPageMaster,
        pagesWhereInstrumentsDisagree: pageDiffs.length,
        firstDisagreements: pageDiffs.slice(0, 12)
    };
    out.q3.marginSignatures = marginSigs;
    out.q3.pageBoundsSignatures = pageBoundsSig;
    try {
        var dp = doc.documentPreferences;
        out.q3.documentPreferences = {
            pageWidth: dp.pageWidth, pageHeight: dp.pageHeight,
            facingPages: dp.facingPages,
            bleedTop: dp.documentBleedTopOffset, bleedInside: dp.documentBleedInsideOrLeftOffset,
            bleedBottom: dp.documentBleedBottomOffset, bleedOutside: dp.documentBleedOutsideOrRightOffset,
            bleedUniform: dp.documentBleedUniformSize
        };
    } catch (e7) { threw("documentPreferences", e7); }
    out.q3.rulerOrigin = String(doc.viewPreferences.rulerOrigin);
    out.q3.scriptUnit = String(app.scriptPreferences.measurementUnit);
    out.q3.docHorizUnit = String(doc.viewPreferences.horizontalMeasurementUnits);

    /* ---- ПИТАННЯ 7 + 4 + 6: один прохід по всіх елементах документа ------- */
    var t6 = new Date().getTime();
    var types = {}, wrapModes = {}, parentKinds = {};
    var anchored = 0, wrapNonNone = 0, wrapThrew = 0;
    var anchoredSample = [];
    for (var k = 0; k < allByEveryItem.length; k++) {
        var it = allByEveryItem[k];
        var tn = "?";
        try { tn = String(it.constructor.name); } catch (e8) { threw("constructor.name", e8); }
        types[tn] = (types[tn] || 0) + 1;

        try {
            var wm = String(it.textWrapPreferences.textWrapMode);
            wrapModes[wm] = (wrapModes[wm] || 0) + 1;
            if (wm !== "NONE" && wm.indexOf("NONE") === -1) wrapNonNone++;
        } catch (e9) { wrapThrew++; if (wrapThrew < 3) threw("textWrapPreferences[" + tn + "]", e9); }

        var pk = "?";
        try { pk = String(it.parent.constructor.name); } catch (e10) { threw("parent.constructor", e10); }
        parentKinds[pk] = (parentKinds[pk] || 0) + 1;
        if (pk === "Character" || pk === "InsertionPoint" || pk === "Text" || pk === "Story" ||
            pk === "Paragraph" || pk === "Word") {
            anchored++;
            if (anchoredSample.length < 6) {
                var rec = { type: tn, parentKind: pk };
                try {
                    var aos = it.anchoredObjectSettings;
                    rec.anchoredPosition = String(aos.anchoredPosition);
                    rec.spineRelative = aos.spineRelative;
                    rec.pinPosition = aos.pinPosition;
                    rec.anchorPoint = String(aos.anchorPoint);
                    rec.horizontalAlignment = String(aos.horizontalAlignment);
                    rec.horizontalReferencePoint = String(aos.horizontalReferencePoint);
                    rec.anchorXoffset = aos.anchorXoffset;
                    rec.anchorYoffset = aos.anchorYoffset;
                } catch (e11) { rec.settingsThrew = String(e11); }
                anchoredSample.push(rec);
            }
        }
    }
    var t7 = new Date().getTime();
    out.q7 = { types: types, ms: t7 - t6 };
    out.q4 = { wrapModes: wrapModes, nonNone: wrapNonNone, threwCount: wrapThrew };
    out.q6 = { anchoredCount: anchored, parentKinds: parentKinds, sample: anchoredSample };

    /* ---- ПИТАННЯ 5: зображення ------------------------------------------- */
    var t8 = new Date().getTime();
    var graphics = doc.allGraphics;
    var t9 = new Date().getTime();
    out.q5.count = graphics.length;
    out.q5.ms = t9 - t8;
    out.q5.items = [];
    for (var g = 0; g < graphics.length && g < 40; g++) {
        var gr = graphics[g];
        var rec2 = {};
        try { rec2.type = String(gr.constructor.name); } catch (eA) { rec2.type = "?"; }
        try { rec2.effectivePpi = gr.effectivePpi; } catch (eB) { rec2.effectivePpiThrew = String(eB); }
        try { rec2.actualPpi = gr.actualPpi; } catch (eC) { rec2.actualPpiThrew = String(eC); }
        try { rec2.space = String(gr.space); } catch (eD) { rec2.spaceThrew = String(eD); }
        try { rec2.hScale = gr.absoluteHorizontalScale; rec2.vScale = gr.absoluteVerticalScale; }
        catch (eE) { rec2.scaleThrew = String(eE); }
        try {
            var lk = gr.itemLink;
            if (lk === null) { rec2.link = null; }
            else { rec2.link = { status: String(lk.status), name: String(lk.name), needed: lk.needed }; }
        } catch (eF) { rec2.linkThrew = String(eF); }
        try { rec2.page = String(gr.parentPage === null ? "(pasteboard)" : gr.parentPage.name); }
        catch (eG) { rec2.pageThrew = String(eG); }
        out.q5.items.push(rec2);
    }

    out.modifiedAfter = doc.modified;
    say("Читальність: modified до=" + out.modifiedBefore + ", після=" + out.modifiedAfter);
} catch (fatal) {
    out.fatal = String(fatal) + (fatal.line ? (" (рядок " + fatal.line + ")") : "");
} finally {
    app.scriptPreferences.measurementUnit = previousUnit;
}

__result = out;

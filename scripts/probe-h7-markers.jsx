/* Зонд H7, Питання 4–12 (спек Фази 7 §6).
 *
 * СТВОРЮЄ ВЛАСНІ ТИМЧАСОВІ ДОКУМЕНТИ і закриває їх без збереження. Робочого
 * документа користувача НЕ ЧІПАЄ: жодного звернення до app.activeDocument,
 * усе адресується через змінні doc / doc2, отримані з app.documents.add().
 * Правило [[indesign-live-document-safety]], зразок — зонд H6.
 *
 * ЯК ЧИТАЄТЬСЯ РЕЗУЛЬТАТ. `character.contents` для маркера повертає САМЕ
 * ПЕРЕРАХУВАННЯ SpecialCharacters — розв'язаного значення DOM не віддає
 * взагалі, а `story.exportFile(TEXT_TYPE)` його теж не розв'язує (виміряно
 * H6: контрольний AUTO_PAGE_NUMBER дав порожній рядок). Тому вимір іде через
 * PDF: там видно рівно те, що НАДРУКУЄТЬСЯ.
 *
 * КОЖНА МІТКА ОБМЕЖЕНА З ДВОХ БОКІВ: «N4=⟨маркер⟩#». H6 брав усе до
 * наступної мітки, і між мітками міг опинитися текст-заповнювач із чужої
 * рамки. Тут значення — це рівно те, що між «=» і «#» ТІЄЇ САМОЇ рамки.
 * Заповнювач ланцюжків навмисно БЕЗ ЦИФР із тієї ж причини.
 *
 * Питання 12 живе в ОКРЕМОМУ документі: 196 рамок у спільному засмітили б
 * PDF, з якого читаються всі інші відповіді.
 */

var previousUnit = app.scriptPreferences.measurementUnit;
app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;

var out = { notes: [], expected: {}, dom: {}, q12: {}, pdfPath: null };
/* Версія застосунку — у результат, а не лише в голову того, хто міряв
 * (рецензія, Important 9). */
out.app = { version: String(app.version), name: String(app.name) };
var doc = null;
var doc2 = null;
var baseLayer = null;

function say(s) { out.notes.push(String(s)); }

/* Координати ВІДНОСНО СТОРІНКИ, не абсолютні: на розвороті система координат
 * спільна для обох сторінок (виміряно Фазою 4), і абсолютні межі осідали б не
 * на тій сторінці, яку я задумав — мовчки, з відповіддю на інше питання.
 *
 * ШАР ЗАДАЄТЬСЯ ЯВНО. `doc.layers.add()` робить новий шар АКТИВНИМ, і все
 * створене після цього осідає на ньому. Перший прогін зонда через це поставив
 * чотири мітки на прихований і на недрукований шар — і чотири «null» у PDF
 * читались би як «маркер не працює», хоч насправді мітки просто не
 * надрукувались. Це той самий клас помилки, що зламані координати H6:
 * зіпсутий прилад із правдоподібною відповіддю. */
function addFrame(page, dx1, dy1, dx2, dy2) {
    var b = page.bounds;          /* [y1, x1, y2, x2] */
    var f = page.textFrames.add();
    if (baseLayer !== null) { try { f.itemLayer = baseLayer; } catch (eL) {} }
    f.geometricBounds = [b[0] + dy1, b[1] + dx1, b[0] + dy2, b[1] + dx2];
    return f;
}

/* Рамка «МІТКА=⟨маркер⟩#». Обидві межі значення — у тій самій рамці. */
function labelled(page, x1, y1, x2, y2, label, marker) {
    var f = addFrame(page, x1, y1, x2, y2);
    f.contents = label;
    f.insertionPoints[-1].contents = marker;
    f.insertionPoints[-1].contents = "#";
    f.texts[0].pointSize = 16;
    try { f.textFramePreferences.textColumnCount = 1; } catch (e) {}
    return f;
}

function fillerText(times) {
    var s = "";
    for (var i = 0; i < times; i++) s += "Текст ланцюжка без цифр. ";
    return s;
}

/* Ланцюжок рамок за списком [сторінка, x1, y1, x2, y2]. Повертає рамки. */
function chain(doc, spec) {
    var frames = [];
    for (var i = 0; i < spec.length; i++) {
        var s = spec[i];
        frames.push(addFrame(doc.pages[s[0]], s[1], s[2], s[3], s[4]));
    }
    for (var j = 0; j + 1 < frames.length; j++) frames[j].nextTextFrame = frames[j + 1];
    frames[0].parentStory.contents = fillerText(60 * frames.length);
    return frames;
}

function pageNameOf(frame) {
    try { return String(frame.parentPage.name); } catch (e) { return null; }
}

try {
    /* ФАЗА «undo»: окремий виклик, бо крок скасування, створений цим самим
     * скриптом, ще не закритий — `doc.undo()` зсередини нього дає «Unable to
     * undo the last command» (виміряно першим прогоном). Користувач тисне
     * Cmd+Z ПІСЛЯ того, як обробник завершився; цей виклик робить те саме. */
    if (params.phase === "undo") {
        var d2 = app.documents.itemByName(params.docName);
        if (!d2.isValid) throw new Error("Документа «" + params.docName + "» уже нема");
        /* ОБЕРІГ. Далі йдуть undo() і close(SaveOptions.NO) — дії, які на
         * чужому документі знищили б роботу. Назва документа користувача
         * ніколи не починається з «Untitled»: тимчасові документи, і лише
         * вони, звуться так до першого збереження (рецензія, Important 7). */
        if (String(d2.name).indexOf("Untitled") !== 0) {
            throw new Error("ВІДМОВА: «" + String(d2.name) + "» не є тимчасовим документом зонда");
        }
        function tallyFrames(d) {
            var n = 0;
            for (var i = 0; i < d.pages.length; i++) n += d.pages[i].textFrames.length;
            return n;
        }
        out.q12 = { framesBeforeUndo: tallyFrames(d2), layersBeforeUndo: d2.layers.length };
        /* ІМ'Я КРОКУ — саме по собі відповідь. Якщо наступний крок скасування
         * названий іменем нашого виклику, то шар, 196 рамок і saveACopy лежать
         * в ОДНОМУ кроці, незалежно від того, чи вдасться його виконати
         * зі скрипта. */
        try { out.q12.undoName = String(d2.undoName); } catch (eUN) { out.q12.undoName = "?" + eUN; }
        try { out.q12.redoName = String(d2.redoName); } catch (eRN) { out.q12.redoName = "?" + eRN; }

        function afterUndo(tag) {
            out.q12.undoPath = tag;
            out.q12.framesAfterUndo = tallyFrames(d2);
            out.q12.layersAfterUndo = d2.layers.length;
            out.q12.layerNamesAfterUndo = [];
            for (var lu = 0; lu < d2.layers.length; lu++) out.q12.layerNamesAfterUndo.push(String(d2.layers[lu].name));
            try { out.q12.undoNameAfter = String(d2.undoName); } catch (eA) { out.q12.undoNameAfter = "?"; }
        }

        var tU = new Date().getTime();
        try {
            d2.undo();
            out.q12.msUndo = new Date().getTime() - tU;
            afterUndo("прямий d2.undo()");
        } catch (eUn) {
            out.q12.undoError = String(eUn);
            /* Друга спроба: зробити документ активним. Він наш власний і
             * закривається наступним рядком, тож вікно користувача
             * повертається саме. */
            try {
                app.activeDocument = d2;
                var tU2 = new Date().getTime();
                d2.undo();
                out.q12.msUndo = new Date().getTime() - tU2;
                afterUndo("d2.undo() після activeDocument");
            } catch (eUn2) {
                out.q12.undoError2 = String(eUn2);
            }
        }
        try { d2.close(SaveOptions.NO); say("документ Питання 12 закрито без збереження"); }
        catch (eCl) { say("НЕ ВДАЛОСЯ ЗАКРИТИ документ Питання 12: " + eCl); }
        app.scriptPreferences.measurementUnit = previousUnit;
        __result = out;
        throw "__H7_DONE__";
    }

    /* --- чи існують самі перерахування (валідує класифікатор Фази 6) --- */
    out.dom.markerNames = {};
    var NAMES = ["AUTO_PAGE_NUMBER", "NEXT_PAGE_NUMBER", "PREVIOUS_PAGE_NUMBER", "SECTION_MARKER"];
    for (var nn = 0; nn < NAMES.length; nn++) {
        var v = SpecialCharacters[NAMES[nn]];
        out.dom.markerNames[NAMES[nn]] = {
            defined: v !== undefined && v !== null,
            asString: v === undefined ? "undefined" : String(v)
        };
    }

    doc = app.documents.add();
    doc.documentPreferences.facingPages = true;
    /* ФОРМАТ ЗАДАНО ЯВНО. Без цього фікстура успадковує ТИПОВИЙ документ
     * користувача, і позиції на кшталт FOLIO_POS = [320, 60, 500, 95] на
     * вужчому форматі виїхали б за сторінку — Питання 13 мовчки поміряло б
     * «не перекриває» замість того, що поставлено (рецензія, Important 9). */
    doc.documentPreferences.pageWidth = 612;
    doc.documentPreferences.pageHeight = 792;
    doc.documentPreferences.pagesPerDocument = 68;
    baseLayer = doc.layers[0];
    say("фікстура: " + doc.name + ", сторінок " + doc.pages.length + ", базовий шар «" + baseLayer.name + "»");

    /* Індекси нижче — ІНДЕКСИ, назви сторінок на одиницю більші.
     * Розвороти при facingPages: [1] [2,3] [4,5] … [18,19] [20]. */

    /* --- ЛАНЦЮЖОК H1: службовий, у порядку сторінок 6→7→8→9→10→11 --- */
    var h1 = chain(doc, [
        [5, 60, 100, 300, 400],
        [6, 60, 100, 300, 400],
        [7, 60, 100, 300, 400],
        [8, 60, 100, 300, 400],
        [9, 60, 100, 300, 400],
        [10, 60, 100, 300, 400]
    ]);
    out.dom.h1Pages = [];
    for (var hi = 0; hi < h1.length; hi++) out.dom.h1Pages.push(pageNameOf(h1[hi]));

    /* --- ЛАНЦЮЖОК M: «основний текст», РВАНИЙ: 3 → 9 → 20 ---
     * Попередня рамка сторінки 9 лежить на сторінці 3, а не 8. Саме тому
     * відповідь Питання 9 буде однозначна. */
    var m = chain(doc, [
        [2, 60, 100, 300, 400],
        [8, 60, 100, 300, 400],
        [19, 60, 100, 300, 400]
    ]);
    out.dom.mPages = [];
    for (var mi = 0; mi < m.length; mi++) out.dom.mPages.push(pageNameOf(m[mi]));

    /* --- ЛАНЦЮЖОК M2: 2 → 11, для контролю порядку накладання --- */
    var m2 = chain(doc, [
        [1, 60, 100, 300, 400],
        [10, 60, 100, 300, 400]
    ]);
    out.dom.m2Pages = [];
    for (var m2i = 0; m2i < m2.length; m2i++) out.dom.m2Pages.push(pageNameOf(m2[m2i]));

    /* --- ЛАНЦЮЖОК M3: 21 → 25, «основний текст» для контролю Питання 9 ---
     * Створюється РАНО, тобто РАНІШЕ за службовий ланцюжок H4. У реальній
     * фазі службовий ланцюжок додається в уже готовий документ, тобто
     * створюється ОСТАННІМ, — і саме цього порядку у першій редакції зонда
     * не було: H1 створювався раніше за M, тож «перемога службового» могла
     * бути просто «перемогою створеного першим». */
    var m3 = chain(doc, [
        [20, 60, 100, 300, 400],
        [24, 60, 100, 300, 400]
    ]);
    out.dom.m3Pages = [];
    for (var m3i = 0; m3i < m3.length; m3i++) out.dom.m3Pages.push(pageNameOf(m3[m3i]));

    /* --- ЛАНЦЮЖОК X: 4 → 5, остання рамка без наступної (Питання 10) --- */
    var x = chain(doc, [
        [3, 60, 100, 300, 400],
        [4, 60, 100, 300, 400]
    ]);

    /* === НЕГАТИВНИЙ КОНТРОЛЬ ===
     * Відповідь відома наперед: номер власної сторінки. Якщо тут не «5» —
     * прилад зламаний і решта чисел зонда нічого не означає. */
    labelled(doc.pages[4], 330, 60, 520, 95, "CTRL=", SpecialCharacters.AUTO_PAGE_NUMBER);
    out.expected.CTRL = String(doc.pages[4].name);

    /* === ПИТАННЯ 4: чи NEXT_PAGE_NUMBER існує й дзеркальний ===
     * Сторінка 8 — середина ланцюжка H1: попередня рамка на 7, наступна на 9. */
    labelled(doc.pages[7], 80, 150, 290, 185, "N4=", SpecialCharacters.NEXT_PAGE_NUMBER);
    labelled(doc.pages[7], 80, 200, 290, 235, "P4=", SpecialCharacters.PREVIOUS_PAGE_NUMBER);
    labelled(doc.pages[7], 80, 250, 290, 285, "C4=", SpecialCharacters.AUTO_PAGE_NUMBER);
    out.expected.N4 = { page: "8", want: "9" };
    out.expected.P4 = { page: "8", want: "7" };
    out.expected.C4 = { page: "8", want: "8" };

    /* === ПИТАННЯ 5: службовий ланцюжок на РОЗІРВАНОМУ основному тексті ===
     * На сторінці 7 основний текст — окрема історія (у ланцюжок не входить),
     * а службова рамка H1 має попередню на сторінці 6. */
    var lone7 = addFrame(doc.pages[6], 60, 120, 300, 300);
    lone7.contents = "Окрема історія сторінки сім, у ланцюжок не входить.";
    labelled(doc.pages[6], 80, 150, 290, 185, "H5=", SpecialCharacters.PREVIOUS_PAGE_NUMBER);
    out.expected.H5 = { page: "7", want: "6", ifBroken: "7" };

    /* === ПИТАННЯ 10: рамка ланцюжка БЕЗ попередньої / БЕЗ наступної ===
     * Сторінка 6 — ПЕРША рамка H1 (попередньої немає).
     * Сторінка 5 — ОСТАННЯ рамка X (наступної немає). */
    labelled(doc.pages[5], 80, 150, 290, 185, "F10=", SpecialCharacters.PREVIOUS_PAGE_NUMBER);
    labelled(doc.pages[4], 80, 150, 290, 185, "X10=", SpecialCharacters.NEXT_PAGE_NUMBER);
    out.expected.F10 = { page: "6", note: "попередньої рамки немає" };
    out.expected.X10 = { page: "5", note: "наступної рамки немає" };

    /* === ПИТАННЯ 9: ЯКИЙ ЛАНЦЮЖОК ВИГРАЄ при перекритті ДВОХ ===
     * Сторінка 9: рамка H1 (попередня на 8) і рамка M (попередня на 3).
     * Сусіди на РІЗНИХ сторінках — відповідь однозначна: 8 = службовий,
     * 3 = основний. Порядок накладання типовий (M створено пізніше, тобто
     * лежить вище). */
    labelled(doc.pages[8], 80, 150, 290, 185, "W9=", SpecialCharacters.PREVIOUS_PAGE_NUMBER);
    out.expected.W9 = { page: "9", helper: "8", main: "3" };

    /* Сторінка 11: те саме, але службову рамку піднято НАД основною. Якщо
     * відповідь відрізняється від W9 — переможець визначається порядком
     * накладання, і `route: "auto"` спирався б на найкрихкішу властивість
     * документа. */
    h1[5].bringToFront();
    labelled(doc.pages[10], 80, 150, 290, 185, "Z9=", SpecialCharacters.PREVIOUS_PAGE_NUMBER);
    out.expected.Z9 = { page: "11", helper: "10", main: "2" };

    /* === ПИТАННЯ 7: маркер у ПРИВ'ЯЗАНІЙ рамці ===
     * Сторінка 10: рамка-хост перекриває рамку H1 (попередня на 9); маркер
     * лежить у рамці, ПРИВ'ЯЗАНІЙ у текст хоста. Наявну рамку прив'язати не
     * можна — тільки створити через insertionPoints.textFrames.add(). */
    var host = addFrame(doc.pages[9], 80, 150, 290, 200);
    host.contents = "Хост ";
    var anchored = null;
    try {
        anchored = host.parentStory.insertionPoints[-1].textFrames.add();
        anchored.geometricBounds = [0, 0, 24, 150];
        anchored.contents = "A7=";
        anchored.insertionPoints[-1].contents = SpecialCharacters.PREVIOUS_PAGE_NUMBER;
        anchored.insertionPoints[-1].contents = "#";
        anchored.texts[0].pointSize = 16;
        try { anchored.textFramePreferences.useNoLineBreaksForAutoSizing = true; } catch (eA1) {}
        try { anchored.texts[0].alignToBaseline = false; } catch (eA2) {}
        out.dom.anchoredParent = String(anchored.parent.constructor.name);
        out.dom.anchoredPage = pageNameOf(anchored);
    } catch (eAnch) {
        out.dom.anchoredError = String(eAnch);
    }
    out.expected.A7 = { page: "10", want: "9" };

    /* === ПИТАННЯ 8: прихований і непридатний до друку шар ===
     * Питання §4.8 стосується ШАРУ СЛУЖБОВОГО ЛАНЦЮЖКА, а не шару самої
     * колонцифри: приховану колонцифру PDF не покаже взагалі, і вимір
     * відповів би на порожнє питання. Тут ланцюжок ховається, а мітка
     * лишається на видимому шарі. */
    try {
        var hiddenLayer = doc.layers.add({ name: "_folio-helper-hidden" });
        var h2 = chain(doc, [
            [11, 60, 100, 300, 400],
            [12, 60, 100, 300, 400],
            [13, 60, 100, 300, 400]
        ]);
        for (var h2i = 0; h2i < h2.length; h2i++) h2[h2i].itemLayer = hiddenLayer;
        hiddenLayer.visible = false;
        out.dom.hiddenLayerVisible = hiddenLayer.visible;
    } catch (eH2) { out.dom.hiddenLayerError = String(eH2); }
    labelled(doc.pages[12], 80, 150, 290, 185, "HID=", SpecialCharacters.PREVIOUS_PAGE_NUMBER);
    out.expected.HID = { page: "13", want: "12" };

    try {
        var npLayer = doc.layers.add({ name: "_folio-helper-noprint" });
        var h3 = chain(doc, [
            [15, 60, 100, 300, 400],
            [16, 60, 100, 300, 400]
        ]);
        for (var h3i = 0; h3i < h3.length; h3i++) h3[h3i].itemLayer = npLayer;
        npLayer.printable = false;
        out.dom.npLayerPrintable = npLayer.printable;
    } catch (eH3) { out.dom.npLayerError = String(eH3); }
    labelled(doc.pages[16], 80, 150, 290, 185, "NPR=", SpecialCharacters.PREVIOUS_PAGE_NUMBER);
    out.expected.NPR = { page: "17", want: "16" };

    /* === ПИТАННЯ 6: ланцюжок із БАТЬКІВСЬКОЇ сторінки без override ===
     * Рамки зшиті на майстрі; на документних сторінках вони НЕ переозначені.
     * Мітка стоїть на документній сторінці 19 і перекриває місце майстрової
     * рамки. Заразом — чи бачить майстрову рамку page.allPageItems (§4.1). */
    try {
        var master = doc.masterSpreads.add();
        var mp = master.pages;
        var mf = [];
        for (var mpi = 0; mpi < mp.length; mpi++) {
            var b = mp[mpi].bounds;
            var fr = mp[mpi].textFrames.add();
            try { fr.itemLayer = baseLayer; } catch (eML) {}
            fr.geometricBounds = [b[0] + 100, b[1] + 60, b[0] + 400, b[1] + 300];
            mf.push(fr);
        }
        if (mf.length > 1) mf[0].nextTextFrame = mf[1];
        mf[0].parentStory.contents = fillerText(120);
        out.dom.masterPages = mp.length;
        out.dom.masterContainers = mf[0].parentStory.textContainers.length;
        doc.pages[17].appliedMaster = master;
        doc.pages[18].appliedMaster = master;
        /* Той самий майстер на сторінках 22–23, але там рамки ПЕРЕОЗНАЧЕНІ.
         * Без цієї пари негативна відповідь була б неповна: невідомо, чи
         * ланцюжок не працює з майстра взагалі, чи саме БЕЗ override. */
        doc.pages[21].appliedMaster = master;
        doc.pages[22].appliedMaster = master;
        var ovr = 0;
        for (var op = 21; op <= 22; op++) {
            var mpis = doc.pages[op].masterPageItems;
            for (var oi = mpis.length - 1; oi >= 0; oi--) {
                try { mpis[oi].override(doc.pages[op]); ovr += 1; } catch (eOv) { out.dom.overrideError = String(eOv); }
            }
        }
        out.dom.overridden = ovr;
    } catch (eM6) { out.dom.masterError = String(eM6); }
    labelled(doc.pages[18], 80, 150, 290, 185, "M6=", SpecialCharacters.PREVIOUS_PAGE_NUMBER);
    out.expected.M6 = { page: "19", want: "18" };
    labelled(doc.pages[22], 80, 150, 290, 185, "O6=", SpecialCharacters.PREVIOUS_PAGE_NUMBER);
    out.expected.O6 = { page: "23", want: "22" };

    /* Чи видно непереозначену майстрову рамку через page.allPageItems. */
    function countTextFrames(page) {
        var n = 0;
        var all;
        try { all = page.allPageItems; } catch (e) { return -1; }
        for (var i = 0; i < all.length; i++) {
            var pr = null;
            try { pr = all[i].paragraphs; } catch (e2) { pr = null; }
            if (pr === null) continue;
            var c = -1;
            try { c = pr.length; } catch (e3) { c = -1; }
            if (c >= 0) n += 1;
        }
        return n;
    }
    out.dom.page19_allPageItems = countTextFrames(doc.pages[18]);
    out.dom.page19_textFrames = doc.pages[18].textFrames.length;
    out.dom.page19_masterItems = doc.pages[18].masterPageItems.length;
    out.dom.page19_appliedMaster = String(doc.pages[18].appliedMaster.name);
    out.dom.page23_allPageItems = countTextFrames(doc.pages[22]);
    out.dom.page23_textFrames = doc.pages[22].textFrames.length;
    out.dom.page23_masterItems = doc.pages[22].masterPageItems.length;

    /* Чи вцілів ЛАНЦЮЖОК після override. Без цього «навіть override не
     * допомагає» могло б насправді означати «override розірвав ланцюжок» —
     * зовсім інший факт із зовсім іншим наслідком для маршруту B. */
    function threadInfo(frame) {
        var info = { containers: null, prevPage: null, nextPage: null };
        try { info.containers = frame.parentStory.textContainers.length; } catch (e) {}
        try {
            var pv = frame.previousTextFrame;
            info.prevPage = (pv !== null && pv !== undefined && pv.isValid) ? pageNameOf(pv) : null;
        } catch (e) {}
        try {
            var nx = frame.nextTextFrame;
            info.nextPage = (nx !== null && nx !== undefined && nx.isValid) ? pageNameOf(nx) : null;
        } catch (e) {}
        return info;
    }
    /* На с.23 після override текстових рамок дві: переозначена майстрова і
     * мітка O6. Майстрова — та, що НЕ містить «O6=». */
    try {
        var p23 = doc.pages[22].textFrames;
        for (var t23 = 0; t23 < p23.length; t23++) {
            if (String(p23[t23].contents).indexOf("O6=") === -1) {
                out.dom.page23_overriddenThread = threadInfo(p23[t23]);
            }
        }
    } catch (eT23) { out.dom.page23_threadError = String(eT23); }
    /* На с.19 без override ланцюжок дивимось на самому елементі майстра. */
    try {
        out.dom.page19_masterItemThread = threadInfo(doc.pages[18].masterPageItems[0]);
    } catch (eT19) { out.dom.page19_threadError = String(eT19); }

    /* === ПИТАННЯ 11: чи переживає символьне форматування заміну ===
     * Літерал «42» має власні кегль і колір; замінюємо його на автомаркер і
     * читаємо атрибути ТОГО САМОГО символа з DOM — PDF-текст до форматування
     * сліпий, тож §9 цього не показав би. */
    try {
        var red = null;
        try {
            red = doc.colors.add({ name: "Зонд-Червоний", model: ColorModel.PROCESS, space: ColorSpace.CMYK, colorValue: [20, 100, 70, 10] });
        } catch (eC) { red = null; }
        var s11 = addFrame(doc.pages[14], 60, 150, 400, 200);
        s11.contents = "S11=42#";
        s11.texts[0].pointSize = 16;
        var lit = s11.characters.itemByRange(4, 5);   /* саме «42» */
        lit.pointSize = 30;
        if (red !== null) lit.fillColor = red;
        out.dom.q11Before = {
            text: String(s11.contents),
            pointSize: String(s11.characters[4].pointSize),
            fill: String(s11.characters[4].fillColor.name)
        };
        /* Заміна ЛИШЕ літерала, за виміряним зсувом (§4.4). */
        s11.characters.itemByRange(4, 5).contents = SpecialCharacters.AUTO_PAGE_NUMBER;
        out.dom.q11After = {
            length: s11.characters.length,
            charIsMarker: s11.characters[4].contents === SpecialCharacters.AUTO_PAGE_NUMBER,
            pointSize: String(s11.characters[4].pointSize),
            fill: String(s11.characters[4].fillColor.name)
        };
    } catch (e11) { out.dom.q11Error = String(e11); }
    out.expected.S11 = { page: "15", want: "15" };

    /* === ПИТАННЯ 9, КОНТРОЛЬ ПОРЯДКУ СТВОРЕННЯ ===
     * H4 — службовий ланцюжок, створений ОСТАННІМ, тобто рівно так, як його
     * створюватиме фаза: у вже готовий документ. Основний ланцюжок M3
     * (21 → 25) створено раніше. На сторінці 25 перекриваються обидва:
     * службовий каже 24, основний каже 21. */
    var h4 = chain(doc, [
        [23, 60, 100, 300, 400],
        [24, 60, 100, 300, 400]
    ]);
    out.dom.h4Pages = [];
    for (var h4i = 0; h4i < h4.length; h4i++) out.dom.h4Pages.push(pageNameOf(h4[h4i]));
    labelled(doc.pages[24], 80, 150, 290, 185, "V9=", SpecialCharacters.PREVIOUS_PAGE_NUMBER);
    out.expected.V9 = { page: "25", helper: "24", main: "21" };

    /* === ПИТАННЯ 13: чи розв'яжеться маркер у НЕПЕРЕОЗНАЧЕНІЙ майстровій
     * рамці, якщо під нею на ДОКУМЕНТНІЙ сторінці лежить службовий ланцюжок
     * ===
     *
     * Це НЕ Питання 6. Там ланцюжок жив на майстрі й мав сусіда на сторінці
     * майстра. Тут ланцюжок живе на документних сторінках, зшитий у порядку
     * сторінок, а майстровий елемент лише геометрично його перекриває.
     *
     * Питання відкрилось із виміру книжки: на майстрах E/D/J уже стоїть
     * колонцифра ⟨PREVIOUS⟩–⟨AUTO⟩ без літералів, і вона друкує «N–N» лише
     * тому, що нічого не перекриває. Якщо службова рамка під нею її
     * «оживляє», з'являється стратегія, якої спек не розглядав: не заміняти
     * 91 літерал, а ЗНЯТИ 91 переозначення. */
    var FOLIO_POS = [320, 60, 500, 95];   /* dx1, dy1, dx2, dy2 відносно сторінки */

    function masterFolio(label) {
        var msp = doc.masterSpreads.add();
        var recto = null;
        for (var mi3 = 0; mi3 < msp.pages.length; mi3++) {
            if (msp.pages[mi3].side === PageSideOptions.RIGHT_HAND) recto = msp.pages[mi3];
        }
        if (recto === null) recto = msp.pages[msp.pages.length - 1];
        var bb = recto.bounds;
        var ff = recto.textFrames.add();
        try { ff.itemLayer = baseLayer; } catch (eFL) {}
        ff.geometricBounds = [bb[0] + FOLIO_POS[1], bb[1] + FOLIO_POS[0], bb[0] + FOLIO_POS[3], bb[1] + FOLIO_POS[2]];
        ff.contents = label;
        ff.insertionPoints[-1].contents = SpecialCharacters.PREVIOUS_PAGE_NUMBER;
        ff.insertionPoints[-1].contents = "-";
        ff.insertionPoints[-1].contents = SpecialCharacters.AUTO_PAGE_NUMBER;
        ff.insertionPoints[-1].contents = "#";
        ff.texts[0].pointSize = 16;
        return { spread: msp, recto: recto, frame: ff };
    }

    /* Службовий ланцюжок ІЗ ТЕКСТОМ — конфігурація, вже доведена Питаннями
     * 5 і 9. Так у Питанні 13 змінюється рівно одна річ: майстер. */
    function helperAt(indices) {
        var spec = [];
        for (var s = 0; s < indices.length; s++) {
            spec.push([indices[s], FOLIO_POS[0], FOLIO_POS[1], FOLIO_POS[2], FOLIO_POS[3]]);
        }
        return chain(doc, spec);
    }

    try {
        var m13 = masterFolio("T13=");
        var hm = helperAt([25, 26, 27, 28]);          /* сторінки 26→27→28→29 */
        out.dom.hm13Pages = [];
        for (var q13 = 0; q13 < hm.length; q13++) out.dom.hm13Pages.push(pageNameOf(hm[q13]));
        doc.pages[27].appliedMaster = m13.spread;
        doc.pages[28].appliedMaster = m13.spread;
        out.dom.page29_masterItems = doc.pages[28].masterPageItems.length;
        /* Збіг геометрії ВИМІРЯНИЙ, а не виведений із конструкції: без цього
         * «маркер не бачить ланцюжка» не відрізнити від «рамки просто не
         * перекриваються» (рецензія, Minor 13). Порівнюються сторінко-
         * відносні межі, бо майстровий елемент віддає свої в системі
         * майстрового розвороту. */
        function relOf(item) {
            try {
                var gb = item.geometricBounds;
                var pb = item.parentPage.bounds;
                return [gb[0] - pb[0], gb[1] - pb[1], gb[2] - pb[0], gb[3] - pb[1]];
            } catch (eR) { return null; }
        }
        var relMaster = relOf(doc.pages[28].masterPageItems[0]);
        var relHelper = relOf(hm[3]);
        out.dom.q13Geometry = { master: relMaster, helper: relHelper, delta: null };
        if (relMaster !== null && relHelper !== null) {
            out.dom.q13Geometry.delta = [
                relMaster[0] - relHelper[0], relMaster[1] - relHelper[1],
                relMaster[2] - relHelper[2], relMaster[3] - relHelper[3]
            ];
        }
        out.expected.T13 = { page: "29", want: "28-29", ifBroken: "29-29" };
    } catch (e13) { out.dom.q13Error = String(e13); }

    /* === ПИТАННЯ 13б: чи працює ПОРОЖНІЙ службовий ланцюжок ===
     * §4.2 вимагає порожнього вмісту службової рамки. Усе, що зонд міряв
     * досі, мало текст, тож «порожньо» — окрема неперевірена змінна. Тут
     * майстра немає взагалі: рамка колонцифри звичайна, документна. */
    try {
        var empty = helperAt([33, 34]);               /* сторінки 34→35 */
        empty[0].parentStory.contents = "";
        out.dom.emptyHelperContainers = empty[0].parentStory.textContainers.length;
        out.dom.emptyHelperChars = empty[0].parentStory.characters.length;
        labelled(doc.pages[34], 330, 65, 490, 90, "E13=", SpecialCharacters.PREVIOUS_PAGE_NUMBER);
        out.expected.E13 = { page: "35", want: "34", ifBroken: "35" };
    } catch (e13b) { out.dom.q13bError = String(e13b); }

    /* === ПИТАННЯ 14: чи можна ЗНЯТИ переозначення ===
     * Сторінки 32–33: той самий майстер, службовий ланцюжок під ним, рамку
     * ПЕРЕОЗНАЧЕНО і навмисно ЗМІНЕНО (зсув і власний текст із літералом
     * «999»), тоді знято через removeOverride().
     *
     * PDF розрізняє наслідки сам: «T14=32-33» означає, що майстровий елемент
     * повернувся і маркер розв'язався; «T14=999» — що переозначення лишилось. */
    try {
        var m14 = masterFolio("T14=");
        var hn = helperAt([29, 30, 31, 32]);          /* сторінки 30→31→32→33 */
        out.dom.hm14Pages = [];
        for (var q14 = 0; q14 < hn.length; q14++) out.dom.hm14Pages.push(pageNameOf(hn[q14]));
        doc.pages[31].appliedMaster = m14.spread;
        doc.pages[32].appliedMaster = m14.spread;

        var pg33 = doc.pages[32];
        out.dom.q14 = {
            beforeOverride: { masterPageItems: pg33.masterPageItems.length, textFrames: pg33.textFrames.length }
        };
        var ov14 = pg33.masterPageItems[0].override(pg33);
        var ovBounds = ov14.geometricBounds;
        ov14.geometricBounds = [ovBounds[0] + 5, ovBounds[1] + 5, ovBounds[2] + 5, ovBounds[3] + 5];
        ov14.contents = "T14=999#";
        ov14.texts[0].pointSize = 16;
        out.dom.q14.afterOverride = {
            masterPageItems: pg33.masterPageItems.length,
            textFrames: pg33.textFrames.length,
            overridden: ov14.overridden,
            id: String(ov14.id),
            bounds: ov14.geometricBounds
        };

        try {
            ov14.removeOverride();
            out.dom.q14.removeOverrideCalled = true;
        } catch (eRO) {
            out.dom.q14.removeOverrideError = String(eRO);
        }
        out.dom.q14.afterRemove = {
            masterPageItems: pg33.masterPageItems.length,
            textFrames: pg33.textFrames.length
        };
        try { out.dom.q14.afterRemove.frameStillValid = ov14.isValid; } catch (eV) { out.dom.q14.afterRemove.frameStillValid = "?" + eV; }
        try {
            out.dom.q14.afterRemove.masterItemBounds = pg33.masterPageItems[0].geometricBounds;
        } catch (eMB2) { out.dom.q14.afterRemove.masterItemBounds = null; }
        out.expected.T14 = { page: "33", want: "32-33", ifOverrideStayed: "999" };
    } catch (e14) { out.dom.q14Error = String(e14); }

    /* === ПИТАННЯ 9, ДРУГЕ КОЛО: три гіпотези замість однієї ===
     *
     * «Виграє створений раніше» узгоджувалось із W9/Z9/V9 не краще, ніж
     * (б) «виграє історія з БІЛЬШОЮ кількістю контейнерів» і (в) «виграє
     * БІЛЬША площа перекриття» — бо в тих трьох випадках рамки-претенденти
     * мали ТОТОЖНІ межі, тобто площа не варіювалась ніде, а контейнери
     * зрівнялись рівно у V9 (рецензія, Important 4).
     *
     * Це не дрібниця: фаза покладе службову рамку ТОЧНО під колонцифру, а
     * рамка основного тексту зачіпатиме її краєм — на книжці всі 7 наявних
     * контактів саме такі (`touch`).
     *
     * Два випадки розводять усі три гіпотези:
     *
     * U9 — службовий: створений ОСТАННІМ, 6 контейнерів, ТОЧНО під міткою;
     *      основний: створений раніше, 2 контейнери, зачіпає на 2 пт.
     *      (а) → основний; (б) → службовий; (в) → службовий.
     *
     * Y9 — службовий: створений ОСТАННІМ, 3 контейнери, ТОЧНО під міткою;
     *      основний: створений раніше, 6 контейнерів, зачіпає на 2 пт.
     *      (а) → основний; (б) → основний; (в) → службовий. */
    var LABEL_BOX = [80, 150, 290, 185];
    var TOUCH_BOX = [80, 183, 290, 400];   /* перетин по вертикалі рівно 2 пт */

    try {
        /* U9: основний СПЕРШУ (2 контейнери, дотик), службовий ПОТІМ (6, точно) */
        var m4 = chain(doc, [
            [40, TOUCH_BOX[0], TOUCH_BOX[1], TOUCH_BOX[2], TOUCH_BOX[3]],
            [48, TOUCH_BOX[0], TOUCH_BOX[1], TOUCH_BOX[2], TOUCH_BOX[3]]
        ]);
        var h5 = chain(doc, [
            [43, LABEL_BOX[0], LABEL_BOX[1], LABEL_BOX[2], LABEL_BOX[3]],
            [44, LABEL_BOX[0], LABEL_BOX[1], LABEL_BOX[2], LABEL_BOX[3]],
            [45, LABEL_BOX[0], LABEL_BOX[1], LABEL_BOX[2], LABEL_BOX[3]],
            [46, LABEL_BOX[0], LABEL_BOX[1], LABEL_BOX[2], LABEL_BOX[3]],
            [47, LABEL_BOX[0], LABEL_BOX[1], LABEL_BOX[2], LABEL_BOX[3]],
            [48, LABEL_BOX[0], LABEL_BOX[1], LABEL_BOX[2], LABEL_BOX[3]]
        ]);
        labelled(doc.pages[48], LABEL_BOX[0], LABEL_BOX[1], LABEL_BOX[2], LABEL_BOX[3], "U9=", SpecialCharacters.PREVIOUS_PAGE_NUMBER);
        out.expected.U9 = {
            page: "49", helper: "48", main: "41",
            predict: { created: "main", containers: "helper", area: "helper" }
        };

        /* Y9: основний СПЕРШУ (6 контейнерів, дотик), службовий ПОТІМ (3, точно) */
        var m5 = chain(doc, [
            [50, TOUCH_BOX[0], TOUCH_BOX[1], TOUCH_BOX[2], TOUCH_BOX[3]],
            [51, TOUCH_BOX[0], TOUCH_BOX[1], TOUCH_BOX[2], TOUCH_BOX[3]],
            [52, TOUCH_BOX[0], TOUCH_BOX[1], TOUCH_BOX[2], TOUCH_BOX[3]],
            [53, TOUCH_BOX[0], TOUCH_BOX[1], TOUCH_BOX[2], TOUCH_BOX[3]],
            [54, TOUCH_BOX[0], TOUCH_BOX[1], TOUCH_BOX[2], TOUCH_BOX[3]],
            [58, TOUCH_BOX[0], TOUCH_BOX[1], TOUCH_BOX[2], TOUCH_BOX[3]]
        ]);
        var h6 = chain(doc, [
            [56, LABEL_BOX[0], LABEL_BOX[1], LABEL_BOX[2], LABEL_BOX[3]],
            [57, LABEL_BOX[0], LABEL_BOX[1], LABEL_BOX[2], LABEL_BOX[3]],
            [58, LABEL_BOX[0], LABEL_BOX[1], LABEL_BOX[2], LABEL_BOX[3]]
        ]);
        labelled(doc.pages[58], LABEL_BOX[0], LABEL_BOX[1], LABEL_BOX[2], LABEL_BOX[3], "Y9=", SpecialCharacters.PREVIOUS_PAGE_NUMBER);
        out.expected.Y9 = {
            page: "59", helper: "58", main: "55",
            predict: { created: "main", containers: "main", area: "helper" }
        };
        out.dom.q9b = {
            m4Containers: m4[0].parentStory.textContainers.length,
            h5Containers: h5[0].parentStory.textContainers.length,
            m5Containers: m5[0].parentStory.textContainers.length,
            h6Containers: h6[0].parentStory.textContainers.length
        };
    } catch (e9b) { out.dom.q9bError = String(e9b); }

    /* === ПИТАННЯ 15: маркер у ПОВЕРНУТІЙ рамці ===
     * 100 % цільових рамок книжки повернуті на −90°, і жодної повернутої
     * рамки у фікстурі не було (рецензія, Important 5). Друга рамка — під
     * довільним кутом, бо саме довільний кут ламав би дводіагональний
     * `spreadBox` (виправлено на чотири кути в probe-h7-book.jsx). */
    try {
        var rc = chain(doc, [
            [60, 60, 100, 400, 500],
            [61, 60, 100, 400, 500],
            [62, 60, 100, 400, 500],
            [63, 60, 100, 400, 500]
        ]);
        var r90 = labelled(doc.pages[61], 150, 200, 350, 235, "R90=", SpecialCharacters.PREVIOUS_PAGE_NUMBER);
        r90.rotationAngle = -90;
        var r45 = labelled(doc.pages[63], 150, 200, 350, 235, "R45=", SpecialCharacters.PREVIOUS_PAGE_NUMBER);
        r45.rotationAngle = 45;
        out.dom.rotations = { r90: r90.rotationAngle, r45: r45.rotationAngle };
        out.expected.R90 = { page: "62", want: "61" };
        out.expected.R45 = { page: "64", want: "63" };
    } catch (e15) { out.dom.q15Error = String(e15); }

    /* === ПИТАННЯ 16: маркер УСЕРЕДИНІ ПЕРЕОЗНАЧЕНОГО майстрового елемента ===
     * Саме ця конфігурація стосується 62 із 91 цільових рамок книжки, і саме
     * її досі не міряли: O6 ставив мітку в ОКРЕМІЙ рамці над зламаним
     * ланцюжком, а не маркер усередині переозначеного елемента (рецензія,
     * Important 6). */
    try {
        var m16 = masterFolio("T16=");
        var h16 = chain(doc, [
            [64, FOLIO_POS[0], FOLIO_POS[1], FOLIO_POS[2], FOLIO_POS[3]],
            [65, FOLIO_POS[0], FOLIO_POS[1], FOLIO_POS[2], FOLIO_POS[3]],
            [66, FOLIO_POS[0], FOLIO_POS[1], FOLIO_POS[2], FOLIO_POS[3]]
        ]);
        out.dom.h16Pages = [];
        for (var q16 = 0; q16 < h16.length; q16++) out.dom.h16Pages.push(pageNameOf(h16[q16]));
        doc.pages[65].appliedMaster = m16.spread;
        doc.pages[66].appliedMaster = m16.spread;
        var pg67 = doc.pages[66];
        var ov16 = pg67.masterPageItems[0].override(pg67);
        out.dom.q16 = {
            overridden: ov16.overridden,
            masterPageItems: pg67.masterPageItems.length,
            textFrames: pg67.textFrames.length,
            containers: null
        };
        try { out.dom.q16.containers = ov16.parentStory.textContainers.length; } catch (eQ16) {}
        out.expected.T16 = { page: "67", want: "66-67", ifBroken: "67-67" };
    } catch (e16) { out.dom.q16Error = String(e16); }

    /* Порядок рамок на трьох спірних сторінках: чи корелює переможець із
     * порядком у page.allPageItems (він же порядок створення), а не з
     * порядком накладання, який на с.11 навмисно перевернуто. */
    out.dom.contested = {};
    var CONTESTED = [[8, "W9", h1[3].id, m[1].id], [10, "Z9", h1[5].id, m2[1].id], [24, "V9", h4[1].id, m3[1].id]];
    for (var ci = 0; ci < CONTESTED.length; ci++) {
        var cpage = doc.pages[CONTESTED[ci][0]];
        var order = [];
        var cAll = cpage.allPageItems;
        for (var cj = 0; cj < cAll.length; cj++) {
            var cp = null;
            try { cp = cAll[cj].paragraphs; } catch (eCP) { cp = null; }
            if (cp === null) continue;
            order.push(String(cAll[cj].id));
        }
        out.dom.contested[CONTESTED[ci][1]] = {
            page: String(cpage.name),
            helperId: String(CONTESTED[ci][2]),
            mainId: String(CONTESTED[ci][3]),
            allPageItemsOrder: order
        };
    }

    /* --- один експорт PDF: те, що надрукується ---
     *
     * Налаштування задаються ЯВНО і відновлюються. Без цього експорт іде
     * «останніми вжитими», а з нього виведено довготривалу вказівку про шар
     * (Питання 8): якби `exportLayers` був увімкнений, прихований шар міг би
     * потрапити в PDF і відповідь перевернулась би (рецензія, Important 9). */
    var pdfPath = Folder.temp.fsName + "/idmcp-h7-markers.pdf";
    var pe = app.pdfExportPreferences;
    var prevPE = { range: pe.pageRange, layers: pe.exportLayers, view: pe.viewPDF };
    try {
        pe.pageRange = PageRange.ALL_PAGES;
        pe.exportLayers = false;
        pe.viewPDF = false;
        out.dom.pdfPrefs = { pageRange: "ALL_PAGES", exportLayers: false, viewPDF: false };
        doc.exportFile(ExportFormat.PDF_TYPE, new File(pdfPath), false);
    } finally {
        pe.pageRange = prevPE.range;
        pe.exportLayers = prevPE.layers;
        pe.viewPDF = prevPE.view;
    }
    out.pdfPath = pdfPath;
    say("PDF експортовано: " + pdfPath);

    /* === ПИТАННЯ 12: saveACopy + шар + 196 рамок одним кроком скасування ===
     * ОКРЕМИЙ документ: 196 рамок у спільному засмітили б PDF вище. */
    doc2 = app.documents.add();
    doc2.documentPreferences.facingPages = true;
    doc2.documentPreferences.pagesPerDocument = 20;

    /* Скасування НЕ перевіряється тут: крок, який створює цей самий скрипт,
     * ще не закритий, і `doc.undo()` зсередини нього дає «Unable to undo the
     * last command» (виміряно). Документ лишається відкритим, скасування
     * робить другий виклик — рівно як користувач, що тисне Cmd+Z після
     * завершення обробника. */
    var copyPath = Folder.temp.fsName + "/idmcp-h7-copy.indd";
    var tStart = new Date().getTime();
    var tFrames = 0, tCopy = 0;
    var q12err = null;
    try {
        var lay = doc2.layers.add({ name: "_folio-helper" });
        var t1 = new Date().getTime();
        for (var i = 0; i < 196; i++) {
            var pg = doc2.pages[i % doc2.pages.length];
            var pb = pg.bounds;
            var f = pg.textFrames.add();
            f.itemLayer = lay;
            f.geometricBounds = [pb[0] + 40 + (i % 10) * 12, pb[1] + 40, pb[0] + 50 + (i % 10) * 12, pb[1] + 120];
            f.textFramePreferences.textColumnCount = 1;
        }
        tFrames = new Date().getTime() - t1;
        var t2 = new Date().getTime();
        doc2.saveACopy(new File(copyPath));
        tCopy = new Date().getTime() - t2;
    } catch (e12) {
        q12err = String(e12);
    }

    function frameTally(d) {
        var n = 0;
        for (var i = 0; i < d.pages.length; i++) n += d.pages[i].textFrames.length;
        return n;
    }
    out.q12 = {
        error: q12err,
        msFrames: tFrames,
        msSaveACopy: tCopy,
        msTotal: new Date().getTime() - tStart,
        copyExists: new File(copyPath).exists,
        framesAfterWrite: frameTally(doc2),
        layersAfterWrite: doc2.layers.length
    };
    try { out.q12.copyBytes = new File(copyPath).length; } catch (eL) { out.q12.copyBytes = null; }
    try { new File(copyPath).remove(); } catch (eR) {}
    out.q12.docName = String(doc2.name);
    doc2 = null;   /* лишаємо відкритим для другого виклику */

} catch (err) {
    /* ES3 не має return з тіла eval, тож фаза «undo» виходить киданням
     * сентинела. Це не помилка — решту тіла просто не треба виконувати. */
    if (String(err) !== "__H7_DONE__") out.error = String(err) + " @ рядок " + (err.line || "?");
} finally {
    if (doc2 !== null) {
        try { doc2.close(SaveOptions.NO); out.notes.push("документ Питання 12 закрито без збереження"); }
        catch (e4) { out.notes.push("НЕ ВДАЛОСЯ ЗАКРИТИ документ Питання 12: " + e4); }
    }
    if (doc !== null) {
        try { doc.close(SaveOptions.NO); out.notes.push("фікстуру закрито без збереження"); }
        catch (e3) { out.notes.push("НЕ ВДАЛОСЯ ЗАКРИТИ фікстуру: " + e3); }
    }
    app.scriptPreferences.measurementUnit = previousUnit;
}

__result = out;

/*
 * ПИТАННЯ 19: чи захищає замок ШАРУ рамку від запису скриптом.
 *
 * Знахідку зробила Задача 11 ненавмисно (звіт `task-11-report.md`): вона
 * інсценувала гонку замком шару, і замість гонки виміряла, що
 * `ClaimFrame.locked === false`, а запис пройшов (`applied: 1`). Тут та сама
 * поведінка міряється НАПРЯМУ й окремо від інструмента: два замки розведені в
 * чотири стани, щоб було видно, який саме з них зупиняє запис.
 *
 * ЧОТИРИ СТАНИ, А НЕ ДВА: `frame.locked` і `frame.itemLayer.locked` — різні
 * властивості різних об'єктів, і «замкнено» в InDesign означає два різні
 * замки. Мірити треба обидва порізно, інакше вимір не розрізнить «шар не
 * захищає» від «нічого не захищає».
 *
 * ДВА РІВНІ ВЗАЄМОДІЇ: бойовий обробник пише всередині `withNoInteraction`
 * (`IDMCP.withNoInteraction`, `pagination-write.jsx`), тобто при
 * `NEVER_INTERACT`. Якби замок шару зупиняв запис лише діалогом, вимір при
 * замовчуванні дав би одне, а бойовий шлях — інше. Тому кожен стан міряється
 * двічі, на власній рамці.
 *
 * ЗАПИС — ТОЙ САМИЙ, ЩО В БОЮ: `range.contents = SpecialCharacters
 * .PREVIOUS_PAGE_NUMBER` над діапазоном символів літерала
 * (`pagination-write.jsx:264`). Не `frame.contents`, не `insertionPoints`.
 *
 * УСПІХ ПЕРЕВІРЯЄТЬСЯ ПЕРЕЧИТУВАННЯМ, А НЕ ВІДСУТНІСТЮ ВИНЯТКУ: «не кинуло» і
 * «записало» — різні твердження, і плутати їх тут не можна саме тому, що
 * питання полягає в тому, чи мовчки проходить заборонена дія.
 */
var doc = app.documents.add();
var out = { cases: [], docsOpen: null };

try {
    doc.documentPreferences.facingPages = true;
    doc.documentPreferences.pagesPerDocument = 4;
    app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;

    var openLayer = doc.layers.item(0);
    openLayer.name = "L_open";
    var lockLayer = doc.layers.add();
    lockLayer.name = "L_locked";

    /*
     * Вісім рамок: чотири стани × два рівні взаємодії. Кожній рамці — власний
     * літерал, бо вдалий запис літерал знищує, і другий вимір на тій самій
     * рамці міряв би вже інший вміст.
     */
    var plan = [
        { id: "A", layer: "open", frameLock: false, interact: "default" },
        { id: "B", layer: "open", frameLock: true, interact: "default" },
        { id: "C", layer: "locked", frameLock: false, interact: "default" },
        { id: "D", layer: "locked", frameLock: true, interact: "default" },
        { id: "A2", layer: "open", frameLock: false, interact: "never" },
        { id: "B2", layer: "open", frameLock: true, interact: "never" },
        { id: "C2", layer: "locked", frameLock: false, interact: "never" },
        { id: "D2", layer: "locked", frameLock: true, interact: "never" }
    ];

    var built = [];
    var i;
    for (i = 0; i < plan.length; i++) {
        var pg = doc.pages[i % doc.pages.length];
        var b = pg.bounds;                 /* [y1, x1, y2, x2] у координатах розвороту */
        var y1 = b[0] + 40 + (Math.floor(i / doc.pages.length) * 40);
        var x1 = b[1] + 40;
        var f = pg.textFrames.add();
        f.geometricBounds = [y1, x1, y1 + 24, x1 + 120];
        f.itemLayer = (plan[i].layer === "locked") ? lockLayer : openLayer;
        f.contents = "42";
        built.push({ spec: plan[i], frame: f });
    }

    /* Замки — ПІСЛЯ побудови: на замкнений шар рамку не покладеш. */
    lockLayer.locked = true;
    for (i = 0; i < built.length; i++) {
        if (built[i].spec.frameLock) built[i].frame.locked = true;
    }

    for (i = 0; i < built.length; i++) {
        var frame = built[i].frame;
        var spec = built[i].spec;

        var frameLocked = null;
        try { frameLocked = frame.locked === true; } catch (eF) { frameLocked = "ПОМИЛКА: " + String(eF.message); }
        var layerName = null;
        var layerLocked = null;
        try {
            var lay = frame.itemLayer;
            layerName = String(lay.name);
            layerLocked = lay.locked === true;
        } catch (eL) { layerLocked = "ПОМИЛКА: " + String(eL.message); }

        var before = String(frame.paragraphs[0].contents);

        var previousLevel = app.scriptPreferences.userInteractionLevel;
        if (spec.interact === "never") {
            app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;
        }
        var threw = null;
        try {
            var para = frame.paragraphs[0];
            var range = para.characters.itemByRange(0, 1);
            range.contents = SpecialCharacters.PREVIOUS_PAGE_NUMBER;
        } catch (eW) {
            threw = String(eW.message);
        }
        app.scriptPreferences.userInteractionLevel = previousLevel;

        /* Перечитуємо: «не кинуло» ще не означає «записало». */
        var after = null;
        try { after = String(frame.paragraphs[0].contents); } catch (eR) { after = "ПОМИЛКА ЧИТАННЯ: " + String(eR.message); }

        out.cases.push({
            id: spec.id,
            layerWanted: spec.layer,
            frameLockWanted: spec.frameLock,
            interaction: spec.interact,
            layerName: layerName,
            frameLocked: frameLocked,
            layerLocked: layerLocked,
            textBefore: before,
            threw: threw,
            textAfter: after,
            wrote: (after !== before)
        });
    }
} finally {
    /* БЕЗ ЗБЕРЕЖЕННЯ — і замків знімати не треба: документ тимчасовий, на
     * диску його не було. */
    doc.close(SaveOptions.NO);
}

out.docsOpen = app.documents.length;
__result = out;

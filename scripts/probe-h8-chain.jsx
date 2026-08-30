/*
 * ЗОНД H8 — ВИМІР ПЕРЕД КОДОМ ФАЗИ 8 (спек §8.1).
 *
 * Сім питань про РЕМОНТ службового ланцюжка. Три з них є ГЕЙТАМИ плану: від
 * Питання 1 залежить, чи народиться дефект `folio-helper-chain-split`; від
 * Питання 3 — форма перезшивання в обробнику ремонту; від Питання 4 — чи не
 * робить ремонт службовий ланцюжок СТАРШИМ за основний (переможця InDesign
 * обирає саме за `story.id`, Питання 9 Фази 7).
 *
 * НІЧОГО НЕ ЧИТАЄ З ДОКУМЕНТІВ КОРИСТУВАЧА. Кожне питання працює на власному
 * документі, і кожен документ закривається ОДРАЗУ, у `finally`, а не наприкінці
 * прогону.
 *
 * МЕЖІ РАМОК — ВІД `page.bounds` СВОЄЇ СТОРІНКИ, а не числами: при
 * `facingPages` рамка, задана абсолютними координатами, лягає геометрично на
 * СУСІДНЮ сторінку. Це не побоювання — на цьому спіткнулась перша редакція
 * зонда Питання 18, і той самий клас помилки вже коштував блокера Задачі 3.
 */
var out = { q1: null, q2: null, q3: null, q4: null, q5: null, q6: null, q7: null };

app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;

var HELPER = "_folio-helper";

/* Прямокутник у верхньому внутрішньому кутку сторінки, сота частина в кожен бік. */
function cornerBox(page) {
    var b = page.bounds;
    var y1 = Math.min(Number(b[0]), Number(b[2])), y2 = Math.max(Number(b[0]), Number(b[2]));
    var x1 = Math.min(Number(b[1]), Number(b[3])), x2 = Math.max(Number(b[1]), Number(b[3]));
    return [y1 + 20, x1 + 20, y1 + 44, x1 + 140];
}

function newDoc(pages) {
    var d = app.documents.add();
    d.documentPreferences.facingPages = true;
    d.documentPreferences.pagesPerDocument = pages;
    while (d.pages.length < pages) d.pages.add();
    return d;
}

/* Службовий шар із прапорцями §4.8: видимий, непридатний до друку. */
function helperLayerOf(doc) {
    var layer = doc.layers.add({ name: HELPER });
    layer.visible = true;
    layer.printable = false;
    /* `doc.layers.add` робить шар активним, а `textFrames.add()` кладе рамку
     * саме на активний — виставляємо явно, бо на цьому вже спіткнулись. */
    doc.activeLayer = layer;
    return layer;
}

function helperOn(layer, page) {
    var f = page.textFrames.add();
    f.itemLayer = layer;
    f.geometricBounds = cornerBox(page);
    f.textWrapPreferences.textWrapMode = TextWrapModes.NONE;
    return f;
}

/* Ланцюжок на КОЖНІЙ сторінці — контракт §4.2 Фази 7. */
function buildChain(doc) {
    var layer = helperLayerOf(doc);
    var frames = [];
    var prev = null;
    for (var i = 0; i < doc.pages.length; i++) {
        var f = helperOn(layer, doc.pages[i]);
        if (prev !== null) prev.nextTextFrame = f;
        prev = f;
        frames.push(f);
    }
    return { layer: layer, frames: frames };
}

/* Скільки різних історій лежить на шарі, і скільки рамок. */
function layerShape(doc, layer) {
    var ids = {}, list = [], n = 0, perPage = [];
    var items = layer.pageItems;
    for (var i = 0; i < items.length; i++) {
        n++;
        try {
            var sid = String(items[i].parentStory.id);
            if (ids[sid] !== true) { ids[sid] = true; list.push(sid); }
        } catch (eS) { }
    }
    for (var p = 0; p < doc.pages.length; p++) {
        var c = 0;
        var pit = doc.pages[p].allPageItems;
        for (var j = 0; j < pit.length; j++) {
            try { if (String(pit[j].itemLayer.name) === HELPER) c++; } catch (eL) { }
        }
        perPage.push({ page: String(doc.pages[p].name), helperFrames: c });
    }
    return { framesOnLayer: n, storyIds: list, pages: doc.pages.length, perPage: perPage };
}

/* --- ПИТАННЯ 1: видалення сторінки з СЕРЕДИНИ ---------------------------- */
var d1 = newDoc(8);
try {
    var c1 = buildChain(d1);
    var before1 = layerShape(d1, c1.layer);
    d1.pages[3].remove();
    out.q1 = { before: before1, after: layerShape(d1, c1.layer) };
} finally { d1.close(SaveOptions.NO); }

/* --- ПИТАННЯ 2: дублювання сторінки -------------------------------------- */
var d2 = newDoc(8);
try {
    var c2 = buildChain(d2);
    var before2 = layerShape(d2, c2.layer);
    d2.pages[2].duplicate(LocationOptions.AFTER, d2.pages[2]);
    out.q2 = { before: before2, after: layerShape(d2, c2.layer) };
} finally { d2.close(SaveOptions.NO); }

/* --- ПИТАННЯ 3 і 4: перезшивання ВЖЕ ЗШИТОЇ рамки ------------------------ */
var d3 = newDoc(6);
try {
    var c3 = buildChain(d3);
    var f3 = c3.frames;

    var storyBefore = String(f3[0].parentStory.id);
    var containersBefore = f3[0].parentStory.textContainers.length;

    /* Переставляємо ланки: 0 → 2 → 1 → 3 → 4 → 5. Питання саме в тому, чи
     * присвоєння `nextTextFrame` вже зшитій рамці ПЕРЕСТАВЛЯЄ ланку, чи РВЕ
     * ланцюжок надвоє. */
    var threadError = null;
    try {
        f3[0].nextTextFrame = f3[2];
        f3[2].nextTextFrame = f3[1];
        f3[1].nextTextFrame = f3[3];
    } catch (eT) { threadError = String(eT.message || eT); }

    var order = [];
    var cs = f3[0].parentStory.textContainers;
    for (var i3 = 0; i3 < cs.length; i3++) {
        var pp3 = null;
        try { pp3 = cs[i3].parentPage; } catch (eP3) { pp3 = null; }
        order.push(pp3 === null || pp3 === undefined ? null : String(pp3.name));
    }

    out.q3 = {
        threadError: threadError,
        containersBefore: containersBefore,
        containersAfter: cs.length,
        pageOrderAfter: order,
        shape: layerShape(d3, c3.layer)
    };
    out.q4 = {
        storyBefore: storyBefore,
        storyAfter: String(f3[0].parentStory.id),
        changed: storyBefore !== String(f3[0].parentStory.id)
    };
} finally { d3.close(SaveOptions.NO); }

/* --- ПИТАННЯ 5: приховати шар і повернути -------------------------------- */
var d5 = newDoc(4);
try {
    var c5 = buildChain(d5);
    c5.layer.visible = false;
    var hidden5 = c5.layer.visible === true;
    c5.layer.visible = true;
    out.q5 = { afterHide: hidden5, afterShow: c5.layer.visible === true };
} finally { d5.close(SaveOptions.NO); }

/* --- ПИТАННЯ 7: ціна проходу по шару ------------------------------------- */
/*
 * Спек §4.1 містить ПРИКИДКУ «порядок мілісекунд». Global Constraints
 * забороняють лишати прикидку в документі, тож міряємо той самий обхід, який
 * робитиме `IDMCP.measureHelperChain`: рамки шару, їхні сторінки й позиція в
 * історії.
 */
var d7 = newDoc(24);
try {
    var c7 = buildChain(d7);
    var t0 = new Date().getTime();
    var probeShape = null;
    for (var rep = 0; rep < 5; rep++) {
        var pageIndexById = {};
        for (var pi7 = 0; pi7 < d7.pages.length; pi7++) pageIndexById[String(d7.pages[pi7].id)] = pi7;
        var seen = {}, cnt = 0;
        var it7 = c7.layer.pageItems;
        for (var k7 = 0; k7 < it7.length; k7++) {
            cnt++;
            try {
                var h7 = it7[k7].parentPage;
                if (h7 !== null && h7 !== undefined) seen[pageIndexById[String(h7.id)]] = true;
                var st7 = it7[k7].parentStory;
                var cc7 = st7.textContainers;
                for (var z7 = 0; z7 < cc7.length; z7++) { if (String(cc7[z7].id) === String(it7[k7].id)) break; }
            } catch (e7) { }
        }
        probeShape = cnt;
    }
    var t1 = new Date().getTime();
    out.q7 = { pages: d7.pages.length, framesSeen: probeShape, msFor5Passes: t1 - t0 };
} finally { d7.close(SaveOptions.NO); }

__result = out;

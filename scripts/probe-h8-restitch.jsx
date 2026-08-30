/*
 * ЗОНД H8, ДРУГЕ КОЛО — ЯК САМЕ ПЕРЕЗШИВАТИ.
 *
 * Перше коло виміряло, що присвоєння `nextTextFrame` ВЖЕ ЗШИТІЙ рамці кидає
 * «Invalid object for this request.» і ланцюжка не міняє (Питання 3). Отже
 * форма кроку 3 ремонту, як її описував план, неможлива, і треба виміряти
 * робочу.
 *
 * Друге коло ставить чотири питання:
 *   3б — чим розшивається ланцюжок і чи можна після цього зшити наново;
 *   4б — чи переживає `story.id` розшивання (це `createdOrder`, яким InDesign
 *        обирає переможця — Питання 9 Фази 7);
 *   2б — що станеться з ланцюжком, якщо докласти ЗАЙВУ рамку дублюванням
 *        сторінки, а потім спробувати вшити її в ланцюжок;
 *   7б — ціна ЛІНІЙНОГО проходу (перше коло міряло квадратичний і дало 75 мс
 *        на 24 сторінках, що для 196 екстраполюється в секунди).
 */
var out = { q3b: null, q4b: null, q2b: null, q7b: null };

app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;
var HELPER = "_folio-helper";

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

function helperLayerOf(doc) {
    var layer = doc.layers.add({ name: HELPER });
    layer.visible = true;
    layer.printable = false;
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

function buildChain(doc) {
    var layer = helperLayerOf(doc);
    var frames = [], prev = null;
    for (var i = 0; i < doc.pages.length; i++) {
        var f = helperOn(layer, doc.pages[i]);
        if (prev !== null) prev.nextTextFrame = f;
        prev = f;
        frames.push(f);
    }
    return { layer: layer, frames: frames };
}

/* Порядок сторінок у КОЖНІЙ історії шару — саме те, що читатиме детектор. */
function chainOrder(doc, layer) {
    var stories = {}, list = [];
    var items = layer.pageItems;
    for (var i = 0; i < items.length; i++) {
        var sid;
        try { sid = String(items[i].parentStory.id); } catch (eS) { continue; }
        if (stories[sid] === undefined) { stories[sid] = items[i]; list.push(sid); }
    }
    var outp = [];
    for (var k = 0; k < list.length; k++) {
        var cs = stories[list[k]].parentStory.textContainers;
        var pages = [];
        for (var c = 0; c < cs.length; c++) {
            var pp = null;
            try { pp = cs[c].parentPage; } catch (eP) { pp = null; }
            pages.push(pp === null || pp === undefined ? null : String(pp.name));
        }
        outp.push({ storyId: list[k], containers: cs.length, pages: pages });
    }
    return outp;
}

/* --- ПИТАННЯ 3б і 4б: розшити й зшити наново ------------------------------ */
var d3 = newDoc(6);
try {
    var c3 = buildChain(d3);
    var f3 = c3.frames;
    var storyBefore = String(f3[0].parentStory.id);
    var orderBefore = chainOrder(d3, c3.layer);

    /*
     * СПРОБА А: розшити через `nextTextFrame = null` на кожній рамці.
     * У InDesign це штатний спосіб розірвати нитку; чи спрацює він на
     * ПОРОЖНІХ рамках і чи не знищить самі рамки — саме те, що міряємо.
     */
    var unthreadError = null;
    try {
        for (var u = 0; u < f3.length; u++) {
            if (f3[u].nextTextFrame !== null) f3[u].nextTextFrame = null;
        }
    } catch (eU) { unthreadError = String(eU.message || eU); }

    var afterUnthread = chainOrder(d3, c3.layer);
    var framesAlive = 0;
    for (var a = 0; a < f3.length; a++) {
        try { if (f3[a].isValid === true) framesAlive++; } catch (eA) { }
    }

    /* Тепер зшиваємо НАНОВО, у зворотному порядку сторінок — щоб було видно,
     * що порядок справді ставимо ми, а не InDesign. */
    var restitchError = null;
    try {
        for (var s = f3.length - 1; s > 0; s--) {
            f3[s].nextTextFrame = f3[s - 1];
        }
    } catch (eR) { restitchError = String(eR.message || eR); }

    out.q3b = {
        unthreadError: unthreadError,
        restitchError: restitchError,
        framesAlive: framesAlive,
        orderBefore: orderBefore,
        afterUnthread: afterUnthread,
        afterRestitch: chainOrder(d3, c3.layer)
    };

    var storyAfter = null;
    try { storyAfter = String(f3[0].parentStory.id); } catch (eS2) { storyAfter = null; }
    out.q4b = { storyBefore: storyBefore, storyAfter: storyAfter, changed: storyBefore !== storyAfter };
} finally { d3.close(SaveOptions.NO); }

/* --- ПИТАННЯ 2б: чи можна вшити рамку-копію в наявний ланцюжок ------------ */
var d2 = newDoc(6);
try {
    var c2 = buildChain(d2);
    var beforeDup = chainOrder(d2, c2.layer);
    d2.pages[2].duplicate(LocationOptions.AFTER, d2.pages[2]);
    var afterDup = chainOrder(d2, c2.layer);

    /* Знайти рамку-одинака (свою історію з одним контейнером) і спробувати
     * вшити її між сусідами БЕЗ попереднього розшивання — тобто рівно те, що
     * Питання 3 уже заборонило, але тепер на рамці, яка сама ні до чого не
     * зшита. Це окремий стан: `nextTextFrame` цільової рамки НЕ зайнятий. */
    var loneFrame = null;
    var it2 = c2.layer.pageItems;
    for (var i2 = 0; i2 < it2.length; i2++) {
        try { if (it2[i2].parentStory.textContainers.length === 1) { loneFrame = it2[i2]; break; } } catch (e2) { }
    }
    var joinError = null;
    if (loneFrame !== null) {
        try {
            /* Вшиваємо ЯК ХВІСТ до останньої рамки головного ланцюжка:
             * `nextTextFrame` у неї порожній, тож заборони Питання 3 тут немає. */
            var main = null;
            for (var m2 = 0; m2 < it2.length; m2++) {
                try {
                    var st = it2[m2].parentStory;
                    if (st.textContainers.length > 1) { main = st; break; }
                } catch (e3) { }
            }
            var tail = main.textContainers[main.textContainers.length - 1];
            tail.nextTextFrame = loneFrame;
        } catch (eJ) { joinError = String(eJ.message || eJ); }
    }

    out.q2b = {
        beforeDup: beforeDup,
        afterDup: afterDup,
        loneFrameFound: loneFrame !== null,
        joinError: joinError,
        afterJoin: chainOrder(d2, c2.layer)
    };
} finally { d2.close(SaveOptions.NO); }

/* --- ПИТАННЯ 7б: ЛІНІЙНИЙ прохід ----------------------------------------- */
/*
 * Перше коло міряло КВАДРАТИЧНИЙ обхід (для кожної рамки — цикл по всіх
 * контейнерах історії) і дало 75 мс на 24 сторінках. Тут той самий вимір
 * робиться лінійно: контейнери історії обходяться ОДИН раз, позиція
 * записується в таблицю за `id`.
 */
var d7 = newDoc(100);
try {
    var c7 = buildChain(d7);

    var tq0 = new Date().getTime();
    var quadCount = 0;
    var itq = c7.layer.pageItems;
    for (var q = 0; q < itq.length; q++) {
        try {
            var cq = itq[q].parentStory.textContainers;
            for (var z = 0; z < cq.length; z++) { quadCount++; if (String(cq[z].id) === String(itq[q].id)) break; }
        } catch (eQ) { }
    }
    var tq1 = new Date().getTime();

    var tl0 = new Date().getTime();
    var orderById = {};
    var seenStory = {};
    var itl = c7.layer.pageItems;
    for (var l = 0; l < itl.length; l++) {
        var sidl;
        try { sidl = String(itl[l].parentStory.id); } catch (eL) { continue; }
        if (seenStory[sidl] === true) continue;
        seenStory[sidl] = true;
        var csl = itl[l].parentStory.textContainers;
        for (var y = 0; y < csl.length; y++) orderById[String(csl[y].id)] = y;
    }
    var linCount = 0;
    for (var n = 0; n < itl.length; n++) {
        try { if (orderById[String(itl[n].id)] !== undefined) linCount++; } catch (eN) { }
    }
    var tl1 = new Date().getTime();

    out.q7b = {
        pages: d7.pages.length,
        quadraticMs: tq1 - tq0, quadraticSteps: quadCount,
        linearMs: tl1 - tl0, linearResolved: linCount
    };
} finally { d7.close(SaveOptions.NO); }

__result = out;

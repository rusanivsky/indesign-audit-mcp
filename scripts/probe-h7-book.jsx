/* Зонд H7, Питання 1–3 (спек Фази 7 §6).
 *
 * ЛИШЕ ЧИТАННЯ. Жодного присвоєння властивості документа, жодного add()/
 * remove()/override()/save()/close(). Єдине присвоєння у скрипті —
 * app.scriptPreferences.measurementUnit (налаштування ЗАСТОСУНКУ, не
 * документа), і воно відновлюється у finally. `doc.modified` міряється до й
 * після, і обидва числа їдуть у звіт.
 *
 * Документ адресується ЯВНО за назвою через app.documents.itemByName, а не
 * через app.activeDocument: правило [[indesign-live-document-safety]].
 *
 * ПИТАННЯ 1. Повний розподіл УСІХ рамок колонцифри по recto/verso. Фаза 6
 * зробила висновок «усі на recto» зі ЗРІЗАНОГО переліку у 20 сторінок
 * (`pagesTruncated: {shown: 20, total: 91}`) — решти 71 ніхто не бачив.
 *
 * ПИТАННЯ 2. Напрямок діапазону: ручне число ліворуч чи праворуч від
 * автомаркера. Підтверджує значення `folio.range` для ЦІЄЇ книжки (§4.3), а
 * не породжує правило.
 *
 * ПИТАННЯ 3. Покриття маршруту A: на скількох рамках сусід ланцюжка лежить
 * саме на очікуваній сторінці. Очікувана сторінка НЕ виводиться з конвенції
 * верстки — вона дорівнює САМОМУ РУЧНОМУ ЧИСЛУ («6–⟨маркер⟩» на с. 7 означає
 * «маркер має розв'язатись на сторінку 6»). Це той самий оракул, що в §4.4
 * крок 5, і він не питає ні параметра, ні константи.
 *
 * ОБХІД ТІЛЬКИ ПО allPageItems. `page.textFrames` не бачить прив'язаних
 * рамок — 1 проти 9 на с. 8 цієї книжки (Фаза 6). Використовується
 * IDMCP.pageTextFrames — рівно той прохід, яким міряє сам інструмент.
 */

var previousUnit = app.scriptPreferences.measurementUnit;
app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;

var out = { notes: [], q1: {}, q2: {}, q3: {}, frames: [], anomalies: [] };
function say(s) { out.notes.push(String(s)); }

/* Версія застосунку — у результат, а не лише в голову того, хто міряв.
 * Без неї числа зонда не відтворювані (рецензія, Important 9). */
out.app = { version: String(app.version), name: String(app.name) };

var SPECIALS = [
    ["auto-page-number", SpecialCharacters.AUTO_PAGE_NUMBER],
    ["section-marker", SpecialCharacters.SECTION_MARKER],
    ["next-page-number", SpecialCharacters.NEXT_PAGE_NUMBER],
    ["previous-page-number", SpecialCharacters.PREVIOUS_PAGE_NUMBER]
];

/* Порівняння ІДЕНТИЧНІСТЮ: String(ch.contents) для автомаркера дає рядок
 * "AUTO_PAGE_NUMBER" (виміряно Фазою 4), тож порівняння через String
 * випадково працює для одного маркера й тихо ламається на інших. */
function classifyChar(ch) {
    for (var i = 0; i < SPECIALS.length; i++) {
        if (ch.contents === SPECIALS[i][1]) return SPECIALS[i][0];
    }
    return null;
}

function styleNameOf(para) {
    try { return String(para.appliedParagraphStyle.name); } catch (e) { return null; }
}

/* Текстові рамки сторінки ВКЛЮЧНО З ПРИВ'ЯЗАНИМИ. Дублює
 * IDMCP.pageTextFrames навмисно: зонд не має мовчки залежати від того, чи
 * завантажився pagination.jsx у цьому виклику. */
function pageTextFrames(page) {
    var res = [];
    var all;
    try { all = page.allPageItems; } catch (eA) { return res; }
    for (var i = 0; i < all.length; i++) {
        var item = all[i];
        var paras = null;
        try { paras = item.paragraphs; } catch (eP) { paras = null; }
        if (paras === null) continue;
        var count = -1;
        try { count = paras.length; } catch (eC) { count = -1; }
        if (count < 0) continue;
        res.push(item);
    }
    return res;
}

/* Межі в координатах РОЗВОРОТУ.
 *
 * geometricBounds прив'язаної рамки лежать не в тій самій системі, що в
 * окремо поставленої, а перекриття — це саме геометрія. resolve() дає
 * однакову систему для обох. geometricBounds теж записуємо, щоб було видно,
 * де вони розходяться. */
function spreadBox(item) {
    try {
        /* ЧОТИРИ кути, не два. Перша редакція брала [0,0] і [1,1]; для −90°
         * діагональ ще збігається з охоплюючим прямокутником, а для довільного
         * кута два кути ЗАНИЖУЮТЬ його — і книжка з фоліо під 45° мовчки дала б
         * «перекриття немає».
         *
         * ПОХОДЖЕННЯ: знайдено ЧИТАННЯМ КОДУ за наводкою Important 5, а не
         * контролем — контроль тодішньої редакції цієї гілки не мав узагалі.
         * Гілку, що справді розрізняє два кути від чотирьох, додано пізніше
         * (фаза `build-control`, сторінка 15), і без неї регресія назад на два
         * кути пройшла б зеленою.
         *
         * На цій книжці різниця виміряна й дорівнює НУЛЮ вердиктів — див.
         * `twoCornerDiff`, який рахує обидва варіанти поруч. */
        var corners = [[0, 0], [1, 0], [0, 1], [1, 1]];
        var xs = [], ys = [];
        for (var c = 0; c < corners.length; c++) {
            var pt = item.resolve([corners[c], BoundingBoxLimits.OUTER_STROKE_BOUNDS], CoordinateSpaces.SPREAD_COORDINATES)[0];
            xs.push(pt[0]);
            ys.push(pt[1]);
        }
        var minX = xs[0], maxX = xs[0], minY = ys[0], maxY = ys[0];
        for (var k = 1; k < xs.length; k++) {
            if (xs[k] < minX) minX = xs[k];
            if (xs[k] > maxX) maxX = xs[k];
            if (ys[k] < minY) minY = ys[k];
            if (ys[k] > maxY) maxY = ys[k];
        }
        return { x1: minX, y1: minY, x2: maxX, y2: maxY, from: "resolve" };
    } catch (e) {
        try {
            var g = item.geometricBounds; /* [y1, x1, y2, x2] */
            return { x1: g[1], y1: g[0], x2: g[3], y2: g[2], from: "geometricBounds" };
        } catch (e2) { return null; }
    }
}

/* СТАРИЙ, ДВОКУТОВИЙ варіант — лишений НАВМИСНО, як вимірювальний еталон.
 *
 * Твердження «на числах книжки вада не позначилась» не можна доводити
 * міркуванням про кути: `overlapKind` бере ДВА прямокутники, і кут другого
 * зонд ніде не записує. Тому обидва варіанти рахуються поруч і різниця
 * МІРЯЄТЬСЯ (рецензія, НД-1). */
function spreadBox2(item) {
    try {
        var tl = item.resolve([[0, 0], BoundingBoxLimits.OUTER_STROKE_BOUNDS], CoordinateSpaces.SPREAD_COORDINATES)[0];
        var br = item.resolve([[1, 1], BoundingBoxLimits.OUTER_STROKE_BOUNDS], CoordinateSpaces.SPREAD_COORDINATES)[0];
        return {
            x1: Math.min(tl[0], br[0]), y1: Math.min(tl[1], br[1]),
            x2: Math.max(tl[0], br[0]), y2: Math.max(tl[1], br[1]),
            from: "resolve2"
        };
    } catch (e) {
        /* ТОЙ САМИЙ відкат, що в spreadBox. Без нього на документі, де
         * resolve() десь падає, `spreadBox` віддавав би geometricBounds, а
         * `spreadBox2` — null, і `twoCornerDiff` рахував би РІЗНИЦЮ ПРИЛАДІВ як
         * розбіжність формул. Для цієї книжки різниці немає (`boxSource` =
         * {"resolve": 91}), але «0» має означати «формули збігаються», а не
         * «одна з них мовчки не порахувалась». */
        try {
            var g = item.geometricBounds; /* [y1, x1, y2, x2] */
            return { x1: g[1], y1: g[0], x2: g[3], y2: g[2], from: "geometricBounds" };
        } catch (e2) { return null; }
    }
}

/* Перекриття. TOUCH — дотик зарахований (документація Adobe каже про
 * «touches or overlaps»); STRICT — площа перетину додатна. Обидва числа
 * їдуть у звіт, щоб не довелось вгадувати, яке з них має значення. */
function overlapKind(a, b) {
    if (a === null || b === null) return null;
    var EPS = 0.01;
    if (a.x2 < b.x1 - EPS || b.x2 < a.x1 - EPS || a.y2 < b.y1 - EPS || b.y2 < a.y1 - EPS) return null;
    if (a.x2 <= b.x1 + EPS || b.x2 <= a.x1 + EPS || a.y2 <= b.y1 + EPS || b.y2 <= a.y1 + EPS) return "touch";
    return "strict";
}

function pageNameOfFrame(frame) {
    try {
        var p = frame.parentPage;
        if (p === null || p === undefined) return null;
        return String(p.name);
    } catch (e) { return null; }
}

function sideOf(page) {
    try {
        if (page.side === PageSideOptions.RIGHT_HAND) return "recto";
        if (page.side === PageSideOptions.LEFT_HAND) return "verso";
        return "single";
    } catch (e) { return "?"; }
}

/* Абзац із ЗСУВАМИ. Зсув літерала потрібен Задачі 8: обробник запису мусить
 * шукати число за тим самим виміром, на якому побудований оракул, а не
 * самостійно й незалежно (§4.1).
 *
 * ЗСУВІВ ДВА, І ЦЕ НЕ НАДЛИШКОВІСТЬ. `offset` — позиція в зібраному РЯДКУ,
 * `charOffset` — індекс СИМВОЛА в абзаці. Вони розходяться, бо не лише
 * маркери, а й типографські символи віддають із contents НАЗВУ
 * ПЕРЕРАХУВАННЯ: у цій книжці колонцифра «6–⟨маркер⟩» збирається в рядок
 * "6EN_DASH￼" — один символ довжиною вісім. Адресувати
 * `para.characters.itemByRange` рядковим зсувом означало б переписати не той
 * символ. */
function readParagraph(para, index) {
    var text = "";
    var markers = [];
    var charAt = [];   /* charAt[i] — індекс символа, з якого почався text[i] */
    var chars = para.characters;
    for (var i = 0; i < chars.length; i++) {
        var kind = classifyChar(chars[i]);
        var piece = kind === null ? String(chars[i].contents) : "￼";
        if (kind !== null) markers.push({ kind: kind, offset: text.length, charOffset: i });
        for (var c = 0; c < piece.length; c++) charAt.push(i);
        text += piece;
    }
    var literals = [];
    var re = /\d+/g;
    var m;
    while ((m = re.exec(text)) !== null) {
        literals.push({
            value: parseInt(m[0], 10),
            offset: m.index,
            charOffset: charAt.length > m.index ? charAt[m.index] : null,
            length: m[0].length
        });
    }
    return {
        index: index,
        styleName: styleNameOf(para),
        text: text,
        literals: literals,
        markers: markers
    };
}

/* Відстань між прямокутниками, 0 при перекритті. КОНТРОЛЬ до Питання 3:
 * «перекриття немає» без відстані — це твердження, яке нічим не підперте, і
 * зламаний вимір виглядав би точно так само. */
function gapBetween(a, b) {
    if (a === null || b === null) return null;
    var dx = Math.max(0, Math.max(a.x1 - b.x2, b.x1 - a.x2));
    var dy = Math.max(0, Math.max(a.y1 - b.y2, b.y1 - a.y2));
    return Math.sqrt(dx * dx + dy * dy);
}

/* Межі, ЗВЕДЕНІ ДО СТОРІНКИ, на якій лежить елемент.
 *
 * Потрібні, щоб порівняти документну рамку з майстровим елементом: майстровий
 * повертає межі в системі МАЙСТРОВОГО РОЗВОРОТУ, документний — у системі свого.
 * Початок відліку лінійки — документне налаштування, якого на чужій книжці
 * міняти не можна, тож віднімаємо `page.bounds`: різниця від початку відліку
 * не залежить. */
function pageRelBounds(item) {
    try {
        var gb = item.geometricBounds;      /* [y1, x1, y2, x2] */
        var pb = item.parentPage.bounds;
        return [gb[0] - pb[0], gb[1] - pb[1], gb[2] - pb[0], gb[3] - pb[1]];
    } catch (e) { return null; }
}

/* Оберіг тимчасових документів: закривати вільно можна лише те, що зонд сам
 * і створив. Назва документа користувача ніколи не починається з «Untitled»
 * (рецензія, Important 7). */
function assertTemporary(d) {
    var nm = String(d.name);
    if (nm.indexOf("Untitled") !== 0) {
        throw new Error("ВІДМОВА: «" + nm + "» не є тимчасовим документом зонда");
    }
    return d;
}

try {
    /* ФАЗА «close»: прибирання контрольної фікстури. */
    if (params.phase === "close") {
        var dc = app.documents.itemByName(params.docName);
        if (!dc.isValid) { say("документа «" + params.docName + "» уже нема"); }
        else {
            assertTemporary(dc);
            dc.close(SaveOptions.NO);
            say("контрольну фікстуру закрито без збереження");
        }
        app.scriptPreferences.measurementUnit = previousUnit;
        __result = out;
        throw "__H7_DONE__";
    }

    /* ФАЗА «build-control»: ПОЗИТИВНИЙ КОНТРОЛЬ до Питання 3.
     *
     * На книжці `covered` вийшло 0, `threadedOverlaps` — {"0": 91}, тобто гілка
     * «сусід → сторінка → звірка з оракулом» не виконалась ЖОДНОГО разу.
     * Помилка саме в цій гілці дала б ті самі числа, і відстані її не ловлять.
     * Тому той САМИЙ код проганяється по фікстурі, де перекриття й сусіди
     * свідомо є, з наперед відомим `covered` (рецензія, Important 3). */
    if (params.phase === "build-control") {
        var cd = app.documents.add();
        cd.documentPreferences.facingPages = true;
        /* Формат задано ЯВНО: успадкований від типового документа користувача
         * зробив би фікстуру невідтворюваною (рецензія, Important 9). */
        cd.documentPreferences.pageWidth = 612;
        cd.documentPreferences.pageHeight = 792;
        cd.documentPreferences.pagesPerDocument = 16;
        var cLayer = cd.layers[0];
        var cStyle = cd.paragraphStyles.add({ name: params.styleName });

        function cFrame(idx, x1, y1, x2, y2) {
            var pg = cd.pages[idx];
            var b = pg.bounds;
            var f = pg.textFrames.add();
            try { f.itemLayer = cLayer; } catch (eC1) {}
            f.geometricBounds = [b[0] + y1, b[1] + x1, b[0] + y2, b[1] + x2];
            return f;
        }
        /* Ланцюжок по сторінках 2…11 — сусід завжди на сусідній сторінці. */
        var cChain = [];
        for (var ci2 = 1; ci2 <= 10; ci2++) cChain.push(cFrame(ci2, 60, 100, 400, 500));
        for (var cj2 = 0; cj2 + 1 < cChain.length; cj2++) cChain[cj2].nextTextFrame = cChain[cj2 + 1];
        var cFill = "";
        for (var cf = 0; cf < 600; cf++) cFill += "Текст ланцюжка без цифр. ";
        cChain[0].parentStory.contents = cFill;

        /* Окрема НЕзчеплена рамка для випадку «перекриває, але не ланцюжок».
         * Свідомо на сторінці 12 — ЗА межами ланцюжка (2…11). Перша редакція
         * поклала її на сторінку 11, де ланцюжкова рамка теж є, і фікстура
         * дала `covered` замість `overlapNoThread`: контроль спіймав помилку
         * САМОГО КОНТРОЛЮ, ще до того, як щось стверджувати про книжку. */
        var cLone = cFrame(11, 60, 100, 400, 500);
        cLone.contents = "Окрема історія без ланцюжка.";

        function cFolio(idx, literal, rot, x1, y1, x2, y2) {
            var f = cFrame(idx, x1, y1, x2, y2);
            f.contents = String(literal);
            f.insertionPoints[-1].contents = SpecialCharacters.AUTO_PAGE_NUMBER;
            f.paragraphs[0].appliedParagraphStyle = cStyle;
            f.texts[0].pointSize = 10;
            if (rot !== 0) f.rotationAngle = rot;
            return f;
        }
        /* Кожен рядок — окрема гілка лічильника Питання 3. Кут повороту
         * навмисно різний: −90° повторює книжку, 45° перевіряє, що поворот сам
         * по собі покриття не ламає. МЕЖУ `spreadBox` ці рамки НЕ перевіряють —
         * вони лежать цілком усередині ланцюжкової, тож два кути й чотири дають
         * однаковий вердикт. За межу відповідає окремий блок на с. 15. */
        cFolio(2, 2, 0, 150, 150, 350, 185);      /* с.3  → covered */
        cFolio(4, 4, -90, 150, 150, 350, 185);    /* с.5  → covered, поворот −90 */
        cFolio(6, 6, 45, 150, 150, 350, 185);     /* с.7  → covered, поворот 45 */
        cFolio(5, 7, 0, 150, 150, 350, 185);      /* с.6 verso, напрямок next → covered */
        cFolio(8, 5, 0, 150, 150, 350, 185);      /* с.9  → сусід не на тій сторінці */
        cFolio(11, 11, 0, 150, 150, 350, 185);    /* с.12 → перекриває, але не ланцюжок */
        cFolio(12, 12, 0, 150, 150, 350, 185);    /* с.13 → без перекриття */

        /* ГІЛКА, ЯКА СПРАВДІ РОЗРІЗНЯЄ ДВА КУТИ ВІД ЧОТИРЬОХ.
         *
         * Попередня редакція контролю цієї гілки НЕ мала: рамка під 45° лежала
         * ЦІЛКОМ усередині ланцюжкової, тож обидва варіанти давали `covered`
         * однаково, і регресія назад на два кути пройшла б зеленою (рецензія,
         * НД-1).
         *
         * Смуга розміщення НЕ рахується наперед, а МІРЯЄТЬСЯ. Перша спроба
         * розвела рамки по осі X і промахнулась: для 45° розходяться межі по Y.
         *
         * Причина — НЕ точка відліку повороту (її зміна є чистою трансляцією,
         * тож зсуває обидва бокси однаково й вісь розходження змінити не може),
         * а ЗНАК повороту в системі з віссю Y униз. Двокутовий бокс — це
         * охоплювач самої діагоналі, тож по кожній осі він дає її проєкцію: для
         * 200 × 35 при −45° це 83,09 по X (стільки ж, скільки повний охоплювач)
         * і 58,34 по Y (заниження на h·cos45 = 24,74 з кожного боку). При
         * протилежному знаку осі міняються місцями.
         *
         * Самокалібрація пробує обидві осі, тож від знака не залежить. */
        var dFolio = cFolio(14, 14, 45, 150, 150, 350, 185);
        var b4 = spreadBox(dFolio);
        var b2 = spreadBox2(dFolio);

        /* Перерахунок «координати resolve() → geometricBounds» на НЕПОВЕРНУТІЙ
         * рамці, де обидві системи збігаються з точністю до зсуву. */
        var cal = cFrame(14, 100, 100, 200, 200);
        var calBox = spreadBox(cal);
        var calGb = cal.geometricBounds;              /* [y1, x1, y2, x2] */
        var offY = calBox.y1 - calGb[0];
        var offX = calBox.x1 - calGb[1];
        cal.remove();

        /* Смуга, що лежить УСЕРЕДИНІ чотирикутового боксу й ПОЗА
         * дводіагональним. Пробуємо обидва боки по Y, тоді по X. */
        var band = null;
        if (b4 !== null && b2 !== null) {
            if (b4.y2 - b2.y2 > 6) band = { axis: "y", lo: b2.y2 + 2, hi: b4.y2 - 1 };
            else if (b2.y1 - b4.y1 > 6) band = { axis: "y", lo: b4.y1 + 1, hi: b2.y1 - 2 };
            else if (b4.x2 - b2.x2 > 6) band = { axis: "x", lo: b2.x2 + 2, hi: b4.x2 - 1 };
            else if (b2.x1 - b4.x1 > 6) band = { axis: "x", lo: b4.x1 + 1, hi: b2.x1 - 2 };
        }

        var diagBuilt = false;
        if (band !== null) {
            var gy1, gy2, gx1, gx2;
            if (band.axis === "y") {
                gy1 = band.lo - offY;
                gy2 = band.hi - offY;
                gx1 = (b2.x1 + 5) - offX;
                gx2 = (b2.x2 - 5) - offX;
            } else {
                gx1 = band.lo - offX;
                gx2 = band.hi - offX;
                gy1 = (b2.y1 + 5) - offY;
                gy2 = (b2.y2 - 5) - offY;
            }
            var dPrev = cd.pages[13].textFrames.add();
            try { dPrev.itemLayer = cLayer; } catch (eD1) {}
            var pb13 = cd.pages[13].bounds;
            dPrev.geometricBounds = [pb13[0] + 100, pb13[1] + 100, pb13[0] + 300, pb13[1] + 300];
            var dNext = cd.pages[14].textFrames.add();
            try { dNext.itemLayer = cLayer; } catch (eD2) {}
            dNext.geometricBounds = [gy1, gx1, gy2, gx2];
            dPrev.nextTextFrame = dNext;
            dPrev.parentStory.contents = cFill;
            diagBuilt = true;
        }

        out.control = {
            docName: String(cd.name),
            diag: {
                built: diagBuilt,
                band: band,
                box4: b4,
                box2: b2
            },
            expected: {
                total: 8,
                covered: diagBuilt ? 5 : 4,
                coveredPages: diagBuilt ? ["15", "3", "5", "6", "7"] : ["3", "5", "6", "7"],
                neighbourWrongPage: 1,
                overlapNoThread: 1,
                noOverlap: diagBuilt ? 1 : 2
            }
        };
        say("контрольну фікстуру створено: " + cd.name);
        app.scriptPreferences.measurementUnit = previousUnit;
        __result = out;
        throw "__H7_DONE__";
    }

    var doc = app.documents.itemByName(params.docName);
    if (!doc.isValid) throw new Error("Документа «" + params.docName + "» не відкрито");
    out.docName = String(doc.name);
    out.pageCount = doc.pages.length;
    out.modifiedBefore = doc.modified;
    say("документ: " + out.docName + ", сторінок " + out.pageCount);
    say("modified ДО зонда: " + out.modifiedBefore);

    var styleName = params.styleName;
    var t0 = new Date().getTime();

    /* Колонцифри на БАТЬКІВСЬКИХ сторінках: page.allPageItems непереозначених
     * елементів майстра не бачить (§4.1), тож рахуємо їх окремо — інакше
     * «91» мовчки означало б «91 переозначена», а не «91 усього». */
    var masterFolios = 0;
    out.q1.masterFolioDetail = [];
    for (var mi = 0; mi < doc.masterSpreads.length; mi++) {
        var ms = doc.masterSpreads[mi];
        var mAll;
        try { mAll = ms.allPageItems; } catch (eM) { mAll = []; }
        for (var mj = 0; mj < mAll.length; mj++) {
            var mParas = null;
            try { mParas = mAll[mj].paragraphs; } catch (eMP) { mParas = null; }
            if (mParas === null) continue;
            var hit = false;
            for (var mk = 0; mk < mParas.length; mk++) {
                if (styleNameOf(mParas[mk]) === styleName) hit = true;
            }
            if (!hit) continue;
            masterFolios += 1;
            /* ЩО САМЕ в майстровій колонцифрі — вирішальне. Літерал означає
             * ручне число на 40 сторінках, яких інструмент не бачить; самий
             * маркер означає, що там уже все автоматично й робити нічого. */
            var mRec = { master: String(ms.name), side: "?", paragraphs: [] };
            /* Шар майстрового елемента і його ВИДИМІСТЬ. Без цього «на майстрі
             * стоїть автоматична колонцифра» нічого не каже про те, чи вона
             * взагалі потрапляє на аркуш (рецензія, Critical 2). */
            try {
                mRec.layer = String(mAll[mj].itemLayer.name);
                mRec.layerVisible = mAll[mj].itemLayer.visible;
                mRec.layerPrintable = mAll[mj].itemLayer.printable;
            } catch (eLV) { mRec.layer = null; }
            try { mRec.side = sideOf(mAll[mj].parentPage); } catch (eMS) {}
            try { mRec.page = String(mAll[mj].parentPage.name); } catch (eMPg) { mRec.page = null; }
            for (var mk2 = 0; mk2 < mParas.length; mk2++) {
                mRec.paragraphs.push(readParagraph(mParas[mk2], mk2));
            }
            /* Чи перекриває майстрова колонцифра ланцюжкову рамку САМОГО
             * майстра — тобто чи є в неї взагалі шанс розв'язатись. Питання 6
             * каже, що з майстра ланцюжок не розв'язується; ця пара чисел
             * показує, чи саме на цьому спіткнулась верстка. */
            mRec.overlaps = [];
            try {
                var mBox = spreadBox(mAll[mj]);
                for (var mo = 0; mo < mAll.length; mo++) {
                    if (mo === mj) continue;
                    var moParas = null;
                    try { moParas = mAll[mo].paragraphs; } catch (eMO) { moParas = null; }
                    if (moParas === null) continue;
                    if (overlapKind(mBox, spreadBox(mAll[mo])) === null) continue;
                    var moRec = { style: moParas.length > 0 ? styleNameOf(moParas[0]) : null };
                    try { moRec.containers = mAll[mo].parentStory.textContainers.length; } catch (eMC) { moRec.containers = null; }
                    try {
                        var mpv = mAll[mo].previousTextFrame;
                        moRec.prevPage = (mpv !== null && mpv !== undefined && mpv.isValid) ? pageNameOfFrame(mpv) : null;
                    } catch (eMPv) { moRec.prevPage = null; }
                    mRec.overlaps.push(moRec);
                }
            } catch (eMB) { mRec.overlapError = String(eMB); }
            out.q1.masterFolioDetail.push(mRec);
        }
    }
    out.q1.masterFolioFrames = masterFolios;

    /* Сторінки, що дістають колонцифру з МАЙСТРА, а не власним елементом.
     * `page.allPageItems` непереозначених елементів майстра не бачить (§4.1),
     * тож інструмент на таких сторінках не побачив би НІЧОГО — і 91 читалось
     * би як «усі колонцифри книжки», хоч це могло б бути «усі, які видно». */
    var masterFolioPages = [];
    for (var mq = 0; mq < doc.pages.length; mq++) {
        var mpage = doc.pages[mq];
        var mitems;
        try { mitems = mpage.masterPageItems; } catch (eMI) { continue; }
        for (var mr = 0; mr < mitems.length; mr++) {
            var mparas = null;
            try { mparas = mitems[mr].paragraphs; } catch (eMR) { mparas = null; }
            if (mparas === null) continue;
            var found = false;
            for (var ms = 0; ms < mparas.length; ms++) {
                if (styleNameOf(mparas[ms]) === styleName) found = true;
            }
            if (found) { masterFolioPages.push(String(mpage.name)); break; }
        }
    }
    out.q1.masterFolioPages = masterFolioPages;

    var sideTally = { recto: 0, verso: 0, single: 0, "?": 0 };
    var orderTally = { "literal-left": 0, "literal-right": 0, "no-marker": 0, "no-literal": 0, other: 0 };
    var coverage = {
        recto: { total: 0, covered: 0, noOverlap: 0, overlapNoThread: 0, threadNoNeighbour: 0, neighbourWrongPage: 0, notOracle: 0 },
        verso: { total: 0, covered: 0, noOverlap: 0, overlapNoThread: 0, threadNoNeighbour: 0, neighbourWrongPage: 0, notOracle: 0 },
        single: { total: 0, covered: 0, noOverlap: 0, overlapNoThread: 0, threadNoNeighbour: 0, neighbourWrongPage: 0, notOracle: 0 }
    };
    var doubleOverlap = 0;
    var conflicting = 0;
    var totalFolio = 0;

    for (var p = 0; p < doc.pages.length; p++) {
        var page = doc.pages[p];
        var pname = String(page.name);
        var side = sideOf(page);
        var frames = pageTextFrames(page);

        /* Спершу — які з рамок сторінки є колонцифрами. Якщо жодної, решта
         * сторінки не міряється взагалі: resolve() на кожній рамці 196
         * сторінок коштує дорого й нізащо. */
        var folioIdx = [];
        var paraCache = [];
        for (var fi = 0; fi < frames.length; fi++) {
            var isFolio = false;
            var paras = null;
            try { paras = frames[fi].paragraphs; } catch (ePP) { paras = null; }
            paraCache.push(paras);
            if (paras === null) continue;
            for (var pi = 0; pi < paras.length; pi++) {
                if (styleNameOf(paras[pi]) === styleName) { isFolio = true; break; }
            }
            if (isFolio) folioIdx.push(fi);
        }
        if (folioIdx.length === 0) continue;

        var boxes = [];
        var boxes2 = [];
        for (var bi = 0; bi < frames.length; bi++) {
            boxes.push(spreadBox(frames[bi]));
            boxes2.push(spreadBox2(frames[bi]));
        }

        for (var k = 0; k < folioIdx.length; k++) {
            var idx = folioIdx[k];
            var frame = frames[idx];
            var box = boxes[idx];
            totalFolio += 1;
            sideTally[side] = (sideTally[side] || 0) + 1;

            var rec = {
                page: pname,
                side: side,
                id: String(frame.id),
                anchored: false,
                box: box,
                paragraphs: [],
                overlaps: []
            };
            try { rec.anchored = String(frame.parent.constructor.name) === "Character"; } catch (eAn) { rec.anchored = null; }
            try { rec.geometricBounds = frame.geometricBounds; } catch (eGB) { rec.geometricBounds = null; }
            try { rec.layer = String(frame.itemLayer.name); } catch (eLy) { rec.layer = null; }
            try { rec.locked = frame.locked; } catch (eLk) { rec.locked = null; }
            try { rec.rotationAngle = frame.rotationAngle; } catch (eRo) { rec.rotationAngle = null; }
            rec.framesOnPage = frames.length;

            /* ПОХОДЖЕННЯ РАМКИ — ВИМІРЯНЕ, а не виведене з відсутності
             * майстрового елемента на сторінці.
             *
             * Перша редакція рахувала «переозначених 62» за ознакою «на
             * сторінці нема живого майстрового елемента». Ця ознака однаково
             * істинна і для «майстровий елемент переозначено», і для
             * «майстра з колонцифрою тут не застосовано взагалі, а рамку
             * намалювали з нуля». Це різні речі з різними наслідками для
             * §4.9, тож читаємо самі властивості (рецензія, НД-2). */
            try { rec.overridden = frame.overridden; } catch (eOv) { rec.overridden = "?"; }
            rec.overriddenMaster = null;
            try {
                var omi = frame.overriddenMasterPageItem;
                if (omi !== null && omi !== undefined && omi.isValid) {
                    rec.overriddenMaster = { id: String(omi.id) };
                    try { rec.overriddenMaster.master = String(omi.parentPage.parent.name); } catch (eOM) {}
                    try { rec.overriddenMaster.layer = String(omi.itemLayer.name); } catch (eOL) {}
                }
            } catch (eOMI) { rec.overriddenMaster = "?" + eOMI; }
            try { rec.appliedMaster = String(page.appliedMaster.name); } catch (eAM) { rec.appliedMaster = null; }

            var allLiterals = [];
            var allMarkers = [];
            var cached = paraCache[idx];
            for (var q = 0; q < cached.length; q++) {
                var rp = readParagraph(cached[q], q);
                rec.paragraphs.push(rp);
                for (var li = 0; li < rp.literals.length; li++) allLiterals.push(rp.literals[li]);
                for (var mi2 = 0; mi2 < rp.markers.length; mi2++) allMarkers.push(rp.markers[mi2]);
            }

            /* ПИТАННЯ 2: взаємний порядок ручного числа й автомаркера. */
            var order;
            if (allLiterals.length === 0) order = "no-literal";
            else if (allMarkers.length === 0) order = "no-marker";
            else if (allLiterals.length === 1 && allMarkers.length === 1) {
                order = allLiterals[0].offset < allMarkers[0].offset ? "literal-left" : "literal-right";
            } else order = "other";
            rec.order = order;
            orderTally[order] = (orderTally[order] || 0) + 1;

            /* ПИТАННЯ 3: покриття маршруту A.
             *
             * Очікувана сторінка = САМЕ РУЧНЕ ЧИСЛО. Напрямок теж виводиться
             * з документа: число менше за власну сторінку означає
             * PREVIOUS_PAGE_NUMBER, більше — NEXT. */
            var own = /^\d+$/.test(pname) ? parseInt(pname, 10) : null;
            var expected = null;
            var direction = null;
            if (allLiterals.length === 1 && own !== null) {
                expected = String(allLiterals[0].value);
                direction = allLiterals[0].value < own ? "previous" : (allLiterals[0].value > own ? "next" : "same");
            }
            rec.expectedNeighbourPage = expected;
            rec.direction = direction;

            var overlapCount = 0;
            var threadedCount = 0;
            var covered = false;
            var anyNeighbour = false;
            var votes = {};
            var nearest = null;      /* КОНТРОЛЬ: найближча рамка й до неї відстань */
            var nearestThread = null; /* найближча рамка ЛАНЦЮЖКА */
            var twoCornerDiff = 0;   /* скільки вердиктів змінив би старий бокс */

            for (var o = 0; o < frames.length; o++) {
                if (o === idx) continue;
                var gap = gapBetween(box, boxes[o]);
                if (gap !== null && (nearest === null || gap < nearest.gap)) {
                    nearest = { gap: gap, id: String(frames[o].id) };
                }
                var oContainers = 1;
                try { oContainers = frames[o].parentStory.textContainers.length; } catch (eOC) { oContainers = 1; }
                if (oContainers > 1 && gap !== null && (nearestThread === null || gap < nearestThread.gap)) {
                    nearestThread = { gap: gap, id: String(frames[o].id), containers: oContainers };
                }
                /* Скільки перекриттів ЗМІНИЛОСЬ би від переходу на два кути —
                 * вимір, а не міркування (рецензія, НД-1). */
                var kind4 = overlapKind(box, boxes[o]);
                var kind2 = overlapKind(boxes2[idx], boxes2[o]);
                if ((kind4 === null) !== (kind2 === null)) twoCornerDiff += 1;

                var kind = kind4;
                if (kind === null) continue;
                overlapCount += 1;
                var other = frames[o];
                var st = null, containers = 1;
                try { st = other.parentStory; containers = st.textContainers.length; } catch (eS) { containers = 1; }
                var prevPage = null, nextPage = null, hasPrev = false, hasNext = false;
                try {
                    var pf = other.previousTextFrame;
                    if (pf !== null && pf !== undefined && pf.isValid) { hasPrev = true; prevPage = pageNameOfFrame(pf); }
                } catch (ePF) { hasPrev = false; }
                try {
                    var nf = other.nextTextFrame;
                    if (nf !== null && nf !== undefined && nf.isValid) { hasNext = true; nextPage = pageNameOfFrame(nf); }
                } catch (eNF) { hasNext = false; }

                var ov = {
                    kind: kind,
                    id: String(other.id),
                    containers: containers,
                    style: (paraCache[o] !== null && paraCache[o].length > 0) ? styleNameOf(paraCache[o][0]) : null,
                    hasPrev: hasPrev, prevPage: prevPage,
                    hasNext: hasNext, nextPage: nextPage
                };
                try { ov.storyId = String(st.id); } catch (eSI) { ov.storyId = null; }
                rec.overlaps.push(ov);

                if (containers > 1 || hasPrev || hasNext) {
                    threadedCount += 1;
                    var neighbourPage = direction === "next" ? nextPage : prevPage;
                    if (neighbourPage !== null) {
                        anyNeighbour = true;
                        votes[neighbourPage] = true;
                        if (neighbourPage === expected) covered = true;
                    }
                }
            }

            var voteCount = 0;
            for (var vk in votes) { if (votes.hasOwnProperty(vk)) voteCount += 1; }
            if (threadedCount > 1) doubleOverlap += 1;
            if (voteCount > 1) conflicting += 1;

            rec.overlapCount = overlapCount;
            rec.threadedOverlaps = threadedCount;
            rec.covered = covered;
            rec.nearest = nearest;
            rec.nearestThread = nearestThread;
            rec.twoCornerDiff = twoCornerDiff;
            rec.box2 = boxes2[idx];

            var bucket = coverage[side] !== undefined ? coverage[side] : null;
            if (bucket !== null) {
                bucket.total += 1;
                if (expected === null) bucket.notOracle += 1;
                else if (covered) bucket.covered += 1;
                else if (overlapCount === 0) bucket.noOverlap += 1;
                else if (threadedCount === 0) bucket.overlapNoThread += 1;
                else if (!anyNeighbour) bucket.threadNoNeighbour += 1;
                else bucket.neighbourWrongPage += 1;
            }

            out.frames.push(rec);
        }
    }

    /* ДВІ КОЛОНЦИФРИ НА ОДНІЙ СТОРІНЦІ (рецензія, Critical 2).
     *
     * Перетин «сторінки з власною рамкою» × «сторінки з живим майстровим
     * елементом» дав 29. Тобто ручну колонцифру там не поставили ЗАМІСТЬ
     * майстрової, а домалювали ПОВЕРХ неї — і майстрова, за Питанням 10,
     * друкує «N–N». Тут міряється, що саме то за елемент і де він лежить
     * відносно ручного. */
    var ownByPage = {};
    for (var ob = 0; ob < out.frames.length; ob++) ownByPage[out.frames[ob].page] = out.frames[ob];
    var doubles = [];
    for (var db = 0; db < masterFolioPages.length; db++) {
        var dpName = masterFolioPages[db];
        if (ownByPage[dpName] === undefined) continue;      /* лише майстровий — не подвійна */
        var dpage = null;
        for (var dp = 0; dp < doc.pages.length; dp++) {
            if (String(doc.pages[dp].name) === dpName) { dpage = doc.pages[dp]; break; }
        }
        if (dpage === null) continue;
        var dRec = { page: dpName, own: null, master: [] };
        dRec.own = {
            rel: null,
            text: ownByPage[dpName].paragraphs[0] ? ownByPage[dpName].paragraphs[0].text : null,
            layer: ownByPage[dpName].layer,
            rotation: ownByPage[dpName].rotationAngle
        };
        /* Зібраний запис несе межі в системі РОЗВОРОТУ, а майстровий елемент
         * повертає свої в системі МАЙСТРОВОГО розвороту. Порівнювати можна
         * лише сторінко-відносні, тож рахуємо їх тут заново. */
        var dOwnFrames = pageTextFrames(dpage);
        for (var dof = 0; dof < dOwnFrames.length; dof++) {
            if (String(dOwnFrames[dof].id) !== ownByPage[dpName].id) continue;
            dRec.own.rel = pageRelBounds(dOwnFrames[dof]);
        }
        var dItems = dpage.masterPageItems;
        for (var di = 0; di < dItems.length; di++) {
            var dParas = null;
            try { dParas = dItems[di].paragraphs; } catch (eDI) { dParas = null; }
            if (dParas === null) continue;
            var dHit = false;
            for (var dk = 0; dk < dParas.length; dk++) {
                if (styleNameOf(dParas[dk]) === styleName) dHit = true;
            }
            if (!dHit) continue;
            var dm = { rel: pageRelBounds(dItems[di]), paragraphs: [] };
            try { dm.master = String(dItems[di].parentPage.parent.name); } catch (eDM) { dm.master = null; }
            try { dm.layer = String(dItems[di].itemLayer.name); } catch (eDL) { dm.layer = null; }
            try { dm.rotation = dItems[di].rotationAngle; } catch (eDR) { dm.rotation = null; }
            for (var dk2 = 0; dk2 < dParas.length; dk2++) dm.paragraphs.push(readParagraph(dParas[dk2], dk2));
            /* Наскільки далеко майстрова від ручної — у сторінко-відносних
             * координатах, тобто чи вони друкуються одна на одній чи поруч. */
            if (dm.rel !== null && dRec.own.rel !== null) {
                dm.deltaFromOwn = [
                    dm.rel[0] - dRec.own.rel[0], dm.rel[1] - dRec.own.rel[1],
                    dm.rel[2] - dRec.own.rel[2], dm.rel[3] - dRec.own.rel[3]
                ];
            }
            dRec.master.push(dm);
        }
        doubles.push(dRec);
    }
    out.q1.doubleFolioPages = doubles;

    /* Повний реєстр шарів документа: саме він пояснює, що з наявного
     * друкується, а що ні. */
    out.q1.layers = [];
    for (var lz = 0; lz < doc.layers.length; lz++) {
        out.q1.layers.push({
            name: String(doc.layers[lz].name),
            visible: doc.layers[lz].visible,
            printable: doc.layers[lz].printable
        });
    }

    out.q1.sideTally = sideTally;
    out.q1.totalFolioFrames = totalFolio;
    out.q2.orderTally = orderTally;
    out.q3.coverage = coverage;
    out.q3.framesOverlappingTwoOrMoreThreads = doubleOverlap;
    out.q3.framesWithConflictingNeighbourPages = conflicting;
    out.elapsedMs = new Date().getTime() - t0;

    /* ЕКСПОРТ КІЛЬКОХ СТОРІНОК КНИЖКИ В PDF (рецензія, Critical 2).
     *
     * Експорт документа НЕ є його зміною: `doc.modified` міряється до й після.
     * Це єдиний спосіб побачити, чи майстрова колонцифра РЕАЛЬНО друкується
     * поруч із ручною, — DOM показує наявність елемента, а не те, що на аркуші.
     *
     * Налаштування експорту задаються ЯВНО і відновлюються: інакше експорт
     * пішов би «останніми вжитими», і `exportLayers` міг би змінити те, що
     * потрапляє в PDF (рецензія, Important 9). */
    if (params.exportPages) {
        var pp = app.pdfExportPreferences;
        var prevRange = pp.pageRange;
        var prevLayers = pp.exportLayers;
        var prevView = pp.viewPDF;
        try {
            pp.pageRange = String(params.exportPages);
            pp.exportLayers = false;
            pp.viewPDF = false;
            var bookPdf = Folder.temp.fsName + "/idmcp-h7-book-pages.pdf";
            doc.exportFile(ExportFormat.PDF_TYPE, new File(bookPdf), false);
            out.bookPdfPath = bookPdf;
            out.bookPdfPages = String(params.exportPages);
            say("PDF сторінок " + params.exportPages + " експортовано: " + bookPdf);
        } catch (eEx) {
            out.exportError = String(eEx);
        } finally {
            pp.pageRange = prevRange;
            pp.exportLayers = prevLayers;
            pp.viewPDF = prevView;
        }
    }

    /* ВАРТІСТЬ `saveACopy` НА РЕАЛЬНІЙ КНИЖЦІ (рецензія, Important 8).
     *
     * 107 мс міряно на фікстурі 2,4 МБ — екстраполювати з неї на книжку 16 МБ
     * не можна. Копія пишеться в СИСТЕМНУ ТИМЧАСОВУ теку, не в теку книжки:
     * писати у синхронізовану теку Google Drive користувача зонд не сміє, а
     * вісь «розмір документа» ця копія міряє чесно. Вісь «синхронізоване
     * призначення» лишається невиміряною, і так і записано в док. */
    if (params.measureSaveACopy) {
        var copyTo = Folder.temp.fsName + "/idmcp-h7-book-copy.indd";
        try {
            var tS = new Date().getTime();
            doc.saveACopy(new File(copyTo));
            out.saveACopy = { ms: new Date().getTime() - tS, path: copyTo };
            try { out.saveACopy.bytes = new File(copyTo).length; } catch (eSB) { out.saveACopy.bytes = null; }
            try { out.saveACopy.sourceBytes = doc.fullName.length; } catch (eSS) { out.saveACopy.sourceBytes = null; }
            try { out.saveACopy.sourceFolder = String(doc.filePath); } catch (eSF) { out.saveACopy.sourceFolder = null; }
            try { new File(copyTo).remove(); out.saveACopy.removed = true; } catch (eSR) { out.saveACopy.removed = false; }
        } catch (eSA) {
            out.saveACopy = { error: String(eSA) };
        }
    }

    out.modifiedAfter = doc.modified;
    say("modified ПІСЛЯ зонда: " + out.modifiedAfter);
    say("рамок колонцифри знайдено: " + totalFolio + " за " + out.elapsedMs + " мс");

} catch (err) {
    /* ES3 не має return з тіла eval, тож короткі фази виходять киданням
     * сентинела. Це не помилка — решту тіла просто не треба виконувати. */
    if (String(err) !== "__H7_DONE__") out.error = String(err) + " @ рядок " + (err.line || "?");
} finally {
    app.scriptPreferences.measurementUnit = previousUnit;
}

__result = out;

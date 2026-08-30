/* Зонд «чужий майстер» (§4 промпту сесії 4). ЛИШЕ ЧИТАННЯ.
 *
 * МІШЕНЬ. Перед здачею в друк на с. 188 робочої книжки не виявилось
 * колонтитула. Причина, названа користувачем: забув переназначити
 * материнський шаблон. `head-missing` цього не бачить за побудовою —
 * очікування будуються З РАМОК НА МАЙСТРАХ, а чужий майстер нічого не
 * обіцяє, тож очікування немає й знахідки немає.
 *
 * ЩО ЗНІМАЄ. Карту «сторінка → застосований майстер» плюс те, що потрібно
 * для підсилення («виглядає як тіло, а вдягнена інакше»): набір абзацних
 * стилів кожної сторінки й кількість абзаців. Обидва файли міряються ОДНИМ
 * прогоном, щоб різницю на 188 було видно без ручного зшивання.
 *
 * ГАРАНТІЇ. Жодного add()/remove()/override()/save(). Файли, яких ще не
 * відкрито, відкриваються БЕЗ ВІКНА і закриваються з SaveOptions.NO. Уже
 * відкритий документ НЕ чіпається взагалі — ні відкриття, ні закриття.
 * Одиниці застосунку відновлюються у finally.
 */

var FILES = [
    { label: "нинішній", path: "/Users/designer/Library/CloudStorage/GoogleDrive-designer@example.com/My Drive/KR/Production/Design/Book/03 Файли проєкту/Book 260817-1230 copy.indd" },
    { label: "старий, зламаний", path: "/Users/designer/Library/CloudStorage/GoogleDrive-designer@example.com/My Drive/KR/Production/Design/Book/03 Файли проєкту/_backups/Book 260816-1250.indd" }
];

var previousUnit = app.scriptPreferences.measurementUnit;
app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;

var out = { app: { version: String(app.version) }, notes: [], docs: [], threw: [] };
function say(s) { out.notes.push(String(s)); }

/* Уже відкритий документ шукаємо за ПОВНИМ шляхом, а не за назвою: у теці
 * лежать «… 260817-1230.indd» і «… 260817-1230 copy.indd», і назва тут не
 * тотожність. Порівняння через decodeURI — fullName віддає URI-форму. */
function alreadyOpen(path) {
    for (var i = 0; i < app.documents.length; i++) {
        var d = app.documents[i];
        var full = null;
        try { full = d.saved ? String(d.fullName) : null; } catch (e) { full = null; }
        if (full === null) continue;
        var decoded = full;
        try { decoded = decodeURI(full); } catch (e2) {}
        if (decoded === path || full === path) return d;
    }
    return null;
}

function measureDoc(doc) {
    var rec = { docName: String(doc.name), pages: [], masters: [], modifiedBefore: doc.modified };

    for (var m = 0; m < doc.masterSpreads.length; m++) {
        var ms = doc.masterSpreads[m];
        rec.masters.push({
            name: String(ms.name),
            baseName: String(ms.baseName),
            prefix: String(ms.namePrefix),
            pages: ms.pages.length
        });
    }

    /* Абзацні стилі — ПО СТОРІНКАХ, через рамки сторінки. Прив'язані об'єкти
     * `page.textFrames` не бачить (виміряно у Фазі 6), тому беремо
     * `allPageItems` і фільтруємо текстові — той самий прийом, що в
     * geometry.jsx. */
    var styleSetByPage = {};
    var paraCountByPage = {};
    for (var p = 0; p < doc.pages.length; p++) {
        var page = doc.pages[p];
        var pname = String(page.name);
        styleSetByPage[pname] = {};
        paraCountByPage[pname] = 0;
        var items;
        try { items = page.allPageItems; } catch (eI) { items = []; }
        for (var it = 0; it < items.length; it++) {
            var item = items[it];
            var paras = null;
            try { paras = item.paragraphs; } catch (eP) { paras = null; }
            if (paras === null) continue;
            for (var pa = 0; pa < paras.length; pa++) {
                var sn = null;
                try { sn = String(paras[pa].appliedParagraphStyle.name); } catch (eS) { sn = null; }
                if (sn === null) continue;
                styleSetByPage[pname][sn] = (styleSetByPage[pname][sn] || 0) + 1;
                paraCountByPage[pname]++;
            }
        }
    }

    for (var pg = 0; pg < doc.pages.length; pg++) {
        var pageObj = doc.pages[pg];
        var name = String(pageObj.name);
        var masterName = null;
        try {
            var mst = pageObj.appliedMaster;
            /* `=== NothingEnum.NOTHING` тут НЕ працює (виміряно, Фаза 4):
             * для сторінки без батьківської вираз завжди false. Натомість
             * сама властивість falsy, і `&& .isValid` коротко замикається. */
            if (mst && mst.isValid) masterName = String(mst.name);
        } catch (eM) { masterName = null; }

        var styles = [];
        for (var s in styleSetByPage[name]) {
            if (styleSetByPage[name].hasOwnProperty(s)) styles.push(s);
        }
        styles.sort();

        rec.pages.push({
            name: name,
            offset: pageObj.documentOffset,
            side: String(pageObj.side),
            master: masterName,
            paragraphs: paraCountByPage[name],
            styles: styles
        });
    }

    rec.modifiedAfter = doc.modified;
    return rec;
}

IDMCP.withNoInteraction(function () {
    try {
        for (var f = 0; f < FILES.length; f++) {
            var spec = FILES[f];
            var doc = alreadyOpen(spec.path);
            var openedByUs = false;
            if (doc === null) {
                var file = new File(spec.path);
                if (!file.exists) { out.threw.push(spec.label + ": файла немає — " + spec.path); continue; }
                /* Без вікна: документ не стає активним і вікна користувача
                 * не перемикаються. */
                doc = app.open(file, false);
                openedByUs = true;
            }
            try {
                var rec = measureDoc(doc);
                rec.label = spec.label;
                rec.openedByUs = openedByUs;
                out.docs.push(rec);
            } finally {
                /* Закриваємо ЛИШЕ те, що самі відкрили, і ЛИШЕ без збереження. */
                if (openedByUs) {
                    try { doc.close(SaveOptions.NO); } catch (eC) { out.threw.push("close: " + String(eC)); }
                }
            }
        }
        say("Документів виміряно: " + out.docs.length);
    } catch (fatal) {
        out.fatal = String(fatal) + (fatal.line ? (" (рядок " + fatal.line + ")") : "");
    } finally {
        app.scriptPreferences.measurementUnit = previousUnit;
    }
});

__result = out;

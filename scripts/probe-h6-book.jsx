/* Зонд H6, Питання 3, 4, 5, 7 (спек Фази 6 §6).
 *
 * ЛИШЕ ЧИТАННЯ. Жодного присвоєння властивості документа, жодного add()/
 * remove()/override(), жодного save()/close(). Єдине присвоєння в скрипті —
 * app.scriptPreferences.measurementUnit (налаштування ЗАСТОСУНКУ, не
 * документа), і воно відновлюється у finally.
 *
 * Документ адресується ЯВНО за назвою через app.documents.itemByName, а не
 * через app.activeDocument: поруч часто відкритий службовий fixture.indd, і
 * активний документ між ними стрибає (правило з пам'яті).
 */

var previousUnit = app.scriptPreferences.measurementUnit;
app.scriptPreferences.measurementUnit = MeasurementUnits.MILLIMETERS;

var out = { notes: [], q3: {}, q4: {}, q5: {}, q7: {} };
function say(s) { out.notes.push(String(s)); }

var SPECIALS = [
    ["auto-page-number", SpecialCharacters.AUTO_PAGE_NUMBER],
    ["section-marker", SpecialCharacters.SECTION_MARKER],
    ["next-page-number", SpecialCharacters.NEXT_PAGE_NUMBER],
    ["previous-page-number", SpecialCharacters.PREVIOUS_PAGE_NUMBER]
];

/* Порівняння ІДЕНТИЧНІСТЮ: String(ch.contents) дав би рядок
 * "AUTO_PAGE_NUMBER" — виміряно Фазою 4. */
function classifyChar(ch) {
    for (var i = 0; i < SPECIALS.length; i++) {
        if (ch.contents === SPECIALS[i][1]) return SPECIALS[i][0];
    }
    return null;
}

function styleNameOf(para) {
    try { return String(para.appliedParagraphStyle.name); } catch (e) { return "?"; }
}

try {
    var doc = app.documents.itemByName(params.docName);
    if (!doc.isValid) throw new Error("Документа «" + params.docName + "» не відкрито");
    say("документ: " + String(doc.name) + ", сторінок " + doc.pages.length);
    say("modified ДО зонда: " + doc.modified);

    var markerTally = {};
    var framesWithMarker = 0;
    var framesDigitsOnly = 0;
    var orphanJumpMarkers = [];
    var headerCandidates = {};
    var tocRows = [];

    /* Сторінки змісту ВИЗНАЧАЮТЬСЯ З ДОКУМЕНТА, не задаються номерами.
     * Перша редакція зонда брала їх списком ["7"…"11"] — і застаріла того
     * ж дня: користувач зменшив книжку на дві сторінки. Ознака — абзацний
     * стиль із заданим префіксом. */
    var tocPages = {};
    var prefix = params.tocStylePrefix;
    for (var tp = 0; tp < doc.pages.length; tp++) {
        var tpage = doc.pages[tp];
        var tframes = tpage.textFrames;
        for (var tf = 0; tf < tframes.length; tf++) {
            var tparas;
            try { tparas = tframes[tf].paragraphs; } catch (eT) { continue; }
            for (var tq = 0; tq < tparas.length; tq++) {
                if (styleNameOf(tparas[tq]).indexOf(prefix) === 0) {
                    tocPages[String(tpage.name)] = true;
                }
            }
        }
    }
    var tocPageList = [];
    for (var tk in tocPages) { if (tocPages.hasOwnProperty(tk)) tocPageList.push(tk); }
    out.q3.tocPages = tocPageList;
    say("сторінки змісту знайдено за стилем «" + prefix + "»: " + tocPageList.join(", "));

    for (var p = 0; p < doc.pages.length; p++) {
        var page = doc.pages[p];
        var pname = String(page.name);
        var frames = page.textFrames;

        for (var fi = 0; fi < frames.length; fi++) {
            var frame = frames[fi];
            var kinds = {};
            var digitsOnly = true;
            var anyText = false;
            var paras;
            try { paras = frame.paragraphs; } catch (eP) { continue; }

            for (var pi = 0; pi < paras.length; pi++) {
                var para = paras[pi];
                var chars = para.characters;
                var plain = "";
                for (var ci = 0; ci < chars.length; ci++) {
                    var kind = classifyChar(chars[ci]);
                    if (kind === null) {
                        plain += String(chars[ci].contents);
                    } else {
                        kinds[kind] = true;
                        markerTally[kind] = (markerTally[kind] || 0) + 1;
                        /* Питання 7: jump-line маркер поза jump-line рамкою.
                         * Позначаємо кандидатом; чи він осиротілий, вирішує
                         * перегляд — маркер сам себе таким не називає. */
                        if (kind === "next-page-number" || kind === "previous-page-number") {
                            orphanJumpMarkers.push({
                                page: pname,
                                frameId: String(frame.id),
                                kind: kind,
                                style: styleNameOf(para)
                            });
                        }
                    }
                }
                var trimmed = plain.replace(/[\s–—\-]/g, "");
                if (trimmed.length > 0) {
                    anyText = true;
                    if (!/^\d+$/.test(trimmed)) digitsOnly = false;
                }

                /* Питання 3: рядки змісту — стиль, базова лінія, інтерліньяж. */
                if (tocPages[pname] === true) {
                    var baseline = null;
                    var leading = null;
                    try {
                        if (para.lines.length > 0) {
                            baseline = para.lines[0].baseline;
                            var lead = para.lines[0].leading;
                            if (typeof lead === "number") leading = lead;
                        }
                    } catch (eL) { baseline = null; }
                    if (plain.replace(/\s/g, "").length > 0) {
                        tocRows.push({
                            page: pname,
                            spread: p,
                            frameId: String(frame.id),
                            style: styleNameOf(para),
                            baseline: baseline,
                            leading: leading,
                            digits: /^\d+$/.test(trimmed),
                            text: plain.substr(0, 40)
                        });
                    }
                }
            }

            var hasMarker = false;
            for (var k in kinds) { if (kinds.hasOwnProperty(k)) hasMarker = true; }
            if (hasMarker) framesWithMarker += 1;
            if (anyText && digitsOnly && !hasMarker) framesDigitsOnly += 1;

            /* Питання 5: кандидат у колонтитули — короткий текст, що
             * повторюється на багатьох сторінках. Рахуємо за текстом. */
            if (anyText && !digitsOnly) {
                var whole = "";
                try { whole = String(frame.contents).replace(/\s+/g, " "); } catch (eC) { whole = ""; }
                if (whole.length > 3 && whole.length < 80) {
                    var key = styleNameOf(paras[0]) + " ||| " + whole;
                    if (headerCandidates[key] === undefined) headerCandidates[key] = 0;
                    headerCandidates[key] += 1;
                }
            }
        }
    }

    out.q4.markerTally = markerTally;
    out.q4.framesWithMarker = framesWithMarker;
    out.q4.framesDigitsOnlyNoMarker = framesDigitsOnly;
    out.q7.jumpMarkers = orphanJumpMarkers;
    out.q7.count = orphanJumpMarkers.length;

    /* Питання 5: лишаємо лише те, що повторюється більш ніж на 5 сторінках. */
    var repeated = [];
    for (var hk in headerCandidates) {
        if (headerCandidates.hasOwnProperty(hk) && headerCandidates[hk] > 5) {
            repeated.push({ key: hk.substr(0, 90), pages: headerCandidates[hk] });
        }
    }
    out.q5.repeatedTextFrames = repeated;

    out.q3.rows = tocRows;
    say("modified ПІСЛЯ зонда: " + doc.modified);

} catch (err) {
    out.error = String(err) + " @ рядок " + (err.line || "?");
} finally {
    app.scriptPreferences.measurementUnit = previousUnit;
}

__result = out;

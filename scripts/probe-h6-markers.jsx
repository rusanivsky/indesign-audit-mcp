/* Зонд H6, Питання 1 і 2 (спек Фази 6 §6).
 *
 * СТВОРЮЄ ВЛАСНИЙ ТИМЧАСОВИЙ ДОКУМЕНТ і закриває його без збереження.
 * Робочого документа користувача НЕ ЧІПАЄ: жодного звернення до
 * app.activeDocument, усе адресується через змінну doc, отриману з
 * app.documents.add(). Правило [[indesign-live-document-safety]].
 *
 * ПИТАННЯ 1. Чи дає PREVIOUS_PAGE_NUMBER номер ПОПЕРЕДНЬОЇ сторінки, якщо
 * рамка перекриває рамку зі зчепленою історією? Пам'ять каже «окремо
 * поставлена рамка показує ПОТОЧНУ сторінку», але умова маркера саме в
 * перекритті, і за цією умовою його не перевіряли. Якщо працює — увесь клас
 * ручних колонцифр можна усунути замість аудитувати.
 *
 * ПИТАННЯ 2. Що показує змінна Running Header (VariableTypes.
 * MATCH_PARAGRAPH_STYLE_TYPE) на сторінці БЕЗ заголовка потрібного стилю —
 * порожнечу чи заголовок із попередньої сторінки?
 *
 * ЯК ЧИТАЄТЬСЯ РЕЗУЛЬТАТ, І ЧОМУ НЕ ЧЕРЕЗ DOM. `character.contents` для
 * маркера повертає САМЕ ПЕРЕРАХУВАННЯ SpecialCharacters, а не розв'язане
 * число — розв'язаного значення DOM не віддає взагалі.
 *
 * Перша редакція зонда читала його через story.exportFile(TEXT_TYPE), і
 * НЕГАТИВНИЙ КОНТРОЛЬ це відкинув: AUTO_PAGE_NUMBER, чия відповідь відома
 * наперед («4»), дав порожній рядок. Тобто текстовий експорт маркери не
 * розв'язує, і чотири «порожньо» першого прогону означали ЗЛАМАНИЙ ПРИЛАД,
 * а не непрацюючий маркер. Без контролю це прочиталося б як відповідь.
 *
 * Тому вимір іде через PDF — там видно рівно те, що НАДРУКУЄТЬСЯ. Кожна
 * рамка несе мітку («CTRL=», «A=»…), щоб її значення витягалося з тексту
 * PDF однозначно, а не за позицією на сторінці. Читає PDF уже Node
 * (scripts/probe-h6-read.mjs) через pdfjs, який у проєкті вже є.
 */

var previousUnit = app.scriptPreferences.measurementUnit;
app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;

var out = { notes: [], expected: {}, pdfPath: null };
var doc = null;

function say(s) { out.notes.push(String(s)); }

/* Координати ВІДНОСНО СТОРІНКИ, не абсолютні.
 *
 * На розвороті система координат СПІЛЬНА для обох сторінок (виміряно Фазою
 * 4). Перша редакція зонда ставила рамки за абсолютними x/y — і рамки
 * осідали не на тих сторінках, на яких я їх задумав, тобто вимір відповідав
 * на інше питання, ніж поставлене. Тепер відлік іде від page.bounds. */
function addFrame(page, dx1, dy1, dx2, dy2) {
    var b = page.bounds;          /* [y1, x1, y2, x2] */
    var f = page.textFrames.add();
    f.geometricBounds = [b[0] + dy1, b[1] + dx1, b[0] + dy2, b[1] + dx2];
    return f;
}

/* Рамка з міткою й маркером: «A=<маркер>». Мітка потрібна, щоб знайти
 * значення в тексті PDF за іменем, а не за координатами. */
function labelled(page, x1, y1, x2, y2, label, marker) {
    var f = addFrame(page, x1, y1, x2, y2);
    f.contents = label;
    f.insertionPoints[-1].contents = marker;
    f.texts[0].pointSize = 18;
    return f;
}

try {
    doc = app.documents.add();
    doc.documentPreferences.facingPages = true;
    doc.documentPreferences.pagesPerDocument = 6;
    say("тимчасовий документ: " + doc.name + ", сторінок " + doc.pages.length);

    /* --- ланцюжок основного тексту через сторінки 2, 3, 4 (індекси 1,2,3) --- */
    var bodyA = addFrame(doc.pages[1], 100, 100, 400, 400);
    var bodyB = addFrame(doc.pages[2], 100, 100, 400, 400);
    var bodyC = addFrame(doc.pages[3], 100, 100, 400, 400);
    bodyA.nextTextFrame = bodyB;
    bodyB.nextTextFrame = bodyC;

    var filler = "";
    for (var i = 0; i < 400; i++) filler += "Текст ланцюжка номер " + i + ". ";
    bodyA.parentStory.contents = filler;
    say("ланцюжок: рамок у історії " + bodyA.parentStory.textContainers.length);

    /* НЕГАТИВНИЙ КОНТРОЛЬ. Відповідь відома наперед: номер своєї сторінки.
     * Якщо в PDF тут НЕ «4» — метод виміру зламаний і решта чисел зонда
     * нічого не означає. */
    labelled(doc.pages[3], 420, 100, 560, 130, "CTRL=", SpecialCharacters.AUTO_PAGE_NUMBER);
    out.expected.CTRL = String(doc.pages[3].name);

    /* ВИПАДОК A: рамка ПЕРЕКРИВАЄ ланцюжкову рамку сторінки 4.
     * Саме умова, за якою маркер jump-line має працювати. */
    labelled(doc.pages[3], 150, 150, 340, 185, "A=", SpecialCharacters.PREVIOUS_PAGE_NUMBER);
    out.expected.A = { page: String(doc.pages[3].name), previousPage: String(doc.pages[2].name) };

    /* ВИПАДОК B: рамка НЕ перекриває нічого. Очікування з пам'яті —
     * показує ПОТОЧНУ сторінку. */
    labelled(doc.pages[3], 420, 200, 560, 235, "B=", SpecialCharacters.PREVIOUS_PAGE_NUMBER);
    out.expected.B = { page: String(doc.pages[3].name), previousPage: String(doc.pages[2].name) };

    /* ВИПАДОК C: перекриття з ОКРЕМОЮ історією (ланцюжок рветься).
     * Тут очікується розбіжність «попередня рамка ланцюжка» ≠ «попередня
     * сторінка» — у цій книжці історії рвуться на відкривачках розділів,
     * інтерв'ю й чеклістах. */
    var lone = addFrame(doc.pages[5], 100, 100, 400, 400);
    lone.contents = "Окрема історія, у ланцюжок не входить.";
    labelled(doc.pages[5], 150, 150, 340, 185, "C=", SpecialCharacters.PREVIOUS_PAGE_NUMBER);
    out.expected.C = { page: String(doc.pages[5].name), previousPage: String(doc.pages[4].name) };

    /* --- ПИТАННЯ 2: змінна Running Header --- */
    var hStyle = doc.paragraphStyles.add({ name: "Зонд-Заголовок" });
    var headed = addFrame(doc.pages[1], 100, 55, 400, 85);
    headed.contents = "ЗАГОЛОВОКРОЗДІЛУ";
    headed.parentStory.paragraphs[0].appliedParagraphStyle = hStyle;

    var variable = doc.textVariables.add();
    variable.name = "Зонд-Колонтитул";
    variable.variableType = VariableTypes.MATCH_PARAGRAPH_STYLE_TYPE;
    variable.variableOptions.appliedParagraphStyle = hStyle;

    /* Сторінка 2 має заголовок цього стилю — контроль для Питання 2. */
    var vHas = addFrame(doc.pages[1], 420, 55, 560, 85);
    vHas.contents = "VH=";
    /* Змінна вставляється НЕ через contents (той приймає лише рядок або
     * SpecialCharacters), а власним інстансом. */
    vHas.insertionPoints[-1].textVariableInstances.add().associatedTextVariable = variable;
    vHas.texts[0].pointSize = 18;
    out.expected.VH = String(doc.pages[1].name);

    /* Сторінка 5 заголовка цього стилю НЕ МАЄ. Це і є питання. */
    var vNone = addFrame(doc.pages[4], 100, 55, 400, 85);
    vNone.contents = "VN=";
    vNone.insertionPoints[-1].textVariableInstances.add().associatedTextVariable = variable;
    vNone.texts[0].pointSize = 18;
    out.expected.VN = String(doc.pages[4].name);

    /* ЗВІРКА РОЗМІЩЕННЯ. Якщо рамка сіла не на ту сторінку, вимір відповів
     * би на інше питання — і мовчки. */
    out.placement = {
        bodyC: String(bodyC.parentPage.name),
        A: String(doc.pages[3].textFrames.item(-1).parentPage.name)
    };

    /* --- експорт у PDF: те, що надрукується --- */
    var pdfPath = Folder.temp.fsName + "/idmcp-h6-markers.pdf";
    var pdfFile = new File(pdfPath);
    doc.exportFile(ExportFormat.PDF_TYPE, pdfFile, false);
    out.pdfPath = pdfPath;
    say("PDF експортовано: " + pdfPath);

} catch (err) {
    out.error = String(err) + " @ рядок " + (err.line || "?");
} finally {
    if (doc !== null) {
        try {
            doc.close(SaveOptions.NO);
            out.notes.push("тимчасовий документ закрито без збереження");
        } catch (e3) {
            out.notes.push("НЕ ВДАЛОСЯ ЗАКРИТИ тимчасовий документ: " + e3);
        }
    }
    app.scriptPreferences.measurementUnit = previousUnit;
}

__result = out;

/* Зонд H4. ЛИШЕ ЧИТАННЯ: жодного запису в документ.
 *
 * Відповідає на сім питань розвідки Фази 4 (спек §6):
 *   1. ε для порівняння чисел (firstLineIndent абзаца проти стилю без перевизначення)
 *   2. що віддає API при мішаному значенні в межах абзаца
 *   3. overridden проти ВИДАЛЕНОГО елемента батьківської сторінки
 *   4. page.side на парній/непарній кількості сторінок і на монтажному столі
 *   5. фактичний обсяг перевизначень, за стилями
 *   6. вартість проходу по абзацах на реальному документі
 *   7. символьний стиль проти локального перевизначення
 *
 * Запускається ВИКЛЮЧНО через mcp__indesign__indesign_run_jsx (тіло цього файла
 * передається в параметр `script`, результат читається зі змінної __result як JSON).
 * НЕ через File → Scripts: цей інструмент загортає прогін у alert(), а alert()
 * у неінтерактивному запуску назавжди блокує InDesign. Тому тут немає ні alert(),
 * ні запису у файл через new File(...) — усі рядки збираються в масив out і
 * кладуться в __result у кінці.
 *
 * Read-only за побудовою: жодного присвоєння властивості документа, жодного add()/
 * remove()/override(), жодного save()/close(). Єдине присвоєння в усьому скрипті —
 * app.scriptPreferences.measurementUnit, налаштування застосунку, не документа,
 * і воно відновлюється у finally.
 */
#target indesign

var previousUnit = app.scriptPreferences.measurementUnit;
app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;

var out = [];
function say(s) { out.push(String(s)); }

try {
    var doc = app.activeDocument;
    say("Документ: " + doc.name + ", сторінок: " + doc.pages.length);
    say("modified ДО зонда: " + doc.modified);

    /* --- Питання 1: ε для порівняння чисел --- */
    /* Абзаци БЕЗ жодного перевизначення мають дати рівно стилеве значення.
     * Міряємо фактичну розбіжність, щоб не порівнювати через !==. */
    var maxDelta = 0;
    var samples = 0;
    var exactMatches = 0;
    var totalChecked = 0;
    for (var s = 0; s < doc.stories.length; s++) {
        var paras = doc.stories[s].paragraphs;
        for (var p = 0; p < paras.length; p++) {
            var par = paras[p];
            var st = par.appliedParagraphStyle;
            var a = par.firstLineIndent, b = st.firstLineIndent;
            if (typeof a === "number" && typeof b === "number") {
                totalChecked++;
                var d = Math.abs(a - b);
                if (d === 0) {
                    exactMatches++;
                } else if (d < 0.01) {
                    if (d > maxDelta) maxDelta = d;
                    samples++;
                }
            }
        }
    }
    say("Питання 1: перевірено абзаців: " + totalChecked +
        ", точних збігів (delta===0): " + exactMatches +
        ", ненульових розбіжностей нижче 0,01 пт: " + samples +
        ", максимум серед них: " + maxDelta);

    /* --- Питання 2: що віддає API при МІШАНОМУ значенні --- */
    /* Порівнювати з невідомим не можна. Треба побачити тип на власні очі. */
    var mixedFound = 0;
    for (var s2 = 0; s2 < doc.stories.length && mixedFound < 3; s2++) {
        var pp = doc.stories[s2].paragraphs;
        for (var q = 0; q < pp.length && mixedFound < 3; q++) {
            var v = pp[q].pointSize;
            if (typeof v !== "number") {
                mixedFound++;
                say("Питання 2: мішаний pointSize, typeof=" + (typeof v) +
                    ", String()=" + String(v) +
                    ", === NothingEnum.NOTHING: " + (v === NothingEnum.NOTHING));
            }
        }
    }
    if (mixedFound === 0) say("Питання 2: мішаних pointSize у документі НЕМАЄ — тип не спостережено");

    /* --- Питання 3: перевизначений проти ВИДАЛЕНОГО елемента батьківської --- */
    /* Видалене фоліо — не перевизначений елемент, а відсутній. Два різні шляхи. */
    for (var p3 = 0; p3 < Math.min(doc.pages.length, 6); p3++) {
        var pg3 = doc.pages[p3];
        var mst = pg3.appliedMaster;
        var onMaster = mst && mst.isValid ? mst.pageItems.length : -1;
        var mpi3 = pg3.masterPageItems;
        var overriddenCount = 0, hasOverriddenProp = false;
        for (var m3 = 0; m3 < mpi3.length; m3++) {
            if (mpi3[m3].hasOwnProperty("overridden") || mpi3[m3].overridden !== undefined) {
                hasOverriddenProp = true;
                if (mpi3[m3].overridden) overriddenCount++;
            }
        }
        say("Питання 3: сторінка " + pg3.name +
            ", на батьківській елементів: " + onMaster +
            ", masterPageItems: " + mpi3.length +
            ", властивість overridden доступна: " + hasOverriddenProp +
            ", перевизначених: " + overriddenCount);
    }
    say("Питання 3, ВИСНОВОК: якщо masterPageItems.length < елементів батьківської — " +
        "різниця і є видаленими. Якщо ні — шляху виявити видалення НЕМАЄ, і дефект " +
        "master-item-missing не реалізується (спек §10, запланована деградація).");

    /* --- Питання 4: page.side на непарній кількості й на монтажному столі --- */
    say("Питання 4: facingPages=" + doc.documentPreferences.facingPages +
        ", сторінок=" + doc.pages.length + " (непарна: " + (doc.pages.length % 2 === 1) + ")");
    for (var p4 = 0; p4 < doc.pages.length; p4++) {
        say("Питання 4: сторінка " + doc.pages[p4].name +
            ", side=" + String(doc.pages[p4].side) +
            ", розворот=" + doc.pages[p4].parent.index +
            ", батьківська=" + (doc.pages[p4].appliedMaster && doc.pages[p4].appliedMaster.isValid
                ? doc.pages[p4].appliedMaster.name : "НЕМАЄ"));
    }
    /* Монтажний стіл: сторінок там немає (pasteboard — не page), спостерігати page.side
     * на монтажному столі механічно неможливо через doc.pages. Фіксуємо це як
     * невиміряне, а не як "не застосовно". */
    say("Питання 4, ПРИМІТКА: doc.pages не містить об'єктів монтажного столу — " +
        "page.side на монтажному столі цим зондом не спостережний. Непарна кількість " +
        "сторінок на цьому документі (парна: " + doc.pages.length + ") також не спостережна " +
        "і лишається для фікстури Задачі 2.");

    /* --- Питання 5: ФАКТИЧНИЙ обсяг перевизначень --- */
    /* Від цього числа залежить, чи потрібен другий рівень зведення (спек §4.4).
     * Поріг 0,01 пт тут — розвідувальний, для порядку величини, НЕ константа продукту. */
    var tally = {};
    var totalParas = 0;
    var props = ["firstLineIndent", "leftIndent", "rightIndent", "spaceBefore", "spaceAfter",
                 "pointSize", "leading", "tracking"];
    for (var s5 = 0; s5 < doc.stories.length; s5++) {
        var pr5 = doc.stories[s5].paragraphs;
        for (var r5 = 0; r5 < pr5.length; r5++) {
            totalParas++;
            var par5 = pr5[r5], st5 = par5.appliedParagraphStyle;
            var key5 = String(st5.name);
            if (!tally[key5]) tally[key5] = { total: 0, over: 0 };
            tally[key5].total++;
            for (var w = 0; w < props.length; w++) {
                var av = par5[props[w]], dv = st5[props[w]];
                if (typeof av === "number" && typeof dv === "number" && Math.abs(av - dv) > 0.01) {
                    tally[key5].over++;
                    break;
                }
            }
        }
    }
    say("Питання 5: усього абзаців " + totalParas + " (поріг перевизначення в цьому зонді: 0,01 пт, розвідувальний)");
    for (var k5 in tally) {
        if (!tally.hasOwnProperty(k5)) continue;
        say("Питання 5: стиль «" + k5 + "» — абзаців " + tally[k5].total +
            ", з перевизначенням хоч однієї властивості: " + tally[k5].over);
    }

    /* --- Питання 6: вартість проходу по абзацах --- */
    /* Фаза 3 уперлася в таймаут AppleScript. Ті самі граблі. */
    var t0 = new Date().getTime();
    var touched = 0;
    for (var s6 = 0; s6 < doc.stories.length; s6++) {
        var pr6 = doc.stories[s6].paragraphs;
        for (var r6 = 0; r6 < pr6.length; r6++) { var _ = pr6[r6].firstLineIndent; touched++; }
    }
    var t1 = new Date().getTime();
    say("Питання 6: прохід по " + touched + " абзацах — " + (t1 - t0) + " мс, " +
        "тобто " + ((t1 - t0) / Math.max(touched, 1)).toFixed(3) + " мс на абзац");

    /* --- Питання 7: символьний стиль проти локального перевизначення --- */
    /* Без цієї відповіді детектор дає знахідку на кожне курсивне слово. */
    var withCs = 0, csExample = "";
    for (var s7 = 0; s7 < doc.stories.length && withCs < 3; s7++) {
        var pr7 = doc.stories[s7].paragraphs;
        for (var r7 = 0; r7 < pr7.length && withCs < 3; r7++) {
            var runs = pr7[r7].textStyleRanges;
            for (var u = 0; u < runs.length; u++) {
                var cs = runs[u].appliedCharacterStyle;
                if (cs && String(cs.name) !== "[None]") {
                    withCs++;
                    csExample = "стиль «" + String(cs.name) + "», діапазонів у абзаці: " + runs.length +
                        ", pointSize абзацу: " + String(pr7[r7].pointSize) +
                        ", pointSize стилю абзацу: " + String(pr7[r7].appliedParagraphStyle.pointSize);
                    say("Питання 7: " + csExample);
                    break;
                }
            }
        }
    }
    if (withCs === 0) say("Питання 7: абзаців із застосованим символьним стилем НЕ знайдено");

    say("modified ПІСЛЯ зонда: " + doc.modified);
} finally {
    app.scriptPreferences.measurementUnit = previousUnit;
}

var __result = out.join("\n");

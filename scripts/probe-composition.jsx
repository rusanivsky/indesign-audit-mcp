/*
 * Зонд Фази 2 (H1). ТІЛЬКИ ЧИТАННЯ. Не присвоює жодної властивості документа.
 * Запускається через обробник run_script; результат кладе у __result.
 *
 * Раунд виправлень 1: усі виміри (крім самого пошуку) працюють на ОДНІЙ і тій самій
 * story — найбільшій у документі, — а не на doc.stories[0]. У реальному документі
 * story з індексом 0 виявилась мікроскопічною службовою рамкою (нумерація сторінок,
 * 3 символи), і перший варіант зонда це мовчки відтворював би щоразу.
 *
 * Раунд виправлень 2: MeasurementUnits.POINTS тепер фіксується ОДИН РАЗ на весь
 * зонд (одна обгортка try/finally навколо пунктів 0–4), а не лише навколо пункту 1.
 * У попередній версії finally відновлював ambient-одиницю ДО пунктів 2 і 3 — координати
 * рядка й обхід по рядках читались уже без гарантії, що лінійка документа в точках.
 * Фактично застосована одиниця записується в out.measurementUnit.
 *
 * Також пункт 2 тепер перевіряє endHorizontalOffset прямим виміром, а не посиланням
 * на очікування: читає передостанній символ рядка (незалежний, не циклічний спосіб
 * дістати ширину сусіднього гліфа в тому самому місці рядка) і сам текст останнього
 * та передостаннього символів — щоб було видно, чи мала різниця пояснюється вузьким
 * гліфом (пунктуація) чи ні.
 */
var doc = app.activeDocument;
var out = {
    docName: doc.name,
    pageCount: doc.pages.length,
    storyCount: doc.stories.length
};

var oldUnit = app.scriptPreferences.measurementUnit;
app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;

try {
    out.measurementUnit = "points";

    // 0. Знайти найбільшу story в документі один раз; використати її нижче в усіх
    //    пунктах. Заразом рахуємо сумарну кількість символів і рядків (дешево —
    //    це .length колекції, не поелементний обхід).
    var bigStory = null;
    var bigLen = 0;
    var totalChars = 0;
    var totalLines = 0;
    for (var s0 = 0; s0 < doc.stories.length; s0++) {
        var len0 = doc.stories[s0].characters.length;
        totalChars += len0;
        totalLines += doc.stories[s0].lines.length;
        if (len0 > bigLen) {
            bigLen = len0;
            bigStory = doc.stories[s0];
        }
    }
    out.totalCharacters = totalChars;
    out.totalLines = totalLines;
    out.biggestStory = {
        length: bigLen,
        lineCount: bigStory ? bigStory.lines.length : null
    };

    // 1. Чи читається horizontalOffset у символа (на найбільшій story).
    var probe = { available: false, sample: null, error: null };
    try {
        if (bigStory && bigStory.characters.length >= 12) {
            var offsets = [];
            for (var c = 0; c < 12; c++) {
                offsets.push(bigStory.characters[c].horizontalOffset);
            }
            probe.available = true;
            probe.sample = offsets;
        } else {
            probe.error = "найбільшу story не знайдено або вона коротша за 12 символів";
        }
    } catch (e1) {
        probe.error = String(e1);
    }
    out.horizontalOffset = probe;

    // 2. Line.endHorizontalOffset: пряма перевірка різниці з останнім символом.
    //    Шукаємо в найбільшій story рядок, довший за 20 символів, і читаємо:
    //    - horizontalOffset рядка (початок) і endHorizontalOffset (кінець);
    //    - horizontalOffset ОСТАННЬОГО символа і його contents (текст);
    //    - horizontalOffset ПЕРЕДОСТАННЬОГО символа і його contents — різниця
    //      lastChar.horizontalOffset - secondToLastChar.horizontalOffset є
    //      незалежним (не спирається на endHorizontalOffset) виміром фактичної
    //      ширини передостаннього гліфа в тому самому місці рядка, з чим і
    //      порівнюємо endHorizontalOffset - lastChar.horizontalOffset.
    var lineProbe = { available: false, error: null };
    try {
        if (bigStory) {
            /* Шукаємо рядок, довший за 20 символів, ЧИЙ ОСТАННІЙ СИМВОЛ — звичайний
             * друкований гліф, а не керівний/спецсимвол. Перший наївний пошук (без
             * фільтра) двічі поспіль випадково впав на керівний символ:
             *   - SpecialCharacters.FORCED_LINE_BREAK (typeof contents === "object",
             *     Enumerator, не рядок) — примусовий перенос рядка;
             *   - "\r" (typeof contents === "string", але це кінець абзацу, не гліф).
             * Тому фільтр перевіряє І тип (рядок), І що це не один із відомих
             * керівних символів кінця рядка/абзацу.
             */
            /* U+2028/U+2029 не можна писати як буквальні символи всередині рядкового
             * лiтерала ExtendScript (ES3 трактує їх як LineTerminator і кидає
             * "Unterminated string constant" — та сама пастка, що й у runner.ts для
             * params.json). Будуємо їх через fromCharCode. */
            var LINE_SEPARATOR = String.fromCharCode(8232);
            var PARAGRAPH_SEPARATOR_CHAR = String.fromCharCode(8233);
            var chosenLine = null;
            var lines = bigStory.lines;
            var linesSkippedSpecialLastChar = 0;
            for (var li = 0; li < lines.length; li++) {
                if (lines[li].characters.length > 20) {
                    var candLc = lines[li].characters;
                    var candLastChar = candLc[candLc.length - 1];
                    var candLastContents = candLastChar.contents;
                    if (candLastContents instanceof Array) candLastContents = candLastContents[0];
                    var isPlainGlyph = (typeof candLastContents === "string") &&
                        candLastContents !== "\r" &&
                        candLastContents !== "\n" &&
                        candLastContents !== LINE_SEPARATOR &&
                        candLastContents !== PARAGRAPH_SEPARATOR_CHAR;
                    if (isPlainGlyph) {
                        chosenLine = lines[li];
                        break;
                    } else {
                        linesSkippedSpecialLastChar++;
                    }
                }
            }
            lineProbe.linesSkippedSpecialLastChar = linesSkippedSpecialLastChar;
            if (chosenLine) {
                var lc = chosenLine.characters;
                var lastIdx = lc.length - 1;
                var lastChar = lc[lastIdx];
                var lastContents = lastChar.contents;
                if (lastContents instanceof Array) lastContents = lastContents[0];

                lineProbe.lineCharacterCount = lc.length;
                lineProbe.horizontalOffset = chosenLine.horizontalOffset;
                lineProbe.endHorizontalOffset = chosenLine.endHorizontalOffset;
                lineProbe.lastCharacterHorizontalOffset = lastChar.horizontalOffset;
                lineProbe.lastCharacterContents = lastContents;
                lineProbe.endMinusLastCharacterOffset =
                    chosenLine.endHorizontalOffset - lastChar.horizontalOffset;
                lineProbe.available = true;

                if (lastIdx >= 1) {
                    var secondToLastChar = lc[lastIdx - 1];
                    var secondToLastOffset = secondToLastChar.horizontalOffset;
                    var secondToLastContents = secondToLastChar.contents;
                    if (secondToLastContents instanceof Array) secondToLastContents = secondToLastContents[0];

                    lineProbe.secondToLastCharacterHorizontalOffset = secondToLastOffset;
                    lineProbe.secondToLastCharacterContents = secondToLastContents;
                    /* Незалежний (не циклічний) вимір фактичної ширини передостаннього
                     * гліфа в цьому самому рядку — для порівняння з endMinusLastCharacterOffset. */
                    lineProbe.secondToLastCharacterWidth = lastChar.horizontalOffset - secondToLastOffset;
                } else {
                    lineProbe.secondToLastCharacterHorizontalOffset = null;
                    lineProbe.secondToLastCharacterWidth = null;
                }
            } else {
                lineProbe.error = "не знайдено в найбільшій story рядок довший за 20 символів";
            }
        } else {
            lineProbe.error = "найбільшу story не знайдено";
        }
    } catch (e2) {
        lineProbe.error = String(e2);
    }
    out.line = lineProbe;

    // 3. Вартість обходу: посимвольно і порядково, на тій самій найбільшій story.
    var timing = { perCharacter: null, perLine: null, error: null };
    try {
        if (bigStory) {
            var t0 = new Date().getTime();
            var limitC = Math.min(1000, bigStory.characters.length);
            var accC = 0;
            for (var k = 0; k < limitC; k++) {
                accC += bigStory.characters[k].horizontalOffset;
            }
            var msC = new Date().getTime() - t0;
            timing.perCharacter = { charsMeasured: limitC, ms: msC };

            var t1 = new Date().getTime();
            var storyLines = bigStory.lines;
            var limitL = Math.min(1000, storyLines.length);
            var accL = 0;
            for (var m = 0; m < limitL; m++) {
                accL += storyLines[m].horizontalOffset;
                accL += storyLines[m].endHorizontalOffset;
            }
            var msL = new Date().getTime() - t1;
            timing.perLine = {
                linesMeasured: limitL,
                totalLinesInStory: storyLines.length,
                ms: msL
            };
        } else {
            timing.error = "найбільшу story не знайдено";
        }
    } catch (e3) {
        timing.error = String(e3);
    }
    out.timing = timing;

    // 4. Налаштування виключки на кількох різних абзацних стилях ОСНОВНОГО тексту —
    //    беремо стилі з тієї самої найбільшої story, а не з випадкового першого
    //    абзацу, щоб порівняти, чи значення справді відрізняються між стилями.
    var justArr = [];
    var justError = null;
    try {
        if (bigStory) {
            var seenStyles = {};
            var paras = bigStory.paragraphs;
            var maxStyles = 3;
            for (var pi = 0; pi < paras.length && justArr.length < maxStyles; pi++) {
                var para = paras[pi];
                if (para.characters.length === 0) continue;
                var styleName;
                try {
                    styleName = para.appliedParagraphStyle.name;
                } catch (eStyle) {
                    continue;
                }
                if (seenStyles[styleName]) continue;
                seenStyles[styleName] = true;

                var j = { appliedParagraphStyle: styleName, error: null };
                try {
                    j.composer = String(para.composer);
                    j.hyphenation = para.hyphenation;
                    j.minimumWordSpacing = para.minimumWordSpacing;
                    j.desiredWordSpacing = para.desiredWordSpacing;
                    j.maximumWordSpacing = para.maximumWordSpacing;
                } catch (eJ) {
                    j.error = String(eJ);
                }
                justArr.push(j);
            }
            if (justArr.length === 0) {
                justError = "у найбільшій story не знайдено непорожніх абзаців зі стилем";
            }
        } else {
            justError = "найбільшу story не знайдено";
        }
    } catch (e4) {
        justError = String(e4);
    }
    out.justification = { styles: justArr, error: justError };
} finally {
    app.scriptPreferences.measurementUnit = oldUnit;
}

__result = out;

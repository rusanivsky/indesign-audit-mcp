/* Зонд H3, точкова діагностика. ЛИШЕ ЧИТАННЯ. Не присвоює жодної властивості
 * документа; єдине присвоєння — app.scriptPreferences.measurementUnit, налаштування
 * застосунку, відновлюється у finally.
 *
 * Це єдиний доказ під двома твердженнями звіту Задачі 1, тому закомічений, а не
 * лишений разовим скриптом:
 *   (а) чому останні рядки абзаців 86 і 130 дають стиснені пробіли — тобто на чому
 *       тримається єдина справжня правка спеки §4.2 і сам вердикт по воротах;
 *   (б) чи «розтягнуті» рядки з п. 3 справді розтягнуті — перевірка ширини рядка
 *       проти ширини рамки, незалежна від калібрування.
 *
 * Застереження до (б): порівняння тут іде з frame.geometricBounds, а не з ефективною
 * мірою. Для цього документа це те саме (відступи рамки нульові, одна колонка), але
 * для загального коду Задачі 6 придатна лише ефективна міра — див.
 * scripts/probe-calibration-measure.jsx.
 *
 * Індекси абзаців 86 і 130 прив'язані до конкретного стану документа
 * «Book-A 260804-0141.indd» на 2026-08-04 і в іншому документі нічого не значать.
 * У scratchpad під час прогону мав ім'я probe-h3-why.jsx.
 */
var out = {};
var doc = app.activeDocument;
var prevUnit = app.scriptPreferences.measurementUnit;
app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;

try {
    var big = null, bigLen = -1, s;
    for (s = 0; s < doc.stories.length; s++) {
        var len = doc.stories[s].characters.length;
        if (len > bigLen) { bigLen = len; big = doc.stories[s]; }
    }
    var paras = big.paragraphs;

    var SEP = "\r\n" + String.fromCharCode(0x2028) + String.fromCharCode(0x2029);
    function isControl(ch) {
        return typeof ch !== "string" || ch.length !== 1 || SEP.indexOf(ch) >= 0;
    }
    function describe(ch) {
        if (typeof ch !== "string") return "<не рядок: " + String(ch) + ">";
        if (ch === "\r") return "<CR>";
        if (ch === "\n") return "<LF>";
        if (ch === String.fromCharCode(0x2028)) return "<U+2028>";
        if (ch === String.fromCharCode(0x2029)) return "<U+2029>";
        return ch + " (U+" + ch.charCodeAt(0).toString(16) + ")";
    }

    /* --- (а) розбір проблемних абзаців --- */
    var targets = [86, 130];
    var detail = [];
    for (var t = 0; t < targets.length; t++) {
        var p = paras[targets[t]];
        var frame = null;
        try { frame = p.parentTextFrames[0]; } catch (eF) { frame = null; }
        var d = {
            paragraphIndex: targets[t],
            style: p.appliedParagraphStyle.name,
            pointSize: String(p.pointSize),
            justification: String(p.justification),
            composer: String(p.composer),
            hyphenation: p.hyphenation,
            minWS: p.minimumWordSpacing,
            desWS: p.desiredWordSpacing,
            maxWS: p.maximumWordSpacing,
            minGlyph: p.minimumGlyphScaling,
            desGlyph: p.desiredGlyphScaling,
            maxGlyph: p.maximumGlyphScaling,
            minLetter: p.minimumLetterSpacing,
            desLetter: p.desiredLetterSpacing,
            maxLetter: p.maximumLetterSpacing,
            frameWidth: null,
            lines: []
        };
        if (frame) {
            try {
                var gb = frame.geometricBounds;
                d.frameWidth = gb[3] - gb[1];
                d.frameColumnCount = frame.textFramePreferences.textColumnCount;
            } catch (eG) { d.frameWidth = null; }
        }
        for (var L = 0; L < p.lines.length; L++) {
            var ln = p.lines[L];
            var offs = ln.characters.everyItem().horizontalOffset;
            var cont = ln.characters.everyItem().contents;
            var ws = [];
            if (offs instanceof Array) {
                for (var j = 0; j < cont.length - 1; j++) {
                    if (cont[j] === " " && !isControl(cont[j + 1])) ws.push(offs[j + 1] - offs[j]);
                }
            }
            var lastC = cont instanceof Array ? cont[cont.length - 1] : null;
            d.lines.push({
                lineIndex: L,
                chars: ln.characters.length,
                lastChar: describe(lastC),
                startX: ln.horizontalOffset,
                endX: ln.endHorizontalOffset,
                lineWidth: ln.endHorizontalOffset - ln.horizontalOffset,
                spaceWidths: ws,
                text: String(ln.contents).substr(0, 45)
            });
        }
        detail.push(d);
    }
    out.problemParagraphs = detail;

    /* --- (б) чи «розтягнуті» рядки справді розтягнуті --- */
    /* Незалежна перевірка: беремо рядки з великим відношенням і дивимось, чи їхня
     * ширина справді близька до ширини колонки (тобто рядок виключений), і скільки
     * в ньому пробілів. Якщо рядок вузький, а «відношення» велике — вимір бреше. */
    var nat = 2.64494323730469; /* медіана з основного зонда для 11.5 пт */
    var loose = [];
    var paraLimit = Math.min(paras.length, 400);
    for (var pi = 0; pi < paraLimit && loose.length < 8; pi++) {
        var pr = paras[pi];
        if (pr.appliedParagraphStyle.name !== "Основний текст F") continue;
        for (var L2 = 0; L2 < pr.lines.length - 1; L2++) {
            var ln2 = pr.lines[L2];
            var o2 = ln2.characters.everyItem().horizontalOffset;
            var c2 = ln2.characters.everyItem().contents;
            if (!(o2 instanceof Array)) continue;
            var w2 = [];
            for (var j2 = 0; j2 < c2.length - 1; j2++) {
                if (c2[j2] === " " && !isControl(c2[j2 + 1])) w2.push(o2[j2 + 1] - o2[j2]);
            }
            if (w2.length === 0) continue;
            w2.sort(function (a, b) { return a - b; });
            var med2 = w2[Math.floor(w2.length / 2)];
            if (med2 / nat < 1.6) continue;
            var fr2 = null;
            try { fr2 = ln2.parentTextFrames[0]; } catch (eF2) { fr2 = null; }
            var fw = null;
            if (fr2) { try { var g2 = fr2.geometricBounds; fw = g2[3] - g2[1]; } catch (eG2) { fw = null; } }
            loose.push({
                paragraphIndex: pi,
                lineIndex: L2,
                chars: ln2.characters.length,
                spaceCount: w2.length,
                medianSpace: med2,
                ratio: med2 / nat,
                lineWidth: ln2.endHorizontalOffset - ln2.horizontalOffset,
                frameWidth: fw,
                text: String(ln2.contents).substr(0, 60)
            });
            if (loose.length >= 8) break;
        }
    }
    out.looseLineSamples = loose;
} finally {
    app.scriptPreferences.measurementUnit = prevUnit;
}

__result = out;

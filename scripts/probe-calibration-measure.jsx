/* Зонд H3, раунд виправлень. ЛИШЕ ЧИТАННЯ. Не присвоює жодної властивості документа;
 * єдине присвоєння — app.scriptPreferences.measurementUnit, налаштування застосунку,
 * відновлюється у finally.
 *
 * Дві прогалини, які рецензія назвала блокерами для Задачі 6:
 *
 * (а) ε і «ширина колонки» не визначені так, щоб їх можна було реалізувати.
 *     Діагностичний зонд порівнював ширину рядка з frame.geometricBounds, і це
 *     працювало лише тому, що в цьому документі відступи рамки, абзацні відступи
 *     й кількість колонок тривіальні. Тут рахуємо ЕФЕКТИВНУ МІРУ
 *     (ширина рамки − відступи рамки − міжколонник·(n−1)) / n − лівий і правий
 *     абзацні відступи, а для першого рядка ще й абзацний відступ першого рядка —
 *     і міряємо розподіл проміжку «ефективна міра − ширина рядка» на останніх
 *     рядках абзаців. Без цього розподілу ε не обмежене зверху: невідомо, наскільки
 *     близько до міри підходить СПРАВЖНІЙ (невиключений) останній рядок.
 *
 * (б) прохід щільності жодного разу не читав paragraph.justification, тож у
 *     знаменнику могли сидіти невиключені стилі, де кожен рядок тривіально дає
 *     відношення 1,000 і не може бути позначений ніколи. Тут та сама вибірка
 *     розбита за justification.
 */
var out = {};
var doc = app.activeDocument;
var prevUnit = app.scriptPreferences.measurementUnit;
app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;

try {
    out.docName = doc.name;
    out.measurementUnit = "points";

    var big = null, bigLen = -1, s;
    for (s = 0; s < doc.stories.length; s++) {
        var len = doc.stories[s].characters.length;
        if (len > bigLen) { bigLen = len; big = doc.stories[s]; }
    }

    var SEP = "\r\n" + String.fromCharCode(0x2028) + String.fromCharCode(0x2029);
    function isControl(ch) {
        return typeof ch !== "string" || ch.length !== 1 || SEP.indexOf(ch) >= 0;
    }
    function quantile(arr, q) {
        if (arr.length === 0) return null;
        var idx = Math.floor(q * (arr.length - 1));
        if (idx < 0) idx = 0;
        if (idx > arr.length - 1) idx = arr.length - 1;
        return arr[idx];
    }
    function num(v, fallback) {
        return (typeof v === "number" && !isNaN(v)) ? v : fallback;
    }

    /* Ефективна міра абзаца — те, що Задача 6 зобов'язана віддавати замість
     * ширини рамки. Порядок дій відтворює те, як InDesign будує рядок. */
    function effectiveMeasure(para) {
        var res = { measure: null, frameWidth: null, columns: null, error: null };
        var frame;
        try { frame = para.parentTextFrames[0]; } catch (eF) { return { measure: null, error: "немає parentTextFrames" }; }
        if (!frame) return { measure: null, error: "немає parentTextFrames" };
        try {
            var gb = frame.geometricBounds;
            var frameW = gb[3] - gb[1];
            res.frameWidth = frameW;

            var tfp = frame.textFramePreferences;
            var insetL = 0, insetR = 0;
            var ins = tfp.insetSpacing;
            if (ins instanceof Array) {
                /* [верх, ліво, низ, право] */
                insetL = num(ins[1], 0);
                insetR = num(ins[3], 0);
            } else {
                insetL = num(ins, 0);
                insetR = insetL;
            }
            var cols = num(tfp.textColumnCount, 1);
            var gutter = num(tfp.textColumnGutter, 0);
            res.columns = cols;
            res.insetLeft = insetL;
            res.insetRight = insetR;
            res.gutter = gutter;

            var colW = (frameW - insetL - insetR - gutter * (cols - 1)) / cols;
            var li = 0, ri = 0;
            try { li = num(para.leftIndent, 0); } catch (e1) { li = 0; }
            try { ri = num(para.rightIndent, 0); } catch (e2) { ri = 0; }
            res.leftIndent = li;
            res.rightIndent = ri;
            try { res.firstLineIndent = num(para.firstLineIndent, 0); } catch (e3) { res.firstLineIndent = 0; }
            res.measure = colW - li - ri;
        } catch (eM) {
            res.error = String(eM);
        }
        return res;
    }

    var paras = big.paragraphs;
    var paraLimit = Math.min(paras.length, 400);
    var p, i, L;

    /* --- крок 1: медіана ширини пробілу на стиль (як у основному зонді) --- */
    var byStyle = {};
    for (p = 0; p < paraLimit; p++) {
        var pa = paras[p];
        if (pa.lines.length === 0) continue;
        var lastLn = pa.lines[pa.lines.length - 1];
        var key = pa.appliedParagraphStyle.name + "@" + pa.pointSize;
        var offs0 = lastLn.characters.everyItem().horizontalOffset;
        var cont0 = lastLn.characters.everyItem().contents;
        if (!(offs0 instanceof Array)) continue;
        for (i = 0; i < cont0.length - 1; i++) {
            if (cont0[i] !== " ") continue;
            if (isControl(cont0[i + 1])) continue;
            var w0 = offs0[i + 1] - offs0[i];
            if (w0 <= 0) continue;
            if (!byStyle[key]) byStyle[key] = [];
            byStyle[key].push(w0);
        }
    }
    var styleMedian = {};
    var kk;
    for (kk in byStyle) {
        if (!byStyle.hasOwnProperty(kk)) continue;
        var sorted = byStyle[kk].sort(function (a, b) { return a - b; });
        styleMedian[kk] = quantile(sorted, 0.5);
    }

    /* --- крок 2 (finding 2): проміжок до ефективної міри на останніх рядках --- */
    var genuineGaps = [];   /* останні рядки, чиї пробіли в межах ±1% від медіани стилю */
    var justifiedLast = []; /* останні рядки зі стисненими/розтягнутими пробілами */
    var measureErrors = 0;
    for (p = 0; p < paraLimit; p++) {
        var pr = paras[p];
        if (pr.lines.length === 0) continue;
        var k = pr.appliedParagraphStyle.name + "@" + pr.pointSize;
        if (styleMedian[k] === undefined) continue;
        var ln = pr.lines[pr.lines.length - 1];

        var offs = ln.characters.everyItem().horizontalOffset;
        var cont = ln.characters.everyItem().contents;
        if (!(offs instanceof Array)) continue;
        var ws = [];
        for (i = 0; i < cont.length - 1; i++) {
            if (cont[i] === " " && !isControl(cont[i + 1])) ws.push(offs[i + 1] - offs[i]);
        }
        if (ws.length === 0) continue;
        ws.sort(function (a, b) { return a - b; });
        var ratio = quantile(ws, 0.5) / styleMedian[k];

        var em = effectiveMeasure(pr);
        if (em.measure === null) { measureErrors++; continue; }
        /* Останній рядок однорядкового абзаца — водночас і перший, тож на нього
         * діє абзацний відступ першого рядка. */
        var avail = em.measure - (pr.lines.length === 1 ? num(em.firstLineIndent, 0) : 0);
        var lineW = ln.endHorizontalOffset - ln.horizontalOffset;
        var gap = avail - lineW;

        var rec = {
            paragraphIndex: p,
            style: k,
            gap: gap,
            lineWidth: lineW,
            effectiveMeasure: em.measure,
            frameWidth: em.frameWidth,
            spaceRatio: ratio,
            lines: pr.lines.length,
            justification: String(pr.justification)
        };
        if (ratio > 0.99 && ratio < 1.01) genuineGaps.push(rec);
        else justifiedLast.push(rec);
    }

    var gapVals = [];
    for (i = 0; i < genuineGaps.length; i++) gapVals.push(genuineGaps[i].gap);
    gapVals.sort(function (a, b) { return a - b; });

    /* Скільки СПРАВЖНІХ останніх рядків втратив би фільтр за різних ε. */
    function lostAt(eps) {
        var n = 0;
        for (var z = 0; z < gapVals.length; z++) if (gapVals[z] < eps) n++;
        return n;
    }
    var badGaps = [];
    for (i = 0; i < justifiedLast.length; i++) badGaps.push(justifiedLast[i].gap);
    badGaps.sort(function (a, b) { return a - b; });

    out.epsilonEvidence = {
        genuineLastLines: genuineGaps.length,
        justifiedLastLines: justifiedLast.length,
        measureErrors: measureErrors,
        genuineGapMin: gapVals.length ? gapVals[0] : null,
        genuineGapP01: quantile(gapVals, 0.01),
        genuineGapP05: quantile(gapVals, 0.05),
        genuineGapP25: quantile(gapVals, 0.25),
        genuineGapP50: quantile(gapVals, 0.5),
        genuineGapMax: gapVals.length ? gapVals[gapVals.length - 1] : null,
        justifiedGapMin: badGaps.length ? badGaps[0] : null,
        justifiedGapMax: badGaps.length ? badGaps[badGaps.length - 1] : null,
        justifiedGaps: badGaps,
        genuineLostAtEps0_5: lostAt(0.5),
        genuineLostAtEps1: lostAt(1),
        genuineLostAtEps2: lostAt(2),
        genuineLostAtEps5: lostAt(5),
        genuineLostAtEps10: lostAt(10),
        /* Найтісніші справжні останні рядки — саме вони обмежують ε зверху. */
        tightestGenuine: []
    };
    genuineGaps.sort(function (a, b) { return a.gap - b.gap; });
    for (i = 0; i < genuineGaps.length && i < 15; i++) {
        out.epsilonEvidence.tightestGenuine.push(genuineGaps[i]);
    }
    out.justifiedLastLineDetail = justifiedLast;

    /* --- крок 3 (finding 4): щільність з розбивкою за justification --- */
    var byJust = {};
    var byStyleDensity = {};
    var maxRatio = -1, maxRatioWhere = null;
    var allRatios = [];
    for (p = 0; p < paraLimit; p++) {
        var pd = paras[p];
        var kd = pd.appliedParagraphStyle.name + "@" + pd.pointSize;
        if (!byStyle[kd] || byStyle[kd].length < 3) continue;
        var nat = styleMedian[kd];
        var maxR = pd.appliedParagraphStyle.maximumWordSpacing / 100;
        var minR = pd.appliedParagraphStyle.minimumWordSpacing / 100;
        var jname = String(pd.justification);

        if (!byJust[jname]) byJust[jname] = { checked: 0, outside: 0, exactlyOne: 0, above133: 0, below80: 0 };
        if (!byStyleDensity[kd]) byStyleDensity[kd] = { checked: 0, outside: 0, exactlyOne: 0, justification: jname };

        for (L = 0; L < pd.lines.length - 1; L++) {
            var l2 = pd.lines[L];
            var o2 = l2.characters.everyItem().horizontalOffset;
            var c2 = l2.characters.everyItem().contents;
            if (!(o2 instanceof Array)) continue;
            var w2 = [];
            for (var j = 0; j < c2.length - 1; j++) {
                if (c2[j] === " " && !isControl(c2[j + 1])) w2.push(o2[j + 1] - o2[j]);
            }
            if (w2.length === 0) continue;
            w2.sort(function (a, b) { return a - b; });
            var r2 = quantile(w2, 0.5) / nat;
            allRatios.push(r2);
            if (r2 > maxRatio) {
                maxRatio = r2;
                maxRatioWhere = { paragraphIndex: p, lineIndex: L, style: kd, justification: jname,
                                  medianSpace: quantile(w2, 0.5), spaces: w2.length };
            }
            byJust[jname].checked++;
            byStyleDensity[kd].checked++;
            if (Math.abs(r2 - 1) < 0.000001) { byJust[jname].exactlyOne++; byStyleDensity[kd].exactlyOne++; }
            if (r2 >= maxR) byJust[jname].above133++;
            if (r2 <= minR) byJust[jname].below80++;
            if (r2 >= maxR || r2 <= minR) { byJust[jname].outside++; byStyleDensity[kd].outside++; }
        }
    }
    var justArr = [];
    var jk;
    for (jk in byJust) {
        if (!byJust.hasOwnProperty(jk)) continue;
        justArr.push({
            justification: jk,
            linesChecked: byJust[jk].checked,
            linesOutside: byJust[jk].outside,
            pctOutside: byJust[jk].checked ? (byJust[jk].outside / byJust[jk].checked) * 100 : null,
            linesExactlyNatural: byJust[jk].exactlyOne,
            above133: byJust[jk].above133,
            below80: byJust[jk].below80
        });
    }
    var styleArr = [];
    var sk;
    for (sk in byStyleDensity) {
        if (!byStyleDensity.hasOwnProperty(sk)) continue;
        styleArr.push({
            style: sk,
            justification: byStyleDensity[sk].justification,
            linesChecked: byStyleDensity[sk].checked,
            linesOutside: byStyleDensity[sk].outside,
            linesExactlyNatural: byStyleDensity[sk].exactlyOne
        });
    }
    allRatios.sort(function (a, b) { return a - b; });
    out.densityByJustification = justArr;
    out.densityByStyle = styleArr;
    out.maxRatioOverAllLines = maxRatio;
    out.maxRatioWhere = maxRatioWhere;
    out.ratioCount = allRatios.length;
} finally {
    app.scriptPreferences.measurementUnit = prevUnit;
}

__result = out;

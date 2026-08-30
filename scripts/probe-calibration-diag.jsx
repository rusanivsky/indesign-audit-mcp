/* Зонд H3-діагностика. ЛИШЕ ЧИТАННЯ. Не входить у брифінг Задачі 1; доданий тому,
 * що основний зонд (scripts/probe-calibration.jsx) дав два числа, які не можна
 * чесно записати у факти без розбору:
 *
 *   1. spreadPct = 88% на стилі «Основний текст F@11.5» при тому, що медіана в нього
 *      така сама, як у двох інших стилів того ж кегля з розкидом ~0.001%. Розмах
 *      min–max нічого не каже про те, ЧИ це кілька викидів, ЧИ справді нестійкий
 *      розподіл. Тут рахуємо перцентилі й частку зразків біля медіани.
 *   2. out.controlCharWidth в основному зонді рахується як
 *      horizontalOffset(останній символ) − horizontalOffset(передостанній), тобто це
 *      ширина ПЕРЕДОСТАННЬОГО (друкованого) гліфа, а не синтетична ширина керівного
 *      символа \r. Гіпотезу H1 таким виміром перевірити не можна. Тут вимірюємо
 *      те, що вимірював H1: endHorizontalOffset(рядок) − horizontalOffset(\r).
 *
 * Плюс гістограма відношень для п. 3 (щільність знахідок) — щоб бачити не лише
 * «скільки за межами», а й наскільки далеко за межами.
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
        var idx = Math.floor(q * (arr.length - 1));
        if (idx < 0) idx = 0;
        if (idx > arr.length - 1) idx = arr.length - 1;
        return arr[idx];
    }

    var paras = big.paragraphs;
    var paraLimit = Math.min(paras.length, 400);

    /* Який стиль у paras[0] — щоб пояснити число 6.73 з основного зонда. */
    out.firstParagraph = {
        style: paras[0].appliedParagraphStyle.name,
        pointSize: String(paras[0].pointSize),
        charCount: paras[0].characters.length
    };

    /* --- 1. Розподіл ширин пробілу на останніх рядках абзаців --- */
    var byStyle = {};
    var outliers = [];
    var pi, i;
    for (pi = 0; pi < paraLimit; pi++) {
        var para = paras[pi];
        if (para.lines.length === 0) continue;
        var last = para.lines[para.lines.length - 1];
        var key = para.appliedParagraphStyle.name + "@" + para.pointSize;

        var offsets = last.characters.everyItem().horizontalOffset;
        var contents = last.characters.everyItem().contents;
        if (!(offsets instanceof Array)) continue;

        for (i = 0; i < contents.length - 1; i++) {
            if (contents[i] !== " ") continue;
            if (isControl(contents[i + 1])) continue;
            var w = offsets[i + 1] - offsets[i];
            if (w <= 0) continue;
            if (!byStyle[key]) byStyle[key] = [];
            byStyle[key].push({ w: w, para: pi, pos: i });
        }
    }

    var dist = [];
    var styleMedian = {};
    var key2;
    for (key2 in byStyle) {
        if (!byStyle.hasOwnProperty(key2)) continue;
        var recs = byStyle[key2];
        var vals = [];
        for (i = 0; i < recs.length; i++) vals.push(recs[i].w);
        vals.sort(function (a, b) { return a - b; });
        var med = quantile(vals, 0.5);
        styleMedian[key2] = med;

        /* Скільки зразків насправді сидять біля медіани — на це spreadPct не відповідає. */
        var near = 0, below = 0, above = 0;
        for (i = 0; i < vals.length; i++) {
            var rel = vals[i] / med;
            if (rel > 0.99 && rel < 1.01) near++;
            else if (rel <= 0.99) below++;
            else above++;
        }
        dist.push({
            style: key2,
            samples: vals.length,
            median: med,
            p01: quantile(vals, 0.01),
            p05: quantile(vals, 0.05),
            p25: quantile(vals, 0.25),
            p75: quantile(vals, 0.75),
            p95: quantile(vals, 0.95),
            p99: quantile(vals, 0.99),
            withinOnePctOfMedian: near,
            belowMedianOverOnePct: below,
            aboveMedianOverOnePct: above,
            /* Стійкий розкид: p05..p95 замість min..max. */
            spreadPctP05P95: quantile(vals, 0.05) > 0
                ? ((quantile(vals, 0.95) - quantile(vals, 0.05)) / quantile(vals, 0.05)) * 100
                : null
        });

        /* Зібрати самі викиди — що це за абзаци. Ліміт свідомо вищий за найбільшу
         * спостережену кількість викидів (18), інакше список обривається й частина
         * викидів лишається неатрибутованою, а звіт стверджує про них більше, ніж
         * виміряно. */
        for (i = 0; i < recs.length && outliers.length < 60; i++) {
            if (recs[i].w / med < 0.99) {
                var op = paras[recs[i].para];
                var oline = op.lines[op.lines.length - 1];
                var spaceChar = null;
                try { spaceChar = oline.characters[recs[i].pos]; } catch (eSC) { spaceChar = null; }
                var rec = {
                    style: key2,
                    width: recs[i].w,
                    ratioToMedian: recs[i].w / med,
                    paragraphIndex: recs[i].para,
                    justification: String(op.justification),
                    paragraphLineCount: op.lines.length,
                    lastLineCharCount: oline.characters.length,
                    lastLineText: String(oline.contents).substr(0, 70)
                };
                if (spaceChar) {
                    try { rec.spacePointSize = spaceChar.pointSize; } catch (e1) { rec.spacePointSize = null; }
                    try { rec.spaceTracking = spaceChar.tracking; } catch (e2) { rec.spaceTracking = null; }
                    try { rec.spaceHorizontalScale = spaceChar.horizontalScale; } catch (e3) { rec.spaceHorizontalScale = null; }
                    try { rec.spaceAppliedFont = String(spaceChar.appliedFont.name); } catch (e4) { rec.spaceAppliedFont = null; }
                }
                outliers.push(rec);
            }
        }
    }
    out.distribution = dist;
    out.outlierSamples = outliers;

    /* --- 2. Гіпотеза H1: справжня синтетична ширина керівного символа \r --- */
    var ctrl = [];
    var seenCtrl = {};
    for (pi = 0; pi < paraLimit && ctrl.length < 6; pi++) {
        var cp = paras[pi];
        if (cp.lines.length === 0) continue;
        var ckey = cp.appliedParagraphStyle.name + "@" + cp.pointSize;
        if (seenCtrl[ckey]) continue;
        var cline = cp.lines[cp.lines.length - 1];
        var cchars = cline.characters;
        if (cchars.length < 2) continue;
        var clast = cchars[cchars.length - 1];
        var clastContents = clast.contents;
        if (clastContents instanceof Array) clastContents = clastContents[0];
        if (clastContents !== "\r") continue;
        seenCtrl[ckey] = true;
        ctrl.push({
            style: ckey,
            /* Те, що вимірював H1: ширина самого керівного символа. */
            controlCharSyntheticWidth: cline.endHorizontalOffset - clast.horizontalOffset,
            /* Те, що рахує основний зонд H3 під іменем controlCharWidth: ширина
             * передостаннього ДРУКОВАНОГО гліфа. Дві різні величини. */
            lastGlyphWidth: clast.horizontalOffset - cchars[cchars.length - 2].horizontalOffset,
            calibratedSpaceWidth: styleMedian[ckey] !== undefined ? styleMedian[ckey] : null
        });
    }
    out.controlCharCheck = ctrl;

    /* --- 3. Гістограма відношень для щільності знахідок --- */
    var buckets = { lt60: 0, b60_80: 0, b80_90: 0, b90_110: 0, b110_133: 0, b133_160: 0, gt160: 0 };
    var ratios = [];
    var checked = 0, outside = 0;
    for (pi = 0; pi < paraLimit; pi++) {
        var pr = paras[pi];
        var k2 = pr.appliedParagraphStyle.name + "@" + pr.pointSize;
        if (!byStyle[k2] || byStyle[k2].length < 3) continue;
        var nat = styleMedian[k2];
        var maxR = pr.appliedParagraphStyle.maximumWordSpacing / 100;
        var minR = pr.appliedParagraphStyle.minimumWordSpacing / 100;

        for (var L = 0; L < pr.lines.length - 1; L++) {
            var ln = pr.lines[L];
            var offs = ln.characters.everyItem().horizontalOffset;
            var cont = ln.characters.everyItem().contents;
            if (!(offs instanceof Array)) continue;
            var widths = [];
            for (var j = 0; j < cont.length - 1; j++) {
                if (cont[j] === " " && !isControl(cont[j + 1])) widths.push(offs[j + 1] - offs[j]);
            }
            if (widths.length === 0) continue;
            widths.sort(function (a, b) { return a - b; });
            var ratio = widths[Math.floor(widths.length / 2)] / nat;
            checked++;
            ratios.push(ratio);
            if (ratio >= maxR || ratio <= minR) outside++;
            if (ratio < 0.6) buckets.lt60++;
            else if (ratio < 0.8) buckets.b60_80++;
            else if (ratio < 0.9) buckets.b80_90++;
            else if (ratio < 1.1) buckets.b90_110++;
            else if (ratio < 1.33) buckets.b110_133++;
            else if (ratio < 1.6) buckets.b133_160++;
            else buckets.gt160++;
        }
    }
    ratios.sort(function (a, b) { return a - b; });
    out.densityDetail = {
        linesChecked: checked,
        linesOutsideBounds: outside,
        buckets: buckets,
        ratioP05: quantile(ratios, 0.05),
        ratioP25: quantile(ratios, 0.25),
        ratioMedianP50: quantile(ratios, 0.5),
        ratioP75: quantile(ratios, 0.75),
        ratioP95: quantile(ratios, 0.95)
    };
} finally {
    app.scriptPreferences.measurementUnit = prevUnit;
}

__result = out;

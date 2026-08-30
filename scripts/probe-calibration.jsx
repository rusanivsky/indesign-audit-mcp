/* Зонд H3. ЛИШЕ ЧИТАННЯ. Три виміри: пакетування everyItem(),
 * стабільність калібрування, щільність знахідок. */
var out = {};
var doc = app.activeDocument;
var prevUnit = app.scriptPreferences.measurementUnit;
app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;

try {
    out.docName = doc.name;
    out.measurementUnit = "points";

    /* 0. Найбільша story — не stories[0]: у цьому документі індекс 0 службовий. */
    var big = null, bigLen = -1, s;
    for (s = 0; s < doc.stories.length; s++) {
        var len = doc.stories[s].characters.length;
        if (len > bigLen) { bigLen = len; big = doc.stories[s]; }
    }
    out.storyChars = bigLen;
    out.storyLines = big.lines.length;

    /* 1. Пакетування everyItem() проти поелементного доступу, на 500 символах. */
    var probeLine = big.lines[Math.floor(big.lines.length / 2)];
    var t0 = new Date().getTime();
    var batched = probeLine.characters.everyItem().horizontalOffset;
    var t1 = new Date().getTime();
    out.everyItem = {
        returnedArray: (batched instanceof Array),
        count: (batched instanceof Array) ? batched.length : -1,
        ms: t1 - t0,
        charsInLine: probeLine.characters.length
    };

    var t2 = new Date().getTime();
    var oneByOne = [];
    for (var c = 0; c < probeLine.characters.length; c++) {
        oneByOne.push(probeLine.characters[c].horizontalOffset);
    }
    var t3 = new Date().getTime();
    out.perItem = { ms: t3 - t2, count: oneByOne.length };

    /* Чи однакові числа обома шляхами — інакше пакетування непридатне. */
    var same = (batched instanceof Array) && batched.length === oneByOne.length;
    if (same) {
        for (var k = 0; k < oneByOne.length; k++) {
            if (Math.abs(batched[k] - oneByOne[k]) > 0.001) { same = false; break; }
        }
    }
    out.everyItem.matchesPerItem = same;

    /* 2. Калібрування: ширина пробілу на ОСТАННІХ рядках абзаців. */
    var SEP = "\r\n" + String.fromCharCode(0x2028) + String.fromCharCode(0x2029);
    function isControl(ch) {
        return typeof ch !== "string" || ch.length !== 1 || SEP.indexOf(ch) >= 0;
    }

    var byStyle = {};
    var paras = big.paragraphs;
    var paraLimit = Math.min(paras.length, 400);
    for (var p = 0; p < paraLimit; p++) {
        var para = paras[p];
        if (para.lines.length === 0) continue;
        var last = para.lines[para.lines.length - 1];
        var key = para.appliedParagraphStyle.name + "@" + para.pointSize;

        var offsets = last.characters.everyItem().horizontalOffset;
        var contents = last.characters.everyItem().contents;
        if (!(offsets instanceof Array)) continue;

        for (var i = 0; i < contents.length - 1; i++) {
            if (contents[i] !== " ") continue;
            if (isControl(contents[i + 1])) continue;
            var w = offsets[i + 1] - offsets[i];
            if (w <= 0) continue;
            if (!byStyle[key]) byStyle[key] = [];
            byStyle[key].push(w);
        }
    }

    var calib = [];
    for (var key2 in byStyle) {
        if (!byStyle.hasOwnProperty(key2)) continue;
        var arr = byStyle[key2].sort(function (a, b) { return a - b; });
        var mid = Math.floor(arr.length / 2);
        var median = arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
        calib.push({
            style: key2,
            samples: arr.length,
            median: median,
            min: arr[0],
            max: arr[arr.length - 1],
            /* Розкид — головне число задачі: якщо він великий, калібрування нестійке. */
            spreadPct: arr[0] > 0 ? ((arr[arr.length - 1] - arr[0]) / arr[0]) * 100 : null
        });
    }
    out.calibration = calib;

    /* 3. Гіпотеза H1: чи дорівнює синтетична ширина \r каліброваній ширині пробілу. */
    var firstPara = paras[0];
    var lastCh = firstPara.characters[firstPara.characters.length - 1];
    var prevCh = firstPara.characters[firstPara.characters.length - 2];
    out.controlCharWidth = lastCh.horizontalOffset - prevCh.horizontalOffset;

    /* 4. Щільність знахідок: скільки рядків виходять за межі виключки стилю. */
    var checked = 0, outside = 0, uncal = 0;
    for (var p2 = 0; p2 < paraLimit; p2++) {
        var pr = paras[p2];
        var k2 = pr.appliedParagraphStyle.name + "@" + pr.pointSize;
        if (!byStyle[k2] || byStyle[k2].length < 3) { uncal += pr.lines.length; continue; }
        var arr2 = byStyle[k2].sort(function (a, b) { return a - b; });
        var nat = arr2[Math.floor(arr2.length / 2)];
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
            var w2 = widths[Math.floor(widths.length / 2)];
            var ratio = w2 / nat;
            checked++;
            if (ratio >= maxR || ratio <= minR) outside++;
        }
    }
    out.density = {
        linesChecked: checked,
        linesOutsideBounds: outside,
        linesUncalibrated: uncal,
        pctOutside: checked > 0 ? (outside / checked) * 100 : null
    };
} finally {
    app.scriptPreferences.measurementUnit = prevUnit;
}

__result = out;

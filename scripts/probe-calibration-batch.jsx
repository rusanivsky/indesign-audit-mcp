/* Зонд H3, вимір пакетування everyItem() на більшій вибірці. ЛИШЕ ЧИТАННЯ.
 * Не присвоює жодної властивості документа; єдине присвоєння —
 * app.scriptPreferences.measurementUnit, налаштування застосунку, відновлюється у finally.
 *
 * Основний зонд міряв пакетування на одному рядку в 66 символів, де обидва числа
 * (5 і 24 мс) лежать на межі роздільної здатності таймера. Це єдиний доказ під
 * заголовним числом звіту (≈9–10×), тому закомічений, а не лишений разовим скриптом.
 * У scratchpad під час прогону мав ім'я probe-h3-batch.jsx.
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
    var lines = big.lines;
    var N = 60;
    var start = Math.floor(lines.length / 4);

    var chars = 0, mism = 0, i, j;
    var t0 = new Date().getTime();
    var batchedAll = [];
    for (i = 0; i < N; i++) {
        var b = lines[start + i].characters.everyItem().horizontalOffset;
        batchedAll.push(b instanceof Array ? b : [b]);
    }
    var msBatched = new Date().getTime() - t0;

    var t1 = new Date().getTime();
    var perAll = [];
    for (i = 0; i < N; i++) {
        var lc = lines[start + i].characters;
        var arr = [];
        for (j = 0; j < lc.length; j++) arr.push(lc[j].horizontalOffset);
        perAll.push(arr);
        chars += arr.length;
    }
    var msPer = new Date().getTime() - t1;

    for (i = 0; i < N; i++) {
        if (batchedAll[i].length !== perAll[i].length) { mism++; continue; }
        for (j = 0; j < perAll[i].length; j++) {
            if (Math.abs(batchedAll[i][j] - perAll[i][j]) > 0.000001) { mism++; break; }
        }
    }
    out.batch = {
        lines: N, chars: chars,
        msBatched: msBatched, msPerItem: msPer,
        speedup: msBatched > 0 ? msPer / msBatched : null,
        msPerCharBatched: msBatched / chars,
        msPerCharPerItem: msPer / chars,
        linesWithAnyMismatch: mism
    };
} finally {
    app.scriptPreferences.measurementUnit = prevUnit;
}
__result = out;

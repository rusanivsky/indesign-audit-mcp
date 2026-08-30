/* Зонд H13, дзеркалення полів — ПІДСТАВА ЗНАХІДКИ C1. ЛИШЕ ЧИТАННЯ.
 *
 * ПИТАННЯ, на яке треба відповісти ЧИСЛОМ, а не вірою:
 * `marginPreferences.left` у документі з розворотами — це ВНУТРІШНЄ поле
 * (тоді на verso полоса починається від `mp.right`, і дзеркалення реальне),
 * чи фізично ліве (тоді дзеркалення не потрібне взагалі)?
 *
 * НАВІЩО. До 2026-08-15 обмін inside/outside стояв У ДВОХ місцях одразу —
 * у `src/jsx/geometry.jsx` і в `typeArea()` (`src/geometry/reference.ts`).
 * Композиція двох обмінів — ТОТОЖНІСТЬ: `typeArea` віддавав
 * [top, mp.left, H−bottom, W−mp.right] на ОБОХ сторонах, тобто дзеркалення
 * не було зовсім, попри те, що обидва місця його декларували коментарями.
 * На 98 verso-сторінках полоса й межі колонок були хибні на 11,3386 pt.
 *
 * СПОСІБ. Беремо на кожній сторінці найширшу нерозвернуту `TextFrame`, що
 * лежить у межах аркуша, і звіряємо її ліву й праву межу з `mp.left`/
 * `mp.right` ТІЄЇ Ж сторінки. Два проходи: перший показує сторінки поіменно
 * (щоб було видно, що це не одна аномалія), другий рахує агрегат по ОБОХ
 * межах і по всіх рамках, а не лише найширшій.
 *
 * ВИМІРЯНО 2026-08-15 на «Book 260811-1645.indd», 196 сторінок,
 * modified === false до і після:
 *
 *   сира сигнатура полів ОДНА на всі 196 сторінок:
 *     top 51,0236 | left 79,3701 | bottom 60,5764 | right 90,7087
 *
 *   recto: x1 ≈ mp.left 128 разів, ≈ mp.right   0 разів
 *          x2 ≈ W−mp.right 107,    ≈ W−mp.left  0
 *   verso: x1 ≈ mp.right 119,      ≈ mp.left    0
 *          x2 ≈ W−mp.left 132,     ≈ W−mp.right 0
 *
 * НУЛЬ контрприкладів в обидва боки, на обох межах ⇒ `mp.left` — внутрішнє
 * поле на ОБОХ сторонах, `mp.right` — зовнішнє. Дзеркалення РЕАЛЬНЕ, і
 * робити його має рівно одне місце — `typeArea()`. Обмін у geometry.jsx
 * прибрано.
 */

var DOC_NAME = "Book 260811-1645.indd";

var previousUnit = app.scriptPreferences.measurementUnit;
app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;

var out = { rows: [], agg: {}, marginSig: {}, threw: [] };

try {
    var doc = app.documents.itemByName(DOC_NAME);
    if (!doc.isValid) throw new Error("Документ не відкрито.");
    out.modifiedBefore = doc.modified;
    out.rulerOrigin = String(doc.viewPreferences.rulerOrigin);
    out.zeroPoint = [doc.zeroPoint[0], doc.zeroPoint[1]];

    var pw = doc.documentPreferences.pageWidth;
    var ph = doc.documentPreferences.pageHeight;
    out.pageW = pw;
    out.pageH = ph;

    /* Агрегат по ОБОХ межах: одна межа могла б збігтися випадково, дві —
     * ні. Саме друга межа й закриває питання остаточно. */
    var st = {
        left:  { x1eqL: 0, x1eqR: 0, x2eqPwL: 0, x2eqPwR: 0, n: 0 },
        right: { x1eqL: 0, x1eqR: 0, x2eqPwL: 0, x2eqPwR: 0, n: 0 }
    };

    var pages = doc.pages.everyItem().getElements();
    for (var i = 0; i < pages.length; i++) {
        var p = pages[i];
        var mp = p.marginPreferences;
        var sideRaw = String(p.side);
        var sk = null;
        if (sideRaw === "LEFT_HAND") sk = "left";
        else if (sideRaw === "RIGHT_HAND") sk = "right";
        if (sk === null) continue;

        var sig = mp.top + "|" + mp.left + "|" + mp.bottom + "|" + mp.right;
        out.marginSig[sig] = (out.marginSig[sig] || 0) + 1;

        var items = p.allPageItems;
        var best = null, bestW = -1;
        for (var k = 0; k < items.length; k++) {
            var it = items[k];

            var tn = "?";
            try { tn = String(it.constructor.name); } catch (e1) {}
            if (tn !== "TextFrame") continue;

            /* Прив'язані рамки не годяться: їхні координати стосуються
             * тексту-носія, а не полоси. Беремо лише те, що лежить прямо на
             * сторінці чи розвороті. */
            var pk = "?";
            try { pk = String(it.parent.constructor.name); } catch (e2) {}
            if (pk !== "Page" && pk !== "Spread") continue;

            /* Повернені виключено: для них geometricBounds — осеорієнтована
             * оболонка, і її СТОРОНИ не є сторонами рамки. */
            var rot = 0;
            try { rot = it.rotationAngle; } catch (e3) {}
            if (rot !== 0) continue;

            var b = null;
            try { var bb = it.geometricBounds; b = [bb[0], bb[1], bb[2], bb[3]]; }
            catch (e4) { continue; }

            /* Відсіюємо монтажний стіл і дрібні службові рамки. */
            if (b[1] < -50 || b[3] > pw + 50) continue;
            if ((b[3] - b[1]) < 100 || (b[2] - b[0]) < 30) continue;

            st[sk].n++;
            if (Math.abs(b[1] - mp.left) < 0.5) st[sk].x1eqL++;
            if (Math.abs(b[1] - mp.right) < 0.5) st[sk].x1eqR++;
            if (Math.abs(b[3] - (pw - mp.left)) < 0.5) st[sk].x2eqPwL++;
            if (Math.abs(b[3] - (pw - mp.right)) < 0.5) st[sk].x2eqPwR++;

            if ((b[3] - b[1]) > bestW) { bestW = b[3] - b[1]; best = b; }
        }

        if (best !== null && out.rows.length < 40) {
            out.rows.push({
                pg: String(p.name), side: sk,
                mpL: mp.left, mpR: mp.right,
                fx1: Math.round(best[1] * 10000) / 10000,
                fx2: Math.round(best[3] * 10000) / 10000,
                rightGap: Math.round((pw - best[3]) * 10000) / 10000
            });
        }
    }

    out.agg = st;
    out.modifiedAfter = doc.modified;
} catch (fatal) {
    out.fatal = String(fatal) + (fatal.line ? (" (рядок " + fatal.line + ")") : "");
} finally {
    app.scriptPreferences.measurementUnit = previousUnit;
}

__result = out;

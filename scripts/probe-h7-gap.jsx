/*
 * ПИТАННЯ 18: що друкує PREVIOUS_PAGE_NUMBER над ланцюжком ІЗ ПРОПУСКОМ.
 *
 * Питання 5 міряло СУЦІЛЬНИЙ ланцюжок — там «попередня рамка ланцюжка» і
 * «сторінка offset − 1» збігаються, тож розрізнити їх було неможливо. Тут вони
 * розведені навмисно: ланцюжок стоїть лише на непарних сторінках, тобто рівно
 * так, як ліг би службовий за правилом «рамка там, де є колонцифра».
 *
 * ПЕРША СПРОБА ЦЬОГО ЗОНДА МАЛА ВЛАСНУ ВАДУ: межі задавались числами замість
 * page.bounds, і при facingPages рамка, додана до сторінки «3», лягала
 * геометрично на «2». Тепер кожна рамка позиціонується від меж СВОЄЇ сторінки.
 */
var doc = app.documents.add();
var out = { cases: [], pdf: null };

try {
    doc.documentPreferences.facingPages = true;
    doc.documentPreferences.pagesPerDocument = 8;
    app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;

    function boxOn(page, dy) {
        var b = page.bounds;           /* [y1, x1, y2, x2] у координатах розвороту */
        var y1 = b[0] + 40 + dy;
        var x1 = b[1] + 40;
        return [y1, x1, y1 + 24, x1 + 120];
    }

    var chain = [];
    for (var p = 0; p < doc.pages.length; p += 2) {
        var pg = doc.pages[p];
        var f = pg.textFrames.add();
        f.geometricBounds = boxOn(pg, 0);
        chain.push({ frame: f, pageIndex: p, pageName: String(pg.name) });
    }
    for (var c = 0; c < chain.length - 1; c++) {
        chain[c].frame.nextTextFrame = chain[c + 1].frame;
    }

    /* Мітка ПЕРЕКРИВАЄ ланцюжкову рамку — та сама геометрія. */
    for (var m = 0; m < chain.length; m++) {
        var mp = doc.pages[chain[m].pageIndex];
        var mark = mp.textFrames.add();
        mark.geometricBounds = boxOn(mp, 0);
        mark.insertionPoints[0].contents = SpecialCharacters.PREVIOUS_PAGE_NUMBER;
        chain[m].mark = mark;
    }

    doc.recompose();

    for (var r = 0; r < chain.length; r++) {
        var containers = chain[r].frame.parentStory.textContainers;
        var at = -1;
        for (var q = 0; q < containers.length; q++) {
            if (containers[q].id === chain[r].frame.id) { at = q; break; }
        }
        var prevPage = null;
        if (at > 0) {
            var pp = containers[at - 1].parentPage;
            if (pp !== null && pp !== undefined) prevPage = String(pp.name);
        }
        var ownPage = chain[r].frame.parentPage;
        out.cases.push({
            markOnPage: chain[r].pageName,
            chainFrameActuallyOn: ownPage === null ? null : String(ownPage.name),
            chainPreviousFrameOnPage: prevPage,
            pageMinusOne: chain[r].pageIndex > 0 ? String(doc.pages[chain[r].pageIndex - 1].name) : null
        });
    }

    var pdfPath = "/tmp/gap.pdf";
    doc.exportFile(ExportFormat.PDF_TYPE, new File(pdfPath), false);
    out.pdf = pdfPath;
} finally {
    doc.close(SaveOptions.NO);
}

__result = out;

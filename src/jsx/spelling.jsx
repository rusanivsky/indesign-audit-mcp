/*
 * Language ranges. Text does NOT travel here — containers_read (inspect.jsx)
 * already carries it. Only what that snapshot lacks lives here: appliedLanguage
 * on the textStyleRange, at the offsets of that SAME container text.
 *
 * ExtendScript has no JSON — the result goes into __result, the bridge
 * serializes it.
 *
 * Task 7 review: the catch below traps a property-READ failure, not the
 * normal "no language set" case — that normal value is what InDesign itself
 * returns as the string "[No Language]" via a successful try. If the catch
 * returned that same string, a real error would become indistinguishable
 * from ordinary data. Hence a separate sentinel string here instead of
 * "[No Language]" — the TS side (assertNoLanguageReadErrors,
 * src/spelling/langruns.ts) throws loudly the moment it sees it.
 */
IDMCP.handlers.language_runs_read = function () {
    var doc = IDMCP.activeDoc();
    var out = [];

    for (var s = 0; s < doc.stories.length; s++) {
        var story = doc.stories[s];

        /* everyItem().getElements() — not indexing: the same work at 773 ms
         * versus 22 ms (Phase 8 measurement). */
        var tsr = story.textStyleRanges.everyItem().getElements();
        var runs = [];
        var cursor = 0;
        for (var k = 0; k < tsr.length; k++) {
            var len = tsr[k].characters.length;
            var nm;
            try { nm = String(tsr[k].appliedLanguage.name); }
            catch (e) { nm = "[Language read error]"; }
            runs.push({ start: cursor, end: cursor + len, language: nm });
            cursor += len;
        }
        out.push({ containerId: "story:" + s, runs: runs });

        /* Footnotes — a separate text flow, a separate container in containers_read. */
        for (var fn = 0; fn < story.footnotes.length; fn++) {
            var ftext = story.footnotes[fn].texts[0];
            var ftsr = ftext.textStyleRanges.everyItem().getElements();
            var fruns = [];
            var fcursor = 0;
            for (var q = 0; q < ftsr.length; q++) {
                var flen = ftsr[q].characters.length;
                var fnm;
                try { fnm = String(ftsr[q].appliedLanguage.name); }
                catch (e) { fnm = "[Language read error]"; }
                fruns.push({ start: fcursor, end: fcursor + flen, language: fnm });
                fcursor += flen;
            }
            out.push({ containerId: "story:" + s + "/footnote:" + fn, runs: fruns });
        }

        /* Table cells — likewise separate containers. */
        for (var t = 0; t < story.tables.length; t++) {
            var table = story.tables[t];
            for (var r = 0; r < table.rows.length; r++) {
                for (var cc = 0; cc < table.rows[r].cells.length; cc++) {
                    var cell = table.rows[r].cells[cc];
                    var ctsr = cell.textStyleRanges.everyItem().getElements();
                    var cruns = [];
                    var ccursor = 0;
                    for (var z = 0; z < ctsr.length; z++) {
                        var clen = ctsr[z].characters.length;
                        var cnm;
                        try { cnm = String(ctsr[z].appliedLanguage.name); }
                        catch (e) { cnm = "[Language read error]"; }
                        cruns.push({ start: ccursor, end: ccursor + clen, language: cnm });
                        ccursor += clen;
                    }
                    out.push({
                        containerId: "story:" + s + "/table:" + t + "/cell:" + r + "," + cc,
                        runs: cruns
                    });
                }
            }
        }
    }

    return { docName: doc.name, containers: out };
};

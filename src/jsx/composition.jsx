/* Composition measurement. READ-ONLY: no writes to the document. */

/*
 * Whether a character is a printable glyph. We compare CODES, not
 * characters: literal U+2028/U+2029 in an ES3 literal break the script, and
 * via charCodeAt there's no need to construct them at all.
 *
 * We filter out the whole C0 range (< 32), not just \r and \n from the
 * brief. The reason is measured on the fixture: the table anchor is
 * U+0016, and the footnote marker is U+0004, and both passed as an
 * "ordinary character". A line consisting of a single table anchor has
 * ZERO width (right === left) at the full column width — exactly the same
 * trap as with rotated frames: it would pass itself off as measurable
 * text.
 */
IDMCP.isPrintableChar = function (ch) {
    if (typeof ch !== "string") return false;
    if (ch.length !== 1) return false;
    var code = ch.charCodeAt(0);
    if (code < 32) return false;               /* C0: \r, \n, table anchor, footnote marker, tab */
    if (code === 0x2028 || code === 0x2029) return false;
    return true;
};

/*
 * Whether it's a letter. ES3 has no Unicode classes in regexes, but
 * ExtendScript knows the case of both Latin and Cyrillic — verified by a
 * probe: for 'а'/'А' toUpperCase and toLowerCase differ, while for a digit,
 * hyphen, or apostrophe they're the same. That's enough for this book's
 * languages.
 */
IDMCP.isLetterChar = function (ch) {
    if (typeof ch !== "string" || ch.length !== 1) return false;
    return ch.toUpperCase() !== ch.toLowerCase();
};

/*
 * InDesign returns NothingEnum.NOTHING instead of a number when a property
 * is mixed within the paragraph (different point sizes in one paragraph,
 * etc.). IDMCP.stringify would serialize this as an object and poison the
 * key (style, size) in Task 7's calibration. This book has none of that
 * (all 2,981 paragraphs return numbers), but a silent type substitution is
 * exactly the class of bug that cost Phase 2 two rounds.
 */
IDMCP.numberOrNull = function (value) {
    return (typeof value === "number" && isFinite(value)) ? value : null;
};

/* Same thing, but for measure arithmetic: a mixed indent counts as 0. */
IDMCP.numberOrZero = function (value) {
    return (typeof value === "number" && isFinite(value)) ? value : 0;
};

/*
 * Frame geometry, its rotation, and its lines' bounds are values constant
 * for the whole frame, yet have to be computed for EVERY line. On a
 * 196-page book (5,193 lines) that's thousands of frame.lines collection
 * builds for nothing. We cache by frame.id: we don't mutate the document,
 * so recomposition can't happen within a single call and the cache can't
 * go stale.
 */
IDMCP.frameGeometry = function (frame, pageObj, cache) {
    var key = String(frame.id);
    if (cache[key]) return cache[key];

    var b = frame.geometricBounds; /* [y1, x1, y2, x2] */
    var prefs = frame.textFramePreferences;
    var insets = prefs.insetSpacing;
    var insetL = (insets instanceof Array) ? IDMCP.numberOrZero(insets[1]) : IDMCP.numberOrZero(insets);
    var insetR = (insets instanceof Array) ? IDMCP.numberOrZero(insets[3]) : IDMCP.numberOrZero(insets);
    var colCount = prefs.textColumnCount || 1;
    var gutter = IDMCP.numberOrZero(prefs.textColumnGutter);
    var usable = (b[3] - b[1]) - insetL - insetR - gutter * (colCount - 1);

    /*
     * Frame rotation. absoluteRotationAngle also accounts for the rotation
     * of a group the frame may sit in, so it's more correct than
     * rotationAngle; on this book both agree across all 651 containers
     * (540 direct, +90 ×13, -90 ×98).
     */
    var angle = 0;
    try {
        angle = frame.absoluteRotationAngle;
    } catch (e) {
        try { angle = frame.rotationAngle; } catch (e2) { angle = 0; }
    }
    angle = IDMCP.numberOrZero(angle);

    var frameLines = frame.lines;
    var geo = {
        /* Width of a single column without insets; paragraph indents are
         * subtracted separately, since they're a property of the paragraph,
         * not the frame. */
        usablePerColumn: usable / colCount,
        firstLineIndex: frameLines.length > 0 ? frameLines[0].index : null,
        lastLineIndex: frameLines.length > 0 ? frameLines[frameLines.length - 1].index : null,
        rotationAngle: angle,
        rotated: Math.abs(angle) > 1e-6,
        /* We determine the master via the PAGE's parent, not via frame.parent:
         * for a grouped frame frame.parent is the Group, and the check would
         * fail. The predicate itself is the same one used in inspect.jsx. */
        isMaster: IDMCP.isMasterParent(pageObj.parent)
    };

    cache[key] = geo;
    return geo;
};

/*
 * Whether a story has even one container on the requested page. Lets us
 * discard a story entirely without entering its paragraphs: on a two-page
 * run that's 187 ms versus 5,725 ms — 30×, because 548 of 549 stories are
 * filtered out.
 *
 * A DELIBERATE CONSEQUENCE: for a story whose frames sit on a master
 * spread, parentPage is the master page ("B", "F"), not a document page
 * number, so with pages given, such stories are filtered out entirely.
 *
 * WARNING — this is NOT sample sanitation. Narrowing by pages only removes
 * the running heads that live on masters: 20 of 111. The remaining 91
 * returned lines sit on ORDINARY document pages (7, 9, 11, 15, 17, 19, 23,
 * 25, …) and come back from a narrowed call on par with the body text —
 * verified: a request for pages 22–23 returns exactly one rotated line,
 * same as the full run. The only reliable filter for that contamination is
 * the rotated flag, not pages.
 */
IDMCP.storyOnWantedPage = function (story, wanted) {
    var containers = story.textContainers;
    for (var i = 0; i < containers.length; i++) {
        /* Via the accessor (`IDMCP.pageItemOf`): text on a path has no
         * `parentPage` of its own, and a raw read would filter out such a
         * story entirely. */
        var pg = IDMCP.parentPageOf(containers[i]);
        if (!pg) continue;
        var name = pg.name;
        for (var w = 0; w < wanted.length; w++) {
            if (wanted[w] === name) return true;
        }
    }
    return false;
};

/* All lines' text of a paragraph in one call (everyItem() batches here too). */
IDMCP.paragraphLineTexts = function (paraLines) {
    var values = paraLines.everyItem().contents;
    if (!(values instanceof Array)) values = [values];
    var out = [];
    for (var i = 0; i < values.length; i++) {
        out.push(typeof values[i] === "string" ? values[i] : "");
    }
    return out;
};

/*
 * The list of document page names — and nothing else.
 *
 * Task 12 (composition_audit) needs EXACTLY the names, to slice the
 * document into windows: a full measurement run costs 116,533 ms and hits
 * AppleScript's own timeout. `doc_overview` would give this list along
 * with everything else, but it reads `story.contents` and
 * `story.words.length` for ALL stories (on this book — 549 containers,
 * ~217K characters), i.e. it would pay for windows a price higher than the
 * window itself.
 *
 * `doc.pages` doesn't include master pages (they're in
 * `doc.masterSpreads`), so a pass over windows never asks for a master
 * explicitly. This is NOT sample sanitation: a story on a master spread
 * gets filtered out by narrowing, but 91 of the book's 111 returned lines
 * sit on ORDINARY pages and will come back on par with the body text — the
 * only reliable filter for that contamination remains `rotated`.
 */
IDMCP.handlers.composition_pages = function () {
    var doc = IDMCP.activeDoc();
    var names = [];
    for (var i = 0; i < doc.pages.length; i++) names.push(doc.pages[i].name);
    return { docName: doc.name, pages: names };
};

IDMCP.handlers.composition_measure = function (params) {
    var doc = IDMCP.activeDoc();
    /* An empty pages array means "all", not "none": otherwise the result is
     * empty and indistinguishable from "there are no lines on these pages". */
    var wanted = (params && params.pages && params.pages.length > 0) ? params.pages : null;

    var prevUnit = app.scriptPreferences.measurementUnit;
    app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;

    try {
        var lines = [];
        var unmeasured = [];
        var pagesSeen = {};
        var pageList = [];
        var geoCache = {};
        /* One `text-path` record per CONTAINER, not per line: otherwise one
         * paragraph on a path would give as many records as it has lines. */
        var pathSeen = {};

        for (var s = 0; s < doc.stories.length; s++) {
            var story = doc.stories[s];
            var containerId = "story:" + s;

            /* Filtering at the story level — before entering its paragraphs. */
            if (wanted !== null && !IDMCP.storyOnWantedPage(story, wanted)) continue;

            /* After filtering, not before: otherwise a narrowed call would report
             * overset in stories that aren't even in the request. */
            if (story.overflows) {
                unmeasured.push({ containerId: containerId, reason: "overset" });
            }

            for (var p = 0; p < story.paragraphs.length; p++) {
                var para = story.paragraphs[p];
                var paraLines = para.lines;
                if (paraLines.length === 0) continue;

                var styleName = "";
                try { styleName = String(para.appliedParagraphStyle.name); } catch (eStyle) { styleName = ""; }

                var pointSize = IDMCP.numberOrNull(para.pointSize);
                var spacing = {
                    min: IDMCP.numberOrNull(para.minimumWordSpacing),
                    desired: IDMCP.numberOrNull(para.desiredWordSpacing),
                    max: IDMCP.numberOrNull(para.maximumWordSpacing)
                };
                /*
                 * Paragraph justification. Measured: 50.2% of the book's
                 * lines (2,608 of 5,193) are unjustified and trivially give
                 * exactly 1.000 — without this field they'd sit in the
                 * detectors' denominator and understate the share of
                 * findings.
                 */
                var justification = String(para.justification);
                var leftIndent = IDMCP.numberOrZero(para.leftIndent);
                var rightIndent = IDMCP.numberOrZero(para.rightIndent);
                var firstLineIndent = IDMCP.numberOrZero(para.firstLineIndent);

                /*
                 * We take lines' text in bulk from line.contents. This is
                 * both faster (196 ms versus 12,444 ms for a
                 * character-by-character everyItem().contents over the
                 * whole document), and more importantly, MORE CORRECT:
                 * character-by-character contents returns an Enumerator,
                 * not a string, for ordinary typographic marks (EM_DASH,
                 * SINGLE_RIGHT_QUOTE, NONBREAKING_SPACE,
                 * ELLIPSIS_CHARACTER, DOUBLE_LEFT_QUOTE/DOUBLE_RIGHT_QUOTE),
                 * and all of them turned into a SPACE in the text.
                 * line.contents returns real Unicode: U+2019, U+2014,
                 * U+00A0, U+2026, U+201C/D.
                 */
                var lineTexts = IDMCP.paragraphLineTexts(paraLines);

                for (var L = 0; L < paraLines.length; L++) {
                    var line = paraLines[L];

                    var frames = line.parentTextFrames;
                    if (frames.length === 0) continue;
                    var frame = frames[0];

                    /*
                     * TEXT ON A PATH CANNOT BE MEASURED AT ALL — and this
                     * needs to be said LOUDLY.
                     *
                     * The whole composition measure rests on
                     * `columnWidth`, i.e. on the rectangular text
                     * column: insets, columns, indents. Text on a path has
                     * neither `textFramePreferences` (measured: the
                     * property doesn't exist on EITHER the container or its
                     * graphic owner) nor any rectangular measure at all —
                     * an oval's bounding box is axis-oriented and has no
                     * relation to the path's length. Computing justification
                     * from it would mean producing a number with nothing to
                     * compare it against.
                     *
                     * This is the same case as `rotated` (see below): not
                     * to "fix", but to exclude — but excluded BY NAME, in
                     * `unmeasured`, not by a silent `continue`. Before
                     * 2026-08-18 such a line silently dropped out via
                     * `pageObj === null`, and `checked` shrank without
                     * explanation.
                     */
                    /* ONE resolve per line: `containerOnPath` and `parentPageOf`
                     * side by side would read `parentPage` three times
                     * where once is enough — and this is the project's
                     * hottest loop (679 s on "History of Ukraine"). */
                    var res = IDMCP.resolveContainerPage(frame);
                    if (res.onPath) {
                        if (!pathSeen[containerId]) {
                            pathSeen[containerId] = true;
                            unmeasured.push({ containerId: containerId, reason: "text-path" });
                        }
                        continue;
                    }

                    var pageObj = res.page;
                    if (!pageObj) continue; /* frame on the pasteboard */
                    var pageName = pageObj.name;
                    /*
                     * НОМЕР РОЗВОРОТУ, а не лише назва сторінки.
                     *
                     * `hyphen-across-spread` міряв ЗМІНУ СТОРІНКИ, бо парність
                     * розвороту з рядка вивести не можна: `page` — рядок, а на
                     * майстрах це взагалі назва майстра («B», «E»). Автор
                     * правила свідомо відмовився вигадувати парність із рядка —
                     * і мав рацію. Але сторінки 12 і 13 у книжці з розворотами
                     * дивляться одна на одну, читач нічого не гортає, а правило
                     * звітувало про кожну таку пару: приблизно половина влучань
                     * на книжці з розворотами, і `composition_apply` вставляв би
                     * м'який перенос, перекомпоновуючи абзац заради неіснуючої
                     * вади.
                     *
                     * Номер розвороту знає САМ InDesign — беремо його звідти,
                     * замість виводити. `parent` сторінки — це її розворот;
                     * `index` розвороту в документі й дає потрібне число.
                     * Не прочиталося — `-1`, і споживач тоді чесно не судить.
                     */
                    var spreadIndex = -1;
                    try { spreadIndex = pageObj.parent.index; } catch (eSp) {}

                    if (wanted !== null) {
                        var want = false;
                        for (var w = 0; w < wanted.length; w++) {
                            if (wanted[w] === pageName) { want = true; break; }
                        }
                        if (!want) continue;
                    }

                    if (!pagesSeen[pageName]) { pagesSeen[pageName] = true; pageList.push(pageName); }

                    /* The one remaining character-by-character everyItem() — coordinates. */
                    var offsets = line.characters.everyItem().horizontalOffset;
                    if (!(offsets instanceof Array)) offsets = [offsets];

                    var text = lineTexts[L];
                    if (typeof text !== "string") text = "";

                    /*
                     * ch === null remains the signal for "not a printable
                     * glyph" and covers only control characters. A space is
                     * no longer substituted for a character in text: this
                     * is exactly why FORCED_LINE_BREAK (44 in one story) was
                     * indistinguishable from a real space — the same defect
                     * as with the non-breaking space.
                     */
                    var chars = [];
                    for (var i = 0; i < offsets.length; i++) {
                        var ch = text.charAt(i);
                        chars.push({ x: offsets[i], ch: IDMCP.isPrintableChar(ch) ? ch : null });
                    }

                    /*
                     * EFFECTIVE measure, not frame width (fix from probe H3,
                     * f161971). The plan's first draft counted only frame
                     * geometry and would only have been correct because in
                     * THIS document all corrections happen to be zero.
                     * Measured a counterexample in the same document: line 0
                     * of paragraph 86 starts 15.987 pt further right due to
                     * a first-line indent at the same right edge. An indent,
                     * an inset, or a second column break the comparison
                     * against geometricBounds — and this comparison is what
                     * the whole ε filter from spec §4.2 rests on.
                     *
                     * We take the frame of THE SAME line (frame above), not
                     * of the paragraph: in a frame chain, a paragraph's last
                     * line can sit in a different frame with different
                     * geometry. (scripts/probe-calibration-measure.jsx has
                     * exactly this bug — para.parentTextFrames[0]; don't
                     * copy from there.)
                     *
                     * firstLineIndent is subtracted on the FIRST line of any
                     * paragraph, not only in single-line ones: there are 907
                     * such lines out of 5,193 (17.5%), while single-line
                     * paragraphs number 415. The value 15.99 pt is 4.3% of
                     * the measure and six times larger than the recommended
                     * ε.
                     *
                     * In a ROTATED frame this value is meaningless
                     * (geometricBounds is an axis-oriented bounding box), so
                     * such a line is flagged rotated and must be excluded by
                     * the consumer, not "fixed".
                     */
                    var geo = IDMCP.frameGeometry(frame, pageObj, geoCache);
                    var columnWidth = geo.usablePerColumn - leftIndent - rightIndent;
                    if (L === 0) columnWidth -= firstLineIndent;

                    /*
                     * Hyphenation break. InDesign's automatic hyphenation is
                     * NOT a text character (it's absent from
                     * line.characters), so the main rule is "the last
                     * character of the line and the first character of the
                     * next are letters": 80 hits in 322 ms versus 81 hits in
                     * 4,906 ms for the "word extends past the line" variant,
                     * which also false-positives on a line ending in
                     * "…риба/яйця/бобові/" (for InDesign that's one Word).
                     * A literal hyphen and a soft hyphen stay in the union —
                     * they catch what the letter rule doesn't see.
                     */
                    var lastChar = text.length > 0 ? text.charAt(text.length - 1) : "";
                    var nextFirstChar = "";
                    if (L < paraLines.length - 1) {
                        var nextText = lineTexts[L + 1];
                        if (typeof nextText === "string" && nextText.length > 0) {
                            nextFirstChar = nextText.charAt(0);
                        }
                    }
                    var endsWithHyphen = (L < paraLines.length - 1) && (
                        lastChar === "-" ||
                        lastChar === String.fromCharCode(0x00ad) ||
                        (IDMCP.isLetterChar(lastChar) && IDMCP.isLetterChar(nextFirstChar))
                    );

                    lines.push({
                        containerId: containerId,
                        page: pageName,
                        spreadIndex: spreadIndex,
                        paragraphIndex: p,
                        lineInParagraph: L,
                        paragraphLineCount: paraLines.length,
                        left: line.horizontalOffset,
                        right: line.endHorizontalOffset,
                        baseline: line.baseline,
                        columnWidth: columnWidth,
                        styleName: styleName,
                        pointSize: pointSize,
                        spacing: spacing,
                        justification: justification,
                        text: text,
                        chars: chars,
                        endsWithHyphen: endsWithHyphen,
                        isFirstInFrame: (geo.firstLineIndex !== null) &&
                            (geo.firstLineIndex === line.index),
                        isLastInFrame: (geo.lastLineIndex !== null) &&
                            (geo.lastLineIndex === line.index),
                        rotated: geo.rotated,
                        rotationAngle: geo.rotationAngle,
                        isMaster: geo.isMaster
                    });
                }
            }
        }

        return {
            docName: doc.name,
            pages: pageList,
            lines: lines,
            unmeasured: unmeasured,
            measurementUnit: "points"
        };
    } finally {
        app.scriptPreferences.measurementUnit = prevUnit;
    }
};

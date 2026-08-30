/* An InDesign-native search plus pinpoint inspection of styles within the found ranges. */

/* Fix 3 (plan review): we build the story.id -> story.index mapping ONCE
 * before the loop over matches, rather than a linear search inside it (as
 * in the briefing's baseline code) — on a real document that would mean
 * hundreds of stories against hundreds of matches, i.e. O(stories × matches). */
IDMCP.buildStoryIndexById = function (doc) {
    var map = {};
    for (var s = 0; s < doc.stories.length; s++) map[doc.stories[s].id] = s;
    return map;
};

/*
 * Fix 2 (plan review): a grep match can sit not only in a story's main
 * text but also inside a table cell or a footnote — Task 6 breaks these
 * out into separate containers with their own containerId formats
 * ("story:N/table:T/cell:R,C", "story:N/footnote:F"), and resolveContainer
 * validates this strictly. The found range's characters[0].parent is Cell
 * for a match in a cell, Footnote for a match in a footnote, and Story
 * itself for regular text (verified empirically on live InDesign, see the
 * Task 7 report).
 *
 * The table/row/column or footnote index is determined by WALKING
 * story.tables / story.footnotes and comparing .id, not by parsing
 * Cell.name — that returns a string formatted as "column:row" (verified
 * with a separate probe script on an asymmetric 3×4 table: cell
 * [row=1,column=2] gave the name "2:1"), and relying on that string format
 * is riskier than walking the same nested rows/cells loop that
 * IDMCP.resolveContainer uses — that guarantees the same container.
 */
IDMCP.resolveMatchContainerId = function (story, storyIndex, ch0) {
    var parent = ch0.parent;

    var isCell = false;
    try { isCell = parent instanceof Cell; } catch (e1) { isCell = false; }
    if (isCell) {
        for (var t = 0; t < story.tables.length; t++) {
            var table = story.tables[t];
            for (var r = 0; r < table.rows.length; r++) {
                var cells = table.rows[r].cells;
                for (var c = 0; c < cells.length; c++) {
                    if (cells[c].id === parent.id) {
                        return "story:" + storyIndex + "/table:" + t + "/cell:" + r + "," + c;
                    }
                }
            }
        }
        /* The cell wasn't found among story.tables — this shouldn't happen if
         * ch0.parent is really a Cell. A loud error is better than a
         * containerId pointing at the wrong text (Task 8 will write into
         * the layout using it). */
        throw new Error("Could not determine the table cell for the found match.");
    }

    var isFootnote = false;
    try { isFootnote = parent instanceof Footnote; } catch (e2) { isFootnote = false; }
    if (isFootnote) {
        for (var fn = 0; fn < story.footnotes.length; fn++) {
            if (story.footnotes[fn].id === parent.id) {
                return "story:" + storyIndex + "/footnote:" + fn;
            }
        }
        throw new Error("Could not determine the footnote for the found match.");
    }

    return "story:" + storyIndex;
};

IDMCP.handlers.grep_find = function (params) {
    var doc = IDMCP.activeDoc();
    var storyIndexById = IDMCP.buildStoryIndexById(doc);
    var out = [];

    /*
     * Fix 1 (plan review, review fix round 1 — Important 1): the search
     * scope of doc.findGrep() is controlled not only by
     * findGrepPreferences/changeGrepPreferences, but also by a SEPARATE
     * global state, app.findChangeGrepOptions — includeFootnotes,
     * includeMasterPages, includeHiddenLayers, includeLockedStoriesForFind,
     * includeLockedLayersForFind (verified empirically: reflect.properties
     * confirms exactly these five names). Without explicitly setting these
     * flags, the search result depends on however the user last left them
     * in InDesign's Find/Change dialog — e.g. if "Include Footnotes" is
     * off, grep_find silently won't find a match in a footnote, and
     * text_find silently undercounts occurrences. We pin all five for the
     * duration of the search (so grep_find always searches the whole
     * document, deterministically) and restore the previous values in the
     * same finally that resets findGrepPreferences — the same approach as
     * measurementUnit in _fixtures.jsx.
     */
    var opts = app.findChangeGrepOptions;
    var prevIncludeFootnotes = opts.includeFootnotes;
    var prevIncludeMasterPages = opts.includeMasterPages;
    var prevIncludeHiddenLayers = opts.includeHiddenLayers;
    var prevIncludeLockedStoriesForFind = opts.includeLockedStoriesForFind;
    var prevIncludeLockedLayersForFind = opts.includeLockedLayersForFind;

    /*
     * THE USER'S OWN Find/Change QUERY, WHICH THIS HANDLER USED TO DELETE.
     *
     * The five options above are saved and restored; `findGrepPreferences` and
     * `changeGrepPreferences` were only ever CLEARED — on entry and again in
     * `finally` — and never captured. They are application state, and they are
     * exactly what the user typed into the GREP tab of Find/Change. So an agent
     * running `text_find` in grep mode silently emptied both the search and the
     * replacement fields of a panel the user was in the middle of using.
     *
     * Reads are wrapped: when the preference is `NothingEnum.NOTHING` these
     * properties can refuse to yield a string, and a failure to PRESERVE state
     * must not become a failure to SEARCH.
     *
     * NAMED LIMIT: assigning `NothingEnum.NOTHING` resets every field of the
     * preference object, not just these two — an applied font, a point size or a
     * paragraph style set in the panel is still lost. Restoring the two typed
     * fields is what the user actually notices; the rest is not claimed.
     */
    var prevFindWhat = null;
    var prevChangeTo = null;
    try { prevFindWhat = String(app.findGrepPreferences.findWhat); } catch (eFw) { }
    try { prevChangeTo = String(app.changeGrepPreferences.changeTo); } catch (eCt) { }

    /*
     * Fix 1 (plan review): findGrepPreferences/changeGrepPreferences are
     * also global app state, not document state. If doc.findGrep() throws
     * (e.g. an invalid GREP expression), the reset at the end of the
     * briefing's baseline code won't run, and the settings will stay dirty
     * in the user's application. try/finally guarantees the reset
     * regardless of outcome.
     */
    try {
        opts.includeFootnotes = true;
        opts.includeMasterPages = true;
        opts.includeHiddenLayers = true;
        opts.includeLockedStoriesForFind = true;
        opts.includeLockedLayersForFind = true;

        app.findGrepPreferences = NothingEnum.NOTHING;
        app.changeGrepPreferences = NothingEnum.NOTHING;
        app.findGrepPreferences.findWhat = params.pattern;

        var found = doc.findGrep();
        var limit = params.limit || 200;
        for (var i = 0; i < found.length && i < limit; i++) {
            var t = found[i];
            var story = t.parentStory;
            var storyIndex = storyIndexById[story.id];
            var ch0 = t.characters[0];
            var start = ch0.index;

            out.push({
                containerId: IDMCP.resolveMatchContainerId(story, storyIndex, ch0),
                start: start,
                end: start + t.characters.length,
                text: t.contents
            });
        }
    } finally {
        opts.includeFootnotes = prevIncludeFootnotes;
        opts.includeMasterPages = prevIncludeMasterPages;
        opts.includeHiddenLayers = prevIncludeHiddenLayers;
        opts.includeLockedStoriesForFind = prevIncludeLockedStoriesForFind;
        opts.includeLockedLayersForFind = prevIncludeLockedLayersForFind;

        app.findGrepPreferences = NothingEnum.NOTHING;
        app.changeGrepPreferences = NothingEnum.NOTHING;

        /* Put the user's query back. An empty string is the same as cleared, so
         * restoring it costs nothing and skipping it would need a special case. */
        if (prevFindWhat) {
            try { app.findGrepPreferences.findWhat = prevFindWhat; } catch (eRfw) { }
        }
        if (prevChangeTo) {
            try { app.changeGrepPreferences.changeTo = prevChangeTo; } catch (eRct) { }
        }
    }

    return { matches: out };
};

/*
 * Discovered empirically (live InDesign, while debugging this task):
 * properties on objects obtained via range.paragraphs[i] /
 * range.textStyleRanges[i] (where range is the result of
 * container.characters.itemByRange(...)) are sometimes returned by
 * ExtendScript wrapped in a single-element array instead of as a scalar
 * value — e.g. paragraph.appliedParagraphStyle, and even paragraph.index,
 * come back as an array [value] here, while the same properties on objects
 * obtained directly from story.paragraphs[i] are plain scalars. It's the
 * same "instance" (paragraph.index matches), just a different access path.
 * So we check explicitly and take the first element when it's an array —
 * otherwise .name would return undefined ("null" after serialization) and
 * slip parasitically past the duplicate check.
 */
IDMCP.unwrapStyleRef = function (value) {
    if (value instanceof Array) return value[0];
    return value;
};

/* Which paragraph and character styles occur within each range. */
IDMCP.handlers.ranges_inspect = function (params) {
    var doc = IDMCP.activeDoc();
    var results = [];

    for (var i = 0; i < params.ranges.length; i++) {
        var r = params.ranges[i];
        /* containerId is always validated (even for the empty range below) — an
         * invalid containerId must fail loudly, not slip past silently. */
        var container = IDMCP.resolveContainer(doc, r.containerId);

        var charStyles = [];
        var paraStyles = [];

        /*
         * Fix 4 (plan review): container.characters.itemByRange(r.start,
         * r.end - 1) is invalid when r.end === r.start (e.g. a query about
         * an insertion range with no characters) — that produces
         * itemByRange(N, N-1), i.e. an end BEFORE the start, and
         * ExtendScript throws instead of treating it as an empty set of
         * characters. An empty range contains no characters at all — so
         * there simply are no styles in it, and that's not an error.
         */
        if (r.end > r.start) {
            var range = container.characters.itemByRange(r.start, r.end - 1);

            var tsr = range.textStyleRanges;
            for (var k = 0; k < tsr.length; k++) {
                var cs = IDMCP.unwrapStyleRef(tsr[k].appliedCharacterStyle).name;
                if (IDMCP.indexOf(charStyles, cs) === -1) charStyles.push(cs);
            }
            var paras = range.paragraphs;
            for (var p = 0; p < paras.length; p++) {
                var ps = IDMCP.unwrapStyleRef(paras[p].appliedParagraphStyle).name;
                if (IDMCP.indexOf(paraStyles, ps) === -1) paraStyles.push(ps);
            }
        }

        results.push({
            containerId: r.containerId,
            start: r.start,
            end: r.end,
            charStyles: charStyles,
            paraStyles: paraStyles
        });
    }

    return { results: results };
};

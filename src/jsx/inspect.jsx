/* Handlers that read InDesign state. They never change anything in the documents. */
/*
 * ШЛЯХ ДО ВСТАНОВЛЕНОГО INDESIGN — окремий читальний обробник.
 *
 * `spelling_audit` брав його через `run_script`, тобто через ЄДИНИЙ обробник,
 * що виконує довільний ExtendScript, обгортає його в `withUndo(ENTIRE_SCRIPT)`
 * і свідомо стоїть поза конвертом запису: `apply.jsx` прямо каже, що
 * `run_script` «виконує довільний ExtendScript без копії й без перевірок».
 * Тобто читальний аудит правопису відкривав транзакцію скасування в
 * документі користувача — заради рядка, для якого не потрібен ані документ,
 * ані скасування.
 *
 * Тут немає ані `withUndo`, ані документа: `app.filePath` — властивість
 * ЗАСТОСУНКУ.
 */
IDMCP.handlers.app_path = function () {
    return String(app.filePath.fsName);
};

IDMCP.handlers.status = function () {
    var docs = [];
    for (var i = 0; i < app.documents.length; i++) {
        var d = app.documents[i];
        docs.push({
            name: d.name,
            saved: d.saved,
            modified: d.modified,
            fullName: d.saved ? String(d.fullName) : null,
            pages: d.pages.length
        });
    }

    var books = [];
    for (var b = 0; b < app.books.length; b++) books.push(app.books[b].name);

    return {
        version: app.version,
        documents: docs,
        activeDocument: app.documents.length > 0 ? app.activeDocument.name : null,
        books: books
    };
};

/* Returns the received parameters unchanged. Serves to verify round-trip serialization
 * (Cyrillic, \r, quotes) through the real eval → IDMCP.stringify cycle. */
IDMCP.handlers.echo = function (params) {
    return params;
};

IDMCP.handlers.doc_overview = function () {
    var doc = IDMCP.activeDoc();

    var stories = [];
    for (var s = 0; s < doc.stories.length; s++) {
        var st = doc.stories[s];
        var text = st.contents;
        stories.push({
            index: s,
            containerId: "story:" + s,
            characters: text.length,
            words: st.words.length,
            preview: text.substr(0, 60),
            overflows: st.overflows
        });
    }

    var paraStyles = [];
    for (var p = 1; p < doc.allParagraphStyles.length; p++) paraStyles.push(doc.allParagraphStyles[p].name);
    var charStyles = [];
    for (var c = 1; c < doc.allCharacterStyles.length; c++) charStyles.push(doc.allCharacterStyles[c].name);

    var fonts = [];
    for (var f = 0; f < doc.fonts.length; f++) fonts.push(doc.fonts[f].name + " [" + doc.fonts[f].status + "]");

    var links = [];
    for (var l = 0; l < doc.links.length; l++) {
        links.push({ name: doc.links[l].name, status: String(doc.links[l].status) });
    }

    var pages = [];
    for (var pg = 0; pg < doc.pages.length; pg++) {
        pages.push({ name: doc.pages[pg].name, frames: doc.pages[pg].textFrames.length });
    }

    return {
        name: doc.name,
        saved: doc.saved,
        fullName: doc.saved ? String(doc.fullName) : null,
        pageCount: doc.pages.length,
        spreadCount: doc.spreads.length,
        pages: pages,
        stories: stories,
        paragraphStyles: paraStyles,
        characterStyles: charStyles,
        fonts: fonts,
        links: links
    };
};

/*
 * A STORY CONTAINER IS NOT ALWAYS A PAGE ITEM. It's a CLASS, not a single line item.
 *
 * MEASURED 2026-08-18, probe `scripts/probe-textpath.jsx`, InDesign 21.5.1.73,
 * «02 Зоряні Мрії 2022 Print 3 copy.indd», 592 pages: `doc.stories[*].
 * textContainers` gives 724 containers — 720 TextFrame and 4 TextPath (text
 * laid along a path). TextFrame has 137 properties, TextPath — 35.
 * TextPath is NOT a PageItem AT ALL: it has not a single geometry,
 * layout, or appearance property. Measured by name, reading
 * EVERY ONE throws “Object does not support the property or method”:
 *
 *     parentPage · rotationAngle · geometricBounds · visibleBounds ·
 *     itemLayer · textFramePreferences · locked · visible · fillColor ·
 *     strokeWeight · appliedObjectStyle · anchoredObjectSettings … (111 names)
 *
 * WHICH IS EXACTLY WHY FIXING IT LINE BY LINE IS POINTLESS. `layout_measure` first failed on
 * `parentPage` (`map.jsx:551`); after the `ed2c666` fix, the exception moved to
 * `rotationAngle` (`map.jsx:558`) — the same object. Next in line
 * were `geometricBounds` (`composition.jsx:62`, `cli-extras.jsx:53`) and
 * `itemLayer` (`color.jsx:127`). There's no way to enumerate them in advance; the only option is to
 * name the class and route ALL such reads through one gate.
 *
 * The CARRIER of these properties for text on a path is its GRAPHIC OWNER
 * (`container.parent`: Oval/Polygon/GraphicLine/SplineItem). Measured on all
 * four: the owner has `parentPage` (the text's real page — 592 and 1),
 * `rotationAngle`, `geometricBounds`, `visibleBounds`, and `itemLayer`.
 * The ONLY thing it lacks is `textFramePreferences` — that's a property of a TEXT FRAME, not
 * of a page item, and no one has it for text on a path. Insets and
 * columns for such text are undefined by construction.
 */
/*
 * ONE SOLUTION FOR ALL FOUR QUESTIONS — AND THIS IS ABOUT COST, NOT ELEGANCE.
 *
 * The first revision of this fix had four independent helpers, and each
 * re-resolved the carrier from scratch. In the project's hottest loop — `composition_measure`,
 * one pass per line of the book — this produced THREE `parentPage` accesses where
 * there was ONE before the fix: `containerOnPath()` read once, `parentPageOf()`
 * read it twice more (the resolve itself plus the page itself). A composition pass over
 * «Зоряні Мрії» costs 679 s, meaning the toll would have been noticeable and entirely
 * for nothing.
 *
 * Here everything is counted for ONE pass: for a regular frame — exactly one
 * access, same as before the fix; for text on a path — two (its own, which threw, and
 * the owner's). The remaining helpers below are thin wrappers that add no new
 * accesses.
 */
IDMCP.resolveContainerPage = function (container) {
    /*
     * `!container`, NOT `container === null` — AND THIS WAS MEASURED BY A CRASH.
     *
     * The `===` operator in ExtendScript applies to the DOM object itself and
     * THROWS when the other side is of the wrong class: “TextFrame.===() cannot work with
     * instances of this class”. The first revision of this function had
     * `container === null || container === undefined` here — outside any try — and
     * this took down the ENTIRE folio-writing path: 15 integration tests,
     * `pagination_apply` couldn't write a single correction.
     *
     * The earlier implementation (`parentPageOf` before 2026-08-18) didn't have
     * this trap by accident: it went straight into `try` and compared nothing. In other words,
     * the refactor introduced a comparison here that had never existed in the code.
     *
     * Checking for truthiness is safe — `if (!parent)` in `isMasterParent` and
     * `p ? p : null` below have worked on live objects for years.
     */
    if (!container) {
        return { carrier: null, page: null, resolved: false, onPath: false };
    }
    /* Classification BY READING, not by class name: `constructor.name` in
     * ExtendScript is unreliable (see `isMasterParent` below), while attempting to
     * read `parentPage` answers exactly the question being asked.
     * Success with a `null` value (pasteboard) is ALSO success: it proves
     * that the object IS a page item. */
    try {
        var mine = container.parentPage;
        return { carrier: container, page: mine ? mine : null, resolved: true, onPath: false };
    } catch (eSelf) { /* not a page item — looking for a carrier */ }

    var owner = null;
    try { owner = container.parent; } catch (eOwner) { owner = null; }
    if (owner) {
        try {
            var theirs = owner.parentPage;
            return { carrier: owner, page: theirs ? theirs : null, resolved: true, onPath: true };
        } catch (eOwnerPage) { /* the owner isn't a page item either */ }
    }
    return { carrier: null, page: null, resolved: false, onPath: false };
};

/** The carrier of a page item's properties, or `null`. Never throws. */
IDMCP.pageItemOf = function (container) {
    return IDMCP.resolveContainerPage(container).carrier;
};

/**
 * Whether the container is text ALONG A PATH — i.e. whether its geometry lives on
 * a foreign object.
 *
 * Needed where a page isn't enough: `composition_measure` measures justification against
 * a RECTANGULAR type area, and text on a path has no such thing in any
 * form (no `textFramePreferences`, no meaningful column width — an oval's bounds
 * are axis-oriented and don't equal the path's length). Such a line has to be
 * called unmeasurable, not “fixed”.
 *
 * `false` for a container that couldn't be classified at all: “don't know”
 * must not pass itself off as “on a path”.
 */
IDMCP.containerOnPath = function (container) {
    return IDMCP.resolveContainerPage(container).onPath;
};

/**
 * The item's page TOGETHER WITH whether it could be determined at all.
 *
 * Three distinct states that, before 2026-08-18, collapsed into a single `null`:
 *   `{ page: Page, resolved: true }`  — the item is on a page;
 *   `{ page: null, resolved: true }`  — the item is ON THE PASTEBOARD (a fact);
 *   `{ page: null, resolved: false }` — could NOT be determined (unknown).
 *
 * The difference between the second and third isn't pedantry. `cli-extras.jsx` relies on this for
 * `pasteboardItems`: by collapsing them, it declared “definitely off the page” for something
 * only known to be “couldn't be read”, and the counter silently inflated.
 * The same rule as everywhere else in the project: a silently wrong number costs more than
 * a loud failure.
 */
IDMCP.pageResolution = function (item) {
    var r = IDMCP.resolveContainerPage(item);
    return { page: r.page, resolved: r.resolved };
};

/**
 * The item's page as an OBJECT, or `null`. Never throws.
 *
 * A thin wrapper — so that a caller who doesn't care about the “pasteboard /
 * couldn't determine” distinction doesn't pay for it in readability. Whoever needs that
 * distinction takes `pageResolution` directly; whoever also needs the carrier uses `resolveContainerPage`.
 */
IDMCP.parentPageOf = function (item) {
    return IDMCP.resolveContainerPage(item).page;
};

/**
 * The same answer, BY NAME, for showing to a person.
 *
 * Implemented THROUGH the shared resolve, not alongside it. Before 2026-08-18 these were
 * two independent implementations, and they DIVERGED: `pageNameFor` had a fallback
 * path through the graphic owner, `parentPageOf` did not. On the same exact
 * frame, `document_map` said «с. 137», while `layout_measure`, `styles_measure`, and
 * `composition_measure` said «сторінки немає». Now they can't diverge by
 * construction: one rule, two forms.
 */
IDMCP.pageNameFor = function (frame) {
    var page = IDMCP.parentPageOf(frame);
    return page ? page.name : "pasteboard";
};

/* Page ranges are taken from the story's frames, not from individual characters. */
IDMCP.pageRunsFor = function (story) {
    var runs = [];
    var containers = story.textContainers;
    for (var i = 0; i < containers.length; i++) {
        var frame = containers[i];
        if (frame.characters.length === 0) continue;
        var first = frame.characters[0].index;
        var last = frame.characters[-1].index + 1;
        var page = IDMCP.pageNameFor(frame);
        runs.push({ start: first, end: last, page: page });
    }
    return runs;
};

/* isMaster: story.textContainers[0].parent — this is either a Page (a regular document)
 * or the MasterSpread itself (text placed directly on a master page).
 * Comparing by constructor name is fragile in ExtendScript (minified engines
 * don't always preserve the function name) — so we also check reflect.name
 * if it's present, and as a last resort we do a "duck typing" check against
 * MasterSpread's characteristic properties (baseName), which Page doesn't have. */
IDMCP.isMasterParent = function (parent) {
    if (!parent) return false;
    if (parent.constructor && String(parent.constructor.name) === "MasterSpread") return true;
    if (parent.hasOwnProperty && parent.hasOwnProperty("baseName")) return true;
    try {
        return parent instanceof MasterSpread;
    } catch (e) {
        return false;
    }
};

/* Whether wanted contains an element equal to prefix, or nested under it
 * (starting with prefix + "/"). Used to decide whether it's even
 * worth walking the story: if the list only has a nested id ("story:3/footnote:0")
 * without "story:3" itself, we still have to enter the story, because that's
 * exactly where the needed footnote or cell lives — filtering at the level of each
 * individual container happens below; here it's only the "enter or not" decision. */
IDMCP.hasPrefixMatch = function (wanted, prefix) {
    var prefixWithSlash = prefix + "/";
    for (var i = 0; i < wanted.length; i++) {
        var w = wanted[i];
        if (w === prefix) return true;
        if (w.length > prefixWithSlash.length && w.substr(0, prefixWithSlash.length) === prefixWithSlash) return true;
    }
    return false;
};

IDMCP.handlers.containers_read = function (params) {
    var doc = IDMCP.activeDoc();
    var wanted = params && params.containerIds ? params.containerIds : null;
    var out = [];

    for (var s = 0; s < doc.stories.length; s++) {
        var story = doc.stories[s];
        var id = "story:" + s;

        /*
         * IMPORTANT (fixed after review): this used to have a `continue` keyed on
         * "story:N" alone — it filtered out the ENTIRE story, including the nested
         * loops over cells and footnotes. Consequence: a containerIds request with only
         * "story:3/footnote:1" (without a separate "story:3") filtered out story 3
         * entirely BEFORE the footnote loop could ever run, and
         * the footnote was never returned. Now this is only the decision of "is it even
         * worth entering this story" (does wanted contain something about the story itself, or
         * something inside it) — and which of the three branches (the story's own text,
         * a cell, a footnote) to return is decided by each branch on its own.
         */
        if (wanted && !IDMCP.hasPrefixMatch(wanted, id)) continue;

        var includeMainText = !wanted || IDMCP.indexOf(wanted, id) !== -1;

        var runs = IDMCP.pageRunsFor(story);
        var oversetFrom = null;
        if (story.overflows && runs.length > 0) oversetFrom = runs[runs.length - 1].end;

        var isMaster = false;
        if (story.textContainers.length > 0) {
            /* Via the CARRIER — see `map.jsx` and `styles.jsx`: for text along
             * a path `.parent` is the graphic owner, not the spread. */
            var imCarrier = IDMCP.pageItemOf(story.textContainers[0]);
            isMaster = imCarrier ? IDMCP.isMasterParent(imCarrier.parent) : false;
        }

        if (includeMainText) {
            out.push({
                containerId: id,
                text: story.contents,
                pageRuns: runs,
                oversetFrom: oversetFrom,
                isMaster: isMaster,
                kind: "text"
            });
        }

        /* Table cells are separate containers, because their text isn't included in story.characters. */
        for (var t = 0; t < story.tables.length; t++) {
            var table = story.tables[t];
            for (var r = 0; r < table.rows.length; r++) {
                for (var cc = 0; cc < table.rows[r].cells.length; cc++) {
                    var cell = table.rows[r].cells[cc];
                    var cellId = id + "/table:" + t + "/cell:" + r + "," + cc;
                    if (wanted && IDMCP.indexOf(wanted, cellId) === -1) continue;
                    out.push({
                        containerId: cellId,
                        text: cell.texts[0].contents,
                        pageRuns: runs.length > 0 ? [{ start: 0, end: cell.texts[0].contents.length, page: runs[0].page }] : [],
                        oversetFrom: null,
                        isMaster: isMaster,
                        kind: "table"
                    });
                }
            }
        }

        /* Footnotes also live in a separate text stream. */
        for (var fn = 0; fn < story.footnotes.length; fn++) {
            var fnId = id + "/footnote:" + fn;
            if (wanted && IDMCP.indexOf(wanted, fnId) === -1) continue;
            var fnText = story.footnotes[fn].texts[0].contents;
            out.push({
                containerId: fnId,
                text: fnText,
                pageRuns: runs.length > 0 ? [{ start: 0, end: fnText.length, page: runs[0].page }] : [],
                oversetFrom: null,
                isMaster: isMaster,
                kind: "footnote"
            });
        }
    }

    return { docName: doc.name, containers: out };
};

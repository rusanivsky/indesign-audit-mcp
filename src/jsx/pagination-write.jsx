/*
 * REPLACING A MANUAL FOLIO NUMBER WITH AN AUTOMATIC MARKER (spec §4.6).
 *
 * THIS IS PHASE 7'S FIRST WRITE PATH, AND THE CENTRAL QUESTION HERE IS NOT
 * "HOW TO WRITE" BUT UNDER WHAT CONDITIONS NOT TO WRITE. The end-to-end
 * principle from §3: the tool must never write a number different from what
 * currently sits in the frame. The cost of a mistake is named by measurement,
 * not by caution: a marker without a neighbor prints ITS OWN page — no
 * blank, no warning, a plausible wrong number gets printed (Questions 10 and
 * 18). So a false write looks correct, and there's nothing left to catch it
 * with by audit: `detectFolio` only produces findings inside
 * `if (para.literals.length > 0)`, and after the literal is replaced there
 * is none.
 *
 * THE SAFETY ENVELOPE IS REPRODUCED, NOT INHERITED. `src/bridge/envelope.ts`
 * is 49 lines and gives exactly two things: the heartbeat lock and turning
 * `fatalError` into an error carrying the copy's name. Everything else lives
 * in the `apply_edits` handler (`src/jsx/apply.jsx`), and `typography_apply`
 * inherits it only because it reuses THE SAME handler. Here it is reproduced
 * by name: `doc.name` check, a copy via `IDMCP.uniqueBackupFile` +
 * `doc.saveACopy`, a heartbeat around the copy, one undo step around the
 * ENTIRE operation, an actual-content check before EVERY write, and
 * measuring overset and page count BEFORE and AFTER.
 *
 * THE LAST POINT IS EASY TO LOSE, WHICH IS WHY IT'S CALLED OUT SEPARATELY:
 * without it `withDiffs` (`src/tools/corrections.ts`) counts diffs against
 * emptiness, the §7 loud error `becameOverset` never fires, and the
 * protection against "frames pushed the layout" looks present and doesn't
 * work.
 *
 * WHAT THIS HANDLER DOES NOT DO AND CANNOT DO. It doesn't compute which page
 * the marker will resolve to: `pagination_measure` measures the topology,
 * and the oracle `planRewrite` (`src/pagination/rewrite.ts`) makes the
 * decision. What arrives here is an already-made decision together with the
 * MEASURED character offset (`ClaimParagraph.literalOffsets`) — precisely so
 * the handler doesn't search for the number ON ITS OWN: a second,
 * independent parse would diverge from the measurement the oracle is built
 * on. A desync between the two calls is closed by `planId` (§4.5); here it's
 * the text check.
 */

/*
 * THE HELPER LAYER'S NAME IS OURS TO CHOOSE, AND THAT'S A NAMED LIMIT (§6,
 * last line). `SpecialCharacters` names aren't subject to localization, but
 * the layer name is a string the operator will see in the Layers panel. The
 * leading underscore sorts it first and sets it apart from layout layers.
 */
IDMCP.HELPER_LAYER_NAME = "_folio-helper";

/*
 * The helper frame's rectangle on a page where THERE IS NO FOLIO.
 *
 * Such a page still gets a frame — that's the §4.2 contract (see the
 * handler) — but there's no geometry to copy from. The rectangle is derived
 * from `page.bounds`, and from those specifically, not from numbers: under
 * `facingPages` a frame given in absolute coordinates lands geometrically on
 * the NEIGHBORING page, and `parentPage` honestly reports the neighbor. This
 * isn't caution — the first draft of the Question 18 probe tripped on
 * exactly this, and the same class of bug already cost a Task 3 blocker.
 *
 * A hundredth of the page on each side, so the frame is guaranteed to sit
 * within its own page regardless of format and doesn't depend on ruler
 * units. The corner is the top inner one, i.e. the start of `page.bounds`;
 * there is no other "correct" corner here, because this page has no folio
 * at all.
 */
IDMCP.helperFallbackBounds = function (page) {
    var b;
    try { b = page.bounds; } catch (eB) { return null; }
    var a0 = Number(b[0]), a1 = Number(b[1]), a2 = Number(b[2]), a3 = Number(b[3]);
    if (isNaN(a0) || isNaN(a1) || isNaN(a2) || isNaN(a3)) return null;
    /* Order is guaranteed by InDesign, not by us: a swapped pair would
     * silently give negative dimensions instead of an error. */
    var y1 = Math.min(a0, a2), y2 = Math.max(a0, a2);
    var x1 = Math.min(a1, a3), x2 = Math.max(a1, a3);
    return [y1, x1, y1 + (y2 - y1) / 100, x1 + (x2 - x1) / 100];
};

/*
 * A BACKUP COPY SHARED BY BOTH PHASE 7 WRITE HANDLERS — one implementation,
 * and that's not about saving lines.
 *
 * §4.6 requires REPRODUCING the `apply_edits` envelope, not inheriting it;
 * but reproducing it TWICE would let the two copies drift apart — the exact
 * kind of divergence `claimParagraph` shares with the measurement to avoid.
 * The copy's name is built by that same `IDMCP.uniqueBackupFile`, so both
 * handlers' copies sit under one prefix and are equally covered by
 * `isOwnBackupName` rotation.
 *
 * `touch("edits")` sits right after `saveACopy`: the longest operation is
 * behind it, and the trail's phase switches once and for all
 * (`src/jsx/apply.jsx`).
 *
 * Housekeeping must never break a valid run: the copy is already made and
 * verified, so a rotation failure goes into the report, not into an
 * exception.
 */
IDMCP.folioBackupCopy = function (doc, stamp, touch) {
    var docFile = doc.fullName;
    var backupDir = new Folder(docFile.parent.fsName + "/_backups");
    if (!backupDir.exists && !backupDir.create()) {
        throw new Error("Could not create the backup folder: " + backupDir.fsName + ". Nothing was changed.");
    }

    var base = doc.name.replace(/\.indd$/i, "");
    var backupFile = IDMCP.uniqueBackupFile(backupDir, base, stamp);
    doc.saveACopy(backupFile);
    touch("edits");
    /* A copy that isn't verified isn't a safeguard, it's a hope. */
    if (!backupFile.exists) {
        throw new Error("Document copy was not created: " + backupFile.fsName + ". Nothing was changed.");
    }

    var out = { file: backupFile, rotated: 0, rotationError: null };
    try {
        out.rotated = IDMCP.rotateBackups(backupDir, base, 10);
    } catch (rotateErr) {
        out.rotationError = String(rotateErr.message || rotateErr);
    }
    touch();
    return out;
};

/* Direction is DECLARED by the edit; guessing it from the page side is forbidden (§4.9). */
IDMCP.FOLIO_MARKER_BY_DIRECTION = {
    previous: SpecialCharacters.PREVIOUS_PAGE_NUMBER,
    next: SpecialCharacters.NEXT_PAGE_NUMBER
};

/* Digits only, and at least one: the marker replaces a NUMBER, not arbitrary text. */
IDMCP.isDigits = function (s) {
    if (typeof s !== "string" || s.length === 0) return false;
    for (var i = 0; i < s.length; i++) {
        var c = s.charCodeAt(i);
        if (c < 48 || c > 57) return false;
    }
    return true;
};

/*
 * Whether frame `id` is a MASTER PAGE item visible from page `pageName`.
 * Only asked once the plain page check has ALREADY FAILED — so the operator
 * gets the reason, not just the fact of a mismatch: for a master item,
 * `parentPage` is the MASTER's page (measured, Question 17), so a plain
 * check against it fires but says the wrong thing.
 *
 * This isn't cosmetic. `page.masterPageItems` returns THE SAME SINGLE
 * object for every page carrying that master, so writing into it would
 * change all those pages at once (§4.4, step 7).
 */
IDMCP.isMasterItemOn = function (doc, pageName, id) {
    var page = null;
    try { page = doc.pages.itemByName(String(pageName)); } catch (eP) { return false; }
    try { if (!page.isValid) return false; } catch (eV) { return false; }
    var items = null;
    try { items = page.masterPageItems; } catch (eM) { return false; }
    for (var i = 0; i < items.length; i++) {
        var itemId = null;
        try { itemId = String(items[i].id); } catch (eI) { itemId = null; }
        if (itemId !== null && itemId === String(id)) return true;
    }
    return false;
};

/*
 * ONE WRITE. Returns null if the marker was placed, or a REASON STRING if
 * writing isn't allowed.
 *
 * The check order matches the oracle's, and for the same reason: structural
 * rejections first, the text check last, so a frame that's no longer where
 * it was measured doesn't get diagnosed as "text changed."
 */
IDMCP.replaceFolioLiteral = function (doc, e) {
    var marker = IDMCP.FOLIO_MARKER_BY_DIRECTION[String(e.direction)];
    if (marker === undefined) {
        return "Unknown marker direction: \"" + String(e.direction) +
            "\" (expected \"previous\" or \"next\").";
    }

    var frame = null;
    try { frame = doc.pageItems.itemByID(parseInt(e.frameId, 10)); } catch (eF) { frame = null; }
    var valid = false;
    /* Truthiness, not `!==`: `===`/`!==` on a DOM object sometimes THROWS
     * (measured 2026-08-18). Here an exception would give not a crash but a
     * SILENT wrong answer of "no frame with this id" — a worse failure mode
     * than a loud rejection. */
    try { valid = !!frame && frame.isValid === true; } catch (eV) { valid = false; }
    if (!valid) {
        return "There is no frame with id " + String(e.frameId) + " in the document — the layout changed since the measurement.";
    }
    if (!IDMCP.isTextFrameLike(frame)) {
        return "Element with id " + String(e.frameId) + " is not a text frame.";
    }

    /*
     * TEXT ALONG A PATH IS NEVER A FOLIO — and the rejection has to happen
     * HERE, EXPLICITLY, not rely on it never reaching this point.
     *
     * MEASURED 2026-08-18, and the measurement disproved my reasoning twice
     * in a row. First I decided `doc.pageItems.itemByID` can't return a
     * TextPath because it isn't a page item. It can:
     *
     *   itemByID(4985).isValid            → true   (control: nonexistent id → false)
     *   getElements()[0].constructor.name → TextPath
     *   .paragraphs.length                → 1      i.e. isTextFrameLike SKIPS IT
     *   .parentPage                       → THROWS
     *
     * Before the fix, a TextPath here was filtered out BY ACCIDENT:
     * `parentPageOf` returned `null`, `pageName` didn't match `e.page`, and
     * the frame got rejected as "layout changed since the measurement" — the
     * right result for the wrong reason. Since `parentPageOf` knows the
     * graphic owner, the page NOW MATCHES, and that accidental protection is
     * gone.
     *
     * The cost of a mistake is asymmetric: this is the WRITE path. A miss
     * would mean a folio marker written into decorative text on a curve.
     */
    if (IDMCP.containerOnPath(frame)) {
        return "Element with id " + String(e.frameId) +
            " is text-on-a-path, not a folio frame. Its geometry " +
            "belongs to the graphic that owns the path, and writing a marker there would be writing " +
            "to the wrong place.";
    }

    /*
     * THE PAGE IS PART OF THE ORACLE, NOT A LOOKUP. The expected number is
     * derived from the SPREAD composition of the page the frame was
     * measured on. If the frame has since moved (the operator dragged it,
     * InDesign recomposed), the same number now means something else — and
     * exactly that kind of marker would look correct.
     */
    var pageName = null;
    try {
        var pp = IDMCP.parentPageOf(frame);
        pageName = pp ? String(pp.name) : null;
    } catch (eP) { pageName = null; }
    if (pageName !== String(e.page)) {
        if (IDMCP.isMasterItemOn(doc, e.page, e.frameId)) {
            return "Frame with id " + String(e.frameId) +
                " is a parent-page item, visible from page " + String(e.page) +
                ". Writing to it would change EVERY page that uses this master.";
        }
        return "Frame with id " + String(e.frameId) + " was measured on page " + String(e.page) +
            ", but it's now on \"" + String(pageName) + "\" — the layout changed since the measurement.";
    }

    /*
     * TWO LOCKS, TWO REJECTIONS, AND NEITHER RELIES ON INDESIGN.
     *
     * Measured (Question 19, probe `scripts/probe-h7-lock.jsx`): replacing a
     * character via `characters.itemByRange(...).contents` goes through
     * WITHOUT AN EXCEPTION whether `frame.locked === true`, whether
     * `frame.itemLayer.locked === true`, at the interaction-suppression
     * default, and under `NEVER_INTERACT` — i.e. exactly the path this
     * handler writes through. The locks are real (`geometricBounds` and
     * `remove()` on the same frame throw `Object is locked.`), but they
     * protect the page item, not its text. So without these two checks a
     * locked frame would be SILENTLY overwritten.
     *
     * The messages differ on purpose: a layer lock isn't visible on the
     * frame itself, and "unlock the frame" would send the operator to the
     * wrong place.
     */
    var locked = false;
    try { locked = frame.locked === true; } catch (eL) { locked = false; }
    if (locked) {
        return "Frame with id " + String(e.frameId) +
            " is locked. InDesign lets a text write through anyway (measured), so we refuse instead: " +
            "the lock was placed by the layout artist. Unlock the frame and try again.";
    }

    var layerLocked = false;
    var layerNameOf = "";
    try {
        var lay = frame.itemLayer;
        layerLocked = lay.locked === true;
        layerNameOf = String(lay.name);
    } catch (eLL) { layerLocked = false; }
    if (layerLocked) {
        return "Frame with id " + String(e.frameId) + " sits on a LOCKED layer \"" + layerNameOf +
            "\". The frame itself is not locked, and InDesign would let the write through — " +
            "we refuse instead. Unlock the layer and try again.";
    }

    var paras = frame.paragraphs;
    if (typeof e.paragraphIndex !== "number" || e.paragraphIndex < 0 || e.paragraphIndex >= paras.length) {
        return "Frame " + String(e.frameId) + " has " + paras.length + " paragraphs, but the edit was requested for paragraph " +
            String(e.paragraphIndex) + ".";
    }
    var para = paras[e.paragraphIndex];

    /*
     * ACTUAL-CONTENT CHECK — THE ANALOG OF `expectedOld` IN
     * `corrections_apply`, and it checks the WHOLE paragraph, not just the
     * literal.
     *
     * Checking just the literal ISN'T ENOUGH, and that's not caution, it's
     * arithmetic: "14" → "144" leaves the same "14" characters at the
     * measured offset, so a narrow check passes while the replacement would
     * give "⟨marker⟩4" — a plausible wrong number, i.e. a worse failure mode
     * than §3 allows.
     *
     * The text is built by the SAME `IDMCP.claimParagraph` as the
     * measurement: otherwise two implementations of the same line would
     * diverge at the first special character (`character.contents` returns
     * the enum NAME, "8–9" → "8EN_DASH9").
     */
    var claim = IDMCP.claimParagraph(para, e.paragraphIndex);
    if (claim.text !== String(e.expectedParagraphText)) {
        return "Paragraph text changed since the measurement: expected \"" + String(e.expectedParagraphText) +
            "\", found in the document \"" + claim.text.substr(0, 120) + "\".";
    }

    if (!IDMCP.isDigits(String(e.expectedLiteral))) {
        return "Expected literal \"" + String(e.expectedLiteral) +
            "\" is not a number; the marker replaces a number, not arbitrary text.";
    }
    var length = String(e.expectedLiteral).length;
    var start = e.charOffset;
    if (typeof start !== "number" || start < 0 || start + length > para.characters.length) {
        return "Character range [" + String(start) + ", " + String(start + length) +
            ") is out of the paragraph's bounds (" + para.characters.length + " characters).";
    }

    /*
     * THE SECOND CHECK — NARROWER, AND ABOUT THE OFFSET, NOT THE TEXT. The
     * paragraph has just been confirmed unchanged, so a mismatch here means
     * `charOffset` points at the wrong literal: the edit was assembled from
     * the wrong measurement. Writing at that offset would overwrite
     * neighboring characters.
     */
    var range = para.characters.itemByRange(start, start + length - 1);
    var actual = IDMCP.rangeText(range);
    if (actual !== String(e.expectedLiteral)) {
        return "At offset " + String(start) + " there's \"" + actual + "\", not \"" +
            String(e.expectedLiteral) + "\".";
    }

    /*
     * Character formatting on the range survives the replacement — measured
     * (Question 11: 30 pt size and color stayed on the marker). So there's
     * no need to reapply formatting after the write.
     */
    range.contents = marker;
    return null;
};

IDMCP.handlers.pagination_replace_literals = function (params) {
    var doc = IDMCP.activeDoc();

    /*
     * Safeguard #0. The plan was built for a specific document; the one
     * active in InDesign could well be a different one — the user's working
     * book. Checked FIRST, before the copy and before any write.
     * `expectedDocName` is REQUIRED here (spec §5.1): on the TypeScript
     * side, `assertExpectedDoc` does nothing when `undefined`, and the cost
     * of silence is a write into a live book.
     */
    if (!params.expectedDocName) {
        throw new Error(
            "pagination_replace_literals requires expectedDocName — the name of the document the plan was built for."
        );
    }
    if (doc.name !== params.expectedDocName) {
        throw new Error(
            "The active InDesign document is \"" + doc.name + "\", but the plan was built for \"" +
                params.expectedDocName + "\". Nothing was changed, no copy was made. " +
                "Make the intended document active, or rebuild the plan."
        );
    }
    if (!params.stamp) {
        throw new Error("pagination_replace_literals requires stamp — a timestamp for the backup file's name.");
    }
    if (!doc.saved) {
        throw new Error("The document hasn't been saved to disk yet. Save it so a backup copy can be made.");
    }

    var edits = params.edits || [];

    /*
     * Safeguard #2 — the OUTERMOST wrapper around everything that touches
     * the document. `doc.saveACopy` is the call most prone to modal dialogs
     * (changed links, font substitution, volume permission), and it must be
     * the one inside, or the dialog would block osascript for the whole
     * timeout.
     */
    return IDMCP.withNoInteraction(function () {
        /*
         * The heartbeat covers EVERYTHING that touches the document,
         * including the copy: on a 196-page book in a cloud folder the copy
         * takes seconds, and that's exactly the window where osascript is
         * most likely to get killed on timeout. A trail written AFTER the
         * copy wouldn't have stopped a second write on top of a still-live
         * first one (`src/jsx/apply.jsx`, A2 / Phase 3 W2).
         */
        return IDMCP.withHeartbeat(params.heartbeatPath, "pagination_replace_literals", doc.name, function (touch) {
            /* Safeguard #1: the copy is made before any changes and OUTSIDE the undo step. */
            var copy = IDMCP.folioBackupCopy(doc, params.stamp, touch);
            var backupFile = copy.file;
            var rotated = copy.rotated;
            var backupRotationError = copy.rotationError;

            var pageCountBefore = doc.pages.length;
            var oversetBefore = IDMCP.oversetStoryIds(doc);

            /*
             * One shared report object, not separate counters: if
             * `withUndo` throws, THAT SAME OBJECT is returned — already
             * carrying the accumulated `applied`/`failed` and the copy's
             * path, which would otherwise be invisible behind the
             * exception's text.
             *
             * `oversetAfter` AND `pageCountAfter` START as `null` — "NOT
             * MEASURED", NOT the "before" VALUE.
             *
             * `apply_edits` puts placeholder values here (`[]` and
             * `pageCountBefore`), and that's the same substitution that
             * already cost the phase once via `ClaimFrame.overlaps`: "we
             * didn't count" was represented by a value byte-identical to a
             * measured fact, so the report claimed "nothing changed" on the
             * strength of a measurement that never happened. The cost here
             * is the same: `withDiffs` would get `becameOverset: []` and the
             * §7 loud error would NEVER fire.
             *
             * `null` doesn't allow that: it never equals any measurement, so
             * a lost "after" measurement can't hide behind a plausible
             * value. Alongside it the report always carries `fatalError`,
             * and `runWrite` (`src/bridge/envelope.ts`) turns it into an
             * error.
             */
            var report = {
                docName: doc.name,
                backupPath: backupFile.fsName,
                backupsRemoved: rotated,
                backupRotationError: backupRotationError,
                applied: 0,
                failed: [],
                oversetBefore: oversetBefore,
                oversetAfter: null,
                pageCountBefore: pageCountBefore,
                pageCountAfter: null
            };

            try {
                /*
                 * Safeguard #3: ONE undo step around the ENTIRE operation.
                 * Two wrappers instead of one would mean the first Cmd+Z
                 * only rolls back half the batch — exactly when undo is
                 * needed most. Undo can't be measured from a script
                 * (Question 12: `doc.undo()` throws inside its own step), so
                 * §8 step 8 requires a manual check.
                 */
                IDMCP.withUndo(params.undoName || "Automatic folios", function () {
                    for (var i = 0; i < edits.length; i++) {
                        var e = edits[i];

                        /*
                         * Once per edit, and REGARDLESS of whether it
                         * landed or not: on a run of failures the trail
                         * could otherwise go stale and block the next call.
                         */
                        touch();

                        /*
                         * Each edit gets its own try. A realistic exception
                         * mid-batch (a locked layer, a locked story) would
                         * otherwise destroy the WHOLE report: edits 1..k
                         * would stay written, and the user would get just
                         * the raw ExtendScript error text — no copy path,
                         * no list of what had already landed.
                         */
                        var problem = null;
                        try {
                            problem = IDMCP.replaceFolioLiteral(doc, e);
                        } catch (writeErr) {
                            /*
                             * THE EXCEPTION'S SITE, NOT JUST ITS MESSAGE.
                             * `.message` alone gives a diagnosis like
                             * "TextFrame.===() cannot work with instances of
                             * this class" — true, but impossible to locate.
                             * ExtendScript exceptions carry `.line` and
                             * `.fileName`; discarding them forces the next
                             * person to search blind.
                             */
                            var where = "";
                            try {
                                if (writeErr.line) where = " [line " + String(writeErr.line);
                                if (where !== "" && writeErr.fileName) {
                                    where = where + ", " + String(writeErr.fileName).replace(/^.*\//, "");
                                }
                                if (where !== "") where = where + "]";
                            } catch (eLoc) { where = ""; }
                            problem = String(writeErr.message || writeErr) + where;
                        }
                        if (problem === null) {
                            report.applied++;
                        } else {
                            report.failed.push({
                                frameId: String(e.frameId),
                                page: String(e.page),
                                paragraphIndex: e.paragraphIndex,
                                error: problem
                            });
                        }
                    }
                });

                /*
                 * Deliberately INSIDE the try: if `withUndo` threw, these
                 * reads can fail on their own, and a second exception would
                 * overwrite the `fatalError` already collected.
                 */
                report.oversetAfter = IDMCP.oversetStoryIds(doc);
                report.pageCountAfter = doc.pages.length;
            } catch (e2) {
                /* The copy already exists — return the report with its path instead
                 * of an exception in which `backupPath` isn't visible. */
                report.fatalError = String(e2);
            }

            return report;
        });
    });
};

/*
 * BUILDING THE HELPER CHAIN (spec §4.2 route B, §4.8).
 *
 * ONE CLAIM GOVERNS EVERYTHING HERE, AND IT'S THE OPPOSITE OF THE OBVIOUS:
 *
 *     a frame is created on EVERY page of the range, not only where a folio
 *     exists.
 *
 * MEASURED (Question 18, 2026-08-08). The marker prints the page of the
 * PREVIOUS FRAME IN THE CHAIN, not "current minus one": over a chain built
 * from odd pages only, the label on p. 3 printed "1", on p. 5 — "3", on
 * p. 7 — "5". All 91 folios in the working book sit on recto, so under the
 * rule "a frame where a folio exists" the chain would land on odd pages, and
 * p. 97 would print "95–97" — 91 lying markers out of 91, each looking
 * correct. That is exactly the failure mode §3 calls worse than a manual
 * number.
 *
 * THE SECOND HALF OF THIS CONTRACT ALREADY STANDS IN THE ORACLE:
 * `helperChainOffsets` and `helperChainNeighbour`
 * (`src/pagination/rewrite.ts`) look for the neighbor IN THE CHAIN ITSELF,
 * not by computing `offset ± 1`. The oracle has to predict the number
 * BEFORE the chain exists, so it relies on the rule of how the chain is
 * built — and that rule is exactly what this handler carries out. That's
 * why "range" here means the WHOLE DOCUMENT, with no narrowing parameter at
 * all: a sub-range would give, on its first page, the promise of page
 * `offset − 1`, for which no frame gets created — the same lie, just at the
 * boundaries.
 *
 * WHAT THIS HANDLER DOES NOT DO. It doesn't decide which frames are
 * eligible, and it writes no marker at all — that's
 * `pagination_replace_literals` above. It only lays down, under the folios,
 * a chain that will have something to resolve to, and returns ACTUAL
 * coverage, so the second call checks the decision instead of rebuilding it
 * (§4.5).
 */
IDMCP.handlers.pagination_create_helper_thread = function (params) {
    var doc = IDMCP.activeDoc();

    /*
     * The same four safeguards as the replacement handler, in the same
     * order: the document check comes FIRST, before the copy and before any
     * write. `expectedDocName` is REQUIRED (§5.1): on the TypeScript side
     * `assertExpectedDoc` does nothing when `undefined`, and the cost of
     * silence is a structural change to the user's live book.
     */
    if (!params.expectedDocName) {
        throw new Error(
            "pagination_create_helper_thread requires expectedDocName — the name of the document to build the chain in."
        );
    }
    if (doc.name !== params.expectedDocName) {
        throw new Error(
            "The active InDesign document is \"" + doc.name + "\", but the chain was requested to be built in \"" +
                params.expectedDocName + "\". Nothing was changed, no copy was made."
        );
    }
    if (!params.stamp) {
        throw new Error("pagination_create_helper_thread requires stamp — a timestamp for the backup file's name.");
    }
    if (!doc.saved) {
        throw new Error("The document hasn't been saved to disk yet. Save it so a backup copy can be made.");
    }

    var layerName = params.layerName || IDMCP.HELPER_LAYER_NAME;

    /*
     * LAYER STATE IS READ BEFORE THE COPY, AND THE REJECTION HERE ALSO
     * PRECEDES THE COPY: an unneeded 16 MB copy isn't safety, it's clutter
     * in the user's folder.
     *
     * WHY EXISTING ELEMENTS ON THE LAYER ARE A REJECTION, NOT "WE'LL JUST
     * ADD TO IT." Measured (Question 9, 5 out of 5 cases): the chain
     * CREATED EARLIER wins — neither stacking order, nor container count,
     * nor overlap area matter. So an old helper frame left under a folio
     * would outrank the fresh chain, and the marker would take its number
     * from IT; and a frame left outside the chain silently prints ITS OWN
     * page per Question 10. Both outcomes look correct — meaning there's
     * nothing left to catch them with afterward.
     *
     * The phase deliberately doesn't build a reverse operation (§4.8): the
     * layer is deleted in InDesign with one action, and that's exactly what
     * the message names.
     */
    var layer = doc.layers.itemByName(layerName);
    var layerExisted = false;
    try { layerExisted = layer.isValid === true; } catch (eLayer) { layerExisted = false; }

    var layerFlagsBefore = null;
    if (layerExisted) {
        if (layer.pageItems.length > 0) {
            throw new Error(
                "Layer \"" + layerName + "\" already has " + layer.pageItems.length +
                    " element(s) on it. A second chain would not override the first (measured: the one created earlier wins), " +
                    "so nothing was changed. Delete the layer \"" + layerName + "\" in InDesign with one action and try again."
            );
        }
        var lockedLayer = false;
        try { lockedLayer = layer.locked === true; } catch (eLock) { lockedLayer = false; }
        if (lockedLayer) {
            throw new Error(
                "Layer \"" + layerName + "\" is locked — InDesign won't allow frames to be placed on it. " +
                    "Nothing was changed."
            );
        }
        layerFlagsBefore = {
            visible: layer.visible === true,
            printable: layer.printable === true
        };
    }

    return IDMCP.withNoInteraction(function () {
        return IDMCP.withHeartbeat(params.heartbeatPath, "pagination_create_helper_thread", doc.name, function (touch) {
            var copy = IDMCP.folioBackupCopy(doc, params.stamp, touch);

            var report = {
                docName: doc.name,
                backupPath: copy.file.fsName,
                backupsRemoved: copy.rotated,
                backupRotationError: copy.rotationError,
                layerName: layerName,
                layerCreated: !layerExisted,
                layerFlagsBefore: layerFlagsBefore,
                created: 0,
                frames: [],
                ignoredFolioFrames: [],
                oversetBefore: IDMCP.oversetStoryIds(doc),
                /*
                 * `null` — "NOT MEASURED", not the "before" value. The same
                 * lesson as `ClaimFrame.overlaps`: a placeholder
                 * byte-identical to a measured fact would give `withDiffs`
                 * an empty `becameOverset`, and the §7 loud error "helper
                 * frames pushed the layout" would NEVER fire.
                 */
                oversetAfter: null,
                pageCountBefore: doc.pages.length,
                pageCountAfter: null
            };

            /*
             * THE RULER IS THE SPREAD, and without this the handler cannot
             * write at all. `geometricBounds` are given and taken in the
             * current coordinate system; under `PAGE_ORIGIN` zero sits at
             * the PAGE's corner, and a just-created frame not yet
             * unambiguously assigned to a page gets a rectangle in the wrong
             * system. This isn't a hypothesis: the first draft of the
             * Question 18 probe seated page "3"'s frame geometrically on
             * "2" exactly this way.
             *
             * The risk is named in the same place as in
             * `pagination_measure`: on timeout the ruler can be left in the
             * wrong scope. The change is view-only, fully reversible, and
             * the cost of the alternative is frames on the wrong pages.
             */
            var previousOrigin = null;
            var previousActiveLayer = null;

            try {
                try {
                    previousOrigin = doc.viewPreferences.rulerOrigin;
                    if (previousOrigin === RulerOrigin.SPREAD_ORIGIN) {
                        previousOrigin = null;
                    } else {
                        doc.viewPreferences.rulerOrigin = RulerOrigin.SPREAD_ORIGIN;
                    }
                } catch (eOrigin) { previousOrigin = null; }

                /*
                 * Safeguard: ONE undo step around EVERYTHING — the layer and
                 * all the frames. Two wrappers would mean the first Cmd+Z
                 * removes half the chain, leaving it with a GAP — exactly
                 * the state Question 18 measured as lying.
                 */
                IDMCP.withUndo(params.undoName || "Helper chain of folios", function () {
                    var helperLayer;
                    if (layerExisted) {
                        helperLayer = doc.layers.itemByName(layerName);
                    } else {
                        helperLayer = doc.layers.add({ name: layerName });
                    }
                    /*
                     * THE FLAGS ARE ALWAYS SET — both on a newly created
                     * layer and on one that already exists with others.
                     * Measured (Question 8): `visible = false` MUTES
                     * resolution (13 instead of 12 in the PDF),
                     * `printable = false` does not (16 out of 16). So one
                     * click on the "eye" silently turns every automatic
                     * folio in the book into "N–N", and it will look the
                     * same as always. Hiding a layer is a habit specific to
                     * this document — it's used to switch off a broken
                     * master folio.
                     */
                    helperLayer.visible = true;
                    helperLayer.printable = false;

                    /*
                     * `doc.layers.add` makes the new layer active (measured
                     * on the Phase 7 fixture: three states silently landed
                     * on the hidden layer), and `textFrames.add()` puts the
                     * frame on whichever layer is active. Set explicitly —
                     * otherwise a locked active layer would break creation
                     * of the very first frame — and restore in `finally`.
                     */
                    try { previousActiveLayer = doc.activeLayer; } catch (eAct) { previousActiveLayer = null; }
                    doc.activeLayer = helperLayer;

                    /*
                     * GEOMETRY COMES FROM THE FOLIO ITSELF, AND FROM THE
                     * LIVE FRAME, NOT FROM NUMBERS IN PARAMETERS. §4.2
                     * requires the rectangle to match the folio's bounds
                     * EXACTLY; reading `geometricBounds` here and now gives
                     * that match by construction and, at the same time,
                     * reports the page from the frame itself, not from a
                     * name that two different pages in the book might
                     * share.
                     *
                     * A rotated frame (all 91 in the book are at −90°)
                     * returns an ENCLOSING rectangle over its four corners —
                     * measured separately; the helper frame covers it
                     * entirely, which is what the resolution needs.
                     */
                    var pages = doc.pages;
                    var pageIndexById = {};
                    for (var pi = 0; pi < pages.length; pi++) {
                        pageIndexById[String(pages[pi].id)] = pi;
                    }

                    var geometryAt = {};
                    var wanted = params.folioFrameIds || [];
                    for (var w = 0; w < wanted.length; w++) {
                        var id = String(wanted[w]);
                        var src = null;
                        try { src = doc.pageItems.itemByID(parseInt(id, 10)); } catch (eSrc) { src = null; }
                        var okSrc = false;
                        /* Truthiness, not `!==` — see the comment at `valid` above. */
                        try { okSrc = !!src && src.isValid === true; } catch (eVal) { okSrc = false; }
                        if (!okSrc) {
                            report.ignoredFolioFrames.push({ frameId: id, reason: "no frame with that id in the document" });
                            continue;
                        }
                        var host = null;
                        try { host = src.parentPage; } catch (eHost) { host = null; }
                        if (!host) {
                            report.ignoredFolioFrames.push({ frameId: id, reason: "the frame doesn't belong to any page" });
                            continue;
                        }
                        var at = pageIndexById[String(host.id)];
                        if (at === undefined) {
                            /* A MASTER PAGE item: its `parentPage` is the master's
                             * page (measured, Question 17), and no such
                             * frame physically exists on the document page. */
                            report.ignoredFolioFrames.push({
                                frameId: id,
                                reason: "the frame is on the parent page \"" + String(host.name) + "\""
                            });
                            continue;
                        }
                        if (geometryAt[at] !== undefined) {
                            /* Two folios on one page: there's a single helper frame
                             * here (a second would make a chain with two
                             * frames on one page, and then "the previous
                             * frame" for the second would be THAT SAME page
                             * — the label would print its own). The first
                             * wins, the rest go loudly into the report. */
                            report.ignoredFolioFrames.push({
                                frameId: id,
                                reason: "page \"" + String(host.name) + "\" already has another folio's geometry taken"
                            });
                            continue;
                        }
                        var g = null;
                        try { g = src.geometricBounds; } catch (eG) { g = null; }
                        if (g === null) {
                            report.ignoredFolioFrames.push({ frameId: id, reason: "the frame's bounds can't be read" });
                            continue;
                        }
                        geometryAt[at] = { bounds: g, frameId: id };
                    }

                    /*
                     * AND NOW — EVERY PAGE, NO CONDITION AT ALL. A condition
                     * here would not be an optimization, it would be a
                     * return to the measured lie: a chain with a gap gives
                     * the marker the page of the previous FRAME, and every
                     * number downstream would drift.
                     */
                    var previousFrame = null;
                    for (var i = 0; i < pages.length; i++) {
                        var page = pages[i];
                        var frame = page.textFrames.add();
                        frame.itemLayer = helperLayer;

                        var known = geometryAt[i];
                        var source = "page";
                        var bounds;
                        if (known === undefined) {
                            bounds = IDMCP.helperFallbackBounds(page);
                            if (bounds === null) {
                                throw new Error(
                                    "Page \"" + String(page.name) + "\"'s bounds can't be read — " +
                                        "there's nowhere to place the helper frame, and a chain with a gap lies on every frame."
                                );
                            }
                        } else {
                            source = "folio";
                            bounds = known.bounds;
                        }
                        frame.geometricBounds = bounds;

                        /* NONE text wrap (§4.2): the helper frame must not
                         * push a single line of the main text. */
                        frame.textWrapPreferences.textWrapMode = TextWrapModes.NONE;

                        /* Contents stay EMPTY — verified separately (Question
                         * 13b, mark `E13`): the two-frame, zero-character
                         * story resolves correctly. */

                        if (previousFrame) previousFrame.nextTextFrame = frame;
                        previousFrame = frame;

                        report.created++;
                        report.frames.push({
                            page: String(page.name),
                            offset: i,
                            frameId: String(frame.id),
                            source: source,
                            folioFrameId: known === undefined ? null : known.frameId
                        });

                        /* Once per page: over 196 pages construction takes
                         * long enough for the trail to go stale. */
                        touch();
                    }
                });

                /* Deliberately INSIDE the try: if `withUndo` threw, these reads
                 * can fail on their own, and a second exception would overwrite
                 * the `fatalError` already collected. */
                report.oversetAfter = IDMCP.oversetStoryIds(doc);
                report.pageCountAfter = doc.pages.length;
            } catch (e2) {
                report.fatalError = String(e2);
            } finally {
                /* Order is the reverse of setup. */
                if (previousActiveLayer) {
                    try { doc.activeLayer = previousActiveLayer; } catch (eR1) { }
                }
                if (previousOrigin !== null) {
                    try { doc.viewPreferences.rulerOrigin = previousOrigin; } catch (eR2) { }
                }
            }

            return report;
        });
    });
};

/*
 * REPAIRING THE HELPER CHAIN (Phase 8 spec, §4.3).
 *
 * FOUR STEPS, AND THE ORDER BETWEEN THEM IS MANDATORY:
 *   1) remove excess — a second-and-later frame on the same page, and
 *      orphans;
 *   2) add missing ones — one per page lacking a link;
 *   3) UNTHREAD ALL, then rethread in page order;
 *   4) restore the layer flags (`visible = true`, `printable = false`).
 *
 * Removal BEFORE adding: otherwise a page with two frames would get a
 * third. Rethreading AFTER both: otherwise the order would have to be
 * fixed twice.
 *
 * STEP 3 HAS EXACTLY THIS SHAPE, AND IT'S MEASURED, NOT CHOSEN (probe
 * `H8`). The natural "assign `nextTextFrame` in page order" is IMPOSSIBLE:
 * on a frame that's already threaded, the assignment throws "Invalid
 * object for this request.", and the chain doesn't change at all
 * (Question 3). Partial threading doesn't save it either — a frame
 * threaded onto the tail of an existing chain stays at the tail
 * ("1,2,3,5,6,7,4" — Question 2b). Only the full cycle works:
 * `nextTextFrame = null` on every frame (unthreading is clean, no frame is
 * lost), then rethreading from scratch, which gives exactly the order
 * requested (Question 3b).
 *
 * THE REPAIR MAKES THE CHAIN YOUNGER, AND THAT WAS CHECKED ON PURPOSE. A
 * full cycle creates a NEW history with a higher `id` (`256 → 469`,
 * Question 4b). Since InDesign picks the chain CREATED EARLIER as the
 * winner (Question 9, Phase 7), the helper chain keeps losing to the main
 * one afterward — so the repair doesn't silently switch part of the folios
 * to a different number source. The opposite result would make the
 * operation unsafe.
 *
 * WHAT THIS HANDLER DOES NOT DO. It doesn't decide which folios are
 * eligible, and it writes no marker. It restores the CHAIN, not the
 * layout: after an odd change in page count, an intact chain will still
 * give perfectly consistent pairs of numbers from the WRONG spread, and
 * that's caught by `folio-marker-cross-spread`, not by the repair.
 */
IDMCP.handlers.pagination_repair_helper_thread = function (params) {
    var doc = IDMCP.activeDoc();

    /* The same four safeguards as in both Phase 7 handlers, in the same
     * order: the document check comes FIRST, before the copy and before any
     * write. */
    if (!params.expectedDocName) {
        throw new Error(
            "pagination_repair_helper_thread requires expectedDocName — the name of the document to repair the chain in."
        );
    }
    if (doc.name !== params.expectedDocName) {
        throw new Error(
            "The active InDesign document is \"" + doc.name + "\", but the chain was requested to be repaired in \"" +
                params.expectedDocName + "\". Nothing was changed, no copy was made."
        );
    }
    if (!params.stamp) {
        throw new Error("pagination_repair_helper_thread requires stamp — a timestamp for the backup file's name.");
    }
    if (!doc.saved) {
        throw new Error("The document hasn't been saved to disk yet. Save it so a backup copy can be made.");
    }

    var layerName = params.layerName || IDMCP.HELPER_LAYER_NAME;
    var layer = doc.layers.itemByName(layerName);
    var layerExists = false;
    try { layerExists = layer.isValid === true; } catch (eLayer) { layerExists = false; }
    if (!layerExists) {
        throw new Error(
            "Layer \"" + layerName + "\" doesn't exist in the document — nothing to repair. The helper chain " +
                "is built by operation: \"create-helper-thread\"; repair restores an existing one."
        );
    }

    /* The layer lock is ALSO checked before the copy: on a locked layer
     * frames couldn't be added and excess ones couldn't be removed. */
    var lockedLayer = false;
    try { lockedLayer = layer.locked === true; } catch (eLock) { lockedLayer = false; }
    if (lockedLayer) {
        throw new Error(
            "Layer \"" + layerName + "\" is locked — InDesign will allow neither placing " +
                "frames on it nor removing extra ones. Nothing was changed."
        );
    }

    /*
     * WHAT'S ALLOWED TO BE DELETED — NARROWED TO THE LIMIT, AND CHECKED
     * BEFORE THE COPY.
     *
     * The name `_folio-helper` IS NOT OWNED BY THE TOOL (docstring on
     * `HELPER_LAYER_NAME`, `src/pagination/topology.ts`), so a layer with
     * our name could carry someone else's work — and it can't be deleted
     * silently. Any deviation (not a text frame, non-empty, with nested
     * objects) is a REJECTION OF THE WHOLE OPERATION with a named list, not
     * "skip this one and move on": selective cleanup would leave the chain
     * half-repaired and turn the report into a lie.
     *
     * `getElements()` here and elsewhere is for the same reason as in the
     * measurement: indexing the collection re-resolves it on every access
     * (measured, 773 ms versus 22 ms on 100 frames).
     */
    var refused = [];
    var onLayer = layer.pageItems.everyItem().getElements();
    for (var i = 0; i < onLayer.length; i++) {
        var it = onLayer[i];
        var itId = "";
        try { itId = String(it.id); } catch (eId) { itId = "?"; }
        if (!IDMCP.isTextFrameLike(it)) {
            refused.push({ frameId: itId, reason: "not a text frame" });
            continue;
        }
        var chars = -1;
        try { chars = it.characters.length; } catch (eC) { chars = -1; }
        if (chars !== 0) {
            refused.push({
                frameId: itId,
                reason: chars < 0 ? "content can't be read" : "the frame is NOT empty (" + chars + " chars)"
            });
            continue;
        }
        var nested = 0;
        try { nested = it.pageItems.length; } catch (eA) { nested = 0; }
        if (nested > 0) {
            refused.push({ frameId: itId, reason: "the frame has " + nested + " nested object(s)" });
        }
    }
    if (refused.length > 0) {
        var brief = [];
        for (var r = 0; r < refused.length && r < 10; r++) {
            brief.push("id " + refused[r].frameId + ": " + refused[r].reason);
        }
        throw new Error(
            "Layer \"" + layerName + "\" has " + refused.length + " element(s) that repair " +
                "must NOT delete: the layer's name isn't owned by this tool, and someone else's work could " +
                "legitimately be under it. Nothing was changed, no copy was made. " +
                brief.join("; ") + (refused.length > 10 ? "; …" : "") +
                ". Remove or move these elements and try again."
        );
    }

    return IDMCP.withNoInteraction(function () {
        return IDMCP.withHeartbeat(params.heartbeatPath, "pagination_repair_helper_thread", doc.name, function (touch) {
            var copy = IDMCP.folioBackupCopy(doc, params.stamp, touch);

            var report = {
                docName: doc.name,
                backupPath: copy.file.fsName,
                backupsRemoved: copy.rotated,
                backupRotationError: copy.rotationError,
                layerName: layerName,
                layerFlagsBefore: {
                    visible: layer.visible === true,
                    printable: layer.printable === true
                },
                removed: [],
                created: [],
                restitched: 0,
                framesAfter: 0,
                oversetBefore: IDMCP.oversetStoryIds(doc),
                /* `null` — "NOT MEASURED", not the "before" value: a placeholder
                 * byte-identical to a measured fact would make the §7 loud
                 * error "helper frames pushed the layout" unreachable
                 * FOREVER. */
                oversetAfter: null,
                pageCountBefore: doc.pages.length,
                pageCountAfter: null
            };

            var previousOrigin = null;
            var previousActiveLayer = null;

            try {
                /* THE RULER IS THE SPREAD. Under `PAGE_ORIGIN` zero sits at the
                 * PAGE's corner, and a just-created frame gets a rectangle
                 * in the wrong system: the first draft of the Question 18
                 * probe seated page "3"'s frame geometrically on "2" exactly
                 * this way. */
                try {
                    previousOrigin = doc.viewPreferences.rulerOrigin;
                    if (previousOrigin === RulerOrigin.SPREAD_ORIGIN) {
                        previousOrigin = null;
                    } else {
                        doc.viewPreferences.rulerOrigin = RulerOrigin.SPREAD_ORIGIN;
                    }
                } catch (eOrigin) { previousOrigin = null; }

                /*
                 * ONE undo step around all four steps. Two wrappers would
                 * mean the first Cmd+Z leaves the chain with a gap —
                 * exactly the state Question 18 measured as lying.
                 */
                IDMCP.withUndo(params.undoName || "Repair of the helper chain", function () {
                    try { previousActiveLayer = doc.activeLayer; } catch (eAct) { previousActiveLayer = null; }
                    doc.activeLayer = layer;

                    var pages = doc.pages.everyItem().getElements();
                    var pageIndexById = {};
                    for (var pi = 0; pi < pages.length; pi++) pageIndexById[String(pages[pi].id)] = pi;

                    /* --- STEP 1: remove excess ---------------------------- */
                    var keptAt = {};
                    var doomed = [];
                    var live = layer.pageItems.everyItem().getElements();
                    for (var k = 0; k < live.length; k++) {
                        var f = live[k];
                        var host = null;
                        try { host = f.parentPage; } catch (eH) { host = null; }
                        var at = (host === null || host === undefined)
                            ? undefined
                            : pageIndexById[String(host.id)];
                        if (at === undefined) {
                            /* Orphan: there's no page, so it holds no chain link —
                             * the marker has nothing to resolve to. */
                            doomed.push({ frame: f, page: null, reason: "orphan" });
                            continue;
                        }
                        if (keptAt[at] === undefined) { keptAt[at] = f; continue; }
                        /* The first one on a page wins — the same convention as
                         * `ignoredFolioFrames` uses during construction. The
                         * second one changes the printed number ("2–3" →
                         * "3–3"), so it can't be left in place. */
                        doomed.push({ frame: f, page: String(pages[at].name), reason: "duplicate-on-page" });
                    }
                    for (var d = 0; d < doomed.length; d++) {
                        var dead = doomed[d];
                        var deadId = String(dead.frame.id);
                        dead.frame.remove();
                        report.removed.push({ frameId: deadId, page: dead.page, reason: dead.reason });
                        touch();
                    }

                    /* --- STEP 2: add the missing ones ------------------------- */
                    /*
                     * GEOMETRY COMES FROM THIS PAGE'S LIVE FOLIO, as in
                     * construction: §4.2 requires an EXACT bounds match, and
                     * reading `geometricBounds` here and now gives that by
                     * construction.
                     *
                     * DONORS ARE REQUIRED WHEREVER A FOLIO EXISTS, AND
                     * THAT'S PROVEN BY THE PRINTED NUMBER. Probe `H8` first
                     * called this handler with an empty `folioFrameIds`,
                     * and the added link landed in the page's corner
                     * (`helperFallbackBounds`), i.e. it did NOT cover the
                     * folio: the chain came out unbroken, the report was
                     * clean, and on the sheet page 5 onward printed "5–5"
                     * instead of "4–5". So without donors the repair fixes
                     * the CHAIN and doesn't fix the NUMBER — exactly the
                     * failure mode §3 calls worse than a manual number.
                     *
                     * Donors are assembled by the caller
                     * (`src/tools/pagination.ts`, `measure.folioFrames`
                     * excluding master items, hidden ones, and those whose
                     * bounds are unknown). The handler doesn't invent them:
                     * on a page without a folio there's nothing to cover,
                     * and the fallback rectangle is correct there.
                     */
                    var geometryAt = {};
                    var wanted = params.folioFrameIds || [];
                    for (var w = 0; w < wanted.length; w++) {
                        var src = null;
                        try { src = doc.pageItems.itemByID(parseInt(String(wanted[w]), 10)); } catch (eSrc) { src = null; }
                        var okSrc = false;
                        /* Truthiness, not `!==` — see the comment at `valid` above. */
                        try { okSrc = !!src && src.isValid === true; } catch (eVal) { okSrc = false; }
                        if (!okSrc) continue;
                        var shost = null;
                        try { shost = src.parentPage; } catch (eSh) { shost = null; }
                        if (shost === null || shost === undefined) continue;
                        var sat = pageIndexById[String(shost.id)];
                        if (sat === undefined || geometryAt[sat] !== undefined) continue;
                        try { geometryAt[sat] = src.geometricBounds; } catch (eG) { }
                    }

                    for (var p = 0; p < pages.length; p++) {
                        if (keptAt[p] !== undefined) continue;
                        var page = pages[p];
                        var frame = page.textFrames.add();
                        frame.itemLayer = layer;
                        var source = "page";
                        var bounds = geometryAt[p];
                        if (bounds === undefined) {
                            bounds = IDMCP.helperFallbackBounds(page);
                            if (bounds === null) {
                                throw new Error(
                                    "Page \"" + String(page.name) + "\"'s bounds can't be read — there's nowhere " +
                                        "to place the helper frame, and a chain with a gap lies on every frame."
                                );
                            }
                        } else {
                            source = "folio";
                        }
                        frame.geometricBounds = bounds;
                        /* NONE text wrap: the helper frame must not push a
                         * single line of the main text (§4.2). */
                        frame.textWrapPreferences.textWrapMode = TextWrapModes.NONE;
                        keptAt[p] = frame;
                        report.created.push({ page: String(page.name), offset: p, frameId: String(frame.id), source: source });
                        touch();
                    }

                    /* --- STEP 3: unthread ALL, then rethread in page order -- */
                    /*
                     * UNTHREADING IS MANDATORY, AND THAT'S MEASURED
                     * (Question 3): assigning `nextTextFrame` on an
                     * already-threaded frame throws instead of
                     * reordering. Unthreading itself is clean here — the
                     * frames stay alive (Question 3b).
                     */
                    var ordered = [];
                    for (var q = 0; q < pages.length; q++) ordered.push(keptAt[q]);

                    /*
                     * WHETHER RETHREADING IS NEEDED AT ALL IS A QUESTION
                     * THAT HAS TO BE ASKED BEFORE THE WORK, NOT AFTER IT.
                     *
                     * Without this, the repair would rewrite the chain
                     * EVERY TIME, and the cost isn't cosmetic: a full
                     * unthread-rethread cycle creates a NEW history
                     * (measured, Question 4b: `256 → 469`), meaning every
                     * no-op run would still change `story.id`, mark the
                     * document `modified`, and push an undo step — for
                     * nothing. Idempotence here isn't a nicety: §4.3
                     * requires a second run in a row to give exactly zero,
                     * and that's precisely how the operator tells "repaired"
                     * apart from "keeps getting repaired every time."
                     *
                     * The chain is intact exactly when the first link has
                     * nothing before it, every following one is the
                     * previous one's `nextTextFrame`, and the last has no
                     * continuation. That checks EXACTLY the property step 3
                     * establishes.
                     */
                    var needsRestitch = report.removed.length > 0 || report.created.length > 0;
                    if (!needsRestitch) {
                        for (var c1 = 0; c1 < ordered.length && !needsRestitch; c1++) {
                            var wantPrev = c1 === 0 ? null : ordered[c1 - 1];
                            var wantNext = c1 + 1 < ordered.length ? ordered[c1 + 1] : null;
                            var gotPrev = null, gotNext = null;
                            try { gotPrev = ordered[c1].previousTextFrame; } catch (eP1) { needsRestitch = true; break; }
                            try { gotNext = ordered[c1].nextTextFrame; } catch (eN1) { needsRestitch = true; break; }
                            var prevId = (gotPrev === null || gotPrev === undefined) ? null : String(gotPrev.id);
                            var nextId = (gotNext === null || gotNext === undefined) ? null : String(gotNext.id);
                            var wantPrevId = wantPrev === null ? null : String(wantPrev.id);
                            var wantNextId = wantNext === null ? null : String(wantNext.id);
                            if (prevId !== wantPrevId || nextId !== wantNextId) needsRestitch = true;
                        }
                    }

                    if (!needsRestitch) {
                        /* The chain is already what step 3 would make it. Aside
                         * from the layer flags below, there's nothing left
                         * to do. */
                        report.framesAfter = ordered.length;
                        layer.visible = true;
                        layer.printable = false;
                        return;
                    }

                    for (var u = 0; u < ordered.length; u++) {
                        try {
                            if (ordered[u].nextTextFrame !== null) ordered[u].nextTextFrame = null;
                        } catch (eU) {
                            /*
                             * THE ROLLBACK HERE IS REAL, AND THAT'S
                             * MEASURED, NOT INFERRED.
                             *
                             * The history of this spot is worth a line,
                             * because it's about method. I first took "the
                             * operation is cancelled entirely" to be false,
                             * on the grounds that `IDMCP.withUndo` is
                             * `doScript(…, UndoModes.ENTIRE_SCRIPT)` with no
                             * `undo()` call anywhere, and nobody in the
                             * project had measured rollback on an exception.
                             * Both premises are true, the conclusion isn't:
                             * InDesign rolls the step back BY ITSELF.
                             *
                             * The 2026-08-17 probe with a positive control
                             * (`docs/measured-facts-mutating-spots.md`,
                             * Question 1): a frame created inside `doScript`
                             * EXISTS before the throw (`textFrames.length` =
                             * 1, id read), is gone after the exception (0),
                             * and the same action without an exception
                             * leaves the frame in place (1). So the step is
                             * rolled back entirely, and the chain returns to
                             * its pre-repair state.
                             *
                             * WHAT STAYS TRUE, AND WHAT THE ROLLBACK DOESN'T
                             * COVER: the app being force-quit, a crash, or
                             * the process getting killed on timeout in the
                             * middle of this very loop. In that case there's
                             * no exception, so nobody sees this message
                             * either, and the chain is left BROKEN — "N–N"
                             * instead of "170–171". That's exactly why the
                             * sentence below names both states, not just the
                             * reassuring one.
                             */
                            throw new Error(
                                "Failed to unstitch the helper frame id " + String(ordered[u].id) + ": " +
                                    String(eU.message || eU) + ". Unstitched links: " + u + " of " +
                                    ordered.length + ". InDesign rolls back the whole step on an exception " +
                                    "(measured), so the chain should remain as it was before the repair. " +
                                    "CHECK THIS BY EYE: if the application is ever force-quit " +
                                    "mid-unstitching, there will be no rollback, and the folios will print " +
                                    "'N\u2013N'. The backup copy's location is named alongside this error."
                            );
                        }
                        touch();
                    }

                    for (var s = 0; s + 1 < ordered.length; s++) {
                        ordered[s].nextTextFrame = ordered[s + 1];
                        report.restitched++;
                        touch();
                    }

                    /* --- STEP 4: layer flags ---------------------------- */
                    /* Measured (Question 8): `visible = false` MUTES marker
                     * resolution, `printable = false` doesn't. The repair
                     * restores both to their normal state. */
                    layer.visible = true;
                    layer.printable = false;

                    report.framesAfter = ordered.length;
                });

                /* Deliberately INSIDE the try: if `withUndo` threw, these reads
                 * can fail on their own, and a second exception would overwrite
                 * the `fatalError` already collected. */
                report.oversetAfter = IDMCP.oversetStoryIds(doc);
                report.pageCountAfter = doc.pages.length;
            } catch (e2) {
                report.fatalError = String(e2);
            } finally {
                /* Order is the reverse of setup. */
                if (previousActiveLayer !== null) {
                    try { doc.activeLayer = previousActiveLayer; } catch (eR1) { }
                }
                if (previousOrigin !== null) {
                    try { doc.viewPreferences.rulerOrigin = previousOrigin; } catch (eR2) { }
                }
            }

            return report;
        });
    });
};

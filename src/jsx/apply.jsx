/*
 * Applying a batch of corrections. Gives three guarantees:
 *   1) a copy of the document in _backups/ before any changes;
 *   2) all corrections in one history step (one Cmd+Z);
 *   3) a check against the actual text before every write.
 *
 * This is NOT the only place that writes to the document: run_script (run.jsx) runs arbitrary
 * ExtendScript without a copy and without checks. The guarantees above apply only to this handler.
 */

IDMCP.oversetStoryIds = function (doc) {
    var ids = [];
    for (var i = 0; i < doc.stories.length; i++) {
        if (doc.stories[i].overflows) ids.push("story:" + i);
    }
    return ids;
};

/*
 * Discovered empirically on a live InDesign: the document has “typographer's
 * quotes” enabled (doc.textPreferences.typographersQuotes = true by default), and
 * InDesign SILENTLY replaces straight quotes with curly ones when writing text —
 * '"here"' lands in the document as '“here”'. This directly contradicts the spec's
 * constraint: quote and dash unification applies only to MATCHING, and what lands
 * in the document must be exactly what the corrector wrote in the `new` field (e.g.
 * inches 12" or a code fragment must stay straight).
 *
 * The flag lives on the DOCUMENT, not on the application: app.textPreferences sets
 * the value for NEW documents and does not affect one already open — verified with
 * a separate probe script (app.textPreferences.typographersQuotes = false did NOT
 * stop the substitution, doc.textPreferences.typographersQuotes = false did stop it).
 *
 * We turn it off for the duration of the write and restore it without fail — the same
 * approach as IDMCP.withNoInteraction and measurementUnit in _fixtures.jsx. This wrapper
 * must be called INSIDE the undo step (see the comment near the call site).
 */
IDMCP.withLiteralText = function (doc, fn) {
    var previous = doc.textPreferences.typographersQuotes;
    doc.textPreferences.typographersQuotes = false;
    try {
        return fn();
    } finally {
        doc.textPreferences.typographersQuotes = previous;
    }
};

/*
 * Discovered empirically on a live InDesign (the same class of surprise as
 * IDMCP.unwrapStyleRef in find.jsx): `characters.itemByRange(a, b).contents`
 * returns NOT a string, but an array with ONE string element — typeof "object",
 * constructor Array, length 1. Verified with a separate probe script both within
 * a single paragraph, and across one paragraph break, and across two, and on a range
 * with several character styles, and on a single character: every time an Array(1)
 * with the full range text inside. (For comparison: `story.texts[0].contents` —
 * an ordinary string.)
 *
 * Because of this, the direct `range.contents !== expectedOld` — comparing an array
 * to a string — is ALWAYS true, and the pre-write check would reject every single
 * correction, silently applying nothing (confirmed by running the integration tests
 * against the briefing's baseline code: applied=[], skipped=[{expected:"pomylka",
 * actual:"pomylka"}] — the texts are identical, yet the correction was skipped).
 *
 * We unwrap explicitly rather than relying on String(array): if InDesign ever
 * returns more than one element, joining with a comma would produce a nonsense string.
 * Any mismatch here is safe: it only leads to skipping the correction,
 * never to writing the wrong text.
 */
IDMCP.rangeText = function (range) {
    var raw = range.contents;
    if (raw instanceof Array) {
        return raw.length === 1 ? String(raw[0]) : raw.join("");
    }
    return String(raw);
};

/*
 * Checking all corrections BEFORE the backup copy and before the first write. A bad
 * containerId or a degenerate range in correction #5 would otherwise fail only after
 * corrections #1–4 were already written — leaving the document in a half-finished
 * state. Here, any structural defect stops everything before anything has changed.
 *
 * The range BOUNDS are checked separately. The most common form of "the document
 * changed after the plan was built" is the story having SHRUNK, in which case
 * characters.itemByRange(start, end - 1) throws instead of clamping. Since
 * orderForApply sorts by descending offset, such a correction is processed LAST
 * in the batch — meaning the exception would occur only after all the others were
 * already written. That's why out-of-bounds corrections don't throw but are
 * returned here as ready-made skipped records: the rest of the batch still lands
 * cleanly, and the user sees the reason.
 *
 * Returns a table "correction index -> skipped record" (empty if everything is fine).
 */
IDMCP.validateEdits = function (doc, edits) {
    var outOfRange = {};
    for (var i = 0; i < edits.length; i++) {
        var e = edits[i];
        if (e.action !== "replace" && e.action !== "delete" && e.action !== "insert") {
            throw new Error("Unknown edit action \"" + e.action + "\" (edit " + e.requestId + ").");
        }
        if (typeof e.start !== "number" || typeof e.end !== "number" || e.end <= e.start) {
            throw new Error(
                "Degenerate range in edit " + e.requestId + ": start=" + e.start + ", end=" + e.end +
                    " (expected end > start)."
            );
        }
        /* Throws a clear error on any invalid segment of containerId. */
        var container = IDMCP.resolveContainer(doc, e.containerId);

        /* e.end is exclusive, so e.end === length is still in bounds. */
        var length = container.characters.length;
        if (e.end > length) {
            outOfRange[i] = {
                requestId: e.requestId,
                candidateId: e.candidateId,
                reason: "The edit's range is out of the container's bounds — the text got shorter after the plan was built.",
                expected: e.expectedOld,
                actual: "the container has " + length + " characters, but the edit needs an end of " + e.end
            };
        }
    }
    return outOfRange;
};

/*
 * A copy name that is GUARANTEED not to overwrite anything. params.stamp has
 * minute precision, and two correction batches within the same minute are a
 * normal cadence when accepting small chunks. Without this check, the second
 * copy would silently overwrite the first, and the backupPath in the first
 * batch's report would point to a file that ALREADY contains the first batch's
 * corrections — i.e. a copy that doesn't actually save anything.
 */
IDMCP.uniqueBackupFile = function (backupDir, base, stamp) {
    var file = new File(backupDir.fsName + "/" + base + "_do-pravok_" + stamp + ".indd");
    var attempt = 2;
    while (file.exists) {
        if (attempt > 500) {
            throw new Error(
                "Could not find a free name for the backup copy in " + backupDir.fsName +
                    ". No edits were applied."
            );
        }
        file = new File(backupDir.fsName + "/" + base + "_do-pravok_" + stamp + "-" + attempt + ".indd");
        attempt++;
    }
    return file;
};

/*
 * A4, round 3 — coordinator's finding: the user keeps THEIR OWN files inside
 * _backups/, named manually with the same prefix ("<base>_do-pravok_..."), but
 * without our format's stamp — for example, "..._do-pravok_20260731-vychytka.indd"
 * (his own proofreading pass). The prefix alone isn't enough: such a file would get
 * deleted as soon as the auto-copies exceed keep. The stamp we generate ourselves
 * (backupStamp() in src/tools/corrections.ts) has EXACTLY the form "YYYY-MM-DD-HHMM",
 * plus an optional "-N" from IDMCP.uniqueBackupFile on a name collision. We check
 * this character by character (no regex — firstly, to be safely ES3-compatible,
 * secondly, "strict" reads more clearly here through explicit character positions
 * than through a pattern).
 */

/** Exactly "YYYY-MM-DD-HHMM" — a digit at every digit position, a hyphen at every hyphen position. */
IDMCP._isBackupStamp = function (s) {
    if (s.length !== 15) return false;
    var digitPositions = [0, 1, 2, 3, 5, 6, 8, 9, 11, 12, 13, 14];
    var dashPositions = [4, 7, 10];
    var i, code;
    for (i = 0; i < digitPositions.length; i++) {
        code = s.charCodeAt(digitPositions[i]);
        if (code < 48 || code > 57) return false; // not '0'..'9'
    }
    for (i = 0; i < dashPositions.length; i++) {
        if (s.charAt(dashPositions[i]) !== "-") return false;
    }
    return true;
};

/**
 * Whether name is a file that THIS tool itself created as a copy for base:
 * "<prefix><YYYY-MM-DD-HHMM>[-N].indd" — and nothing broader. Anything else under
 * the same prefix (the user's manual files) is not ours — never touch it.
 */
IDMCP.isOwnBackupName = function (name, prefix) {
    if (name.indexOf(prefix) !== 0) return false;

    var EXT = ".indd";
    if (name.length < prefix.length + EXT.length) return false;
    if (name.substr(name.length - EXT.length) !== EXT) return false;

    var body = name.substr(prefix.length, name.length - prefix.length - EXT.length);
    var STAMP_LEN = 15;
    if (body.length < STAMP_LEN) return false;

    if (!IDMCP._isBackupStamp(body.substr(0, STAMP_LEN))) return false;

    var tail = body.substr(STAMP_LEN);
    if (tail.length === 0) return true; // stamp without a collision tail — our file

    // Collision tail from uniqueBackupFile: exactly "-" followed by one or more digits.
    if (tail.charAt(0) !== "-") return false;
    var digits = tail.substr(1);
    if (digits.length === 0) return false;
    for (var k = 0; k < digits.length; k++) {
        var c = digits.charCodeAt(k);
        if (c < 48 || c > 57) return false;
    }
    return true;
};

/*
 * A4. Copies were accumulating without limit: every apply_edits call leaves another
 * 196-page file next to the document. We keep the KEEP most recent ones.
 *
 * The ExtendScript mask here is just "*.indd", without base: in the mask, only
 * "*" and "?" are special, so a literal "*" or "?" in the document name (macOS allows
 * this) would land in the mask as a stray wildcard and could pick up copies of
 * ANOTHER document. Whether a file belongs to THIS document and to OUR name format
 * is checked by IDMCP.isOwnBackupName in code, after the selection — special
 * characters in base are then harmless (indexOf compares literally), and other
 * people's files under the same prefix (the user's manual copies without our stamp)
 * never get deleted.
 */
IDMCP.rotateBackups = function (backupDir, base, keep) {
    var prefix = base + "_do-pravok_";
    var all = backupDir.getFiles("*.indd");
    if (!all) return 0;

    var matches = [];
    for (var i = 0; i < all.length; i++) {
        if (IDMCP.isOwnBackupName(all[i].name, prefix)) matches.push(all[i]);
    }
    if (matches.length <= keep) return 0;

    // Sort by modification time, newest first.
    matches.sort(function (a, b) { return b.modified.getTime() - a.modified.getTime(); });

    var removed = 0;
    for (var j = keep; j < matches.length; j++) {
        /*
         * A single file being synced by a cloud client (iCloud/Dropbox) or
         * locked by another process must not block cleanup of the rest:
         * .remove() on such a file can throw. We swallow it here — the
         * file stays put, and the next apply_edits call will try again.
         */
        try {
            if (matches[j].remove()) removed++;
        } catch (removeErr) {
            // Leave the file in place. Do not count it as removed.
        }
    }
    return removed;
};

IDMCP.handlers.apply_edits = function (params) {
    var doc = IDMCP.activeDoc();

    /*
     * Guard #0. The plan was built for a specific document; the one active in
     * InDesign could well be a different one — the user's real working layout.
     * We check this FIRST, before the copy and before any write.
     */
    if (!params.expectedDocName) {
        throw new Error(
            "apply_edits requires expectedDocName — the name of the document the plan was built for."
        );
    }
    if (doc.name !== params.expectedDocName) {
        throw new Error(
            "The active InDesign document is \"" + doc.name + "\", but the plan was built for \"" +
                params.expectedDocName + "\". Nothing was changed, no copy was made. " +
                "Make the right document active or rebuild the plan."
        );
    }

    if (!params.stamp) {
        throw new Error("apply_edits requires stamp — a timestamp for the backup file's name.");
    }

    if (!doc.saved) {
        throw new Error("The document hasn't been saved to disk yet. Save it so a backup copy can be made.");
    }

    var edits = params.edits || [];
    var tracking = params.tracking || [];

    /*
     * Guard #2 — the OUTERMOST wrapper around everything that touches the document.
     * It used to start only right before the corrections loop, leaving the call most
     * prone to dialogs — doc.saveACopy — as the one unprotected spot: saving a large
     * document is exactly where InDesign raises modal dialogs (modified or missing
     * links, font substitution, "file in use", volume permission). A modal there would
     * block osascript for the entire timeout, and the user would get an alarming message
     * about corrections possibly having been applied, for an operation that wrote nothing.
     */
    return IDMCP.withNoInteraction(function () {
        /*
         * A2. The heartbeat covers EVERYTHING that touches the document — and that's
         * exactly why it is the OUTERMOST one, not started just before the corrections loop.
         *
         * WHY THIS WAS MOVED (Phase 3, W2; the flaw was inherited from A2). Previously the
         * trace was written AFTER doc.saveACopy. On a 196-page book in a cloud folder,
         * copying takes many seconds and is the handler's longest operation — exactly the
         * window where osascript is most likely to be killed by timeout. If that happened,
         * the script INSIDE InDesign was not interrupted: it finished writing the copy and
         * went on to write the corrections. But no trace existed yet, so the next call's
         * assertNoLiveWrite saw nothing and let a SECOND write start on top of the still-live
         * first one — exactly the trap the heartbeat exists to prevent.
         *
         * WHAT REMAINS UNCLOSED (fixed in round 2 of the final review — the previous text
         * of this comment was stale and contradicted the comment below, at `touch("edits")`:
         * that one describes the extended bound of the "copy" phase, while this one still
         * claimed the bound was 20 seconds everywhere). The EXTENSION (`heartbeat.ts`,
         * `isStale`) closes one specific case: a SECOND call arrives while the first is still
         * writing its trace with phase "copy", and no more than `copyPhaseStaleMs` has elapsed
         * from the START of the first call to this second one — that bound is `APPLY_TIMEOUT_MS`
         * (180 s), passed in by the caller (`envelope.ts`, `runWrite`) as the staleness bound
         * for the "copy" phase. This protects against a parallel or quick repeat call arriving
         * while the first is still clearly within its own timeout.
         *
         * CLOSED 2026-08-05 with the `COPY_PHASE_SLACK` multiplier (`heartbeat.ts`).
         * This used to describe a gap: a natural retry call arrives AFTER the first call's
         * client has given up on its `timeoutMs` (the same APPLY_TIMEOUT_MS), and at that
         * point the first call's trace has an age ≈ that same `copyPhaseStaleMs` bound — i.e.
         * right at the `isStale` threshold. If `doc.saveACopy` for this document takes longer
         * than 180 s (a large book on a slow or cloud volume), the retry call would consider
         * the trace stale and start a SECOND write on top of the still-live first one. The
         * symmetry "retry bound = original timeout" looked tidy, but it meant the guard failed
         * exactly when it was most needed.
         *
         * Now the bound of the "copy" phase = `APPLY_TIMEOUT_MS × COPY_PHASE_SLACK`
         * (180 s × 4 = 12 min), i.e. the trace stays valid for a while even after the client
         * has given up. WHAT'S STILL NOT CLOSED: a copy longer than 12 min creates the same
         * gap — and it sometimes cannot be closed at all in principle, because the trace only
         * carries an age, not a "process is alive" flag. The cost of the multiplier is named
         * right there: after a truly dead script (an InDesign crash that prevented `finally`
         * from running), the write stays locked for up to 12 min, and that's exactly why the
         * `assertNoLiveWrite` message names the trace's path and states outright that it can
         * be deleted.
         */
        return IDMCP.withHeartbeat(params.heartbeatPath, "apply_edits", doc.name, function (touch) {
            var outOfRange = IDMCP.validateEdits(doc, edits);

            /* Guard #1: the copy is made before any changes and outside the undo step. */
            var docFile = doc.fullName;
            var backupDir = new Folder(docFile.parent.fsName + "/_backups");
            if (!backupDir.exists && !backupDir.create()) {
                throw new Error("Could not create the backups folder: " + backupDir.fsName + ". No edits were applied.");
            }

            var base = doc.name.replace(/\.indd$/i, "");
            var backupFile = IDMCP.uniqueBackupFile(backupDir, base, params.stamp);
            doc.saveACopy(backupFile);
            /*
             * The longest operation is behind us — update the trace immediately, so the
             * next steps start from a fresh one, not an almost-stale one.
             *
             * THIS IS THE PHASE TRANSITION (Phase 3, W2, round 2): up to this line the trace
             * carried "copy" (written even before this function started, in
             * IDMCP.withHeartbeat) — and the MCP side was entitled to wait on it longer
             * than the usual 20 s, because this is exactly the handler's one operation
             * during which there is nothing to touch the file with. From this point to the
             * end of the handler, touches happen at the usual cadence of the corrections
             * loop, so the phase switches to "edits" ONCE AND FOR ALL — no touch below
             * (rotation, each correction, each tracking update) passes the argument again.
             */
            touch("edits");
            /* A copy without verification is not a guard, it's a hope. */
            if (!backupFile.exists) {
                throw new Error("The document copy was not created: " + backupFile.fsName + ". No edits were applied.");
            }

            /*
             * Coordinator's finding (A4, round 2): cosmetic cleanup of old copies must
             * not be allowed to break an already-valid batch of corrections. This run's
             * copy is already created and verified — if the rotation fails (an unexpected
             * object from getFiles without .modified, or anything else outside the inner
             * try/catch around .remove()), the corrections still need to land exactly as
             * they would without rotation. We carry the failure into the report rather than
             * swallow it silently.
             */
            var rotated = 0;
            var backupRotationError = null;
            try {
                rotated = IDMCP.rotateBackups(backupDir, base, 10);
            } catch (rotateErr) {
                backupRotationError = String(rotateErr.message || rotateErr);
            }
            touch();

            var pageCountBefore = doc.pages.length;
            var oversetBefore = IDMCP.oversetStoryIds(doc);

            /*
             * report is one shared object, not separate applied/skipped/failed: if
             * withUndo throws, this is the same object we return with fatalError —
             * with applied/skipped/failed already accumulated up to the point of failure.
             */
            var report = {
                backupPath: backupFile.fsName,
                backupsRemoved: rotated,
                backupRotationError: backupRotationError,
                applied: [],
                skipped: [],
                failed: [],
                /*
                 * Phase 3, W2. Both arrays are declared HERE, together with the rest of
                 * the report, and not inside the history step: if withUndo throws, this
                 * same object is returned with fatalError, and the consumer must see the
                 * fields, not undefined.
                 */
                trackingApplied: [],
                trackingFailed: [],
                oversetBefore: oversetBefore,
                oversetAfter: [],
                pageCountBefore: pageCountBefore,
                pageCountAfter: pageCountBefore
            };

            try {
                /*
                 * Guard #3 — and it's exactly INSIDE it that the typographer's quotes
                 * are toggled.
                 *
                 * The order here isn't cosmetic. At first withLiteralText stood outside
                 * withUndo — "so that only text corrections land in the history step".
                 * It turned out to be the opposite: changing doc.textPreferences itself
                 * lands in the history as separate steps, so the batch stopped being one
                 * step — the first Cmd+Z undid the flag restoration, not the corrections
                 * (the test "a single undo rolls back the whole second batch" caught this).
                 * Inside doScript(ENTIRE_SCRIPT), the toggling, the restoration, and all
                 * the corrections merge into a single step.
                 */
                IDMCP.withUndo(params.undoName || "Proofreader's edits", function () {
                    IDMCP.withLiteralText(doc, function () {
                        for (var i = 0; i < edits.length; i++) {
                            var e = edits[i];

                            /*
                             * Once per correction — with a margin against HEARTBEAT_STALE_MS
                             * even on the slowest write, and regardless of whether the
                             * correction was applied, skipped, or failed: the continue below
                             * must not skip the touch, otherwise a run of skips could let
                             * the heartbeat go stale.
                             */
                            touch();

                            /* An out-of-bounds correction — already a ready-made skipped record from the pre-pass. */
                            if (outOfRange[i]) {
                                report.skipped.push(outOfRange[i]);
                                continue;
                            }

                            /*
                             * Each correction is in its own try. A realistic exception in the
                             * middle of a batch (a locked layer, a locked story, a frame on a
                             * locked master page) would otherwise destroy the ENTIRE report:
                             * corrections 1..k would remain written, but the user would get
                             * only the ExtendScript error text — without backupPath and without
                             * a list of what had managed to land.
                             */
                            try {
                                var container = IDMCP.resolveContainer(doc, e.containerId);
                                var range = container.characters.itemByRange(e.start, e.end - 1);

                                /*
                                 * Guard #4. Also applies to insert: there [start, end) is the
                                 * ANCHOR TEXT after which we insert. If the anchor in the document
                                 * changed after the plan was built, the insertion would land in the
                                 * wrong place, so insert is checked the same way as replace and delete.
                                 */
                                var actual = IDMCP.rangeText(range);
                                if (actual !== e.expectedOld) {
                                    report.skipped.push({
                                        requestId: e.requestId,
                                        candidateId: e.candidateId,
                                        reason: "The text in the document changed after the plan was built.",
                                        expected: e.expectedOld,
                                        actual: actual.substr(0, 120)
                                    });
                                    continue;
                                }

                                if (e.action === "insert") {
                                    /*
                                     * Insertion is the only action that does NOT change its own anchor:
                                     * after inserting " (vstavka)" after "Ukrainy" the anchor still
                                     * reads as "Ukrainy", so the check above cannot, by construction,
                                     * prevent a repeat run of the same plan, and the text would get
                                     * duplicated. That's why we separately check whether the new text
                                     * is ALREADY sitting right after the anchor.
                                     */
                                    if (IDMCP.insertAlreadyThere(container, e)) {
                                        report.skipped.push({
                                            requestId: e.requestId,
                                            candidateId: e.candidateId,
                                            reason: "The insertion is already applied: this text already sits right after the anchor.",
                                            expected: e.expectedOld,
                                            actual: actual.substr(0, 120)
                                        });
                                        continue;
                                    }
                                    /* insertionPoints[end] — the position right AFTER the anchor's last character. */
                                    container.insertionPoints[e.end].contents = e.newText;
                                } else if (e.action === "delete") {
                                    range.remove();
                                } else {
                                    range.contents = e.newText;
                                }
                                report.applied.push({ requestId: e.requestId, candidateId: e.candidateId });
                            } catch (writeErr) {
                                report.failed.push({
                                    requestId: e.requestId,
                                    candidateId: e.candidateId,
                                    reason: String(writeErr.message || writeErr)
                                });
                            }
                        }

                        /*
                         * PARAGRAPH TRACKING (Phase 3, W2) — the only genuinely new phase record.
                         *
                         * WHY HERE, AND NOT A SEPARATE HANDLER. Two handlers would mean two
                         * history steps: the first Cmd+Z would roll back only half the batch,
                         * and the guarantee "one batch — one undo" would stop holding exactly
                         * when it's needed most. That's why tracking lives inside the same
                         * withUndo (and the same withLiteralText, which doesn't affect tracking
                         * but doesn't get in its way either).
                         *
                         * AFTER the text corrections, and this matters: the tracking address is
                         * a PARAGRAPH INDEX, not a character offset. Text corrections shift
                         * characters, but paragraph numbering only changes when a paragraph-end
                         * mark appears or disappears. `composition_apply` never produces such
                         * corrections at all (its invisible mark is replacing a word fragment
                         * with "U+00AD + the same fragment"), but a caller who mixes a "\r"
                         * deletion and tracking into one batch will get a shifted address. This
                         * is a limitation of the handler, and it's stated, not swept under the rug.
                         *
                         * `para.tracking = para.tracking + delta` ADDS the delta. Two corrections
                         * on the same paragraph would double it, so deduplication by the pair
                         * (container, paragraph) is the caller's responsibility (see the comment
                         * on `proposeFixes`, "Invariant 1").
                         */
                        for (var t = 0; t < tracking.length; t++) {
                            /* The same margin against a stale heartbeat as in the corrections
                             * loop: a run of failed tracking updates must not leave the file untouched. */
                            touch();

                            var item = tracking[t];
                            try {
                                if (typeof item.delta !== "number" || isNaN(item.delta)) {
                                    throw new Error(
                                        "delta must be a number, but got \"" + String(item.delta) +
                                            "\". Adding a non-number to tracking would silently corrupt the paragraph."
                                    );
                                }
                                var trackContainer = IDMCP.resolveContainer(doc, item.containerId);
                                if (item.paragraphIndex < 0 || item.paragraphIndex >= trackContainer.paragraphs.length) {
                                    throw new Error(
                                        "The container has " + trackContainer.paragraphs.length +
                                            " paragraphs, but tracking was requested for paragraph " + item.paragraphIndex + "."
                                    );
                                }
                                var para = trackContainer.paragraphs[item.paragraphIndex];
                                var current = para.tracking;
                                /*
                                 * For mixed tracking within a paragraph, InDesign returns NothingEnum,
                                 * not a number. `NothingEnum + 20` would give not 20, but garbage,
                                 * and it would land in the document silently — exactly the class of
                                 * substitution that numberOrNull in the measurement layer guards against.
                                 */
                                if (typeof current !== "number" || isNaN(current)) {
                                    throw new Error(
                                        "The paragraph's tracking is mixed (InDesign returned \"" + String(current) +
                                            "\"), so there's nothing to add the delta to. Align the paragraph's tracking manually."
                                    );
                                }
                                para.tracking = current + item.delta;
                                report.trackingApplied.push({
                                    containerId: item.containerId,
                                    paragraphIndex: item.paragraphIndex,
                                    delta: item.delta,
                                    trackingBefore: current,
                                    trackingAfter: para.tracking
                                });
                            } catch (eTrack) {
                                report.trackingFailed.push({
                                    containerId: item.containerId,
                                    paragraphIndex: item.paragraphIndex,
                                    delta: item.delta,
                                    reason: String(eTrack.message || eTrack)
                                });
                            }
                        }
                    });
                });

                /*
                 * Deliberately INSIDE the try: if withUndo threw, these reads of
                 * doc could themselves fail (the document in an unpredictable state),
                 * and report.oversetAfter/pageCountAfter should stay at their "before
                 * corrections" placeholders (report.oversetBefore/report.pageCountBefore),
                 * rather than risk another exception that would overwrite the fatalError
                 * already collected.
                 */
                report.oversetAfter = IDMCP.oversetStoryIds(doc);
                report.pageCountAfter = doc.pages.length;
            } catch (e) {
                /* The copy already exists — we return a report with its path instead of throwing
                 * an exception in which backupPath isn't visible. */
                report.fatalError = String(e);
            }

            return report;
        });
    });
};

/*
 * Whether newText is already sitting right after the anchor [start, end). There's
 * no point inserting an empty newText, so it is always considered "not applied" —
 * otherwise every empty insertion would report as a duplicate.
 */
IDMCP.insertAlreadyThere = function (container, e) {
    if (!e.newText || e.newText.length === 0) return false;
    var tailEnd = e.end + e.newText.length;
    if (tailEnd > container.characters.length) return false;
    return IDMCP.rangeText(container.characters.itemByRange(e.end, tailEnd - 1)) === e.newText;
};

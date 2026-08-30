/*
 * Handlers that create reproducible test documents. They live separately
 * from the working handlers and carry a __ prefix so they can't be confused
 * with them.
 */
IDMCP.handlers.__fixture_make = function () {
    /*
     * app.scriptPreferences.measurementUnit defaults to AUTO_VALUE —
     * meaning bare numbers in geometricBounds are interpreted in the ruler
     * units of the NEW document, not in points. In this environment a new
     * document's default ruler unit is picas (1 pica = 12pt), so [20,20,30,60]
     * without this fix creates a 120×480pt frame — huge — and the intentional
     * overset in f2 simply never happens. We temporarily pin POINTS and
     * restore the previous value in finally, so this isn't a lasting change to
     * the app's settings (the same approach as IDMCP.withNoInteraction).
     */
    var previousUnit = app.scriptPreferences.measurementUnit;
    app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;
    var doc = null;
    try {
        doc = app.documents.add();
        doc.documentPreferences.pagesPerDocument = 2;

        var para = doc.paragraphStyles.add({ name: "Osnovnyi" });
        var vydilennia = doc.characterStyles.add({ name: "Vydilennia" });
        var zaholovok = doc.paragraphStyles.add({ name: "Zaholovok" });

        var f1 = doc.pages[0].textFrames.add();
        f1.geometricBounds = [20, 20, 120, 180];
        f1.contents = "Kyiv — stolytsia Ukrainy. Cei tekst mistyt slovo pomylka dlia testu.";
        f1.texts[0].appliedParagraphStyle = para;

        var f2 = doc.pages[1].textFrames.add();
        f2.geometricBounds = [20, 20, 30, 60];
        f2.contents = "Druhyi potik tekstu, iakyi navmysno ne vlizaie u ramku i daie overset.";

        /* A table and a footnote — separate text streams whose content is NOT part
         * of story.characters. We add them to f1 so containers_read actually
         * exercises these branches (table:/cell:, footnote:), not just compiles
         * without ever running them.
         */
        var table = f1.insertionPoints[-1].tables.add(LocationOptions.AT_END, undefined, {
            bodyRowCount: 1,
            columnCount: 1
        });
        table.rows[0].cells[0].texts[0].contents = "Yacheika tablytsi.";

        f1.insertionPoints[-1].footnotes.add().texts[0].contents = "Tekst vynosky.";

        /*
         * Task 7, review fix round 1 (Important 2): a separate story with a boundary
         * BETWEEN TWO paragraph styles and a character-style boundary inside the
         * second paragraph — so ranges_inspect can be tested on a range that
         * genuinely spans several different styles, not just one. Deliberately a
         * separate frame f3 (it doesn't touch the text of f1/f2, whose exact
         * content and length the Task 6 checks in inspect.test.ts rely on) —
         * because none of those checks read styling, only offsets.
         */
        var f3 = doc.pages[0].textFrames.add();
        f3.geometricBounds = [140, 20, 260, 400];
        f3.contents = "Zaholovok rozdilu.\rOsnovnyi tekst rozdilu z vydilenniam.";
        f3.paragraphs[0].appliedParagraphStyle = zaholovok;
        f3.paragraphs[1].appliedParagraphStyle = para;
        var vydStart = f3.contents.indexOf("vydilenniam");
        var vydEnd = vydStart + "vydilenniam".length - 1;
        f3.characters.itemByRange(vydStart, vydEnd).appliedCharacterStyle = vydilennia;

        /*
         * Task 6, edit round. Until now the fixture had NEITHER chained frames NOR
         * rotated frames, so three things in composition_measure went completely
         * unchecked: isFirstInFrame/isLastInFrame (without a chain, every line is
         * trivially both first and last), a paragraph broken across frames, and a
         * hyphenation break inserted by the composer.
         *
         * f4 -> f5: a narrow justified column with hyphenation enabled. Latin-script
         * text with long words — so the composer is forced to hyphenate; the
         * resulting line — «слово розірване» — is caught by the "letter + letter"
         * rule. Deliberately WITHOUT the word "pomylka", straight quotes, or
         * trailing spaces: find.test.ts and typography.test.ts rely on those being
         * absent.
         */
        var f4 = doc.pages[1].textFrames.add();
        f4.geometricBounds = [40, 20, 110, 130];
        var f5 = doc.pages[1].textFrames.add();
        f5.geometricBounds = [130, 20, 300, 130];
        f4.nextTextFrame = f5;
        f4.contents =
            "Considerable international communication requires extraordinary " +
            "responsibility and uncompromising professional determination from " +
            "every participating organization worldwide.";
        f4.texts[0].appliedParagraphStyle = para;
        f4.texts[0].justification = Justification.LEFT_JUSTIFIED;
        f4.texts[0].hyphenation = true;

        /*
         * f6 — a rotated frame, modeling a running head. The real book has 111
         * such lines, each with line.horizontalOffset === endHorizontalOffset,
         * i.e. zero width, while geometricBounds is an axis-aligned bounding box.
         * Without this frame there would be nothing to catch a regression on
         * rotated frames.
         */
        var f6 = doc.pages[1].textFrames.add();
        f6.geometricBounds = [40, 200, 60, 350];
        f6.contents = "Kolontytul povernutyi";
        f6.rotationAngle = -90;

        /*
         * Phase 9: states for spelling_audit. Without them the whole phase would be
         * tested against empty ground — the Phase 5 rule that got stepped on here
         * at least twice.
         *
         * A SEPARATE frame and story (f7), NOT appended to f1 (doc.stories[0]) —
         * a review-round-1 fix. The first version appended these states to the end
         * of f1 via insertionPoints[-1], and in doing so silently broke ANOTHER,
         * already-existing test from three earlier phases: inspect.test.ts:181
         * checks f1's story.text.length literally (BASE_TEXT_1.length + 2 — the
         * base sentence plus the table and footnote anchors); the 77 new characters
         * of the four states would have made that length 147 instead of 70. The
         * lesson is the same one already spelled out in this very task's briefing:
         * a test that stays green on a fixture missing the needed state proves
         * nothing — here it happened in mirror image: a CORRECT test broke
         * silently because the shared fixture shifted underneath it. A separate
         * story doesn't touch any assumption the other tasks already rest on f1,
         * and it's more honest in substance too — these four states belong to
         * Phase 9, not to the frame shared by the three phases before it.
         */
        var f7 = doc.pages[1].textFrames.add();
        f7.geometricBounds = [340, 20, 600, 400];

        /*
         * 1. a [No Language] range WITH WORDS — the measured case on p. 31: 520
         * characters of prose with no spelling or hyphenation check. The first
         * entry into a freshly created empty story — with no leading "\r": the
         * separators below sit BETWEEN states, not before the first one.
         */
        f7.contents = "Текст без жодної мови на діапазоні.";
        f7.characters.itemByRange(0, f7.characters.length - 1).appliedLanguage = "[No Language]";

        /*
         * 2. a foreign language WITH WORDS — a legitimate insertion (a quote, a
         * parallel translation), not a defect: the detector must give ZERO
         * findings on this range and surface it only in the language inventory.
         */
        f7.insertionPoints[-1].contents = "\rSome English words here.";
        f7.characters.itemByRange(
            f7.characters.length - 24, f7.characters.length - 1
        ).appliedLanguage = "English: USA";

        /*
         * 3. a foreign language WITHOUT words — the measured case on p. 66: a
         * single paragraph mark tagged as Vietnamese. The language is applied
         * ONLY to the "\r" character itself (characters[-1] at the moment of this
         * call — still BEFORE state 4 is inserted), not to any word: language-stray
         * looks at a language's weight across the WHOLE document, so the next
         * state deliberately does NOT inherit this language (see the comment
         * below).
         */
        f7.insertionPoints[-1].contents = "\r";
        f7.characters[-1].appliedLanguage = "Vietnamese";

        /*
         * 4. a word outside the dictionary. The text added right after the
         * Vietnamese "\r" was EMPIRICALLY CONFIRMED (not inferred from the docs)
         * — by a separate one-off probe on live InDesign (an isolated document,
         * created and immediately closed, indesign_run_jsx outside this file): new
         * text inherits the appliedLanguage of the character BEFORE the insertion
         * point, including the "\r" character itself. Without an explicit
         * reassignment, "жабуринка тут." would have become VIETNAMESE with words,
         * and then language-stray for Vietnamese (state 3) would disappear,
         * because the language would no longer be "a stray with no words anywhere
         * in the document". So here the language is explicitly set back to
         * Ukrainian — not left as inherited.
         */
        f7.insertionPoints[-1].contents = "\rжабуринка тут.";
        f7.characters.itemByRange(
            f7.characters.length - 14, f7.characters.length - 1
        ).appliedLanguage = "Ukrainian";

        /*
         * Phase 11: states for the 2019 orthography. A SEPARATE frame and story
         * (f8) — the same lesson already noted at f7: appending to an existing
         * story would shift the lengths that the checks from the three earlier
         * phases rely on. Its bounding box sits below f7 ([340..600]) and fits
         * within the default page (Letter 612×792 pt and A4 595×842 pt — 760 is
         * less than both).
         */
        var f8 = doc.pages[1].textFrames.add();
        f8.geometricBounds = [610, 20, 760, 400];

        /*
         * 1. Ukrainian: pre-reform forms for all three rules, plus the ефір/етер
         *    pair in BOTH forms.
         */
        f8.contents = "Проект і веб-сайт, священик, ефір і етер.";
        f8.characters.itemByRange(0, f8.characters.length - 1).appliedLanguage = "Ukrainian";

        /*
         * 2. a match ON THE LANGUAGE BOUNDARY. New text inherits the language of
         *    the character BEFORE the insertion point (measured in Phase 9,
         *    comment at f7), i.e. here — Ukrainian; then exactly ONE character
         *    inside the word «проект» is reassigned to English. The rule's match
         *    («прое») now crosses the language boundary and must be REJECTED, not
         *    applied. Indices from the end: "\rпроект mezha." — «.» is -1, the
         *    word's «е» is -10.
         */
        f8.insertionPoints[-1].contents = "\rпроект mezha.";
        f8.characters[-10].appliedLanguage = "English: USA";

        /*
         * 3. a pre-reform form inside a FOREIGN-LANGUAGE range: «проект» is a
         *    correct Russian word, the rule must not touch it. "Русский проект
         *    здесь." — 21 characters.
         */
        f8.insertionPoints[-1].contents = "\rРусский проект здесь.";
        f8.characters.itemByRange(
            f8.characters.length - 21, f8.characters.length - 1
        ).appliedLanguage = "Russian";

        /*
         * Task 7 (Phase 12): states for the «пів» family (piv2019). The LAST frame
         * in __fixture_make — the same lesson already noted twice above at f7 and
         * f8: containers_read/language_runs_read produce a containerId of the form
         * "story:N" from the story's INDEX in doc.stories, so inserting anywhere
         * but the end would renumber f1..f8 and break the tests of other tasks
         * that rely on those numbers.
         *
         * f9 is on a REGULAR page (doc.pages[1]) and carries all FOUR spellings:
         * solid («півгодини», «півострова»), separate («пів року», «пів яблука»,
         * «пів години», «пів острова»), apostrophe («пів яблука» typed as «пів'
         * яблука»), and hyphen («пів-Києва»). The real book (measured) contains
         * not a single pre-reform mark — so the apostrophe and hyphen forms are
         * checked here the ONE time in the entire codebase.
         */
        var f9 = doc.pages[1].textFrames.add();
        f9.geometricBounds = [610, 420, 760, 592];
        f9.contents =
            "За півгодини все змінилось. Ми пройшли пів року разом, з'їли пів яблука " +
            "і побачили пів'яблука ще раз. Дорога на пів-Києва зайняла пів години. " +
            "Мешканці півострова знають пів острова напам'ять.";
        f9.characters.itemByRange(0, f9.characters.length - 1).appliedLanguage = "Ukrainian";

        /*
         * A separate frame ON THE MASTER — proof that isMaster filters the «пів»
         * family the same way it filters all the others (piv2019.ts:
         * `if (c.isMaster) continue;`). Without this frame, a mutant that removes
         * this filter passes every test green: the fixture simply has no master
         * text that could leak into the report.
         *
         * doc.masterSpreads[0] is the master that `app.documents.add()` already
         * creates on its own (no new master is added here — unlike
         * __fixture_make_layout, this is a completely different document, and
         * there is no master named "L" here at all). The «master» root NEVER
         * OCCURS anywhere else in the fixture — which is exactly why the test can
         * prove its absence by the root itself, not merely by a finding count.
         */
        var fMaster = doc.masterSpreads[0].pages[0].textFrames.add();
        fMaster.geometricBounds = [20, 20, 40, 200];
        fMaster.contents = "Колонтитул: пів-майстра";
        fMaster.characters.itemByRange(
            0, fMaster.characters.length - 1
        ).appliedLanguage = "Ukrainian";

        return doc.name;
    } catch (e) {
        /*
         * If something inside fails AFTER app.documents.add(), the document is
         * left open and orphaned: the call never returned doc.name, so the TS side
         * (afterAll in the test) has no idea what to close. We close it right
         * here, while we still hold a direct reference to the object, and only
         * then rethrow the error.
         */
        if (doc) {
            try {
                doc.close(SaveOptions.NO);
            } catch (closeErr) {
                /* Навіть якщо закрити не вдалося — не ховаємо оригінальну помилку. */
            }
        }
        throw e;
    } finally {
        app.scriptPreferences.measurementUnit = previousUnit;
    }
};

/*
 * Closes ONLY the document named params.name — and only if the name
 * genuinely matches. No "close all" or "close the active one": the user
 * may have a real working document open, and this function has no right
 * to touch it.
 */
IDMCP.handlers.__fixture_close = function (params) {
    for (var i = app.documents.length - 1; i >= 0; i--) {
        if (app.documents[i].name === params.name) {
            app.documents[i].close(SaveOptions.NO);
        }
    }
    return true;
};

/*
 * Closes a document BY FULL PATH rather than by name — and this isn't a
 * duplicate of the handler above, it's exactly what that one is missing.
 *
 * A NAME IS NOT AN IDENTITY. `pagination-fixture.indd` is created by EACH
 * of the four test files — in its own temp folder, under the same file
 * name. So `__fixture_close` by name either hits some other fixture that
 * happens to share the name, or (when the caller doesn't know the name at
 * all) hits nothing. Cleaning up an ABANDONED document must name exactly
 * one document — the one whose path matches.
 *
 * We compare `String(doc.fullName)` — this is the exact form the path
 * takes when it comes back from the `status` handler (`inspect.jsx`),
 * which is how the caller learned about the leftover document in the
 * first place. Comparing against `fsName` would diverge from it on any
 * path with non-ASCII characters.
 *
 * `paths` is an array because on macOS a temp folder from mkdtemp has two
 * equally valid spellings (`/var/folders/…` and `/private/var/folders/…`;
 * measured 2026-08-16: InDesign returns the SECOND, while `mkdtemp`
 * returns the FIRST). The caller passes both instead of guessing.
 *
 * An unsaved document is explicitly skipped: it has no `fullName` path to
 * describe it.
 */
IDMCP.handlers.__fixture_close_path = function (params) {
    var paths = params && params.paths ? params.paths : [];
    var closed = [];
    for (var i = app.documents.length - 1; i >= 0; i--) {
        var doc = app.documents[i];
        if (!doc.saved) continue;
        if (IDMCP.indexOf(paths, String(doc.fullName)) === -1) continue;
        closed.push({ name: doc.name, path: String(doc.fullName) });
        doc.close(SaveOptions.NO);
    }
    return { closed: closed };
};

/*
 * A content signature of the document — proof that `layout_measure` is
 * read-only (Task 3, review fix round 1, Important 1, FINAL version).
 *
 * `document.modified` doesn't work for this in either direction — measured
 * and documented twice in a row: `app.documents.add()` gives
 * `modified === false`, but that flips irreversibly the moment the first
 * edit happens (even adding an EMPTY frame with no content), while
 * `doc.modified = false` throws an error ("read only property"). So on a
 * fixture that's already "dirty" (it builds its own master spread/
 * styles/frames before the first test runs), `modified` stays `true`
 * regardless of whether `layout_measure` itself writes anything — a test
 * on this flag could NEVER fail, no matter what the code does. And even
 * on a clean base it's a monotonic flag: it only says "something touched
 * the document", not "what exactly".
 *
 * The signature instead says WHAT EXACTLY stayed unchanged — precisely
 * what `layout_measure` would have corrupted if it wrote:
 *   - the count of pages/stories/frames;
 *   - for pages: `appliedMaster` (name, or an empty string if none) and
 *     the `masterPageItems` count;
 *   - for each frame: `.label` — a property `layout_measure` NEVER reads
 *     or returns, so a write specifically to `.label` (the demonstration
 *     mutant from the coordinator's brief) would diverge here even
 *     without showing up in `layout_measure`'s own output at all;
 *   - for the first few paragraphs: `appliedParagraphStyle.name`,
 *     `firstLineIndent`, `pointSize`, `contents`.
 *
 * DELIBERATELY does not call layout_measure and does not reuse its logic
 * — an independent traversal of the same document collections
 * (`doc.pages`, `doc.stories`), but with its own code: checking
 * "layout_measure against itself" (two matching but equally wrong
 * answers) would prove nothing if it consistently read something other
 * than what's actually in the document.
 */
IDMCP.handlers.__fixture_signature = function (params) {
    var doc = IDMCP.activeDoc();
    var paragraphLimit = (params && typeof params.paragraphLimit === "number") ? params.paragraphLimit : 8;

    var pages = [];
    for (var i = 0; i < doc.pages.length; i++) {
        var pg = doc.pages[i];
        var master = pg.appliedMaster;
        pages.push({
            name: String(pg.name),
            master: (master && master.isValid) ? String(master.name) : "",
            masterItemCount: pg.masterPageItems.length
        });
    }

    var frames = [];
    for (var s = 0; s < doc.stories.length; s++) {
        var containers = doc.stories[s].textContainers;
        for (var c = 0; c < containers.length; c++) {
            frames.push({ id: String(containers[c].id), label: String(containers[c].label) });
        }
    }

    var paragraphs = [];
    var count = 0;
    for (var s2 = 0; s2 < doc.stories.length && count < paragraphLimit; s2++) {
        var paras = doc.stories[s2].paragraphs;
        for (var p = 0; p < paras.length && count < paragraphLimit; p++) {
            var par = paras[p];
            paragraphs.push({
                containerId: "story:" + s2,
                paragraphIndex: p,
                styleName: String(par.appliedParagraphStyle.name),
                firstLineIndent: (typeof par.firstLineIndent === "number") ? par.firstLineIndent : null,
                pointSize: (typeof par.pointSize === "number") ? par.pointSize : null,
                contents: String(par.contents)
            });
            count++;
        }
    }

    return {
        pageCount: doc.pages.length,
        storyCount: doc.stories.length,
        frameCount: frames.length,
        pages: pages,
        frames: frames,
        paragraphs: paragraphs
    };
};

/*
 * Fixture for Task 8: a document SAVED to disk — without a file on disk,
 * apply_edits can't make a backup and refuses to run. Content deliberately
 * matches __fixture_make (the same em-dash sentence and the same second,
 * overset-producing stream), so offsets can be checked against a literal
 * string in the test.
 *
 * We pin the measurement unit to POINTS for the same reason as in
 * __fixture_make: the new document's ruler unit here is picas, and
 * without this the intentional overset in the second frame simply never
 * happens.
 */
IDMCP.handlers.__fixture_make_saved = function (params) {
    var previousUnit = app.scriptPreferences.measurementUnit;
    app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;
    var doc = null;
    try {
        doc = app.documents.add();
        doc.documentPreferences.pagesPerDocument = 1;
        doc.paragraphStyles.add({ name: "Osnovnyi" });

        var f1 = doc.pages[0].textFrames.add();
        f1.geometricBounds = [20, 20, 120, 400];
        f1.contents = "Kyiv — stolytsia Ukrainy. Cei tekst mistyt slovo pomylka dlia testu.";

        var f2 = doc.pages[0].textFrames.add();
        f2.geometricBounds = [140, 20, 152, 80];
        f2.contents = "Druhyi potik tekstu, iakyi navmysno ne vlizaie u ramku i daie overset.";

        /*
         * A separate third frame with a table and a footnote. Deliberately
         * SEPARATE from f1: table and footnote anchors add characters to their
         * own story's text, and the Task 8 tests check f1's text against the
         * literal BASE_TEXT_1 for exact equality. Here they produce a third story,
         * on which WRITING into a table cell and into a footnote is checked — the
         * one write branch that would otherwise be left uncovered by a live
         * test.
         */
        var f3 = doc.pages[0].textFrames.add();
        f3.geometricBounds = [170, 20, 300, 400];
        f3.contents = "Tretii potik dlia tablytsi ta vynosky.";

        var table = f3.insertionPoints[-1].tables.add(LocationOptions.AT_END, undefined, {
            bodyRowCount: 1,
            columnCount: 1
        });
        table.rows[0].cells[0].texts[0].contents = "Yacheika z opecatka vseredyni.";

        f3.insertionPoints[-1].footnotes.add().texts[0].contents = "Vynoska z opecatka vseredyni.";

        doc.save(new File(params.dir + "/fixture.indd"));
        return doc.name;
    } catch (e) {
        /*
         * Same reason as in __fixture_make: if it fails after
         * app.documents.add(), the caller never gets the document's name and
         * won't know what to close — we close it here, while we still hold a
         * direct reference.
         */
        if (doc) {
            try {
                doc.close(SaveOptions.NO);
            } catch (closeErr) {
                /* Не ховаємо оригінальну помилку. */
            }
        }
        throw e;
    } finally {
        app.scriptPreferences.measurementUnit = previousUnit;
    }
};

/*
 * Phase 3 fixture, W2: a document SAVED to disk (without a file,
 * apply_edits makes no copies and refuses to write) and deliberately
 * built so it GENUINELY carries the typesetting defects that Task 14
 * fixes and re-measures.
 *
 * WHY A SEPARATE FIXTURE, NOT AN EXTENSION OF __fixture_make_saved: that
 * fixture's text is checked in the Task 8 tests for EXACT equality
 * against literals (BASE_TEXT_1/BASE_TEXT_2 in corrections.test.ts), so
 * any addition there would break the proof of apply_edits's backward
 * compatibility — precisely the proof this task has to deliver.
 *
 * WHAT'S HERE AND WHY:
 *  - `f1` — a narrow JUSTIFIED column with hyphenation on. Produces
 *    hyphenated lines, i.e. a target for the soft hyphen U+00AD;
 *  - `f2`'s first paragraph carries a FORCED LINE BREAK (U+000A) inside a
 *    justified paragraph — a known InDesign trap where the preceding line
 *    stretches to full measure (`docs/measured-facts-phase3.md:316-319`).
 *    This is the subject of Task 13's open question: whether tracking
 *    reduces the air in such a line;
 *  - the rest of `f2`'s paragraphs are ordinary, and their SHORT LAST
 *    LINES aren't there for looks: `calibrate` derives the natural space
 *    width from exactly these, and without at least three samples no line
 *    in the document gets measured at all.
 *  - `f3` — a narrow column with twelve long em dashes (Phase Task 4,
 *    "line-start-dash"): the target for the rule "a dash torn from its
 *    word by a line break". Twelve, not one, because the composer — not
 *    the fixture — decides where the line break falls.
 */
IDMCP.handlers.__fixture_make_composition = function (params) {
    var previousUnit = app.scriptPreferences.measurementUnit;
    app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;
    var doc = null;
    try {
        doc = app.documents.add();
        doc.documentPreferences.pagesPerDocument = 1;
        var st = doc.paragraphStyles.add({ name: "Osnovnyi" });

        /* A narrow justified column with hyphenation — the source of hyphenated lines. */
        var f1 = doc.pages[0].textFrames.add();
        f1.geometricBounds = [20, 20, 260, 150];
        f1.contents =
            "Considerable international communication requires extraordinary " +
            "responsibility and uncompromising professional determination from " +
            "every participating organization worldwide.";
        f1.texts[0].appliedParagraphStyle = st;
        f1.texts[0].pointSize = 11;
        f1.texts[0].justification = Justification.LEFT_JUSTIFIED;
        f1.texts[0].hyphenation = true;

        /*
         * "\n" in contents is specifically a FORCED LINE BREAK (Shift+Enter), not
         * a paragraph end: a paragraph end is "\r" (see SEPARATORS in
         * normalize.ts). Because of it, this paragraph's first line will justify
         * to full measure.
         */
        var f2 = doc.pages[0].textFrames.add();
        f2.geometricBounds = [20, 180, 400, 420];
        f2.contents =
            "Tut korotko a tam dali\n" +
            "prodovzhennia toho samoho abzatsu iake zaimaie shche kilka riadkiv " +
            "tekstu dlia nadiinosti vymiru i kalibruvannia.\r" +
            "Druhyi abzats iakyi maie zvychainyi korotkyi ostannii riadok tut.\r" +
            "Tretii abzats takozh zi zvychainym korotkym ostannim riadkom tut.\r" +
            "Chetvertyi abzats znovu zi zvychainym korotkym ostannim riadkom.\r" +
            "Piatyi abzats dlia zapasu zrazkiv kalibruvannia pryrodnoi shyryny.";
        f2.texts[0].appliedParagraphStyle = st;
        f2.texts[0].pointSize = 11;
        f2.texts[0].justification = Justification.LEFT_JUSTIFIED;
        f2.texts[0].hyphenation = false;

        /*
         * A narrow column with MANY long em dashes. A single dash can't be
         * guaranteed to land at the start of a line by width alone — where the
         * break falls is the composer's call. That's why there are twelve of them
         * here: with 4–5 words per line, the odds that none of them becomes the
         * first character of a line are vanishingly small. The test checks for
         * "at least one", not a specific page.
         */
        var f3 = doc.pages[0].textFrames.add();
        f3.geometricBounds = [20, 440, 400, 540];
        var clause = "slovo tut — prodovzhennia rechennia ";
        var body = "";
        for (var i = 0; i < 12; i++) body += clause;
        f3.contents = body + "krapka.";
        f3.texts[0].appliedParagraphStyle = st;
        f3.texts[0].pointSize = 11;
        f3.texts[0].justification = Justification.LEFT_JUSTIFIED;
        f3.texts[0].hyphenation = false;

        doc.save(new File(params.dir + "/composition-fixture.indd"));
        return doc.name;
    } catch (e) {
        /*
         * Same reason as in __fixture_make: without doc.name the caller won't
         * know what to close — we close it here, while we still hold a
         * reference.
         */
        if (doc) {
            try {
                doc.close(SaveOptions.NO);
            } catch (closeErr) {
                /* Не ховаємо оригінальну помилку. */
            }
        }
        throw e;
    } finally {
        app.scriptPreferences.measurementUnit = previousUnit;
    }
};

/*
 * Test helper (Phase 3, W2): reads the tracking value of a named
 * paragraph. Needed to prove that tracking GENUINELY landed in the
 * document, not merely in the report, and to show that Cmd+Z (i.e.
 * __undo_once) reverts it. Read-only; we check the document name, as
 * everywhere else.
 */
IDMCP.handlers.__debug_paragraph_tracking = function (params) {
    var doc = IDMCP.activeDoc();
    if (!params || !params.name || doc.name !== params.name) {
        throw new Error(
            "Expected active document \"" + (params && params.name) + "\", but active is \"" + doc.name + "\"."
        );
    }
    var container = IDMCP.resolveContainer(doc, params.containerId);
    var para = container.paragraphs[params.paragraphIndex];
    var value = para.tracking;
    return { tracking: typeof value === "number" ? value : null, raw: String(value) };
};

/*
 * Undoes EXACTLY one history step — and only in the document named
 * params.name. Checking the name is mandatory: undo acts on the active
 * document, and the user's active document could well be their real
 * working layout. Getting this wrong means undoing someone else's edit in
 * someone else's document.
 */
IDMCP.handlers.__undo_once = function (params) {
    var doc = IDMCP.activeDoc();
    if (!params || !params.name) {
        throw new Error("__undo_once requires params.name — the name of the document to undo in.");
    }
    if (doc.name !== params.name) {
        throw new Error(
            "Active document is \"" + doc.name + "\", but undo was requested in \"" + params.name +
                "\". Nothing was undone."
        );
    }
    /*
     * WHY DIAGNOSTICS HERE INSTEAD OF PLAIN doc.undo() (Phase 4).
     *
     * A bare `doc.undo()` throws «Unable to undo the last command» on
     * failure — a message that reveals NOTHING: not what's on top of the
     * stack, not how many documents are open. Three integration tests
     * (composition-apply, corrections, end-to-end) consistently failed right
     * here, and there was no way to figure out the cause from a message like
     * that.
     *
     * It turned out the cause wasn't in the code: on that very same commit,
     * after restarting InDesign, all 88 integration tests pass — twice in a
     * row. The state of the InDesign session (at the time, a second document
     * was open that the user was actively working in) makes `doc.undo()`
     * impossible, and no change in this repository affects that.
     *
     * I didn't prove the mechanism — only that the defect isn't in the code.
     * So this block stays here for good: it turns a mysterious failure into a
     * message from which the next run immediately shows whether the problem
     * is the session again (`undoName` isn't what the test expects) or, this
     * time, actually the code.
     */
    var undoName = "<unavailable>";
    var redoName = "<unavailable>";
    try { undoName = String(doc.undoName); } catch (eU) { undoName = "<exception: " + eU.message + ">"; }
    try { redoName = String(doc.redoName); } catch (eR) { redoName = "<exception: " + eR.message + ">"; }

    try {
        doc.undo();
    } catch (e) {
        throw new Error(
            "doc.undo() failed: " + String(e.message || e) +
                " | undoName=\"" + undoName + "\"" +
                " | redoName=\"" + redoName + "\"" +
                " | documents=" + app.documents.length +
                " | modified=" + doc.modified
        );
    }
    return { undone: true, undoNameBefore: undoName };
};

/*
 * Test helper (Task 8): the ambient state that apply_edits changes for
 * the duration of a write and is obligated to restore — the app's
 * interaction level (NEVER_INTERACT) and the document's "smart quotes"
 * setting. Both belong to the user, so the test has to prove restoration
 * rather than take the code's word for it (the same approach as
 * __debug_set_include_footnotes in Task 7). Read-only; we check the
 * document name, as everywhere else.
 */
IDMCP.handlers.__debug_app_state = function (params) {
    var doc = IDMCP.activeDoc();
    if (!params || !params.name || doc.name !== params.name) {
        throw new Error(
            "Expected active document \"" + (params && params.name) + "\", but active is \"" + doc.name + "\"."
        );
    }
    return {
        userInteractionLevel: String(app.scriptPreferences.userInteractionLevel),
        typographersQuotes: doc.textPreferences.typographersQuotes
    };
};

/*
 * Test helper (Task 8): opens a document BY EXACT PATH, reads its
 * story's text, and immediately closes it without saving. Needed to
 * prove that the backup in _backups/ was made SPECIFICALLY BEFORE the
 * edits — i.e. it holds the original text, not the already-corrected
 * one. We close via a direct reference to the open object, so there's no
 * way to touch any other document.
 */
IDMCP.handlers.__fixture_read_doc_file = function (params) {
    var f = new File(params.path);
    if (!f.exists) {
        throw new Error("File not found: " + params.path);
    }
    return IDMCP.withNoInteraction(function () {
        var doc = app.open(f, false);
        try {
            var texts = [];
            for (var i = 0; i < doc.stories.length; i++) texts.push(doc.stories[i].contents);
            return texts;
        } finally {
            doc.close(SaveOptions.NO);
        }
    });
};

/*
 * Layout fixture for Phase 4. Contains ALL the states that distinguish
 * the detectors: a parent (master) with a folio, a page with an
 * overridden master item, a page with a master item that's been DELETED,
 * a page with no master, paragraphs with overrides in every property
 * group, a paragraph with a mixed point size, a paragraph with a
 * character style, a list-style paragraph with a manual bullet.
 *
 * An ODD number of pages (7, was 5 — review fix round 1 added the 6-7
 * spread for the single-sided master, without touching the structure of
 * spreads 1-5) — deliberate: it's exactly the oddness that shifts
 * recto/verso and breaks running heads (spec §4.5). Measured (Task 2, on
 * a freshly created document): `page.side` alternates just as cleanly as
 * on the real, even, 198-page document (odd page number → RIGHT_HAND,
 * even → LEFT_HAND, no exceptions) — the fixture doesn't reproduce the
 * mechanism of a shift caused by inserting/deleting a page in the middle
 * of an even spread (that's outside Task 2's scope), only the structural
 * fact "the document has an odd page count".
 *
 * CRITICAL, measured by Task 2: `doc.viewPreferences.rulerOrigin` here is
 * SPREAD_ORIGIN — the geometricBounds of ANY element (master page or
 * ordinary page alike) is measured from the left edge of the SPREAD, not
 * the page it was added to. An element added via `page.textFrames.add()`
 * on a page that is the SECOND (right) page of its spread, given
 * geometricBounds with "bare" x-coordinates within the width of a single
 * page, SILENTLY ends up on the LEFT neighboring page of the spread
 * rather than the page whose textFrames collection it was added to
 * (verified: without the pageWidth offset, the folio on the right and f2
 * on page 5 both ended up on the neighboring left page). That's why
 * below, every element on the "second page of a spread" is shifted by
 * `pageWidth`.
 *
 * The method for matching a page item to a master item (measured by
 * Task 2, on this very fixture — see the task report, section "Measured
 * facts about master items"): the count-based comparison from the
 * briefing draft (`masterPageItems.length` vs.
 * `appliedMaster.pageItems.length`) was disproved by Task 1's probe
 * (Question 3) — the populations don't match by construction. The method
 * that works is by IDENTITY: an untouched master item stays in
 * `page.masterPageItems` under its own `.id`; an overridden one
 * disappears from there and shows up in `page.pageItems` with
 * `.overridden === true` and `.overriddenMasterPageItem.id` equal to the
 * original's `.id` on the master; a deleted one appears NOWHERE (neither
 * in masterPageItems nor in pageItems), and the only way to tell it apart
 * from "there's no master at all" is by checking whether
 * `page.appliedMaster` is still applied.
 */
IDMCP.handlers.__fixture_make_layout = function () {
    var previousUnit = app.scriptPreferences.measurementUnit;
    app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;
    var doc = null;
    try {
        doc = app.documents.add();
        doc.documentPreferences.facingPages = true;
        /*
         * 7, not 5 (review fix round 1). The oddness (a property deliberately
         * tested below) is preserved; pages 6-7 are a NEW spread, added AFTER the
         * existing 1-5 without changing their side or spread (spreads are built
         * sequentially: 1 alone, then pairs 2-3, 4-5, 6-7 — measured earlier,
         * Task 2). The 6-7 pair carries a single-sided master (below).
         */
        doc.documentPreferences.pagesPerDocument = 9;   /* ODD */
        var pageWidth = doc.documentPreferences.pageWidth;

        /* --- a master with a folio on both pages of the spread --- */
        var master = doc.masterSpreads.add();
        master.baseName = "L";
        var mLeft = master.pages[0].textFrames.add();
        mLeft.geometricBounds = [270, 20, 285, 120];
        mLeft.insertionPoints[0].contents = SpecialCharacters.AUTO_PAGE_NUMBER;
        /*
         * Review fix round 1, Important 2: the label must NOT contain the word
         * "folio" (and must not otherwise repeat the product's own trait).
         * A reviewer substituted `IDMCP.hasAutoPageNumber` with
         * `item.label.indexOf("folio") === 0` and the test passed — because the
         * old label itself hinted at the "correct" answer. The label stays here
         * purely as a reading convenience while developing the fixture dump, and
         * must not let any implementation "guess" the folio trait instead of
         * actually checking AUTO_PAGE_NUMBER.
         */
        mLeft.label = "mLeft";
        /*
         * master.pages[1] is the right page of the spread; the pageWidth offset
         * is mandatory (SPREAD_ORIGIN, see the comment above).
         */
        var mRight = master.pages[1].textFrames.add();
        mRight.geometricBounds = [270, pageWidth + 20, 285, pageWidth + 120];
        mRight.insertionPoints[0].contents = SpecialCharacters.AUTO_PAGE_NUMBER;
        mRight.label = "mRight";

        /*
         * NEW (Phase 4 merge-blocker fix). A non-text item on the master — a
         * rectangle, only on the LEFT (mLeft) side of the spread. Before this
         * fix, the fixture's masters had ONLY TextFrames, so both measured
         * defects (IDMCP.hasAutoPageNumber, which failed on a non-text item's
         * `.texts` past its internal try/catch, and `kind`, which on the real
         * book returned "PageItem" from the wrapper instead of the real type)
         * went unreproduced on this fixture and survived all the way to Phase
         * 4's final review — see IDMCP.itemKind and IDMCP.hasAutoPageNumber in
         * src/jsx/map.jsx.
         *
         * MEASURED (caught by the integration test on the first attempt at this
         * fix, not guessed): `pageItems` is a collection ordered by Z-ORDER
         * (the frontmost item first), NOT by creation order. The new item is
         * added to the FRONT, i.e. becomes `pageItems[0]`, and the previous item
         * (the mLeft TextFrame) shifts to `pageItems[1]`. The first version of
         * this fix added the rectangle WITHOUT `sendToBack()`, which replaced
         * the item at index [0] — the override/remove calls below
         * (`doc.pages[1].masterPageItems[0]`,
         * `doc.pages[3].masterPageItems[0]`) then hit the rectangle instead of
         * the folio TextFrame, and the "detectMasters..." test on page "4"
         * failed (`folio-missing` expected, `master-item-missing` produced —
         * because the item actually removed was the non-folio rectangle).
         * `sendToBack()` here is MANDATORY: it puts the mLeft TextFrame back at
         * `pageItems[0]`, so the override/remove calls below hit the folio
         * again, as intended.
         *
         * Deliberately only on mLeft (LEFT_HAND), NOT mRight: pages "1" and
         * "5" (RIGHT_HAND, controls, already checked by the test for
         * masterItems.length === 1 in map.test.ts) remain UNTOUCHED by this
         * change, while pages "2" and "4" (LEFT_HAND) get a second master
         * item — a Rectangle, whose kind the test checks separately.
         */
        var mLeftRect = master.pages[0].rectangles.add();
        mLeftRect.geometricBounds = [20, 20, 40, 60];
        mLeftRect.label = "mLeftRect";
        mLeftRect.sendToBack();

        /*
         * Review fix round 1, Important 1: a SINGLE-SIDED master — a real case
         * (a section title page), not a made-up one. Measured on live InDesign:
         * a master spread created via `masterSpreads.add()` always gives 2
         * pages [LEFT_HAND, RIGHT_HAND] in a fixed index order — which is
         * EXACTLY WHY a "blind index" (`pgSide === "LEFT_HAND" ? pages[0] :
         * pages[1]`) is behaviorally INDISTINGUISHABLE from a correct check
         * against `.side` on an ORDINARY two-sided master — no two-page master
         * will ever tell them apart. Only a master with ONE page tells them
         * apart: after `master.pages[1].remove()`, `pages.length === 1` remains,
         * and that single page's `.side` is `SINGLE_SIDED` (not
         * LEFT_HAND/RIGHT_HAND!). Accessing the now-nonexistent `pages[1]`
         * returns an object with `isValid === false`, and reading any property
         * off it (verified: `.side`) throws `Error: Object is invalid`. In other
         * words, the "blind index" on a RIGHT_HAND page with this kind of
         * master reaches for exactly this invalid object.
         *
         * Applied to BOTH pages of the new spread (6 — LEFT_HAND, 7 —
         * RIGHT_HAND), deliberately UNTOUCHED: with a correct check against
         * `.side` (which for a single-sided master takes `pages[0]` regardless
         * of side — a single page's `.side` never equals the document page's
         * LEFT_HAND/RIGHT_HAND anyway), both give the SAME composition (the
         * same one master item). The "blind index" on page 7 reaches for the
         * invalid `pages[1]` and breaks.
         */
        var single = doc.masterSpreads.add();
        single.baseName = "S";
        single.pages[1].remove();
        var sMarker = single.pages[0].textFrames.add();
        sMarker.geometricBounds = [30, 30, 50, 130];
        sMarker.contents = "Shmuctytul, odnostoronnia batkivska.";

        /*
         * A GUIDE on the single-sided master (a volume regression test).
         *
         * Measured on the working book: `page.masterPageItems` includes a
         * Guide, while `masterSpread.pageItems` does not. On three pages of the
         * book this produced 137 guides out of 143 items, i.e. the map was 96%
         * guides. Without this guide, a test asserting "no Guide in
         * masterItems" would be checking emptiness and would pass with any
         * implementation.
         *
         * Placed specifically on the SINGLE-SIDED master `single`, not on `L`:
         * pages 2 and 4 reach `masterPageItems[0]` by index, and an extra item
         * on `L` would shift the target — the same Z-order trap that already
         * broke this fixture once before.
         */
        single.pages[0].guides.add(undefined, { location: 100, orientation: HorizontalOrVertical.HORIZONTAL });
        sMarker.label = "single-marker";

        /* --- paragraph styles with KNOWN values --- */
        var osnovnyi = doc.paragraphStyles.add({
            name: "Osnovnyi",
            firstLineIndent: 12,
            leftIndent: 0,
            rightIndent: 0,
            spaceBefore: 0,
            spaceAfter: 0,
            pointSize: 11,
            leading: 14,
            justification: Justification.LEFT_JUSTIFIED
        });
        var spysok = doc.paragraphStyles.add({ name: "Spysok", pointSize: 11, leading: 14 });
        spysok.bulletsAndNumberingListType = ListType.BULLET_LIST;
        var vydilennia = doc.characterStyles.add({ name: "Vydilennia", pointSize: 9 });

        /* --- pages: various master states --- */
        for (var i = 0; i < doc.pages.length; i++) doc.pages[i].appliedMaster = master;
        /*
         * page 3 (index 2) — WITHOUT a master. Caution (measured): you CANNOT
         * read this back via `appliedMaster === NothingEnum.NOTHING` — that
         * expression evaluates to `false` for both "no master" and "has one".
         * Task 7 must check `String(page.appliedMaster) === "null"` or a
         * try/catch on `.name`/`.isValid`.
         */
        doc.pages[2].appliedMaster = NothingEnum.NOTHING;

        /*
         * page 2 (index 1) — folio OVERRIDDEN. It's the first (left) page of
         * its spread, so no offset is needed here.
         */
        var ov = doc.pages[1].masterPageItems[0].override(doc.pages[1]);
        ov.geometricBounds = [200, 250, 215, 350];

        /*
         * page 4 (index 3) — folio DELETED from the page entirely: override(),
         * then remove() of the overridden item. After this, both
         * masterPageItems and pageItems on this page are empty.
         */
        doc.pages[3].masterPageItems[0].override(doc.pages[3]).remove();

        /*
         * page 5 (index 4) remains UNTOUCHED — the "everything's in place"
         * control: masterPageItems.length === 1, pageItems.length (before f2
         * below) === 0.
         */

        /*
         * pages 6 (index 5, LEFT_HAND) and 7 (index 6, RIGHT_HAND) — the
         * SINGLE-SIDED master "S", BOTH UNTOUCHED. See the comment above about
         * SINGLE_SIDED and the "blind index".
         */
        doc.pages[5].appliedMaster = single;
        doc.pages[6].appliedMaster = single;

        /*
         * page 8 (index 7) — FOLIO OVERRIDDEN, AND ITS AUTO-NUMBER KILLED BY
         * HAND. A state the fixture was missing: Phase 4 called it out as debt
         * precisely because there was nothing to check this path against ("the
         * fixture doesn't contain such a state, so it's untestable without a
         * made-up test").
         *
         * Differs from page 2 by exactly one thing: there, the override moves
         * the GEOMETRY while the content stays an auto-number; here, the
         * content is replaced with fixed text. For InDesign both are an
         * "overridden item", and until now the detector saw them as identical.
         * In reality this case is worse than a missing folio: the page looks
         * correct right up until a recomposition shifts it, at which point the
         * number goes wrong SILENTLY.
         *
         * The fixture grew from 7 to 9 pages for the sake of this page. The
         * oddness — the property map.test.ts checks (it shifts recto/verso) —
         * is preserved on purpose.
         */
        var ovKilledFolio = doc.pages[7].masterPageItems[0].override(doc.pages[7]);
        ovKilledFolio.label = "mKilledFolio";
        ovKilledFolio.texts[0].contents = "8";

        /* --- text with overrides in every group --- */
        var f1 = doc.pages[0].textFrames.add();
        f1.geometricBounds = [20, 20, 240, 400];
        f1.contents =
            "Chystyi abzats bez pereviznachen.\r" +
            "Abzats iz inshym vidstupom.\r" +
            "Abzats iz inshym kehlem.\r" +
            "Abzats iz mishanym kehlem vseredyni.\r" +
            "Abzats iz symvolnym stylem vseredyni.\r" +
            "Odnakovyi Inshyi Odnakovyi\r" +
            "- Ruchnyi marker zamist spyskovoho.";
        f1.texts[0].appliedParagraphStyle = osnovnyi;

        f1.paragraphs[1].firstLineIndent = 24;          /* indents group */
        f1.paragraphs[2].pointSize = 9.5;               /* sizes group   */
        /*
         * A mixed point size inside a paragraph. Measured by Task 2: reading
         * the `paragraph.pointSize` of a paragraph with a GENUINE mixed size
         * gives neither NothingEnum, nor a string, nor an error — it SILENTLY
         * returns the number of the paragraph's FIRST character range (typeof
         * stays "number"), indistinguishable from a real, uniform value. This
         * disproves the defensive check `typeof x !== "number"` from Task 1's
         * probe (Question 2) as a way to catch mixed values at the paragraph
         * level — it will NOT work here. Task 6 must check `textStyleRanges`
         * (several ranges with different pointSize inside one paragraph),
         * not the typeof of `paragraph.pointSize`'s result.
         */
        f1.paragraphs[3].characters.itemByRange(0, 5).pointSize = 8;
        var vStart = f1.paragraphs[4].contents.indexOf("symvolnym");
        f1.paragraphs[4].characters.itemByRange(vStart, vStart + 8).appliedCharacterStyle = vydilennia;
        /*
         * Paragraph 5 (Task 3, review fix round 1, Important 2): THREE character
         * ranges, where the FIRST and the LAST are equal to each other (8pt),
         * and the MIDDLE one differs (16pt). Verified on live InDesign:
         * itemByRange uses INCLUSIVE bounds on both ends (0..8 is 9 characters,
         * not 8), and the third range's bound (17..26) deliberately captures
         * the trailing carriage-return character too (the paragraph's \r, index
         * 26) — otherwise it would be left unassigned and form a 4th range with
         * the default 11pt size, ruining the "first === last" property.
         *
         * Paragraph 3 (above) does NOT catch this: it only has 2 ranges (8 and
         * the default 11), and comparing "first↔last" is indistinguishable
         * from comparing "all ranges" there — both reach the same conclusion. A
         * mutant that replaces a full walk of textStyleRanges with a comparison
         * of only the outer ranges would pass unnoticed on paragraph 3 (8 !== 11
         * in both versions), but not here: "first↔last" would give 8 === 8 and
         * falsely call the paragraph NOT mixed, while the middle (16) actually
         * makes it mixed.
         */
        f1.paragraphs[5].characters.itemByRange(0, 8).pointSize = 8;
        f1.paragraphs[5].characters.itemByRange(9, 16).pointSize = 16;
        f1.paragraphs[5].characters.itemByRange(17, 26).pointSize = 8;
        f1.paragraphs[6].appliedParagraphStyle = spysok;  /* a list style + a manual bullet */

        /* --- frame chain and overset --- */
        /*
         * page 5 (index 4) — the SECOND (right) page of its spread, so it too
         * needs the pageWidth offset (without it the frame silently ends up on
         * page 4).
         */
        var f2 = doc.pages[4].textFrames.add();
        f2.geometricBounds = [20, pageWidth + 20, 40, pageWidth + 100];
        f2.contents = "Tekst iakyi navmysno ne vlizaie u ramku i daie overset dlia perevirky.";

        /* --- Phase 5: a state for style hygiene --- */

        /* Declared and unused. */
        var unused = doc.paragraphStyles.add();
        unused.name = "Nevzhyvanyi";
        unused.pointSize = 9;

        /*
         * A style inside a folder: `allParagraphStyles` flattens folders, so
         * the full path is the only thing that tells them apart.
         */
        var group = doc.paragraphStyleGroups.add();
        group.name = "Hrupa";
        var inGroup = group.paragraphStyles.add();
        inGroup.name = "V_Hrupi";
        inGroup.pointSize = 10;

        /*
         * A style that ALL of its paragraphs override — a miniature of the
         * measured `Заголовок до чеклисту` case (21 out of 21).
         */
        var allOver = doc.paragraphStyles.add();
        allOver.name = "Vsi_Pereviznachaiut";
        allOver.pointSize = 12;

        /*
         * TWO STYLES FOR THE `hierarchy` FAMILY (Task 9 review, round 1,
         * Important 3). MEASURED LIVE (not guessed): every style in the fixture
         * above, created via `.add()` without an explicit `basedOn`, gives
         * `st.basedOn.name`/`.id` the STRING "undefined" — not by throwing an
         * exception and not by a real reference to `[No Paragraph Style]`, but
         * via `NothingEnum.NOTHING` (the property simply isn't set). That means
         * none of them exercises either the "throws" branch (`[No Paragraph
         * Style]` itself) or the "legal explicit basedOn: [No Paragraph Style]"
         * branch in `IDMCP.relatedStyleId` — both would stay uncovered by a
         * live run, and a mutant that "removes the [No Paragraph Style] special
         * case in relatedStyleId" would pass unnoticed.
         *
         * `bazovanyiNaNoPara` — an EXPLICIT `basedOn: [No Paragraph Style]`, the
         * very case named by the function's own comment (`styles.jsx`): "a
         * style can LEGALLY declare basedOn: [No Paragraph Style] via the
         * InDesign dialog, and its .id is an ordinary working string, not a
         * sentinel". Without a name check, `relatedStyleId` would return the
         * REAL id of `[No Paragraph Style]` here instead of null.
         */
        var bazovanyiNaNoPara = doc.paragraphStyles.add({
            name: "Bazovanyi_Na_NoPara",
            basedOn: doc.paragraphStyles.itemByName("[No Paragraph Style]")
        });

        /*
         * `bazovanyiNaOsnovnyi` — a GENUINE, non-empty chain: its basedOn leads
         * to a real, previously created style, `osnovnyi`. This gives a
         * `basedOnId` that resolves to someone else's `.id` (neither null nor
         * "undefined"), which is exactly why `resolveChains`/`hierarchyBlock`
         * (styles.ts) have something to count on this fixture —
         * `stylesInChains ≥ 1`, `maxChainDepth ≥ 1`. No other style in the
         * fixture produces such a chain (all the others are "roots" via the
         * NothingEnum path above).
         */
        var bazovanyiNaOsnovnyi = doc.paragraphStyles.add({
            name: "Bazovanyi_Na_Osnovnyi",
            basedOn: osnovnyi
        });

        /*
         * A NEW FRAME ON PAGE "1" (Task 8 review, item Г). f1 (above) already
         * sits on this page and also has paragraphIndex 0 in its own story —
         * the "page '1' + paragraphIndex 0" filter used by map.test.ts and
         * styles-measure.test.ts is no longer unambiguous after this frame:
         * page+paragraphIndex now coincide across MULTIPLE stories. Until now
         * `.find()` happened to return f1 only because f1 was created FIRST and
         * `doc.stories` in practice iterates in creation order — that's an
         * OBSERVED engine behavior, not an API guarantee. The tests were fixed
         * by binding to the `containerId` found via the styleName "Osnovnyi" (a
         * style applied nowhere else in the fixture) — see the comments in
         * map.test.ts and styles-measure.test.ts.
         */
        var extra = doc.pages[0].textFrames.add();
        extra.geometricBounds = [40, 20, 200, 200];
        extra.contents = "Perviy abzac\rDrugiy abzac\rSluzhbovyi\rMasshtab";
        var ep = extra.paragraphs;

        ep[0].appliedParagraphStyle = allOver;
        ep[0].pointSize = 18;            /* != 12 — an override */
        ep[1].appliedParagraphStyle = allOver;
        ep[1].pointSize = 20;            /* != 12 — an override */

        ep[2].appliedParagraphStyle = doc.paragraphStyles.itemByName("[Basic Paragraph]");

        ep[3].horizontalScale = 96;      /* exactly 96 — a measured manual value */

        /*
         * A paragraph with a MIXED scale inside itself. State added per Task
         * 2's review: without it, the mutants "invert the condition for
         * recording scale" and "read horizontalScale straight off the
         * paragraph instead of charPropActual" BOTH passed, because the
         * fixture had no scaled text at all and the scales array stayed empty
         * either way. Mixedness is the one state that tells these two paths
         * apart: reading off the paragraph silently returns the value of the
         * FIRST range, while charPropActual gives null.
         */
        var mixedFrame = doc.pages[0].textFrames.add();
        mixedFrame.geometricBounds = [210, 20, 240, 200];
        mixedFrame.contents = "Persha polovyna druha polovyna";
        mixedFrame.paragraphs[0].characters.itemByRange(0, 13).horizontalScale = 80;

        /*
         * TWO CHARACTER STYLES WITH THE SAME NAME, different ids: one applied,
         * the other not. This state was added per Task 13's review, and it's
         * the only one that gives a BEHAVIORAL proof where a text-based guard is
         * structurally powerless.
         *
         * The `styles-jsx-character-guard` checks that the code contains the
         * token `charStyleRunCounts[csId]`. It CANNOT check where the value of
         * `csId` came from: swapping `String(...id)` for `String(...name)`
         * leaves the text identical and passes the guard. And the consequence
         * of that swap is exactly the defect that was Critical in the `usage`
         * family: an unused style disappears from the report because its name
         * is shared by another, used one.
         *
         * InDesign only allows the same name in different folders, so the
         * second style is created inside a group.
         */
        var csUsed = doc.characterStyles.add();
        csUsed.name = "Dvijnyk";
        csUsed.pointSize = 14;
        var csGroup = doc.characterStyleGroups.add();
        csGroup.name = "Hrupa CS";
        var csUnused = csGroup.characterStyles.add();
        csUnused.name = "Dvijnyk";
        csUnused.pointSize = 15;
        /* Only the first is made used — that asymmetry is exactly what's being tested. */
        mixedFrame.paragraphs[0].characters.itemByRange(0, 5).appliedCharacterStyle = csUsed;

        /*
         * THREE CHARACTER STYLES THAT LIVE OUTSIDE ANY TEXT (2026-08-16).
         *
         * None of them is applied to any range, i.e. `appliedRuns = 0` — and
         * yet all three ARE applied: as a bullet marker, as a nested style, and
         * as a nested GREP style. Removing such a style on
         * `character-style-unused`'s advice would silently change the
         * appearance of paragraphs that depend on it.
         *
         * WHY A FIXTURE, NOT A RUN ON THE BOOK. Measured on the working book
         * that same day: `nestedStyles`, `nestedLineStyles`, and
         * `nestedGrepStyles` are EMPTY across all 56 paragraph styles, and the
         * two styles that actually sit on such carriers (`Text Semi Bold` — a
         * bullet marker in three styles; `Зміст Номер сторінки` — a
         * cross-reference block) also have textual usage of their own (158 and
         * 35 ranges), so the defect never fires on the book at all. The book
         * doesn't prove this branch — only this exact state does.
         *
         * Every call below was verified by execution on a temporary document
         * (scripts/probe-carriers.mjs) BEFORE it landed here:
         * `nestedStyles.add` and `nestedGrepStyles.add` accept
         * `appliedCharacterStyle` in their properties, and a walk through
         * `IDMCP.characterStyleCarriers` sees all three with zero misses.
         */
        var csBulletOnly = doc.characterStyles.add();
        csBulletOnly.name = "Lyshe_Marker";
        csBulletOnly.pointSize = 13;
        var spysokZMarkerom = doc.paragraphStyles.add({ name: "Spysok_Z_Markerom" });
        spysokZMarkerom.bulletsCharacterStyle = csBulletOnly;

        var csNestedOnly = doc.characterStyles.add();
        csNestedOnly.name = "Lyshe_Vkladenyi";
        csNestedOnly.pointSize = 13;
        var zVkladenym = doc.paragraphStyles.add({ name: "Z_Vkladenym" });
        zVkladenym.nestedStyles.add({
            appliedCharacterStyle: csNestedOnly,
            delimiter: ".",
            inclusive: true,
            repetition: 1
        });

        var csGrepOnly = doc.characterStyles.add();
        csGrepOnly.name = "Lyshe_Grep";
        csGrepOnly.pointSize = 13;
        var zGrepom = doc.paragraphStyles.add({ name: "Z_Grepom" });
        zGrepom.nestedGrepStyles.add({
            appliedCharacterStyle: csGrepOnly,
            grepExpression: "\\d+"
        });

        /*
         * AN UNUSED BASE — the other side of the `style-unused-leaf` /
         * `style-unused-base` split (`src/styles/dependants.ts`, session
         * 2026-08-16). Until now the fixture only had LEAVES (`Nevzhyvanyi`),
         * so the "a base must not be removed" branch rested on unit tests alone
         * — the integration suite never exercised it at all, exactly the
         * asymmetry recorded as debt at the entry point.
         *
         * `Baza_Nevzhyvana` carries no paragraph of its own, but
         * `Dytyna_Vzhyvana` is based on it, and that child DOES have a
         * paragraph. So the base survives cleanup, and the detector must call
         * it a base, not a leaf.
         */
        var bazaNevzhyvana = doc.paragraphStyles.add({
            name: "Baza_Nevzhyvana",
            pointSize: 17
        });
        var dytynaVzhyvana = doc.paragraphStyles.add({
            name: "Dytyna_Vzhyvana",
            basedOn: bazaNevzhyvana
        });
        var bazaFrame = doc.pages[0].textFrames.add();
        bazaFrame.geometricBounds = [250, 20, 275, 200];
        bazaFrame.contents = "Abzac na dytyni bazy";
        bazaFrame.paragraphs[0].appliedParagraphStyle = dytynaVzhyvana;

        return doc.name;
    } catch (e) {
        /*
         * Same reason as in __fixture_make: without doc.name the caller won't
         * know what to close — we close it here, while we still hold a
         * reference.
         */
        if (doc) {
            try {
                doc.close(SaveOptions.NO);
            } catch (closeErr) {
                /* Не ховаємо оригінальну помилку. */
            }
        }
        throw e;
    } finally {
        app.scriptPreferences.measurementUnit = previousUnit;
    }
};

/*
 * Test helper (Task 7, review fix round 1, Important 1): reads and, if
 * params.value is a boolean, sets
 * app.findChangeGrepOptions.includeFootnotes. Needed to prove in a test
 * that grep_find gives the same result REGARDLESS of this app-level
 * ambient state, and that after the call the value doesn't "leak"
 * changed to the outside. Returns the value BEFORE and AFTER the
 * change, so the test can restore the app's original state.
 */
IDMCP.handlers.__debug_set_include_footnotes = function (params) {
    var opts = app.findChangeGrepOptions;
    var previous = opts.includeFootnotes;
    if (params && typeof params.value === "boolean") {
        opts.includeFootnotes = params.value;
    }
    return { previous: previous, current: opts.includeFootnotes };
};

/*
 * Phase 6 fixture — `pagination_audit`.
 *
 * THE LIST OF STATES WAS DRAWN UP IN ADVANCE (spec §9), before the
 * detectors' first line of code. Each block below creates EXACTLY ONE
 * state and says which detector would go unchecked without it. Phase 5
 * paid for the opposite with a whole separate task: its fixture lacked
 * the needed states, and three detector families tested against empty
 * ground, showing green.
 *
 * Pages (facing pages, 10 pages): 1 | 2-3 | 4-5 | 6-7 | 8-9 | 10. A
 * spread neighbor is exactly what the `folio` family takes its
 * reference from.
 */
IDMCP.handlers.__fixture_make_pagination = function (params) {
    var previousUnit = app.scriptPreferences.measurementUnit;
    app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;
    var doc = null;
    var states = [];

    function frameOn(page, dx1, dy1, dx2, dy2) {
        var b = page.bounds;   /* [y1, x1, y2, x2] */
        var f = page.textFrames.add();
        /*
         * Coordinates RELATIVE TO THE PAGE: on a spread they're shared between
         * both pages, and absolute numbers would drop the frame onto the wrong
         * page.
         */
        f.geometricBounds = [b[0] + dy1, b[1] + dx1, b[0] + dy2, b[1] + dx2];
        return f;
    }

    function folioFrame(page, label, withAuto, style) {
        var f = frameOn(page, 20, 700, 200, 730);
        f.contents = label;
        if (withAuto) {
            f.insertionPoints[-1].contents = SpecialCharacters.AUTO_PAGE_NUMBER;
        }
        f.paragraphs[0].appliedParagraphStyle = style;
        return f;
    }

    try {
        doc = app.documents.add();
        doc.documentPreferences.facingPages = true;
        doc.documentPreferences.pagesPerDocument = 10;

        var stFolio = doc.paragraphStyles.add({ name: "Kolontsyfra" });
        var stTitle = doc.paragraphStyles.add({ name: "Zmist Rozdil" });
        var stNum = doc.paragraphStyles.add({ name: "Zmist Cyfra" });
        var stHead = doc.paragraphStyles.add({ name: "Zagolovok" });
        stTitle.leading = 14;
        stNum.leading = 14;

        /* ================= MASTER PAGE =================
         * WHAT WAS MISSING AND WHY IT WAS EXPENSIVE. The Phase 6 fixture had
         * `masterCount: 0` on every page, meaning the THIRD FRAME SOURCE
         * (`page.masterPageItems`) was never checked at all: a mutant that
         * "disables the third source" passed green on all 17 tests (Task 3
         * report). Spec §8 explicitly requires a "master page" state.
         *
         * THE MAIN THING THIS SPECIFIC LAYOUT GIVES: a folio on the RIGHT
         * master page. Page "1" sits alone in its spread (position 0), while
         * the master's right page is position 1, so the coordinate systems
         * differ by exactly one page width (Question 17). Without this frame,
         * coordinate reconciliation checks nothing: on every other page the
         * offset is zero.
         */
        var mspread = doc.masterSpreads[0];
        var mverso = mspread.pages[0];
        var mrecto = mspread.pages[1];

        function masterFolio(mpage) {
            /*
            * The same coordinates as the document folios, so the master frame
            * sits UNDER them. This reproduces a measured book state: 29 pages
            * have a live master folio underneath a hand-drawn one (§4.9, dormant
            * duplicates). It's also the only source of an overlap with
            * `fromMaster: true`.
            */
            var f = frameOn(mpage, 20, 700, 200, 730);
            f.insertionPoints[0].contents = SpecialCharacters.AUTO_PAGE_NUMBER;
            f.paragraphs[0].appliedParagraphStyle = stFolio;
            return f;
        }
        masterFolio(mrecto);
        states.push("master-folio-recto");
        var mfolioVerso = masterFolio(mverso);
        states.push("master-folio-verso");

        /*
         * A HEADING INSIDE THE MASTER FOLIO FRAME — a state that slipped past
         * TWO fix rounds because each half of the code looked correct on its
         * own.
         *
         * The "a master frame belongs only to the folio family" gate rejects a
         * frame by ROLE, i.e. it lets exactly a folio through; heading
         * collection, which runs after it, is per-paragraph and never checked
         * `fromMaster` at all. Measured by review `49faac5`: this frame produced
         * 5 phantom `Zagolovok` entries — one for every verso page (2, 4, 6, 8,
         * x) — exactly the kind of multiplication §4.1 exists to forbid.
         *
         * The `mhead` running head below does NOT catch this: there, the
         * heading is the FIRST paragraph, so the frame is already rejected by
         * role. What's needed is specifically a heading that is NOT the first
         * paragraph, in a frame whose role IS `folio`.
         */
        mfolioVerso.insertionPoints[-1].contents = "\rZagolovok z majstra";
        mfolioVerso.paragraphs[1].appliedParagraphStyle = stHead;
        states.push("master-folio-with-heading-paragraph");

        /*
         * A running head on the LEFT master page, set in the BODY heading
         * style. A measured book state: running heads live on the verso of
         * masters E, D, J. The `contents` family must not collect it once for
         * EVERY page under this master — otherwise a single running head would
         * produce 5 phantom headings.
         */
        var mhead = frameOn(mverso, 20, 40, 300, 60);
        mhead.contents = "Kolontytul z majstra";
        mhead.paragraphs[0].appliedParagraphStyle = stHead;
        states.push("master-running-head");

        /*
         * The same thing for the contents-number family: a frame styled
         * `Zmist Cyfra` on the master. The number 77 doesn't occur anywhere
         * else in the fixture, so any leak is identifiable by name.
         */
        var mnum = frameOn(mverso, 320, 40, 380, 60);
        mnum.contents = "77";
        mnum.paragraphs[0].appliedParagraphStyle = stNum;
        states.push("master-contents-number");

        /*
         * THE ONLY MEASURED STATE THAT GIVES `parentPage === null` WHILE STILL
         * REACHING THE CODE — a GROUP's leaf that sits outside the master
         * pages.
         *
         * Three places in the code had, until now, named the cause of this
         * branch as "an item straddling the master's spine". A probe (a 4-page
         * fixture, four states) disproved that:
         *
         *   a frame CROSSING THE SPINE                parentPage «A» — not null;
         *   a frame on the master's pasteboard         null, but
         *                                               absent from `page.masterPageItems`;
         *   a group's leaf WITHIN the page bounds       «A»;
         *   a group's leaf OUTSIDE the page bounds      null — and this is the one that shows up.
         *
         * Mechanism: the GROUP itself is assigned to the master page and does
         * appear in `masterPageItems`, but `IDMCP.collectMasterInto` unpacks it
         * into leaves — and a leaf that lies outside the master pages already
         * belongs to no one. From there, `recordBounds` returns `null`, and
         * `claimFrame` gives `bounds: null` and `overlaps: null`, i.e. "not
         * counted" rather than "no overlaps".
         *
         * THE GROUP'S ANCHOR IS A RECTANGLE, NOT A SECOND TEXT FRAME: a group
         * needs two items, but `collectMasterInto` only collects text ones, so
         * the rectangle adds no assertion of its own and the fixture's numbers
         * stay derivable.
         */
        /*
         * A STYLE NAMED `constructor` — NOT A JOKE, A PROTOTYPE TRAP.
         *
         * Paragraph style names come from the user's document, i.e. they're
         * arbitrary strings, and they become the keys of the measurement's
         * dictionaries. `{}["constructor"]` returns a FUNCTION instead of
         * `undefined` — and that alone turned the index of a skipped frame into
         * a function, `masterSkipped.declared[…]` into `undefined`, and
         * `.frames += 1` crashed the ENTIRE measurement with a `TypeError`.
         * Reproduced by running it in node before this fixture existed; here
         * the state lives in the document, so the check goes through the real
         * call path.
         *
         * Placed on the master and NOT declared among the default parameters:
         * in an ordinary run it gives the negative control `undeclared` ("there
         * are master frames here at all"), while a test that does declare it
         * walks straight into the trap.
         */
        var stCtor = doc.paragraphStyles.add({ name: "constructor" });
        var mctor = frameOn(mverso, 20, 500, 200, 530);
        mctor.contents = "Styl z nazvoiu constructor";
        mctor.paragraphs[0].appliedParagraphStyle = stCtor;
        states.push("master-style-named-constructor");

        var mgAnchor = mspread.rectangles.add();
        mgAnchor.geometricBounds = [
            mverso.bounds[0] + 400, mverso.bounds[1] + 40,
            mverso.bounds[0] + 430, mverso.bounds[1] + 140
        ];
        var mgOut = mspread.textFrames.add();
        mgOut.geometricBounds = [
            mverso.bounds[0] + 400, mverso.bounds[1] - 300,
            mverso.bounds[0] + 430, mverso.bounds[1] - 200
        ];
        /*
         * Without a single digit: the frame must add an ASSERTION for the folio
         * family, not a finding — otherwise the state would be testing two
         * different mechanisms at once.
         */
        mgOut.contents = "Poza majstrovoiu storinkoiu";
        mgOut.paragraphs[0].appliedParagraphStyle = stFolio;

        /*
         * A SECOND LEAF — THE SAME MECHANISM, BUT WITH A MARKER, and without it
         * `folio-marker-unmeasured` never fired on the fixture even once
         * (finding Y3 of review `a1004eb`).
         *
         * §4.9 routes a frame to this finding on exactly two signals at once:
         * `overlaps === null` (the measurement has no bounds of its own) AND a
         * directional marker (without it the detector stays silent by
         * construction). The first leaf deliberately has NO marker — it's the
         * negative control for this very pair: unknown bounds alone produce no
         * finding.
         *
         * WHY NOT ADD THE MARKER TO THE FIRST ONE INSTEAD. Then a single state
         * would be testing two different mechanisms at once, and there would be
         * no way to show that the finding comes from the marker specifically,
         * not from unknown bounds. The cost is one folio-family assertion per
         * verso page, i.e. the V multiplier in both integration tests' tables.
         */
        var mgOutMarked = mspread.textFrames.add();
        mgOutMarked.geometricBounds = [
            mverso.bounds[0] + 440, mverso.bounds[1] - 300,
            mverso.bounds[0] + 470, mverso.bounds[1] - 200
        ];
        mgOutMarked.contents = "-";
        mgOutMarked.insertionPoints[0].contents = SpecialCharacters.PREVIOUS_PAGE_NUMBER;
        mgOutMarked.paragraphs[0].appliedParagraphStyle = stFolio;

        mspread.groups.add([mgAnchor, mgOut, mgOutMarked]);
        states.push("master-group-leaf-outside-pages");
        states.push("master-group-leaf-with-marker");

        /* ================= folio ================= */

        /*
         * A NEGATIVE CONTROL. p.3, neighbor "2", manual 2 + auto-marker: part 1
         * is satisfied (2 is the neighbor), so is part 2 (2 ≠ 3). Without this
         * line, a detector that flags everything would pass the tests.
         */
        folioFrame(doc.pages[2], "2–", true, stFolio);
        states.push("folio-correct");

        /*
         * p.5, neighbor "4", manual 2 — is neither 5 nor 4. Reproduces the
         * measured -2 offset (2026-07-29, 76 pages). Caught by PART 1.
         */
        folioFrame(doc.pages[4], "2–", true, stFolio);
        states.push("folio-drifted");

        /*
         * p.6, neighbor "7", manual 6 — equal to the page's OWN number, i.e. it
         * duplicates the auto-marker. Part 1 MISSES this; only PART 2 catches
         * it. Reproduces the measured 2026-08-04 defect (52 folios on the wrong
         * side, reading "96–96"). Without this state, half the rule is
         * checked by nothing.
         */
        folioFrame(doc.pages[5], "6–", true, stFolio);
        states.push("folio-wrong-side");

        /*
         * p.9, neighbor "8", "8–9" entirely as literals, WITHOUT an
         * auto-marker. Both numbers are correct, so nothing will be stale here
         * — but the frame will break on recompose, and that's exactly what
         * folio-manual is supposed to say. It's also the boundary between the
         * two parts: without an auto-marker, part 2 must not fire.
         */
        folioFrame(doc.pages[8], "8–9", false, stFolio);
        states.push("folio-no-marker");

        /*
         * A section with Roman numerals: the page name stops being a number.
         * Must produce folio-unparsable, not a comparison against NaN.
         */
        var sec = doc.sections.add(doc.pages[9]);
        sec.pageNumberStyle = PageNumberStyle.LOWER_ROMAN;
        folioFrame(doc.pages[9], "9–", true, stFolio);
        states.push("folio-unparsable-page-name");

        /* ================= headings in the body ================= */
        /* Three headings on known pages — the reference for contents numbers. */
        var headPages = [3, 5, 7];   /* pages "4", "6", "8" */
        for (var h = 0; h < headPages.length; h++) {
            var hf = frameOn(doc.pages[headPages[h]], 20, 60, 300, 90);
            hf.contents = "Zagolovok " + (h + 1);
            hf.paragraphs[0].appliedParagraphStyle = stHead;
        }

        /* ================= contents ================= */
        /*
         * A table of contents on p.2. Titles and numbers as separate frames
         * with matching leading, so their baselines line up in pairs.
         */
        var toc = doc.pages[1];

        function titleAt(y, text) {
            var f = frameOn(toc, 20, y, 220, y + 20);
            f.contents = text;
            f.paragraphs[0].appliedParagraphStyle = stTitle;
            return f;
        }
        function numberAt(y, text) {
            var f = frameOn(toc, 240, y, 290, y + 20);
            f.contents = text;
            f.paragraphs[0].appliedParagraphStyle = stNum;
            return f;
        }

        /*
         * An automatic number — a text-variable instance. The THIRD kind of
         * content alongside literals and SpecialCharacters (spec §4.6a): on the
         * real book this is XREF_PAGE_NUMBER, here it's CUSTOM_TEXT — the
         * detector distinguishes the FACT of a variable instance, not its type.
         * This is a NEGATIVE CONTROL for contents-manual: such a line must not
         * produce a finding.
         */
        var tv = doc.textVariables.add();
        tv.name = "Nomer avto";
        tv.variableType = VariableTypes.CUSTOM_TEXT_TYPE;
        tv.variableOptions.contents = "4";
        titleAt(100, "Zagolovok 1");
        /*
         * We build the frame by hand rather than via numberAt: an EMPTY frame
         * has no paragraphs, so paragraphs[0] is invalid and there's nothing to
         * apply a style to. First the variable instance, only then the style.
         */
        var autoNum = frameOn(toc, 240, 100, 290, 120);
        autoNum.insertionPoints[0].textVariableInstances.add().associatedTextVariable = tv;
        autoNum.paragraphs[0].appliedParagraphStyle = stNum;
        states.push("contents-auto");

        /*
         * A literal number that MATCHES the heading's actual page. Must produce
         * contents-manual (not yet migrated), but NOT contents-stale.
         */
        titleAt(140, "Zagolovok 2");
        numberAt(140, "6");
        states.push("contents-manual-correct");

        /*
         * A literal number that has DRIFTED from the fact: heading 3 is on p.8.
         */
        titleAt(180, "Zagolovok 3");
        numberAt(180, "5");
        states.push("contents-stale");

        /*
         * Two titles within the tolerance of one number: 14 pt leading → 7 pt
         * tolerance, and the baselines differ by 4 pt. Must produce
         * contents-ambiguous, not a guess at which of the two it is.
         */
        titleAt(240, "Blyzniuk A");
        titleAt(244, "Blyzniuk B");
        numberAt(242, "7");
        states.push("contents-ambiguous");

        /*
         * A rotated numbers frame: the baselines live in a rotated coordinate
         * system, so matching would silently drift. A separate finding.
         */
        var rot = numberAt(300, "9");
        rot.rotationAngle = -90;
        states.push("contents-rotated");

        /*
         * A number on a DIFFERENT spread than its title: the pair is never
         * built.
         */
        titleAt(340, "Zagolovok na inshomu rozvoroti");
        var far = frameOn(doc.pages[4], 240, 340, 290, 360);
        far.contents = "3";
        far.paragraphs[0].appliedParagraphStyle = stNum;
        states.push("contents-cross-spread");

        /*
         * A level where there are MORE contents lines than body headings:
         * matching must stop entirely, not emit N false findings with an
         * offset.
         */
        titleAt(380, "Zajvyj riadok bez zagolovka");
        numberAt(380, "10");
        states.push("contents-count-mismatch");

        /*
         * Numbers that DECREASE in reading order: 12 after 10. Monotonicity is
         * the check that replaces title matching (spec §4.5).
         */
        titleAt(420, "Zagolovok pislia");
        numberAt(420, "12");
        titleAt(460, "Zagolovok scho vypav z poriadku");
        numberAt(460, "3");
        states.push("contents-out-of-order");

        /*
         * A STATE THAT PROBE H6 UNCOVERED: a number in an ANCHORED frame.
         * page.textFrames can't see one (on p.8 of the real book — 1 out of 9),
         * so without this state the test would pass while the tool stayed
         * blind to half the document (spec §4.2a).
         */
        var host = frameOn(toc, 20, 520, 290, 560);
        host.contents = "Riadok z pryviazanym chyslom";
        host.paragraphs[0].appliedParagraphStyle = stTitle;
        var anchored = host.paragraphs[0].insertionPoints[0].textFrames.add();
        anchored.contents = "8";
        anchored.paragraphs[0].appliedParagraphStyle = stNum;
        states.push("anchored-number");

        /*
         * Nine states the Phase 6 fixture didn't have. Each exists because
         * without it a whole section of the spec would be tested against empty
         * ground — the lesson Phase 5 paid for with a separate task, and Phase
         * 6 repeated twice.
         *
         * PAGES ARE ONLY EVER APPENDED AT THE END, and that's not a matter of
         * taste: the Phase 6 tests are bound to page NAMES ("3", "5", "6",
         * "9", "x"), and inserting in the middle would renumber everything
         * past the insertion point.
         *
         * THE ARABIC-NUMERAL SECTION IS MANDATORY. The `LOWER_ROMAN` section,
         * set up above for the `folio-unparsable-page-name` state, runs to the
         * end of the document: without a second section the new pages would
         * have got names like "xi", "xii", … (measured by a probe: exactly
         * those), meaning NONE of them would be comparable, and all nine states
         * would land in `notCompared`.
         *
         * THE MEASURED LAYOUT AFTER THIS BLOCK (Task 4B's probe, reading
         * `page.name`, `page.side`, and the composition of `spread.pages`
         * directly on its own temporary document with the same call
         * sequence):
         *
         *   index   name   side    spread
         *   0       1      RIGHT   alone
         *   1–8     2…9    L/R     pairs
         *   9       x      LEFT    with "11"   ← used to be alone, now paired
         *   10      11     RIGHT   with "x"
         *   11–20   12…21  L/R     pairs
         *   21      22     LEFT    with "23", "24"  ← a spread of THREE
         *   22      23     RIGHT   with "22", "24"
         *   23      24     RIGHT   with "22", "23"
         *   24      25     RIGHT   ALONE  ← the LAST page (Task 4B)
         *
         * So 14 recto and 11 verso, 25 total. These two numbers multiply EVERY
         * master-related assertion, and the new counters in both integration
         * tests are derived straight from them — see the tables there.
         *
         * TASK 4B'S FOUR PAGES (18…21) ARE ADDED TO THE THREE-PAGE SPREAD,
         * NOT AFTER IT, and this is a measured necessity, not a stylistic
         * choice: a spread with `allowPageShuffle = false` breaks pairing, and
         * every `spreads.add` InDesign performs after it hands out ONE page per
         * spread (probed: a single call produced two spreads of one page
         * each). Task 4B used exactly this behavior for its "last page" — which
         * is why the "last" addition is built AFTER, and everything else
         * BEFORE.
         *
         * THE CHAIN AND PROBE FRAMES ARE DELIBERATELY EMPTY. An empty frame has
         * no paragraphs (`paragraphs.length === 0`), so the measurement
         * discards it before even determining its role
         * (`pagination.jsx:969`) — it adds NO assertion of its own, but it
         * still shows up in the page's overlap table, which is built from every
         * record. That gives exactly what's needed: topology without
         * arithmetic. It's also a measured state of the phase itself — the
         * service (helper) chain of §4.2 is empty by construction.
         */

        var pgAdd;
        for (pgAdd = 0; pgAdd < 11; pgAdd++) {
            doc.pages.add(LocationOptions.AT_END);
        }
        var secArabic = doc.sections.add(doc.pages[10]);
        secArabic.continueNumbering = true;
        secArabic.pageNumberStyle = PageNumberStyle.ARABIC;

        /*
         * A SPREAD OF THREE PAGES. `spread.allowPageShuffle = false` is
         * MANDATORY and comes FIRST: otherwise InDesign re-lays the pages in
         * pairs and the third silently moves to the next spread. A fresh
         * `spreads.add()` gives TWO pages, not one (measured), so exactly one
         * more needs to be appended.
         */
        var spread3 = doc.spreads.add(LocationOptions.AT_END);
        spread3.allowPageShuffle = false;
        spread3.pages.add(LocationOptions.AT_END, spread3.pages[spread3.pages.length - 1]);

        /*
         * THE LAST PAGE, ALONE IN ITS OWN SPREAD — a spec §8 line that the
         * fixture ONCE HAD and LOST.
         *
         * Before Task 4, page "x" stood alone in its spread; the seven added
         * pages paired it with "11", and half of `no-siblings` coverage
         * silently vanished along with that spec line (finding I-3 of review
         * `61134b5`, noticed only after acceptance). The other half — page
         * "1" — remained, so the loss was invisible.
         *
         * THE RECIPE IS MEASURED, NOT INVENTED. `spreads.add` after a spread
         * with `allowPageShuffle = false` doesn't give one spread of two pages,
         * but TWO spreads of one page each: pairing is broken, and InDesign
         * keeps laying out one page per spread from then on. In other words,
         * "a page alone in its spread" comes out on its own here, and the only
         * job left is removing the extra one — which is exactly why the loop
         * below runs over `doc.pages.length`, not `tail.pages[1].remove()`: the
         * second page no longer belongs to `tail` by that point.
         */
        var tail = doc.spreads.add(LocationOptions.AT_END);
        tail.allowPageShuffle = false;
        while (doc.pages.length > 25) {
            doc.pages[doc.pages.length - 1].remove();
        }

        /*
         * `folio-first-page` — a folio on the first page of a facing-pages
         * document. Page "1" stands alone in its spread, i.e. `spreadSiblings`
         * is empty (the measurement test already asserts this). §4.3's
         * reference is taken from the spread's composition — so here there's
         * NOWHERE TO TAKE IT FROM, and the frame must produce `no-siblings`,
         * not a comparison against a made-up neighbor. The manual "0" is used
         * specifically because page "1" has no left neighbor.
         */
        folioFrame(doc.pages[0], "0–", true, stFolio);
        states.push("folio-first-page");

        /*
         * `folio-broken-thread` — a chain that STARTS on this page. The marker
         * on a recto page looks BACKWARD for its neighbor
         * (`PREVIOUS_PAGE_NUMBER`, §4.3), and there's no preceding frame in the
         * chain — that's `no-neighbour-frame`, distinct from "the frame
         * doesn't overlap a chain at all". Both chain frames are empty (see
         * above), so this state adds exactly ONE assertion — the folio itself.
         *
         * MOVED FROM "11" TO "7" BY TASK 4B, FOR A MEASURED REASON. Page
         * "11"'s neighbor is "x", the document's ONLY non-numeric name, and
         * §4.4 places step 4 ("the neighbor's name doesn't parse") BEFORE step
         * 6. So on "11" this frame would NEVER have produced the reason it
         * exists to test: the oracle would have stopped earlier. The
         * `no-neighbour-frame` branch was, meanwhile, being closed by
         * coincidence via `folio-anchored` on "13" — meaning it was actually
         * exercised by a different state, and the report line
         * "→ no-neighbour-frame" was broader than what was measured.
         *
         * THE NUMBER IS TAKEN FROM THE DOCUMENT, not written as a constant: the
         * frame has to pass oracle steps 1–5 so the failure lands specifically
         * on step 6, and "page 7's neighbor" is a fact of the layout that a
         * fixture shift could change (§3.2).
         *
         * The folio sits on the standard band, i.e. it also overlaps the master
         * underneath it. This isn't contamination — it's a measured book state
         * (29 pages with a live master folio under a hand-drawn one) and
         * exactly the pair on which §4.2 distinguishes an overlapping frame's
         * `fromMaster`.
         */
        var chainStart = frameOn(doc.pages[6], 20, 690, 200, 740);
        var chainNext = frameOn(doc.pages[7], 300, 690, 480, 740);
        chainStart.nextTextFrame = chainNext;
        folioFrame(doc.pages[6], String(doc.pages[5].name) + "–", true, stFolio);
        states.push("folio-broken-thread");

        /*
         * `folio-verso-correct` — a CORRECT verso, for a reason stronger than
         * "there was no negative control".
         *
         * The existing `folio-verso` (p. "12") carries a manual 7 with
         * neighbor "13", i.e. a WRONG number. Review `61134b5` showed it
         * doesn't distinguish correct code from a mirror-flipped bug: an
         * implementation that mixed up the sides and looks LEFT for the manual
         * number on verso would expect 11, compare it to 7, and produce the
         * SAME `oracle-mismatch`. So the mirror half of §4.3 was never checked
         * by any state — neither positively nor negatively.
         *
         * Second, and harder: with zero SUITABLE verso pages, `pagination_apply`
         * would never write `NEXT_PAGE_NUMBER` on the fixture, and the book has
         * zero verso folios (Question 1). That means half the write path would
         * go completely unchecked, while §4.3 says both sides are mandatory.
         *
         * Here the manual number equals the neighbor on the RIGHT SIDE: on a
         * verso, under `backward` this is `offset + 1`, i.e. the right page of
         * the spread. Taken from the document.
         */
        var versoOk = frameOn(doc.pages[7], 20, 700, 200, 730);
        versoOk.contents = "–" + String(doc.pages[8].name);
        versoOk.insertionPoints[0].contents = SpecialCharacters.AUTO_PAGE_NUMBER;
        versoOk.paragraphs[0].appliedParagraphStyle = stFolio;
        states.push("folio-verso-correct");

        /*
         * `folio-locked` — §4.4 step 7 (`SkipReason: "locked-frame"`), which
         * had no state anywhere: the measurement read `ClaimFrame.locked`, but
         * the fixture never set `locked` on anything, so the branch was checked
         * against the constant `false`.
         *
         * THE NUMBER IS DELIBERATELY CORRECT. The oracle's steps are ordered so
         * cheap failures come first: a frame with a wrong number would get
         * `oracle-mismatch` at step 5 and never reach step 7. A state named
         * "locked" would then be checking something else entirely — exactly
         * the defect for which Task 4B moves `folio-broken-thread`.
         *
         * `locked` is set LAST: a locked frame accepts neither content nor a
         * style.
         */
        var lockedFolio = frameOn(doc.pages[3], 20, 700, 200, 730);
        lockedFolio.contents = "–" + String(doc.pages[4].name);
        lockedFolio.insertionPoints[0].contents = SpecialCharacters.AUTO_PAGE_NUMBER;
        lockedFolio.paragraphs[0].appliedParagraphStyle = stFolio;
        lockedFolio.locked = true;
        states.push("folio-locked");

        /*
         * `folio-marker-unbound` — the FIRST of two "defects that print"
         * (§4.9), and until Task 4B it never fired on the fixture at all.
         *
         * Exactly ONE frame had a neighboring page's marker — `folio-hidden-layer`
         * on "15" — and that one was on a hidden layer, i.e. it was already
         * out of the game for a different reason (`folio-dormant-duplicate`).
         * So both detectors, without which §2 calls the phase HARMFUL, were
         * only ever checked by hand-built `ClaimFrame` objects in unit tests.
         *
         * This frame sits on a VISIBLE layer and overlaps ONLY the MASTER
         * chain (`folio-master-thread` places it on both master pages, so it's
         * visible from either). §4.2 doesn't count such a chain — for a
         * document page it never resolves at all (Questions 6 and 13) — so the
         * marker has nothing to resolve against, and that's exactly
         * `folio-marker-unbound`.
         *
         * THE STATE DISTINGUISHES TWO DETECTORS, NOT JUST ONE BRANCH: a mutant
         * that "stops filtering out master links" would produce not silence
         * here but `folio-marker-cross-spread` — the marker would resolve to
         * page "A".
         *
         * NO LITERALS ON PURPOSE: that's exactly what the frame looks like
         * AFTER the replacement, and §4.9 is the only thing that sees anything
         * at all on frames like that.
         */
        var unbound = frameOn(doc.pages[10], 300, 600, 560, 640);
        unbound.contents = "–";
        unbound.insertionPoints[0].contents = SpecialCharacters.PREVIOUS_PAGE_NUMBER;
        unbound.insertionPoints[-1].contents = SpecialCharacters.AUTO_PAGE_NUMBER;
        unbound.paragraphs[0].appliedParagraphStyle = stFolio;
        states.push("folio-marker-unbound");

        /*
         * `folio-verso` — the whole mirror half of §4.3.
         *
         * On a verso, the manual number sits on the RIGHT, i.e. the
         * auto-marker comes first: "⟨auto⟩–7". The book has ZERO verso folios
         * (Question 1, full list), so without this state a tool that only
         * handles recto would silently miss the other half of the edition, and
         * every test would stay green.
         *
         * Page "12"'s neighbor is "13", and the manual number is 7, i.e. the
         * number is also WRONG. That's deliberate: this checks the side itself,
         * not a coincidental match.
         */
        var versoFolio = frameOn(doc.pages[11], 20, 700, 200, 730);
        versoFolio.contents = "–7";
        versoFolio.insertionPoints[0].contents = SpecialCharacters.AUTO_PAGE_NUMBER;
        versoFolio.paragraphs[0].appliedParagraphStyle = stFolio;
        states.push("folio-verso");

        /*
         * `folio-anchored` — a folio in an ANCHORED frame.
         *
         * `page.textFrames` can't see one at all (measured by a probe: 0 out of
         * 1), so the frame only exists via the `allPageItems` walk. Question 7
         * measured that a marker in an anchored frame behaves NORMALLY — so it
         * needs no separate reason to be skipped, and that's exactly what
         * needs to be checked.
         *
         * The recipe isn't invented: created via
         * `insertionPoints[…].textFrames.add()` (you can't anchor an EXISTING
         * frame) plus an `anchoredObjectSettings` property set carried over
         * from project memory. `spineRelative = false` — otherwise the object
         * mirrors to the other side of the spread; `pinPosition = false` —
         * otherwise it gets forced inside the column; text wrap `NONE` —
         * otherwise the text starts wrapping around the frame and the whole
         * band recomposes.
         *
         * The host frame is deliberately left WITHOUT a declared style: with a
         * contents-line style it would also become an assertion for the
         * `contents` family, meaning the state would test two mechanisms at
         * once.
         */
        var ancHost = frameOn(doc.pages[12], 20, 500, 300, 540);
        ancHost.contents = "Riadok, u iakyi pryviazano kolontsyfru";
        var ancFolio = ancHost.paragraphs[0].insertionPoints[0].textFrames.add();
        ancFolio.geometricBounds = [0, 0, 30, 120];
        ancFolio.contents = "12–";
        ancFolio.insertionPoints[-1].contents = SpecialCharacters.AUTO_PAGE_NUMBER;
        ancFolio.paragraphs[0].appliedParagraphStyle = stFolio;
        var aos = ancFolio.anchoredObjectSettings;
        aos.anchoredPosition = AnchorPosition.ANCHORED;
        aos.spineRelative = false;
        aos.pinPosition = false;
        aos.anchorPoint = AnchorPoint.TOP_LEFT_ANCHOR;
        aos.horizontalReferencePoint = AnchoredRelativeTo.TEXT_FRAME;
        aos.horizontalAlignment = HorizontalAlignment.LEFT_ALIGN;
        aos.anchorXoffset = 0;
        aos.verticalReferencePoint = VerticallyRelativeTo.LINE_BASELINE;
        aos.anchorYoffset = 0;
        ancFolio.textWrapPreferences.textWrapMode = TextWrapModes.NONE;
        states.push("folio-anchored");

        /*
         * `folio-no-literals` — a folio frame WITHOUT a single digit, only an
         * auto-marker. This is exactly what all of §4.9 operates on:
         * `detectFolio` only produces findings inside
         * `if (para.literals.length > 0)` (`folio.ts:104`), meaning that after
         * a successful replacement `pagination_audit` stays blind to such a
         * frame FOREVER, and a broken chain will print a plausible "121–121"
         * with no warning at all (Question 10).
         *
         * The DOCUMENT-level frame never had this state before: all five
         * hand-drawn folios carry literals ("2–", "6–", "8–9", "9–"). Frames
         * with no digits do exist in the fixture, but ALL of them are on
         * masters — and Phase 7 only writes to document-level frames, which is
         * exactly why the state is needed on a document-level one.
         */
        var noLit = frameOn(doc.pages[13], 300, 200, 480, 230);
        noLit.insertionPoints[0].contents = SpecialCharacters.AUTO_PAGE_NUMBER;
        noLit.paragraphs[0].appliedParagraphStyle = stFolio;
        states.push("folio-no-literals");

        /*
         * `folio-hidden-layer` — a frame with a marker on a `visible = false`
         * layer.
         *
         * Without this state, §4.9's third detector (`folio-dormant-duplicate`)
         * would be tested against empty ground — and it's exactly the one that
         * saves the book's first run from 29 FALSE-POSITIVE
         * `folio-marker-unbound` findings. The distinction is decisive: a frame
         * on a hidden layer isn't printed TODAY, i.e. it isn't lying; it only
         * becomes a second, wrong folio once the layer is turned on.
         *
         * This frame doesn't overlap any chain — i.e. it's "unbound" by
         * topology. That's exactly why the state distinguishes the two
         * detectors: the verdict must be `folio-dormant-duplicate`, NOT
         * `folio-marker-unbound`. The criterion is `layer.visible` OF THE FRAME
         * ITSELF, not of the layer in general (`layer.visible` means the
         * opposite thing in two different places, §4.9).
         *
         * The layer is named as in the real book: there, the hidden layer is
         * specifically called «Нумерація».
         */
        /*
         * THE ACTIVE LAYER HAS TO BE RESTORED, and that's not pedantry — it's a
         * defect the probe caught on this fixture's very first run.
         * `doc.layers.add` makes the new layer ACTIVE, so every frame created
         * after it silently landed on the hidden layer: `folio-rotated`,
         * `folio-master-thread`, and `folio-three-page-spread` all arrived in
         * the measurement with `layerVisible: false`, meaning three states
         * merged into a fourth (`folio-dormant-duplicate`) and would have been
         * testing something other than what their names say.
         */
        var activeBefore = doc.activeLayer;
        var dormantLayer = doc.layers.add({ name: "Numeratsiia", visible: false });
        /*
         * A SECOND HIDDEN LAYER — A SERVICE (HELPER) ONE, and it is NOT a
         * duplicate of the first.
         *
         * §4.9 gives a two-row table, and `layer.visible` means the OPPOSITE
         * thing in each row: a hidden layer for the FRAME ITSELF means it isn't
         * printed, i.e. it isn't lying today; a hidden layer for the SERVICE
         * CHAIN the frame reads its number from means the frame prints WITH A
         * WRONG number. The fixture only had the first row.
         *
         * These flags are exactly what §4.8 requires be FORBIDDEN: the
         * `_folio-helper` layer must be `printable = false, visible = true`,
         * because it's measured (Question 8) that `visible = false` KILLS
         * marker resolution while `printable = false` does not. So this layer
         * reproduces exactly the accident §4.8 warns about: one click on the
         * "eye" turns every automatic folio in the book into "N–N".
         *
         * `doc.layers.add` MAKES THE LAYER ACTIVE — which is exactly why three
         * states silently landed on the hidden layer on the fixture's first
         * run. The active layer is restored once, after both additions.
         */
        var helperLayer = doc.layers.add({ name: "_folio-helper", visible: false, printable: false });
        doc.activeLayer = activeBefore;
        var dormant = frameOn(doc.pages[14], 300, 200, 480, 230);
        dormant.itemLayer = dormantLayer;
        dormant.contents = "14–";
        dormant.insertionPoints[-1].contents = SpecialCharacters.PREVIOUS_PAGE_NUMBER;
        dormant.paragraphs[0].appliedParagraphStyle = stFolio;
        states.push("folio-hidden-layer");

        /*
         * `folio-layer-locked` — THE SECOND LOCK OF §4.4 STEP 7
         * (`SkipReason: "locked-layer-frame"`), and `folio-locked` does NOT
         * cover it, in principle.
         *
         * MEASURED (Question 19, state C, probe `scripts/probe-h7-lock.jsx`): a
         * frame on a locked layer has `frame.locked === false`, and replacing a
         * character inside it SUCCEEDS. So this isn't a variation of
         * `folio-locked` — it's the opposite state of a different flag: without
         * this frame the `layerLocked` branch would be checked against the
         * constant `false` — exactly the defect for which Task 4B set up
         * `folio-locked` itself.
         *
         * PAGE "2", NOT A NEW ONE: this is the last verso without a hand-drawn
         * folio, and the page layout hasn't shifted because of this state. The
         * number is deliberately CORRECT, same as in `folio-locked`: a wrong
         * one would get rejected at step 5 (`oracle-mismatch`), and a state
         * named "locked layer" would then be checking an entirely different
         * step.
         *
         * THE LAYER IS ADDED HERE, AFTER BOTH HIDDEN ONES, not next to
         * `folio-locked`: `doc.layers.add` puts a layer ON TOP, so placing it
         * elsewhere would have shifted `Numeratsiia` and `_folio-helper` in the
         * stack relative to the rest. The active layer is restored right away
         * — the same defect this fixture already tripped over once (three
         * states silently landing on the hidden layer).
         *
         * THE LOCK IS APPLIED LAST: you can't put a frame on a locked layer
         * ("Object is locked."), and it won't accept content or a style
         * either.
         */
        var activeBeforeLock = doc.activeLayer;
        var lockedLayer = doc.layers.add({ name: "Zablokovanyi" });
        doc.activeLayer = activeBeforeLock;
        var layerLockedFolio = frameOn(doc.pages[1], 20, 700, 200, 730);
        layerLockedFolio.itemLayer = lockedLayer;
        layerLockedFolio.contents = "–" + String(doc.pages[2].name);
        layerLockedFolio.insertionPoints[0].contents = SpecialCharacters.AUTO_PAGE_NUMBER;
        layerLockedFolio.paragraphs[0].appliedParagraphStyle = stFolio;
        lockedLayer.locked = true;
        states.push("folio-layer-locked");

        /*
         * `folio-rotated` — TWO frames, and the second isn't decorative.
         *
         * MEASURED BY A PROBE (a 200 × 40 pt frame, four corners via
         * `resolve(AnchorPoint.…, CoordinateSpaces.SPREAD_COORDINATES)`):
         *
         *   angle    bounding box, 4 corners     bounding box, 2 diagonal corners
         *   −90°     x 160.00 … 200.00           x 160.00 … 200.00   ← MATCH
         *   −37°     x  96.06 … 279.86           x 120.14 … 255.79   ← 24.08 narrower
         *                                                               on one side
         *
         * In other words, the bug "compute the bounding box from two diagonal
         * corners" is INVISIBLE on THIS book — all 91 frames are rotated by
         * exactly −90° — but on the next edition it would silently produce
         * "no overlap". Probe `H7` had exactly this defect and only found it
         * via a positive control.
         *
         * A SIDE MEASUREMENT WORTH KNOWING: a rotated frame's
         * `frame.geometricBounds` ALREADY returns the four-corner bounding box
         * (verified at both angles: the numbers match to the hundredth). So the
         * existing `IDMCP.frameBounds` is correct, and probe `H7`'s bug was in
         * the probe itself.
         *
         * `rotProbe` is a positive control: an empty 8 pt strip, flush against
         * the LEFT edge of the frame's bounding box at −37°. It's inside the
         * four-corner box and 16 pt to the left of the two-diagonal-corner box,
         * meaning only correct geometry will say "there's an overlap". The
         * bounds are taken FROM THE DOCUMENT (`rotOdd.geometricBounds` after
         * rotation), not from a layout constant.
         */
        var rot90 = frameOn(doc.pages[15], 60, 200, 260, 240);
        rot90.contents = "15–";
        rot90.insertionPoints[-1].contents = SpecialCharacters.AUTO_PAGE_NUMBER;
        rot90.paragraphs[0].appliedParagraphStyle = stFolio;
        rot90.rotationAngle = -90;

        var rotOdd = frameOn(doc.pages[15], 300, 300, 500, 340);
        rotOdd.contents = "15–";
        rotOdd.insertionPoints[-1].contents = SpecialCharacters.AUTO_PAGE_NUMBER;
        rotOdd.paragraphs[0].appliedParagraphStyle = stFolio;
        rotOdd.rotationAngle = -37;

        var rotBounds = rotOdd.geometricBounds;   /* [y1, x1, y2, x2] */
        var rotProbe = doc.pages[15].textFrames.add();
        rotProbe.geometricBounds = [
            rotBounds[0] + 8, rotBounds[1],
            rotBounds[2] - 8, rotBounds[1] + 8
        ];
        states.push("folio-rotated");

        /*
         * `folio-master-thread` — route B, Question 6.
         *
         * Two threaded frames on the MASTER spread: the left one on the master
         * verso, the right one on the master recto. Measured by a probe: after
         * threading, `textContainers.length === 2`, and
         * `previousTextFrame.parentPage.name` on the right frame returns
         * **"A"** — i.e. the MASTER's own page, not the document's. That's
         * exactly why a marker in such a frame has NOTHING TO RESOLVE against,
         * and exactly why §4.2 forbids counting an overlap with a master chain
         * as a reason to force the `thread` route.
         *
         * The cost of getting this wrong is measured: on the book, 90 of 91
         * folios had an overlap, every single one against a master. If they
         * counted, the phase would fix ONE frame out of 91 while reporting the
         * other 90 as "legitimate" skips.
         *
         * The document-level folio on p. "17" sits directly under the right
         * frame of this chain — without it there's no overlap for anyone to
         * see. The page is recto, so it sees specifically the master recto.
         */
        var mthreadV = frameOn(mverso, 300, 600, 560, 640);
        var mthreadR = frameOn(mrecto, 300, 600, 560, 640);
        mthreadV.nextTextFrame = mthreadR;
        var overMaster = frameOn(doc.pages[16], 300, 600, 560, 640);
        overMaster.contents = "16–";
        overMaster.insertionPoints[-1].contents = SpecialCharacters.AUTO_PAGE_NUMBER;
        overMaster.paragraphs[0].appliedParagraphStyle = stFolio;
        states.push("folio-master-thread");

        /*
         * `folio-marker-cross-spread` — the SECOND "defect that prints": the
         * marker RESOLVES, but the resulting pair of numbers isn't two pages of
         * the same spread.
         *
         * The chain deliberately jumps a spread: the previous frame is on
         * "17", this frame itself is on "18", and "18"'s spread partner is
         * "19". So it prints "17–18" — a pair that looks plausible and was
         * never actually a spread. This is the exact shape the 2026-08-04 defect
         * turns into AFTER the replacement: `folio-duplicates-auto` caught it
         * by LITERAL, which no longer exists after the replacement.
         *
         * The chain's frames are empty, so they add no assertions.
         */
        var crossPrev = frameOn(doc.pages[16], 20, 300, 200, 340);
        var crossHere = frameOn(doc.pages[17], 20, 300, 200, 340);
        crossPrev.nextTextFrame = crossHere;

        var crossFolio = frameOn(doc.pages[17], 20, 300, 200, 340);
        crossFolio.contents = "–";
        crossFolio.insertionPoints[0].contents = SpecialCharacters.PREVIOUS_PAGE_NUMBER;
        crossFolio.insertionPoints[-1].contents = SpecialCharacters.AUTO_PAGE_NUMBER;
        crossFolio.paragraphs[0].appliedParagraphStyle = stFolio;
        states.push("folio-marker-cross-spread");

        /*
         * `folio-both-threads` — a frame that overlaps BOTH chains at once: the
         * document one and the master one. Review `61134b5` measured that the
         * fixture had no such state at all (none of the 44 `overlaps` records
         * had both), and §4.2 decides its route on exactly this configuration.
         *
         * The document pair is placed exactly where the master chain sits, so
         * both land in the same frame's `overlaps`. The correct answer: filter
         * out the master one (Questions 6 and 13), take the document one — and
         * then the marker resolves against the spread neighbor, i.e. the frame
         * IS SUITABLE via the `thread` route. Until now the fixture had no
         * suitable frame via this route at all, meaning route A was only ever
         * checked through failures.
         *
         * The number is taken from the document — the neighbor at `offset` in
         * the marker's direction.
         */
        var bothPrev = frameOn(doc.pages[17], 300, 600, 560, 640);
        var bothHere = frameOn(doc.pages[18], 300, 600, 560, 640);
        bothPrev.nextTextFrame = bothHere;

        var bothFolio = frameOn(doc.pages[18], 300, 600, 560, 640);
        bothFolio.contents = String(doc.pages[17].name) + "–";
        bothFolio.insertionPoints[-1].contents = SpecialCharacters.AUTO_PAGE_NUMBER;
        bothFolio.paragraphs[0].appliedParagraphStyle = stFolio;
        states.push("folio-both-threads");

        /*
         * `folio-helper-layer-hidden` — the SECOND row of §4.9's table, which
         * no state had: `ThreadLink.layerVisible === false`.
         *
         * The folio frame sits on a VISIBLE layer, i.e. it prints; the chain
         * underneath it is on the hidden `_folio-helper`. Measured (Question
         * 8): in the PDF such a label came out as 13 instead of 12 — resolution
         * was LOST, and InDesign prints the current page's number with no
         * warning at all.
         *
         * THE CHAIN'S NEIGHBOR IS NAMED CORRECTLY, AND THAT'S THE POINT OF THIS
         * STATE: the preceding frame really does sit on the spread's
         * neighboring page. So without a `ThreadLink.layerVisible` check, the
         * marker would resolve to a LEGITIMATE number and there'd be no finding
         * at all — i.e. this state kills the mutant "drop the layer check",
         * not merely light up a branch.
         */
        var helpPrev = frameOn(doc.pages[19], 20, 300, 200, 340);
        var helpHere = frameOn(doc.pages[20], 20, 300, 200, 340);
        helpPrev.itemLayer = helperLayer;
        helpHere.itemLayer = helperLayer;
        helpPrev.nextTextFrame = helpHere;

        var helpFolio = frameOn(doc.pages[20], 20, 300, 200, 340);
        helpFolio.contents = "–";
        helpFolio.insertionPoints[0].contents = SpecialCharacters.PREVIOUS_PAGE_NUMBER;
        helpFolio.insertionPoints[-1].contents = SpecialCharacters.AUTO_PAGE_NUMBER;
        helpFolio.paragraphs[0].appliedParagraphStyle = stFolio;
        states.push("folio-helper-layer-hidden");

        /*
         * `folio-three-page-spread` — `spread-not-pair`.
         *
         * §4.3's reference is taken from `spreadSiblings`, i.e. from the
         * spread's composition as InDesign knows it, not from ±1 arithmetic. A
         * three-page spread has TWO neighbors (measured: p. "19" has both
         * "18" and "20"), so the question "which number should the frame
         * have named" has no answer, and the tool has to say so rather than
         * pick one of the two.
         *
         * It's also the second state where the page's coordinate system and
         * the master page's diverge: the spread's third page sits at position
         * 2 against the master's position 1 (the first such state was page
         * "1").
         */
        folioFrame(doc.pages[22], String(doc.pages[21].name) + "–", true, stFolio);
        states.push("folio-three-page-spread");

        /*
         * `folio-last-page` — the second half of `no-siblings`, and a spec §8
         * line the fixture had and lost (see the `tail` spread built above).
         *
         * Manual "0" — for the same reason as page "1": it has no spread
         * neighbor, so any other number would pretend a reference exists. §4.4
         * step 3 must refuse BEFORE the comparison.
         */
        folioFrame(doc.pages[24], "0–", true, stFolio);
        states.push("folio-last-page");

        /*
         * SAVING TO DISK IS OPTIONAL, AND THAT'S EXACTLY WHY IT STAYS BACKWARD
         * COMPATIBLE.
         *
         * The WRITE handlers (Phase 7) need a file: the backup folder is
         * derived from `doc.fullName.parent`, and an unsaved document has none
         * at all — `doc.saveACopy` then has nowhere to put a copy, and the
         * handler refuses to write (the same `!doc.saved` guard as in
         * `apply.jsx`). Calls WITHOUT `dir` (all of Phase 6: measurement,
         * audit, and state-guard tests) behave exactly as before — the
         * document stays unsaved and `doc.name` stays "Untitled-N".
         *
         * `doc.save` CHANGES `doc.name` to the file's name, so the name is
         * returned AFTER saving: the caller closes the document by that exact
         * name.
         */
        if (params && params.dir) {
            doc.save(new File(params.dir + "/pagination-fixture.indd"));
        }
        return { docName: String(doc.name), states: states, pages: doc.pages.length };
    } catch (e) {
        /*
         * Same reason as in __fixture_make: without doc.name the caller won't
         * know what to close — we close it here, while we still hold a
         * reference.
         */
        if (doc) {
            try { doc.close(SaveOptions.NO); } catch (closeErr) { /* не ховаємо оригінальну */ }
        }
        throw e;
    } finally {
        app.scriptPreferences.measurementUnit = previousUnit;
    }
};

/*
 * A SINGLE-SIDED PAGINATION FIXTURE — A SEPARATE DOCUMENT, AND THIS
 * ISN'T A STYLE CHOICE.
 *
 * Spec §8 requires a "`SINGLE_SIDED` document" state (oracle step 2),
 * and `page.side` equals `SINGLE_SIDED` exactly when
 * `documentPreferences.facingPages === false`. This is a WHOLE-DOCUMENT
 * switch: in a facing-pages document such a page can't exist in
 * principle (measured: all 25 pages of the main fixture are
 * `LEFT_HAND`/`RIGHT_HAND`), and flipping it on the main fixture would
 * mean destroying its spreads, i.e. every other state.
 *
 * THE SECOND THING THIS DOCUMENT CHECKS, and it's not incidental:
 * Question 17 measured that reconciling master bounds against the
 * document spread must be IDENTICAL here — page position 0, master
 * page position also 0, axes match. This is the only state that catches
 * the "always reconcile" bug, the mirror opposite of the already-caught
 * "never reconcile": on the facing-pages fixture that bug is invisible,
 * because there the offset is nonzero exactly where it's expected to
 * be.
 *
 * Three pages, not one: a single page couldn't tell "no neighbors
 * because the document is single-sided" apart from "no neighbors
 * because there's only one page".
 */
/*
 * A RUNNING-HEADS FIXTURE — A SEPARATE DOCUMENT, AND THIS ISN'T A
 * STYLE CHOICE.
 *
 * The same precedent as the single-sided fixture below. The first
 * attempt put the running-head states into the SHARED
 * `__fixture_make_pagination` fixture, and that broke six numeric
 * assertions across three other files: attaching a new master to
 * existing pages STRIPS them of their old master folios, i.e. it
 * changes exactly what those tests measure ("output changed silently"
 * — the name of one of them). The `head-missing` state is unreachable
 * in principle without a master, because the expectation "there should
 * be a running head here" is derived from the master.
 *
 * Hence — its own document. The shared fixture stays untouched.
 *
 * SIX STATES THAT THE WORKING BOOK DOESN'T HAVE A SINGLE ONE OF
 * (measured: four rules out of five give zero there). That's exactly
 * why the phase's acceptance sits here, while the book remains a
 * control run.
 */
IDMCP.handlers.__fixture_make_pagination_heads = function () {
    var previousUnit = app.scriptPreferences.measurementUnit;
    app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;
    var doc = null;
    var states = [];

    try {
        doc = app.documents.add();
        doc.documentPreferences.facingPages = true;
        doc.documentPreferences.pagesPerDocument = 12;

        var stHead = doc.paragraphStyles.add({ name: "Zagolovok" });
        var stKolontytul = doc.paragraphStyles.add({ name: "Kolontytul", pointSize: 10 });

        /*
         * The frame is placed as a FRACTION of the page, not absolute numbers:
         * the ruler unit is set by the document, and absolute numbers already
         * once cost the project a red test (C2). Here the units are our own
         * (POINTS above), but the rule is the same — geometry is derived from
         * the page bounds.
         */
        function frameAt(page, fx1, fy1, fx2, fy2) {
            var b = page.bounds;
            var h = b[2] - b[0];
            var w = b[3] - b[1];
            var f = page.textFrames.add();
            f.geometricBounds = [b[0] + h * fy1, b[1] + w * fx1, b[0] + h * fy2, b[1] + w * fx2];
            return f;
        }

        function headAt(page, label) {
            var f = frameAt(page, 0.10, 0.04, 0.90, 0.09);
            f.contents = label;
            f.paragraphs[0].appliedParagraphStyle = stKolontytul;
            return f;
        }

        /* ── Headings set the ranges: section 1 from p."3", section 2 from p."8" ── */
        var h1 = frameAt(doc.pages[2], 0.10, 0.30, 0.90, 0.40);
        h1.contents = "Rozdil pershyi";
        h1.paragraphs[0].appliedParagraphStyle = stHead;

        var h2 = frameAt(doc.pages[7], 0.10, 0.30, 0.90, 0.40);
        h2.contents = "Rozdil druhyi";
        h2.paragraphs[0].appliedParagraphStyle = stHead;
        states.push("heads-two-chapters");

        /* ── A master with a running head on VERSO ────────────────────────── */
        var kSpread = doc.masterSpreads.add();
        kSpread.baseName = "K";
        var kVerso = kSpread.pages[0];
        var kHead = frameAt(kVerso, 0.10, 0.04, 0.90, 0.09);
        kHead.contents = "Rozdil pershyi";
        kHead.paragraphs[0].appliedParagraphStyle = stKolontytul;

        /*
         * PAGES ARE TAKEN BY THEIR MEASURED SIDE, NOT BY INDEX. The first draft
         * assumed "odd index means verso" and produced zero master running
         * heads: side alternation isn't derivable from the index.
         */
        var versoIn = function (fromOffset, toOffset) {
            var out = [];
            for (var i = 0; i < doc.pages.length; i++) {
                if (i < fromOffset || i > toOffset) continue;
                if (String(doc.pages[i].side) !== String(PageSideOptions.LEFT_HAND)) continue;
                out.push(doc.pages[i]);
            }
            return out;
        };

        var inCh1 = versoIn(2, 6);
        var inCh2 = versoIn(7, 11);
        if (inCh1.length < 1 || inCh2.length < 2) {
            throw new Error("running-head fixture: ran out of verso pages in the gaps");
        }

        /* 1. The running head names its OWN section. */
        inCh1[0].appliedMaster = kSpread;
        states.push("head-correct-from-master");

        /* 2. The same master in SECTION 2 — its text is now foreign there. */
        inCh2[0].appliedMaster = kSpread;
        states.push("head-wrong-chapter");

        /*
         * 3. A page under the same master where the running head has been
         *    overridden and DELETED: the sheet is blank. A deliberately
         *    removed one is indistinguishable from a lost one (spec §6.3) —
         *    both are candidates.
         */
        inCh2[1].appliedMaster = kSpread;
        var ovHead = kHead.override(inCh2[1]);
        ovHead.remove();
        states.push("head-missing");

        /*
         * 4. A running head OUTSIDE any range: p."2" comes before the first
         *    heading at all.
         */
        headAt(doc.pages[1], "Rozdil pershyi");
        states.push("head-unexpected");

        /*
         * 5. A running head with a FOREIGN look — the twin of a finding on the
         *    real book, where "Передмова" is set in Proba Pro Light against
         *    Regular in the other seven. The text is deliberately correct for
         *    its section: the state has to be CLEAN with respect to section,
         *    otherwise two rules would fire on the same frame and the test
         *    couldn't tell which one is doing the work.
         */
        var stray = headAt(doc.pages[4], "Rozdil pershyi");
        stray.paragraphs[0].pointSize = 18;
        states.push("head-style-stray");

        /* 6. A running head on the WRONG SIDE: the rest sit on verso. */
        var rectoPage = null;
        for (var r = 2; r < 7; r++) {
            if (String(doc.pages[r].side) === String(PageSideOptions.RIGHT_HAND)) {
                rectoPage = doc.pages[r];
                break;
            }
        }
        if (rectoPage !== null) {
            headAt(rectoPage, "Rozdil pershyi");
            states.push("head-side-stray");
        }

        return { docName: String(doc.name), states: states, pages: doc.pages.length };
    } catch (e) {
        if (doc) {
            try { doc.close(SaveOptions.NO); } catch (closeErr) { /* не ховаємо оригінальну */ }
        }
        throw e;
    } finally {
        app.scriptPreferences.measurementUnit = previousUnit;
    }
};

IDMCP.handlers.__fixture_make_pagination_single = function () {
    var previousUnit = app.scriptPreferences.measurementUnit;
    app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;
    var doc = null;
    var states = [];

    try {
        doc = app.documents.add();
        doc.documentPreferences.facingPages = false;
        doc.documentPreferences.pagesPerDocument = 3;

        var stFolio = doc.paragraphStyles.add({ name: "Kolontsyfra" });

        /*
         * A master folio with the SAME offsets from the page corner as the
         * hand-drawn one below. It's exactly this pair — "same geometry,
         * different origin" — that makes an identity check possible: the
         * difference between the two `folioFrames` records must be zero.
         */
        var mpage = doc.masterSpreads[0].pages[0];
        var mb = mpage.bounds;
        var mfolio = mpage.textFrames.add();
        mfolio.geometricBounds = [mb[0] + 700, mb[1] + 20, mb[0] + 730, mb[1] + 200];
        mfolio.insertionPoints[0].contents = SpecialCharacters.AUTO_PAGE_NUMBER;
        mfolio.paragraphs[0].appliedParagraphStyle = stFolio;
        states.push("single-sided-master-folio");

        states.push("single-sided-page");

        /*
         * A manual number on the second page: without an assertion paragraph
         * carrying a literal, the oracle would have nothing to skip, and step 2
         * (`single-sided`) would stay unreachable. The number "1" is the
         * previous page's name, i.e. exactly what a typesetter would write out
         * of facing-pages habit; in a single-sided document it means nothing,
         * which is exactly why step 2 comes BEFORE the comparison.
         */
        var own = doc.pages[1];
        var ob = own.bounds;
        var drawn = own.textFrames.add();
        drawn.geometricBounds = [ob[0] + 700, ob[1] + 20, ob[0] + 730, ob[1] + 200];
        drawn.contents = "1–";
        drawn.insertionPoints[-1].contents = SpecialCharacters.AUTO_PAGE_NUMBER;
        drawn.paragraphs[0].appliedParagraphStyle = stFolio;
        states.push("single-sided-folio-manual");

        doc.name;
        return { docName: String(doc.name), states: states, pages: doc.pages.length };
    } catch (e) {
        if (doc) {
            try { doc.close(SaveOptions.NO); } catch (closeErr) { /* не ховаємо оригінальну */ }
        }
        throw e;
    } finally {
        app.scriptPreferences.measurementUnit = previousUnit;
    }
};

/*
 * THE SERVICE (HELPER) CHAIN FIXTURE (Phase 8 spec, §8.2). A SEPARATE
 * DOCUMENT.
 *
 * WHY NOT IN THE MAIN FIXTURE. That one has 25 pages and 24 named
 * states, and a service frame inevitably lands in every folio's
 * `overlaps` (measured, Phase 7 Question 20: the geometry matches
 * exactly) — a chain on every page would have overlapped half the
 * existing states. The same precedent as
 * `__fixture_make_pagination_single`: a DOCUMENT property, not a page
 * one.
 *
 * ONE STATE PER CALL, AND THAT'S NOT AN INCONVENIENCE. "A complete
 * chain" and "a chain with a gap" are mutually exclusive properties of
 * ONE document, so they can't be assembled together by construction.
 * The caller closes the document RIGHT AFTER each state, not at the
 * end.
 *
 * EVERY STATE IS BUILT EXACTLY AS THE PROBE MEASURED IT, NOT
 * "SIMILARLY". This matters most for `helper-chain-split`: it's
 * produced via `page.duplicate()`, because that's the action that gives
 * the measured layout (`H8`, Question 2 — the main story WITHOUT the
 * duplicated page, plus a single-frame story on it), and it's exactly
 * what an operator would actually see. Stitching two stories together
 * by hand would mean testing a state that doesn't occur in nature.
 */
IDMCP.handlers.__fixture_make_helper_chain = function (params) {
    var state = String((params && params.state) || "helper-chain-complete");
    var previousUnit = app.scriptPreferences.measurementUnit;
    app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;
    var doc = null;

    try {
        doc = app.documents.add();
        doc.documentPreferences.facingPages = true;
        doc.documentPreferences.pagesPerDocument = 6;
        while (doc.pages.length < 6) doc.pages.add();

        var layer = doc.layers.add({ name: "_folio-helper" });
        layer.visible = true;
        layer.printable = false;
        /*
         * `doc.layers.add` makes the layer active, and `textFrames.add()` puts
         * a frame on whichever layer is active — we set it explicitly, because
         * this is exactly what silently landed three Phase 7 fixture states on
         * a hidden layer.
         */
        doc.activeLayer = layer;

        /*
         * Bounds are FROM `page.bounds` of its own page: with `facingPages`, a
         * frame given absolute numbers lands geometrically on the NEIGHBORING
         * page.
         */
        function cornerBox(page) {
            var b = page.bounds;
            var y1 = Math.min(Number(b[0]), Number(b[2]));
            var x1 = Math.min(Number(b[1]), Number(b[3]));
            return [y1 + 20, x1 + 20, y1 + 44, x1 + 140];
        }

        function helperOn(page) {
            var f = page.textFrames.add();
            f.itemLayer = layer;
            f.geometricBounds = cornerBox(page);
            f.textWrapPreferences.textWrapMode = TextWrapModes.NONE;
            return f;
        }

        /* The page skipped in the `gap` state. −1 = don't skip. */
        var skip = (state === "helper-chain-gap") ? 3 : -1;

        /*
         * THE FOLIOS ARE NEEDED, AND NOT FOR LOOKS. The tool refuses loudly
         * when the declared style isn't in the document ("an empty report
         * would read as all-clear"), so without this style the repair can't be
         * called AT ALL. They also give the repair GEOMETRY DONORS: §4.2
         * requires the service frame to exactly match the folio's bounds, and
         * without a live folio that branch would never be checked.
         *
         * NO LITERALS, JUST AN AUTO-MARKER: a manual number would produce
         * `folio-manual` on every page and turn the negative control "a
         * complete chain → zero findings" into a check of something else.
         *
         * ON THE LAYOUT LAYER, not the service one: a non-empty frame on
         * `_folio-helper` is someone else's work, and the repair REFUSES to
         * touch it (the `helper-chain-foreign-item` state checks exactly
         * this).
         */
        var stFolio = doc.paragraphStyles.add({ name: "Kolontsyfra" });
        var bodyLayer = doc.layers[doc.layers.length - 1];
        for (var fi = 0; fi < doc.pages.length; fi++) {
            var fpage = doc.pages[fi];
            var folio = fpage.textFrames.add();
            folio.itemLayer = bodyLayer;
            folio.geometricBounds = cornerBox(fpage);
            folio.insertionPoints[0].contents = SpecialCharacters.AUTO_PAGE_NUMBER;
            folio.paragraphs[0].appliedParagraphStyle = stFolio;
        }

        var made = [];
        for (var i = 0; i < doc.pages.length; i++) {
            if (i === skip) continue;
            made.push(helperOn(doc.pages[i]));
        }

        if (state === "helper-chain-duplicate-on-page") {
            /*
         * A SECOND frame on the same page — the measured input C1 of Phase 7:
         * only the first folio gets a service frame, and the second one's
         * printed number changed ("2–3" → "3–3").
         */
            made.push(helperOn(doc.pages[2]));
        }

        if (state === "helper-chain-orphan-frame") {
            /*
         * The pasteboard: `parentPage` will be null. The offset is two page
         * widths to the left of the first, again measured from `page.bounds`.
         */
            var pb = doc.pages[0].bounds;
            var w = Math.abs(Number(pb[3]) - Number(pb[1]));
            var orphan = doc.textFrames.add();
            orphan.itemLayer = layer;
            orphan.geometricBounds = [Number(pb[0]), Number(pb[1]) - 2 * w,
                                      Number(pb[0]) + 24, Number(pb[1]) - 2 * w + 120];
            orphan.textWrapPreferences.textWrapMode = TextWrapModes.NONE;
            made.push(orphan);
        }

        if (state === "helper-chain-foreign-item") {
            /*
         * SOMEONE ELSE'S WORK ON OUR LAYER. The name `_folio-helper` isn't the
         * tool's private property (the `§` at `HELPER_LAYER_NAME`,
         * `src/pagination/topology.ts`), so the repair must not delete a frame
         * that has CONTENT — and that's exactly what `refusedToRemove` checks.
         * An empty frame wouldn't do here: non-emptiness is precisely the
         * signal the repair refuses on.
         */
            var fb = doc.pages[1].bounds;
            var foreign = doc.pages[1].textFrames.add();
            foreign.itemLayer = layer;
            foreign.geometricBounds = [Number(fb[0]) + 80, Number(fb[1]) + 20,
                                       Number(fb[0]) + 120, Number(fb[1]) + 200];
            foreign.contents = "foreign frame on our layer";
        }

        /*
         * THREADING. For `helper-chain-unordered` the two links are
         * deliberately swapped — and that can ONLY be done on the first
         * threading: measured (`H8`, Question 3) that assigning
         * `nextTextFrame` to an already-threaded frame throws "Invalid object
         * for this request.".
         */
        var order = [];
        for (var k = 0; k < made.length; k++) order.push(k);
        if (state === "helper-chain-unordered" && order.length >= 4) {
            var tmp = order[1]; order[1] = order[3]; order[3] = tmp;
        }
        for (var s = 0; s + 1 < order.length; s++) {
            made[order[s]].nextTextFrame = made[order[s + 1]];
        }

        if (state === "helper-chain-split") {
            /*
         * A MEASURED ACTION, NOT AN IMITATION OF ONE (`H8`, Question 2). Page
         * duplication copies the service frame but does NOT thread the copy
         * into the chain: the result is a frame on every page (i.e.
         * `pagesWithoutFrame` is EMPTY) with the main story's order still
         * monotonic — both of the other detectors stay blind, and the numbers
         * shift by one.
         */
            doc.pages[2].duplicate(LocationOptions.AFTER, doc.pages[2]);
        }

        if (state === "helper-chain-hidden-layer") {
            /*
         * Measured (Phase 7, Question 8): `visible = false` KILLS marker
         * resolution, `printable = false` does not.
         */
            layer.visible = false;
        }

        /*
         * SAVING TO DISK — ONLY ON REQUEST, AND THIS ISN'T A CONVENIENCE.
         * Both Phase 7's write handlers and the Phase 8 repair refuse on an
         * unsaved document (`doc.saved`), because there's nothing to build a
         * backup from. Read-only tests have no use for saving, and an extra
         * file in the user's folder is a cost too.
         */
        if (params && params.dir) {
            doc.save(new File(String(params.dir) + "/helper-chain.indd"));
        }

        return { docName: String(doc.name), states: [state], pages: doc.pages.length };
    } catch (e) {
        if (doc) {
            try { doc.close(SaveOptions.NO); } catch (closeErr) { /* не ховаємо оригінальну */ }
        }
        throw e;
    } finally {
        app.scriptPreferences.measurementUnit = previousUnit;
    }
};

/*
 * A preflight fixture: a document with a DELIBERATE overset.
 *
 * WHY ITS OWN FIXTURE, NOT __fixture_make (which also has an overset).
 * The shape of `aggregatedResults` can't be seen on a clean document:
 * there it's `["Untitled-268", "[Basic]", []]`, i.e. the list of
 * lines is empty and no depths are visible at all. So the only way to
 * keep the measured shape reproducible is a document that
 * guaranteed-gives levels 1–3. Tying this to a fixture whose exact
 * content a dozen unrelated tests depend on would mean the very first
 * extension of that fixture silently changes this measurement too.
 *
 * A SECOND page with a frame the text fits into — deliberate: without
 * it, "found an overset" is indistinguishable from "flagged overset
 * everywhere".
 */
IDMCP.handlers.__fixture_make_preflight = function () {
    /*
         * Same reason as in __fixture_make: this new document's ruler unit is
         * picas, and without POINTS the frame comes out 12 times too big, and
         * the deliberate overset simply never happens.
         */
    var previousUnit = app.scriptPreferences.measurementUnit;
    app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;
    var doc = null;
    try {
        doc = app.documents.add();
        doc.documentPreferences.pagesPerDocument = 2;

        var tight = doc.pages[0].textFrames.add();
        tight.geometricBounds = [20, 20, 30, 60];
        tight.contents =
            "Cei tekst navmysno ne vlizaie u ramku i daie overset, dovoli dovhyi " +
            "riadok tekstu dlia nadiinosti vymiru.";

        var roomy = doc.pages[1].textFrames.add();
        roomy.geometricBounds = [20, 20, 200, 300];
        roomy.contents = "Korotkyi tekst, iakyi vlizaie.";

        return { docName: String(doc.name), pages: doc.pages.length };
    } catch (e) {
        /*
         * Same reason as in __fixture_make: without doc.name the caller won't
         * know what to close — we close it here, while we still hold a
         * reference.
         */
        if (doc) {
            try { doc.close(SaveOptions.NO); } catch (closeErr) { /* не ховаємо оригінальну */ }
        }
        throw e;
    } finally {
        app.scriptPreferences.measurementUnit = previousUnit;
    }
};

/*
 * How many preflight processes are alive in the app. A process lives
 * OUTSIDE the document, so closing the fixture doesn't clean it up:
 * without this counter, "cleaned up after itself" would have to be
 * taken on faith from the very same code that writes the
 * processRemoved field.
 */
IDMCP.handlers.__fixture_preflight_process_count = function () {
    return app.preflightProcesses.length;
};

/*
 * Fixture for geometry_audit. Contains EXACTLY the states the working
 * book lacks (measured, H13) and without which the detector families
 * would be tested against empty ground:
 *
 *   - A NEAR MISS past the type-area edge — the frame family's main
 *     signal — and its negative control (an item sitting exactly on
 *     the type-area edge);
 *   - a gross overrun past the type area — NOT a finding (a negative
 *     control for the near miss);
 *   - an item beyond the bleed, and its negative control — an item
 *     exactly at the bleed;
 *   - a rotated frame (excluded from the alignment verdict);
 *   - text wrap in every mode (NONE on all 965 items in the book),
 *     including on a non-printable layer;
 *   - anchored items from three populations, including a zero-height
 *     ruler;
 *   - a locked item.
 *
 * WHAT'S DELIBERATELY MISSING HERE: the image family (a broken link, a
 * low-resolution raster, a vector with no ppi) — the script does NOT
 * place images, because that needs files on disk that don't exist in
 * this environment (the `note` field in the handler's own return value
 * says as much, honestly). That gap isn't closed here: the image
 * family is proven with a faked measurement in Task 8's unit tests, and
 * live graphics coverage comes from the run on the real book (Task
 * 14).
 *
 * Geometry is expressed AS FRACTIONS OF THE SHEET. Absolute numbers in
 * points once already sent a frame off to the pasteboard, because the
 * fixture's ruler was in picas (C2, Phase 9).
 */
IDMCP.handlers.__fixture_geometry = function (params) {
    var name = params && params.name ? params.name : "__geometry_fixture";
    var doc = app.documents.add();
    doc.name = name;

    var prev = app.scriptPreferences.measurementUnit;
    app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;
    try {
        var dp = doc.documentPreferences;
        dp.facingPages = true;
        dp.documentBleedTopOffset = 8.5;
        dp.documentBleedBottomOffset = 8.5;
        dp.documentBleedInsideOrLeftOffset = 0;
        dp.documentBleedOutsideOrRightOffset = 8.5;
        var W = dp.pageWidth;
        var H = dp.pageHeight;

        var page = doc.pages[0];
        var mp = page.marginPreferences;
        mp.top = H * 0.08;
        mp.bottom = H * 0.10;
        mp.left = W * 0.15;
        mp.right = W * 0.17;
        mp.columnCount = 1;

        var top = H * 0.08, left = W * 0.15;
        var bottom = H - H * 0.10, right = W - W * 0.17;

        /*
         * 1. EXACTLY on the type-area edge — the negative control for a near
         *    miss.
         */
        var exact = page.textFrames.add();
        exact.geometricBounds = [top, left, top + H * 0.05, right];
        exact.contents = "exactly on the grid";

        /*
         * 2. A NEAR MISS — 0.05 pt past the left type-area edge. The frame
         *    family's main signal.
         */
        var near = page.textFrames.add();
        near.geometricBounds = [top + H * 0.10, left - 0.05, top + H * 0.15, right];
        near.contents = "near miss";

        /*
         * 3. A GROSS overrun past the type area — 20% of the sheet width. NOT a
         *    finding: 62% of the book deliberately sits outside the type
         *    area.
         */
        var gross = page.textFrames.add();
        gross.geometricBounds = [top + H * 0.20, W * 0.02, top + H * 0.25, right];
        gross.contents = "deliberately past the grid";

        /*
         * 4. Past the BLEED — a frame-off-page finding. The bleed is 8.5 pt
         *    outside, so −20 on x is guaranteed to be past it.
         */
        var beyond = page.textFrames.add();
        beyond.geometricBounds = [top + H * 0.30, -20, top + H * 0.35, W * 0.30];
        beyond.contents = "past the bleed";

        /*
         * 5. EXACTLY at the bleed — the negative control for the previous
         *    one.
         */
        var inBleed = page.textFrames.add();
        inBleed.geometricBounds = [-8.5, W * 0.40, H * 0.05, W * 0.60];
        inBleed.contents = "full-bleed plate";

        /*
         * 6. A ROTATED frame — excluded from the alignment verdict.
         */
        var rot = page.textFrames.add();
        rot.geometricBounds = [top + H * 0.40, left - 0.05, top + H * 0.45, left + W * 0.10];
        rot.contents = "rotated";
        rot.rotationAngle = -90;

        /*
         * 7. TEXT WRAP — all three modes. The book has zero across 965 items,
         *    so the wrap family is proven EXCLUSIVELY here.
         */
        var wrapBox = page.rectangles.add();
        wrapBox.geometricBounds = [top + H * 0.50, left, top + H * 0.55, left + W * 0.10];
        wrapBox.textWrapPreferences.textWrapMode = TextWrapModes.BOUNDING_BOX_TEXT_WRAP;

        var wrapJump = page.rectangles.add();
        wrapJump.geometricBounds = [top + H * 0.57, left, top + H * 0.60, left + W * 0.10];
        wrapJump.textWrapPreferences.textWrapMode = TextWrapModes.JUMP_OBJECT_TEXT_WRAP;

        /*
         * 8. Text wrap on a NON-PRINTABLE layer — a wrap finding.
         *
         * MEASURED BY A LIVE RUN (not from a briefing draft): doc.layers.add()
         * makes the newly created layer ACTIVE, so without explicit restoration
         * EVERY item added AFTER this line (host/anchorNum/anchorLine/
         * lockedFrame) would silently land on "_geometry-nonprint" together
         * with wrapHidden — the first run produced 5 items on that layer
         * instead of the intended one, and the local locked/anchored state
         * would have turned out non-printable instead of ordinary. We capture
         * the active layer BEFORE creating the new one and restore IT right
         * after wrapHidden.
         *
         * Review fix round 1, Important: a bare assignment is NOT
         * exception-safe — the outer try/finally around the whole builder
         * (at the bottom of the file) only restores measurementUnit, not the
         * layer. If an exception had struck anywhere between
         * doc.layers.add(...) and the restore (page.rectangles.add(),
         * itemLayer=, geometricBounds=, textWrapMode=), the active layer would
         * have stayed on "_geometry-nonprint" FOREVER — and, worse, the
         * document wouldn't have closed: unlike __fixture_make, this function
         * doesn't call doc.close() in its own catch, the test would never
         * receive geoName from the failed call, and afterAll would skip
         * closing it — the fixture would hang in InDesign and corrupt the next
         * integration run. Its own try/finally here makes the layer restore
         * UNCONDITIONAL, whether or not this section fails (proven by
         * execution — see the task report, "Round 1" section).
         */
        var defaultLayer = doc.activeLayer;
        var hidden = doc.layers.add({ name: "_geometry-nonprint", printable: false });
        try {
            var wrapHidden = page.rectangles.add();
            wrapHidden.itemLayer = hidden;
            wrapHidden.geometricBounds = [top + H * 0.62, left, top + H * 0.65, left + W * 0.10];
            wrapHidden.textWrapPreferences.textWrapMode = TextWrapModes.BOUNDING_BOX_TEXT_WRAP;
        } finally {
            doc.activeLayer = defaultLayer;
        }

        /*
         * 9. ANCHORED items from three populations. The third is a
         *    ZERO-HEIGHT ruler: the book has 82 of these, and any check that
         *    divides by height breaks exactly here.
         */
        var host = page.textFrames.add();
        host.geometricBounds = [top + H * 0.70, left, bottom, right];
        host.contents = "anchored carrier\rsecond paragraph\rthird paragraph";

        var anchorNum = host.paragraphs[0].insertionPoints[0].textFrames.add();
        anchorNum.geometricBounds = [0, 0, 20, 28.3];
        anchorNum.contents = "1";

        var anchorLine = host.paragraphs[1].insertionPoints[0].graphicLines.add();
        anchorLine.geometricBounds = [0, 0, 0, W * 0.30];

        /*
         * 10. A LOCKED item and a LOCKED layer — two separate states.
         */
        var lockedFrame = page.textFrames.add();
        lockedFrame.geometricBounds = [top + H * 0.66, right - W * 0.05, top + H * 0.68, right];
        lockedFrame.contents = "locked";
        lockedFrame.locked = true;

        /*
         * 11. A VERSO PAGE — WITH NOTHING ON IT AT ALL, and that's exactly the
         *     point.
         *
         * Spec §9.4 requires the control on recto AND verso SEPARATELY, because
         * a margin-mirroring bug on the recto side is INVISIBLE. Before
         * 2026-08-15 this fixture had only one page (recto), so a double swap
         * of inside/outside — in both geometry.jsx and typeArea() — canceled
         * out into an identity, and no integration test had anywhere to see
         * that.
         *
         * No items are needed here: what's being checked is the type area
         * itself (`typeArea`), not landing inside it. So the fixture's item
         * count stays at 13.
         *
         * Margins are set EXPLICITLY and ASYMMETRICALLY: a new page inherits
         * the document's default (symmetric) margins, and with inside ===
         * outside even a broken mirroring gives the same result — the check
         * would be empty.
         */
        var verso = doc.pages.add();
        var vmp = verso.marginPreferences;
        vmp.top = H * 0.08;
        vmp.bottom = H * 0.10;
        vmp.left = W * 0.15;
        vmp.right = W * 0.17;
        vmp.columnCount = 1;

        return {
          name: String(doc.name),
          pages: doc.pages.length,
          versoSide: String(verso.side),
          note: "Images are NOT inserted by the script: files on disk are required. " +
                "The image family is proven by a faked measurement in unit tests."
        };
    } finally {
        app.scriptPreferences.measurementUnit = prev;
    }
};

/*
 * Fixture for Phase 14. Thirteen cases the working book does NOT have,
 * without which four families of color_audit detectors go entirely
 * unproven: the book has no table, no paragraph rule, no RGB, no spot
 * swatch, no overprint — and applies [Registration] to nothing.
 *
 *   1. [Registration] on an object               — the main breed that once cost a print run
 *   2. [Registration] on text
 *   3. TAC 340 on a solid                        — over the usual limit
 *   4. rich black under 8 pt                      — an incompatibility halo
 *   5. pure K under 8 pt                          — negative control for 4
 *   6. an RGB swatch
 *   7. a spot swatch                             — a fifth ink
 *   8. overprint on white                         — vanishes on paper
 *   9. color in a table cell
 *  10. color in a paragraph rule
 *  11. TAC 400 on a NON-PRINTABLE layer            — negative control for 1 and 3
 *      ([Registration] by itself gives 100/100/100/100 = TAC 400 when
 *      printed, so this one swatch proves both the printable gate and TAC
 *      at once)
 *  12. TAC 400 on a HIDDEN but printable layer     — negative control
 *      for the visible gate, distinct from 11: the reasons for not
 *      printing differ (Ruling 6, "Task 11")
 *  13. GraphicLine: [Registration] fill, Black stroke             —
 *      negative control for laysInk: a line's fill lays down no ink,
 *      an exact copy of 82 such lines in the working book (Ruling 8,
 *      "Task 11")
 *
 * A TRAP MEASURED IN PHASE 13 AND REPEATED HERE: doc.layers.add() makes
 * the new layer ACTIVE, so anything added after it silently lands on
 * it. We capture the active layer BEFORE creating the new one and
 * restore it right after, in a try/finally — a bare assignment is NOT
 * exception-safe.
 */
IDMCP.handlers.__fixture_color = function (params) {
    var name = params && params.name ? params.name : "__color_fixture";
    var doc = app.documents.add();
    doc.name = name;

    var prev = app.scriptPreferences.measurementUnit;
    app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;
    try {
        var page = doc.pages[0];
        var W = doc.documentPreferences.pageWidth;

        var registration = doc.swatches.itemByName("Registration");
        var black = doc.swatches.itemByName("Black");
        var paper = doc.swatches.itemByName("Paper");

        /*
         * Swatches that don't exist in a new document.
         */
        var heavy = doc.colors.add({
            name: "__важкий 340", model: ColorModel.PROCESS, space: ColorSpace.CMYK,
            colorValue: [90, 80, 80, 90]
        });
        var rich = doc.colors.add({
            name: "__збагачений чорний", model: ColorModel.PROCESS, space: ColorSpace.CMYK,
            colorValue: [76, 48, 66, 70]
        });
        var rgb = doc.colors.add({
            name: "__rgb", model: ColorModel.PROCESS, space: ColorSpace.RGB,
            colorValue: [255, 0, 0]
        });
        var spot = doc.colors.add({
            name: "__спот", model: ColorModel.SPOT, space: ColorSpace.CMYK,
            colorValue: [0, 90, 86, 0]
        });

        /*
         * 1. [Registration] on an object.
         */
        var regBox = page.rectangles.add();
        regBox.geometricBounds = [20, 20, 60, 120];
        regBox.fillColor = registration;

        /*
         * 3. TAC 340 on a solid.
         */
        var heavyBox = page.rectangles.add();
        heavyBox.geometricBounds = [70, 20, 110, 120];
        heavyBox.fillColor = heavy;

        /*
         * 6. RGB, APPLIED to an object.
         *
         * Applied, specifically, not merely added to the swatch palette. Until
         * this swatch existed, the `space` family's integration proof
         * ("finds RGB") passed ONLY via a false positive: the swatch was
         * judged as used (see the final review, C1). The swatch gate removed
         * that false positive, so the positive proof now has to stand on
         * genuine usage.
         */
        var rgbBox = page.rectangles.add();
        rgbBox.geometricBounds = [540, 20, 580, 120];
        rgbBox.fillColor = rgb;

        /*
         * 7. A spot color — the document's fifth ink. Likewise APPLIED: without
         *    this, the swatch gate would have removed the proof of the
         *    spot-applied rule too.
         */
        var spotBox = page.rectangles.add();
        spotBox.geometricBounds = [120, 20, 160, 120];
        spotBox.fillColor = spot;

        /*
         * 8. Overprint on white: visible on screen, vanishes on paper.
         *
         * MEASURED BY A LIVE RUN (InDesign 21.5.1.73), NOT FROM A BRIEFING
         * DRAFT: setting `overprintFill = true` on an item with fillColor
         * "Paper" throws "The property is not applicable in the current
         * state.". This isn't a coincidence or an assignment-order bug — twelve
         * combinations in a row threw the same exception: before and after
         * fillColor, through a single `.properties = {...}`, on
         * Rectangle/Oval/Polygon/GraphicLine/TextFrame, with a custom CMYK
         * 0/0/0/0 instead of the "Paper" swatch (i.e. the issue is ZERO ink,
         * not the swatch's name), and even INDIRECTLY: if overprintFill=true is
         * set on K=100% and only THEN the swatch's colorValue is brought to
         * zero, or the swatch is swapped via `.remove(replaceWith)`, the
         * exception on write disappears, but reading `item.overprintFill`
         * afterward throws the same exception anyway. InDesign simply doesn't
         * let the STATE "overprint enabled on zero ink" exist in a live
         * document — it's an invariant of the object model, not a temporary
         * restriction on one setter. So HERE we wrap the write in try/catch: if
         * some future InDesign version relaxes the invariant, the case will
         * appear on its own; on 21.5.1.73 it is DELIBERATELY absent, not
         * forgotten — documented in the task report
         * (batch-F-report.md, "Case 8").
         */
        var whiteOver = page.rectangles.add();
        whiteOver.geometricBounds = [170, 20, 210, 120];
        whiteOver.fillColor = paper;
        try { whiteOver.overprintFill = true; } catch (eWhiteOver) {}

        /*
         * 2. [Registration] on text + 4. rich black under 8 pt +
         *    5. pure K under 8 pt (negative control) +
         *   10. a colored paragraph rule.
         */
        var tf = page.textFrames.add();
        tf.geometricBounds = [220, 20, 340, W - 20];
        tf.contents = "приводка\rдрібний збагачений\rдрібний чистий";
        var paras = tf.parentStory.paragraphs;

        paras[0].texts[0].fillColor = registration;
        paras[0].pointSize = 9;

        paras[1].texts[0].fillColor = rich;
        paras[1].pointSize = 8;

        paras[2].texts[0].fillColor = black;
        paras[2].pointSize = 8;

        paras[2].ruleBelow = true;
        paras[2].ruleBelowColor = heavy;

        /*
         * 9. Color in a table cell.
         */
        var tableFrame = page.textFrames.add();
        tableFrame.geometricBounds = [350, 20, 420, W - 20];
        var tbl = tableFrame.parentStory.tables.add();
        tbl.columnCount = 2;
        tbl.bodyRowCount = 1;
        tbl.cells[0].fillColor = heavy;

        /*
         * 11. TAC 400 on a NON-PRINTABLE layer — a negative control.
         *
         * We capture the active layer BEFORE adding and restore it RIGHT AFTER,
         * in a try/finally: otherwise any exception between these lines would
         * leave the technical layer active forever (the Phase 13 trap).
         */
        var activeBefore = doc.activeLayer;
        var tech = doc.layers.add({ name: "__технічний", printable: false });
        try {
            var techBox = page.rectangles.add();
            techBox.itemLayer = tech;
            techBox.geometricBounds = [430, 20, 470, 120];
            techBox.fillColor = registration;
        } finally {
            doc.activeLayer = activeBefore;
        }

        /*
         * 12. TAC 400 on a HIDDEN (but printable) layer — a negative control
         * for the visible gate. Distinct from case 11: the reasons for not
         * printing differ, and each needs its own control (Ruling 6, "Task
         * 11").
         */
        var hiddenBefore = doc.activeLayer;
        var hidden = doc.layers.add({ name: "__прихований", printable: true, visible: true });
        try {
            var hiddenBox = page.rectangles.add();
            hiddenBox.itemLayer = hidden;
            hiddenBox.geometricBounds = [480, 20, 520, 120];
            hiddenBox.fillColor = registration;
        } finally {
            doc.activeLayer = hiddenBefore;
        }
        /*
         * visible is turned off LAST: you can't add an item to a hidden layer,
         * so we populate it first and hide it after.
         */
        hidden.visible = false;

        /*
         * 13. A line with a [Registration] FILL and a Black stroke.
         * Negative control for the laysInk gate: a line's fill prints nothing,
         * so there must be NO finding. An exact copy of 82 such lines in the
         * working book (Ruling 8, "Task 11").
         */
        var line = page.graphicLines.add();
        line.geometricBounds = [530, 20, 530, 360];
        line.fillColor = registration;
        line.strokeColor = black;
        line.strokeWeight = 0.4;

        return String(doc.name);
    } catch (e) {
        /*
         * Same reason as in __fixture_make: if it fails after the document is
         * created, it can't be left open — the next test run would see
         * someone else's active document.
         */
        if (doc) {
            try { doc.close(SaveOptions.NO); } catch (eClose) {}
        }
        throw e;
    } finally {
        app.scriptPreferences.measurementUnit = prev;
    }
};

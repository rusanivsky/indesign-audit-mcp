/*
 * Measurement for `preflight_document` — InDesign's native preflight.
 *
 * READ-ONLY. Creates its own `PreflightProcess`, reads the result, and
 * cleans up after itself. Does not modify the document: `doc.modified`
 * verified before and after.
 */

/*
 * The profile is looked up by ITERATION, not `itemByName`.
 *
 * Measured 2026-08-07: `app.preflightProfiles.itemByName("[Basic]")` returns
 * an invalid object — a name in square brackets can't be found through it.
 * This is the same family of trap as `RUNNING_HEADER_PARAGRAPH_STYLE_TYPE` in
 * Phase 6: looks obvious, silently doesn't work.
 */
IDMCP.findPreflightProfile = function (name) {
    for (var i = 0; i < app.preflightProfiles.length; i++) {
        if (String(app.preflightProfiles[i].name) === String(name)) {
            return app.preflightProfiles[i];
        }
    }
    return null;
};

IDMCP.preflightRules = function (profile) {
    var out = [];
    for (var i = 0; i < profile.preflightProfileRules.length; i++) {
        var rule = profile.preflightProfileRules[i];
        var flag = String(rule.flag);
        out.push({
            id: String(rule.id),
            flag: flag,
            enabled: flag !== "RULE_IS_DISABLED"
        });
    }
    return out;
};

/*
 * `aggregatedResults` is a TREE FLATTENED INTO A LIST: the first column of
 * each row is the depth (1 category, 2 rule, 3 case). Measured on a fixture
 * with a deliberate overset. The shape is normalized here so TypeScript
 * doesn't have to parse arrays of unknown depth.
 *
 * RETURNS NOT ONLY ROWS BUT ALSO COUNTERS. The first version, given an
 * unrecognized shape, returned an empty list with no trace, and then "0
 * violations" and "InDesign returned a shape we don't understand" produced
 * BYTE-FOR-BYTE the same answer. This is the same defect Phase 6 closed with
 * the checked/notCompared counters.
 */
IDMCP.preflightRows = function (agg) {
    var out = {
        shapeRecognised: false,
        rowsSeen: 0,
        rowsParsed: 0,
        pairsSeen: 0,
        pairsParsed: 0,
        rows: []
    };
    if (!(agg instanceof Array) || !(agg[2] instanceof Array)) return out;

    /*
     * Measured on a CLEAN document: the shape `["Untitled-268", "[Basic]", []]`.
     * That is, a recognized shape with zero rows is a legitimate state, which
     * is exactly why `shapeRecognised` is kept separate from `rowsSeen`.
     */
    out.shapeRecognised = true;

    var list = agg[2];
    out.rowsSeen = list.length;
    for (var i = 0; i < list.length; i++) {
        var r = list[i];
        if (!(r instanceof Array)) continue;

        var pairs = [];
        if (r[4] instanceof Array) {
            out.pairsSeen += r[4].length;
            for (var p = 0; p < r[4].length; p++) {
                var kv = r[4][p];
                if (kv instanceof Array && kv.length >= 2) {
                    pairs.push([String(kv[0]), String(kv[1])]);
                    out.pairsParsed++;
                }
            }
        }
        out.rows.push([Number(r[0]), String(r[1]), String(r[2]), String(r[3]), pairs]);
        out.rowsParsed++;
    }
    return out;
};

IDMCP.handlers.preflight_measure = function (params) {
    var doc = IDMCP.activeDoc();

    var profileName = params.profileName;
    if (!profileName) {
        profileName = String(doc.preflightOptions.preflightWorkingProfile);
    }

    var profile = IDMCP.findPreflightProfile(profileName);
    if (profile === null) {
        var names = [];
        for (var n = 0; n < app.preflightProfiles.length; n++) {
            names.push(String(app.preflightProfiles[n].name));
        }
        /*
         * A LOUD error, not an empty report. A typo in the profile name would
         * otherwise produce zero findings, which reads as "all clean" — exactly
         * the failure mode Phase 5 caught five times.
         */
        throw new Error(
            "Profile \"" + profileName + "\" does not exist. Available: " + names.join(", ")
        );
    }

    var available = [];
    for (var a = 0; a < app.preflightProfiles.length; a++) {
        available.push(String(app.preflightProfiles[a].name));
    }

    /*
     * Wait EXACTLY as long as the caller said. There's no default here on
     * purpose: `params.timeoutSeconds || 120` was dead code (TS always passes
     * a value) and dangerous at the same time — if it ever stopped passing
     * one, the JSX would silently wait for a different span than the outer
     * timeout expects.
     */
    var waitSeconds = Number(params.waitSeconds);
    if (!(waitSeconds > 0)) {
        throw new Error(
            "preflight_measure: the waitSeconds parameter was not passed or is not positive (" +
            String(params.waitSeconds) + "). How long to wait is the caller's decision, " +
            "because it alone knows its own outer timeout."
        );
    }

    var proc = null;
    var processRemoved = false;
    var parsed = null;
    var waitTimedOut = null;
    var aggDocName = String(doc.name);
    try {
        proc = app.preflightProcesses.add(doc, profile);

        /*
         * THE POLARITY OF `waitForProcess` IS MEASURED, AND IT'S THE OPPOSITE OF
         * WHAT THE NAME SUGGESTS. Control run on 2026-08-07 on ONE AND THE SAME
         * process:
         *
         * | call                | returned  | aggregatedResults          |
         * |---------------------|-----------|----------------------------|
         * | waitForProcess(0)   | true      | THROWS "not available"     |
         * | waitForProcess(60)  | false     | available, complete        |
         * | waitForProcess(60)  | false     | available (stable)         |
         *
         * That is, `true` means "did NOT finish waiting". The check
         * "if (!waited) throw", which the name invites, would fail EVERY
         * successful run.
         *
         * `proc.status` DOES NOT EXIST: reflect.properties gives targetObject,
         * appliedProfile, description, processResults, processInventory,
         * aggregatedResults, isValid, parent, index — and that's all.
         */
        waitTimedOut = proc.waitForProcess(waitSeconds);

        /*
         * SIGNAL 3 — A NON-POLAR VALUE. DEGRADES, DOES NOT THROW.
         *
         * This state used to be caught INDIRECTLY, by the `waitTimedOut !== false`
         * throw that was there for signal 2's sake. When signal 2 deliberately
         * stopped throwing (4d6da93), this check silently vanished along with it.
         *
         * WHY IT CAN'T BE SILENT, and why the mechanism is exactly this one, was
         * VERIFIED BY EXECUTION, because the first attempt described it
         * incorrectly. The report is serialized not by `JSON.stringify` but by
         * `IDMCP.stringify` (`_core.jsx:27-31`), which renders `"null"` for
         * `undefined`, `null`, AND `NaN` alike. So the field does NOT
         * disappear — it arrives as `null` in a field declared `boolean`, and
         * `buildCaveat` checks it by TRUTHINESS — in the `else if` branch, which
         * catches everything without `waitPolarity`. `null` is falsy, so no
         * loud line at all: the report would look like "finished, complete".
         *
         * WHY NOT THROW, even though it's tempting. The rows come from
         * `aggregatedResults` and DO NOT DEPEND on `waitForProcess` AT ALL — a
         * non-polar value only makes the COMPLETENESS of the listing unknown,
         * not the truthfulness of what's in it. This is exactly the same
         * reasoning that made signal 2 stop throwing, and it applies here just
         * the same. Throwing would also create a worse failure down the line:
         * if Adobe ever changes the return type, every run of the tool would
         * die instead of returning genuine findings.
         *
         * So: `waitTimedOut` becomes `true` — conservatively, because "completeness
         * not confirmed" is exactly that — while the raw value travels in a
         * separate field TOGETHER WITH ITS TYPE. Without `typeof`, the string
         * `"true"` and `new Boolean(true)` would render identically as "true" in
         * the report, so the field would say nothing about the cause.
         */
        var waitPolarity = null;
        if (waitTimedOut !== true && waitTimedOut !== false) {
            waitPolarity = typeof waitTimedOut + " " + String(waitTimedOut);
            waitTimedOut = true;
        }

        /*
         * A second check, independent of polarity: when the process hasn't
         * finished, `aggregatedResults` doesn't return emptiness, it THROWS
         * ("Aggregated Result for this process is not available"). That raw
         * message says nothing about the timeout, so we translate it into an
         * explanation.
         */
        var agg = null;
        var aggError = null;
        try {
            agg = proc.aggregatedResults;
        } catch (eAgg) {
            aggError = String(eAgg.message ? eAgg.message : eAgg);
        }

        if (aggError !== null) {
            throw new Error(
                "Preflight did not finish within " + waitSeconds + " s, so there is no result " +
                "(waitForProcess returned " +
                (waitPolarity === null ? String(waitTimedOut) : waitPolarity) +
                "; InDesign: " + aggError +
                "). The report is NOT returned: there is nothing to show. " +
                "Give it a bigger timeout or narrow the profile."
            );
        }

        /*
         * SIGNAL 2 DOES NOT THROW, AND THAT IS DELIBERATE.
         *
         * This point can only be reached in a state the measurement never
         * OBSERVED: the wait says "didn't finish", yet the result read out
         * anyway. Throwing here would be substantively wrong: preflight
         * findings are INDIVIDUALLY genuine — each one is a real violation in
         * the document. The timeout casts doubt on the COMPLETENESS of the
         * listing, not on the truthfulness of what's in it.
         *
         * Telling apart "correct but incomplete" from "complete" is exactly
         * what this tool does with "0 violations across six of 38 rules".
         * So the report is returned with waitTimedOut: true, and the caveat
         * gets the loudest block. This also makes the polarity genuinely
         * visible in the report: before this, the field could only ever be
         * false, because the throw sat BEFORE the result was returned.
         */

        if (agg instanceof Array) {
            aggDocName = String(agg[0]);
        }
        parsed = IDMCP.preflightRows(agg);
    } finally {
        /*
         * Cleanup is MANDATORY. The process lives in the application, not in
         * the document, so without this every call would leave behind an
         * entry in the Preflight panel.
         *
         * The exception here is swallowed DELIBERATELY — otherwise it would
         * shadow the original error that got us here in the first place. But
         * the fact itself travels in the report as the processRemoved field: a
         * silent cleanup failure is the only way the process stays alive.
         */
        if (proc !== null) {
            try {
                proc.remove();
                processRemoved = true;
            } catch (eRemove) {}
        }
    }

    return {
        docName: aggDocName,
        profileName: String(profile.name),
        workingProfile: String(doc.preflightOptions.preflightWorkingProfile),
        preflightOff: doc.preflightOptions.preflightOff,
        scope: String(doc.preflightOptions.preflightScope),
        rules: IDMCP.preflightRules(profile),
        rows: parsed.rows,
        availableProfiles: available,
        shapeRecognised: parsed.shapeRecognised,
        rowsSeen: parsed.rowsSeen,
        rowsParsed: parsed.rowsParsed,
        pairsSeen: parsed.pairsSeen,
        pairsParsed: parsed.pairsParsed,
        processRemoved: processRemoved,
        waitTimedOut: waitTimedOut,
        waitPolarity: waitPolarity
    };
};

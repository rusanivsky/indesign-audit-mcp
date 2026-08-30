/*
 * Handler for the `nbsp` layer. Non-breaking in InDesign is done by TWO
 * mechanisms: the U+00A0 character in the text, and the Text.noBreak
 * attribute (typically via a GREP style in the paragraph style). The first
 * is visible in `containers_read`, the second is not.
 *
 * Measured on the 2022 edition: U+00A0 — 15 per 1.5 million characters,
 * noBreak=true — 0 of 700 checked pairs. That is, there is no protection
 * there at all. But on an edition where the layout artist used a GREP
 * style, a detector without this handler would produce thousands of false
 * positives.
 *
 * The handler does NOT scan the document: the rule first finds candidates
 * in the text (thousands of them, not millions), and a batch of offsets
 * arrives here. Targeted reading instead of a full traversal — the same
 * decision that gave styles_audit 10.9s versus 340s in layout_measure.
 */
IDMCP.handlers.nobreak_read = function (params) {
    var doc = IDMCP.activeDoc();
    var queries = params && params.queries ? params.queries : [];
    var out = [];

    /* Cache by containerId: calling resolveContainer for each of ~9000
     * queries would be wasted work — there are dozens of containers,
     * thousands of queries. */
    var cache = {};

    for (var i = 0; i < queries.length; i++) {
        var q = queries[i];
        /* `hasOwn`, not `container === undefined`: `===` on a DOM object
         * sometimes THROWS (measured 2026-08-18). Checking the OWN key keeps
         * caching exact — otherwise a cached empty value would be resolved
         * again on each of thousands of queries. */
        if (!IDMCP.hasOwn(cache, q.containerId)) {
            cache[q.containerId] = IDMCP.resolveContainer(doc, q.containerId);
        }
        var container = cache[q.containerId];
        /* IDMCP.resolveContainer does NOT return falsy for an invalid
         * containerId — it throws an exception ("Index story out of
         * range: ..." etc.), and the exception fails the whole batch instead
         * of marking a single query as false. This is intentional: one bad
         * containerId means a desync between what the rule believes and
         * what the document shows — a loud failure right away is more
         * correct than a silent "not protected" at that query's place. */

        /*
         * MEASURED on live InDesign 2026 (the task brief was wrong here):
         * "characters.itemByRange(a, b).noBreak" returns neither a pure
         * boolean nor NothingEnum.NOTHING on a mixed range. It consistently
         * returns a JS Array with ONE element — the noBreak value of the
         * FIRST character of the range, regardless of whether the rest of
         * the characters have a different value. The comparison
         * "range.noBreak === true" is therefore always false (an array is
         * never strictly equal to true), and trusting the first element
         * would give a false "protected" on a mixed range (first character
         * true, another one not).
         *
         * Direct indexing "characters[i]" (WITHOUT itemByRange), on the
         * other hand, is measured to give a pure boolean on each individual
         * character — on uniform, on mixed, and on a just-set range alike.
         * So here we traverse character by character: a pair is protected
         * by the attribute only when noBreak===true on EVERY character of
         * the range [start, end).
         */
        var chars = container.characters;
        var end = q.end;
        if (end > chars.length) end = chars.length;
        /* Symmetrically for start too: a negative offset does not occur in
         * practice (candidates are counted by the TS side from the real
         * text), but without a clamp "start < end" on {start:-1, end:2}
         * would silently give false instead of throwing or an explicit
         * refusal — asymmetric bounds protection is worse than none: it
         * convinces you the bounds were checked when in fact they were
         * not. */
        var start = q.start;
        if (start < 0) start = 0;

        var protectedByAttr = start < end;
        for (var idx = start; idx < end; idx++) {
            if (chars[idx].noBreak !== true) {
                protectedByAttr = false;
                break;
            }
        }
        out.push(protectedByAttr);
    }

    return { answers: out };
};

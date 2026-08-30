/*
 * Runs arbitrary ExtendScript. The script must put its result into the
 * __result variable; it gets serialized back to JSON. Everything is wrapped
 * in a single undo step, so the effects can be reverted with one Cmd+Z.
 */
IDMCP.handlers.run_script = function (params) {
    var body = params.script;
    var undoName = params.undoName || "InDesign script";

    return IDMCP.withNoInteraction(function () {
        return IDMCP.withUndo(undoName, function () {
            var __result = null;
            eval(body);
            return __result;
        });
    });
};

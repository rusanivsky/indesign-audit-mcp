/* Core of the bridge: reading parameters, serializing the result, safety wrappers. */
var IDMCP = {};
IDMCP.handlers = {};

IDMCP.readFile = function (path) {
    var f = new File(path);
    f.encoding = "UTF-8";
    f.open("r");
    var s = f.read();
    f.close();
    return s;
};

IDMCP.writeFile = function (path, text) {
    var f = new File(path);
    f.encoding = "UTF-8";
    f.open("w");
    f.write(text);
    f.close();
};

/* The input file is written by our own server into our own temp folder, so eval is safe. */
IDMCP.parse = function (text) {
    return eval("(" + text + ")");
};

/*
 * `undefined` У ВЛАСТИВОСТІ ОБ'ЄКТА ВИПУСКАЄТЬСЯ, ЯК І В JSON.stringify.
 *
 * Доти воно ставало `"key": null`, і це не косметика: інтерфейси на боці TS
 * писані під конвенцію Node, тобто з НЕОБОВ'ЯЗКОВИМИ полями (`JsxResult.data?`,
 * `runWrite` з `backupPath?: string`). Обробник, що повернув
 * `{ backupPath: undefined }`, давав на тому боці `{ backupPath: null }` —
 * `"backupPath" in result` істинне, а перевірка `result.backupPath ? … : …`
 * тихо йшла гілкою «копії не робилося» для поля, якого просто не задавали.
 *
 * На верхньому рівні (`stringify(undefined)`) лишається `null`: там немає
 * ключа, який можна випустити, а порожня відповідь зламала б розбір.
 */
IDMCP.stringify = function (value) {
    var t = typeof value;
    if (value === null || t === "undefined") return "null";
    if (t === "number") return isFinite(value) ? String(value) : "null";
    if (t === "boolean") return value ? "true" : "false";
    if (t === "string") return IDMCP.quote(value);

    var parts = [];
    var i;
    if (value instanceof Array) {
        for (i = 0; i < value.length; i++) parts.push(IDMCP.stringify(value[i]));
        return "[" + parts.join(",") + "]";
    }
    for (var k in value) {
        if (typeof value[k] === "undefined") continue;
        if (!value.hasOwnProperty(k)) continue;
        if (typeof value[k] === "function") continue;
        parts.push(IDMCP.quote(k) + ":" + IDMCP.stringify(value[k]));
    }
    return "{" + parts.join(",") + "}";
};

IDMCP.quote = function (s) {
    var out = '"';
    for (var i = 0; i < s.length; i++) {
        var c = s.charAt(i);
        var code = s.charCodeAt(i);
        if (c === '"') out += '\\"';
        else if (c === "\\") out += "\\\\";
        else if (code === 8) out += "\\b";
        else if (code === 9) out += "\\t";
        else if (code === 10) out += "\\n";
        else if (code === 12) out += "\\f";
        else if (code === 13) out += "\\r";
        else if (code < 32) {
            var hex = code.toString(16);
            while (hex.length < 4) hex = "0" + hex;
            out += "\\u" + hex;
        } else out += c;
    }
    return out + '"';
};

/* Used by the write handlers from Task 8 — disables InDesign dialogs for the duration of the
 * call and always restores the previous value. */
IDMCP.withNoInteraction = function (fn) {
    var previous = app.scriptPreferences.userInteractionLevel;
    app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;
    try {
        return fn();
    } finally {
        app.scriptPreferences.userInteractionLevel = previous;
    }
};

/* The whole batch of changes becomes one step in the undo history. */
IDMCP.withUndo = function (name, fn) {
    var box = {};
    app.doScript(
        function () {
            box.value = fn();
        },
        ScriptLanguage.JAVASCRIPT,
        undefined,
        UndoModes.ENTIRE_SCRIPT,
        name
    );
    return box.value;
};

/* ES3 has no Array.prototype.indexOf. */
IDMCP.indexOf = function (arr, value) {
    for (var i = 0; i < arr.length; i++) if (arr[i] === value) return i;
    return -1;
};

IDMCP.activeDoc = function () {
    if (app.documents.length === 0) {
        throw new Error("NO_DOCUMENT: no documents are open in InDesign.");
    }
    return app.activeDocument;
};

/* Turns a text index into a non-negative integer; a non-numeric, negative,
 * or out-of-range index is an explicit error, not a silent NaN or an
 * exception with unclear text. length can be omitted if the caller checks the bound itself. */
IDMCP.parseIndex = function (text, label, length) {
    if (!/^\d+$/.test(String(text))) {
        throw new Error("Invalid index " + label + ": \"" + text + "\" (expected a non-negative integer).");
    }
    var n = parseInt(text, 10);
    if (length !== undefined && n >= length) {
        throw new Error("Index " + label + " out of range: " + n + " (total " + length + ").");
    }
    return n;
};

/*
 * containerId — an opaque string:
 *   "story:3"                      main text of story 3
 *   "story:3/table:0/cell:2,1"     a table cell
 *   "story:3/footnote:5"           a footnote
 *
 * Any unknown or malformed segment throws an explicit error — a loud
 * failure right away is better than a silent correction landing in the
 * wrong container (e.g. the typo "footnotes" instead of "footnote" used to
 * silently return the whole story).
 * Always returns Text (one type for any path), not sometimes Story, sometimes Text.
 */
IDMCP.resolveContainer = function (doc, containerId) {
    var parts = containerId.split("/");
    var head = parts[0].split(":");

    if (head[0] !== "story") {
        throw new Error("Invalid containerId: expected prefix \"story:\", got \"" + parts[0] + "\".");
    }
    var storyIndex = IDMCP.parseIndex(head[1], "story", doc.stories.length);

    /* container is always Text (not Story), so the result type is the same for any path. */
    var container = doc.stories[storyIndex].texts[0];

    for (var i = 1; i < parts.length; i++) {
        var seg = parts[i].split(":");

        if (seg[0] === "table") {
            var tableIndex = IDMCP.parseIndex(seg[1], "table", container.tables.length);
            container = container.tables[tableIndex];
        } else if (seg[0] === "cell") {
            if (!container.rows) {
                throw new Error("Segment \"cell:\" without a preceding \"table:\" in containerId \"" + containerId + "\".");
            }
            var rc = seg[1].split(",");
            if (rc.length !== 2) {
                throw new Error("Invalid cell index: \"" + seg[1] + "\" (expected \"row,column\").");
            }
            var rowIndex = IDMCP.parseIndex(rc[0], "cell row", container.rows.length);
            var colIndex = IDMCP.parseIndex(rc[1], "cell column", container.columns.length);
            container = container.rows[rowIndex].cells[colIndex].texts[0];
        } else if (seg[0] === "footnote") {
            var footnoteIndex = IDMCP.parseIndex(seg[1], "footnote", container.footnotes.length);
            container = container.footnotes[footnoteIndex].texts[0];
        } else {
            throw new Error("Unknown containerId segment: \"" + parts[i] + "\" (in \"" + containerId + "\").");
        }
    }
    return container;
};

IDMCP.run = function (handlerName) {
    var result;
    try {
        var params = IDMCP.parse(IDMCP.readFile($.global.__IDMCP_PARAMS));
        var handler = IDMCP.handlers[handlerName];
        if (!handler) throw new Error("Unknown handler: " + handlerName);
        result = { ok: true, data: handler(params) };
    } catch (e) {
        result = {
            ok: false,
            error: {
                message: String(e.message || e),
                line: e.line ? e.line : -1,
                /*
                 * ФАЙЛ, А НЕ ЛИШЕ РЯДОК, — інакше номер рядка нікуди не
                 * прикласти. Кожен модуль вантажиться окремим `$.evalFile`
                 * саме заради того, щоб `e.line` був номером У СВОЄМУ файлі
                 * (`runner.ts` це пояснює), але назва файла не записувалась —
                 * і вся вигода зникала одним шаром вище: у `pagination.jsx`,
                 * `map.jsx`, `apply.jsx`, `color.jsx` і `composition.jsx` є
                 * свій рядок 453, а назва обробника модуля не називає.
                 * `e.fileName` в ExtendScript є; беремо базове ім'я.
                 */
                fileName: e.fileName ? String(e.fileName).replace(/^.*[\/\\]/, "") : "",
                source: e.source ? String(e.source).substr(0, 400) : ""
            }
        };
    }
    IDMCP.writeFile($.global.__IDMCP_RESULT, IDMCP.stringify(result));
};

/*
 * A2. A write handler leaves a trace of its life: the MCP side sees behind
 * it that the previous call is still working, even if osascript has
 * already been killed by timeout. touch() is called from the correction
 * loop — no less often than every few seconds.
 *
 * THE `phase` FIELD (Phase 3, W2, round 2). Without it the MCP side could
 * not distinguish "just started doc.saveACopy of a 196-page book" (where
 * a minute or more MAY pass before the next touch — inside the synchronous
 * ExtendScript call itself there is no way to touch a file) from "the
 * correction has actually hung". Both cases left a trace of the same age,
 * and the MCP could only judge them by HEARTBEAT_STALE_MS = 20s — a limit
 * sized for the rhythm of the CORRECTION LOOP, not for a copy.
 *
 * `phase` lives in the CLOSURE, not in write()'s argument: the call is
 * written FIRST, even BEFORE fn (the handler body) has started executing
 * at all — and that is exactly when the "copy" phase is needed. `touch`,
 * which receives fn, takes an OPTIONAL argument: without it, it keeps the
 * current phase (for touches inside the correction loop, where the phase
 * is already "edits" and there is nothing to switch to); with an argument,
 * it switches once and for good (the "copy" → "edits" transition happens
 * exactly once, right after doc.saveACopy — see apply.jsx).
 */
IDMCP.withHeartbeat = function (path, handlerName, docName, fn) {
    if (!path) return fn(function () {});

    var file = new File(path);
    var startedAt = new Date().getTime();
    var phase = "copy";

    var write = function () {
        var payload =
            '{"startedAt":' + startedAt +
            ',"touchedAt":' + new Date().getTime() +
            ',"handler":' + IDMCP.quote(handlerName) +
            ',"docName":' + IDMCP.quote(docName) +
            ',"phase":' + IDMCP.quote(phase) + "}";
        file.encoding = "UTF-8";
        if (file.open("w")) {
            file.write(payload);
            file.close();
        }
    };

    var touch = function (nextPhase) {
        if (nextPhase) phase = nextPhase;
        write();
    };

    write();
    try {
        return fn(touch);
    } finally {
        /* We remove the trace unconditionally — otherwise a stale file would have
         * to wait out HEARTBEAT_STALE_MS before the next write. */
        try { file.remove(); } catch (e) {}
    }
};

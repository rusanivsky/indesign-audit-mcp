/* Зонд TextPath (§1 промпту сесії 4). ЛИШЕ ЧИТАННЯ.
 *
 * ПИТАННЯ. `layout_measure` упав двічі на одному й тому самому класі
 * об'єкта: спершу на `parentPage` (map.jsx:551), після фіксу — на
 * `rotationAngle` (map.jsx:558). Промпт §1 забороняє лагодити наступний
 * рядок і вимагає ВИМІРЯТИ, які саме властивості кидають.
 *
 * ЩО РОБИТЬ. Обходить `doc.stories[*].textContainers`, класифікує кожен
 * контейнер (constructor.name + reflect.name), і для КОЖНОГО контейнера, що
 * не є звичайним TextFrame, читає по черзі кожну властивість, яку читає
 * літерал `map.jsx:554-566` і сусідні проходи (styles.jsx, composition.jsx,
 * cli-extras.jsx), кожну — у власному try/catch. Записує ok+значення або
 * текст винятку.
 *
 * ГАРАНТІЇ ЧИТАЛЬНОСТІ. Жодного add()/remove()/override()/save()/close().
 * Єдине присвоєння — одиниці ЗАСТОСУНКУ, з відновленням у finally.
 * `doc.modified` знімається до й після.
 */

var previousUnit = app.scriptPreferences.measurementUnit;
app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;

var out = {
    app: { version: String(app.version) },
    notes: [],
    kinds: {},           /* назва класу -> скільки контейнерів */
    suspects: [],        /* повний звіт по кожному не-TextFrame контейнеру */
    threw: []
};
function say(s) { out.notes.push(String(s)); }

/* Назва класу об'єкта, стійка до мінімізації: спершу constructor.name,
 * потім reflect.name. Обидва читання — у try, бо на екзотичних об'єктах
 * і вони кидають. */
function kindOf(o) {
    var byCtor = null, byReflect = null;
    try { if (o.constructor && o.constructor.name) byCtor = String(o.constructor.name); } catch (e1) {}
    try { if (o.reflect && o.reflect.name) byReflect = String(o.reflect.name); } catch (e2) {}
    return { ctor: byCtor, reflect: byReflect, name: byReflect || byCtor || "?" };
}

/* Читає одну властивість у власному try. Повертає {ok, value} або {ok:false, err}. */
function probe(rec, label, fn) {
    try {
        var v = fn();
        var shown;
        if (v === null || v === undefined) shown = String(v);
        else if (typeof v === "object") shown = "[object " + kindOf(v).name + "]";
        else shown = String(v);
        if (shown.length > 120) shown = shown.substr(0, 120) + "…";
        rec.props.push({ prop: label, ok: true, value: shown });
    } catch (e) {
        rec.props.push({ prop: label, ok: false, err: String(e) + (e.line ? (" [рядок " + e.line + "]") : "") });
    }
}

try {
    var doc = app.activeDocument;
    out.docName = String(doc.name);
    out.pageCount = doc.pages.length;
    out.modifiedBefore = doc.modified;

    var t0 = new Date().getTime();
    var stories = doc.stories;
    out.storyCount = stories.length;
    var containerTotal = 0;

    for (var s = 0; s < stories.length; s++) {
        var containers;
        try { containers = stories[s].textContainers; }
        catch (eSC) { if (out.threw.length < 40) out.threw.push("story " + s + ".textContainers: " + String(eSC)); continue; }

        for (var c = 0; c < containers.length; c++) {
            var fr = containers[c];
            containerTotal++;
            var k = kindOf(fr);
            out.kinds[k.name] = (out.kinds[k.name] || 0) + 1;

            if (k.name === "TextFrame") continue;
            if (out.suspects.length >= 40) continue;

            var rec = {
                storyIndex: s,
                containerIndex: c,
                kind: k,
                props: []
            };

            /* --- рівно те, що читає літерал map.jsx:554-566 --- */
            probe(rec, "id", function () { return fr.id; });
            probe(rec, "parentPage", function () { return fr.parentPage; });
            probe(rec, "rotationAngle", function () { return fr.rotationAngle; });
            probe(rec, "previousTextFrame", function () { return fr.previousTextFrame; });
            probe(rec, "nextTextFrame", function () { return fr.nextTextFrame; });
            probe(rec, "overflows", function () { return fr.overflows; });
            probe(rec, "parent", function () { return fr.parent; });

            /* --- резервний шлях pageNameFor (inspect.jsx:121) --- */
            probe(rec, "parent.constructor.name", function () { return fr.parent.constructor.name; });
            probe(rec, "parent.parentPage", function () { return fr.parent.parentPage; });
            probe(rec, "parent.parentPage.name", function () { return fr.parent.parentPage.name; });
            probe(rec, "parent.id", function () { return fr.parent.id; });
            probe(rec, "parent.rotationAngle", function () { return fr.parent.rotationAngle; });
            probe(rec, "parent.geometricBounds", function () { return String(fr.parent.geometricBounds); });
            probe(rec, "parent.parent", function () { return fr.parent.parent; });

            /* --- решта того, що читають сусідні проходи по контейнерах --- */
            probe(rec, "geometricBounds", function () { return String(fr.geometricBounds); });
            probe(rec, "characters.length", function () { return fr.characters.length; });
            probe(rec, "characters[0].index", function () { return fr.characters.length ? fr.characters[0].index : -1; });
            probe(rec, "lines.length", function () { return fr.lines.length; });
            probe(rec, "paragraphs.length", function () { return fr.paragraphs.length; });
            probe(rec, "contents.length", function () { return String(fr.contents).length; });
            probe(rec, "textFramePreferences", function () { return fr.textFramePreferences; });
            probe(rec, "itemLayer.name", function () { return fr.itemLayer.name; });
            probe(rec, "visibleBounds", function () { return String(fr.visibleBounds); });
            probe(rec, "insertionPoints.length", function () { return fr.insertionPoints.length; });
            probe(rec, "textColumns.length", function () { return fr.textColumns.length; });
            probe(rec, "hasOwnProperty('baseName')", function () { return fr.hasOwnProperty && fr.hasOwnProperty("baseName"); });
            probe(rec, "parent hasOwnProperty('baseName')", function () { return fr.parent.hasOwnProperty && fr.parent.hasOwnProperty("baseName"); });

            /* --- що каже сам об'єкт про свої властивості --- */
            probe(rec, "reflect.properties.length", function () { return fr.reflect.properties.length; });

            out.suspects.push(rec);
        }
    }

    out.containerTotal = containerTotal;
    out.ms = new Date().getTime() - t0;
    out.modifiedAfter = doc.modified;
    say("Читальність: modified до=" + out.modifiedBefore + ", після=" + out.modifiedAfter);
} catch (fatal) {
    out.fatal = String(fatal) + (fatal.line ? (" (рядок " + fatal.line + ")") : "");
} finally {
    app.scriptPreferences.measurementUnit = previousUnit;
}

__result = out;

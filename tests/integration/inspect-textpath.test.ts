import { afterEach, describe, expect, it } from "vitest";
import { runJsx } from "../../src/bridge/runner.js";
import { assertFixtureActive, closeFixtureDoc, makeFixtureDoc } from "./fixture-doc.js";
import type { ContainerSnapshot } from "../../src/corrections/types.js";

/*
 * Задача 14. Виміряний факт (2026-08-11, InDesign 21.5.1.73, живий документ
 * «02 Зоряні Мрії 2022 Print 3.indd», story:21): для тексту, покладеного
 * вздовж контуру (TextPath), звернення `frame.parentPage` не повертає
 * undefined — воно КИДАЄ ("Object does not support the property or method
 * 'parentPage'"). До виправлення `IDMCP.pageRunsFor` (inspect.jsx) це
 * валило `containers_read` цілком на будь-якій story, що містить хоч один
 * такий контейнер, — а на `containers_read` стоять typography_audit,
 * corrections_plan і bibliography_audit. Цей тест відтворює той самий
 * контейнер (Oval → TextPath) на фікстурі й перевіряє, що containers_read
 * більше не кидає.
 */

function addTextPathScript(text: string): string {
  return [
    "var previousUnit = app.scriptPreferences.measurementUnit;",
    "app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;",
    "try {",
    "  var doc = app.activeDocument;",
    "  var oval = doc.pages[0].ovals.add();",
    "  oval.geometricBounds = [400, 60, 500, 160];",
    "  var tp = oval.textPaths.add();",
    `  tp.contents = ${JSON.stringify(text)};`,
    "  var storyIndex = -1;",
    "  for (var si = 0; si < doc.stories.length; si++) {",
    "    if (doc.stories[si] === tp.parentStory) { storyIndex = si; break; }",
    "  }",
    "  __result = storyIndex;",
    "} finally {",
    "  app.scriptPreferences.measurementUnit = previousUnit;",
    "}",
  ].join("\n");
}

describe("containers_read: текст уздовж контуру (TextPath) не валить читання", () => {
  let docName: string | undefined;

  afterEach(async () => {
    /* Спрацьовує і після падіння `it` — фікстура не лишиться висіти
     * відкритою через провалений expect (той самий патерн, що й у
     * bibliography-audit.test.ts). afterEach, а НЕ afterAll: у цьому файлі
     * поки один тест, але правило Задачі 12 — кожен `it` відповідає за
     * власну фікстуру, щоб файл лишався безпечним і при додаванні тестів. */
    if (docName) await closeFixtureDoc(docName);
  });

  it("containers_read не кидає й повертає контейнер TextPath", async () => {
    docName = await makeFixtureDoc();
    await assertFixtureActive(docName);

    const storyIndex = await runJsx<number>("run_script", {
      script: addTextPathScript("Текст уздовж контуру фікстури"),
      undoName: "Тест: додати TextPath на овал",
    });
    expect(storyIndex).toBeGreaterThanOrEqual(0);

    await assertFixtureActive(docName);

    const r = await runJsx<{ containers: ContainerSnapshot[] }>("containers_read", {});

    const id = `story:${storyIndex}`;
    const container = r.containers.find((c) => c.containerId === id);
    expect(container).toBeTruthy();
    expect(container!.text).toContain("Текст уздовж контуру фікстури");
    /* pageRuns не мусить лишитися порожнім — резервний шлях (frame.parent.parentPage,
     * для TextPath це графічний власник Oval) повинен визначити сторінку. */
    expect(container!.pageRuns.length).toBeGreaterThan(0);
    /*
     * Рецензія: самої довжини > 0 замало — "лінива" реалізація, яка одразу
     * здається на першому catch і завжди повертає "монтажний стіл" (теж не
     * кидає, теж непорожній масив), лишила б цей тест зеленим. Овал додано
     * саме на doc.pages[0] (addTextPathScript), тому резервний шлях мусить
     * повернути справжню назву першої сторінки — той самий рядок "1", який
     * inspect.test.ts:51 і :183 перевіряють для звичайних TextFrame.
     */
    expect(container!.pageRuns[0]!.page).toBe("1");
  });
});

import { afterAll, describe, expect, it } from "vitest";
import { runJsx } from "../../src/bridge/runner.js";
import { assertFixtureActive, closeFixtureDoc, makeFixtureDoc } from "./fixture-doc.js";

/*
 * `nobreak_read` бачить ДРУГИЙ механізм нерозривності — атрибут Text.noBreak
 * (типово застосований через GREP-стиль), який не видно у звичайному читанні
 * тексту story (спек §0.5, §7.2). Стандартна фікстура (__fixture_make) не
 * ставить noBreak ніде сама, тож ставимо його вручну через run_script на
 * story:0 (перша story — story f1, "Kyiv — stolytsia Ukrainy. Cei tekst
 * mistyt slovo pomylka dlia testu.") і перевіряємо, що nobreak_read бачить
 * саме ту пару, на яку його поставлено, і не бачить сусідню.
 */
describe("nobreak_read", () => {
  let docName: string | undefined;

  afterAll(async () => {
    if (docName) await closeFixtureDoc(docName);
  });

  it("бачить noBreak=true там, де його поставлено, і false там, де ні", async () => {
    docName = await makeFixtureDoc();
    await assertFixtureActive(docName);

    /* Ставимо noBreak на один символ (індекс 2, "i" у "Kyiv") у story:0.
     * `run_script` кладе результат виклику в __result — тут ми його
     * не потребуємо, тож лишаємо null. */
    await runJsx("run_script", {
      script: "app.activeDocument.stories[0].texts[0].characters.itemByRange(2, 2).noBreak = true;",
      undoName: "Тест: nobreak_read setup",
    });

    const res = await runJsx<{ answers: boolean[] }>("nobreak_read", {
      queries: [
        { containerId: "story:0", start: 2, end: 3 },
        { containerId: "story:0", start: 5, end: 6 },
      ],
    });

    expect(res.answers).toEqual([true, false]);
  });
});

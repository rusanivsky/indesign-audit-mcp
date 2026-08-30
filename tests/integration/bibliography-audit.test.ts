import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runJsx } from "../../src/bridge/runner.js";
import { collectAudit, type AuditCollection, type Layer } from "../../src/tools/bibliography.js";
import { nbspFindings } from "../../src/bibliography/rules-nbsp.js";
import { readNoBreak } from "../../src/bibliography/nobreak.js";
import type { ContainerSnapshot } from "../../src/corrections/types.js";
import { assertFixtureActive, closeFixtureDoc, makeFixtureDoc } from "./fixture-doc.js";

/*
 * `makeFixtureDoc` (fixture-doc.ts) НЕ приймає тексту — вона будує фіксовану
 * фікстуру з наперед відомим вмістом (f1/f2/f3/table/footnote/f4-f5/f6),
 * розрахованим на РЕШТУ інтеграційних тестів (inspect/composition/pagination
 * тощо). Для bibliography_audit потрібен окремий текст із власне
 * бібліографічними записами, яких у стандартній фікстурі немає. Той самий
 * розрив уже розв'язала `bibliography-nobreak.test.ts` (Задача 5): вона не
 * чіпає `__fixture_make`, а домальовує потрібний стан довільним
 * ExtendScript через `run_script` ПІСЛЯ створення фікстури. Тут той самий
 * прийом — новий текстовий фрейм на сторінці 0 із бібліографічним текстом,
 * замість того, щоб вигадувати ще один параметр `makeFixtureDoc`.
 */

/*
 * Один запис за ДСТУ ГОСТ 7.1:2006 із ДВОМА свідомими дефектами:
 *  - роздільник зон набраний дефісом (U+002D) замість короткого тире
 *    (U+2013) — і перед "2024", і перед "Вип.", і перед "С." (усі три —
 *    валідні "стартери" зони за ZONE_STARTERS, тож "bib-zone-separator"
 *    спрацює на кожному);
 *  - ініціали "А. В." набрані звичайним пробілом, без нерозривного пробілу
 *    в жодному з двох механізмів (ні символом U+00A0, ні атрибутом
 *    noBreak) — кандидат правила "bib-nbsp-initials".
 * Дискримінатор запису (segment.ts) не потребує самого тире: чотиризначний
 * рік "2024" сам по собі задовольняє DEFAULT_RECORD_DISCRIMINATOR, тож
 * сегментація не залежить від того, який саме знак стоїть у роздільнику.
 */
const REC = (n: number) =>
  `${n}. Прізвище, Ім'я По батькові. Назва праці / А. В. Прізвище // Журнал. - 2024. - Вип. 21. - С. 68-74.`;

const BIB_TEXT = Array.from({ length: 35 }, (_, i) => REC(i + 1)).join("\r");

/*
 * Додає новий, ні з чим не зчеплений текстовий фрейм на сторінку 0 і
 * повертає ІНДЕКС його story в `doc.stories` — той самий індекс, який
 * `containers_read` (inspect.jsx) використовує для `containerId` виду
 * "story:N". Шукаємо позицію лінійним порівнянням об'єктів, а не довіряємо
 * "останній доданий story — останній у колекції": це припущення ніде не
 * задокументоване як контракт InDesign API, а лінійний пошук коштує тут
 * копійки (одиниці story у фікстурі).
 *
 * Одиниці лінійки тимчасово фіксуємо в POINTS — та сама пастка, що й у
 * `__fixture_make` (_fixtures.jsx): без цього фікса geometricBounds
 * читається в одиницях лінійки НОВОГО документа (типово піки), і рамка
 * виходить у 6 разів більшою за задум. Тут це не критично для самого
 * тексту (overset не заважає читанню story.contents), але утримує фікстуру
 * передбачуваною.
 */
function addBibliographyFrameScript(text: string): string {
  return [
    "var previousUnit = app.scriptPreferences.measurementUnit;",
    "app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;",
    "try {",
    "  var doc = app.activeDocument;",
    "  var f = doc.pages[0].textFrames.add();",
    "  f.geometricBounds = [300, 20, 760, 500];",
    `  f.contents = ${JSON.stringify(text)};`,
    "  var storyIndex = -1;",
    "  for (var si = 0; si < doc.stories.length; si++) {",
    "    if (doc.stories[si] === f.parentStory) { storyIndex = si; break; }",
    "  }",
    "  __result = storyIndex;",
    "} finally {",
    "  app.scriptPreferences.measurementUnit = previousUnit;",
    "}",
  ].join("\n");
}

/*
 * Спільний хвіст обох тестів: прочитати контейнери з живого документа,
 * зібрати аудит і звірити кандидатів nbsp з атрибутним механізмом одним
 * пакетом. Винесено, бо обидва `it` повторювали цей блок дослівно (рецензія)
 * — різняться лише `layers`, які тому й лишились параметром, а не частиною
 * хелпера.
 */
async function collectAndReadNoBreak(
  layers: Layer[],
): Promise<{ collected: AuditCollection; answers: boolean[] }> {
  const read = await runJsx<{ docName: string; containers: ContainerSnapshot[] }>(
    "containers_read",
    {},
  );
  const collected = collectAudit(read.containers, { standard: "7.1", layers });
  const answers = await readNoBreak(
    collected.nbspCandidates.map((c) => ({
      containerId: c.parsed.record.containerId,
      start: c.parsed.record.start + c.localStart,
      end: c.parsed.record.start + c.localEnd,
    })),
  );
  return { collected, answers };
}

describe("bibliography_audit на живому документі", () => {
  /*
   * ОБОВ'ЯЗКОВО beforeEach/afterEach, а не beforeAll/afterAll: у цьому файлі
   * ДВА тести, кожен створює СВІЙ документ фікстури. `afterAll` спрацював би
   * рівно один раз і закрив би лише той `docName`, що лишився в змінній
   * після ОСТАННЬОГО тесту, — документ першого тесту лишився б відкритим
   * сиротою (виміряно: саме так і сталося на першому прогоні цього файлу,
   * лишивши "Untitled-35" у InDesign). Той самий патерн, що й у
   * pagination-apply.test.ts.
   */
  let docName: string | undefined;
  let storyIndex: number;

  beforeEach(async () => {
    docName = await makeFixtureDoc();
    await assertFixtureActive(docName);

    storyIndex = await runJsx<number>("run_script", {
      script: addBibliographyFrameScript(BIB_TEXT),
      undoName: "Тест: додати бібліографічний текст",
    });
  });

  afterEach(async () => {
    /* Спрацьовує і після падіння тесту всередині `it` — фікстура не лишиться
     * висіти відкритою через провалений `expect`. */
    if (docName) await closeFixtureDoc(docName);
  });

  it("знаходить дефіс замість тире й незахищені ініціали", async () => {
    expect(storyIndex).toBeGreaterThanOrEqual(0);

    const { collected, answers } = await collectAndReadNoBreak(["standard", "nbsp"]);
    expect(collected.records).toBe(35);
    expect(collected.unparsed).toBe(0);

    /* Атрибута ніхто не ставив — усі відповіді мосту мусять бути false. */
    expect(answers.length).toBeGreaterThan(0);
    expect(answers.every((a) => a === false)).toBe(true);

    const nbsp = nbspFindings(collected.nbspCandidates, answers);
    expect(nbsp.length).toBeGreaterThan(0);
    expect(collected.standardFindings.some((f) => f.ruleId === "bib-zone-separator")).toBe(true);
  });

  it("МОВЧИТЬ про nbsp, коли поставлено атрибут noBreak", async () => {
    /*
     * Найважливіший інтеграційний тест усього плану (спек §0.5, §7.2): без
     * нього видання з GREP-стилем (атрибут noBreak замість символу U+00A0)
     * дасть тисячі хибних спрацювань, і жоден юніт-тест цього не покаже,
     * бо юніт-тести не мають живого InDesign, який один уміє відповісти на
     * "чи стоїть тут noBreak".
     */
    expect(storyIndex).toBeGreaterThanOrEqual(0);

    /* Рецензія: перевірка активного документа в beforeEach захищає ПЕРШИЙ
     * запис у документ (вставку BIB_TEXT), але не цей другий — між ними
     * фокус InDesign теоретично міг перемкнутись. У користувача зараз
     * відкрита робоча книжка на 592 сторінки; писати в неї без свіжої
     * звірки — саме той клас помилки, від якого існує assertFixtureActive.
     * Решта інтеграційних тестів тримає патерн «перевірка перед КОЖНИМ
     * записом» (pagination-apply.test.ts, composition-apply.test.ts,
     * corrections.test.ts) — тут той самий патерн. */
    await assertFixtureActive(docName!);

    /* Ставимо noBreak на КОЖЕН символ story з бібліографічним текстом —
     * саме на той story, у який щойно вписали BIB_TEXT (не stories[0]:
     * стандартна фікстура вже має кілька story з інших фреймів/таблиці/
     * виноски, і їхній порядок — деталь реалізації, на яку не варто
     * покладатись). */
    await runJsx("run_script", {
      script:
        `var t = app.activeDocument.stories[${storyIndex}].texts[0];` +
        "t.characters.everyItem().noBreak = true;",
      undoName: "Тест: поставити noBreak на весь бібліографічний текст",
    });

    const { collected, answers } = await collectAndReadNoBreak(["nbsp"]);
    expect(answers.length).toBeGreaterThan(0);
    expect(nbspFindings(collected.nbspCandidates, answers)).toEqual([]);
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertFixtureActive, closeFixtureDoc, makeFixtureDoc } from "./fixture-doc.js";
import { readLanguageRuns } from "../../src/spelling/langruns.js";
import { runJsx } from "../../src/bridge/runner.js";
import type { ContainerSnapshot } from "../../src/corrections/types.js";
import { detectLanguage, tallyLanguages } from "../../src/spelling/language.js";
import type { Aff } from "../../src/spelling/types.js";

/*
 * Брифінг Задачі 12 передавав `detectLanguage`/`tallyLanguages` один-єдиний
 * `Aff`, отриманий з `parseAff`. Це застаріло: обидві функції приймають
 * `Map<string, Aff>` — словник AFF-правил ПО МОВІ (language.ts, `affFor`).
 * Порожня мапа тут навмисна, а не недбалість: коли код мови не знайдено в
 * мапі, `affFor` падає на `DEFAULT_WORD_AFF` (unknown.ts) — а той містить
 * рівно ті самі `wordChars: ["-", "'"]`, що й `parseAff("WORDCHARS -'")` із
 * застарілого брифінгу. Тобто порожня мапа й «мапа з одним записом на все»
 * дають ІДЕНТИЧНУ поведінку для меж слова — різниця стосується лише
 * словника (`known()`), якого ця родина взагалі не читає.
 */
const EMPTY_AFFS: Map<string, Aff> = new Map();

let DOC = "";

describe("родина language на живому InDesign", () => {
  beforeAll(async () => {
    DOC = await makeFixtureDoc();
  });

  afterAll(async () => {
    await closeFixtureDoc(DOC);
  });

  it("знаходить усі три дефекти й НЕ плутає їх між собою", async () => {
    await assertFixtureActive(DOC);
    const read = await runJsx<{ docName: string; containers: ContainerSnapshot[] }>(
      "containers_read",
      {},
    );
    const langs = await readLanguageRuns();
    const found = detectLanguage(read.containers, langs, EMPTY_AFFS);

    const byDefect = found.reduce<Record<string, number>>((a, f) => {
      a[f.defect] = (a[f.defect] ?? 0) + 1;
      return a;
    }, {});
    /*
     * Детекторів ДВА. Діапазон із чужою мовою ТА СЛОВАМИ (стан 2 фікстури) —
     * законна вставка, а не дефект: він має дати НУЛЬ знахідок і з'явитись
     * лише в інвентарі. Саме це відрізняє переписану родину від первісної
     * (третій детектор `language-foreign` прибрано — коментар language.ts).
     */
    expect(byDefect).toMatchObject({
      "language-none": 1,
      "language-stray": 1,
    });
    expect(byDefect["language-foreign"]).toBeUndefined();
    expect(found.find((f) => f.defect === "language-stray")!.words).toBe(0);
    expect(found.find((f) => f.defect === "language-none")!.words).toBeGreaterThan(0);

    /*
     * Інвентар мусить бачити ВСІ мови фікстури, зокрема ту, що не дала
     * жодної знахідки (English: USA — стан 2, законна вставка).
     */
    const tally = tallyLanguages(read.containers, langs, EMPTY_AFFS);
    expect(tally.map((t) => t.language)).toEqual(
      expect.arrayContaining(["Ukrainian", "English: USA", "[No Language]", "Vietnamese"]),
    );

    /* Vietnamese (стан 3) несе позначку, але жодного слова — інвентар мусить
     * показати це прямо, а не просто перелічити мову серед інших. */
    const vietnamese = tally.find((t) => t.language === "Vietnamese");
    expect(vietnamese?.words).toBe(0);

    /* English: USA (стан 2) несе слова, і вони НЕ мали породити жодного
     * дефекту (перевірено вище через byDefect["language-foreign"]). */
    const english = tally.find((t) => t.language === "English: USA");
    expect(english?.words).toBeGreaterThan(0);
  });
});

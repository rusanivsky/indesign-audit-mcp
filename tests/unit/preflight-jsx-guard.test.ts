import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { jsxModules } from "../../src/bridge/runner.js";

const RAW = readFileSync("src/jsx/preflight.jsx", "utf8");

/*
 * Ґарди дивляться на КОД, не на коментарі: у цьому файлі коментарі згадують і
 * `proc.status`, і `itemByName` — саме щоб пояснити, ЧОМУ їх немає в коді.
 * Ґард, що не відрізняє код від тексту про код, карав би за документування.
 */
const SRC = RAW.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("preflight.jsx", () => {
  it("модуль зареєстровано, інакше обробник не існує в рантаймі", () => {
    /*
     * Без цієї перевірки рядок "preflight.jsx" можна було вирізати з
     * runner.ts — і жоден тест не впав би, хоч інструмент перестав би
     * існувати в рантаймі.
     */
    expect(jsxModules({})).toContain("preflight.jsx");
    expect(jsxModules({ INDESIGN_MCP_FIXTURES: "1" })).toContain("preflight.jsx");
  });

  it("шукає профіль ПЕРЕБОРОМ, а не itemByName", () => {
    /* Виміряно: app.preflightProfiles.itemByName("[Basic]") віддає невалідний
     * об'єкт — назва в квадратних дужках через нього не знаходиться. */
    expect(SRC).toMatch(/for\s*\([\s\S]{0,120}app\.preflightProfiles\.length/);
    expect(SRC).not.toMatch(/preflightProfiles\.itemByName/);
  });

  it("НЕ читає proc.status — такої властивості не існує", () => {
    /* Виміряно через reflect.properties: targetObject, appliedProfile,
     * description, processResults, processInventory, aggregatedResults,
     * isValid, parent, index. Звернення до .status кидає одразу. */
    expect(SRC).not.toMatch(/proc\w*\.status/);
  });

  it("результат waitForProcess ЗБЕРІГАЄТЬСЯ і доходить до звіту", () => {
    /*
     * Найдорожчий дефект першої редакції: значення викидалось узагалі. Тепер
     * воно зберігається й ЇДЕ У ЗВІТ — саме тому в цій редакції поле може бути
     * `true`, а не лише `false` (кидок на ньому знято свідомо: див.
     * preflight-jsx-logic.test.ts, «СИГНАЛ 2»). Значення ПОЗА {true, false} —
     * третій стан: воно теж не кидає, але виставляє `waitTimedOut` у `true`
     * консервативно й кладе сире значення з типом у `waitPolarity`. Перевірено
     * там-таки виконанням, а не регекспом — статичний ґард був би слабшим.
     *
     * Поведінку обох гілок перевіряє той тест, виконанням. Тут лишається лише
     * те, що регексп справді стереже: значення не загублене по дорозі.
     */
    expect(SRC).toMatch(/waitTimedOut\s*=\s*proc\.waitForProcess\(/);
    expect(SRC).toMatch(/waitTimedOut:\s*waitTimedOut/);
  });

  it("aggregatedResults читається під try/catch і його недоступність КИДАЄ", () => {
    /* Виміряно: у незавершеного процесу властивість не віддає порожнечу, а
     * кидає «Aggregated Result for this process is not available». Сире це
     * повідомлення про таймаут нічого не каже. */
    expect(SRC).toMatch(/try\s*\{\s*\n?\s*agg\s*=\s*proc\.aggregatedResults;/);
    expect(SRC).toMatch(/aggError\s*!==\s*null[\s\S]{0,200}throw new Error/);
  });

  it("не має мовчазного дефолту таймауту — його переданість перевіряється гучно", () => {
    expect(SRC).not.toMatch(/timeoutSeconds\s*\|\|/);
    expect(SRC).toMatch(/waitSeconds\s*>\s*0/);
  });

  it("прибирає процес у finally й ЗВІТУЄ про це полем", () => {
    expect(SRC).toMatch(/finally\s*\{[\s\S]*proc\.remove\(\)/);
    expect(SRC).toMatch(/processRemoved\s*=\s*true/);
    expect(SRC).toMatch(/processRemoved:\s*processRemoved/);
  });

  it("розбір рядків повертає ЛІЧИЛЬНИКИ, а не самі лише рядки", () => {
    /* «0 порушень» і «форма, якої ми не розуміємо» мусять давати різні
     * відповіді — інакше це той самий тихий порожній звіт. */
    for (const field of ["shapeRecognised", "rowsSeen", "rowsParsed", "pairsSeen", "pairsParsed"]) {
      expect(SRC, `лічильник ${field} зник`).toMatch(new RegExp(`${field}:`));
    }
  });

  it("не використовує вкладених тернарників", () => {
    expect(SRC).not.toMatch(/\?[^;{}\n]*\?[^;{}\n]*:[^;{}\n]*:/);
  });
});

import { describe, expect, it } from "vitest";
import { parseAff } from "../../src/spelling/aff.js";
import { normaliseApostrophes, splitWords } from "../../src/spelling/words.js";

const aff = parseAff(["WORDCHARS -'", "BREAK 1", "BREAK -"].join("\n"));

/* Реальний uk_UA.aff несе IGNORE U+0301 — комбінований наголос. Окремий
 * .aff тут, а не розширення спільного `aff`, бо наголос потрібен лише
 * одному тесту — домішувати IGNORE до фікстури решти тестів зайве. */
const affWithStress = parseAff(
  ["WORDCHARS -'", "IGNORE ́", "BREAK 1", "BREAK -"].join("\n"),
);

describe("splitWords", () => {
  it("апостроф і дефіс НАЛЕЖАТЬ слову", () => {
    expect(splitWords("п’ять синьо-жовтих", aff).map((w) => w.text))
      .toEqual(["п’ять", "синьо-жовтих"]);
  });

  it("офсети вказують на місце в переданому тексті", () => {
    const [second] = splitWords("аб вг", aff).slice(1);
    expect(second).toMatchObject({ text: "вг", start: 3, end: 5 });
  });

  it("цифри й розділові знаки словами не є", () => {
    expect(splitWords("на с. 31 — 47 разів", aff).map((w) => w.text))
      .toEqual(["на", "с", "разів"]);
  });

  it("порожній діапазон дає порожній масив, а не кидає", () => {
    expect(splitWords("\r  ", aff)).toEqual([]);
  });

  it("нелітерний край обрізається: «-й» після пропуску втрачає дефіс", () => {
    /* Виміряно 2026-08-08: саме такі уламки («-й», «-го», «-му») давав
     * необрізаний regex на реальній книжці. */
    expect(splitWords("щось -й інше", aff).map((w) => w.text))
      .toEqual(["щось", "й", "інше"]);
  });

  it("послідовність із самих WORDCHARS словом не є", () => {
    expect(splitWords("-- '' ---", aff)).toEqual([]);
  });

  it("наголос (IGNORE) лишається ВСЕРЕДИНІ токена — слово не розривається надвоє", () => {
    /* «по́їзд»: по + U+0301 + їзд. Без цього символу в класі токенізації
     * regex зупиняється на комбінованому наголосі і ріже слово на дві
     * частини, жодної з яких немає в словнику — два хибних влучання. */
    const word = "по́їзд";
    expect(splitWords(word, affWithStress)).toEqual([
      { text: word, start: 0, end: word.length },
    ]);
  });
});

describe("normaliseApostrophes", () => {
  /* Виміряно 2026-08-08: у .dic апостроф ТІЛЬКИ U+0027 (1460 слів), U+2019 —
   * нуль; канонічний апостроф проєкту — U+2019 (typography_apply конвертує
   * саме в нього). Без нормалізації кожне «п'ять» — хибне влучання. */
  it("зводить типографські апострофи до U+0027", () => {
    expect(normaliseApostrophes("п’ять")).toBe("п'ять");
    expect(normaliseApostrophes("пʼять")).toBe("п'ять");
    expect(normaliseApostrophes("п‘ять")).toBe("п'ять");
  });

  it("не чіпає слів без апострофа", () => {
    expect(normaliseApostrophes("стіл")).toBe("стіл");
  });

  it("зводить бектик (третій виміряний WORDCHARS-символ) теж", () => {
    /* Виміряно Задачею 3: WORDCHARS для uk_UA.aff — «-'`», три символи, не
     * два (od -c звірено побайтово). Бектик — один із вимірюваних фактів; без
     * тесту він лишається твердженням, яке ніхто не боронить від рефакторингу. */
    expect(normaliseApostrophes("п`ять")).toBe("п'ять");
  });
});

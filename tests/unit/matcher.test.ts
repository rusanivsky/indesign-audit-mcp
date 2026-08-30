import { describe, it, expect } from "vitest";
import { findOccurrences, findOccurrencesWithTrim, findClosest } from "../../src/corrections/matcher.js";

describe("findOccurrences", () => {
  it("знаходить точний збіг і повертає індекси вихідного тексту", () => {
    const src = "Київ — столиця України.";
    expect(findOccurrences(src, "столиця")).toEqual([{ start: 7, end: 14 }]);
  });

  it("знаходить збіг попри нерозривний пробіл у документі", () => {
    const src = "у Києві";
    expect(findOccurrences(src, "у Києві")).toEqual([{ start: 0, end: 7 }]);
  });

  it("знаходить збіг попри м'який перенос у документі", () => {
    const src = "сто­лиця";
    expect(findOccurrences(src, "столиця")).toEqual([{ start: 0, end: 8 }]);
  });

  it("знаходить збіг попри різні лапки", () => {
    const src = 'книга «Кобзар» вийшла';
    const m = findOccurrences(src, '"Кобзар"');
    expect(m).toEqual([{ start: 6, end: 14 }]);
    expect(src.slice(6, 14)).toBe("«Кобзар»");
  });

  it("повертає всі збіги", () => {
    expect(findOccurrences("кіт і кіт", "кіт")).toEqual([
      { start: 0, end: 3 },
      { start: 6, end: 9 },
    ]);
  });

  it("повертає порожній масив, коли збігів немає", () => {
    expect(findOccurrences("Київ", "Львів")).toEqual([]);
  });

  it("порожній запит не дає збігів", () => {
    expect(findOccurrences("Київ", "")).toEqual([]);
  });
});

/*
 * C1 (фінальна рецензія гілки). У ExtendScript "\r" у contents — це знак кінця
 * абзацу. Він входив у набір WS у normalize.ts, а нормалізація згортає весь
 * пробільний прогін в один пробіл із mapEnd за кінцем прогону, тож `old` із
 * хвостовим пробілом (найприродніша форма при диктуванні) захоплював "\r" у
 * діапазон запису й заміна ЗНИЩУВАЛА межу абзаців. Звірка перед записом тут
 * структурно безсила: expectedOld = matchText містить той самий "\r".
 *
 * Інваріант: якщо `old` користувача не містить розриву абзацу, то й діапазон
 * збігу не сміє його містити.
 */
describe("findOccurrences і межа абзацу (C1)", () => {
  const src = "Persha fraza abzatsu.\rDruhyi abzats pochynaietsia tut.";
  const sep = src.indexOf("\r");

  it("old із хвостовим пробілом не захоплює знак кінця абзацу", () => {
    const m = findOccurrences(src, "abzatsu. ");
    expect(m).toHaveLength(1);
    expect(src.slice(m[0]!.start, m[0]!.end)).not.toContain("\r");
    expect(m[0]!.end).toBe(sep);
  });

  it("old із хвостовим пробілом усе одно ЗНАХОДИТЬСЯ — правка не втрачається", () => {
    // Варіант «просто не збігатися через межу» відкинуто: коректор диктує
    // `old` із пробілом на кінці й чекає, що правку застосують усередині абзацу.
    const m = findOccurrences(src, "fraza abzatsu. ");
    expect(m).toHaveLength(1);
    expect(src.slice(m[0]!.start, m[0]!.end)).toBe("fraza abzatsu.");
  });

  it("old із провідним пробілом не захоплює знак кінця абзацу попереду", () => {
    const m = findOccurrences(src, " Druhyi");
    expect(m).toHaveLength(1);
    expect(src.slice(m[0]!.start, m[0]!.end)).toBe("Druhyi");
    expect(m[0]!.start).toBe(sep + 1);
  });

  it("збіг, ЯДРО якого перетинає межу абзацу, не пропонується взагалі", () => {
    // Обрізати нема куди: розділювач усередині тексту правки, а не на її краю.
    // Мовчазне злиття абзаців тут гірше за «не знайдено» з підказками.
    expect(findOccurrences(src, "abzatsu. Druhyi")).toEqual([]);
  });

  it("явний розрив абзацу в самому old лишається дозволеним", () => {
    const m = findOccurrences(src, "abzatsu.\rDruhyi");
    expect(m).toHaveLength(1);
    expect(src.slice(m[0]!.start, m[0]!.end)).toContain("\r");
  });

  it("м'який перенос рядка (\\n) захищений так само, як кінець абзацу", () => {
    const soft = "Riadok odyn.\nRiadok dva.";
    const m = findOccurrences(soft, "odyn. ");
    expect(m).toHaveLength(1);
    expect(soft.slice(m[0]!.start, m[0]!.end)).not.toContain("\n");
    expect(m[0]!.end).toBe(soft.indexOf("\n"));
  });

  it("звичайний збіг без роздільників лишається побайтово тим самим", () => {
    expect(findOccurrences("Kyiv — stolytsia Ukrainy.", "stolytsia ")).toEqual([
      { start: 7, end: 17 },
    ]);
  });
});

/*
 * T-trim (рецензія хвилі C1). clampToParagraph обрізає діапазон запису
 * мовчки — findOccurrences() і далі віддає лише {start, end}, тож на рівні
 * планувальника нема на чому побудувати попередження про можливий зайвий
 * пробіл на стику з обрізаним краєм. findOccurrencesWithTrim() — той самий
 * пошук, але з ознакою headTrimmed/tailTrimmed для кожного збігу.
 */
describe("findOccurrencesWithTrim", () => {
  const src = "Persha fraza abzatsu.\rDruhyi abzats pochynaietsia tut.";

  it("хвіст обрізано по межі абзацу — tailTrimmed", () => {
    const m = findOccurrencesWithTrim(src, "abzatsu. ");
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ tailTrimmed: true, headTrimmed: false });
  });

  it("голову обрізано по межі абзацу — headTrimmed", () => {
    const m = findOccurrencesWithTrim(src, " Druhyi");
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ headTrimmed: true, tailTrimmed: false });
  });

  it("звичайний збіг без роздільників — жодного прапорця", () => {
    const m = findOccurrencesWithTrim(src, "fraza");
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ headTrimmed: false, tailTrimmed: false });
  });

  it("явний розрив абзацу в самому old — обрізки немає, needleHasSeparator", () => {
    const m = findOccurrencesWithTrim(src, "abzatsu.\rDruhyi");
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ headTrimmed: false, tailTrimmed: false });
  });

  it("findOccurrences не змінює форму — лише {start, end}, як і раніше", () => {
    // Регресія: findOccurrencesWithTrim не сміє протікати в старий контракт.
    expect(findOccurrences(src, "abzatsu. ")).toEqual([{ start: 13, end: 21 }]);
  });
});

describe("findClosest", () => {
  it("знаходить схожий фрагмент із однією помилкою", () => {
    const src = "Це речення містить помилкове слово.";
    const s = findClosest(src, "містить помилков слово");
    expect(s.length).toBeGreaterThan(0);
    expect(s[0]!.score).toBeGreaterThan(0.8);
    expect(src.slice(s[0]!.start, s[0]!.end)).toContain("помилкове");
  });

  it("не пропонує нічого для зовсім чужого тексту", () => {
    expect(findClosest("Київ столиця України", "автомобільний двигун карбюратор")).toEqual([]);
  });

  it("не падає на запиті без довгих слів", () => {
    /*
     * ТВЕРДЖЕННЯ ПРО РЕЗУЛЬТАТ, А НЕ ПРО ВІДСУТНІСТЬ ВИКИДУ.
     *
     * Доти тут стояло лише `not.toThrow()` — єдиний тест, що торкався цієї
     * гілки, і він не міг упасти від жодної зміни поведінки. Мутаційна проба
     * 2026-08-26 це й показала: поріг довжини якірного слова `>= 4` можна
     * було змінити на `>= 5`, і ввесь набір лишався зеленим.
     */
    expect(findClosest("а б в", "і ж")).toEqual([]);
  });
});

/*
 * ДВІ МУТАЦІЇ, ЩО ПЕРЕЖИЛИ ВЕСЬ НАБІР (проба 2026-08-26).
 */
describe("межі, доти не накриті", () => {
  it("поріг якірного слова — саме чотири літери, не п'ять", () => {
    /* `words.filter(w => w.length >= 4)`. Запит із найдовшим словом рівно на
     * чотири літери мусить мати якір і знайти збіг; на `>= 5` він мовчав би. */
    const found = findClosest("тут стоїть мама і тато", "мама");
    expect(found.length).toBeGreaterThan(0);
  });

  it("НЕГАТИВНИЙ КОНТРОЛЬ: слова коротші за поріг якоря не дають", () => {
    expect(findClosest("тут стоїть мама і тато", "і та")).toEqual([]);
  });

  it("входження ПЕРЕКРИВАЮТЬСЯ: крок пошуку — один символ, не довжина голки", () => {
    /*
     * `from = idx + 1`, а не `idx + n.text.length`. Крок у довжину голки
     * перетворив би перекривні входження на неперекривні, і планувальник
     * правок вважав би неоднозначний збіг унікальним — тобто написав би в
     * документ там, де мусив спитати.
     */
    const found = findOccurrences("ааааа", "аа");
    expect(found.length).toBe(4);
  });
});

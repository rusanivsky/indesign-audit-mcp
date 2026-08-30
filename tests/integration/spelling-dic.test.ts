import { existsSync, readdirSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { parseAff } from "../../src/spelling/aff.js";
import { buildDictionary } from "../../src/spelling/dic.js";
import { dictPathsFor } from "../../src/spelling/dictpath.js";
import type { Aff } from "../../src/spelling/types.js";

/**
 * Корінь ВСТАНОВЛЕННЯ InDesign, з якого беруться словники для звірки з
 * оракулом (`tests/fixtures/hunspell-oracle.json`, згенерований
 * `scripts/gen-hunspell-oracle.mjs` із того самого кореня).
 *
 * Тут стояв ЗАШИТИЙ абсолютний шлях на «Adobe InDesign 2026» — відкладена
 * рецензією дрібниця. Він ламався б від будь-чого: інша версія застосунку,
 * установка не в `/Applications`, Beta-збірка. Виводиться так само, як у
 * продакшні (`dictPathsFor`, `src/spelling/dictpath.ts`), тож саме той
 * будівник шляху заразом і перевіряється, а не дублюється.
 *
 * НЕ пропускає тестів, коли застосунку немає, — кидає з назвою змінної
 * оточення. Пропуск тут був би «перевіркою, що не може впасти»: звірка з
 * оракулом — головний доказ Фази 9, і зелений набір без неї брехав би.
 *
 * ЧОМУ ЦЕЙ ФАЙЛ ЖИВЕ В `tests/integration/`, А НЕ В `tests/unit/`.
 *
 * Він лежав серед юніт-тестів, і там ця чесна відмова оберталася на брехню
 * іншого ґатунку: README обіцяє, що `npm test` не потребує InDesign, а цей
 * файл потребує його ВСТАНОВЛЕННЯ (не запуску). На машині розробника різниці
 * не видно — InDesign там є завжди. Перший же прогін CI на Linux показав її
 * рівно так, як і мав: `ENOENT: scandir '/Applications'`, і весь юніт-набір
 * червоний.
 *
 * Переклад сюди нічого не послабляє: політика «кидати, а не пропускати»
 * лишилась дослівно, і на будь-якій машині з InDesign звірка з оракулом
 * відбувається так само. Змінилось одне — набір, який обіцяє працювати без
 * InDesign, тепер справді працює без нього.
 */
function resolveAppRoot(): string {
  const fromEnv = process.env.INDESIGN_MCP_APP_ROOT;
  if (fromEnv) return fromEnv;
  const candidates = readdirSync("/Applications")
    .filter((n) => n.startsWith("Adobe InDesign"))
    .map((n) => `/Applications/${n}`)
    /* Beta-збірки — після стабільних: на машині розробника їх дві, і
     * оракул згенеровано зі стабільної. */
    .sort((a, b) => Number(a.includes("Beta")) - Number(b.includes("Beta")) || a.localeCompare(b));
  const found = candidates.find((root) => existsSync(dictPathsFor(root, "uk_UA").dicPath));
  if (found === undefined) {
    throw new Error(
      "не знайдено встановлення InDesign зі словниками hunspell. Перевірено: " +
        `${candidates.join(", ") || "(нічого в /Applications)"}. ` +
        "Задайте корінь застосунку через INDESIGN_MCP_APP_ROOT.",
    );
  }
  return found;
}

const APP_ROOT = resolveAppRoot();
const dicPath = (lang: string): string => dictPathsFor(APP_ROOT, lang).dicPath;
const affPath = (lang: string): string => dictPathsFor(APP_ROOT, lang).affPath;

describe("buildDictionary — синтетичний словник", () => {
  const aff = parseAff(["SFX V Y 1", "SFX V ий ого [^ц]ий"].join("\n"));

  it("знає основу", () => {
    expect(buildDictionary("2\nбілий/V\nстіл", aff).known("білий")).toBe(true);
  });

  it("знає форму, утворену афіксом", () => {
    expect(buildDictionary("1\nбілий/V", aff).known("білого")).toBe(true);
  });

  it("НЕ знає форми, якщо основа не має прапорця групи", () => {
    expect(buildDictionary("1\nбілий", aff).known("білого")).toBe(false);
  });

  it("рахує основи в stems", () => {
    expect(buildDictionary("2\nбілий/V\nстіл", aff).stems).toBe(2);
  });

  it("велика літера на початку слова знаходиться через малу", () => {
    expect(buildDictionary("1\nстіл", aff).known("Стіл")).toBe(true);
  });

  it("мала літера НЕ знаходиться лише тому, що є власна назва", () => {
    expect(buildDictionary("1\nКиїв", aff).known("київ")).toBe(false);
  });

  it("апостроф у слові нормалізується перед пошуком", () => {
    // словник тримає U+0027, книжка може прийти з U+2019
    expect(buildDictionary("1\nім'я", aff).known("ім’я")).toBe(true);
  });

  it("наголос (IGNORE) знімається перед пошуком", () => {
    const affWithIgnore = parseAff("IGNORE ́");
    expect(buildDictionary("1\nстіл", affWithIgnore).known("ст́іл")).toBe(true);
  });

  it("ICONV: вхідна заміна словника застосовується перед пошуком", () => {
    /* Лігатура — це `\p{L}`, тож splitWords віддає «ﬁre» ЦІЛИМ токеном, а
     * словник тримає лише «fire». Тест червоніє, якщо aff.iconv знову
     * розбирається й не застосовується (розбір без ужитку — саме той стан,
     * у якому цей код прожив усю фазу). */
    const affIconv = parseAff(["ICONV 1", "ICONV ﬁ fi"].join("\n"));
    expect(buildDictionary("1\nfire", affIconv).known("ﬁre")).toBe(true);
  });

  it("BREAK: складне слово визнається, коли визнані ВСІ частини", () => {
    /* Досі BREAK покривав лише оракул (63 дефісні слова known, 45 unknown) —
     * тобто на червоному було б видно ЩО зламалось, але не де. Синтетична
     * пара показує саме правило: обидві частини є → визнано; одна відсутня →
     * ні. */
    const affBreak = parseAff(["BREAK 1", "BREAK -"].join("\n"));
    const dict = buildDictionary("2\nсиньо\nзелений", affBreak);
    expect(dict.known("синьо-зелений")).toBe(true);
    expect(dict.known("синьо-бузковий")).toBe(false);
  });

  it("ICONV без оголошених пар нічого не міняє", () => {
    /* Негативний контроль до попереднього: заміна працює РІВНО тому, що
     * словник її оголосив, а не тому, що лігатури розкладаються завжди. */
    expect(buildDictionary("1\nfire", aff).known("ﬁre")).toBe(false);
  });
});

describe("buildDictionary — прапорці .dic розбираються через parseFlags", () => {
  it("режим long: два символи на прапорець, не по одному", () => {
    // якби .dic-парсер різав рядок по символах (а не через parseFlags),
    // "V1" дав би прапорці {V,1} замість одного прапорця "V1".
    const aff = parseAff(["FLAG long", "SFX V1 Y 1", "SFX V1 0 s ."].join("\n"));
    const dict = buildDictionary("1\ncat/V1", aff);
    expect(dict.known("cats")).toBe(true);
  });

  it("режим num: прапорці через кому, не по символах", () => {
    const aff = parseAff(["FLAG num", "SFX 12 Y 1", "SFX 12 0 s ."].join("\n"));
    const dict = buildDictionary("1\ncat/12", aff);
    expect(dict.known("cats")).toBe(true);
  });

  it("аліас AF розгортається у справжні прапорці", () => {
    const aff = parseAff([
      "AF 1",
      "AF SM",
      "SFX S Y 1",
      "SFX S 0 s .",
    ].join("\n"));
    // "1" у .dic — не прапорець "1", а НОМЕР рядка AF → розгортається в "S","M"
    const dict = buildDictionary("1\ncat/1", aff);
    expect(dict.known("cats")).toBe(true);
  });
});

describe("buildDictionary — проти оракула справжнього hunspell", () => {
  const oracle: Record<string, Array<{ word: string; known: boolean }>> = JSON.parse(
    readFileSync("tests/fixtures/hunspell-oracle.json", "utf8"),
  );

  /**
   * Нижня межа вибірки — ВИМІРЯНА (`node -e` по самій фікстурі, 2026-08-14),
   * не кругла. Без неї порожній або всічений оракул давав би ЗЕЛЕНИЙ тест:
   * `wrong = words.filter(...)` на порожньому масиві порожній, і звірка,
   * яка нічого не звіряє, читалась би як «нуль розбіжностей на 12 808».
   * Це рівно та «перевірка, що не може впасти», на якій фаза спіймала себе
   * чотири рази — тут вона стосується не команди оболонки, а самого доказу
   * фази. Числа-мінімуми дорівнюють поточному розміру фікстури навмисно:
   * перегенерація сміє додавати слова, але не сміє мовчки їх втрачати.
   */
  /*
   * uk_UA ЗМЕНШЕНО НАВМИСНО з 9657 до 1596 — 2026-08-26, і це не втрата, яку
   * цей самий поріг мав ловити. Доти українська вибірка бралася з
   * `book-words.json`, тобто зі словника ОДНІЄЇ справжньої клієнтської
   * книжки: 9657 слово-типів, разом із назвами торгових марок і назвою
   * видавництва. Такий оракул не можна опублікувати, і він до того ж
   * відрізнявся ЗА МЕТОДОМ від англійського без жодної на те підстави.
   *
   * Тепер усі три мови виводяться однаково — зі стем-ів самого словника та
   * їхніх власних SFX/PFX-правил (`scripts/gen-hunspell-oracle.mjs`). Вибірка
   * менша, але рівномірніша: вона покриває афіксну машинерію як таку, а не те,
   * як випадково відмінювала одна книжка. Вироки, як і раніше, від СПРАВЖНЬОГО
   * hunspell, а не від нашої реалізації.
   *
   * Числа знову дорівнюють поточному розміру фікстури: перегенерація сміє
   * додавати слова, але не сміє мовчки їх втрачати.
   */
  const MIN_ORACLE_WORDS: Record<string, number> = { uk_UA: 1596, en_US: 1561, en_GB: 1590 };

  const affs: Record<string, Aff> = {};
  let buildUkMs = -1;

  beforeAll(() => {
    for (const lang of ["uk_UA", "en_US", "en_GB"]) {
      affs[lang] = parseAff(readFileSync(affPath(lang), "utf8"));
    }
    const t0 = performance.now();
    buildDictionary(readFileSync(dicPath("uk_UA"), "utf8"), affs.uk_UA!);
    buildUkMs = performance.now() - t0;
    // eslint-disable-next-line no-console
    console.log(`buildDictionary(uk_UA): ${buildUkMs.toFixed(1)} мс`);
  });

  for (const lang of ["uk_UA", "en_US", "en_GB"]) {
    it(`вирок збігається на всій вибірці — ${lang}`, () => {
      const aff = affs[lang]!;
      const t0 = performance.now();
      const dict = buildDictionary(readFileSync(dicPath(lang), "utf8"), aff);
      const words = oracle[lang]!;

      /* Вибірка мусить бути НЕПОРОЖНЬОЮ і містити ОБИДВА вироки: звірка,
       * у якій усі слова відомі (або всі невідомі), не відрізнила б
       * розгортач від функції, що завжди повертає одне й те саме. */
      expect(words.length).toBeGreaterThanOrEqual(MIN_ORACLE_WORDS[lang]!);
      expect(words.filter((o) => o.known).length).toBeGreaterThan(0);
      expect(words.filter((o) => !o.known).length).toBeGreaterThan(0);

      const wrong = words.filter((o) => dict.known(o.word) !== o.known);
      /* Розбіжності друкуються ОБОМА класами — хибна суворість і хибна
       * поблажливість ламаються по-різному, і зливати їх в одне число означало б
       * ховати небезпечнішу. */
      const tooStrict = wrong.filter((o) => o.known);
      const tooLax = wrong.filter((o) => !o.known);
      const elapsedMs = performance.now() - t0;
      // eslint-disable-next-line no-console
      console.log(
        `${lang}: ${words.length} слів, звірка ${elapsedMs.toFixed(1)} мс, ` +
          `хибноСувору=${tooStrict.length}, хибноПоблажливо=${tooLax.length}`,
      );

      expect({
        хибноСувору: tooStrict.slice(0, 10).map((o) => o.word),
        хибноПоблажливо: tooLax.slice(0, 10).map((o) => o.word),
      }).toEqual({ хибноСувору: [], хибноПоблажливо: [] });
    });
  }
});

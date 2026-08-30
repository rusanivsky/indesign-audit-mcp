import { describe, expect, it } from "vitest";
import { ConfigError, reconcileWithDocument } from "../../src/cli/config/validate.js";
import { FAMILY_NAMES, type AuditConfig } from "../../src/cli/config/schema.js";

function конфіг(родини: Record<string, unknown>): AuditConfig {
  return {
    edition: { title: "К", docPath: "/т/к.indd" },
    print: { minPpi: 300, maxTotalInk: 300, expectedInks: 4 },
    families: {
      ...Object.fromEntries(FAMILY_NAMES.map((f) => [f, { notApplicable: "ні" }])),
      ...родини,
    },
  } as AuditConfig;
}

const стилі = ["Назва розділу", "Колонтитул v1", "Основний текст L"];

/* Задача G: перелік стилів приходить із `doc_overview`, тобто з
 * `app.activeDocument`. Відмова правдива лише щодо ТОГО документа, який
 * опитали, тож його ім'я — обов'язковий аргумент, а не оздоба. */
const ДОКУМЕНТ = "Book 260816-1250.indd";

describe("reconcileWithDocument — позитивний близнюк", () => {
  it("мовчить, коли всі названі стилі є в документі", () => {
    expect(() =>
      reconcileWithDocument(
        конфіг({ pagination: { folio: "Колонтитул v1", headingStyles: ["Назва розділу"] } }),
        стилі,
        ДОКУМЕНТ,
      ),
    ).not.toThrow();
  });
});

describe("reconcileWithDocument — відмови", () => {
  it("відмовляє на стилі, якого в документі немає", () => {
    // Підстава: неправильні headingStyles дали 45 хибних знахідок.
    expect(() =>
      reconcileWithDocument(конфіг({ pagination: { headingStyles: ["Заголовок"] } }), стилі, ДОКУМЕНТ),
    ).toThrow(ConfigError);
  });

  it("називає і відсутній стиль, і схожий наявний", () => {
    try {
      reconcileWithDocument(конфіг({ pagination: { folio: "Колонтитул v2" } }), стилі, ДОКУМЕНТ);
      throw new Error("мало відмовити");
    } catch (e) {
      expect((e as Error).message).toMatch(/Колонтитул v2/);
      expect((e as Error).message).toMatch(/Колонтитул v1/);
    }
  });

  /*
   * Задача G: живий прогін 2026-08-16 сказав «У документі стилю
   * „Колонтитул v1“ немає», опитавши ОБКЛАДИНКУ (2 стилі), тоді як у
   * цільовій книжці цей стиль несуть 99 абзаців. Повідомлення без імені
   * документа звинувачує конфіг у тому, чого конфіг не робив, і відправляє
   * читача шукати одруківку там, де її немає. Ім'я приходить із тієї самої
   * відповіді `doc_overview`, з якої взято й перелік стилів.
   */
  it("називає ДОКУМЕНТ, у якому стилю не знайшлось", () => {
    try {
      reconcileWithDocument(
        конфіг({ pagination: { folio: "Колонтитул v1" } }),
        ["[Basic Paragraph]", "Обкладинка Назва"],
        "Cover_260812_429.5x226_cut463.5x260.indd",
      );
      throw new Error("мало відмовити");
    } catch (e) {
      expect((e as Error).message).toContain(
        'In document "Cover_260812_429.5x226_cut463.5x260.indd" the style "Колонтитул v1" doesn\'t exist.',
      );
    }
  });

  it("незастосовну родину не звіряє взагалі", () => {
    expect(() =>
      reconcileWithDocument(конфіг({ pagination: { notApplicable: "нема колонцифр" } }), стилі, ДОКУМЕНТ),
    ).not.toThrow();
  });
});

/*
 * Приклад зі спека §5.2: pagination.contents.numberStyle і
 * sequences.rules[].style — назви стилів на ДРУГОМУ й ТРЕТЬОМУ рівні
 * вкладеності. Рецензія задачі 7 підтвердила виконанням, що collectNames
 * дістає їх правильно, але жоден тест цього не документував — ось він.
 */
describe("reconcileWithDocument — вкладеність (спек §5.2)", () => {
  it("мовчить, коли вкладені contents.numberStyle і sequences.rules[].style є в документі", () => {
    expect(() =>
      reconcileWithDocument(
        конфіг({
          pagination: { contents: { numberStyle: "Зміст Номер сторінки" } },
          sequences: { rules: [{ style: "Нумерація питань", mustBeSequential: true }] },
        }),
        [...стилі, "Зміст Номер сторінки", "Нумерація питань"],
        ДОКУМЕНТ,
      ),
    ).not.toThrow();
  });

  it("відмовляє на вкладеному pagination.contents.numberStyle, якого немає в документі", () => {
    expect(() =>
      reconcileWithDocument(
        конфіг({ pagination: { contents: { numberStyle: "Зміст Неіснуючий" } } }),
        стилі,
        ДОКУМЕНТ,
      ),
    ).toThrow(ConfigError);
  });

  it("відмовляє на вкладеному sequences.rules[].style, якого немає в документі", () => {
    expect(() =>
      reconcileWithDocument(
        конфіг({
          sequences: { rules: [{ style: "Неіснуюча нумерація", mustBeSequential: true }] },
        }),
        стилі,
        ДОКУМЕНТ,
      ),
    ).toThrow(ConfigError);
  });
});

/*
 * СПРАВЖНІ ФОРМИ РОДИН `pagination` (задача A1) — і чому без цього блоку
 * виправлення форми МОВЧКИ ВБИЛО Б ступінь 2.
 *
 * Форму знає лише `pagination_audit` (`src/tools/pagination.ts:90-125,
 * 630-640`): `folio` — `{ styleName }`, `runningHead` — `{ styleNames }`,
 * `contents.levelMap[]` — `{ contentsStyle, headingStyles }`. Доки конфіг
 * ніс `"folio": "рядок"`, назву стилю збирав ключ `folio`. Після правки
 * форми назва переїхала на рівень нижче — у ключ `styleName`, якого в
 * `STYLE_KEYS` не було. Тобто саме ті ключі, чиї неправильні значення
 * дали 45 хибних знахідок, перестали б звірятися з документом узагалі.
 */
describe("reconcileWithDocument — справжні форми родин pagination (A1)", () => {
  it("мовчить, коли назви в folio.styleName і runningHead.styleNames є в документі", () => {
    expect(() =>
      reconcileWithDocument(
        конфіг({
          pagination: {
            folio: { styleNames: ["Колонтитул v1"] },
            runningHead: { styleNames: ["Колонтитул v1"] },
            headingStyles: ["Назва розділу"],
          },
        }),
        стилі,
        ДОКУМЕНТ,
      ),
    ).not.toThrow();
  });

  it("відмовляє на folio.styleNames, якого в документі немає", () => {
    expect(() =>
      reconcileWithDocument(конфіг({ pagination: { folio: { styleNames: ["Колонтитул v9"] } } }), стилі, ДОКУМЕНТ),
    ).toThrow(ConfigError);
  });

  it("відмовляє на runningHead.styleNames, якого в документі немає", () => {
    expect(() =>
      reconcileWithDocument(
        конфіг({ pagination: { runningHead: { styleNames: ["Колонтитул v1", "Колонтитул v9"] } } }),
        стилі,
        ДОКУМЕНТ,
      ),
    ).toThrow(ConfigError);
  });

  /*
   * F5: `contents.levelMap[].headingStyles` (`src/tools/pagination.ts`) —
   * ЄДИНА позиція нової форми, що не мала ні позитивного, ні негативного
   * тесту. Обхід `collectNames` її дістає (ключ `headingStyles` у
   * `STYLE_KEYS`, значення — масив рядків), тож це закріплення чинної
   * поведінки, а не виправлення. Закріплювати треба саме тому, що позиція
   * вкладена ТРИЧІ (contents → levelMap[] → headingStyles) і відрізняється
   * від голого `pagination.headingStyles` вище лише глибиною.
   */
  it("мовчить, коли всі contents.levelMap[].headingStyles є в документі", () => {
    expect(() =>
      reconcileWithDocument(
        конфіг({
          pagination: {
            contents: {
              numberStyle: "Зміст Номер сторінки",
              levelMap: [{ contentsStyle: "Зміст Розділ", headingStyles: ["Назва розділу"] }],
            },
          },
        }),
        [...стилі, "Зміст Номер сторінки", "Зміст Розділ"],
        ДОКУМЕНТ,
      ),
    ).not.toThrow();
  });

  it("відмовляє на contents.levelMap[].headingStyles, якого в документі немає", () => {
    expect(() =>
      reconcileWithDocument(
        конфіг({
          pagination: {
            contents: {
              numberStyle: "Зміст Номер сторінки",
              levelMap: [
                {
                  contentsStyle: "Зміст Розділ",
                  // Перша назва наявна, друга — ні: перевірка мусить дійти
                  // до КОЖНОГО елемента масиву, а не спинитись на першому.
                  headingStyles: ["Назва розділу", "Заголовок якого немає"],
                },
              ],
            },
          },
        }),
        [...стилі, "Зміст Номер сторінки", "Зміст Розділ"],
        ДОКУМЕНТ,
      ),
    ).toThrow(ConfigError);
  });

  it("відмовляє на contents.levelMap[].contentsStyle, якого в документі немає", () => {
    expect(() =>
      reconcileWithDocument(
        конфіг({
          pagination: {
            contents: {
              numberStyle: "Зміст Номер сторінки",
              levelMap: [{ contentsStyle: "Зміст Неіснуючий", headingStyles: ["Назва розділу"] }],
            },
          },
        }),
        [...стилі, "Зміст Номер сторінки"],
        ДОКУМЕНТ,
      ),
    ).toThrow(ConfigError);
  });
});

/*
 * extras.bodyTextStyles (приклад конфіга книжки, рядок 2522 плану) —
 * IMPORTANT #1 із рецензії: цей ключ не входив у STYLE_KEYS, тож
 * неіснуючий стиль тут проходив би звірку мовчки.
 */
describe("reconcileWithDocument — extras.bodyTextStyles", () => {
  it("мовчить, коли всі bodyTextStyles є в документі", () => {
    expect(() =>
      reconcileWithDocument(конфіг({ extras: { bodyTextStyles: ["Основний текст L"] } }), стилі, ДОКУМЕНТ),
    ).not.toThrow();
  });

  it("відмовляє на bodyTextStyles, якого в документі немає", () => {
    expect(() =>
      reconcileWithDocument(конфіг({ extras: { bodyTextStyles: ["Основний текст XL"] } }), стилі, ДОКУМЕНТ),
    ).toThrow(ConfigError);
  });
});

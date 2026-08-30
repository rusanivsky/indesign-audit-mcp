import { describe, expect, it } from "vitest";
import { ConfigError, validateConfig } from "../../src/cli/config/validate.js";
import {
  scaffoldConfig,
  titleFromName,
  unfilledSpots,
  підказкаСтилів,
  pathForConfig,
  UNCONFIRMED,
  type DocumentPassport,
} from "../../src/cli/config/scaffold.js";

const паспорт: DocumentPassport = {
  docName: "02 Зоряні Мрії 2022 Print 3 copy.indd",
  fullName: null,
  pageCount: 592,
  paragraphStyles: ["03 Основний текст", "Нумерація L", "Нумерація R", "Колонтитул L"],
};

describe("шлях документа для конфіга", () => {
  it("збережений документ адресується ПОВНИМ шляхом — тотожність це шлях, не назва (R10/R23)", () => {
    expect(pathForConfig({ ...паспорт, fullName: "/т/книжка.indd" })).toBe("/т/книжка.indd");
  });

  /*
   * Незбережений документ шляху не має. `chooseDocument` уміє приєднатися
   * до нього за іменем файлу, коли такий кандидат рівно один — тож ім'я
   * тут не милиця, а підтримана форма адресації.
   */
  it("незбережений — за іменем файлу, бо шляху ще не існує", () => {
    expect(pathForConfig(паспорт)).toBe("02 Зоряні Мрії 2022 Print 3 copy.indd");
  });

  it("назва видання — ім'я без розширення", () => {
    expect(titleFromName("02 Зоряні Мрії 2022 Print 3 copy.indd")).toBe(
      "02 Зоряні Мрії 2022 Print 3 copy",
    );
    expect(titleFromName("КНИЖКА.INDD")).toBe("КНИЖКА");
  });
});

describe("чернетка конфіга", () => {
  it("вписує виміряне: назву й шлях", () => {
    const c = scaffoldConfig(паспорт);
    expect(c.edition.title).toBe("02 Зоряні Мрії 2022 Print 3 copy");
    expect(c.edition.docPath).toBe("02 Зоряні Мрії 2022 Print 3 copy.indd");
  });

  /*
   * `print` — вимоги ДРУКАРНІ, не властивість файлу: документ їх не знає й
   * знати не може. Замовчування тут чесніше за позначку, бо числа
   * загальновживані й друкуються у звіті дослівно.
   */
  it("вписує друкарські замовчування числами, а не позначками", () => {
    const c = scaffoldConfig(паспорт);
    expect(c.print).toEqual({ minPpi: 300, maxTotalInk: 300, expectedInks: 4 });
  });

  /*
   * ГОЛОВНЕ. Здогад за назвою («Нумерація L» → колонцифра) написався б за
   * хвилину й коштував би Critical, як уже коштував (R26). Збірщик не
   * вгадує НІЧОГО, що адресує стилі.
   */
  it("НЕ вгадує стилів, хоч назви й самоописові", () => {
    const c = scaffoldConfig(паспорт);
    const текст = JSON.stringify(c);
    expect(текст).not.toContain("Нумерація L");
    expect(текст).not.toContain("03 Основний текст");
    expect(текст).not.toContain("Колонтитул L");
  });

  it("позначає рівно ті місця, де рішення за людиною", () => {
    expect(unfilledSpots(scaffoldConfig(паспорт)).sort()).toEqual([
      "families.extras.bodyTextStyles[0]",
      "families.pagination.folio.styleNames[0]",
      "families.pagination.headingStyles[0]",
      "families.pagination.runningHead.styleNames[0]",
      /* §3.3: доти чернетка видавала `sequences: { rules: [] }` — і саме
       * тому цього рядка тут не було. Порожній масив позначок не містить,
       * тож стан «родина виконується й не перевіряє нічого» роздавався
       * кожному новому виданню мовчки. */
      "families.sequences.rules[0].style",
    ]);
  });
});

describe("ступінь 1 відмовляє недозаповненій чернетці", () => {
  it("чернетка як є — ВІДМОВА, ще до дотику до InDesign", () => {
    expect(() => validateConfig(scaffoldConfig(паспорт))).toThrow(ConfigError);
  });

  it("причина називає кожну незаповнену клітинку поіменно", () => {
    try {
      validateConfig(scaffoldConfig(паспорт));
      expect.unreachable("мала бути відмова");
    } catch (e) {
      const текст = String((e as Error).message);
      expect(текст).toContain("families.pagination.folio.styleNames[0]");
      expect(текст).toContain("families.extras.bodyTextStyles[0]");
      /* §3.3: чернетка доти видавала `sequences: { rules: [] }` — стан, у
       * якому родина виконується, не перевіряє нічого й зникає зі звіту
       * цілком. Позначок порожній масив не містить, тож ця перевірка його
       * не бачила, і мовчазний стан роздавався кожному новому виданню. */
      expect(текст).toContain("families.sequences.rules[0].style");
      /* Причина мусить читатись як «ви не дозаповнили», а не як «щось не
       * так із документом»: інакше людина шукатиме проблему не там. */
      expect(текст).toMatch(/not fully filled in|--init draft/i);
    }
  });

  it("дозаповнена чернетка проходить", () => {
    const c = scaffoldConfig(паспорт);
    c.families.pagination = {
      folio: { styleNames: ["Нумерація L", "Нумерація R"] },
      runningHead: { styleNames: ["Колонтитул L"] },
      headingStyles: ["01-1 РОЗДІЛ право"],
    };
    c.families.extras = { bodyTextStyles: ["03 Основний текст"] };
    c.families.sequences = { rules: [{ style: "Нумерація питань" }] };
    expect(() => validateConfig(c)).not.toThrow();
  });

  it("порожній перелік правил sequences — відмова, а не мовчазне зникнення зі звіту", () => {
    /*
     * §3.3 передачі. `rules: []` гірший за `notApplicable`: прохід
     * виконується, платить за весь обхід документа й не перевіряє нічого, а
     * `out.sequences` при порожньому переліку не з'являється взагалі — тож
     * родина не потрапляє ні в «чисто», ні в «не бачили», ні в «потребує
     * очей». `notApplicable` хоч друкує причину.
     */
    const c = scaffoldConfig(паспорт);
    c.families.pagination = {
      folio: { styleNames: ["Нумерація L"] },
      runningHead: { styleNames: ["Колонтитул L"] },
      headingStyles: ["01-1 РОЗДІЛ право"],
    };
    c.families.extras = { bodyTextStyles: ["03 Основний текст"] };
    c.families.sequences = { rules: [] };
    expect(() => validateConfig(c)).toThrow(/sequences/);
  });

  it("sequences notApplicable проходить — причина принаймні друкується", () => {
    const c = scaffoldConfig(паспорт);
    c.families.pagination = {
      folio: { styleNames: ["Нумерація L"] },
      runningHead: { styleNames: ["Колонтитул L"] },
      headingStyles: ["01-1 РОЗДІЛ право"],
    };
    c.families.extras = { bodyTextStyles: ["03 Основний текст"] };
    c.families.sequences = { notApplicable: "у виданні немає нумерованих послідовностей" };
    expect(() => validateConfig(c)).not.toThrow();
  });

  /* Одна незаповнена клітинка з-поміж дозаповнених мусить спиняти так само:
   * «майже готовий» конфіг дає майже правильний звіт, тобто неправильний. */
  it("одна забута клітинка спиняє так само, як усі чотири", () => {
    const c = scaffoldConfig(паспорт);
    c.families.pagination = {
      folio: { styleNames: ["Нумерація L", "Нумерація R"] },
      runningHead: { styleNames: ["Колонтитул L"] },
      headingStyles: [UNCONFIRMED],
    };
    c.families.extras = { bodyTextStyles: ["03 Основний текст"] };
    expect(() => validateConfig(c)).toThrow(/headingStyles/);
  });
});

describe("підказка операторові", () => {
  it("перелічує ВСІ стилі документа, у порядку самого документа", () => {
    const текст = підказкаСтилів(паспорт);
    for (const s of паспорт.paragraphStyles) expect(текст).toContain(s);
    expect(текст.indexOf("03 Основний текст")).toBeLessThan(текст.indexOf("Нумерація L"));
  });

  it("називає обсяг документа, щоб було видно, чи це та книжка", () => {
    const текст = підказкаСтилів(паспорт);
    expect(текст).toContain("592");
    expect(текст).toContain(паспорт.docName);
  });
});

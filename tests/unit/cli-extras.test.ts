import { describe, expect, it } from "vitest";
import { summariseExtras, type ExtrasMeasure } from "../../src/cli/measure/extras.js";

/*
 * Підсумовувач тепер віддає ОБИДВІ мови (звіт має кнопку перемикання). Тести
 * читають українську половину — саме її бачить друкарня, і саме про неї всі
 * твердження нижче. Англійська половина перевіряється окремо, в кінці файла.
 */
function укр(m: ExtrasMeasure): { clean: string[]; findings: string[] } {
  const r = summariseExtras(m);
  return { clean: r.clean.map((b) => b.uk), findings: r.findings.map((b) => b.uk) };
}

const порожній: ExtrasMeasure = {
  docName: "к.indd",
  horizontalScaleOffenders: [],
  emptyParagraphs: 0,
  forcedBreaks: { total: 0, inBodyText: 0 },
  smallestPointSize: null,
  thinnestStrokePt: null,
  pasteboardItems: [],
  pageFormat: { width: 0, height: 0, units: "pt" },
  bleed: { top: 0, bottom: 0, inside: 0, outside: 0 },
};

describe("summariseExtras", () => {
  it("нуль горизонтальних масштабів іде в «чисто», а не зникає", () => {
    const { clean } = укр(порожній);
    expect(clean.join(" ")).toMatch(/горизонтальн/i);
  });

  it("масштаб ≠ 100 стає знахідкою з числом і сторінкою", () => {
    const { findings } = укр({
      ...порожній,
      horizontalScaleOffenders: [{ page: "47", style: "Зміст", scale: 109.63, count: 35 }],
    });
    expect(findings.join(" ")).toMatch(/109\.63/);
    expect(findings.join(" ")).toMatch(/47/);
  });

  it("волосяне обведення відрізняється від просто тонкого", () => {
    const тонке = укр({ ...порожній, thinnestStrokePt: 0.4 });
    expect(тонке.findings.join(" ")).not.toMatch(/волосян/i);
    const волосяне = укр({ ...порожній, thinnestStrokePt: 0.05 });
    expect(волосяне.findings.join(" ")).toMatch(/волосян/i);
  });

  /*
   * Раунд виправлень 2, Minor 3: кегль і обведення друкувались СИРИМИ — за
   * два рядки від формату, який раунд 1 уже округлив. У живій книжці обидва
   * виявились круглими, тож симптому в звіті не було; ці три тести
   * відтворюють числа, на яких він з'явився б, — саме тому фікстури мають
   * довгий хвіст, а не рівні 9.5 і 0.4 (на рівних округляти нічого, і тест
   * лишався б зеленим на нечитному звіті — та сама вада, що вже коштувала
   * раунду 1 переписаної фікстури формату).
   */
  it("Minor 3: найдрібніший кегль друкується округленим, а не сирим float", () => {
    const { clean } = укр({
      ...порожній,
      smallestPointSize: { pt: 8.503937007874016, style: "Виноска", page: "12" },
    });
    const text = clean.join(" ");
    expect(text).not.toContain("8.503937007874016");
    expect(text).toMatch(/Найдрібніший кегль: 8\.5 pt/);
    /* Адреса знахідки не втрачена разом із хвостом. */
    expect(text).toMatch(/Виноска/);
    expect(text).toMatch(/12/);
  });

  it("Minor 3: найтонше обведення в «чисто» теж округлене", () => {
    const { clean } = укр({
      ...порожній,
      thinnestStrokePt: 0.4000000000000001,
    });
    const text = clean.join(" ");
    expect(text).not.toContain("0.4000000000000001");
    expect(text).toMatch(/Найтонше обведення: 0\.4 pt/);
  });

  /*
   * Округлюється ПОКАЗ, а не поріг: 0.24999999999999997 тонше за 0.25, і
   * знахідка мусить спрацювати. Якби порівняння поїхало на округлене число,
   * 0.25 < 0.25 стало б хибним і волосяне обведення пішло б у «чисто» —
   * тихий зелений рядок на дефекті, який друкарня не відтворить.
   */
  it("Minor 3: поріг волосяної лишається на СИРОМУ числі — 0.2499… це знахідка", () => {
    const { clean, findings } = укр({
      ...порожній,
      thinnestStrokePt: 0.24999999999999997,
    });
    expect(findings.join(" ")).toMatch(/волосян/i);
    expect(clean.join(" ")).not.toMatch(/обведення/i);
    expect(findings.join(" ")).not.toContain("0.24999999999999997");
  });

  it("§2.6: «не визначили» рахується ОКРЕМО від монтажного столу", () => {
    /*
     * Доти обидва стани зливались в один `null`, і елемент, про який відомо
     * лише «прочитати не вдалося», потрапляв у `pasteboardItems` як доведено
     * позасторінковий — лічильник тихо роздувався.
     *
     * Тест водночас стереже, що лічильник має СПОЖИВАЧА: перша редакція
     * правки завела `unresolvedItems` у JSX і в тип, а прочитати його не
     * прочитував ніхто — тобто повторила ту саму ваду, яку закривала.
     */
    const { findings } = укр({ ...порожній, unresolvedItems: 7 });
    const текст = findings.join(" ");
    expect(текст).toMatch(/7/);
    expect(текст).toMatch(/НЕ визначено/);
    /* І прямо сказано, що це НЕ монтажний стіл. */
    expect(текст).toMatch(/не «на монтажному столі»/);
  });

  it("§2.6: нуль невизначених рядка не друкує — це стан кожного здорового прогону", () => {
    const { findings, clean } = укр({ ...порожній, unresolvedItems: 0 });
    expect([...findings, ...clean].join(" ")).not.toMatch(/НЕ визначено/);
  });

  it("§2.6: невизначені НЕ додаються до числа монтажного столу", () => {
    const { findings } = укр({
      ...порожній,
      pasteboardItems: [{ layer: "Шар 1", count: 19 }],
      unresolvedItems: 7,
    });
    const монтаж = findings.find((f) => f.includes("на шарі"));
    expect(монтаж).toMatch(/19/);
    expect(монтаж).not.toMatch(/26/);
  });

  it("об'єкти на монтажному столі рахуються по шарах", () => {
    const { findings } = укр({
      ...порожній,
      pasteboardItems: [{ layer: "_folio-helper", count: 169 }, { layer: "Шар 1", count: 19 }],
    });
    expect(findings.join(" ")).toMatch(/_folio-helper/);
    expect(findings.join(" ")).toMatch(/169/);
  });

  /*
   * Minor із рецензії раунду 1: на відміну від horizontalScaleOffenders /
   * emptyParagraphs / forcedBreaks, порожній pasteboardItems раніше просто
   * зникав — нуль не потрапляв у «чисто» жодним рядком. Це суперечило
   * власному коментарю файла про спек §8 (нуль має бути числом, а не
   * мовчанням).
   */
  it("порожній монтажний стіл іде в «чисто» з нулем, а не зникає (Minor раунду 1)", () => {
    const { clean, findings } = укр(порожній);
    expect(clean.join(" ")).toMatch(/монтажн/i);
    expect(findings.join(" ")).not.toMatch(/монтажн/i);
  });

  /*
   * R19 (задача 11 контрольної таблиці §10): формат сторінки й виліт — не в
   * жодній відповіді жодного інструмента. geometry_audit міряє їх усередині
   * (`GeometryMeasure`), але не виносить у звіт (`GeometryReport`). Числа
   * йдуть у «чисто», бо це не знахідка — це довідкові дані для регресійної
   * таблиці.
   */
  it("формат сторінки й виліт ідуть у «чисто» з числами (R19)", () => {
    const { clean } = укр({
      ...порожній,
      pageFormat: { width: 538.58, height: 623.62, units: "pt" },
      bleed: { top: 8.5, bottom: 0, inside: 8.5, outside: 8.5 },
    });
    const text = clean.join(" ");
    expect(text).toMatch(/538\.58/);
    expect(text).toMatch(/623\.62/);
    expect(text).toMatch(/8\.5/);
    expect(text).toMatch(/pt/);
  });

  it("одиниця вілету НЕ підмінюється: поле units іде дослівно, без перекладу", () => {
    const { clean } = укр({
      ...порожній,
      pageFormat: { width: 190, height: 220, units: "mm" },
      bleed: { top: 3, bottom: 0, inside: 3, outside: 3 },
    });
    const text = clean.join(" ");
    expect(text).toMatch(/\bmm\b/);
    expect(text).not.toMatch(/\bpt\b/);
  });

  /*
   * C3 (родина `sequences`, спек §4.4, рулінг R25): 185 номерів питань.
   * Формат — перелік розривів, а не вирок «послідовно/ні» (див. коментар
   * при `ExtrasMeasure.sequences`).
   */
  describe("sequences (C3)", () => {
    it("усі 185 розібрано, розривів немає — іде в «чисто» З ОБОМА числами", () => {
      const { clean, findings } = укр({
        ...порожній,
        sequences: [
          { style: "Нумерація питань", found: 185, parsed: 185, restarts: 12, breaks: [], unparsed: [] },
        ],
      });
      const text = clean.join(" ");
      expect(text).toMatch(/Нумерація «Нумерація питань»/);
      expect(text).toMatch(/185 абз\./);
      expect(text).toMatch(/розібрано 185/);
      expect(findings.join(" ")).not.toMatch(/Нумерація/);
    });

    /*
     * Minor 5 (раунд виправлень 1): рестарти нумерації — 12 на живому
     * документі — мусять бути видимі в самому рядку звіту, а не лише в
     * коментарі коду. Без цього поля «розривів немає» читається як
     * «суцільна нумерація», хоча насправді перевірено 12 окремих відрізків.
     */
    it("рестарти нумерації — видиме число в рядку, не лише коментар коду", () => {
      const { clean } = укр({
        ...порожній,
        sequences: [
          { style: "Нумерація питань", found: 185, parsed: 185, restarts: 12, breaks: [], unparsed: [] },
        ],
      });
      expect(clean.join(" ")).toMatch(/рестартів нумерації: 12/);
    });

    it("розрив — перелік, з попереднім числом, наступним і сторінкою", () => {
      const { findings } = укр({
        ...порожній,
        sequences: [
          {
            style: "Нумерація питань",
            found: 185,
            parsed: 185,
            restarts: 12,
            breaks: [{ prev: 6, next: 8, page: "27" }],
            unparsed: [],
          },
        ],
      });
      const text = findings.join(" ");
      expect(text).toMatch(/6/);
      expect(text).toMatch(/8/);
      expect(text).toMatch(/27/);
    });

    it("абзац, з якого число не читається взагалі, — ОКРЕМИЙ рядок, не мовчазний пропуск", () => {
      const { findings } = укр({
        ...порожній,
        sequences: [
          {
            style: "Нумерація питань",
            found: 185,
            parsed: 184,
            restarts: 12,
            breaks: [],
            unparsed: [{ page: "99", text: "дванадцять" }],
          },
        ],
      });
      const text = findings.join(" ");
      expect(text).toMatch(/не розпізнано/);
      expect(text).toMatch(/99/);
      expect(text).toMatch(/дванадцять/);
    });

    /*
     * Найважливіший тест файла: 0 розривів при 3 розібраних із 185 НЕ
     * сміє виглядати як «чисто» — інакше майже нічого не розібраний
     * парсер мовчки заспокоює.
     */
    it("0 розривів при 3 розібраних із 185 — НЕ «чисто»: parsed ≠ found це видає", () => {
      const { clean, findings } = укр({
        ...порожній,
        sequences: [
          {
            style: "Нумерація питань",
            found: 185,
            parsed: 3,
            restarts: 1,
            breaks: [],
            unparsed: [{ page: "1", text: "?" }],
          },
        ],
      });
      expect(clean.join(" ")).not.toMatch(/Нумерація/);
      const text = findings.join(" ");
      expect(text).toMatch(/розібрано 3/);
      expect(text).toMatch(/185/);
    });

    /*
     * Important 2 (раунд виправлень 1): `found === 0` — стилю в документі
     * НЕМАЄ (описка, або повний шлях замість барого імені — задача A
     * виміряла, що повний шлях резолвиться в НІЩО). До цієї правки
     * `breaks.length === 0 && unparsed.length === 0` було істинним і тут,
     * і правило з неіснуючим стилем друкувалось зеленим рядком «чисто».
     */
    it("found === 0 (стилю немає) — НЕ «чисто», окрема знахідка «нічого не перевірено»", () => {
      const { clean, findings } = укр({
        ...порожній,
        sequences: [
          { style: "Стилі книги / Нумерація питань", found: 0, parsed: 0, restarts: 0, breaks: [], unparsed: [] },
        ],
      });
      expect(clean.join(" ")).not.toMatch(/Нумерація/);
      const text = findings.join(" ");
      expect(text).toMatch(/не знайдено/);
      expect(text).toMatch(/нічого не перевірено/);
    });
  });
});

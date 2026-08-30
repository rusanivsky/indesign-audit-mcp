import { describe, expect, it } from "vitest";
import {
  DEFAULT_MIN_WORD_CHARS,
  DEFAULT_SHORT_LAST_LINE_FRACTION,
  detectLines,
  fillFraction,
  lineVerdict,
  lineWords,
  surveyLines,
} from "../../src/composition/detect-lines.js";
import type { LineMeasure } from "../../src/composition/types.js";
import { line } from "./helpers/composition.js";

type Opts = Parameters<typeof line>[0];

/**
 * Рядок за замовчуванням: придатний до виміру, у дворядковому абзаці, шириною
 * 23,2 пт при мірі 200 пт (заповнення 11,6%). Кожен тест перекриває рівно те,
 * що міряє.
 */
function ln(over: Partial<Opts> = {}): LineMeasure {
  return line({ spaceWidth: 3.2, isLast: false, ...over });
}

/** Кінцевий рядок нормальної довжини: 7 слів «аб» = 89,2 пт з 200 (44,6%). */
function normalLast(over: Partial<Opts> = {}): LineMeasure {
  return ln({ lineInParagraph: 1, paragraphLineCount: 2, words: 7, ...over });
}

describe("detectLines — визначення", () => {
  it("перший рядок абзацу внизу фрейму — сирота", () => {
    const f = detectLines([ln({ lineInParagraph: 0, paragraphLineCount: 3, isLastInFrame: true })]);
    expect(f.map((x) => x.defect)).toEqual(["orphan"]);
    expect(f[0]!.severity).toBe("error");
  });

  it("останній рядок абзацу вгорі фрейму — вісяк", () => {
    const f = detectLines([normalLast({ lineInParagraph: 2, paragraphLineCount: 3, isFirstInFrame: true })]);
    expect(f.map((x) => x.defect)).toEqual(["widow"]);
    expect(f[0]!.measured).toBeCloseTo(0.446, 3);
  });

  it("однорядковий абзац не є ні вісяком, ні сиротою, ні коротким кінцевим", () => {
    /* Гейт стоїть на визначенні, а не на частці: єдиний рядок абзацу є водночас
     * першим і останнім, відриватись нема від чого, а його «кінцевий рядок» —
     * це весь абзац. Рядок навмисно вузький (10 пт з 200 = 5%), тобто правило
     * ширини спрацювало б негайно, якби гейт зник. */
    const f = detectLines([
      ln({
        lineInParagraph: 0,
        paragraphLineCount: 1,
        words: 1,
        isFirstInFrame: true,
        isLastInFrame: true,
      }),
    ]);
    expect(f).toEqual([]);
  });

  it("рядок посеред абзацу на межі фрейму — не дефект позиції", () => {
    /* Якби перевірка «перший/останній у СВОЄМУ АБЗАЦІ» зникла, кожен рядок на
     * межі фрейму (620 фреймів книжки) став би знахідкою. */
    const f = detectLines([
      ln({
        lineInParagraph: 1,
        paragraphLineCount: 3,
        isFirstInFrame: true,
        isLastInFrame: true,
      }),
    ]);
    expect(f).toEqual([]);
  });

  it("кінцевий рядок унизу фрейму — не сирота, перший рядок угорі — не вісяк", () => {
    /* Дзеркальна перевірка: боки шва не можна плутати. */
    expect(detectLines([normalLast({ isLastInFrame: true })])).toEqual([]);
    expect(detectLines([ln({ lineInParagraph: 0, paragraphLineCount: 2, isFirstInFrame: true })])).toEqual(
      [],
    );
  });

  it("абзац на шві двох фреймів дає і сироту, і вісяка — щонайменше 32 такі абзаци", () => {
    const f = detectLines([
      ln({ lineInParagraph: 0, paragraphLineCount: 2, isLastInFrame: true, containerId: "story:1" }),
      normalLast({ isFirstInFrame: true, containerId: "story:2" }),
    ]);
    expect(f.map((x) => x.defect)).toEqual(["orphan", "widow"]);
  });
});

describe("detectLines — короткий кінцевий рядок", () => {
  it("дуже короткий кінцевий рядок абзацу — знахідка", () => {
    const f = detectLines([ln({ lineInParagraph: 1, paragraphLineCount: 2, words: 1, columnWidth: 200 })]);
    expect(f.map((x) => x.defect)).toEqual(["short-last-line"]);
    expect(f[0]!.measured).toBeCloseTo(0.05, 9);
  });

  it("нормальний кінцевий рядок не дає знахідки", () => {
    expect(detectLines([normalLast()])).toEqual([]);
  });

  it("рядок РІВНО на порозі не є дефектом, на волосину коротший — є", () => {
    /* Правило читається «менша за частку», тож порівняння строге. 6 літер по
     * 5 пт = 30 пт з 200 — це рівно 0,15 і в двійковому поданні теж. */
    const at = ln({ lineInParagraph: 1, paragraphLineCount: 2, words: 1, word: "абвгде", columnWidth: 200 });
    expect(fillFraction(at)).toBe(DEFAULT_SHORT_LAST_LINE_FRACTION);
    expect(detectLines([at])).toEqual([]);
    const below = ln({ lineInParagraph: 1, paragraphLineCount: 2, words: 1, word: "абвгд", columnWidth: 200 });
    expect(detectLines([below]).map((x) => x.defect)).toEqual(["short-last-line"]);
  });

  it("поріг короткого рядка перекривається параметром", () => {
    const f = detectLines([normalLast()], { shortLastLineFraction: 0.9 });
    expect(f.map((x) => x.defect)).toEqual(["short-last-line"]);
    expect(f[0]!.detail).toContain("threshold 90%");
  });

  it("кінцевий рядок з одного короткого слова — знахідка навіть при достатній ширині", () => {
    /* «та» — 10 пт з 40, тобто 25%: правило ширини мовчить, правило слова ні. */
    const f = detectLines([
      ln({ lineInParagraph: 1, paragraphLineCount: 2, words: 1, word: "та", columnWidth: 40 }),
    ]);
    expect(f.map((x) => x.defect)).toEqual(["short-last-line"]);
    expect(f[0]!.detail).toContain('"та"');
    expect(f[0]!.measured).toBeCloseTo(0.25, 9);
  });

  it("слово рівно на порозі довжини не є дефектом; поріг перекривається", () => {
    const four = ln({ lineInParagraph: 1, paragraphLineCount: 2, words: 1, word: "абвг", columnWidth: 60 });
    expect(DEFAULT_MIN_WORD_CHARS).toBe(4);
    expect(detectLines([four])).toEqual([]);
    expect(detectLines([four], { minWordChars: 5 }).map((x) => x.defect)).toEqual(["short-last-line"]);
  });

  it("правило слова стосується РІВНО одного слова, а не найкоротшого", () => {
    /* Два коротких слова «та та» — 23,2 пт з 100 (23%): обидва правила мовчать.
     * Якби перевірка кількості слів зникла, рядок став би знахідкою. */
    const f = detectLines([
      ln({ lineInParagraph: 1, paragraphLineCount: 2, words: 2, word: "та", columnWidth: 100 }),
    ]);
    expect(f).toEqual([]);
  });

  it("керівні символи C0 не рахуються символами слова", () => {
    /* Виміряно: якір таблиці — U+0016, маркер виноски — U+0004. Без заміни
     * слово «абв» з маркером мало б довжину 4 і поріг 4 його б не побачив. */
    const withMarker = ln({
      lineInParagraph: 1,
      paragraphLineCount: 2,
      words: 1,
      word: "абв\u0004",
      columnWidth: 40,
    });
    /* Шар виміру віддає C0 як `ch: null` при справжньому символі в `text` —
     * фікстура зобов'язана поводитись так само, інакше маркер виноски мовчки
     * додав би рядкові власну ширину й змістив би заповнення (15 пт з 40, а не
     * 20 з 40). */
    expect(withMarker.text).toHaveLength(4);
    expect(withMarker.chars).toHaveLength(4);
    expect(withMarker.chars[3]!.ch).toBeNull();
    expect(fillFraction(withMarker)).toBeCloseTo(0.375, 9);
    expect(lineWords(withMarker.text)).toEqual(["абв"]);
    expect(detectLines([withMarker]).map((x) => x.defect)).toEqual(["short-last-line"]);
  });

  it("одна знахідка на клас: рядок, що порушує ОБИДВА правила, не двоїться", () => {
    /* Інакше два `short-last-line` на один рядок дістали б однаковий findingId. */
    const f = detectLines([
      ln({ lineInParagraph: 1, paragraphLineCount: 2, words: 1, word: "та", columnWidth: 200 }),
    ]);
    expect(f).toHaveLength(1);
    expect(f[0]!.detail).toContain("of column width");
  });

  it("не кінцевий рядок правилами довжини не судиться", () => {
    /* Не останній рядок може бути коротким лише через примусовий перенос —
     * це дефект Задачі 8, не цієї. */
    expect(detectLines([ln({ lineInParagraph: 1, paragraphLineCount: 3, words: 1 })])).toEqual([]);
  });
});

describe("detectLines — спільні поправки виміру", () => {
  it("непридатний рядок не дає ЖОДНОЇ знахідки, хоч виглядає найгіршою", () => {
    /* 595 рядків з 5 193. Порожній абзац має ПОВНУ міру при ширині 2,3 пт, тобто
     * заповнення ≈0 — для детектора це найгрубіший короткий кінцевий у книжці;
     * повернута рамка дає right − left === 0. Сирота перевіряється окремо, бо
     * вона єдина не потребує геометрії й гейт придатності — єдине, що її спиняє. */
    const widowish = [
      ln({ lineInParagraph: 1, paragraphLineCount: 2, isFirstInFrame: true, rotated: true }),
      ln({ lineInParagraph: 1, paragraphLineCount: 2, isFirstInFrame: true, rotationAngle: 30 }),
      ln({ lineInParagraph: 1, paragraphLineCount: 2, isFirstInFrame: true, empty: true }),
    ];
    const orphanish = [
      ln({ lineInParagraph: 0, paragraphLineCount: 3, isLastInFrame: true, rotated: true }),
      ln({ lineInParagraph: 0, paragraphLineCount: 3, isLastInFrame: true, rotationAngle: 30 }),
      ln({ lineInParagraph: 0, paragraphLineCount: 3, isLastInFrame: true, empty: true }),
    ];
    expect(detectLines(widowish)).toEqual([]);
    expect(detectLines(orphanish)).toEqual([]);
    expect(surveyLines([...widowish, ...orphanish]).excluded.notMeasurable).toBe(6);
  });

  it("кінцевий пробіл не зараховується в ширину рядка", () => {
    /* Виміряно: 13 рядків книжки «перевищують» міру до 4,599 пт, і всі 13 —
     * через кінцевий пробіл. По сирому `right` цей рядок мав би 35/200 = 17,5%
     * і знахідки не дав би; по правому краю останнього гліфа — 5%. */
    const l = ln({
      lineInParagraph: 1,
      paragraphLineCount: 2,
      words: 1,
      trailingSpace: 25,
      columnWidth: 200,
    });
    expect(l.right - l.left).toBeCloseTo(35, 9);
    const f = detectLines([l]);
    expect(f.map((x) => x.defect)).toEqual(["short-last-line"]);
    expect(f[0]!.measured).toBeCloseTo(0.05, 9);
  });

  it("гейт придатності у fillFraction тримається В РАНТАЙМІ, а не лише в типах", () => {
    /* `MeasurableLine` — бренд, і `measurable.ts` прямо каже, що він НЕ переживає
     * `JSON.parse`, а саме так `MeasureResult` приходить від JSX: рантайм-
     * валідатора на цій межі немає. Тобто без рантайм-перевірки повернута рамка
     * віддала б заповнення 0 (right − left === 0), а порожній абзац — теж 0 при
     * повній мірі, і обидва очолили б звіт як «порожні кінцеві рядки».
     * Без цього тесту зняття гейта ловив би самий лише `tsc`. */
    const rotated = JSON.parse(JSON.stringify(ln({ rotated: true }))) as LineMeasure;
    const empty = JSON.parse(JSON.stringify(ln({ empty: true }))) as LineMeasure;
    expect(rotated.right - rotated.left).toBe(0);
    expect(fillFraction(rotated)).toBeNull();
    expect(fillFraction(empty)).toBeNull();
  });

  it("недодатна міра: заповнення не виміряне, тож ні вісяка, ні короткого кінцевого", () => {
    /* `Finding.measured` — завжди число; вигадати заповнення не можна. */
    expect(fillFraction(ln({ columnWidth: 0 }))).toBeNull();
    expect(
      detectLines([
        ln({ lineInParagraph: 1, paragraphLineCount: 2, isFirstInFrame: true, columnWidth: 0 }),
      ]),
    ).toEqual([]);
  });

  it("сирота видається й без виміряної міри — її величина не з геометрії", () => {
    const f = detectLines([
      ln({ lineInParagraph: 0, paragraphLineCount: 2, isLastInFrame: true, columnWidth: 0 }),
    ]);
    expect(f.map((x) => x.defect)).toEqual(["orphan"]);
    expect(f[0]!.measured).toBe(0.5);
  });
});

describe("detectLines — сила й порядок", () => {
  it("вісяки ранжуються ПОРОЖНЕЧЕЮ рядка: коротший стоїть вище", () => {
    /* Обидва вісяки навмисно ДОВШІ за поріг короткого кінцевого (24,8% і 90,8%),
     * тобто в результаті лише клас `widow` — міряється саме його ранжування. */
    const short = ln({
      lineInParagraph: 1,
      paragraphLineCount: 2,
      isFirstInFrame: true,
      words: 4,
      containerId: "story:1",
    });
    const long = ln({
      lineInParagraph: 1,
      paragraphLineCount: 2,
      isFirstInFrame: true,
      words: 14,
      containerId: "story:2",
    });
    const f = detectLines([long, short]);
    expect(f.map((x) => x.defect)).toEqual(["widow", "widow"]);
    expect(f.map((x) => x.containerId)).toEqual(["story:1", "story:2"]);
    expect(f[0]!.strength).toBeCloseTo(1 - (4 * 10 + 3 * 3.2) / 200, 9);
    expect(f[1]!.strength).toBeCloseTo(1 - (14 * 10 + 13 * 3.2) / 200, 9);
  });

  it("сироти ранжуються ЧАСТКОЮ АБЗАЦУ: розірваний навпіл — найгірший", () => {
    /* Порожнеча для сироти не працює: сирота — не кінцевий рядок і у виключеному
     * абзаці дотягує до міри (виміряно на 1 403 рядках), тобто «1 − заповнення»
     * дало б ≈0 усім. Абзац на 2 рядки віддає шву половину себе, на 10 — десяту. */
    const half = ln({
      lineInParagraph: 0,
      paragraphLineCount: 2,
      isLastInFrame: true,
      containerId: "story:2",
    });
    const tenth = ln({
      lineInParagraph: 0,
      paragraphLineCount: 10,
      isLastInFrame: true,
      containerId: "story:1",
    });
    const f = detectLines([tenth, half]);
    expect(f.map((x) => x.containerId)).toEqual(["story:2", "story:1"]);
    expect(f.map((x) => x.strength)).toEqual([0.5, 0.1]);
    /* Обидві сироти заповнюють міру однаково — порожнеча їх не розрізнила б. */
    expect(fillFraction(half)).toBe(fillFraction(tenth));
  });

  it("класи не змішуються в одному ранжуванні — міжкласової шкали немає", () => {
    /* Сирота з силою 0,1 стоїть ВИЩЕ за вісяка з силою 0,95 не тому, що вона
     * гірша, а тому, що порівнювати їх нема чим: 0,1 абзацу й 0,95 рядка — різні
     * одиниці. Клас іде першим ключем саме як відмова стверджувати порядок. */
    const orphan = ln({
      lineInParagraph: 0,
      paragraphLineCount: 10,
      isLastInFrame: true,
      containerId: "story:9",
    });
    const widow = ln({
      lineInParagraph: 1,
      paragraphLineCount: 2,
      isFirstInFrame: true,
      words: 4,
      containerId: "story:1",
    });
    const f = detectLines([widow, orphan]);
    expect(f.map((x) => x.defect)).toEqual(["orphan", "widow"]);
    expect(f[0]!.strength).toBeLessThan(f[1]!.strength);
  });

  it("за рівної сили порядок визначає ключ — прогін відтворюваний", () => {
    const f = detectLines([
      ln({ lineInParagraph: 0, paragraphLineCount: 3, isLastInFrame: true, containerId: "story:9" }),
      ln({ lineInParagraph: 0, paragraphLineCount: 3, isLastInFrame: true, containerId: "story:1" }),
      ln({ lineInParagraph: 0, paragraphLineCount: 3, isLastInFrame: true, containerId: "story:5" }),
    ]);
    expect(new Set(f.map((x) => x.strength)).size).toBe(1);
    expect(f.map((x) => x.containerId)).toEqual(["story:1", "story:5", "story:9"]);
  });

  it("порядок відтворюється з самих лише знахідок — LineMeasure не потрібні", () => {
    /* Саме заради цього `strength` обов'язкове: Задача 12 ріже документ на пачки
     * сторінок і зводить їх, маючи на руках тільки Finding[]. */
    const f = detectLines([
      ln({ lineInParagraph: 1, paragraphLineCount: 2, isFirstInFrame: true, words: 4, containerId: "story:1" }),
      ln({ lineInParagraph: 1, paragraphLineCount: 2, isFirstInFrame: true, words: 14, containerId: "story:2" }),
    ]);
    const shuffled = [...f].reverse();
    shuffled.sort((a, b) => b.strength - a.strength);
    expect(shuffled.map((x) => x.containerId)).toEqual(["story:1", "story:2"]);
  });

  it("сила невід'ємна навіть коли рядок виступає за міру", () => {
    /* Контракт `Finding.strength`: невід'ємна. Рядок, ширший за власну міру,
     * дав би «мінус повітря». */
    const f = detectLines([
      ln({ lineInParagraph: 1, paragraphLineCount: 2, isFirstInFrame: true, overshoot: 5 }),
    ]);
    expect(f).toHaveLength(1);
    expect(f[0]!.measured).toBeGreaterThan(1);
    expect(f[0]!.strength).toBe(0);
  });

  it("виміряна величина в кожного класу СВОЯ, і це видно", () => {
    const f = detectLines([
      ln({ lineInParagraph: 0, paragraphLineCount: 4, isLastInFrame: true, containerId: "story:1" }),
      ln({ lineInParagraph: 1, paragraphLineCount: 2, isFirstInFrame: true, words: 4, containerId: "story:2" }),
    ]);
    /* Сирота: 1/4 АБЗАЦУ. Вісяк: 24,8% МІРИ. Числа близькі випадково — одиниці
     * різні, і саме тому вони не в одному ранжуванні. */
    expect(f.find((x) => x.defect === "orphan")!.measured).toBe(0.25);
    expect(f.find((x) => x.defect === "widow")!.measured).toBeCloseTo(0.248, 9);
  });
});

describe("detectLines — вага, ключ, пояснення", () => {
  it("вага всіх знахідок цього детектора — error, і це свідоме рішення", () => {
    /* `warning` потребує смуги, якої ніхто не міряв; `info` недосяжне, бо
     * детектор відбирає, а не ранжує все; `unrated` недосяжне, бо невиміряний
     * рядок тут не дає знахідки взагалі. Задачі 12: сортувати за severity
     * безглуздо, порядок несе strength. */
    const f = detectLines([
      ln({ lineInParagraph: 0, paragraphLineCount: 3, isLastInFrame: true, containerId: "story:1" }),
      ln({ lineInParagraph: 1, paragraphLineCount: 2, isFirstInFrame: true, words: 1, containerId: "story:2" }),
    ]);
    expect(f).toHaveLength(3);
    expect(new Set(f.map((x) => x.severity))).toEqual(new Set(["error"]));
  });

  it("один рядок, дві знахідки — і ключі в них різні", () => {
    const f = detectLines([
      ln({ lineInParagraph: 1, paragraphLineCount: 2, isFirstInFrame: true, words: 1, word: "та" }),
    ]);
    expect(f.map((x) => x.defect)).toEqual(["short-last-line", "widow"]);
    expect(new Set(f.map((x) => x.id)).size).toBe(2);
  });

  it("ключ стабільний між прогонами", () => {
    const input = [ln({ lineInParagraph: 0, paragraphLineCount: 3, isLastInFrame: true })];
    expect(detectLines(input)[0]!.id).toBe(detectLines(input)[0]!.id);
    expect(detectLines(input)[0]!.id).toBe("orphan:story:0:0:0");
  });

  it("пояснення називає величину людською мовою", () => {
    const f = detectLines([
      ln({ lineInParagraph: 0, paragraphLineCount: 4, isLastInFrame: true, containerId: "story:1" }),
      ln({ lineInParagraph: 3, paragraphLineCount: 4, isFirstInFrame: true, words: 7, containerId: "story:2" }),
    ]);
    const orphan = f.find((x) => x.defect === "orphan")!;
    const widow = f.find((x) => x.defect === "widow")!;
    expect(orphan.detail).toContain("3 of 4 lines");
    expect(orphan.detail).toContain("25%");
    expect(widow.detail).toContain("45%");
    expect(widow.detail).toContain("3 of 4 lines");
  });

  it("текст рядка їде разом зі знахідкою", () => {
    const f = detectLines([
      ln({ lineInParagraph: 1, paragraphLineCount: 2, words: 1, word: "та", columnWidth: 40 }),
    ]);
    expect(f[0]!.lineText).toBe("та");
  });
});

describe("lineVerdict і surveyLines", () => {
  it("кожен рядок потрапляє рівно в одну категорію", () => {
    const corpus = [
      ln({ lineInParagraph: 0, paragraphLineCount: 1 }) /* однорядковий */,
      ln({ rotated: true }) /* непридатний */,
      ln({ empty: true }) /* непридатний */,
      ln({ lineInParagraph: 0, paragraphLineCount: 2 }) /* судимий, не кінцевий */,
      normalLast({ containerId: "story:1" }) /* судимий, кінцевий */,
    ];
    const s = surveyLines(corpus);
    expect(s.excluded).toEqual({ notMeasurable: 2, singleLine: 1, noMeasure: 0 });
    expect(s.judged).toBe(2);
    expect(s.lastLines).toBe(1);
  });

  it("класифікація експортована — Задача 12 не виводить знаменник заново", () => {
    expect(lineVerdict(ln({ rotated: true })).kind).toBe("not-measurable");
    expect(lineVerdict(ln({ lineInParagraph: 0, paragraphLineCount: 1 })).kind).toBe("single-line");
    expect(lineVerdict(ln()).kind).toBe("judged");
  });

  it("однорядкові абзаци рахуються окремо, а не як «чисто»", () => {
    /* Без окремого лічильника однорядкові абзаци мовчки розбавляли б знаменник,
     * за яким людина обирає поріг. */
    const s = surveyLines([
      ln({ lineInParagraph: 0, paragraphLineCount: 1, words: 1 }),
      ln({ lineInParagraph: 0, paragraphLineCount: 1, words: 1 }),
      normalLast(),
    ]);
    expect(s.excluded.singleLine).toBe(2);
    expect(s.lastLines).toBe(1);
    expect(s.fills).toHaveLength(1);
  });

  it("віддає розподіл заповнення кінцевих рядків — вхідні дані для порогу", () => {
    const s = surveyLines([
      ln({ lineInParagraph: 1, paragraphLineCount: 2, words: 1, containerId: "story:1" }) /* 5% */,
      normalLast({ containerId: "story:2" }) /* 44,6% */,
      ln({ lineInParagraph: 1, paragraphLineCount: 2, words: 14, containerId: "story:3" }) /* 90,8% */,
    ]);
    expect(s.fills).toEqual([...s.fills].sort((a, b) => a - b));
    expect(s.percentiles.min).toBeCloseTo(0.05, 9);
    expect(s.percentiles.max).toBeCloseTo(0.908, 3);
    expect(s.percentiles.p50).toBeCloseTo(0.446, 3);
  });

  it("віддає довжини однослівних кінцевих рядків — бо поріг слова не виміряний", () => {
    const s = surveyLines([
      ln({ lineInParagraph: 1, paragraphLineCount: 2, words: 1, word: "та", containerId: "story:1" }),
      ln({ lineInParagraph: 1, paragraphLineCount: 2, words: 1, word: "абвгд", containerId: "story:2" }),
      normalLast({ containerId: "story:3" }) /* сім слів — не однослівний */,
    ]);
    expect(s.singleWordLengths).toEqual([2, 5]);
  });

  it("рахує структурні дефекти, нічого не позначаючи", () => {
    const s = surveyLines([
      ln({ lineInParagraph: 0, paragraphLineCount: 2, isLastInFrame: true, containerId: "story:1" }),
      normalLast({ isFirstInFrame: true, containerId: "story:2" }),
      normalLast({ containerId: "story:3" }),
    ]);
    expect(s.counts).toEqual({ widow: 1, orphan: 1 });
  });

  it("недодатна міра має власний лічильник, а не тоне в розподілі", () => {
    const s = surveyLines([normalLast({ columnWidth: 0, containerId: "story:1" })]);
    expect(s.excluded.noMeasure).toBe(1);
    expect(s.lastLines).toBe(0);
  });

  it("порожня вибірка дає NaN, а не нуль — нуль читався б як «усі рядки порожні»", () => {
    const s = surveyLines([]);
    expect(s.judged).toBe(0);
    expect(s.percentiles.p50).toBeNaN();
    expect(s.percentiles.min).toBeNaN();
    expect(s.percentiles.max).toBeNaN();
  });
});

/**
 * Задача 10 Фази 4: борг закритий — політика щодо `isMaster` тепер оголошена
 * САМЕ ТУТ, у детекторі, а не лише в обробнику `composition_audit` нагорі.
 */
describe("detectLines — includeMasters", () => {
  it("за замовчуванням рядки батьківських сторінок НЕ рахуються", () => {
    const lines = [normalLast({ isFirstInFrame: true, isMaster: true })];
    expect(detectLines(lines, {}).length).toBe(0);
  });

  it("includeMasters: true їх повертає", () => {
    const lines = [normalLast({ isFirstInFrame: true, isMaster: true })];
    expect(detectLines(lines, { includeMasters: true }).length).toBeGreaterThan(0);
  });
});

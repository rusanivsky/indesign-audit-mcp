import { describe, expect, it } from "vitest";
import { detectHyphens, surveyHyphens } from "../../src/composition/detect-hyphens.js";
import { line } from "./helpers/composition.js";

/*
 * `Partial<…>`, а не `Parameters<typeof line>[0]` — обидва хелпери самі
 * підставляють обов'язкові `spaceWidth` і `isLast`, тож вимагати їх від
 * викликача означало б вимагати те, що він і не має задавати. Повний тип тут
 * стояв від початку й давав 129 помилок typecheck — усі невидимі, бо
 * `tsconfig.json` включав лише `src/**` (борг знайдено 2026-08-05). Заразом
 * зникає TS2783 «spaceWidth вказано двічі»: з необов'язковими полями spread
 * уже не гарантовано затирає явні значення.
 */
type LineOver = Partial<Parameters<typeof line>[0]>;

/** Рядок із переносом за замовчуванням: придатний, не останній в абзаці. */
function h(over: LineOver) {
  return line({ spaceWidth: 3.2, isLast: false, ...over });
}

/** Абзац із трьох слів, останнє з яких — уламок перенесеного слова. */
function tail(words: string[], over: LineOver) {
  return h({ wordList: words, ...over });
}

describe("detectHyphens — драбина", () => {
  it("три переноси підряд — драбина", () => {
    const f = detectHyphens([
      h({ lineInParagraph: 0, paragraphLineCount: 4, endsWithHyphen: true }),
      h({ lineInParagraph: 1, paragraphLineCount: 4, endsWithHyphen: true }),
      h({ lineInParagraph: 2, paragraphLineCount: 4, endsWithHyphen: true }),
      h({ lineInParagraph: 3, paragraphLineCount: 4, endsWithHyphen: false }),
    ]);
    expect(f.map((x) => x.defect)).toEqual(["hyphen-ladder"]);
    expect(f[0]!.lineInParagraph).toBe(0);
    expect(f[0]!.measured).toBe(3);
    expect(f[0]!.strength).toBe(3);
  });

  it("два переноси підряд — у межах норми", () => {
    const f = detectHyphens([
      h({ lineInParagraph: 0, paragraphLineCount: 3, endsWithHyphen: true }),
      h({ lineInParagraph: 1, paragraphLineCount: 3, endsWithHyphen: true }),
      h({ lineInParagraph: 2, paragraphLineCount: 3, endsWithHyphen: false }),
    ]);
    expect(f).toEqual([]);
  });

  it("поріг драбини перекривається параметром", () => {
    const f = detectHyphens(
      [
        h({ lineInParagraph: 0, paragraphLineCount: 3, endsWithHyphen: true }),
        h({ lineInParagraph: 1, paragraphLineCount: 3, endsWithHyphen: true }),
        h({ lineInParagraph: 2, paragraphLineCount: 3, endsWithHyphen: false }),
      ],
      { maxLadder: 1 },
    );
    expect(f.map((x) => x.defect)).toEqual(["hyphen-ladder"]);
    expect(f[0]!.measured).toBe(2);
  });

  it("драбина не тягнеться крізь межу абзацу", () => {
    const f = detectHyphens([
      h({ paragraphIndex: 0, lineInParagraph: 0, paragraphLineCount: 2, endsWithHyphen: true }),
      h({ paragraphIndex: 0, lineInParagraph: 1, paragraphLineCount: 2, endsWithHyphen: true }),
      h({ paragraphIndex: 1, lineInParagraph: 0, paragraphLineCount: 2, endsWithHyphen: true }),
      h({ paragraphIndex: 1, lineInParagraph: 1, paragraphLineCount: 2, endsWithHyphen: true }),
    ]);
    expect(f).toEqual([]);
  });

  it("драбина не тягнеться крізь межу контейнера", () => {
    const f = detectHyphens([
      h({ containerId: "story:0", lineInParagraph: 0, paragraphLineCount: 2, endsWithHyphen: true }),
      h({ containerId: "story:0", lineInParagraph: 1, paragraphLineCount: 2, endsWithHyphen: true }),
      h({ containerId: "story:1", lineInParagraph: 2, paragraphLineCount: 4, endsWithHyphen: true }),
      h({ containerId: "story:1", lineInParagraph: 3, paragraphLineCount: 4, endsWithHyphen: true }),
    ]);
    expect(f).toEqual([]);
  });

  it("драбина не тягнеться крізь ДІРКУ в нумерації рядків абзацу", () => {
    /* Масив може прийти профільтрованим — сусідство в масиві не означає
     * сусідства на сторінці. Без перевірки безперервності це була б драбина. */
    const f = detectHyphens([
      h({ lineInParagraph: 0, paragraphLineCount: 9, endsWithHyphen: true }),
      h({ lineInParagraph: 1, paragraphLineCount: 9, endsWithHyphen: true }),
      h({ lineInParagraph: 5, paragraphLineCount: 9, endsWithHyphen: true }),
      h({ lineInParagraph: 6, paragraphLineCount: 9, endsWithHyphen: true }),
    ]);
    expect(f).toEqual([]);
  });

  it("непридатний рядок розриває драбину, а не подовжує її", () => {
    const f = detectHyphens([
      h({ lineInParagraph: 0, paragraphLineCount: 5, endsWithHyphen: true }),
      h({ lineInParagraph: 1, paragraphLineCount: 5, endsWithHyphen: true }),
      h({ lineInParagraph: 2, paragraphLineCount: 5, endsWithHyphen: true, rotated: true }),
      h({ lineInParagraph: 3, paragraphLineCount: 5, endsWithHyphen: true }),
      h({ lineInParagraph: 4, paragraphLineCount: 5, endsWithHyphen: true }),
    ]);
    expect(f).toEqual([]);
  });

  it("непридатний рядок РОЗРИВАЄ прогін навіть без дірки в нумерації", () => {
    /* Фікстура навмисно штучна: непридатний рядок узято з ІНШОГО контейнера,
     * щоб нумерація рядків абзацу лишилась суцільною (0,1,2,3). Інакше правило
     * «непридатний рядок розриває прогін» неможливо відрізнити від правила
     * безперервності нумерації — воно завжди спрацьовувало б першим. */
    const withGap = [
      h({ lineInParagraph: 0, paragraphLineCount: 4, endsWithHyphen: true }),
      h({ lineInParagraph: 1, paragraphLineCount: 4, endsWithHyphen: true }),
      h({ containerId: "колонтитул", lineInParagraph: 0, rotated: true, endsWithHyphen: true }),
      h({ lineInParagraph: 2, paragraphLineCount: 4, endsWithHyphen: true }),
      h({ lineInParagraph: 3, paragraphLineCount: 4, endsWithHyphen: true }),
    ];
    expect(detectHyphens(withGap)).toEqual([]);
    expect(surveyHyphens(withGap).runs).toEqual([2, 2]);
  });

  it("прогін не тягнеться крізь межу абзацу навіть при суцільній нумерації", () => {
    /* Друга штучна фікстура: `lineInParagraph` не скидається на межі абзацу,
     * чого шар виміру не робить. Вона пришпилює сам предикат «фізично
     * наступний рядок», а не той його доданок, що спрацьовує на цій книжці. */
    expect(
      detectHyphens([
        h({ paragraphIndex: 0, lineInParagraph: 0, paragraphLineCount: 2, endsWithHyphen: true }),
        h({ paragraphIndex: 0, lineInParagraph: 1, paragraphLineCount: 2, endsWithHyphen: true }),
        h({ paragraphIndex: 1, lineInParagraph: 2, paragraphLineCount: 4, endsWithHyphen: true }),
        h({ paragraphIndex: 1, lineInParagraph: 3, paragraphLineCount: 4, endsWithHyphen: true }),
      ]),
    ).toEqual([]);
  });

  it("порожній абзац не судиться і не потрапляє у знаменник", () => {
    const f = detectHyphens([h({ empty: true, endsWithHyphen: true, lineInParagraph: 0 })]);
    expect(f).toEqual([]);
    const s = surveyHyphens([h({ empty: true, endsWithHyphen: true, lineInParagraph: 0 })]);
    expect(s.judged).toBe(0);
    expect(s.excluded.notMeasurable).toBe(1);
  });

  it("драбина в кінці масиву все одно видається", () => {
    /* Прогін не завершується «чистим» рядком — його закриває фінальний flush. */
    const f = detectHyphens([
      h({ lineInParagraph: 0, paragraphLineCount: 4, endsWithHyphen: true }),
      h({ lineInParagraph: 1, paragraphLineCount: 4, endsWithHyphen: true }),
      h({ lineInParagraph: 2, paragraphLineCount: 4, endsWithHyphen: true }),
    ]);
    expect(f.map((x) => x.defect)).toEqual(["hyphen-ladder"]);
    expect(f[0]!.measured).toBe(3);
  });

  it("довша драбина має більшу силу", () => {
    const long = detectHyphens([
      h({ containerId: "a", lineInParagraph: 0, paragraphLineCount: 5, endsWithHyphen: true }),
      h({ containerId: "a", lineInParagraph: 1, paragraphLineCount: 5, endsWithHyphen: true }),
      h({ containerId: "a", lineInParagraph: 2, paragraphLineCount: 5, endsWithHyphen: true }),
      h({ containerId: "a", lineInParagraph: 3, paragraphLineCount: 5, endsWithHyphen: true }),
      h({ containerId: "a", lineInParagraph: 4, paragraphLineCount: 5, endsWithHyphen: false }),
    ]);
    const short = detectHyphens([
      h({ containerId: "b", lineInParagraph: 0, paragraphLineCount: 4, endsWithHyphen: true }),
      h({ containerId: "b", lineInParagraph: 1, paragraphLineCount: 4, endsWithHyphen: true }),
      h({ containerId: "b", lineInParagraph: 2, paragraphLineCount: 4, endsWithHyphen: true }),
      h({ containerId: "b", lineInParagraph: 3, paragraphLineCount: 4, endsWithHyphen: false }),
    ]);
    expect(long[0]!.strength).toBeGreaterThan(short[0]!.strength);
  });

  it("нецілий чи нульовий maxLadder — помилка, а не тихий звіт про кожен перенос", () => {
    const l = [h({ lineInParagraph: 0, paragraphLineCount: 2, endsWithHyphen: true })];
    expect(() => detectHyphens(l, { maxLadder: 0 })).toThrow(/maxLadder/);
    expect(() => detectHyphens(l, { maxLadder: 1.5 })).toThrow(/maxLadder/);
  });
});

describe("detectHyphens — перенос через розворот", () => {
  it("перенос на межі сторінки — окрема знахідка", () => {
    const f = detectHyphens([
      tail(["звернувся", "до", "Шевчен"], {
        lineInParagraph: 0,
        paragraphLineCount: 2,
        endsWithHyphen: true,
        isLastInFrame: true,
        page: "12",
      }),
      tail(["ком,", "і", "далі"], {
        lineInParagraph: 1,
        paragraphLineCount: 2,
        endsWithHyphen: false,
        page: "13",
      }),
    ]);
    expect(f.map((x) => x.defect)).toEqual(["hyphen-across-spread"]);
    /* «Шевчен» лишилось, «ком» перенесено: 3 літери з 9. */
    expect(f[0]!.measured).toBe(3);
    expect(f[0]!.strength).toBeCloseTo(3 / 9, 10);
    expect(f[0]!.page).toBe("12");
    /* Пояснення говорить про межу СТОРІНОК — правило міряє саме її. Парність
     * розвороту з `page` не виводиться, тож «перегортання» тут стверджувати
     * нема на чому: 12 і 13 у книжці дивляться одна на одну. */
    expect(f[0]!.detail).toContain("pages 12 → 13");
    expect(f[0]!.detail).not.toContain("перегорт");
  });

  it("що коротший уламок лишився, то більша сила", () => {
    const stub = detectHyphens([
      tail(["Ше"], {
        containerId: "a",
        lineInParagraph: 0,
        paragraphLineCount: 2,
        endsWithHyphen: true,
        isLastInFrame: true,
        page: "12",
      }),
      tail(["вченко"], { containerId: "a", lineInParagraph: 1, paragraphLineCount: 2, page: "13" }),
    ]);
    const full = detectHyphens([
      tail(["Шевчен"], {
        containerId: "b",
        lineInParagraph: 0,
        paragraphLineCount: 2,
        endsWithHyphen: true,
        isLastInFrame: true,
        page: "12",
      }),
      tail(["ко"], { containerId: "b", lineInParagraph: 1, paragraphLineCount: 2, page: "13" }),
    ]);
    expect(stub[0]!.strength).toBeGreaterThan(full[0]!.strength);
  });

  it("перенос усередині сторінки не є переносом через розворот", () => {
    const f = detectHyphens([
      tail(["Шевчен"], {
        lineInParagraph: 0,
        paragraphLineCount: 2,
        endsWithHyphen: true,
        isLastInFrame: true,
        page: "12",
      }),
      tail(["ком."], { lineInParagraph: 1, paragraphLineCount: 2, page: "12" }),
    ]);
    expect(f).toEqual([]);
  });

  it("рядок не останній у фреймі — розвороту немає навіть при різних сторінках", () => {
    const f = detectHyphens([
      tail(["Шевчен"], {
        lineInParagraph: 0,
        paragraphLineCount: 2,
        endsWithHyphen: true,
        isLastInFrame: false,
        page: "12",
      }),
      tail(["ком."], { lineInParagraph: 1, paragraphLineCount: 2, page: "13" }),
    ]);
    expect(f).toEqual([]);
  });

  it("наступного рядка немає в масиві — вердикту немає, і це видно в огляді", () => {
    const lines = [
      tail(["Шевчен"], {
        lineInParagraph: 0,
        paragraphLineCount: 2,
        endsWithHyphen: true,
        isLastInFrame: true,
        page: "12",
      }),
    ];
    expect(detectHyphens(lines)).toEqual([]);
    expect(surveyHyphens(lines).undecidableSpread).toBe(1);
  });

  it("наступний рядок належить іншому абзацу — це не продовження слова", () => {
    const f = detectHyphens([
      tail(["Шевчен"], {
        paragraphIndex: 0,
        lineInParagraph: 0,
        paragraphLineCount: 2,
        endsWithHyphen: true,
        isLastInFrame: true,
        page: "12",
      }),
      tail(["ком."], { paragraphIndex: 1, lineInParagraph: 0, paragraphLineCount: 2, page: "13" }),
    ]);
    expect(f).toEqual([]);
  });

  it("продовженням вважається лише ФІЗИЧНО наступний рядок", () => {
    /* Чотири способи, якими сусід у масиві може не бути продовженням слова.
     * Дві останні фікстури штучні (шар виміру нумерує рядки від нуля в кожному
     * абзаці) — вони пришпилюють предикат, а не спостережений випадок. */
    const head = (over: LineOver) =>
      tail(["Шевчен"], {
        lineInParagraph: 0,
        paragraphLineCount: 2,
        endsWithHyphen: true,
        isLastInFrame: true,
        page: "12",
        ...over,
      });

    /* дірка в нумерації */
    expect(
      detectHyphens([
        head({ paragraphLineCount: 9 }),
        tail(["ком."], { lineInParagraph: 5, paragraphLineCount: 9, page: "13" }),
      ]),
    ).toEqual([]);

    /* інший контейнер */
    expect(
      detectHyphens([
        head({}),
        tail(["ком."], {
          containerId: "story:9",
          lineInParagraph: 1,
          paragraphLineCount: 2,
          page: "13",
        }),
      ]),
    ).toEqual([]);

    /* інший абзац при суцільній нумерації */
    expect(
      detectHyphens([
        head({ paragraphIndex: 0 }),
        tail(["ком."], {
          paragraphIndex: 1,
          lineInParagraph: 1,
          paragraphLineCount: 2,
          page: "13",
        }),
      ]),
    ).toEqual([]);

    /* непридатний наступний рядок — його слів читати не можна */
    expect(
      detectHyphens([
        head({}),
        tail(["ком."], { lineInParagraph: 1, paragraphLineCount: 2, page: "13", rotated: true }),
      ]),
    ).toEqual([]);
  });

  it("сила впорядковує знахідки ВСЕРЕДИНІ класу", () => {
    /* Сильніша знахідка навмисно має ПІЗНІШИЙ ключ: інакше порядок збігався б
     * із сортуванням за ключем і не відрізнявся б від нього. */
    const f = detectHyphens([
      /* уламок «Шевчен» — перенесено 2 з 8 */
      tail(["Шевчен"], {
        containerId: "a",
        lineInParagraph: 0,
        paragraphLineCount: 2,
        endsWithHyphen: true,
        isLastInFrame: true,
        page: "12",
      }),
      tail(["ко"], { containerId: "a", lineInParagraph: 1, paragraphLineCount: 2, page: "13" }),
      /* уламок «Ше» — перенесено 6 з 8 літер */
      tail(["Ше"], {
        containerId: "b",
        lineInParagraph: 0,
        paragraphLineCount: 2,
        endsWithHyphen: true,
        isLastInFrame: true,
        page: "20",
      }),
      tail(["вченко"], { containerId: "b", lineInParagraph: 1, paragraphLineCount: 2, page: "21" }),
    ]);
    expect(f.map((x) => x.containerId)).toEqual(["b", "a"]);
    expect(f[0]!.strength).toBeGreaterThan(f[1]!.strength);
  });

  it("продовження без жодної літери — уламок не виміряний, знахідки немає", () => {
    const lines = [
      tail(["Шевчен"], {
        lineInParagraph: 0,
        paragraphLineCount: 2,
        endsWithHyphen: true,
        isLastInFrame: true,
        page: "12",
      }),
      tail(["«»"], { lineInParagraph: 1, paragraphLineCount: 2, page: "13" }),
    ];
    expect(detectHyphens(lines)).toEqual([]);
    expect(surveyHyphens(lines).unmeasuredWord).toBe(1);
  });
});

describe("detectHyphens — заборонені слова", () => {
  const broken = (over: LineOver = {}) => [
    tail(["звернувся", "до", "Шевчен"], {
      lineInParagraph: 0,
      paragraphLineCount: 2,
      endsWithHyphen: true,
      ...over,
    }),
    tail(["ком,", "і", "далі"], { lineInParagraph: 1, paragraphLineCount: 2 }),
  ];

  it("слово зі списку заборонених дає знахідку", () => {
    const f = detectHyphens(broken(), { forbidden: ["Шевченком"] });
    expect(f.map((x) => x.defect)).toEqual(["hyphen-forbidden"]);
    /* «Шевчен» лишилось, «ком» перенесено — 3 літери з 9. */
    expect(f[0]!.measured).toBe(3);
    expect(f[0]!.strength).toBeCloseTo(3 / 9, 10);
  });

  it("словозміна не заважає: у списку лема, у тексті орудний відмінок", () => {
    const f = detectHyphens(broken(), { forbidden: ["Шевченко"] });
    expect(f.map((x) => x.defect)).toEqual(["hyphen-forbidden"]);
  });

  it("порожній список нічого не позначає", () => {
    expect(detectHyphens(broken())).toEqual([]);
    expect(detectHyphens(broken(), { forbidden: [] })).toEqual([]);
  });

  it("продовження з наступного рядка відсіює однопрефіксного сусіда", () => {
    /* «Ше-вчук» має спільний префікс із «Шевченко», але це інше слово. */
    const f = detectHyphens(
      [
        tail(["Ше"], { lineInParagraph: 0, paragraphLineCount: 2, endsWithHyphen: true }),
        tail(["вчук"], { lineInParagraph: 1, paragraphLineCount: 2 }),
      ],
      { forbidden: ["Шевченко"] },
    );
    expect(f).toEqual([]);
  });

  it("кінцевий літеральний дефіс зрізається перед звіркою", () => {
    const f = detectHyphens(
      [
        tail(["Шевчен-"], { lineInParagraph: 0, paragraphLineCount: 2, endsWithHyphen: true }),
        tail(["ком."], { lineInParagraph: 1, paragraphLineCount: 2 }),
      ],
      { forbidden: ["Шевченко"] },
    );
    expect(f.map((x) => x.defect)).toEqual(["hyphen-forbidden"]);
  });

  it("лапка перед уламком не заважає звірці", () => {
    const f = detectHyphens(
      [
        tail(["«Шевчен"], { lineInParagraph: 0, paragraphLineCount: 2, endsWithHyphen: true }),
        tail(["ком»."], { lineInParagraph: 1, paragraphLineCount: 2 }),
      ],
      { forbidden: ["Шевченко"] },
    );
    expect(f.map((x) => x.defect)).toEqual(["hyphen-forbidden"]);
  });

  it("апостроф усередині слова не обрізає уламка", () => {
    /* U+2019 приходить у `text` справжнім символом. Доки він не вважався
     * частиною слова, «з'єд-» давало уламок «єд», слово «єднання» і ЖОДНОЇ
     * знахідки за списком ["з'єднання"]. */
    const f = detectHyphens(
      [
        tail(["з’єд"], { lineInParagraph: 0, paragraphLineCount: 2, endsWithHyphen: true }),
        tail(["нання"], { lineInParagraph: 1, paragraphLineCount: 2 }),
      ],
      { forbidden: ["з’єднання"] },
    );
    expect(f.map((x) => x.defect)).toEqual(["hyphen-forbidden"]);
    expect(f[0]!.measured).toBe(5);
    expect(f[0]!.strength).toBeCloseTo(5 / 9, 10);
    expect(f[0]!.detail).toContain("з’єднання");
  });

  it("прізвище з апострофом ловиться списком", () => {
    const f = detectHyphens(
      [
        tail(["Лук’я"], { lineInParagraph: 0, paragraphLineCount: 2, endsWithHyphen: true }),
        tail(["ненко,"], { lineInParagraph: 1, paragraphLineCount: 2 }),
      ],
      { forbidden: ["Лук’яненко"] },
    );
    expect(f.map((x) => x.defect)).toEqual(["hyphen-forbidden"]);
    expect(f[0]!.measured).toBe(5);
  });

  it("зміна кінцевої літери основи НЕ ловиться — межа правила, не помилка", () => {
    /* «Шевченком» = «Шевченко» + «м», тож орудний ловиться. А в родовому
     * «Шевченка» кінцева «о» ЗАМІНЮЄТЬСЯ на «а», спільного префікса зі
     * списковим записом не досить, і знахідки немає. Відрізнити таку заміну від
     * словотвору («Іван» → «Іваненко») можна лише морфологією української, якої
     * в цьому модулі немає. Тест фіксує межу, щоб її зміна була помітною. */
    const f = detectHyphens(
      [
        tail(["Шевчен"], { lineInParagraph: 0, paragraphLineCount: 2, endsWithHyphen: true }),
        tail(["ка,"], { lineInParagraph: 1, paragraphLineCount: 2 }),
      ],
      { forbidden: ["Шевченко"] },
    );
    expect(f).toEqual([]);
    /* Спосіб це обійти — тримати в списку ту форму, що в тексті. */
    const withForm = detectHyphens(
      [
        tail(["Шевчен"], { lineInParagraph: 0, paragraphLineCount: 2, endsWithHyphen: true }),
        tail(["ка,"], { lineInParagraph: 1, paragraphLineCount: 2 }),
      ],
      { forbidden: ["Шевченка"] },
    );
    expect(withForm.map((x) => x.defect)).toEqual(["hyphen-forbidden"]);
  });

  it("накреслення апострофа в списку може не збігатися з текстом", () => {
    /* У тексті книжки — U+2019, у списку людина набирає ASCII. */
    const f = detectHyphens(
      [
        tail(["Дем’я"], { lineInParagraph: 0, paragraphLineCount: 2, endsWithHyphen: true }),
        tail(["на"], { lineInParagraph: 1, paragraphLineCount: 2 }),
      ],
      { forbidden: ["Дем'ян"] },
    );
    expect(f.map((x) => x.defect)).toEqual(["hyphen-forbidden"]);
    /* У поясненні стоїть те, що на сторінці, а не згорнута форма. */
    expect(f[0]!.detail).toContain("Дем’яна");
  });

  it("внутрішній дефіс не обрізає уламка", () => {
    const f = detectHyphens(
      [
        tail(["жовто-блакит"], {
          lineInParagraph: 0,
          paragraphLineCount: 2,
          endsWithHyphen: true,
        }),
        tail(["ний"], { lineInParagraph: 1, paragraphLineCount: 2 }),
      ],
      { forbidden: ["жовто-блакитний"] },
    );
    expect(f.map((x) => x.defect)).toEqual(["hyphen-forbidden"]);
    expect(f[0]!.measured).toBe(3);
    expect(f[0]!.strength).toBeCloseTo(3 / 15, 10);
  });

  it("слово, розірване двічі, дає ОДНУ знахідку — на першому розриві", () => {
    /* Пришпилює кон'юнкт `w.startsWith(whole)`: без нього «Шев|чен» не
     * продовжує «Шевченко» й перший розрив теж не знаходиться (мутант,
     * знайдений рецензією, а не власним прогоном). */
    const f = detectHyphens(
      [
        tail(["Шев"], { lineInParagraph: 0, paragraphLineCount: 3, endsWithHyphen: true }),
        tail(["чен"], { lineInParagraph: 1, paragraphLineCount: 3, endsWithHyphen: true }),
        tail(["ко."], { lineInParagraph: 2, paragraphLineCount: 3 }),
      ],
      { forbidden: ["Шевченко"] },
    );
    expect(f.map((x) => x.defect)).toEqual(["hyphen-forbidden"]);
    expect(f[0]!.lineInParagraph).toBe(0);
  });

  it("хвіст словотвору теж ловиться — задокументоване хибне спрацювання", () => {
    /* НЕ бажана поведінка, а зафіксована: `whole.startsWith(w)` приймає будь-який
     * хвіст, тож короткий запис у списку ловить ширше, ніж хотілося б. Тест
     * стоїть тут, щоб зміна цього правила була помітною, а не тихою. */
    const f = detectHyphens(
      [
        tail(["Іва"], { lineInParagraph: 0, paragraphLineCount: 2, endsWithHyphen: true }),
        tail(["ненко"], { lineInParagraph: 1, paragraphLineCount: 2 }),
      ],
      { forbidden: ["Іван"] },
    );
    expect(f.map((x) => x.defect)).toEqual(["hyphen-forbidden"]);
  });

  it("пояснення називає ВІДНОВЛЕНЕ слово, а не запис списку", () => {
    const f = detectHyphens(broken(), { forbidden: ["Шевченко"] });
    expect(f[0]!.detail).toContain('"Шевченком"');
    expect(f[0]!.detail).toContain("3 of 9 letters");
    expect(f[0]!.detail).toContain('"Шевченко"');
  });

  it("уламок дорівнює всьому слову — слово не розірване, знахідки немає", () => {
    const f = detectHyphens(
      [
        tail(["Шевченко"], { lineInParagraph: 0, paragraphLineCount: 2, endsWithHyphen: true }),
        tail(["вич"], { lineInParagraph: 1, paragraphLineCount: 2 }),
      ],
      { forbidden: ["Шевченко"] },
    );
    expect(f).toEqual([]);
  });

  it("продовження без літер — знахідки немає, а не знахідка з нулем", () => {
    const f = detectHyphens(
      [
        tail(["Шевчен"], { lineInParagraph: 0, paragraphLineCount: 2, endsWithHyphen: true }),
        tail(["«»"], { lineInParagraph: 1, paragraphLineCount: 2 }),
      ],
      { forbidden: ["Шевченко"] },
    );
    expect(f).toEqual([]);
  });

  it("без наступного рядка вердикту немає — половини слова не досить", () => {
    const lines = [
      tail(["Шевчен"], { lineInParagraph: 0, paragraphLineCount: 2, endsWithHyphen: true }),
    ];
    expect(detectHyphens(lines, { forbidden: ["Шевченко"] })).toEqual([]);
  });
});

describe("detectHyphens — контракт знахідки", () => {
  const mixed = [
    /* Драбина з трьох + розворот на її останньому рядку. */
    tail(["Шевчен"], {
      lineInParagraph: 0,
      paragraphLineCount: 5,
      endsWithHyphen: true,
      page: "12",
    }),
    tail(["ков", "переніс", "спра"], {
      lineInParagraph: 1,
      paragraphLineCount: 5,
      endsWithHyphen: true,
      page: "12",
    }),
    tail(["ву", "далі", "неспо"], {
      lineInParagraph: 2,
      paragraphLineCount: 5,
      endsWithHyphen: true,
      isLastInFrame: true,
      page: "12",
    }),
    tail(["дівано"], { lineInParagraph: 3, paragraphLineCount: 5, page: "13" }),
  ];

  it("вага всіх знахідок — error, і це константа", () => {
    const f = detectHyphens(mixed, { forbidden: ["Шевченков"] });
    expect(f.length).toBeGreaterThan(1);
    expect(new Set(f.map((x) => x.severity))).toEqual(new Set(["error"]));
  });

  it("порядок — спершу клас, усередині класу за спаданням сили", () => {
    const f = detectHyphens(mixed, { forbidden: ["Шевченков"] });
    expect(f.map((x) => x.defect)).toEqual([
      "hyphen-across-spread",
      "hyphen-forbidden",
      "hyphen-ladder",
    ]);
  });

  it("id стабільний і різний для різних класів на тому самому рядку", () => {
    const f = detectHyphens(mixed, { forbidden: ["Шевченков"] });
    expect(new Set(f.map((x) => x.id)).size).toBe(f.length);
    expect(f.map((x) => x.id)).toEqual(detectHyphens(mixed, { forbidden: ["Шевченков"] }).map((x) => x.id));
  });

  it("кожна знахідка несе число в measured і невід'ємну силу", () => {
    for (const x of detectHyphens(mixed, { forbidden: ["Шевченков"] })) {
      expect(Number.isFinite(x.measured)).toBe(true);
      expect(x.strength).toBeGreaterThanOrEqual(0);
      expect(x.detail.length).toBeGreaterThan(0);
    }
  });
});

describe("surveyHyphens", () => {
  it("віддає розподіл довжин прогонів, не позначаючи нічого", () => {
    const s = surveyHyphens([
      h({ containerId: "a", lineInParagraph: 0, paragraphLineCount: 4, endsWithHyphen: true }),
      h({ containerId: "a", lineInParagraph: 1, paragraphLineCount: 4, endsWithHyphen: true }),
      h({ containerId: "a", lineInParagraph: 2, paragraphLineCount: 4, endsWithHyphen: true }),
      h({ containerId: "a", lineInParagraph: 3, paragraphLineCount: 4, endsWithHyphen: false }),
      h({ containerId: "b", lineInParagraph: 0, paragraphLineCount: 2, endsWithHyphen: true }),
      h({ containerId: "b", lineInParagraph: 1, paragraphLineCount: 2, endsWithHyphen: false }),
    ]);
    expect(s.judged).toBe(6);
    expect(s.hyphenated).toBe(4);
    expect(s.runs).toEqual([1, 3]);
    expect(s.percentiles.max).toBe(3);
  });

  it("на порожній вибірці перцентилі — NaN, а не нуль", () => {
    const s = surveyHyphens([]);
    expect(s.runs).toEqual([]);
    expect(Number.isNaN(s.percentiles.max)).toBe(true);
    expect(Number.isNaN(s.percentiles.p50)).toBe(true);
  });

  it("рахує переноси на шві фрейму окремо від тих, що перетнули сторінку", () => {
    const s = surveyHyphens([
      tail(["Шевчен"], {
        lineInParagraph: 0,
        paragraphLineCount: 3,
        endsWithHyphen: true,
        isLastInFrame: true,
        page: "12",
      }),
      tail(["ком", "далі", "спра"], {
        lineInParagraph: 1,
        paragraphLineCount: 3,
        endsWithHyphen: true,
        isLastInFrame: true,
        page: "13",
      }),
      tail(["ву"], { lineInParagraph: 2, paragraphLineCount: 3, page: "13" }),
      /* Перенос усередині фрейму — у `frameBreaks` потрапляти не повинен. */
      tail(["спра"], {
        containerId: "b",
        lineInParagraph: 0,
        paragraphLineCount: 2,
        endsWithHyphen: true,
      }),
      tail(["ву"], { containerId: "b", lineInParagraph: 1, paragraphLineCount: 2 }),
    ]);
    expect(s.hyphenated).toBe(3);
    expect(s.frameBreaks).toBe(2);
    expect(s.acrossSpread).toBe(1);
  });
});

/**
 * Задача 10 Фази 4: борг закритий — політика щодо `isMaster` тепер оголошена
 * САМЕ ТУТ, у детекторі, а не лише в обробнику `composition_audit` нагорі.
 */
describe("detectHyphens — includeMasters", () => {
  /* Та сама драбина з трьох переносів, що й у першому тесті файлу, тепер
   * цілком на батьківській сторінці. */
  const masterLadder = [
    h({ lineInParagraph: 0, paragraphLineCount: 4, endsWithHyphen: true, isMaster: true }),
    h({ lineInParagraph: 1, paragraphLineCount: 4, endsWithHyphen: true, isMaster: true }),
    h({ lineInParagraph: 2, paragraphLineCount: 4, endsWithHyphen: true, isMaster: true }),
    h({ lineInParagraph: 3, paragraphLineCount: 4, endsWithHyphen: false, isMaster: true }),
  ];

  it("за замовчуванням рядки батьківських сторінок НЕ рахуються", () => {
    expect(detectHyphens(masterLadder)).toEqual([]);
  });

  it("includeMasters: true їх повертає", () => {
    const f = detectHyphens(masterLadder, { includeMasters: true });
    expect(f.map((x) => x.defect)).toEqual(["hyphen-ladder"]);
  });
});

/*
 * ШОВ РОЗВОРОТУ, А НЕ БУДЬ-ЯКА ЗМІНА СТОРІНКИ.
 *
 * Правило міряло зміну СТОРІНКИ, бо парність розвороту з рядка вивести не
 * можна: `page` — рядок, а на майстрах це взагалі назва майстра. Автор
 * свідомо відмовився вигадувати парність — і мав рацію, але наслідок лишався:
 * сторінки 12 і 13 у книжці з розворотами дивляться одна на одну, читач
 * нічого не гортає, а правило звітувало про кожну таку пару. Приблизно
 * половина влучань, і `composition_apply` вставляв би м'який перенос,
 * перекомпоновуючи абзац заради неіснуючої вади.
 *
 * Тепер `spreadIndex` приходить із виміру (`page.parent.index`).
 */
describe("перенос через шов розвороту", () => {
  const пара = (aSpread: number, bSpread: number) => [
    tail(["звернувся", "до", "Шевчен"], {
      lineInParagraph: 0,
      paragraphLineCount: 2,
      endsWithHyphen: true,
      isLastInFrame: true,
      page: "12",
      spreadIndex: aSpread,
    }),
    tail(["ком,", "і", "далі"], {
      lineInParagraph: 1,
      paragraphLineCount: 2,
      endsWithHyphen: false,
      page: "13",
      spreadIndex: bSpread,
    }),
  ];

  it("усередині ОДНОГО розвороту знахідки немає", () => {
    const f = detectHyphens(пара(6, 6));
    expect(f.filter((x) => x.defect === "hyphen-across-spread")).toEqual([]);
  });

  it("ПОЗИТИВНИЙ БЛИЗНЮК: через справжній шов — є", () => {
    const f = detectHyphens(пара(6, 7));
    expect(f.map((x) => x.defect)).toEqual(["hyphen-across-spread"]);
  });

  it("коли розворот не прочитався, падаємо назад на сторінки — консервативно", () => {
    /* −1 бодай з одного боку: можлива зайва знахідка, але не пропущена. */
    const f = detectHyphens(пара(-1, -1));
    expect(f.map((x) => x.defect)).toEqual(["hyphen-across-spread"]);
  });
});

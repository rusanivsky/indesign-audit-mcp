import { describe, expect, it } from "vitest";
import type { ParagraphMeasure, StyleValues } from "../../src/layout/types.js";
import { detectCharacter } from "../../src/styles/character.js";
import {
  UNUSED_STYLE_CAVEAT_KEY,
  type RangeMeasure,
  type StylesMeasure,
} from "../../src/styles/types.js";

const EMPTY: StyleValues = {
  firstLineIndent: null, leftIndent: null, rightIndent: null,
  spaceBefore: null, spaceAfter: null, pointSize: null, leading: null,
  justification: null, appliedFont: null, fontStyle: null, tracking: null, listType: null,
};

function para(declared: Partial<StyleValues>): ParagraphMeasure {
  return {
    containerId: "story:1", paragraphIndex: 0, page: "1", styleName: "A", styleId: "1",
    isMaster: false, declared: { ...EMPTY, ...declared }, actual: { ...EMPTY, ...declared },
    hasCharacterStyleRuns: false, preview: "",
  };
}

function range(over: Partial<RangeMeasure>): RangeMeasure {
  return {
    containerId: "story:1", paragraphIndex: 0, rangeIndex: 0, characterStyle: "[None]",
    pointSize: null, appliedFont: null, fontStyle: null, tracking: null, horizontalScale: null,
    ...over,
  };
}

function measure(paragraphs: ParagraphMeasure[], ranges: RangeMeasure[], characterStyles: StylesMeasure["characterStyles"] = []): StylesMeasure {
  return { docName: "T.indd", styles: [], paragraphs, ranges, characterStyles, scales: [], paragraphsOffPage: 0 };
}

describe("detectCharacter", () => {
  it("діапазон, що збігається з абзацним еталоном, знахідки не дає", () => {
    const r = detectCharacter(measure([para({ pointSize: 11.5 })], [range({ pointSize: 11.5 })]));
    expect(r.findings).toHaveLength(0);
  });

  it("голий діапазон із іншим кеглем — відхилення", () => {
    const r = detectCharacter(measure([para({ pointSize: 11.5 })], [range({ pointSize: 17 })]));
    expect(r.findings).toHaveLength(1);
    expect(r.byProperty.pointSize).toBe(1);
  });

  /*
   * Рецензія сусідньої задачі: жоден тест до цього не перевіряв АДРЕСНІ поля
   * знахідки character-override (styleName, page, containerId,
   * paragraphIndex) — лише кількість, byProperty і текст detail. Мутант, що
   * підмінює styleName знахідки на назву символьного стилю діапазону, а page
   * на null, проходив би непоміченим. Тут же перевіряється й styleId: він
   * має бути id АБЗАЦНОГО стилю (para.styleId), не символьного — знахідка
   * про відхилення діапазону від абзацного еталона, і символьний стиль
   * діапазону (тут — "Акцент") власного еталона взагалі не має (див.
   * коментар угорі файла).
   *
   * ПРАВКА РЕЦЕНЗІЇ КОЛА 1: `characterStyles` тут НЕПОРОЖНІЙ і містить стиль
   * із назвою, що збігається з `range.characterStyle` ("Акцент"), але з
   * ІНШИМ id ("cs-accent-id" ≠ "para-style-9"). Порожній `characterStyles`
   * (тобто `measure()` без третього аргументу) маскував би мутанта «шукати
   * styleId за назвою символьного стилю замість para.styleId»: пошук не
   * знаходив би нічого, спрацьовував би довільний запасний шлях, і
   * правильне значення могло вийти ЗБІГОМ, а не тому, що код вірний. З
   * непорожнім і відмінним за id символьним стилем правильна поведінка
   * (id АБЗАЦНОГО стилю) і зламана (id символьного стилю) дають РІЗНІ
   * значення, і саме це тест і має розрізняти.
   */
  it("адресні поля знахідки character-override — styleName, page, containerId, paragraphIndex, styleId абзацу", () => {
    const p: ParagraphMeasure = { ...para({ pointSize: 11.5 }), containerId: "story:9", paragraphIndex: 4, page: "12", styleName: "Основний текст", styleId: "para-style-9" };
    const r = detectCharacter(measure(
      [p],
      [range({ containerId: "story:9", paragraphIndex: 4, pointSize: 17, characterStyle: "Акцент" })],
      [{ id: "cs-accent-id", name: "Акцент", appliedRuns: 1 }],
    ));
    expect(r.findings).toHaveLength(1);
    const f = r.findings[0]!;
    expect(f.styleName).toBe("Основний текст");
    expect(f.page).toBe("12");
    expect(f.containerId).toBe("story:9");
    expect(f.paragraphIndex).toBe(4);
    expect(f.styleId).toBe("para-style-9");
  });

  /*
   * ЕТАЛОН АБЗАЦНИЙ, І ЦЕ ВИМІРЯНО, А НЕ ОБРАНО ЗІ СМАКУ: з 5 ужитих
   * символьних стилів книжки повний набір оголошених значень має 1, а
   * [None] не має жодного. Порівнювати з символьним еталоном нема з чим.
   */
  it("діапазон ПІД символьним стилем теж міряється проти АБЗАЦНОГО еталона", () => {
    const r = detectCharacter(measure([para({ pointSize: 11.5 })], [range({ pointSize: 17, characterStyle: "Акцент" })]));
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.detail).toContain("Акцент");
  });

  it("недоступний абзацний еталон не дає знахідки — не порівняно не є відхиленням", () => {
    const r = detectCharacter(measure([para({ pointSize: null })], [range({ pointSize: 17 })]));
    expect(r.findings).toHaveLength(0);
  });

  it("одна знахідка на КОЖНУ відмінну властивість діапазону", () => {
    const r = detectCharacter(measure(
      [para({ pointSize: 11.5, tracking: 0 })],
      [range({ pointSize: 17, tracking: -100 })],
    ));
    expect(r.byProperty.pointSize).toBe(1);
    expect(r.byProperty.tracking).toBe(1);
  });

  it("невживаний символьний стиль дає знахідку без адреси", () => {
    const r = detectCharacter(measure([], [], [{ id: "cs-1", name: "Невживаний", appliedRuns: 0 }]));
    const unused = r.findings.filter((f) => f.defect === "character-style-unused");
    expect(unused).toHaveLength(1);
    expect(unused[0]!.containerId).toBeNull();
    // Тут styleId — id САМОГО символьного стилю (cs.id), не абзацного: знахідка
    // про стиль, що не належить жодному конкретному абзацу.
    expect(unused[0]!.styleId).toBe("cs-1");
  });

  it("ужитий символьний стиль знахідки про невжиток не дає", () => {
    const r = detectCharacter(measure([], [], [{ id: "cs-2", name: "Ужитий", appliedRuns: 12 }]));
    expect(r.findings.filter((f) => f.defect === "character-style-unused")).toHaveLength(0);
  });

  /*
   * НОСІЇ ПОЗА ТЕКСТОМ (2026-08-16). `appliedRuns` рахує лише
   * `textStyleRanges`, а символьний стиль буває застосований, не торкаючись
   * жодного діапазону: маркер списку, нумерація, вкладений чи GREP-стиль,
   * блок перехресного посилання, номер сторінки у змісті. Знесення такого
   * стилю за порадою аудиту мовчки міняє вигляд усіх абзаців, що на нього
   * спираються — той самий клас руйнівної поради, що `style-unused` до
   * поділу на листок і базу.
   *
   * Виміряно на живій книжці: `Text Semi Bold` стоїть маркером у ТРЬОХ
   * абзацних стилях, `Зміст Номер сторінки` — у форматі перехресного
   * посилання. Обидва зараз мають і текстовий ужиток, тож саме на цій
   * книжці вада не спрацьовує — доводить її фікстура.
   */
  it("стиль без тексту, але маркером списку — НЕ невживаний", () => {
    const r = detectCharacter(
      measure([], [], [
        {
          id: "cs-bullet",
          name: "Маркер",
          appliedRuns: 0,
          referencedBy: [{ carrier: "bullets", count: 3 }],
        },
      ]),
    );
    expect(r.findings.filter((f) => f.defect === "character-style-unused")).toHaveLength(0);
  });

  it("стиль без тексту й без носіїв — невживаний, як і раніше", () => {
    /* Позитивний близнюк: без нього попередній тест проходив би й на коді,
     * що просто перестав давати знахідку взагалі. */
    const r = detectCharacter(
      measure([], [], [{ id: "cs-dead", name: "Мертвий", appliedRuns: 0, referencedBy: [] }]),
    );
    expect(r.findings.filter((f) => f.defect === "character-style-unused")).toHaveLength(1);
  });

  it("поле відсутнє зовсім — читається як «носіїв немає», не як помилка", () => {
    /* Сумісність зі старими вимірами й ручними StylesMeasure у тестах. */
    const r = detectCharacter(measure([], [], [{ id: "cs-old", name: "Старий", appliedRuns: 0 }]));
    expect(r.findings.filter((f) => f.defect === "character-style-unused")).toHaveLength(1);
  });

  it("носії рахуються окремим числом — це інвентар, не знахідка", () => {
    const r = detectCharacter(
      measure([], [], [
        { id: "a", name: "Маркер", appliedRuns: 0, referencedBy: [{ carrier: "bullets", count: 1 }] },
        { id: "b", name: "Вкладений", appliedRuns: 0, referencedBy: [{ carrier: "nestedGrep", count: 2 }] },
        { id: "c", name: "Мертвий", appliedRuns: 0, referencedBy: [] },
        { id: "d", name: "Живий", appliedRuns: 5, referencedBy: [] },
      ]),
    );
    expect(r.stylesOnlyReferenced).toEqual([
      { name: "Маркер", styleId: "a", referencedBy: [{ carrier: "bullets", count: 1 }] },
      { name: "Вкладений", styleId: "b", referencedBy: [{ carrier: "nestedGrep", count: 2 }] },
    ]);
  });

  it("стиль із текстом і носієм у переліку «лише носії» не з'являється", () => {
    /* Книжка — саме цей випадок (`Text Semi Bold`: 158 діапазонів і три
     * маркери), і плутати його з «живе лише на носії» не можна. */
    const r = detectCharacter(
      measure([], [], [
        { id: "x", name: "Обидва", appliedRuns: 158, referencedBy: [{ carrier: "bullets", count: 3 }] },
      ]),
    );
    expect(r.stylesOnlyReferenced).toEqual([]);
  });

  it("[None] ніколи не рахується як невживаний символьний стиль", () => {
    const r = detectCharacter(measure([], [], [{ id: "cs-none", name: "[None]", appliedRuns: 0 }]));
    expect(r.findings).toHaveLength(0);
  });

  /*
   * Рецензія кола 1, I-2: appliedFont (343 виміряні випадки — найбільший
   * клас після pointSize), fontStyle (91) і horizontalScale (32) не мали
   * ЖОДНОГО тесту. Найгірший наслідок — мутант HORIZONTAL_SCALE_BASELINE
   * 100 -> 0 заллє звіт знахідкою на КОЖЕН із ~3480 діапазонів документа
   * і не впаде без тесту на сам збіг зі 100.
   */
  it("horizontalScale 100 проти еталонних 100 — збіг, знахідки нема", () => {
    const r = detectCharacter(measure([para({})], [range({ horizontalScale: 100 })]));
    expect(r.findings).toHaveLength(0);
  });

  it("horizontalScale != 100 — відхилення від ЛІТЕРАЛЬНОГО еталона (не від стилю)", () => {
    const r = detectCharacter(measure([para({})], [range({ horizontalScale: 96 })]));
    expect(r.findings).toHaveLength(1);
    expect(r.byProperty.horizontalScale).toBe(1);
  });

  it("appliedFont — рядкове відхилення діапазону від абзацної гарнітури", () => {
    const r = detectCharacter(measure(
      [para({ appliedFont: "Minion Pro" })],
      [range({ appliedFont: "Arial" })],
    ));
    expect(r.findings).toHaveLength(1);
    expect(r.byProperty.appliedFont).toBe(1);
  });

  it("fontStyle — рядкове відхилення діапазону від абзацного накреслення", () => {
    const r = detectCharacter(measure(
      [para({ fontStyle: "Regular" })],
      [range({ fontStyle: "Bold" })],
    ));
    expect(r.findings).toHaveLength(1);
    expect(r.byProperty.fontStyle).toBe(1);
  });

  /*
   * Рецензія кола 1, I-3: усі попередні тести мали ОДИН абзац в ОДНОМУ
   * контейнері, тож мутант «ключ лише за paragraphIndex» (без containerId)
   * проходив би зелено — на реальному документі він переплутав би
   * діапазони різних історій із чужими еталонами. Два абзаци з ОДНАКОВИМ
   * paragraphIndex у РІЗНИХ контейнерах і РІЗНИМИ еталонами ловлять це:
   * під мутантом другий запис у Map/об'єкті переписав би перший (спільний
   * ключ "0"), і діапазон story:1 звірявся б з еталоном story:2.
   */
  it("ключ порівняння враховує containerId — діапазони різних історій не плутаються з чужими еталонами", () => {
    const paraStory1: ParagraphMeasure = { ...para({ pointSize: 11.5 }), containerId: "story:1", paragraphIndex: 0 };
    const paraStory2: ParagraphMeasure = { ...para({ pointSize: 20 }), containerId: "story:2", paragraphIndex: 0 };
    const rangeStory1 = range({ containerId: "story:1", paragraphIndex: 0, pointSize: 11.5 });
    const rangeStory2 = range({ containerId: "story:2", paragraphIndex: 0, pointSize: 20 });
    const r = detectCharacter(measure([paraStory1, paraStory2], [rangeStory1, rangeStory2]));
    expect(r.findings).toHaveLength(0);
  });

  /*
   * Рецензія `styles_audit`, коло 3, Important 1: `rangesDeviating` —
   * тепер ЄДИНЕ джерело істини (раніше споживач, `src/tools/styles.ts`,
   * дублював цю лічбу окремою функцією). Один діапазон, ДВІ властивості
   * відхиляються одразу — розрізняє «різні діапазони» (rangesDeviating,
   * має дати 1) від «пари діапазон+властивість» (byProperty, сума 2).
   */
  it("rangesDeviating рахує ДІАПАЗОНИ, не пари (діапазон, властивість) — один діапазон, дві властивості", () => {
    const r = detectCharacter(measure(
      [para({ pointSize: 11.5, appliedFont: "Minion Pro" })],
      [range({ pointSize: 17, appliedFont: "Arial" })],
    ));
    expect(r.rangesDeviating).toBe(1);
    expect(r.byProperty.pointSize).toBe(1);
    expect(r.byProperty.appliedFont).toBe(1);
    expect(r.findings).toHaveLength(2);
  });

  /*
   * Дедуплікація за ТРЬОМА полями (containerId + paragraphIndex +
   * rangeIndex), не двома: два РІЗНІ відхилені діапазони ОДНОГО абзаца
   * (rangeIndex 0 і 1, спільний containerId+paragraphIndex) мусять дати
   * rangesDeviating === 2. Мутант «ключ лише containerId#paragraphIndex»
   * злив би їх в один запис (1) — рівно та пастка, від якої застерігає
   * докстрінг `CharacterResult.rangesDeviating`: 485 з 2982 абзаців
   * книжки мають більш ніж один діапазон.
   */
  it("rangesDeviating дедуплікує за трьома полями — два діапазони ОДНОГО абзаца рахуються окремо", () => {
    const p = para({ pointSize: 11.5 });
    const r = detectCharacter(measure(
      [p],
      [
        range({ rangeIndex: 0, pointSize: 17 }),
        range({ rangeIndex: 1, pointSize: 30 }),
      ],
    ));
    expect(r.rangesDeviating).toBe(2);
    expect(r.byProperty.pointSize).toBe(2);
  });

  /*
   * ADVERSARIAL: сам роздільник `#` У ЗНАЧЕННІ `containerId`.
   *
   * Відкладена рецензією дрібниця «немає тесту на колізію ключа
   * containerId#paragraphIndex». Заразом вона виправляє й ПРИКЛАД, з яким
   * борг був записаний: `("a", 23)` проти `("a#2", 3)` колізії НЕ дають —
   * роздільник вставляється завжди, тож виходить `a#23` проти `a#2#3`.
   * Гарантія тут структурна й тримається на ОДНІЙ властивості: останнє поле
   * ключа — ЧИСЛО, тож останній `#` завжди розділювач, хай би скільки їх
   * було в `containerId`. Це не «здогад про формат `story:N`»: ключ лишається
   * ін'єктивним, навіть якщо InDesign колись віддасть containerId з `#`.
   *
   * Тест ставить рівно той стан, який зламав би НЕструктурний ключ: два
   * різні контейнери, у яких конкатенація без роздільника («a#2» + «3» проти
   * «a#» + «23») дала б однаковий рядок. Еталони в них РІЗНІ, тож збіг
   * ключів перекинув би діапазон на чужий абзац і змінив би вирок:
   * знахідок стало б не дві, а одна.
   */
  it("containerId, що САМ містить «#», не збиває ключа — два контейнери судяться нарізно", () => {
    const pA: ParagraphMeasure = { ...para({ pointSize: 11.5 }), containerId: "a#2", paragraphIndex: 3 };
    const pB: ParagraphMeasure = { ...para({ pointSize: 30 }), containerId: "a#", paragraphIndex: 23 };
    const r = detectCharacter(measure(
      [pA, pB],
      [
        /* Збігається з еталоном СВОГО абзаца (11.5) і відхиляється від чужого (30). */
        range({ containerId: "a#2", paragraphIndex: 3, rangeIndex: 0, pointSize: 17 }),
        range({ containerId: "a#", paragraphIndex: 23, rangeIndex: 0, pointSize: 17 }),
      ],
    ));
    expect(r.rangesDeviating).toBe(2);
    expect(r.byProperty.pointSize).toBe(2);
    /* Кожен діапазон судився ВЛАСНИМ еталоном — 17 проти 11,5 і 17 проти 30,
     * тобто обидва еталони видно в знахідках, а не один двічі. */
    expect(r.findings.map((f) => f.containerId).sort()).toEqual(["a#", "a#2"]);
    expect(r.findings.some((f) => f.detail.includes("11.5"))).toBe(true);
    expect(r.findings.some((f) => f.detail.includes("30"))).toBe(true);
  });

  /*
   * Батьківський абзац — поза перевіркою (коло 3, дрібне п.6): та сама
   * політика, що вже діє для usage.defaultStyleApplied і scale.ratioMatches.
   */
  it("діапазон батьківського абзаца не дає знахідки й не входить у rangesDeviating", () => {
    const masterPara: ParagraphMeasure = { ...para({ pointSize: 11.5 }), isMaster: true };
    const r = detectCharacter(measure([masterPara], [range({ pointSize: 17 })]));
    expect(r.findings).toHaveLength(0);
    expect(r.rangesDeviating).toBe(0);
  });

  /*
   * I-3 ФІНАЛЬНОЇ РЕЦЕНЗІЇ. `rangesDeviating` — чисельник, і йому потрібен
   * СВІЙ знаменник: `measure.ranges.length` (він же `rangesTotal` в
   * інструменті) рахує ВСІ діапазони, включно з батьківськими й тими,
   * чийого абзаца у вимірі немає. Оператор, поділивши одне на друге,
   * дістає ЗАНИЖЕНУ частку — той самий дефект, який Задача 6 закрила
   * полем `paragraphsAudited`.
   *
   * Фікстура містить усі три класи одразу: діапазон, що ввійшов у
   * перевірку й відхилився; діапазон батьківського абзаца; діапазон, чийого
   * абзаца у вимірі немає взагалі.
   */
  it("rangesAudited — знаменник частки: батьківські й безабзацні діапазони в нього не входять", () => {
    const normal = para({ pointSize: 11.5 });
    const masterPara: ParagraphMeasure = {
      ...para({ pointSize: 11.5 }), paragraphIndex: 1, isMaster: true,
    };
    const r = detectCharacter(measure(
      [normal, masterPara],
      [
        range({ paragraphIndex: 0, pointSize: 17 }),
        range({ paragraphIndex: 1, pointSize: 17 }),
        range({ paragraphIndex: 99, pointSize: 17 }),
      ],
    ));
    expect(r.rangesAudited).toBe(1);
    expect(r.rangesDeviating).toBe(1);
    /* Мутант «rangesAudited = measure.ranges.length» дав би 3 — і саме
     * від нього частка виходила б утричі заниженою. */
    expect(r.rangesAudited).toBeLessThan(3);
  });

  it("діапазон, що дійшов до перевірки й НЕ відхилився, у знаменник усе одно входить", () => {
    const r = detectCharacter(measure([para({ pointSize: 11.5 })], [range({ pointSize: 11.5 })]));
    expect(r.rangesAudited).toBe(1);
    expect(r.rangesDeviating).toBe(0);
  });

  /*
   * I-4 ФІНАЛЬНОЇ РЕЦЕНЗІЇ: знахідка про невживаний стиль — єдина, що веде
   * до РУЙНІВНОЇ дії, а вимір іде по story.paragraphs і не бачить ані
   * комірок таблиць, ані виносок. Застереження мусить стояти в тексті
   * САМОЇ знахідки, а не лише в типах виміру, куди оператор не дійде.
   */
  it("текст character-style-unused називає таблиці й виноски поіменно", () => {
    const r = detectCharacter(measure([], [], [{ id: "cs1", name: "Акцент", appliedRuns: 0 }]));
    const found = r.findings.find((f) => f.defect === "character-style-unused")!;
    expect(found.detail).toContain("tables");
    expect(found.detail).toContain("footnotes");
    expect(found.detail).toContain("Don't delete");
  });

  /* Той самий сторож, що в styles-inventory.test.ts: пояснення механізму
   * живе у відповіді один раз, знахідка несе заборону й ключ. */
  it("текст character-style-unused НЕ повторює пояснення механізму", () => {
    const found = detectCharacter(measure([], [], [{ id: "cs1", name: "Акцент", appliedRuns: 0 }]))
      .findings.find((f) => f.defect === "character-style-unused")!;
    expect(found.detail).not.toContain("story.paragraphs і не заходить");
    expect(found.detail).toContain(UNUSED_STYLE_CAVEAT_KEY);
    expect(Buffer.byteLength(found.detail, "utf8")).toBeLessThan(300);
  });

  /*
   * ВІДКЛАДЕНЕ РЕЦЕНЗІЄЮ, ЗАКРИТО: адресний ключ `containerId#paragraphIndex`
   * не мав жодного adversarial-тесту на колізію. Код структурно захищений —
   * індекс завжди цифри, тож останній «#» ділить ключ однозначно, — але
   * ГАРАНТІЯ не була покрита нічим, і «спрощення» ключа (скажімо, склеювання
   * без роздільника) пройшло б усі 2553 тести зеленим.
   *
   * Пара підібрана саме під ту помилку: `story:1` + 23 і `story:12` + 3
   * дають однакове `story:123` БЕЗ роздільника і різне з ним. Тобто тест
   * падає рівно тоді, коли роздільник зникає чи стає неоднозначним.
   *
   * Другий `it` нижче доводить, що перший не порожній: та сама адреса з
   * іншим кеглем знахідку таки дає, тож нуль у першому — це «зіставилось із
   * СВОЇМ абзацом», а не «зіставляти не було чого».
   *
   * ПОРЯДОК МАСИВУ ТУТ ЗНАЧУЩИЙ, І ЦЕ КОШТУВАЛО МУТАНТА. Перша редакція
   * обох тестів ставила `[p1, p2]` — і мутант зі склеєним без роздільника
   * ключем ВИЖИВ обидва рази: колізія є, але `Map.set` другого абзаца
   * затирає перший, тож пошук випадково знаходив саме той абзац, який
   * потрібен. Порядок `[p2, p1]` ставить у колізію ЧУЖИЙ абзац — і мутант
   * падає обома тестами. Не «уніфікуйте» порядок побудови масиву:
   * мутаційне покриття тут тримається саме на ньому.
   */
  it("адреса containerId#paragraphIndex не злипається: story:1+23 ≠ story:12+3", () => {
    const p1 = { ...para({ pointSize: 11.5 }), containerId: "story:1", paragraphIndex: 23 };
    const p2 = {
      ...para({ pointSize: 30 }),
      containerId: "story:12",
      paragraphIndex: 3,
      styleName: "B",
      styleId: "2",
    };
    const r = detectCharacter(
      measure([p2, p1], [range({ containerId: "story:12", paragraphIndex: 3, pointSize: 30 })]),
    );
    /* Знайшовся б замість нього абзац p1 (11.5 pt) — це було б відхилення. */
    expect(r.findings.filter((f) => f.defect === "character-override")).toHaveLength(0);
    expect(r.rangesAudited).toBe(1);
  });

  it("та сама адреса з іншим кеглем знахідку ДАЄ — перший тест не порожній", () => {
    const p1 = { ...para({ pointSize: 11.5 }), containerId: "story:1", paragraphIndex: 23 };
    const p2 = {
      ...para({ pointSize: 30 }),
      containerId: "story:12",
      paragraphIndex: 3,
      styleName: "B",
      styleId: "2",
    };
    const r = detectCharacter(
      measure([p2, p1], [range({ containerId: "story:12", paragraphIndex: 3, pointSize: 17 })]),
    );
    const знахідки = r.findings.filter((f) => f.defect === "character-override");
    expect(знахідки).toHaveLength(1);
    /* Еталон узято з p2, а не з p1: у деталі стоїть 30 і НЕ стоїть 11.5. */
    expect(знахідки[0]!.detail).toContain("30");
    expect(знахідки[0]!.detail).not.toContain("11.5");
    expect(знахідки[0]!.styleId).toBe("2");
  });
});

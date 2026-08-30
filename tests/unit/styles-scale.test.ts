import { describe, expect, it } from "vitest";
import type { ParagraphMeasure, StyleValues } from "../../src/layout/types.js";
import {
  detectRatioScale,
  detectScale,
  groupScales,
  MAX_GROUP_MEMBERS,
  MAX_SCALE_GROUPS,
} from "../../src/styles/scale.js";
import type { ScaleMeasure } from "../../src/styles/types.js";

const EMPTY: StyleValues = {
  firstLineIndent: null, leftIndent: null, rightIndent: null,
  spaceBefore: null, spaceAfter: null, pointSize: null, leading: null,
  justification: null, appliedFont: null, fontStyle: null, tracking: null, listType: null,
};

function scale(h: number | null, v: number | null, container: string, index: number, styleName = "A"): ScaleMeasure {
  return {
    containerId: container,
    paragraphIndex: index,
    page: "1",
    styleName,
    // Голе значення, не назва стилю конкретної книжки — див. правило файла.
    styleId: `style:${styleName}`,
    horizontalScale: h,
    verticalScale: v,
  };
}

/*
 * ПРАВИЛО ФАЙЛА: у частині фікстур цього файла ПОРЯДОК ЕЛЕМЕНТІВ МАСИВУ —
 * НЕСУЧА КОНСТРУКЦІЯ, а не оформлення.
 *
 * Відкладена рецензією дрібниця, і записана вона була саме як ризик
 * рефакторингу: `groupScales` сортує групи за спаданням числа абзаців і
 * лише ПОТІМ обрізає, а порядок усередині `containers`/`styles` — це
 * порядок першої появи. Тест, чия фікстура вже подана «прибрано» (найбільша
 * група першою, контейнери за номером), проходить однаково і на правильному
 * коді, і на мутанті «обрізати до сортування» — assert не змінюється, і
 * втрату покриття не видно НІ ПО ЧОМУ. Цей проєкт уже ловив рівно такого
 * мутанта у Фазі 10: він вижив, бо тест ставив більшість першою.
 *
 * Тому там, де порядок несе доказ, він (а) названий коментарем при фікстурі
 * і (б) ЗАКРІПЛЕНИЙ окремим `expect` на самому вхідному масиві — щоб
 * «уніфікація» побудови фікстури валила тест голосно, а не тихо знеструмлювала
 * його. Не «прибирайте» такі масиви в природний порядок.
 */
describe("groupScales", () => {
  it("однакові коефіцієнти зливаються в один рядок", () => {
    const { groups } = groupScales([scale(96, 100, "story:1", 0), scale(96, 100, "story:2", 0)]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.paragraphs).toBe(2);
    expect(groups[0]!.containers).toEqual(["story:1", "story:2"]);
  });

  it("різні коефіцієнти лишаються окремими рядками", () => {
    const { groups } = groupScales([scale(96, 100, "story:1", 0), scale(109.632164859675, 100, "story:2", 0)]);
    expect(groups).toHaveLength(2);
  });

  /*
   * Головна перевірка родини. Виміряно на робочій книжці: 19 історій із рівно
   * 96 — це РУЧНИЙ прийом верстальника, а п'ять історій змісту з
   * 109,632164859675 — наслідок «Scale Text» на рамці. Групування за
   * значенням робить різницю видимою, НЕ класифікуючи її.
   */
  it("не злипаються значення, що відрізняються на чотирнадцятому знаку", () => {
    const { groups } = groupScales([
      scale(109.632164859675, 100, "story:1", 0),
      scale(109.632164859676, 100, "story:2", 0),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("той самий контейнер двічі не дублюється в переліку контейнерів", () => {
    const { groups } = groupScales([scale(96, 100, "story:1", 0), scale(96, 100, "story:1", 5)]);
    expect(groups[0]!.paragraphs).toBe(2);
    expect(groups[0]!.containers).toEqual(["story:1"]);
  });

  it("групи впорядковані за спаданням числа абзаців — найбільший випадок першим", () => {
    const { groups } = groupScales([
      scale(96, 100, "story:1", 0),
      scale(105, 100, "story:2", 0),
      scale(105, 100, "story:3", 0),
    ]);
    expect(groups[0]!.horizontalScale).toBe(105);
    expect(groups[0]!.paragraphs).toBe(2);
  });

  it("мішаний масштаб (null) не зливається зі 100 і не зникає", () => {
    const { groups } = groupScales([scale(null, 100, "story:1", 0)]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.horizontalScale).toBeNull();
  });

  /*
   * null означає «масштаб мішаний у межах абзацу» (символьна властивість, InDesign
   * не дає єдиного значення на весь абзац), 100 означає «звичайний, немасштабований
   * текст». Це два принципово різні стани, і ключ через String() їх розрізняє —
   * але лише тест, що подає ОБИДВА значення в один виклик, доводить, що вони не
   * зливаються в одну групу. Третій запис (105) — щоб групи були змістовні, а не
   * вироджений випадок з одним елементом.
   */
  it("null і 100 в одному виклику лишаються різними групами — мішаний масштаб не ховається серед звичайного", () => {
    const { groups } = groupScales([
      scale(null, 100, "story:1", 0),
      scale(100, 100, "story:2", 0),
      scale(105, 100, "story:3", 0),
    ]);
    expect(groups).toHaveLength(3);
    const nullGroup = groups.find((g) => g.horizontalScale === null);
    const hundredGroup = groups.find((g) => g.horizontalScale === 100);
    expect(nullGroup).toBeDefined();
    expect(hundredGroup).toBeDefined();
    expect(nullGroup!.containers).toEqual(["story:1"]);
    expect(hundredGroup!.containers).toEqual(["story:2"]);
  });

  /*
   * Дрібне п.4 фінальної рецензії: перелік стилів групи ключується за
   * `.id`, назва їде поруч. Два РІЗНІ стилі з однаковою назвою (виміряна
   * ситуація книжки — зонд H5) за старим `styleNames: string[]` давали
   * ОДИН рядок, і оператор не бачив, що масштаб зачепив обидва.
   */
  it("перелік стилів групи — за id з назвою поруч: два однойменні стилі не зливаються", () => {
    const a = { ...scale(96, 100, "story:1", 0, "Заголовок"), styleId: "style:1" };
    const b = { ...scale(96, 100, "story:1", 1, "Заголовок"), styleId: "style:2" };
    const { groups } = groupScales([a, b]);
    expect(groups[0]!.styles).toEqual([
      { styleId: "style:1", styleName: "Заголовок" },
      { styleId: "style:2", styleName: "Заголовок" },
    ]);
  });

  it("той самий стиль двічі не дублюється в переліку стилів групи", () => {
    const { groups } = groupScales([scale(96, 100, "story:1", 0), scale(96, 100, "story:2", 1)]);
    expect(groups[0]!.styles).toEqual([{ styleId: "style:A", styleName: "A" }]);
  });

  /*
   * I-6 ФІНАЛЬНОЇ РЕЦЕНЗІЇ. Ключ групи навмисно містить ТОЧНЕ значення
   * float (див. `key` у scale.ts) — конструкція максимізує кількість груп,
   * а параметра сторінок інструмент не має. Без стелі ця структура
   * дефолтної відповіді росла б із документом без будь-якої межі.
   *
   * 60 різних значень масштабу проти MAX_SCALE_GROUPS = 50: обрізання
   * НАЗВАНЕ через `groupsTruncated`, а не мовчазне, і зникають найдрібніші
   * групи (сортування за спаданням числа абзаців іде ДО обрізання).
   */
  it("кількість груп має стелю; обрізання назване через groupsTruncated, а не мовчазне", () => {
    const scales: ScaleMeasure[] = [];
    for (let i = 0; i < 60; i += 1) scales.push(scale(90 + i * 0.0001, 100, `story:${i}`, 0));
    /* Найбільша група — щоб довести, що обрізання йде ПІСЛЯ сортування.
     * ПОРЯДОК НЕСУЧИЙ: другий абзац найбільшої групи дописується В КІНЕЦЬ, тож
     * ця група в порядку появи 60-та з 60 і мутант «обрізати до сортування»
     * викинув би саме її. Подати її першою — і мутант вижив би мовчки. */
    scales.push(scale(90 + 59 * 0.0001, 100, "story:59", 1));

    /* Закріплення порядку фікстури (правило файла вгорі): найбільша група НЕ
     * перша в порядку появи. Червоніє, якщо побудову масиву «уніфікують». */
    expect(scales[0]!.horizontalScale).not.toBe(scales.at(-1)!.horizontalScale);
    expect(scales.at(-1)!.horizontalScale).toBe(90 + 59 * 0.0001);

    const { groups, groupsTruncated } = groupScales(scales);
    expect(groups).toHaveLength(MAX_SCALE_GROUPS);
    expect(groupsTruncated).toEqual({ shown: MAX_SCALE_GROUPS, total: 60 });
    /* Найбільша група вціліла — обрізано найдрібніші, не випадкові. */
    expect(groups[0]!.paragraphs).toBe(2);
  });

  it("груп менше за стелю — groupsTruncated відсутнє взагалі, а не {shown: N, total: N}", () => {
    const { groupsTruncated } = groupScales([scale(96, 100, "story:1", 0)]);
    expect(groupsTruncated).toBeUndefined();
  });

  /*
   * Стеля на кількість ГРУП не покриває переліків усередині групи: одна
   * група з тисячею абзаців у тисячі різних рамок дала б тисячу рядків у
   * `containers`. `total` мусить називати ЗАГАЛ, а не стелю — інакше поле
   * бреше саме тим числом, заради якого існує.
   */
  it("переліки всередині групи теж мають стелю, і total називає загал, а не стелю", () => {
    const scales: ScaleMeasure[] = [];
    for (let i = 0; i < 70; i += 1) {
      scales.push({ ...scale(96, 100, `story:${i}`, 0, `Стиль ${i}`), styleId: `style:${i}` });
    }
    const { groups } = groupScales(scales);
    expect(groups[0]!.containers).toHaveLength(MAX_GROUP_MEMBERS);
    expect(groups[0]!.containersTruncated).toEqual({ shown: MAX_GROUP_MEMBERS, total: 70 });
    expect(groups[0]!.styles).toHaveLength(MAX_GROUP_MEMBERS);
    expect(groups[0]!.stylesTruncated).toEqual({ shown: MAX_GROUP_MEMBERS, total: 70 });
    /* Сама лічба абзаців НЕ обрізається — обмежено перелік, не облік. */
    expect(groups[0]!.paragraphs).toBe(70);
  });
});

describe("detectScale", () => {
  it("знахідка на кожен абзац, з адресою", () => {
    const found = detectScale([scale(96, 100, "story:1", 3)]);
    expect(found).toHaveLength(1);
    expect(found[0]!.defect).toBe("scaled-text");
    expect(found[0]!.paragraphIndex).toBe(3);
    expect(found[0]!.containerId).toBe("story:1");
    // styleId родини scale бере ScaleMeasure.styleId, не переоголошується.
    expect(found[0]!.styleId).toBe("style:A");
  });

  /*
   * Перелік ширший за буквальні «дефект/помилка/хибний»: намір тесту —
   * «інструмент не ставить діагнозу» загалом, а не лише цими трьома словами.
   * Додані корені покривають типові формулювання діагнозу в українській
   * технічній мові: неправильн(ий/е), проблем(а), недолік, порушен(ня),
   * некоректн(ий), невірн(ий/е), збій. Перевірено виконанням (не лише
   * міркуванням): старий вузький регекс пропускав усі сім прикладів нижче,
   * розширений ловить усі сім, і жоден не хибить на нейтральному тексті,
   * який `detectScale` реально повертає.
   */
  const DIAGNOSIS_WORDS = /дефект|помилк|хибн|неправильн|проблем|недолік|порушен|некоректн|невірн|збій/i;

  it("опис знахідки НЕ називає її дефектом — 19 місць із 22 свідомий прийом", () => {
    const found = detectScale([scale(96, 100, "story:1", 0)]);
    expect(found[0]!.detail).not.toMatch(DIAGNOSIS_WORDS);
    expect(found[0]!.detail).toContain("96");
  });

  it("розширений регекс ловить формулювання діагнозу, яких вузький /дефект|помилк|хибн/i пропускав", () => {
    const OLD_NARROW = /дефект|помилк|хибн/i;
    const diagnosticPhrases = [
      "неправильне масштабування тексту",
      "проблема з масштабом",
      "недолік верстки",
      "порушення пропорцій",
      "некоректний масштаб",
      "невірне значення масштабу",
      "збій масштабування",
    ];
    for (const phrase of diagnosticPhrases) {
      // Доказ мутанта: вузький регекс брифа пропускав би саме ці формулювання.
      expect(phrase).not.toMatch(OLD_NARROW);
      // Розширений регекс їх ловить.
      expect(phrase).toMatch(DIAGNOSIS_WORDS);
    }
  });
});

describe("detectRatioScale — другий, підтверджувальний детектор", () => {
  function para(declaredSize: number | null, actualSize: number | null, declaredLead: number | string | null, actualLead: number | string | null): ParagraphMeasure {
    return {
      containerId: "story:1", paragraphIndex: 0, page: "1", styleName: "A",
      // Голий id, не назва стилю конкретної книжки.
      styleId: "style:A",
      isMaster: false,
      declared: { ...EMPTY, pointSize: declaredSize, leading: declaredLead },
      actual: { ...EMPTY, pointSize: actualSize, leading: actualLead },
      hasCharacterStyleRuns: false, preview: "",
    };
  }

  it("однаковий коефіцієнт кегля й інтерліньяжу — рамку масштабували", () => {
    /* Виміряний випадок B: 96,8578724 % на стор. 47. */
    const r = detectRatioScale([para(11.5, 11.1386553, 16, 15.4972596)]);
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0]!.ratio).toBeCloseTo(0.968578724, 6);
  });

  it("різні коефіцієнти — це не масштабування рамки, а звичайне перевизначення", () => {
    const r = detectRatioScale([para(11.5, 14, 16, 16)]);
    expect(r.matches).toHaveLength(0);
  });

  it("коефіцієнт рівно 1 не є знахідкою", () => {
    const r = detectRatioScale([para(11.5, 11.5, 16, 16)]);
    expect(r.matches).toHaveLength(0);
  });

  /*
   * Сліпа зона названа, не замовчана. Виміряно на робочій книжці: 163 абзаци
   * з 2980 (5,5 %) не дають коефіцієнта через Leading.AUTO. Друга детекція
   * (horizontalScale) цієї зони не має взагалі.
   */
  it("Leading.AUTO не дає коефіцієнта — абзац іде в noRatio, а не в «чисто»", () => {
    const r = detectRatioScale([para(11.5, 10.5, "AUTO", "AUTO")]);
    expect(r.matches).toHaveLength(0);
    expect(r.noRatio).toBe(1);
  });

  it("недоступне оголошене значення теж іде в noRatio", () => {
    const r = detectRatioScale([para(null, 10.5, 16, 15)]);
    expect(r.noRatio).toBe(1);
  });

  /*
   * Захист від ділення на нуль. Оголошений кегль 0 — вироджений випадок
   * (реального стилю з таким кеглем не буває, але вхід не гарантований), і
   * без явної перевірки `ds === 0` вираз `as / ds` дав би Infinity. Перевірка
   * зводить його в noRatio, а не в matches із нечисловим ratio.
   */
  it("оголошений кегль 0 іде в noRatio, а не в Infinity/NaN серед matches", () => {
    const r = detectRatioScale([para(0, 10.5, 16, 15)]);
    expect(r.matches).toHaveLength(0);
    expect(r.noRatio).toBe(1);
  });

  /*
   * Та сама пастка для інтерліньяжу: оголошений leading 0 без перевірки
   * `dl === 0` дав би Infinity в leadRatio і хибне порівняння з sizeRatio.
   */
  it("оголошений інтерліньяж 0 іде в noRatio, а не в Infinity/NaN серед matches", () => {
    const r = detectRatioScale([para(11.5, 10.5, 0, 15)]);
    expect(r.matches).toHaveLength(0);
    expect(r.noRatio).toBe(1);
  });

  /*
   * ГОЛОВНА МЕЖА ЦЬОГО ДЕТЕКТОРА, виміряна на найбільшому випадку книжки.
   * 131 абзац змісту масштабовано з еталонним стилем 15/16, а поверх
   * застосовано інший стиль, 11,5/16. Проти НОВОГО стилю пропорції немає, і
   * детектор мовчить — тоді як horizontalScale ловить цей випадок незалежно
   * від того, який стиль застосовано зараз. Саме тому пропорційний
   * детектор ДРУГИЙ, а не єдиний.
   */
  it("стиль, змінений ПІСЛЯ масштабування, робить детектор сліпим", () => {
    const r = detectRatioScale([para(11.5, 13.6821160279006, 16, 14.5942570964273)]);
    expect(r.matches).toHaveLength(0);
  });
});

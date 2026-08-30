import { describe, expect, it } from "vitest";
import {
  documentThreadLinks,
  helperChainWins,
  HELPER_LAYER_NAME,
  rectsOverlap,
  resolveMarkerPage,
} from "../../src/pagination/topology.js";
import type { ClaimFrame, FrameGeometry, ThreadLink } from "../../src/pagination/types.js";

const R = (y1: number, x1: number, y2: number, x2: number): FrameGeometry => ({ y1, x1, y2, x2 });

/**
 * Ланцюжковий зв'язок із замовчуваннями «документна рамка на видимому шарі».
 *
 * Поля названі поіменно, а не докинуті `as never`, саме тому, що ТРИ з шести
 * (`createdOrder`, `layerVisible`, `fromMaster`) вирішують відповідь, і
 * фікстура, яка їх мовчки не має, перевіряла б поведінку на `undefined`.
 */
function link(over: Partial<ThreadLink>): ThreadLink {
  return {
    storyId: "s1",
    previousPage: null,
    nextPage: null,
    createdOrder: 1,
    layerVisible: true,
    /* НЕ службовий шар: замовчування мусить означати «рамка основного
     * ланцюжка», інакше кожна фікстура мовчки твердила б про `_folio-helper`
     * і маршрут `helper` виходив би там, де його ніхто не будував (C1). */
    layerName: "Текст",
    fromMaster: false,
    ...over,
  };
}

function frame(overlaps: ThreadLink[] | null): ClaimFrame {
  return {
    id: "f1",
    page: "7",
    styleName: "Колонцифра",
    rotationAngle: -90,
    paragraphs: [],
    bounds: R(0, 0, 10, 10),
    layerName: "Layer 1",
    layerVisible: true,
    layerPrintable: true,
    fromMaster: false,
    locked: false,
    layerLocked: false,
    overlaps,
  };
}

/*
 * `rectsOverlap` — ДВІЙНИК `IDMCP.boundsTouch`, а не ідеальний геометричний
 * предикат, і саме тому дотик тут ЗАРАХОВАНО.
 *
 * Бриф Задачі 5 вимагав строгих нерівностей із поясненням «InDesign вимагає
 * накладання площ». Вимір каже протилежне, і він новіший за бриф (коміт
 * 353c714, Задача 3): Adobe описує розв'язання маркера як «touches or
 * overlaps», а на робочій книжці з 7 наявних контактів колонцифри з ланцюжком
 * `touch` — 7, `strict` (площа перетину > 0) — **0** (H7, Питання 3, таблиця
 * «Розкладка тих семи перекриттів, що є»).
 *
 * Отже строга версія розійшлася б із `ClaimFrame.overlaps` на 100 %
 * контактів, які в книжці існують: `overlaps` будує ВИКЛЮЧНО
 * `IDMCP.boundsTouch` (`src/jsx/pagination.jsx`, єдине місце виклику в
 * `claimFrame`). Два предикати в одному репозиторії, що відповідають
 * протилежно на єдиний виміряний випадок, — це не «строгість», це друга
 * правда.
 */
describe("rectsOverlap", () => {
  it("перекриття по обох осях", () => {
    expect(rectsOverlap(R(0, 0, 10, 10), R(5, 5, 15, 15))).toBe(true);
  });

  it("ДОТИК КРАЯМИ ВВАЖАЄТЬСЯ перекриттям — так рахує вимір", () => {
    /* Виміряно H7, Питання 3: усі 7 контактів книжки — саме `touch`, `strict`
     * нуль. Хибне «ні» тут дало б нуль перекриттів там, де InDesign їх
     * бачить, тобто мовчазний нуль маршруту A на КОЖНІЙ книжці, а не лише на
     * цій — рівно той тихий відмовний режим, проти якого §3. */
    expect(rectsOverlap(R(0, 0, 10, 10), R(10, 10, 20, 20))).toBe(true);
  });

  it("розходження лише по одній осі — не перекриття", () => {
    expect(rectsOverlap(R(0, 0, 10, 10), R(0, 20, 10, 30))).toBe(false);
  });

  it("розрив, більший за допуск, — не перекриття", () => {
    /* 0,5 мм по x. Без цього тесту «зараховувати дотик» не відрізнити від
     * «зараховувати будь-що». */
    expect(rectsOverlap(R(0, 0, 10, 10), R(0, 10.5, 10, 20))).toBe(false);
  });

  it("розрив У МЕЖАХ допуску — перекриття, як у `IDMCP.boundsTouch`", () => {
    /* 0,005 мм при допуску 0,01. Допуск не наша політика, а паритет із
     * вимірювальним предикатом: розійшовшись у ньому, двійник перестав би
     * бути двійником саме на межі, заради якої допуск і введено. */
    expect(rectsOverlap(R(0, 0, 10, 10), R(0, 10.005, 10, 20))).toBe(true);
  });

  it("розрив РІВНО в допуск — ЩЕ перекриття (межа паритету з boundsTouch)", () => {
    /*
     * БОРГ ЗАДАЧІ 5, ЗНАХІДКА I1 РЕЦЕНЗІЇ `0abf0be`. Звіт Задачі 5 назвав
     * мутант `<` → `<=` «вакуумним» і тесту не дописав, хоч Step 5 брифа
     * вимагав саме переписати тест, якщо мутант не впав. Рецензент довів
     * виконанням, що тест можливий: під мутантом падає рівно цей рядок.
     *
     * Діагноз Задачі 5 при цьому вірний, і саме він пояснює, ЧОМУ потрібен
     * окремий випадок. У формі КОН'ЮНКЦІЇ (`a.x1 < b.x2 && …`), яку
     * припускав бриф, `<` → `<=` перемикає ДОТИК — а його вже стереже тест
     * вище. У формі РОЗДІЛЕННЯ, у якій написаний двійник, той самий знак
     * перемикає інший випадок: розрив ШИРИНОЮ РІВНО В ДОПУСК.
     *
     * Числа підібрані так, щоб відповідь не залежала від подвійної точності:
     * `0.01 - 0.01 === 0` рівно, тоді як `10.01 - 0.01 === 10.000000000000002`.
     * Тому перша рамка — вироджена смуга з `x1 === x2 === 0`.
     *
     * Що ловить: «підтягування строгості» до `<=`. Усі решта тестів файла
     * лишаються зеленими, а TypeScript і вимір починають відповідати
     * по-різному про контакти шириною рівно в допуск — саме та «друга
     * правда», проти якої написаний увесь модуль.
     */
    expect(rectsOverlap(R(0, 0, 10, 0), R(0, 0.01, 10, 10))).toBe(true);
  });
});

/*
 * `overlaps` НУЛЬОВНИЙ, І `?? []` ТУТ ЗАБОРОНЕНО.
 *
 * Три стани замість двох (`ClaimFrame.overlaps`, спек §4.9): непорожній масив,
 * `[]` («перевірили — не перекриває», факт про верстку) і `null` («НЕ
 * перевіряли»: власні `bounds` невідомі). `resolveMarkerPage` віддає `null` в
 * обох останніх випадках — сторінки немає ні там, ні там, — а РОЗРІЗНЯЄ їх
 * викликач: детектор Задачі 6 перевіряє `frame.overlaps === null` ПЕРШИМ і
 * веде таку рамку в `notCompared`, не в `deviating`. Тому тут же перевіряється
 * й `documentThreadLinks`, який єдиний зберігає різницю.
 */
describe("resolveMarkerPage", () => {
  it("previous бере сторінку попередньої рамки перекритого ланцюжка", () => {
    expect(resolveMarkerPage(frame([link({ previousPage: "6", nextPage: "8" })]), "previous")).toBe(
      "6",
    );
  });

  it("next бере сторінку НАСТУПНОЇ рамки того ж ланцюжка", () => {
    /* Напрямок оголошує сам маркер (спек §4.9), не бік розвороту. На книжці
     * verso-колонцифр нуль (Питання 1), тож цю гілку не покриє жоден прогін
     * на ній — лише тест. */
    expect(resolveMarkerPage(frame([link({ previousPage: "6", nextPage: "8" })]), "next")).toBe("8");
  });

  it("немає перекриття — null, а не поточна сторінка", () => {
    /* H6, випадок B: маркер тоді ПОКАЗУЄ поточну сторінку, але для нас це
     * «не розв'язується». Повернути "7" означало б визнати рамку придатною. */
    expect(resolveMarkerPage(frame([]), "previous")).toBeNull();
  });

  it("overlaps === null — теж null, але це ІНШИЙ null", () => {
    /* `[]` — «перевірили, не перекриває»; `null` — «НЕ ПЕРЕВІРЯЛИ»
     * (`types.ts`, `ClaimFrame.overlaps`). Обидва не дають сторінки;
     * розрізняє їх викликач через `documentThreadLinks`. */
    expect(resolveMarkerPage(frame(null), "previous")).toBeNull();
  });

  it("перекриття є, але сусіда в потрібному напрямку немає — null", () => {
    expect(
      resolveMarkerPage(frame([link({ previousPage: null, nextPage: "8" })]), "previous"),
    ).toBeNull();
  });

  it("перекриття ДВОХ ланцюжків — виграє СТВОРЕНИЙ РАНІШЕ", () => {
    /* Виміряно H7, Питання 9: 5 із 5, порядок накладання не впливає
     * (`bringToFront` не працює як засіб керування), більше контейнерів і
     * більша площа перекриття відкинуті явно (`U9`, `Y9`). Фаза додає
     * службовий ланцюжок ОСТАННІМ, тож основний текст виграє скрізь, де
     * колонцифра його перекриває — службова рамка такої рамки НЕ рятує, і
     * маршрут там примусово "thread", а не "helper" (§4.2).
     *
     * Службовий стоїть у масиві ПЕРШИМ навмисно: порядок у `overlaps` — це
     * порядок обходу рамок сторінки, тобто саме та величина, яку вимір
     * оголосив невпливовою. Реалізація «виграє перший у списку» тут падає. */
    const two = frame([
      link({ storyId: "s-helper", createdOrder: 2, previousPage: "3", nextPage: "4" }),
      link({ storyId: "s-main", createdOrder: 1, previousPage: "6", nextPage: "8" }),
    ]);
    expect(resolveMarkerPage(two, "previous")).toBe("6");
  });

  it("МАЙСТРОВЕ перекриття маршруту не дає — сторінки для розв'язання немає", () => {
    /* Питання 6: ланцюжок, що живе на майстрі, лишається ланцюжком МАЙСТРА —
     * сусідня рамка лежить на сторінці «B», документної сторінки в маркера
     * немає. Питання 13: маркер у непереозначеній майстровій рамці не бачить
     * і документного ланцюжка під собою.
     *
     * Ціна помилки виміряна: на робочій книжці 90 із 91 рамки колонцифри
     * мають перекриття, УСІ майстрові. Якби вони рахувались, фаза примусила б
     * `thread` на 90 рамках і полагодила б ОДНУ з 91, доповівши про 90
     * законних пропусків (§4.2). */
    const master = frame([link({ fromMaster: true, previousPage: "6", nextPage: "8" })]);
    expect(resolveMarkerPage(master, "previous")).toBeNull();
  });

  it("майстровий ланцюжок не перебиває документного, хоч і створений раніше", () => {
    /* Правило «виграє створений раніше» діє СЕРЕД ДОКУМЕНТНИХ ланцюжків.
     * Майстровий вибуває раніше за будь-яке порівняння — він не виконується
     * взагалі, а не програє. Спершу відсіяти, потім упорядкувати. */
    const mixed = frame([
      link({ storyId: "s-master", createdOrder: 1, fromMaster: true, previousPage: "3" }),
      link({ storyId: "s-doc", createdOrder: 2, previousPage: "6" }),
    ]);
    expect(resolveMarkerPage(mixed, "previous")).toBe("6");
  });

  it("ПРИХОВАНИЙ шар перекритої рамки глушить маркер — null", () => {
    /* Виміряно, Питання 8: прихований шар ГЛУШИТЬ розв'язання (на відміну від
     * `printable = false`, яке не ламає нічого). Це `layerVisible` ПЕРЕКРИТОЇ
     * рамки, не своєї: приховано ЇЇ — число хибне (`folio-marker-unbound`);
     * приховано САМУ рамку — вона не друкується (`folio-dormant-duplicate`).
     * Два однойменні поля поруч означають протилежне (§4.9). */
    const hidden = frame([link({ layerVisible: false, previousPage: "6" })]);
    expect(resolveMarkerPage(hidden, "previous")).toBeNull();
  });

  it("дві рамки ОДНОГО ланцюжка з різними сусідами — null, вибір не виміряний", () => {
    /* Один `storyId` — один `createdOrder` (`createdOrder = Number(story.id)`,
     * `pagination.jsx`), тож правило Питання 9 їх не впорядковує взагалі.
     * Котра з двох сусідніх рамок ланцюжка виграє — не міряно, а половина
     * шансів написати неправильне число гірша за пропуск. */
    const sameStory = frame([
      link({ storyId: "s1", createdOrder: 1, previousPage: "6" }),
      link({ storyId: "s1", createdOrder: 1, previousPage: "5" }),
    ]);
    expect(resolveMarkerPage(sameStory, "previous")).toBeNull();
  });

  it("«сусіда немає» проти «сусід на 6» — теж розбіжність, отже null", () => {
    /*
     * БОРГ ЗАДАЧІ 5, ЗНАХІДКА I3 РЕЦЕНЗІЇ `0abf0be`. Коментар при
     * `pages.add(...)` проголошує, що `null` у множині сторінок рахується
     * НАРІВНІ зі сторінкою, — і поведінку, заради якої функція взагалі
     * розрізняє сусідів, не тримав жоден тест. Рецензент показав це
     * виконанням: мутант «ігнорувати null-сторінки»
     * (`const p = …; if (p !== null) pages.add(p);`) давав 19 passed.
     *
     * Стан досяжний і не екзотичний: колонцифра перекриває дві рамки ОДНОГО
     * ланцюжка, з яких перша в історії не має попередньої (`previousPage:
     * null`), а друга веде на «6». Один `storyId` — один `createdOrder`, тож
     * правило Питання 9 їх не впорядковує, і вибрати «те, що є» означало б
     * угадати з половиною шансів написати неправильне число.
     */
    const partial = frame([
      link({ storyId: "s1", createdOrder: 1, previousPage: null }),
      link({ storyId: "s1", createdOrder: 1, previousPage: "6" }),
    ]);
    expect(resolveMarkerPage(partial, "previous")).toBeNull();
  });

  it("дві рамки одного ланцюжка з ОДНАКОВИМ сусідом — однозначно", () => {
    const sameStory = frame([
      link({ storyId: "s1", createdOrder: 1, previousPage: "6" }),
      link({ storyId: "s1", createdOrder: 1, previousPage: "6" }),
    ]);
    expect(resolveMarkerPage(sameStory, "previous")).toBe("6");
  });

  it("два РІЗНІ ланцюжки з однаковим createdOrder — null навіть при однаковій сторінці", () => {
    /* Стан досяжний: `createdOrder = Number(story.id)`, а при нечисловому
     * `id` вимір кладе 0 (`pagination.jsx`, гілка `isNaN`). Два таких
     * ланцюжки нерозрізненні правилом Питання 9, і збіг сторінок цього не
     * лікує — сьогодні збіглись, завтра ні, а мовчазна відповідь була б та
     * сама. */
    const tied = frame([
      link({ storyId: "s-a", createdOrder: 0, previousPage: "6" }),
      link({ storyId: "s-b", createdOrder: 0, previousPage: "6" }),
    ]);
    expect(resolveMarkerPage(tied, "previous")).toBeNull();
  });
});

describe("documentThreadLinks", () => {
  it("null лишається null — «не перевіряли» не стає порожнім списком", () => {
    /* Єдине місце, де три стани `overlaps` ще розрізнимі. Якби тут стояло
     * `?? []`, детектор §4.9 дістав би «виміряли й порожньо» на рамці, якої
     * ніхто не міряв, і вигадав би `folio-marker-unbound` у `deviating`. */
    expect(documentThreadLinks(frame(null))).toBeNull();
  });

  it("майстрові зв'язки відсіяні, документні збережені", () => {
    const mixed = frame([
      link({ storyId: "s-master", fromMaster: true }),
      link({ storyId: "s-doc", fromMaster: false }),
    ]);
    expect(documentThreadLinks(mixed)?.map((l) => l.storyId)).toEqual(["s-doc"]);
  });
});

/**
 * ГЛУХИЙ КУТ НЕ ПЕРЕБИВАЄ ЛАНЦЮЖКА, НАВІТЬ СТВОРЕНИЙ РАНІШЕ.
 *
 * Правило «виграє створений найраніше» (H7, Питання 9) виміряне на змаганні
 * ДВОХ СПРАВЖНІХ ланцюжків. Випадку «найраніший узагалі не може дати числа»
 * той вимір не покривав, і код тлумачив його як безвихідь — `null`, тобто
 * відмову `no-neighbour-frame`.
 *
 * Переміряно 2026-08-16 надрукованим числом (`scripts/probe-touch-winner.mjs`,
 * фікстура + експорт PDF + читання тексту). Рамка-глухий кут (історія з однієї
 * рамки, `previousPage` порожній) із `story.id = 243` проти ланцюжка з
 * `story.id = 266` — тобто глухий кут СТВОРЕНО РАНІШЕ — і маркер усе одно
 * надрукував число ланцюжка. Обидва порядки створення дали те саме.
 *
 * Отже InDesign глухий кут ПРОПУСКАЄ, а не впирається в нього, і правило
 * «найраніший» діє лише серед тих, хто взагалі може дати число.
 *
 * Ціна цієї помилки на робочій книжці: сім сторінок (101, 109, 153, 167, 171,
 * 185, 195), де колонцифра дотикається рамки декоративної лапки «’’» —
 * 150 pt Apple Symbols, історія з однієї рамки. Вони діставали відмову й
 * лишались ручними без жодної причини.
 */
describe("глухий кут серед перекриттів", () => {
  const GOOD = { storyId: "s-helper", createdOrder: 9, previousPage: "6", nextPage: "8" };
  /* previousPage і nextPage порожні — вести нема куди. Створено РАНІШЕ. */
  const DEAD = { storyId: "s-quote", createdOrder: 1, previousPage: null, nextPage: null };

  it("ранiший глухий кут не заважає — число дає ланцюжок", () => {
    expect(resolveMarkerPage(frame([link(DEAD), link(GOOD)]), "previous")).toBe("6");
  });

  it("те саме для напрямку next", () => {
    expect(resolveMarkerPage(frame([link(DEAD), link(GOOD)]), "next")).toBe("8");
  });

  it("ПОЗИТИВНИЙ БЛИЗНЮК: два СПРАВЖНІ ланцюжки досі дають null", () => {
    /* Тут неоднозначність справжня: обидва можуть дати число, і різне. */
    const a = link({ storyId: "s-a", createdOrder: 1, previousPage: "6", nextPage: "8" });
    const b = link({ storyId: "s-b", createdOrder: 1, previousPage: "4", nextPage: "5" });
    expect(resolveMarkerPage(frame([a, b]), "previous")).toBeNull();
  });

  it("ПОЗИТИВНИЙ БЛИЗНЮК: самі глухі кути — досі null", () => {
    expect(resolveMarkerPage(frame([link(DEAD)]), "previous")).toBeNull();
  });

  it("ПОЗИТИВНИЙ БЛИЗНЮК: прихований переможець досі глушить маркер", () => {
    /* Виміряно Питанням 8; поведінку прихованого шару ця правка НЕ чіпає. */
    const hidden = link({ storyId: "s-h", createdOrder: 1, previousPage: "6", layerVisible: false });
    expect(resolveMarkerPage(frame([hidden, link(GOOD)]), "previous")).toBeNull();
  });
});

/*
 * ПАДІННЯ ПІСЛЯ ВДАЛОГО ЗАПИСУ — найгірший момент, щоб упасти.
 *
 * `helperChainWins` стереже свій вхід, але передає в `resolutionWinners`
 * результат `liveLinks(...)`, а той буває порожнім і на непорожньому вході:
 * коли жодна ланка не дає сторінки в потрібному напрямку, а всі вони на
 * видимому шарі. `resolveFromLinks` цей стан стереже явно — `helperChainWins`
 * не стеріг, і `links[0]!.createdOrder` кидав TypeError.
 *
 * Дорого це саме тим, ДЕ трапляється: виклик у tools/pagination.ts іде вже
 * ПІСЛЯ того, як repair-helper-thread записав у документ і зберіг план. Тобто
 * успішний ремонт читався оператором як провал.
 *
 * Виміряно на робочій книжці: колонцифра торкається одноблокової історії
 * (декоративна лапка 150 pt) на семи сторінках, а в такої історії
 * previousPage === null — тобто вхід саме той.
 */
describe("helperChainWins на входу, що дає порожній liveLinks", () => {
  const ланка = (over: Partial<ThreadLink> = {}): ThreadLink => ({
    storyId: "266",
    previousPage: null,
    nextPage: null,
    createdOrder: 266,
    layerVisible: true,
    layerName: "Текст",
    fromMaster: false,
    ...over,
  });

  it("не падає, а відповідає false", () => {
    expect(() => helperChainWins([ланка()], "previous")).not.toThrow();
    expect(helperChainWins([ланка()], "previous")).toBe(false);
  });

  it("порожній список — так само false", () => {
    expect(helperChainWins([], "previous")).toBe(false);
  });

  it("ПОЗИТИВНИЙ БЛИЗНЮК: жива ланка на шарі-помічнику досі виграє", () => {
    /* Без цього сторож, що завжди віддає false, склав би обидві перевірки
     * вище — і родина helper-chain замовкла б назовсім. */
    const жива = ланка({ previousPage: "12", layerName: HELPER_LAYER_NAME, storyId: "900" });
    expect(helperChainWins([жива], "previous")).toBe(true);
  });
});

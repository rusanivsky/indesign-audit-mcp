import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runJsx } from "../../src/bridge/runner.js";
import type { ClaimFrame, PaginationMeasure } from "../../src/pagination/types.js";
import { assertFixtureActive, closeFixtureDoc } from "./fixture-doc.js";

const PARAMS = {
  folioStyles: ["Kolontsyfra"],
  contentsNumberStyle: "Zmist Cyfra",
  contentsTitleStyles: ["Zmist Rozdil"],
  headingStyles: ["Zagolovok"],
};

/*
 * РОЗКЛАДКА ФІКСТУРИ — ДЖЕРЕЛО ВСІХ МАЙСТРОВИХ ЧИСЕЛ У ЦЬОМУ ФАЙЛІ.
 *
 * Майстрова рамка — ОДИН об'єкт, видимий із N сторінок, і кожен показ є
 * окремим твердженням. Отже будь-яке число, що стосується батьківського
 * розвороту, дорівнює кількості сторінок ВІДПОВІДНОГО БОКУ, а не константі.
 * Задача 4 додала до фікстури десять сторінок, і всі такі числа треба було
 * ПЕРЕВЕСТИ за цією таблицею, а не замінити новим літералом, підігнаним під
 * новий вивід.
 *
 * Виміряно прямим читанням `page.name`, `page.side` і складу `spread.pages`
 * (зонд Задачі 4Б, власний тимчасовий документ із тією самою послідовністю
 * викликів):
 *
 *   verso (LEFT_HAND)  2, 4, 6, 8, x, 12, 14, 16, 18, 20, 22          11
 *   recto (RIGHT_HAND) 1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21,
 *                      23, 24, 25                                     14
 *                                                                    ---
 *                                                                     25
 *
 * «x» — п'ята verso: секція `LOWER_ROMAN` робить її назву нечисловою, і саме
 * на цьому стоїть `folio-unparsable-page-name`. Сторінки «23» і «24» — друга
 * й третя в розвороті з ТРЬОХ, тому боку `RIGHT_HAND` там двічі поспіль.
 * Сторінка «25» — ОСТАННЯ, сама у своєму розвороті (`spreadSiblings: []`).
 *
 * Задача 4Б додала чотири сторінки (18…21) і одну останню (25); множники
 * майстрових чисел нижче ті самі, змінились лише R і V: 11 → 14 і 9 → 11.
 */
const VERSO_PAGES = ["2", "4", "6", "8", "x", "12", "14", "16", "18", "20", "22"];
const RECTO_PAGES = ["1", "3", "5", "7", "9", "11", "13", "15", "17", "19", "21", "23", "24", "25"];

describe("pagination_measure на фікстурі", () => {
  let docName: string;
  let m: PaginationMeasure;

  /*
   * Фікстура має тепер ДВІ рамки колонцифри на кількох сторінках: намальовану
   * в документі й батьківську під нею (виміряний стан книжки — 29 таких).
   * Тести, писані до цього, брали `find(page === …)` і мовчки діставали першу,
   * тобто покладались на порядок джерел. Джерело називається явно.
   */
  const ownFolio = (page: string): ClaimFrame =>
    m.folioFrames.find((fr) => fr.page === page && !fr.fromMaster)!;

  beforeAll(async () => {
    const made = await runJsx<{ docName: string }>("__fixture_make_pagination", {}, {
      timeoutMs: 180_000,
    });
    docName = made.docName;
    await assertFixtureActive(docName);
    m = await runJsx<PaginationMeasure>("pagination_measure", PARAMS, { timeoutMs: 180_000 });
  }, 300_000);

  afterAll(async () => {
    if (docName) await closeFixtureDoc(docName);
  });

  it("міряє саме фікстуру, а не чужий документ", () => {
    expect(m.docName).toBe(docName);
    expect(m.pages).toHaveLength(VERSO_PAGES.length + RECTO_PAGES.length);
    /* Розкладка вгорі файла — не коментар, а джерело чисел нижче: якщо
     * фікстура зсунеться, впасти має ТУТ, а не в лічильнику через 300 рядків
     * із незрозумілим «expected 27 to be 18». */
    expect(m.pages.map((p) => p.name).sort()).toEqual(
      [...VERSO_PAGES, ...RECTO_PAGES].sort(),
    );
  });

  it("склад розвороту виміряно, і сторінка не є сусідом самій собі", () => {
    const p3 = m.pages.find((p) => p.name === "3");
    expect(p3!.spreadSiblings).toEqual(["2"]);
    expect(p3!.spreadSiblings).not.toContain("3");
  });

  it("автомаркер класифіковано як маркер, а НЕ як літеральне число", () => {
    /* Ключова перевірка виміру: у рамці «2–<auto>» на с.3 число 3, яке дасть
     * автомаркер, не сміє потрапити в literals — інакше регулярка порахувала
     * б автоматичне число як ручне, і вся різниця між родинами зникла б. */
    const f = ownFolio("3");
    expect(f.paragraphs[0]!.markers).toContain("auto-page-number");
    expect(f.paragraphs[0]!.literals).toEqual([2]);
  });

  it("рамка без автомаркера дає два літерали й порожній перелік маркерів", () => {
    const f = ownFolio("9");
    expect(f.paragraphs[0]!.markers).toEqual([]);
    expect(f.paragraphs[0]!.literals).toEqual([8, 9]);
  });

  it("секція робить назву сторінки нечисловою — вимір це показує, а не ховає", () => {
    const last = m.pages[9]!;
    expect(last.name).not.toMatch(/^\d+$/);
  });

  it("ПРИВ'ЯЗАНА рамка потрапляє у вимір", () => {
    /* Зонд H6: page.textFrames її не бачить (1 проти 9 на реальній книжці).
     * Прив'язане число «8» лежить у рамці всередині тексту рядка змісту. */
    const anchored = m.contentsNumbers.filter((f) =>
      f.paragraphs.some((p) => p.literals.includes(8)),
    );
    expect(anchored.length).toBeGreaterThan(0);
  });

  it("інстанс текстової змінної класифіковано як text-variable, не як порожнечу", () => {
    /* Третій вид вмісту (спек §4.6а). Без нього рядок виглядав би порожнім,
     * і інструмент не сказав би головного: він УЖЕ автоматичний. */
    const auto = m.contentsNumbers.filter((f) =>
      f.paragraphs.some((p) => p.markers.includes("text-variable")),
    );
    expect(auto.length).toBeGreaterThan(0);
    expect(auto[0]!.paragraphs[0]!.literals).toEqual([]);
  });

  it("повернена рамка чисел зберігає кут — інакше зсув базових ліній був би тихим", () => {
    const rotated = m.contentsNumbers.filter((f) => f.rotationAngle !== 0);
    expect(rotated.length).toBeGreaterThan(0);
  });

  it("заголовки тіла зібрано в порядку документа зі сторінками", () => {
    expect(m.headings.map((h) => h.page)).toEqual(["4", "6", "8"]);
    expect(m.headings.map((h) => h.order)).toEqual([0, 1, 2]);
  });

  it("базові лінії й інтерліньяж виміряно в міліметрах", () => {
    const withBaseline = m.contentsTitles.flatMap((f) => f.paragraphs).filter((p) => p.baseline !== null);
    expect(withBaseline.length).toBeGreaterThan(0);
    /* Сторінка A4 має 297 мм заввишки: у пайках ті самі координати дали б
     * сотні, і допуск «половина інтерліньяжу» мовчки з'їхав би. */
    expect(Math.abs(withBaseline[0]!.baseline!)).toBeLessThan(400);
  });

  it("рамка колонцифри несе геометрію, шар і зв'язки перекритих ланцюжків", () => {
    const f = ownFolio("3");
    expect(f).toBeDefined();
    expect(f.bounds!.y2).toBeGreaterThan(f.bounds!.y1);
    expect(f.bounds!.x2).toBeGreaterThan(f.bounds!.x1);
    expect(typeof f.layerName).toBe("string");
    expect(f.locked).toBe(false);
    expect(Array.isArray(f.overlaps)).toBe(true);
  });

  /*
   * ТЕСТ «зсуви літералів дають рівно ті самі числа, що literals» ВИДАЛЕНО, а
   * не послаблено. Він робив `p.text.slice(at, …)`, тобто перевіряв РЯДКОВУ
   * властивість СИМВОЛЬНОГО зсуву — не сліпий, а ІНВЕРТОВАНИЙ. Доведено
   * виконанням (звіт Задачі 3): на рамці «8–9» правильний код такий зріз
   * ПРОВАЛЮЄ, а мутант «рядковий зсув» проходить. Виживав тест лише тому, що
   * був прив'язаний до с. 3, де обидва зсуви нульові.
   *
   * Перевірити символьний зсув засобами самого виміру неможливо: у відповіді
   * немає переліку символів, лише зібраний рядок. Тому інваріант перевіряється
   * там, де дві системи розходяться, ОЧІКУВАНИМИ ЧИСЛАМИ — тест нижче. Це
   * строкове зобов'язання: Задача 4 додасть `folio-verso` з міткою «–7», і
   * зріз по рядку впав би вже проти ПРАВИЛЬНОГО коду.
   */

  it("зсув літерала СИМВОЛЬНИЙ, а не рядковий", () => {
    /* Рамка «8–9» на с.9 — єдине місце фікстури, де дві системи РОЗХОДЯТЬСЯ.
     * `character.contents` віддає назву перерахування і для типографських
     * символів теж, тож рядок збирається як "8EN_DASH9": літерал 9 стоїть на
     * позиції 8 РЯДКА і на позиції 2 серед СИМВОЛІВ. Запис іде через
     * `paragraph.characters[i]`, тож правильна відповідь — 2.
     *
     * Без цього тесту рядковий зсув пройшов би зеленим: у решті фікстури (і в
     * усіх 91 літералах робочої книжки) обидва зсуви дорівнюють 0. */
    const f = ownFolio("9");
    const p = f.paragraphs[0]!;
    expect(p.literals).toEqual([8, 9]);
    expect(p.literalOffsets).toEqual([0, 2]);
    /* Негативний контроль: якби зсув був рядковим, тут стояло б 8. */
    expect(p.text.indexOf("9")).toBe(8);
  });

  it("перекриття несе всі ШІСТЬ полів ThreadLink, а не саму лише ознаку дотику", () => {
    /* Перенесено з рамки ЧИСЛА ЗМІСТУ на рамку КОЛОНЦИФРИ, і не заради
     * зручності: `overlaps` рахуються тепер лише для родини `folio` (§4.2 і
     * §4.9 — єдині споживачі). Пара фікстури — намальована колонцифра й
     * батьківська під нею, тобто виміряний стан книжки. */
    const f = ownFolio("3");
    expect(f.overlaps!.length).toBeGreaterThan(0);
    const link = f.overlaps![0]!;
    expect(typeof link.storyId).toBe("string");
    expect(link.storyId).not.toBe("");
    expect(typeof link.createdOrder).toBe("number");
    expect(Number.isNaN(link.createdOrder)).toBe(false);
    expect(typeof link.layerVisible).toBe("boolean");
    /* Перекрита рамка — одна рамка одного ланцюжка, сусідів немає. `null`, а
     * не здогад про сторінку ±1. */
    expect(link.previousPage).toBeNull();
    expect(link.nextPage).toBeNull();
  });

  it("ThreadLink.fromMaster розрізняє походження ПЕРЕКРИТОЇ рамки", () => {
    /*
     * БЛОКЕР B2. Третє джерело додало майстрові рамки в `overlaps`, і на
     * робочій книжці 90 із 91 колонцифри дістали перекриття — усі майстрові.
     * За §4.2 «де перекриття є — маршрут примусово thread» фаза полагодила б
     * ОДНУ рамку з 91, а 90 пропусків виглядали б законними: ланцюжок майстра
     * для документної сторінки не розв'язується взагалі (Питання 6 і 13).
     *
     * Обидва значення перевіряються на ОДНІЙ парі рамок, тобто поле справді
     * розрізняє, а не стоїть константою: намальована колонцифра бачить під
     * собою майстрову (`true`), майстрова бачить над собою намальовану
     * (`false`).
     */
    const own = ownFolio("3");
    const master = m.folioFrames.find((fr) => fr.page === "3" && fr.fromMaster)!;
    expect(own.overlaps!.map((o) => o.fromMaster)).toEqual([true]);
    expect(master.overlaps!.map((o) => o.fromMaster)).toEqual([false]);
    /* Дані НЕ відкинуто на вході: майстрове перекриття лишилось у переліку з
     * позначкою, а не зникло. Інше видання може мати там документний
     * ланцюжок, і відрізнити зможе лише той, хто бачить обидва. */
    expect(own.overlaps![0]!.storyId).not.toBe("");
  });

  it("шар і походження рамки виміряно, а не припущено", () => {
    const f = ownFolio("3");
    expect(f.layerVisible).toBe(true);
    expect(f.layerPrintable).toBe(true);
    expect(f.fromMaster).toBe(false);
    /* Ознака мусить РОЗРІЗНЯТИ, а не бути константою: фікстура має обидва
     * походження на тій самій сторінці. */
    expect(m.folioFrames.some((fr) => fr.fromMaster)).toBe(true);
    expect(m.folioFrames.some((fr) => !fr.fromMaster)).toBe(true);
  });

  it("межі рамки в МІЛІМЕТРАХ і в координатах розвороту", () => {
    /* Колонцифра фікстури лежить на recto, тобто на ДРУГІЙ сторінці
     * розвороту: у координатах сторінки її x починався б від ~7 мм, у
     * координатах розвороту — за шириною лівої сторінки. Перевірка ловить
     * і одиниці, і початок відліку одночасно. */
    const f = ownFolio("3");
    expect(f.bounds!.x1).toBeGreaterThan(150);
    expect(f.bounds!.x2).toBeLessThan(500);
    expect(f.bounds!.y2 - f.bounds!.y1).toBeGreaterThan(5);
    expect(f.bounds!.y2 - f.bounds!.y1).toBeLessThan(30);
  });

  it("межі МАЙСТРОВОЇ рамки зведено до ДОКУМЕНТНОГО розвороту", () => {
    /*
     * БЛОКЕР B1, і перевіряється саме той стан, де системи РОЗХОДЯТЬСЯ.
     *
     * Одна й та сама майстрова рамка (той самий `.id`) стоїть на правій
     * батьківській сторінці, тобто на позиції 1 свого розвороту. Сторінка «3»
     * теж на позиції 1 — системи збігаються. Сторінка «1» стоїть у розвороті
     * САМА, на позиції 0, і сирі `geometricBounds` приходять зміщені на цілу
     * ширину сторінки (виміряно, Питання 17: 215,9 мм на Letter).
     *
     * Без зведення рамка сторінки «1» лежала б за правим краєм власного
     * розвороту й не перекривала б нічого — тобто §4.9 мовчки не побачив би
     * жодного сплячого дубля на перших сторінках книжки.
     */
    const onOne = m.folioFrames.find((fr) => fr.page === "1" && fr.fromMaster)!;
    const onThree = m.folioFrames.find((fr) => fr.page === "3" && fr.fromMaster)!;
    expect(onOne.id).toBe(onThree.id);

    const pageOne = m.pages.find((p) => p.name === "1")!;
    expect(pageOne.spreadSiblings).toEqual([]);

    /* Сторінка «1» — перша в розвороті, тож її x іде від нуля. */
    expect(onOne.bounds!.x1).toBeLessThan(100);
    expect(onOne.bounds!.x1).toBeGreaterThan(0);
    /* Сторінка «3» — друга в розвороті, зсуву немає. Різниця двох показів
     * ОДНІЄЇ рамки і є ширина сторінки. */
    expect(onThree.bounds!.x1).toBeGreaterThan(150);
    expect(onThree.bounds!.x1 - onOne.bounds!.x1).toBeGreaterThan(150);
    /* По вертикалі сторінки розвороту стоять на одному рівні — зсуву бути
     * не сміє, інакше зведення підмінило б і те, що збігалось. */
    expect(onThree.bounds!.y1).toBeCloseTo(onOne.bounds!.y1, 3);
  });

  it("майстрова рамка належить лише родині folio — contents її не РОЗМНОЖУЄ", () => {
    /*
     * Свідоме рішення, не пропуск (спек §2, §4.5). Майстрова рамка — ОДИН
     * об'єкт, видимий із N сторінок. Для фоліо N записів це N різних
     * тверджень («що надрукує ЦЯ сторінка»), і саме з них зроблені сплячі
     * дублі §4.9. Для змісту N записів були б РОЗМНОЖЕННЯМ одного факту:
     * колонтитул на батьківській дав би 5 фантомних заголовків на фікстурі й
     * 40 на книжці, а далі — contents-count-mismatch і зсув, що робить
     * застарілим кожен наступний рядок.
     */
    expect(m.folioFrames.filter((fr) => fr.fromMaster).length).toBeGreaterThan(0);
    expect(m.contentsTitles.every((fr) => !fr.fromMaster)).toBe(true);
    expect(m.contentsNumbers.every((fr) => !fr.fromMaster)).toBe(true);
    /* Поіменно: фікстура має на батьківській колонтитул зі стилем заголовка
     * тіла і рамку зі стилем чисел змісту. Жодне з двох не сміє протекти. */
    expect(m.headings.map((h) => h.text)).not.toContain("Kolontytul z majstra");
    expect(m.headings).toHaveLength(3);
    expect(m.headings.every((h) => h.page !== null)).toBe(true);
    expect(m.contentsNumbers.some((fr) => fr.paragraphs.some((p) => p.literals.includes(77)))).toBe(
      false,
    );
  });

  it("заголовок УСЕРЕДИНІ майстрової рамки колонцифри не множиться посторінково", () => {
    /*
     * ДІРА, ЯКУ НЕ ЛОВИВ ЖОДЕН ТЕСТ ДВОХ ФІКС-РАУНДІВ, бо кожна половина коду
     * окремо виглядала правильною.
     *
     * Гейт «майстрова рамка належить лише родині folio» відкидає рамку за
     * РОЛЛЮ, тобто саме колонцифру пропускає далі; збір заголовків стоїть
     * ПІСЛЯ нього, він поабзацний і `fromMaster` не перевіряв узагалі.
     * Рамка `master-folio-with-heading-paragraph` фікстури має заголовок
     * ДРУГИМ абзацом усередині колонцифри — і давала 5 фантомних `Zagolovok`
     * з ОДНОГО об'єкта (по одному на кожну verso-сторінку), тобто рівно те
     * розмноження, заради заборони якого існує §4.1.
     *
     * ЧОМУ ЦЕ НЕ ДУБЛЬ ТЕСТУ ВИЩЕ: там колонтитул, у якого заголовок ПЕРШИМ
     * абзацом, тобто рамка відкидається ще за роллю й до поабзацного циклу не
     * доходить. Ця перевірка стоїть на єдиному стані, який туди доходить.
     */
    expect(m.headings.map((h) => h.text)).not.toContain("Zagolovok z majstra");
    expect(m.headings.map((h) => h.text)).toEqual([
      "Zagolovok 1",
      "Zagolovok 2",
      "Zagolovok 3",
    ]);
    /* Негативний контроль: стан у фікстурі справді Є, а не зник із неї —
     * інакше перевірка була б порожньою правдою. Рамка колонцифри на verso
     * має два абзаци, і другий саме стилем заголовка. */
    const masterVerso = m.folioFrames.find(
      (fr) => fr.page === "2" && fr.fromMaster && fr.paragraphs.length > 1,
    )!;
    expect(masterVerso).toBeDefined();
    expect(masterVerso.paragraphs[1]!.styleName).toBe("Zagolovok");
  });

  it("МЕЖІ НЕВІДОМІ — це власний стан, а не «перекриттів немає»", () => {
    /*
     * Правка попереднього раунду («зводити нема від чого → `null`») мети не
     * досягала: `claimFrame` робив із `null` нуль-прямокутник, `boundsTouch`
     * не викликався взагалі, і у відповідь ішов `overlaps: []` — значення,
     * побайтово однакове з «перевірили й перекриттів немає». §4.9 на такому
     * вході доповів би «сплячих дублів немає» як факт.
     *
     * Стан у фікстурі — `master-group-leaf-outside-pages`: лист ГРУПИ, що
     * лежить за межами майстрових сторінок. Це ЄДИНИЙ виміряний стан, який
     * дає `parentPage === null` І доходить до коду (рамка через корінець
     * майстра віддає `parentPage` = «A», а рамка на монтажному столі до
     * `page.masterPageItems` не потрапляє взагалі).
     *
     * ДВА ВИХОДИ ПОРУЧ — інакше це не перевірка стану, а перевірка константи.
     */
    const unknown = m.folioFrames.filter((fr) => fr.bounds === null);
    /*
     * Листи групи лежать на ЛІВІЙ батьківській, тож показів рівно стільки,
     * скільки verso-сторінок, — і ЛИСТІВ ТЕПЕР ДВА, а не один: Задача 4Б
     * додала другий, з напрямковим маркером, заради стану
     * `master-group-leaf-with-marker`. Множник переведено за розкладкою
     * (2 × V), а не замінено новою константою: 5 → 9 → 22.
     */
    expect(unknown.length).toBe(2 * VERSO_PAGES.length);
    expect(unknown.every((fr) => fr.fromMaster)).toBe(true);
    expect(unknown.every((fr) => fr.overlaps === null)).toBe(true);
    expect(unknown.map((fr) => fr.page).sort()).toEqual(
      [...VERSO_PAGES, ...VERSO_PAGES].sort(),
    );
    /*
     * І РІВНО ОДИН ІЗ ДВОХ ЛИСТІВ НЕСЕ МАРКЕР. Без цього рядка стан
     * `master-group-leaf-with-marker` перевірявся б лише за назвою: два листи
     * з невідомими межами дали б те саме число й без нього, а знахідку
     * `folio-marker-unmeasured` породжує саме маркер (§4.9).
     */
    const marked = unknown.filter((fr) =>
      fr.paragraphs.some((p) => p.markers.includes("previous-page-number")),
    );
    expect(marked.length).toBe(VERSO_PAGES.length);
    expect(marked.every((fr) => fr.paragraphs.every((p) => p.literals.length === 0))).toBe(true);

    /* Та сама родина, та сама сторінка — і межі відомі, а перекриття
     * ПОРАХОВАНІ. Якби `overlaps` був порожнім масивом в обох випадках,
     * різниці між ними не було б видно взагалі. */
    const known = m.folioFrames.filter((fr) => fr.page === "2" && fr.bounds !== null);
    expect(known.length).toBeGreaterThan(0);
    expect(known.every((fr) => Array.isArray(fr.overlaps))).toBe(true);
  });

  it("перекриття рахуються ЛИШЕ для folio — родина contents їх не замовляла", () => {
    /*
     * §4.2 і §4.9 — єдині споживачі `overlaps`, і обидва про колонцифру.
     * Прив'язана рамка числа лежить усередині рамки-господаря, тобто
     * перекриває її за побудовою: доти вона давала непорожній перелік, за
     * який ніхто не платив користі.
     *
     * НЕ звуження до «оголошеної родини»: таблиця перекриттів рамки колонцифри
     * містить УСІ рамки сторінки, бо маршрут A будується на перекритті з
     * рамкою основного ланцюжка, а вона оголошеній родині не належить ніколи.
     */
    const anchored = m.contentsNumbers.find((fr) =>
      fr.paragraphs.some((q) => q.literals.includes(8)),
    )!;
    /*
     * `null`, А НЕ `[]`, І РІЗНИЦЯ ТУТ НЕ КОСМЕТИЧНА. Доти рядок змісту
     * віддавав порожній масив — значення, побайтово однакове з виміряним
     * фактом «перевірили й не перекриває нічого». Перевірки не було: таблиця
     * перекриттів під цю родину не будується взагалі.
     */
    expect(anchored.overlaps).toBeNull();
    expect(m.contentsNumbers.every((fr) => fr.overlaps === null)).toBe(true);
    expect(m.contentsTitles.every((fr) => fr.overlaps === null)).toBe(true);
    /* Негативний контроль: у фоліо перекриття лишились, тобто зникли саме
     * зайві, а не всі. */
    expect(m.folioFrames.some((fr) => fr.overlaps !== null && fr.overlaps.length > 0)).toBe(true);
  });

  it("СИМВОЛЬНА РІВНІСТЬ: зсувів рівно стільки ж, скільки літералів — у КОЖНІЙ рамці", () => {
    /*
     * Повернуто з видаленого тесту зсувів (M1 рецензії). Він перевіряв ДВІ
     * речі, і лише перша була інвертованою: зріз `p.text.slice(...)` міряв
     * РЯДКОВУ властивість СИМВОЛЬНОГО зсуву й падав би проти правильного коду.
     * Друга — суто символьна, переживає «–7» Задачі 4 і не потребує жодного
     * переліку символів.
     *
     * ЧОМУ ЦЕ НЕ ДУБЛЬ тесту «зсув літерала СИМВОЛЬНИЙ»: той приписаний до
     * однієї рамки с. 9 і перевіряє ЗНАЧЕННЯ ([0, 2]); цей — інваріант по
     * ВСЬОМУ документу. Розсинхрон масивів дав би запис у позицію
     * `undefined`, тобто мовчазну правку не того символа, — і жоден тест на
     * конкретній рамці його б не побачив.
     */
    const all = [...m.folioFrames, ...m.contentsNumbers, ...m.contentsTitles];
    expect(all.length).toBeGreaterThan(0);
    let withLiterals = 0;
    for (const fr of all) {
      for (const p of fr.paragraphs) {
        expect(p.literalOffsets).toHaveLength(p.literals.length);
        if (p.literals.length > 0) withLiterals += 1;
      }
    }
    /* Негативний контроль: перевірка була б порожньою правдою, якби літералів
     * у фікстурі не було взагалі. */
    expect(withLiterals).toBeGreaterThan(0);
  });

  it("пропуск майстрових рамок родинами contents і headings — ГУЧНИЙ, а не мовчазний", () => {
    /*
     * Рішення §4.1 («майстрова рамка бере участь лише як колонцифра»)
     * правильне, але без цього поля воно мовчазне: видання з шаблонним
     * змістом дало б порожню родину contents — форму, яку читають як «усе
     * чисто».
     *
     * ЧИСЛА ФІКСТУРИ ВИВОДЯТЬСЯ З ЇЇ РОЗКЛАДКИ, а не підігнані. Ліва
     * батьківська застосована до КОЖНОЇ verso-сторінки, тож кожна майстрова
     * рамка на ній дає по одному твердженню на verso-сторінку:
     *
     *   `Zmist Cyfra` — рамка числа змісту, ПОРАМКОВО:            V
     *   `Zagolovok`   — колонтитул (заголовок ПЕРШИМ абзацом):    V
     *   `Zagolovok`   — другий абзац усередині майстрової рамки
     *                   КОЛОНЦИФРИ, тобто ПОАБЗАЦНО:             +V
     *                                                            ---
     *                                                            2V
     *
     * V — кількість verso-сторінок. Задача 4 додала їх до дев'яти
     * (2, 4, 6, 8, x, 12, 14, 16, 18 — див. `VERSO_PAGES`), тобто множник
     * змінився, а розкладка ні: 5 → 9 і 10 → 18. Це ПЕРЕВЕДЕННЯ за
     * розкладкою, а не нова константа під новий вивід.
     *
     * Друга п'ятірка й є та діра, яку рецензія `49faac5` довела виконанням:
     * лічильник дивився на стиль ПЕРШОГО абзаца, тож цей заголовок давав нуль
     * у `declared` і `+1` в `undeclared`, який у відповідь не їде. Одиниця
     * твердження тут «сторінка × абзац» саме тому, що поабзацний і сам збір.
     */
    const byStyle = new Map(m.masterSkipped.declared.map((s) => [s.styleName, s]));
    expect(byStyle.get("Zagolovok")).toEqual({
      styleName: "Zagolovok",
      role: "heading",
      frames: 2 * VERSO_PAGES.length,
    });
    expect(byStyle.get("Zmist Cyfra")).toEqual({
      styleName: "Zmist Cyfra",
      role: "number",
      frames: VERSO_PAGES.length,
    });
    /* Колонцифра НЕ пропускається — інакше поле рахувало б усе підряд. */
    expect(byStyle.has("Kolontsyfra")).toBe(false);
    /*
     * НЕГАТИВНИЙ КОНТРОЛЬ МАЄ БУТИ НЕНУЛЬОВИМ. Рамка стилю `constructor` на
     * лівій батьківській цими параметрами не оголошена, тож дає по одному
     * твердженню на verso-сторінку: «майстрові рамки тут узагалі є, і жодна з
     * них не твоя». Доти тут стояв нуль — тобто число, яке однаково виглядає
     * і при робочому лічильнику, і при вимкненому.
     *
     * Дві зшиті рамки майстрового ланцюжка (стан `folio-master-thread`) сюди
     * НЕ додаються, і це виміряна властивість, а не збіг: вони порожні, тобто
     * не мають абзаців, і вимір відкидає їх ще до визначення ролі.
     */
    expect(m.masterSkipped.undeclared).toBe(VERSO_PAGES.length);
    /* Одне твердження — рівно в одне число: рамка, що внесла пропущений
     * заголовок, у `undeclared` не рахується. Колонтитул і рамка колонцифри
     * з заголовком дають 2V у `declared` і нуль тут; `Zmist Cyfra` додає V. */
    expect(m.masterSkipped.declared.reduce((n, d) => n + d.frames, 0)).toBe(
      3 * VERSO_PAGES.length,
    );
  });

  it("стиль на ім'я `constructor` не валить вимір — ключ шукається як ВЛАСНИЙ", async () => {
    /*
     * ПАСТКА ПРОТОТИПУ, від якої застерігав сусідній рядок коду й яку той-таки
     * код відтворював рядком нижче. Назви стилів — довільні рядки з документа
     * користувача, а `{}["constructor"]` віддає ФУНКЦІЮ замість `undefined`:
     * індекс пропущеної рамки ставав функцією, `masterSkipped.declared[…]` —
     * `undefined`, а `.frames += 1` валив УВЕСЬ вимір `TypeError`.
     *
     * Тому перевірка йде окремим прогоном: у типових параметрах цей стиль не
     * оголошений (він там негативний контроль `undeclared`), а пастка
     * заводиться саме оголошенням.
     */
    const trap = await runJsx<PaginationMeasure>(
      "pagination_measure",
      { ...PARAMS, contentsTitleStyles: ["Zmist Rozdil", "constructor"] },
      { timeoutMs: 180_000 },
    );
    const ctor = trap.masterSkipped.declared.find((d) => d.styleName === "constructor");
    expect(ctor).toEqual({
      styleName: "constructor",
      role: "title",
      frames: VERSO_PAGES.length,
    });
    /* Пастка не з'їла решти обліку: інші стилі порахувались, як і в
     * типовому прогоні. */
    expect(trap.masterSkipped.declared.find((d) => d.styleName === "Zagolovok")!.frames).toBe(
      2 * VERSO_PAGES.length,
    );
    /* І рамка, яка щойно перестала бути «нічиєю», зникла саме з `undeclared`. */
    expect(trap.masterSkipped.undeclared).toBe(0);
  });

  it("стани Фази 7 ВИДНО У ВИМІРІ, а не лише в переліку назв", () => {
    /*
     * ЧОМУ ЦЕЙ ТЕСТ ІСНУЄ ОКРЕМО ВІД `pagination-fixture.test.ts`. Той стежить
     * за НАЗВАМИ станів, і назва — це обіцянка. Стан, названий правильно й
     * побудований неправильно, дає рівно ту саму зелень, що й відсутній: у
     * Задачах 5–9 детектор перевірятиметься на порожньому місці, а тест
     * показуватиме зелене. Тому кожен рядок нижче називає ВЛАСТИВІСТЬ, заради
     * якої стан заведено, і бере її з виміру.
     *
     * Це не гіпотетична обережність: перший прогін цієї фікстури спіймав саме
     * такий дефект. `doc.layers.add` робить новий шар АКТИВНИМ, тож
     * `folio-rotated`, `folio-master-thread` і `folio-three-page-spread` тихо
     * лягли на прихований шар — три стани мали правильні назви й перевіряли
     * четвертий. Перевірка назв цього не бачила.
     */
    const page = (n: string) => m.pages.find((p) => p.name === n)!;

    /* folio-first-page: сусідів по розвороту НЕМА, тобто еталон §4.3 брати
     * нема звідки — це `no-siblings`, а не порівняння з вигаданим числом. */
    expect(page("1").spreadSiblings).toEqual([]);
    expect(ownFolio("1")).toBeDefined();

    /*
     * folio-broken-thread: перекрито ДОКУМЕНТНУ рамку ланцюжка, яка на цій
     * сторінці починається — попередньої немає, наступна на «8». Маркер на
     * recto шукає назад, тобто `no-neighbour-frame`.
     *
     * ПЕРЕНЕСЕНО З «11» НА «7» ЗАДАЧЕЮ 4Б, і причина виміряна: сусід сторінки
     * «11» — «x», єдина нечислова назва в документі, а §4.4 ставить крок 4
     * («назва сусіда не парситься») ПЕРЕД кроком 6. Тобто на «11» ця рамка
     * ніколи не дала б причини, заради якої заведена: оракул зупинявся б
     * раніше, а гілку `no-neighbour-frame` випадково закривав `folio-anchored`
     * на «13» — тобто зовсім інший стан.
     */
    const broken = ownFolio("7").overlaps!.filter((o) => !o.fromMaster);
    expect(broken).toHaveLength(1);
    expect(broken[0]!.previousPage).toBeNull();
    expect(broken[0]!.nextPage).toBe("8");
    /* Число рамки дорівнює сусідові, тобто кроки 1–5 оракула вона проходить, і
     * відмова буде саме на кроці 6. Без цього рядка перенесення могло б
     * повторити ваду «11» в іншому місці. */
    expect(page("7").spreadSiblings).toEqual(["6"]);
    expect(ownFolio("7").paragraphs[0]!.literals).toEqual([6]);

    /* folio-verso: бік ЛІВИЙ, автомаркер перший, ручне число після нього. */
    expect(page("12").side).toBe("LEFT_HAND");
    expect(ownFolio("12").paragraphs[0]!.markers).toContain("auto-page-number");
    expect(ownFolio("12").paragraphs[0]!.literals).toEqual([7]);

    /* folio-anchored: рамка існує ЛИШЕ в обході `allPageItems` —
     * `page.textFrames` прив'язаних не бачить (виміряно: 0 із 1). Те, що
     * вимір її взагалі має, і є перевірка. */
    expect(ownFolio("13")).toBeDefined();
    expect(ownFolio("13").paragraphs[0]!.literals).toEqual([12]);

    /* folio-no-literals: маркер є, цифр НЕМА. Саме на таких рамках
     * `detectFolio` не породжує знахідок ніколи (§4.9). */
    expect(ownFolio("14").paragraphs[0]!.literals).toEqual([]);
    expect(ownFolio("14").paragraphs[0]!.markers).toContain("auto-page-number");

    /* folio-hidden-layer: шар САМОЇ рамки прихований, і рамка при цьому
     * ТОПОЛОГІЧНО unbound (не перекриває нічого). Стан розрізняє два
     * детектори: вердикт має бути `folio-dormant-duplicate`, а не
     * `folio-marker-unbound`. Порожній масив тут — виміряний факт, не «не
     * рахували»: `bounds` у рамки відомі. */
    expect(ownFolio("15").layerVisible).toBe(false);
    expect(ownFolio("15").paragraphs[0]!.markers).toContain("previous-page-number");
    expect(ownFolio("15").bounds).not.toBeNull();
    expect(ownFolio("15").overlaps).toEqual([]);
    /* Негативний контроль до попереднього рядка: прихований шар має бути
     * ВИНЯТКОМ, а не станом усієї фікстури. */
    expect(m.folioFrames.filter((f) => !f.layerVisible)).toHaveLength(1);

    /* folio-rotated: два кути, і другий — позитивний контроль геометрії.
     * Порожня смуга притулена до лівого краю охоплюючого прямокутника рамки
     * під −37°; вона на 16 пт лівіше за прямокутник, порахований по двох
     * діагональних кутах. Непорожній `overlaps` тут можливий ЛИШЕ при
     * правильній геометрії. Рамка під −90° лишається негативним контролем:
     * для неї обидва способи дають те саме. */
    const rotated = m.folioFrames.filter((f) => f.page === "16" && !f.fromMaster);
    /* Компаратор обов'язковий: типове `sort()` порівнює РЯДКИ, і «-37» < «-90». */
    expect(rotated.map((f) => f.rotationAngle).sort((a, b) => a - b)).toEqual([-90, -37]);
    const odd = rotated.find((f) => f.rotationAngle === -37)!;
    expect(odd.overlaps!.length).toBeGreaterThan(0);

    /* folio-master-thread: перекрито МАЙСТРОВУ рамку зшитого ланцюжка, і її
     * попередня лежить на сторінці «A» — тобто на сторінці МАЙСТРА, а не
     * документа. Саме тому маркеру нема на що розв'язатись (Питання 6), і
     * саме тому §4.2 забороняє рахувати таке перекриття приводом для
     * маршруту `thread`. */
    const viaMaster = ownFolio("17").overlaps!.filter((o) => o.fromMaster);
    expect(viaMaster).toHaveLength(1);
    expect(viaMaster[0]!.previousPage).toBe("A");

    /* folio-three-page-spread: сусідів ДВОЄ, тобто «яке число мала б назвати
     * рамка» відповіді не має. Розворот із трьох переїхав на 22|23|24 разом із
     * чотирма сторінками, які Задача 4Б додала ПЕРЕД ним. */
    expect(page("23").spreadSiblings).toEqual(["22", "24"]);
  });

  it("вісім станів Задачі 4Б ВИДНО У ВИМІРІ — кожен своєю властивістю", () => {
    /*
     * ТОЙ САМИЙ ЗАКОН, ЩО В ТЕСТІ ВИЩЕ, І ТА САМА ПРИЧИНА. Назва стану — це
     * обіцянка; перевіряти треба ВЛАСТИВІСТЬ, заради якої стан заведено.
     * Перший прогін фікстури Задачі 4 спіймав саме таку розбіжність
     * (`doc.layers.add` робить шар АКТИВНИМ, і три стани тихо лягли на
     * прихований шар), і перевірка назв її не бачила.
     */
    const page = (n: string) => m.pages.find((p) => p.name === n)!;

    /*
     * folio-verso-correct (с. «8»). ПРАВИЛЬНА verso: ручне число дорівнює
     * сусідові з потрібного боку. Наявна `folio-verso` на «12» несе КРИВЕ
     * число (7 при сусідові 13), і переогляд показав, що вона не розрізняє
     * правильний код від дзеркально хибного: реалізація з переплутаними
     * боками чекала б 11 і видала б ТОЙ САМИЙ `oracle-mismatch`. Ця рамка
     * розрізняє: з правильними боками вона придатна, з переверненими —
     * ні.
     */
    expect(page("8").side).toBe("LEFT_HAND");
    expect(page("8").spreadSiblings).toEqual(["9"]);
    expect(ownFolio("8").paragraphs[0]!.markers).toContain("auto-page-number");
    expect(ownFolio("8").paragraphs[0]!.literals).toEqual([9]);
    /* Автомаркер ПЕРШИЙ, ручне число після нього — саме та дзеркальність, про
     * яку §4.3 каже «обидва боки обов'язкові». Зсув символьний. */
    expect(ownFolio("8").paragraphs[0]!.literalOffsets).toEqual([2]);

    /* folio-locked (с. «4»): `SkipReason: "locked-frame"` — крок 7 §4.4, який
     * доти не мав стану ніде. Число правильне навмисно: інакше рамку відкинув
     * би крок 5 і до кроку 7 вона не дійшла б. */
    expect(ownFolio("4").locked).toBe(true);
    expect(ownFolio("4").paragraphs[0]!.literals).toEqual([5]);
    /* Негативний контроль: заблокованість мусить РОЗРІЗНЯТИ, а не бути
     * константою виміру. */
    expect(ownFolio("3").locked).toBe(false);


    /*
     * folio-marker-unbound (с. «11»): рамка з маркером сусідньої сторінки на
     * ВИДИМОМУ шарі, що перекриває ЛИШЕ МАЙСТРОВИЙ ланцюжок. §4.2 такий
     * ланцюжок не рахує (Питання 6 і 13), тож розв'язати маркер нема на що.
     * Мутант «не відсіювати майстрові» дав би тут `folio-marker-cross-spread`
     * замість `folio-marker-unbound` — тобто стан розрізняє два детектори.
     */
    expect(ownFolio("11").layerVisible).toBe(true);
    expect(ownFolio("11").paragraphs[0]!.markers).toContain("previous-page-number");
    expect(ownFolio("11").paragraphs[0]!.literals).toEqual([]);
    expect(ownFolio("11").overlaps!.length).toBeGreaterThan(0);
    expect(ownFolio("11").overlaps!.every((o) => o.fromMaster)).toBe(true);
    expect(ownFolio("11").overlaps!.some((o) => o.previousPage === "A")).toBe(true);

    /*
     * folio-marker-cross-spread (с. «18»): маркер РОЗВ'ЯЗУЄТЬСЯ, але на
     * сторінку з іншого розвороту. Ланцюжок навмисно перестрибує розворот:
     * попередня рамка на «17», сама рамка на «18», а розворот «18» складає
     * «19».
     */
    const cross = ownFolio("18").overlaps!.filter((o) => !o.fromMaster);
    expect(cross).toHaveLength(1);
    expect(cross[0]!.previousPage).toBe("17");
    expect(cross[0]!.layerVisible).toBe(true);
    expect(page("18").spreadSiblings).toEqual(["19"]);
    expect(ownFolio("18").paragraphs[0]!.markers).toContain("previous-page-number");

    /*
     * folio-both-threads (с. «19»): рамка перекриває ОБИДВА ланцюжки —
     * документний і майстровий. Це та конфігурація, на якій §4.2 вирішує
     * маршрут, і доти її у фікстурі не було жодної (виміряно переоглядом: із
     * 44 записів `overlaps` жоден не мав обох).
     */
    const both = ownFolio("19").overlaps!;
    expect(both.some((o) => o.fromMaster)).toBe(true);
    expect(both.some((o) => !o.fromMaster)).toBe(true);
    /* Документний ланцюжок веде на сусіда розвороту, тобто маршрут `thread`
     * доходить до придатності — на фікстурі цього не робила жодна рамка. */
    expect(both.filter((o) => !o.fromMaster)[0]!.previousPage).toBe("18");
    expect(ownFolio("19").paragraphs[0]!.literals).toEqual([18]);

    /*
     * folio-helper-layer-hidden (с. «21») — ДРУГИЙ рядок таблиці §4.9, якого
     * не мав жоден стан: рамка на ВИДИМОМУ шарі перекриває ланцюжок на
     * ПРИХОВАНОМУ. Вона друкується, а число хибне — протилежно до
     * `folio-dormant-duplicate`, де прихована сама рамка.
     *
     * Сусід у ланцюжку названий правильно (сторінка «20» — саме сусід
     * розвороту), і це навмисно: без перевірки `ThreadLink.layerVisible`
     * маркер розв'язався б у законне число й знахідки не було б узагалі.
     */
    expect(ownFolio("21").layerVisible).toBe(true);
    const hidden = ownFolio("21").overlaps!.filter((o) => !o.fromMaster);
    expect(hidden).toHaveLength(1);
    expect(hidden[0]!.layerVisible).toBe(false);
    expect(hidden[0]!.previousPage).toBe("20");
    expect(page("21").spreadSiblings).toEqual(["20"]);

    /* folio-last-page (с. «25»): друга половина `no-siblings` — остання
     * сторінка фейсинг-документа сама у своєму розвороті. До Задачі 4Б цей
     * рядок §8 був у фікстурі й ЗНИК: сторінка «x» стояла сама, а Задача 4
     * поставила її в пару з «11». */
    expect(page("25").spreadSiblings).toEqual([]);
    expect(ownFolio("25").paragraphs[0]!.literals.length).toBeGreaterThan(0);
    /* Негативний контроль: «остання» — це саме остання за порядком виміру. */
    expect(m.pages[m.pages.length - 1]!.name).toBe("25");
  });

  it("замок ШАРУ виміряно ОКРЕМИМ прапорцем — і він не дублює замок рамки", () => {
    /*
     * ЗАДАЧА 11Б, стан `folio-layer-locked` (с. «2»).
     *
     * Виміряно зондом `scripts/probe-h7-lock.jsx` (Питання 19, стан C): рамка
     * на замкненому шарі має `frame.locked === false`, а заміна символа в ній
     * ПРОХОДИТЬ. Тобто доти вимір цього стану не бачив узагалі — і оракул
     * визнавав таку рамку придатною.
     *
     * ОБИДВА ПРАПОРЦІ НА ОДНІЙ РАМЦІ, І ДЗЕРКАЛЬНО НА ДРУГІЙ: злиття двох
     * замків в одне поле — найімовірніша помилка саме тут, і без пари «замок
     * шару без замка рамки» / «замок рамки без замка шару» вона була б
     * невидима.
     */
    expect(ownFolio("2").layerLocked).toBe(true);
    expect(ownFolio("2").locked).toBe(false);
    /* Число правильне — інакше рамку відкинув би крок 5, і стан перевіряв би
     * не той крок оракула. */
    expect(ownFolio("2").paragraphs[0]!.literals).toEqual([3]);

    /* Дзеркально: `folio-locked` (с. «4») замкнена САМА, шар під нею вільний.
     * Мутант «layerLocked = locked» помер би тут. */
    expect(ownFolio("4").locked).toBe(true);
    expect(ownFolio("4").layerLocked).toBe(false);

    /* І негативний контроль до обох: звичайна рамка не має жодного замка. */
    expect(ownFolio("3").locked).toBe(false);
    expect(ownFolio("3").layerLocked).toBe(false);
  });

  it("оголошений неіснуючий стиль потрапляє в missingStyles, а не гине мовчки", async () => {
    const bad = await runJsx<PaginationMeasure>(
      "pagination_measure",
      { ...PARAMS, folioStyles: ["stylu-z-takoiu-nazvoiu-nemaie"] },
      { timeoutMs: 180_000 },
    );
    expect(bad.missingStyles).toContain("stylu-z-takoiu-nazvoiu-nemaie");
  });
});

/*
 * ОДНОСТОРОННІЙ ДОКУМЕНТ — РЯДОК §8, ЯКИЙ НЕМОЖЛИВО ДОДАТИ ДО ОСНОВНОЇ
 * ФІКСТУРИ.
 *
 * `page.side === "SINGLE_SIDED"` буває рівно тоді, коли
 * `documentPreferences.facingPages === false`, а це перемикач НА ВЕСЬ
 * ДОКУМЕНТ: у фейсинг-документі такої сторінки немає в принципі (виміряно:
 * усі 25 сторінок основної фікстури — `LEFT_HAND`/`RIGHT_HAND`). Без цього
 * документа крок 2 оракула (`skipped: single-sided`) перевірявся б лише
 * рукописним `PageRef` у юніті.
 *
 * ДРУГЕ, ЩО ТУТ ПЕРЕВІРЯЄТЬСЯ, І ВОНО НЕ ДРІБНЕ: Питання 17 виміряло, що
 * зведення майстрових меж до документного розвороту в односторонньому
 * документі мусить бути ТОТОЖНИМ (позиція сторінки 0, позиція майстрової
 * сторінки теж 0 — осі збігаються). Це єдиний стан, який ловить помилку
 * «зводити завжди», протилежну до вже спійманої «не зводити ніколи».
 */
describe("pagination_measure на ОДНОСТОРОННІЙ фікстурі", () => {
  let docName: string;
  let m: PaginationMeasure;

  beforeAll(async () => {
    const made = await runJsx<{ docName: string }>("__fixture_make_pagination_single", {}, {
      timeoutMs: 180_000,
    });
    docName = made.docName;
    await assertFixtureActive(docName);
    m = await runJsx<PaginationMeasure>("pagination_measure", PARAMS, { timeoutMs: 180_000 });
  }, 300_000);

  afterAll(async () => {
    if (docName) await closeFixtureDoc(docName);
  });

  it("бік СТОРІНКИ — SINGLE_SIDED, і сусідів по розвороту немає в жодної", () => {
    expect(m.pages).toHaveLength(3);
    expect(m.pages.every((p) => p.side === "SINGLE_SIDED")).toBe(true);
    expect(m.pages.every((p) => p.spreadSiblings.length === 0)).toBe(true);
    /* Негативний контроль до всієї фікстури: рамка-твердження тут Є, тобто
     * перевірка не є порожньою правдою. */
    expect(m.folioFrames.some((fr) => !fr.fromMaster)).toBe(true);
  });

  it("зведення майстрових меж ТОТОЖНЕ — осі збігаються (Питання 17, стан 3)", () => {
    /*
     * Дві рамки на сторінці «2» мають ОДНАКОВІ зсуви від кута своєї сторінки:
     * одна намальована в документі, друга приходить із батьківської. У
     * фейсинг-документі їхні системи координат розходяться на цілу ширину
     * сторінки там, де позиції в розвороті різні (Питання 17, стани 1 і 2, —
     * це вже стереже тест «межі МАЙСТРОВОЇ рамки зведено…» вище). Тут позиції
     * однакові, тож правильна відповідь — ЗБІГ до сотих.
     *
     * Мутант, який зводить завжди (додає різницю кутів, не перевіривши, що
     * вона нульова), на фейсинг-фікстурі був би невидимий, а тут дасть зсув.
     */
    const own = m.folioFrames.find((fr) => fr.page === "2" && !fr.fromMaster)!;
    const master = m.folioFrames.find((fr) => fr.page === "2" && fr.fromMaster)!;
    expect(own.bounds).not.toBeNull();
    expect(master.bounds).not.toBeNull();
    expect(master.bounds!.x1).toBeCloseTo(own.bounds!.x1, 2);
    expect(master.bounds!.y1).toBeCloseTo(own.bounds!.y1, 2);
    expect(master.bounds!.x2).toBeCloseTo(own.bounds!.x2, 2);
    expect(master.bounds!.y2).toBeCloseTo(own.bounds!.y2, 2);
  });

  it("ручне число тут Є — інакше крок 2 оракула перевіряти було б нічим", () => {
    const own = m.folioFrames.find((fr) => fr.page === "2" && !fr.fromMaster)!;
    expect(own.paragraphs[0]!.literals).toEqual([1]);
    expect(own.paragraphs[0]!.markers).toContain("auto-page-number");
  });
});

/*
 * СЛУЖБОВИЙ ЛАНЦЮЖОК — ТРЕТІЙ `describe`, і документів тут кілька: фікстура
 * ланцюжка будує ОДИН стан на документ. Кожен закривається одразу, у `finally`.
 *
 * Стиль колонцифри в цих документах не оголошений навмисно: `helperChain` —
 * вимір БЕЗУМОВНИЙ, не за родиною, і саме це тут і перевіряється.
 */
describe("pagination_measure бачить службовий ланцюжок", () => {
  async function measureState(state: string): Promise<PaginationMeasure> {
    const made = await runJsx<{ docName: string }>(
      "__fixture_make_helper_chain",
      { state },
      { timeoutMs: 180_000 },
    );
    try {
      return await runJsx<PaginationMeasure>("pagination_measure", PARAMS, { timeoutMs: 180_000 });
    } finally {
      await closeFixtureDoc(made.docName);
    }
  }

  it("на документі БЕЗ шару віддає null, а не порожній ланцюжок", async () => {
    /*
     * ОДНОСТОРОННЯ ФІКСТУРА, А НЕ ОСНОВНА — І ЦЕ ЗНАЙДЕНО ВИКОНАННЯМ, НЕ
     * ЗДОГАДОМ. Перша редакція цього тесту брала `__fixture_make_pagination` і
     * впала: основна фікстура ШАР МАЄ. Його створює Фаза 7 (`_fixtures.jsx`,
     * `doc.layers.add({ name: "_folio-helper", visible: false, printable: false })`)
     * під стани `folio-helper-layer-hidden` і `folio-both-threads`, і ланцюжок
     * там навмисно частковий. Тобто документ БЕЗ шару треба брати інший.
     */
    const made = await runJsx<{ docName: string }>(
      "__fixture_make_pagination_single",
      {},
      { timeoutMs: 180_000 },
    );
    try {
      const m = await runJsx<PaginationMeasure>("pagination_measure", PARAMS, { timeoutMs: 180_000 });
      /* `null`, А НЕ `{frames: []}`: «не будували» ≠ «збудували порожній».
       * Порожня структура дала б стільки знахідок «пропуск», скільки сторінок. */
      expect(m.helperChain).toBeNull();
    } finally {
      await closeFixtureDoc(made.docName);
    }
  });

  it("основна фікстура має ЧАСТКОВИЙ і ПРИХОВАНИЙ ланцюжок — стан Фази 7", async () => {
    /*
     * НЕГАТИВНИЙ КОНТРОЛЬ ДО ПОПЕРЕДНЬОГО ТЕСТУ: без нього «null» не
     * відрізнити від «вимір не працює». Заразом це факт, який визначає, що
     * побачить аудит на основній фікстурі — прихований шар плюс пропуски.
     */
    const made = await runJsx<{ docName: string }>("__fixture_make_pagination", {}, { timeoutMs: 180_000 });
    try {
      const m = await runJsx<PaginationMeasure>("pagination_measure", PARAMS, { timeoutMs: 180_000 });
      expect(m.helperChain).not.toBeNull();
      expect(m.helperChain!.layerVisible).toBe(false);
      expect(m.helperChain!.pagesWithoutFrame.length).toBeGreaterThan(0);
    } finally {
      await closeFixtureDoc(made.docName);
    }
  });

  it("цілий ланцюжок: рамка на кожній сторінці, одна історія, прапорці §4.8", async () => {
    const m = await measureState("helper-chain-complete");
    expect(m.helperChain).not.toBeNull();
    const c = m.helperChain!;
    expect(c.layerName).toBe("_folio-helper");
    expect(c.frames).toHaveLength(6);
    expect(c.pagesWithoutFrame).toEqual([]);
    expect(c.storyIds).toHaveLength(1);
    /* Виміряно (Питання 8 Фази 7): видимий, але непридатний до друку. */
    expect(c.layerVisible).toBe(true);
    expect(c.layerPrintable).toBe(false);
    expect(c.layerLocked).toBe(false);
  });

  it("порядок ланок збігається з порядком сторінок на цілому ланцюжку", async () => {
    const m = await measureState("helper-chain-complete");
    const byOrder = m.helperChain!.frames.slice().sort((a, b) => a.orderInStory - b.orderInStory);
    expect(byOrder.map((f) => f.pageOffset)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("пропуск: сторінка без ланки названа ПОІМЕННО", async () => {
    const m = await measureState("helper-chain-gap");
    const c = m.helperChain!;
    expect(c.frames).toHaveLength(5);
    expect(c.pagesWithoutFrame).toEqual(["4"]);
  });

  it("прихований шар видно у вимірі", async () => {
    const m = await measureState("helper-chain-hidden-layer");
    expect(m.helperChain!.layerVisible).toBe(false);
  });

  it("дублювання сторінки: рамка Є на кожній, а історій ДВІ", async () => {
    /*
     * ВИМІРЯНИЙ СТАН (`H8`, Питання 2), і саме він робить два інші детектори
     * сліпими: `pagesWithoutFrame` порожній, порядок головної історії
     * монотонний — а ланцюжок зламаний.
     */
    const m = await measureState("helper-chain-split");
    const c = m.helperChain!;
    expect(c.pagesWithoutFrame).toEqual([]);
    expect(c.storyIds.length).toBe(2);
    expect(c.frames).toHaveLength(7);
    const counts = new Map<string, number>();
    for (const f of c.frames) counts.set(f.storyId, (counts.get(f.storyId) ?? 0) + 1);
    expect([...counts.values()].sort()).toEqual([1, 6]);
  });

  it("рамка-сирота: page і pageOffset — null, і в pagesWithoutFrame її немає", async () => {
    const m = await measureState("helper-chain-orphan-frame");
    const c = m.helperChain!;
    const orphans = c.frames.filter((f) => f.page === null);
    expect(orphans).toHaveLength(1);
    expect(orphans[0]!.pageOffset).toBeNull();
    expect(c.pagesWithoutFrame).toEqual([]);
  });

  it("перетасований ланцюжок: порядок ланок НЕ збігається з порядком сторінок", async () => {
    const m = await measureState("helper-chain-unordered");
    const byOrder = m.helperChain!.frames.slice().sort((a, b) => a.orderInStory - b.orderInStory);
    const offsets = byOrder.map((f) => f.pageOffset);
    expect(offsets).not.toEqual([0, 1, 2, 3, 4, 5]);
    /* Множина сторінок при цьому та сама — переставлено, не загублено. */
    expect(offsets.slice().sort((a, b) => a! - b!)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

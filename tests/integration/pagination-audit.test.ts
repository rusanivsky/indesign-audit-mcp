import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runJsx } from "../../src/bridge/runner.js";
import { detectFolio } from "../../src/pagination/folio.js";
import { detectHelperChain } from "../../src/pagination/helper-chain.js";
import {
  detectContents,
  flattenFrames,
  pairByBaseline,
} from "../../src/pagination/contents.js";
import { buildReport, type PaginationReport } from "../../src/pagination/report.js";
import type { PaginationDefect, PaginationMeasure } from "../../src/pagination/types.js";
import { assertFixtureActive, closeFixtureDoc } from "./fixture-doc.js";

const LEVELS = [{ contentsStyle: "Zmist Rozdil", headingStyles: ["Zagolovok"] }];

/**
 * Майстрових ТВЕРДЖЕНЬ на кожну verso-сторінку — три, і кожне має ім'я:
 * ліва батьківська колонцифра, лист майстрової ГРУПИ поза сторінками й
 * ДРУГИЙ такий лист, з маркером (Задача 4Б). На recto — одне: права
 * батьківська колонцифра.
 *
 * Множники винесені в іменовані сталі, бо доти `checked` і `notCompared`
 * лишались ЛІТЕРАЛАМИ там, де сусідній файл того самого коміту вже перейшов
 * на формули (знахідка М-1 переогляду `61134b5`). Виведення в коментарі
 * нижче було правильне, але наступна зміна складу фікстури зробила б його
 * хибним МОВЧКИ — рівно та відмова, від якої `pagination-measure.test.ts`
 * щойно вилікували.
 */
const MASTER_CLAIMS_PER_VERSO = 3;
const MASTER_CLAIMS_PER_RECTO = 1;

describe("pagination_audit наскрізно на фікстурі", () => {
  let docName: string;
  let report: PaginationReport;
  /** Кількість сторінок кожного боку — з ВИМІРУ, а не з переписаної таблиці. */
  let verso = 0;
  let recto = 0;

  beforeAll(async () => {
    const made = await runJsx<{ docName: string }>("__fixture_make_pagination", {}, {
      timeoutMs: 180_000,
    });
    docName = made.docName;
    await assertFixtureActive(docName);

    const m = await runJsx<PaginationMeasure>(
      "pagination_measure",
      {
        folioStyles: ["Kolontsyfra"],
        contentsNumberStyle: "Zmist Cyfra",
        contentsTitleStyles: ["Zmist Rozdil"],
        headingStyles: ["Zagolovok"],
      },
      { timeoutMs: 180_000 },
    );

    verso = m.pages.filter((p) => p.side === "LEFT_HAND").length;
    recto = m.pages.filter((p) => p.side === "RIGHT_HAND").length;

    const titles = flattenFrames(m.contentsTitles, m.pages);
    const numbers = flattenFrames(m.contentsNumbers, m.pages);
    const paired = pairByBaseline(titles, numbers);
    const detected = detectContents(
      paired.pairs,
      m.headings,
      LEVELS,
      m.contentsNumbers.filter((f) => f.rotationAngle !== 0),
    );

    /*
     * ЧЕТВЕРТИЙ ДЕТЕКТОР ВЛИВАЄТЬСЯ ТУТ ТАК САМО, ЯК В ІНСТРУМЕНТІ — інакше цей
     * наскрізний тест перевіряв би не те, що бачить оператор.
     */
    const folioResult = detectFolio(m.pages, m.folioFrames);
    folioResult.findings.push(...detectHelperChain(m.helperChain));

    report = buildReport({
      docName: m.docName,
      folio: folioResult,
      runningHead: null,
      contents: {
        checked: detected.checked,
        notCompared: detected.notCompared,
        findings: [...paired.findings, ...detected.findings],
      },
      missingStyles: m.missingStyles,
      masterSkipped: m.masterSkipped.declared,
      masterIslands: [],
      detailFamily: null,
    });
  }, 300_000);

  afterAll(async () => {
    if (docName) await closeFixtureDoc(docName);
  });

  /* Звіт тепер зведений за дефектами, тож «які дефекти на цій сторінці»
   * читається з переліку сторінок групи. */
  function defectsOnPage(page: string): PaginationDefect[] {
    return report.folio!.groups.filter((g) => g.pages.includes(page)).map((g) => g.defect);
  }

  /*
   * Дефекти САМОГО ЧИСЛА, без folio-manual: той каже про спосіб набору, а
   * не про помилку, і супроводжує будь-яку рамку з ручним числом.
   *
   * ДРУГЕ ВИКЛЮЧЕННЯ ДОДАЛА ЗАДАЧА 4Б, і воно з тієї самої родини.
   * `folio-marker-unmeasured` не твердить про число НІЧОГО — у нього
   * `claimed: null`, і каже він рівно «не порівнювали». Стан, що його
   * породжує, — лист майстрової ГРУПИ поза майстровими сторінками, тобто ОДИН
   * об'єкт, видимий із КОЖНОЇ verso-сторінки: без цього виключення він
   * потрапляв би в перелік дефектів числа на кожній із них (виміряно: тест
   * «чужий бік на с.6» став червоним саме так), і фільтр читався б як
   * «на цій сторінці два дефекти числа» там, де їх один.
   */
  /*
   * ТРЕТЄ ВИКЛЮЧЕННЯ — ФАЗА 8, і воно того самого роду, що два попередні.
   * Дефекти `folio-helper-chain-*` твердять про ЛАНЦЮЖОК, а не про число в
   * рамці: їхня одиниця — сторінка (пропуск, розпад) і документ (шар). Без
   * цього виключення пропуск ланки читався б як «на цій сторінці дефект
   * числа», а на фікстурі таких сторінок більшість — службовий шар там
   * створений навмисно частковим і прихованим (стан `folio-helper-layer-hidden`
   * Фази 7).
   */
  const CHAIN_DEFECTS: PaginationDefect[] = [
    "folio-helper-chain-gap",
    "folio-helper-chain-unordered",
    "folio-helper-chain-hidden",
    "folio-helper-chain-split",
  ];

  /** Усе, що стосується САМОЇ рамки на сторінці: без тверджень про ланцюжок. */
  function frameDefectsOnPage(page: string): PaginationDefect[] {
    return defectsOnPage(page).filter((d) => !CHAIN_DEFECTS.includes(d));
  }

  function numberDefectsOnPage(page: string): PaginationDefect[] {
    return defectsOnPage(page).filter(
      (d) =>
        d !== "folio-manual" &&
        d !== "folio-marker-unmeasured" &&
        !CHAIN_DEFECTS.includes(d),
    );
  }

  it("НЕГАТИВНИЙ КОНТРОЛЬ: коректна колонцифра на с.3 дефектів ЧИСЛА не дає", () => {
    expect(numberDefectsOnPage("3")).toEqual([]);
    /* Але folio-manual там є, і має бути: ручна половина «2–<авто>»
     * розійдеться з автоматичною при перекомпонуванні. Саме цього
     * інструмент не казав до прогону на робочій книжці. */
    expect(defectsOnPage("3")).toContain("folio-manual");
  });

  it("зсув на с.5 ловиться частиною 1 правила", () => {
    expect(numberDefectsOnPage("5")).toEqual(["folio-stale"]);
  });

  it("чужий бік на с.6 ловиться ЧАСТИНОЮ 2 — частина 1 його пропускає", () => {
    expect(numberDefectsOnPage("6")).toEqual(["folio-duplicates-auto"]);
  });

  it("колонцифра без автомаркера на с.9 — manual, і НЕ duplicates-auto", () => {
    /* `frameDefectsOnPage`, а не `defectsOnPage`: сторінка 9 у цій фікстурі
     * ще й не має ланки службового ланцюжка, і той дефект — про ЛАНЦЮЖОК, а
     * не про цю рамку. */
    expect(frameDefectsOnPage("9")).toEqual(["folio-manual"]);
  });

  it("нечислова назва сторінки дає folio-unparsable і notCompared", () => {
    const unparsable = report.folio!.groups.filter((g) => g.defect === "folio-unparsable");
    expect(unparsable).toHaveLength(1);
    /*
     * ЧОТИРИ, А НЕ ОДНА — і це вже змінений вихід злитого інструмента, а не
     * нова поведінка Фази 7. Третє джерело рамок (§4.1) зробило видимими
     * батьківські колонцифри, а `folio-unparsable` породжується НА РАМКУ:
     * на сторінці з римською назвою їх тепер чотири — намальана, батьківська
     * під нею і ДВА листи майстрової ГРУПИ поза майстровими сторінками (стани
     * `master-group-leaf-outside-pages` і доданий Задачею 4Б
     * `master-group-leaf-with-marker`, обидва заради гілки
     * `parentPage === null`). На книжці той самий механізм підняв
     * `folioFrames` з 91 до 160.
     */
    expect(unparsable[0]!.count).toBe(MASTER_CLAIMS_PER_VERSO + 1);
    expect(report.folio!.notCompared).toBeGreaterThan(0);
  });

  it("батьківські колонцифри РАХУЮТЬСЯ родиною folio — вихід змінився не мовчки", () => {
    /*
     * Задача 3 змінила вихід уже злитого `pagination_audit`, не сказавши про
     * це тестом: `folioFrames` на книжці виросли з 91 до 160, тобто `checked`
     * родини folio зросло на батьківські рамки. Це ПРАВИЛЬНО (з них зроблені
     * 29 сплячих дублів §4.9), але мусить бути видно.
     *
     * Числа фікстури ВИВОДЯТЬСЯ З РОЗКЛАДКИ, а не підганяються. Задача 4Б
     * додала п'ять сторінок і сім намальованих колонцифр, тож розкладка
     * ПРОДОВЖЕНА, а не замінена константою — множники ті самі, змінились
     * лише R (recto), V (verso) і кількість майстрових листів на verso:
     * було 11 і 9, стало 14 і 11; листів групи стало ДВА замість одного.
     *
     *   намальовані колонцифри Фази 6 (с. 3, 5, 6, 9, x)              5
     *   намальовані колонцифри Фази 7:
     *     folio-first-page (с. 1)                                     1
     *     folio-layer-locked (с. 2, Задача 11Б)                       1
     *     folio-locked (с. 4)                                         1
     *     folio-broken-thread (с. 7, перенесено з «11»)               1
     *     folio-verso-correct (с. 8)                                  1
     *     folio-marker-unbound (с. 11)                                1
     *     folio-verso (с. 12, число КРИВЕ)                            1
     *     folio-anchored (с. 13, ПРИВ'ЯЗАНА)                          1
     *     folio-no-literals (с. 14)                                   1
     *     folio-hidden-layer (с. 15)                                  1
     *     folio-rotated (с. 16, ДВІ рамки: −90° і −37°)               2
     *     folio-master-thread (с. 17)                                 1
     *     folio-marker-cross-spread (с. 18)                           1
     *     folio-both-threads (с. 19)                                  1
     *     folio-helper-layer-hidden (с. 21)                           1
     *     folio-three-page-spread (с. 23)                             1
     *     folio-last-page (с. 25)                                     1
     *   права батьківська колонцифра, по одній на кожну recto  R  =  14
     *   ліва батьківська колонцифра, по одній на кожну verso   V  =  11
     *   лист майстрової ГРУПИ поза сторінками, по одній на V   V  =  11
     *   ДРУГИЙ лист групи, з маркером (Задача 4Б), теж на V    V  =  11
     *                                                               ---
     *                                                                69
     *
     * Порожні рамки (чотири ланцюжки, зонд повороту, майстровий ланцюжок)
     * сюди НЕ входять: без абзаців вимір відкидає їх до визначення ролі. Саме
     * тому стани можна було додати, не зрушивши цієї арифметики.
     *
     * На сторінці з римською назвою «x» стоять ЧОТИРИ з них (намальована,
     * батьківська і два листи групи) — вони не перевіряються, а рахуються в
     * `notCompared`. Сторінка «x» лишилась ЄДИНОЮ нечисловою: нові сторінки
     * дістали власну секцію з арабськими числами саме для цього.
     * `checked` = 69 − 4 = 65.
     *
     * НИЖЧЕ — ФОРМУЛА, А НЕ ЛІТЕРАЛ (М-1). R і V беруться з ВИМІРУ, множники
     * названі сталими вгорі файла, а `DRAWN` — це рівно перелік вище. Отже
     * зсув розкладки впаде тут із зрозумілим числом, а не зробить коментар
     * хибним мовчки.
     */
    const DRAWN = 23;
    const onUnparsablePage = MASTER_CLAIMS_PER_VERSO + 1; /* «x» — verso, плюс намальована */
    const total = recto * MASTER_CLAIMS_PER_RECTO + verso * MASTER_CLAIMS_PER_VERSO + DRAWN;

    /* Негативний контроль до самої формули: якби бік не читався, обидва були
     * б нулями, і рівність зійшлася б на порожньому. */
    expect(recto).toBeGreaterThan(0);
    expect(verso).toBeGreaterThan(0);
    expect(recto + verso).toBe(25);

    expect(report.folio!.checked).toBe(total - onUnparsablePage);
    expect(report.folio!.notCompared).toBe(onUnparsablePage);
  });

  it("прихований шар САМОЇ рамки — dormant-duplicate, і НЕ unbound (§4.9)", () => {
    /*
     * ЄДИНЕ МІСЦЕ, ДЕ РОЗДІЛЕННЯ ДВОХ ОДНОЙМЕННИХ `layerVisible` ПЕРЕВІРЯЄТЬСЯ
     * НА СПРАВЖНЬОМУ ДОКУМЕНТІ, а не на зібраному руками `ClaimFrame`.
     *
     * Стан `folio-hidden-layer` (с. 15) відтворює виміряну книжку: рамка з
     * маркером `PREVIOUS_PAGE_NUMBER` лежить на шарі з `visible = false` і не
     * перекриває жодного ланцюжка, тобто ТОПОЛОГІЧНО вона unbound. Вердикт має
     * бути протилежний: рамка не друкується, отже сьогодні не бреше. Без цього
     * розділення перший прогін по книжці дав би 29 хибнопозитивних
     * `folio-marker-unbound` — там три майстрові колонцифри живуть на
     * прихованому шарі `Нумерація` і видимі з 29 сторінок.
     */
    expect(defectsOnPage("15")).toContain("folio-dormant-duplicate");
    expect(defectsOnPage("15")).not.toContain("folio-marker-unbound");
    /*
     * І НЕГАТИВНИЙ КОНТРОЛЬ ДО ЦЬОГО РОЗДІЛЕННЯ: сплячий дубль на фікстурі
     * рівно один, тобто гілка не ковтає всі рамки з маркером. Решта рамок із
     * напрямковим маркером лежать на ВИДИМИХ шарах і дають зовсім інші
     * вердикти — тест нижче.
     */
    const dormantGroups = report.folio!.groups.filter(
      (g) => g.defect === "folio-dormant-duplicate",
    );
    expect(dormantGroups).toHaveLength(1);
    expect(dormantGroups[0]!.pages).toEqual(["15"]);
  });

  it("ОБИДВА «дефекти, що друкуються», спрацьовують на ДОКУМЕНТІ, а не лише в юнітах", () => {
    /*
     * ЦЕ НАЙВАЖЛИВІШЕ, ЩО ДОДАЛА ЗАДАЧА 4Б, І ДО НЕЇ ТУТ СТОЯВ НЕГАТИВНИЙ
     * КОНТРОЛЬ — «жодна рамка не дістала `folio-marker-unbound`».
     *
     * Він був правдивий і водночас руйнівний: `folio-marker-unbound` і
     * `folio-marker-cross-spread` — це ті два детектори, заради яких §2
     * називає фазу без них ШКІДЛИВОЮ (заміна ручного числа маркером робить
     * `pagination_audit` сліпим до цієї рамки назавжди, а розірваний ланцюжок
     * друкує правдоподібне «121–121» без жодного попередження, Питання 10).
     * На фікстурі не спрацьовував ЖОДЕН: маркер сусідньої сторінки мала рівно
     * одна рамка, і та на прихованому шарі, тобто виходила з гри раніше —
     * `folio-dormant-duplicate`. Отже обидва були перевірені лише
     * рукописними `ClaimFrame` у юнітах, а на справжньому документі їх не
     * бачив ніхто.
     *
     * ТРИ РАМКИ НИЖЧЕ — ТРИ РІЗНІ ПРИЧИНИ, а не три копії однієї:
     *
     *   с. «11» — перекрито ЛИШЕ МАЙСТРОВИЙ ланцюжок. §4.2 його не рахує
     *             (Питання 6 і 13), тож розв'язати нема на що. Мутант «не
     *             відсіювати майстрові» дав би тут cross-spread («A»);
     *   с. «21» — перекрито ДОКУМЕНТНИЙ ланцюжок на ПРИХОВАНОМУ шарі. Сусід
     *             у ланцюжку названий ПРАВИЛЬНО, тож без перевірки
     *             `ThreadLink.layerVisible` знахідки не було б узагалі;
     *   с. «18» — маркер РОЗВ'ЯЗУЄТЬСЯ, але на «17», а розворот складає «19».
     */
    expect(defectsOnPage("11")).toContain("folio-marker-unbound");
    expect(defectsOnPage("21")).toContain("folio-marker-unbound");
    expect(defectsOnPage("18")).toContain("folio-marker-cross-spread");

    /* Кожна причина — саме своя, а не обидві разом на одній рамці. */
    expect(defectsOnPage("11")).not.toContain("folio-marker-cross-spread");
    expect(defectsOnPage("21")).not.toContain("folio-marker-cross-spread");
    expect(defectsOnPage("18")).not.toContain("folio-marker-unbound");

    const count = (d: PaginationDefect) =>
      report.folio!.groups.find((g) => g.defect === d)?.count ?? 0;
    expect(count("folio-marker-unbound")).toBe(2);
    expect(count("folio-marker-cross-spread")).toBe(1);

    /*
     * І ОБИДВА В `deviating` — тобто вони не просто породжуються, а
     * потрапляють туди, куди §4.9 їх посилає: рамка друкується вже зараз із
     * хибним числом, на відміну від сплячого дубля.
     */
    const claimed = report.folio!.groups.find(
      (g) => g.defect === "folio-marker-cross-spread",
    )!;
    expect(claimed.pages).toEqual(["18"]);
    expect(report.folio!.deviating).toBeGreaterThanOrEqual(3);
  });

  it("«не міряли» звучить: рамка без меж із маркером дає folio-marker-unmeasured", () => {
    /*
     * Стан `master-group-leaf-with-marker` (Задача 4Б): другий лист майстрової
     * ГРУПИ поза майстровими сторінками — `parentPage === null`, отже
     * `bounds === null` і `overlaps === null` — але з напрямковим маркером.
     *
     * Доти `folio-marker-unmeasured` не породжувався на фікстурі ЖОДНОГО разу
     * (знахідка Y3 переогляду `a1004eb`): рамки з невідомими межами маркера не
     * несли, тож `NON_DEVIATIONS`-членство цього дефекту не бачив жоден прогін
     * на документі. Різниця, яку стан робить видимою: «не порівнювали» проти
     * «перевірили й чисто» — до фікс-раунду 3 обидва віддавали `[]` і були
     * побайтово нерозрізнимі.
     *
     * Показів рівно стільки, скільки verso-сторінок (лист лежить на ЛІВІЙ
     * батьківській) — 11 за розкладкою `pagination-measure.test.ts`.
     */
    const groups = report.folio!.groups.filter((g) => g.defect === "folio-marker-unmeasured");
    expect(groups).toHaveLength(1);
    expect(groups[0]!.count).toBe(verso);
    /* Сторінка «x» серед них: нечислова назва глушила доти всі три детектори
     * §4.9, і фікс-раунд 6Б це зняв. */
    expect(groups[0]!.pages).toContain("x");
  });

  it("ані folio-manual, ані folio-unparsable, ані dormant не роздувають deviating", () => {
    /*
     * `folio-unparsable` додано до виключень цим раундом (M4 рецензії): та
     * сама рамка інакше потрапляла у `notCompared` І в `deviating` одразу, а
     * третє джерело рамок (§4.1) породжує знахідку НА РАМКУ — на сторінці з
     * римською назвою їх дві, тобто `deviating` ріс би від ДЖЕРЕЛА рамок, а
     * не від стану верстки.
     */
    const total = report.folio!.groups.reduce((n, g) => n + g.count, 0);
    const count = (d: PaginationDefect) =>
      report.folio!.groups.find((g) => g.defect === d)?.count ?? 0;
    const manual = count("folio-manual");
    const unparsable = count("folio-unparsable");
    /*
     * ТРЕТЄ ВИКЛЮЧЕННЯ ДОДАНО ФАЗОЮ 7, і воно не косметичне. Виміряно цим
     * самим прогоном: до нього рівність трималася на двох доданках, а з
     * появою сплячого дубля дала 7 проти 8 — тобто нова знахідка справді
     * потрапила у `findings` і справді НЕ потрапила в `deviating`. Той самий
     * клас, що `folio-manual`: рамка на прихованому шарі не друкується, число
     * зламається лише тоді, коли шар увімкнуть.
     */
    const dormant = count("folio-dormant-duplicate");
    /*
     * П'ЯТИЙ ДОДАНОК — ПАСТКА Y2, І ВІН ДОПИСАНИЙ САМЕ ЗАРАЗ, А НЕ ПІЗНІШЕ.
     *
     * `NON_DEVIATIONS` має п'ять елементів (`src/pagination/report.ts`), а ця
     * рівність доти віднімала чотири. Зелено було тому, що п'ятий,
     * `folio-marker-unmeasured`, на фікстурі не породжувався ЖОДНОГО разу:
     * рамка потрапляє в цю гілку лише з `overlaps === null` І напрямковим
     * маркером, а рамки з невідомими межами (лист майстрової групи поза
     * сторінками) маркера не несли.
     *
     * Задача 8 свідомо лишила доданок недописаним і пояснила чому: на той день
     * це був no-op, який неможливо довести виконанням, а задача-сторож
     * публічного контракту — останнє місце, де доречно мовчки правити чужий
     * інтеграційний тест. Задача 4Б — та сама задача, що додає стан, який його
     * породить (другий лист майстрової групи, з маркером), тож доданок стоїть
     * ПЕРШИМ КРОКОМ і окремим комітом, поки рівність іще зелена: інакше вона
     * впала б разом із новими станами й читалася б як їхня регресія.
     *
     * НА КОМІТІ, ЯКИЙ ЙОГО ДОПИСАВ, `unmeasured` ДОРІВНЮВАВ НУЛЮ — і це було
     * ВИМІРЯНО прогоном (тимчасова заміна на `toBe(0)`, `13 passed`), а не
     * припущено. Стан, який його породжує, додано наступним комітом тієї
     * самої задачі, і тепер доданок ненульовий: рівність доводиться
     * виконанням, а не обіцянкою.
     */
    const unmeasured = count("folio-marker-unmeasured");
    expect(manual).toBeGreaterThan(0);
    expect(unparsable).toBe(MASTER_CLAIMS_PER_VERSO + 1);
    expect(dormant).toBe(1);
    expect(unmeasured).toBeGreaterThan(0);
    expect(report.folio!.deviating).toBe(total - manual - unparsable - dormant - unmeasured);
  });

  it("повернена рамка чисел дає власну знахідку", () => {
    expect(report.contents!.groups.map((g) => g.defect)).toContain("contents-rotated-frame");
  });

  it("число на іншому розвороті пари не дає — це знахідка, не тиша", () => {
    expect(report.contents!.groups.map((g) => g.defect)).toContain("contents-cross-spread");
  });

  it("дві назви в допуску одного числа дають ambiguous", () => {
    expect(report.contents!.groups.map((g) => g.defect)).toContain("contents-ambiguous");
  });

  it("лічильники присутні — нуль знахідок відрізняється від «не міряли»", () => {
    expect(report.folio).not.toBeNull();
    expect(typeof report.folio!.checked).toBe("number");
    expect(typeof report.contents!.notCompared).toBe("number");
  });

  it("обсяг відповіді не росте непомітно", () => {
    /*
     * Поріг — 2× від ВИМІРЯНОГО розміру на цій фікстурі, а не кругле число
     * «із запасом». Фаза 5 двічі за одну фазу поставила поріг стелею
     * (64 000 Б проти реальних 6 750), і такий тест проходив однаково із
     * захистом і без нього, тобто не захищав нічого.
     *
     * Виміряно 2026-08-08 цим самим тестом: **6 607 Б** (було 6 602 до
     * Задачі 11Б, яка додала стан `folio-layer-locked`: +5 Б, бо нова рамка
     * дефекту не породжує — вона лише зайвий раз пройшла лічильники). Поріг —
     * 7 700 Б, тобто 1,17× від виміряного. Поріг НЕ піднято під нове число навмисно:
     * підняти його — означає щоразу підтверджувати те зростання, яке тест і
     * мусить помітити. Запас справді став тісним (був 1,72× при 4 489 Б), і
     * це названо вголос: наступна задача, яка додасть ще одну групу дефектів,
     * ОБОВ'ЯЗКОВА пояснити зростання, а не підняти число мовчки.
     *
     * Історія числа: 2 897 → 3 968 (folio-manual почав спрацьовувати й на
     * змішаних рамках) → 3 644 (однакові знахідки зведено в один рядок) →
     * 3 857 (Задача 4 додала десять сторінок і десять колонцифр) → 4 461
     * (Задача 6: група `folio-dormant-duplicate` з власним `example`, тобто
     * повним текстом пояснення) → 4 489 (Задача 6Б: +28 Б на переписаний
     * `detail` того самого сплячого дубля — доти він СТВЕРДЖУВАВ «стане дві
     * колонцифри», не перевіривши, чи є на сторінці друга, видима; на цій
     * фікстурі це неправда) → 6 602 (Задача 4Б) → 6 607 (Задача 11Б).
     * На реальній книжці те саме
     * зведення дало 33 437 → 733 Б, у 46 разів.
     *
     * +2 113 Б Задачі 4Б — це ТРИ НОВІ ГРУПИ, а не нові записи на кожну
     * рамку: `folio-marker-unbound`, `folio-marker-cross-spread` і
     * `folio-marker-unmeasured`, кожна з власним `example`, тобто повним
     * текстом пояснення. Найдорожча — третя: 11 показів одного майстрового
     * листа звелися в ОДИН рядок з переліком сторінок, і саме це і є доказ,
     * що зведення працює: без нього вона везла б 11 записів.
     *
     * Число в цьому коментарі спершу було написане ДО виміру («6 049»), і
     * це та сама помилка, від якої застерігає правило: поріг, узятий зі
     * стелі, не захищає нічого. Виправлено після прогону.
     *
     * ФАЗА 8: 6 607 → 8 112 Б, і поріг піднято з 7 700 до 9 000 — СВІДОМО,
     * з виміру, як вимагає §6 спека Фази 7 («наступна група дефектів у нього
     * не вміститься, і поріг НЕ піднімати мовчки»).
     *
     * +1 505 Б — це знову ГРУПИ, а не записи на кожну сторінку: на цій
     * фікстурі службовий шар створений навмисно ЧАСТКОВИМ і ПРИХОВАНИМ (стан
     * `folio-helper-layer-hidden` Фази 7), тож четвертий детектор дає
     * `folio-helper-chain-hidden` (одна знахідка на документ) і
     * `folio-helper-chain-gap` на більшості з 25 сторінок — а звіт везе дві
     * групи з переліком сторінок до стелі `MAX_GROUP_PAGES`.
     *
     * ПОРІГ ЛИШАЄТЬСЯ ТІСНИМ (1,11×), А НЕ «×2 ІЗ ЗАПАСОМ», і це розбіжність
     * зі спеком Фази 8 §6, яку тут названо вголос. Правило Фази 5 про «≈2× від
     * виміряного» народилось там, де поріг був СТЕЛЕЮ без виміру й тест
     * проходив однаково із захистом і без нього. Тут навпаки: 7 700 при 6 607
     * — тісний поріг, який щойно спрацював і змусив ухвалити рішення. Підняти
     * його до 16 000 означало б зробити сторожа вакуумним рівно тим способом,
     * від якого Фаза 5 застерігала.
     */
    const size = JSON.stringify(report).length;
    console.log(`  обсяг відповіді на фікстурі: ${size} Б`);
    expect(size).toBeLessThan(9_000);
  });
});

/*
 * ЧЕТВЕРТИЙ ДЕТЕКТОР НАСКРІЗНО — окремий `describe`, бо фікстура ланцюжка
 * будує ОДИН стан на документ (спек Фази 8, §8.2). Документ закривається
 * одразу після кожного стану.
 */
describe("цілісність службового ланцюжка наскрізно", () => {
  async function reportFor(state: string): Promise<PaginationReport> {
    const made = await runJsx<{ docName: string }>(
      "__fixture_make_helper_chain",
      { state },
      { timeoutMs: 180_000 },
    );
    try {
      const m = await runJsx<PaginationMeasure>(
        "pagination_measure",
        {
          folioStyles: ["Kolontsyfra"],
          contentsNumberStyle: null,
          contentsTitleStyles: [],
          headingStyles: [],
        },
        { timeoutMs: 180_000 },
      );
      const folio = detectFolio(m.pages, m.folioFrames);
      folio.findings.push(...detectHelperChain(m.helperChain));
      return buildReport({
        docName: m.docName,
        folio,
        contents: null,
      runningHead: null,
        missingStyles: m.missingStyles,
        masterSkipped: m.masterSkipped.declared,
        masterIslands: [],
      detailFamily: null,
      });
    } finally {
      await closeFixtureDoc(made.docName);
    }
  }

  function defects(r: PaginationReport): PaginationDefect[] {
    return r.folio!.groups.map((g) => g.defect).sort();
  }

  it("НЕГАТИВНИЙ КОНТРОЛЬ: цілий ланцюжок не дає жодної знахідки родини", async () => {
    const r = await reportFor("helper-chain-complete");
    expect(defects(r)).toEqual([]);
    expect(r.folio!.deviating).toBe(0);
  });

  it("пропуск ланки доповідається ПОІМЕННО і рахується в deviating", async () => {
    const r = await reportFor("helper-chain-gap");
    expect(defects(r)).toEqual(["folio-helper-chain-gap"]);
    const g = r.folio!.groups.find((x) => x.defect === "folio-helper-chain-gap")!;
    expect(g.count).toBe(1);
    expect(g.pages).toEqual(["4"]);
    expect(r.folio!.deviating).toBe(1);
  });

  it("прихований шар — ОДНА знахідка на документ, і рамкових лічильників не чіпає", async () => {
    const r = await reportFor("helper-chain-hidden-layer");
    expect(defects(r)).toEqual(["folio-helper-chain-hidden"]);
    /*
     * ОДИНИЦЯ ДЕФЕКТУ — ДОКУМЕНТ, І САМЕ ЦЕ ТУТ ДОВОДИТЬСЯ. Шість колонцифр
     * фікстури дають шість ТВЕРДЖЕНЬ про число, і всі шість перевірено та
     * визнано чистими; знахідка про шар при цьому одна й у `deviating`.
     * Тобто вона рахується як розбіжність, але не як сьоме твердження.
     *
     * Перша редакція чекала тут `checked: 0` — і це було правильно лише доти,
     * доки фікстура ланцюжка не мала колонцифр узагалі. Їх довелось додати,
     * бо без оголошеного стилю інструмент відмовляється гучно.
     */
    expect(r.folio!.checked).toBe(6);
    expect(r.folio!.notCompared).toBe(0);
    expect(r.folio!.deviating).toBe(1);
  });

  it("ДУБЛЮВАННЯ СТОРІНКИ ловиться, хоч рамка є на кожній і порядок монотонний", async () => {
    /*
     * Головний тест фази. Виміряно (`H8`, Питання 2): після `page.duplicate()`
     * `pagesWithoutFrame` порожній і порядок головної історії не спадає, тобто
     * два інші детектори мовчать — а числа вже з'їхали. До Фази 8 цей стан не
     * бачив ніхто.
     */
    const r = await reportFor("helper-chain-split");
    expect(defects(r)).toEqual(["folio-helper-chain-split"]);
    expect(r.folio!.deviating).toBe(1);
  });

  it("перетасована ланка ловиться", async () => {
    const r = await reportFor("helper-chain-unordered");
    expect(defects(r)).toContain("folio-helper-chain-unordered");
  });

  it("рамка-сирота сама по собі дефекту НЕ дає — її прибирає ремонт", async () => {
    /* Сирота не бреше про число: вона поза сторінками, тож маркер на неї не
     * розв'язується. Дефектом було б назвати її дефектом ЧИСЛА. Але вона
     * лежить в окремій історії, отже ланцюжок таки розпався — і саме це
     * звучить. */
    const r = await reportFor("helper-chain-orphan-frame");
    expect(defects(r)).not.toContain("folio-helper-chain-gap");
    expect(defects(r)).not.toContain("folio-helper-chain-unordered");
  });
});

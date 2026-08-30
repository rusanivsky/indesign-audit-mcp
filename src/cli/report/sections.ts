import { bi, joinBi, same, type Bi } from "./i18n.js";
import type { Measurements, PassResult } from "../run/execute.js";
/*
 * Форма відповіді `indesign_status` УЖЕ описана типом — `StatusShape` у
 * сеансовому шарі, який цією ж відповіддю будує `stamp` (`src/jsx/inspect.jsx`
 * → `session.ts`). Другого опису тієї самої форми тут не заводиться: саме
 * такі ручні дзеркала в цьому файлі й давали вигадані назви полів (див.
 * коментар при `АДАПТЕРИ`). Імпорт лише типовий, тож у зібраний код нічого
 * не додає й циклу не створює.
 */
import type { StatusShape } from "../run/session.js";
import type { ExtrasMeasure } from "../measure/extras.js";
import { countSequenceProblems, summariseExtras, ВОЛОСЯНА_PT } from "../measure/extras.js";
import type { BibliographyReport } from "../../bibliography/report.js";
import type { ColorReport } from "../../color/report.js";
import type { GeometryReport } from "../../geometry/report.js";
import type { MasterIslandCandidate } from "../../pagination/master-island.js";
import type { FamilyReport, PaginationReport } from "../../pagination/report.js";
import type { PreflightReport } from "../../preflight/types.js";
import type { SpellingReport } from "../../spelling/types.js";
import type { StyleFinding } from "../../styles/types.js";
import type { RuleGroup } from "../../typography/engine.js";

export interface Sections {
  /**
   * `params` — назва інструмента (стоїть у дужках при назві проходу);
   * `paramLines` — «параметри, якими міряв» (спек §8), по рядку на КЛАС
   * походження, кожен окремим блоком у картці (див. `describeParams`).
   */
  clean: Array<{ what: Bi; measured: Bi; params: Bi; paramLines: Bi[] }>;
  notSeen: Array<{ source: Bi; detail: Bi }>;
  needsEyes: Array<{ topic: Bi; detail: Bi }>;
}

/**
 * Межі, яких скрипт не долає в принципі (спек §2). Вони НЕ виводяться з
 * даних прогону — вони властивість приладу, тож друкуються завжди.
 */
const ЗАВЖДИ_НЕ_БАЧИЛИ: ReadonlyArray<{ source: Bi; detail: Bi }> = [
  {
    source: bi("межа приладу", "instrument limit"),
    detail: bi(
      "Смислові звірки: чи відповідає анотація складу видання — це читання, не вимір.",
      "Semantic checks: whether the blurb matches the contents of the edition — that is reading, not measurement.",
    ),
  },
  {
    source: bi("межа приладу", "instrument limit"),
    detail: bi(
      "Тріаж слів: невідомі слова віддано списком; які з них помилки — вирішує людина.",
      "Word triage: unknown words are handed over as a list; which of them are errors is for a human to decide.",
    ),
  },
  {
    source: bi("межа приладу", "instrument limit"),
    detail: bi(
      "Нові правила: правило верстки виводить із документа людина; скрипт лише стереже вже назване.",
      "New rules: a layout rule is derived from the document by a human; the script only guards what has already been named.",
    ),
  },
  {
    source: bi("межа приладу", "instrument limit"),
    detail: bi(
      "Візуальний огляд: половина справжніх знахідок видно лише на експортованому розвороті.",
      "Visual review: half of the real findings are visible only on an exported spread.",
    ),
  },
  {
    source: bi("межа приладу", "instrument limit"),
    detail: bi(
      "Покриття фарби всередині розміщеної графіки: видно колірний простір лінка, не фарбу в пікселі.",
      "Ink coverage inside placed artwork: the link's colour space is visible, not the ink in a pixel.",
    ),
  },
  /*
   * I5 / рулінг R42: КОНТРОЛЬНЕ ЧИСЛО, ЯКОГО НЕ МІРЯЄ ЖОДЕН ПРОХІД, — це
   * прогалина СПРОМОЖНОСТІ, і вона відрізняється від родини, оголошеної
   * `notApplicable` (там людина сказала «не треба»; тут інструмента просто
   * немає). Друкарня мусить бачити її так само чітко, як і вимкнене
   * правило профілю — інакше «н/д» у шапці лишається загадкою.
   *
   * Обидва рядки виміряні, а не припущені:
   *   - `color.tacSurvey` — це РОЗКЛАДКА за відрами `{upTo, count}`
   *     (`src/color/detect/tac.ts`), скалярного максимуму немає ніде;
   *   - `doc_overview.links` — масив `{name, status}` без лічильника
   *     NORMAL, а `src/geometry/image.ts:113-133` статус `LINK_OK`
   *     свідомо пропускає.
   * Самі виміри тут НЕ будуються — це окрема робота з власною ціною.
   */
  {
    source: bi("прогалина спроможності", "capability gap"),
    detail: bi(
      "Максимальне покриття фарби (одне число, напр. 240 %) не міряє ЖОДЕН прохід: color_audit " +
        "віддає розкладку за відрами (tacSurvey {upTo, count}), а не максимум. Щоб число з'явилось, " +
        "треба навчити вимір кольору повертати скалярний максимум разом із адресою місця, де він досягнутий. " +
        "Тому в шапці стоїть «н/д», а не нуль.",
      "Maximum ink coverage (a single number, e.g. 240 %) is measured by NO pass: color_audit " +
        "returns a distribution by buckets (tacSurvey {upTo, count}), not a maximum. For the number to appear, " +
        "the colour measurement must be taught to return a scalar maximum together with the address of the place where it is reached. " +
        "That is why the header carries “n/a” rather than a zero.",
    ),
  },
  {
    source: bi("прогалина спроможності", "capability gap"),
    detail: bi(
      "Скільки лінків у нормі (напр. 6/6) не міряє ЖОДЕН прохід: doc_overview віддає перелік " +
        "{name, status} без лічильника NORMAL, а geometry_audit статус LINK_OK свідомо пропускає " +
        "(src/geometry/image.ts:113-133). Щоб число з'явилось, треба лічильник станів лінків у " +
        "самому обході — окрема робота, у цьому прогоні не зроблена.",
      "How many links are in order (e.g. 6/6) is measured by NO pass: doc_overview returns a list of " +
        "{name, status} without a NORMAL counter, and geometry_audit deliberately skips the LINK_OK status " +
        "(src/geometry/image.ts:113-133). For the number to appear, a counter of link states is needed in " +
        "the walk itself — separate work, not done in this run.",
    ),
  },
];

/*
 * ============================================================================
 * СПРАВЖНІ ФОРМИ ВІДПОВІДІ КОЖНОГО ІНСТРУМЕНТА (рецензія задачі 11, Critical).
 *
 * `PassResult.data` — НЕ внутрішній тип `report.ts` кожного домену: це
 * `JSON.parse(text)` там, де `text` — серіалізований аргумент `ok(data)`
 * (`src/tools/shared.ts:56`, `src/cli/collect.ts:91-103`). Для чотирьох
 * інструментів `data`, який передається в `ok()`, ЗБІГАЄТЬСЯ з експортованим
 * типом `report.ts`/`types.ts` (перевірено читанням кожного виклику):
 *
 *   - color_audit:        ok(buildReport(...))        → ColorReport      (src/tools/color.ts:240)
 *   - geometry_audit:      ok(report)                   → GeometryReport   (src/tools/geometry.ts:155)
 *   - preflight_document:  ok({...report, elapsedMs})   → PreflightReport & {elapsedMs} (src/tools/preflight.ts:84)
 *   - pagination_audit:    ok(buildReport({...}))       → PaginationReport (src/tools/pagination.ts:784-803)
 *
 * Для решти — НІ. Попередня редакція цього файлу читала спільну вигадану
 * назву `data.findings` і для `pagination`/`styles`/`bibliography`/`spelling`
 * такого поля просто немає — розбіжність була ТИХОЮ: `pagination` типово
 * критична (`src/cli/run/plan.ts` КРИТИЧНІ), і `hasCritical` НІКОЛИ не
 * спрацьовував на розбіжності колонцифри чи змісту.
 *
 * Ключ адаптера — `p.tool`, НЕ `p.id`: до задачі C "pagination" і
 * "sequences" були різними `id` того самого інструмента `pagination_audit`
 * з тією самою формою відповіді — звідси й це правило. Задача C (R25)
 * перевела `sequences` на `__cli_extras`, де той самий принцип тримає
 * "extras" і "sequences": обидві — id того самого `__cli_extras`, і
 * `АДАПТЕРИ["__cli_extras"]` нижче читає ту саму форму `ExtrasMeasure` для
 * будь-якого з двох `id` — приклад змінився, правило лишилось те саме.
 * ============================================================================
 */

/** `color_audit` повертає `ColorReport` НАПРЯМУ. */
type ColorAuditResponse = ColorReport;

/** `geometry_audit` повертає `GeometryReport` НАПРЯМУ. */
type GeometryAuditResponse = GeometryReport;

/** `preflight_document` повертає `PreflightReport` + `elapsedMs`. */
type PreflightAuditResponse = PreflightReport & { elapsedMs: number };

/** `pagination_audit` повертає `PaginationReport` НАПРЯМУ (без обгортки). */
type PaginationAuditResponse = PaginationReport;

/**
 * `styles_audit` — НЕ `StyleReport` (`src/styles/report.ts:81-91`, там
 * `overrideFindings`/`rows`, і саме цю форму вигадав план задачі 11).
 * Справжня форма — окремий об'єкт-літерал без експортованого типу
 * (`src/tools/styles.ts:604-668`, прочитано напряму):
 *
 *  - `findings: StyleFinding[]` — top-level поле дійсно існує, але воно
 *    ВУЖЧЕ за `overrideFindings`: ловить лише `style-unused-*`,
 *    `styles-indistinguishable`, `based-on-missing`, `character-style-unused`
 *    (`src/tools/styles.ts:369-388`). Основна маса перевизначень —
 *    подеталь у `totals`, а НЕ в `findings`.
 *  - `totals.overridePropertyDeviations` / `characterRangesDeviating` /
 *    `scaleParagraphs` — числа (не масиви) сум по родинах overrides/
 *    character/scale (`src/tools/styles.ts:630-667`); `null` означає
 *    «родину не рахували», а не «нуль».
 */
export interface StylesAuditResponse {
  findings: StyleFinding[];
  totals: {
    paragraphs: number;
    overridePropertyDeviations: number | null;
    scaleParagraphs: number | null;
    characterRangesDeviating: number | null;
  };
}

/**
 * `bibliography_audit` = `{docName, standard, numberingGaps} & BibliographyReport`
 * (`src/tools/bibliography.ts:167-179`, `buildReport` розгорнуто оператором
 * `...` у той самий об'єкт). У `BibliographyReport` (`src/bibliography/
 * report.ts:68-76`) немає top-level `findings` узагалі — знахідки лежать
 * ПОРОДИННО в `groups[].total` (`src/bibliography/report.ts:32-45`).
 *
 * `numberingGaps` ДОТИ ТУТ НЕ БУЛО — і це коштувало цілої перевірки. Розриви
 * нумерації рахуються (`src/bibliography/segment.ts:121`), доїжджають до
 * відповіді (`src/tools/bibliography.ts:170`), і в усьому CLI згадувались
 * ЛИШЕ в цьому коментарі. На «Book B» їх виміряно 135: число було,
 * роботи — нуль. Причина суто типова: аліас звужував відповідь до
 * `BibliographyReport`, у якому цього поля немає, тож компілятор про втрату
 * мовчав.
 */
type BibliographyAuditResponse = BibliographyReport & {
  numberingGaps?: Array<{ after: number; next: number }>;
};

/**
 * `spelling_audit` = `{docName, dictionaries, languagesWithoutDictionary,
 * caveat, languages} & SpellingReport` (`src/tools/spelling.ts:296-324`).
 * `SpellingReport` (`src/spelling/types.ts:217-234`) не має поля
 * `unknownWordTypes` — план задачі 11 його вигадав. Справжні поля:
 * `deviating` (реальні дефекти: `language-none` + `word-not-checked`) і
 * `wordTypesTotal` (повне число слово-типів ОБОХ дефектів word-unknown +
 * word-not-checked, до будь-якого обрізання — саме те число, що йде
 * СПИСКОМ, а не знахідками, у «потребує очей»).
 *
 * C1: `languagesWithoutDictionary` — поле САМОГО `ok()`, не `SpellingReport`
 * (`src/tools/spelling.ts:284,305`, `otherFields`). Це прилад, а не
 * документ: мова, для якої словника не знайшли, дає нуль помилок завжди —
 * і саме цю пастку спек §3 називає «тихо інший вимір». Необов'язкове
 * (`?`), бо фікстури, типізовані голим `SpellingReport`, його не несуть.
 */
type SpellingAuditResponse = SpellingReport & { languagesWithoutDictionary?: string[] };

/**
 * `layout_audit` — так само без експортованого типу (об'єкт-літерал
 * `src/tools/map.ts:215-226`). Знахідки НЕ в одному масиві: `masters.
 * findings` — сирий перелік знахідок родини `masters`, а знахідки родини
 * `overrides` тут узагалі не їдуть (лише через `detail` на один стиль) —
 * `totals.overrideFindings` дає їх ЧИСЛО, не масив.
 */
export interface LayoutAuditResponse {
  pages: string[];
  masters: { findings: unknown[] };
  totals: {
    overrideFindings: number;
    masterFindings: number;
    /**
     * C1: скільки груп властивостей звірити НЕ вдалося
     * (`src/tools/map.ts:224`, `overrides.notCompared.length`). Нуль
     * перевизначень при непорожньому лічильнику — це «не звіряли», а не
     * «збігається». ОБОВ'ЯЗКОВЕ: інструмент кладе його в кожну відповідь,
     * і фікстура, яка мовчить про прилад, — це рівно та фікстура, повз яку
     * пройшла ця вада (жодна з трьох у `cli-sections.test.ts` не мала
     * приладових полів узагалі).
     */
    notComparedGroups: number;
    /**
     * §2.2: скільки контейнерів історії й абзаців випало з виміру, бо їм не
     * вдалося призначити сторінку. Той самий клас, що `notComparedGroups`
     * вище: нуль знахідок при ненульовому лічильнику — «не дивились», а не
     * «збігається».
     *
     * Необов'язкові з тієї самої причини, що й решта пізніх поповнень:
     * фікстури `LayoutAuditResponse`, написані раніше, полів не мають.
     */
    unplacedContainers?: number;
    unplacedParagraphs?: number;
  };
}

/**
 * `composition_audit` — об'єкт-літерал `buildReport` у `src/tools/
 * composition.ts:637-891`. Плоского масиву `findings` тут немає взагалі:
 * `findingsTotal` (рядок 890) — ЧИСЛО по ВСІХ знахідках; сам перелік їде
 * лише погруповано за шкалою в `findingsByScale`, до покласового ліміту.
 */
export interface CompositionAuditResponse {
  scope: {
    linesAnalysed: number;
    /**
     * C1: `true` означає, що обхід ЗУПИНИВСЯ на впалому вікні, а форма
     * звіту при цьому лишилась та сама (`src/tools/composition.ts:
     * 1509-1516` — «не має вдавати повний прогін: ознака partial є»,
     * `src/tools/composition.ts:700-708`). Без цього поля частковий прогін
     * і повний друкувались однаково.
     */
    partial: boolean;
    stoppedAt?: string | null;
    stoppedReason?: string | null;
    pagesMeasured?: number;
  };
  findingsTotal: number;
  /**
   * Межі виміру, названі самим інструментом (`collectWarnings`,
   * `src/tools/composition.ts:1144`).
   *
   * §3.2 передачі, ширше за те, що вона назвала. Поле було на відповіді
   * ЗАВЖДИ, а адаптер повертав `notSeen: []` — тобто в звіт не доходило
   * НІЧОГО з цього переліку: ні незадані `forbiddenWords` (дефект
   * `hyphen-forbidden` не спрацьовував жодного разу), ні запасна ширина
   * знака переносу, ні некаліброані стилі, ні звужений діапазон сторінок.
   * Родина `hyphens` віддавала нуль, і нуль читався як «немає».
   *
   * Необов'язкове (`?`): фікстури `CompositionAuditResponse`, написані до
   * цього поповнення, поля не мають, а `npm run typecheck` уже бачить тести.
   */
  warnings?: string[];
}

/**
 * `typography_audit` — об'єкт-літерал `src/tools/typography.ts:231-260`.
 * Знахідки лежать у ДВОХ незалежних місцях: `groups` (зведення `scan.
 * matches` за правилом, `totalMatches` — їхня повна кількість ДО обрізання
 * вибірки) і `auditOnly` (окрема, ПОВНІСТЮ ІНША популяція — сумнівні збіги
 * з `rules-uk.ts`, які не входять у `scan.matches` узагалі). Рецензія
 * задачі 11 (раунд 2): попередня редакція цього файлу не мала адаптера
 * взагалі, і саме через це `quotes-uk`/`space-before-break` (контрольна
 * таблиця §10) зникали зі звіту цілком.
 */
export interface TypographyAuditResponse {
  groups: RuleGroup[];
  totalMatches: number;
  auditOnly: unknown[];
  /**
   * C1: МОВНИЙ ГЕЙТ — прилад, а не документ. Коментар у самому інструменті
   * (`src/tools/typography.ts:236-240`) каже це прямо: «Нуль мусить
   * читатися як нуль, а не як „чисто“: на локалізованій збірці InDesign
   * назва мови не збіжиться, і вся половина правопису 2019 мовчки віддасть
   * порожньо». `ukrainianRuns === 0` — саме той стан.
   */
  spelling2019: { ukrainianRuns: number; skippedByLanguage: number };
  /** Той самий ключ, ІНША популяція — знаменник тут лише збіги взірця «пів». */
  piv2019: { ukrainianRuns: number; skippedByLanguage: number };
}

/**
 * `doc_overview` — `ok(await runJsx("doc_overview", {}))`, тобто СИРИЙ
 * результат `IDMCP.handlers.doc_overview` (`src/jsx/inspect.jsx:32-75`),
 * прочитаний до кінця обробника рядок за рядком. Це ІНВЕНТАР, не аудит:
 * тут НЕМА поняття «знахідка» — і НЕМА полів формату сторінки чи вильоту
 * (`format`/`bleed`/`trim` тощо в обробнику не зустрічаються ЖОДНОГО разу).
 * Тому `count` тут завжди 0 (не «нуль знахідок», а «тут немає знахідок за
 * побудовою») — і числа інвентаря видно через `measured`, а не вигадуються
 * як «формат» чи «виліт», яких обробник не дає.
 *
 * `fonts`/`links` тут — ПЛОСКІ рядки (`"ім'я [статус]"` і
 * `{name, status}` із сирим `String(доменний enum)` відповідно):
 * розкладання на «родини шрифтів» проти «накреслень», чи на «лінки в
 * нормі» проти «лінки з проблемою», обробник НЕ РОБИТЬ — і вигадувати
 * такий розбір тут означало б повторити ту саму помилку, яку лагодить
 * це виправлення. Тому `measured` несе лише сирі лічильники (`fonts.
 * length`, `links.length`), без вигаданого групування.
 */
export interface DocOverviewResponse {
  /**
   * `doc.name` того документа, який обробник СПРАВДІ прочитав
   * (`IDMCP.activeDoc()`, `src/jsx/inspect.jsx:33,68`) — не той, який
   * замовляв викликач. Задача G: діагностика ступеня 2 називає документ
   * саме звідси, бо це єдине місце, де ім'я приходить разом із самим
   * виміром, а не з чужої віри в те, до чого ми приєдналися.
   */
  name: string;
  /**
   * Повний шлях документа, або `null`, якщо його ЩЕ НЕ ЗБЕРЕГЛИ
   * (`src/jsx/inspect.jsx:70`: `doc.saved ? String(doc.fullName) : null`).
   *
   * УВАГА до форми: InDesign віддає його СИРИМ — із провідною тильдою,
   * percent-encoded і в NFD (`%D0%B8%CC%86` — це розкладене «й»). Для
   * порівняння його нормалізує `normalizePathForComparison` (R23); для
   * показу людині — теж, інакше в конфіг лягає нечитний рядок.
   */
  fullName: string | null;
  pageCount: number;
  spreadCount: number;
  paragraphStyles: string[];
  characterStyles: string[];
  fonts: string[];
  links: unknown[];
}

/**
 * Результат адаптера одного проходу: скільки СПРАВЖНІХ знахідок, що міряли,
 * і — головне — ЧИ ПІДТВЕРДИВ ПРИЛАД, ЩО ВЗАГАЛІ МІРЯВ.
 *
 * C1 (фінальна рецензія гілки, Critical, доведено ВИКОНАННЯМ проти
 * зібраного `dist/`): попередня редакція читала в кожного інструмента лише
 * поля ЗНАХІДОК і жодного поля ПРИЛАДУ. `preflight_document` із
 * `shapeRecognised: false` (InDesign віддав форму, якої розбір не впізнав)
 * і `occurrenceCount: 0` друкувався як «Перевірено чисто · увімкнених
 * правил перевірено: 6», `hasCritical` віддавав `false`, і CLI виходив із
 * кодом 0. Той самий стан `src/preflight/summarise.ts` описує власним
 * `caveat`: «Нуль знахідок тут означає „не змогли прочитати“, а не „немає
 * порушень“» — а CLI цей `caveat` викидав повністю.
 *
 * Тому одиниця адаптера тепер ТРИСКЛАДОВА, і третій складник обов'язковий
 * за типом — новий інструмент неможливо додати, «забувши» сказати про його
 * прилад: компілятор вимагатиме поле. Це СТРУКТУРНА гарантія, а не перелік
 * випадків (перелік випадків у цьому проєкті вже провалився тричі — R18,
 * R20, R22).
 */
interface PassExtract {
  count: number;
  measured: Bi;
  /**
   * Чому нуль (або будь-яке число) цього проходу НЕ підтверджений виміром.
   * Порожньо — прилад сам сказав, що прочитав усе, про що його питали.
   *
   * Непорожньо — прохід іде в «Чого перевірка НЕ бачила», а НЕ в
   * «Перевірено чисто», і критична родина в такому стані запалює ворота
   * (`hasCritical`): збій у безпечний бік, як уже вирішено рулінгом R41 в
   * сеансовому шарі.
   */
  unconfirmed: Bi[];
  /**
   * Названі цим прогоном прогалини покриття (спек §8: «необійдені
   * поверхні», «лінки, чия фарба невимірна», вимкнені правила профілю).
   * Друкуються в «Чого перевірка НЕ бачила» ЗАВЖДИ, але самі по собі
   * виміру не скасовують: `geometry_audit`, наприклад, безумовно оголошує
   * межу «майстрові елементи в обхід не входять» — вона правдива й на
   * бездоганному прогоні.
   */
  notSeen: Bi[];
}

/**
 * Дрібний помічник: скорочує довгий перелік, не ховаючи його розміру.
 *
 * Самі елементи — назви стилів, правил, сторінок — мовою не відрізняються;
 * різниться лише слово «показано», тож помічник віддає ОБИДВІ мови.
 */
function перелік(items: readonly string[], стеля = 12): Bi {
  if (items.length <= стеля) return same(items.join(", "));
  const голова = items.slice(0, стеля).join(", ");
  return bi(
    `${голова} … (показано ${стеля} з ${items.length})`,
    `${голова} … (showing ${стеля} of ${items.length})`,
  );
}

/**
 * ЯВНИЙ АДАПТЕР НА КОЖЕН ІНСТРУМЕНТ (рецензія задачі 11, рішення R16-а/б).
 * Кожен запис читає ПОЛЯ, ЯКІ СПРАВДІ Є в даного інструмента (цитати вище),
 * а не вгадану спільну назву. Мапа за `p.tool`.
 */
const АДАПТЕРИ: Record<string, (data: unknown) => PassExtract> = {
  color_audit(data) {
    const d = data as ColorAuditResponse;
    const сайтівПроаналізовано = d.counters.reduce((s, c) => s + c.parsed, 0);
    const unconfirmed: Bi[] = [];
    const notSeen: Bi[] = [];
    /*
     * C1/I1: `unreadSurfaces` будується самим `buildReport` за правилом
     * «seen > 0 при parsed === 0» (`src/color/report.ts:136-141`) — тобто
     * поверхня, яка В ДОКУМЕНТІ Є, а прочитати її не вдалося. Нуль
     * знахідок на такій поверхні означає «не прочитали», а не «чисто»,
     * і це рівно той стан, заради якого поле існує.
     */
    if (d.unreadSurfaces.length > 0) {
      const список = перелік(d.unreadSurfaces);
      unconfirmed.push(
        bi(
          `поверхні, які в документі є, але прочитати їх не вдалося: ${список.uk}. ` +
            "Нуль знахідок на них означає «не прочитали».",
          `surfaces that exist in the document but could not be read: ${список.en}. ` +
            "Zero findings on them means “we did not read them”.",
        ),
      );
    }
    /*
     * I1: спек §8 називає «лінки, чия фарба невимірна» ОКРЕМИМ складником
     * «Чого перевірка НЕ бачила» — цього прогону, поіменно. Рядок
     * ЗАВЖДИ_НЕ_БАЧИЛИ про фарбу всередині графіки — це межа §2 взагалі, а
     * не список цього прогону; підміняти одне одним означало б віддати
     * загальну фразу замість назв файлів.
     */
    if (d.unmeasurableLinks.length > 0) {
      const список = перелік(d.unmeasurableLinks);
      notSeen.push(
        bi(
          `Лінки, чия фарба невимірна (${d.unmeasurableLinks.length}): ${список.uk}. ` +
            "Видно колірний простір лінка, не фарбу в пікселі.",
          `Links whose ink is unmeasurable (${d.unmeasurableLinks.length}): ${список.en}. ` +
            "The link's colour space is visible, not the ink in a pixel.",
        ),
      );
    }
    if (d.findingsTruncated !== undefined) {
      /*
       * НАЗИВАЄМО РОДИНИ ПОІМЕННО. «Показано 60 зі 140» не дає читачеві
       * підстав запідозрити, що якоїсь родини в переліку немає ЗОВСІМ, — а
       * саме так виглядало обрізання доти, доки стеля була спільна.
       */
      const cut = d.findingsTruncated.byFamily ?? [];
      const byFamilyUk = cut.map((c) => `${c.family} ${c.shown} з ${c.total}`).join(", ");
      const byFamilyEn = cut.map((c) => `${c.family} ${c.shown} of ${c.total}`).join(", ");
      notSeen.push(
        bi(
          `Перелік знахідок кольору обрізано стелею: показано ${d.findingsTruncated.shown} з ${d.findingsTruncated.total}` +
            (byFamilyUk ? ` (зрізано по родинах: ${byFamilyUk}).` : "."),
          `The listing of colour findings was truncated by a ceiling: showing ${d.findingsTruncated.shown} of ${d.findingsTruncated.total}` +
            (byFamilyEn ? ` (truncated per family: ${byFamilyEn}).` : "."),
        ),
      );
    }
    /*
     * §3.2 передачі. `caveat` — речення, без якого нуль читається неправильно
     * (`src/color/report.ts:60-68`): межа покриття названа ужитою, а не
     * виведеною з документа; місця, пропущені з трьох різних причин; фарба
     * всередині лінків, не виміряна взагалі; і — головне для §3.2 — «поріг
     * близького промаху не названо, тож родина palette не дає вироку про
     * промах».
     *
     * Інструмент це речення БУДУВАВ, а CLI його не читав ЖОДНОГО разу: поле
     * було на відповіді й ніде більше. Тобто вимкнена перевірка виглядала в
     * звіті як виконана. Сусідня `geometry_audit` читає свій `notMeasured`
     * рівно так само (рядок вище) — тут просто бракувало однієї гілки.
     *
     * Іде в «не бачили», а не в `unconfirmed`: це МЕЖІ виміру, правдиві й на
     * бездоганному прогоні, і скасовувати ними вимір означало б, що родина
     * color не може бути чистою НІКОЛИ.
     */
    if (d.caveat.length > 0) {
      /* `d.caveat` — речення САМОГО інструмента; воно приходить тією мовою,
       * якою інструмент його склав, і перекладати його тут нічим. */
      notSeen.push(
        bi(
          `Межі виміру кольору, названі самим інструментом: ${d.caveat}`,
          `Limits of the colour measurement, named by the tool itself: ${d.caveat}`,
        ),
      );
    }
    return {
      count: d.findingCount,
      measured: bi(
        `сайтів кольору проаналізовано: ${сайтівПроаналізовано}`,
        `colour sites analysed: ${сайтівПроаналізовано}`,
      ),
      unconfirmed,
      notSeen,
    };
  },
  geometry_audit(data) {
    const d = data as GeometryAuditResponse;
    /*
     * `notMeasured`/`caveats` — це МЕЖІ ВИМІРУ, а не збій приладу: перший
     * рядок `notMeasured` безумовний («майстрові елементи в обхід
     * page.allPageItems не входять», `src/geometry/report.ts:222`) і
     * правдивий навіть на бездоганному прогоні. Тому вони йдуть у «не
     * бачили» НАЗВАНИМИ рядками (спек §8, «необійдені поверхні»), але
     * виміру не скасовують — інакше `geometry` не могла б бути чистою
     * НІКОЛИ, і секція «чисто» втратила б сенс.
     */
    /* Рядки приходять від САМОГО geometry_audit — вони вже готові речення
     * інструмента, і другої мови для них не існує ніде. */
    const notSeen: Bi[] = [...d.notMeasured, ...d.caveats].map(same);
    if (d.truncated !== null) {
      notSeen.push(
        bi(
          `Перелік знахідок геометрії обрізано: показано ${d.truncated.shown} з ${d.truncated.total}.`,
          `The listing of geometry findings was truncated: showing ${d.truncated.shown} of ${d.truncated.total}.`,
        ),
      );
    }
    return {
      count: d.findings.length,
      measured: bi(
        `елементів побачено: ${d.measuredWith.itemsSeen}`,
        `elements seen: ${d.measuredWith.itemsSeen}`,
      ),
      unconfirmed: [],
      notSeen,
    };
  },
  preflight_document(data) {
    const d = data as PreflightAuditResponse;
    const unconfirmed: Bi[] = [];
    const notSeen: Bi[] = [];
    /*
     * ЛІЧИЛЬНИКИ ПРИЛАДУ, а не документа (`src/preflight/types.ts`). Саме
     * їх не читав ніхто, і саме через це прогін із `shapeRecognised:
     * false` виходив кодом 0 із написом «перевірено чисто».
     */
    if (!d.shapeRecognised) {
      unconfirmed.push(
        bi(
          "InDesign віддав результат формою, якої розбір не впізнав (shapeRecognised = false): " +
            "нуль знахідок тут означає «не змогли прочитати», а не «немає порушень».",
          "InDesign returned a result in a shape the parser did not recognise (shapeRecognised = false): " +
            "zero findings here means “we could not read it”, not “there are no violations”.",
        ),
      );
    } else if (d.rowsParsed < d.rowsSeen) {
      unconfirmed.push(
        bi(
          `З ${d.rowsSeen} рядків результату розібрано ${d.rowsParsed}: нерозібране у findings НЕ потрапило.`,
          `Of ${d.rowsSeen} result rows, parsed ${d.rowsParsed}: what was not parsed did NOT reach findings.`,
        ),
      );
    }
    if (d.pairsParsed < d.pairsSeen) {
      unconfirmed.push(
        bi(
          `З ${d.pairsSeen} пар «ключ → значення» розібрано ${d.pairsParsed}: описи знахідок неповні.`,
          `Of ${d.pairsSeen} “key → value” pairs, parsed ${d.pairsParsed}: the finding descriptions are incomplete.`,
        ),
      );
    }
    if (d.waitPolarity !== null) {
      unconfirmed.push(
        bi(
          `waitForProcess повернув НЕ булеве (${d.waitPolarity}) — чи дочекався preflight завершення, ` +
            "НЕВІДОМО, тож перелік вважається неповним.",
          `waitForProcess returned a NON-boolean (${d.waitPolarity}) — whether preflight ran to completion is ` +
            "UNKNOWN, so the listing is treated as incomplete.",
        ),
      );
    } else if (d.waitTimedOut) {
      unconfirmed.push(
        bi(
          "preflight НЕ ДОЧЕКАВСЯ завершення (waitTimedOut = true): знахідки поодинці справжні, " +
            "але перелік НЕПОВНИЙ — їх може бути більше.",
          "preflight DID NOT RUN TO COMPLETION (waitTimedOut = true): the findings are individually real, " +
            "but the listing is INCOMPLETE — there may be more of them.",
        ),
      );
    }
    /*
     * `preflightOff` виміру НЕ скасовує, і це вибір, а не недогляд: живий
     * preflight у документі вимкнено оператором, але ЦЕЙ прогін відпрацював
     * на вимогу й прочитав справжній результат. Стан усе одно мусить бути
     * названий — інакше читач вважатиме, що InDesign сам стереже ці ж
     * правила постійно, а він мовчить.
     */
    if (d.preflightOff) {
      notSeen.push(
        bi(
          "Живий preflight у документі ВИМКНЕНО (preflightOff = true): ці числа — з разового " +
            "прогону на вимогу, сам InDesign про ці ж порушення мовчить, доки прапорець не повернуть.",
          "Live preflight in the document is OFF (preflightOff = true): these numbers come from a one-off " +
            "run on demand; InDesign itself stays silent about these same violations until the flag is put back.",
        ),
      );
    }
    if (!d.processRemoved) {
      notSeen.push(
        bi(
          "Процес preflight не прибрано за собою — він лишився в панелі Preflight InDesign.",
          "The preflight process was not cleaned up — it remained in InDesign's Preflight panel.",
        ),
      );
    }
    if (d.disabledRuleIds.length > 0) {
      const список = перелік(d.disabledRuleIds, 40);
      notSeen.push(
        bi(
          `Вимкнені правила профілю «${d.profileName}» (${d.disabledRuleIds.length}): ` +
            `${список.uk}. Нуль порушень їх не стосується.`,
          `Disabled rules of profile “${d.profileName}” (${d.disabledRuleIds.length}): ` +
            `${список.en}. Zero violations does not apply to them.`,
        ),
      );
    }
    /*
     * РУЛІНГ R44. Спек §4.3 вимагає передпольотної перевірки по ВСІХ
     * профілях документа; код проганяє ОДИН — робочий (`plan.ts` кличе
     * `preflight_document` без `profileName`, тобто бере
     * `doc.preflightOptions.preflightWorkingProfile`).
     *
     * Дірка вужча за тривогу спека: роздільність, найдорожче з того, чого
     * `[Basic]` не стереже, фактично покриває `geometry_audit` власним
     * виміром. Але ЗВІТ ПРО ЗВУЖЕННЯ МОВЧАВ — а мовчазне звуження обсягу
     * читається як повний обсяг, і це та сама форма відмови, що R46: тихе
     * «чисто» замість названої межі. Тому звуження друкується завжди, коли
     * профілів більше за один, і називає їх поіменно — щоб читач сам
     * вирішив, чи потрібен йому другий прогін іншим профілем.
     *
     * Прогнати всі профілі поспіль тут НЕ можна одним рядком: кожен profile
     * — окремий прогін preflight на 180 с, і рішення про його ціну належить
     * не звітові. Тому R44 закривається чесною назвою межі, а не тихим
     * розширенням обсягу.
     */
    if (d.availableProfiles.length > 1) {
      const інші = d.availableProfiles.filter((назва) => назва !== d.profileName);
      const список = перелік(інші, 40);
      notSeen.push(
        bi(
          `Preflight прогнано ОДНИМ профілем — «${d.profileName}». У документі є ще ` +
            `${інші.length}: ${список.uk}. Спек §4.3 чекає перевірки по всіх; ` +
            "їхні правила цим прогоном не застосовувались.",
          `Preflight was run with ONE profile — “${d.profileName}”. The document has another ` +
            `${інші.length}: ${список.en}. Spec §4.3 expects a check across all of them; ` +
            "their rules were not applied by this run.",
        ),
      );
    }
    if (d.occurrencesTruncated !== null) {
      notSeen.push(
        bi(
          `Перелік випадків preflight обрізано стелею: показано ${d.occurrencesTruncated.shown} з ${d.occurrencesTruncated.total}.`,
          `The listing of preflight occurrences was truncated by a ceiling: showing ${d.occurrencesTruncated.shown} of ${d.occurrencesTruncated.total}.`,
        ),
      );
    }
    /*
     * `caveat` — речення, яке будує сам інструмент із ЦЬОГО виміру
     * (`src/preflight/summarise.ts:150`), і до C1 воно не доходило до
     * звіту взагалі (`grep caveat src/cli/` давав один влучень — у
     * коментарі). Друкується лише коли вимір не підтверджений: на
     * здоровому прогоні воно повторило б словами те, що вже сказали
     * структурні рядки вище.
     */
    if (unconfirmed.length > 0 && d.caveat.length > 0) {
      unconfirmed.push(
        bi(`Застереження самого інструмента: ${d.caveat}`, `The tool's own caveat: ${d.caveat}`),
      );
    }
    return {
      count: d.occurrenceCount,
      measured: bi(
        `увімкнених правил перевірено: ${d.enabledRuleIds.length}`,
        `enabled rules checked: ${d.enabledRuleIds.length}`,
      ),
      unconfirmed,
      notSeen,
    };
  },
  pagination_audit(data) {
    const d = data as PaginationAuditResponse;
    const родини = [d.folio, d.contents, d.runningHead].filter((f): f is FamilyReport => f !== null);
    const checked = родини.reduce((s, f) => s + f.checked, 0);
    const deviating = родини.reduce((s, f) => s + f.deviating, 0);
    const notCompared = родини.reduce((s, f) => s + f.notCompared, 0);
    const unconfirmed: Bi[] = [];
    const notSeen: Bi[] = [];
    /*
     * `missingStyles` існує саме для того, «щоб порожній звіт не читався
     * як „усе чисто“» (`src/pagination/report.ts:85-93`) — оголошений
     * стиль, якого в документі немає, означає, що родина не перевірила
     * НІЧОГО.
     */
    if (d.missingStyles.length > 0) {
      const список = перелік(d.missingStyles);
      unconfirmed.push(
        bi(
          `Оголошених стилів у документі немає: ${список.uk}. ` +
            "Родина, що спирається на них, не перевірила нічого.",
          `The document contains none of the declared styles: ${список.en}. ` +
            "The family that rests on them checked nothing.",
        ),
      );
    }
    if (notCompared > 0) {
      unconfirmed.push(
        bi(
          `${notCompared} тверджень НЕ звірено (notCompared) — для них порівнювати не було з чим.`,
          `${notCompared} assertions NOT reconciled (notCompared) — there was nothing to compare them against.`,
        ),
      );
    }
    if (родини.length === 0) {
      unconfirmed.push(
        bi(
          "Жодної родини колонцифр/змісту/колонтитулів не виміряно (folio, contents, runningHead — усі null): " +
            "нуль тут означає «не питали».",
          "Not one of the folio/contents/running-head families was measured (folio, contents, runningHead — all null): " +
            "a zero here means “not asked”.",
        ),
      );
    }
    /* Той самий канал, лише не фатальний: рамка оголошеного стилю на
     * батьківській сторінці — законний стан верстки, але мовчати про неї
     * не можна (`src/tools/pagination.ts:789-800`). */
    for (const ms of d.masterSkipped) {
      notSeen.push(
        bi(
          `Рамка оголошеного стилю лежить на батьківській сторінці й родині невидима: ${JSON.stringify(ms)}.`,
          `A frame of a declared style lies on a parent page and is invisible to the family: ${JSON.stringify(ms)}.`,
        ),
      );
    }
    return {
      count: deviating,
      measured: bi(`тверджень перевірено: ${checked}`, `assertions checked: ${checked}`),
      unconfirmed,
      notSeen,
    };
  },
  styles_audit(data) {
    const d = data as StylesAuditResponse;
    /*
     * C1: `null` тут означає «родину НЕ РАХУВАЛИ», а не «нуль» — це
     * написано на 15 рядків вище цього файлу, при самому
     * `StylesAuditResponse`, і водночас порушувалось тут-таки оператором
     * `?? 0`. Твердження й код суперечили одне одному всередині одного
     * файлу: `families: ["usage"]` давав «абзаців проаудитовано: 2980,
     * чисто», хоча перевизначення, масштаб і символьні діапазони ніхто не
     * рахував.
     *
     * `?? 0` лишається — для СУМИ це правильно (нерахована родина не додає
     * знахідок), — але сама нерахованість тепер названа.
     */
    const родини: Array<[number | null, Bi]> = [
      [d.totals.overridePropertyDeviations, bi("перевизначення властивостей абзацу (overrides)", "paragraph property overrides (overrides)")],
      [d.totals.characterRangesDeviating, bi("символьні діапазони (character)", "character ranges (character)")],
      [d.totals.scaleParagraphs, bi("масштаб абзаців (scale)", "paragraph scale (scale)")],
    ];
    const нераховані = родини.filter(([ч]) => ч === null).map(([, підпис]) => підпис);
    const count =
      d.findings.length +
      (d.totals.overridePropertyDeviations ?? 0) +
      (d.totals.characterRangesDeviating ?? 0) +
      (d.totals.scaleParagraphs ?? 0);
    return {
      count,
      measured: bi(
        `абзаців проаудитовано: ${d.totals.paragraphs}`,
        `paragraphs audited: ${d.totals.paragraphs}`,
      ),
      unconfirmed:
        нераховані.length === 0
          ? []
          : [
              bi(
                `Родини стилів, яких цей прохід НЕ рахував (totals = null, а не нуль): ${нераховані.map((п) => п.uk).join("; ")}. ` +
                  "Їхніх знахідок у числі вище немає — ні нульових, ні інших.",
                `Style families this pass did NOT count (totals = null rather than zero): ${нераховані.map((п) => п.en).join("; ")}. ` +
                  "None of their findings is in the number above — neither zeros nor anything else.",
              ),
            ],
      notSeen: [],
    };
  },
  bibliography_audit(data) {
    const d = data as BibliographyAuditResponse;
    const count = d.groups.reduce((s, g) => s + g.total, 0);
    const unconfirmed: Bi[] = [];
    if (d.unparsed > 0) {
      unconfirmed.push(
        bi(
          `${d.unparsed} записів не розібрано: правила ДСТУ до них не застосовувались узагалі.`,
          `${d.unparsed} records were not parsed: the ДСТУ rules were not applied to them at all.`,
        ),
      );
    }
    const notSeen: Bi[] = d.skipped.map((sk) =>
      bi(
        `Бібліографія: пропущено ${sk.count} абзаців — ${sk.reason}.`,
        `Bibliography: skipped ${sk.count} paragraphs — ${sk.reason}.`,
      ),
    );
    for (const w of d.warnings) {
      notSeen.push(bi(`Бібліографія, попередження інструмента: ${w}`, `Bibliography, tool warning: ${w}`));
    }
    return {
      count,
      measured: bi(`бібліографічних записів: ${d.records}`, `bibliographic records: ${d.records}`),
      unconfirmed,
      notSeen,
    };
  },
  spelling_audit(data) {
    const d = data as SpellingAuditResponse;
    const unconfirmed: Bi[] = [];
    const notSeen: Bi[] = [];
    /*
     * `languagesWithoutDictionary` — мови, для яких словника не знайшли:
     * їхні слова НЕ перевірялись жодного разу. Спек §3 називає це прямо
     * («на локалізованій збірці InDesign мовний гейт мовчки віддасть
     * нулі»), і саме це поле — єдиний сигнал про такий стан.
     */
    if (d.languagesWithoutDictionary !== undefined && d.languagesWithoutDictionary.length > 0) {
      const список = перелік(d.languagesWithoutDictionary);
      unconfirmed.push(
        bi(
          `Мови без словника: ${список.uk}. ` +
            "Слова цих мов не перевірялись — їхній нуль помилок нічого не означає.",
          `Languages without a dictionary: ${список.en}. ` +
            "Words of these languages were not checked — their zero errors means nothing.",
        ),
      );
    }
    if (d.truncated !== null) {
      notSeen.push(
        bi(
          `Перелік слово-типів обрізано: показано ${d.truncated.shown} з ${d.truncated.total}.`,
          `The listing of word types was truncated: showing ${d.truncated.shown} of ${d.truncated.total}.`,
        ),
      );
    }
    return {
      count: d.deviating,
      measured: bi(
        `слово-типів проаналізовано: ${d.wordTypesTotal}`,
        `word types analysed: ${d.wordTypesTotal}`,
      ),
      unconfirmed,
      notSeen,
    };
  },
  layout_audit(data) {
    const d = data as LayoutAuditResponse;
    const unconfirmed: Bi[] = [];
    /* `notComparedGroups` — групи властивостей, які порівняти не вдалося
     * (`src/tools/map.ts:224`). Нуль перевизначень при непорожньому
     * лічильнику — це «не звіряли», а не «збігається». */
    if (d.totals.notComparedGroups > 0) {
      unconfirmed.push(
        bi(
          `${d.totals.notComparedGroups} груп властивостей НЕ звірено (notComparedGroups): ` +
            "їхніх перевизначень у числі вище немає.",
          `${d.totals.notComparedGroups} property groups NOT reconciled (notComparedGroups): ` +
            "none of their overrides is in the number above.",
        ),
      );
    }
    /*
     * §2.2: контейнер чи абзац, якому не вдалося призначити сторінку, з
     * виміру ВИПАДАЄ — і доти це відбувалось мовчки. Тепер число їде сюди,
     * бо воно каже рівно те саме, що `notComparedGroups`: віддане число не
     * рахує цих абзаців, тож нижчою межею воно не є.
     */
    /* Рядок з'являється лише при ненулі. Нуль тут був би шумом у КОЖНОМУ
     * здоровому звіті; «нуль друкується як ненуль» стосується
     * `pasteboardItems`, де нуль щось означає. */
    const безСторінки =
      (d.totals.unplacedContainers ?? 0) + (d.totals.unplacedParagraphs ?? 0);
    if (безСторінки > 0) {
      unconfirmed.push(
        bi(
          `Без сторінки лишилось ${d.totals.unplacedContainers ?? 0} контейнерів і ` +
            `${d.totals.unplacedParagraphs ?? 0} абзаців — вони з виміру випали, ` +
            "тож їхніх перевизначень у числі вище немає.",
          `Left without a page: ${d.totals.unplacedContainers ?? 0} containers and ` +
            `${d.totals.unplacedParagraphs ?? 0} paragraphs — they dropped out of the measurement, ` +
            "so none of their overrides is in the number above.",
        ),
      );
    }
    return {
      count: d.totals.overrideFindings + d.totals.masterFindings,
      measured: bi(`сторінок оглянуто: ${d.pages.length}`, `pages surveyed: ${d.pages.length}`),
      unconfirmed,
      notSeen: [],
    };
  },
  composition_audit(data) {
    const d = data as CompositionAuditResponse;
    const unconfirmed: Bi[] = [];
    /* `scope.partial` виставляє сам інструмент, коли одне з вікон упало й
     * обхід зупинився (`src/tools/composition.ts:1509-1516`): форма звіту
     * та сама, ознака інша. */
    if (d.scope.partial) {
      unconfirmed.push(
        bi(
          `Обхід зупинився на сторінці ${d.scope.stoppedAt ?? "?"} (${d.scope.stoppedReason ?? "причини не названо"}): ` +
            `виміряно ${d.scope.pagesMeasured ?? "?"} сторінок — решта не аналізувалась.`,
          `The walk stopped at page ${d.scope.stoppedAt ?? "?"} (${d.scope.stoppedReason ?? "no reason named"}): ` +
            `measured ${d.scope.pagesMeasured ?? "?"} pages — the rest was not analysed.`,
        ),
      );
    }
    /* Межі виміру — у «не бачили» НАЗВАНИМИ рядками, як у `geometry_audit`:
     * вони правдиві й на бездоганному прогоні, тому виміру не скасовують. */
    const notSeen: Bi[] = (d.warnings ?? []).map((w) =>
      bi(`Композиція, межа виміру: ${w}`, `Composition, limit of the measurement: ${w}`),
    );
    return {
      count: d.findingsTotal,
      measured: bi(
        `рядків проаналізовано: ${d.scope.linesAnalysed}`,
        `lines analysed: ${d.scope.linesAnalysed}`,
      ),
      unconfirmed,
      notSeen,
    };
  },
  typography_audit(data) {
    const d = data as TypographyAuditResponse;
    const unconfirmed: Bi[] = [];
    const notSeen: Bi[] = [];
    /*
     * Сам інструмент попереджає про це в коді (`src/tools/typography.ts:
     * 236-240`): «на локалізованій збірці InDesign назва мови не збіжиться,
     * і вся половина правопису 2019 мовчки віддасть порожньо». Нуль
     * українських прогонів при непорожньому документі — саме той стан.
     */
    if (d.spelling2019.ukrainianRuns === 0) {
      unconfirmed.push(
        bi(
          "Жодного українського мовного прогону не знайдено (spelling2019.ukrainianRuns = 0): " +
            "правила правопису 2019 не застосовувались узагалі — мовний гейт міг не збігтися " +
            "на локалізованій збірці InDesign.",
          "Not one Ukrainian language run was found (spelling2019.ukrainianRuns = 0): " +
            "the 2019 orthography rules were not applied at all — the language gate may have failed to match " +
            "on a localised InDesign build.",
        ),
      );
    }
    const пропущено = d.spelling2019.skippedByLanguage + d.piv2019.skippedByLanguage;
    if (пропущено > 0) {
      notSeen.push(
        bi(
          `Типографіка: ${пропущено} збігів пропущено мовним гейтом (не українська мова діапазону).`,
          `Typography: ${пропущено} matches skipped by the language gate (the range's language is not Ukrainian).`,
        ),
      );
    }
    return {
      count: d.totalMatches + d.auditOnly.length,
      measured: bi(
        `збігів правил перевірено: ${d.totalMatches}`,
        `rule matches checked: ${d.totalMatches}`,
      ),
      unconfirmed,
      notSeen,
    };
  },
  /*
   * Раунд виправлень 1, знахідка контролера №1 (живий прогін): `status`
   * ДОТИ адаптера не мав — свідомо, бо «його дані вже в `stamp` прогону».
   * Наслідок виміряно на справжній книжці: усі 12 проходів ✓, а плитка
   * шапки казала «Не виміряно 2», де одна одиниця — цей зонд, і вона
   * стояла б там НА КОЖНОМУ прогоні, завжди. Число, яке ніколи не буває
   * нулем, читач за кілька прогонів вивчає як «норма» і перестає бачити —
   * тоді плитка гірша за свою відсутність (§6.4 про ворота, те саме про
   * будь-який постійний сигнал).
   *
   * Лік не виправляється виїмкою для цього інструмента: перелік випадків у
   * цьому файлі провалювався тричі (R18, R20, C1). Виправляється тим самим
   * структурним правилом, що й решта — КОЖЕН прохід говорить про свій
   * прилад. Зондові сеансу є що сказати (§8, «нуль іде в чисто З ЧИСЛОМ»):
   * версія InDesign, скільки документів відкрито, який спереду, чи має
   * незбережені зміни.
   *
   * Знахідок тут немає ЗА ПОБУДОВОЮ, як і в `doc_overview`: зонд міряє
   * СЕРЕДОВИЩЕ, а не макет, і судити макет йому нічим. Нуль правдивий, а
   * не замовчаний. Неоднозначність «який документ наш» — не його справа:
   * її вирішує сеансовий шар (R41), і його рішення друкується в
   * `stamp`/футері.
   */
  indesign_status(data) {
    const d = data as StatusShape;
    const незбережені = d.documents.filter((док) => док.modified).map((док) => док.name);
    const список = перелік(незбережені);
    return {
      count: 0,
      measured: bi(
        `зонд сеансу (середовище, не макет): InDesign ${d.version ?? "версію не названо"}, ` +
          `відкритих документів: ${d.documents.length}, спереду: «${d.activeDocument ?? "жодного"}», ` +
          `з незбереженими змінами: ${незбережені.length === 0 ? "жодного" : список.uk}`,
        `session probe (the environment, not the layout): InDesign ${d.version ?? "version not named"}, ` +
          `open documents: ${d.documents.length}, frontmost: “${d.activeDocument ?? "none"}”, ` +
          `with unsaved changes: ${незбережені.length === 0 ? "none" : список.en}`,
      ),
      unconfirmed: [],
      notSeen: [],
    };
  },
  doc_overview(data) {
    const d = data as DocOverviewResponse;
    /* Інвентар, не аудит: знахідок тут за побудовою немає (див. коментар
     * при `DocOverviewResponse`), тож 0 — завжди правдивий нуль, не
     * замовчана відсутність перевірки. Приладових лічильників обробник
     * (`src/jsx/inspect.jsx:32-75`) не має жодного — прочитано до кінця. */
    return {
      count: 0,
      measured: bi(
        `сторінок: ${d.pageCount}, розворотів: ${d.spreadCount}, ` +
          `абзацних стилів: ${d.paragraphStyles.length}, символьних стилів: ${d.characterStyles.length}, ` +
          `шрифтів: ${d.fonts.length}, лінків: ${d.links.length}`,
        `pages: ${d.pageCount}, spreads: ${d.spreadCount}, ` +
          `paragraph styles: ${d.paragraphStyles.length}, character styles: ${d.characterStyles.length}, ` +
          `fonts: ${d.fonts.length}, links: ${d.links.length}`,
      ),
      unconfirmed: [],
      notSeen: [],
    };
  },
  __cli_extras(data) {
    /*
     * R22 (рецензія задачі 12, Important, доведено ВИКОНАННЯМ): `count:
     * findings.length` рахував КІЛЬКІСТЬ РЯДКІВ-РЕЧЕНЬ `summariseExtras`
     * (типів знахідок — шарів монтажного столю, груп масштабу), а НЕ саму
     * величину. 193 об'єкти на одному шарі монтажного столу давали
     * `findings.length === 1` — і, головне, число 193 в `measured`
     * (`clean.join(...)`) не було ВЗАГАЛІ: `clean` несе лише пункти, що
     * пройшли чисто, а рядки-знахідки `summariseExtras` тут відкидались
     * повністю. Виправлено: `count` тепер сума СПРАВЖНІХ величин зі
     * СТРУКТУРНИХ полів `ExtrasMeasure` — той самий принцип, яким
     * `rowsFromExtras` в `audit.ts` будує рядки таблиці (той самий поріг
     * `ВОЛОСЯНА_PT`, звідти ж).
     *
     * Critical 1 (раунд виправлень 1, задача C): `послідовності` додає до
     * `count` суму `countSequenceProblems` по кожному запису `d.sequences`
     * — БЕЗ цього доповнення прохід із розривом у нумерації, але з чистими
     * рештою полів (масштаб/монтажний стіл/волосяне — усі нулі), давав
     * `count === 0` і публікувався в «Перевірено чисто» — документ із
     * дефектом друкував МЕНШЕ, ніж документ без дефекту. `countSequenceProblems`
     * — та сама функція, яку `rowsFromExtras` (`audit.ts`) використовує для
     * рядків таблиці: секція-лічильник і таблиця-деталь тепер судять «є
     * проблема чи ні» одним правилом, а не двома, що можуть розійтися.
     */
    const d = data as ExtrasMeasure;
    const { clean } = summariseExtras(d);
    const масштаб = d.horizontalScaleOffenders.reduce((s, o) => s + o.count, 0);
    const монтажнийСтіл = d.pasteboardItems.reduce((s, p) => s + p.count, 0);
    const волосяне = d.thinnestStrokePt !== null && d.thinnestStrokePt < ВОЛОСЯНА_PT ? 1 : 0;
    const послідовності = (d.sequences ?? []).reduce((s, seq) => s + countSequenceProblems(seq), 0);
    /*
     * ПРИЛАДОВИЙ ЛІЧИЛЬНИК У ДОМІРА ТЕПЕР Є — і коментар, що стояв тут
     * раніше, застарів разом із гілкою, яка його породила. Було сказано:
     * «приладових лічильників у нього немає … тут порожньо не через
     * недогляд, а тому, що прилад мовчить». Прилад більше не мовчить:
     * `unresolvedItems` рахує елементи, чию сторінку прочитати НЕ ВДАЛОСЯ.
     *
     * І сам він мало не повторив ту саму ваду, проти якої заведений:
     * `summariseExtras` кладе його рядок у `findings`, а цей адаптер
     * деструктурує лише `{ clean }` — тобто число було виміряне,
     * типізоване, покрите тестом і ВИКИНУТЕ на межі звіту. Знайдено
     * ворожою рецензією гілки.
     *
     * Іде в `unconfirmed`, а не в `count`: це не дефект макета, а межа
     * приладу. Прохід із непрочитаними об'єктами не сміє друкуватись у
     * «Перевірено чисто».
     */
    const unconfirmed: Bi[] = [];
    const невизначені = d.unresolvedItems ?? 0;
    if (невизначені > 0) {
      unconfirmed.push(
        bi(
          `Сторінку НЕ визначено для ${невизначені} об'єктів: прочитати їх не вдалося. ` +
            "У числі на монтажному столі вони НЕ враховані, і чи є на них дефекти — невідомо.",
          `A page was NOT determined for ${невизначені} objects: they could not be read. ` +
            "They are NOT counted in the pasteboard figure, and whether they carry defects is unknown.",
        ),
      );
    }
    return {
      count: масштаб + монтажнийСтіл + волосяне + послідовності,
      measured: joinBi(clean, "; "),
      unconfirmed,
      notSeen: [],
    };
  },
};

/**
 * Значення параметра словами — рівно `JSON.stringify`, без власного
 * форматування. Причина: рядок у лапках («"style-bounds"») відрізняється від
 * числа (20) і від переліку (["overrides","masters"]) сам собою, а будь-яке
 * «гарніше» подання довелось би вигадувати — і воно розійшлося б із тим, що
 * людина написала в конфігу.
 */
function значенняСловами(v: unknown): string {
  const текст = JSON.stringify(v);
  /* `JSON.stringify(undefined)` віддає `undefined`, а не рядок. Сюди воно не
   * доходить (zod не лишає ключа з `undefined` у розібраному об'єкті), але
   * мовчазне «undefined» у звіті було б гірше за назване. */
  return текст ?? "undefined";
}

/**
 * Пари розділені « · », а не комою (R37). Кома всередині значення —
 * `["overrides","masters"]` — і кома між парами виглядають однаково, і
 * одинадцять пар зливались в один суцільний блок замість переліку.
 * Крапка посередині в моноширинному підписі картки ділить пари на око.
 */
function перелікПараметрів(args: Record<string, unknown>, keys: string[]): string {
  return keys.map((k) => `${k}: ${значенняСловами(args[k])}`).join(" · ");
}

/**
 * «Параметри, якими міряв» (спек §8) — з поділом на те, що обрала людина, і
 * те, що припустив інструмент (рулінг R28).
 *
 * Спек §5.4 забороняє покладатися на умовність там, де звіт читає друкарня,
 * і `src/cli/run/plan.ts` тримає цю заборону для порогів друку (`minPpi`,
 * `maxTotalInk`, `expectedInks`) — вони йдуть із конфіга завжди. Селекторам
 * обсягу (`families`) і вікнам алгоритму (`pageWindow`) замовчувати дозволено
 * — але не мовчки: R28 вимагає, щоб звіт назвав їх замовчуваннями.
 *
 * Позначка ГРУПОВА, а не при кожному значенні. Виміряно на справжньому
 * `composition_audit` із `configs/maaam.json`: 11 із 12 його параметрів
 * приходять із `.default(...)` (`src/tools/composition.ts:1362-1414`, плюс
 * `perDefectLimit`), і повторене одинадцять разів «(замовчування
 * інструмента)» дає в картці рядок на 577 знаків проти 334 групового.
 * Слова лишились ті самі, винесено лише спільний множник.
 *
 * Рулінг R37: половини віддаються ОКРЕМИМИ рядками, а не одним з'єднаним.
 * Класову відмінність робить читомою саме підпис групи, але на 334 знаках
 * в один рядок вона зливалася з рештою й читалась як один довгий хвіст.
 * Тому тут повертається масив: рендер картки (`src/cli/audit.ts`,
 * `замінитиCleanБлок`) кладе кожен рядок у власний блок. ЖОДНОГО значення
 * при цьому не приховано — ховати половину, яку обрала людина, означало б
 * ховати те, заради чого §8 узагалі друкує параметри, а ховати другу
 * половину означало б повернути саме ту ваду, проти якої стоїть R28.
 *
 * Текст — для людини, що читає звіт перед друком і цього коду не бачила,
 * тому «ніхто їх не обирав» стоїть прямо в підписі, а не мається на увазі.
 *
 * Екранування (спек §7) робить `escapeHtml` на місці підстановки в шаблон
 * — по разу на КОЖЕН рядок; цей модуль віддає ЧИСТИЙ текст, як і
 * `what`/`measured` поруч.
 */
export function describeParams(p: PassResult): Bi[] {
  const ключі = Object.keys(p.args);
  /* «Без параметрів» — теж відповідь на питання «чим міряв», і мовчання
   * тут відрізнити від «параметри є, але їх не показали» було б нічим. */
  if (ключі.length === 0) return [bi("без параметрів", "no parameters")];
  const замовчані = new Set(p.defaulted);
  const зКонфіга = ключі.filter((k) => !замовчані.has(k));
  const зіСхеми = ключі.filter((k) => замовчані.has(k));
  /* Самі пари «ключ: значення» мовою не відрізняються — різниться лише те,
   * ЗВІДКИ параметр узявся, і саме це несе сенс для читача. */
  const рядки: Bi[] = [];
  if (зКонфіга.length > 0) {
    const пари = перелікПараметрів(p.args, зКонфіга);
    рядки.push(bi(`задано в конфігу: ${пари}`, `set in the config: ${пари}`));
  }
  if (зіСхеми.length > 0) {
    const пари = перелікПараметрів(p.args, зіСхеми);
    рядки.push(
      bi(
        `замовчування інструмента (ніхто їх не обирав): ${пари}`,
        `the tool's defaults (nobody chose them): ${пари}`,
      ),
    );
  }
  return рядки;
}

/** Скільки слово-типів чекає людського тріажу — лише для spelling_audit. */
function словоТипівПотребуєОчей(p: PassResult): number {
  if (p.tool !== "spelling_audit" || p.data === null) return 0;
  return (p.data as SpellingAuditResponse).wordTypesTotal;
}

/**
 * Сторінки, вдягнені інакше за сусідів ТОГО САМОГО БОКУ — лише для
 * `pagination_audit`.
 *
 * §4 передачі: інцидент с. 188 робочої книжки (забуте переназначення шаблона,
 * через яке зник колонтитул). `head-missing` цього не бачить за побудовою —
 * очікування будуються з рамок НА МАЙСТРАХ, а чужий майстер нічого не
 * обіцяє. КАНДИДАТИ, не знахідки: титул і шмуцтитул законно мають свій
 * майстер.
 */
function островиМайстра(p: PassResult): MasterIslandCandidate[] {
  if (p.tool !== "pagination_audit" || p.data === null) return [];
  return (p.data as PaginationAuditResponse).masterIslands ?? [];
}

/**
 * Розриви в нумерації бібліографічних записів — лише для bibliography_audit.
 *
 * §3.1 передачі. Число рахувалось (`src/bibliography/segment.ts:121`),
 * доїжджало до відповіді інструмента (`src/tools/bibliography.ts:170`) — і в
 * усьому CLI згадувалось ЛИШЕ в коментарі. На «Book B» їх виміряно
 * 135: число було, роботи нуль.
 *
 * КУДИ ЦЕ НАЛЕЖИТЬ І ЧОМУ НЕ В ІНШІ ДВА КАНАЛИ. Не в `unconfirmed` — той
 * оголошує ВЕСЬ прохід непідтвердженим і каже, що віддане число нижчою межею
 * не є; тут неправда і те, і те: правила ДСТУ відпрацювали й підтверджені, а
 * розриви — окреме спостереження ПОРУЧ із ними. Не в `notSeen` — це не
 * прогалина покриття, ми якраз побачили. І не в лічильник знахідок — розрив
 * між 12 і 14 не є порушенням ДСТУ: список могли свідомо перенумерувати,
 * запис могли вилучити редакторськи, а могли й загубити при верстці.
 * Інструмент їх не розрізняє й розрізняти не мусить.
 *
 * Лишається «потребує очей» — той самий канал і той самий прецедент, що
 * `словоТипівПотребуєОчей` вище: це СПИСОК, а тріаж за людиною.
 */
function розривиНумерації(p: PassResult): Array<{ after: number; next: number }> {
  if (p.tool !== "bibliography_audit" || p.data === null) return [];
  return (p.data as BibliographyAuditResponse).numberingGaps ?? [];
}

/**
 * Один прохід, розібраний РІВНО ОДИН раз: і секції, і ворота, і числа шапки
 * звіту читають ЦЕЙ результат, а не рахують кожен своє.
 *
 * I6 (фінальна рецензія, Important): шапка звіту рахувала РЯДКИ таблиць
 * (`РЯДКОВІ_АДАПТЕРИ` в `audit.ts`), у яких немає записів для
 * `typography_audit`, `layout_audit` і `composition_audit`. На живому
 * прогоні quotes-uk 8 і space-before-break 1 у «Важливих» не рахувались
 * узагалі, тоді як «Потребує очей» показувало для них СВОЄ число: одна
 * величина, два різні числа в одному документі. Та сама вада, що R22,
 * рівнем вище — і той самий лік: одна спільна функція.
 */
export interface PassVerdict {
  id: string;
  tool: string;
  /** `null` — прохід упав, немає адаптера або немає даних (див. `reason`). */
  extract: PassExtract | null;
  /** Чому вироку немає; `null` — вирок є. */
  reason: Bi | null;
}

/**
 * Розбирає КОЖЕН прохід рівно одним правилом. Експортовано, бо шапка звіту
 * (`src/cli/audit.ts`) мусить рахувати те саме, що секції, — інакше вони
 * розійдуться, як уже розходились.
 */
export function judgePasses(m: Measurements): PassVerdict[] {
  return m.passes.map((p) => {
    if (!p.ok) {
      return {
        id: p.id,
        tool: p.tool,
        extract: null,
        reason: bi(
          `Прохід «${p.id}» не виконався: ${p.error}`,
          `Pass “${p.id}” did not run: ${p.error}`,
        ),
      };
    }
    const адаптер = АДАПТЕРИ[p.tool];
    if (адаптер === undefined) {
      return {
        id: p.id,
        tool: p.tool,
        extract: null,
        reason: bi(
          `Прохід «${p.id}» (${p.tool}) виконано, але цей звіт не розбирає його форму на знахідки — його чисел тут немає.`,
          `Pass “${p.id}” (${p.tool}) ran, but this report does not parse its shape into findings — its numbers are not here.`,
        ),
      };
    }
    if (p.data === null) {
      return {
        id: p.id,
        tool: p.tool,
        extract: null,
        reason: bi(
          `Прохід «${p.id}» (${p.tool}) виконано, але повернув порожні дані — чисел тут немає.`,
          `Pass “${p.id}” (${p.tool}) ran, but returned empty data — there are no numbers here.`,
        ),
      };
    }
    return { id: p.id, tool: p.tool, extract: адаптер(p.data), reason: null };
  });
}

export function deriveSections(m: Measurements): Sections {
  const clean: Sections["clean"] = [];
  const notSeen: Sections["notSeen"] = [...ЗАВЖДИ_НЕ_БАЧИЛИ];
  const needsEyes: Sections["needsEyes"] = [];

  const вироки = judgePasses(m);

  for (const [i, p] of m.passes.entries()) {
    // Довжина `вироки` дорівнює `m.passes` за побудовою `judgePasses`.
    const вирок = вироки[i]!;

    const слова = словоТипівПотребуєОчей(p);
    if (слова > 0) {
      needsEyes.push({
        topic: bi("невідомі словникові слова", "unknown dictionary words"),
        detail: bi(
          `${слова} слово-типів. Це СПИСОК, а не знахідки: тріаж — за людиною.`,
          `${слова} word types. This is a LIST, not findings: the triage is for a human.`,
        ),
      });
    }

    const острови = островиМайстра(p);
    if (острови.length > 0) {
      const ПОКАЗАТИ = 8;
      const адресиUk = острови
        .slice(0, ПОКАЗАТИ)
        .map((c) => `с. ${c.page} — «${c.master}» серед «${c.neighbourMaster}»`)
        .join("; ");
      const адресиEn = острови
        .slice(0, ПОКАЗАТИ)
        .map((c) => `p. ${c.page} — “${c.master}” among “${c.neighbourMaster}”`)
        .join("; ");
      const рештаUk = острови.length > ПОКАЗАТИ ? ` та ще ${острови.length - ПОКАЗАТИ}` : "";
      const рештаEn = острови.length > ПОКАЗАТИ ? ` and ${острови.length - ПОКАЗАТИ}` : "";
      needsEyes.push({
        topic: bi("сторінки, вдягнені інакше за сусідів", "pages dressed differently from their neighbours"),
        detail: bi(
          `${острови.length} кандидат(ів): ${адресиUk}${рештаUk}. Це КАНДИДАТИ, а не знахідки: ` +
            "титул, шмуцтитул і розділювач законно мають власний майстер, а забуте " +
            "переназначення шаблона виглядає точно так само — розрізнити їх може лише людина.",
          `${острови.length} candidate(s): ${адресиEn}${рештаEn}. These are CANDIDATES, not findings: ` +
            "a title page, a half-title and a divider legitimately have their own master, and a forgotten " +
            "template reassignment looks exactly the same — only a human can tell them apart.",
        ),
      });
    }

    const розриви = розривиНумерації(p);
    if (розриви.length > 0) {
      const ПОКАЗАТИ = 5;
      const приклади = розриви
        .slice(0, ПОКАЗАТИ)
        .map((g) => `${g.after}→${g.next}`)
        .join(", ");
      const рештаUk = розриви.length > ПОКАЗАТИ ? ` та ще ${розриви.length - ПОКАЗАТИ}` : "";
      const рештаEn = розриви.length > ПОКАЗАТИ ? ` and ${розриви.length - ПОКАЗАТИ}` : "";
      needsEyes.push({
        topic: bi("розриви в нумерації бібліографії", "gaps in the bibliography numbering"),
        detail: bi(
          `${розриви.length} розривів (${приклади}${рештаUk}). Це СПИСОК, а не знахідки: ` +
            "свідома перенумерація, вилучений запис і загублений при верстці тут " +
            "нерозрізненні — тріаж за людиною.",
          `${розриви.length} gaps (${приклади}${рештаEn}). This is a LIST, not findings: ` +
            "a deliberate renumbering, a removed record and one lost during layout are " +
            "indistinguishable here — the triage is for a human.",
        ),
      });
    }

    /*
     * R18 (рецензія задачі 11, раунд 2): прохід без адаптера НЕ сміє
     * зникати мовчки. Попередня редакція просто пропускала такий прохід
     * (`if (адаптер !== undefined) {...}`, без `else`) — і саме тому
     * `typography_audit`/`doc_overview`/`__cli_extras` зникали зі звіту
     * ЦІЛКОМ, ні в «чисто», ні в «не бачили», ні в «потребує очей».
     *
     * Гілка лишається для МАЙБУТНЬОГО забутого адаптера: інструмент, чиєї
     * форми звіт не розбирає, буде видно в самому звіті, а не чекатиме на
     * рецензента. Станом на зараз адаптер має КОЖЕН прохід плану
     * (`src/cli/run/plan.ts`), включно з `indesign_status` — раунд
     * виправлень 1 дав зондові сеансу власний адаптер (`АДАПТЕРИ` вище),
     * бо доти він єдиний падав у цю гілку НА КОЖНОМУ прогоні й тримав
     * плитку шапки «Не виміряно» вічно ненульовою. Тобто на здоровому
     * прогоні тут не має бути НІКОГО — і саме це стереже тест
     * «indesign_status має адаптер…» у `tests/unit/cli-sections.test.ts`.
     *
     * Прохід, що ВПАВ, приходить сюди тим самим шляхом (`extract === null`,
     * `reason` названо): збій, невідомий інструмент і порожні дані — три
     * різні причини одного стану «числа немає», і всі три однаково видимі.
     * Критична родина в будь-якому з трьох запалює ворота (I1, рулінг R46,
     * `hasCritical` нижче).
     */
    if (вирок.extract === null) {
      notSeen.push({
        source: same(p.tool),
        detail: вирок.reason ?? bi("Причини не названо.", "No reasons named."),
      });
      continue;
    }

    const { count, measured, unconfirmed, notSeen: прогалини } = вирок.extract;

    /* Прогалини покриття друкуються НЕЗАЛЕЖНО від того, куди піде сам
     * прохід: вимкнене правило профілю чи невимірний лінк лишаються
     * правдою і на бездоганному прогоні (спек §8). */
    for (const рядок of прогалини) notSeen.push({ source: same(p.id), detail: рядок });

    if (unconfirmed.length > 0) {
      /*
       * C1 (Critical, фінальна рецензія): вимір, якого прилад НЕ
       * підтвердив, — це «не бачили», а не «чисто». Число, яке прохід
       * усе-таки віддав, друкується поруч: викидати його означало б
       * приховати ще й те, що вдалося прочитати.
       */
      notSeen.push({
        source: same(p.id),
        detail: bi(
          `Прохід «${p.id}» (${p.tool}) виконався, але вимір НЕ підтверджений: ${unconfirmed.map((u) => u.uk).join(" ")} ` +
            `Віддане число (${count} знахідок; ${measured.uk}) нижчою межею НЕ є — ` +
            "воно рахує лише те, що прилад справді прочитав.",
          `Pass “${p.id}” (${p.tool}) ran, but the measurement is NOT confirmed: ${unconfirmed.map((u) => u.en).join(" ")} ` +
            `The returned number (${count} findings; ${measured.en}) is NOT a lower bound — ` +
            "it counts only what the instrument actually read.",
        ),
      });
    } else if (count === 0) {
      clean.push({ what: same(p.id), measured, params: same(p.tool), paramLines: describeParams(p) });
    } else {
      /*
       * R20 (рецензія задачі 12): та сама вада, що R18, рівнем нижче.
       * R18 закрив «немає адаптера взагалі»; ця гілка була відсутня для
       * «адаптер є, І ЗНАХІДКИ Є» (`count > 0`) — і саме вона мовчала.
       * На живій книжці це мовчання ховало РЕАЛЬНІ дефекти: quotes-uk 8
       * (с. 24, 67) і space-before-break 1 (с. 149) з typography_audit,
       * 193 об'єкти на монтажному столі з __cli_extras — жоден не з'являвся
       * НІ в «чисто» (count не нуль), НІ в «не бачили», НІ в «потребує
       * очей» (обидві попередні гілки цього not-null пасу вже забрані
       * вище). Код виходу при цьому лишався 0 для некритичних родин:
       * чистий вихід і звіт без згадки про справжній дефект — саме та
       * відмова, проти якої існує цей CLI.
       *
       * Інваріант тепер: КОЖЕН прохід потрапляє РІВНО в одну з трьох
       * секцій — незалежно від `count`, від наявності адаптера і від того,
       * чи підтвердив прилад свій вимір (C1). Формулювання тут НАВМИСНО не
       * каже «рядків таблиці немає» — цей модуль не знає про рядкові
       * адаптери CLI (`src/cli/audit.ts`), і для семи з дванадцяти
       * інструментів рядки таблиці ЯКРАЗ Є; казати інакше було б неправдою
       * для них. Правда, яку можна сказати ЗВІДСИ, — що знахідки є і
       * скільки їх.
       */
      needsEyes.push({
        topic: same(`${p.id} (${p.tool})`),
        detail: bi(
          `${count} знахідок. ${measured.uk}. Подробиці — у файлі вимірів (measurements.json) або у відповідній таблиці звіту.`,
          `${count} findings. ${measured.en}. Details are in the measurements file (measurements.json) or in the corresponding table of the report.`,
        ),
      });
    }
  }

  for (const s of m.skipped) {
    /*
     * F2 (рулінг R29): незастосовною можна оголосити не лише родину, а й
     * ПІДРОДИНУ (`pagination.contents`). Це той самий словник §5.1 рівнем
     * нижче, і друкується він тим самим рядком — другий механізм для тієї
     * самої думки розійшовся б із першим. Причина йде ДОСЛІВНО (§5.1);
     * екранування робить `escapeHtml` на місці підстановки в шаблон
     * (`src/cli/audit.ts`), як і для решти полів цього модуля.
     */
    const джерело =
      s.subfamily === undefined
        ? bi(`родина «${s.family}»`, `family “${s.family}”`)
        : bi(
            `родина «${s.family}», підродина «${s.subfamily}»`,
            `family “${s.family}”, subfamily “${s.subfamily}”`,
          );
    notSeen.push({
      source: джерело,
      detail: bi(`Оголошено незастосовною: ${s.reason}`, `Declared inapplicable: ${s.reason}`),
    });
  }

  needsEyes.push({
    topic: bi("питання до друкарні", "questions for the print shop"),
    detail: bi(
      "Доля аркуша, зошити, профіль кольору, спосіб скріплення — цього документ про себе не знає.",
      "The sheet layout, signatures, colour profile and binding method — the document does not know these about itself.",
    ),
  });
  needsEyes.push({
    topic: bi("вихідні відомості", "imprint"),
    detail: bi(
      "Звірити склад видання з анотацією та колофоном — це читання, не вимір.",
      "Reconciling the contents of the edition against the blurb and the colophon — that is reading, not measurement.",
    ),
  });

  return { clean, notSeen, needsEyes };
}

/**
 * Ворота (спек §6.4): «є знахідки» горіло б завжди — 497 невідомих слів є в
 * кожному прогоні цієї книжки. Тому запалюють ЛИШЕ критичні родини, і лише
 * через СПРАВЖНІЙ адаптер `p.tool` — не вгадану назву поля (див. коментар
 * при `АДАПТЕРИ` вище: саме тут `pagination`, типово критична родина,
 * мовчала на розбіжностях до цього виправлення).
 *
 * ДВІ ПОЛОВИНИ ОДНІЄЇ ВЛАСТИВОСТІ (C1 + I1, рулінг R46). Ворота запалює
 * будь-який стан, у якому нуль критичної родини НЕ означає «чисто»:
 *
 *  - м'яка половина (C1): прилад віддав число, але сам сказав, що прочитав
 *    не все — `extract.unconfirmed` непорожній;
 *  - тверда половина (I1): приладу не було чути ЗОВСІМ — `extract === null`.
 *    `judgePasses` віддає це в ТРЬОХ випадках, і кожен означає те саме:
 *    прохід упав (`!p.ok`), звіт не розбирає форму його відповіді (немає
 *    адаптера), прохід віддав порожні дані (`p.data === null`). Жоден із
 *    трьох не є рішенням людини, і жоден не сміє читатися як «готово до
 *    друку»: упалий критичний `preflight` доти давав EXIT.CLEAN = 0.
 *
 * МЕЖА, ЯКУ НЕ ПЕРЕХОДИТИ (R46): родина, свідомо оголошена
 * `{"notApplicable": "…"}`, воріт НЕ запалює. Такі родини живуть у
 * `m.skipped`, а не в `m.passes`, тож у `judgePasses` не потрапляють
 * узагалі — і це НАВМИСНО, а не недогляд. §5.1 робить цей стан законним,
 * причина друкується дослівно в «Чого перевірка НЕ бачила», а ворота, що
 * горіли б на кожному оголошенні незастосовності, були б рівно тим, що
 * §6.4 забороняє: «ворота, що горять постійно, не ворота». Та сама межа,
 * що вже проведена рулінгом R34: «свідомо не оголошено» і «мусило бути й
 * нема» — різні речі. Негативний близнюк цієї межі стоїть у тестах.
 */
export function hasCritical(m: Measurements, criticalIds: ReadonlySet<string>): boolean {
  return judgePasses(m).some((в) => {
    if (!criticalIds.has(в.id)) return false;
    /* I1: вироку немає — вимір ВТРАЧЕНО (три випадки вище). */
    if (в.extract === null) return true;
    /*
     * C1: НЕПІДТВЕРДЖЕНИЙ вимір критичної родини запалює ворота так само,
     * як знахідка. Підстава пряма: `preflight` типово критичний, і його
     * `shapeRecognised: false` давав EXIT.CLEAN = 0 — зелені ворота на
     * прогоні, який нічого не прочитав. Збій у безпечний бік — той самий
     * вибір, що вже зроблено рулінгом R41 у сеансовому шарі.
     */
    return в.extract.unconfirmed.length > 0 || в.extract.count > 0;
  });
}

/**
 * Числа шапки звіту — з ТИХ САМИХ вироків, що й секції (I6).
 *
 * Одиниця — ЗНАХІДКА, як її рахує адаптер інструмента, а не рядок таблиці:
 * рядків у `typography_audit`/`layout_audit`/`composition_audit` немає
 * взагалі (їхня форма відповіді не несе сторінки на знахідку), і шапка,
 * що рахувала рядки, мовчки викидала їх зі свого числа. Тепер шапка й
 * «Потребує очей» рахують ОДНЕ І ТЕ САМЕ.
 *
 * Прохід, чий вимір не підтверджено, у ці числа НЕ входить: він живе в
 * «Чого перевірка НЕ бачила», і додати його до «Важливих» означало б
 * видати непрочитане за прочитане. Саме тому повертається ще й
 * `непідтверджених` — щоб шапка могла сказати про них окремо.
 *
 * I2: `непідтверджених` рахує ОБИДВІ половини (R46) — і вимір, якому не
 * можна вірити (`unconfirmed` непорожній), і вимір, якого не було зовсім
 * (`extract === null`). Доти другий випадок ішов у `continue` без ліку, і
 * шапка мовчала про нього цілком.
 *
 * Це число друкується плиткою «Не виміряно», тож воно мусить МІНЯТИСЯ —
 * постійний складник зробив би плитку декорацією. Раунд виправлень 1 забрав
 * єдиний такий складник: `indesign_status` доти не мав адаптера й давав
 * `extract === null` на КОЖНОМУ прогоні (плитка ніколи не бувала нулем —
 * виміряно живим прогоном). Тепер адаптер має КОЖЕН прохід плану, тож тверда
 * половина (`extract === null`) на здоровому прогоні дає нуль, а все, що
 * лишається в числі, — м'яка половина: прилад сам сказав, що прочитав не
 * все. На живій книжці це `layout` з його 41 незвіреною групою властивостей
 * — число, яке наступного прогону може стати іншим, тобто сигнал, а не
 * оздоба. Якщо колись з'явиться ще один ПОСТІЙНИЙ складник — його треба
 * прибирати в його ж адаптері (як зробили зондові сеансу), а не виймати з
 * ліку: виїмка перетворює це число на неправду, а перелік випадків у цьому
 * файлі провалювався тричі (R18, R20, C1).
 *
 * `критичніБезВиміру` — ті самі стани, звужені до критичних родин, і саме
 * вони запалюють ворота (`hasCritical`). Шапка мусить назвати їх поіменно:
 * без цього звіт самосуперечливий — «Критичних 0» при червоному коді
 * виходу. Список, а не число, бо читач перед друком мусить знати ЯКА
 * родина лишилась неперевіреною, а не лише скільки їх.
 */
export function tallyFindings(
  m: Measurements,
  criticalIds: ReadonlySet<string>,
): { критичних: number; важливих: number; непідтверджених: number; критичніБезВиміру: string[] } {
  let критичних = 0;
  let важливих = 0;
  let непідтверджених = 0;
  const критичніБезВиміру: string[] = [];
  for (const в of judgePasses(m)) {
    if (в.extract === null || в.extract.unconfirmed.length > 0) {
      непідтверджених++;
      if (criticalIds.has(в.id)) критичніБезВиміру.push(в.id);
      continue;
    }
    if (criticalIds.has(в.id)) критичних += в.extract.count;
    else важливих += в.extract.count;
  }
  return { критичних, важливих, непідтверджених, критичніБезВиміру };
}

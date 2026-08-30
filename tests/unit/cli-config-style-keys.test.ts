/*
 * F4: сторож для РУЧНОГО ДЗЕРКАЛА `STYLE_KEYS`
 * (`src/cli/config/validate.ts`).
 *
 * Набір — літерал, зібраний руками, а коментар над ним називає джерелом
 * істини «САМІ СХЕМИ ІНСТРУМЕНТІВ». Досі цього не тримало НІЩО, і дзеркало
 * вже осліпло двічі: `bodyTextStyles` випадав із набору (додано за
 * рецензією), задача A додала ще три ключі (`styleName`, `styleNames`,
 * `contentsStyle`) — усі три переїхали на рівень нижче разом із формою
 * родин. Ціна сліпоти виміряна: ступінь 2 перестає бачити назви стилів, а
 * неіснуючий стиль дає 45 хибних знахідок замість відмови.
 *
 * ЧОГО ЦЕЙ СТОРОЖ НЕ ВМІЄ, СКАЗАНО ВІДРАЗУ. «Ключ, чиє значення — назва
 * абзацного стилю» зі схеми машинно НЕ видно: `z.string()` не каже, рядок це
 * назви стилю чи патерн номера запису. Тому автоматичного вердикту тут бути
 * не може, і вигадувати евристику («ключ містить `style`») означало б
 * завести третій переказ схеми — рівно те, від чого застерігає R30.
 *
 * ЩО ВІН УМІЄ НАТОМІСТЬ: вимагає, щоб КОЖЕН ключ кожної `inputSchema`
 * (рекурсивно, разом із вкладеними) був названий рівно в одному з ДВОХ
 * явних переліків нижче — «це назва стилю» або «це свідомо не назва». Новий
 * ключ, доданий у будь-яку схему, не належить до жодного з них і валить
 * тест, НАЗИВАЮЧИ СЕБЕ. Тобто людина мусить сказати, до якого він табору,
 * замість мовчки провалитись у третій — той, де ступінь 2 його не бачить.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { collectTools } from "../../src/cli/collect.js";
import { FAMILY_NAMES, type AuditConfig } from "../../src/cli/config/schema.js";
import { STYLE_KEYS } from "../../src/cli/config/validate.js";
import { planPasses } from "../../src/cli/run/plan.js";

/* ==========================================================================
 * Обхід схеми. Читає внутрішню форму zod 4.4.3 (`._zod.def`) — виміряно, не
 * згадано: `object` → `shape`, `array` → `element`, `record` → `valueType`,
 * `optional`/`nullable`/`default` → `innerType`, `union` → `options`.
 * ========================================================================== */

/** Типи, які обхід вважає ЛИСТКОМ — тобто в них немає вкладених ключів. */
const ЛИСТКИ: ReadonlySet<string> = new Set([
  "string",
  "number",
  "boolean",
  "enum",
  "literal",
  "null",
  "undefined",
  "any",
  "unknown",
  "date",
  "bigint",
]);

interface ZodDef {
  type: string;
  shape?: Record<string, unknown>;
  element?: unknown;
  valueType?: unknown;
  innerType?: unknown;
  options?: unknown[];
}

function def(схема: unknown): ZodDef | undefined {
  return (схема as { _zod?: { def?: ZodDef } })._zod?.def;
}

/**
 * Збирає ВСІ ключі схеми крапковими шляхами (`contents.levelMap[].contentsStyle`).
 *
 * `невідомі` — конструкти, яких обхід не знає. Він не мовчить про них: тиха
 * пропущена гілка — це рівно та сама сліпота, проти якої існує цей файл.
 */
function зібратиКлючі(
  схема: unknown,
  шлях: string,
  ключі: Set<string>,
  невідомі: Set<string>,
): void {
  const d = def(схема);
  if (d === undefined) {
    невідомі.add(`${шлях || "(корінь)"}: не zod-схема`);
    return;
  }
  switch (d.type) {
    case "object":
      for (const [k, v] of Object.entries(d.shape ?? {})) {
        ключі.add(шлях === "" ? k : `${шлях}.${k}`);
        зібратиКлючі(v, шлях === "" ? k : `${шлях}.${k}`, ключі, невідомі);
      }
      return;
    case "array":
      зібратиКлючі(d.element, `${шлях}[]`, ключі, невідомі);
      return;
    case "record":
      /* Ключі динамічні (їх називає користувач), імен у схемі немає — але
       * значення обходимо: там може стояти об'єкт із власними ключами. */
      зібратиКлючі(d.valueType, `${шлях}[*]`, ключі, невідомі);
      return;
    case "optional":
    case "nullable":
    case "default":
    case "nonoptional":
    case "readonly":
    case "pipe":
      зібратиКлючі(d.innerType, шлях, ключі, невідомі);
      return;
    case "union":
      for (const о of d.options ?? []) зібратиКлючі(о, шлях, ключі, невідомі);
      return;
    default:
      if (!ЛИСТКИ.has(d.type)) невідомі.add(`${шлях}: ${d.type}`);
  }
}

/* ==========================================================================
 * ДВА ЯВНІ ПЕРЕЛІКИ. Третього табору немає — це і є весь механізм сторожа.
 * ========================================================================== */

/**
 * Ключі, чиє значення — НАЗВА абзацного (чи символьного) стилю. Кожен мусить
 * бути в `STYLE_KEYS`, інакше ступінь 2 його не звірить із документом.
 */
const НАЗВИ_СТИЛІВ: ReadonlySet<string> = new Set([
  "pagination_audit.folio.styleNames",
  "pagination_audit.contents.numberStyle",
  "pagination_audit.contents.levelMap[].contentsStyle",
  "pagination_audit.contents.levelMap[].headingStyles",
  "pagination_audit.headingStyles",
  "pagination_audit.runningHead.styleNames",
  /* `style` тут — саме назва абзацного стилю популяції якорів
   * (`src/tools/geometry.ts`, `anchorRule`), а не ідентифікатор. */
  "geometry_audit.anchorRule.style",

  /* I7: домір `__cli_extras` тепер теж має схему (`СХЕМА_CLI_EXTRAS`,
   * `src/cli/measure/extras.ts`), тож обидва його ключі-назви нарешті
   * ПІД сторожем — доти вони лежали в третьому таборі, якого «немає». */
  "__cli_extras.bodyTextStyles",
  "__cli_extras.rules[].style",
]);

/**
 * Ключі, які назвами стилів СВІДОМО не є. Кожен рядок — рішення, а не
 * замовчування: саме тому вони перелічені, а не відсіяні правилом.
 */
const СВІДОМО_НЕ_НАЗВИ: ReadonlySet<string> = new Set([
  /* Типографська школа — «uk» | «en-US» | «en-GB», а не назва стилю. Обирає
   * ПАКЕТ правил (src/typography/packs.ts), не звіряється з документом.
   * Лише `typography_audit`: обхід іде по схемах АУДИТІВ, які збирає CLI, а
   * `typography_apply` до нього не потрапляє — той самий ключ там був би
   * «привидом», і це ловить перевірка нижче. */
  "typography_audit.locale",

  /* Контейнери: тримають об'єкт/масив, а назва лежить рівнем нижче. */
  "pagination_audit.folio",
  "pagination_audit.contents",
  "pagination_audit.contents.levelMap",
  "pagination_audit.runningHead",
  "pagination_audit.detail",
  "geometry_audit.anchorRule",
  "styles_audit.detail",
  "layout_audit.detail",

  /* `styleId` — це `.id`, НЕ назва (`src/tools/styles.ts`, `src/tools/map.ts`:
   * два різні стилі можуть звати однаково, тому адресація йде id). Звірка з
   * документа за назвою тут дала б відмову на цілком чинному id. */
  "styles_audit.detail.styleId",
  "layout_audit.detail.styleId",

  /* Селектори родин, групи, enum-режими — не імена стилів. */
  "pagination_audit.detail.family",
  "styles_audit.families",
  "styles_audit.detail.family",
  "styles_audit.detail.group",
  "layout_audit.families",
  "layout_audit.detail.group",
  "layout_audit.pages",
  "layout_audit.includeMasters",
  "geometry_audit.families",
  "geometry_audit.nearMissThresholdPt",
  "geometry_audit.minPpi",
  "geometry_audit.anchorRule.edge",
  "geometry_audit.anchorRule.alignsTo",
  /* Чи дзеркалиться пара (edge, alignsTo) на розвороті — властивість
   * ГЕОМЕТРІЇ макета, а не назва стилю. */
  "geometry_audit.anchorRule.mirrored",
  "geometry_audit.anchorRule.tolerance",
  "color_audit.families",
  "color_audit.maxTotalInk",
  "color_audit.richBlackMaxPointSize",
  "color_audit.expectedInks",
  "color_audit.paletteNearMissThreshold",
  "color_audit.includeNonPrinting",
  "color_audit.includeHidden",
  "typography_audit.ruleIds",
  "typography_audit.sampleSize",

  /* `bibliography_audit.layers` — шари ПРАВИЛ (dstu/nbsp), не шари документа
   * й не стилі; `recordPattern`/`recordDiscriminator` — рядки-патерни. */
  "bibliography_audit.standard",
  "bibliography_audit.layers",
  "bibliography_audit.ruleIds",
  "bibliography_audit.recordPattern",
  "bibliography_audit.recordDiscriminator",
  "bibliography_audit.sampleSize",

  /* `spelling_audit.family` — enum ("language"/"dictionary");
   * `languageDictionaries` — мапа НАЗВА МОВИ → код словника. */
  "spelling_audit.family",
  "spelling_audit.maxResponseBytes",
  "spelling_audit.languageDictionaries",
  "spelling_audit.expectedDocName",

  /* composition_audit: пороги, вікна й словники слів — жодної назви стилю.
   * `spacingMode` — enum ("style-bounds"): значення згадує слово «style», але
   * стилем не є, і саме тому стоїть тут поіменно. */
  "composition_audit.pages",
  "composition_audit.spacingMode",
  "composition_audit.minRatio",
  "composition_audit.maxRatio",
  "composition_audit.warnBandPct",
  "composition_audit.shortLastLineFraction",
  "composition_audit.minWordChars",
  "composition_audit.maxLadder",
  "composition_audit.forbiddenWords",
  "composition_audit.riverMinRows",
  "composition_audit.riverTolerancePt",
  "composition_audit.riverMinChannelPt",
  "composition_audit.riverJustifiedOnly",
  "composition_audit.sentenceEnders",
  "composition_audit.includeMasters",
  "composition_audit.pageWindow",
  "composition_audit.perDefectLimit",

  /* `rules` — контейнер; `mustBeSequential` — оголошення наміру, не стиль. */
  "__cli_extras.rules",
  "__cli_extras.rules[].mustBeSequential",
]);

/**
 * Інструменти беруться з ТОГО САМОГО маршруту, яким ходить прогін
 * (`planPasses`), а не з окремого списку: другий список розійшовся б із
 * першим, і сторож стеріг би не ті схеми. Родини — всі одинадцять,
 * налаштовані порожнім `{}`, щоб маршрут побудувався для кожної.
 */
function інструментиРодин(): string[] {
  const cfg = {
    edition: { title: "К", docPath: "/т/к.indd" },
    print: { minPpi: 300, maxTotalInk: 300, expectedInks: 4 },
    families: Object.fromEntries(FAMILY_NAMES.map((f) => [f, {}])),
  } as AuditConfig;
  const родини = new Set<string>(FAMILY_NAMES);
  return [
    ...new Set(planPasses(cfg).passes.filter((p) => родини.has(p.id)).map((p) => p.tool)),
  ].sort();
}

function усіКлючіСхем(): { ключі: string[]; невідомі: string[]; безСхеми: string[] } {
  const box = collectTools();
  const ключі: string[] = [];
  const невідомі: string[] = [];
  const безСхеми: string[] = [];
  for (const інструмент of інструментиРодин()) {
    const запис = box.get(інструмент);
    if (запис?.inputSchema === undefined) {
      безСхеми.push(інструмент);
      continue;
    }
    const зібрані = new Set<string>();
    const невідоміТут = new Set<string>();
    зібратиКлючі(z.object(запис.inputSchema), "", зібрані, невідоміТут);
    for (const k of зібрані) ключі.push(`${інструмент}.${k}`);
    for (const u of невідоміТут) невідомі.push(`${інструмент}.${u}`);
  }
  return { ключі: ключі.sort(), невідомі, безСхеми };
}

describe("STYLE_KEYS — сторож ручного дзеркала схем (F4)", () => {
  it("обхід схем не має сліпих гілок: жодного невідомого zod-конструкта", () => {
    // Якщо тут з'явиться рядок, обхід мовчки НЕ читав цю гілку — а отже
    // ключі під нею не потрапили б у жоден із двох переліків.
    expect(усіКлючіСхем().невідомі).toEqual([]);
  });

  it("кожен ключ кожної схеми названо рівно в ОДНОМУ з двох переліків", () => {
    const { ключі } = усіКлючіСхем();
    const нікуди = ключі.filter(
      (k) => !НАЗВИ_СТИЛІВ.has(k) && !СВІДОМО_НЕ_НАЗВИ.has(k),
    );
    expect(
      нікуди,
      "Нові ключі в inputSchema. Скажіть про КОЖЕН, назва це стилю чи ні:\n" +
        "  — назва стилю → до НАЗВИ_СТИЛІВ тут І до STYLE_KEYS у validate.ts;\n" +
        "  — не назва    → до СВІДОМО_НЕ_НАЗВИ тут.\n" +
        `Неназвані: ${нікуди.join(", ")}`,
    ).toEqual([]);

    const вДвох = ключі.filter((k) => НАЗВИ_СТИЛІВ.has(k) && СВІДОМО_НЕ_НАЗВИ.has(k));
    expect(вДвох, "ключ не сміє бути в обох переліках одночасно").toEqual([]);
  });

  it("кожен ключ-НАЗВА є в STYLE_KEYS — інакше ступінь 2 його не звірить", () => {
    // Саме ця перевірка була б червоною до задачі A: `styleName`,
    // `styleNames` і `contentsStyle` переїхали в схему, а в наборі їх не було.
    const поза = [...НАЗВИ_СТИЛІВ]
      .map((шлях) => шлях.split(/[.[]/).filter((s) => s !== "" && s !== "]").at(-1)!)
      .filter((останній) => !STYLE_KEYS.has(останній));
    expect(
      [...new Set(поза)],
      "ці ключі несуть назви стилів, але collectNames їх не бачить — додайте в STYLE_KEYS",
    ).toEqual([]);
  });

  it("НАЗВИ_СТИЛІВ і СВІДОМО_НЕ_НАЗВИ описують саме наявні схеми, а не вигадані шляхи", () => {
    // Зворотний бік: перелік, що пережив видалення поля зі схеми, тихо
    // перетворюється на брехню. Тому шлях, якого в схемах немає, — теж вада.
    const { ключі } = усіКлючіСхем();
    const наявні = new Set(ключі);
    const привиди = [...НАЗВИ_СТИЛІВ, ...СВІДОМО_НЕ_НАЗВИ].filter((k) => !наявні.has(k));
    expect(привиди, "цих шляхів у схемах уже немає — приберіть їх із переліків").toEqual([]);
  });

  /*
   * I7 (фінальна рецензія, Important) — ЦЕЙ ТЕСТ ПЕРЕВЕРНУТО НАВМИСНО.
   *
   * Було: «МЕЖА: __cli_extras схеми не має, тож bodyTextStyles і
   * rules[].style сторож не бачить» — і саме ця «названа вголос межа» й
   * була дірою: родини `extras`/`sequences` несуть ШІСТЬ із чотирнадцяти
   * контрольних чисел §10, а одруківка в ключі (`bodyTextStyle`) не
   * ловилась нічим і давала «Примусових розривів: 402, з них в основному
   * тексті 0» — правдоподібно, впевнено, неправда.
   *
   * Стало: жодного інструмента родини без схеми не лишилось, тож сторож
   * покриває ВСІ маршрути прогону.
   */
  it("I7: жодна родина не ходить на інструмент без схеми — сторож покриває всі", () => {
    expect(усіКлючіСхем().безСхеми).toEqual([]);
    expect(STYLE_KEYS.has("bodyTextStyles")).toBe(true);
    expect(STYLE_KEYS.has("style")).toBe(true);
  });

  /*
   * §2.5 передачі — ДРУГИЙ НАПРЯМОК, ЯКОГО ТУТ НЕ БУЛО.
   *
   * Сторож перевіряв лише «НАЗВИ_СТИЛІВ ⊆ STYLE_KEYS» — тобто що жоден
   * ЖИВИЙ ключ не випав із дзеркала. Протилежного він не питав ніколи, і
   * саме тому `styleName` (однина) пережив у наборі перейменування
   * `fc8f96d`: ключа з такою назвою в схемах уже не було, а тест мовчав.
   *
   * Мертвий запис не безневинний. Дзеркало — це перелік того, ЩО СТУПІНЬ 2
   * ЗВІРЯЄ З ДОКУМЕНТОМ; привид у ньому вчить наступного читача старій
   * формі й робить набір недостовірним рівно там, де в нього єдина робота —
   * бути достовірним. Той самий клас, що й перевірка вище, дзеркально: там
   * «схема пішла вперед, дзеркало відстало», тут «схема пішла вперед,
   * дзеркало лишило по собі труп».
   *
   * Зовнішні імена контейнерів (`folio`, `runningHead`) привидами НЕ Є:
   * вони справжні ключі схем, просто лежать у СВІДОМО_НЕ_НАЗВИ як
   * контейнери. Тому звірка йде з УСІМА ключами схем, а не лише з
   * НАЗВИ_СТИЛІВ.
   */
  it("§2.5: у STYLE_KEYS немає привидів — кожен запис існує в якійсь схемі", () => {
    const { ключі } = усіКлючіСхем();
    const живіОстанні = new Set(
      ключі.map((шлях) => шлях.split(/[.[]/).filter((s) => s !== "" && s !== "]").at(-1)!),
    );
    const привиди = [...STYLE_KEYS].filter((k) => !живіОстанні.has(k));
    expect(
      привиди,
      "цих ключів у схемах інструментів немає — вони вчать старій формі й " +
        "роблять дзеркало недостовірним. Приберіть їх із STYLE_KEYS.",
    ).toEqual([]);
  });
});

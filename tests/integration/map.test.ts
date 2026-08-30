import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runJsx } from "../../src/bridge/runner.js";
import { detectMasters } from "../../src/layout/masters.js";
import type { LayoutMeasure as FullLayoutMeasure, MasterItemRef, PageMeasure } from "../../src/layout/types.js";
import { registerMapTools } from "../../src/tools/map.js";
import type { Tools } from "../../src/tools/shared.js";
import {
  assertFixtureActive,
  closeFixtureDoc,
  makeFixtureDoc,
  makeLayoutFixtureDoc,
} from "./fixture-doc.js";

let docName = "";

beforeAll(async () => {
  docName = await makeLayoutFixtureDoc();
});

afterAll(async () => {
  if (docName) await closeFixtureDoc(docName);
});

it("фікстура має непарну кількість сторінок — саме вона зсуває recto/verso", async () => {
  await assertFixtureActive(docName);
  const overview = await runJsx<{ pageCount: number }>("doc_overview", {});
  /* 9, не 7 і не 5: Раунд виправлень 1 додав розворот 6-7 для односторонньої
   * батьківської, а 2026-08-05 — сторінки 8-9 заради перевизначеного фоліо з
   * убитим автономером. Непарність — властивість, що тестується тут, а не
   * конкретне число. */
  expect(overview.pageCount).toBe(9);
  expect(overview.pageCount % 2).toBe(1);
});

it("фікстура має абзацні стилі з відомими значеннями", async () => {
  await assertFixtureActive(docName);
  const overview = await runJsx<{ paragraphStyles: string[] }>("doc_overview", {});
  expect(overview.paragraphStyles).toContain("Osnovnyi");
  expect(overview.paragraphStyles).toContain("Spysok");
});

interface LayoutMeasure {
  docName: string;
  pages: { name: string; side: string; master: string | null; frameCount: number }[];
  paragraphs: {
    containerId: string;
    paragraphIndex: number;
    page: string | null;
    styleName: string;
    isMaster: boolean;
    declared: Record<string, unknown>;
    actual: Record<string, unknown>;
  }[];
}

/*
 * РЕЦЕНЗІЯ Задачі 8, п. Г: фікстурні рамки Задачі 8 (`extra`, `mixedFrame`,
 * `_fixtures.jsx`) теж лежать на сторінці "1" і теж мають paragraphIndex 0 у
 * своїй історії — після їхньої появи «сторінка "1" + paragraphIndex N» уже
 * НЕ однозначний адрес: кільком story на цій сторінці відповідає той самий
 * paragraphIndex. `.find()` і раніше повертав би правильний абзац лише
 * тому, що f1 створюється в `__fixture_make_layout` РАНІШЕ за нові рамки, а
 * `doc.stories` на практиці йде в порядку створення — це СПОСТЕРЕЖЕНА
 * поведінка рушія, а не гарантія API InDesign.
 *
 * Прив'язуємось до `containerId`: анкеримо його один раз через властивість,
 * яка відрізняє story f1 від УСІХ інших на сторінці "1" за побудовою —
 * styleName "Osnovnyi", застосований ЛИШЕ до f1 (`f1.texts[0]
 * .appliedParagraphStyle = osnovnyi`, `_fixtures.jsx`). Явна перевірка
 * довжини перед узяттям елемента: якщо ця унікальність колись-небудь
 * зламається (ще одна рамка зі стилем Osnovnyi), тест впаде тут голосно, а
 * не дасть хибний позитив нижче.
 */
function f1ContainerId(m: LayoutMeasure): string {
  const candidates = m.paragraphs.filter(
    (p) => !p.isMaster && p.page === "1" && p.paragraphIndex === 0 && p.styleName === "Osnovnyi",
  );
  expect(candidates).toHaveLength(1);
  return candidates[0]!.containerId;
}

it("layout_measure віддає оголошені й фактичні значення окремо", async () => {
  await assertFixtureActive(docName);
  const m = await runJsx<LayoutMeasure>("layout_measure", {});

  const onF1 = m.paragraphs.filter((p) => p.containerId === f1ContainerId(m));
  const clean = onF1.find((p) => p.paragraphIndex === 0);
  expect(clean?.declared.firstLineIndent).toBe(12);
  expect(clean?.actual.firstLineIndent).toBe(12);

  const overridden = onF1.find((p) => p.paragraphIndex === 1);
  expect(overridden?.declared.firstLineIndent).toBe(12);
  expect(overridden?.actual.firstLineIndent).toBe(24);
});

it("мішаний кегль віддається як null, а не як об'єкт", async () => {
  await assertFixtureActive(docName);
  const m = await runJsx<LayoutMeasure>("layout_measure", {});
  const mixed = m.paragraphs
    .filter((p) => p.containerId === f1ContainerId(m))
    .find((p) => p.paragraphIndex === 3);
  expect(mixed?.actual.pointSize).toBeNull();
});

it("мішаність, невидима для порівняння лише крайніх діапазонів, теж дає null (Important 2)", async () => {
  await assertFixtureActive(docName);
  const m = await runJsx<LayoutMeasure>("layout_measure", {});
  /*
   * Абзац 5 фікстури має ТРИ символьні діапазони: перший і останній — 8pt
   * (ОДНАКОВІ), середній — 16pt (інший). Мутант, що звіряє мішаність лише
   * "перший діапазон проти останнього" (а не проходить усі textStyleRanges),
   * на абзаці 3 (вище, лише 2 діапазони) пройшов би непоміченим — там
   * "перший↔останній" і "усі діапазони" дають той самий висновок. Тут —
   * ні: "перший↔останній" дав би 8 === 8 і хибно визнав би абзац НЕ
   * мішаним. Правильна реалізація має побачити середній діапазон (16) і
   * віддати null.
   */
  const target = m.paragraphs
    .filter((p) => p.containerId === f1ContainerId(m))
    .find((p) => p.paragraphIndex === 5);
  expect(target?.actual.pointSize).toBeNull();
});

it("leading: AUTO віддається назвою enum, а не розчиняється в null", async () => {
  await assertFixtureActive(docName);
  const m = await runJsx<LayoutMeasure>("layout_measure", {});
  /*
   * ВИМІРЯНО на робочій книжці користувача (читальний зонд, `doc.modified`
   * false → false до і після): `typeof Leading.AUTO === "object"`, а
   * `String(Leading.AUTO)` дає читабельне "AUTO". Крізь загальний
   * `IDMCP.propValue` (число-або-рядок) автоінтерліньяж перетворювався на
   * `null` — і тоді 128 абзаців тієї книжки, де AUTO стоїть І в стилі, І в
   * абзаці, звіт називав «мішаними» (інтерліньяж у них однаковий і чистий),
   * а 35 абзаців зі СПРАВЖНІМ перевизначенням (стиль AUTO, абзац числовий)
   * не могли дати знахідку в принципі.
   *
   * У фікстурі носій цього стану — f2 на сторінці "5": рамка без явного
   * абзацного стилю, тобто [Basic Paragraph], у якого інтерліньяж
   * автоматичний за замовчуванням.
   */
  const auto = m.paragraphs.filter((p) => !p.isMaster && p.page === "5")[0];
  expect(auto).toBeDefined();
  expect(auto!.declared.leading).toBe("AUTO");
  expect(auto!.actual.leading).toBe("AUTO");
});

it("розворот віддається цілим, з обома своїми сторінками", async () => {
  await assertFixtureActive(docName);
  const m = await runJsx<LayoutMeasure & { spreads: { pages: string[] }[] }>("layout_measure", {});
  /* 7 сторінок при facingPages: перший розворот — одна сторінка (обкладинка),
   * далі по дві. Точний склад звірте з тим, що показав зонд, Питання 4. */
  expect(m.spreads.length).toBeGreaterThan(1);
  expect(m.spreads.flatMap((s) => s.pages)).toHaveLength(9);
});

it("overset історії видно в карті", async () => {
  await assertFixtureActive(docName);
  const m = await runJsx<LayoutMeasure & { stories: { overflows: boolean }[] }>("layout_measure", {});
  expect(m.stories.some((s) => s.overflows)).toBe(true);
});

it("сторінка без батьківської віддає master: null", async () => {
  await assertFixtureActive(docName);
  const m = await runJsx<LayoutMeasure>("layout_measure", {});
  expect(m.pages[2]!.master).toBeNull();
});

interface ContentSignature {
  pageCount: number;
  storyCount: number;
  frameCount: number;
  pages: { name: string; master: string; masterItemCount: number }[];
  frames: { id: string; label: string }[];
  paragraphs: {
    containerId: string;
    paragraphIndex: number;
    styleName: string;
    firstLineIndent: number | null;
    pointSize: number | null;
    contents: string;
  }[];
}

it("layout_measure нічого не змінює в документі (Important 1)", async () => {
  /*
   * РАУНД ВИПРАВЛЕНЬ 1: перша версія цього тесту порівнювала
   * `document.modified` до/після виклику. Координатор показав це неправильним
   * у ДВА способи. По-перше: на СПІЛЬНІЙ фікстурі `docName` (яка сама будує
   * майстер-спред/стилі/рамки в тому самому виклику, що й повертає ім'я)
   * `modified` уже `true` ще ДО першого тесту в файлі — і лишається `true`
   * незалежно від того, чи щось пише `layout_measure`, тож порівняння
   * "до/після" на ній не могло впасти НІКОЛИ. По-друге: спроба дати чисту
   * базу через окремий "порожній" документ (`app.documents.add()` без
   * жодної подальшої правки) теж не рятує тест по суті — `modified` навіть
   * на чистій базі лишається монотонним прапорцем, який каже лише "щось
   * торкнулося документа", а не "що саме" (і не годиться, якщо потрібно
   * довести саме ВІДСУТНІСТЬ конкретних змін вмісту).
   *
   * Замість `modified` — сигнатура вмісту: незалежний від коду
   * `layout_measure` обхід (`__fixture_signature`, окрема функція, не
   * викликає `layout_measure` і не переймає його логіку), що читає кількість
   * сторінок/історій/рамок, `appliedMaster`+`masterPageItems.length` кожної
   * сторінки, `.label` кожної рамки (властивість, якої `layout_measure`
   * НІКОЛИ не читає — щоб мутант-запис саме в `.label` не сховався за тим,
   * що сам `layout_measure` про неї мовчить) і кілька перших абзаців
   * (стиль, firstLineIndent, pointSize, contents). Знімок ДО і ПІСЛЯ виклику
   * `layout_measure` мають збігатися ПОБАЙТОВО — глибока рівність, а не
   * порівняння прапорця.
   *
   * РАУНД ВИПРАВЛЕНЬ 2: перша версія сигнатурного тесту працювала на
   * СПІЛЬНІЙ фікстурі `docName` і покладалась на те, що вона стоїть ПЕРШОЮ
   * серед викликів `layout_measure` у файлі. Рецензент довів це недостатнім
   * експериментально: вставив перед тестом нешкідливий "розігрівний" виклик
   * `layout_measure` (без жодних тверджень) і наклав той самий мутант — усі
   * тести пройшли, тест повністю осліп. Причина та сама, що вже описана
   * вище для `modified`, лише на рівень нижче: мутант пише ІДЕМПОТЕНТНЕ
   * значення, і будь-який попередній виклик `layout_measure` на тій самій
   * фікстурі (розігрівний чи просто сусідній тест файлу) встигає внести те
   * саме забруднення в "до"-знімок ще до того, як цей тест його візьме.
   * Гарантія трималась не на конструкції тесту, а на тому, що він
   * ВИПАДКОВО перший за порядком рядків у файлі — властивість, яку зламав
   * би будь-хто, хто додав би вище ще один тест, що побіжно кличе
   * `layout_measure`.
   *
   * Правильний фікс — не позиція, а ІЗОЛЯЦІЯ: цей тест створює ВЛАСНИЙ
   * документ-фікстуру (не спільний `docName`), на якому `layout_measure`
   * гарантовано не викликався ЖОДНОГО разу до цього моменту, і закриває
   * його сам у `finally` — незалежно від сусідніх тестів, порядку рядків
   * у файлі чи того, впав тест сам чи ні.
   */
  const isolatedName = await makeLayoutFixtureDoc();
  try {
    await assertFixtureActive(isolatedName);
    const before = await runJsx<ContentSignature>("__fixture_signature", {});
    await runJsx("layout_measure", {});
    const after = await runJsx<ContentSignature>("__fixture_signature", {});
    expect(after).toEqual(before);
  } finally {
    await closeFixtureDoc(isolatedName);
  }
});

it(
  "detectMasters на фікстурі: перевизначено, видалено (фоліо), і без батьківської — три різні знахідки, " +
    "а не одна на всіх (Задача 7)",
  async () => {
    await assertFixtureActive(docName);
    const m = await runJsx<{ pages: PageMeasure[] }>("layout_measure", {});

    /*
     * Мапу "склад батьківської" будуємо з `expectedMasterItems`, які
     * `layout_measure` уже порахував ОКРЕМО для кожної сторінки, з
     * урахуванням її `.side` (виміряно: лівий і правий фоліо фікстури —
     * різні елементи з різними `.id`). Ключ `master#side` — той самий
     * формат, який `detectMasters` пробує першим (`src/layout/masters.ts`).
     */
    const masterItems = new Map<string, MasterItemRef[] | null>();
    for (const p of m.pages) {
      if (p.master !== null && p.side !== null) {
        masterItems.set(`${p.master}#${p.side}`, p.expectedMasterItems);
      }
    }

    const result = detectMasters(m.pages, masterItems);
    const byPage = (name: string) => result.findings.filter((f) => f.page === name);

    /* Сторінка "2" (LEFT_HAND): фоліо ПЕРЕВИЗНАЧЕНО фікстурою
     * (masterPageItems[0].override), контент (AUTO_PAGE_NUMBER) не займано —
     * тому це master-item-overridden, не folio-missing. */
    expect(byPage("2")).toHaveLength(1);
    expect(byPage("2")[0]?.defect).toBe("master-item-overridden");

    /* Сторінка "3" (RIGHT_HAND): без батьківської (NothingEnum.NOTHING) —
     * рівно одна знахідка master-none, без жодної додаткової на елементи. */
    expect(byPage("3")).toHaveLength(1);
    expect(byPage("3")[0]?.defect).toBe("master-none");

    /* Сторінка "4" (LEFT_HAND): фоліо ВИДАЛЕНО фікстурою (override +
     * remove) — той самий елемент батьківської, що на сторінці "2", тепер
     * зник повністю. Оскільки він несе AUTO_PAGE_NUMBER (isFolio),
     * очікуємо саме folio-missing, а не загальний master-item-missing. */
    expect(byPage("4")).toHaveLength(1);
    expect(byPage("4")[0]?.defect).toBe("folio-missing");

    /*
     * Сторінка "8" (LEFT_HAND): фоліо ПЕРЕВИЗНАЧЕНО, і автономер у ньому
     * замінено сталим текстом "8". Борг Фази 4, закритий 2026-08-05: доти
     * фікстура такого стану не містила, і шлях не можна було перевірити
     * чесно — а без нього цей випадок ішов звичайним master-item-overridden,
     * нарівні зі зсунутою лінійкою сторінки "2".
     *
     * Пара "2" ↔ "8" і є доказом: обидві сторінки для InDesign однакові
     * ("елемент батьківської перевизначено"), а різняться рівно тим, чи
     * лишився в елементі маркер автонумерації. Тест, що дивиться лише на "8",
     * проходив би й у детектора, який позначає БУДЬ-ЯКЕ перевизначення фоліо.
     */
    expect(byPage("8")).toHaveLength(1);
    expect(byPage("8")[0]?.defect).toBe("folio-missing");
    expect(byPage("8")[0]?.actual).toBe("overridden-without-auto-number");

    /* Сторінки "1", "5" і "9" — контроль, усе на місці, знахідок немає. */
    expect(byPage("1")).toHaveLength(0);
    expect(byPage("5")).toHaveLength(0);
    expect(byPage("9")).toHaveLength(0);
  },
);

it(
  "одностороння батьківська: сторінки з обох боків розвороту бачать ОДНАКОВИЙ склад " +
    "(Раунд виправлень 1, Important 1 — ловить \"сліпий індекс\" pages[0]/pages[1])",
  async () => {
    await assertFixtureActive(docName);
    const m = await runJsx<{ pages: PageMeasure[] }>("layout_measure", {});

    const page6 = m.pages.find((p) => p.name === "6");
    const page7 = m.pages.find((p) => p.name === "7");
    expect(page6?.side).toBe("LEFT_HAND");
    expect(page7?.side).toBe("RIGHT_HAND");
    /* Ім'я батьківської — НЕ "S": InDesign автоматично додає префікс
     * розвороту до baseName (виміряно тут-таки: "C-S", бо документ уже мав
     * дефолтну "A-..." і "B-L" перед нею) — точний префікс не є частиною
     * контракту, тож звіряємо лише що "6" і "7" бачать ОДНУ Й ТУ САМУ
     * батьківську, а не конкретне ім'я. */
    expect(page6?.master).not.toBeNull();
    expect(page7?.master).toBe(page6?.master);

    /*
     * Батьківська "S" — ОДНОСТОРОННЯ (`master.pages.length === 1` після
     * `.remove()` другої сторінки у фікстурі; `.side` єдиної сторінки —
     * `SINGLE_SIDED`, виміряно на живому InDesign, а не LEFT_HAND/RIGHT_HAND).
     * Правильна реалізація (`src/jsx/map.jsx`) бере єдину сторінку
     * НЕЗАЛЕЖНО від боку документної сторінки — тому склад на "6" (LEFT_HAND)
     * і на "7" (RIGHT_HAND) МУСИТЬ бути однаковим (той самий елемент, той
     * самий `.id`), і жодна з двох сторінок не повинна давати знахідок
     * (елемент батьківської присутній на обох, ніхто нічого не чіпав).
     *
     * "Сліпий індекс" (`pgSide === "LEFT_HAND" ? pages[0] : pages[1]`) на
     * сторінці "7" звертається до неіснуючого `pages[1]` (об'єкт з
     * `isValid === false`) — читання будь-якої властивості з нього кидає
     * помилку, тобто виклик `layout_measure` для ВСЬОГО документа впаде.
     * Цей тест мусить впасти і в такому разі (await відхилиться), і в разі,
     * якщо мутант тихо ковтне помилку — тоді `expectedMasterItems` на "7"
     * стане порожнім і перестане збігатися зі "6".
     */
    expect(page6?.expectedMasterItems).toHaveLength(1);
    expect(page7?.expectedMasterItems).toEqual(page6?.expectedMasterItems);

    const masterItems = new Map<string, MasterItemRef[] | null>();
    for (const p of m.pages) {
      if (p.master !== null && p.side !== null) {
        masterItems.set(`${p.master}#${p.side}`, p.expectedMasterItems);
      }
    }
    const result = detectMasters(m.pages, masterItems);
    const byPage = (name: string) => result.findings.filter((f) => f.page === name);
    expect(byPage("6")).toHaveLength(0);
    expect(byPage("7")).toHaveLength(0);
  },
);

/*
 * Задача 8: інструмент `document_map`. Головний запобіжник цієї фази —
 * перехресна перевірка з `doc_overview` (спек §9): мутуючої поверхні мало, і
 * помилка читання інакше проїде непоміченою.
 *
 * РАУНД ВИПРАВЛЕНЬ 1 (Critical). Перша версія трьох тестів нижче звірялася
 * не з інструментом `document_map`, а з сирим обробником `runJsx("layout_measure",
 * ...)` в обхід `src/tools/map.ts` — увесь продакшн-код обробника (передача
 * `pages` у `runJsx`, передача `headingStyles` у `buildMap`, обгортка
 * `ok`/`fail`) лишався непокритим, а назви тестів («карта звіряється з
 * doc_overview», «діапазон pages звужує вибірку») обіцяли протилежне.
 * Рецензент довів це п'ятьма мутантами обробника, що вижили. Виправлено:
 * тести звертаються до самого обробника через `toolHandler`, підробленим
 * `registerTool` — той самий патерн, що вже усталений у
 * tests/integration/composition-apply.test.ts.
 */
type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
type AnyHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

function toolHandler(name: string): AnyHandler {
  let captured: AnyHandler | null = null;
  const fakeServer = {
    registerTool: (n: string, _c: unknown, handler: AnyHandler) => {
      if (n === name) captured = handler;
    },
  } as unknown as Tools;
  registerMapTools(fakeServer);
  if (captured === null) throw new Error(`${name} не зареєстровано`);
  return captured;
}

const body = (r: ToolResult) => JSON.parse(r.content[0]!.text);

it("карта звіряється з doc_overview: кількість сторінок мусить збігтися", async () => {
  await assertFixtureActive(docName);
  const overview = await runJsx<{ pageCount: number }>("doc_overview", {});
  const map = body(await toolHandler("document_map")({}));
  expect(map.pageCount).toBe(overview.pageCount);
  expect(map.pages).toHaveLength(overview.pageCount);
});

it("карта звіряється з doc_overview: історії та їхній overset мусять збігтися", async () => {
  await assertFixtureActive(docName);
  const overview = await runJsx<{ stories: { containerId: string; overflows: boolean }[] }>(
    "doc_overview",
    {},
  );
  const map = body(await toolHandler("document_map")({}));
  expect(map.stories).toHaveLength(overview.stories.length);
  for (const s of overview.stories) {
    const mine = map.stories.find((x: { containerId: string }) => x.containerId === s.containerId);
    expect(mine?.overflows).toBe(s.overflows);
  }
});

it("діапазон pages справді звужує вибірку (мутант: pages не доходить до runJsx)", async () => {
  await assertFixtureActive(docName);
  const map = body(await toolHandler("document_map")({ pages: ["1"] }));
  expect(map.pages).toHaveLength(1);
  expect(map.pages[0].name).toBe("1");
});

it(
  "headingStyles доходить до buildMap і не плутається з pages " +
    "(мутанти: buildMap(measure) без headingStyles; buildMap(measure, pages))",
  async () => {
    await assertFixtureActive(docName);
    /*
     * Навмисно ОБИДВА параметри в одному виклику, з РІЗНИМИ значеннями:
     * `pages: ["1"]` і `headingStyles: ["Osnovnyi"]`. Якщо обробник передає
     * в buildMap не другим аргументом headingStyles, а pages (мутант
     * "buildMap(measure, pages)"), дерево шукатиме абзаци зі styleName "1" —
     * такого стилю немає, і headings лишиться порожнім масивом (не null:
     * довжина ["1"] — 1, тобто гілка "headingStyles задано" однаково
     * спрацює, просто шукатиме не те). Якщо ж мутант прибирає headingStyles
     * узагалі ("buildMap(measure)"), headings стане null незалежно від
     * того, що передав викликач. Правильна поведінка — непорожнє дерево з
     * усіма абзацами сторінки "1", застосованими стилем "Osnovnyi" (їх
     * шість: чистий і п'ять із перевизначеннями в різних групах).
     */
    const map = body(
      await toolHandler("document_map")({ pages: ["1"], headingStyles: ["Osnovnyi"] }),
    );
    expect(map.headings).not.toBeNull();
    expect(map.headings.length).toBeGreaterThan(0);
    expect(map.headings.every((h: { styleName: string }) => h.styleName === "Osnovnyi")).toBe(true);
  },
);

it("без headingStyles дерева немає (headings === null, а не порожній масив)", async () => {
  await assertFixtureActive(docName);
  const map = body(await toolHandler("document_map")({ pages: ["1"] }));
  expect(map.headings).toBeNull();
});

it("buildMap не оминається (мутант ok(measure) замість ok(buildMap(...))): тіло — DocumentMap, не сирий LayoutMeasure", async () => {
  await assertFixtureActive(docName);
  const map = body(await toolHandler("document_map")({}));
  /* DocumentMap несе styleInventory/pageCount і НЕ несе paragraphs — сирий
   * LayoutMeasure навпаки: paragraphs є, а styleInventory/pageCount немає.
   * Обхід buildMap віддав би саме сирий вимір. */
  expect(map.styleInventory).toBeDefined();
  expect(Array.isArray(map.styleInventory)).toBe(true);
  expect(map.pageCount).toBeDefined();
  expect(map.paragraphs).toBeUndefined();
});

/*
 * Задача 8, рецензія Задачі 2/3: фікстура «Задачі 7» обіцяє вісім станів,
 * а попередні тести цього файлу не торкались трьох конкретних полів —
 * `masterItems[].kind`, `frames[].isMaster` і ланцюжка `previousFrameId`/
 * `nextFrameId`. Нижче — саме вони, а не повторення вже покритого.
 */

it("masterItems[].kind — тип елемента батьківської, а не лише його id", async () => {
  await assertFixtureActive(docName);
  const m = await runJsx<{ pages: PageMeasure[] }>("layout_measure", {});
  /* Сторінка "1" — НЕТОРКНУТА (контроль): один елемент батьківської,
   * mLeft/mRight фікстури — TextFrame, доданий через `textFrames.add()`.
   * Сторінка "1" — RIGHT_HAND (непарна), тому бачить mRight, а не mLeft —
   * прямокутник mLeftRect (нижче) цієї сторінки не торкається. */
  const page1 = m.pages.find((p) => p.name === "1")!;
  expect(page1.masterItems).toHaveLength(1);
  expect(page1.masterItems[0]?.kind).toBe("TextFrame");
});

/*
 * ВИПРАВЛЕННЯ БЛОКЕРА ЗЛИТТЯ ФАЗИ 4. `__fixture_make_layout` до цієї правки
 * мала на батьківських ЛИШЕ TextFrame — тому дефект, знайдений на робочій
 * книжці користувача (`IDMCP.hasAutoPageNumber` падав на `.texts`
 * нетекстового елемента повз ВНУТРІШНІЙ try/catch; `kind` на живому
 * документі давав "PageItem" з обгортки замість справжнього типу), НЕ
 * відтворювався в жодному тесті цього файлу і дожив до фінальної рецензії.
 *
 * `mLeftRect` — прямокутник, доданий лише на mLeft (LEFT_HAND) стороні
 * батьківської "master". Сторінки "2" і "4" (LEFT_HAND, парні) бачать його
 * через `expectedMasterItems` (Задача 7): це рівно той код, що раніше
 * викликав `IDMCP.hasAutoPageNumber(mstItem)` на нетекстовому елементі.
 */
it(
  "нетекстовий елемент батьківської (Rectangle): kind — справжній тип, а не " +
    "\"PageItem\" з обгортки, і hasAutoPageNumber не падає",
  async () => {
    await assertFixtureActive(docName);
    const m = await runJsx<{ pages: PageMeasure[] }>("layout_measure", {});

    for (const pageName of ["2", "4"]) {
      const page = m.pages.find((p) => p.name === pageName)!;
      expect(page.side).toBe("LEFT_HAND");

      /* `null` тут означало б, що сторони майстра не знайдено — окремий стан
       * (див. layout/types.ts). Для цієї сторінки він був би самостійним
       * дефектом фікстури, тож стверджуємо його відсутність явно. */
      expect(page.expectedMasterItems, "композиція майстра невідома").not.toBeNull();
      const rect = page.expectedMasterItems!.find((it) => it.kind === "Rectangle");
      expect(rect, `сторінка "${pageName}": Rectangle відсутній серед expectedMasterItems`).toBeDefined();
      expect(rect!.kind).not.toBe("PageItem");
      expect(rect!.kind).not.toBeNull();
      /* Прямокутник не несе AUTO_PAGE_NUMBER — hasAutoPageNumber мусить
       * відпрацювати на ньому БЕЗ помилки (весь виклик layout_measure вище
       * вже пройшов) і віддати false, а не "не знайдено" через впалий виклик. */
      expect(rect!.isFolio).toBe(false);

      /* Текстова батьківська (фоліо) теж має бути серед expectedMasterItems —
       * прямокутник її не витіснив, обидва елементи присутні одночасно. */
      const folio = page.expectedMasterItems!.find((it) => it.isFolio === true);
      expect(folio?.kind).toBe("TextFrame");
    }
  },
);

it("frames[].isMaster — рамка на самій батьківській позначена окремо від рамок документа", async () => {
  await assertFixtureActive(docName);
  const m = await runJsx<FullLayoutMeasure>("layout_measure", {});
  /*
   * mLeft/mRight (фоліо батьківської) і "single-marker" (одностороння
   * батьківська "S") несуть текст — кожен утворює власну story на самій
   * батьківській (`story.textContainers[0].parent` — MasterSpread, не
   * Page), і тому потрапляє у плоский список `frames` нарівні з рамками
   * документа. Без розрізнення isMaster ці рамки батьківської нічим не
   * відрізнялися б від f1/f2 документа в тому самому масиві.
   */
  expect(m.frames.some((f) => f.isMaster)).toBe(true);
  expect(m.frames.some((f) => !f.isMaster)).toBe(true);
});

it("ланцюжок рамок: previousFrameId/nextFrameId — взаємно узгоджена пара, а не самі по собі id", async () => {
  /*
   * Фікстура верстки (`__fixture_make_layout`) навмисно НЕ має зчеплених
   * рамок — f1 і f2 там кожен сам собі story. Зчеплення f4→f5 несе інша,
   * вже наявна фікстура (`__fixture_make`, Задача 6) — власний, ІЗОЛЬОВАНИЙ
   * документ (той самий підхід, що й у тесті "layout_measure нічого не
   * змінює", вище): не торкається спільного `docName`, закривається сам.
   */
  const isolatedName = await makeFixtureDoc();
  try {
    await assertFixtureActive(isolatedName);
    const m = await runJsx<FullLayoutMeasure>("layout_measure", {});

    /* Історія зі СПЕЦИФІЧНО двома рамками в ланцюжку — єдина така в цій
     * фікстурі (таблиця й виноска f1 — окремі story з одним контейнером
     * кожна, f3 і f6 — по одному контейнеру). */
    const chainStory = m.stories.find((s) => s.frames === 2);
    expect(chainStory).toBeDefined();

    const chainFrames = m.frames.filter((f) => f.containerId === chainStory!.containerId);
    expect(chainFrames).toHaveLength(2);

    const first = chainFrames.find((f) => f.previousFrameId === null);
    const second = chainFrames.find((f) => f.previousFrameId !== null);
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first!.nextFrameId).toBe(second!.id);
    expect(second!.previousFrameId).toBe(first!.id);
    expect(second!.nextFrameId).toBeNull();
  } finally {
    await closeFixtureDoc(isolatedName);
  }
});

/*
 * РЕГРЕСІЯ ОБСЯГУ, не вмісту (знайдено живим прогоном на книжці користувача
 * після злиття Фази 4). Запит `document_map` на ТРИ сторінки віддавав 78 КБ і
 * не пролазив у відповідь MCP. Розклад був такий: `stories` — 39 967 байт
 * (51%), бо цикл ішов по ВСІХ 552 історіях документа, ігноруючи діапазон; а в
 * `pages` — 137 напрямних із 143 елементів.
 *
 * Наявні тести цього не ловили, бо перевіряють ВМІСТ відповіді, а не її
 * ОБСЯГ, і фікстура має два порядки менше історій за реальну книжку.
 */
describe("document_map — обсяг відповіді", () => {
  it("stories звужуються діапазоном, а не віддаються всі", async () => {
    await assertFixtureActive(docName);
    const all = body(await toolHandler("document_map")({}));
    const one = body(await toolHandler("document_map")({ pages: ["1"] }));
    expect(all.stories.length).toBeGreaterThan(1);
    expect(one.stories.length).toBeLessThan(all.stories.length);
  });

  it("напрямні не потрапляють у masterItems", async () => {
    await assertFixtureActive(docName);
    const map = body(await toolHandler("document_map")({}));
    const kinds = map.pages.flatMap((p: { masterItems: { kind: string }[] }) =>
      p.masterItems.map((i) => i.kind),
    );
    expect(kinds.length).toBeGreaterThan(0);
    expect(kinds).not.toContain("Guide");
  });

  /*
   * Друга половина того самого рішення: викинути напрямні із ПЕРЕЛІКУ — не те
   * саме, що приховати їхнє існування. Без цього тесту детектор, який просто
   * перестав би їх бачити (напр. `itemKind` почав віддавати null), проходив би
   * тест вище як «чисто», і карта мовчки стверджувала б, що напрямних немає.
   */
  it("guideCount рахує напрямні, викинуті з переліку", async () => {
    await assertFixtureActive(docName);
    const map = body(await toolHandler("document_map")({}));
    const pages = map.pages as { name: string; guideCount: number }[];

    for (const p of pages) {
      expect(typeof p.guideCount, `сторінка ${p.name}`).toBe("number");
    }

    const total = pages.reduce((s, p) => s + p.guideCount, 0);
    expect(
      total,
      "фікстура має напрямну на односторонній батьківській (_fixtures.jsx: guides.add) — " +
        "нуль тут означає, що її або не створено, або вже не видно",
    ).toBeGreaterThan(0);
  });
});

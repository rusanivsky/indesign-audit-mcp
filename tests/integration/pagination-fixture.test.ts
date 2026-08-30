import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runJsx } from "../../src/bridge/runner.js";
import { closeFixtureDoc } from "./fixture-doc.js";

/**
 * Фікстура Фази 6 мусить містити КОЖЕН стан, названий спеком §9 — інакше
 * зелений тест детектора не означає нічого. Той самий урок, що Фаза 5
 * заплатила окремою задачею: її фікстура не мала ні невживаного стилю, ні
 * масштабу ≠ 100, і три родини тестувались на порожньому місці.
 *
 * Перелік складено НАПЕРЕД, до першого рядка коду детекторів, і цей тест
 * стежить, щоб він не всох непомітно.
 */
/*
 * Назва НЕ фіксована: фікстура не зберігається на диск, тож InDesign дає їй
 * «Untitled-N». Беремо ту, яку повернув обробник, — так само, як решта
 * фікстур проєкту, і так само закриваємо ЛИШЕ її.
 */
let docName: string | null = null;

const REQUIRED_STATES = [
  /* --- folio --- */
  "folio-correct",
  "folio-drifted",
  "folio-wrong-side",
  "folio-no-marker",
  "folio-unparsable-page-name",
  /* --- contents --- */
  "contents-auto",
  "contents-manual-correct",
  "contents-stale",
  "contents-ambiguous",
  "contents-rotated",
  "contents-cross-spread",
  "contents-count-mismatch",
  "contents-out-of-order",
  /* --- стан, який відкрив зонд H6 --- */
  "anchored-number",
  /*
   * --- батьківська сторінка (спек §8) ---
   *
   * Додано Задачею 3F. Доти фікстура мала `masterCount: 0`, тобто третє
   * джерело рамок не перевірялося нічим: мутант «третє джерело вимкнено»
   * проходив зеленим на всіх 17 тестах виміру (звіт Задачі 3).
   */
  "master-folio-recto",
  "master-folio-verso",
  "master-running-head",
  "master-contents-number",
  /*
   * ТРИ СТАНИ, ЯКІ ДОДАВ ФІКС-РАУНД 3 (`f6b0e4c`) І НЕ ДОПИСАВ СЮДИ. Тест
   * порівнює множини на РІВНІСТЬ, тож коміт лишив цей файл червоним, а
   * рецензія `f6b0e4c` того не помітила, бо ганяла лише `pagination-measure`
   * і `pagination-audit`. Іронія рівно за темою файла: сторож переліку станів
   * сам випав із прогону.
   */
  "master-folio-with-heading-paragraph",
  "master-style-named-constructor",
  "master-group-leaf-outside-pages",
  /* --- стани Фази 7 (спек §8); нащо кожен — див. PHASE7_STATES --- */
  "folio-verso",
  "folio-broken-thread",
  "folio-anchored",
  "folio-master-thread",
  "folio-first-page",
  "folio-three-page-spread",
  "folio-no-literals",
  "folio-hidden-layer",
  "folio-rotated",
  /*
   * ВІСІМ СТАНІВ ЗАДАЧІ 4Б — борг фікстури, виданий рецензією `61134b5`
   * окремою задачею саме тому, що минулого разу борг розчинили в примітках і
   * три стани загубились так, що цей файл був червоний на `HEAD` цілий раунд.
   */
  "folio-verso-correct",
  "folio-locked",
  "folio-marker-unbound",
  "folio-marker-cross-spread",
  "folio-helper-layer-hidden",
  "folio-both-threads",
  "folio-last-page",
  "master-group-leaf-with-marker",
  /* --- стан Задачі 11Б: ДРУГИЙ замок (Питання 19) --- */
  "folio-layer-locked",
].sort();

/**
 * Стани ОДНОСТОРОННЬОЇ фікстури — окремий документ, і це не оформлення.
 *
 * `page.side` дорівнює `SINGLE_SIDED` рівно тоді, коли
 * `documentPreferences.facingPages === false`, а це властивість ДОКУМЕНТА:
 * у фейсинг-документі такої сторінки не буває в принципі (виміряно: усі 25
 * сторінок основної фікстури — `LEFT_HAND`/`RIGHT_HAND`). Тому рядок §8
 * «`SINGLE_SIDED` документ» неможливо додати до основної фікстури, не
 * зруйнувавши решту: перемикач один на весь документ.
 */
const REQUIRED_STATES_SINGLE = [
  "single-sided-page",
  "single-sided-master-folio",
  "single-sided-folio-manual",
].sort();

/**
 * Стани ФІКСТУРИ СЛУЖБОВОГО ЛАНЦЮЖКА — теж окремий документ (спек Фази 8, §8.2).
 *
 * Підстава та сама, що в односторонньої: службова рамка неодмінно потрапляє в
 * `overlaps` кожної колонцифри (виміряно, Питання 20 Фази 7), тож ланцюжок на
 * кожній сторінці перекрив би половину з 24 станів основної фікстури.
 *
 * ОДИН СТАН НА ДОКУМЕНТ: «цілий ланцюжок» і «ланцюжок із пропуском» —
 * взаємовиключні властивості одного документа.
 */
const REQUIRED_STATES_HELPER_CHAIN = [
  "helper-chain-complete",          /* негативний контроль: цілий ланцюжок → нуль знахідок */
  "helper-chain-gap",               /* `folio-helper-chain-gap` і крок 2 ремонту */
  "helper-chain-unordered",         /* `folio-helper-chain-unordered` і крок 3 ремонту */
  "helper-chain-hidden-layer",      /* `folio-helper-chain-hidden` і крок 4 ремонту */
  "helper-chain-duplicate-on-page", /* крок 1 ремонту — виміряний вхід C1 Фази 7 */
  "helper-chain-orphan-frame",      /* крок 1 ремонту, гілка `page === null` */
  "helper-chain-foreign-item",      /* `refusedToRemove` — чужа робота на нашому шарі */
  /*
   * НАЙВАЖЛИВІШИЙ, І ДОДАНИЙ ЗА ВИМІРОМ, А НЕ ЗА ЗАДУМОМ. Зонд H8 (Питання 2)
   * показав: дублювання сторінки лишає рамку на КОЖНІЙ сторінці й монотонний
   * порядок головної історії, тобто два інші детектори мовчать — а числа при
   * цьому вже з'їхали. Без цього стану найчастіша поломка не перевіряється.
   */
  "helper-chain-split",
].sort();

/*
 * КІЛЬКІСТЬ СТОРІНОК ВИВОДИТЬСЯ З РОЗКЛАДКИ, а не з виводу фікстури:
 *
 *   базовий документ                                        10
 *   сторінки під стани Фази 7 (11…21)                     + 11
 *   розворот із трьох сторінок (22, 23, 24)                + 3
 *   ОСТАННЯ сторінка, сама у своєму розвороті (25)         + 1
 *                                                          ----
 *                                                           25
 *
 * Частина станів власної сторінки не потребує («folio-first-page» на с. «1»,
 * «folio-master-thread» на батьківському розвороті, «folio-locked» на с. «4»,
 * «folio-verso-correct» на с. «8», «folio-broken-thread» на с. «7»), тому
 * доданих сторінок менше, ніж станів.
 *
 * ЧОТИРИ ДОДАНІ СТОРІНКИ ЗАДАЧІ 4Б (18…21) ЙДУТЬ ДО РОЗВОРОТУ З ТРЬОХ, а не
 * після нього: розворот із `allowPageShuffle = false` ламає парність, і кожен
 * доданий після нього розворот InDesign роздає по одній сторінці (виміряно
 * зондом — `spreads.add` дав ДВА розвороти по одній сторінці замість одного з
 * двох). Тому «остання сторінка» будується саме там і саме так: один
 * `spreads.add` у кінець і видалення зайвої сторінки, поки їх не лишиться 25.
 */
const EXPECTED_PAGES = 10 + 11 + 3 + 1;

/*
 * СТАНИ, ЯКИХ ФІКСТУРА ФАЗИ 6 НЕ МАЛА — спек §8.
 *
 * Перелік окремий від `REQUIRED_STATES` навмисно: той стежить, щоб склад
 * фікстури не всох, а цей називає рівно те, без чого відповідний розділ
 * Фази 7 тестувався б на порожньому місці. Урок повторився щонайменше тричі
 * за дві фази — тест, зелений на фікстурі без потрібного стану, не перевіряє
 * нічого, — тож поруч із кожним рядком стоїть, що саме він рятує.
 */
const PHASE7_STATES = [
  "folio-verso",             /* ручне число ПРАВОРУЧ і КРИВЕ — `oracle-mismatch` на verso */
  "folio-broken-thread",     /* `no-neighbour-frame`: ланцюжок ПОЧИНАЄТЬСЯ на цій сторінці */
  "folio-anchored",          /* обхід `allPageItems`, Питання 7 — `page.textFrames` сліпий */
  "folio-master-thread",     /* маршрут B, Питання 6 — сусід лежить на сторінці МАЙСТРА */
  "folio-first-page",        /* `no-siblings`: перша сторінка фейсинг-документа сама у розвороті */
  "folio-three-page-spread", /* `spread-not-pair`: сусідів двоє, а не один */
  "folio-no-literals",       /* §4.9 — детектори працюють саме на рамках без літералів */
  "folio-hidden-layer",      /* `folio-dormant-duplicate`, і що він НЕ `folio-marker-unbound` */
  "folio-rotated",           /* −90° як у книжці, і довільний кут — геометрія перекриття */
  /*
   * ЗАДАЧА 4Б. Кожен рядок нижче закриває стан, без якого відповідна ГІЛКА
   * перевірялась або на рукописному `ClaimFrame`, або взагалі ніяк.
   */
  "folio-verso-correct",     /* ПРАВИЛЬНА verso: без неї `NEXT_PAGE_NUMBER` не пише ніхто */
  "folio-locked",            /* `SkipReason: "locked-frame"` (§4.4 крок 7) не мав стану */
  "folio-marker-unbound",    /* «дефект, що друкується» №1 — на документі не бачив ніхто */
  "folio-marker-cross-spread", /* «дефект, що друкується» №2 — те саме */
  "folio-helper-layer-hidden", /* другий рядок таблиці §4.9: `ThreadLink.layerVisible === false` */
  "folio-both-threads",      /* §4.2: рамка через ДОКУМЕНТНИЙ і МАЙСТРОВИЙ ланцюжки одразу */
  "folio-last-page",         /* друга половина `no-siblings` — остання сторінка */
  "master-group-leaf-with-marker", /* `overlaps === null` + маркер → `folio-marker-unmeasured` */
  /*
   * ЗАДАЧА 11Б. Замок ШАРУ — не той самий стан, що замок рамки: виміряно
   * (Питання 19), що на замкненому шарі `frame.locked === false`, а запис
   * проходить. `folio-locked` цю гілку не покриває в принципі.
   */
  "folio-layer-locked",      /* `SkipReason: "locked-layer-frame"` — другий замок кроку 7 */
];

describe("фікстура pagination", () => {
  let made: { docName: string; states: string[]; pages: number };

  beforeAll(async () => {
    made = await runJsx<{ docName: string; states: string[]; pages: number }>(
      "__fixture_make_pagination",
      {},
      { timeoutMs: 180_000 },
    );
    docName = made.docName;
  });

  afterAll(async () => {
    if (docName !== null) await closeFixtureDoc(docName);
  });

  it("містить кожен стан, названий спеком §9", () => {
    expect(made.pages).toBe(EXPECTED_PAGES);
    expect(made.states.slice().sort()).toEqual(REQUIRED_STATES);
  });

  it("містить сімнадцять станів, потрібних Фазі 7", () => {
    for (const s of PHASE7_STATES) expect(made.states).toContain(s);
  });
});

/*
 * ОДНОСТОРОННЯ ФІКСТУРА — ОКРЕМИЙ ДОКУМЕНТ І ОКРЕМИЙ `describe`.
 *
 * `describe` тут другий у файлі навмисно: інтеграційний проєкт ганяється
 * послідовно (`fileParallelism: false`), а в InDesign «активний» документ один
 * на процес, тож два документи одночасно жити не можуть. Створюємо після того,
 * як `afterAll` вище закрив основну фікстуру.
 */
describe("одностороння фікстура pagination", () => {
  let singleName: string | null = null;
  let made: { docName: string; states: string[]; pages: number };

  beforeAll(async () => {
    made = await runJsx<{ docName: string; states: string[]; pages: number }>(
      "__fixture_make_pagination_single",
      {},
      { timeoutMs: 180_000 },
    );
    singleName = made.docName;
  });

  afterAll(async () => {
    if (singleName !== null) await closeFixtureDoc(singleName);
  });

  it("містить стани, яких фейсинг-документ дати не може", () => {
    expect(made.pages).toBe(3);
    expect(made.states.slice().sort()).toEqual(REQUIRED_STATES_SINGLE);
  });
});

/*
 * ФІКСТУРА СЛУЖБОВОГО ЛАНЦЮЖКА — третій `describe`, і документ тут не один, а
 * вісім: по одному на стан. Кожен закривається ОДРАЗУ після перевірки, у
 * `finally`, а не наприкінці — правило середовища, здобуте Фазою 7.
 */
describe("фікстура службового ланцюжка", () => {
  it("будує КОЖЕН названий стан, і рівно його", async () => {
    const seen: string[] = [];
    for (const state of REQUIRED_STATES_HELPER_CHAIN) {
      const made = await runJsx<{ docName: string; states: string[]; pages: number }>(
        "__fixture_make_helper_chain",
        { state },
        { timeoutMs: 180_000 },
      );
      try {
        expect(made.states).toEqual([state]);
        /* Дублювання додає сторінку — це частина виміряного стану, не збій. */
        expect(made.pages).toBe(state === "helper-chain-split" ? 7 : 6);
        seen.push(state);
      } finally {
        await closeFixtureDoc(made.docName);
      }
    }
    expect(seen.slice().sort()).toEqual(REQUIRED_STATES_HELPER_CHAIN);
  });
});

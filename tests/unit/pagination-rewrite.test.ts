/**
 * Тести Фази 7 — план переписування колонцифр.
 *
 * Другий describe і є ОРАКУЛ (спек §4.4): сім кроків придатності, кожен зі
 * своєю причиною відмови, плюс інваріант, який тримає всю фазу — придатна
 * рамка не міняє ЧИСЛА, лише спосіб його набору.
 */

import { describe, expect, it } from "vitest";
import {
  buildPageIndex,
  helperChainNeighbour,
  helperChainOffsets,
  planRewrite,
} from "../../src/pagination/rewrite.js";
import type {
  FrameVerdict,
  RewritePlan,
  SkipReason,
} from "../../src/pagination/rewrite-types.js";
import { HELPER_LAYER_NAME } from "../../src/pagination/topology.js";
import type { ClaimFrame, MarkerKind, PageRef, ThreadLink } from "../../src/pagination/types.js";

describe("типи rewrite-types (заготовка Фази 7)", () => {
  it("непридатна рамка несе SkipReason, придатна — ні", () => {
    const skipped: FrameVerdict = {
      frameId: "39017",
      page: "97",
      paragraphIndex: 0,
      eligible: false,
      reason: "locked-frame",
      current: null,
      expected: null,
      direction: null,
      route: null,
      resolvedBy: null,
    };
    const ready: FrameVerdict = {
      frameId: "39018",
      page: "96",
      paragraphIndex: 0,
      eligible: true,
      reason: null,
      current: 96,
      expected: 96,
      direction: "previous",
      route: "thread",
      resolvedBy: "main",
    };
    expect(skipped.reason).not.toBeNull();
    expect(ready.reason).toBeNull();
    expect(ready.current).toBe(ready.expected);
  });

  it("план несе planId, придатний для звірки з наступним запуском", () => {
    const plan: RewritePlan = {
      planId: "plan-1",
      docName: "book-a.indd",
      verdicts: [],
    };
    expect(plan.planId).not.toBe("");
    expect(plan.verdicts).toHaveLength(0);
  });
});

/* ── фікстури ─────────────────────────────────────────────────────────── */

function pageOf(over: Partial<PageRef> & { name: string; offset: number }): PageRef {
  return {
    side: "RIGHT_HAND",
    spreadIndex: 0,
    spreadSiblings: [],
    master: null,
    ...over,
  };
}

/**
 * Нормальний розворот фейсинг-книжки: verso, потім recto, суміжні `offset`.
 *
 * Саме на такому розвороті сусід за `offset` у напрямку маркера ТОТОЖНИЙ
 * `spreadSiblings` — тотожність, на яку спирається §4.3 і яку крок 3 оракула
 * забезпечує, відкидаючи розворот не з двох.
 */
function spread(verso: string, recto: string, firstOffset: number, spreadIndex: number): PageRef[] {
  return [
    pageOf({
      name: verso,
      offset: firstOffset,
      side: "LEFT_HAND",
      spreadIndex,
      spreadSiblings: [recto],
    }),
    pageOf({
      name: recto,
      offset: firstOffset + 1,
      side: "RIGHT_HAND",
      spreadIndex,
      spreadSiblings: [verso],
    }),
  ];
}

/** Розворот «96–97», тобто те, з чого складається робоча книжка. */
function pair96(): PageRef[] {
  return spread("96", "97", 0, 1);
}

function link(over: Partial<ThreadLink> & { storyId: string }): ThreadLink {
  return {
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

/**
 * Рамка колонцифри з одним абзацом.
 *
 * `overlaps: []` за замовчуванням — «перевірили, не перекриває», а НЕ «не
 * перевіряли»: `null` тут третій стан, і мовчазна підстановка його всім
 * фікстурам перевіряла б оракул на неміряному вході.
 */
function frameOf(
  pageName: string,
  literals: number[],
  over: Partial<ClaimFrame> = {},
  markers: MarkerKind[] = [],
): ClaimFrame {
  return {
    id: `f-${pageName}`,
    page: pageName,
    styleName: "Колонцифра",
    rotationAngle: -90,
    bounds: { y1: 0, x1: 0, y2: 10, x2: 10 },
    layerName: "Layer 1",
    layerVisible: true,
    layerPrintable: true,
    fromMaster: false,
    locked: false,
    layerLocked: false,
    overlaps: [],
    paragraphs: [
      {
        index: 0,
        styleName: null,
        text: "…",
        literals,
        markers,
        literalOffsets: literals.map((_, i) => i),
        baseline: 0,
        leading: 4,
      },
    ],
    ...over,
  };
}

/** Рамка на recto «97», що перекриває ДОКУМЕНТНИЙ ланцюжок із сусідом на «96». */
function threadedRecto(literal: number, over: Partial<ClaimFrame> = {}): ClaimFrame {
  return frameOf("97", [literal], {
    overlaps: [link({ storyId: "s", previousPage: "96", nextPage: "98" })],
    ...over,
  });
}

/* ── оракул ───────────────────────────────────────────────────────────── */

describe("planRewrite — сім кроків оракула (§4.4)", () => {
  const cases: {
    name: string;
    reason: SkipReason | null;
    build: () => { pages: PageRef[]; frames: ClaimFrame[] };
  }[] = [
    {
      name: "два літерали",
      reason: "multiple-literals",
      /* Яке з двох замінити — невідомо без оператора, і вгадування тут
       * означало б записати число, якого ніхто не питав. Обидва числа при
       * цьому «правильні» за оракулом — відмова саме через неоднозначність. */
      build: () => ({
        pages: pair96(),
        frames: [
          frameOf("97", [96, 97], { overlaps: [link({ storyId: "s", previousPage: "96" })] }),
        ],
      }),
    },
    {
      name: "SINGLE_SIDED",
      reason: "single-sided",
      build: () => ({
        pages: [pageOf({ name: "5", offset: 0, side: "SINGLE_SIDED" })],
        frames: [frameOf("5", [4])],
      }),
    },
    {
      name: "перша сторінка, сусідів немає",
      reason: "no-siblings",
      build: () => ({
        pages: [pageOf({ name: "1", offset: 0, spreadSiblings: [] })],
        frames: [frameOf("1", [2])],
      }),
    },
    {
      name: "розворот із трьох",
      reason: "spread-not-pair",
      build: () => ({
        pages: [
          pageOf({ name: "2", offset: 0, side: "LEFT_HAND", spreadIndex: 1, spreadSiblings: ["3", "4"] }),
          pageOf({ name: "3", offset: 1, spreadIndex: 1, spreadSiblings: ["2", "4"] }),
          pageOf({ name: "4", offset: 2, spreadIndex: 1, spreadSiblings: ["2", "3"] }),
        ],
        frames: [frameOf("3", [2])],
      }),
    },
    {
      name: "назва сусідньої сторінки «iv»",
      reason: "unparsable-page-name",
      build: () => ({ pages: spread("iv", "97", 0, 1), frames: [threadedRecto(96)] }),
    },
    {
      name: "число не дорівнює сусідові",
      reason: "oracle-mismatch",
      /* Виміряний дефект 2026-07-29 у його придатній формі: 94 замість 96. */
      build: () => ({ pages: pair96(), frames: [threadedRecto(94)] }),
    },
    {
      name: "перекриття немає",
      reason: "no-neighbour-frame",
      build: () => ({ pages: pair96(), frames: [frameOf("97", [96])] }),
    },
    {
      name: "сусід не на очікуваній сторінці",
      reason: "wrong-neighbour-page",
      build: () => ({
        pages: pair96(),
        frames: [
          frameOf("97", [96], { overlaps: [link({ storyId: "s", previousPage: "42" })] }),
        ],
      }),
    },
    {
      name: "рамка заблокована",
      reason: "locked-frame",
      build: () => ({ pages: pair96(), frames: [threadedRecto(96, { locked: true })] }),
    },
    {
      /*
       * ДРУГИЙ ЗАМОК, І ВІН НЕ ДУБЛЬ ПЕРШОГО (Питання 19). `frame.locked` для
       * рамки на замкненому шарі дорівнює `false` — виміряно, — тобто без
       * власного поля цей стан проходив крок 7 наскрізь і давав `eligible`.
       */
      name: "рамка на ЗАМКНЕНОМУ шарі",
      reason: "locked-layer-frame",
      build: () => ({ pages: pair96(), frames: [threadedRecto(96, { layerLocked: true })] }),
    },
    {
      name: "рамка на ПРИХОВАНОМУ шарі",
      reason: "hidden-layer-frame",
      build: () => ({ pages: pair96(), frames: [threadedRecto(96, { layerVisible: false })] }),
    },
    {
      name: "усе гаразд",
      reason: null,
      build: () => ({ pages: pair96(), frames: [threadedRecto(96)] }),
    },
  ];

  for (const c of cases) {
    it(`${c.name} → ${c.reason ?? "eligible"}`, () => {
      const { pages, frames } = c.build();
      const v = planRewrite(pages, frames, "backward", "thread")[0]!;
      expect(v.reason).toBe(c.reason);
      expect(v.eligible).toBe(c.reason === null);
    });
  }

  it("прихований шар відкидає рамку НАВІТЬ тоді, коли число сходиться ідеально", () => {
    /*
     * РІШЕННЯ ЗАДАЧІ 11 ПО ЗНАХІДЦІ ЗАДАЧІ 9, і воно свідомо коштує покриття.
     *
     * Стан виміряний, а не вигаданий: на фікстурі рамка `id=1473` («15», шар
     * `Numeratsiia`, `visible: false`, вміст «14–⟨previous⟩») давала
     * `eligible: true` — `current === expected === 14`, тобто ЗА ЧИСЛОМ
     * бездоганно. §4.9 при цьому називає той самий стан дефектом
     * `folio-dormant-duplicate`. Дві частини системи мовчки не згоджувались про
     * ту саму рамку.
     *
     * ЧОМУ ВІДМОВА, А НЕ НАЗВАНА МЕЖА — дві незалежні підстави, і перша
     * самодостатня:
     *
     * 1) КОРИСТЬ НУЛЬОВА, ЦІНА НІ. Рамка на прихованому шарі не друкується,
     *    тож зробити її самооновною не міняє НІЧОГО на аркуші — а §1 заради
     *    аркуша фазу й затіяли. Ціна натомість реальна: §4.9 відкриває себе
     *    словами «після успішної заміни `pagination_audit` на цій рамці сліпий
     *    НАЗАВЖДИ» (знахідки родяться лише в `if (para.literals.length > 0)`).
     *    Тобто заміна ВІДБИРАЄ літеральний сигнал у рамки, яку сама система вже
     *    класифікує як приспану міну.
     * 2) НЕ МІРЯНО. Питання 8 міряло прихований шар СЛУЖБОВОГО ЛАНЦЮЖКА (глушить
     *    розв'язання: у PDF 13 замість 12). Протилежної конфігурації — маркер у
     *    рамці на прихованому шарі над ВИДИМИМ ланцюжком — не міряв ніхто. Той
     *    самий прецедент, що `non-canonical-page-name`: «що саме друкує маркер —
     *    НЕ МІРЯНО, тому тут відмова, а не здогад» (§3 дозволяє втратити
     *    покриття й не дозволяє записати число, за яке ніхто не відповідає).
     *
     * НЕГАТИВНИЙ КОНТРОЛЬ ПОРУЧ ОБОВ'ЯЗКОВИЙ: та сама рамка з видимим шаром
     * придатна. Без нього тест був би зелений і тоді, коли оракул відкидає
     * взагалі все.
     */
    const hidden = threadedRecto(96, { layerVisible: false });
    const visible = threadedRecto(96);

    const v = planRewrite(pair96(), [hidden], "backward", "thread")[0]!;
    expect(v.eligible).toBe(false);
    expect(v.reason).toBe("hidden-layer-frame");
    /* Число встановлене й показане — відмова НЕ від того, що оракул не дійшов
     * до кроку 5: оператор бачить, що рамка «правильна», і все одно пропущена. */
    expect(v.current).toBe(96);
    expect(v.expected).toBe(96);

    expect(planRewrite(pair96(), [visible], "backward", "thread")[0]!.eligible).toBe(true);
  });

  it("`printable: false` рамкою НЕ керує — це інший прапорець з іншим виміром", () => {
    /*
     * Два булеві поля однакової форми поводяться протилежно (§4.8, Питання 8:
     * `visible = false` розв'язання ГЛУШИТЬ — 13 замість 12; `printable = false`
     * не ламає — 16 із 16). Сплутати їх — означало б або відкинути 91 рамку
     * дарма, або пропустити ту єдину, заради якої відмова існує.
     */
    const notPrintable = threadedRecto(96, { layerPrintable: false });
    expect(planRewrite(pair96(), [notPrintable], "backward", "thread")[0]!.eligible).toBe(true);
  });

  it("два замки — дві причини, і рамка з обома називає замок САМОЇ РАМКИ", () => {
    /*
     * ПОРЯДОК ТУТ НАВМИСНИЙ, А НЕ ВИПАДКОВИЙ, і саме тому запнутий тестом.
     * Причина в вердикті одна, а замків може бути два (Питання 19, стан D):
     * називається замок САМОЇ рамки, бо його оператор бачить на елементі.
     * Знявши лише його, оператор дістане на наступному плані
     * `locked-layer-frame` — тобто друга причина не губиться, вона стає видною
     * після зняття першої. Зворотний порядок відправляв би оператора до
     * панелі шарів по замок, який усе одно нічого не розблокує сам собою.
     */
    const both = threadedRecto(96, { locked: true, layerLocked: true });
    expect(planRewrite(pair96(), [both], "backward", "thread")[0]!.reason).toBe("locked-frame");

    const layerOnly = threadedRecto(96, { locked: false, layerLocked: true });
    expect(planRewrite(pair96(), [layerOnly], "backward", "thread")[0]!.reason).toBe(
      "locked-layer-frame",
    );

    /*
     * НЕГАТИВНИЙ КОНТРОЛЬ ДО ОБОХ: без замків та сама рамка придатна. Без
     * нього обидві перевірки вище справджувалися б і на оракулі, що відкидає
     * геть усе.
     */
    expect(planRewrite(pair96(), [threadedRecto(96)], "backward", "thread")[0]!.eligible).toBe(
      true,
    );
  });

  it("у придатної рамки expected ЗАВЖДИ дорівнює current", () => {
    /*
     * ГОЛОВНИЙ ІНВАРІАНТ ФАЗИ, а не властивість тесту (спек §3): інструмент не
     * сміє записати число, відмінне від того, що стоїть у рамці зараз. Наявні
     * ручні числа — готовий оракул, і придатність означає рівно «маркер
     * розв'яжеться в те саме число», а не «маркер щось покаже».
     */
    const pages = [...pair96(), ...spread("98", "99", 2, 2)];
    const frames = [
      threadedRecto(96),
      { ...threadedRecto(94), id: "f-mismatch" },
      { ...frameOf("97", [96]), id: "f-no-thread" },
      { ...threadedRecto(96, { locked: true }), id: "f-locked" },
      frameOf("99", [98], { overlaps: [link({ storyId: "s2", previousPage: "98" })] }),
    ];
    const verdicts = planRewrite(pages, frames, "backward", "thread");
    /* Непорожність придатних — інакше інваріант справджувався б порожньо, і
     * мутант, що відкидає геть усе, лишився б живим. */
    expect(verdicts.some((v) => v.eligible)).toBe(true);
    for (const v of verdicts) if (v.eligible) expect(v.expected).toBe(v.current);
  });

  it("рамка без літералів не потрапляє у вердикти взагалі", () => {
    /* Вона `alreadyAutomatic` — окремий лічильник поза `total` (§5.2), а не
     * `skipped`: інакше другий запуск дав би `balanced: false` на бездоганному
     * прогоні, бо вже переведені абзаци становитимуть більшість. */
    const auto = frameOf("97", [], { overlaps: [link({ storyId: "s", previousPage: "96" })] }, [
      "previous-page-number",
      "auto-page-number",
    ]);
    expect(planRewrite(pair96(), [auto], "backward", "thread")).toEqual([]);
  });

  it("range: forward дзеркалить напрямок І очікуване число", () => {
    /*
     * ДЗЕРКАЛЬНІСТЬ — ПАРАМЕТР, А НЕ ФАКТ ЦІЄЇ КНИЖКИ (§3.2, §4.3). Верстка,
     * що друкує на recto діапазон УПЕРЕД, дзеркальна до таблиці §4.3: ручне
     * число стоїть праворуч, маркер потрібен `NEXT_PAGE_NUMBER`, а називає
     * воно сторінку 98 — тобто НЕ сусіда по розвороту.
     *
     * На робочій книжці цей бік не трапляється жодного разу (Питання 2: 91 із
     * 91 — `backward`), тож покрити його може лише тест.
     */
    const pages = [...pair96(), ...spread("98", "99", 2, 2)];
    const f = frameOf("97", [98], {
      overlaps: [link({ storyId: "s", previousPage: "96", nextPage: "98" })],
    });
    const v = planRewrite(pages, [f], "forward", "thread")[0]!;
    expect(v.direction).toBe("next");
    expect(v.expected).toBe(98);
    expect(v.eligible).toBe(true);

    /* Та сама рамка при неоголошеному напрямку — саме той `oracle-mismatch`
     * на 100 % рамок, який §4.3 обіцяє книжці з протилежною конвенцією. */
    expect(planRewrite(pages, [f], "backward", "thread")[0]!.reason).toBe("oracle-mismatch");
  });

  it("verso: напрямок NEXT, очікуване число — recto того самого розвороту", () => {
    /* Обидва боки обов'язкові (§4.3): на цій книжці verso-колонцифр НУЛЬ
     * (Питання 1, повний перелік), і інструмент, що вміє лише recto, тихо
     * пропустив би іншу книжку. */
    const f = frameOf("96", [97], { overlaps: [link({ storyId: "s", nextPage: "97" })] });
    const v = planRewrite(pair96(), [f], "backward", "thread")[0]!;
    expect(v.direction).toBe("next");
    expect(v.expected).toBe(97);
    expect(v.eligible).toBe(true);
  });

  it("придатний вердикт несе адресу, напрямок, маршрут і ДЖЕРЕЛО, а не самий прапорець", () => {
    const v = planRewrite(pair96(), [threadedRecto(96)], "backward", "thread")[0]!;
    /*
     * ПОРІВНЯННЯ ЦІЛИМ ОБ'ЄКТОМ, А НЕ ПОПОЛЬОВО, І ЦЕ ВЖЕ СПРАЦЮВАЛО: нове
     * поле `resolvedBy` (I7) червонило саме цей тест, тобто перелік того, що
     * вердикт обіцяє операторові, лишається повним, а не «тим, що згадали».
     */
    expect(v).toEqual({
      frameId: "f-97",
      page: "97",
      paragraphIndex: 0,
      eligible: true,
      reason: null,
      current: 96,
      expected: 96,
      direction: "previous",
      route: "thread",
      resolvedBy: "main",
    });
  });

  it("overlaps === null — НЕ придатна за жодного маршруту", () => {
    /*
     * ТРИ СТАНИ `overlaps`, І `?? []` ЗАБОРОНЕНО. `null` означає «перекриттів
     * НЕ РАХУВАЛИ» (власні межі рамки невідомі), а не «не перекриває». Звести
     * його до `[]` означало б: під `thread` — назвати причиною
     * `no-neighbour-frame` те, чого ніхто не міряв, а під `helper` і `auto` —
     * оголосити рамку ПРИДАТНОЮ, тобто записати маркер там, де невідомо, чи
     * не перебиває його основний ланцюжок (§4.2). Друге — брехливий маркер,
     * тобто гірший режим відмови за §3.
     */
    const f = frameOf("97", [96], { overlaps: null });
    for (const route of ["thread", "helper", "auto"] as const) {
      const v = planRewrite(pair96(), [f], "backward", route)[0]!;
      expect(v.eligible).toBe(false);
      expect(v.reason).toBe("overlaps-unmeasured");
    }
  });

  it("МАЙСТРОВЕ перекриття не є маршрутом A — рамка йде в helper", () => {
    /*
     * АРИФМЕТИКА РОБИТЬ ЦЕ ВИРІШАЛЬНИМ (§4.2): на робочій книжці перекриття
     * дістали 90 рамок із 91, УСІ майстрові. Якби вони рахувались, оракул
     * примусив би `thread`, на мертвому ланцюжку не зійшовся б, і
     * `pagination_apply` полагодив би ОДНУ рамку з 91, доповівши про 90
     * законних пропусків — рівно той тихий відмовний режим, проти якого §3.
     *
     * Ланцюжок майстра для документної сторінки не розв'язується взагалі
     * (Питання 6 і 13), тож він і не перебиває службового.
     */
    const f = frameOf("97", [96], {
      overlaps: [
        link({ storyId: "m", previousPage: "96", fromMaster: true }),
        /* Службова рамка ПІД колонцифрою — те, чим маршрут `helper` і
         * доводиться порамково (C1). Без неї рамка була б непридатна не через
         * майстрове перекриття, а через відсутність доказу, і тест перевіряв
         * би не те, що обіцяє назвою. */
        link({
          storyId: "h",
          layerName: HELPER_LAYER_NAME,
          createdOrder: 9000,
          previousPage: "96",
        }),
      ],
    });
    const v = planRewrite(pair96(), [f], "backward", "auto")[0]!;
    expect(v.route).toBe("helper");
    expect(v.eligible).toBe(true);
  });

  it("документне перекриття примушує thread — службова рамка його не рятує", () => {
    /*
     * Виміряно (Питання 9, 5 випадків із 5): виграє ланцюжок, СТВОРЕНИЙ
     * РАНІШЕ, а службовий додається в готовий документ ОСТАННІМ. Отже там, де
     * колонцифра перекриває основний текст, маркер візьме число з нього — і
     * `helper` як прохання оператора нічого не змінює.
     */
    const f = frameOf("97", [96], { overlaps: [link({ storyId: "s", previousPage: "42" })] });
    for (const route of ["auto", "helper"] as const) {
      const v = planRewrite(pair96(), [f], "backward", route)[0]!;
      expect(v.eligible).toBe(false);
      expect(v.reason).toBe("wrong-neighbour-page");
    }
  });

  it("helper: сусід за offset — ПЕРЕДБАЧЕННЯ, і воно живе лише в оголошеному прогнозі", () => {
    /*
     * §4.2: службова історія зшита в порядку сторінок, сусідня рамка —
     * сторінка ±1 НА МОМЕНТ ОПЕРАЦІЇ. Доти цей тест твердив, що рамка БЕЗ
     * ПЕРЕКРИТТІВ придатна, «хоча жодного ланцюжка під нею сьогодні немає», —
     * і це було рівно те твердження, яким інструмент записував брехливі
     * маркери: посторінковий перелік відповідав про СТОРІНКУ на питання про
     * РАМКУ (C1, три відтворені входи).
     *
     * Передбачення лишається — але тільки там, де його оголосили явно, тобто
     * в `create-helper-thread`, який колонцифр не чіпає взагалі. Без прогнозу
     * та сама рамка тепер відмовляється.
     */
    const forecast = planRewrite(
      pair96(),
      [frameOf("97", [96])],
      "backward",
      "helper",
      "contract",
    )[0]!;
    expect(forecast.route).toBe("helper");
    expect(forecast.eligible).toBe(true);
    expect(forecast.expected).toBe(96);

    const measured = planRewrite(pair96(), [frameOf("97", [96])], "backward", "helper")[0]!;
    expect(measured.eligible).toBe(false);
    expect(measured.reason).toBe("no-neighbour-frame");
  });

  it("порядок кроків: криве число діагностується ДО топології й до замка", () => {
    /*
     * §4.4 наказує саме цей порядок: дешеві відмови першими, `oracle-mismatch`
     * ПЕРЕД перевіркою маркера — щоб рамка з кривим числом не діагностувалася
     * як топологічна проблема й не відправляла оператора лагодити ланцюжок.
     */
    const locked = planRewrite(pair96(), [threadedRecto(94, { locked: true })], "backward", "thread");
    expect(locked[0]!.reason).toBe("oracle-mismatch");
    const unmeasured = planRewrite(
      pair96(),
      [frameOf("97", [94], { overlaps: null })],
      "backward",
      "thread",
    );
    expect(unmeasured[0]!.reason).toBe("oracle-mismatch");
  });

  it("сторінки немає у вимірі — «не порівнювали», а не «немає сусіда»", () => {
    /* Ні власної сторінки рамки, ні сторінки-сусіда вимір може не мати. Обидва
     * випадки — «не міряли», і назвати їх `no-siblings` означало б доповісти
     * оператору причину, якої ніхто не встановлював. */
    const orphan = planRewrite(pair96(), [frameOf("55", [54])], "backward", "thread")[0]!;
    expect(orphan.reason).toBe("page-unmeasured");

    /* Сусід оголошений у `spreadSiblings`, але самої сторінки у вимірі немає. */
    const lonely = pageOf({ name: "97", offset: 1, spreadIndex: 1, spreadSiblings: ["96"] });
    const noSib = planRewrite([lonely], [threadedRecto(96)], "backward", "thread")[0]!;
    expect(noSib.reason).toBe("page-unmeasured");
  });

  it("одиниця — АБЗАЦ-твердження: два абзаци з числами дають два вердикти", () => {
    /* §4.4 і §5.2: одиниця скрізь одна, інакше `reconciliation.balanced`
     * віддає `false` без жодної втрати. */
    const f = threadedRecto(96);
    f.paragraphs.push({ ...f.paragraphs[0]!, index: 1, literals: [94], literalOffsets: [0] });
    const verdicts = planRewrite(pair96(), [f], "backward", "thread");
    expect(verdicts.map((v) => v.paragraphIndex)).toEqual([0, 1]);
    expect(verdicts.map((v) => v.reason)).toEqual([null, "oracle-mismatch"]);
  });
});

/* ── контракт службового ланцюжка (§4.2) ──────────────────────────────── */

describe("СЛУЖБОВИЙ ЛАНЦЮЖОК МУСИТЬ БУТИ СУЦІЛЬНИМ (§4.2)", () => {
  /** Книжка цієї фази в мініатюрі: колонцифри лише на recto, 96–99. */
  function fourPages(): PageRef[] {
    return [...pair96(), ...spread("98", "99", 2, 2)];
  }

  function offsets(pages: PageRef[]): Map<number, PageRef> {
    return new Map(pages.map((p) => [p.offset, p]));
  }

  it("маркер дає сторінку ПОПЕРЕДНЬОЇ РАМКИ ланцюжка, а не «offset − 1»", () => {
    /*
     * ВИМІРЯНА МЕЖА, А НЕ АРИФМЕТИКА: `PREVIOUS_PAGE_NUMBER` віддає сторінку
     * `previousPage` — сторінку попередньої РАМКИ ланцюжка (H6, випадок C,
     * записано при `ThreadLink`). Ці дві величини збігаються рівно тоді, коли
     * службова рамка стоїть на КОЖНІЙ сторінці.
     *
     * Ланцюжок «там, де є колонцифра» на цій книжці стоїть лише на непарних —
     * і рамка на с. 99 дістає 97 замість 98. Помножити на 91 рамку книжки:
     * 91 брехливий маркер із 91, кожен на одиницю менший за правильний і
     * кожен на вигляд правильний (§3, гірший режим відмови).
     */
    const pages = fourPages();
    const page99 = pages[3]!;

    /* Ланцюжок із пропуском — рамки лише на recto (offset 1 і 3). */
    expect(helperChainNeighbour([1, 3], offsets(pages), page99, "previous")?.name).toBe("97");

    /* Ланцюжок за контрактом — рамка на КОЖНІЙ сторінці. */
    expect(
      helperChainNeighbour(helperChainOffsets(pages), offsets(pages), page99, "previous")?.name,
    ).toBe("98");
  });

  it("придатність на helper прив'язана до ФАКТИЧНО ВЖИТОГО переліку, а не до свіжого виклику", () => {
    /*
     * СТОРОЖ ПРИПУЩЕННЯ, І ВІН НАВМИСНО ЗВІРЯЄ ДВІ ВЕЛИЧИНИ, А НЕ ЛІТЕРАЛИ.
     * Оракул обіцяє надрукувати `expected`; ланцюжок надрукує те, що віддасть
     * `helperChainNeighbour` на переліку сторінок із контракту. Поки контракт
     * каже «рамка на КОЖНІЙ сторінці», ці дві величини тотожні. Звузьте
     * контракт до «сторінок, де є колонцифра» — на цій книжці це самі recto —
     * і тотожність зникає: для с. 99 ланцюжок дасть 97, а оракул обіцяв 98.
     *
     * ПЕРЕЛІК БЕРЕТЬСЯ З `buildPageIndex`, А НЕ ЗІ СВІЖОГО `helperChainOffsets`,
     * І ЦЕ ВСЯ СУТЬ ПРАВКИ. Доти сторож звіряв обіцянку оракула з власним
     * свіжим викликом, тобто дві сторони тотожності бралися з РІЗНИХ місць —
     * і рецензент `bd3c602` протиснув між ними пару мутантів: звузити контракт
     * на місці виклику І прибрати перевірку кроку 6 давало `1260 passed`,
     * тобто мовчазні «91 брехливий маркер із 91». Тепер побудова одна на
     * `planRewrite` і на тест, і розійтись їм ніде.
     *
     * Літеральні 96 і 98 тут теж стоять — інакше обидві сторони могли б
     * зіпсуватись однаково й тотожність справдилась би порожньо.
     *
     * Другу сторону контракту — що рамка СПРАВДІ є на кожній сторінці —
     * закриває будівник ланцюжка (Задача 10).
     */
    const pages = fourPages();
    const frames = [frameOf("97", [96]), frameOf("99", [98])];
    const verdicts = planRewrite(pages, frames, "backward", "auto", "contract");

    expect(verdicts.map((v) => v.route)).toEqual(["helper", "helper"]);
    expect(verdicts.map((v) => v.expected)).toEqual([96, 98]);
    expect(verdicts.every((v) => v.eligible)).toBe(true);

    const used = buildPageIndex(pages, "contract");
    /* Тип індексу звужується явно: у стані `measured` переліку сторінок немає
     * взагалі, і саме цим він відрізняється від передбачення (C1). */
    if (used.chain.kind === "measured") throw new Error("очікували передбачення за контрактом");
    for (const [i, page] of [pages[1]!, pages[3]!].entries()) {
      const chain = helperChainNeighbour(used.chain.offsets, used.byOffset, page, "previous");
      expect(chain?.name).toBe(String(verdicts[i]!.expected));
    }
  });

  it("ланцюжок із ПРОПУСКОМ → відмова, а не передбачення за невиконаним правилом", () => {
    /*
     * СТОРОЖ САМОЇ УМОВИ КРОКУ 6 НА МАРШРУТІ `helper`. Доти цю умову не вбивав
     * жоден мутант, і це доводилось: `chainOffsets` за побудовою дорівнював
     * `offset` УСІХ виміряних сторінок, тож розійтись із сусідом за `offset`
     * він не міг на жодному вході — а такий вхід крок 3 однаково відкидав
     * (`page-unmeasured` / `no-neighbour-page`). Умова була сторожем, якого не
     * можна перевірити, тобто обіцянкою.
     *
     * Відколи покриття передається (`planRewrite(..., chainOffsets)`, §4.5),
     * порушення контракту — звичайний вхід. Ланцюжок лише на recto (`[1, 3]`)
     * — це рівно те, що виміряно в Питанні 18: мітка над такою рамкою друкує
     * сторінку ПОПЕРЕДНЬОЇ РАМКИ ЛАНЦЮЖКА, тобто для с. 99 «97» замість «98».
     * А рамка на с. 97 у цьому ланцюжку ПЕРША, і там теж є вимір: мітка на
     * с. 1 того самого зонда надрукувала ВЛАСНУ сторінку («1»), а не
     * порожнечу. Тобто друкується 97 замість обіцяних 96 — обидва вердикти
     * брехливі, обидва мусять стати відмовами.
     *
     * ДВІ ПРИЧИНИ, А НЕ ОДНА: «сусідньої рамки в ланцюжку немає взагалі» і
     * «сусідня рамка є, але не на тій сторінці» — різні стани, і назвати
     * перший `wrong-neighbour-page` означало б доповісти причину, якої ніхто
     * не встановлював.
     */
    const pages = fourPages();
    const frames = [frameOf("97", [96]), frameOf("99", [98])];
    const verdicts = planRewrite(pages, frames, "backward", "auto", {
      offsets: [1, 3],
      /* Обидві колонцифри службову рамку ДІСТАЛИ — інакше відмова прийшла б із
       * порамкового покриття (I2), і сторож посторінкового пропуску мовчав би
       * так само зелено, як доти. */
      folioFrameIds: frames.map((f) => f.id),
    });

    expect(verdicts.map((v) => v.eligible)).toEqual([false, false]);
    expect(verdicts.map((v) => v.reason)).toEqual(["no-neighbour-frame", "wrong-neighbour-page"]);
    /* Маршрут і очікуване число встановлені — відмова тут топологічна, а не
     * «не дійшли». Оператор мусить бачити, що саме оракул обіцяв. */
    expect(verdicts.map((v) => v.route)).toEqual(["helper", "helper"]);
    expect(verdicts.map((v) => v.expected)).toEqual([96, 98]);
  });

  it("передане покриття НОРМАЛІЗУЄТЬСЯ раз, а не на кожну рамку", () => {
    /*
     * `helperChainNeighbour` шукає у ВПОРЯДКОВАНОМУ переліку без повторів, і
     * впорядкування підняте в `helperChainOffsets`/`buildPageIndex` — рівно з
     * тієї причини, з якої там живе `nameCount`: інакше `Set` + `sort` робились
     * би на КОЖНУ рамку (рецензія `bd3c602`, М5).
     *
     * Тому перелік, переданий у безладі й із повторами, мусить дати той самий
     * вердикт, що й упорядкований.
     */
    const frames = [frameOf("97", [96]), frameOf("99", [98])];
    const messyCoverage = {
      offsets: [3, 1, 3, 0, 2, 0],
      folioFrameIds: frames.map((f) => f.id),
    };

    const index = buildPageIndex(fourPages(), messyCoverage);
    if (index.chain.kind === "measured") throw new Error("очікували передбачення за звітом");
    expect(index.chain.offsets).toEqual([0, 1, 2, 3]);
    expect(helperChainOffsets(fourPages())).toEqual([0, 1, 2, 3]);

    const messy = planRewrite(fourPages(), frames, "backward", "auto", messyCoverage);
    expect(messy.every((v) => v.eligible)).toBe(true);
  });
});

/* ── чотири входи рецензії f5d3509 на хибне «придатна» ────────────────── */

describe("оракул порівнює ЧИСЛО, а на аркуші РЯДОК (B2, B4)", () => {
  it("дві однойменні сторінки → відмова, а не чужий розворот", () => {
    /*
     * ПРОБА A рецензії, відтворена: `byName` лишає ОСТАННЮ з однойменних, тож
     * рамка на ПЕРШІЙ «97» звірялася з розворотом `42|97` і дала
     * `eligible: true` з `current: 42` — а надрукувалося б 96.
     *
     * Розрізнити дві однойменні сторінки не можна, але ВИЯВИТИ дублікат —
     * можна, і саме виявність дозволяє відмовитись замість вгадувати.
     */
    const pages = [...pair96(), ...spread("42", "97", 2, 2)];
    const v = planRewrite(pages, [frameOf("97", [42])], "backward", "auto")[0]!;
    expect(v.eligible).toBe(false);
    expect(v.reason).toBe("ambiguous-page-name");
  });

  it("назва сусіда «096» → відмова: маркер друкує РЯДОК, а не число", () => {
    /*
     * ПРОБА B рецензії: `pageNumber("096")` дає 96, літерал 96 збігається, і
     * рамка виходила придатною — а на аркуші замість «96» стало б «096».
     * Стиль нумерації секції «001, 002, 003» — штатний вибір InDesign.
     *
     * ЩО САМЕ ДРУКУЄ МАРКЕР ПРИ НЕЦИФРОВІЙ ФОРМІ НАЗВИ — НЕ МІРЯНО. Тому
     * відмова, а не здогад: над-відмова тут правильний бік помилки (§3).
     */
    const pages = spread("096", "097", 0, 1);
    const v = planRewrite(pages, [frameOf("097", [96])], "backward", "auto")[0]!;
    expect(v.eligible).toBe(false);
    expect(v.reason).toBe("non-canonical-page-name");
  });
});

describe("майстрова рамка: один об'єкт — N вердиктів (B3)", () => {
  /** Той самий фізичний майстровий об'єкт, видимий зі с. 97 і зі с. 99. */
  function masterTwice(): ClaimFrame[] {
    return [
      frameOf("97", [96], { id: "39017", fromMaster: true }),
      frameOf("99", [98], { id: "39017", fromMaster: true }),
    ];
  }

  it("майстрова рамка непридатна", () => {
    /*
     * ПРОБА H рецензії: `page.masterPageItems` дає запис на КОЖНУ сторінку з
     * тим майстром, а `id` запису — `String(item.id)` самого об'єкта, тобто
     * ОДИН на всі записи. Оракул віддавав два придатні вердикти з одним
     * `frameId` і різними `expected` (96 і 98) — план, що суперечить сам собі,
     * і Задача 9 не має чим обрати між ними. Писати в непереозначений елемент
     * майстра однаково не можна: запис, якби пройшов, змінив би ВСІ сторінки
     * з цим майстром.
     */
    const pages = [...pair96(), ...spread("98", "99", 2, 2)];
    const verdicts = planRewrite(pages, masterTwice(), "backward", "auto");
    expect(verdicts.map((v) => v.reason)).toEqual(["master-frame", "master-frame"]);
  });

  it("жодні два придатні вердикти з одним frameId не обіцяють РІЗНИХ чисел", () => {
    /*
     * ІНВАРІАНТ ПЕРЕПИСАНО, БО ПОПЕРЕДНЄ ФОРМУЛЮВАННЯ БУЛО ХИБНЕ Й ПОРОЖНЄ
     * ВОДНОЧАС (рецензія `bd3c602`, М2).
     *
     * ХИБНЕ: казало «жоден `frameId` не дає ДВОХ ПРИДАТНИХ вердиктів». Але
     * одиниця плану — АБЗАЦ-твердження, і рамка з двома абзацами-твердженнями
     * законно дає два придатні вердикти з одним `frameId` (проба P1
     * рецензента: `f-97` двічі, обидва `expected: 96`). Задача 9, узявши те
     * формулювання за передумову й здедуплікувавши план за `frameId`, тихо
     * викинула б один із двох законних записів.
     *
     * ПОРОЖНЄ: стояло на фікстурі, де ВСІ вердикти — `master-frame`, тож
     * `eligibleIds` був порожній і рядок звучав `0 === 0`. Впасти він не міг:
     * прибери відмову — і першим упав би рядок про причини, до інваріанта
     * виконання б не дійшло.
     *
     * Небезпечний стан, який B3 закриває, — інший: ОДИН `frameId` із РІЗНИМИ
     * `expected`. Саме його й перевіряємо, і саме він з'являється, щойно
     * прибрати відмову майстровій рамці: 96 зі с. 97 і 98 зі с. 99.
     */
    const pages = [...pair96(), ...spread("98", "99", 2, 2)];
    /* Законний стан у тій самій фікстурі: одна рамка, ДВА абзаци-твердження,
     * обидва з тим самим числом. Він мусить лишитись придатним — інакше
     * інваріант забороняв би те, що спек дозволяє. */
    const twoParas = threadedRecto(96);
    twoParas.paragraphs.push({ ...twoParas.paragraphs[0]!, index: 1 });
    const verdicts = planRewrite(pages, [...masterTwice(), twoParas], "backward", "auto");

    const eligible = verdicts.filter((v) => v.eligible);
    const promisedBy = new Map<string, Set<number | null>>();
    for (const v of eligible) {
      const seen = promisedBy.get(v.frameId) ?? new Set<number | null>();
      seen.add(v.expected);
      promisedBy.set(v.frameId, seen);
    }

    /*
     * ОДИН РЯДОК НЕСЕ ОБИДВІ ПОЛОВИНИ, і це навмисно: він падає і коли
     * інваріант порушено (з'явився `frameId` із двома різними `expected`), і
     * коли придатних не лишилось узагалі (перелік порожній ≠ очікуваному).
     * Розділені на два `expect`, вони знову дали б порожню тишу — перший ловив
     * би все, а до другого виконання не доходило б.
     */
    expect([...promisedBy].map(([id, seen]) => [id, seen.size])).toEqual([["f-97", 1]]);

    /* А це — доказ, що інваріант перевіряється на ЗАКОННОМУ стані, який
     * попереднє формулювання забороняло: один `frameId`, ДВА придатні
     * вердикти (два абзаци-твердження в одній рамці). */
    expect(eligible.map((v) => [v.frameId, v.paragraphIndex, v.expected])).toEqual([
      ["f-97", 0, 96],
      ["f-97", 1, 96],
    ]);
  });
});

describe("причина мусить бути встановленою, а не найближчою (m3)", () => {
  it("сусід за краєм книжки — «сторінки немає», а не «не міряли»", () => {
    /*
     * ПРОБА F рецензії: для першої сторінки книжки сусід за `offset − 1` має
     * від'ємний індекс, тобто такої сторінки немає в ЖОДНОМУ документі —
     * ніхто її не «не міряв». Оператор дістав би причину, якої ніхто не
     * встановлював, — той самий докір, який оракул сам адресує `no-siblings`.
     */
    const pages = [
      pageOf({ name: "97", offset: 0, spreadIndex: 0, spreadSiblings: ["98"] }),
      pageOf({ name: "98", offset: 1, side: "LEFT_HAND", spreadIndex: 0, spreadSiblings: ["97"] }),
    ];
    const v = planRewrite(pages, [frameOf("97", [96])], "backward", "auto")[0]!;
    expect(v.reason).toBe("no-neighbour-page");

    /*
     * А ось `offset` У МЕЖАХ ДОКУМЕНТА лишається «не міряли»: чи сторінка
     * існує й не потрапила у вимір, чи її немає, оракул звідси не бачить —
     * і вигадувати другу відповідь не можна.
     */
    const lonely = pageOf({ name: "97", offset: 5, spreadIndex: 1, spreadSiblings: ["96"] });
    const gap = planRewrite([lonely], [frameOf("97", [96])], "backward", "auto")[0]!;
    expect(gap.reason).toBe("page-unmeasured");
  });
});

/* ── C1: одиниця твердження — СТОРІНКА проти РАМКИ ─────────────────────── */

/**
 * ГОЛОВНА ПРАВКА ФАЗИ, І ВОНА ПРО ОДИНИЦЮ, А НЕ ПРО ГІЛКУ.
 *
 * Фінальна рецензія довела НАДРУКОВАНИМ ЧИСЛОМ, що `pagination_apply` записує
 * число, відмінне від наявного, і доповідає бездоганний успіх: «2–3», «4–5»,
 * «6–7» стали «3–3», «5–5», «7–7» при `applied: 3`, `skipped: []`.
 *
 * Механізм — інверсія, яку варто назвати вголос. Маршрут обирався як
 * `links.length > 0 ? "thread" : "helper"`, де `links` — ДОКУМЕНТНІ перекриття
 * з того самого виміру. Службова рамка будується з геометрією, що ТОЧНО
 * збігається з колонцифрою (§4.2), тож коли вона є — вона неодмінно в
 * `overlaps`. Звідси випливає протилежне до задуму: **гілка `helper` була
 * досяжна рівно тоді, коли вимір щойно довів, що службової рамки під цією
 * рамкою НЕМАЄ** — і саме в ній оракул визнавав рамку придатною на підставі
 * `chainOffsets`, тобто ПОСТОРІНКОВОГО переліку.
 *
 * Одиниця твердження була СТОРІНКА, а фізика InDesign вимагає РАМКИ. Три
 * входи розводять ці одиниці, і всі три відтворено рецензією:
 * ланцюжка немає взагалі; ланцюжок зник між викликами; дві колонцифри на
 * одній сторінці (тут між викликами не робиться НІЧОГО).
 */
describe("C1 — на маршруті helper придатність доводиться ПОРАМКОВО", () => {
  /** Службова рамка `_folio-helper` під колонцифрою: створена ОСТАННЬОЮ (§4.2). */
  const helperLink = (over: Partial<ThreadLink> = {}): ThreadLink =>
    link({
      storyId: "helper-story",
      layerName: HELPER_LAYER_NAME,
      createdOrder: 9000,
      previousPage: "96",
      nextPage: "98",
      ...over,
    });

  it("ВХІД A і B: службової рамки під рамкою немає → відмова, а не передбачення", () => {
    /*
     * Вхід A — `route: "helper"` без `planId`, ланцюжка немає взагалі. Вхід B —
     * `route: "auto"` з дійсним `planId`, але шар `_folio-helper` видалено між
     * викликами (§4.8 і §8 крок 8 називають це штатною зворотною дією). Обидва
     * приходять сюди однаковим станом: `overlaps` порожній, тобто вимір щойно
     * довів, що брати число нема звідки.
     *
     * ПЕРЕДАНЕ ПОКРИТТЯ ЦЬОГО НЕ РЯТУЄ, і саме цим вхід B відрізняється від
     * доти відомих: план каже «на цій СТОРІНЦІ рамка є», а під РАМКОЮ її немає.
     */
    for (const request of ["auto", "helper"] as const) {
      const v = planRewrite(pair96(), [frameOf("97", [96])], "backward", request)[0]!;
      expect(v.eligible).toBe(false);
      expect(v.reason).toBe("no-neighbour-frame");
      expect(v.route).toBe("helper");
    }
  });

  it("ВХІД C: дві колонцифри на сторінці — службову рамку дістала лише одна", () => {
    /*
     * КРИТЕРІЙ ПРИЙМАННЯ ПРАВКИ. Тут не бракує ані плану, ані ланцюжка, і
     * оператор між викликами не робить НІЧОГО: обробник дає службову рамку
     * лише ПЕРШІЙ колонцифрі сторінки й сам доповідає це в `ignoredFolioFrames`
     * (`pagination-write.jsx`), а посторінковий оракул визнавав придатною й
     * другу. Надруковане число другої ставало «3–3A» замість «2–3A».
     *
     * Мінімальна правка «вимагати planId і для helper» цього входу не бачить:
     * план є, покриття в ньому чесне, розходиться саме ОДИНИЦЯ.
     */
    const covered = frameOf("97", [96], { overlaps: [helperLink()] });
    const orphan = frameOf("97", [96], { id: "f-97-b", overlaps: [] });

    const verdicts = planRewrite(pair96(), [covered, orphan], "backward", "auto");

    expect(verdicts[0]!.eligible).toBe(true);
    expect(verdicts[0]!.route).toBe("helper");
    expect(verdicts[1]!.eligible).toBe(false);
    expect(verdicts[1]!.reason).toBe("no-neighbour-frame");
  });

  it("службова рамка під колонцифрою НЕ вдає основного ланцюжка", () => {
    /*
     * ДРУГА ПОЛОВИНА ІНВЕРСІЇ. Доти будь-яке документне перекриття примушувало
     * `thread`, тож службова рамка — єдина, заради якої маршрут `helper` і
     * існує, — робила його недосяжним. Маршрут відтепер виводиться з того, ЩО
     * САМЕ лежить під рамкою: шар `_folio-helper` дає `helper`, будь-який
     * інший документний ланцюжок — `thread`.
     */
    const v = planRewrite(
      pair96(),
      [frameOf("97", [96], { overlaps: [helperLink()] })],
      "backward",
      "auto",
    )[0]!;
    expect(v.route).toBe("helper");
    expect(v.eligible).toBe(true);
    expect(v.expected).toBe(96);
  });

  it("службова рамка веде НЕ НА ТУ сторінку → wrong-neighbour-page", () => {
    /* Ланцюжок із пропуском дає сусіда, але не того: маркер надрукує «42», а
     * оракул обіцяв «96». Різниця з відмовою вище — стан інший, і причина теж. */
    const v = planRewrite(
      pair96(),
      [frameOf("97", [96], { overlaps: [helperLink({ previousPage: "42" })] })],
      "backward",
      "auto",
    )[0]!;
    expect(v.eligible).toBe(false);
    expect(v.reason).toBe("wrong-neighbour-page");
    expect(v.route).toBe("helper");
  });

  it("ПРИХОВАНИЙ шар службової рамки глушить маркер → відмова", () => {
    /* Виміряно (Питання 8): `visible = false` службового шару розв'язання
     * ГЛУШИТЬ (у PDF 13 замість 12). Порамковий доказ це бачить сам —
     * посторінковий перелік про видимість не знав нічого. */
    const v = planRewrite(
      pair96(),
      [frameOf("97", [96], { overlaps: [helperLink({ layerVisible: false })] })],
      "backward",
      "auto",
    )[0]!;
    expect(v.eligible).toBe(false);
    expect(v.reason).toBe("no-neighbour-frame");
  });

  it("основний ланцюжок перебиває службовий — виграє СТВОРЕНИЙ РАНІШЕ", () => {
    /*
     * Виміряно (Питання 9, 5 випадків із 5), і §4.2 будує на цьому весь примус:
     * службовий ланцюжок фаза додає в готовий документ ОСТАННІМ. Тож там, де
     * колонцифра перекриває основний текст, число візьметься з нього — навіть
     * коли службова рамка лежить точно під нею.
     */
    const f = frameOf("97", [96], {
      overlaps: [helperLink(), link({ storyId: "main", createdOrder: 5, previousPage: "42" })],
    });
    const v = planRewrite(pair96(), [f], "backward", "auto")[0]!;
    expect(v.route).toBe("thread");
    expect(v.eligible).toBe(false);
    expect(v.reason).toBe("wrong-neighbour-page");
  });

  it("route: \"thread\" не приймає числа зі СЛУЖБОВОГО ланцюжка", () => {
    /*
     * Оператор просив основний ланцюжок; під рамкою лежить лише службовий.
     * Мовчки взяти його означало б доповісти маршрут, якого не було.
     *
     * ПРИЧИНА ЗМІНИЛАСЬ РАЗОМ ІЗ C2, І ЦЕ НЕ КОСМЕТИКА. Доти відмова була
     * `no-neighbour-frame` — тобто «сусідньої рамки немає» про рамку, під
     * якою сусідня рамка Є і маркер на неї розв'яжеться. Оракул звужував
     * рахунок ДО розв'язання й через це доповідав неправду про документ; тепер
     * він рахує ту саму множину, що InDesign, а прохання оператора виражає
     * ВІДМОВОЮ ПІСЛЯ розв'язання, з власною причиною.
     */
    const v = planRewrite(
      pair96(),
      [frameOf("97", [96], { overlaps: [helperLink()] })],
      "backward",
      "thread",
    )[0]!;
    expect(v.eligible).toBe(false);
    expect(v.reason).toBe("helper-chain-winner");
    expect(v.route).toBe("thread");
  });

  it("ПЕРЕДБАЧЕННЯ лишається — але лише там, де ланцюжка ще НЕМА ЗА ПОБУДОВОЮ", () => {
    /*
     * `create-helper-thread` рахує придатність ДО того, як ланцюжок існує, тож
     * порамкового доказу там нема й бути не може — і саме тому та операція
     * НІЧОГО НЕ ПИШЕ в колонцифри. Передбачення оголошується явно
     * (`"contract"` — названий контракт §4.2), а не виходить із мовчання:
     * безпечне значення мусить бути тим, яке дає ВІДСУТНІСТЬ поля.
     */
    const v = planRewrite(pair96(), [frameOf("97", [96])], "backward", "auto", "contract")[0]!;
    expect(v.eligible).toBe(true);
    expect(v.route).toBe("helper");
  });

  it("ПЕРЕДБАЧЕННЯ ЗА ЗВІТОМ теж порамкове: колонцифра поза покриттям відмовляється", () => {
    /*
     * I2: обробник ЗНАЄ поіменно, які колонцифри лишились без службової рамки
     * (`ignoredFolioFrames`), і доти мовчав про це і в §7, і в оракулі — той
     * самий клас, що `masterSkipped`: знання є, каналу немає. Відтепер звіт
     * будівника їде в оракул ДВОМА одиницями: `offsets` (де рамки стоять) і
     * `folioFrameIds` (під якими саме колонцифрами вони лягли).
     */
    const covered = frameOf("97", [96]);
    const orphan = frameOf("97", [96], { id: "f-97-b" });
    const verdicts = planRewrite(pair96(), [covered, orphan], "backward", "auto", {
      offsets: [0, 1],
      folioFrameIds: ["f-97"],
    });
    expect(verdicts[0]!.eligible).toBe(true);
    expect(verdicts[1]!.eligible).toBe(false);
    expect(verdicts[1]!.reason).toBe("no-neighbour-frame");
  });
});

/* ── C2: прохання МАРШРУТУ проти РОЗВ'ЯЗАННЯ ───────────────────────────── */

/**
 * ДРУГА КРИТИЧНА ПРАВКА ФАЗИ, І ВОНА ПРО ТЕ, ЧИМ ВИРАЖАТИ ПРОХАННЯ ОПЕРАТОРА.
 *
 * Правка C1 додала побічну клаузу, якої доти не було:
 * `permitted = request === "thread" ? mainLinks : links`. Намір був чесний —
 * не доповідати маршруту, якого оператор не просив. Наслідок протилежний:
 * **InDesign розв'язує маркер по ВСІХ перекриттях** (виміряно, Питання 9:
 * виграє створений раніше), а оракул на `route: "thread"` почав рахувати
 * ВУЖЧУ множину — тобто міркувати про документ, якого немає.
 *
 * Відтворено надрукованим числом (переогляд `11В`, власний зонд, справжні
 * операції): `create-helper-thread` → зникла одна службова рамка → оператор
 * доклав основний ланцюжок → `replace-literals` із `route: "thread"`. На с. 3
 * «2–3» стало **«1–3»**, а інструмент доповів `applied: 1` без жодної скарги.
 *
 * РОЗВЕДЕННЯ, ЯКЕ ЛАГОДИТЬ ЦЕ НАЗАВЖДИ: рахунок — по всіх зв'язках (як у
 * InDesign), а прохання `route: "thread"` виражається ВІДМОВОЮ ПІСЛЯ
 * розв'язання. Звуження змушує оракул брехати про фізику; відмова чесно каже,
 * що прохання несумісне зі станом документа.
 */
describe("C2 — маршрут просять ВІДМОВОЮ після розв'язання, а не звуженням до нього", () => {
  /** Службовий зв'язок, але СТАРШИЙ за основний — саме цим C2 і відрізняється. */
  const olderHelper = (over: Partial<ThreadLink> = {}): ThreadLink =>
    link({
      storyId: "helper-story",
      layerName: HELPER_LAYER_NAME,
      createdOrder: 1,
      previousPage: "42",
      ...over,
    });

  /** Основний ланцюжок, докладений ПІЗНІШЕ, із сусідом на «правильній» сторінці. */
  const youngerMain = (over: Partial<ThreadLink> = {}): ThreadLink =>
    link({ storyId: "main-story", createdOrder: 9000, previousPage: "96", ...over });

  it("два зв'язки різного ВІКУ: службовий старший — route: \"thread\" відмовляється", () => {
    /*
     * СТАН, ЯКИЙ ЗБИРАЄТЬСЯ ЗІ ШТАТНИХ ДІЙ, названих самим спеком: службовий
     * ланцюжок будується першим (§4.5), одна службова рамка зникає (§4.8 називає
     * штатною зворотною дією видалення ЦІЛОГО шару, тобто строго більше),
     * оператор докладає верстку.
     *
     * InDesign візьме число зі СТАРШОГО — службового — ланцюжка, тобто «42».
     * Оракул, що рахує лише основні зв'язки, побачив би «96», визнав би збіг і
     * записав би маркер, який надрукує інше число. Тому відмова, і причина
     * власна: сусідня рамка Є, і сказати «її немає» означало б відправити
     * оператора лагодити не те.
     */
    const f = frameOf("97", [96], { overlaps: [olderHelper(), youngerMain()] });
    const v = planRewrite(pair96(), [f], "backward", "thread")[0]!;

    expect(v.eligible).toBe(false);
    expect(v.reason).toBe("helper-chain-winner");
    expect(v.expected).toBe(96);
  });

  it("той самий стан під auto: число береться з ФІЗИЧНОГО переможця, тобто службового", () => {
    /*
     * НЕГАТИВНИЙ КОНТРОЛЬ ДО ТЕСТУ ВИЩЕ, і він доводить, що йдеться саме про
     * прохання маршруту, а не про службовий шар як такий. Під `auto` оракул
     * рахує ту саму множину, що InDesign, і чесно доповідає розбіжність:
     * переможець веде на «42», а сусід розвороту — «96».
     *
     * Якби рахунок і тут звузився до основних зв'язків, рамка вийшла б
     * ПРИДАТНОЮ — і це рівно та брехня, яку відтворив зонд.
     */
    const f = frameOf("97", [96], { overlaps: [olderHelper(), youngerMain()] });
    const v = planRewrite(pair96(), [f], "backward", "auto")[0]!;

    expect(v.eligible).toBe(false);
    expect(v.reason).toBe("wrong-neighbour-page");
    /* Маршрут доповідає ПРИМУС основним перекриттям (§4.2) — він є під рамкою. */
    expect(v.route).toBe("thread");
  });

  it("переможці ОДНОГО ланцюжка на РІЗНИХ шарах: досить одного службового, щоб відмовитись", () => {
    /*
     * МУТАНТ, ЩО ВИЖИВАВ, І ЦЕ ЗНАХІДКА ПРО ТЕСТ, А НЕ ПРО КОД. Заміна `some`
     * на `every` у `helperChainWins` не червонила НІЧОГО: у решті станів
     * переможець один, тож обидва предикати збігаються.
     *
     * СТАН ДОСЯЖНИЙ, і його форма випливає з коду виміру, а не з припущення:
     * `createdOrder` — це `Number(story.id)` (`IDMCP.threadLink`), тобто
     * величина ЛАНЦЮЖКА, а не рамки. Дві рамки одного ланцюжка мають РІВНИЙ
     * `createdOrder`, отже переможцями стають обидві; шар при цьому в кожної
     * свій — рамку ланцюжка можна перекласти на інший шар.
     *
     * АЛЕ РІВНИЙ `createdOrder` — УМОВА НЕОБХІДНА, А НЕ ДОСТАТНЯ, і доти цей
     * коментар описував стан ШИРШИМ, ніж він досяжний (M9 переогляду `11g`).
     * Обидві рамки мусять ще й називати ОДНОГО сусіда: при різних
     * `previousPage` рамка відмовляється раніше й з іншої причини — у
     * `resolveFromLinks`, на `pages.size !== 1`, тобто до питання про
     * переможця справа не доходить. Фікстура нижче тому й дає обом «96»: це не
     * недбалість про сусіда, а єдина форма, у якій стан узагалі існує (дві
     * попередні рамки ланцюжка лежать на ОДНІЙ сторінці).
     *
     * ЩО РОБИТЬ INDESIGN, КОЛИ ЛАНЦЮЖОК РОЗКЛАДЕНО ПО ДВОХ ШАРАХ, — НЕ МІРЯНО.
     * Тому тут не здогад, а вибір боку помилки: під `route: "thread"` досить
     * одного службового переможця, щоб сказати «прохання несумісне». Ціна —
     * втрата покриття, і §3 дозволяє тільки її.
     */
    const f = frameOf("97", [96], {
      overlaps: [
        link({ storyId: "s", createdOrder: 7, previousPage: "96", layerName: HELPER_LAYER_NAME }),
        link({ storyId: "s", createdOrder: 7, previousPage: "96" }),
      ],
    });
    const v = planRewrite(pair96(), [f], "backward", "thread")[0]!;

    expect(v.eligible).toBe(false);
    expect(v.reason).toBe("helper-chain-winner");
  });

  it("основний ланцюжок СТАРШИЙ — route: \"thread\" виконується, а не відмовляється", () => {
    /*
     * ДРУГИЙ НЕГАТИВНИЙ КОНТРОЛЬ: відмова мусить бути про ПЕРЕМОЖЦЯ, а не про
     * саму присутність службового зв'язку. Це штатний стан фази — службовий
     * ланцюжок додається в готовий документ ОСТАННІМ (§4.2), тож під
     * колонцифрою, що перекриває основний текст, виграє основний.
     *
     * Мутант «відмовляти, щойно серед перекриттів є службовий шар» лишив би
     * `route: "thread"` без жодної придатної рамки й убив би маршрут A на
     * кожній книжці — цей тест його червонить.
     */
    const f = frameOf("97", [96], {
      overlaps: [
        link({ storyId: "main-story", createdOrder: 1, previousPage: "96" }),
        olderHelper({ createdOrder: 9000 }),
      ],
    });
    const v = planRewrite(pair96(), [f], "backward", "thread")[0]!;

    expect(v.eligible).toBe(true);
    expect(v.route).toBe("thread");
    expect(v.expected).toBe(96);
  });
});

describe("I7 — ДЖЕРЕЛО числа звітується окремо від ПРИМУСУ маршруту", () => {
  /**
   * Службовий ланцюжок, СТАРШИЙ за основний, і сусід у нього ПРАВИЛЬНИЙ —
   * тобто рамка виходить придатною, а число дає він.
   *
   * Стан збирається зі штатних дій, названих самим спеком (§4.5, §4.8): спершу
   * будують службовий ланцюжок, потім оператор докладає верстку.
   */
  const olderHelperRight = (): ThreadLink =>
    link({
      storyId: "helper-story",
      layerName: HELPER_LAYER_NAME,
      createdOrder: 1,
      previousPage: "96",
    });

  /** Основний ланцюжок, докладений ПІЗНІШЕ. Переможцем він не стає. */
  const youngerMain = (over: Partial<ThreadLink> = {}): ThreadLink =>
    link({ storyId: "main-story", createdOrder: 9000, previousPage: "96", ...over });

  it("під auto число дає СЛУЖБОВИЙ ланцюжок — і рамка це каже, попри route: thread", () => {
    /*
     * СТОРОЖ I7, І ЙОГО ЦІНА НЕ КОСМЕТИЧНА. §4.8 називає видалення шару
     * `_folio-helper` штатною зворотною дією («видаляється однією дією, тому
     * фаза не будує зворотної операції»), а Питання 8 виміряло, чим це
     * закінчується: приховати шар — і маркер друкує 13 замість 12, тобто
     * колонцифра стає «N–N». Оператор, який бачить у звіті САМЕ ЛИШЕ
     * `route: "thread"`, робить природний висновок «службового шару ця рамка
     * не потребує» — і робить рівно ту дію, яку фаза називає найгіршою.
     *
     * ДВА ПОЛЯ — ДВА РІЗНІ ПИТАННЯ, І ЗЛИТИ ЇХ НЕ МОЖНА. `route` каже, який
     * маршрут ПРИМУШЕНО (§4.2: перекриття з основним ланцюжком примушує
     * `thread` незалежно від прохання) — тут він чесно `thread`, бо основний
     * ланцюжок під рамкою Є. `resolvedBy` каже, хто ВИГРАВ розв'язання —
     * виміряний переможець, той самий, якого обчислює `helperChainWins`.
     */
    const f = frameOf("97", [96], { overlaps: [olderHelperRight(), youngerMain()] });
    const v = planRewrite(pair96(), [f], "backward", "auto")[0]!;

    expect(v.eligible).toBe(true);
    expect(v.expected).toBe(96);
    expect(v.route).toBe("thread");
    expect(v.resolvedBy).toBe("helper");
  });

  it("той самий вхід, лише вік ланцюжків обернено — джерело стає main", () => {
    /*
     * НЕГАТИВНИЙ КОНТРОЛЬ, І ВІН ПРО МУТАНТА, А НЕ ПРО СИМЕТРІЮ. Без нього
     * `resolvedBy` можна було б написати як «чи є серед перекриттів службовий
     * зв'язок» — предикат, що дав би тут `helper` і був би хибний: службова
     * рамка під колонцифрою є ЗАВЖДИ, щойно ланцюжок побудовано (§4.2), тож
     * така відповідь не несла б жодної інформації.
     */
    const f = frameOf("97", [96], {
      overlaps: [
        link({ storyId: "main-story", createdOrder: 1, previousPage: "96" }),
        link({
          storyId: "helper-story",
          layerName: HELPER_LAYER_NAME,
          createdOrder: 9000,
          previousPage: "96",
        }),
      ],
    });
    const v = planRewrite(pair96(), [f], "backward", "auto")[0]!;

    expect(v.eligible).toBe(true);
    expect(v.route).toBe("thread");
    expect(v.resolvedBy).toBe("main");
  });

  it("розв'язання виміряне, а сторінка не та — джерело однаково назване", () => {
    /*
     * ПРОПУСК ТЕЖ МУСИТЬ ВЕЗТИ ДЖЕРЕЛО, КОЛИ ВОНО ВСТАНОВЛЕНЕ. `route` тут
     * скаже `thread` (основний ланцюжок під рамкою є), а на «42» повів саме
     * службовий — і без `resolvedBy` оператор пішов би лагодити основний
     * текст, якого ця відмова не стосується.
     */
    const f = frameOf("97", [96], {
      overlaps: [
        link({
          storyId: "helper-story",
          layerName: HELPER_LAYER_NAME,
          createdOrder: 1,
          previousPage: "42",
        }),
        youngerMain(),
      ],
    });
    const v = planRewrite(pair96(), [f], "backward", "auto")[0]!;

    expect(v.reason).toBe("wrong-neighbour-page");
    expect(v.route).toBe("thread");
    expect(v.resolvedBy).toBe("helper");
  });

  it("розв'язання НЕ відбулось — джерела немає, і поле мовчить", () => {
    /*
     * `null` — «НЕ ВСТАНОВЛЕНО», рівно як `expected: null` у пропуску вище за
     * течією. Назвати тут `main` означало б доповісти встановленим те, чого
     * ніхто не встановлював: переможця немає взагалі, бо немає й розв'язання.
     */
    const v = planRewrite(pair96(), [frameOf("97", [96])], "backward", "auto")[0]!;

    expect(v.reason).toBe("no-neighbour-frame");
    expect(v.resolvedBy).toBeNull();
  });
});

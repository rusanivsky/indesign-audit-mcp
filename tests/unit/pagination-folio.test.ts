import { describe, expect, it } from "vitest";
import { detectFolio } from "../../src/pagination/folio.js";
import { buildReport } from "../../src/pagination/report.js";
import type { MarkerDirection } from "../../src/pagination/rewrite-types.js";
import type { ClaimFrame, MarkerKind, PageRef, ThreadLink } from "../../src/pagination/types.js";

function page(name: string, siblings: string[], offset = 0): PageRef {
  return {
    name,
    offset,
    side: "RIGHT_HAND",
    spreadIndex: 0,
    spreadSiblings: siblings,
    master: null,
  };
}

/**
 * Зв'язок ланцюжка з замовчуваннями «документна рамка на видимому шарі».
 *
 * Поіменно, а не `as never`: три поля з шести (`createdOrder`, `layerVisible`,
 * `fromMaster`) вирішують відповідь `resolveMarkerPage`, і фікстура, яка їх
 * мовчки не має, перевіряла б поведінку на `undefined`. Та сама форма, що в
 * `tests/unit/pagination-topology.test.ts`.
 */
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
 * Замовчування ПОЛІВ ФАЗИ 7 для рамки-твердження.
 *
 * `overlaps: []` — це «перевірили, не перекриває», а НЕ «не перевіряли»:
 * `null` тут був би третім станом (§4.9), і мовчки поставити його всім
 * фікстурам означало б перевіряти детектори на стані «не міряли».
 * `layerVisible: true` — рамка друкується, тобто її число бреше вже сьогодні;
 * протилежне значення перекидає вердикт у `folio-dormant-duplicate`.
 */
const FRAME_DEFAULTS = {
  styleName: "Колонцифра",
  rotationAngle: -90,
  bounds: { y1: 0, x1: 0, y2: 10, x2: 10 },
  layerName: "Layer 1",
  layerVisible: true,
  layerPrintable: true,
  fromMaster: false,
  locked: false,
  layerLocked: false,
  overlaps: [] as ThreadLink[] | null,
};

function folio(pageName: string, literals: number[], markers: MarkerKind[]): ClaimFrame {
  return {
    id: `frame-${pageName}`,
    page: pageName,
    ...FRAME_DEFAULTS,
    paragraphs: [
      {
        index: 0,
        styleName: null,
        text: "…",
        literals,
        markers,
        /* СИМВОЛЬНІ зсуви, по одному на літерал: детектори §4.9 їх не читають,
         * але тип вимагає паритету довжин, і `[]` при непорожніх `literals`
         * був би фікстурою, що суперечить сама собі. */
        literalOffsets: literals.map((_, i) => i),
        baseline: 0,
        leading: 4,
      },
    ],
  };
}

/** Маркер сусідньої сторінки за напрямком; `null` — рамка взагалі без маркера. */
function markerOf(dir: MarkerDirection | null): MarkerKind[] {
  if (dir === null) return [];
  return [dir === "previous" ? "previous-page-number" : "next-page-number"];
}

/**
 * Рамка ПІСЛЯ заміни: маркер сусідньої сторінки є, літералів немає.
 *
 * Саме на таких рамках `detectFolio` сліпий назавжди без §4.9 — знахідки
 * породжуються виключно всередині `if (para.literals.length > 0)`.
 */
function folioNoLiterals(
  pageName: string,
  overlaps: (Partial<ThreadLink> & { storyId: string })[] | null,
  dir: MarkerDirection | null,
): ClaimFrame {
  return {
    ...folio(pageName, [], markerOf(dir)),
    overlaps: overlaps === null ? null : overlaps.map(link),
  };
}

/** Та сама рамка, але на ПРИХОВАНОМУ шарі: сьогодні вона не друкується. */
function folioHidden(
  pageName: string,
  overlaps: (Partial<ThreadLink> & { storyId: string })[],
  dir: MarkerDirection | null,
): ClaimFrame {
  return { ...folioNoLiterals(pageName, overlaps, dir), layerVisible: false };
}

const AUTO: MarkerKind[] = ["auto-page-number"];

/*
 * Дефекти САМОГО ЧИСЛА, без folio-manual.
 *
 * `folio-manual` — не помилка числа, а факт про спосіб набору, і він тепер
 * супроводжує будь-яку рамку з літералом (зокрема змішану «6–<авто>»).
 * Тести про правильність числа мусять дивитись повз нього, інакше вони
 * перевіряли б дві різні речі одним твердженням.
 */
function defectsOfNumber(r: { findings: { defect: string }[] }): string[] {
  return r.findings.map((f) => f.defect).filter((d) => d !== "folio-manual");
}

describe("detectFolio", () => {
  it("НЕГАТИВНИЙ КОНТРОЛЬ: коректна колонцифра не дає дефекту", () => {
    /* Сторінка 97, сусідня 96, ручне число 96, автомаркер дасть 97.
     * Обидві частини правила задоволені. */
    const r = detectFolio([page("97", ["96"])], [folio("97", [96], AUTO)]);
    /* «Чисто» тут означає «жодного дефекту ЧИСЛА». folio-manual лишається:
     * ручна половина колонцифри зламається — див. окремий тест нижче. */
    expect(r.findings.filter((f) => f.defect !== "folio-manual")).toEqual([]);
    expect(r.checked).toBe(1);
    expect(r.notCompared).toBe(0);
  });

  it("частина 1 — зсув: 94 не є ні своєю сторінкою, ні сусідньою", () => {
    /* Відтворює виміряний дефект 2026-07-29: систематичний зсув −2 на 76
     * сторінках (41–195). */
    const r = detectFolio([page("97", ["96"])], [folio("97", [94], AUTO)]);
    const stale = r.findings.filter((f) => f.defect === "folio-stale");
    expect(stale).toHaveLength(1);
    expect(stale[0]!.claimed).toBe("94");
    expect(stale[0]!.actual).toBe("96");
    expect(stale[0]!.page).toBe("97");
  });

  it("частина 2 — дублювання автомаркера, яке частина 1 ПРОПУСКАЄ", () => {
    /* Сторінка 96, сусідня 97, ручне число 96. Частина 1 задоволена: 96
     * дорівнює назві ВЛАСНОЇ сторінки. Ловить лише частина 2.
     *
     * Відтворює виміряний дефект 2026-08-04: непарна вставка перевернула бік
     * розвороту, 52 колонцифри опинилися на чужому боці й читалися «96–96».
     *
     * Без цього тесту половина правила не перевіряється нічим. */
    const r = detectFolio([page("96", ["97"])], [folio("96", [96], AUTO)]);
    expect(defectsOfNumber(r)).toEqual(["folio-duplicates-auto"]);
    const dup = r.findings.find((f) => f.defect === "folio-duplicates-auto")!;
    expect(dup.claimed).toBe("96");
    expect(dup.actual).toBe("97");
  });

  it("ЗМІШАНА рамка «6–<авто>» теж дає folio-manual — ручна половина зламається", () => {
    /* Знайдено прогоном на робочій книжці 2026-08-07: усі 91 колонцифра там
     * саме такі, і за попередньою умовою («літерали І немає автомаркера»)
     * інструмент мовчав про всі 91 — тобто рівно про той клас, який у цій
     * книжці ламався двічі. */
    const r = detectFolio([page("97", ["96"])], [folio("97", [96], AUTO)]);
    expect(r.findings.map((f) => f.defect)).toEqual(["folio-manual"]);
    expect(r.findings[0]!.detail).toContain("drift apart");
  });

  it("нечислова назва сторінки дає folio-unparsable, а не порівняння з NaN", () => {
    const r = detectFolio([page("iv", ["iii"])], [folio("iv", [3], AUTO)]);
    expect(r.findings.map((f) => f.defect)).toEqual(["folio-unparsable"]);
    expect(r.notCompared).toBe(1);
    expect(r.checked).toBe(0);
  });

  it("рамка без автомаркера — folio-manual, і це факт, а не дефект числа", () => {
    /* «6–7» цілком літералами: обидва числа коректні (7 — своя сторінка,
     * 6 — сусідня), тож folio-stale тут не буде. Але воно зламається при
     * наступному перекомпонуванні, і саме це треба сказати. */
    const r = detectFolio([page("7", ["6"])], [folio("7", [6, 7], [])]);
    expect(r.findings.map((f) => f.defect)).toEqual(["folio-manual"]);
    expect(r.checked).toBe(1);
  });

  it("без автомаркера частина 2 НЕ спрацьовує — 7 законно дорівнює своїй сторінці", () => {
    /* Критична межа між частинами: дублювати нічого, якщо автомаркера немає. */
    const r = detectFolio([page("7", ["6"])], [folio("7", [6, 7], [])]);
    expect(r.findings.map((f) => f.defect)).not.toContain("folio-duplicates-auto");
  });

  it("рамка на сторінці, якої немає у вимірі, йде в notCompared", () => {
    const r = detectFolio([page("7", ["6"])], [folio("99", [6], AUTO)]);
    expect(r.notCompared).toBe(1);
    expect(r.checked).toBe(0);
    expect(r.findings).toEqual([]);
  });

  it("сусідні сторінки з нечисловими назвами не ламають перевірку своєї", () => {
    /* Своя сторінка числова, сусідня «iii» — її просто немає серед
     * допустимих значень, і 96 має дати stale, а не виняток. */
    const r = detectFolio([page("97", ["iii"])], [folio("97", [96], AUTO)]);
    expect(defectsOfNumber(r)).toEqual(["folio-stale"]);
    expect(r.findings.find((f) => f.defect === "folio-stale")!.actual).toBe("97");
  });

  it("кілька рамок рахуються окремо, і checked рахує СТОРІНКИ-твердження", () => {
    const r = detectFolio(
      [page("96", ["97"], 0), page("97", ["96"], 1)],
      [folio("96", [97], AUTO), folio("97", [96], AUTO)],
    );
    expect(r.checked).toBe(2);
    expect(defectsOfNumber(r)).toEqual([]);
  });
});

/*
 * ТРИ ДЕТЕКТОРИ §4.9 — ВИЯВНІСТЬ, ЯКУ ЗАМІНА ІНАКШЕ Б ЗАБРАЛА.
 *
 * Правило вище породжує знахідки ВИКЛЮЧНО всередині
 * `if (para.literals.length > 0)`. Рамка без літералів не дає знахідок ніколи,
 * тобто після успішної заміни ручного числа маркером `pagination_audit` на цій
 * рамці сліпий НАЗАВЖДИ. Виміряний сценарій відмови (Питання 10): користувач
 * розриває історію, маркер починає показувати поточну сторінку, друкується
 * правдоподібне «121–121» — порожнечі немає, попередження немає, аудит каже
 * «чисто». Саме тому без цих трьох детекторів фаза не нейтральна, а шкідлива.
 *
 * Нові дефекти рахуються НА РАМКУ: у рамки без літералів немає
 * абзаців-тверджень із числами, тобто немає й одиниці, на яку рахувати.
 */
describe("detectFolio — маркер сусідньої сторінки (§4.9)", () => {
  it("маркер, що не розв'язується, — folio-marker-unbound", () => {
    /* `overlaps: []` — ВИМІРЯНИЙ факт «не перекриває нічого», а не «не
     * міряли». Маркеру нема звідки взяти сторінку (H6, випадок B). */
    const f = folioNoLiterals("97", [], "previous");
    const r = detectFolio([page("97", ["96"])], [f]);
    expect(r.findings.map((x) => x.defect)).toContain("folio-marker-unbound");
  });

  it("маркер розв'язується не в свій розворот — folio-marker-cross-spread", () => {
    /* Сторінка 98 (verso, розворот 98|99), маркер PREVIOUS дає 97. Пара 97–98
     * не є двома сторінками одного розвороту — це дефект 2026-08-04, «чужий
     * бік», і після заміни ЛОВИТЬ ЙОГО ЛИШЕ ЦЕЙ детектор: літералів немає,
     * тобто ні `folio-stale`, ні `folio-duplicates-auto` не породжуються. */
    const f = folioNoLiterals("98", [{ storyId: "s", previousPage: "97", nextPage: "99" }], "previous");
    const r = detectFolio([page("98", ["99"])], [f]);
    expect(r.findings.map((x) => x.defect)).toContain("folio-marker-cross-spread");
  });

  it("маркер розв'язується у ВЛАСНУ сторінку — «97–97» теж не пара розвороту", () => {
    /*
     * ЦЕ ВИМІРЯНИЙ ДЕФЕКТ 2026-08-04 У ЙОГО ПІСЛЯЗАМІННІЙ ФОРМІ, і саме заради
     * нього §4.9 існує. Тоді 52 колонцифри друкували «96–96», і ловив це
     * `folio-duplicates-auto` — ПО ЛІТЕРАЛУ. Після заміни літерала немає, тож
     * той детектор мовчить за побудовою, а цей мусить сказати те саме.
     *
     * Стан досяжний без екзотики: досить, щоб попередня рамка ланцюжка
     * опинилась на тій самій сторінці — дубльована сторінка, друга службова
     * рамка на сторінці, або маршрут A (кілька рамок основного тексту на
     * одній сторінці, §4.2).
     *
     * Спек на боці знахідки: тригер — «отримана ПАРА ЧИСЕЛ не є двома
     * сторінками одного розвороту». «97–97» — це одна сторінка двічі.
     */
    const f = folioNoLiterals("97", [{ storyId: "s", previousPage: "97" }], "previous");
    const found = detectFolio([page("97", ["96"])], [f]).findings.find(
      (x) => x.defect === "folio-marker-cross-spread",
    );
    expect(found).toBeDefined();
    expect(found!.claimed).toBe("97");
  });

  it("маркер, що розв'язується у свій розворот, знахідки не дає", () => {
    /* НЕГАТИВНИЙ КОНТРОЛЬ: без нього «ловить дефект» не відрізнити від
     * «кричить на кожну рамку з маркером». */
    const f = folioNoLiterals("97", [{ storyId: "s", previousPage: "96", nextPage: "98" }], "previous");
    const r = detectFolio([page("97", ["96"])], [f]);
    expect(r.findings).toEqual([]);
  });

  it("обидва нові дефекти рахуються в deviating", () => {
    /* Їх немає в `NON_DEVIATIONS` — і це не деталь звіту, а весь сенс: рамка
     * ДРУКУЄТЬСЯ, і надруковане число хибне ЗАРАЗ, а не після наступного
     * перекомпонування. */
    const f = folioNoLiterals("97", [], "previous");
    const rep = buildReport({
      folio: detectFolio([page("97", ["96"])], [f]),
      contents: null,
      runningHead: null,
      docName: "d",
      missingStyles: [],
      masterSkipped: [], masterIslands: [],
      detailFamily: null,
    });
    expect(rep.folio!.deviating).toBe(1);
  });

  it("рамка без маркера й без літералів знахідок не дає взагалі", () => {
    /* Порожня рамка стилю колонцифри — не дефект. Детектори вмикає САМ
     * МАРКЕР, а не наявність рамки. */
    const f = folioNoLiterals("97", [], null);
    expect(detectFolio([page("97", ["96"])], [f]).findings).toEqual([]);
  });

  it("маркер на ПРИХОВАНОМУ шарі — dormant-duplicate, а НЕ unbound", () => {
    /*
     * НАЙВАЖЛИВІШИЙ ТЕСТ ЗАДАЧІ. `layer.visible` означає ПРОТИЛЕЖНЕ в двох
     * місцях (§4.9): прихований шар СЛУЖБОВОГО ланцюжка, з якого рамка бере
     * число, — це `folio-marker-unbound` (рамка друкується, число хибне);
     * прихований шар САМОЇ рамки — це `folio-dormant-duplicate` (рамка не
     * друкується, отже сьогодні не бреше).
     *
     * Без цього розділення перший же прогін по книжці дав би 29
     * ХИБНОПОЗИТИВНИХ `unbound`: виміряно, що три майстрові колонцифри лежать
     * на шарі `Нумерація` з `visible = false` і живі на 29 сторінках. Це
     * дзеркальне повторення провалу Фази 6, де інструмент доповів «усі 91
     * фоліо чисті».
     */
    const f = folioHidden("97", [], "previous");
    const defects = detectFolio([page("97", ["96"])], [f]).findings.map((x) => x.defect);
    expect(defects).toContain("folio-dormant-duplicate");
    expect(defects).not.toContain("folio-marker-unbound");
  });

  it("dormant-duplicate НЕ рахується в deviating", () => {
    /* Той самий клас, що `folio-manual`: число правильне сьогодні й
     * зламається лише тоді, коли шар увімкнуть. Знахідка при цьому у звіті
     * Є — мовчання про сплячий дубль було б втратою, а не спокоєм. */
    const f = folioHidden("97", [], "previous");
    const rep = buildReport({
      folio: detectFolio([page("97", ["96"])], [f]),
      contents: null,
      runningHead: null,
      docName: "d",
      missingStyles: [],
      masterSkipped: [], masterIslands: [],
      detailFamily: null,
    });
    expect(rep.folio!.deviating).toBe(0);
    expect(rep.folio!.groups.some((g) => g.defect === "folio-dormant-duplicate")).toBe(true);
  });

  it("overlaps === null — це «не міряли»: своя знахідка, і НЕ в deviating", () => {
    /*
     * ТРИ СТАНИ, А НЕ ДВА, і два з них доти були одним. `null` означає, що
     * перекриттів НЕ РАХУВАЛИ (власні `bounds` рамки невідомі), `[]` —
     * «перевірили, не перекриває». Спокуслива полагодка `frame.overlaps ?? []`
     * дає рівно протилежне тому, чого §4.9 хоче: рамка, якої ніхто не міряв,
     * дістає `folio-marker-unbound`, тобто потрапляє в `deviating` як
     * ДОВЕДЕНИЙ дефект. Це той самий обмін виявності на тишу, проти якого
     * стоїть §3, лише в інший бік: не пропущений дефект, а ВИГАДАНИЙ.
     *
     * АЛЕ «НЕ ВИГАДУВАТИ ДЕФЕКТ» ≠ «МОВЧАТИ». Доти тут не було ні знахідки,
     * ні лічильника, і рамка, топології якої ніхто не міряв, у відповіді
     * побайтово не відрізнялась від перевіреної й чистої — рівно та форма
     * відмови, проти якої збудований §3. Канал, що лічильників не чіпає, уже
     * існує: знахідка в `NON_DEVIATIONS`, як `folio-unparsable`, який каже
     * так само «не порівнювали».
     *
     * Лічильники Фази 6 при цьому НЕ рухаються: `checked` для цієї рамки вже
     * пораховано, а `checked` і `notCompared` порамково взаємовиключні, тож
     * третій `notCompared` порахував би одну рамку двічі.
     */
    const f = folioNoLiterals("97", null, "previous");
    const r = detectFolio([page("97", ["96"])], [f]);
    expect(r.findings.map((x) => x.defect)).toEqual(["folio-marker-unmeasured"]);
    expect(r.checked).toBe(1);
    expect(r.notCompared).toBe(0);
    const rep = buildReport({
      folio: r,
      contents: null,
      runningHead: null,
      docName: "d",
      missingStyles: [],
      masterSkipped: [], masterIslands: [],
      detailFamily: null,
    });
    expect(rep.folio!.deviating).toBe(0);
    expect(rep.folio!.groups.some((g) => g.defect === "folio-marker-unmeasured")).toBe(true);
  });

  it("МАЙСТРОВЕ перекриття маркера не рятує — це unbound, а не «розв'язалось»", () => {
    /* Ланцюжок, що живе на майстрі, для документної сторінки не
     * розв'язується взагалі (Питання 6 і 13), тож рамка, яка перекриває лише
     * його, друкує поточну сторінку. Ціна помилки виміряна: на книжці 90 із
     * 91 колонцифри мають перекриття, УСІ майстрові. */
    const f = folioNoLiterals(
      "97",
      [{ storyId: "s", previousPage: "96", nextPage: "98", fromMaster: true }],
      "previous",
    );
    const defects = detectFolio([page("97", ["96"])], [f]).findings.map((x) => x.defect);
    expect(defects).toEqual(["folio-marker-unbound"]);
  });

  it("прихований шар ПЕРЕКРИТОЇ рамки — unbound, а не dormant-duplicate", () => {
    /* Дзеркало до тесту про прихований шар самої рамки, і разом вони
     * тримають розділення: тут рамка ВИДИМА (друкується), а прихований шар
     * ланцюжка глушить розв'язання маркера (Питання 8), тобто надруковане
     * число хибне вже сьогодні. Один із двох тестів без другого лишав би
     * можливість переплутати два однойменні поля. */
    const f = folioNoLiterals("97", [{ storyId: "s", previousPage: "96", layerVisible: false }], "previous");
    const defects = detectFolio([page("97", ["96"])], [f]).findings.map((x) => x.defect);
    expect(defects).toContain("folio-marker-unbound");
    expect(defects).not.toContain("folio-dormant-duplicate");
  });

  it("маркер NEXT дзеркальний — напрямок оголошує САМ МАРКЕР", () => {
    /* Схема `pagination_audit` не міняється саме тому, що напрямок не
     * потрібно оголошувати параметром: `NEXT_PAGE_NUMBER` означає «сусід на
     * N+1» у будь-якому виданні. На книжці verso-колонцифр нуль (Питання 1),
     * тож цю гілку не покриє жоден прогін на ній — лише тест. */
    const ok = folioNoLiterals("98", [{ storyId: "s", nextPage: "99" }], "next");
    expect(detectFolio([page("98", ["99"])], [ok]).findings).toEqual([]);
    const bad = folioNoLiterals("98", [{ storyId: "s", nextPage: "100" }], "next");
    expect(detectFolio([page("98", ["99"])], [bad]).findings.map((x) => x.defect)).toEqual([
      "folio-marker-cross-spread",
    ]);
  });

  it("cross-spread несе розв'язане число й склад розвороту, а не самий діагноз", () => {
    /* `claimed`/`actual` — це те, чим звіт відрізняється від ярлика: оператор
     * має побачити, ЩО надрукується і з чим воно розійшлося. */
    const f = folioNoLiterals("98", [{ storyId: "s", previousPage: "97" }], "previous");
    const found = detectFolio([page("98", ["99"])], [f]).findings.find(
      (x) => x.defect === "folio-marker-cross-spread",
    )!;
    expect(found.claimed).toBe("97");
    expect(found.actual).toBe("99");
    expect(found.page).toBe("98");
    expect(found.frameId).toBe("frame-98");
    /* Знахідка НА РАМКУ: абзацу-твердження з числом у такої рамки немає. */
    expect(found.paragraphIndex).toBeNull();
  });

  it("НЕЧИСЛОВА назва сторінки не глушить детекторів §4.9", () => {
    /*
     * Детекторам §4.9 числова назва НЕ ПОТРІБНА ВЗАГАЛІ: вони порівнюють
     * `resolved` із `pg.name` і `pg.spreadSiblings` як РЯДКИ, і жоден із трьох
     * тригерів такої залежності не оголошує. Доти гілка `own === null` робила
     * `continue` ПЕРЕД блоком детекторів, тобто римська передмова чи секційна
     * нумерація («iv», «A-1», «Дод-3» — законні назви за докстрінгом
     * `PageRef.name`) позбавляла себе всіх трьох перевірок без причини.
     *
     * Лічильники лишаються, як були: рамка йде в `notCompared`, а не в
     * `checked` — літерали з такою назвою справді звірити нема з чим.
     */
    const f = folioNoLiterals("x", [{ storyId: "s", previousPage: "vii" }], "previous");
    const r = detectFolio([page("x", ["ix"])], [f]);
    const defects = r.findings.map((d) => d.defect);
    expect(defects).toContain("folio-unparsable");
    expect(defects).toContain("folio-marker-cross-spread");
    expect(r.checked).toBe(0);
    expect(r.notCompared).toBe(1);
  });

  it("рамка з ОБОМА напрямковими маркерами перевіряється в ОБИДВА боки", () => {
    /*
     * Доти `markerDirection` віддавав «previous» і зупинявся, тобто перевірка
     * другого маркера просто ВИКИДАЛАСЬ. Тут `previous` розв'язується
     * правильно, а `next` — у чужий розворот: якщо детектор бере лише перший
     * напрямок, знахідки не буде взагалі.
     *
     * Вимір книжки такі рамки має: колонцифра «⟨PREVIOUS⟩–⟨AUTO⟩» несе два
     * маркери, просто другий не напрямковий; двонапрямкова рамка — той самий
     * клас на один крок далі.
     */
    const f = folioNoLiterals(
      "98",
      [{ storyId: "s", previousPage: "99", nextPage: "101" }],
      "previous",
    );
    f.paragraphs[0]!.markers = ["previous-page-number", "next-page-number"];
    const found = detectFolio([page("98", ["99"])], [f]).findings;
    expect(found.map((x) => x.defect)).toEqual(["folio-marker-cross-spread"]);
    /* Саме від NEXT: `previous` дав «99», тобто сусіда по розвороту. */
    expect(found[0]!.claimed).toBe("101");

    /*
     * І коли хибні ОБИДВА — дві знахідки з РІЗНИМИ `id`. Однаковий `id` для
     * двох різних тверджень зробив би адресу знахідки неоднозначною там, де
     * вона єдине, чим оператор знаходить рамку.
     */
    const both = folioNoLiterals("98", [{ storyId: "s", previousPage: "97", nextPage: "101" }], "previous");
    both.paragraphs[0]!.markers = ["previous-page-number", "next-page-number"];
    const two = detectFolio([page("98", ["99"])], [both]).findings;
    expect(two).toHaveLength(2);
    expect(new Set(two.map((x) => x.id)).size).toBe(2);
  });

  it("прихований шар + САМ АВТОМАРКЕР — теж сплячий дубль", () => {
    /*
     * §4.9 пише «рамка З МАРКЕРОМ лежить на прихованому шарі», без звуження до
     * маркера СУСІДНЬОЇ сторінки. Звичайний сплячий дубль наступного видання —
     * це саме проста автоколонцифра на вимкненому шарі: увімкнули шар — і на
     * сторінці друга колонцифра.
     *
     * На ЦІЙ книжці різниці немає (усі три майстрові колонцифри несуть
     * `⟨PREVIOUS⟩–⟨AUTO⟩`, тож 29 сплячих дублів ловились і звуженим
     * тригером) — тому це тест, а не вимір.
     */
    const f: ClaimFrame = { ...folio("97", [], AUTO), layerVisible: false };
    const defects = detectFolio([page("97", ["96"])], [f]).findings.map((x) => x.defect);
    expect(defects).toContain("folio-dormant-duplicate");
  });

  it("checked і далі рахує РАМКИ, не абзаци", () => {
    /* Лічильники Фази 6 не міняються (спек §4.4): «вирівняти» їх під абзаци
     * означало б зламати злитий інструмент заради косметики. */
    const r = detectFolio(
      [page("96", ["97"], 0), page("97", ["96"], 1)],
      [folio("96", [97], AUTO), folio("97", [96], AUTO)],
    );
    expect(r.checked).toBe(2);
  });

  it("рамка з маркером і ЛІТЕРАЛОМ дає обидві знахідки — заміна не почалась", () => {
    /* Проміжний стан книжки: ручне число вже стоїть поруч із маркером
     * сусідньої сторінки. `folio-manual` (ручна половина зламається) і
     * `folio-marker-unbound` (маркерна половина вже бреше) кажуть про різні
     * половини тієї самої рамки, і сховати одну за другою не можна. */
    const f: ClaimFrame = { ...folio("97", [96], ["previous-page-number"]) };
    const defects = detectFolio([page("97", ["96"])], [f]).findings.map((x) => x.defect);
    expect(defects).toContain("folio-manual");
    expect(defects).toContain("folio-marker-unbound");
  });

  it("речення про надруковану пару «97–97» з'являється ЛИШЕ за наявності автомаркера", () => {
    /*
     * БОРГ ЗАДАЧІ 6Б (переогляд `a1004eb`, знахідка X1). Умова
     * `frame.paragraphs.some(… "auto-page-number")` у тексті
     * `folio-marker-cross-spread` не мала сторожа: мутант `true || …` проходив
     * повний юніт-набір зеленим (1230 passed).
     *
     * ЦЕ НЕ СТОРОЖ РЕДАКЦІЇ, А СТОРОЖ ГІЛКИ ПО ВИМІРЯНОМУ ВМІСТУ РАМКИ, і саме
     * тому він потрібен там, де для тексту сплячого дубля свідомо вирішили
     * тесту не ставити. Рамка з єдиним `⟨PREVIOUS⟩` друкує ОДНЕ число; сказати
     * про неї «надрукується «97–97»» означає ствердити стан, якого детектор не
     * перевіряв, — рівно та знахідка N1, яку попереднє коло вже закривало.
     *
     * Обидва боки перевіряються навмисно: сама лише відсутність рядка не
     * відрізнила б «умова працює» від «речення прибрали зовсім».
     */
    const own = folioNoLiterals("97", [{ storyId: "s", previousPage: "97" }], "previous");
    const withoutAuto = detectFolio([page("97", ["96"])], [own]).findings.find(
      (x) => x.defect === "folio-marker-cross-spread",
    )!;
    expect(withoutAuto.detail).toContain("OWN page 97");
    expect(withoutAuto.detail).not.toContain("97–97");

    const withAuto: ClaimFrame = { ...own };
    withAuto.paragraphs = [{ ...own.paragraphs[0]!, markers: ["previous-page-number", "auto-page-number"] }];
    const paired = detectFolio([page("97", ["96"])], [withAuto]).findings.find(
      (x) => x.defect === "folio-marker-cross-spread",
    )!;
    expect(paired.detail).toContain("97–97");
  });

  it("section-marker і text-variable НЕ вмикають сплячого дубля", () => {
    /*
     * БОРГ ЗАДАЧІ 6Б (переогляд `a1004eb`, знахідка X2). Межа оголошена вголос
     * у трьох місцях (докстрінг `hasPageNumberMarker`, спек §4.9, звіт), але
     * мутант «до тригера входить БУДЬ-ЯКИЙ маркер» виживав повний набір.
     *
     * Підстава межі — вимір, якого НЕМАЄ: `section-marker` називає секцію, а не
     * сторінку, а `text-variable` — інстанс змінної, вміст якої вимір не
     * розкриває (у цій книжці це `XREF_PAGE_NUMBER_TYPE` у ЗМІСТІ). Що надрукує
     * кожен із них після ввімкнення шару, ніхто не міряв, а вигадувати вердикт
     * для неміряного стану — те, чого вся фаза уникає навмисно.
     *
     * Позитивний контроль у тому ж тесті: без нього «межа тримається» не
     * відрізнити від «детектор сплячого дубля помер цілком».
     */
    const excluded: ClaimFrame = {
      ...folio("97", [], ["section-marker", "text-variable"]),
      layerVisible: false,
    };
    expect(detectFolio([page("97", ["96"])], [excluded]).findings).toEqual([]);

    const included: ClaimFrame = { ...folio("97", [], AUTO), layerVisible: false };
    expect(detectFolio([page("97", ["96"])], [included]).findings.map((x) => x.defect)).toEqual([
      "folio-dormant-duplicate",
    ]);
  });
});

/*
 * ДВІ ОДНОЙМЕННІ СТОРІНКИ — ВІДМОВА, А НЕ ВГАДУВАННЯ.
 *
 * Секція, що починає нумерацію заново (додаток), дає дві сторінки «3».
 * `new Map(pages.map(p => [p.name, p]))` лишає ОСТАННЮ, тож рамка на першій
 * судилася б проти сусідів, сторони й офсету другої. Наслідок двобічний:
 * правильна колонцифра діставала хибний folio-stale, а справді протухлий
 * літерал на тій самій сторінці проходив мовчки — і в обох випадках звіт
 * відсилав редактора не на ту сторінку.
 *
 * `src/pagination/rewrite.ts` цей стан уже відмовляється переписувати
 * (`ambiguous-page-name`, відтворено рецензією f5d3509) і в коментарі прямо
 * називає `detectFolio` як місце з такою самою мапою. Тепер відмовляється й
 * воно.
 */
describe("однойменні сторінки", () => {
  const перша = page("3", ["2"], 2);
  const друга = page("3", ["4"], 8);

  it("рамку на однойменній сторінці НЕ судять, а називають непорівняною", () => {
    const r = detectFolio([перша, друга], [folio("3", [2], [])]);
    const defects = r.findings.map((f) => f.defect);
    expect(defects).toContain("folio-ambiguous-page-name");
    expect(defects, "винесено вирок там, де сторінку розрізнити не можна").not.toContain(
      "folio-stale",
    );
    expect(r.notCompared).toBe(1);
    expect(r.checked).toBe(0);
  });

  it("відмова каже, скільки сторінок мають цю назву", () => {
    const r = detectFolio([перша, друга], [folio("3", [2], [])]);
    const f = r.findings.find((x) => x.defect === "folio-ambiguous-page-name")!;
    expect(f.detail).toContain("2 pages named");
    expect(f.claimed).toBeNull();
  });

  it("вона «не порівняно», а не «розійшлося» — тобто не в deviating", () => {
    const r = detectFolio([перша, друга], [folio("3", [2], [])]);
    const rep = buildReport({
      docName: "к.indd",
      folio: r,
      contents: null,
      runningHead: null,
      missingStyles: [],
      masterSkipped: [],
      masterIslands: [],
      detailFamily: null,
    });
    expect(rep.folio!.deviating).toBe(0);
  });

  it("НЕГАТИВНИЙ КОНТРОЛЬ: унікальна назва судиться як і раніше", () => {
    /* Без цього сторож, що відмовляється завжди, склав би всі перевірки вище
     * і вимкнув би родину folio назовсім. */
    const r = detectFolio([page("7", ["6"], 6)], [folio("7", [42], [])]);
    expect(r.findings.map((f) => f.defect)).toContain("folio-stale");
    expect(r.checked).toBe(1);
  });
});

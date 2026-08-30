import { describe, expect, it } from "vitest";
import { loadJsxInspect, throwingOn, TEXT_PATH_MISSING } from "./helpers/load-jsx-inspect.js";

/**
 * КОНТЕЙНЕР ІСТОРІЇ — НЕ ЗАВЖДИ ЕЛЕМЕНТ СТОРІНКИ.
 *
 * Ці тести стоять на вимірі, а не на здогаді. Зонд
 * `scripts/probe-textpath.jsx` (2026-08-18, InDesign 21.5.1.73, «Book B 2022
 * Print 3 copy.indd», 592 с.) знайшов серед 724 контейнерів
 * чотири TextPath і поіменно перелічив, що в них кидає, а що ні:
 *
 *   КИДАЮТЬ  parentPage · rotationAngle · geometricBounds · visibleBounds ·
 *            itemLayer · textFramePreferences   (усі 4 з 4)
 *   ЧИТАЮТЬСЯ id · previousTextFrame · nextTextFrame · overflows · parent ·
 *            characters · lines · paragraphs · contents   (усі 4 з 4)
 *
 * У власника (`container.parent`, Oval) читається ВСЕ, крім
 * `textFramePreferences`, і його `parentPage` — справжня сторінка тексту
 * (виміряно: с. 592 і с. 1).
 *
 * Саме тому це КЛАС, а не рядок: `layout_measure` упав спершу на
 * `parentPage`, після фіксу `ed2c666` — на `rotationAngle`, і далі в черзі
 * стояли `geometricBounds` та `itemLayer`.
 */

/** Сторінка з іменем — рівно те, що чіпає наш код. */
function page(name: string): object {
  return { name, documentOffset: 0 };
}

/** Звичайна текстова рамка: сама собі носій геометрії. */
function textFrame(onPage: object | null): object {
  return {
    id: 100,
    parentPage: onPage,
    rotationAngle: 0,
    geometricBounds: [10, 20, 30, 40],
    itemLayer: { name: "Шар 1", visible: true, printable: true },
    parent: { constructor: { name: "Spread" } },
  };
}

/**
 * Текст уздовж контуру: перелічені властивості КИДАЮТЬ, а `parent` — овал,
 * який їх усі має. Точна копія виміряної форми.
 */
function textPath(ownerPage: object | null): { path: object; owner: object } {
  const owner = {
    id: 99,
    parentPage: ownerPage,
    rotationAngle: 0,
    geometricBounds: [311.48, 353.26, 372.18, 413.96],
    visibleBounds: [311.48, 353.26, 372.18, 413.96],
    itemLayer: { name: "Шар 1", visible: true, printable: true },
    parent: { constructor: { name: "Group" } },
  };
  const path = throwingOn(
    {
      id: 4985,
      contents: "текст на контурі",
      previousTextFrame: null,
      nextTextFrame: null,
      overflows: false,
      parent: owner,
    },
    TEXT_PATH_MISSING,
  );
  return { path, owner };
}

describe("носій властивостей елемента сторінки (IDMCP.pageItemOf)", () => {
  it("для звичайної рамки носієм є вона сама", () => {
    const IDMCP = loadJsxInspect();
    const frame = textFrame(page("137"));
    expect(IDMCP.pageItemOf(frame)).toBe(frame);
  });

  it("для тексту вздовж контуру носієм є графічний власник", () => {
    const IDMCP = loadJsxInspect();
    const { path, owner } = textPath(page("592"));
    expect(IDMCP.pageItemOf(path)).toBe(owner);
  });

  it("рамка НА МОНТАЖНОМУ СТОЛІ лишається носієм сама собі", () => {
    /* `parentPage === null` читається БЕЗ кидка — тобто об'єкт таки є
     * елементом сторінки. Класифікувати його як «не PageItem» означало б
     * піти шукати носія в його батька-розвороті. */
    const IDMCP = loadJsxInspect();
    const frame = textFrame(null);
    expect(IDMCP.pageItemOf(frame)).toBe(frame);
  });

  it("носія немає взагалі, коли не має ні контейнер, ні його батько", () => {
    const IDMCP = loadJsxInspect();
    const orphan = throwingOn({ id: 1, parent: throwingOn({ id: 2 }, ["parentPage"]) }, [
      "parentPage",
    ]);
    expect(IDMCP.pageItemOf(orphan)).toBeNull();
  });

  it("null і undefined не кидають", () => {
    const IDMCP = loadJsxInspect();
    expect(IDMCP.pageItemOf(null)).toBeNull();
    expect(IDMCP.pageItemOf(undefined)).toBeNull();
  });
});

describe("сторінка контейнера (IDMCP.parentPageOf)", () => {
  it("текст уздовж контуру ТЕПЕР має сторінку — ту, що в його власника", () => {
    /*
     * НЕГАТИВНИЙ КОНТРОЛЬ ЦІЄЇ ЗАДАЧІ. Реалізація до 2026-08-18 віддавала
     * тут `null`: у `parentPageOf` не було резервного шляху через власника,
     * хоч у `pageNameFor` він був. Через це на ОДНІЙ І ТІЙ САМІЙ рамці
     * `document_map` казав «с. 592», а `layout_measure`, `styles_measure` і
     * `composition_measure` — «сторінки немає».
     */
    const IDMCP = loadJsxInspect();
    const { path } = textPath(page("592"));
    expect(IDMCP.parentPageOf(path)).not.toBeNull();
    expect(IDMCP.parentPageOf(path).name).toBe("592");
  });

  it("власник на монтажному столі дає чесний null", () => {
    const IDMCP = loadJsxInspect();
    const { path } = textPath(null);
    expect(IDMCP.parentPageOf(path)).toBeNull();
  });

  it("звичайна рамка не змінила поведінки", () => {
    const IDMCP = loadJsxInspect();
    expect(IDMCP.parentPageOf(textFrame(page("12"))).name).toBe("12");
    expect(IDMCP.parentPageOf(textFrame(null))).toBeNull();
  });
});

describe("назва сторінки й об'єкт сторінки НЕ МОЖУТЬ розійтися", () => {
  /*
   * §2.1 рецензії: доти це були дві незалежні реалізації, і вони давали
   * різні відповіді на тому самому контейнері. Тепер `pageNameFor`
   * побудований НАД `parentPageOf`, тож розбіжність структурно неможлива —
   * і цей тест тримає саме цю властивість, а не окремі числа.
   */
  const cases: Array<[string, object]> = [
    ["звичайна рамка на сторінці", textFrame(page("137"))],
    ["звичайна рамка на монтажному столі", textFrame(null)],
    ["текст уздовж контуру", textPath(page("592")).path],
    ["текст уздовж контуру поза сторінкою", textPath(null).path],
  ];

  for (const [label, container] of cases) {
    it(`${label}: pageNameFor === parentPageOf`, () => {
      const IDMCP = loadJsxInspect();
      const obj = IDMCP.parentPageOf(container);
      const expected = obj ? obj.name : "pasteboard";
      expect(IDMCP.pageNameFor(container)).toBe(expected);
    });
  }
});

describe("три стани замість двох (IDMCP.pageResolution)", () => {
  it("на сторінці: page є, resolved true", () => {
    const IDMCP = loadJsxInspect();
    const r = IDMCP.pageResolution(textFrame(page("5")));
    expect(r.resolved).toBe(true);
    expect(r.page.name).toBe("5");
  });

  it("монтажний стіл — це ФАКТ: page null, resolved true", () => {
    const IDMCP = loadJsxInspect();
    const r = IDMCP.pageResolution(textFrame(null));
    expect(r.resolved).toBe(true);
    expect(r.page).toBeNull();
  });

  it("не визначили — це НЕЗНАННЯ: page null, resolved FALSE", () => {
    /*
     * §2.6: доти обидва останні стани зливались в один `null`, і
     * `cli-extras` рахував «невідомо» як «точно поза сторінкою».
     * `pasteboardItems` тихо роздувався.
     */
    const IDMCP = loadJsxInspect();
    const orphan = throwingOn({ id: 1, parent: throwingOn({ id: 2 }, ["parentPage"]) }, [
      "parentPage",
    ]);
    const r = IDMCP.pageResolution(orphan);
    expect(r.resolved).toBe(false);
    expect(r.page).toBeNull();
  });
});

describe("розпізнавання тексту вздовж контуру (IDMCP.containerOnPath)", () => {
  it("текст на контурі — так", () => {
    const IDMCP = loadJsxInspect();
    expect(IDMCP.containerOnPath(textPath(page("592")).path)).toBe(true);
  });

  it("звичайна рамка — ні, навіть на монтажному столі", () => {
    const IDMCP = loadJsxInspect();
    expect(IDMCP.containerOnPath(textFrame(page("1")))).toBe(false);
    expect(IDMCP.containerOnPath(textFrame(null))).toBe(false);
  });

  it("нерозпізнаний контейнер — НІ: «не знаю» не видає себе за «на контурі»", () => {
    const IDMCP = loadJsxInspect();
    const orphan = throwingOn({ id: 1, parent: throwingOn({ id: 2 }, ["parentPage"]) }, [
      "parentPage",
    ]);
    expect(IDMCP.containerOnPath(orphan)).toBe(false);
  });
});

describe("ЦІНА резолву — рахуємо звернення до DOM, а не сподіваємось", () => {
  /*
   * ЦЕЙ БЛОК ІСНУЄ ЧЕРЕЗ ВЛАСНУ ПОМИЛКУ, ЗНАЙДЕНУ САМООГЛЯДОМ.
   *
   * Перша редакція правки мала чотири незалежні помічники, і кожен резолвив
   * носія заново. У `composition_measure` — найгарячішому циклі проєкту, по
   * виклику НА КОЖЕН РЯДОК книжки — сусідні `containerOnPath()` і
   * `parentPageOf()` давали ТРИ звернення `parentPage` там, де до правки було
   * ОДНЕ. Прохід композиції на «Book B» коштує 679 с; така платня
   * не з'явилась би в жодному тесті, бо всі вони зелені і при трьох.
   *
   * Тому лічильник тут явний: тест міряє САМЕ ТЕ, що пішло не так.
   */
  function лічильник(page: object | null) {
    let читань = 0;
    const owner = {
      id: 99,
      get parentPage() { читань++; return page; },
      rotationAngle: 0,
      parent: { constructor: { name: "Group" } },
    };
    const path = throwingOn(
      { id: 4985, contents: "x", parent: owner },
      TEXT_PATH_MISSING,
    );
    const frame = {
      id: 100,
      get parentPage() { читань++; return page; },
      rotationAngle: 0,
      parent: { constructor: { name: "Spread" } },
    };
    return { path, frame, читань: () => читань };
  }

  it("звичайна рамка — РІВНО одне звернення, як і до правки", () => {
    const IDMCP = loadJsxInspect();
    const c = лічильник(page("12"));
    const r = IDMCP.resolveContainerPage(c.frame);
    expect(r.page.name).toBe("12");
    expect(r.onPath).toBe(false);
    expect(c.читань()).toBe(1);
  });

  it("текст на контурі — два: своє, що кинуло, і власникове", () => {
    const IDMCP = loadJsxInspect();
    const c = лічильник(page("592"));
    const r = IDMCP.resolveContainerPage(c.path);
    expect(r.page.name).toBe("592");
    expect(r.onPath).toBe(true);
    /* Своє звернення КИНУЛО ще до інкремента, тож рахується лише власникове. */
    expect(c.читань()).toBe(1);
  });

  it("сторінка й «чи на контурі» дістаються ОДНИМ резолвом, а не двома", () => {
    /* Саме та пара викликів, що стояла в composition.jsx: доти вона коштувала
     * три звернення, тепер одне. */
    const IDMCP = loadJsxInspect();
    const c = лічильник(page("7"));
    const r = IDMCP.resolveContainerPage(c.frame);
    /* Усі три факти беруться з ОДНОГО результату — саме в цьому суть. */
    expect(r.onPath).toBe(false);
    expect(r.page.name).toBe("7");
    expect(r.carrier).toBe(c.frame);
    expect(c.читань()).toBe(1);
  });

  it("обгортки не додають звернень понад один резолв кожна", () => {
    const IDMCP = loadJsxInspect();
    for (const виклик of [
      (o: unknown) => IDMCP.parentPageOf(o),
      (o: unknown) => IDMCP.pageItemOf(o),
      (o: unknown) => IDMCP.containerOnPath(o),
      (o: unknown) => IDMCP.pageResolution(o),
      (o: unknown) => IDMCP.pageNameFor(o),
    ]) {
      const c = лічильник(page("3"));
      виклик(c.frame);
      expect(c.читань()).toBe(1);
    }
  });
});

describe("клас, а не рядок: жодне з виміряних читань не кидає через ворота", () => {
  /*
   * Тут перевіряється рівно те твердження, заради якого написана вся правка:
   * будь-яку властивість PageItem можна прочитати через носія, і жодна з них
   * не покладе прохід. Перелік — виміряний зондом, а не вигаданий.
   */
  const READ_BY_OUR_PASSES = [
    "parentPage",
    "rotationAngle",
    "geometricBounds",
    "visibleBounds",
    "itemLayer",
  ];

  for (const prop of READ_BY_OUR_PASSES) {
    it(`${prop} читається через носія й на контурі`, () => {
      const IDMCP = loadJsxInspect();
      const { path } = textPath(page("592"));
      const carrier = IDMCP.pageItemOf(path);
      expect(carrier).not.toBeNull();
      expect(() => carrier[prop]).not.toThrow();
    });

    it(`${prop} КИДАЄ, якщо читати сирим — саме через це падав прохід`, () => {
      const { path } = textPath(page("592"));
      expect(() => (path as Record<string, unknown>)[prop]).toThrow(
        /does not support the property/,
      );
    });
  }

  it("textFramePreferences не має НІ контейнер, НІ носій — і це не помилка", () => {
    /* Виміряно: властивість текстової РАМКИ, а не елемента сторінки. Інсетів
     * і колонок у тексту на контурі немає ні в кого, тому composition_measure
     * такий рядок оголошує невимірним, а не рахує з чужої геометрії. */
    const IDMCP = loadJsxInspect();
    const { path } = textPath(page("592"));
    const carrier = IDMCP.pageItemOf(path);
    expect(() => (path as Record<string, unknown>).textFramePreferences).toThrow();
    expect(carrier.textFramePreferences).toBeUndefined();
  });
});

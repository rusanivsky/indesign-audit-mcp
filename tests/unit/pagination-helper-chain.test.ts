import { describe, expect, it } from "vitest";
import { detectHelperChain } from "../../src/pagination/helper-chain.js";
import type { HelperChainMeasure, HelperFrameRef } from "../../src/pagination/types.js";

function link(page: string | null, offset: number | null, order: number, story = "10"): HelperFrameRef {
  return { frameId: `f${page ?? "x"}-${order}`, page, pageOffset: offset, storyId: story, orderInStory: order };
}

function chain(over: Partial<HelperChainMeasure> = {}): HelperChainMeasure {
  return {
    layerName: "_folio-helper",
    layerVisible: true,
    layerPrintable: false,
    layerLocked: false,
    storyIds: ["10"],
    frames: [link("1", 0, 0), link("2", 1, 1), link("3", 2, 2)],
    pagesWithoutFrame: [],
    ...over,
  };
}

describe("detectHelperChain", () => {
  it("МОВЧИТЬ, коли шару немає — це «не будували», а не «зламано»", () => {
    /*
     * Найважливіший тест файла. Полагодка `chain ?? порожній` дала б на КОЖНОМУ
     * документі без службового шару стільки знахідок «пропуск», скільки в ньому
     * сторінок — тобто інструмент кричав би на переважній більшості документів.
     */
    expect(detectHelperChain(null)).toEqual([]);
  });

  it("цілий ланцюжок не дає знахідок — негативний контроль", () => {
    expect(detectHelperChain(chain())).toEqual([]);
  });

  it("`printable = false` знахідки НЕ дає: виміряно, розв'язання воно не ламає", () => {
    /* Два булеві поля однакової форми поводяться протилежно (Питання 8 Фази 7):
     * `printable = false` — штатний стан цього шару, `visible = false` — дефект. */
    expect(detectHelperChain(chain({ layerPrintable: false }))).toEqual([]);
  });

  describe("пропуск ланки", () => {
    it("одна знахідка НА СТОРІНКУ, з її назвою", () => {
      const out = detectHelperChain(chain({
        pagesWithoutFrame: ["2", "3"],
        frames: [link("1", 0, 0)],
      }));
      expect(out.map((f) => f.defect)).toEqual(["folio-helper-chain-gap", "folio-helper-chain-gap"]);
      expect(out.map((f) => f.page)).toEqual(["2", "3"]);
    });

    it("адреси знахідок різні — інакше дві сторінки злилися б в одну", () => {
      const out = detectHelperChain(chain({ pagesWithoutFrame: ["2", "3"], frames: [link("1", 0, 0)] }));
      expect(new Set(out.map((f) => f.id)).size).toBe(2);
    });

    it("родина завжди folio — знахідки вливаються в неї", () => {
      const out = detectHelperChain(chain({ pagesWithoutFrame: ["2"], frames: [link("1", 0, 0)] }));
      expect(out[0]!.family).toBe("folio");
    });
  });

  describe("порядок ланцюжка", () => {
    it("перетасована ланка дає знахідку на місце розриву", () => {
      const out = detectHelperChain(chain({
        frames: [link("1", 0, 0), link("3", 2, 1), link("2", 1, 2)],
      }));
      expect(out).toHaveLength(1);
      expect(out[0]!.defect).toBe("folio-helper-chain-unordered");
      expect(out[0]!.page).toBe("2");
    });

    it("РІВНИЙ offset розривом НЕ вважається — межа `>` проти `>=`", () => {
      /*
       * Дві ланки на одній сторінці — робота ремонту (крок 1), а не дефект
       * порядку: порядок тут не порушено. Мутант `>=` падає саме тут.
       */
      const out = detectHelperChain(chain({
        frames: [link("1", 0, 0), link("1", 0, 1), link("2", 1, 2)],
      }));
      expect(out.filter((f) => f.defect === "folio-helper-chain-unordered")).toEqual([]);
    });

    it("рамка-сирота в порядку НЕ бере участі", () => {
      /*
       * `pageOffset === null` — сторінки немає, тож «раніше чи пізніше» про неї
       * не означене. Прибирає її ремонт; давати тут дефект порядку означало б
       * вести оператора не туди.
       *
       * СИРОТА СТОЇТЬ САМЕ ТУТ, І ЦЕ ЗНАЙДЕНО МУТАНТОМ, А НЕ ОБРАНО ЗІ СМАКУ.
       * Перша редакція тесту ставила її ДРУГОЮ, після сторінки з `offset = 0`, —
       * і мутант «не фільтрувати сиріт» проходив зеленим на всіх 19 тестах.
       * Причина в JS: `null` у порівнянні `>` зводиться до нуля, тож `0 > null`
       * хибне, і сирота після ПЕРШОЇ сторінки хибної знахідки не дає ні з
       * фільтром, ні без нього. Хибну знахідку вона дає лише тоді, коли стоїть
       * після сторінки з `offset > 0`: тоді `1 > null` → `1 > 0` → істина.
       */
      const out = detectHelperChain(chain({
        frames: [link("1", 0, 0), link("2", 1, 1), link(null, null, 2), link("3", 2, 3)],
      }));
      expect(out.filter((f) => f.defect === "folio-helper-chain-unordered")).toEqual([]);
    });

    it("порядок читається з orderInStory, а не з порядку масиву", () => {
      /* Виміряно (`H8`, Питання 3б): після розшивання порядок обходу
       * `layer.pageItems` не збігається з порядком сторінок ані з порядком
       * ланцюжка. Покладатись на порядок масиву не можна ніде. */
      const out = detectHelperChain(chain({
        frames: [link("3", 2, 2), link("1", 0, 0), link("2", 1, 1)],
      }));
      expect(out).toEqual([]);
    });

    it("порядок рахується В МЕЖАХ історії, а не наскрізно", () => {
      /*
       * Дві історії мають власну нумерацію `orderInStory`, і зшивати їх в один
       * ряд не можна: наскрізне порівняння дало б хибний «розрив» на кожному
       * стику. Розпад ловить окремий дефект нижче.
       */
      const out = detectHelperChain(chain({
        storyIds: ["10", "20"],
        frames: [
          link("1", 0, 0, "10"), link("2", 1, 1, "10"),
          link("3", 2, 0, "20"), link("4", 3, 1, "20"),
        ],
      }));
      expect(out.filter((f) => f.defect === "folio-helper-chain-unordered")).toEqual([]);
    });
  });

  describe("прихований шар", () => {
    it("ОДНА знахідка на документ, page: null", () => {
      const out = detectHelperChain(chain({ layerVisible: false }));
      expect(out).toHaveLength(1);
      expect(out[0]!.defect).toBe("folio-helper-chain-hidden");
      expect(out[0]!.page).toBeNull();
    });

    it("НЕ глушить перевірку пропуску — перевірки незалежні", () => {
      /* Дзеркало помилки Фази 7, де `continue` в одній гілці глушив усі три
       * детектори одразу. */
      const out = detectHelperChain(chain({
        layerVisible: false,
        pagesWithoutFrame: ["3"],
        frames: [link("1", 0, 0), link("2", 1, 1)],
      }));
      expect(out.map((f) => f.defect).sort()).toEqual([
        "folio-helper-chain-gap",
        "folio-helper-chain-hidden",
      ]);
    });
  });

  describe("розпад ланцюжка", () => {
    it("дублювання сторінки: рамка є на кожній, порядок монотонний — і все одно дефект", () => {
      /*
       * ВИМІРЯНИЙ СТАН (`H8`, Питання 2), і він робить два інші детектори
       * сліпими: `pagesWithoutFrame` порожній, головна історія `1,2,3,5,6,7`
       * не спадає. Ловить лише цей дефект.
       */
      const out = detectHelperChain(chain({
        storyIds: ["256", "404"],
        pagesWithoutFrame: [],
        frames: [
          link("1", 0, 0, "256"), link("2", 1, 1, "256"), link("3", 2, 2, "256"),
          link("5", 4, 3, "256"), link("6", 5, 4, "256"), link("7", 6, 5, "256"),
          link("4", 3, 0, "404"),
        ],
      }));
      expect(out).toHaveLength(1);
      expect(out[0]!.defect).toBe("folio-helper-chain-split");
      /* Адреса — сторінка ВІДКОЛОТОЇ ланки, бо саме там оператор побачить збій. */
      expect(out[0]!.page).toBe("4");
    });

    it("одна історія — знахідки немає", () => {
      expect(detectHelperChain(chain({ storyIds: ["10"] }))).toEqual([]);
    });

    it("три історії дають ДВІ знахідки — по одній на кожну зайву", () => {
      const out = detectHelperChain(chain({
        storyIds: ["10", "20", "30"],
        frames: [
          link("1", 0, 0, "10"), link("2", 1, 1, "10"),
          link("3", 2, 0, "20"),
          link("4", 3, 0, "30"),
        ],
      }));
      expect(out.filter((f) => f.defect === "folio-helper-chain-split")).toHaveLength(2);
      expect(out.map((f) => f.page).sort()).toEqual(["3", "4"]);
    });

    it("головним вважається НАЙДОВШИЙ ланцюжок, а не перший за порядком", () => {
      /* Інакше при розпаді 1+6 «зайвою» оголосили б шістку, і оператор пішов би
       * лагодити цілий ланцюжок замість відколотої ланки. */
      const out = detectHelperChain(chain({
        storyIds: ["10", "20"],
        frames: [
          link("1", 0, 0, "10"),
          link("2", 1, 0, "20"), link("3", 2, 1, "20"), link("4", 3, 2, "20"),
        ],
      }));
      expect(out).toHaveLength(1);
      expect(out[0]!.page).toBe("1");
    });

    it("при РІВНІЙ довжині головним вважається той, що починається раніше", () => {
      /* Довільний вибір тут дав би недетермінований звіт на тому самому
       * документі — а це найгірше, що може зробити інструмент виявності. */
      const out = detectHelperChain(chain({
        storyIds: ["99", "11"],
        frames: [
          link("3", 2, 0, "99"), link("4", 3, 1, "99"),
          link("1", 0, 0, "11"), link("2", 1, 1, "11"),
        ],
      }));
      expect(out).toHaveLength(1);
      expect(out[0]!.page).toBe("3");
    });
  });

  describe("«не міряли» не сміє ставати дефектом", () => {
    /*
     * ДВА СТАНИ, І ОБИДВА ДАЮТЬ ВИГАДАНИЙ ДЕФЕКТ, ЯКЩО ЇХ НЕ ВІДСІЯТИ. §3
     * називає вигаданий дефект гіршою відмовою, ніж пропущений: оператор іде
     * лагодити те, чого немає.
     */
    it("orderInStory = −1 НЕ дає хибного розриву порядку", () => {
      /* Мінус один сортується першим, тож ланка з великим `pageOffset` стала б
       * початком ланцюжка, і наступне порівняння дало б «розрив». */
      const out = detectHelperChain(chain({
        frames: [link("1", 0, 0), link("2", 1, 1), link("3", 2, -1)],
      }));
      expect(out.filter((f) => f.defect === "folio-helper-chain-unordered")).toEqual([]);
    });

    it("storyId = \"\" НЕ дає хибного розпаду", () => {
      /* Порожній рядок — це не ім'я історії, а його відсутність. Групувати за
       * ним означало б оголосити ланку окремим ланцюжком. */
      const out = detectHelperChain(chain({
        storyIds: ["10"],
        frames: [link("1", 0, 0), link("2", 1, 1), { ...link("3", 2, 2), storyId: "" }],
      }));
      expect(out.filter((f) => f.defect === "folio-helper-chain-split")).toEqual([]);
    });
  });

  it("усі чотири дефекти можуть звучати одночасно", () => {
    const out = detectHelperChain(chain({
      layerVisible: false,
      storyIds: ["10", "20"],
      pagesWithoutFrame: ["5"],
      frames: [
        link("1", 0, 0, "10"), link("3", 2, 1, "10"), link("2", 1, 2, "10"),
        link("4", 3, 0, "20"),
      ],
    }));
    expect(new Set(out.map((f) => f.defect))).toEqual(new Set([
      "folio-helper-chain-hidden",
      "folio-helper-chain-gap",
      "folio-helper-chain-unordered",
      "folio-helper-chain-split",
    ]));
  });
});

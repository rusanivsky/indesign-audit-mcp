import { describe, expect, it } from "vitest";
import {
  buildReport,
  MAX_ANCHORED_ROWS,
  MAX_DETAIL_ROWS,
  MAX_PAGES_PER_ROW,
  type GeometryInventoryInput,
  type PopulationFamily,
  type ReportOptions,
} from "../../src/geometry/report.js";
import { hasWrapMaterial } from "../../src/geometry/wrap.js";
import { serialise } from "../../src/tools/shared.js";
import type { Family, GeometryFinding, GeometryMeasure, ItemMeasure } from "../../src/geometry/types.js";

const ALL_FAMILIES: Family[] = ["frame", "image", "anchored", "wrap"];

function measure(over: Partial<GeometryMeasure> = {}): GeometryMeasure {
  return {
    docName: "тест.indd", units: "points", traversal: "page.allPageItems",
    /* Звичайний стан робочої книжки — виміряно 2026-08-15. */
    rulerOrigin: "PAGE_ORIGIN", zeroPoint: [0, 0],
    ms: 744, pages: [], items: [], ...over,
  };
}

function inventory(over: Partial<GeometryInventoryInput> = {}): GeometryInventoryInput {
  return { anchored: [], graphics: [], wrap: [], ...over };
}

/**
 * Опції за замовчуванням ТЕСТУ (не інструмента): усі родини запитано,
 * інвентарі порожні. `families` в самому `ReportOptions` замовчування не має
 * й мати не може — викликач мусить сказати, що він рахував.
 */
function opts(over: Partial<ReportOptions> = {}): ReportOptions {
  return { families: ALL_FAMILIES, rotatedExcluded: 0, inventory: inventory(), ...over };
}

function finding(over: Partial<GeometryFinding> = {}): GeometryFinding {
  return {
    family: "frame", defect: "frame-near-miss", pages: ["1"], count: 1,
    value: "0.05 pt", ...over,
  };
}

function wrapItem(wrapMode: string | null): ItemMeasure {
  return {
    itemId: 1, page: "1", side: "right", type: "TextFrame", parentKind: "Spread",
    anchored: false, inGroup: false, layer: "Шар 1", layerVisible: true,
    layerPrintable: true, locked: false, rotation: 0,
    bounds: [0, 0, 10, 10], wrapMode, wrapOffsets: null,
    anchorStyle: null, graphic: null,
  };
}

describe("buildReport", () => {
  it("measuredWith обов'язкове й неспорожнюване", () => {
    /* Фаза виміряла ЧОТИРИ прилади з чотирма різними числами. Відповідь без
     * measuredWith не відрізнити від відповіді, знятої іншим приладом. */
    const r = buildReport(measure(), [], opts());
    expect(r.measuredWith.traversal).toBe("page.allPageItems");
    expect(r.measuredWith.units).toBe("points");
    expect(r.measuredWith.ms).toBe(744);
  });

  it("notMeasured називає повернені рамки, виключені з вироку", () => {
    const r = buildReport(measure(), [], opts({ rotatedExcluded: 91 }));
    const note = r.notMeasured.find((n) => n.includes("rotated"));
    expect(note).toBeDefined();
    expect(note).toContain("91");
  });

  it("порожній звіт відрізняється від звіту, який нічого не міг перевірити", () => {
    const empty = buildReport(measure(), [], opts());
    const blind = buildReport(measure(), [], opts({ anchorRuleNamed: false }));
    expect(empty.notMeasured).not.toEqual(blind.notMeasured);
  });

  it("обрізає деталі за стелею й КАЖЕ про це", () => {
    const many = Array.from({ length: MAX_DETAIL_ROWS + 10 }, (_, i) =>
      finding({ value: `${i} pt` }),
    );
    const r = buildReport(measure(), many, opts());
    expect(r.findings).toHaveLength(MAX_DETAIL_ROWS);
    expect(r.truncated).toEqual({ shown: MAX_DETAIL_ROWS, total: MAX_DETAIL_ROWS + 10 });
  });

  it("не обрізає, коли обрізати нема чого", () => {
    const r = buildReport(measure(), [finding()], opts());
    expect(r.truncated).toBeNull();
  });

  it("notMeasured завжди містить нереалізований детектор «обтікання, що нічого не обтікає»", () => {
    /* wrap.ts (Задача 10б) свідомо не реалізує третій детектор родини й
     * обіцяє винести це в notMeasured звіту (Задача 11) — незалежно від
     * опцій виклику, бо це стала межа інструмента, а не наслідок відсутнього
     * параметра користувача. */
    const r = buildReport(measure(), [], opts());
    const note = r.notMeasured.find((n) => n.includes("isn't implemented"));
    expect(note).toBeDefined();
  });

  /*
   * Раунд виправлень 1 (рецензія сусідньої задачі, plan-vs-spec): §8 спеку
   * називає ДВА пункти notMeasured, яких у Задачі 11 не було заведено взагалі
   * — «вектор без ppi» і «популяції, яких у документі немає». Кожен рядок
   * нижче має ПОЗИТИВНОГО й НЕГАТИВНОГО близнюка: мовчазна відсутність рядка
   * має бути неможливою, а не просто малоймовірною.
   */
  describe("notMeasured — вектор без ppi (§8, Раунд 1)", () => {
    it("є вектори — рядок про них є, і називає ЧОМУ (властивість, не брак виміру)", () => {
      const r = buildReport(measure(), [], opts({ vectorGraphicsCount: 2 }));
      const note = r.notMeasured.find((n) => n.includes("vector"));
      expect(note).toBeDefined();
      expect(note).toContain("2");
      expect(note).toMatch(/BY CONSTRUCTION/i);
    });

    it("позитивний близнюк: НЕМА векторів — рядка про вектор немає", () => {
      const r = buildReport(measure(), [], opts({ vectorGraphicsCount: 0 }));
      expect(r.notMeasured.find((n) => n.includes("vector"))).toBeUndefined();
    });

    it("опцію не передано взагалі — рядка про вектор немає (той самий стан, що 0)", () => {
      const r = buildReport(measure(), [], opts());
      expect(r.notMeasured.find((n) => n.includes("vector"))).toBeUndefined();
    });
  });

  describe("notMeasured — порожні популяції (§8, Раунд 1)", () => {
    it("родина без матеріалу — рядок про НЕЇ є (anchored)", () => {
      const r = buildReport(measure(), [], opts({ emptyPopulations: ["anchored"] }));
      const note = r.notMeasured.find((n) => n.includes("no anchored objects"));
      expect(note).toBeDefined();
    });

    it("родина без матеріалу — рядок про НЕЇ є (image)", () => {
      const r = buildReport(measure(), [], opts({ emptyPopulations: ["image"] }));
      const note = r.notMeasured.find((n) => n.includes("no graphics"));
      expect(note).toBeDefined();
    });

    it("родина без матеріалу — рядок про НЕЇ є (wrap)", () => {
      const r = buildReport(measure(), [], opts({ emptyPopulations: ["wrap"] }));
      const note = r.notMeasured.find((n) => n.includes("Text wrap isn't applied"));
      expect(note).toBeDefined();
    });

    it("позитивний близнюк: родина МАЄ матеріал — жодного з трьох рядків немає", () => {
      const r = buildReport(measure(), [], opts({ emptyPopulations: [] }));
      expect(r.notMeasured.find((n) => n.includes("no anchored objects"))).toBeUndefined();
      expect(r.notMeasured.find((n) => n.includes("no graphics"))).toBeUndefined();
      expect(r.notMeasured.find((n) => n.includes("Text wrap isn't applied"))).toBeUndefined();
    });

    it("опцію не передано взагалі — той самий стан, що порожній масив: жодного рядка", () => {
      const r = buildReport(measure(), [], opts());
      expect(r.notMeasured.find((n) => n.includes("no anchored objects"))).toBeUndefined();
      expect(r.notMeasured.find((n) => n.includes("no graphics"))).toBeUndefined();
      expect(r.notMeasured.find((n) => n.includes("Text wrap isn't applied"))).toBeUndefined();
    });

    it("три порожні популяції одразу — три окремі рядки, жоден не проковтнутий", () => {
      const r = buildReport(measure(), [], opts({ emptyPopulations: ["anchored", "image", "wrap"] }));
      expect(r.notMeasured.filter((n) => n.includes("no anchored objects"))).toHaveLength(1);
      expect(r.notMeasured.filter((n) => n.includes("no graphics"))).toHaveLength(1);
      expect(r.notMeasured.filter((n) => n.includes("Text wrap isn't applied"))).toHaveLength(1);
    });
  });

  /*
   * Рецензія ГІЛКИ (2026-08-15). Знахідки I2/I4/I5/I6 — кожна про те, що
   * відповідь описувала не той вимір, який насправді відбувся.
   */
  describe("I4 — джерело координат назване в measuredWith", () => {
    it("measuredWith несе rulerOrigin і zeroPoint, а не лише обхід і одиниці", () => {
      /* geometricBounds мовчки віддає інші числа в документі з пересунутим
       * нулем лінійки — і жодна перевірка цього не помітить. */
      const r = buildReport(measure(), [], opts());
      expect(r.measuredWith.coordinateOrigin.rulerOrigin).toBe("PAGE_ORIGIN");
      expect(r.measuredWith.coordinateOrigin.zeroPoint).toEqual([0, 0]);
    });

    it("нестандартний нуль лінійки — caveat, а не мовчанка", () => {
      const r = buildReport(measure({ rulerOrigin: "SPREAD_ORIGIN" }), [], opts());
      expect(r.caveats.find((c) => c.includes("SPREAD_ORIGIN"))).toBeDefined();
    });

    it("пересунута нульова точка — окремий caveat", () => {
      const r = buildReport(measure({ zeroPoint: [10, -5] }), [], opts());
      expect(r.caveats.find((c) => c.includes("[10, -5]"))).toBeDefined();
    });

    it("позитивний близнюк: звичайний початок координат — жодного зайвого caveat", () => {
      /* Інакше попередні два тести проходили б і на коді, що додає caveat
       * завжди — тобто ні про що не свідчили б. */
      const r = buildReport(measure(), [], opts());
      expect(r.caveats.find((c) => c.includes("ruler zero"))).toBeUndefined();
      expect(r.caveats.find((c) => c.includes("zero point has been moved"))).toBeUndefined();
    });
  });

  describe("I5 — майстрові елементи названі як межа ПРИЛАДУ", () => {
    it("рядок про майстрові елементи є завжди", () => {
      /* page.allPageItems не бачить непереозначених майстрових елементів
       * (зонд H7 Фази 10: 50 колонцифр дали нуль). Спек §2 обіцяє
       * походження fromMaster, і його немає ніде. */
      const r = buildReport(measure(), [], opts());
      expect(r.notMeasured.find((n) => n.includes("Master-page elements"))).toBeDefined();
    });

    it("і не зникає, коли просять одну родину — це межа приладу, не родини", () => {
      const r = buildReport(measure(), [], opts({ families: ["image"] }));
      expect(r.notMeasured.find((n) => n.includes("Master-page elements"))).toBeDefined();
    });
  });

  describe("I6 — inventory й notMeasured слухаються фільтра families", () => {
    it("families: [\"frame\"] — жодного рядка про anchored/image/wrap", () => {
      /* До 2026-08-15 відповідь на families: ["frame"] однаково заявляла, що
       * anchored/image/wrap не судились через брак параметра — для родин,
       * яких користувач не просив. notMeasured — обіцянка про МЕЖІ ВИМІРУ, і
       * рядок про непроведений вимір там, де виміру й не просили, робить цю
       * обіцянку неправдою. */
      const r = buildReport(measure(), [], opts({
        families: ["frame"],
        anchorRuleNamed: false,
        resolutionThresholdNamed: false,
        vectorGraphicsCount: 7,
        emptyPopulations: ["anchored", "image", "wrap"],
      }));
      expect(r.notMeasured.find((n) => n.includes("Anchored-object geometry"))).toBeUndefined();
      expect(r.notMeasured.find((n) => n.includes("resolution"))).toBeUndefined();
      expect(r.notMeasured.find((n) => n.includes("vector"))).toBeUndefined();
      expect(r.notMeasured.find((n) => n.includes("no anchored objects"))).toBeUndefined();
      expect(r.notMeasured.find((n) => n.includes("no graphics"))).toBeUndefined();
      expect(r.notMeasured.find((n) => n.includes("Text wrap isn't applied"))).toBeUndefined();
      expect(r.notMeasured.find((n) => n.includes("isn't implemented"))).toBeUndefined();
    });

    it("позитивний близнюк: ті самі опції з усіма родинами — усі рядки на місці", () => {
      /* Без цього близнюка попередній тест проходив би й на коді, що просто
       * не додає цих рядків НІКОЛИ. */
      const r = buildReport(measure(), [], opts({
        families: ALL_FAMILIES,
        anchorRuleNamed: false,
        resolutionThresholdNamed: false,
        vectorGraphicsCount: 7,
        emptyPopulations: ["anchored", "image", "wrap"],
      }));
      expect(r.notMeasured.find((n) => n.includes("Anchored-object geometry"))).toBeDefined();
      expect(r.notMeasured.find((n) => n.includes("Image resolution was not assessed"))).toBeDefined();
      expect(r.notMeasured.find((n) => n.includes("vector"))).toBeDefined();
      expect(r.notMeasured.find((n) => n.includes("no anchored objects"))).toBeDefined();
      expect(r.notMeasured.find((n) => n.includes("no graphics"))).toBeDefined();
      expect(r.notMeasured.find((n) => n.includes("Text wrap isn't applied"))).toBeDefined();
      expect(r.notMeasured.find((n) => n.includes("isn't implemented"))).toBeDefined();
    });

    it("рядок про повернені рамки — лише коли просять frame", () => {
      const withFrame = buildReport(measure(), [], opts({ rotatedExcluded: 91 }));
      const withoutFrame = buildReport(measure(), [], opts({
        families: ["image"],
        rotatedExcluded: 91,
      }));
      expect(withFrame.notMeasured.find((n) => n.includes("rotated"))).toBeDefined();
      expect(withoutFrame.notMeasured.find((n) => n.includes("rotated"))).toBeUndefined();
    });
  });

  describe("I2 — інвентар усередині ВІДПОВІДІ, і так само обрізаний", () => {
    it("inventory й survey — поля звіту, а не доважок поруч", () => {
      /* Доки вони доклеювались у tools/geometry.ts через spread, вимір
       * обсягу важив звіт БЕЗ них — тобто не ту відповідь, яку інструмент
       * віддає. */
      const r = buildReport(measure(), [], opts({
        inventory: inventory({ wrap: [{ mode: "NONE", count: 965 }] }),
        survey: [{ bucket: "≤1", count: 46 }],
      }));
      expect(r.inventory.wrap).toEqual([{ mode: "NONE", count: 965 }]);
      expect(r.survey).toEqual([{ bucket: "≤1", count: 46 }]);
    });

    it("survey не передано — поле є й дорівнює null (а не зникає з відповіді)", () => {
      const r = buildReport(measure(), [], opts());
      expect(r.survey).toBeNull();
    });

    it("інвентар графіки обрізається за тією ж стелею, що й findings, і КАЖЕ про це", () => {
      /* Книжка з 400 фото давала б ~80 КБ — рівно той провал, яким Фаза 4
       * вивела інструмент із ладу. */
      const many = Array.from({ length: MAX_DETAIL_ROWS + 40 }, (_, i) => ({
        page: String(i), kind: "raster" as const, linkName: `ф${i}.tif`, linkStatus: "NORMAL",
        measured: "растр", effectivePpi: 300, actualPpi: 300, scale: "100.0×100.0 %",
      }));
      const r = buildReport(measure(), [], opts({ inventory: inventory({ graphics: many }) }));
      expect(r.inventory.graphics).toHaveLength(MAX_DETAIL_ROWS);
      expect(r.inventory.graphicsTruncated).toEqual({
        shown: MAX_DETAIL_ROWS,
        total: MAX_DETAIL_ROWS + 40,
      });
    });

    it("позитивний близнюк: інвентар нижчий за стелю не обрізається й не бреше про це", () => {
      const few = [{
        page: "1", kind: "vector" as const, linkName: "лого.ai", linkStatus: "NORMAL",
        measured: "вектор", effectivePpi: null, actualPpi: null, scale: "100.0×100.0 %",
      }];
      const r = buildReport(measure(), [], opts({ inventory: inventory({ graphics: few }) }));
      expect(r.inventory.graphics).toHaveLength(1);
      expect(r.inventory.graphicsTruncated).toBeNull();
    });

    it("довгий список СТОРІНОК в одному рядку обрізається, і pagesTotal каже скільки було", () => {
      /* Друге, непомічене джерело обсягу: обрізання РЯДКІВ не рятує, коли
       * один рядок несе сотні назв сторінок (на книжці «Нумерація питань» —
       * 185 елементів). Мовчазно вкорочений список читався б як повний. */
      const pages = Array.from({ length: MAX_PAGES_PER_ROW + 30 }, (_, i) => String(i + 1));
      const r = buildReport(measure(), [finding({ pages, count: pages.length })], opts());
      expect(r.findings[0]!.pages).toHaveLength(MAX_PAGES_PER_ROW);
      expect(r.findings[0]!.pagesTotal).toBe(MAX_PAGES_PER_ROW + 30);
      /* count — це елементи, і він НЕ обрізається: обрізано показ, не вимір. */
      expect(r.findings[0]!.count).toBe(MAX_PAGES_PER_ROW + 30);
    });

    it("позитивний близнюк: короткий список сторінок не обрізається й pagesTotal не з'являється", () => {
      const r = buildReport(measure(), [finding({ pages: ["1", "2"] })], opts());
      expect(r.findings[0]!.pages).toEqual(["1", "2"]);
      expect(r.findings[0]!.pagesTotal).toBeUndefined();
    });

    /*
     * Рішення користувача 2026-08-15: стеля на КІЛЬКІСТЬ рядків
     * `inventory.anchored`. Доти це було єдине місце відповіді без верхньої
     * межі взагалі — обрізались лише списки сторінок УСЕРЕДИНІ рядка, а
     * самих рядків могло бути скільки завгодно (~657 Б кожен, лінійно:
     * 500 популяцій давали 394 751 Б проти 68 485 Б на чотирьох).
     */
    describe("MAX_ANCHORED_ROWS — стеля рядків інвентаря anchored", () => {
      function anchoredRows(n: number) {
        return Array.from({ length: n }, (_, i) => ({
          style: `Популяція ${i}`, type: "TextFrame", count: 10,
          pages: ["1", "2"], sampleWidth: 28.3, sampleHeight: 48,
        }));
      }

      it("популяцій БІЛЬШЕ за стелю — рядків рівно стеля, і поле каже правду", () => {
        const r = buildReport(measure(), [], opts({
          inventory: inventory({ anchored: anchoredRows(MAX_ANCHORED_ROWS + 40) }),
        }));
        expect(r.inventory.anchored).toHaveLength(MAX_ANCHORED_ROWS);
        expect(r.inventory.anchoredTruncated).toEqual({
          shown: MAX_ANCHORED_ROWS,
          total: MAX_ANCHORED_ROWS + 40,
        });
      });

      it("популяцій МЕНШЕ за стелю — обрізання немає, і поле про це не бреше", () => {
        /* Позитивний близнюк: інакше попередній тест проходив би й на коді,
         * що обрізає завжди. Робоча книжка — рівно цей випадок (4 популяції). */
        const r = buildReport(measure(), [], opts({
          inventory: inventory({ anchored: anchoredRows(4) }),
        }));
        expect(r.inventory.anchored).toHaveLength(4);
        expect(r.inventory.anchoredTruncated).toBeNull();
      });

      it("популяцій РІВНО стеля — це ще не обрізання", () => {
        /* Межа сама: `>` проти `>=` — саме той один символ, що змусив би звіт
         * заявити обрізання, якого не сталося. */
        const r = buildReport(measure(), [], opts({
          inventory: inventory({ anchored: anchoredRows(MAX_ANCHORED_ROWS) }),
        }));
        expect(r.inventory.anchored).toHaveLength(MAX_ANCHORED_ROWS);
        expect(r.inventory.anchoredTruncated).toBeNull();
      });

      it("стеля тримає ОБСЯГ: 500 популяцій важать не більше, ніж 18", () => {
        /* Власне те, заради чого стеля й з'явилась: без зрізу 500 популяцій
         * давали 394 751 Б. Мутант «прибрати зріз» червонить саме тут. */
        const at18 = serialise(buildReport(measure(), [], opts({
          inventory: inventory({ anchored: anchoredRows(MAX_ANCHORED_ROWS) }),
        })));
        const at500 = serialise(buildReport(measure(), [], opts({
          inventory: inventory({ anchored: anchoredRows(500) }),
        })));
        /* Різниця лише в полі anchoredTruncated — кілька десятків байтів,
         * а не сотні кілобайтів. */
        expect(Buffer.byteLength(at500, "utf8") - Buffer.byteLength(at18, "utf8")).toBeLessThan(200);
      });

      it("обрізання рядків не мутує вхідного масиву викликача", () => {
        const rows = anchoredRows(MAX_ANCHORED_ROWS + 5);
        buildReport(measure(), [], opts({ inventory: inventory({ anchored: rows }) }));
        expect(rows).toHaveLength(MAX_ANCHORED_ROWS + 5);
      });
    });

    it("рядки інвентаря anchored обрізаються так само, як знахідки", () => {
      const pages = Array.from({ length: MAX_PAGES_PER_ROW + 5 }, (_, i) => String(i + 1));
      const r = buildReport(measure(), [], opts({
        inventory: inventory({
          anchored: [{
            style: "Нумерація питань", type: "TextFrame", count: 185,
            pages, sampleWidth: 28.3, sampleHeight: 48,
          }],
        }),
      }));
      expect(r.inventory.anchored[0]!.pages).toHaveLength(MAX_PAGES_PER_ROW);
      expect(r.inventory.anchored[0]!.pagesTotal).toBe(MAX_PAGES_PER_ROW + 5);
    });

    it("обрізання НЕ мутує вхідних даних викликача", () => {
      /* Інакше повторний виклик на тому самому вимірі давав би інший
       * результат — і вимір обсягу залежав би від того, котрий він за
       * рахунком. */
      const pages = Array.from({ length: MAX_PAGES_PER_ROW + 5 }, (_, i) => String(i + 1));
      const row = {
        style: "Нумерація питань", type: "TextFrame", count: 185,
        pages, sampleWidth: 28.3, sampleHeight: 48,
      };
      buildReport(measure(), [], opts({ inventory: inventory({ anchored: [row] }) }));
      expect(row.pages).toHaveLength(MAX_PAGES_PER_ROW + 5);
    });
  });

  /*
   * Раунд виправлень 2 (рецензія): попередні тести вище задавали
   * `emptyPopulations` ЛІТЕРАЛОМ, тож не могли спіймати неправильний
   * КРИТЕРІЙ обчислення цього масиву (саме такий розрив пропустив Раунд 1:
   * критерій `inventoryWrap().length === 0` мовчав би про робочу книжку).
   * Тести нижче рахують `emptyPopulations` для wrap ТОЮ Ж функцією
   * (`hasWrapMaterial`), якою її рахує `src/tools/geometry.ts`, — і саме на
   * межі, що виявила рецензія: усі елементи `NONE` (стан робочої книжки).
   */
  describe("notMeasured — wrap: критерій «матеріал для вироку», не «інвентар непорожній» (Раунд 2)", () => {
    function emptyPopulationsFor(items: ItemMeasure[]): PopulationFamily[] {
      const out: PopulationFamily[] = [];
      if (!hasWrapMaterial(items)) out.push("wrap");
      return out;
    }

    it("книжковий стан: усі елементи NONE — рядок про порожній wrap Є", () => {
      const items = [wrapItem("NONE"), wrapItem("NONE")];
      const r = buildReport(measure(), [], opts({ emptyPopulations: emptyPopulationsFor(items) }));
      const note = r.notMeasured.find((n) => n.includes("Text wrap isn't applied"));
      expect(note).toBeDefined();
    });

    it("позитивний близнюк: бодай один елемент зі справжнім обтіканням — рядка немає", () => {
      const items = [wrapItem("NONE"), wrapItem("BOUNDING_BOX_TEXT_WRAP")];
      const r = buildReport(measure(), [], opts({ emptyPopulations: emptyPopulationsFor(items) }));
      expect(r.notMeasured.find((n) => n.includes("Text wrap isn't applied"))).toBeUndefined();
    });
  });
});

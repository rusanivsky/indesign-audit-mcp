import { describe, expect, it } from "vitest";
import { flattenFrames, pairByBaseline, type PlacedParagraph } from "../../src/pagination/contents.js";
import type { ClaimFrame, PageRef } from "../../src/pagination/types.js";

function para(over: Partial<PlacedParagraph> = {}): PlacedParagraph {
  return {
    frameId: "f",
    page: "8",
    spreadIndex: 4,
    styleName: "Zmist Rozdil",
    index: 0,
    literals: [],
    markers: [],
    /* Непорожній за замовчуванням: порожні абзаци тепер свідомо не є
     * кандидатами на пару, тож зразок із "" перевіряв би не те. */
    text: "назва",
    baseline: 50,
    leading: 4.94,
    ...over,
  };
}

const PAGES: PageRef[] = [
  { name: "8", offset: 7, side: "LEFT_HAND", spreadIndex: 4, spreadSiblings: ["9"], master: null },
  { name: "9", offset: 8, side: "RIGHT_HAND", spreadIndex: 4, spreadSiblings: ["8"], master: null },
  { name: "10", offset: 9, side: "LEFT_HAND", spreadIndex: 5, spreadSiblings: [], master: null },
];

/**
 * Поля Фази 7, які зіставлення за базовою лінією не читає взагалі.
 *
 * `overlaps: null` — те, що віддає вимір: таблиця перекриттів будується ЛИШЕ
 * під родину `folio` (§4.2), тож для рамки змісту стан чесно «не рахували».
 */
const CONTENTS_FRAME_FIELDS = {
  bounds: { y1: 0, x1: 0, y2: 10, x2: 10 },
  layerName: "Layer 1",
  layerVisible: true,
  layerPrintable: true,
  fromMaster: false,
  locked: false,
  layerLocked: false,
  overlaps: null,
};

describe("flattenFrames", () => {
  it("додає розворот зі сторінки — базові лінії порівнянні лише в його межах", () => {
    const frame: ClaimFrame = {
      id: "f1",
      page: "9",
      styleName: "Zmist Cyfra",
      rotationAngle: 0,
      paragraphs: [{ index: 0, styleName: null, text: "48", literals: [48], markers: [], literalOffsets: [0], baseline: 50, leading: 4 }],
      ...CONTENTS_FRAME_FIELDS,
    };
    const flat = flattenFrames([frame], PAGES);
    expect(flat).toHaveLength(1);
    expect(flat[0]!.spreadIndex).toBe(4);
  });

  it("ПОВЕРНЕНУ рамку не сплющує — її базові лінії в іншій системі координат", () => {
    /* Інакше вона мовчки брала б участь у зіставленні з хибними числами.
     * Знахідку про неї будує detectContents, а не цей крок. */
    const rotated: ClaimFrame = {
      id: "f2",
      page: "9",
      styleName: "Zmist Cyfra",
      rotationAngle: -90,
      paragraphs: [{ index: 0, styleName: null, text: "9", literals: [9], markers: [], literalOffsets: [0], baseline: 50, leading: 4 }],
      ...CONTENTS_FRAME_FIELDS,
    };
    expect(flattenFrames([rotated], PAGES)).toEqual([]);
  });

  it("рамку на сторінці поза виміром не сплющує", () => {
    const orphan: ClaimFrame = {
      id: "f3",
      page: "999",
      styleName: "Zmist Cyfra",
      rotationAngle: 0,
      paragraphs: [{ index: 0, styleName: null, text: "1", literals: [1], markers: [], literalOffsets: [0], baseline: 50, leading: 4 }],
      ...CONTENTS_FRAME_FIELDS,
    };
    expect(flattenFrames([orphan], PAGES)).toEqual([]);
  });
});

describe("pairByBaseline", () => {
  it("НЕГАТИВНИЙ КОНТРОЛЬ: рівні базові лінії дають пару без знахідок", () => {
    const r = pairByBaseline([para({ text: "Rozdil" })], [para({ literals: [48], styleName: "Zmist Cyfra" })]);
    expect(r.pairs).toHaveLength(1);
    expect(r.findings).toEqual([]);
  });

  it("допуск — половина МЕНШОГО інтерліньяжу пари, і він з документа", () => {
    /* leading 4.94 → допуск 2.47. Константи «2 мм» тут бути не може: вона
     * була б властивістю однієї верстки (спек §3). */
    expect(pairByBaseline([para({ baseline: 50 })], [para({ baseline: 52.4, literals: [48] })]).pairs).toHaveLength(1);
    expect(pairByBaseline([para({ baseline: 50 })], [para({ baseline: 52.6, literals: [48] })]).pairs).toHaveLength(0);
  });

  it("менший інтерліньяж пари й задає допуск, а не більший", () => {
    /* min(4.94, 2.0)/2 = 1.0 — різниця 1.5 в допуск НЕ входить. */
    const r = pairByBaseline(
      [para({ baseline: 50, leading: 2.0 })],
      [para({ baseline: 51.5, literals: [48] })],
    );
    expect(r.pairs).toEqual([]);
  });

  it("дві назви в допуску одного числа — ambiguous, а не здогад", () => {
    const r = pairByBaseline(
      [para({ baseline: 50, index: 0 }), para({ baseline: 51, index: 1 })],
      [para({ baseline: 50.2, literals: [48] })],
    );
    expect(r.pairs).toEqual([]);
    expect(r.findings.map((f) => f.defect)).toEqual(["contents-ambiguous"]);
  });

  it("число на сторінці без жодного рядка змісту — це знахідка, не тиша", () => {
    /* Дефект зветься cross-spread історично: спершу умовою був розворот.
     * Після виміру 2026-08-07 умова звузилась до СТОРІНКИ (базова лінія
     * спільна для розвороту, тож сусідня сторінка давала хибні пари), а
     * сенс лишився той самий: число нема з чим зіставляти. */
    const r = pairByBaseline(
      [para({ page: "8", spreadIndex: 4 })],
      [para({ page: "9", spreadIndex: 4, literals: [48] })],
    );
    expect(r.pairs).toEqual([]);
    expect(r.findings.map((f) => f.defect)).toEqual(["contents-cross-spread"]);
  });

  it("Auto-інтерліньяж робить допуск необчислюваним — unpaired, а не допуск 0", () => {
    const r = pairByBaseline([para({ leading: null })], [para({ literals: [48] })]);
    expect(r.pairs).toEqual([]);
    expect(r.findings.map((f) => f.defect)).toEqual(["contents-unpaired"]);
  });

  it("назва без числа поруч знахідки не дає — числа є не в кожного рядка", () => {
    /* Зонд H6: у змісті 60 рядків назв і лише 35 посилань. Вимагати число
     * від кожного рядка означало б 25 хибних знахідок. */
    const r = pairByBaseline([para({ baseline: 50 }), para({ baseline: 90 })], [para({ baseline: 50, literals: [48] })]);
    expect(r.pairs).toHaveLength(1);
    expect(r.findings).toEqual([]);
  });

  it("одна назва не дістається двом числам", () => {
    const r = pairByBaseline(
      [para({ baseline: 50 })],
      [para({ baseline: 50, literals: [48], index: 0 }), para({ baseline: 50, literals: [49], index: 1 })],
    );
    expect(r.pairs).toHaveLength(1);
    expect(r.findings.map((f) => f.defect)).toEqual(["contents-unpaired"]);
  });
});

describe("flattenFrames: рівень — властивість АБЗАЦУ", () => {
  it("одна рамка з трьома рівнями дає три різні стилі, а не стиль рамки", () => {
    /* Знайдено прогоном на робочій книжці 2026-08-07: одна рамка змісту
     * містить усі три рівні. Поки стиль брався з рамки, всі 80 її абзаців
     * рахувались як рівень першого, і «Зміст Розділ» отримав 13 рядків
     * замість 4. На фікстурі не спливало: там кожна назва була окремою
     * рамкою. */
    const mixed: ClaimFrame = {
      id: "f9",
      page: "9",
      styleName: "Zmist Rozdil",
      rotationAngle: 0,
      paragraphs: [
        { index: 0, styleName: "Zmist Rozdil", text: "a", literals: [], markers: [], literalOffsets: [], baseline: 10, leading: 4 },
        { index: 1, styleName: "Zmist Pidrozdil", text: "b", literals: [], markers: [], literalOffsets: [], baseline: 20, leading: 4 },
        { index: 2, styleName: "Zmist Punkty", text: "c", literals: [], markers: [], literalOffsets: [], baseline: 30, leading: 4 },
      ],
      ...CONTENTS_FRAME_FIELDS,
    };
    expect(flattenFrames([mixed], PAGES).map((p) => p.styleName)).toEqual([
      "Zmist Rozdil",
      "Zmist Pidrozdil",
      "Zmist Punkty",
    ]);
  });

  it("абзац без власного стилю падає назад на стиль рамки", () => {
    const frame: ClaimFrame = {
      id: "f10", page: "9", styleName: "Zmist Cyfra", rotationAngle: 0,
      paragraphs: [{ index: 0, styleName: null, text: "48", literals: [48], markers: [], literalOffsets: [0], baseline: 50, leading: 4 }],
      ...CONTENTS_FRAME_FIELDS,
    };
    expect(flattenFrames([frame], PAGES)[0]!.styleName).toBe("Zmist Cyfra");
  });
});

describe("порожні абзаци не є кандидатами на пару", () => {
  it("порожній рядок поруч не робить пару неоднозначною", () => {
    /* У змісті реальної книжки між блоками стоять порожні абзаци-відбивки
     * того самого стилю. Базову лінію вони мають, тож потрапляли в допуск і
     * давали ambiguous там, де двозначності немає: порожній рядок не може
     * бути рядком змісту. Виміряно: саме вони давали 14 із 14. */
    const r = pairByBaseline(
      [para({ baseline: 50, text: "Справжня назва" }), para({ baseline: 50.5, text: "  " })],
      [para({ baseline: 50, literals: [48] })],
    );
    expect(r.pairs).toHaveLength(1);
    expect(r.pairs[0]!.title.text).toBe("Справжня назва");
    expect(r.findings).toEqual([]);
  });

  it("дві НЕпорожні назви в допуску так само дають ambiguous", () => {
    /* Захист від протилежної помилки: фільтр не сміє прибрати справжню
     * двозначність. */
    const r = pairByBaseline(
      [para({ baseline: 50, text: "Перша" }), para({ baseline: 50.5, text: "Друга" })],
      [para({ baseline: 50, literals: [48] })],
    );
    expect(r.findings.map((f) => f.defect)).toEqual(["contents-ambiguous"]);
  });
});

describe("кандидати — з тієї самої СТОРІНКИ, не розвороту", () => {
  it("рядок із сусідньої сторінки розвороту пари не робить", () => {
    /* Базова лінія спільна для всього розвороту: рядок на лівій сторінці і
     * рядок на правій, що стоять на однаковій висоті, мають ОДНАКОВУ базову
     * лінію. Виміряно: саме це давало 11 із 11 решти ambiguous. */
    const r = pairByBaseline(
      [
        para({ page: "8", baseline: 46.2, text: "Своя назва" }),
        para({ page: "9", baseline: 46.2, text: "Чужа сторінка" }),
      ],
      [para({ page: "8", baseline: 46.2, literals: [48] })],
    );
    expect(r.pairs).toHaveLength(1);
    expect(r.pairs[0]!.title.text).toBe("Своя назва");
    expect(r.findings).toEqual([]);
  });
});

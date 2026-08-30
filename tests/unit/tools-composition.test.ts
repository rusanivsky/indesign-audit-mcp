import { describe, expect, it } from "vitest";
import {
  buildReport,
  mergeResults,
  pageWindows,
  parseMeasureResult,
  ratioForShare,
  styleKeyConflicts,
  type AuditParams,
} from "../../src/tools/composition.js";
import type { LineMeasure, MeasureResult } from "../../src/composition/types.js";
import { line } from "./helpers/composition.js";

const empty = (over: Partial<MeasureResult> = {}): MeasureResult => ({
  docName: "Книга.indd",
  pages: [],
  lines: [],
  unmeasured: [],
  measurementUnit: "points",
  ...over,
});

/** Параметри аудиту за замовчуванням — рівно ті, що ставить сам інструмент. */
const params = (over: Partial<AuditParams> = {}): AuditParams => ({
  spacingMode: "survey",
  warnBandPct: 0,
  shortLastLineFraction: 0.15,
  minWordChars: 4,
  maxLadder: 2,
  riverMinRows: 4,
  riverTolerancePt: 0,
  riverMinChannelPt: 0,
  riverJustifiedOnly: false,
  includeMasters: false,
  perDefectLimit: 5,
  requestedPages: null,
  windows: 1,
  windowsDone: 1,
  stoppedAt: null,
  stoppedReason: null,
  ...over,
});

/** Рядок із заданою адресою — щоб було видно, чи злиття відновило порядок. */
function at(containerId: string, paragraphIndex: number, lineInParagraph: number): LineMeasure {
  return line({
    spaceWidth: 2.6,
    isLast: false,
    containerId,
    paragraphIndex,
    lineInParagraph,
    paragraphLineCount: 4,
  });
}

describe("pageWindows", () => {
  it("ріже перелік сторінок на вікна заданого розміру", () => {
    expect(pageWindows(["1", "2", "3", "4", "5"], 2)).toEqual([["1", "2"], ["3", "4"], ["5"]]);
  });

  it("порожній перелік дає порожній результат, а не вікно з нічого", () => {
    expect(pageWindows([], 20)).toEqual([]);
  });

  it("розмір, менший за одиницю, не дає нескінченного циклу", () => {
    expect(() => pageWindows(["1", "2"], 0)).toThrow(/window size/i);
  });
});

describe("mergeResults", () => {
  it("зливає рядки й сторінки з кількох вікон", () => {
    const merged = mergeResults([
      empty({ pages: ["1"], unmeasured: [{ containerId: "story:0", reason: "overset" }] }),
      empty({ pages: ["2"], unmeasured: [{ containerId: "story:0", reason: "overset" }] }),
    ]);
    expect(merged.pages).toEqual(["1", "2"]);
  });

  it("не дублює той самий overset-контейнер із різних вікон", () => {
    const merged = mergeResults([
      empty({ unmeasured: [{ containerId: "story:0", reason: "overset" }] }),
      empty({ unmeasured: [{ containerId: "story:0", reason: "overset" }] }),
    ]);
    expect(merged.unmeasured).toHaveLength(1);
  });

  it("порожній вхід не валиться", () => {
    expect(mergeResults([]).lines).toEqual([]);
  });

  /*
   * Головне, чого брифінг не бачив: пласке склеювання вікон РОЗРИВАЄ сусідство
   * рядків, на якому тримаються драбина переносів і коридор. Story, що лежить
   * на сторінках обох вікон, приходить двома шматками, а між ними стоять рядки
   * інших story з першого вікна.
   */
  it("відновлює порядок документа, а не порядок вікон", () => {
    const merged = mergeResults([
      empty({ lines: [at("story:2", 0, 0), at("story:4", 7, 0), at("story:4", 7, 1)] }),
      empty({ lines: [at("story:2", 0, 1), at("story:4", 7, 2)] }),
    ]);
    expect(
      merged.lines.map((l) => `${l.containerId}#${l.paragraphIndex}.${l.lineInParagraph}`),
    ).toEqual(["story:2#0.0", "story:2#0.1", "story:4#7.0", "story:4#7.1", "story:4#7.2"]);
  });

  /*
   * M4 із мутаційного прогону: попередній тест не розрізняв відновлення порядку
   * від порядку вставляння, бо вікна там ішли за зростанням. Явний перелік
   * сторінок може прийти в будь-якому порядку (["23","22"]), і тоді пізніший
   * абзац контейнера потрапляє в масив ПЕРШИМ.
   */
  it("відновлює порядок навіть тоді, коли вікна прийшли навспак", () => {
    const merged = mergeResults([
      empty({ pages: ["23"], lines: [at("story:0", 5, 0)] }),
      empty({ pages: ["22"], lines: [at("story:0", 2, 0)] }),
    ]);
    expect(merged.lines.map((l) => l.paragraphIndex)).toEqual([2, 5]);
  });

  /*
   * Рецензія: обидва попередні тести мали порядок вставляння, що вже збігався з
   * документним ДЛЯ РЯДКІВ ОДНОГО АБЗАЦУ, тож стабільне сортування проходило й
   * без розв'язки за `lineInParagraph`. А це і є той шов, заради якого злиття
   * існує: драбина переносів і коридор тримаються саме за сусідство рядків
   * одного абзацу.
   */
  it("відновлює порядок РЯДКІВ ОДНОГО АБЗАЦУ, розірваного швом вікна", () => {
    const merged = mergeResults([
      empty({ pages: ["23"], lines: [at("story:0", 4, 1)] }),
      empty({ pages: ["22"], lines: [at("story:0", 4, 0)] }),
    ]);
    expect(merged.lines.map((l) => l.lineInParagraph)).toEqual([0, 1]);
  });

  it("не дублює ту саму сторінку з двох вікон", () => {
    const merged = mergeResults([empty({ pages: ["7", "8"] }), empty({ pages: ["8", "9"] })]);
    expect(merged.pages).toEqual(["7", "8", "9"]);
  });

  it("не дублює той самий рядок, якщо вікна перекрились", () => {
    const merged = mergeResults([
      empty({ lines: [at("story:0", 1, 0)] }),
      empty({ lines: [at("story:0", 1, 0)] }),
    ]);
    expect(merged.lines).toHaveLength(1);
  });

  it("не зшиває вікна з різних документів мовчки", () => {
    expect(() =>
      mergeResults([empty({ docName: "А.indd" }), empty({ docName: "Б.indd" })]),
    ).toThrow(/document/i);
  });
});

describe("parseMeasureResult", () => {
  const raw = (over: Record<string, unknown> = {}): unknown => ({
    docName: "Книга.indd",
    pages: ["1"],
    lines: [],
    unmeasured: [],
    measurementUnit: "points",
    ...over,
  });

  it("пропускає коректний результат", () => {
    const r = parseMeasureResult(raw({ lines: [line({ spaceWidth: 2.6, isLast: false })] }));
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]!.chars.length).toBeGreaterThan(0);
  });

  it("не приймає відсутнє поле замість числа", () => {
    const l = { ...line({ spaceWidth: 2.6, isLast: false }) } as Record<string, unknown>;
    delete l.columnWidth;
    expect(() => parseMeasureResult(raw({ lines: [l] }))).toThrow(/columnWidth/);
  });

  it("не приймає NaN там, де контракт обіцяє число", () => {
    const l = { ...line({ spaceWidth: 2.6, isLast: false }), left: NaN };
    expect(() => parseMeasureResult(raw({ lines: [l] }))).toThrow(/left/);
  });

  it("не приймає рядок замість масиву рядків", () => {
    expect(() => parseMeasureResult(raw({ lines: "нема" }))).toThrow(/lines/);
  });

  it("не приймає чужу причину в unmeasured", () => {
    expect(() =>
      parseMeasureResult(raw({ unmeasured: [{ containerId: "story:0", reason: "хтозна" }] })),
    ).toThrow(/reason/);
  });

  it("не приймає null замість усього результату", () => {
    expect(() => parseMeasureResult(null)).toThrow();
  });

  /*
   * Рецензія: нуллабельна гілка приймала `undefined` як `null`. Відсутній
   * pointSize зробив би styleKey «@mixed» по всьому документу, жоден стиль не
   * відкалібрувався б — і звіт назвав би це «стилі без виміру» замість
   * «обробник і тип розійшлися».
   */
  it("не приймає ВІДСУТНЄ нуллабельне поле як null", () => {
    const l = { ...line({ spaceWidth: 2.6, isLast: false }) } as Record<string, unknown>;
    delete l.pointSize;
    expect(() => parseMeasureResult(raw({ lines: [l] }))).toThrow(/pointSize/);
  });

  it("не приймає ВІДСУТНЮ межу виключки як мішане значення", () => {
    const l = { ...line({ spaceWidth: 2.6, isLast: false }) } as Record<string, unknown>;
    l.spacing = { min: 80, max: 133 }; /* desired відсутній */
    expect(() => parseMeasureResult(raw({ lines: [l] }))).toThrow(/spacing\.desired/);
  });

  it("тримає нуллабельність кегля й меж виключки", () => {
    const l = { ...line({ spaceWidth: 2.6, isLast: false, size: null }) };
    l.spacing = { min: null, desired: null, max: null };
    const r = parseMeasureResult(raw({ lines: [l] }));
    expect(r.lines[0]!.pointSize).toBeNull();
    expect(r.lines[0]!.spacing.max).toBeNull();
  });
});

describe("ratioForShare", () => {
  const sorted = Array.from({ length: 100 }, (_, i) => (i + 1) / 100);

  /*
   * ОБИДВІ ПОЛОВИНИ ПОЗНАЧАЮТЬ ОДНАКОВО — і доти не позначали.
   *
   * `boundSide` порівнює включно (`ratio >= max`, `ratio <= min`), а
   * `percentile` віддає значення З ВИБІРКИ. Тож верхній поріг, узятий як
   * `percentile(1 − share)`, позначав `share·n + 1` рядків, а нижній — рівно
   * `share·n`. Пара `thresholdsForShare` подається читачеві як пара, тож
   * несиметричність читалася як властивість набору, а не як похибка. Найгірше
   * на найменшій частці: 1 % давав 2 рядки зі 100, тобто вдвічі більше саме
   * там, де людина найімовірніше й вибирає.
   */
  it("поріг позначає РІВНО задану частку — з обох боків", () => {
    const r = ratioForShare(sorted, 0.05);
    expect(sorted.filter((v) => v >= r.loose)).toHaveLength(5);
    expect(sorted.filter((v) => v <= r.tight)).toHaveLength(5);
  });

  it("те саме на найменшій частці, де вада була вдвічі", () => {
    const r = ratioForShare(sorted, 0.01);
    expect(sorted.filter((v) => v >= r.loose)).toHaveLength(1);
    expect(sorted.filter((v) => v <= r.tight)).toHaveLength(1);
  });

  it("пороги лишаються значеннями З ВИБІРКИ, а не інтерполяцією", () => {
    const r = ratioForShare(sorted, 0.05);
    expect(sorted).toContain(r.loose);
    expect(sorted).toContain(r.tight);
  });

  it("на порожній вибірці віддає NaN, а не нуль", () => {
    const r = ratioForShare([], 0.05);
    expect(Number.isNaN(r.loose)).toBe(true);
    expect(Number.isNaN(r.tight)).toBe(true);
  });
});

describe("styleKeyConflicts", () => {
  it("бачить два різні desired під одним ключем калібрування", () => {
    const conflicts = styleKeyConflicts([
      line({ spaceWidth: 2.6, isLast: false, spacing: { min: 80, desired: 100, max: 133 } }),
      line({ spaceWidth: 2.6, isLast: false, spacing: { min: 80, desired: 90, max: 133 } }),
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.desired).toEqual([90, 100]);
  });

  it("однакові desired конфліктом не є", () => {
    expect(
      styleKeyConflicts([
        line({ spaceWidth: 2.6, isLast: false }),
        line({ spaceWidth: 2.9, isLast: false }),
      ]),
    ).toEqual([]);
  });

  it("непридатні до виміру рядки не породжують конфлікту", () => {
    expect(
      styleKeyConflicts([
        line({ spaceWidth: 2.6, isLast: false }),
        line({ spaceWidth: 2.6, isLast: false, rotated: true, spacing: { min: 80, desired: 90, max: 133 } }),
      ]),
    ).toEqual([]);
  });
});

describe("buildReport", () => {
  /** Невеликий, але живий корпус: виключений абзац із чотирьох рядків. */
  function corpus(over: Partial<Parameters<typeof line>[0]> = {}): LineMeasure[] {
    return [0, 1, 2].map((i) =>
      line({
        spaceWidth: 2.6 + i * 2,
        isLast: false,
        lineInParagraph: i,
        paragraphLineCount: 4,
        ...over,
      }),
    ).concat(
      /* Чотири слова = три проміжки: калібруванню треба щонайменше 3 зразки
       * (`calibrate(..., minSamples = 3)`), інакше стиль лишиться
       * невідкаліброваним і жодного відношення не буде взагалі. */
      line({ spaceWidth: 2.6, isLast: true, lineInParagraph: 3, paragraphLineCount: 4, words: 4, ...over }),
    );
  }

  it("у режимі survey знахідок щільності немає — і про це сказано прямо", () => {
    const r = buildReport(empty({ lines: corpus() }), params());
    expect(r.spacing.mode).toBe("survey");
    expect(r.spacing.selection).toMatch(/SURVEY ONLY|not run/i);
    const scales = r.findingsByScale.map((g) => g.scale);
    expect(scales).not.toContain("air-fraction");
  });

  it("базова частка ділиться на known, а не на measured", () => {
    const lines = [
      /* Обидві межі виміряні. */
      line({ spaceWidth: 2.6, isLast: false }),
      /* Виміряна лише верхня — у знаменник базової частки не йде. */
      line({ spaceWidth: 40, isLast: false, spacing: { min: null, desired: 100, max: 133 } }),
      line({ spaceWidth: 2.6, isLast: true, lineInParagraph: 1, paragraphLineCount: 2, words: 4 }),
    ];
    const r = buildReport(empty({ lines }), params());
    expect(r.spacing.baseRate.known).toBe(1);
    expect(r.spacing.baseRate.partial).toBe(1);
    expect(r.spacing.baseRate.outsidePartial).toBe(1);
    expect(r.spacing.baseRate.outsideKnown).toBe(0);
  });

  /*
   * Рецензія: попередній тест фіксував лічильники, але не саму частку, а його
   * фікстура мала outsideKnown = 0, тож будь-який знаменник давав 0. Це те
   * число, навколо якого побудовано весь звіт, тож воно перевіряється прямо:
   * три рядки з обома межами (один за межею) і один — лише з однією межею.
   * Правильна частка — 1/3, а не 1/4.
   */
  it("частка рахується як outsideKnown / known, а не по всій виміряній популяції", () => {
    const lines = [
      line({ spaceWidth: 40, isLast: false, paragraphIndex: 0 }),
      line({ spaceWidth: 2.6, isLast: false, paragraphIndex: 1 }),
      line({ spaceWidth: 2.6, isLast: false, paragraphIndex: 2 }),
      line({
        spaceWidth: 40,
        isLast: false,
        paragraphIndex: 3,
        spacing: { min: null, desired: 100, max: 133 },
      }),
      line({ spaceWidth: 2.6, isLast: true, lineInParagraph: 1, paragraphLineCount: 2, paragraphIndex: 4, words: 4 }),
    ];
    const r = buildReport(empty({ lines }), params());
    expect(r.spacing.baseRate.known).toBe(3);
    expect(r.spacing.baseRate.outsideKnown).toBe(1);
    expect(r.spacing.baseRate.partial).toBe(1);
    /* 1/3 = 33,33%. Знаменник known+partial дав би 25%, measured — теж 25%. */
    expect(r.spacing.baseRate.pct).toBeCloseTo(33.33, 1);
  });

  it("scope повідомляє, скільки рядків прийшло з виміру, а не лише скільки лишилось", () => {
    const master = { ...line({ spaceWidth: 2.6, isLast: false }), isMaster: true };
    const r = buildReport(empty({ lines: [...corpus(), master] }), params());
    expect(r.scope.linesReturned).toBe(5);
    expect(r.scope.linesAnalysed).toBe(4);
  });

  it("рядки майстер-сторінок за замовчуванням поза аналізом, але полічені", () => {
    const master = { ...line({ spaceWidth: 2.6, isLast: false }), isMaster: true };
    const r = buildReport(empty({ lines: [...corpus(), master] }), params());
    expect(r.notMeasured.masterPages.lines).toBe(1);
    expect(r.notMeasured.masterPages.included).toBe(false);
    expect(r.scope.linesAnalysed).toBe(4);
  });

  it("includeMasters повертає їх в аналіз — рішення оборотне викликом", () => {
    const master = { ...line({ spaceWidth: 2.6, isLast: false }), isMaster: true };
    const r = buildReport(empty({ lines: [master] }), params({ includeMasters: true }));
    expect(r.notMeasured.masterPages.included).toBe(true);
    expect(r.scope.linesAnalysed).toBe(1);
  });

  it("рядок із розсинхроном text і chars викидається й лічиться окремо", () => {
    const broken = { ...line({ spaceWidth: 2.6, isLast: false }) };
    broken.text = `${broken.text}зайве`;
    const r = buildReport(empty({ lines: [...corpus(), broken] }), params());
    expect(r.notMeasured.textCharsMismatch).toBe(1);
    expect(r.scope.linesAnalysed).toBe(4);
  });

  it("повернуті рядки лічаться окремо й супроводжуються попередженням про звуження", () => {
    const head = line({ spaceWidth: 2.6, isLast: false, rotated: true });
    const r = buildReport(empty({ lines: [...corpus(), head] }), params());
    expect(r.notMeasured.rotated.lines).toBe(1);
    expect(r.notMeasured.rotated.note).toMatch(/Narrowing by pages/i);
  });

  /*
   * M20: повернутий рядок БЕЗ гліфів підпадає під обидва правила придатності
   * одразу. Лічити його двічі означало б рапортувати 111 + 484 більше, ніж є
   * рядків, — саме та вада, від якої захищає роздільність цих двох класів.
   */
  it("повернутий і водночас порожній рядок не лічиться двічі", () => {
    const both = line({ spaceWidth: 2.6, isLast: false, rotated: true, empty: true });
    const r = buildReport(empty({ lines: [...corpus(), both] }), params());
    expect(r.notMeasured.rotated.lines).toBe(1);
    expect(r.notMeasured.emptyParagraphs.lines).toBe(0);
  });

  it("знахідки згруповані за шкалою, а пласкої «двадцятки» немає взагалі", () => {
    const r = buildReport(empty({ lines: corpus() }), params({ spacingMode: "rank" }));
    expect(Array.isArray(r.findingsByScale)).toBe(true);
    expect(r).not.toHaveProperty("worst");
    expect(r.findingsByScale.every((g) => typeof g.total === "number")).toBe(true);
    expect(r.scaleOrderNote).toMatch(/alphabetical/i);
  });

  it("у шкалі air-fraction щільні й розріджені ріжуться окремо, а не тонуть разом", () => {
    const lines = [
      line({ spaceWidth: 40, isLast: false, paragraphIndex: 0 }),
      line({ spaceWidth: 40, isLast: false, paragraphIndex: 1 }),
      line({ spaceWidth: 0.3, isLast: false, paragraphIndex: 2 }),
      line({ spaceWidth: 2.6, isLast: true, lineInParagraph: 1, paragraphLineCount: 2, paragraphIndex: 3, words: 4 }),
    ];
    const r = buildReport(empty({ lines }), params({ spacingMode: "rank", perDefectLimit: 1 }));
    const air = r.findingsByScale.find((g) => g.scale === "air-fraction");
    expect(air?.defects.map((d) => d.defect).sort()).toEqual(["loose", "tight"]);
    /* Ліміт застосовано ПОКЛАСОВО: щільний рядок видно попри двох розріджених. */
    expect(air?.defects.find((d) => d.defect === "tight")?.worst).toHaveLength(1);
  });

  /*
   * Помилку кидає і сам detectSpacing, тож перевіряти сам факт винятку мало:
   * власна перевірка звіту цінна саме тим, що НАЗИВАЄ, де взяти число, і
   * спрацьовує до калібрування всього корпусу.
   */
  /*
   * Рецензія: звіт стверджує, що читає `severity` (це умова, за якої detect.ts
   * дозволяє полю жити), але жоден тест не прив'язував лічильники до дійсності.
   * У режимі "rank" відбору немає, тож вага — ЄДИНИЙ сигнал «за оголошеною
   * межею»: рядок поза 80/133 має дати error, рядок усередині — info.
   */
  it("лічильники ваги в режимі rank відрізняють «за межею» від «у межах»", () => {
    const lines = [
      /* 40 / 2.6 = 15.4 — далеко за верхньою межею 133%. */
      line({ spaceWidth: 40, isLast: false, paragraphIndex: 0 }),
      /* 3.0 / 2.6 = 1.15 — усередині 80–133%. */
      line({ spaceWidth: 3, isLast: false, paragraphIndex: 1 }),
      line({ spaceWidth: 2.6, isLast: true, lineInParagraph: 1, paragraphLineCount: 2, paragraphIndex: 2, words: 4 }),
    ];
    const r = buildReport(empty({ lines }), params({ spacingMode: "rank" }));
    const loose = r.findingsByScale
      .find((g) => g.scale === "air-fraction")!
      .defects.find((d) => d.defect === "loose")!;
    expect(loose.total).toBe(2);
    expect(loose.severity.error).toBe(1);
    expect(loose.severity.info).toBe(1);
    expect(loose.severity.warning).toBe(0);
  });

  it("лічильники ваги розрізняють смугу попередження від порушення межі", () => {
    const lines = [
      /* 3.5 / 2.6 = 1.346 — за межею 133%: error. */
      line({ spaceWidth: 3.5, isLast: false, paragraphIndex: 0 }),
      /* 3.35 / 2.6 = 1.288 — у межах, але у смузі 10 в. п. під 133%: warning. */
      line({ spaceWidth: 3.35, isLast: false, paragraphIndex: 1 }),
      line({ spaceWidth: 2.6, isLast: true, lineInParagraph: 1, paragraphLineCount: 2, paragraphIndex: 2, words: 4 }),
    ];
    const r = buildReport(empty({ lines }), params({ spacingMode: "style-bounds", warnBandPct: 10 }));
    const loose = r.findingsByScale
      .find((g) => g.scale === "air-fraction")!
      .defects.find((d) => d.defect === "loose")!;
    expect(loose.severity.error).toBe(1);
    expect(loose.severity.warning).toBe(1);
  });

  it("режим ratio без жодної межі зупиняється й каже, звідки брати число", () => {
    expect(() =>
      buildReport(empty({ lines: corpus() }), params({ spacingMode: "ratio" })),
    ).toThrow(/thresholdsForShare/);
  });

  it("явно заданий діапазон сторінок породжує попередження про обрив прогонів", () => {
    const r = buildReport(empty({ lines: corpus() }), params({ requestedPages: ["12", "13"] }));
    expect(r.warnings.join(" ")).toMatch(/cut off|edges/i);
  });

  it("конфлікт desired під одним ключем потрапляє в попередження", () => {
    const lines = [
      line({ spaceWidth: 2.6, isLast: false, spacing: { min: 80, desired: 100, max: 133 } }),
      line({ spaceWidth: 2.6, isLast: false, spacing: { min: 80, desired: 90, max: 133 } }),
      line({ spaceWidth: 2.6, isLast: true, lineInParagraph: 1, paragraphLineCount: 2 }),
    ];
    const r = buildReport(empty({ lines }), params());
    expect(r.warnings.join(" ")).toMatch(/desiredWordSpacing/);
  });

  it("показує джерело ширини дефіса — це вимога measurable.ts, а не оздоба", () => {
    const r = buildReport(empty({ lines: corpus() }), params());
    expect(r.calibration.hyphen.source).toBe("fallback");
    expect(r.calibration.hyphen.samples).toBe(0);
  });

  it("невідкалібровані стилі не потрапляють у «чисто»", () => {
    /* Один-єдиний останній рядок — зразків на медіану не набереться. */
    const r = buildReport(
      empty({ lines: [line({ spaceWidth: 2.6, isLast: true, lineInParagraph: 1, paragraphLineCount: 2 })] }),
      params(),
    );
    expect(r.notMeasured.uncalibratedStyles.length).toBeGreaterThan(0);
  });

  it("порожній вимір не вдає, ніби документ чистий", () => {
    const r = buildReport(empty(), params());
    expect(r.scope.linesAnalysed).toBe(0);
    expect(r.readThisFirst.join(" ")).toMatch(/Not a single line/i);
  });

  it("перерваний прогін лишається тим самим звітом, а не іншою формою", () => {
    const r = buildReport(
      empty({ lines: corpus(), pages: ["1"] }),
      params({ windows: 5, windowsDone: 2, stoppedAt: "21", stoppedReason: "InDesign не відповів" }),
    );
    expect(r.scope.partial).toBe(true);
    expect(r.scope.stoppedAt).toBe("21");
    expect(r.findingsByScale).toBeDefined();
  });

  it("пороги під бажану частку — квантилі виміряного розподілу, а не порада", () => {
    const lines = [
      ...Array.from({ length: 20 }, (_, i) =>
        line({ spaceWidth: 2.6 + i * 0.5, isLast: false, paragraphIndex: i }),
      ),
      line({ spaceWidth: 2.6, isLast: true, lineInParagraph: 1, paragraphLineCount: 2, paragraphIndex: 99, words: 4 }),
    ];
    const r = buildReport(empty({ lines }), params());
    const five = r.spacing.thresholdsForShare.find((t) => t.share === 0.05);
    expect(five).toBeDefined();
    expect(five!.maxRatio).toBeGreaterThan(1);
  });

  /*
   * W1. Пропозиції рахуються по ВСІХ знахідках, а показуються при тих, що
   * пройшли покласовий ліміт. Обидва боки перевіряються тут, бо розійтися вони
   * можуть тихо: зведення лишиться правдоподібним, а при знахідках пропозицій
   * просто не стане.
   */
  it("кожна показана знахідка несе свою пропозицію", () => {
    const r = buildReport(empty({ lines: corpus() }), params({ spacingMode: "rank" }));
    const shown = r.findingsByScale.flatMap((g) => g.defects.flatMap((d) => d.worst));
    expect(shown.length).toBeGreaterThan(0);
    for (const f of shown) {
      expect(f.proposal, f.id).not.toBeNull();
      expect(f.proposal!.description.length).toBeGreaterThan(10);
    }
  });

  it("зведення пропозицій рахує ВСІ знахідки, а не лише показані", () => {
    const r = buildReport(empty({ lines: corpus() }), params({ spacingMode: "rank", perDefectLimit: 1 }));
    const shown = r.findingsByScale.flatMap((g) => g.defects.flatMap((d) => d.worst)).length;
    expect(r.proposals.total).toBe(r.findingsTotal);
    expect(r.proposals.total).toBeGreaterThan(shown);
  });

  it("вид «text» не видається жодного разу — текст автора не переписується", () => {
    const r = buildReport(empty({ lines: corpus() }), params({ spacingMode: "rank" }));
    expect(r.proposals.byKind.text).toBe(0);
    expect(r.proposals.note).toMatch(/text/);
  });

  it("розбіжність між видом і фактичним записом названа, а не замовчана", () => {
    /* Аудит не читає текст контейнерів, тож невидимі знаки лишаються без
     * адреси. Це мусить бути видно числом, а не лише прозою. */
    const r = buildReport(empty({ lines: corpus() }), params({ spacingMode: "rank" }));
    expect(r.proposals.writable).toBeLessThanOrEqual(r.proposals.total);
    expect(r.proposals.note).toMatch(/composition_apply/);
  });
});

describe("buildReport, найслабша ланка калібрування", () => {
  it("називає стиль із найнижчою стійкістю, а не ховає його серед решти", () => {
    const lines: LineMeasure[] = [
      /* Стиль А: три однакові проміжки — стійкість 100%. */
      line({ spaceWidth: 2.6, isLast: true, lineInParagraph: 1, paragraphLineCount: 2, words: 4, style: "А" }),
      /* Стиль Б: проміжки різної ширини — медіана є, стійкість просідає. */
      line({
        spaceWidth: 2.6,
        isLast: true,
        lineInParagraph: 1,
        paragraphLineCount: 2,
        style: "Б",
        gapsAt: [10, 40, 80],
      }),
      line({
        spaceWidth: 9,
        isLast: true,
        lineInParagraph: 1,
        paragraphLineCount: 2,
        style: "Б",
        paragraphIndex: 1,
        gapsAt: [10, 40, 80],
      }),
    ];
    const r = buildReport(empty({ lines }), params());
    expect(r.calibration.leastStable?.styleKey).toBe("Б@10");
    expect(r.calibration.leastStable!.stabilityPct).toBeLessThan(100);
  });

  it("без жодного відкаліброваного стилю віддає null, а не вигадану пару", () => {
    expect(buildReport(empty(), params()).calibration.leastStable).toBeNull();
  });
});

describe("composition_audit — тире на початку рядка", () => {
  const EM = "—";

  const dashPair = () => [
    line({
      spaceWidth: 3.2,
      isLast: false,
      wordList: ["і", "Київ"],
      trailingSpace: 3.2,
      lineInParagraph: 0,
      paragraphLineCount: 2,
    }),
    line({
      spaceWidth: 3.2,
      isLast: true,
      wordList: [EM, "столиця"],
      lineInParagraph: 1,
      paragraphLineCount: 2,
    }),
  ];

  it("знахідка потрапляє у звіт під власною шкалою", () => {
    const r = buildReport(empty({ lines: dashPair() }), params());
    const group = r.findingsByScale.find((g) => g.scale === "unranked");
    expect(group, "шкали unranked немає у звіті").toBeDefined();
    expect(group!.defects.map((d) => d.defect)).toContain("line-start-dash");
    expect(group!.total).toBe(1);
  });

  it("працює і в режимі survey — вигаданого порога в цього детектора немає", () => {
    const survey = buildReport(empty({ lines: dashPair() }), params({ spacingMode: "survey" }));
    const rank = buildReport(empty({ lines: dashPair() }), params({ spacingMode: "rank" }));
    for (const r of [survey, rank]) {
      expect(r.findingsByScale.some((g) => g.scale === "unranked")).toBe(true);
    }
  });

  it("sentenceEnders доходить від параметрів аудиту до детектора", () => {
    const lines = [
      line({
        spaceWidth: 3.2,
        isLast: false,
        wordList: ["він", "мовчав."],
        trailingSpace: 3.2,
        lineInParagraph: 0,
        paragraphLineCount: 2,
      }),
      line({
        spaceWidth: 3.2,
        isLast: true,
        wordList: ["—", "Що"],
        lineInParagraph: 1,
        paragraphLineCount: 2,
      }),
    ];
    const withDefault = buildReport(empty({ lines }), params());
    const withNone = buildReport(empty({ lines }), params({ sentenceEnders: [] }));
    expect(withDefault.findingsByScale.some((g) => g.scale === "unranked")).toBe(false);
    expect(withNone.findingsByScale.some((g) => g.scale === "unranked")).toBe(true);
  });
});

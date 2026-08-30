import { describe, expect, it } from "vitest";
import { detectRivers, surveyRivers } from "../../src/composition/detect-rivers.js";
import { line } from "./helpers/composition.js";

/**
 * Один рядок смуги: проміжки в заданих x, адреса й базова лінія — за номером
 * рядка. `baseline` мусить зростати, інакше детектор вважає рядки несусідніми
 * (перехід у наступну колонку), — це і є та властивість, яку перевіряють тести
 * сусідства нижче.
 */
function row(gaps: number[], i: number, over: Partial<Parameters<typeof line>[0]> = {}) {
  return line({
    spaceWidth: 3.2,
    isLast: false,
    gapsAt: gaps,
    lineInParagraph: i,
    paragraphLineCount: 8,
    baseline: 100 + i * 12,
    ...over,
  });
}

/** Смуга сусідніх рядків; `over` накладається на КОЖЕН рядок. */
function column(gapRows: number[][], over: Partial<Parameters<typeof line>[0]> = {}) {
  return gapRows.map((gaps, i) => row(gaps, i, over));
}

/** Поріг брифінгу — три рядки; замовчування детектора інше, див. окремий тест. */
const R3 = { minRows: 3 } as const;

describe("detectRivers — сам коридор", () => {
  it("три рядки з проміжками на одній вертикалі — коридор", () => {
    const f = detectRivers(column([[50], [51], [50.5]]), R3);
    expect(f).toHaveLength(1);
    expect(f[0]!.defect).toBe("river");
    expect(f[0]!.measured).toBe(3);
    expect(f[0]!.severity).toBe("error");
  });

  it("два рядки — ще не коридор", () => {
    expect(detectRivers(column([[50], [50]]), R3)).toEqual([]);
  });

  it("проміжки врозтіч не дають коридору", () => {
    expect(detectRivers(column([[20], [60], [100]]), R3)).toEqual([]);
  });

  it("перекриття, а не близькість лівих країв: вузькі проміжки на тій самій відстані не сходяться", () => {
    /* Ліві краї за 3 пт один від одного. При ширині 3,2 пт відрізки
     * перекриваються, при ширині 1,0 пт — ні. Це рівно те, чого не бачить
     * порівняння самих лише лівих координат. */
    expect(detectRivers(column([[50], [53], [50]]), R3)).toHaveLength(1);
    const narrow = [
      row([50], 0, { spaceWidth: 1 }),
      row([53], 1, { spaceWidth: 1 }),
      row([50], 2, { spaceWidth: 1 }),
    ];
    expect(detectRivers(narrow, R3)).toEqual([]);
  });

  it("канал тримається БІЖУЧИМ перетином — коридор не стікає вбік", () => {
    /* Попарно кожна сусідня пара перекривається (крок 3 пт при ширині 3,2 пт),
     * але наскрізної вертикалі немає: [50;53,2] ∩ [59;62,2] порожній. */
    expect(detectRivers(column([[50], [53], [56], [59]]), R3)).toEqual([]);
  });

  it("проміжки, що лише ДОТИКАЮТЬСЯ, каналу не дають", () => {
    /* [50;54) і [54;58) мають спільну точку й нуль білого між собою: смуга
     * нульової ширини — це не діра, а межа. Ширини точні у двійковому. */
    const rows = [
      row([50], 0, { spaceWidth: 4 }),
      row([54], 1, { spaceWidth: 4 }),
      row([50], 2, { spaceWidth: 4 }),
    ];
    expect(detectRivers(rows, R3)).toEqual([]);
  });

  it("пробіл без ДРУКОВАНОГО правого сусіда проміжком не є", () => {
    /* Керівний символ (якір таблиці U+0016) має синтетичну ширину, тобто
     * координати за ним ростуть — і без правила «друкований сусід» такий пробіл
     * виглядав би нормальним проміжком, а фільтр `width > 0` його не спіймав би. */
    const rows = [0, 1, 2].map((i) =>
      line({
        spaceWidth: 3.2,
        isLast: false,
        wordList: ["аб", "\u0016аб"],
        controlWidth: 3.2,
        lineInParagraph: i,
        paragraphLineCount: 8,
        baseline: 100 + i * 12,
      }),
    );
    expect(detectRivers(rows, R3)).toEqual([]);
  });

  it("допуск перекривається параметром", () => {
    const rows = column([[50], [56], [62]]);
    expect(detectRivers(rows, R3)).toEqual([]);
    expect(detectRivers(rows, { ...R3, tolerancePt: 8 })).toHaveLength(1);
  });

  it("замовчування minRows — чотири рядки, не три", () => {
    expect(detectRivers(column([[50], [50], [50]]))).toEqual([]);
    expect(detectRivers(column([[50], [50], [50], [50]]))).toHaveLength(1);
  });

  it("minRows < 2 і дробовий — виняток", () => {
    expect(() => detectRivers([], { minRows: 1 })).toThrow(/minRows/);
    expect(() => detectRivers([], { minRows: 2.5 })).toThrow(/minRows/);
  });

  it("від'ємний допуск — виняток", () => {
    expect(() => detectRivers([], { tolerancePt: -1 })).toThrow(/tolerancePt/);
  });
});

describe("detectRivers — які рядки стоять один під одним", () => {
  it("рядки з різних контейнерів не утворюють коридор", () => {
    const rows = [
      row([50], 0, { containerId: "story:0" }),
      row([50], 1, { containerId: "story:1" }),
      row([50], 2, { containerId: "story:2" }),
    ];
    expect(detectRivers(rows, R3)).toEqual([]);
  });

  it("рядки з різних сторінок ОДНІЄЇ story не утворюють коридор", () => {
    /* Головна пастка: containerId — це story на весь документ, а колонки різних
     * сторінок стоять у тих самих x. */
    const rows = [row([50], 0, { page: "12" }), row([50], 1, { page: "13" }), row([50], 2, { page: "14" })];
    expect(detectRivers(rows, R3)).toEqual([]);
  });

  it("шов фрейму розриває смугу", () => {
    const rows = [row([50], 0, { isLastInFrame: true }), row([50], 1), row([50], 2)];
    expect(detectRivers(rows, R3)).toEqual([]);
  });

  it("спадання baseline (наступна колонка фрейму) розриває смугу", () => {
    const rows = [row([50], 0, { baseline: 300 }), row([50], 1, { baseline: 100 }), row([50], 2, { baseline: 112 })];
    expect(detectRivers(rows, R3)).toEqual([]);
  });

  it("однакова baseline теж не є сусідством", () => {
    const rows = [row([50], 0, { baseline: 100 }), row([50], 1, { baseline: 100 }), row([50], 2, { baseline: 100 })];
    expect(detectRivers(rows, R3)).toEqual([]);
  });

  it("дірка в нумерації рядків абзацу розриває смугу", () => {
    const rows = [row([50], 0), row([50], 1), row([50], 3)];
    expect(detectRivers(rows, R3)).toEqual([]);
  });

  it("наступний абзац продовжує смугу з нульового рядка", () => {
    const rows = [
      row([50], 0, { paragraphIndex: 0 }),
      row([50], 1, { paragraphIndex: 0 }),
      row([50], 0, { paragraphIndex: 1, baseline: 124 }),
    ];
    expect(detectRivers(rows, R3)).toHaveLength(1);
  });

  it("наступний абзац НЕ з нульового рядка смуги не продовжує", () => {
    const rows = [
      row([50], 0, { paragraphIndex: 0 }),
      row([50], 1, { paragraphIndex: 0 }),
      row([50], 2, { paragraphIndex: 1, baseline: 124 }),
    ];
    expect(detectRivers(rows, R3)).toEqual([]);
  });

  it("нульовий рядок ТОГО САМОГО абзацу смуги не продовжує", () => {
    /* Номер рядка пішов назад у межах одного абзацу — це не «наступний абзац»,
     * а розрив: правило вимагає СТРОГО більшого paragraphIndex. */
    const rows = [
      row([50], 3, { paragraphIndex: 0, baseline: 100 }),
      row([50], 0, { paragraphIndex: 0, baseline: 112 }),
      row([50], 1, { paragraphIndex: 0, baseline: 124 }),
    ];
    expect(detectRivers(rows, R3)).toEqual([]);
  });

  it("абзац без рядків пропущено шаром виміру — номер із діркою смугу не розриває", () => {
    const rows = [
      row([50], 0, { paragraphIndex: 4 }),
      row([50], 1, { paragraphIndex: 4 }),
      row([50], 0, { paragraphIndex: 9, baseline: 124 }),
    ];
    expect(detectRivers(rows, R3)).toHaveLength(1);
  });
});

describe("detectRivers — придатність до виміру", () => {
  it("повернуті рядки не дають коридору попри однакові координати", () => {
    /* Виміряно: у повернутій рамці ВСІ chars[].x — та сама константа, тобто без
     * фільтра колонтитули були б ідеальним коридором із нізвідки. */
    const rows = column([[50], [50], [50]], { rotated: true });
    expect(rows.every((r) => r.chars.every((c) => c.x === 0))).toBe(true);
    expect(detectRivers(rows, R3)).toEqual([]);
  });

  it("рамка під довільним кутом теж непридатна", () => {
    expect(detectRivers(column([[50], [50], [50]], { rotationAngle: 30 }), R3)).toEqual([]);
  });

  it("порожній абзац посередині розриває смугу", () => {
    const rows = [
      row([50], 0),
      row([50], 1),
      line({ spaceWidth: 3.2, isLast: false, empty: true, lineInParagraph: 2, baseline: 124 }),
      row([50], 3),
      row([50], 4),
    ];
    expect(detectRivers(rows, R3)).toEqual([]);
  });
});

describe("detectRivers — максимальність і паралельні коридори", () => {
  it("коридор із п'яти рядків дає ОДНУ знахідку, а не три", () => {
    const f = detectRivers(column([[50], [50], [50], [50], [50]]), R3);
    expect(f).toHaveLength(1);
    expect(f[0]!.measured).toBe(5);
    expect(f[0]!.lineInParagraph).toBe(0);
  });

  it("два паралельні коридори на тих самих рядках — дві знахідки з різними id", () => {
    const f = detectRivers(column([[50, 100], [50, 100], [50, 100]]), R3);
    expect(f).toHaveLength(2);
    expect(new Set(f.map((x) => x.id)).size).toBe(2);
    expect(f.every((x) => x.measured === 3)).toBe(true);
  });

  it("прогін тримається за НАЙШИРШУ гілку, а не за першу-ліпшу", () => {
    /* Канал [50;60) від широкого проміжку першого рядка. На другому рядку два
     * кандидати: [48;52) дає перетин 2 пт, [57;61) — 3 пт. Третій рядок
     * доступний лише з ширшої гілки. */
    const rows = [
      row([50], 0, { spaceWidth: 10 }),
      row([48, 57], 1, { spaceWidth: 4 }),
      row([58], 2, { spaceWidth: 4 }),
    ];
    expect(detectRivers(rows, R3)).toHaveLength(1);
  });

  it("на РІВНИХ перетинах виграє лівіша гілка — це фіксує channel.left, тобто id", () => {
    /* Канал [100;110) від широкого проміжку; на другому рядку два кандидати по
     * 4 пт перетину кожен. Тай-брейк мусить бути визначеним: від нього залежить
     * хвіст ключа, за який Задачі 13–14 триматимуть виправлення. */
    const rows = [
      row([100], 0, { spaceWidth: 10 }),
      row([100, 106], 1, { spaceWidth: 4 }),
      row([100, 106], 2, { spaceWidth: 4 }),
    ];
    const f = detectRivers(rows, R3);
    expect(f).toHaveLength(1);
    expect(f[0]!.id.endsWith(":100.00")).toBe(true);
  });

  it("проміжок ІЗ СЕРЕДИНИ виданого прогону може почати власний коридор", () => {
    /* Фікстура рецензії. `used` позначає ПРОМІЖКИ, а не рядки, тож у рядків
     * усередині першого прогону лишаються вільними їхні інші проміжки. */
    const rows = [
      row([100], 0, { spaceWidth: 10 }),
      row([100], 1, { spaceWidth: 10 }),
      row([100, 106], 2, { spaceWidth: 4 }),
      row([100, 106], 3, { spaceWidth: 4 }),
      row([106], 4, { spaceWidth: 4 }),
      row([106], 5, { spaceWidth: 4 }),
    ];
    const f = detectRivers(rows, { minRows: 4 });
    expect(f).toHaveLength(2);
    const byLine = new Map(f.map((x) => [x.lineInParagraph, x.measured]));
    expect(byLine.get(0)).toBe(4);
    /* Другий коридор стартує з рядка 1 — СЕРЕДИНИ першого, а не з його кінця. */
    expect(byLine.get(1)).toBe(5);
    /* І він заниження: справжня смуга [106;110) є вже в рядку 0 (його проміжок
     * [100;110) її містить), тобто насправді 6 рядків від рядка 0. Тай-брейк
     * забрав проміжок рядка 0 у ліву гілку. Максимальності НЕМАЄ, і це
     * зафіксовано тут, а не обіцяно навпаки. */
    expect(byLine.get(1)).toBeLessThan(6);
  });

  it("два прогони ділять щонайбільше ОДИН проміжок — свій спільний старт", () => {
    const rows = [
      row([100], 0, { spaceWidth: 10 }),
      row([100], 1, { spaceWidth: 10 }),
      row([100, 106], 2, { spaceWidth: 4 }),
      row([100, 106], 3, { spaceWidth: 4 }),
      row([106], 4, { spaceWidth: 4 }),
      row([106], 5, { spaceWidth: 4 }),
    ];
    const f = detectRivers(rows, { minRows: 4 });
    /* Перший прогін — рядки 0–3, другий — 1–5: перетин адрес є (рядки 1–3), але
     * проміжки в них різні, крім самого старту другого. Видно з сил: якби
     * другий прогін ішов тими самими проміжками, його медіана дорівнювала б
     * медіані першого. */
    const s = f.map((x) => x.strength).sort((a, b) => a - b);
    expect(s[0]).not.toBeCloseTo(s[1]!, 6);
  });

  it("проміжок, яким прогін ЗАКІНЧИВСЯ, може почати власний коридор", () => {
    /* Перший коридор — рядки 0–2; канал звузився до [53;54) і далі не пройшов.
     * Сам проміжок рядка 2 ширший за той канал і тягне другу смугу вниз. */
    const rows = [
      row([50], 0, { spaceWidth: 4 }),
      row([50], 1, { spaceWidth: 4 }),
      row([53], 2, { spaceWidth: 4 }),
      row([56], 3, { spaceWidth: 4 }),
      row([56], 4, { spaceWidth: 4 }),
    ];
    const f = detectRivers(rows, R3);
    expect(f).toHaveLength(2);
    expect(f.map((x) => x.measured)).toEqual([3, 3]);
    expect(new Set(f.map((x) => x.lineInParagraph))).toEqual(new Set([0, 2]));
  });

  it("id стабільний між прогонами", () => {
    const rows = column([[50], [50], [50]]);
    expect(detectRivers(rows, R3)[0]!.id).toBe(detectRivers(rows, R3)[0]!.id);
  });
});

describe("detectRivers — сила й контракт знахідки", () => {
  it("сила = рядки × медіанний проміжок / міра", () => {
    const rows = column([[50], [50], [50]], { spaceWidth: 4, columnWidth: 200 });
    const f = detectRivers(rows, R3);
    expect(f[0]!.strength).toBeCloseTo((3 * 4) / 200, 12);
  });

  it("по проміжках береться МЕДІАНА, а не максимум, мінімум чи середнє", () => {
    /* Ширини 2/4/10 при спільному лівому краї: медіана 4, максимум 10,
     * мінімум 2, середнє 5⅓ — усі чотири розрізняються. Доти кожна фікстура
     * мала єдиний spaceWidth на смугу, тож статистика була невизначена. */
    const rows = [
      row([100], 0, { spaceWidth: 2, columnWidth: 200 }),
      row([100], 1, { spaceWidth: 4, columnWidth: 200 }),
      row([100], 2, { spaceWidth: 10, columnWidth: 200 }),
    ];
    const f = detectRivers(rows, R3);
    expect(f).toHaveLength(1);
    expect(f[0]!.strength).toBeCloseTo((3 * 4) / 200, 12);
    expect(f[0]!.strength).not.toBeCloseTo((3 * 10) / 200, 6);
    expect(f[0]!.strength).not.toBeCloseTo((3 * 2) / 200, 6);
    expect(f[0]!.strength).not.toBeCloseTo((3 * 16) / 3 / 200, 6);
  });

  it("по мірі теж МЕДІАНА, а не міра першого рядка", () => {
    /* Міри 100/200/600: медіана 200, перший рядок 100, останній 600,
     * середнє 300. Прогін може перетинати абзаци з різними відступами, тож
     * єдиної міри в нього немає. */
    const rows = [
      row([100], 0, { spaceWidth: 4, columnWidth: 100 }),
      row([100], 1, { spaceWidth: 4, columnWidth: 200 }),
      row([100], 2, { spaceWidth: 4, columnWidth: 600 }),
    ];
    const f = detectRivers(rows, R3);
    expect(f).toHaveLength(1);
    expect(f[0]!.strength).toBeCloseTo((3 * 4) / 200, 12);
    expect(f[0]!.strength).not.toBeCloseTo((3 * 4) / 100, 6);
    expect(f[0]!.strength).not.toBeCloseTo((3 * 4) / 600, 6);
    expect(f[0]!.strength).not.toBeCloseTo((3 * 4) / 300, 6);
  });

  it("ширший проміжок при тій самій довжині — більша сила", () => {
    const thin = detectRivers(column([[50], [50], [50]], { spaceWidth: 2 }), R3);
    const thick = detectRivers(column([[50], [50], [50]], { spaceWidth: 8 }), R3);
    expect(thick[0]!.strength).toBeGreaterThan(thin[0]!.strength);
  });

  it("довший коридор при тій самій ширині — більша сила", () => {
    const short = detectRivers(column([[50], [50], [50]]), R3);
    const long = detectRivers(column([[50], [50], [50], [50], [50]]), R3);
    expect(long[0]!.strength).toBeGreaterThan(short[0]!.strength);
  });

  it("сила не залежить від допуску — інакше пачки сторінок були б несумірні", () => {
    const rows = column([[50], [50], [50]]);
    expect(detectRivers(rows, { ...R3, tolerancePt: 5 })[0]!.strength).toBe(
      detectRivers(rows, R3)[0]!.strength,
    );
  });

  it("порядок — за спаданням сили", () => {
    const f = detectRivers(
      [
        ...column([[50], [50], [50]], { containerId: "story:0", spaceWidth: 2 }),
        ...column([[50], [50], [50]], { containerId: "story:1", spaceWidth: 8 }),
      ],
      R3,
    );
    expect(f).toHaveLength(2);
    expect(f[0]!.containerId).toBe("story:1");
  });

  it("недодатна міра сили не дає — знахідки немає", () => {
    const rows = column([[50], [50], [50]], { columnWidth: 0 });
    expect(detectRivers(rows, R3)).toEqual([]);
  });

  it("кожна знахідка задовольняє контракт Finding", () => {
    const f = detectRivers(column([[50], [50], [50], [50]]), R3);
    expect(f).toHaveLength(1);
    for (const x of f) {
      expect(typeof x.measured).toBe("number");
      expect(Number.isFinite(x.measured)).toBe(true);
      expect(typeof x.strength).toBe("number");
      expect(x.strength).toBeGreaterThanOrEqual(0);
      expect(x.id.length).toBeGreaterThan(0);
      expect(x.detail.length).toBeGreaterThan(0);
      expect(x.lineText).toBe(f[0]!.lineText);
    }
  });
});

describe("detectRivers — ширина каналу", () => {
  it("волосинний канал відсікається minChannelPt", () => {
    /* Проміжки 3,2 пт із кроком 3,0 пт: перетин трьох — 0,2 пт. */
    const rows = column([[50], [53], [50.2]]);
    expect(detectRivers(rows, R3)).toHaveLength(1);
    expect(detectRivers(rows, { ...R3, minChannelPt: 1 })).toEqual([]);
  });

  it("широкий канал minChannelPt проходить", () => {
    expect(detectRivers(column([[50], [50], [50]]), { ...R3, minChannelPt: 3 })).toHaveLength(1);
  });

  it("канал РІВНО в minChannelPt проходить — поріг нестрогий знизу", () => {
    /* Канал рівно 4,0 пт: ширина точна у двійковому, тож «рівно» справді
     * означає рівність. Доти обидва тести стояли далеко від межі. */
    const rows = column([[50], [50], [50]], { spaceWidth: 4 });
    expect(detectRivers(rows, { ...R3, minChannelPt: 4 })).toHaveLength(1);
    expect(detectRivers(rows, { ...R3, minChannelPt: 4.5 })).toEqual([]);
  });
});

describe("detectRivers — рівний набір", () => {
  const ragged = column([[50], [50], [50]], { justification: "LEFT_ALIGN" });

  it("невиключені абзаци судяться за замовчуванням", () => {
    expect(detectRivers(ragged, R3)).toHaveLength(1);
  });

  it("justifiedOnly їх відсікає", () => {
    expect(detectRivers(ragged, { ...R3, justifiedOnly: true })).toEqual([]);
  });

  it("при justifiedOnly рівний рядок посередині розриває смугу", () => {
    const rows = [
      row([50], 0),
      row([50], 1),
      row([50], 2, { justification: "LEFT_ALIGN" }),
      row([50], 3),
      row([50], 4),
    ];
    expect(detectRivers(rows, R3)).toHaveLength(1);
    expect(detectRivers(rows, { ...R3, justifiedOnly: true })).toEqual([]);
  });
});

describe("surveyRivers", () => {
  it("віддає прогони від ДВОХ рядків — видно й те, що замовчування відкидає", () => {
    const s = surveyRivers(column([[50], [50], [50]]));
    expect(s.runs).toEqual([3]);
    expect(s.percentiles.max).toBe(3);
    expect(s.channels).toHaveLength(1);
    expect(s.channels[0]).toBeCloseTo(3.2, 10);
  });

  it("знаменник — придатні рядки; непридатні рахуються окремо", () => {
    const s = surveyRivers([
      ...column([[50], [50]]),
      line({ spaceWidth: 3.2, isLast: false, rotated: true }),
      line({ spaceWidth: 3.2, isLast: false, empty: true }),
    ]);
    expect(s.judged).toBe(2);
    expect(s.excluded.notMeasurable).toBe(2);
    expect(s.excluded.notJustified).toBe(0);
  });

  it("justifiedOnly переносить невиключені рядки у власний лічильник", () => {
    const s = surveyRivers(column([[50], [50]], { justification: "LEFT_ALIGN" }), {
      justifiedOnly: true,
    });
    expect(s.judged).toBe(0);
    expect(s.excluded.notJustified).toBe(2);
    expect(s.runs).toEqual([]);
  });

  it("на порожній вибірці перцентилі NaN, а не нуль", () => {
    const s = surveyRivers([]);
    expect(s.runs).toEqual([]);
    expect(Number.isNaN(s.percentiles.p50)).toBe(true);
    expect(Number.isNaN(s.percentiles.max)).toBe(true);
    expect(s.segments).toBe(0);
  });

  it("смуги рахуються за тим самим правилом сусідства, що й у детекторі", () => {
    const s = surveyRivers([
      ...column([[50], [50]], { containerId: "story:0" }),
      ...column([[50], [50]], { containerId: "story:1" }),
    ]);
    expect(s.segments).toBe(2);
    expect(s.runs).toEqual([2, 2]);
  });
});

/**
 * Задача 10 Фази 4: борг закритий — політика щодо `isMaster` тепер оголошена
 * САМЕ ТУТ, у детекторі, а не лише в обробнику `composition_audit` нагорі.
 */
describe("detectRivers — includeMasters", () => {
  /* Той самий коридор, що й у першому тесті файлу, тепер на батьківській. */
  it("за замовчуванням рядки батьківських сторінок НЕ рахуються", () => {
    const f = detectRivers(column([[50], [51], [50.5]], { isMaster: true }), R3);
    expect(f).toEqual([]);
  });

  it("includeMasters: true їх повертає", () => {
    const f = detectRivers(column([[50], [51], [50.5]], { isMaster: true }), {
      ...R3,
      includeMasters: true,
    });
    expect(f).toHaveLength(1);
    expect(f[0]!.defect).toBe("river");
  });
});

/**
 * Раунд виправлень 1 Задачі 10 Фази 4: рецензент прогнав два мутанти на
 * `surveyRivers` — (6) `columnSegments` кличеться з жорстко зашитим `false`
 * замість прапорця, (7) гілку `isMaster` прибрано з циклу лічби `judged`/
 * `excluded` — і обидва вижили, бо жоден тест не звіряв `surveyRivers` із
 * `isMaster` окремо від `detectRivers`. Це рівно та вада, від якої застерігає
 * власний коментар модуля: огляд і детектор мусять рахувати ОДИН і той самий
 * знаменник, інакше частки в звіті розійдуться мовчки.
 */
describe("surveyRivers — includeMasters (Раунд виправлень 1, мутанти 6–7)", () => {
  /* Той самий коридор, що й вище, тепер міряється оглядом, а не детектором. */
  const masterCorridor = column([[50], [51], [50.5]], { isMaster: true });

  it("за замовчуванням майстер-рядки НЕ рахуються — ні в judged, ні в segments", () => {
    const s = surveyRivers(masterCorridor);
    /* Мутант 7 (гілка isMaster прибрана з циклу лічби) дав би judged: 3,
     * excluded.master: 0 — рядки впали б у звичайний "вимірний і придатний". */
    expect(s.judged).toBe(0);
    expect(s.excluded.master).toBe(3);
    /* Мутант 6 тут не ловиться (жорстко зашите `false` і так відповідає
     * замовчуванню `includeMasters: false`) — його ловить тест нижче. */
    expect(s.segments).toBe(0);
    expect(s.runs).toEqual([]);
  });

  it("includeMasters: true — той самий знаменник, що бачить detectRivers", () => {
    const s = surveyRivers(masterCorridor, { includeMasters: true });
    expect(s.judged).toBe(3);
    expect(s.excluded.master).toBe(0);
    /* Мутант 6 (columnSegments кличеться з жорстко зашитим false) відрізав би
     * майстер-рядки від сегментів навіть тут, попри includeMasters: true —
     * segments лишився б 0, а не 1. */
    expect(s.segments).toBe(1);
    expect(s.runs.length).toBeGreaterThan(0);
  });
});

/*
 * ШИРИНА КАНАЛУ — ЦЕ БІЛА СМУГА, А НЕ СМУГА ДОПУСКУ.
 *
 * `channel` збирався з `dilate(gap, tolerance)`, тобто зі смуги, у якій
 * прогалини визнано «одна під одною». Саме вона потрапляла в `channelPt`, у
 * текст знахідки й у `surveyRivers().channels` — роздута рівно на
 * `2 × tolerance`.
 *
 * Наслідок подвійний: `minChannelPt` не міг відсіяти НІЧОГО вужчого за
 * `2 × tolerance` (тобто фільтр, написаний проти волосяних коридорів, їх і
 * пропускав), а оператора відсилали шукати смугу, якої на сторінці немає.
 */
describe("ширина каналу проти допуску", () => {
  /* Ширина прогалини задається `spaceWidth` рядка. */
  const смуга = (w: number) => column([[100], [100], [100], [100]], { spaceWidth: w });

  it("волосяний коридор не проходить фільтр, написаний проти волосяних", () => {
    const found = detectRivers(смуга(0.01), { minRows: 3, tolerancePt: 2, minChannelPt: 2 });
    expect(found, "смуга допуску видала себе за ширину каналу").toEqual([]);
  });

  it("ПОЗИТИВНИЙ БЛИЗНЮК: справді широкий коридор фільтр проходить", () => {
    /* Інакше правка звелася б до «жоден коридор не звітується». */
    const found = detectRivers(смуга(6), { minRows: 3, tolerancePt: 2, minChannelPt: 2 });
    expect(found.length).toBeGreaterThan(0);
  });
});

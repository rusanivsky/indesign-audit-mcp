import { describe, expect, it } from "vitest";
import {
  DASHES,
  SENTENCE_ENDERS,
  dashOffsetInLine,
  detectDashes,
  judgeDashLine,
  precedingWord,
  surveyDashes,
} from "../../src/composition/detect-dashes.js";
import { line } from "./helpers/composition.js";

const NBSP = String.fromCharCode(0x00a0);
const EM = "—";

/* Шість прозорих знаків — ті, крізь які виняток кінця речення дивиться наскрізь. */
const TRANSPARENT_CHARS = [
  String.fromCharCode(0x00bb), /* » */
  String.fromCharCode(0x201d), /* " */
  String.fromCharCode(0x0022), /* " */
  String.fromCharCode(0x2019), /* ' */
  ")",
  "]",
];

/** Попередній рядок абзацу: закінчується словом і КІНЦЕВИМ ПРОБІЛОМ. */
function prevLine(words: string[], trailing = true) {
  return line({
    spaceWidth: 3.2,
    isLast: false,
    wordList: words,
    lineInParagraph: 0,
    paragraphLineCount: 2,
    ...(trailing ? { trailingSpace: 3.2 } : {}),
  });
}

/** Рядок знахідки: починається з тире. */
function dashLine(words: string[]) {
  return line({
    spaceWidth: 3.2,
    isLast: true,
    wordList: words,
    lineInParagraph: 1,
    paragraphLineCount: 2,
  });
}

describe("dashOffsetInLine — чи рядок починається з тире", () => {
  it("знаходить кожне з чотирьох справжніх тире на позиції 0", () => {
    for (const d of DASHES) expect(dashOffsetInLine(`${d} слово`)).toBe(0);
  });

  it("дефіс і мінус — не тире", () => {
    for (const ch of ["-", "‐", "‑", "−"]) {
      expect(dashOffsetInLine(`${ch} слово`), ch).toBeNull();
    }
  });

  it("тире після початкових пробілів знайдено разом зі своїм зсувом", () => {
    expect(dashOffsetInLine(`  ${EM} слово`)).toBe(2);
  });

  it("тире після літери — не початок рядка", () => {
    expect(dashOffsetInLine(`а ${EM} б`)).toBeNull();
  });

  it("рядок із самих пробілів тире не має", () => {
    expect(dashOffsetInLine("   ")).toBeNull();
  });
});

describe("precedingWord — слово, до якого приклеїться тире", () => {
  it("бере останнє слово, ігноруючи кінцевий пробіл", () => {
    expect(precedingWord("і сталося Київ ")).toBe("Київ");
  });

  it("після коми слова немає — приклеюватися нема до чого на око", () => {
    expect(precedingWord("сказав він, ")).toBe("");
  });
});

describe("judgeDashLine — предикат знахідки", () => {
  it("тире посеред речення після слова — знахідка", () => {
    const v = judgeDashLine(dashLine([EM, "столиця"]), prevLine(["і", "Київ"]));
    expect(v).toEqual({ kind: "finding", dashInLine: 0 });
  });

  it("рядок без тире — no-dash", () => {
    expect(judgeDashLine(dashLine(["столиця"]), prevLine(["і", "Київ"])).kind).toBe("no-dash");
  });

  it("перед тире вже нерозривний пробіл — знахідки немає (ідемпотентність)", () => {
    const prev = line({
      spaceWidth: 3.2,
      isLast: false,
      wordList: ["і", `Київ${NBSP}`],
      lineInParagraph: 0,
      paragraphLineCount: 2,
    });
    expect(judgeDashLine(dashLine([EM, "столиця"]), prev)).toEqual({
      kind: "not-space",
      why: "alreadyNbsp",
    });
  });

  it("попередній рядок кінчається впритул на літеру — знахідки немає", () => {
    expect(judgeDashLine(dashLine([EM, "столиця"]), prevLine(["і", "Київ"], false))).toEqual({
      kind: "not-space",
      why: "other",
    });
  });

  it("примусовий розрив рядка — виняток", () => {
    const prev = line({
      spaceWidth: 3.2,
      isLast: false,
      wordList: ["і", "Київ\n"],
      lineInParagraph: 0,
      paragraphLineCount: 2,
    });
    expect(judgeDashLine(dashLine([EM, "столиця"]), prev)).toEqual({
      kind: "not-space",
      why: "forcedBreak",
    });
  });

  it("кожна кінцівка речення окремо вимикає знахідку", () => {
    for (const end of SENTENCE_ENDERS) {
      const v = judgeDashLine(dashLine([EM, "Що"]), prevLine(["він", `мовчав${end}`]));
      expect(v.kind, end).toBe("sentence-end");
    }
  });

  it("закривна лапка ПРОЗОРА: під нею оклик — виняток", () => {
    const v = judgeDashLine(dashLine([EM, "Що"]), prevLine(["крикнув", "«Іди!»"]));
    expect(v.kind).toBe("sentence-end");
  });

  it("закривна лапка ПРОЗОРА: під нею літера — знахідка", () => {
    const v = judgeDashLine(dashLine([EM, "і"]), prevLine(["сказав", "«іди»"]));
    expect(v).toEqual({ kind: "finding", dashInLine: 0 });
  });

  it("кожен з шести прозорих знаків — виняток дивиться під нього", () => {
    /*
     * Прозорий знак стоїть ЗА крапкою (`.${transparent}`), а не перед нею:
     * лапка перед крапкою («кінець ». ») лишає крапку останнім знаком і
     * замикає sentence-end БЕЗ участі циклу `while (TRANSPARENT.has(…))` у
     * `detect-dashes.ts` — попередня редакція тесту саме так і мовчала:
     * вона проходила навіть коли `TRANSPARENT` порожній.
     *
     * Обидва напрямки обов'язкові:
     *  - `.${transparent}` — під прозорим знаком крапка → sentence-end. Без
     *    циклу останній знак сам прозорий («»» не кінцівка й не тире») —
     *    вердикт стане «finding», і цей рядок почервоніє.
     *  - `${word}${transparent}` — під прозорим знаком ЛІТЕРА → finding. Тут
     *    вердикт «finding» виходить за ДВОМА різними причинами (без циклу —
     *    бо сама лапка не кінцівка; з циклом — бо під нею літера), тож саму
     *    по собі цю гілку легко визнати «непотрібною». Вона лишається, бо
     *    без першого напрямку доказ неповний: цикл здатний або НЕДО-, або
     *    ПЕРЕ-спрацювати, і другий напрям ловить якраз друге — гіпотетичну
     *    мутацію, що трактує прозорий знак як sentence-ender сам по собі.
     */
    for (const transparent of TRANSPARENT_CHARS) {
      const tag = `transparent: ${transparent.charCodeAt(0).toString(16)}`;
      const end = judgeDashLine(dashLine([EM, "і"]), prevLine(["кінець", `.${transparent} `]));
      expect(end.kind, tag).toBe("sentence-end");

      const found = judgeDashLine(dashLine([EM, "і"]), prevLine(["сказав", `іди${transparent} `]));
      expect(found, tag).toEqual({ kind: "finding", dashInLine: 0 });
    }
  });

  it("порожній набір кінцівок вимикає виняток кінця речення", () => {
    const v = judgeDashLine(dashLine([EM, "Що"]), prevLine(["він", "мовчав."]), new Set<string>());
    expect(v).toEqual({ kind: "finding", dashInLine: 0 });
  });

  it("перед тире стоїть інше тире — приклеювати нема сенсу", () => {
    expect(judgeDashLine(dashLine([EM, "б"]), prevLine(["а", EM])).kind).toBe("dash-before");
  });

  it("пробіл на початку рядка знахідки, а не в кінці попереднього", () => {
    /* Незалежність від конвенції композитора (§4.3.4). На живому InDesign ця
     * гілка не спрацьовує ніколи, тож зламати її можна, не зламавши більш нічого. */
    const dash = line({
      spaceWidth: 3.2,
      isLast: true,
      wordList: [` ${EM}`, "столиця"],
      lineInParagraph: 1,
      paragraphLineCount: 2,
    });
    expect(judgeDashLine(dash, prevLine(["і", "Київ"], false))).toEqual({
      kind: "finding",
      dashInLine: 1,
    });
  });
});

describe("detectDashes — відбір рядків", () => {
  const EM = "—";

  /** Абзац із двох рядків, у якому тире починає другий. */
  function pair(over: { isMaster?: boolean; containerId?: string } = {}) {
    return [
      line({
        spaceWidth: 3.2,
        isLast: false,
        wordList: ["і", "Київ"],
        trailingSpace: 3.2,
        lineInParagraph: 0,
        paragraphLineCount: 2,
        ...over,
      }),
      line({
        spaceWidth: 3.2,
        isLast: true,
        wordList: [EM, "столиця"],
        lineInParagraph: 1,
        paragraphLineCount: 2,
        ...over,
      }),
    ];
  }

  it("дає одну знахідку з вагою error і константною силою", () => {
    const fs = detectDashes(pair());
    expect(fs).toHaveLength(1);
    expect(fs[0]!.defect).toBe("line-start-dash");
    expect(fs[0]!.severity).toBe("error");
    expect(fs[0]!.strength).toBe(1);
    expect(fs[0]!.measured).toBe(1);
    expect(fs[0]!.lineInParagraph).toBe(1);
    expect(fs[0]!.detail).toMatch(/Київ/);
  });

  it("перший рядок абзацу не судиться — це початок абзацу", () => {
    const solo = line({
      spaceWidth: 3.2,
      isLast: false,
      wordList: [EM, "Привіт"],
      lineInParagraph: 0,
      paragraphLineCount: 2,
    });
    expect(detectDashes([solo])).toHaveLength(0);
  });

  it("рядок майстра не судиться без includeMasters", () => {
    expect(detectDashes(pair({ isMaster: true }))).toHaveLength(0);
    expect(detectDashes(pair({ isMaster: true }), { includeMasters: true })).toHaveLength(1);
  });

  it("непридатний до виміру рядок не судиться", () => {
    const [prev, dash] = pair();
    const rotated = { ...dash!, rotated: true, rotationAngle: -90 };
    expect(detectDashes([prev!, rotated])).toHaveLength(0);
  });

  it("власний набір кінцівок речення перекриває замовчування", () => {
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
        wordList: [EM, "Що"],
        lineInParagraph: 1,
        paragraphLineCount: 2,
      }),
    ];
    expect(detectDashes(lines)).toHaveLength(0);
    expect(detectDashes(lines, { sentenceEnders: [] })).toHaveLength(1);
  });
});

describe("surveyDashes — облік без позначення", () => {
  const EM = "—";

  it("тотожність лічильників тримається: кожен рядок із тире кудись пішов", () => {
    const corpus = [
      /* знахідка */
      line({ spaceWidth: 3.2, isLast: false, wordList: ["і", "Київ"], trailingSpace: 3.2, lineInParagraph: 0, paragraphLineCount: 2 }),
      line({ spaceWidth: 3.2, isLast: true, wordList: [EM, "столиця"], lineInParagraph: 1, paragraphLineCount: 2 }),
      /* виняток кінця речення */
      line({ spaceWidth: 3.2, isLast: false, containerId: "story:1", wordList: ["він", "мовчав."], trailingSpace: 3.2, lineInParagraph: 0, paragraphLineCount: 2 }),
      line({ spaceWidth: 3.2, isLast: true, containerId: "story:1", wordList: [EM, "Що"], lineInParagraph: 1, paragraphLineCount: 2 }),
      /* впритул, без пробілу */
      line({ spaceWidth: 3.2, isLast: false, containerId: "story:2", wordList: ["і", "Київ"], lineInParagraph: 0, paragraphLineCount: 2 }),
      line({ spaceWidth: 3.2, isLast: true, containerId: "story:2", wordList: [EM, "столиця"], lineInParagraph: 1, paragraphLineCount: 2 }),
    ];
    const s = surveyDashes(corpus);
    const notSpace =
      s.skippedNotSpace.forcedBreak + s.skippedNotSpace.alreadyNbsp + s.skippedNotSpace.other;
    expect(s.startsWithDash).toBe(
      s.skippedNoPreviousLine + notSpace + s.skippedSentenceEnd + s.skippedDashBefore + s.findings,
    );
    expect(s.findings).toBe(1);
    expect(s.skippedSentenceEnd).toBe(1);
    expect(s.skippedNotSpace.other).toBe(1);
  });

  it("виключене з знаменника рахується окремо — це НЕ «чисті» рядки", () => {
    const master = line({
      spaceWidth: 3.2,
      isLast: true,
      wordList: [EM, "столиця"],
      lineInParagraph: 1,
      paragraphLineCount: 2,
      isMaster: true,
    });
    const s = surveyDashes([master]);
    expect(s.eligible).toBe(0);
    expect(s.excluded.master).toBe(1);
  });
});

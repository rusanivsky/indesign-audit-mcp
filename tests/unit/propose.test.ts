import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_TRACKING,
  FIX_KIND,
  proposeFixes,
  type Proposal,
} from "../../src/composition/propose.js";
import { STRENGTH_SCALE } from "../../src/composition/finding.js";
import type { ContainerSnapshot } from "../../src/corrections/types.js";
import type { DefectClass, Finding, LineMeasure } from "../../src/composition/types.js";
import { line } from "./helpers/composition.js";

/**
 * Повний `ContainerSnapshot` для однієї історії.
 *
 * У блоках про `line-start-dash` замість нього стояли скорочення лише з
 * `containerId` і `text`, які типізації не проходили — бракувало
 * `pageRuns`, `oversetFrom`, `isMaster`, `kind`. Побачити це було нічим:
 * `tsconfig.json` включав лише `src/**`, а vitest компілює без перевірки
 * типів (борг закрито 2026-08-05). На поведінку не впливало — для цього
 * класу `proposeFixes` читає лише `text`, — але фікстура стверджувала, що
 * знає тип, якого не мала, і будь-яке майбутнє правило, що зазирне в
 * `pageRuns` чи `isMaster`, спіткнулося б тут на `undefined`.
 */
function containerSnapshot(text: string, containerId = "story:0"): ContainerSnapshot {
  return {
    containerId,
    text,
    pageRuns: [{ start: 0, end: text.length, page: "12" }],
    oversetFrom: null,
    isMaster: false,
    kind: "text",
  };
}

/*
 * АРИФМЕТИКА, ЯКУ ПЕРЕВІРЯЮТЬ ЦІ ТЕСТИ, і звідки в них числа.
 *
 * Одиниця трекінгу InDesign — 1/1000 em, тобто на кожен символ припадає
 * `delta/1000 × pointSize` пунктів. Звідси весь модуль:
 *
 *   delta = 1000 × (скільки пунктів треба забрати чи додати) / (ПРОМІЖКИ × кегль)
 *
 * «Проміжки», не «символи»: трекінг додає простір ПІСЛЯ кожного символа, тож на
 * n символах рядка працюють n − 1 проміжків — додаток після останнього гліфа
 * нічого не штовхає. Виміряно у Фазі 3 (17/18 і 41/42), виправлено 2026-08-05.
 * Для widow/short-last-line знаменником лишаються САМІ символи: там абзац із
 * кількох рядків, і скільки проміжків «зникає» на кінцях рядків, ніхто не
 * міряв — переносити сюди виміряне для одного рядка означало б підмінити
 * вимір аналогією.
 *
 * «Символи» в цій формулі РІЗНІ для двох груп класів, і саме тут це найлегше
 * зіпсувати непомітно:
 *  - `loose`/`tight` — символи БЕЗ міжслівних пробілів. Ширина виключеного
 *    рядка зафіксована мірою, тож трекінг, доданий пробілу, розв'язувач
 *    виключки одразу забирає назад: повітря вбирає лише те, що не є пробілом;
 *  - `widow`/`short-last-line` — УСІ символи абзацу, пробіли включно: там
 *    рухається сама ширина вмісту, і пробіл несе трекінг нарівні з літерами.
 *
 * Фікстура `line()` дає гліф завширшки 5 пт, кегль 10 і міру 200 пт. Рядок за
 * замовчуванням «аб аб» — це 5 символів із просуванням, із них 4 непробільні,
 * тож обидва знаменники в тестах різні числа, і сплутати їх мовчки не вийде.
 */

const CONTAINER = "story:0";

function finding(over: Partial<Finding> & { defect: DefectClass }): Finding {
  return {
    id: `${over.defect}:${CONTAINER}:0:0`,
    severity: "error",
    page: "12",
    containerId: CONTAINER,
    paragraphIndex: 0,
    lineInParagraph: 0,
    lineText: "рядок",
    measured: 1.4,
    strength: 0.001,
    detail: "",
    ...over,
  };
}

type LineOpts = Parameters<typeof line>[0];

/** Рядок за замовчуванням: 5 друкованих символів, кегль 10, міра 200. */
function plain(over: Partial<LineOpts> = {}): LineMeasure {
  return line({ spaceWidth: 3, isLast: false, ...over });
}

/**
 * М'який перенос. Записаний саме escape-послідовністю, а не самим символом:
 * U+00AD у вихідному тексті невидимий, і виправлення тесту наосліп було б
 * питанням часу.
 */
const SHY = String.fromCharCode(0x00ad);

function only(ps: Proposal[]): Proposal {
  expect(ps).toHaveLength(1);
  return ps[0]!;
}

describe("proposeFixes — відображення дефекту у вид виправлення", () => {
  /*
   * Таблиця відображення — ЄДИНЕ місце, де воно оголошене. Тест тримає її
   * повною: `Record<DefectClass, …>` не дасть додати клас у `DefectClass`, не
   * назвавши його вид, а цей тест не дасть змінити вид мовчки.
   */
  it("кожен із десяти класів має рівно один оголошений вид", () => {
    expect(Object.keys(FIX_KIND).sort()).toEqual(Object.keys(STRENGTH_SCALE).sort());
    expect(FIX_KIND).toEqual({
      loose: "tracking",
      tight: "tracking",
      widow: "tracking",
      "short-last-line": "tracking",
      orphan: "manual",
      "hyphen-across-spread": "invisible",
      "hyphen-forbidden": "invisible",
      "hyphen-ladder": "manual",
      river: "manual",
      "line-start-dash": "invisible",
    });
  });

  it("вид пропозиції не залежить від того, чи вдалося її адресувати", () => {
    /* Без `lines` і без знімка контейнера адресувати нічого не можна — але
     * КЛАС дефекту від цього не міняється, міняється лише `blocked`. */
    for (const defect of Object.keys(FIX_KIND) as DefectClass[]) {
      const p = only(proposeFixes([finding({ defect })], []));
      expect(p.kind, defect).toBe(FIX_KIND[defect]);
    }
  });

  it("вид «text» не видається ніколи — тексту автора інструмент не переписує", () => {
    expect(Object.values(FIX_KIND)).not.toContain("text");
  });
});

describe("proposeFixes — трекінг для щільних і розріджених рядків", () => {
  /*
   * НАПРЯМ. Розріджений рядок має ЗАЙВЕ міжслівне повітря, тож літери треба
   * РОЗСУНУТИ (додатний трекінг): ширина гліфів забирає надлишок на себе, і
   * пробіли стискаються до природних. Щільний — навпаки.
   */
  it("розріджений рядок дає ДОДАТНИЙ трекінг: ширина літер забирає повітря", () => {
    /* strength = 0,001 частки міри × 200 пт = 0,2 пт повітря;
     * непробільних символів 4 (із 5 із просуванням), тобто ПРОМІЖКІВ 3 —
     * трекінг додає простір після кожного символа, і додаток після
     * останнього нічого не штовхає (виміряно, Фаза 3: 17/18 і 41/42);
     * 1000 × 0,2 / (3 × 10 пт) = +6,67 → +7. */
    const p = only(proposeFixes([finding({ defect: "loose", strength: 0.001 })], [plain()]));
    expect(p.tracking).toEqual({ containerId: CONTAINER, paragraphIndex: 0, delta: 7 });
  });

  it("міжслівні пробіли в знаменник НЕ входять — виключка забирає їхній трекінг назад", () => {
    /* Той самий рядок, але з трьох слів: 8 символів із просуванням, 6
     * непробільних, тобто 5 проміжків. Сила вдвічі більша (0,002 × 200 =
     * 0,4 пт): 1000 × 0,4 / (5 × 10) = +8 — проти +7 у рядка з двох слів.
     * Якби в знаменник ішли й пробіли, вийшло б 1000 × 0,4 / (7 × 10) =
     * +5,7 → +6, тобто інше число: сплутати знаменники мовчки не вийде. */
    const p = only(
      proposeFixes([finding({ defect: "loose", strength: 0.002 })], [plain({ words: 3 })]),
    );
    expect(p.tracking!.delta).toBe(8);
  });

  it("щільний рядок дає ВІД'ЄМНИЙ трекінг: літери звужуються, пробіли розтискаються", () => {
    const p = only(
      proposeFixes([finding({ defect: "tight", measured: 0.79, strength: 0.001 })], [plain()]),
    );
    expect(p.tracking!.delta).toBe(-7);
  });

  it("трекінг не виходить за дозволену межу, і недобір названий числом", () => {
    /* strength = 0,01 × 200 = 2 пт; 1000 × 2 / (3 × 10) = +66,7, межа 5. */
    const p = only(
      proposeFixes([finding({ defect: "loose", strength: 0.01 })], [plain()], { maxTracking: 5 }),
    );
    expect(p.tracking!.delta).toBe(5);
    expect(p.shortfall).toEqual({ requiredDelta: 66.7, appliedDelta: 5, coverage: 0.075 });
  });

  it("недобір іде В ОПИС, а не лише в поле поруч", () => {
    const p = only(
      proposeFixes([finding({ defect: "loose", strength: 0.01 })], [plain()], { maxTracking: 5 }),
    );
    expect(p.description).toMatch(/WON'T BE ENOUGH/);
    expect(p.description).toContain("+66.7");
    expect(p.description).toMatch(/8%/);
  });

  it("дробова потрібна поправка не округлюється у звіті до цілого", () => {
    /* 1000 × (0,0025 × 200) / (3 × 10) = +16,67 → 16,7. */
    const p = only(
      proposeFixes([finding({ defect: "loose", strength: 0.0025 })], [plain()], { maxTracking: 5 }),
    );
    expect(p.shortfall!.requiredDelta).toBe(16.7);
  });

  it("розтягнутий примусовим переносом рядок трекінгу не дістає — причина інша", () => {
    /*
     * `docs/measured-facts-phase3.md:317-319`: найгрубіший розріджений рядок
     * книжки закінчується `\n`, і InDesign виключає на повну міру рядок перед
     * примусовим переносом. Трекінг цілиться не в ту причину.
     */
    const forced = plain({ wordList: ["аб", `аб${String.fromCharCode(10)}`] });
    const p = only(proposeFixes([finding({ defect: "loose", strength: 0.01 })], [forced]));
    expect(p.tracking).toBeUndefined();
    expect(p.blocked).toMatch(/FORCED LINE BREAK/i);
  });

  it("у межах допустимого недобору немає взагалі", () => {
    const p = only(proposeFixes([finding({ defect: "loose", strength: 0.001 })], [plain()]));
    expect(p.shortfall).toBeUndefined();
  });

  it("замовчування межі — конвенція, названа числом, а не мовчазна п'ятірка", () => {
    expect(DEFAULT_MAX_TRACKING).toBe(20);
    const p = only(proposeFixes([finding({ defect: "loose", strength: 0.01 })], [plain()]));
    expect(p.tracking!.delta).toBe(DEFAULT_MAX_TRACKING);
  });

  it("межа мусить бути додатним числом — нуль означав би пропозицію-пустушку", () => {
    expect(() => proposeFixes([], [], { maxTracking: 0 })).toThrow(/maxTracking/);
    expect(() => proposeFixes([], [], { maxTracking: -3 })).toThrow(/maxTracking/);
  });

  it("відхилення, менше за одиницю трекінгу, виправлення не дістає", () => {
    /* 1000 × (0,00001 × 200) / (4 × 10) = 0,05 → округлюється в нуль. */
    const p = only(proposeFixes([finding({ defect: "loose", strength: 0.00001 })], [plain()]));
    expect(p.tracking).toBeUndefined();
    expect(p.blocked).toMatch(/smaller than one tracking unit/);
  });
});

describe("proposeFixes — трекінг для вісяка й короткого кінцевого рядка", () => {
  /*
   * Обидва класи сидять в одній шкалі сили `emptiness` (`finding.ts`), тобто
   * самі детектори довели, що це ОДНА величина. Тому й виправлення одне:
   * підтиснути абзац рівно настільки, щоб останній рядок утягнувся в
   * попередній. Скільки саме — це ширина того рядка, поділена на всі символи
   * абзацу.
   */
  const para = (): LineMeasure[] => [
    line({ spaceWidth: 3, isLast: false, words: 10, lineInParagraph: 0, paragraphLineCount: 2 }),
    line({
      spaceWidth: 3,
      isLast: true,
      words: 10,
      lineInParagraph: 1,
      paragraphLineCount: 2,
      isFirstInFrame: true,
    }),
  ];

  const widow = finding({
    defect: "widow",
    id: `widow:${CONTAINER}:0:1`,
    lineInParagraph: 1,
    measured: 0.05,
    strength: 0.95,
  });

  it("вісяк підтискається трекінгом, порахованим із ширини самого рядка", () => {
    /* 0,05 × 200 пт = 10 пт треба забрати; символів у абзаці 2 × 29 = 58;
     * 1000 × 10 / (58 × 10) = −17,24 → −17. */
    const p = only(proposeFixes([widow], para()));
    expect(p.kind).toBe("tracking");
    expect(p.tracking!.delta).toBe(-17);
  });

  it("короткий кінцевий рядок лікується тим самим трекінгом — шкала в них одна", () => {
    const short = finding({
      defect: "short-last-line",
      id: `short-last-line:${CONTAINER}:0:1`,
      lineInParagraph: 1,
      measured: 0.05,
      strength: 0.95,
    });
    expect(only(proposeFixes([short], para())).tracking!.delta).toBe(-17);
  });

  it("абзац, поміряний не цілком, трекінгу не дістає — знаменник був би вигаданий", () => {
    /* Другий рядок абзацу лишився за вікном сторінок: символів у знаменнику
     * менше, ніж є насправді, і трекінг вийшов би завеликим. */
    const p = only(proposeFixes([widow], [para()[1]!]));
    expect(p.tracking).toBeUndefined();
    expect(p.blocked).toMatch(/not fully measured/i);
  });
});

describe("proposeFixes — що не міряли, того не виправляють", () => {
  it("рядка немає серед виміряних — пропозиція без запису", () => {
    const p = only(proposeFixes([finding({ defect: "loose" })], []));
    expect(p.tracking).toBeUndefined();
    expect(p.blocked).toMatch(/not found among the measured/i);
  });

  it("непридатний до виміру рядок виправлення не дістає", () => {
    const p = only(proposeFixes([finding({ defect: "loose" })], [plain({ rotated: true })]));
    expect(p.tracking).toBeUndefined();
    expect(p.blocked).toMatch(/not measurable/i);
  });

  it("мішаний кегль абзацу трекінгу не дістає — переводити 1/1000 em нічим", () => {
    const p = only(proposeFixes([finding({ defect: "loose" })], [plain({ size: null })]));
    expect(p.tracking).toBeUndefined();
    expect(p.blocked).toMatch(/point size/i);
  });

  it("нульовий кегль теж не дістає — інакше вийшла б тиха поправка на всю межу", () => {
    /* Ділення на нуль дає Infinity, а `Math.min(Infinity, max)` — рівно межу.
     * Тобто без цієї перевірки збій виглядав би як упевнене виправлення. */
    const p = only(proposeFixes([finding({ defect: "loose" })], [plain({ size: 0 })]));
    expect(p.tracking).toBeUndefined();
    expect(p.blocked).toMatch(/point size/i);
  });

  it("недодатна міра абзацу трекінгу не дає — відхилення нема від чого рахувати", () => {
    const p = only(proposeFixes([finding({ defect: "loose" })], [plain({ columnWidth: 0 })]));
    expect(p.tracking).toBeUndefined();
    expect(p.blocked).toMatch(/Paragraph measure/i);
  });

  it("керівні символи трекінгу не дістають — просування в них синтетичне", () => {
    /* Абзац із двох рядків по два слова: 5 друкованих символів у кожному.
     * Останній рядок несе ще й знак кінця абзацу, і він у знаменник НЕ йде.
     * 0,05 × 200 = 10 пт; 1000 × 10 / (10 символів × 10 пт) = −100.
     * Якби `\r` рахувався, знаменник був би 11 і вийшло б −91. */
    const p = only(
      proposeFixes(
        [
          finding({
            defect: "widow",
            id: `widow:${CONTAINER}:0:1`,
            lineInParagraph: 1,
            measured: 0.05,
            strength: 0.95,
          }),
        ],
        [
          plain({ lineInParagraph: 0, paragraphLineCount: 2 }),
          plain({ lineInParagraph: 1, paragraphLineCount: 2, endsParagraph: true }),
        ],
        { maxTracking: 200 },
      ),
    );
    expect(p.tracking!.delta).toBe(-100);
  });

  it("нульова сила знахідки трекінгу не дає — надлишок повітря не виміряно", () => {
    /* `detectSpacing` ставить strength = 0 саме тоді, коли airFraction === null. */
    const p = only(proposeFixes([finding({ defect: "loose", strength: 0 })], [plain()]));
    expect(p.tracking).toBeUndefined();
    expect(p.blocked).toMatch(/not measured/i);
  });
});

describe("proposeFixes — один трекінг на абзац", () => {
  /*
   * `apply_edits` ДОДАЄ дельту до наявного трекінгу абзацу. Дві пропозиції на
   * той самий абзац, застосовані обидві, подвоїли б правку. Тому всі пропозиції
   * одного абзацу несуть ОДНАКОВУ дельту: Задача 14 може зняти дублікати за
   * (контейнер, абзац) і взяти будь-яку.
   */
  const twoLoose = [
    finding({ defect: "loose", id: "loose:story:0:0:0", lineInParagraph: 0, strength: 0.001 }),
    finding({ defect: "loose", id: "loose:story:0:0:1", lineInParagraph: 1, strength: 0.01 }),
  ];
  const twoLines = [
    plain({ lineInParagraph: 0 }),
    plain({ lineInParagraph: 1, isLast: true }),
  ];

  it("дві знахідки одного абзацу дістають ОДНУ дельту — інакше її застосували б двічі", () => {
    const ps = proposeFixes(twoLoose, twoLines);
    expect(ps.map((p) => p.tracking!.delta)).toEqual([7, 7]);
  });

  it("спільна дельта — найобережніша з потрібних, а не найбільша", () => {
    /* Потрібні +7 і +66,7; беремо +7. Той, кому мало, бачить це в shortfall. */
    const ps = proposeFixes(twoLoose, twoLines);
    expect(ps[0]!.shortfall).toBeUndefined();
    expect(ps[1]!.shortfall).toEqual({ requiredDelta: 66.7, appliedDelta: 7, coverage: 0.105 });
  });

  it("протилежні напрями в одному абзаці трекінгу не дістають узагалі", () => {
    const mixed = [
      finding({ defect: "loose", id: "loose:story:0:0:0", lineInParagraph: 0, strength: 0.001 }),
      finding({ defect: "tight", id: "tight:story:0:0:1", lineInParagraph: 1, strength: 0.001 }),
    ];
    const ps = proposeFixes(mixed, twoLines);
    expect(ps.every((p) => p.tracking === undefined)).toBe(true);
    for (const p of ps) expect(p.blocked).toMatch(/opposite/i);
  });

  it("абзаци не плутаються між собою", () => {
    const other = finding({
      defect: "loose",
      id: "loose:story:0:7:0",
      paragraphIndex: 7,
      strength: 0.01,
    });
    const ps = proposeFixes([twoLoose[0]!, other], [
      twoLines[0]!,
      plain({ paragraphIndex: 7 }),
    ]);
    expect(ps.map((p) => p.tracking!.delta)).toEqual([7, 20]);
  });
});

describe("proposeFixes — невидимий знак для переносу", () => {
  /*
   * Слово «Шевченко» розірване межею сторінок: «до Шевчен-» / «ко далі».
   * Виправлення — м'який перенос U+00AD ПЕРЕД словом: у InDesign це вимикає
   * перенос усього слова, і воно переходить цілим. Слова автора не змінені.
   */
  const head = line({
    spaceWidth: 3,
    isLast: false,
    wordList: ["до", "Шевчен"],
    endsWithHyphen: true,
    lineInParagraph: 0,
    paragraphLineCount: 2,
    isLastInFrame: true,
  });
  const tail = line({
    spaceWidth: 3,
    isLast: true,
    wordList: ["ко", "далі"],
    lineInParagraph: 1,
    paragraphLineCount: 2,
  });
  const snapshot = (text: string): ContainerSnapshot => ({
    containerId: CONTAINER,
    text,
    pageRuns: [{ start: 0, end: text.length, page: "12" }],
    oversetFrom: null,
    isMaster: false,
    kind: "text",
  });
  const spread = finding({
    defect: "hyphen-across-spread",
    id: `hyphen-across-spread:${CONTAINER}:0:0`,
    lineText: head.text,
    measured: 2,
    strength: 0.25,
  });

  it("зі знімком контейнера виходить готовий AcceptedEdit", () => {
    const p = only(
      proposeFixes([spread], [head, tail], { containers: [snapshot("до Шевченко далі")] }),
    );
    expect(p.kind).toBe("invisible");
    expect(p.edit).toEqual({
      requestId: spread.id,
      candidateId: `${spread.id}#0`,
      containerId: CONTAINER,
      start: 3,
      end: 9,
      expectedOld: "Шевчен",
      newText: `${SHY}Шевчен`,
      action: "replace",
    });
  });

  it("requestId правки — це ідентифікатор знахідки, і другої системи адрес немає", () => {
    const p = only(
      proposeFixes([spread], [head, tail], { containers: [snapshot("до Шевченко далі")] }),
    );
    expect(p.edit!.requestId).toBe(p.findingId);
  });

  it("заборонене слово лікується так само — вимір у них один", () => {
    const forbidden = finding({
      defect: "hyphen-forbidden",
      id: `hyphen-forbidden:${CONTAINER}:0:0`,
      lineText: head.text,
      measured: 2,
      strength: 0.25,
    });
    const p = only(
      proposeFixes([forbidden], [head, tail], { containers: [snapshot("до Шевченко далі")] }),
    );
    expect(p.edit!.newText).toBe(`${SHY}Шевчен`);
  });

  it("зсув рахується від початку КОНТЕЙНЕРА, а не від початку абзацу", () => {
    /* Той самий абзац, але другим у story: перед ним «Перший.» + `\r`. */
    const before = line({
      spaceWidth: 3,
      isLast: true,
      wordList: ["Перший."],
      lineInParagraph: 0,
      paragraphLineCount: 1,
      endsParagraph: true,
    });
    const p = only(
      proposeFixes(
        [finding({ ...spread, paragraphIndex: 1, id: `hyphen-across-spread:${CONTAINER}:1:0` })],
        [
          before,
          { ...head, paragraphIndex: 1 },
          { ...tail, paragraphIndex: 1 },
        ],
        { containers: [snapshot("Перший.\rдо Шевченко далі")] },
      ),
    );
    expect(p.edit!.start).toBe(11);
    expect(p.edit!.end).toBe(17);
  });

  it("без знімка контейнера правки немає, і сказано чому", () => {
    const p = only(proposeFixes([spread], [head, tail]));
    expect(p.kind).toBe("invisible");
    expect(p.edit).toBeUndefined();
    expect(p.blocked).toMatch(/no container text/i);
  });

  it("розбіжність знімка з виміром зупиняє правку, а не пише навмання", () => {
    /* У знімку між словами два пробіли — зсуви поїхали б на символ. */
    const p = only(
      proposeFixes([spread], [head, tail], { containers: [snapshot("до  Шевченко далі")] }),
    );
    expect(p.edit).toBeUndefined();
    expect(p.blocked).toMatch(/diverged from the measurement/i);
  });

  it("розбіжність ПІСЛЯ слова зупиняє правку так само — довіряти нема чому", () => {
    /*
     * Тут зсуви самого слова ще збігаються, тож звірка тексту на межах цю
     * підробку пропустила б. Ловить її саме зшивання абзацу: якщо знімок і
     * вимір розійшлися хоч десь, вони описують різні стани документа.
     */
    const p = only(
      proposeFixes([spread], [head, tail], { containers: [snapshot("до Шевченко  далі")] }),
    );
    expect(p.edit).toBeUndefined();
    expect(p.blocked).toMatch(/diverged from the measurement/i);
  });

  it("береться ОСТАННЄ входження уламка в рядок, а не перше", () => {
    /* «Шевчен Шевчен-»: перше входження стоїть на позиції 0 і виглядає так
     * само правдоподібно, тож помилка тут була б мовчазною. */
    const twice = line({
      spaceWidth: 3,
      isLast: false,
      wordList: ["Шевчен", "Шевчен"],
      endsWithHyphen: true,
      lineInParagraph: 0,
      paragraphLineCount: 2,
      isLastInFrame: true,
    });
    const p = only(
      proposeFixes([finding({ ...spread, lineText: twice.text })], [twice, tail], {
        containers: [snapshot("Шевчен Шевченко далі")],
      }),
    );
    expect(p.edit!.start).toBe(7);
    expect(p.edit!.end).toBe(13);
  });

  it("абзац поза межами знімка зупиняє правку ще ДО зшивання", () => {
    /*
     * Знімок має рівно один абзац, а знахідка стоїть у другому. Без строгої
     * межі (`>=`, а не `>`) розбір поліз би за край масиву й помилка вилізла б
     * аж на зшиванні — з чужим поясненням, яке веде читача не туди.
     */
    const p = only(
      proposeFixes(
        [finding({ ...spread, paragraphIndex: 1, id: `hyphen-across-spread:${CONTAINER}:1:0` })],
        [
          { ...head, paragraphIndex: 1 },
          { ...tail, paragraphIndex: 1 },
        ],
        { containers: [snapshot("до Шевченко далі")] },
      ),
    );
    expect(p.edit).toBeUndefined();
    expect(p.blocked).toMatch(/paragraphs, but the finding is in paragraph/);
  });

  it("опис називає слово, яке СПРАВДІ правиться, а не те, що лежало в знахідці", () => {
    /*
     * Задача 14 зводить знахідки ДО запису зі свіжим виміром, тож `lineText`
     * знахідки й текст рядка можуть розійтися. Правиться те, що виміряно зараз,
     * і опис має називати саме його.
     */
    const p = only(
      proposeFixes([finding({ ...spread, lineText: "до Інший" })], [head, tail], {
        containers: [snapshot("до Шевченко далі")],
      }),
    );
    expect(p.edit!.expectedOld).toBe("Шевчен");
    expect(p.description).toContain("Шевчен");
    expect(p.description).not.toContain("Інший");
  });

  it("знімок звіряється за containerId, а не береться перший-ліпший", () => {
    const other: ContainerSnapshot = { ...snapshot("зовсім інший текст"), containerId: "story:9" };
    const p = only(proposeFixes([spread], [head, tail], { containers: [other] }));
    expect(p.edit).toBeUndefined();
    expect(p.blocked).toMatch(/No container/i);
  });

  it("уже поставлений м'який перенос удруге не ставиться", () => {
    const already = line({
      spaceWidth: 3,
      isLast: false,
      wordList: ["до", `${SHY}Шевчен`],
      endsWithHyphen: true,
      lineInParagraph: 0,
      paragraphLineCount: 2,
      isLastInFrame: true,
    });
    const p = only(
      proposeFixes(
        [finding({ ...spread, lineText: already.text })],
        [already, tail],
        { containers: [snapshot(`до ${SHY}Шевченко далі`)] },
      ),
    );
    expect(p.edit).toBeUndefined();
    expect(p.blocked).toMatch(/already/i);
  });

  it("рядок без видимого уламка слова правки не дістає", () => {
    const bare = line({ spaceWidth: 3, isLast: false, wordList: ["…"], lineInParagraph: 0 });
    const p = only(
      proposeFixes([finding({ ...spread, lineText: bare.text })], [bare, tail], {
        containers: [snapshot("…ко далі")],
      }),
    );
    expect(p.edit).toBeUndefined();
    expect(p.blocked).toMatch(/fragment/i);
  });
});

describe("proposeFixes — що дістає Задача 14 для перевірки", () => {
  it("кожна пропозиція посилається на свою знахідку тим самим ключем", () => {
    const ps = proposeFixes(
      [
        finding({ defect: "loose", id: "a" }),
        finding({ defect: "river", id: "river:story:0:0:0:12.50" }),
      ],
      [plain()],
    );
    expect(ps.map((p) => p.findingId)).toEqual(["a", "river:story:0:0:0:12.50"]);
  });

  it("несе адресу перекомпонування — саме її Задача 14 переміряє", () => {
    const p = only(proposeFixes([finding({ defect: "loose", page: "77" })], [plain()]));
    expect(p.scope).toEqual({ containerId: CONTAINER, paragraphIndex: 0, page: "77" });
  });

  it("несе стан ДО запису — інакше порівнювати перемір буде ні з чим", () => {
    const p = only(
      proposeFixes([finding({ defect: "loose", measured: 1.42, strength: 0.001 })], [plain()]),
    );
    expect(p.before).toEqual({ measured: 1.42, strength: 0.001 });
  });

  it("називає сусідів по абзацу: правка перекомпоновує їх усіх", () => {
    const ps = proposeFixes(
      [
        finding({ defect: "loose", id: "a", lineInParagraph: 0 }),
        finding({ defect: "widow", id: "b", lineInParagraph: 1 }),
        finding({ defect: "loose", id: "c", paragraphIndex: 5 }),
      ],
      [plain({ lineInParagraph: 0 }), plain({ lineInParagraph: 1, isLast: true })],
    );
    expect(ps[0]!.alsoInParagraph).toEqual(["b"]);
    expect(ps[1]!.alsoInParagraph).toEqual(["a"]);
    expect(ps[2]!.alsoInParagraph).toEqual([]);
  });

  it("клас дефекту їде разом із пропозицією", () => {
    expect(only(proposeFixes([finding({ defect: "river" })], [])).defect).toBe("river");
  });

  it("порядок пропозицій дзеркалить порядок знахідок і нічого не ранжує", () => {
    const ids = ["r1", "l1", "m1", "l2"];
    const ps = proposeFixes(
      [
        finding({ defect: "river", id: "r1" }),
        finding({ defect: "loose", id: "l1" }),
        finding({ defect: "hyphen-ladder", id: "m1" }),
        finding({ defect: "loose", id: "l2", paragraphIndex: 3 }),
      ],
      [plain(), plain({ paragraphIndex: 3 })],
    );
    expect(ps.map((p) => p.findingId)).toEqual(ids);
  });
});

describe("proposeFixes — інструкції без запису", () => {
  it("коридор і драбина — лише інструкція, без запису", () => {
    const ps = proposeFixes(
      [
        finding({ defect: "river", id: "f2" }),
        finding({ defect: "hyphen-ladder", id: "f3" }),
      ],
      [plain()],
    );
    expect(ps.map((p) => p.kind)).toEqual(["manual", "manual"]);
    expect(ps.every((p) => p.edit === undefined && p.tracking === undefined)).toBe(true);
    expect(ps.every((p) => p.blocked === undefined)).toBe(true);
  });

  it("сирота — інструкція: трекінг ЦЬОГО абзацу її не зрушить", () => {
    const p = only(
      proposeFixes(
        [finding({ defect: "orphan", measured: 0.25, strength: 0.25 })],
        [plain({ isLastInFrame: true })],
      ),
    );
    expect(p.kind).toBe("manual");
    expect(p.tracking).toBeUndefined();
    expect(p.description).toMatch(/шов фрейму|Keep Options/);
  });

  it("опис пропозиції не порожній — оператор має розуміти, що йому пропонують", () => {
    for (const defect of Object.keys(FIX_KIND) as DefectClass[]) {
      const p = only(proposeFixes([finding({ defect })], [plain()]));
      expect(p.description.length, defect).toBeGreaterThan(10);
    }
  });

  it("порожній вхід дає порожній вихід, а не виняток", () => {
    expect(proposeFixes([], [])).toEqual([]);
  });
});

describe("proposeFixes — нерозривний пробіл перед тире на початку рядка", () => {
  const EM = "—";
  const SPACE = String.fromCharCode(0x0020);
  const NBSP = String.fromCharCode(0x00a0);

  /** Абзац із двох рядків: «і Київ » + «— столиця\r». */
  function paragraphLines() {
    return [
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
        endsParagraph: true,
      }),
    ];
  }

  const TEXT = `і Київ ${EM} столиця\r`;
  /*
   * Повний `ContainerSnapshot`, а не `{ containerId, text }`. Скорочена
   * форма стояла тут від написання цього блоку й типізації не проходила —
   * бракувало `pageRuns`, `oversetFrom`, `isMaster`, `kind`. Побачити це було
   * нічим: `tsconfig.json` включав лише `src/**`, а vitest компілює без
   * перевірки типів (борг закрито 2026-08-05). На поведінку не впливало —
   * `proposeFixes` для цього класу читає лише `text`, — але фікстура
   * стверджувала, що знає тип, якого не мала.
   */
  const snapshot: ContainerSnapshot[] = [
    {
      containerId: "story:0",
      text: TEXT,
      pageRuns: [{ start: 0, end: TEXT.length, page: "12" }],
      oversetFrom: null,
      isMaster: false,
      kind: "text",
    },
  ];

  const f = () =>
    finding({
      defect: "line-start-dash",
      containerId: "story:0",
      paragraphIndex: 0,
      lineInParagraph: 1,
      measured: 1,
      strength: 1,
    });

  it("адресує РІВНО пробіл перед тире й замінює його на нерозривний", () => {
    const p = only(proposeFixes([f()], paragraphLines(), { containers: snapshot }));
    expect(p.kind).toBe("invisible");
    expect(p.blocked).toBeUndefined();
    expect(p.edit).toBeDefined();
    const e = p.edit!;
    expect(TEXT[e.start]).toBe(SPACE);
    expect(TEXT[e.start + 1]).toBe(EM);
    expect(e.end).toBe(e.start + 1);
    expect(e.expectedOld).toBe(SPACE);
    expect(e.newText).toBe(NBSP);
    expect(e.action).toBe("replace");
    expect(e.requestId).toBe(p.findingId);
  });

  /*
   * ПОДВІЙНИЙ ПРОБІЛ (борг гілки `line-start-dash`, закрито 2026-08-05).
   *
   * Заміна ДРУГОГО пробілу на нерозривний дала б «пробіл + NBSP + тире»:
   * розрив ляже на перший пробіл, тире знову опиниться на початку рядка, а
   * повторний аудит побачить NBSP і скаже «чисто». Тобто правка не лагодить
   * рядок, зате робить його невидимим для наступної перевірки — гірше, ніж не
   * правити зовсім. Причина тут не в тире, а в подвійному пробілі, і прибирає
   * її `collapse-spaces` у typography_apply.
   */
  it("подвійний пробіл перед тире блокує правку й називає справжню причину", () => {
    const doubleText = `і Київ  ${EM} столиця\r`;
    const doubleSnapshot: ContainerSnapshot[] = [containerSnapshot(doubleText)];
    /* Той самий рядок, але з двома пробілами перед тире в попередньому. */
    const lines = [
      line({
        spaceWidth: 3.2,
        isLast: false,
        /* Порожнє «слово» в кінці дає ДРУГИЙ пробіл: конструктор ставить
         * роздільник між елементами списку, тож ["і","Київ",""] закінчується
         * пробілом, а trailingSpace додає ще один. */
        wordList: ["і", "Київ", ""],
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
        endsParagraph: true,
      }),
    ];

    const p = only(proposeFixes([f()], lines, { containers: doubleSnapshot }));
    expect(p.edit).toBeUndefined();
    expect(p.blocked).toMatch(/TWO consecutive spaces/);
    expect(p.blocked).toMatch(/collapse-spaces/);
  });

  it("правка НЕ зсуває наступних позицій — довжина збережена", () => {
    const p = only(proposeFixes([f()], paragraphLines(), { containers: snapshot }));
    expect(p.edit!.newText).toHaveLength(p.edit!.expectedOld.length);
  });

  it("опис називає і дію, і ціну", () => {
    const p = only(proposeFixes([f()], paragraphLines(), { containers: snapshot }));
    expect(p.description).toMatch(/non-breaking/i);
    expect(p.description).toMatch(/Київ/);
    expect(p.description).toMatch(/displaced|slides down|loose/);
  });

  it("без знімка контейнера правка блокується з причиною, а не мовчить", () => {
    const p = only(proposeFixes([f()], paragraphLines()));
    expect(p.edit).toBeUndefined();
    expect(p.blocked).toMatch(/snapshot/i);
  });

  it("попереднього рядка немає серед виміряних — блокується", () => {
    const p = only(
      proposeFixes([f()], [paragraphLines()[1]!], { containers: snapshot }),
    );
    expect(p.edit).toBeUndefined();
    expect(p.blocked).toBeTruthy();
  });

  it("нерозривний пробіл уже стоїть — правки немає", () => {
    const already = `і Київ${NBSP}${EM} столиця\r`;
    const lines = [
      line({
        spaceWidth: 3.2,
        isLast: false,
        wordList: ["і", `Київ${NBSP}`],
        lineInParagraph: 0,
        paragraphLineCount: 2,
      }),
      line({
        spaceWidth: 3.2,
        isLast: true,
        wordList: [EM, "столиця"],
        lineInParagraph: 1,
        paragraphLineCount: 2,
        endsParagraph: true,
      }),
    ];
    const p = only(
      proposeFixes([f()], lines, { containers: [containerSnapshot(already)] }),
    );
    expect(p.edit).toBeUndefined();
    expect(p.blocked).toMatch(/space/i);
  });

  it("слово перед тире порожнє (кінець на розділовому знаку) — опис не пише «слові «»»", () => {
    /*
     * `precedingWord("сказав «іди» ")` === "" — `wordTail` бере кінцевий
     * прогін ЛІТЕР, а там закривна лапка. Це не гіпотетичний випадок: рівно
     * той самий приклад спек §4.3.7 наводить для прозорості лапки. Без
     * нормалізації `found.value.word` (порожній рядок) минає `word ?? "?"`
     * у `describe` — `??` ловить лише `null`/`undefined` — і оператор читає
     * «лишиться при слові «»».
     */
    const withQuote = [
      line({
        spaceWidth: 3.2,
        isLast: false,
        wordList: ["сказав", "«іди»"],
        trailingSpace: 3.2,
        lineInParagraph: 0,
        paragraphLineCount: 2,
      }),
      line({
        spaceWidth: 3.2,
        isLast: true,
        wordList: [EM, "і"],
        lineInParagraph: 1,
        paragraphLineCount: 2,
        endsParagraph: true,
      }),
    ];
    const text = `сказав «іди» ${EM} і\r`;
    const p = only(
      proposeFixes([f()], withQuote, { containers: [containerSnapshot(text)] }),
    );
    expect(p.edit).toBeDefined();
    expect(p.description).not.toContain("«»");
    expect(p.description).toMatch(/the previous line/);
  });
});

describe("proposeFixes — тире: адреса при d > 0 і невкриті гілки locateDashSpace", () => {
  /*
   * Спек §7 вимагає тесту на конвенцію композитора з формулюванням «знахідка
   * є, і ЗСУВ ПРАВКИ вказує на цей пробіл». `detect-dashes.test.ts` (рядки
   * 160–174) уже покриває першу половину — предикат дає `dashInLine: 1` —
   * але зсув САМОЇ ПРАВКИ (`edit.start`) для `d > 0` там не перевіряється
   * взагалі. На живому InDesign ця гілка не спрацьовує ніколи (композитор
   * лишає пробіл у ПОПЕРЕДНЬОМУ рядку — `types.ts`), тож зламати арифметику
   * `locateDashSpace` для `d > 0` можна, не зламавши жодного іншого тесту.
   */
  const EM = "—";
  const SPACE = String.fromCharCode(0x0020);

  /** «і Київ» (без кінцевого пробілу) + « — хтось» (тире не на позиції 0). */
  function paragraphLines() {
    return [
      line({
        spaceWidth: 3.2,
        isLast: false,
        wordList: ["і", "Київ"],
        lineInParagraph: 0,
        paragraphLineCount: 2,
      }),
      line({
        spaceWidth: 3.2,
        isLast: true,
        wordList: [` ${EM}`, "хтось"],
        lineInParagraph: 1,
        paragraphLineCount: 2,
      }),
    ];
  }

  const TEXT = `і Київ ${EM} хтось`;
  const snapshot = [containerSnapshot(TEXT)];

  const f = () =>
    finding({
      defect: "line-start-dash",
      containerId: "story:0",
      paragraphIndex: 0,
      lineInParagraph: 1,
      measured: 1,
      strength: 1,
    });

  it("d > 0: зсув правки вказує на пробіл ПЕРЕД тире у ВЛАСНОМУ рядку знахідки", () => {
    /*
     * `dashOffsetInLine(" — хтось")` = 1 — тире не на позиції 0, перед ним
     * лежить пробіл, що належить рядку знахідки, а не попередньому. Адреса
     * має вказати САМЕ на цей пробіл (позиція 6 у TEXT — межа «Київ» і
     * « — хтось»), а не на кінцевий пробіл попереднього рядка.
     */
    const p = only(proposeFixes([f()], paragraphLines(), { containers: snapshot }));
    expect(p.edit).toBeDefined();
    const e = p.edit!;
    expect(TEXT[e.start]).toBe(SPACE);
    expect(TEXT[e.start + 1]).toBe(EM);
    expect(e.start).toBe("і Київ".length);
  });

  it("рядок не серед виміряних — locateDashSpace не адресує вигадку", () => {
    const p = only(
      proposeFixes([f()], [paragraphLines()[0]!], { containers: snapshot }),
    );
    expect(p.edit).toBeUndefined();
    expect(p.blocked).toMatch(/not found among the measured/i);
  });

  it("рядок непридатний до виміру — правки немає", () => {
    const [prev, dash] = paragraphLines();
    const rotated = { ...dash!, rotated: true, rotationAngle: -90 };
    const p = only(proposeFixes([f()], [prev!, rotated], { containers: snapshot }));
    expect(p.edit).toBeUndefined();
    expect(p.blocked).toMatch(/not measurable/i);
  });

  it("рядок більше не починається з тире — вимір розійшовся зі знахідкою", () => {
    /* Знахідка вказує на lineInParagraph 1, але свіжий вимір цього рядка
     * тире більше не несе — Задача 14 звіряє за свіжим виміром, не за
     * `lineText` знахідки. */
    const [prev] = paragraphLines();
    const notDash = line({
      spaceWidth: 3.2,
      isLast: true,
      wordList: ["не", "тире"],
      lineInParagraph: 1,
      paragraphLineCount: 2,
    });
    const p = only(proposeFixes([f()], [prev!, notDash], { containers: snapshot }));
    expect(p.edit).toBeUndefined();
    expect(p.blocked).toMatch(/no longer starts with a dash/i);
  });

  it("тире стоїть на самому початку абзацу — пробілу перед ним немає", () => {
    /* Перший рядок абзацу — порожній (offsetInParagraph === 0), а тире
     * стоїть у другому рядку рівно на позиції 0 (d === 0): start = 0 + 0 +
     * 0 − 1 = −1. */
    const emptyFirst = { ...paragraphLines()[0]!, text: "", chars: [] };
    const dashAtStart = line({
      spaceWidth: 3.2,
      isLast: true,
      wordList: [EM, "хтось"],
      lineInParagraph: 1,
      paragraphLineCount: 2,
      endsParagraph: true,
    });
    const p = only(
      proposeFixes([f()], [emptyFirst, dashAtStart], {
        containers: [containerSnapshot(dashAtStart.text)],
      }),
    );
    expect(p.edit).toBeUndefined();
    expect(p.blocked).toMatch(/very start of the paragraph/i);
  });
});

/*
 * Нульова сила (борг Фази 3, закрито 2026-08-05). Детектор знімає силу, коли
 * не може назвати величину відхилення: `airFraction` не виміряно, або пробіли
 * рядка НЕОДНОРІДНІ й медіана з сумою суперечать одна одній
 * (`detect-spacing.ts`). Дельта нуль була б пропозицією «нічого не робити»,
 * поданою як виправлення.
 */
describe("proposeFixes — сила 0 не дає пропозиції з нульовою дельтою", () => {
  it("loose із силою 0 — відмова з причиною, а не delta: 0", () => {
    const p = only(proposeFixes([finding({ defect: "loose", strength: 0 })], [plain()]));
    expect(p.tracking).toBeUndefined();
    expect(p.blocked).toMatch(/not measured|contradict/i);
  });

  it("tight із силою 0 — так само", () => {
    const p = only(
      proposeFixes([finding({ defect: "tight", measured: 0.79, strength: 0 })], [plain()]),
    );
    expect(p.tracking).toBeUndefined();
    expect(p.blocked).toMatch(/not measured|contradict/i);
  });

  /* Контроль: ненульова сила пропозицію дає — блокується саме нуль. */
  it("контроль: ненульова сила пропозицію дає", () => {
    const p = only(proposeFixes([finding({ defect: "loose", strength: 0.001 })], [plain()]));
    expect(p.tracking!.delta).toBe(7);
  });
});

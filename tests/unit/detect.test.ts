import { describe, expect, it } from "vitest";
import { calibrate } from "../../src/composition/calibrate.js";
import {
  SEVERITY_VARYING_CLASSES,
  byDocumentOrder,
  byScaleThenStrength,
  detectAll,
  groupByScale,
} from "../../src/composition/detect.js";
import { detectDashes } from "../../src/composition/detect-dashes.js";
import { detectHyphens } from "../../src/composition/detect-hyphens.js";
import { detectLines } from "../../src/composition/detect-lines.js";
import { detectRivers } from "../../src/composition/detect-rivers.js";
import { detectSpacing } from "../../src/composition/detect-spacing.js";
import { STRENGTH_SCALE, strengthScaleOf } from "../../src/composition/finding.js";
import type { DefectClass, Finding } from "../../src/composition/types.js";
import { line } from "./helpers/composition.js";

/** Калібрувальна вибірка: природна ширина «Основний текст»@10 виходить 3,2 пт. */
const base = [
  line({ spaceWidth: 3.2, isLast: true }),
  line({ spaceWidth: 3.2, isLast: true }),
  line({ spaceWidth: 3.2, isLast: true }),
];
const cal = calibrate(base);

const RANK = { mode: "rank" } as const;

/** Рядок смуги коридору. */
function riverRow(i: number) {
  return line({
    spaceWidth: 3.2,
    isLast: false,
    gapsAt: [50],
    containerId: "story:4",
    lineInParagraph: i,
    paragraphLineCount: 8,
    baseline: 100 + i * 12,
  });
}

/* Слово, розірване межею сторінок, і воно ж — зі списку винятків.
 * Без цих двох рядків інвентар ваги діставав 7 класів із 9: корпус не
 * породжував ні `hyphen-across-spread`, ні `hyphen-forbidden`, тож для них
 * перевірка була порожньою (знайдено рецензією). Названа константа, а не
 * інлайн у корпусі: тест на незалежність від порядку нижче переставляє цю
 * пару відносно `dashPairLines` за посиланням, а не за індексом. */
const hyphenAcrossPageLines = [
  line({
    spaceWidth: 3.2,
    isLast: false,
    wordList: ["текст", "Шевчен"],
    containerId: "story:5",
    page: "16",
    lineInParagraph: 0,
    paragraphLineCount: 3,
    endsWithHyphen: true,
    isLastInFrame: true,
  }),
  line({
    spaceWidth: 3.2,
    isLast: false,
    wordList: ["ко", "далі"],
    containerId: "story:5",
    page: "17",
    lineInParagraph: 1,
    paragraphLineCount: 3,
  }),
];

/*
 * Тире, відірване від слова: без цієї пари інвентар діставав 9 класів із 10.
 *
 * ВЛАСНИЙ `paragraphIndex: 1` — НЕ косметика (рецензія Задачі 2, Important 1).
 * Той самий `containerId: "story:5"` уже займає `hyphenAcrossPageLines` за
 * замовчуваним `paragraphIndex: 0` (`line()` ставить 0, коли поле не задане —
 * `tests/unit/helpers/composition.ts:244`). Без власного індексу обидві пари
 * ділили б РІВНО ту саму адресу (containerId, paragraphIndex, lineInParagraph)
 * для двох РІЗНИХ абзаців, і `byParagraph` у `detect-dashes.ts` тихо
 * перезаписувала б запис однієї пари записом іншої — правильний `prev`
 * тримався б лише на тому, в якому порядку пари лежать у МАСИВІ, а не на
 * адресі. Тест «результат не залежить від порядку» нижче ловить повернення
 * цієї колізії.
 */
const dashPairLines = [
  line({
    spaceWidth: 3.2,
    isLast: false,
    containerId: "story:5",
    paragraphIndex: 1,
    wordList: ["і", "Київ"],
    trailingSpace: 3.2,
    lineInParagraph: 0,
    paragraphLineCount: 2,
  }),
  line({
    spaceWidth: 3.2,
    isLast: true,
    containerId: "story:5",
    paragraphIndex: 1,
    wordList: ["—", "столиця"],
    lineInParagraph: 1,
    paragraphLineCount: 2,
  }),
];

/**
 * Корпус, який зачіпає всі п'ять детекторів. Контейнери різні навмисно: інакше
 * драбина й коридор злилися б із рештою рядків у одну смугу.
 */
const corpus = [
  ...base,
  /* щільність: 4,5 / 3,2 = 1,406 — за верхньою межею 133% */
  line({ spaceWidth: 4.5, isLast: false, containerId: "story:1" }),
  line({ spaceWidth: 2.0, isLast: false, containerId: "story:1", paragraphIndex: 1 }),
  /* 4,0 / 3,2 = 1,25 — у межах 133%, але в попереджувальній смузі 20 в. п. */
  line({ spaceWidth: 4.0, isLast: false, containerId: "story:1", paragraphIndex: 2 }),
  /* вісяк і короткий кінцевий: останній рядок абзацу став першим у фреймі */
  line({
    spaceWidth: 3.2,
    isLast: true,
    containerId: "story:2",
    isFirstInFrame: true,
    lineInParagraph: 2,
    paragraphLineCount: 3,
  }),
  /* сирота: перший рядок абзацу — останній у фреймі */
  line({
    spaceWidth: 3.2,
    isLast: false,
    containerId: "story:2",
    paragraphIndex: 1,
    isLastInFrame: true,
    lineInParagraph: 0,
    paragraphLineCount: 4,
  }),
  /* драбина: три переноси поспіль при замовчуванні 2 */
  line({ spaceWidth: 3.2, isLast: false, containerId: "story:3", lineInParagraph: 0, paragraphLineCount: 5, endsWithHyphen: true }),
  line({ spaceWidth: 3.2, isLast: false, containerId: "story:3", lineInParagraph: 1, paragraphLineCount: 5, endsWithHyphen: true }),
  line({ spaceWidth: 3.2, isLast: false, containerId: "story:3", lineInParagraph: 2, paragraphLineCount: 5, endsWithHyphen: true }),
  ...hyphenAcrossPageLines,
  /* коридор: чотири рядки під замовчування minRows */
  riverRow(0),
  riverRow(1),
  riverRow(2),
  riverRow(3),
  ...dashPairLines,
];

/** Список винятків, який робить досяжним клас `hyphen-forbidden`. */
const FORBIDDEN = { forbidden: ["Шевченко"] };

describe("detectAll — збірка", () => {
  it("без opts.spacing кидає виняток, а не мовчки пропускає детектор", () => {
    expect(() => detectAll(corpus, cal)).toThrow(/spacing/);
  });

  it("віддає знахідки всіх п'яти детекторів", () => {
    const classes = new Set(detectAll(corpus, cal, { spacing: RANK }).map((f) => f.defect));
    expect(classes.has("loose")).toBe(true);
    expect(classes.has("widow")).toBe(true);
    expect(classes.has("orphan")).toBe(true);
    expect(classes.has("hyphen-ladder")).toBe(true);
    expect(classes.has("river")).toBe(true);
    expect(classes.has("line-start-dash")).toBe(true);
  });

  it("нічого не губить і нічого не додає проти окремих прогонів", () => {
    const all = detectAll(corpus, cal, { spacing: RANK });
    const apart = [
      ...detectSpacing(corpus, cal, RANK),
      ...detectLines(corpus),
      ...detectHyphens(corpus),
      ...detectRivers(corpus),
      ...detectDashes(corpus),
    ];
    expect(all).toHaveLength(apart.length);
    expect(new Set(all.map((f) => f.id))).toEqual(new Set(apart.map((f) => f.id)));
  });

  it("опції доходять до кожного детектора", () => {
    const noLadder = detectAll(corpus, cal, { spacing: RANK, hyphens: { maxLadder: 9 } });
    expect(noLadder.some((f) => f.defect === "hyphen-ladder")).toBe(false);
    const noRiver = detectAll(corpus, cal, { spacing: RANK, rivers: { minRows: 9 } });
    expect(noRiver.some((f) => f.defect === "river")).toBe(false);
    const noShort = detectAll(corpus, cal, { spacing: RANK, lines: { shortLastLineFraction: 0 } });
    expect(noShort.some((f) => f.defect === "short-last-line")).toBe(false);
  });

  it("результат не залежить від порядку рядків, коли дві пари ділять containerId", () => {
    /* Регресія рецензії Задачі 2 (Important 1): `dashPairLines` і
     * `hyphenAcrossPageLines` ділять `containerId: "story:5"`. Якщо колись
     * `dashPairLines` знову втратить свій `paragraphIndex`, обидві пари
     * діставатимуть ОДНАКОВУ адресу для двох РІЗНИХ абзаців, і `byParagraph`
     * у `detect-dashes.ts` мовчки перезапише одну пару іншою — правильний
     * результат тримався б лише на тому, в якому порядку пари лежать у
     * масиві. Переставляємо `dashPairLines` ПЕРЕД `hyphenAcrossPageLines`
     * (рівно те розташування, яке рецензія назвала таким, що ламає тест
     * «інвентар накриває ВЕСЬ словник») і звіряємо набір id — він не має
     * змінитися, якщо адреси справді власні. */
    const withoutDash = corpus.filter((l) => !dashPairLines.includes(l));
    const hyphenStart = withoutDash.indexOf(hyphenAcrossPageLines[0]!);
    const reordered = [
      ...withoutDash.slice(0, hyphenStart),
      ...dashPairLines,
      ...withoutDash.slice(hyphenStart),
    ];
    const idsOf = (fs: Finding[]) => new Set(fs.map((f) => f.id));
    expect(idsOf(detectAll(reordered, cal, { spacing: RANK }))).toEqual(
      idsOf(detectAll(corpus, cal, { spacing: RANK })),
    );
  });
});

describe("detectAll — порядок", () => {
  const all = detectAll(corpus, cal, { spacing: RANK });

  it("шкали йдуть суцільними блоками, за іменем", () => {
    const scales = all.map((f) => strengthScaleOf(f.defect));
    const firstSeen = [...new Set(scales)];
    expect(firstSeen).toEqual([...firstSeen].sort());
    /* Суцільність: жодна шкала не з'являється двічі окремими блоками. */
    expect(new Set(scales).size).toBe(firstSeen.length);
    for (let i = 1; i < scales.length; i++) {
      if (scales[i] !== scales[i - 1]) {
        expect(scales.slice(0, i).includes(scales[i]!)).toBe(false);
      }
    }
  });

  it("усередині шкали — за спаданням сили", () => {
    for (const group of groupByScale(all).values()) {
      for (let i = 1; i < group.length; i++) {
        expect(group[i - 1]!.strength).toBeGreaterThanOrEqual(group[i]!.strength);
      }
    }
  });

  it("порядок відтворюваний між прогонами", () => {
    expect(detectAll(corpus, cal, { spacing: RANK }).map((f) => f.id)).toEqual(all.map((f) => f.id));
  });

  it("групування за шкалою тримає пари класів, які детектори оголосили порівнянними", () => {
    const g = groupByScale(all);
    expect(STRENGTH_SCALE.tight).toBe(STRENGTH_SCALE.loose);
    expect(STRENGTH_SCALE.widow).toBe(STRENGTH_SCALE["short-last-line"]);
    expect(STRENGTH_SCALE["hyphen-across-spread"]).toBe(STRENGTH_SCALE["hyphen-forbidden"]);
    /* …і водночас розводить ті, які порівнянними не оголошував ніхто. */
    expect(STRENGTH_SCALE.orphan).not.toBe(STRENGTH_SCALE.widow);
    expect(STRENGTH_SCALE["hyphen-ladder"]).not.toBe(STRENGTH_SCALE.river);
    expect(g.get("emptiness")!.every((f) => f.defect === "widow" || f.defect === "short-last-line")).toBe(true);
  });

  it("byDocumentOrder — окремий компаратор, не замовчування", () => {
    const doc = [...all].sort(byDocumentOrder);
    for (let i = 1; i < doc.length; i++) {
      expect(byDocumentOrder(doc[i - 1]!, doc[i]!)).toBeLessThanOrEqual(0);
    }
    /* Номери сторінок — рядки, і порівнюються числово, а не лексикографічно. */
    const a = { ...all[0]!, page: "9" };
    const b = { ...all[0]!, page: "10" };
    expect(byDocumentOrder(a, b)).toBeLessThan(0);
  });

  it("byScaleThenStrength не залежить від порядку входу", () => {
    const shuffled = [...all].reverse().sort(byScaleThenStrength);
    expect(shuffled.map((f) => f.id)).toEqual(all.map((f) => f.id));
  });
});

describe("Severity — інвентар після п'яти детекторів", () => {
  /**
   * Твердження, заради якого існує `SEVERITY_VARYING_CLASSES`: вага змінна рівно
   * у двох класів із десяти. Доти воно жило прозою в трьох файлах.
   */
  const probes: Finding[] = [
    ...detectSpacing(corpus, cal, RANK),
    ...detectSpacing(corpus, cal, { mode: "style-bounds", warnBandPct: 20 }),
    ...detectLines(corpus),
    ...detectHyphens(corpus, FORBIDDEN),
    ...detectRivers(corpus),
    ...detectDashes(corpus),
  ];

  it("інвентар накриває ВЕСЬ словник — інакше він не сильніший за прозу", () => {
    /* Перевірка «поза списком завжди error» порожня для класу, якого корпус не
     * породжує. Доти корпус давав 7 із 9, і саме два переносні класи випадали. */
    const seen = new Set(probes.map((f) => f.defect));
    for (const defect of Object.keys(STRENGTH_SCALE) as DefectClass[]) {
      expect(seen.has(defect)).toBe(true);
    }
  });

  it("поза двома класами вага завжди error", () => {
    for (const f of probes) {
      if (!SEVERITY_VARYING_CLASSES.has(f.defect)) expect(f.severity).toBe("error");
    }
  });

  it("у КОЖНОМУ класі зі списку вона справді змінна — інакше він там зайвий", () => {
    /* Перевірка ПОКЛАСОВА навмисно: спільна множина ваг по всьому списку
     * пропустила б клас, доданий туди помилково, — його константний `error`
     * просто розчинився б у чужій варіативності. */
    const byClass = new Map<DefectClass, Set<string>>();
    for (const f of probes) {
      const seen = byClass.get(f.defect) ?? new Set<string>();
      seen.add(f.severity);
      byClass.set(f.defect, seen);
    }
    expect(byClass.size).toBeGreaterThan(SEVERITY_VARYING_CLASSES.size);
    for (const defect of SEVERITY_VARYING_CLASSES) {
      expect(byClass.get(defect)?.size ?? 0).toBeGreaterThan(1);
    }
  });

  it("кожен клас словника має шкалу сили", () => {
    for (const defect of Object.keys(STRENGTH_SCALE) as DefectClass[]) {
      expect(typeof strengthScaleOf(defect)).toBe("string");
    }
    expect(Object.keys(STRENGTH_SCALE)).toHaveLength(10);
  });

  it("новий бінарний клас НЕ у списку змінної ваги", () => {
    expect(SEVERITY_VARYING_CLASSES.has("line-start-dash")).toBe(false);
  });
});

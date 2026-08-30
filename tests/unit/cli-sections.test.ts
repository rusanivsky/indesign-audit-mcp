import { describe, expect, it } from "vitest";
import {
  deriveSections,
  describeParams as describeParamsBi,
  hasCritical,
  tallyFindings,
} from "../../src/cli/report/sections.js";
/*
 * Звіт тепер двомовний, і `describeParams` віддає пари. Твердження нижче —
 * про українську половину: саме її бачить друкарня, і саме про неї вони
 * писались. Англійська половина перевіряється окремим тестом у кінці файла.
 */
function describeParams(p: PassResult): string[] {
  return describeParamsBi(p).map((b) => b.uk);
}
import type {
  CompositionAuditResponse,
  DocOverviewResponse,
  LayoutAuditResponse,
  StylesAuditResponse,
  TypographyAuditResponse,
} from "../../src/cli/report/sections.js";
import type { Measurements, PassResult } from "../../src/cli/run/execute.js";
import type { ExtrasMeasure } from "../../src/cli/measure/extras.js";
import type { BibliographyReport } from "../../src/bibliography/report.js";
import type { ColorFinding } from "../../src/color/types.js";
import type { ColorReport } from "../../src/color/report.js";
import type { GeometryReport } from "../../src/geometry/report.js";
import type { PaginationReport } from "../../src/pagination/report.js";
import type { PreflightReport } from "../../src/preflight/types.js";
import type { SpellingReport } from "../../src/spelling/types.js";
import type { StatusShape } from "../../src/cli/run/session.js";

/*
 * ФІКСТУРИ ТИПІЗОВАНІ СПРАВЖНІМИ ІНТЕРФЕЙСАМИ КОЖНОГО ІНСТРУМЕНТА (рецензія
 * задачі 11, рішення R16-в). Це СТРУКТУРНА гарантія, не дисципліна: вигадана
 * назва поля тут НЕ СКОМПІЛЮЄТЬСЯ, бо кожен `data: SomeReport = {...}` нижче
 * перевіряється компілятором проти РЕАЛЬНОГО типу з `src/<домен>/`, а не
 * проти вільного об'єкта, кинутого в `Measurements` без перевірки.
 */

const відбиток = {
  indesignVersion: "20.0", docName: "к.indd", docPath: "/т/к.indd",
  modified: true, wasAlreadyOpen: true, openDocumentCount: 1,
  dictionaryPath: "/словник", locale: "uk", sessionUptimeMs: 900_000,
};

/*
 * R28 додав до `PassResult` два поля — `args` і `defaulted`. Фікстурам,
 * що перевіряють адаптери знахідок, вони байдужі, тож `виміри` підставляє
 * порожні; тести самих параметрів (внизу файлу) називають їх ЯВНО.
 */
type ЧастковийПрохід = Omit<PassResult, "args" | "defaulted"> &
  Partial<Pick<PassResult, "args" | "defaulted">>;

function виміри(
  часткові: Omit<Partial<Measurements>, "passes"> & { passes?: ЧастковийПрохід[] },
): Measurements {
  return {
    schemaVersion: 3, startedAt: "2026-08-16T10:00:00Z",
    stamp: відбиток, skipped: [], ...часткові,
    passes: (часткові.passes ?? []).map((p) => ({ args: {}, defaulted: [], ...p })),
  } as Measurements;
}

/** Мінімальний ПОВНИЙ `ColorReport` — усі поля справжнього типу присутні. */
function базовийColorReport(): ColorReport {
  return {
    docName: "к.indd",
    caveat: "",
    parameters: {},
    findingCount: 0,
    occurrenceCount: 0,
    findings: [],
    counters: [],
    unreadSurfaces: [],
    unmeasurableLinks: [],
    layers: [],
    inkCount: 0,
    inkNames: [],
    tacSurvey: null,
    paletteSurvey: null,
    elapsedMs: 0,
  };
}

const справжняColorЗнахідка: ColorFinding = {
  family: "tac",
  rule: "tac-max-exceeded",
  color: "C100 M100 Y100 K100",
  totalInk: 400,
  count: 1,
  surfaces: ["pageItem"],
  pages: ["12"],
  pagesTotal: 1,
  examples: ["Прямокутник на с.12"],
};

/** Мінімальний ПОВНИЙ `PreflightReport`. */
function базовийPreflightReport(): PreflightReport {
  return {
    docName: "к.indd",
    profileName: "[Basic]",
    workingProfile: "[Basic]",
    preflightOff: false,
    scope: "PREFLIGHT_ALL_PAGES",
    availableProfiles: ["[Basic]"],
    rulesEnabled: 6,
    rulesDisabled: 32,
    enabledRuleIds: ["ADBE_OversetText"],
    disabledRuleIds: [],
    findings: [],
    occurrenceCount: 0,
    occurrencesTruncated: null,
    shapeRecognised: true,
    rowsSeen: 0,
    rowsParsed: 0,
    pairsSeen: 0,
    pairsParsed: 0,
    processRemoved: true,
    waitTimedOut: false,
    waitPolarity: null,
    caveat: "",
  };
}

/**
 * Мінімальний ПОВНИЙ `GeometryReport` — здоровий прилад, нуль знахідок,
 * вимір ПІДТВЕРДЖЕНИЙ (`notMeasured`/`caveats` порожні, `truncated` — null).
 * Саме такий нуль і має право читатися як «чисто», і саме він служить
 * контролем для I1: фікс, від якого червоніє й цей прогін, — не фікс.
 */
function базовийGeometryReport(): GeometryReport {
  return {
    docName: "к.indd",
    measuredWith: {
      traversal: "allPageItems",
      units: "pt",
      coordinateOrigin: { rulerOrigin: "PAGE_ORIGIN", zeroPoint: [0, 0] },
      itemsSeen: 10,
      pagesSeen: 5,
      ms: 100,
    },
    findings: [],
    truncated: null,
    inventory: { anchored: [], graphics: [], wrap: [], graphicsTruncated: null, anchoredTruncated: null },
    survey: null,
    notMeasured: [],
    caveats: [],
  };
}

/** Мінімальний ПОВНИЙ `PaginationReport`. */
function базовийPaginationReport(): PaginationReport {
  return {
    docName: "к.indd",
    folio: null,
    contents: null,
    runningHead: null,
    detail: null,
    detailTruncated: null,
    missingStyles: [],
    masterSkipped: [], masterIslands: [],
  };
}

/** Мінімальний ПОВНИЙ `SpellingReport`. */
function базовийSpellingReport(): SpellingReport {
  return {
    deviating: 0,
    language: [],
    words: [],
    wordsAll: [],
    wordsNotCheckedAll: [],
    wordTypesTotal: 0,
    truncated: null,
  };
}

/**
 * Мінімальний ПОВНИЙ `TypographyAuditResponse` — зі ЗДОРОВИМ приладом.
 *
 * C1: мовний гейт `spelling2019`/`piv2019` — це прилад, а не документ
 * (`src/tools/typography.ts:236-240`: «на локалізованій збірці InDesign
 * назва мови не збіжиться, і вся половина правопису 2019 мовчки віддасть
 * порожньо»). Фікстура мусить його НАЗВАТИ — саме тиша про прилад і
 * пропустила C1 повз усі попередні тести цього файлу.
 */
function базоваTypography(): TypographyAuditResponse {
  return {
    groups: [],
    totalMatches: 0,
    auditOnly: [],
    spelling2019: { ukrainianRuns: 1200, skippedByLanguage: 0 },
    piv2019: { ukrainianRuns: 1200, skippedByLanguage: 0 },
  };
}

/** Мінімальний ПОВНИЙ `BibliographyReport`. */
function базовийBibliographyReport(): BibliographyReport {
  return {
    records: 0,
    unparsed: 0,
    skipped: [],
    uniformity: [],
    groups: [],
    warnings: [],
    nextStep: "",
  };
}

describe("deriveSections — «чисто»", () => {
  it("нуль знахідок іде в «чисто» З ЧИСЛОМ, яке міряли (pagination_audit, справжня форма PaginationReport)", () => {
    const data: PaginationReport = {
      ...базовийPaginationReport(),
      folio: { checked: 131, deviating: 0, notCompared: 0, groups: [] },
    };
    const s = deriveSections(виміри({
      passes: [{ id: "pagination", tool: "pagination_audit", ok: true, elapsedMs: 10, data, error: null }],
    }));
    expect(s.clean).toHaveLength(1);
    expect(s.clean[0]!.measured.uk).toMatch(/131/);
  });

  it("styles_audit: нуль знахідок несе число проаудитованих абзаців", () => {
    const data: StylesAuditResponse = {
      findings: [],
      totals: { paragraphs: 2980, overridePropertyDeviations: 0, scaleParagraphs: 0, characterRangesDeviating: 0 },
    };
    const s = deriveSections(виміри({
      passes: [{ id: "styles", tool: "styles_audit", ok: true, elapsedMs: 1, data, error: null }],
    }));
    expect(s.clean).toHaveLength(1);
    expect(s.clean[0]!.measured.uk).toMatch(/2980/);
  });

  it("styles_audit: непорожні totals.overridePropertyDeviations НЕ дають «чисто» (раніше `data.findings` цього не бачив узагалі)", () => {
    const data: StylesAuditResponse = {
      findings: [],
      totals: { paragraphs: 2980, overridePropertyDeviations: 744, scaleParagraphs: 0, characterRangesDeviating: 0 },
    };
    const s = deriveSections(виміри({
      passes: [{ id: "styles", tool: "styles_audit", ok: true, elapsedMs: 1, data, error: null }],
    }));
    expect(s.clean).toHaveLength(0);
  });

  it("bibliography_audit: нуль записів у групах — «чисто» з числом бібліозаписів", () => {
    const data: BibliographyReport = { ...базовийBibliographyReport(), records: 42 };
    const s = deriveSections(виміри({
      passes: [{ id: "bibliography", tool: "bibliography_audit", ok: true, elapsedMs: 1, data, error: null }],
    }));
    expect(s.clean).toHaveLength(1);
    expect(s.clean[0]!.measured.uk).toMatch(/42/);
  });

  it("bibliography_audit: непорожня group.total НЕ йде в «чисто» (groups[].total — справжнє поле, не вигадане `findings`)", () => {
    const data: BibliographyReport = {
      ...базовийBibliographyReport(),
      records: 42,
      groups: [{ ruleId: "bib-zone-separator", title: "Роздільник зон", basis: "ДСТУ", total: 3, verdict: null, samples: [], needsReview: [], needsReviewTotal: 0 }],
    };
    const s = deriveSections(виміри({
      passes: [{ id: "bibliography", tool: "bibliography_audit", ok: true, elapsedMs: 1, data, error: null }],
    }));
    expect(s.clean).toHaveLength(0);
  });

  it("bibliography_audit: розриви нумерації доходять до звіту як «потребує очей»", () => {
    /*
     * §3.1 передачі. `numberingGaps` рахувався в `segment.ts`, доїжджав до
     * відповіді інструмента — і в усьому CLI згадувався ЛИШЕ в коментарі.
     * На «Book B» їх виміряно 135: число було, роботи нуль.
     * Причина була типова: аліас звужував відповідь до `BibliographyReport`,
     * де такого поля немає, тож компілятор про втрату мовчав.
     */
    const data = {
      ...базовийBibliographyReport(),
      records: 42,
      numberingGaps: [
        { after: 12, next: 14 },
        { after: 30, next: 33 },
      ],
    };
    const s = deriveSections(виміри({
      passes: [{ id: "bibliography", tool: "bibliography_audit", ok: true, elapsedMs: 1, data, error: null }],
    }));
    const рядок = s.needsEyes.find((n) => n.topic.uk.includes("розриви в нумерації"));
    expect(рядок).toBeDefined();
    expect(рядок!.detail.uk).toMatch(/2 розривів/);
    expect(рядок!.detail.uk).toMatch(/12→14/);
    expect(рядок!.detail.uk).toMatch(/30→33/);
  });

  it("bibliography_audit: розрив нумерації НЕ скасовує «чисто» — це кандидат, не вирок", () => {
    /*
     * Перенумерація буває свідома, а вилучення запису — редакторське.
     * Інструмент їх не розрізняє, тому в лічильник дефектів вони не йдуть і
     * прохід із нулем знахідок ДСТУ лишається чистим. Канал «потребує очей»
     * при цьому все одно горить — той самий прецедент, що слово-типи
     * spelling_audit.
     */
    const data = {
      ...базовийBibliographyReport(),
      records: 42,
      numberingGaps: [{ after: 12, next: 14 }],
    };
    const s = deriveSections(виміри({
      passes: [{ id: "bibliography", tool: "bibliography_audit", ok: true, elapsedMs: 1, data, error: null }],
    }));
    expect(s.clean).toHaveLength(1);
    expect(s.needsEyes.some((n) => n.topic.uk.includes("розриви в нумерації"))).toBe(true);
  });

  it("bibliography_audit: без розривів рядок не з'являється взагалі", () => {
    const data = { ...базовийBibliographyReport(), records: 42, numberingGaps: [] };
    const s = deriveSections(виміри({
      passes: [{ id: "bibliography", tool: "bibliography_audit", ok: true, elapsedMs: 1, data, error: null }],
    }));
    expect(s.clean).toHaveLength(1);
    expect(s.needsEyes.some((n) => n.topic.uk.includes("розриви в нумерації"))).toBe(false);
  });

  it("pagination_audit: острови чужого майстра доходять до «потребує очей»", () => {
    /*
     * §4 передачі. Інцидент с. 188 робочої книжки: забуте переназначення
     * материнського шаблона, через яке зник колонтитул. `head-missing` цього
     * не бачить за побудовою, тож канал мусить бути окремий — і не в
     * лічильнику знахідок: титул і шмуцтитул законно мають власний майстер.
     */
    const data = {
      docName: "book.indd",
      folio: null,
      contents: null,
      runningHead: null,
      detail: null,
      detailTruncated: null,
      missingStyles: [],
      masterSkipped: [],
      masterIslands: [
        {
          page: "188",
          side: "LEFT_HAND" as const,
          master: "G-Шаблон без колонтитулів",
          neighbourMaster: "J-Розділ 3 текст колонтитули",
          runBefore: 3,
          runAfter: 2,
        },
      ],
    };
    const s = deriveSections(виміри({
      passes: [{ id: "pagination", tool: "pagination_audit", ok: true, elapsedMs: 1, data, error: null }],
    }));
    const рядок = s.needsEyes.find((n) => n.topic.uk.includes("вдягнені інакше"));
    expect(рядок).toBeDefined();
    expect(рядок!.detail.uk).toMatch(/с\. 188/);
    expect(рядок!.detail.uk).toMatch(/G-Шаблон без колонтитулів/);
    /* КАНДИДАТИ, а не знахідки — вирок лишається людині. */
    expect(рядок!.detail.uk).toMatch(/КАНДИДАТИ/);
  });

  it("pagination_audit: без островів рядок не з'являється", () => {
    const data = {
      docName: "book.indd",
      folio: null,
      contents: null,
      runningHead: null,
      detail: null,
      detailTruncated: null,
      missingStyles: [],
      masterSkipped: [],
      masterIslands: [],
    };
    const s = deriveSections(виміри({
      passes: [{ id: "pagination", tool: "pagination_audit", ok: true, elapsedMs: 1, data, error: null }],
    }));
    expect(s.needsEyes.some((n) => n.topic.uk.includes("вдягнені інакше"))).toBe(false);
  });

  it("layout_audit: нуль знахідок несе число оглянутих сторінок", () => {
    const data: LayoutAuditResponse = {
      pages: ["1", "2", "3"],
      masters: { findings: [] },
      totals: { overrideFindings: 0, masterFindings: 0, notComparedGroups: 0 },
    };
    const s = deriveSections(виміри({
      passes: [{ id: "layout", tool: "layout_audit", ok: true, elapsedMs: 1, data, error: null }],
    }));
    expect(s.clean).toHaveLength(1);
    expect(s.clean[0]!.measured.uk).toMatch(/3/);
  });

  it("color_audit: caveat інструмента доходить до «не бачили»", () => {
    /*
     * Ворожа рецензія гілки довела виконанням: цей канал можна було
     * ВИРІЗАТИ, і всі 2640 тестів лишались зеленими. Інструмент будував
     * речення (`src/color/report.ts`), а CLI не читав `d.caveat` жодного
     * разу — тобто вимкнена перевірка порога промаху виглядала в звіті
     * виконаною.
     */
    const data = {
      findingCount: 0,
      counters: [{ surface: "text", seen: 10, parsed: 10 }],
      unreadSurfaces: [],
      unmeasurableLinks: [],
      caveat: "Поріг близького промаху не названо, тож родина palette не дає вироку про промах.",
    };
    const s = deriveSections(виміри({
      passes: [{ id: "color", tool: "color_audit", ok: true, elapsedMs: 1, data, error: null }],
    }));
    const текст = s.notSeen.map((n) => n.detail.uk).join(" ");
    expect(текст).toMatch(/Поріг близького промаху не названо/);
  });

  it("composition_audit: межі виміру інструмента доходять до «не бачили»", () => {
    /*
     * Той самий клас: адаптер повертав `notSeen: []` і НЕ читав `d.warnings`
     * ніколи. Через це до звіту не доходили ні незадані forbiddenWords, ні
     * запасна ширина знака переносу, ні некалібровані стилі.
     */
    const data = {
      scope: { linesAnalysed: 100, partial: false },
      findingsTotal: 0,
      warnings: [
        "Переносів у заборонених словах НЕ перевірено: forbiddenWords не названо.",
      ],
    };
    const s = deriveSections(виміри({
      passes: [{ id: "composition", tool: "composition_audit", ok: true, elapsedMs: 1, data, error: null }],
    }));
    const текст = s.notSeen.map((n) => n.detail.uk).join(" ");
    expect(текст).toMatch(/forbiddenWords не названо/);
  });

  it("extras: невизначені об'єкти НЕ дають «чисто» — прилад про них мовчить", () => {
    /*
     * Найтонший випадок гілки. `summariseExtras` кладе рядок у `findings`, а
     * адаптер деструктурує лише `{ clean }` — тобто число було виміряне,
     * типізоване, покрите тестом і ВИКИНУТЕ на межі звіту. Рівно та вада,
     * проти якої заведено сам лічильник.
     */
    const data = {
      docName: "к.indd",
      horizontalScaleOffenders: [],
      emptyParagraphs: 0,
      forcedBreaks: { total: 0, inBodyText: 0 },
      smallestPointSize: null,
      thinnestStrokePt: null,
      pasteboardItems: [],
      unresolvedItems: 12,
      pageFormat: { width: 0, height: 0, units: "pt" },
      bleed: { top: 0, bottom: 0, inside: 0, outside: 0 },
    };
    const s = deriveSections(виміри({
      passes: [{ id: "extras", tool: "__cli_extras", ok: true, elapsedMs: 1, data, error: null }],
    }));
    expect(s.clean).toHaveLength(0);
    const текст = s.notSeen.map((n) => n.detail.uk).join(" ");
    expect(текст).toMatch(/НЕ визначено для 12/);
  });

  it("extras: нуль невизначених лишає прохід чистим", () => {
    const data = {
      docName: "к.indd",
      horizontalScaleOffenders: [],
      emptyParagraphs: 0,
      forcedBreaks: { total: 0, inBodyText: 0 },
      smallestPointSize: null,
      thinnestStrokePt: null,
      pasteboardItems: [],
      unresolvedItems: 0,
      pageFormat: { width: 0, height: 0, units: "pt" },
      bleed: { top: 0, bottom: 0, inside: 0, outside: 0 },
    };
    const s = deriveSections(виміри({
      passes: [{ id: "extras", tool: "__cli_extras", ok: true, elapsedMs: 1, data, error: null }],
    }));
    expect(s.clean).toHaveLength(1);
  });

  it("layout_audit: контейнери без сторінки НЕ дають «чисто» — вони випали з виміру", () => {
    /*
     * §2.2, і водночас перевірка того, що лічильник має СПОЖИВАЧА. Перша
     * редакція цієї правки завела `unplacedContainers`/`unplacedParagraphs`
     * у JSX і не провела їх ніде — тобто повторила рівно ту ваду, яку
     * закривала: знання є, каналу немає.
     */
    const data = {
      pages: ["1", "2"],
      masters: { findings: [] },
      totals: {
        overrideFindings: 0,
        masterFindings: 0,
        notComparedGroups: 0,
        unplacedContainers: 4,
        unplacedParagraphs: 137,
      },
    };
    const s = deriveSections(виміри({
      passes: [{ id: "layout", tool: "layout_audit", ok: true, elapsedMs: 1, data, error: null }],
    }));
    expect(s.clean).toHaveLength(0);
    const текст = s.notSeen.map((n) => n.detail.uk).join(" ");
    expect(текст).toMatch(/4 контейнерів/);
    expect(текст).toMatch(/137 абзаців/);
  });

  it("layout_audit: нуль без сторінки — рядка немає, «чисто» лишається", () => {
    const data = {
      pages: ["1"],
      masters: { findings: [] },
      totals: {
        overrideFindings: 0,
        masterFindings: 0,
        notComparedGroups: 0,
        unplacedContainers: 0,
        unplacedParagraphs: 0,
      },
    };
    const s = deriveSections(виміри({
      passes: [{ id: "layout", tool: "layout_audit", ok: true, elapsedMs: 1, data, error: null }],
    }));
    expect(s.clean).toHaveLength(1);
    expect(JSON.stringify(s)).not.toMatch(/Без сторінки/);
  });

  it("composition_audit: нуль знахідок несе число проаналізованих рядків", () => {
    const data: CompositionAuditResponse = {
      scope: { linesAnalysed: 563, partial: false },
      findingsTotal: 0,
    };
    const s = deriveSections(виміри({
      passes: [{ id: "composition", tool: "composition_audit", ok: true, elapsedMs: 1, data, error: null }],
    }));
    expect(s.clean).toHaveLength(1);
    expect(s.clean[0]!.measured.uk).toMatch(/563/);
  });

  /*
   * Рецензія задачі 11 (раунд 2): `typography_audit`, `doc_overview` і
   * `__cli_extras` не мали адаптера ВЗАГАЛІ — і зникали зі звіту цілком, ні
   * тут, ні в «не бачили», ні в «потребує очей». Контрольна таблиця §10
   * бере звідси десять чисел (quotes-uk 8, space-before-break 1 — з
   * typography; обсяг/стилі/шрифти/лінки — з doc_overview; шість чисел
   * empty/forced-breaks/kegl/stroke/pasteboard — з __cli_extras).
   */
  it("typography_audit: нуль збігів (обидві популяції — groups і auditOnly) — «чисто» з числом totalMatches", () => {
    const data: TypographyAuditResponse = { ...базоваTypography(), groups: [], totalMatches: 0, auditOnly: [] };
    const s = deriveSections(виміри({
      passes: [{ id: "typography", tool: "typography_audit", ok: true, elapsedMs: 1, data, error: null }],
    }));
    expect(s.clean).toHaveLength(1);
    expect(s.clean[0]!.measured.uk).toMatch(/0/);
  });

  it("typography_audit: totalMatches > 0 НЕ йде в «чисто» (напр. quotes-uk 8 на с.24,67)", () => {
    const data: TypographyAuditResponse = {
      ...базоваTypography(),
      groups: [{ ruleId: "quotes-uk", title: "Лапки", total: 8, samples: [], needsReview: [] }],
      totalMatches: 8,
      auditOnly: [],
    };
    const s = deriveSections(виміри({
      passes: [{ id: "typography", tool: "typography_audit", ok: true, elapsedMs: 1, data, error: null }],
    }));
    expect(s.clean).toHaveLength(0);
  });

  it("typography_audit: непорожній auditOnly (окрема популяція від groups) теж НЕ йде в «чисто»", () => {
    const data: TypographyAuditResponse = {
      ...базоваTypography(), groups: [], totalMatches: 0, auditOnly: [{ rule: "sentence-space" }],
    };
    const s = deriveSections(виміри({
      passes: [{ id: "typography", tool: "typography_audit", ok: true, elapsedMs: 1, data, error: null }],
    }));
    expect(s.clean).toHaveLength(0);
  });

  it("doc_overview: інвентар, не аудит — завжди «чисто», з реальними числами (не з вигаданого формату/вильоту)", () => {
    const data: DocOverviewResponse = {
      fullName: null,
      name: "Book 260816-1250.indd",
      pageCount: 196,
      spreadCount: 99,
      paragraphStyles: ["Основний текст L", "Основний текст"],
      characterStyles: [],
      fonts: new Array(11).fill("Шрифт [installed]"),
      links: new Array(6).fill({ name: "img.tif", status: "LinkStatus.NORMAL" }),
    };
    const s = deriveSections(виміри({
      passes: [{ id: "overview", tool: "doc_overview", ok: true, elapsedMs: 1, data, error: null }],
    }));
    expect(s.clean).toHaveLength(1);
    expect(s.clean[0]!.measured.uk).toMatch(/196/);
    expect(s.clean[0]!.measured.uk).toMatch(/11/);
    expect(s.clean[0]!.measured.uk).toMatch(/6/);
  });

  it("__cli_extras: усе чисто — summariseExtras() дає «чисто» з шістьма числами (не власний розбір)", () => {
    const data: ExtrasMeasure = {
      docName: "к.indd",
      horizontalScaleOffenders: [],
      emptyParagraphs: 398,
      forcedBreaks: { total: 401, inBodyText: 27 },
      smallestPointSize: { pt: 9.5, style: "Основний текст", page: "12" },
      thinnestStrokePt: 0.4,
      pasteboardItems: [],
    };
    const s = deriveSections(виміри({
      passes: [{ id: "extras", tool: "__cli_extras", ok: true, elapsedMs: 1, data, error: null }],
    }));
    expect(s.clean).toHaveLength(1);
    expect(s.clean[0]!.measured.uk).toMatch(/398/);
    expect(s.clean[0]!.measured.uk).toMatch(/401/);
    expect(s.clean[0]!.measured.uk).toMatch(/27/);
    expect(s.clean[0]!.measured.uk).toMatch(/9\.5/);
  });

  it("__cli_extras: об'єкти на монтажному столі — знахідка summariseExtras(), НЕ «чисто»", () => {
    const data: ExtrasMeasure = {
      docName: "к.indd",
      horizontalScaleOffenders: [],
      emptyParagraphs: 0,
      forcedBreaks: { total: 0, inBodyText: 0 },
      smallestPointSize: null,
      thinnestStrokePt: null,
      pasteboardItems: [{ layer: "Робочий шар", count: 193 }],
    };
    const s = deriveSections(виміри({
      passes: [{ id: "extras", tool: "__cli_extras", ok: true, elapsedMs: 1, data, error: null }],
    }));
    expect(s.clean).toHaveLength(0);
  });

  /*
   * Critical 1 (раунд виправлень 1, задача C): розрив у нумерації, але
   * ІНАКШЕ ЧИСТИЙ extras (масштаб/монтажний стіл/волосяне — усі нулі), до
   * цієї правки давав `count === 0` → прохід ішов у «Перевірено чисто», а
   * рядок про розрив губився: документ ІЗ дефектом друкував МЕНШЕ, ніж
   * документ без нього. Мутаційний доказ — у звіті задачі C.
   */
  it("__cli_extras: розрив у нумерації при чистому решта extras — НЕ «чисто» (Critical 1)", () => {
    const data: ExtrasMeasure = {
      docName: "к.indd",
      horizontalScaleOffenders: [],
      emptyParagraphs: 0,
      forcedBreaks: { total: 0, inBodyText: 0 },
      smallestPointSize: null,
      thinnestStrokePt: null,
      pasteboardItems: [],
      sequences: [
        {
          style: "Нумерація питань",
          found: 185,
          parsed: 185,
          restarts: 12,
          breaks: [{ prev: 6, next: 8, page: "27" }],
          unparsed: [],
        },
      ],
    };
    const s = deriveSections(виміри({
      passes: [{ id: "extras", tool: "__cli_extras", ok: true, elapsedMs: 1, data, error: null }],
    }));
    expect(s.clean).toHaveLength(0);
    expect(s.needsEyes.some((n) => n.topic.uk.includes("extras"))).toBe(true);
  });

  /*
   * Той самий факт, на іншому крайньому випадку: `found === 0` (стилю
   * немає) теж НЕ сміє бути «чисто» (Important 2), навіть коли решта
   * extras справді порожня.
   */
  it("__cli_extras: found === 0 (стилю немає) при чистому решта extras — НЕ «чисто»", () => {
    const data: ExtrasMeasure = {
      docName: "к.indd",
      horizontalScaleOffenders: [],
      emptyParagraphs: 0,
      forcedBreaks: { total: 0, inBodyText: 0 },
      smallestPointSize: null,
      thinnestStrokePt: null,
      pasteboardItems: [],
      sequences: [
        { style: "Стилі книги / Нумерація питань", found: 0, parsed: 0, restarts: 0, breaks: [], unparsed: [] },
      ],
    };
    const s = deriveSections(виміри({
      passes: [{ id: "extras", tool: "__cli_extras", ok: true, elapsedMs: 1, data, error: null }],
    }));
    expect(s.clean).toHaveLength(0);
  });
});

describe("deriveSections — «не бачили»", () => {
  it("бере вимкнені правила з самого preflight (справжня форма PreflightReport)", () => {
    const data: PreflightReport = {
      ...базовийPreflightReport(),
      disabledRuleIds: ["ADBE_ImageResolution", "ADBE_Overprint"],
    };
    const s = deriveSections(виміри({
      passes: [{ id: "preflight", tool: "preflight_document", ok: true, elapsedMs: 1, data, error: null }],
    }));
    expect(s.notSeen.map((n) => n.detail.uk).join(" ")).toMatch(/ADBE_ImageResolution/);
  });

  /*
   * РУЛІНГ R44. Спек §4.3 чекає перевірки по ВСІХ профілях, код проганяє
   * робочий. Мовчазне звуження обсягу читається як повний обсяг — та сама
   * форма відмови, що R46. Тест стереже саме НАЗИВАННЯ межі, не її зняття.
   */
  it("R44: називає звуження до одного профілю й перелічує неперевірені поіменно", () => {
    const data: PreflightReport = {
      ...базовийPreflightReport(),
      profileName: "[Basic]",
      availableProfiles: ["[Basic]", "kDigPubProfileName", "New Preflight Profile", "Basic 2"],
    };
    const s = deriveSections(виміри({
      passes: [{ id: "preflight", tool: "preflight_document", ok: true, elapsedMs: 1, data, error: null }],
    }));
    const текст = s.notSeen.map((n) => n.detail.uk).join(" ");
    expect(текст).toMatch(/ОДНИМ профілем/);
    expect(текст).toMatch(/\[Basic\]/);
    expect(текст).toMatch(/kDigPubProfileName/);
    expect(текст).toMatch(/Basic 2/);
    /* Робочий профіль у переліку НЕПЕРЕВІРЕНИХ стояти не сміє: він якраз
     * перевірений, і назвати його неперевіреним — та сама неправда, лише
     * в інший бік. */
    expect(текст).toMatch(/є ще 3:/);
  });

  it("R44: один-єдиний профіль звуженням НЕ оголошується — попередження, що горить завжди, читач проминає", () => {
    const data: PreflightReport = {
      ...базовийPreflightReport(),
      profileName: "[Basic]",
      availableProfiles: ["[Basic]"],
    };
    const s = deriveSections(виміри({
      passes: [{ id: "preflight", tool: "preflight_document", ok: true, elapsedMs: 1, data, error: null }],
    }));
    expect(s.notSeen.map((n) => n.detail.uk).join(" ")).not.toMatch(/ОДНИМ профілем/);
  });

  it("друкує причину незастосовності ДОСЛІВНО", () => {
    const s = deriveSections(виміри({ skipped: [{ family: "bibliography", reason: "нема бібліографії" }] }));
    expect(s.notSeen.map((n) => n.detail.uk).join(" ")).toMatch(/нема бібліографії/);
  });

  /*
   * F2 (рулінг R29): дірка, крізь яку 35 чисел змісту зникали зі звіту
   * БЕЗСЛІДНО. Родину `pagination` виміряно (folio, runningHead), але одну
   * її ПІДРОДИНУ — `contents` — свідомо не оголошено, і до цієї правки про
   * це не було де прочитати: у «чисто» вона не потрапляла (прохід не
   * порожній), у «не бачили» теж (там жили лише РОДИНИ цілком). Рівно те,
   * що §5.1 забороняє: «тихого нуля не існує за побудовою».
   */
  it("причина, оголошена на ПІДРОДИНІ, теж потрапляє в «не бачили» — і теж дослівно", () => {
    const s = deriveSections(
      виміри({
        skipped: [
          {
            family: "pagination",
            subfamily: "contents",
            reason: "35 чисел змісту — інстанси текстової змінної",
          },
        ],
      }),
    );
    const рядок = s.notSeen.find((n) => n.detail.uk.includes("35 чисел змісту"));
    expect(рядок, "причина підродини мусить бути в notSeen").toBeDefined();
    // Джерело називає ОБИДВА рівні: без підродини читач шукав би причину,
    // яка суперечить сусідньому рядку «pagination: перевірено чисто».
    expect(рядок!.source.uk).toBe("родина «pagination», підродина «contents»");
    expect(рядок!.detail.uk).toBe(
      "Оголошено незастосовною: 35 чисел змісту — інстанси текстової змінної",
    );
  });

  it("родинний запис БЕЗ підродини лишається таким самим, як був", () => {
    // Інакше правка F2 мовчки переписала б формулювання всіх наявних
    // рядків «не бачили» — а їх читає друкарня.
    const s = deriveSections(виміри({ skipped: [{ family: "spelling", reason: "словника немає" }] }));
    const рядок = s.notSeen.find((n) => n.detail.uk.includes("словника немає"));
    expect(рядок!.source.uk).toBe("родина «spelling»");
  });

  it("прохід, що ВПАВ, іде в «не бачили», а не мовчить", () => {
    const s = deriveSections(виміри({
      passes: [{ id: "color", tool: "color_audit", ok: false, elapsedMs: 1, data: null, error: "міст упав" }],
    }));
    expect(s.notSeen.map((n) => n.detail.uk).join(" ")).toMatch(/міст упав/);
  });

  it("завжди називає чотири межі, яких скрипт не долає (масив несе п'ять пунктів — «завжди», «смислов», «візуальн» перевірено окремо)", () => {
    const s = deriveSections(виміри({}));
    const текст = s.notSeen.map((n) => n.detail.uk).join(" ");
    expect(текст).toMatch(/смислов/i);
    expect(текст).toMatch(/візуальн/i);
  });
});

describe("deriveSections — «потребує очей»", () => {
  it("невідомі слова йдуть СПИСКОМ, а не знахідками (справжнє поле wordTypesTotal, не вигадане unknownWordTypes)", () => {
    const data: SpellingReport = { ...базовийSpellingReport(), wordTypesTotal: 497 };
    const s = deriveSections(виміри({
      passes: [{ id: "spelling", tool: "spelling_audit", ok: true, elapsedMs: 1, data, error: null }],
    }));
    expect(s.needsEyes.map((n) => n.detail.uk).join(" ")).toMatch(/497/);
  });
});

describe("deriveSections — R18: прохід без адаптера НЕ сміє зникати", () => {
  /*
   * Обов'язковий доказ рецензії (раунд 2): попередня редакція просто
   * пропускала прохід, для якого адаптера немає (`if (адаптер !== undefined)
   * {...}`, без `else`) — і саме тому typography_audit/doc_overview/
   * __cli_extras зникали зі звіту ЦІЛКОМ. Цей тест ловить майбутню таку ж
   * діру для БУДЬ-ЯКОГО інструмента, не лише для цих трьох.
   */
  it("прохід із невідомим tool потрапляє в notSeen, а не зникає з усіх трьох секцій", () => {
    const s = deriveSections(виміри({
      passes: [{ id: "typography", tool: "якийсь_майбутній_інструмент", ok: true, elapsedMs: 1, data: { щось: 1 }, error: null }],
    }));
    expect(s.notSeen.map((n) => n.detail.uk).join(" ")).toMatch(/якийсь_майбутній_інструмент/);
    expect(s.clean).toHaveLength(0);
  });

  /*
   * ОЧІКУВАННЯ ЦЬОГО ТЕСТУ ЗМІНЕНО (раунд виправлень 1, знахідка контролера
   * №1, живий прогін). Було: «`indesign_status` свідомо без адаптера — і так
   * само видимий у notSeen». Інваріант R18 («прохід не зникає») тримався, але
   * ціна виявилась вимірною: зонд сеансу сидів у «не бачили» НА КОЖНОМУ
   * прогоні, і плитка «Не виміряно» ніколи не бувала нулем.
   *
   * Стало: у зонда є адаптер, і він каже те, що справді виміряв (§8 — нуль
   * іде в «чисто» З ЧИСЛОМ). Секція змінилась, ІНВАРІАНТ той самий: прохід
   * стоїть рівно в одній із трьох і не зникає — це й перевіряється нижче.
   */
  it("indesign_status має адаптер: іде в «чисто» З ЧИСЛАМИ середовища, а не в «не бачили»", () => {
    const data: StatusShape = {
      version: "21.5.1.73",
      documents: [{ name: "к.indd", fullName: "/т/к.indd", modified: false }],
      activeDocument: "к.indd",
    };
    const s = deriveSections(виміри({
      passes: [{ id: "status", tool: "indesign_status", ok: true, elapsedMs: 1, data, error: null }],
    }));
    /* Рівно в одній секції — інваріант R18/R20 не ослаблено. */
    expect(s.clean.map((c) => c.what.uk)).toEqual(["status"]);
    expect(s.notSeen.map((n) => n.detail.uk).join(" ")).not.toMatch(/indesign_status/);
    /* І з ЧИСЛАМИ, а не з порожнім «перевірено»: версія, скільки відкрито, який спереду. */
    const виміряно = s.clean[0]!.measured.uk;
    expect(виміряно).toContain("21.5.1.73");
    expect(виміряно).toContain("відкритих документів: 1");
    expect(виміряно).toContain("к.indd");
    /* І сказано, що це середовище, а не макет — інакше «чисто» читалось би ширше. */
    expect(виміряно).toMatch(/середовище, не макет/);
  });

  /*
   * Незбережені зміни — єдине, що зонд знає й що впливає на читання звіту
   * (аудит міряв стан, якого на диску немає). Число мусить бути видимим.
   */
  it("indesign_status називає документи з незбереженими змінами, а не мовчить про них", () => {
    const data: StatusShape = {
      version: "21.5.1.73",
      documents: [
        { name: "к.indd", fullName: "/т/к.indd", modified: true },
        { name: "інша.indd", fullName: null, modified: false },
      ],
      activeDocument: "к.indd",
    };
    const s = deriveSections(виміри({
      passes: [{ id: "status", tool: "indesign_status", ok: true, elapsedMs: 1, data, error: null }],
    }));
    expect(s.clean[0]!.measured.uk).toContain("з незбереженими змінами: к.indd");
    expect(s.clean[0]!.measured.uk).toContain("відкритих документів: 2");
  });

  it("прохід із адаптером, але з порожніми даними (data: null) — теж у notSeen, не мовчить і не падає", () => {
    const s = deriveSections(виміри({
      passes: [{ id: "color", tool: "color_audit", ok: true, elapsedMs: 1, data: null, error: null }],
    }));
    expect(s.notSeen.map((n) => n.detail.uk).join(" ")).toMatch(/color_audit/);
    expect(s.clean).toHaveLength(0);
  });
});

/*
 * ============================================================================
 * C1 (фінальна рецензія гілки, Critical): ПРИЛАДОВІ ЛІЧИЛЬНИКИ.
 *
 * Кожна фікстура тут — вимір, що НЕ ВІДБУВСЯ, поданий інструментом у формі,
 * яка на перший погляд не відрізняється від чистого прогону. Саме таких
 * фікстур не було в цьому файлі жодної: усі попередні ставили приладові
 * поля порожніми або нульовими, і тому кожна перевіряла лише, що адаптер
 * читає ПРАВИЛЬНІ поля знахідок — але не те, чи читає він поля, без яких
 * нуль неправдивий.
 *
 * Стан приладу, доведений рецензентом ВИКОНАННЯМ проти зібраного `dist/`:
 * `preflight_document` із `shapeRecognised: false`, `preflightOff: true`,
 * `waitTimedOut: true`, `occurrenceCount: 0` друкувався як
 * «CLEAN: увімкнених правил перевірено: 6», `hasCritical` віддавав `false`,
 * і процес виходив кодом 0.
 * ============================================================================
 */
describe("C1 — вимір, якого прилад не підтвердив, НЕ «чисто»", () => {
  it("preflight, shapeRecognised: false — не «чисто», а «не бачили», і ворота горять", () => {
    const data: PreflightReport = {
      ...базовийPreflightReport(),
      shapeRecognised: false,
      preflightOff: true,
      waitTimedOut: true,
      occurrenceCount: 0,
      caveat: "УВАГА: InDesign віддав результат формою, якої розбір не впізнав",
    };
    const m = виміри({
      passes: [{ id: "preflight", tool: "preflight_document", ok: true, elapsedMs: 1, data, error: null }],
    });
    const s = deriveSections(m);
    expect(s.clean, "непрочитаний preflight не сміє стояти в «Перевірено чисто»").toHaveLength(0);
    const текст = s.notSeen.map((n) => n.detail.uk).join(" ");
    expect(текст).toMatch(/shapeRecognised = false/);
    expect(текст).toMatch(/не змогли прочитати/);
    /* Живий preflight вимкнено — окремий рядок, бо це інший факт. */
    expect(текст).toMatch(/preflightOff = true/);
    expect(hasCritical(m, new Set(["preflight"])), "ворота мусять горіти").toBe(true);
  });

  it("preflight, waitTimedOut: true при впізнаній формі — перелік неповний, теж не «чисто»", () => {
    const data: PreflightReport = { ...базовийPreflightReport(), waitTimedOut: true };
    const s = deriveSections(виміри({
      passes: [{ id: "preflight", tool: "preflight_document", ok: true, elapsedMs: 1, data, error: null }],
    }));
    expect(s.clean).toHaveLength(0);
    expect(s.notSeen.map((n) => n.detail.uk).join(" ")).toMatch(/НЕ ДОЧЕКАВСЯ/);
  });

  it("preflight, waitPolarity — полярність невідома, вимір непідтверджений", () => {
    const data: PreflightReport = {
      ...базовийPreflightReport(),
      waitTimedOut: true,
      waitPolarity: "string \"true\"",
    };
    const s = deriveSections(виміри({
      passes: [{ id: "preflight", tool: "preflight_document", ok: true, elapsedMs: 1, data, error: null }],
    }));
    expect(s.clean).toHaveLength(0);
    expect(s.notSeen.map((n) => n.detail.uk).join(" ")).toMatch(/НЕ булеве/);
  });

  /* Позитивний близнюк усіх трьох вище: здоровий прилад — «чисто». */
  it("preflight зі здоровим приладом і нулем порушень — «чисто», з числом правил", () => {
    const s = deriveSections(виміри({
      passes: [{ id: "preflight", tool: "preflight_document", ok: true, elapsedMs: 1, data: базовийPreflightReport(), error: null }],
    }));
    expect(s.clean).toHaveLength(1);
    expect(s.clean[0]!.measured.uk).toMatch(/увімкнених правил перевірено: 1/);
  });

  it("color: непрочитана поверхня — не «чисто»; невимірні лінки названі в «не бачили» поіменно (I1)", () => {
    const data: ColorReport = {
      ...базовийColorReport(),
      unreadSurfaces: ["pageItem"],
      unmeasurableLinks: ["a.psd"],
    };
    const s = deriveSections(виміри({
      passes: [{ id: "color", tool: "color_audit", ok: true, elapsedMs: 1, data, error: null }],
    }));
    expect(s.clean).toHaveLength(0);
    const текст = s.notSeen.map((n) => n.detail.uk).join(" ");
    expect(текст).toMatch(/pageItem/);
    expect(текст, "спек §8 вимагає назвати лінк, а не лише межу приладу").toMatch(/a\.psd/);
  });

  it("color: невимірний лінк САМ ПО СОБІ виміру не скасовує — прохід лишається «чисто», але лінк названий", () => {
    const data: ColorReport = { ...базовийColorReport(), unmeasurableLinks: ["b.ai"] };
    const s = deriveSections(виміри({
      passes: [{ id: "color", tool: "color_audit", ok: true, elapsedMs: 1, data, error: null }],
    }));
    expect(s.clean).toHaveLength(1);
    expect(s.notSeen.map((n) => n.detail.uk).join(" ")).toMatch(/b\.ai/);
  });

  it("pagination: оголошеного стилю в документі немає — не «чисто»", () => {
    const data: PaginationReport = {
      ...базовийPaginationReport(),
      folio: { checked: 0, deviating: 0, notCompared: 131, groups: [] },
      missingStyles: ["Колонтитул v1"],
    };
    const m = виміри({
      passes: [{ id: "pagination", tool: "pagination_audit", ok: true, elapsedMs: 1, data, error: null }],
    });
    const s = deriveSections(m);
    expect(s.clean).toHaveLength(0);
    const текст = s.notSeen.map((n) => n.detail.uk).join(" ");
    expect(текст).toMatch(/Колонтитул v1/);
    expect(текст).toMatch(/131 тверджень НЕ звірено/);
    expect(hasCritical(m, new Set(["pagination"]))).toBe(true);
  });

  it("styles: totals.* === null означає «родину не рахували» — не «чисто» з нулем", () => {
    const data: StylesAuditResponse = {
      findings: [],
      totals: {
        paragraphs: 2980,
        overridePropertyDeviations: null,
        scaleParagraphs: null,
        characterRangesDeviating: null,
      },
    };
    const s = deriveSections(виміри({
      passes: [{ id: "styles", tool: "styles_audit", ok: true, elapsedMs: 1, data, error: null }],
    }));
    expect(s.clean, "«абзаців проаудитовано: 2980» при трьох нерахованих родинах — неправда").toHaveLength(0);
    expect(s.notSeen.map((n) => n.detail.uk).join(" ")).toMatch(/totals = null/);
  });

  it("layout: незвірені групи властивостей — не «чисто»", () => {
    const data: LayoutAuditResponse = {
      pages: ["1", "2"],
      masters: { findings: [] },
      totals: { overrideFindings: 0, masterFindings: 0, notComparedGroups: 7 },
    };
    const s = deriveSections(виміри({
      passes: [{ id: "layout", tool: "layout_audit", ok: true, elapsedMs: 1, data, error: null }],
    }));
    expect(s.clean).toHaveLength(0);
    expect(s.notSeen.map((n) => n.detail.uk).join(" ")).toMatch(/7 груп/);
  });

  it("composition: частковий обхід (scope.partial) — не «чисто»", () => {
    const data: CompositionAuditResponse = {
      scope: { linesAnalysed: 120, partial: true, stoppedAt: "88", stoppedReason: "міст мовчить", pagesMeasured: 87 },
      findingsTotal: 0,
    };
    const s = deriveSections(виміри({
      passes: [{ id: "composition", tool: "composition_audit", ok: true, elapsedMs: 1, data, error: null }],
    }));
    expect(s.clean).toHaveLength(0);
    expect(s.notSeen.map((n) => n.detail.uk).join(" ")).toMatch(/міст мовчить/);
  });

  it("typography: нуль українських прогонів — мовний гейт не збігся, не «чисто»", () => {
    const data: TypographyAuditResponse = {
      ...базоваTypography(),
      spelling2019: { ukrainianRuns: 0, skippedByLanguage: 0 },
    };
    const s = deriveSections(виміри({
      passes: [{ id: "typography", tool: "typography_audit", ok: true, elapsedMs: 1, data, error: null }],
    }));
    expect(s.clean).toHaveLength(0);
    expect(s.notSeen.map((n) => n.detail.uk).join(" ")).toMatch(/ukrainianRuns = 0/);
  });

  it("spelling: мова без словника — не «чисто»", () => {
    const data: SpellingReport & { languagesWithoutDictionary: string[] } = {
      ...базовийSpellingReport(),
      languagesWithoutDictionary: ["Ukrainian"],
    };
    const s = deriveSections(виміри({
      passes: [{ id: "spelling", tool: "spelling_audit", ok: true, elapsedMs: 1, data, error: null }],
    }));
    expect(s.clean).toHaveLength(0);
    expect(s.notSeen.map((n) => n.detail.uk).join(" ")).toMatch(/Ukrainian/);
  });

  it("bibliography: нерозібрані записи — не «чисто»", () => {
    const data: BibliographyReport = { ...базовийBibliographyReport(), records: 42, unparsed: 5 };
    const s = deriveSections(виміри({
      passes: [{ id: "bibliography", tool: "bibliography_audit", ok: true, elapsedMs: 1, data, error: null }],
    }));
    expect(s.clean).toHaveLength(0);
    expect(s.notSeen.map((n) => n.detail.uk).join(" ")).toMatch(/5 записів не розібрано/);
  });

  /*
   * ІНВАРІАНТ R18/R20 при непідтвердженому вимірі: прохід не зникає й не
   * роздвоюється — він стоїть РІВНО в одній секції.
   */
  it("ІНВАРІАНТ: непідтверджений прохід стоїть рівно в ОДНІЙ секції", () => {
    const data: PreflightReport = { ...базовийPreflightReport(), shapeRecognised: false };
    const s = deriveSections(виміри({
      passes: [{ id: "preflight", tool: "preflight_document", ok: true, elapsedMs: 1, data, error: null }],
    }));
    const уClean = s.clean.filter((c) => c.what.uk === "preflight").length;
    const уNotSeen = s.notSeen.filter((n) => n.detail.uk.includes("Прохід «preflight»")).length;
    const уNeedsEyes = s.needsEyes.filter((n) => n.topic.uk.includes("preflight")).length;
    expect([уClean, уNotSeen, уNeedsEyes]).toEqual([0, 1, 0]);
  });
});

describe("hasCritical", () => {
  it("незбережений документ не робить прогону критичним сам собою", () => {
    expect(hasCritical(виміри({}), new Set(["color"]))).toBe(false);
  });

  it("знахідка в критичній родині запалює ворота (справжня форма ColorReport)", () => {
    const data: ColorReport = {
      ...базовийColorReport(),
      findingCount: 1,
      occurrenceCount: 1,
      findings: [справжняColorЗнахідка],
    };
    const m = виміри({
      passes: [{ id: "color", tool: "color_audit", ok: true, elapsedMs: 1, data, error: null }],
    });
    expect(hasCritical(m, new Set(["color"]))).toBe(true);
  });

  it("знахідка в НЕкритичній родині воріт не запалює (справжня форма SpellingReport)", () => {
    const data: SpellingReport = { ...базовийSpellingReport(), deviating: 3 };
    const m = виміри({
      passes: [{ id: "spelling", tool: "spelling_audit", ok: true, elapsedMs: 1, data, error: null }],
    });
    expect(hasCritical(m, new Set(["color"]))).toBe(false);
  });

  /*
   * Обов'язковий доказ рецензії (пункт г): `pagination` — типово критична
   * родина (`src/cli/run/plan.ts` CRITICAL_FAMILIES), і саме тут стара версія
   * мовчала — `знахідки(p)` читала `data.findings`, якого в PaginationReport
   * НЕМАЄ ВЗАГАЛІ, тож ворота НІКОЛИ не спрацьовували на розбіжності
   * колонцифри чи змісту. Тест будує СПРАВЖНЮ форму `PaginationReport` з
   * непорожньою родиною `folio` (91 ручна колонцифра — виміряне число
   * книжки) і перевіряє, що ворота спрацьовують.
   */
  it("hasCritical спрацьовує на справжній формі PaginationReport із непорожньою родиною знахідок", () => {
    const data: PaginationReport = {
      ...базовийPaginationReport(),
      folio: {
        checked: 91,
        deviating: 91,
        notCompared: 0,
        groups: [{
          defect: "folio-manual",
          count: 91,
          pages: ["3", "5"],
          pagesTruncated: { shown: 2, total: 91 },
          example: {
            id: "f1", family: "folio", defect: "folio-manual",
            page: "3", frameId: "fr1", paragraphIndex: 0,
            claimed: "3", actual: null, detail: "число набране руками",
          },
        }],
      },
    };
    const m = виміри({
      passes: [{ id: "pagination", tool: "pagination_audit", ok: true, elapsedMs: 1, data, error: null }],
    });
    expect(hasCritical(m, new Set(["pagination"]))).toBe(true);
  });

  /*
   * C1 (фінальна рецензія, Critical) — ОЧІКУВАННЯ ЦЬОГО ТЕСТУ ПЕРЕВЕРНУТО
   * НАВМИСНО, і саме воно було одним із проявів вади.
   *
   * Було: «порожні родини PaginationReport (усе null) НЕ запалюють воріт» —
   * тобто критична родина, яка не виміряла ЖОДНОГО твердження (folio,
   * contents, runningHead — усі null, `checked: 0`), давала зелені ворота
   * й картку «Перевірено чисто · тверджень перевірено: 0». Це рівно той
   * тихий нуль, якого §5.1 обіцяє «не існує за побудовою»: нуль від
   * невиміряної родини невідрізненний від чистої верстки.
   *
   * Стало: непідтверджений вимір критичної родини запалює ворота. Знахідок
   * при цьому справді нуль — воріт не запалює ЗНАХІДКА, їх запалює
   * відсутність виміру.
   */
  it("C1: критична родина, що не виміряла НІЧОГО (усі родини null), запалює ворота", () => {
    const data: PaginationReport = базовийPaginationReport();
    const m = виміри({
      passes: [{ id: "pagination", tool: "pagination_audit", ok: true, elapsedMs: 1, data, error: null }],
    });
    expect(hasCritical(m, new Set(["pagination"]))).toBe(true);
  });

  /* Позитивний близнюк: РЕАЛЬНО виміряна родина з нулем розбіжностей воріт
   * НЕ запалює — інакше ворота горіли б завжди, і це були б не ворота. */
  it("C1: виміряна родина з нулем розбіжностей воріт не запалює", () => {
    const data: PaginationReport = {
      ...базовийPaginationReport(),
      folio: { checked: 131, deviating: 0, notCompared: 0, groups: [] },
    };
    const m = виміри({
      passes: [{ id: "pagination", tool: "pagination_audit", ok: true, elapsedMs: 1, data, error: null }],
    });
    expect(hasCritical(m, new Set(["pagination"]))).toBe(false);
  });

  /*
   * I1 (рулінг R46) — ТВЕРДА половина тієї самої властивості, що C1.
   * C1 закрив «прилад віддав результат, якому не можна вірити». Тут —
   * «приладу не було чути ЗОВСІМ»: `judgePasses` віддає `extract === null`
   * у ТРЬОХ випадках, і доти всі три давали `hasCritical === false`, тобто
   * код виходу 0 = «чисто, готово до друку». Виміряно виконанням проти
   * `dist/`: упалий критичний `preflight` віддавав зелені ворота.
   *
   * Три випадки перевіряються ОКРЕМО навмисно: один тест на всі три не
   * показує, що працюють усі три, — і саме так минула перша хвиля.
   */
  it("I1, випадок 1 із 3: критичний прохід УПАВ — ворота горять", () => {
    const m = виміри({
      passes: [{
        id: "preflight", tool: "preflight_document", ok: false, elapsedMs: 1,
        data: null, error: "InDesign не відповів за 180 с",
      }],
    });
    expect(hasCritical(m, new Set(["preflight"])), "упалий прохід — не «чисто»").toBe(true);
  });

  it("I1, випадок 2 із 3: критичний прохід віддав ПОРОЖНІ дані — ворота горять", () => {
    const m = виміри({
      passes: [{ id: "color", tool: "color_audit", ok: true, elapsedMs: 1, data: null, error: null }],
    });
    expect(hasCritical(m, new Set(["color"])), "порожні дані — не «чисто»").toBe(true);
  });

  /*
   * Третій випадок — сценарій R18: інструмент виконався, дані віддав, а
   * адаптера під його назву в звіті немає (інструмент перейменували,
   * адаптер забули). Прохід типізований СПРАВЖНІМ `GeometryReport`, щоб
   * було видно: дані є й вони правильної форми — не розібрано їх лише тому,
   * що назва інструмента звітові невідома.
   */
  it("I1, випадок 3 із 3: звіт НЕ розбирає форму критичного проходу — ворота горять", () => {
    const data: GeometryReport = базовийGeometryReport();
    const m = виміри({
      passes: [{ id: "geometry", tool: "geometry_audit_v2", ok: true, elapsedMs: 1, data, error: null }],
    });
    expect(hasCritical(m, new Set(["geometry"])), "нерозібрана форма — не «чисто»").toBe(true);
  });

  /*
   * НЕГАТИВНИЙ БЛИЗНЮК — МЕЖА РУЛІНГУ R46, і без нього наступна правка
   * «узагальнить» умову I1 на будь-яку відсутність виміру та зламає §5.1
   * непомітно.
   *
   * Родина, оголошена `{"notApplicable": "…"}`, воріт НЕ запалює: це
   * рішення ЛЮДИНИ, а не втрачений вимір. Механічно такі родини живуть у
   * `m.skipped`, а не в `m.passes`, тож у `judgePasses` не потрапляють
   * узагалі — тест стверджує саме поведінку (ворота), а не механіку, бо
   * механіка може змінитись, а межа — ні. Ворота, що горіли б на кожному
   * оголошенні незастосовності, були б рівно тим, що §6.4 забороняє.
   *
   * Друга половина твердження не менш важлива: причина при цьому НЕ
   * зникає — вона друкується дослівно в «Чого перевірка НЕ бачила». Тихого
   * нуля тут немає, є названа відмова.
   */
  it("R46, негативний близнюк: критична родина, ОГОЛОШЕНА незастосовною, воріт НЕ запалює", () => {
    const m = виміри({
      passes: [],
      skipped: [{ family: "pagination", reason: "у цьому виданні немає ні змісту, ні колонцифр" }],
    });
    expect(hasCritical(m, new Set(["pagination"])), "свідома відмова — не втрачений вимір").toBe(false);
    /* І причина не мовчить, а стоїть у звіті дослівно. */
    expect(deriveSections(m).notSeen.map((n) => `${n.source.uk} ${n.detail.uk}`).join(" ")).toContain(
      "у цьому виданні немає ні змісту, ні колонцифр",
    );
  });

  /*
   * КОНТРОЛЬ, який мусить лишитися зеленим: здоровий прилад без знахідок
   * дає ворота ЗАКРИТІ, а прохід іде в «Перевірено чисто». Фікс, який
   * робить усе червоним, — не фікс.
   */
  it("контроль: здоровий прилад без знахідок — ворота не горять, прохід у «Перевірено чисто»", () => {
    const data: GeometryReport = базовийGeometryReport();
    const m = виміри({
      passes: [{ id: "geometry", tool: "geometry_audit", ok: true, elapsedMs: 1, data, error: null }],
    });
    expect(hasCritical(m, new Set(["geometry"]))).toBe(false);
    expect(deriveSections(m).clean.map((c) => c.what.uk)).toContain("geometry");
  });
});

/*
 * I2: шапка звіту не сміє суперечити кодові виходу. `tallyFindings` —
 * ЄДИНЕ джерело чисел шапки (I6), тож саме тут з'являється число
 * невиміряного й перелік критичних родин без виміру.
 */
describe("tallyFindings — невиміряне видно в шапці (I2)", () => {
  it("рахує ВСІ три випадки втраченого виміру, а не лише непідтверджений", () => {
    const m = виміри({
      passes: [
        { id: "preflight", tool: "preflight_document", ok: false, elapsedMs: 1, data: null, error: "збій" },
        { id: "color", tool: "color_audit", ok: true, elapsedMs: 1, data: null, error: null },
        { id: "geometry", tool: "geometry_audit_v2", ok: true, elapsedMs: 1, data: базовийGeometryReport(), error: null },
      ],
    });
    const t = tallyFindings(m, new Set(["preflight", "color", "geometry"]));
    expect(t.непідтверджених, "усі три випадки пораховані").toBe(3);
    expect(t.критичніБезВиміру).toEqual(["preflight", "color", "geometry"]);
    /* Знахідок при цьому справді нуль — їх ніхто не міряв. */
    expect(t.критичних).toBe(0);
  });

  it("здоровий прилад без знахідок не дає жодного невиміряного", () => {
    const m = виміри({
      passes: [{ id: "geometry", tool: "geometry_audit", ok: true, elapsedMs: 1, data: базовийGeometryReport(), error: null }],
    });
    const t = tallyFindings(m, new Set(["geometry"]));
    expect(t.непідтверджених).toBe(0);
    expect(t.критичніБезВиміру).toEqual([]);
  });

  /*
   * ІНВАРІАНТ, який тримає шапку й ворота вкупі: якщо шапка називає
   * критичну родину без виміру, ворота МУСЯТЬ горіти. Розійшлись би вони —
   * і звіт знову казав би одне, а код виходу інше (та сама вада, що R22 й
   * I6, лише між шапкою й воротами). Перебираються ВСІ чотири стани
   * критичної родини — три втрачені виміри й непідтверджений (C1).
   */
  it("ІНВАРІАНТ: названа в шапці критична родина без виміру ЗАВЖДИ запалює ворота", () => {
    const непідтверджений: PreflightReport = { ...базовийPreflightReport(), shapeRecognised: false };
    const стани: ЧастковийПрохід[] = [
      { id: "preflight", tool: "preflight_document", ok: false, elapsedMs: 1, data: null, error: "збій" },
      { id: "preflight", tool: "preflight_document", ok: true, elapsedMs: 1, data: null, error: null },
      { id: "preflight", tool: "preflight_v2", ok: true, elapsedMs: 1, data: базовийPreflightReport(), error: null },
      { id: "preflight", tool: "preflight_document", ok: true, elapsedMs: 1, data: непідтверджений, error: null },
    ];
    const критичні = new Set(["preflight"]);
    for (const прохід of стани) {
      const m = виміри({ passes: [прохід] });
      const названо = tallyFindings(m, критичні).критичніБезВиміру.length > 0;
      expect(названо, `шапка мусить назвати стан ${прохід.tool}/${String(прохід.ok)}`).toBe(true);
      expect(hasCritical(m, критичні), `і ворота мусять горіти на ${прохід.tool}`).toBe(true);
    }
  });
});

/*
 * R20 (рецензія задачі 12): та сама вада, що R18 (прохід без адаптера
 * зникав мовчки), рівнем нижче — прохід З АДАПТЕРОМ, чиї дані НЕПОРОЖНІ
 * (`count > 0`), теж зникав мовчки: гілка `if (count === 0) clean.push(...)`
 * не мала `else`, тож `typography_audit`/`layout_audit`/
 * `composition_audit`/`__cli_extras` із РЕАЛЬНИМИ знахідками не траплялись
 * НІ в «чисто», НІ в «не бачили», НІ в «потребує очей» — а код виходу
 * лишався 0 для некритичних родин. Попередні тести файлу (вище) перевіряли
 * лише `s.clean).toHaveLength(0)` для таких кейсів — і саме тому діра
 * пройшла повз них: порожній `clean` — правда, але не вся правда.
 *
 * Тест нижче стверджує ІНВАРІАНТ, а не окремий випадок: для НАБОРУ
 * вимірів, де КОЖЕН прохід (з усіх дванадцяти інструментів, які мають
 * адаптер у `АДАПТЕРИ`, крім `doc_overview` — його `count` за побудовою
 * завжди 0, він структурно не може дати цей кейс) має `count > 0`, жоден
 * `pass.id` не випадає з об'єднання `clean ∪ notSeen ∪ needsEyes`.
 */
describe("deriveSections — R20: прохід із count > 0 НЕ сміє зникати мовчки", () => {
  const непорожнійColorReport: ColorReport = {
    ...базовийColorReport(),
    findingCount: 1,
    occurrenceCount: 1,
    findings: [справжняColorЗнахідка],
  };

  const непорожнійGeometryReport: GeometryReport = {
    docName: "к.indd",
    measuredWith: {
      traversal: "allPageItems",
      units: "pt",
      coordinateOrigin: { rulerOrigin: "PAGE_ORIGIN", zeroPoint: [0, 0] },
      itemsSeen: 10,
      pagesSeen: 5,
      ms: 100,
    },
    findings: [{ family: "wrap", defect: "text-wrap-mismatch", pages: ["7"], count: 1, value: "1" }],
    truncated: null,
    inventory: { anchored: [], graphics: [], wrap: [], graphicsTruncated: null, anchoredTruncated: null },
    survey: null,
    notMeasured: [],
    caveats: [],
  };

  const непорожнійPreflightReport: PreflightReport = {
    ...базовийPreflightReport(),
    findings: [{
      category: "TEXT", rule: "Overset text", occurrenceCount: 1,
      occurrences: [{ page: "3", object: "Text Frame", description: "Overset", details: [] }],
    }],
    occurrenceCount: 1,
  };

  const непорожнійPaginationReport: PaginationReport = {
    ...базовийPaginationReport(),
    folio: {
      checked: 91, deviating: 91, notCompared: 0,
      groups: [{
        defect: "folio-manual", count: 91, pages: ["3"], pagesTruncated: null,
        example: {
          id: "f1", family: "folio", defect: "folio-manual",
          page: "3", frameId: "fr1", paragraphIndex: 0,
          claimed: "3", actual: null, detail: "число набране руками",
        },
      }],
    },
  };

  const непорожнійStylesReport: StylesAuditResponse = {
    findings: [{
      family: "usage", defect: "style-unused-leaf", styleName: "Мертвий стиль",
      styleId: "id1", page: null, containerId: null, paragraphIndex: null, detail: "не вжито",
    }],
    totals: { paragraphs: 100, overridePropertyDeviations: 0, scaleParagraphs: 0, characterRangesDeviating: 0 },
  };

  const непорожнійBibliographyReport: BibliographyReport = {
    ...базовийBibliographyReport(),
    records: 10,
    groups: [{ ruleId: "bib-zone-separator", title: "Роздільник зон", basis: "ДСТУ", total: 1, verdict: null, samples: [], needsReview: [], needsReviewTotal: 0 }],
  };

  const непорожнійSpellingReport: SpellingReport = { ...базовийSpellingReport(), deviating: 3 };

  const непорожнійLayoutReport: LayoutAuditResponse = {
    pages: ["1", "2"],
    masters: { findings: [{ якесь: "поле" }] },
    totals: { overrideFindings: 1, masterFindings: 0, notComparedGroups: 0 },
  };

  const непорожнійCompositionReport: CompositionAuditResponse = {
    scope: { linesAnalysed: 500, partial: false },
    findingsTotal: 3,
  };

  /* Справжня форма зі знахідками (спек контрольної таблиці §10):
   * quotes-uk 8 на с. 24, 67. */
  const непорожнійTypographyReport: TypographyAuditResponse = {
    ...базоваTypography(),
    groups: [{ ruleId: "quotes-uk", title: "Лапки", total: 8, samples: [], needsReview: [] }],
    totalMatches: 8,
    auditOnly: [],
  };

  /*
   * R22 (рецензія задачі 12, Important, доведено ВИКОНАННЯМ): рецензент
   * прогнав шлях і виявив, що 193 не з'являється НІДЕ — ні в числі
   * (`count` рахував `findings.length`, тобто кількість ТИПІВ знахідок,
   * не саму величину), ні в тексті (`measured` = `clean.join(...)` не
   * несе рядків-знахідок узагалі). Фікстура нижче МІСТИТЬ ДВІ незалежні
   * величини (66 масштабу + 193 монтажного столу) саме тому, що
   * рецензент назвав ОБИДВА числа явно.
   */
  const непорожнійExtras: ExtrasMeasure = {
    docName: "к.indd",
    horizontalScaleOffenders: [{ page: "12", style: "Підпис", scale: 92, count: 66 }],
    emptyParagraphs: 0,
    forcedBreaks: { total: 0, inBodyText: 0 },
    smallestPointSize: null,
    thinnestStrokePt: null,
    pasteboardItems: [{ layer: "Робочий шар", count: 193 }],
  };

  const усіПроходиЗЗнахідками: ЧастковийПрохід[] = [
    { id: "color", tool: "color_audit", ok: true, elapsedMs: 1, error: null, data: непорожнійColorReport },
    { id: "geometry", tool: "geometry_audit", ok: true, elapsedMs: 1, error: null, data: непорожнійGeometryReport },
    { id: "preflight", tool: "preflight_document", ok: true, elapsedMs: 1, error: null, data: непорожнійPreflightReport },
    { id: "pagination", tool: "pagination_audit", ok: true, elapsedMs: 1, error: null, data: непорожнійPaginationReport },
    { id: "styles", tool: "styles_audit", ok: true, elapsedMs: 1, error: null, data: непорожнійStylesReport },
    { id: "bibliography", tool: "bibliography_audit", ok: true, elapsedMs: 1, error: null, data: непорожнійBibliographyReport },
    { id: "spelling", tool: "spelling_audit", ok: true, elapsedMs: 1, error: null, data: непорожнійSpellingReport },
    { id: "layout", tool: "layout_audit", ok: true, elapsedMs: 1, error: null, data: непорожнійLayoutReport },
    { id: "composition", tool: "composition_audit", ok: true, elapsedMs: 1, error: null, data: непорожнійCompositionReport },
    { id: "typography", tool: "typography_audit", ok: true, elapsedMs: 1, error: null, data: непорожнійTypographyReport },
    { id: "extras", tool: "__cli_extras", ok: true, elapsedMs: 1, error: null, data: непорожнійExtras },
  ];

  it("ІНВАРІАНТ: кожен pass.id з непорожніми знахідками є десь у clean ∪ notSeen ∪ needsEyes", () => {
    const s = deriveSections(виміри({ passes: усіПроходиЗЗнахідками }));
    const усіТексти = [
      ...s.clean.map((c) => `${c.what} ${c.measured} ${c.params} ${c.paramLines.map((b) => b.uk).join(" ")}`),
      ...s.notSeen.map((n) => `${n.source.uk} ${n.detail.uk}`),
      ...s.needsEyes.map((n) => `${n.topic.uk} ${n.detail.uk}`),
    ].join(" | ");

    for (const p of усіПроходиЗЗнахідками) {
      expect(усіТексти, `pass.id="${p.id}" (${p.tool}) зник з усіх трьох секцій`).toMatch(
        new RegExp(`\\b${p.id}\\b`),
      );
    }
  });

  it("жоден із цих проходів не потрапляє в «чисто» — вони не нульові", () => {
    const s = deriveSections(виміри({ passes: усіПроходиЗЗнахідками }));
    expect(s.clean).toHaveLength(0);
  });

  it("typography_audit (quotes-uk 8) конкретно потрапляє в needsEyes із числом", () => {
    const s = deriveSections(виміри({
      passes: [{ id: "typography", tool: "typography_audit", ok: true, elapsedMs: 1, error: null, data: непорожнійTypographyReport }],
    }));
    const текст = s.needsEyes.map((n) => `${n.topic.uk} ${n.detail.uk}`).join(" ");
    expect(текст).toMatch(/typography/);
    expect(текст).toMatch(/8/);
  });

  it("__cli_extras (66 масштабу + 193 монтажного столу) конкретно потрапляє в needsEyes ІЗ ЧИСЛОМ", () => {
    /*
     * R22: слабкий асерт (лише /extras/, без числа) — саме та форма, повз
     * яку раніше пройшла хибна лічба `count: findings.length` (== 1,
     * замість 66+193 == 259). Тепер стверджуємо число, не лише назву:
     * `count` у `sections.ts` тепер сума СПРАВЖНІХ величин зі структурних
     * полів, а не кількість типів знахідок.
     */
    const s = deriveSections(виміри({
      passes: [{ id: "extras", tool: "__cli_extras", ok: true, elapsedMs: 1, error: null, data: непорожнійExtras }],
    }));
    const текст = s.needsEyes.map((n) => `${n.topic.uk} ${n.detail.uk}`).join(" ");
    expect(текст).toMatch(/extras/);
    expect(текст).toMatch(/259 знахідок/); // 66 (масштаб) + 193 (монтажний стіл)
  });
});

/*
 * R28: спек §8 обіцяє, що «Перевірено чисто» друкує кожен прохід «із числом,
 * яке він виміряв, І ПАРАМЕТРАМИ, ЯКИМИ МІРЯВ». До цієї задачі `params` ніс
 * лише назву інструмента — параметрів у звіті не було взагалі, а після
 * `ce246af` частина з них ще й бралася із замовчувань схеми, яких ніхто не
 * обирав. Тести нижче стережуть обидві половини: параметри друкуються, і їхнє
 * походження назване.
 */
describe("describeParams — походження кожного числа назване", () => {
  function прохід(частковий: Partial<PassResult>): PassResult {
    return {
      id: "composition", tool: "composition_audit", ok: true, elapsedMs: 1,
      data: null, error: null, args: {}, defaulted: [], ...частковий,
    };
  }

  /*
   * R37: половини віддаються ОКРЕМИМИ рядками — рендер картки кладе кожен
   * у власний блок. Асерт на масив, а не на з'єднаний рядок, і є тим, що
   * стереже цю форму: повернення до одного рядка зробить його червоним.
   */
  it("параметр із конфіга й параметр із замовчування — ДВА окремі рядки, не один", () => {
    const рядки = describeParams(прохід({
      args: { spacingMode: "style-bounds", pageWindow: 20 },
      defaulted: ["pageWindow"],
    }));
    expect(рядки).toEqual([
      'задано в конфігу: spacingMode: "style-bounds"',
      "замовчування інструмента (ніхто їх не обирав): pageWindow: 20",
    ]);
  });

  /*
   * ТІ САМІ аргументи, ІНШЕ походження. Обидва проходи виміряли з
   * `pageWindow: 20`; різниця лише в тому, чи хтось це число обирав. Якби
   * звіт судив за значенням, а не за походженням, обидва друкувались би
   * однаково — і саме це рулінг R28 забороняє.
   */
  it("ті самі значення, але названі людиною, замовчуваннями НЕ звуться", () => {
    const args = { spacingMode: "style-bounds", pageWindow: 20 };
    const мовчки = describeParams(прохід({ args, defaulted: ["pageWindow"] }));
    const обрано = describeParams(прохід({ args, defaulted: [] }));
    expect(мовчки).not.toEqual(обрано);
    expect(обрано).toEqual(['задано в конфігу: spacingMode: "style-bounds" · pageWindow: 20']);
    expect(обрано.join(" ")).not.toMatch(/замовчування/);
  });

  it("прохід без параметрів каже про це прямо, а не мовчить порожнім переліком", () => {
    expect(describeParams(прохід({ id: "status", tool: "indesign_status" }))).toEqual([
      "без параметрів",
    ]);
  });

  it("перелік і об'єкт друкуються як у конфігу, без вигаданого форматування", () => {
    const рядки = describeParams(прохід({
      id: "pagination", tool: "pagination_audit",
      args: { folio: { styleNames: ["Колонтитул v1"] }, headingStyles: ["Назва розділу"] },
      defaulted: [],
    }));
    expect(рядки.join(" ")).toContain('folio: {"styleNames":["Колонтитул v1"]}');
    expect(рядки.join(" ")).toContain('headingStyles: ["Назва розділу"]');
  });

  /* R37: кома всередині значення й кома між парами виглядали однаково —
   * пари розділені « · », щоб перелік читався переліком. */
  it("пари розділені « · », а не комою — кома лишається тільки всередині значення", () => {
    const рядки = describeParams(прохід({
      id: "layout", tool: "layout_audit",
      args: { families: ["overrides", "masters"], includeMasters: false },
      defaulted: ["families", "includeMasters"],
    }));
    expect(рядки).toEqual([
      'замовчування інструмента (ніхто їх не обирав): families: ["overrides","masters"] · includeMasters: false',
    ]);
  });

  it("прохід, де ВСІ параметри — замовчування, підпису «задано в конфігу» не має", () => {
    const рядки = describeParams(прохід({
      id: "styles", tool: "styles_audit",
      args: { families: ["usage", "overrides"] },
      defaulted: ["families"],
    }));
    expect(рядки).toEqual([
      'замовчування інструмента (ніхто їх не обирав): families: ["usage","overrides"]',
    ]);
  });

  it("картка «чисто» несе назву інструмента окремо, а рядки параметрів — окремо", () => {
    const data: CompositionAuditResponse = {
      scope: { linesAnalysed: 563, partial: false },
      findingsTotal: 0,
    };
    const s = deriveSections(виміри({
      passes: [{
        id: "composition", tool: "composition_audit", ok: true, elapsedMs: 1, data, error: null,
        args: { spacingMode: "style-bounds", pageWindow: 20 }, defaulted: ["pageWindow"],
      }],
    }));
    expect(s.clean).toHaveLength(1);
    expect(s.clean[0]!.params.uk).toBe("composition_audit");
    expect(s.clean[0]!.paramLines.map((b) => b.uk)).toEqual([
      'задано в конфігу: spacingMode: "style-bounds"',
      "замовчування інструмента (ніхто їх не обирав): pageWindow: 20",
    ]);
  });
});

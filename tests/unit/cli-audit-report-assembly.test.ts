// tests/unit/cli-audit-report-assembly.test.ts
/*
 * Тестує ЗШИВАННЯ (Задача 12): чи справді `buildReportHtml` заповнює
 * шаблон реальними вимірами — а не лише трьома плейсхолдерами брифу.
 *
 * R14 (рулінг координатора): «Код стану» пакує чекбокси ПОЗИЦІЙНО, тож
 * порядок рядків МУСИТЬ бути стабільним, а `data-k` — унікальним у ВСЬОМУ
 * зібраному документі (не лише в межах однієї родини, як гарантує сам
 * `dataKey`). Обидва факти перевіряються тут, на РІВНІ ЗІБРАНОГО ЗВІТУ —
 * `cli-render.test.ts` уже довів це для `renderRows` окремо, але не для
 * складання кількох родин в один документ.
 */
import { describe, expect, it } from "vitest";
import { buildReportHtml, oversetЗВимірів, прибратиЗаСобою } from "../../src/cli/audit.js";
import type { SessionHandle } from "../../src/cli/run/session.js";
import type { PreflightReport } from "../../src/preflight/types.js";
import type { AuditConfig } from "../../src/cli/config/schema.js";
import type { Pass } from "../../src/cli/run/plan.js";
import type { Measurements } from "../../src/cli/run/execute.js";
import type { EnvironmentStamp } from "../../src/cli/run/session.js";
import type { ColorReport } from "../../src/color/report.js";
import type { ColorFinding } from "../../src/color/types.js";
import type { PaginationReport } from "../../src/pagination/report.js";
import type { SpellingReport } from "../../src/spelling/types.js";
import type { DocOverviewResponse } from "../../src/cli/report/sections.js";
import type { ExtrasMeasure } from "../../src/cli/measure/extras.js";
import type { StatusShape } from "../../src/cli/run/session.js";

const конфіг: AuditConfig = {
  edition: { title: "Тестове видання", docPath: "/т/книга.indd" },
  print: { minPpi: 250, maxTotalInk: 300, expectedInks: 4 },
  families: {
    color: {}, geometry: {}, spelling: {}, typography: {}, styles: {},
    pagination: {}, composition: {}, layout: {}, bibliography: {},
    sequences: {}, extras: {},
  },
};

const відбиток: EnvironmentStamp = {
  indesignVersion: "20.0", docName: "книга.indd", docPath: "/т/книга.indd",
  modified: false, wasAlreadyOpen: true, openDocumentCount: 1,
  dictionaryPath: null, locale: "uk", sessionUptimeMs: null,
  releaseSkippedReason: null,
};

const колірЗнахідка: ColorFinding = {
  family: "tac", rule: "tac-over-limit", color: "C100 M100 Y100 K100",
  totalInk: 400, count: 3, surfaces: ["pageItem"], pages: ["12", "13"],
  pagesTotal: 3, examples: ["Прямокутник на с.12"],
};

const colorData: ColorReport = {
  docName: "книга.indd", caveat: "", parameters: {}, findingCount: 1,
  occurrenceCount: 3, findings: [колірЗнахідка], counters: [], unreadSurfaces: [],
  unmeasurableLinks: [], layers: [], inkCount: 4, inkNames: [],
  tacSurvey: null, paletteSurvey: null, elapsedMs: 100,
};

const spellingData: SpellingReport = {
  deviating: 1,
  language: [{
    defect: "language-none", containerId: "c1", page: "31", language: "[No Language]",
    start: 0, end: 10, words: 5, sample: "текст без мови",
  }],
  words: [], wordsAll: [], wordsNotCheckedAll: [], wordTypesTotal: 0, truncated: null,
};

const overviewData: DocOverviewResponse = {
  fullName: null,
  name: "Book 260816-1250.indd",
  pageCount: 196, spreadCount: 99,
  paragraphStyles: ["Основний текст"], characterStyles: [],
  fonts: ["Шрифт [installed]"], links: [],
};

/*
 * R22 (рецензія задачі 12, Important, доведено ВИКОНАННЯМ): рецензент
 * прогнав шлях і виявив, що 193 не з'являється НІДЕ в готовому звіті —
 * ані в лічильнику, ані в тексті. Фікстура нижче МІСТИТЬ ОБИДВІ величини,
 * які він назвав явно (66 масштабу, 193 монтажного столу), щоб тест
 * ловив саме той шлях, який раніше мовчав.
 */
const extrasData: ExtrasMeasure = {
  docName: "к.indd",
  horizontalScaleOffenders: [{ page: "40", style: "Підпис", scale: 92, count: 66 }],
  emptyParagraphs: 0,
  forcedBreaks: { total: 0, inBodyText: 0 },
  smallestPointSize: null,
  thinnestStrokePt: null,
  pasteboardItems: [{ layer: "Робочий шар", count: 193 }],
};

function зробитиВиміри(): Measurements {
  return {
    schemaVersion: 3,
    startedAt: "2026-08-16T10:00:00.000Z",
    stamp: відбиток,
    skipped: [],
    passes: [
      { id: "overview", tool: "doc_overview", ok: true, elapsedMs: 5, data: overviewData, error: null, args: {}, defaulted: [] },
      { id: "color", tool: "color_audit", ok: true, elapsedMs: 10, data: colorData, error: null, args: { maxTotalInk: 300, expectedInks: 4 }, defaulted: [] },
      { id: "spelling", tool: "spelling_audit", ok: true, elapsedMs: 10, data: spellingData, error: null, args: {}, defaulted: [] },
      { id: "extras", tool: "__cli_extras", ok: true, elapsedMs: 10, data: extrasData, error: null, args: {}, defaulted: [] },
    ],
  };
}

function зробитиПроходи(): Pass[] {
  return [
    { id: "status", tool: "indesign_status", args: {}, critical: false, timeoutHintMs: 1000 },
    { id: "overview", tool: "doc_overview", args: {}, critical: false, timeoutHintMs: 1000 },
    { id: "color", tool: "color_audit", args: {}, critical: true, timeoutHintMs: 1000 },
    { id: "spelling", tool: "spelling_audit", args: {}, critical: false, timeoutHintMs: 1000 },
    { id: "extras", tool: "__cli_extras", args: {}, critical: false, timeoutHintMs: 1000 },
  ];
}

function секція(html: string, id: string): string {
  const re = new RegExp(`<section id="${id}">[\\s\\S]*?<\\/section>`);
  const m = re.exec(html);
  if (!m) throw new Error(`Секції «${id}» немає в готовому HTML.`);
  return m[0];
}

describe("buildReportHtml — зшивання", () => {
  it("жодного {{ у готовому звіті — усі 35 плейсхолдерів або заповнені, або чесно позначені", () => {
    const html = buildReportHtml(конфіг, зробитиВиміри(), зробитиПроходи());
    expect(html).not.toMatch(/\{\{/);
  });

  it("критична знахідка (color) потрапляє в секцію «crit», а не «major»", () => {
    const html = buildReportHtml(конфіг, зробитиВиміри(), зробитиПроходи());
    expect(секція(html, "crit")).toMatch(/tac-over-limit/);
    expect(секція(html, "major")).not.toMatch(/tac-over-limit/);
  });

  it("некритична знахідка (spelling language-none) потрапляє в «major», а не в «crit»", () => {
    const html = buildReportHtml(конфіг, зробитиВиміри(), зробитиПроходи());
    expect(секція(html, "major")).toMatch(/текст без мови/);
    expect(секція(html, "crit")).not.toMatch(/текст без мови/);
  });

  it("сторінки знахідки color потрапляють у рядок таблиці", () => {
    const html = buildReportHtml(конфіг, зробитиВиміри(), зробитиПроходи());
    const crit = секція(html, "crit");
    expect(crit).toMatch(/>12</);
    expect(crit).toMatch(/>13</);
  });

  it("небезпечний текст макета (з ColorFinding.examples) не ламає розмітку", () => {
    const небезпечні: Measurements = зробитиВиміри();
    const dataз: ColorReport = {
      ...colorData,
      findings: [{ ...колірЗнахідка, examples: ["<script>alert(1)</script>"] }],
    };
    небезпечні.passes = небезпечні.passes.map((p) => (p.tool === "color_audit" ? { ...p, data: dataз } : p));
    const html = buildReportHtml(конфіг, небезпечні, зробитиПроходи());
    expect(html).not.toMatch(/<script>alert/);
  });

  it("data-k глобально унікальні в усьому зібраному документі", () => {
    const html = buildReportHtml(конфіг, зробитиВиміри(), зробитиПроходи());
    const ключі = [...html.matchAll(/data-k="([^"]+)"/g)].map((m) => m[1]);
    expect(ключі.length).toBeGreaterThan(0);
    expect(new Set(ключі).size).toBe(ключі.length);
  });

  it("R14: два виклики з тими самими вимірами дають ІДЕНТИЧНИЙ HTML (стабільний порядок рядків)", () => {
    const html1 = buildReportHtml(конфіг, зробитиВиміри(), зробитиПроходи());
    const html2 = buildReportHtml(конфіг, зробитиВиміри(), зробитиПроходи());
    expect(html2).toBe(html1);
  });

  it("Сторінок (facts) бере pageCount із doc_overview", () => {
    const html = buildReportHtml(конфіг, зробитиВиміри(), зробитиПроходи());
    expect(html).toMatch(/<dt[^>]*>Сторінок<\/dt><dd>196/);
  });

  it("назва видання і дата йдуть у заголовок", () => {
    const html = buildReportHtml(конфіг, зробитиВиміри(), зробитиПроходи());
    expect(html).toMatch(/Тестове видання/);
    expect(html).toMatch(/2026-08-16/);
  });

  it("R22: __cli_extras (66 масштабу + 193 монтажного столу) дає РЯДКИ ТАБЛИЦІ зі справжніми числами", () => {
    /*
     * Рецензент прогнав шлях і виявив, що 193 не з'являлось ЖОДНОГО РАЗУ
     * в готовому звіті. Тепер обидва числа мусять бути видимі буквально —
     * у секції «major» (extras некритична за замовчуванням), не лише в
     * лічильнику фактів.
     */
    const html = buildReportHtml(конфіг, зробитиВиміри(), зробитиПроходи());
    const major = секція(html, "major");
    expect(major).toMatch(/193/);
    expect(major).toMatch(/66/);
    expect(major).toMatch(/Робочий шар/);
    expect(major).toMatch(/>40</); // сторінка масштабного офендера
  });

  /*
   * Critical 1 (раунд виправлень 1, задача C): до цієї правки жоден рядок
   * таблиці не будувався з `ExtrasMeasure.sequences` узагалі — розрив у
   * нумерації не з'являвся НІ в «crit», НІ в «major», навіть коли решта
   * `extras` брудна (66 масштабу + 193 монтажного столу з тесту вище).
   * Мутаційний доказ у звіті задачі C показує саме цей рядок ЗНИКЛИМ до
   * правки й ПРИСУТНІМ після.
   */
  it("Critical 1: розрив у нумерації дає РЯДОК ТАБЛИЦІ з попереднім/наступним числом і сторінкою", () => {
    const зРозривом: Measurements = зробитиВиміри();
    зРозривом.passes = зРозривом.passes.map((p) =>
      p.tool === "__cli_extras"
        ? {
            ...p,
            data: {
              ...(p.data as ExtrasMeasure),
              sequences: [
                {
                  style: "Нумерація питань",
                  found: 185,
                  parsed: 185,
                  restarts: 12,
                  breaks: [{ prev: 6, next: 8, page: "27" }],
                  unparsed: [{ page: "99", text: "дванадцять" }],
                },
              ],
            },
          }
        : p,
    );
    const html = buildReportHtml(конфіг, зРозривом, зробитиПроходи());
    const major = секція(html, "major");
    expect(major).toMatch(/6/);
    expect(major).toMatch(/8/);
    expect(major).toMatch(/>27</);
    expect(major).toMatch(/не розпізнано/);
    expect(major).toMatch(/дванадцять/);
  });

  /*
   * R28: параметри проходу тепер друкуються в картках «Перевірено чисто», і
   * серед них є значення, ЩО ПРИЙШЛИ З ДОКУМЕНТА — назви стилів. Спек §7
   * вимагає екранування всього такого. Тут воно перевіряється на зібраному
   * HTML, а не на рівні `sections.ts`: саме `audit.ts` кладе `params` у
   * розмітку, і саме там екранування або є, або його немає.
   */
  /*
   * §3.4 передачі: РЯДОК «ЩО РОБИТИ» ОБІЦЯВ ТЕ, ЧОГО НЕМАЄ НІДЕ.
   *
   * Стояло «повний перелік адрес — у файлі вимірів». Неправда: адреси
   * беруться з `g.pages`, обрізаних стелею MAX_GROUP_PAGES (20), а повний
   * перелік живе лише в полі `detail`, якого CLI не просить у ЖОДНОЇ родини.
   * Тобто читача відправляли шукати туди, де їх так само немає.
   */
  function звітЗГрупою(pagesTruncated: { shown: number; total: number } | null): string {
    const дані: PaginationReport = {
      docName: "книга.indd",
      folio: {
        checked: 91,
        deviating: 91,
        notCompared: 0,
        groups: [
          {
            defect: "folio-manual",
            count: 91,
            pages: ["3", "5"],
            pagesTruncated,
            example: {
              id: "f1", family: "folio", defect: "folio-manual",
              page: "3", frameId: "fr1", paragraphIndex: 0,
              claimed: "3", actual: null, detail: "число набране руками",
            },
          },
        ],
      },
      contents: null, runningHead: null, detail: null, detailTruncated: null,
      missingStyles: [], masterSkipped: [], masterIslands: [],
    };
    const виміри: Measurements = зробитиВиміри();
    виміри.passes = [
      ...виміри.passes,
      {
        id: "pagination", tool: "pagination_audit", ok: true, elapsedMs: 10,
        data: дані, error: null, args: {}, defaulted: [],
      },
    ];
    return buildReportHtml(конфіг, виміри, [
      ...зробитиПроходи(),
      { id: "pagination", tool: "pagination_audit", args: {}, critical: true, timeoutHintMs: 1000 },
    ]);
  }

  it("§3.4: обрізана група НЕ обіцяє адрес, яких немає, а каже чим їх дістати", () => {
    const html = звітЗГрупою({ shown: 20, total: 91 });
    expect(html).toMatch(/Показано 20 сторінок із 91/);
    expect(html).toMatch(/detail/);
    /* Стара обіцянка не сміє лишитись у жодному вигляді. */
    expect(html).not.toMatch(/повний перелік адрес — у файлі вимірів/);
  });

  it("§3.4: НЕобрізана група не радить нічого діставати — адреси вже на місці", () => {
    const html = звітЗГрупою(null);
    expect(html).toMatch(/адреси всіх тверджень цієї групи наведені вище/);
    expect(html).not.toMatch(/Показано \d+ сторінок із/);
  });

  it("R28: назва стилю з документа в параметрах проходу екранується, а не ламає розмітку", () => {
    const чистаPagination: PaginationReport = {
      docName: "книга.indd",
      folio: { checked: 131, deviating: 0, notCompared: 0, groups: [] },
      contents: null, runningHead: null, detail: null, detailTruncated: null,
      missingStyles: [], masterSkipped: [], masterIslands: [],
    };
    const виміри: Measurements = зробитиВиміри();
    виміри.passes = [
      ...виміри.passes,
      {
        id: "pagination", tool: "pagination_audit", ok: true, elapsedMs: 10,
        data: чистаPagination, error: null,
        args: { folio: { styleNames: ["<script>alert(1)</script>"] } },
        defaulted: [],
      },
    ];
    const html = buildReportHtml(конфіг, виміри, [
      ...зробитиПроходи(),
      { id: "pagination", tool: "pagination_audit", args: {}, critical: true, timeoutHintMs: 1000 },
    ]);
    expect(html).not.toMatch(/<script>alert/);
    expect(html).toMatch(/&lt;script&gt;alert/);
  });

  /*
   * F2 (рулінг R29): причина, оголошена на ПІДРОДИНІ, друкується дослівно в
   * «Чого перевірка НЕ бачила». Дослівно — значить із тексту конфіга, а
   * текст конфіга пише людина: спек §7 вимагає екранування. Перевіряється
   * на ЗІБРАНОМУ HTML, бо саме `audit.ts` кладе `notSeen` у розмітку.
   */
  it("R29: причина незастосовної підродини доходить до HTML — дослівно й екранованою", () => {
    const виміри: Measurements = зробитиВиміри();
    виміри.skipped = [
      ...виміри.skipped,
      {
        family: "pagination",
        subfamily: "contents",
        reason: "35 чисел змісту <не звірялися>",
      },
    ];
    const html = buildReportHtml(конфіг, виміри, зробитиПроходи());
    expect(html).toMatch(/35 чисел змісту/);
    expect(html).toMatch(/підродина «contents»/);
    expect(html).not.toMatch(/<не звірялися>/);
    expect(html).toMatch(/&lt;не звірялися&gt;/);
  });

  /*
   * R37: дві половини «параметрів, якими міряв» мусять читатись як дві.
   * `.clean span` у шаблоні — `display:block`, тож окремий `<span>` і є
   * окремим блоком у картці. Тест дивиться на РОЗМІТКУ, а не на текст:
   * склеювання половин назад в один рядок дало б той самий видимий текст,
   * і асерт на текст такої регресії не побачив би.
   */
  it("R37: половини параметрів стоять окремими блоками картки, а не одним рядком", () => {
    const чистаPagination: PaginationReport = {
      docName: "книга.indd",
      folio: { checked: 131, deviating: 0, notCompared: 0, groups: [] },
      contents: null, runningHead: null, detail: null, detailTruncated: null,
      missingStyles: [], masterSkipped: [], masterIslands: [],
    };
    const виміри: Measurements = зробитиВиміри();
    виміри.passes = [
      ...виміри.passes,
      {
        id: "pagination", tool: "pagination_audit", ok: true, elapsedMs: 10,
        data: чистаPagination, error: null,
        args: { folio: { styleNames: ["Колонтитул v1"] }, detail: { family: "folio" } },
        defaulted: ["detail"],
      },
    ];
    const html = buildReportHtml(конфіг, виміри, [
      ...зробитиПроходи(),
      { id: "pagination", tool: "pagination_audit", args: {}, critical: true, timeoutHintMs: 1000 },
    ]);
    const clean = /<div class="clean">[\s\S]*?\n {2}<\/div>/.exec(html);
    expect(clean).not.toBeNull();
    /* Назва проходу й інструмент тепер кожне у власному <span> — цього вимагає
     * кнопка мови: перемикач заміняє textContent, і текст, що лежить голим у
     * <div>, перемкнути було б нічим. */
    const картка =
      /<div><b>✓<\/b><div><span [^>]*>pagination<\/span> \(<span [^>]*>pagination_audit<\/span>\)[\s\S]*?<\/div><\/div>/.exec(
        clean![0],
      );
    expect(картка, "картки pagination немає серед «чисто»").not.toBeNull();
    const усіСпани = [...картка![0].matchAll(/<span [^>]*>([^<]*)<\/span>/g)].map((m) => m[1]);
    /* Перші два — назва проходу й інструмент; далі йдуть вимір і блоки параметрів. */
    const блоки = усіСпани.slice(2);
    /* Лапки очікуються вже як `&quot;` — це та сама розмітка, що піде в
     * браузер, і водночас доказ, що екранування спрацювало РІВНО раз:
     * подвійне дало б `&amp;quot;`. */
    expect(блоки).toEqual([
      "тверджень перевірено: 131",
      "задано в конфігу: folio: {&quot;styleNames&quot;:[&quot;Колонтитул v1&quot;]}",
      "замовчування інструмента (ніхто їх не обирав): detail: {&quot;family&quot;:&quot;folio&quot;}",
    ]);
  });

  /*
   * I3 (фінальна рецензія, Important): у шапці стояв ЖОРСТКО ВПИСАНИЙ рядок
   * «формат не виміряно», тоді як формат виміряно — `ExtrasMeasure.pageFormat`,
   * і `summariseExtras` друкує його ж в іншій секції ТОГО САМОГО звіту
   * («Формат сторінки: 190 × 220 pt»). Шапка суперечила тілу.
   */
  /*
   * Раунд виправлень 1, знахідка контролера №2: фікстура тепер несе ТІ САМІ
   * числа, що прийшли з живого прогону справжньої книжки — 538.582677165354 ×
   * 623.622047244095 pt і виліт 8.50393700787402 pt. Круглі «190 × 220 pt»
   * попередньої редакції не могли зловити ваду взагалі: округляти в них
   * нічого, і тест лишався зеленим на нечитному звіті.
   */
  const реальнийФормат = {
    pageFormat: { width: 538.582677165354, height: 623.622047244095, units: "pt" },
    bleed: {
      top: 8.50393700787402, bottom: 8.50393700787402,
      inside: 0, outside: 8.50393700787402,
    },
  };

  it("I3: формат сторінки в шапці береться з виміру, а не з рядка «формат не виміряно»", () => {
    const m = зробитиВиміри();
    m.passes = m.passes.map((p) =>
      p.tool === "__cli_extras"
        ? { ...p, data: { ...extrasData, ...реальнийФормат } satisfies ExtrasMeasure }
        : p,
    );
    const html = buildReportHtml(конфіг, m, зробитиПроходи());
    expect(html).not.toMatch(/формат не виміряно/);
    /* Плитка шапки — міліметрами, які й замовляє друкарня. */
    expect(html).toContain("190 × 220 мм, виліт 3/3/0/3 мм");
  });

  it("округлення: сирі 538.582677165354 в готовий звіт НЕ потрапляють НІДЕ", () => {
    const m = зробитиВиміри();
    m.passes = m.passes.map((p) =>
      p.tool === "__cli_extras"
        ? { ...p, data: { ...extrasData, ...реальнийФормат } satisfies ExtrasMeasure }
        : p,
    );
    const html = buildReportHtml(конфіг, m, зробитиПроходи());
    /* Ані формат, ані виліт — п'ятнадцять знаків після коми читаються як шум. */
    expect(html).not.toContain("538.582677165354");
    expect(html).not.toContain("623.622047244095");
    expect(html).not.toContain("8.50393700787402");
    /* Але сам ВИМІР не втрачено: пункти лишились у картці «чисто», округлені до сотої. */
    expect(html).toContain("538.58 × 623.62 pt");
    expect(html).toContain("8.5/8.5/0/8.5");
  });

  /*
   * Одиниця виміру не підмінюється: якби JSX колись віддав не пункти,
   * перекладати їх у міліметри коефіцієнтом «дюйм = 25.4 мм = 72 pt» було б
   * неправдою. Тоді число друкується своєю власною одиницею — округленим до
   * сотої, але не перекладеним (раунд виправлень 2, Minor 2: доти шапка
   * друкувала його тут СИРИМ, а картка «чисто» — округленим).
   */
  it("не-пункти в вимірі НЕ перекладаються в міліметри, а друкуються своєю одиницею", () => {
    const m = зробитиВиміри();
    m.passes = m.passes.map((p) =>
      p.tool === "__cli_extras"
        ? {
            ...p,
            data: {
              ...extrasData,
              pageFormat: { width: 190, height: 220, units: "mm" },
              bleed: { top: 3, bottom: 3, inside: 0, outside: 3 },
            } satisfies ExtrasMeasure,
          }
        : p,
    );
    const html = buildReportHtml(конфіг, m, зробитиПроходи());
    expect(html).toContain("190 × 220 mm");
    expect(html).not.toContain("67 × 77.6 мм");
  });

  /*
   * Раунд виправлень 2, Minor 2. Круглі «190 × 220 mm» тесту вище розбіжність
   * зловити не могли: на них сире й округлене однакові. Тут — той самий
   * не-пунктовий вимір із хвостом, і саме на ньому шапка з карткою
   * розходились: плитка друкувала `${f.width}` як є, картка «чисто» —
   * `короткеЧисло(…, 2)`. Тест стверджує ОДНАКОВІСТЬ двох показів, а не
   * конкретну реалізацію: будь-яке повернення до двох форматувань його рве.
   */
  it("Minor 2: шапка й картка показують не-пунктовий вимір ОДНАКОВО, обидві округлено", () => {
    const m = зробитиВиміри();
    m.passes = m.passes.map((p) =>
      p.tool === "__cli_extras"
        ? {
            ...p,
            data: {
              ...extrasData,
              pageFormat: { width: 190.04999999999998, height: 220.00000000000003, units: "mm" },
              bleed: {
                top: 3.0000000000000004, bottom: 3.0000000000000004,
                inside: 0, outside: 3.0000000000000004,
              },
            } satisfies ExtrasMeasure,
          }
        : p,
    );
    const html = buildReportHtml(конфіг, m, зробитиПроходи());
    expect(html).not.toContain("190.04999999999998");
    expect(html).not.toContain("220.00000000000003");
    expect(html).not.toContain("3.0000000000000004");
    /*
     * Шість разів, а не двічі, і це наслідок кнопки мови: місць так само ДВА
     * (плитка шапки й текст доміру «Формат сторінки: …»), але кожне тепер
     * несе значення тричі — у `data-uk`, у `data-en` і як видимий текст.
     * Число саме по собі мовою не відрізняється, тож в обох атрибутах воно
     * однакове. Округлення перевіряють рядки вище — саме вони тут головні.
     */
    expect([...html.matchAll(/190\.05 × 220 mm/g)]).toHaveLength(6);
    expect(html).toContain("виліт 3/3/0/3 mm");
    /* І далі не перекладено в міліметри коефіцієнтом пунктів. */
    expect(html).not.toMatch(/мм/);
  });

  it("I3: коли доміру НЕ було, «формат не виміряно» лишається — бо тоді це правда", () => {
    const m = зробитиВиміри();
    m.passes = m.passes.filter((p) => p.tool !== "__cli_extras");
    const html = buildReportHtml(конфіг, m, зробитиПроходи());
    expect(html).toMatch(/формат не виміряно/);
  });

  /*
   * I5 (рулінг R42): контрольне число, якого не міряє ЖОДЕН прохід, — це
   * прогалина СПРОМОЖНОСТІ, і друкарня мусить прочитати про неї в «Чого
   * перевірка НЕ бачила», а не гадати над «н/д» у шапці.
   */
  it("I5/R42: прогалини спроможності (макс. фарба, лінки в нормі) названі в «не бачили»", () => {
    const html = buildReportHtml(конфіг, зробитиВиміри(), зробитиПроходи());
    expect(html).toMatch(/tacSurvey/);
    expect(html).toMatch(/скалярн/i);
    expect(html).toMatch(/LINK_OK/);
  });

  /*
   * I6 (фінальна рецензія, Important): шапка рахувала РЯДКИ таблиць, а
   * рядкових адаптерів для typography/layout/composition немає — їхні
   * знахідки не потрапляли в «Важливих» узагалі, тоді як «Потребує очей»
   * показувало для них своє число.
   */
  it("I6: «Важливих» рахує ЗНАХІДКИ (разом із typography), а не рядки таблиці", () => {
    const m = зробитиВиміри();
    m.passes = [
      ...m.passes,
      {
        id: "typography", tool: "typography_audit", ok: true, elapsedMs: 1, error: null,
        args: {}, defaulted: [],
        data: {
          groups: [{ ruleId: "quotes-uk", title: "Лапки", total: 8, samples: [], needsReview: [] }],
          totalMatches: 8,
          auditOnly: [],
          spelling2019: { ukrainianRuns: 1200, skippedByLanguage: 0 },
          piv2019: { ukrainianRuns: 1200, skippedByLanguage: 0 },
        },
      },
    ];
    const проходи: Pass[] = [
      ...зробитиПроходи(),
      { id: "typography", tool: "typography_audit", args: {}, critical: false, timeoutHintMs: 1000 },
    ];
    const html = buildReportHtml(конфіг, m, проходи);
    /* spelling 1 + extras 259 (66 + 193) + typography 8 = 268. */
    expect(html).toMatch(/<dt[^>]*>Важливих<\/dt><dd>268<\/dd>/);
    /* І тим самим числом типографіка мусить бути видима в таблиці «major». */
    expect(секція(html, "major")).toMatch(/8 знахідок без поіменних адрес/);
  });

  it("I6: непідтверджений вимір НЕ додається до «Критичних», але має рядок у таблиці", () => {
    const m = зробитиВиміри();
    m.passes = m.passes.map((p) =>
      p.tool === "color_audit"
        ? { ...p, data: { ...colorData, findings: [], findingCount: 0, unreadSurfaces: ["pageItem"] } }
        : p,
    );
    const html = buildReportHtml(конфіг, m, зробитиПроходи());
    expect(html).toMatch(/<dt[^>]*>Критичних<\/dt><dd>0<\/dd>/);
    expect(секція(html, "crit")).toMatch(/вимір НЕ підтверджений приладом/);
  });

  /*
   * I2 (рулінг R46): шапка не сміє суперечити кодові виходу. Ворота на
   * упалій критичній родині тепер горять (`hasCritical`, I1), знахідок при
   * цьому нуль — і без цих двох ознак шапки читач бачив би «Критичних 0»
   * на прогоні, який кольору не міряв узагалі.
   *
   * Перевіряються ОБИДВІ ознаки: плитка з числом (скільки) і речення в
   * підводці (яка саме родина й чому звіт не «чисто»). Плитка без речення
   * не каже, чому код виходу червоний; речення без плитки не дає числа.
   */
  it("I2: упала КРИТИЧНА родина — шапка називає невимір, а не показує «нуль критичних»", () => {
    const m = зробитиВиміри();
    m.passes = m.passes.map((p) =>
      p.tool === "color_audit"
        ? { ...p, ok: false, data: null, error: "InDesign не відповів за 120 с" }
        : p,
    );
    const html = buildReportHtml(конфіг, m, зробитиПроходи());
    /* Знахідок справді нуль — їх ніхто не міряв, і шапка тут не бреше. */
    expect(html).toMatch(/<dt[^>]*>Критичних<\/dt><dd>0<\/dd>/);
    /* Але поруч стоїть число невиміряного — доти його не друкував НІХТО. */
    expect(html).toMatch(/<dt[^>]*>Не виміряно<\/dt><dd>1<\/dd>/);
    /* І підводка називає родину та причину, чому нуль читати як «чисто» не можна. */
    expect(html).toContain("критичних перевірок без результату — 1 (color)");
    expect(html).toContain("саме через це прогін завершено як критичний");
  });

  it("I2: коли все виміряно, попередження НЕ з'являється — інакше читач навчиться його проминати", () => {
    const html = buildReportHtml(конфіг, зробитиВиміри(), зробитиПроходи());
    expect(html).toMatch(/<dt[^>]*>Не виміряно<\/dt><dd>0<\/dd>/);
    expect(html).not.toContain("критичних перевірок без результату");
  });

  /*
   * Раунд виправлень 1, знахідка контролера №1 (живий прогін): усі 12 проходів
   * ✓, а плитка казала «Не виміряно 2» — одна одиниця з них була зондом
   * сеансу, і вона стояла б там ЗАВЖДИ. Тест тримає ЗДОРОВИЙ прогін із
   * зондом на нулі й вимагає, щоб сам зонд при цьому не зник, а стояв у
   * «чисто» зі своїми числами. Дані зонда — справжня форма `StatusShape`,
   * числа з того самого живого прогону.
   */
  it("раунд 1: зонд сеансу більше НЕ завищує «Не виміряно» — здоровий прогін дає нуль", () => {
    const statusData: StatusShape = {
      version: "21.5.1.73",
      documents: [{ name: "Book 260816-1250.indd", fullName: "/т/к.indd", modified: false }],
      activeDocument: "Book 260816-1250.indd",
    };
    const m = зробитиВиміри();
    m.passes = [
      { id: "status", tool: "indesign_status", ok: true, elapsedMs: 3, data: statusData, error: null, args: {}, defaulted: [] },
      ...m.passes,
    ];
    const html = buildReportHtml(конфіг, m, зробитиПроходи());
    expect(html).toMatch(/<dt[^>]*>Не виміряно<\/dt><dd>0<\/dd>/);
    /* І зонд не зник: його числа стоять у звіті. */
    expect(html).toContain("21.5.1.73");
    expect(html).toContain("відкритих документів: 1");
  });

  it("відсутність overview НЕ кидає — «Сторінок» чесно позначено, а не вигадано", () => {
    const без: Measurements = зробитиВиміри();
    без.passes = без.passes.filter((p) => p.tool !== "doc_overview");
    const html = buildReportHtml(конфіг, без, зробитиПроходи());
    expect(html).not.toMatch(/\{\{/);
    /* «н/д» — одне з небагатьох значень шапки, що ВІДРІЗНЯЄТЬСЯ мовою, тож
     * воно їде двомовним прогоном, а не голим текстом. Видима половина —
     * українська: звіт відкривається нею. */
    expect(html).toMatch(/<dt[^>]*>Сторінок<\/dt><dd><span [^>]*>н\/д<\/span>/);
    expect(html).toMatch(/data-en="n\/a"/);
  });
});

/*
 * I8 (фінальна рецензія, Important): прибирання за собою — ОБИДВІ дії, у
 * правильному порядку, і жодна не сміє кинути. Вада була не в змісті цих
 * дій, а в тому, що на шляху збою середовища виконувалась лише ОДНА з них
 * (`restoreActiveDocument`), а документ, який CLI відкрив САМ, лишався
 * відкритим — усупереч спек §6.1.
 */
describe("прибратиЗаСобою — I8", () => {
  function сеанс(
    поведінка: Partial<{ releaseКидає: Error; restoreПовертає: string | null; причина: string | null }> = {},
  ): { session: SessionHandle; порядок: string[] } {
    const порядок: string[] = [];
    const session: SessionHandle = {
      stamp: {
        indesignVersion: "20.0", docName: "к.indd", docPath: "/т/к.indd",
        modified: false, wasAlreadyOpen: false, openDocumentCount: 1,
        dictionaryPath: null, locale: "uk", sessionUptimeMs: null,
        releaseSkippedReason: поведінка.причина ?? null,
      },
      async release() {
        порядок.push("release");
        if (поведінка.releaseКидає) throw поведінка.releaseКидає;
      },
      async restoreActiveDocument() {
        порядок.push("restore");
        return поведінка.restoreПовертає ?? null;
      },
    };
    return { session, порядок };
  }

  it("закриває документ, і ЛИШЕ ПОТІМ повертає спереду попередній активний", async () => {
    const { session, порядок } = сеанс();
    await прибратиЗаСобою(session, () => undefined);
    expect(порядок).toEqual(["release", "restore"]);
  });

  it("збій закриття НЕ кидає й НЕ зупиняє повернення активного — це `finally`", async () => {
    const { session, порядок } = сеанс({ releaseКидає: new Error("міст мовчить") });
    const попередження: string[] = [];
    await expect(прибратиЗаСобою(session, (р) => попередження.push(р))).resolves.toBeUndefined();
    expect(порядок).toEqual(["release", "restore"]);
    expect(попередження.join(" ")).toMatch(/міст мовчить/);
  });

  it("причина, з якої документ НЕ закрито, доходить до оператора, а не мовчить у відбитку", async () => {
    const { session } = сеанс({ причина: "документ має незбережені зміни" });
    const попередження: string[] = [];
    await прибратиЗаСобою(session, (р) => попередження.push(р));
    expect(попередження.join(" ")).toMatch(/незбережені зміни/);
  });
});

/*
 * I5 (рулінг R42, «дешевий виняток»): overset уже обчислювався, але жив
 * ЛИШЕ в HTML — у `measurements.json`, яким §4.2 велить порівнювати два
 * прогони, його не було. Обчислення лишається одне (`overset()` в
 * `audit.ts`); ця функція лише знаходить для нього прохід.
 */
describe("oversetЗВимірів — I5", () => {
  function зPreflight(звіт: Partial<PreflightReport>): Measurements {
    const m = зробитиВиміри();
    m.passes = [
      ...m.passes,
      {
        id: "preflight", tool: "preflight_document", ok: true, elapsedMs: 1, error: null,
        args: {}, defaulted: [],
        data: {
          docName: "к.indd", profileName: "[Basic]", workingProfile: "[Basic]",
          preflightOff: false, scope: "PREFLIGHT_ALL_PAGES", availableProfiles: ["[Basic]"],
          rulesEnabled: 6, rulesDisabled: 32, enabledRuleIds: ["ADBE_OversetText"],
          disabledRuleIds: [], findings: [], occurrenceCount: 0, occurrencesTruncated: null,
          shapeRecognised: true, rowsSeen: 0, rowsParsed: 0, pairsSeen: 0, pairsParsed: 0,
          processRemoved: true, waitTimedOut: false, waitPolarity: null, caveat: "",
          ...звіт,
        } satisfies PreflightReport,
      },
    ];
    return m;
  }

  it("правило увімкнене й порушень немає — число, придатне для порівняння прогонів", () => {
    expect(oversetЗВимірів(зPreflight({})).uk).toBe("0");
  });

  it("правило вимкнене — «н/д», а не мовчазний нуль", () => {
    expect(oversetЗВимірів(зPreflight({ disabledRuleIds: ["ADBE_OversetText"] })).uk).toMatch(/н\/д/);
  });

  it("те саме число потрапляє й у шапку звіту — одне обчислення, два споживачі", () => {
    const m = зPreflight({
      findings: [
        {
          category: "TEXT", rule: "Overset text", occurrenceCount: 3,
          occurrences: [{ page: "3", object: "Text Frame", description: "Overset", details: [] }],
        },
      ],
      occurrenceCount: 3,
    });
    m.overset = oversetЗВимірів(m).uk;
    expect(m.overset).toBe("3");
    const html = buildReportHtml(конфіг, m, [
      ...зробитиПроходи(),
      { id: "preflight", tool: "preflight_document", args: {}, critical: true, timeoutHintMs: 1000 },
    ]);
    expect(html).toMatch(/<dt[^>]*>Overset<\/dt><dd>3<\/dd>/);
  });
});

/*
 * Та сама заборона, що в `cli-template.test.ts`, але на ГОТОВОМУ звіті:
 * шаблон — не єдине джерело тексту, і `\uXXXX` може приїхати з коду
 * (підпис секції, назва проходу, причина відмови). Сторожа на обох кінцях
 * коштує два рядки, а ловить увесь клас: у HTML це вісім літер, а не символ.
 */
describe("у зібраному звіті немає невитлумачених екранувань", () => {
  it("жодного \\uXXXX у готовому HTML", () => {
    const html = buildReportHtml(конфіг, зробитиВиміри(), зробитиПроходи());
    const знайдені = [...html.matchAll(/\\u[0-9a-fA-F]{4}/g)].map((m) => m[0]);
    expect(знайдені, `у HTML це вісім літер: ${знайдені.join(", ")}`).toEqual([]);
  });

  it("готовий звіт оголошує utf-8", () => {
    const html = buildReportHtml(конфіг, зробитиВиміри(), зробитиПроходи());
    expect(html).toMatch(/<meta\s+charset=["']utf-8["']/i);
  });
});

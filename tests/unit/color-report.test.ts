import { describe, expect, it } from "vitest";
import {
  buildReport,
  MAX_DETAIL_ROWS,
  MAX_DETAIL_ROWS_PER_FAMILY,
  MAX_PAGES_PER_ROW,
} from "../../src/color/report.js";
import type { ColorFinding, ColorMeasure } from "../../src/color/types.js";

function measure(over: Partial<ColorMeasure> = {}): ColorMeasure {
  return {
    docName: "Книжка.indd", ms: 1200, inkCount: 4,
    inkNames: ["Process Cyan", "Process Magenta", "Process Yellow", "Process Black"],
    layers: [{ name: "01", printable: true, visible: true }],
    sites: [], counters: [
      { surface: "pageItem", seen: 1128, parsed: 1128, failed: 0 },
      { surface: "textRange", seen: 2417, parsed: 2417, failed: 0 },
    ],
    links: [
      { name: "Mother_1.psd", ownerKind: "Image", page: "2", space: "CMYK",
        profile: "Use Document Default", status: "NORMAL", inkMeasurable: false },
    ],
    ...over,
  };
}

function options(over: Record<string, unknown> = {}) {
  return {
    families: ["tac", "black", "palette", "space", "overprint"] as const,
    maxTotalInk: 300, richBlackMaxPointSize: 24, expectedInks: 4,
    includeNonPrinting: false, includeHidden: false, paletteThresholdNamed: false,
    sitesJudged: 3545, sitesSkippedNonPrinting: 0, sitesSkippedHidden: 0,
    sitesSkippedNoInk: 0, sitesOverprintUnknown: 0,
    tacSurvey: null, paletteSurvey: null,
    ...over,
  } as never;
}

const finding: ColorFinding = {
  family: "tac", rule: "tac-over-limit", color: "безіменний CMYK 76/48/66/70",
  totalInk: 260, count: 84, surfaces: ["pageItem"],
  pages: ["17", "25"], pagesTotal: 2, examples: ["GraphicLine"],
};

describe("buildReport", () => {
  it("застереження називає МЕЖУ ФАРБИ як ужиту, а не виведену з документа", () => {
    const r = buildReport(measure(), [], options());
    expect(r.caveat).toContain("300");
    expect(r.caveat).toContain("used");
  });

  it("застереження називає невимірні розміщення поіменно, а не мовчить про них", () => {
    const r = buildReport(measure(), [], options());
    expect(r.caveat).toContain("Mother_1.psd");
  });

  it("нуль знахідок НЕ подається як «чисто»", () => {
    const r = buildReport(measure(), [], options());
    expect(r.caveat).not.toContain("clean");
    expect(r.findingCount).toBe(0);
  });

  it("рахує ВИПАДКИ, а не рядки: 84 елементи в одному рядку — це 84", () => {
    const r = buildReport(measure(), [finding], options());
    expect(r.findingCount).toBe(1);
    expect(r.occurrenceCount).toBe(84);
  });

  it("обрізає рядки деталей і каже, скільки їх було насправді", () => {
    /* Стеля тепер НА РОДИНУ, тож однорідний список ріжеться до неї, а не до
     * спільних шістдесяти. Причина — в наступному тесті. */
    const many: ColorFinding[] = [];
    for (let i = 0; i < MAX_DETAIL_ROWS_PER_FAMILY + 15; i++) {
      many.push({ ...finding, color: `колір ${i}` });
    }
    const r = buildReport(measure(), many, options());
    expect(r.findings).toHaveLength(MAX_DETAIL_ROWS_PER_FAMILY);
    expect(r.findingsTruncated?.shown).toBe(MAX_DETAIL_ROWS_PER_FAMILY);
    expect(r.findingsTruncated?.total).toBe(MAX_DETAIL_ROWS_PER_FAMILY + 15);
  });

  /*
   * ЗАРАДИ ЧОГО СТЕЛЮ ВЗАГАЛІ ЗМІНЕНО.
   *
   * Плаский slice(0, 60) різав за порядком складання родин у tools/color.ts:
   * tac → black → palette → space → overprint. Отже досить понад шістдесяти
   * знахідок TAC — і кожен рядок overprint зникав із відповіді цілком, разом
   * із overprint-on-white, який сам модуль зве найдорожчим: на екрані видно,
   * на відбитку зникає. Те саме, проти чого прямо застерігає
   * src/typography/auditcap.ts: «рідкісний вид витісняє частий».
   */
  it("рясна родина НЕ витісняє рідкісну з переліку", () => {
    const many: ColorFinding[] = [];
    for (let i = 0; i < 200; i++) {
      many.push({ ...finding, family: "tac", rule: "tac-over-limit", color: `колір ${i}` });
    }
    many.push({ ...finding, family: "overprint", rule: "overprint-on-white", color: "Paper" });

    const r = buildReport(measure(), many, options());
    const families = new Set(r.findings.map((f) => f.family));
    expect(families.has("overprint"), "родину overprint витіснено з переліку").toBe(true);
    expect(r.findings.filter((f) => f.family === "tac")).toHaveLength(MAX_DETAIL_ROWS_PER_FAMILY);
  });

  it("зрізані родини названі поіменно, а не сховані за спільним числом", () => {
    /* «Показано 60 зі 140» не дає читачеві підстав запідозрити, що цілої
     * родини в переліку немає. Тепер дає. */
    const many: ColorFinding[] = [];
    for (let i = 0; i < 40; i++) many.push({ ...finding, family: "tac", color: `к ${i}` });
    for (let i = 0; i < 3; i++) many.push({ ...finding, family: "palette", color: `п ${i}` });

    const r = buildReport(measure(), many, options());
    const cut = r.findingsTruncated?.byFamily ?? [];
    expect(cut.map((c) => c.family)).toEqual(["tac"]);
    expect(cut[0]).toEqual({ family: "tac", shown: MAX_DETAIL_ROWS_PER_FAMILY, total: 40 });
  });

  it("обрізає список сторінок у рядку й лишає повне число", () => {
    const pages: string[] = [];
    for (let i = 1; i <= MAX_PAGES_PER_ROW + 40; i++) pages.push(String(i));
    const r = buildReport(measure(), [{ ...finding, pages, pagesTotal: pages.length }], options());
    expect(r.findings[0]!.pages).toHaveLength(MAX_PAGES_PER_ROW);
    expect(r.findings[0]!.pagesTotal).toBe(MAX_PAGES_PER_ROW + 40);
  });

  it("пропущені недруковані шари називаються числом, інакше вони невидимі", () => {
    const r = buildReport(measure(), [], options({ sitesSkippedNonPrinting: 8 }));
    expect(r.caveat).toContain("8");
  });

  it("поверхня з parsed = 0 позначена окремо: це «не прочитали», а не «чисто»", () => {
    const m = measure({ counters: [{ surface: "tableCell", seen: 12, parsed: 0, failed: 12 }] });
    const r = buildReport(m, [], options());
    expect(r.unreadSurfaces).toContain("tableCell");
  });

  it("поверхня, якої в документі немає, НЕ вважається непрочитаною", () => {
    const m = measure({ counters: [{ surface: "tableCell", seen: 0, parsed: 0, failed: 0 }] });
    const r = buildReport(m, [], options());
    expect(r.unreadSurfaces).not.toContain("tableCell");
  });

  // Ruling 6: приховані шари — окрема причина пропуску від недрукованих.
  it("пропущені приховані шари названі окремо від недрукованих", () => {
    const r = buildReport(
      measure(),
      [],
      options({ sitesSkippedHidden: 6, sitesSkippedNonPrinting: 196 }),
    );
    expect(r.caveat).toContain("6");
    expect(r.caveat).toContain("196");
    expect(r.caveat).toContain("HIDDEN");
  });

  // Ruling 8: місця без фарби через геометрію (нульова площа заливки,
  // нульова товщина обведення) рахуються окремо від пропусків через шар.
  it("пропущені через геометрію названі окремо від пропущених через шар", () => {
    const r = buildReport(measure(), [], options({ sitesSkippedNoInk: 84 }));
    expect(r.caveat).toContain("84");
    expect(r.caveat).toContain("zero-area");
  });

  // Ruling 12: overprint на нульовій фарбі не читається InDesign 21.5.1.73 —
  // мовчання правила overprint-on-white мусить бути видимим числом.
  it("нечитний overprint названо числом — мовчання правила стає видимим", () => {
    const r = buildReport(measure(), [], options({ sitesOverprintUnknown: 3 }));
    expect(r.caveat).toContain("NOT READ");
    expect(r.caveat).toContain("3");
  });

  it("коли overprint читається скрізь, зайвого речення немає", () => {
    const r = buildReport(measure(), [], options({ sitesOverprintUnknown: 0 }));
    expect(r.caveat).not.toContain("NOT READ");
  });

  it("findingsTruncated ВІДСУТНІЙ, коли знахідок не більше стелі", () => {
    const r = buildReport(measure(), [finding], options());
    expect(r.findingsTruncated).toBeUndefined();
  });

  it("рівно стеля родини — межовий випадок, НЕ обрізання", () => {
    const exact: ColorFinding[] = [];
    for (let i = 0; i < MAX_DETAIL_ROWS_PER_FAMILY; i++) {
      exact.push({ ...finding, color: `колір ${i}` });
    }
    const r = buildReport(measure(), exact, options());
    expect(r.findings).toHaveLength(MAX_DETAIL_ROWS_PER_FAMILY);
    expect(r.findingsTruncated).toBeUndefined();
  });

  it("п'ять родин по стелі кожна дають ті самі 60 рядків, що й давала спільна стеля", () => {
    /* Бюджет відповіді не зріс: 5 × 12 = 60. Змінилося не скільки рядків, а
     * ЯК вони розподілені між родинами. */
    const all: ColorFinding[] = [];
    for (const family of ["tac", "black", "palette", "space", "overprint"] as const) {
      for (let i = 0; i < 50; i++) all.push({ ...finding, family, color: `${family} ${i}` });
    }
    const r = buildReport(measure(), all, options());
    expect(r.findings).toHaveLength(MAX_DETAIL_ROWS);
  });
});

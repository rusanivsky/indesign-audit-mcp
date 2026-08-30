import { describe, expect, it } from "vitest";
import {
  DASH_SEPARATOR_WARNING,
  UNIFORMITY_SILENT_WARNING,
  buildReport,
} from "../../src/bibliography/report.js";
import type { Finding, SkippedParagraph, UniformityFact } from "../../src/bibliography/types.js";

const f = (ruleId: string, n: number): Finding => ({
  ruleId, title: "Т", confidence: "high", recordNumber: n, containerId: "story:0",
  page: "20", zone: "imprint", start: n, end: n + 1, before: "-", suggested: "–",
  contextBefore: "", contextAfter: "", basis: "ДСТУ ГОСТ 7.1:2006",
});

describe("buildReport", () => {
  it("групує за правилом і обмежує вибірку", () => {
    const findings = Array.from({ length: 500 }, (_, i) => f("bib-zone-separator", i));
    const r = buildReport({ findings, uniformity: [], skipped: [], records: 500, unparsed: 0, sampleSize: 10 });
    expect(r.groups[0]?.total).toBe(500);
    expect(r.groups[0]?.samples).toHaveLength(10);
  });

  it("ставить вердикт однорідності ПОРУЧ із числом", () => {
    /*
     * Спек §8: без цього поля 16 154 знахідки прочитаються як поломка
     * інструмента, а не як одна заміна.
     */
    const uniformity: UniformityFact[] = [{
      id: "zone-separator",
      forms: [{ value: "-", count: 16154 }, { value: "–", count: 289 }],
      dominantShare: 0.982,
      verdict: "systematic",
    }];
    const r = buildReport({
      findings: [f("bib-zone-separator", 1)], uniformity, skipped: [],
      records: 100, unparsed: 0, sampleSize: 10,
    });
    expect(r.groups[0]?.verdict).toBe("systematic");
  });

  it("ЗАВЖДИ попереджає про dash-separator, коли є записи", () => {
    const r = buildReport({ findings: [], uniformity: [], skipped: [], records: 42, unparsed: 0, sampleSize: 10 });
    expect(r.warnings).toContain(DASH_SEPARATOR_WARNING);
  });

  it("не попереджає, коли записів немає взагалі", () => {
    const r = buildReport({ findings: [], uniformity: [], skipped: [], records: 0, unparsed: 0, sampleSize: 10 });
    expect(r.warnings).not.toContain(DASH_SEPARATOR_WARNING);
  });

  it("виносить needs-review окремо від упевнених", () => {
    const findings = [f("bib-abbrev", 1), { ...f("bib-abbrev", 2), confidence: "needs-review" as const }];
    const r = buildReport({ findings, uniformity: [], skipped: [], records: 50, unparsed: 0, sampleSize: 10 });
    expect(r.groups[0]?.samples).toHaveLength(1);
    expect(r.groups[0]?.needsReview).toHaveLength(1);
  });

  it("вердикт групи — НАЙСЛАБШИЙ із її фактів, а не перший-ліпший", () => {
    /*
     * bib-range-dash ловить і сторінкові, і річні діапазони під одним ruleId.
     * Якщо сторінкові системні, а річні розсипані, група НЕ є однією заміною —
     * і сказати «systematic» означало б послати оператора робити глобальну
     * заміну там, де треба поштучна правка.
     */
    const uniformity: UniformityFact[] = [
      { id: "page-range-dash", forms: [{ value: "-", count: 990 }, { value: "–", count: 10 }], dominantShare: 0.99, verdict: "systematic" },
      { id: "year-range-dash", forms: [{ value: "-", count: 50 }, { value: "–", count: 50 }], dominantShare: 0.5, verdict: "mixed" },
    ];
    const r = buildReport({
      findings: [f("bib-range-dash", 1)], uniformity, skipped: [],
      records: 100, unparsed: 0, sampleSize: 10,
    });
    expect(r.groups[0]?.verdict).toBe("mixed");
  });

  it("HEADINGS_WARNING присутній, коли є записи", () => {
    const r = buildReport({ findings: [], uniformity: [], skipped: [], records: 42, unparsed: 0, sampleSize: 10 });
    expect(r.warnings.some((w) => w.includes("global dash replacement"))).toBe(true);
  });

  it("nextStep згадує composition_audit", () => {
    const r = buildReport({ findings: [], uniformity: [], skipped: [], records: 1, unparsed: 0, sampleSize: 10 });
    expect(r.nextStep).toContain("composition_audit");
  });

  /*
   * Знахідка I1 фінальної рецензії: `samples` обмежувались `sampleSize`, а
   * `needsReview` — ні. На книжці це 14 432 об'єкти й 5,73 МБ компактного
   * JSON, а `ok()` (src/tools/shared.ts:9) серіалізує ще й з відступами.
   */
  it("needsReview обмежений так само, як samples, а ПОВНЕ число видно", () => {
    const findings = Array.from({ length: 20_000 }, (_, i) => ({
      ...f("bib-abbrev", i),
      confidence: "needs-review" as const,
    }));
    const r = buildReport({ findings, uniformity: [], skipped: [], records: 5000, unparsed: 0, sampleSize: 10 });
    expect(r.groups[0]?.needsReview).toHaveLength(10);
    expect(r.groups[0]?.needsReviewTotal).toBe(20_000);
    expect(r.groups[0]?.total).toBe(20_000);
    /* Головне: звіт лишається малим. 20 000 знахідок — не 20 000 об'єктів. */
    expect(JSON.stringify(r).length).toBeLessThan(20_000);
  });

  /*
   * Знахідка I2: спек §4 вимагає `{ reason, count, samples }` і прямо каже
   * чому — «мовчазна вибірка читається як "перевірено все"». Код зводив це до
   * самих чисел, і 6 927 мовчки відкинутих абзаців перевірити було нічим.
   */
  it("skipped повертає і числа, і ЗРАЗКИ, обмежені sampleSize", () => {
    const skipped: SkippedParagraph[] = Array.from({ length: 300 }, (_, i) => ({
      reason: i % 3 === 0 ? "heading" : "no-discriminator",
      text: `пропущений абзац ${i}`,
      start: i * 10,
    }));
    const r = buildReport({ findings: [], uniformity: [], skipped, records: 100, unparsed: 0, sampleSize: 5 });
    const heading = r.skipped.find((s) => s.reason === "heading");
    const noDisc = r.skipped.find((s) => s.reason === "no-discriminator");
    expect(heading?.count).toBe(100);
    expect(noDisc?.count).toBe(200);
    expect(heading?.samples).toHaveLength(5);
    expect(heading?.samples[0]?.text).toBe("пропущений абзац 0");
  });

  /*
   * Знахідка I3: спек §6 — «при records < 30 однорідність не рахується взагалі
   * Й ЗВІТ КАЖЕ, ЩО ПРОМОВЧАВ І ЧОМУ». Порожній `uniformity` без пояснення
   * не відрізнити від «усе однорідне».
   */
  it("мовчання однорідності на малій вибірці ПОЯСНЕНЕ у warnings", () => {
    const r = buildReport({ findings: [], uniformity: [], skipped: [], records: 12, unparsed: 0, sampleSize: 10 });
    expect(r.uniformity).toEqual([]);
    expect(r.warnings).toContain(UNIFORMITY_SILENT_WARNING);
  });

  it("на великій вибірці цього пояснення НЕМАЄ — інакше воно нічого не означає", () => {
    const r = buildReport({ findings: [], uniformity: [], skipped: [], records: 1159, unparsed: 0, sampleSize: 10 });
    expect(r.warnings).not.toContain(UNIFORMITY_SILENT_WARNING);
  });
});

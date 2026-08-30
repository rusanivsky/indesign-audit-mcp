import { describe, expect, it } from "vitest";
import type { ContainerSnapshot } from "../../src/corrections/types.js";
import { nbspFindings } from "../../src/bibliography/rules-nbsp.js";
import { assertNoBreakAnswersMatch, collectAudit } from "../../src/tools/bibliography.js";

const snap = (text: string): ContainerSnapshot => ({
  containerId: "story:0",
  text,
  pageRuns: [{ start: 0, end: text.length + 1, page: "20" }],
  oversetFrom: null,
  isMaster: false,
  kind: "text",
});

const REC = (n: number) =>
  `${n}. Прізвище, Ім'я По батькові. Назва / А. В. Прізвище // Журнал. - 2024. - С. 5-9.`;

describe("collectAudit", () => {
  it("збирає записи, кандидатів nbsp і знахідки dstu без звертання до InDesign", () => {
    const text = Array.from({ length: 40 }, (_, i) => REC(i + 1)).join("\r");
    const r = collectAudit([snap(text)], { standard: "7.1", layers: ["standard", "nbsp"] });
    expect(r.records).toBe(40);
    expect(r.nbspCandidates.length).toBeGreaterThan(0);
    expect(r.standardFindings.some((f) => f.ruleId === "bib-zone-separator")).toBe(true);
  });

  it("шар можна вимкнути", () => {
    const text = Array.from({ length: 40 }, (_, i) => REC(i + 1)).join("\r");
    const r = collectAudit([snap(text)], { standard: "7.1", layers: ["standard"] });
    expect(r.nbspCandidates).toEqual([]);
  });

  it("ruleIds фільтрує і шар dstu, і шар nbsp", () => {
    const text = Array.from({ length: 40 }, (_, i) => REC(i + 1)).join("\r");
    const r = collectAudit([snap(text)], {
      standard: "7.1",
      layers: ["standard", "nbsp"],
      ruleIds: ["bib-zone-separator"],
    });
    expect(r.standardFindings.every((f) => f.ruleId === "bib-zone-separator")).toBe(true);
    expect(r.standardFindings.length).toBeGreaterThan(0);
    /* "bib-nbsp-*" не входить у ruleIds — шар nbsp мовчить повністю. */
    expect(r.nbspCandidates).toEqual([]);
  });

  it("ЖОДНА знахідка не вказує на знак абзацу", () => {
    /*
     * closeOpen() зшиває абзаци символ-на-символ, щоб зберегти офсети. Якщо при
     * цьому \r стає звичайним пробілом, правила nbsp пропонують поставити U+00A0
     * НА МІСЦЕ знака абзацу — тобто злити два абзаци. Фінальна рецензія знайшла
     * це на формі «покажчика імен», де заголовок і назва — окремі абзаци.
     */
    const rec = (n: number) => `${n}. Прізвище, А. В.\rНазва праці / А. В. Прізвище // Журнал. – 2021. – С. 5-9.`;
    const text = Array.from({ length: 5 }, (_, i) => rec(i + 1)).join("\r\r");
    const snap = { containerId: "story:0", text, pageRuns: [{ start: 0, end: text.length + 1, page: "1" }], oversetFrom: null, isMaster: false, kind: "text" as const };
    const collected = collectAudit([snap], { standard: "7.1", layers: ["standard", "nbsp"] });
    const findings = [
      ...collected.standardFindings,
      ...nbspFindings(collected.nbspCandidates, collected.nbspCandidates.map(() => false)),
    ];
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(text.slice(f.start, f.end)).toBe(f.before);
      expect(f.before).not.toContain("\r");
    }
  });
});

/*
 * Перенесена знахідка із Задачі 9: `nbspFindings(candidates, answers)`
 * покладається на те, що `answers` — той самий масив за довжиною й
 * порядком, що й `candidates` (rules-nbsp.ts). Раніше коротший масив
 * мовчки означав «не захищено» для кожного зайвого кандидата — тисячі
 * хибних знахідок без жодної видимої причини. `assertNoBreakAnswersMatch`
 * — єдине місце, де відповідь `readNoBreak` зустрічається з кандидатами,
 * тож саме тут контракт мусить провалюватись гучно, а не мовчки.
 */
describe("assertNoBreakAnswersMatch", () => {
  it("однакова довжина — контракт дотримано, нічого не кидає", () => {
    expect(() => assertNoBreakAnswersMatch(5, 5)).not.toThrow();
  });

  it("нуль кандидатів і нуль відповідей — теж дотримано", () => {
    expect(() => assertNoBreakAnswersMatch(0, 0)).not.toThrow();
  });

  it("коротша відповідь — кидає зрозумілу помилку, а не мовчить", () => {
    expect(() => assertNoBreakAnswersMatch(9000, 4321)).toThrow(
      /9000.*4321|4321.*9000/su,
    );
  });

  it("довша відповідь так само провалюється гучно", () => {
    expect(() => assertNoBreakAnswersMatch(3, 5)).toThrow();
  });
});

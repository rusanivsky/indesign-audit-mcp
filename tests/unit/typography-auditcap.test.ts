import { describe, expect, it } from "vitest";
import { capAuditOnly, MAX_AUDIT_ONLY_PER_KIND } from "../../src/typography/auditcap.js";
import { serialise } from "../../src/tools/shared.js";

function finding(kind: string, start: number, containerId = "story:0") {
  return { kind, start, end: start + 1, contextBefore: "…".repeat(40), containerId };
}

function many(kind: string, n: number, from = 0) {
  return Array.from({ length: n }, (_, i) => finding(kind, from + i));
}

describe("capAuditOnly — стеля НА КОЖЕН РІД окремо", () => {
  it("рідкісний рід не витісняється частим", () => {
    /*
     * Головне твердження модуля. На робочій книжці 2026-08-16 усі 398
     * знахідок — `empty-paragraph`, тож спільна стеля «перші 50 у порядку
     * документа» там виглядала б бездоганно. На рукописі з Word розклад
     * буває протилежний, і одна табуляція серед сотень порожніх абзаців
     * зникла б МОВЧКИ — а саме вона там і цікава.
     */
    const findings = [...many("empty-paragraph", 300), finding("tab-indent", 900)];
    const r = capAuditOnly(findings, 25);
    expect(r.items.filter((f) => f.kind === "tab-indent")).toHaveLength(1);
    expect(r.items.filter((f) => f.kind === "empty-paragraph")).toHaveLength(25);
  });

  it("родів менше за стелю — обрізання немає, і поле про це не бреше", () => {
    const r = capAuditOnly([...many("empty-paragraph", 3), finding("tab-indent", 90)], 25);
    expect(r.items).toHaveLength(4);
    expect(r.truncated).toBeUndefined();
  });

  it("знахідок РІВНО стеля — це ще не обрізання", () => {
    const r = capAuditOnly(many("empty-paragraph", 25), 25);
    expect(r.items).toHaveLength(25);
    expect(r.truncated).toBeUndefined();
  });

  it("обрізано — сказано, скільки й чого", () => {
    const r = capAuditOnly([...many("empty-paragraph", 398), ...many("tab-indent", 30, 500)], 25);
    expect(r.truncated).toEqual([
      { kind: "empty-paragraph", shown: 25, total: 398 },
      { kind: "tab-indent", shown: 25, total: 30 },
    ]);
  });

  it("counts рахує ПОВНІ числа, а не показані", () => {
    const r = capAuditOnly([...many("empty-paragraph", 398), ...many("tab-indent", 30, 500)], 25);
    expect(r.counts).toEqual({ "empty-paragraph": 398, "tab-indent": 30 });
  });

  it("порядок документа всередині роду зберігається", () => {
    const r = capAuditOnly(many("empty-paragraph", 100), 3);
    expect(r.items.map((f) => f.start)).toEqual([0, 1, 2]);
  });

  it("не мутує вхідного масиву викликача", () => {
    const findings = many("empty-paragraph", 100);
    capAuditOnly(findings, 5);
    expect(findings).toHaveLength(100);
  });

  it("порожній вхід — порожній вихід, без полів про обрізання", () => {
    const r = capAuditOnly([], 25);
    expect(r.items).toEqual([]);
    expect(r.counts).toEqual({});
    expect(r.truncated).toBeUndefined();
  });

  it("стеля тримає ОБСЯГ: 398 знахідок важать не більше, ніж 25", () => {
    /* Заради чого стеля й з'явилась: виміряно на книжці 2026-08-16 —
     * `auditOnly` давав 66 738 Б, тобто 86 % усієї відповіді
     * typography_audit. Міряється тим самим серіалізатором, що й `ok()`. */
    const all = many("empty-paragraph", 398);
    const capped = Buffer.byteLength(serialise(capAuditOnly(all, 25)), "utf8");
    const uncapped = Buffer.byteLength(serialise(capAuditOnly(all, 398)), "utf8");
    expect(uncapped - capped).toBeGreaterThan(40_000);
  });

  it("замовчування стелі — 25 на рід", () => {
    /* Число з виміру: рядок знахідки важить ≈168 Б, тож два роди по 25 —
     * ≈8 КБ проти 67 КБ повного переліку. */
    expect(MAX_AUDIT_ONLY_PER_KIND).toBe(25);
  });
});

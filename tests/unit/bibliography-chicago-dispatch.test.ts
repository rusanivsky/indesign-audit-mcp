import { describe, expect, it } from "vitest";
import type { ContainerSnapshot } from "../../src/corrections/types.js";
import { collectAudit, normaliseLayers } from "../../src/tools/bibliography.js";
import { DSTU_RULES, type Standard } from "../../src/bibliography/rules-dstu.js";
import { CHICAGO_RULES } from "../../src/bibliography/rules-chicago.js";
import { CIP_RECORD } from "./fixtures/chicago-cip.js";

/** Both directions must hold, or the gate below only checks one of them. */
const STANDARD_VALUES = ["7.1", "8302"] as const;
type Listed = (typeof STANDARD_VALUES)[number];
type Exhaustive = [Standard] extends [Listed] ? ([Listed] extends [Standard] ? true : never) : never;
const exhaustiveGate: Exhaustive = true;

const snap = (text: string): ContainerSnapshot => ({
  containerId: "story:245",
  text,
  pageRuns: [{ start: 0, end: text.length + 1, page: "4" }],
  oversetFrom: null,
  isMaster: false,
  kind: "text",
});

describe("диспетч стандарту", () => {
  it("chicago знаходить запис там, де ДСТУ не знаходить жодного", () => {
    /* Рівно те, що зміряно на живому виданні: ДСТУ дав records: 0. */
    const dstu = collectAudit([snap(CIP_RECORD)], { standard: "7.1", layers: ["standard"] });
    expect(dstu.records).toBe(0);
    const chicago = collectAudit([snap(CIP_RECORD)], {
      standard: "chicago",
      layers: ["standard"],
    });
    expect(chicago.records).toBe(1);
  });

  it("під chicago НЕ спрацьовує жодне правило ДСТУ", () => {
    const r = collectAudit([snap(CIP_RECORD)], { standard: "chicago", layers: ["standard"] });
    const dstuIds = new Set(DSTU_RULES.map((x) => x.id));
    expect(r.standardFindings.length).toBeGreaterThan(0);
    expect(r.standardFindings.filter((f) => dstuIds.has(f.ruleId))).toEqual([]);
    expect(r.standardFindings.every((f) => CHICAGO_RULES.some((c) => c.id === f.ruleId))).toBe(
      true,
    );
  });

  it("ruleIds звужує родину Chicago, а не мовчки віддає всю", () => {
    const r = collectAudit([snap(CIP_RECORD)], {
      standard: "chicago",
      layers: ["standard"],
      ruleIds: ["chicago-colon-spacing"],
    });
    expect(new Set(r.standardFindings.map((f) => f.ruleId))).toEqual(
      new Set(["chicago-colon-spacing"]),
    );
  });

  it("без шару standard родина не біжить узагалі", () => {
    const r = collectAudit([snap(CIP_RECORD)], { standard: "chicago", layers: ["nbsp"] });
    expect(r.standardFindings).toEqual([]);
    /* Записи все одно сегментуються — шар вимикає СУДЖЕННЯ, а не читання. */
    expect(r.records).toBe(1);
  });

  it("«dstu» лишається застарілим синонімом «standard»", () => {
    expect(normaliseLayers(["dstu", "nbsp"])).toEqual(["standard", "nbsp"]);
    expect(normaliseLayers(["standard"])).toEqual(["standard"]);
    expect(normaliseLayers(["nbsp"])).toEqual(["nbsp"]);
  });

  it("ВОРОТА: Standard лишається рівно двочленним", () => {
    /*
     * Ці ворота — на рівні ТИПІВ, і виконуються вони не тут, а в `npm run
     * typecheck`, який охоплює й тести. Якщо `Standard` розросте до трьох
     * членів, `STANDARD_VALUES` перестане його вичерпувати, `Exhaustive`
     * стане `never`, і присвоєння нижче не збереться.
     *
     * Перша редакція цих воріт перевіряла АРНІСТЬ `check` — і була хибною:
     * `Function.length` рахує параметри до першого необов'язкового, а частина
     * правил ДСТУ оголошена як `check(parsed)` і другий параметр просто
     * ігнорує. Тест падав на здоровому коді, тобто міряв не те, що твердив.
     */
    expect(STANDARD_VALUES).toHaveLength(2);
    expect(exhaustiveGate).toBe(true);
  });

  it("кириличний контейнер під chicago дає нуль записів і чесну причину", () => {
    const uk = "Прізвище Ім'я.\rНазва / Ім'я Прізвище. — Київ : ВИДАВЕЦЬ, 2026. — 196 с.";
    const r = collectAudit([snap(uk)], { standard: "chicago", layers: ["standard"] });
    expect(r.records).toBe(0);
    expect(r.standardFindings).toEqual([]);
    expect(r.skipped.every((s) => s.reason === "cyrillic")).toBe(true);
  });
});

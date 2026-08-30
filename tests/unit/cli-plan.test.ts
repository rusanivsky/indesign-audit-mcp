import { describe, expect, it } from "vitest";
import { planPasses } from "../../src/cli/run/plan.js";
import { FAMILY_NAMES, type AuditConfig } from "../../src/cli/config/schema.js";

function конфіг(родини: Record<string, unknown>): AuditConfig {
  return {
    edition: { title: "К", docPath: "/т/к.indd" },
    print: { minPpi: 300, maxTotalInk: 240, expectedInks: 4 },
    families: {
      ...Object.fromEntries(FAMILY_NAMES.map((f) => [f, { notApplicable: "ні" }])),
      ...родини,
    },
  } as AuditConfig;
}

describe("planPasses", () => {
  it("statusi preflight виконуються завжди, незалежно від родин", () => {
    const { passes } = planPasses(конфіг({}));
    expect(passes.map((p) => p.tool)).toContain("indesign_status");
    expect(passes.map((p) => p.tool)).toContain("preflight_document");
  });

  it("doc_overview виконується завжди, незалежно від родин (R11)", () => {
    const { passes } = planPasses(конфіг({}));
    expect(passes.map((p) => p.tool)).toContain("doc_overview");
    expect(passes.find((p) => p.tool === "doc_overview")!.critical).toBe(false);
  });

  it("незастосовна родина не стає проходом, а стає пропуском із причиною", () => {
    const { passes, skipped } = planPasses(конфіг({ color: { notApplicable: "чорно-біле" } }));
    expect(passes.map((p) => p.id)).not.toContain("color");
    expect(skipped).toContainEqual({ family: "color", reason: "чорно-біле" });
  });

  /*
   * F2 (рулінг R29): `{"notApplicable": "…"}` можна оголосити не лише на
   * родині, а й на ПІДРОДИНІ — тим самим словником §5.1, рівнем нижче.
   * Прохід родини при цьому виконується; незастосовна одна підродина.
   */
  describe("незастосовна ПІДРОДИНА (R29)", () => {
    const cfg = конфіг({
      pagination: {
        folio: { styleName: "Колонтитул v1" },
        contents: { notApplicable: "числа змісту — інстанси текстової змінної" },
      },
    });

    it("родина ВИКОНУЄТЬСЯ: незастосовна підродина, а не вся родина", () => {
      const прохід = planPasses(cfg).passes.find((p) => p.id === "pagination");
      expect(прохід).toBeDefined();
      expect(прохід!.args.folio).toEqual({ styleName: "Колонтитул v1" });
    });

    it("службовий ключ НЕ доїжджає до інструмента — pagination_audit про notApplicable не знає", () => {
      const прохід = planPasses(cfg).passes.find((p) => p.id === "pagination")!;
      expect(прохід.args.contents).toBeUndefined();
      expect(Object.keys(прохід.args)).toEqual(["folio"]);
    });

    it("причина потрапляє в skipped із НАЗВОЮ підродини — інакше звіт про неї не скаже", () => {
      expect(planPasses(cfg).skipped).toContainEqual({
        family: "pagination",
        subfamily: "contents",
        reason: "числа змісту — інстанси текстової змінної",
      });
    });
  });

  it("передає ЧИСЛА ДРУКУ явно — жодне замовчування не сміє спрацювати", () => {
    const { passes } = planPasses(конфіг({ color: {}, geometry: { nearMissPt: 3 } }));
    const колір = passes.find((p) => p.id === "color")!;
    expect(колір.args.maxTotalInk).toBe(240);
    expect(колір.args.expectedInks).toBe(4);
    const геом = passes.find((p) => p.id === "geometry")!;
    expect(геом.args.minPpi).toBe(300);
    expect(геом.args.nearMissThresholdPt).toBe(3);
  });

  it("критичність родин — за переліком спека", () => {
    const { passes } = planPasses(конфіг({ color: {}, spelling: {} }));
    expect(passes.find((p) => p.id === "color")!.critical).toBe(true);
    expect(passes.find((p) => p.id === "spelling")!.critical).toBe(false);
  });

  it("конфіг може підняти родину до критичної", () => {
    const { passes } = planPasses(конфіг({ spelling: { critical: true } }));
    expect(passes.find((p) => p.id === "spelling")!.critical).toBe(true);
  });

  it("порядок від дешевих до дорогих — композиція після кольору", () => {
    const { passes } = planPasses(конфіг({ color: {}, composition: {} }));
    const i = passes.findIndex((p) => p.id === "color");
    const j = passes.findIndex((p) => p.id === "composition");
    expect(i).toBeLessThan(j);
  });

  /*
   * C1 (рулінг R25): `sequences` переїхала з `pagination_audit` на
   * `__cli_extras` — той інструмент не приймає `rules` узагалі й гучно
   * відмовляє «Не оголошено жодної родини», що й дав перший живий прогін.
   */
  describe("родина sequences (C1, рулінг R25)", () => {
    it("сама по собі (extras notApplicable) іде на __cli_extras, НЕ на pagination_audit", () => {
      const { passes } = planPasses(
        конфіг({ sequences: { rules: [{ style: "Нумерація питань", mustBeSequential: true }] } }),
      );
      const seq = passes.find((p) => p.id === "sequences")!;
      expect(seq).toBeDefined();
      expect(seq.tool).toBe("__cli_extras");
      expect(seq.args.rules).toEqual([{ style: "Нумерація питань", mustBeSequential: true }]);
    });

    /*
     * Обидві родини ходять на ОДИН синтетичний інструмент. Якби кожна
     * лишалась окремим проходом, JSX-обробник порахував би масштаб/
     * монтажний стіл ДВІЧІ під двома різними `id` — sections.ts/audit.ts
     * ключують адаптери за `p.tool`, не за `p.id` (sections.ts:52-54), тож
     * справжні знахідки продублювались би в звіті. `mergeCliExtras`
     * (plan.ts) зливає обидві в ОДИН прохід, коли налаштовані обидві.
     */
    it("коли extras і sequences ОБИДВІ налаштовані — рівно ОДИН прохід __cli_extras", () => {
      const { passes } = planPasses(
        конфіг({
          extras: { bodyTextStyles: ["Основний текст F"] },
          sequences: { rules: [{ style: "Нумерація питань", mustBeSequential: true }] },
        }),
      );
      const проходиCliExtras = passes.filter((p) => p.tool === "__cli_extras");
      expect(проходиCliExtras).toHaveLength(1);
      expect(проходиCliExtras[0]!.id).toBe("extras");
      expect(проходиCliExtras[0]!.args.bodyTextStyles).toEqual(["Основний текст F"]);
      expect(проходиCliExtras[0]!.args.rules).toEqual([
        { style: "Нумерація питань", mustBeSequential: true },
      ]);
    });

    it("злиття піднімає critical, якщо ХОЧ ОДНА з двох родин його просить", () => {
      const { passes } = planPasses(
        конфіг({
          extras: { bodyTextStyles: ["Основний текст F"] },
          sequences: { rules: [{ style: "Нумерація питань", mustBeSequential: true }], critical: true },
        }),
      );
      const прохід = passes.find((p) => p.tool === "__cli_extras")!;
      expect(прохід.critical).toBe(true);
    });

    it("extras сама по собі (sequences notApplicable) лишається одиночним проходом без rules", () => {
      const { passes, skipped } = planPasses(
        конфіг({ extras: { bodyTextStyles: ["Основний текст F"] } }),
      );
      const проходиCliExtras = passes.filter((p) => p.tool === "__cli_extras");
      expect(проходиCliExtras).toHaveLength(1);
      expect(проходиCliExtras[0]!.id).toBe("extras");
      expect(проходиCliExtras[0]!.args.rules).toBeUndefined();
      expect(skipped).toContainEqual({ family: "sequences", reason: "ні" });
    });
  });
});

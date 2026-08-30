import { describe, expect, it } from "vitest";
import {
  auditConfigSchema,
  FAMILY_NAMES,
  isNotApplicable,
} from "../../src/cli/config/schema.js";

const базовий = {
  edition: { title: "Книжка", docPath: "/тека/книжка.indd" },
  print: { minPpi: 300, maxTotalInk: 300, expectedInks: 4 },
  families: Object.fromEntries(
    FAMILY_NAMES.map((f) => [f, { notApplicable: "не цього разу" }]),
  ),
};

describe("auditConfigSchema", () => {
  it("приймає конфіг, де кожна родина в одному з трьох станів", () => {
    expect(auditConfigSchema.safeParse(базовий).success).toBe(true);
  });

  it("відмовляє, коли родини бракує — тихого нуля не існує", () => {
    const без = structuredClone(базовий);
    delete (без.families as Record<string, unknown>).pagination;
    expect(auditConfigSchema.safeParse(без).success).toBe(false);
  });

  it("відмовляє на невідомій родині — це друкарська помилка, не розширення", () => {
    const зайва = structuredClone(базовий);
    (зайва.families as Record<string, unknown>).вигадана = {};
    expect(auditConfigSchema.safeParse(зайва).success).toBe(false);
  });

  it("відмовляє на від'ємному порозі друку", () => {
    const поганий = structuredClone(базовий);
    поганий.print.minPpi = -1;
    expect(auditConfigSchema.safeParse(поганий).success).toBe(false);
  });

  it("вимагає всіх трьох чисел друку — їх вирішує друкарня, не інструмент", () => {
    for (const ключ of ["minPpi", "maxTotalInk", "expectedInks"] as const) {
      const без = structuredClone(базовий);
      delete (без.print as Record<string, unknown>)[ключ];
      expect(auditConfigSchema.safeParse(без).success).toBe(false);
    }
  });
});

describe("isNotApplicable", () => {
  it("розрізняє оголошену незастосовність і налаштовану родину", () => {
    expect(isNotApplicable({ notApplicable: "нема бібліографії" })).toBe(true);
    expect(isNotApplicable({ nearMissPt: 3 })).toBe(false);
  });

  it("порожня причина незастосовністю не є — причина друкується у звіті", () => {
    expect(isNotApplicable({ notApplicable: "" })).toBe(false);
  });
});

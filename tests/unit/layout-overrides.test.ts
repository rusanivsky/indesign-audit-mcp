import { describe, expect, it } from "vitest";
import { EPSILON_PT, detectOverrides } from "../../src/layout/overrides.js";
import { summariseByStyle } from "../../src/layout/summarise.js";
import { paragraph } from "./helpers/layout.js";

describe("порівняння з оголошеним стилем", () => {
  it("чистий абзац знахідки не дає", () => {
    expect(detectOverrides([paragraph()]).findings).toEqual([]);
  });

  it("перевизначений відступ дає знахідку групи indents", () => {
    const r = detectOverrides([paragraph({ actual: { firstLineIndent: 24 } })]);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.group).toBe("indents");
    expect(r.findings[0]!.property).toBe("firstLineIndent");
    expect(r.findings[0]!.declared).toBe(12);
    expect(r.findings[0]!.actual).toBe(24);
  });

  it("розбіжність у межах ε знахідки не дає", () => {
    const r = detectOverrides([paragraph({ actual: { firstLineIndent: 12 + EPSILON_PT / 2 } })]);
    expect(r.findings).toEqual([]);
  });

  it("рядкові властивості порівнюються точно, без ε", () => {
    const r = detectOverrides([paragraph({ actual: { justification: "LEFT_ALIGN" } })]);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.group).toBe("justification");
  });
});

describe("leading як число АБО назва enum", () => {
  it("AUTO проти AUTO — чисто, а не «не порівняно»", () => {
    const r = detectOverrides([paragraph({ declared: { leading: "AUTO" } })]);
    expect(r.findings).toEqual([]);
    expect(r.notCompared).toEqual([]);
  });

  it("AUTO у стилі проти числа в абзаці — СПРАВЖНЯ знахідка групи sizes", () => {
    const r = detectOverrides([
      paragraph({ declared: { leading: "AUTO" }, actual: { leading: 14 } }),
    ]);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.group).toBe("sizes");
    expect(r.findings[0]!.property).toBe("leading");
    expect(r.findings[0]!.declared).toBe("AUTO");
    expect(r.findings[0]!.actual).toBe(14);
  });
});

describe("три правила, без яких детектор бреше", () => {
  it("правило 1: абзац із символьним стилем не дає знахідок ГРУП font і sizes", () => {
    const r = detectOverrides([
      paragraph({ hasCharacterStyleRuns: true, actual: { pointSize: 9, fontStyle: "Italic" } }),
    ]);
    expect(r.findings).toEqual([]);
  });

  it(
    "правило 1: заглушені групи ОБЛІКОВУЮТЬСЯ як «не порівняно» — інакше вони зникають " +
      "безслідно й оператор читає порожній звіт як «відхилень немає»",
    () => {
      const r = detectOverrides([
        paragraph({
          hasCharacterStyleRuns: true,
          actual: { pointSize: 9, fontStyle: "Italic", tracking: -8 },
        }),
      ]);
      expect(r.findings).toEqual([]);
      /* Порядок — той, у якому групи трапляються в GROUP_PROPERTIES. */
      expect(r.notCompared).toEqual([
        { styleId: "100", styleName: "Osnovnyi", group: "sizes", reason: "character-style", count: 1 },
        { styleId: "100", styleName: "Osnovnyi", group: "font", reason: "character-style", count: 1 },
        { styleId: "100", styleName: "Osnovnyi", group: "tracking", reason: "character-style", count: 1 },
      ]);
    },
  );

  it("заглушена група рахується РАЗ на абзац, а не раз на властивість групи", () => {
    /* `sizes` — це pointSize І leading: без спільного countedGroups вийшло б 2. */
    const r = detectOverrides([paragraph({ hasCharacterStyleRuns: true })]);
    const sizes = r.notCompared.filter((n) => n.group === "sizes");
    expect(sizes).toHaveLength(1);
    expect(sizes[0]!.count).toBe(1);
  });

  it("правило 1 не глушить групи, до яких символьний стиль стосунку не має", () => {
    const r = detectOverrides([
      paragraph({ hasCharacterStyleRuns: true, actual: { firstLineIndent: 24 } }),
    ]);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.group).toBe("indents");
  });

  it("правило 2: мішане значення йде в notCompared, а НЕ в findings", () => {
    const r = detectOverrides([paragraph({ actual: { pointSize: null } })]);
    expect(r.findings).toEqual([]);
    expect(r.notCompared).toEqual([
      { styleId: "100", styleName: "Osnovnyi", group: "sizes", reason: "mixed", count: 1 },
    ]);
  });

  it("правило 2: недоступне ОГОЛОШЕНЕ значення теж не є відхиленням", () => {
    const r = detectOverrides([paragraph({ declared: { leading: null }, actual: { leading: 20 } })]);
    expect(r.findings).toEqual([]);
    expect(r.notCompared[0]!.reason).toBe("unavailable");
  });

  it(
    "правило 2: коли недоступні ОБИДВА боки, причина — «unavailable», а не «mixed»: " +
      "абзацний стиль мішаним бути не може за побудовою",
    () => {
      /* helper: actual успадковує declared, тож обидва боки тут null. */
      const r = detectOverrides([paragraph({ declared: { pointSize: null } })]);
      expect(r.findings).toEqual([]);
      expect(r.notCompared).toEqual([
        { styleId: "100", styleName: "Osnovnyi", group: "sizes", reason: "unavailable", count: 1 },
      ]);
    },
  );

  it("контролює регресію: дві мішані властивості ОДНІЄЇ групи дають ОДИН запис notCompared, не два", () => {
    const r = detectOverrides([
      paragraph({ actual: { pointSize: null, leading: null } }),
    ]);
    expect(r.findings).toEqual([]);
    expect(r.notCompared).toEqual([
      { styleId: "100", styleName: "Osnovnyi", group: "sizes", reason: "mixed", count: 1 },
    ]);
  });
});

describe("ручний маркер", () => {
  it("абзац стилю-СПИСКУ, що починається з тире, є знахідкою", () => {
    const r = detectOverrides([
      paragraph({ declared: { listType: "BULLET_LIST" }, preview: "- Punkt spysku" }),
    ]);
    expect(r.findings.map((f) => f.defect)).toContain("manual-bullet");
  });

  it("звичайний абзац, що починається з тире, знахідкою НЕ є — це пряма мова", () => {
    const r = detectOverrides([
      paragraph({ declared: { listType: "NO_LIST" }, preview: "— A tse pryama mova." }),
    ]);
    expect(r.findings).toEqual([]);
  });
});

describe("трекінг", () => {
  it("трекінг дає власну групу, а не потрапляє в sizes", () => {
    const r = detectOverrides([paragraph({ actual: { tracking: -8 } })]);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.group).toBe("tracking");
  });
});

describe("батьківські сторінки", () => {
  it("за замовчуванням абзаци батьківських НЕ рахуються", () => {
    const r = detectOverrides([paragraph({ isMaster: true, actual: { firstLineIndent: 24 } })]);
    expect(r.findings).toEqual([]);
  });

  it("includeMasters: true їх повертає", () => {
    const r = detectOverrides([paragraph({ isMaster: true, actual: { firstLineIndent: 24 } })], {
      includeMasters: true,
    });
    expect(r.findings).toHaveLength(1);
  });
});

describe("лічильник абзаців", () => {
  it("рахує ВСІ абзаци стилю, не лише відхилені — інакше зведення нічого не означає", () => {
    const r = detectOverrides([
      paragraph({ index: 0 }),
      paragraph({ index: 1, actual: { firstLineIndent: 24 } }),
    ]);
    expect(r.paragraphCounts.get("100")).toEqual({ styleName: "Osnovnyi", paragraphs: 2 });
  });

  it(
    "два стилі з ОДНАКОВОЮ назвою й різними id дають ДВА окремі записи — " +
      "виміряно зондом H5 на робочій книжці (565 абзаців проти 0)",
    () => {
      const r = detectOverrides([
        paragraph({ index: 0, style: "Однакова назва", styleId: "100" }),
        paragraph({ index: 1, style: "Однакова назва", styleId: "200" }),
      ]);
      expect(r.paragraphCounts.size).toBe(2);
      expect(r.paragraphCounts.get("100")).toEqual({ styleName: "Однакова назва", paragraphs: 1 });
      expect(r.paragraphCounts.get("200")).toEqual({ styleName: "Однакова назва", paragraphs: 1 });
    },
  );
});

/*
 * Рецензія кола 1 («Прогалина в мутантах»): рецензентські мутанти показали,
 * що переставлені місцями `styleName`/`styleId` у `findings.push` (overrides.ts)
 * не ловить НІЩО — наскрізного тесту «детектор → зведення» не було,
 * `summariseByStyle` перевірявся лише на рукотворних знахідках. Тут —
 * СПРАВЖНІЙ `detectOverrides`, СПРАВЖНІЙ `summariseByStyle`, без жодної
 * підміни: мутант, що міняє поля місцями, дав би `styleId` рядковим ім'ям
 * стилю, а `styleName` — числовим id, і саме це перевіряється явно.
 */
describe("наскрізно: detectOverrides → summariseByStyle (страховка від переплутаних полів)", () => {
  it("styleId і styleName в рядку зведення НЕ переплутані", () => {
    const r = detectOverrides([
      paragraph({ style: "Назва Стилю", styleId: "12345", actual: { firstLineIndent: 24 } }),
    ]);
    const summary = summariseByStyle(r.findings, r.paragraphCounts, r.notCompared);

    expect(summary).toHaveLength(1);
    expect(summary[0]!.styleId).toBe("12345");
    expect(summary[0]!.styleName).toBe("Назва Стилю");
    expect(summary[0]!.styleId).not.toBe("Назва Стилю");
    expect(summary[0]!.styleName).not.toBe("12345");
  });
});

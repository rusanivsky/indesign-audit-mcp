import { describe, expect, it } from "vitest";
import { rewrite, runRules } from "../../src/typography/engine.js";
import {
  auditOnly,
  DASH_RULES,
  QUOTE_RULES,
  SPACING_RULES,
  UK2019_RULES,
  UK_RULES,
} from "../../src/typography/rules-uk.js";

const fix = (text: string, rules = UK_RULES) => rewrite(text, runRules(text, rules));

describe("пробіли й сміття", () => {
  it("згортає кілька пробілів в один", () => {
    expect(fix("мама  і   тато", SPACING_RULES)).toBe("мама і тато");
  });

  it("прибирає пробіл перед розділовим знаком", () => {
    /* КРАПКА З КОМОЮ ТУТ ЛИШАЄТЬСЯ НЕЗАЙМАНОЮ, і це не послаблення тесту.
     *
     * З 2026-08-26 виняток «пробіл з ОБОХ боків» покриває не лише двокрапку,
     * а й крапку з комою: ДСТУ 7.1 приписує її саме так — між місцями
     * видання та між другим і дальшими відомостями про відповідальність.
     * Доти `typography_apply` мовчки (confidence «high») знімав ці пробіли
     * просто на сторінці вихідних відомостей.
     *
     * Ціна названа вголос там, де й для двокрапки: справжня одруківка
     * «і все ; ще» посеред прози тепер не ловиться. Зіпсувати вихідні
     * відомості дорожче, ніж проґавити одруківку.
     *
     * Кома й крапка в цьому ж рядку правляться як і раніше — саме вони
     * доводять, що правило не вимкнулося ціле. Обидві межі винятку —
     * у tests/unit/rules-uk-zones.test.ts. */
    expect(fix("так , ось . і все ; ще", SPACING_RULES)).toBe("так, ось. і все ; ще");
  });

  it("крапку з комою БЕЗ пробілу після неї все одно ловить", () => {
    /* Позитивний близнюк до попереднього: виняток тримається на ознаці
     * «пробільне з обох боків», а не на самому знаку, тож звичайна одруківка
     * лишається помилкою. Без цього тесту виняток міг би тихо вимкнути
     * правило для крапки з комою назовсім. */
    expect(fix("слово ;інше", SPACING_RULES)).toBe("слово;інше");
  });

  it("прибирає пробіл перед знаком абзацу", () => {
    expect(fix("рядок   \rдалі", SPACING_RULES)).toBe("рядок\rдалі");
  });

  it("НЕ чіпає сам знак абзацу", () => {
    const src = "перший\rдругий\rтретій";
    expect(fix(src, SPACING_RULES)).toBe(src);
  });

  it("прибирає пробіли всередині дужок", () => {
    expect(fix("текст ( ось так ) далі", SPACING_RULES)).toBe("текст (ось так) далі");
  });

  it("не з'їдає межу абзацу, коли пробіли стоять з обох боків", () => {
    const out = fix("кінець \r початок", SPACING_RULES);
    expect(out).toContain("\r");
    expect(out.split("\r")).toHaveLength(2);
  });
});

describe("тире й дефіси", () => {
  it("дефіс між пробілами стає довгим тире", () => {
    expect(fix("мама - це все", DASH_RULES)).toBe("мама — це все");
  });

  it("дефіс усередині слова не чіпається", () => {
    expect(fix("синьо-жовтий", DASH_RULES)).toBe("синьо-жовтий");
  });

  it("тире, що вже стоїть, не чіпається", () => {
    expect(fix("мама — це все", DASH_RULES)).toBe("мама — це все");
  });

  it("числовий діапазон дає коротке тире без пробілів", () => {
    expect(fix("1941-1945 роки", DASH_RULES)).toBe("1941–1945 роки");
  });

  it("номер телефону виноситься в сумнівні, а не правиться мовчки", () => {
    const m = runRules("тел. 067 - 123", DASH_RULES);
    expect(m.some((x) => x.confidence === "needs-review")).toBe(true);
  });

  it("номер телефону не згортається мовчки у повному rewrite", () => {
    const out = fix("тел. 067 - 123", DASH_RULES);
    // Раніше rangeDashNumeric (confidence "high") перекривав вужчий
    // dashSeparator-збіг (needs-review) і мовчки перетворював номер на
    // "067–123". Після виправлення except у rangeDashNumeric цей вивід
    // не повинен містити суцільного en-dash без пробілів.
    expect(out).not.toBe("тел. 067–123");
    expect(out).not.toContain("067–123");
  });

  it("географічний діапазон завжди сумнівний", () => {
    const m = runRules("рейс Київ-Львів", DASH_RULES);
    expect(m.every((x) => x.confidence === "needs-review")).toBe(true);
  });

  it("тире на початку репліки діалогу", () => {
    expect(fix("- Мамо, я вдома.", DASH_RULES)).toBe("— Мамо, я вдома.");
  });

  it("тире на початку репліки після знака абзацу", () => {
    expect(fix("текст\r- Мамо!", DASH_RULES)).toBe("текст\r— Мамо!");
  });
});

describe("лапки, апостроф, крапки", () => {
  it("прямі лапки стають ялинками", () => {
    expect(fix('вона сказала "привіт" і пішла', QUOTE_RULES)).toBe(
      "вона сказала «привіт» і пішла",
    );
  });

  it("вкладені лапки стають англійськими", () => {
    expect(fix('книга "роман "Мати" тут" усе', QUOTE_RULES)).toBe(
      "книга «роман “Мати” тут» усе",
    );
  });

  it("ідемпотентна: вже правильні лапки не чіпаються", () => {
    const src = "книга «роман “Мати” тут» усе";
    expect(fix(src, QUOTE_RULES)).toBe(src);
  });

  it("апостроф усередині слова стає типографським", () => {
    expect(fix("п'ять і м'ясо", QUOTE_RULES)).toBe("п’ять і м’ясо");
  });

  it("три крапки стають багатокрапкою", () => {
    expect(fix("і потім... тиша", QUOTE_RULES)).toBe("і потім… тиша");
  });

  it("більше трьох крапок теж згортаються", () => {
    expect(fix("чекай.....", QUOTE_RULES)).toBe("чекай…");
  });

  it("пряма лапка одразу після « відкриває нову вкладену лапку (без псування)", () => {
    expect(fix('він читав «"Мати" — роман» вголос', QUOTE_RULES)).toBe(
      "він читав «“Мати” — роман» вголос",
    );
    expect(fix('сказав «"Привіт"» тут', QUOTE_RULES)).toBe('сказав «“Привіт”» тут');
  });

  it("дюйми після числа не стають лапками", () => {
    const out = fix('екран 15" завширшки', QUOTE_RULES);
    expect(out).toContain('15"');
  });
});

describe("auditOnly", () => {
  it("знаходить табуляцію на початку абзацу", () => {
    const f = auditOnly("\tабзац з відступом\rзвичайний");
    expect(f.some((x) => x.kind === "tab-indent")).toBe(true);
  });

  it("знаходить порожні абзаци", () => {
    const f = auditOnly("текст\r\r\rдалі");
    expect(f.filter((x) => x.kind === "empty-paragraph").length).toBeGreaterThan(0);
  });

  it("на чистому тексті нічого не знаходить", () => {
    expect(auditOnly("перший абзац\rдругий абзац")).toEqual([]);
  });
});

describe("UK_RULES разом", () => {
  it("містить усі три групи", () => {
    expect(UK_RULES.length).toBe(
      SPACING_RULES.length + DASH_RULES.length + QUOTE_RULES.length + UK2019_RULES.length,
    );
  });

  it("усі id унікальні", () => {
    const ids = UK_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("не містить правил про нерозривні пробіли", () => {
    expect(UK_RULES.some((r) => r.id.includes("nbsp"))).toBe(false);
  });
});

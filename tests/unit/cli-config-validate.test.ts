import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ConfigError, validateConfig } from "../../src/cli/config/validate.js";
import { FAMILY_NAMES } from "../../src/cli/config/schema.js";

const повний = {
  edition: { title: "Книжка", docPath: "/тека/книжка.indd" },
  print: { minPpi: 300, maxTotalInk: 300, expectedInks: 4 },
  families: Object.fromEntries(FAMILY_NAMES.map((f) => [f, { notApplicable: "ні" }])),
};

describe("validateConfig — позитивний близнюк", () => {
  it("повертає конфіг, коли все названо", () => {
    expect(validateConfig(повний).print.minPpi).toBe(300);
  });
});

describe("validateConfig — відмови", () => {
  it("називає РОДИНУ, якої бракує", () => {
    const без = structuredClone(повний);
    delete (без.families as Record<string, unknown>).geometry;
    expect(() => validateConfig(без)).toThrow(ConfigError);
    expect(() => validateConfig(без)).toThrow(/geometry/);
  });

  it("пояснює, ЧОМУ замовчування немає, а не лише що бракує", () => {
    const без = structuredClone(повний);
    delete (без.print as Record<string, unknown>).minPpi;
    let помилка: ConfigError | null = null;
    try {
      validateConfig(без);
    } catch (e) {
      помилка = e as ConfigError;
    }
    expect(помилка).toBeInstanceOf(ConfigError);
    expect(помилка!.whyNoDefault).toMatch(/printer/i);
    expect(помилка!.message).toMatch(/minPpi/);
  });

  it("не мовчить про невідому родину", () => {
    const зайва = structuredClone(повний);
    (зайва.families as Record<string, unknown>).пагінація = {};
    expect(() => validateConfig(зайва)).toThrow(ConfigError);
  });

  it("НАЗИВАЄ саме зайву родину — не просто відмовляє на невідомому ключі", () => {
    // Це і є властивість, заради якої довелось відхилитись від
    // брифового `path[1]` на користь `issue.keys` (zod 4.4.3 для
    // unrecognized_keys не кладе ім'я в path). Без цього тесту гілку
    // `issue.code === "unrecognized_keys"` можна прибрати чи переплутати,
    // і всі інші тести лишаться зеленими, а повідомлення тихо втратить
    // ім'я зайвої родини.
    const зайва = structuredClone(повний);
    (зайва.families as Record<string, unknown>).пагінація = {};
    let помилка: ConfigError | null = null;
    try {
      validateConfig(зайва);
    } catch (e) {
      помилка = e as ConfigError;
    }
    expect(помилка).toBeInstanceOf(ConfigError);
    expect(помилка!.family).toBe("пагінація");
    expect(помилка!.message).toMatch(/пагінація/);
  });

  it("відмова стається до будь-якого дотику до InDesign", () => {
    // Доказ від протилежного: validateConfig не приймає ToolBox узагалі,
    // тож викликати InDesign їй нічим.
    expect(validateConfig.length).toBe(1);
  });

  it("чесніший доказ: модуль validate.ts не імпортує нічого, що вміє "
    + "запускати процес чи говорити з InDesign", () => {
    // Арність — слабкий доказ (нічого не заважає функції ігнорувати
    // додаткові аргументи чи все одно звернутись до зовнішнього стану).
    // Тут перевіряємо саме джерело модуля: якщо він фізично не імпортує
    // ані `node:child_process`, ані міст до InDesign (`src/bridge/*`),
    // то жодним шляхом досягти InDesign з нього не можна — байдуже, яку б
    // сигнатуру `validateConfig` не мала.
    const тут = dirname(fileURLToPath(import.meta.url));
    const шлях = join(тут, "..", "..", "src", "cli", "config", "validate.ts");
    const джерело = readFileSync(шлях, "utf8");
    expect(джерело).not.toMatch(/node:child_process/);
    expect(джерело).not.toMatch(/bridge\/(runner|errors)/);
  });
});

/*
 * Important 3 (раунд виправлень 1, задача C): `sequences` і `extras`
 * ходять ОДНИМ проходом `__cli_extras` (спек §4.4, R25). Коли `sequences`
 * налаштована, а `extras` — `notApplicable`, одиночний прохід `sequences`
 * усе одно виконує ВЕСЬ обхід `__cli_extras` і публікує його побічні числа
 * (масштаб, монтажний стіл, `forcedBreaks.inBodyText` — фальшивий нуль без
 * `bodyTextStyles`) під `id: "sequences"`, тоді як звіт одночасно каже
 * «extras не перевіряли». Стан ЗАКОННИЙ за спек §5.1 — тому це не помилка
 * ФОРМИ (`auditConfigSchema` його приймає), а окрема перевірка ПІСЛЯ схеми.
 */
describe("validateConfig — sequences вимагає налаштованої extras (Important 3)", () => {
  it("позитивний близнюк: обидві налаштовані — конфіг проходить", () => {
    const cfg = structuredClone(повний);
    (cfg.families as Record<string, unknown>).sequences = {
      rules: [{ style: "Нумерація питань", mustBeSequential: true }],
    };
    (cfg.families as Record<string, unknown>).extras = { bodyTextStyles: ["Основний текст"] };
    expect(() => validateConfig(cfg)).not.toThrow();
  });

  it("позитивний близнюк: обидві notApplicable — конфіг проходить (правило не застосовується)", () => {
    // `повний` уже має sequences/extras notApplicable — тест лише
    // називає це вголос, а не покладається на замовчування фікстури.
    expect(() => validateConfig(повний)).not.toThrow();
  });

  it("sequences налаштована, extras — notApplicable → ВІДМОВА, не тихе змішування", () => {
    const cfg = structuredClone(повний);
    (cfg.families as Record<string, unknown>).sequences = {
      rules: [{ style: "Нумерація питань", mustBeSequential: true }],
    };
    // extras лишається notApplicable зі спадкованого `повний`.
    let помилка: ConfigError | null = null;
    try {
      validateConfig(cfg);
    } catch (e) {
      помилка = e as ConfigError;
    }
    expect(помилка).toBeInstanceOf(ConfigError);
    expect(помилка!.family).toBe("sequences");
    expect(помилка!.message).toMatch(/__cli_extras/);
  });

  it("extras налаштована, sequences — notApplicable → дозволено (правило однобічне)", () => {
    // Самотня `extras` без `sequences` — звичайний, уже наявний до цієї
    // задачі стан; C1 не мав торкатись його, і ця перевірка це стверджує.
    const cfg = structuredClone(повний);
    (cfg.families as Record<string, unknown>).extras = { bodyTextStyles: ["Основний текст"] };
    expect(() => validateConfig(cfg)).not.toThrow();
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { EXIT, exitCodeFor } from "../../src/cli/audit.js";
import type { Measurements, PassResult } from "../../src/cli/run/execute.js";

/*
 * ВОРОТА ДРУКУ — ЄДИНЕ, ЩО СПИНЯЄ ДЕФЕКТНУ КНИЖКУ, І ВОНО НЕ БУЛО НАКРИТЕ.
 *
 * `indesign-audit` завершується кодом 1, коли в критичній родині є знахідка,
 * і 0, коли книжку можна віддавати. Цей код читає людина або скрипт друкарні;
 * іншого вердикту CLI не видає.
 *
 * Мутаційна проба 2026-08-26: останній `return` у `main` замінено на голе
 * `return EXIT.CLEAN` — тобто «книжка чиста ЗАВЖДИ» — і ввесь юніт-набір
 * лишився зеленим, усі 2762 тести. Єдина згадка `EXIT` у тестах
 * (`cli-args.test.ts:46`) звіряла сталі самі з собою: `[0,1,2,3]` дорівнює
 * `[0,1,2,3]`, що не може впасти ніколи.
 *
 * Важливо, ДЕ саме була діра. `hasCritical` перевірений докладно
 * (`cli-sections.test.ts`, разом із випадком «непідтверджений вимір теж
 * запалює ворота»). Неперевіреним був ШОВ: перехід від вердикту до коду
 * виходу. Саме тому рішення винесено в `exitCodeFor` — щоб шов став
 * функцією, яку можна викликати, а не рядком усередині 400-рядкового `main`.
 */

const відбиток = {
  indesignVersion: "20.0",
  docName: "к.indd",
  docPath: "/т/к.indd",
  modified: true,
  wasAlreadyOpen: true,
  openDocumentCount: 1,
  dictionaryPath: "/словник",
  locale: "uk",
  sessionUptimeMs: 900_000,
};

function виміри(passes: Partial<PassResult>[]): Measurements {
  return {
    schemaVersion: 3,
    startedAt: "2026-08-16T10:00:00Z",
    stamp: відбиток,
    skipped: [],
    passes: passes.map((p) => ({ args: {}, defaulted: [], ...p })),
  } as unknown as Measurements;
}

/* Прохід, що ВПАВ: вимір критичної родини втрачено. За рішенням R41 це
 * запалює ворота так само, як знахідка, — збій у безпечний бік. */
const впалийКолір: Partial<PassResult> = {
  id: "color",
  tool: "color_audit",
  ok: false,
  elapsedMs: 1,
  data: null,
  error: "boom",
};

describe("ворота друку: вердикт → код виходу", () => {
  it("критична родина з втраченим виміром дає ступінь 1", () => {
    expect(exitCodeFor(виміри([впалийКолір]), new Set(["color"]))).toBe(EXIT.CRITICAL);
  });

  it("та сама біда в НЕкритичній родині воріт не запалює", () => {
    /* Позитивний близнюк: доводить, що ворота дивляться саме на список
     * критичних родин, а не запалюють від будь-якої негаразди. */
    expect(exitCodeFor(виміри([впалийКолір]), new Set(["spelling"]))).toBe(EXIT.CLEAN);
  });

  it("НЕГАТИВНИЙ КОНТРОЛЬ: чистий прогін дає ступінь 0", () => {
    /* Без цього функція, що завжди віддає 1, склала б перший тест і
     * заблокувала б геть усе, що йде в друк. */
    expect(exitCodeFor(виміри([]), new Set(["color"]))).toBe(EXIT.CLEAN);
  });

  it("два коди РІЗНІ — інакше «ворота» нічого не розрізняють", () => {
    expect(EXIT.CRITICAL).not.toBe(EXIT.CLEAN);
  });
});

/*
 * ДРУГА ПОЛОВИНА ШВА. Тести вище доводять, що `exitCodeFor` вирішує
 * правильно; вони НЕ доводять, що `main` досі його кличе. Саме та мутація —
 * підміна виклику сталою — і пережила набір, тож рядок перевіряємо в самому
 * джерелі. Це навмисно структурна перевірка: закрити її по-справжньому міг би
 * лише наскрізний прогін CLI, а він потребує живого InDesign і кількох хвилин.
 */
describe("ворота досі під'єднані до main", () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "cli", "audit.ts"),
    "utf8",
  );

  it("main повертає саме exitCodeFor, а не сталу", () => {
    expect(source).toMatch(/return exitCodeFor\(m, [^)]+\);/u);
  });

  it("на шляху успіху немає голого `return EXIT.CLEAN` — форми, якою мутація підмінила ворота", () => {
    /* EXIT.CLEAN лишається законним для інших виходів (наприклад `--init`),
     * тож звіряємо не наявність рядка взагалі, а те, що вердикт критичності
     * не обійдено: `hasCritical` мусить лишатися єдиним джерелом ступеня 1. */
    expect(source).toContain("EXIT.CRITICAL : EXIT.CLEAN");
  });
});

import { expect, it, vi } from "vitest";
import { MAX_PREFLIGHT_OCCURRENCES, type PreflightMeasure, type PreflightRow } from "../../src/preflight/types.js";
import type { Tools } from "../../src/tools/shared.js";

/*
 * Той самий патерн, що в tools-pagination-handler.test.ts: місток підмінено,
 * обробник викликається напряму, живий InDesign не залучається.
 */
const { runJsxMock } = vi.hoisted(() => ({ runJsxMock: vi.fn() }));
vi.mock("../../src/bridge/runner.js", () => ({ runJsx: runJsxMock }));

const { registerPreflightTools } = await import("../../src/tools/preflight.js");

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
type AnyHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

let capturedDescription = "";

function handler(): AnyHandler {
  let captured: AnyHandler | null = null;
  const fake = {
    registerTool(name: string, cfg: { description?: string }, h: AnyHandler) {
      if (name === "preflight_document") {
        captured = h;
        capturedDescription = cfg.description ?? "";
      }
    },
  } as unknown as Tools;
  registerPreflightTools(fake);
  if (!captured) throw new Error("preflight_document не зареєстровано");
  return captured;
}

const ROWS: PreflightRow[] = [
  [1, "TEXT (1)", "", "", []],
  [2, "Overset text (1)", "", "", []],
  [3, "Text Frame", "1", "Problem: Overset text: 94 characters", [["Problem", "Overset text: 94 characters"]]],
];

function measure(over: Partial<PreflightMeasure> = {}): PreflightMeasure {
  return {
    docName: "Книжка.indd",
    profileName: "[Basic]",
    workingProfile: "[Basic]",
    preflightOff: false,
    scope: "PREFLIGHT_ALL_PAGES",
    rules: [
      { id: "ADBE_OversetText", flag: "RETURN_AS_ERROR", enabled: true },
      { id: "ADBE_ImageResolution", flag: "RULE_IS_DISABLED", enabled: false },
    ],
    rows: ROWS,
    availableProfiles: ["[Basic]"],
    shapeRecognised: true,
    rowsSeen: 3,
    rowsParsed: 3,
    pairsSeen: 1,
    pairsParsed: 1,
    processRemoved: true,
    waitTimedOut: false,
    waitPolarity: null,
    ...over,
  };
}

function payload(res: ToolResult): Record<string, unknown> {
  return JSON.parse(res.content[0]!.text) as Record<string, unknown>;
}

it("віддає звіт із caveat, знахідками й часом прогону", async () => {
  runJsxMock.mockReset();
  runJsxMock.mockResolvedValue(measure());
  const data = payload(await handler()({}));
  expect(data.occurrenceCount).toBe(1);
  expect(String(data.caveat)).toContain('"[Basic]"');
  expect(typeof data.elapsedMs).toBe("number");
});

it("власне очікування JSX КОРОТШЕ за зовнішній таймаут — інакше його повідомлення не встигне", async () => {
  /*
   * Рівні межі означають, що зовнішній таймаут AppleScript спрацьовує першим,
   * і пояснення «preflight не встиг за N с» не з'являється НІКОЛИ. Пор.
   * свідомий PROCESS_KILL_GRACE_MS у runner.ts.
   */
  runJsxMock.mockReset();
  runJsxMock.mockResolvedValue(measure());
  await handler()({});
  const [, params, opts] = runJsxMock.mock.calls[0] as [string, { waitSeconds: number }, { timeoutMs: number }];
  expect(params.waitSeconds).toBeGreaterThan(0);
  expect(params.waitSeconds * 1000).toBeLessThan(opts.timeoutMs);
});

it("не передає в JSX жодного timeoutSeconds — мертвого дефолту більше немає", async () => {
  runJsxMock.mockReset();
  runJsxMock.mockResolvedValue(measure());
  await handler()({});
  const [, params] = runJsxMock.mock.calls[0] as [string, Record<string, unknown>];
  expect(params).not.toHaveProperty("timeoutSeconds");
});

it("невпізнана форма результату НЕ читається як «порушень немає»", async () => {
  runJsxMock.mockReset();
  runJsxMock.mockResolvedValue(measure({ rows: [], shapeRecognised: false, rowsSeen: 0, rowsParsed: 0 }));
  const data = payload(await handler()({}));
  expect(data.occurrenceCount).toBe(0);
  expect(data.shapeRecognised).toBe(false);
  expect(String(data.caveat)).toContain("shapeRecognised = false");
});

it("неприбраний процес видно у відповіді, а не лише в панелі InDesign", async () => {
  runJsxMock.mockReset();
  runJsxMock.mockResolvedValue(measure({ processRemoved: false }));
  expect(payload(await handler()({})).processRemoved).toBe(false);
});

/*
 * СПРАВЖНІЙ текст InDesign, а не порожні рядки.
 *
 * Перша редакція цього тесту будувала випадки з порожнім описом і без пар —
 * 128 Б замість 477 Б, тобто вчетверо дешевші. Наслідок виміряно на копії
 * дерева: стелю можна було мовчки підняти до ~317 і лишитись зеленим, а 300
 * випадків справжнього тексту дають ≈139 КБ — майже вдвічі більше за 78 КБ, на
 * яких Фаза 4 вивела інструмент з ладу. Тобто поріг не спрацьовував ні з
 * захистом, ні без нього.
 */
const REAL_PROBLEM = "Image resolution: effective ppi is 96, minimum is 250";
const REAL_FIX =
  "Resize the image, or replace it with a higher-resolution original. " +
  "Add text frames to the story thread if necessary.";

function imageRows(total: number): PreflightRow[] {
  const rows: PreflightRow[] = [
    [1, "IMAGES", "", "", []],
    [2, "Image resolution", "", "", []],
  ];
  for (let i = 0; i < total; i++) {
    rows.push([
      3,
      "Image",
      String(i + 1),
      `Problem: ${REAL_PROBLEM}\nFix: ${REAL_FIX}`,
      [["Problem", REAL_PROBLEM], ["Fix", REAL_FIX]],
    ]);
  }
  return rows;
}

it("стеля випадків діє на шляху інструмента, а не лише в чистій функції", async () => {
  runJsxMock.mockReset();
  const total = MAX_PREFLIGHT_OCCURRENCES + 17;
  runJsxMock.mockResolvedValue(measure({ rows: imageRows(total) }));

  const res = await handler()({});
  const data = payload(res);
  expect(data.occurrenceCount).toBe(total);
  expect(data.occurrencesTruncated).toEqual({ shown: MAX_PREFLIGHT_OCCURRENCES, total });
});

it("відповідь на стелі лишається під 40 КБ — зі СПРАВЖНІМ текстом Problem/Fix", async () => {
  /*
   * Це і є перевірка самого числа MAX_PREFLIGHT_OCCURRENCES, а не лише того, що
   * обрізання відбулося. Межа — 40 КБ, удвічі менша за 78 КБ Фази 4. Доведено
   * виконанням: зі стелею 120 і 200 цей тест валиться (див. звіт фікс-раунду 2).
   */
  runJsxMock.mockReset();
  runJsxMock.mockResolvedValue(measure({ rows: imageRows(MAX_PREFLIGHT_OCCURRENCES * 3) }));

  const res = await handler()({});
  const bytes = Buffer.byteLength(res.content[0]!.text, "utf8");
  expect(bytes, `відповідь на стелі ${MAX_PREFLIGHT_OCCURRENCES} важить ${bytes} Б`).toBeLessThan(
    40 * 1024,
  );
});

it("помилка виміру доходить як помилка, а не як порожній звіт", async () => {
  runJsxMock.mockReset();
  runJsxMock.mockRejectedValue(new Error("Preflight did not finish within 165 s"));
  const res = await handler()({});
  expect(res.isError).toBe(true);
  expect(res.content[0]!.text).toContain("did not finish");
});

it("опис інструмента називає поля відповіді — конвенція проєкту", async () => {
  handler();
  for (const field of [
    "caveat",
    "findings",
    "occurrenceCount",
    "occurrencesTruncated",
    "preflightOff",
    "availableProfiles",
    "elapsedMs",
    "shapeRecognised",
    "processRemoved",
  ]) {
    expect(capturedDescription, `опис не називає поля ${field}`).toContain(field);
  }
});

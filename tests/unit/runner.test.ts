import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * runner.ts викликає лише "osascript" через node:child_process.execFile.
 * Підміняємо його, щоб тестувати без живого InDesign: наш мок читає
 * bootstrap.jsx, який runJsx сам записав у тимчасову теку, і дістає звідти
 * шляхи __IDMCP_PARAMS/__IDMCP_RESULT — так тест бачить точно те, що
 * реально пише міст, а не окрему копію логіки.
 *
 * Справжній execFile має власний util.promisify.custom, який пакує
 * (stdout, stderr) у об'єкт замість дефолтної поведінки promisify
 * (повернути лише перший callback-аргумент). Наш мок відтворює це,
 * інакше runner.ts, що деструктурує { stdout } з результату
 * execFileAsync, отримає undefined замість тексту.
 */
const { execFileMock, promisifyCustomSymbol } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  promisifyCustomSymbol: Symbol.for("nodejs.util.promisify.custom"),
}));

vi.mock("node:child_process", () => {
  const mockedExecFile: any = (...args: unknown[]) => (execFileMock as any)(...args);
  mockedExecFile[promisifyCustomSymbol] = (file: string, args: string[], options?: unknown) =>
    new Promise((resolve, reject) => {
      const callback = (err: unknown, stdout?: string, stderr?: string) => {
        if (err) reject(err);
        else resolve({ stdout: stdout ?? "", stderr: stderr ?? "" });
      };
      /* Завжди 4 позиційні аргументи (file, args, options, callback), незалежно від
       * того, чи викликач передав options — щоб mockImplementation у тестах міг
       * покладатися на єдину, передбачувану сигнатуру. */
      (execFileMock as any)(file, args, options ?? {}, callback);
    });
  return { execFile: mockedExecFile };
});

const { runJsx } = await import("../../src/bridge/runner.js");
const { IndesignError } = await import("../../src/bridge/errors.js");

/**
 * Дочекатися ВІДМОВИ і повернути її вже типізованою.
 *
 * Замінює `await runJsx(...).catch((e) => e)`, який стояв тут раніше. Той
 * патерн мав дві вади, і typecheck на тестах (борг закрито 2026-08-05)
 * підсвітив лише першу: `e` мав тип `unknown`, тож кожне звернення до
 * `err.kind` було помилкою TS18046. Друга гірша — якщо проміс НЕ відхилявся,
 * `.catch` не спрацьовував, `err` ставав звичайним результатом, і тест падав
 * на порівнянні `undefined` з очікуваним `kind`, тобто скаржився на не ту
 * причину. Тут успішний проміс — окрема, названа помилка.
 */
async function rejection(p: Promise<unknown>): Promise<InstanceType<typeof IndesignError>> {
  try {
    await p;
  } catch (e) {
    if (e instanceof IndesignError) return e;
    throw new Error(`очікували IndesignError, отримали ${String(e)}`);
  }
  throw new Error("очікували відмову, а проміс виконався успішно");
}

/** Дістає POSIX-шлях до bootstrap.jsx з тіла applescript, який runner передає в -e. */
function extractBootstrapPath(applescript: string): string {
  const m = applescript.match(/POSIX file "([^"]+)"/);
  if (!m) throw new Error("Не знайдено POSIX file у applescript: " + applescript);
  return m[1]!;
}

/** Дістає значення $.global.__IDMCP_PARAMS / __IDMCP_RESULT із bootstrap.jsx. */
function extractGlobal(bootstrapSource: string, name: string): string {
  const re = new RegExp("__" + name + '\\s*=\\s*"([^"]+)"');
  const m = bootstrapSource.match(re);
  if (!m) throw new Error("Не знайдено " + name + " у bootstrap.jsx");
  return m[1]!;
}

function isSystemEventsCheck(applescript: string): boolean {
  return applescript.indexOf("System Events") !== -1;
}

const tempDirsToCleanup: string[] = [];

beforeEach(() => {
  execFileMock.mockReset();
});

afterEach(async () => {
  while (tempDirsToCleanup.length > 0) {
    const dir = tempDirsToCleanup.pop()!;
    await rm(dir, { recursive: true, force: true });
  }
});

describe("runJsx — перевірка, що InDesign запущено", () => {
  it("якщо процес InDesign не знайдено, кидає not-running і не викликає do script до InDesign", async () => {
    const calls: string[] = [];
    execFileMock.mockImplementation((_file: string, args: string[], _opts: unknown, cb: Function) => {
      calls.push(args[1]!);
      cb(null, "false\n", "");
    });

    const err = await rejection(runJsx("status", {}));

    expect(err.kind).toBe("not-running");
    expect(calls.length).toBe(1);
    expect(isSystemEventsCheck(calls[0]!)).toBe(true);
  });

  it("перевірка через System Events має власний короткий таймаут (не 0 — інакше може зависнути назавжди на TCC-діалозі)", async () => {
    let capturedOptions: { timeout?: number } | undefined;
    execFileMock.mockImplementation((_file: string, args: string[], opts: { timeout?: number }, cb: Function) => {
      if (isSystemEventsCheck(args[1]!)) {
        capturedOptions = opts;
        cb(null, "true\n", "");
        return;
      }
      cb(new Error("не мало дійти сюди в цьому тесті"));
    });

    await runJsx("status", {}).catch(() => {});

    expect(capturedOptions).toBeDefined();
    expect(typeof capturedOptions!.timeout).toBe("number");
    expect(capturedOptions!.timeout).toBeGreaterThan(0);
  });

  it("якщо перевірка System Events падає через відсутній дозвіл, підказка називає саме System Events (не InDesign)", async () => {
    execFileMock.mockImplementation((_file: string, args: string[], _opts: unknown, cb: Function) => {
      if (isSystemEventsCheck(args[1]!)) {
        const err = new Error("execution error") as Error & { stderr?: string; killed?: boolean };
        err.stderr = "Not authorized to send Apple events (-1743)";
        err.killed = false;
        cb(err);
        return;
      }
      cb(new Error("не мало дійти сюди в цьому тесті"));
    });

    const err = await rejection(runJsx("status", {}));

    expect(err.kind).toBe("no-permission");
    expect(err.hint).toContain("System Events");
    expect(err.hint).not.toContain("InDesign");
  });

  it("якщо перевірка System Events падає за таймаутом, підказка називає System Events, а не пораду шукати модальне вікно InDesign", async () => {
    execFileMock.mockImplementation((_file: string, args: string[], _opts: unknown, cb: Function) => {
      if (isSystemEventsCheck(args[1]!)) {
        const err = new Error("Command timed out") as Error & { killed?: boolean; signal?: string };
        err.killed = true;
        err.signal = "SIGTERM";
        cb(err);
        return;
      }
      cb(new Error("не мало дійти сюди в цьому тесті"));
    });

    const err = await rejection(runJsx("status", {}));

    expect(err.kind).toBe("busy");
    expect(err.hint).toContain("System Events");
    expect(err.hint).not.toContain("модальне вікно");
  });

  it("якщо перевірка System Events падає з нерозпізнаною помилкою, підказка називає System Events, а не InDesign", async () => {
    execFileMock.mockImplementation((_file: string, args: string[], _opts: unknown, cb: Function) => {
      if (isSystemEventsCheck(args[1]!)) {
        const err = new Error("execution error") as Error & { stderr?: string; killed?: boolean };
        err.stderr = "щось незрозуміле пішло не так";
        err.killed = false;
        cb(err);
        return;
      }
      cb(new Error("не мало дійти сюди в цьому тесті"));
    });

    const err = await rejection(runJsx("status", {}));

    expect(err.kind).toBe("unknown");
    expect(err.hint).toContain("System Events");
    expect(err.message).toContain("System Events");
    expect(err.message).not.toContain("InDesign");
    expect(err.hint).not.toContain("InDesign");
  });

  it("якщо процес InDesign знайдено, виконує звичайний do script", async () => {
    execFileMock.mockImplementation((_file: string, args: string[], _opts: unknown, cb: Function) => {
      const script = args[1] as string;
      if (isSystemEventsCheck(script)) {
        cb(null, "true\n", "");
        return;
      }
      const bootstrapPath = extractBootstrapPath(script);
      tempDirsToCleanup.push(dirname(bootstrapPath));
      const bootstrap = readFileSync(bootstrapPath, "utf8");
      const resultPath = extractGlobal(bootstrap, "IDMCP_RESULT");
      writeFileSync(resultPath, JSON.stringify({ ok: true, data: { hello: "world" } }));
      cb(null, "", "");
    });

    const result = await runJsx<{ hello: string }>("status", {});
    expect(result).toEqual({ hello: "world" });
  });
});

/** У решті тестів InDesign вважається запущеним — фокус на самій логіці do script. */
function mockRunning(handleDoScript: (script: string, cb: Function) => void) {
  execFileMock.mockImplementation((_file: string, args: string[], _opts: unknown, cb: Function) => {
    const script = args[1] as string;
    if (isSystemEventsCheck(script)) {
      cb(null, "true\n", "");
      return;
    }
    handleDoScript(script, cb);
  });
}

describe("runJsx — обробка результату", () => {
  it("успішний шлях повертає data і прибирає тимчасову теку", async () => {
    let capturedDir = "";
    mockRunning((script, cb) => {
      const bootstrapPath = extractBootstrapPath(script);
      capturedDir = dirname(bootstrapPath);
      const bootstrap = readFileSync(bootstrapPath, "utf8");
      const resultPath = extractGlobal(bootstrap, "IDMCP_RESULT");
      writeFileSync(resultPath, JSON.stringify({ ok: true, data: { hello: "world" } }));
      cb(null, "", "");
    });

    const result = await runJsx<{ hello: string }>("status", {});

    expect(result).toEqual({ hello: "world" });
    expect(existsSync(capturedDir)).toBe(false);
  });

  it("ok:false з NO_DOCUMENT перетворюється на IndesignError kind no-document", async () => {
    mockRunning((script, cb) => {
      const bootstrapPath = extractBootstrapPath(script);
      const bootstrap = readFileSync(bootstrapPath, "utf8");
      const resultPath = extractGlobal(bootstrap, "IDMCP_RESULT");
      writeFileSync(
        resultPath,
        JSON.stringify({
          ok: false,
          error: { message: "NO_DOCUMENT: у InDesign немає відкритих документів.", line: -1, source: "" },
        }),
      );
      cb(null);
    });

    const err = await rejection(runJsx("status", {}));
    expect(err.kind).toBe("no-document");
  });

  it("ok:false зі звичайною помилкою перетворюється на IndesignError kind jsx-error з номером рядка", async () => {
    mockRunning((script, cb) => {
      const bootstrapPath = extractBootstrapPath(script);
      const bootstrap = readFileSync(bootstrapPath, "utf8");
      const resultPath = extractGlobal(bootstrap, "IDMCP_RESULT");
      writeFileSync(
        resultPath,
        JSON.stringify({
          ok: false,
          error: { message: "TypeError: undefined has no properties", line: 42, source: "story.texts[0]" },
        }),
      );
      cb(null);
    });

    const err = await rejection(runJsx("status", {}));
    expect(err.kind).toBe("jsx-error");
    expect(err.message).toContain("42");
  });

  it("прибирає тимчасову теку, коли osascript падає без таймауту", async () => {
    let capturedDir = "";
    mockRunning((script, cb) => {
      const bootstrapPath = extractBootstrapPath(script);
      capturedDir = dirname(bootstrapPath);
      const err = new Error("execution error") as Error & { stderr?: string; killed?: boolean };
      err.stderr = "Not authorized to send Apple events (-1743)";
      err.killed = false;
      cb(err);
    });

    const err = await rejection(runJsx("status", {}));
    expect(err.kind).toBe("no-permission");
    expect(existsSync(capturedDir)).toBe(false);
  });

  it("НЕ прибирає тимчасову теку при таймауті і згадує її шлях у підказці", async () => {
    let capturedDir = "";
    mockRunning((script, cb) => {
      const bootstrapPath = extractBootstrapPath(script);
      capturedDir = dirname(bootstrapPath);
      const err = new Error("Command timed out") as Error & { killed?: boolean; signal?: string };
      err.killed = true;
      err.signal = "SIGTERM";
      cb(err);
    });

    const err = await rejection(runJsx("status", {}));

    expect(err.kind).toBe("busy");
    expect(existsSync(capturedDir)).toBe(true);
    expect(err.hint).toContain(capturedDir);

    tempDirsToCleanup.push(capturedDir);
  });
});

/*
 * H1. Повідомлення про таймаут мусить називати ліміт, під яким виклик упав.
 * У звіті видно САМЕ `message` (виконавець проходів кладе його в
 * `PassResult.error`, прогрес-рядок друкує його ж — `hint` туди не
 * потрапляє), а без числа «не встиг за відведений час» не відрізнити
 * «треба більше часу» від «зависло». Спек §6.3: довгий сеанс роздуває
 * важкий прохід у 12–29 разів, тож замало може виявитись і 180 с.
 */
describe("runJsx — повідомлення про таймаут називає вжитий ліміт", () => {
  it("-1712 (таймаут самого AppleScript): у message є число секунд, виведене з timeoutMs", async () => {
    let capturedDir = "";
    mockRunning((script, cb) => {
      capturedDir = dirname(extractBootstrapPath(script));
      const err = new Error("execution error") as Error & { stderr?: string; killed?: boolean };
      err.stderr = "execution error: Adobe InDesign 2026 got an error: AppleEvent timed out. (-1712)";
      err.killed = false;
      cb(err);
    });

    const err = await rejection(runJsx("__cli_extras", {}, { timeoutMs: 180_000 }));

    expect(err.kind).toBe("busy");
    expect(err.message).toContain("-1712");
    expect(err.message).toContain("180");
    tempDirsToCleanup.push(capturedDir);
  });

  it("убитий процес osascript: те саме число — і воно з timeoutMs, а не стале", async () => {
    let capturedDir = "";
    mockRunning((script, cb) => {
      capturedDir = dirname(extractBootstrapPath(script));
      const err = new Error("Command timed out") as Error & { killed?: boolean; signal?: string };
      err.killed = true;
      err.signal = "SIGTERM";
      cb(err);
    });

    /* Інше число, ніж у попередньому тесті, — інакше збіг зі сталою в коді
     * лишився б непоміченим. */
    const err = await rejection(runJsx("__cli_extras", {}, { timeoutMs: 45_000 }));

    expect(err.kind).toBe("busy");
    expect(err.message).toContain("45");
    expect(err.message).not.toContain("180");
    tempDirsToCleanup.push(capturedDir);
  });
});

describe("runJsx — кодування параметрів", () => {
  it("екранує U+2028/U+2029 у params.json, щоб eval у ExtendScript не впав", async () => {
    let paramsContent = "";
    mockRunning((script, cb) => {
      const bootstrapPath = extractBootstrapPath(script);
      const bootstrap = readFileSync(bootstrapPath, "utf8");
      const paramsPath = extractGlobal(bootstrap, "IDMCP_PARAMS");
      paramsContent = readFileSync(paramsPath, "utf8");
      const resultPath = extractGlobal(bootstrap, "IDMCP_RESULT");
      writeFileSync(resultPath, JSON.stringify({ ok: true, data: null }));
      cb(null);
    });

    const lineSeparator = String.fromCharCode(0x2028);
    const paragraphSeparator = String.fromCharCode(0x2029);
    await runJsx("status", { text: "рядок1" + lineSeparator + "рядок2" + paragraphSeparator });

    expect(paramsContent.indexOf(lineSeparator)).toBe(-1);
    expect(paramsContent.indexOf(paragraphSeparator)).toBe(-1);
    expect(paramsContent.indexOf("\\u2028")).toBeGreaterThanOrEqual(0);
    expect(paramsContent.indexOf("\\u2029")).toBeGreaterThanOrEqual(0);
  });
});

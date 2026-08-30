import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { readAsset } from "../embedded/assets.js";
import { IndesignError, classifyOsascriptFailure } from "./errors.js";

const execFileAsync = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
/** In the built output, jsx lives in dist/jsx next to dist/bridge. */
const JSX_DIR = join(HERE, "..", "jsx");

const APP_TARGET = process.env.INDESIGN_APP ?? 'id "com.adobe.InDesign"';
const DEFAULT_TIMEOUT = 30_000;
/** Margin between the AppleScript timeout and killing the osascript process. */
const PROCESS_KILL_GRACE_MS = 5_000;

/** Working modules loaded before every call. */
const CORE_MODULES = [
  "_core.jsx",
  "inspect.jsx",
  "find.jsx",
  "apply.jsx",
  "composition.jsx",
  "map.jsx",
  "styles.jsx",
  /* The nobreak_read handler for the `nbsp` layer of the bibliography_audit
   * tool. Without this line the handler simply won't load, and the error
   * will be «Unknown handler», which gives no clue why. */
  "bibliography.jsx",
  /* The language_runs_read handler for the spelling_audit tool. Without
   * this line the handler simply won't load, and the error will be
   * «Unknown handler», which gives no clue why. */
  "spelling.jsx",
  "pagination.jsx",
  /* AFTER `pagination.jsx`: the write handler compares text using the same
   * `IDMCP.claimParagraph` as the measurement — precisely so the two
   * implementations of one rule don't drift apart. Without this line the
   * handler simply won't load, and the error will be «Unknown handler»,
   * which gives no clue why. */
  "pagination-write.jsx",
  /* The geometry_measure handler for the geometry_audit tool. Without this
   * line the handler simply won't load, and the error will be «Unknown
   * handler», which gives no clue why. */
  "geometry.jsx",
  /* The color_measure handler for the color_audit tool. Without this line
   * the handler simply won't load, and the error will be «Unknown
   * handler», which gives no clue why. */
  "color.jsx",
  "preflight.jsx",
  "run.jsx",
  /* The render_bounds and render_export handlers for the page_render tool.
   * They only use IDMCP.activeDoc and IDMCP.withNoInteraction from
   * _core.jsx — their order relative to the other modules doesn't matter,
   * only relative to _core.jsx (above) and cli-extras.jsx (below, per this
   * task's team request). */
  "render.jsx",
  /* The __cli_extras handler for the CLI preflight audit. Uses
   * IDMCP.pageNameFor from inspect.jsx (loaded above in this list) —
   * without this line the handler simply won't load, and the error will
   * be «Unknown handler», which gives no clue why. */
  "cli-extras.jsx",
];

/*
 * A4. `_fixtures.jsx` contains `__fixture_close`, which closes the document
 * with SaveOptions.NO. As long as it rode along on every call, this handler
 * was available right next to the user's working layout. Now it loads only
 * when the caller explicitly asks for it — i.e., in integration tests.
 */
export function jsxModules(env: NodeJS.ProcessEnv = process.env): string[] {
  return env.INDESIGN_MCP_FIXTURES ? [...CORE_MODULES, "_fixtures.jsx"] : [...CORE_MODULES];
}

/** One JSX module in the load plan. */
export interface JsxLoad {
  /** The path that `$.evalFile` will receive. */
  path: string;
  /** `null` — the file is already on disk; otherwise the content to write there. */
  contents: string | null;
}

/**
 * Where to source each JSX module from.
 *
 * AN EMBEDDED MODULE STILL GOES THROUGH A FILE, rather than being pasted
 * into the bootstrap. There are two reasons, both measured on this project.
 * First, `$.evalFile` on a separate file gives a line number WITHIN ITS OWN
 * module — a concatenated text would turn every ExtendScript error into a
 * report about a line in the thousands, which would then have to be mapped
 * back to the source by hand. Second, the load order here is critical
 * (`_core.jsx` declares `IDMCP`; `inspect.jsx` must land before
 * `cli-extras.jsx`, otherwise `IDMCP.cliPageOfPara` silently returns
 * «pasteboard» for every paragraph) — and the `jsxModules()` array remains
 * the single source of that order regardless of where the content came
 * from.
 *
 * The temp folder is already created for `params.json`/`result.json` and is
 * cleaned up by that same `rm`, so embedded modules add no new cleanup.
 */
export function planJsxLoads(modules: string[], tempDir: string): JsxLoad[] {
  return modules.map((m) => {
    const embedded = readAsset(`jsx/${m}`);
    return embedded === null
      ? { path: join(JSX_DIR, m), contents: null }
      : { path: join(tempDir, m), contents: embedded };
  });
}

interface JsxResult<T> {
  ok: boolean;
  data?: T;
  error?: { message: string; line: number; source: string; fileName?: string };
}

export async function runJsx<T>(
  handler: string,
  params: unknown,
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  /*
   * `tell application id "..." to do script` LAUNCHES InDesign if it isn't
   * running yet, rather than returning code -600 — so a cold start of
   * InDesign 2026 (longer than DEFAULT_TIMEOUT) would otherwise be
   * misdiagnosed as «busy with a modal dialog». We check via System Events,
   * without touching InDesign itself, so as not to accidentally launch it.
   */
  await assertInDesignRunning();

  await reapStaleTempDirs();
  const dir = await mkdtemp(join(tmpdir(), "idmcp-"));
  const paramsPath = join(dir, "params.json");
  const resultPath = join(dir, "result.json");
  const bootstrapPath = join(dir, "bootstrap.jsx");
  /* On timeout, InDesign may still be running the handler — deleting the
   * folder in that case is unsafe (Task 8: it would fail writing
   * result.json into an already-deleted folder). We leave it on disk for
   * diagnostics. */
  let keepDirForInspection = false;

  try {
    await writeFile(paramsPath, encodeParams(params), "utf8");

    const plan = planJsxLoads(jsxModules(), dir);
    for (const item of plan) {
      if (item.contents !== null) await writeFile(item.path, item.contents, "utf8");
    }
    const loads = plan
      .map((item) => `$.evalFile(new File(${jsxString(item.path)}));`)
      .join("\n");
    const bootstrap = [
      `$.global.__IDMCP_PARAMS = ${jsxString(paramsPath)};`,
      `$.global.__IDMCP_RESULT = ${jsxString(resultPath)};`,
      loads,
      `IDMCP.run(${jsxString(handler)});`,
      "",
    ].join("\n");
    await writeFile(bootstrapPath, bootstrap, "utf8");

    /*
     * `do script` without an explicit `with timeout` is bounded by
     * AppleScript's default timeout (120 s) — independent of our timeoutMs.
     * Because of this, a long but perfectly healthy call (a whole-document
     * composition measurement) would fail with `AppleEvent timed out
     * (-1712)` before our own limit kicked in. We derive the AppleScript
     * timeout from timeoutMs, so there is a single boundary.
     */
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT;
    const timeoutSeconds = Math.max(2, Math.ceil(timeoutMs / 1000));
    /* Скільки насправді триває очікування до вбивства процесу: AppleScript
     * має свій ліміт, а поверх нього ще PROCESS_KILL_GRACE_MS. Повідомлення
     * досі називало лише перше число, тобто применшувало на цю пільгу. */
    const killDeadlineSeconds = Math.ceil((timeoutMs + PROCESS_KILL_GRACE_MS) / 1000);
    const applescript =
      `with timeout of ${timeoutSeconds} seconds\n` +
      `tell application ${APP_TARGET}\n` +
      `  do script (POSIX file ${appleScriptString(bootstrapPath)}) language javascript\n` +
      `end tell\n` +
      `end timeout`;

    try {
      /*
       * We kill the process LATER than the AppleScript timeout fires —
       * otherwise the kill would beat -1712 and we'd lose the more precise
       * diagnostic.
       */
      await execFileAsync("osascript", ["-e", applescript], {
        timeout: timeoutMs + PROCESS_KILL_GRACE_MS,
      });
    } catch (err) {
      const e = err as { killed?: boolean; signal?: string; stderr?: string };
      const timedOut = Boolean(e.killed) || e.signal === "SIGTERM";
      const classified = classifyOsascriptFailure(e.stderr ?? "", timedOut);
      /* Both kill and -1712 mean: the handler in InDesign may still be running. */
      if (timedOut || classified.kind === "busy") {
        keepDirForInspection = true;
        /*
         * H1: the limit is named IN THE MESSAGE ITSELF, not in a hint. The
         * report's reader sees only `message` (the pass runner puts exactly
         * this into `PassResult.error`, and the progress line prints the
         * same), and without the number "didn't finish in the time given"
         * cannot be told apart from "hung". Spec §6.3: a long session
         * inflates a heavy pass by 12–29x, so next time even 180 s might
         * turn out to be too little — and then the line shows right away
         * which 180 exactly.
         */
        throw new IndesignError(
          classified.kind,
          `${classified.message} The limit for this call is ${timeoutSeconds} s (the process is killed at ${killDeadlineSeconds} s).`,
          `${classified.hint} The temp folder was left for diagnostics: ${dir}`,
        );
      }
      throw classified;
    }

    const raw = await readFile(resultPath, "utf8");
    const parsed = JSON.parse(raw) as JsxResult<T>;

    if (!parsed.ok) {
      const info = parsed.error!;
      if (info.message.startsWith("NO_DOCUMENT:")) {
        throw new IndesignError(
          "no-document",
          info.message.replace("NO_DOCUMENT: ", ""),
          "Open the document in InDesign and try again.",
        );
      }
      throw new IndesignError(
        "jsx-error",
        /* Назва ФАЙЛА, коли ExtendScript її дав: обробник модуля не називає,
         * а рядок 453 є в п'яти модулях одразу. Порожня — не вигадуємо. */
        `ExtendScript error in "${handler}"${info.fileName ? ` (${info.fileName})` : ""}, ` +
          `line ${info.line}: ${info.message}`,
        info.source ? `Source: ${info.source}` : "Check the state of the document.",
      );
    }

    return parsed.data as T;
  } finally {
    if (!keepDirForInspection) {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

/**
 * СКІЛЬКИ ЖИВЕ ЗАЛИШЕНА ДЛЯ ДІАГНОСТИКИ ТЕКА. Доба: досить, щоб її встиг
 * подивитися той, хто саме зараз розбирає таймаут, і мало, щоб вона не
 * накопичувалася тижнями.
 */
const TEMP_DIR_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * ПРИБИРАЄ ЧУЖІ ЗАЛИШЕНІ ТЕКИ ПЕРЕД ТИМ, ЯК ЗРОБИТИ СВОЮ.
 *
 * На таймауті `keepDirForInspection` лишає теку НАВМИСНО — видалити її було б
 * небезпечно (обробник у InDesign ще живий і може писати туди `result.json`), і
 * її шлях названо в підказці. Але не прибирав її потім НІХТО: у зібраному
 * пакунку там лежать усі 18 модулів JSX плюс `params.json` і `bootstrap.jsx`,
 * а важкий прохід, що впирається в таймаут кілька разів за день, залишає
 * стільки ж копій.
 *
 * Прибирання ПЕРЕД створенням, а не після роботи: своєї теки воно не чіпає
 * ніколи, і поточний виклик від нього не залежить. Мовчазне й неблокуюче —
 * невдача прибирання не сміє стати першою причиною падіння виклику, як і в
 * `global-fixture-sweep.ts`.
 */
async function reapStaleTempDirs(): Promise<void> {
  try {
    const root = tmpdir();
    const now = Date.now();
    for (const name of await readdir(root)) {
      if (!name.startsWith("idmcp-")) continue;
      const path = join(root, name);
      try {
        const info = await stat(path);
        if (!info.isDirectory()) continue;
        if (now - info.mtimeMs < TEMP_DIR_TTL_MS) continue;
        await rm(path, { recursive: true, force: true });
      } catch {
        /* Зникла між читанням і видаленням, або чужа за правами — не наша справа. */
      }
    }
  } catch {
    /* Тимчасова тека недоступна — це проблема виклику нижче, не прибирання. */
  }
}

/**
 * A check through System Events responds instantly (without launching any
 * heavy application), so a short timeout of its own is more fitting than the
 * call's overall timeoutMs. Without a limit, the call could hang forever if
 * macOS showed a TCC permission dialog for Automation access to System
 * Events and the user didn't notice it.
 */
const SYSTEM_EVENTS_CHECK_TIMEOUT_MS = 5_000;

/**
 * Throws not-running if the InDesign process isn't found. We check via
 * System Events (not via `tell application id "com.adobe.InDesign"`),
 * because any reference to InDesign itself, while it isn't running, launches
 * it.
 */
async function assertInDesignRunning(): Promise<void> {
  /*
   * `is` НА ПОЧАТОК НАЗВИ, А НЕ `contains`.
   *
   * `contains "InDesign"` збігається і з «Adobe InDesign 2026 (Installer)», і
   * з допоміжним процесом CEP, і з `InDesignServer`. Перевірка тоді
   * проходила, а справжній `do script` падав нижче з менш зрозумілою
   * помилкою, ніж `not-running`, заради якої ця функція й існує.
   * `starts with "Adobe InDesign"` лишає звичайні збірки різних років і
   * відсікає інсталятор та сервер, чиї назви починаються інакше.
   */
  const script =
    'tell application "System Events" to (exists (some process whose name starts with "Adobe InDesign" ' +
    'and name does not contain "Installer" and name does not contain "Server"))';
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("osascript", ["-e", script], {
      timeout: SYSTEM_EVENTS_CHECK_TIMEOUT_MS,
    }));
  } catch (err) {
    const e = err as { killed?: boolean; signal?: string; stderr?: string };
    const timedOut = Boolean(e.killed) || e.signal === "SIGTERM";
    /* target="System Events" — this is the application that actually failed,
     * so classifyOsascriptFailure will build a hint that names it, not
     * InDesign (by default InDesign is passed only for the do script below). */
    throw classifyOsascriptFailure(e.stderr ?? "", timedOut, "System Events");
  }
  if (stdout.trim() !== "true") {
    throw new IndesignError(
      "not-running",
      "Adobe InDesign is not running.",
      "Launch Adobe InDesign 2026 and open a document.",
    );
  }
}

/**
 * JSON.stringify does not escape U+2028/U+2029 (LINE/PARAGRAPH SEPARATOR) —
 * they go into the file as raw bytes. ExtendScript (ES3) treats these
 * characters as LineTerminator and forbids them inside a string literal, so
 * IDMCP.parse (eval) would fail with a SyntaxError if the edit text
 * contained a line separator.
 */
function encodeParams(params: unknown): string {
  return JSON.stringify(params ?? {})
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** A string literal for ExtendScript. */
function jsxString(value: string): string {
  return JSON.stringify(value);
}

/** A string literal for AppleScript. */
function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

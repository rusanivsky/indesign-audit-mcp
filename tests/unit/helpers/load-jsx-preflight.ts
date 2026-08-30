import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { loadJsxCore } from "./load-jsx-core.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PREFLIGHT_PATH = join(HERE, "..", "..", "..", "src", "jsx", "preflight.jsx");

/**
 * Виконує СПРАВЖНІЙ `src/jsx/preflight.jsx` поверх справжнього `_core.jsx` — з
 * тих самих міркувань, що й `loadJsxApply`: перевіряємо той код, який поїде в
 * InDesign, а не його переказ у TypeScript.
 *
 * НАВІЩО ЦЕ ТУТ. Обробник має гілку, недосяжну в реальному прогоні: «очікування
 * не дочекалось, але результат усе ж прочитався». Живий InDesign у цьому стані
 * кидає при читанні `aggregatedResults` (виміряно), тож інтеграційний тест
 * дійти до неї не може — до неї доходить лише інший, гірший InDesign, якого в
 * нас немає. Підставні `app`/`doc` дають той стан на вимогу.
 *
 * На верхньому рівні `preflight.jsx` лише вішає функції на `IDMCP` і
 * `IDMCP.handlers`; до `app` він звертається виключно всередині тіл функцій,
 * тож для самого завантаження підставні глобальні об'єкти не потрібні — вони
 * потрібні на виклик, і їх ставить `withFakeApp`.
 */
export function loadJsxPreflight(): any {
  const IDMCP = loadJsxCore();
  vm.runInThisContext(readFileSync(PREFLIGHT_PATH, "utf8"), { filename: PREFLIGHT_PATH });
  return IDMCP;
}

export interface FakeProcess {
  /**
   * Що поверне `waitForProcess`. ВИМІРЯНО: `true` означає «НЕ дочекалось».
   * Тип `unknown`, а не `boolean`, СВІДОМО: обробник мусить лишитись гучним і
   * на значенні поза {true, false}, а перевірити це можна лише подавши таке.
   */
  waitReturns: unknown;
  /** Коли задано — читання `aggregatedResults` кидає з цим текстом. */
  aggThrows?: string;
  /** Сирий `aggregatedResults`, як його віддає InDesign. */
  agg?: unknown;
  /** Коли `true` — `remove()` кидає (перевірка `processRemoved`). */
  removeThrows?: boolean;
  removeCalls: number;
}

export interface FakeAppOptions {
  process: FakeProcess;
  docName?: string;
  profileNames?: string[];
  workingProfile?: string;
  rules?: Array<{ id: string; flag: string }>;
  preflightOff?: boolean;
}

/**
 * Ставить підставні `app` і `IDMCP.activeDoc` на час одного виклику й прибирає
 * їх після. Форма об'єктів — рівно та, яку виміряно на живому InDesign:
 * `preflightProfiles` індексується числом і має `length`, правило несе `id` і
 * `flag`, `aggregatedResults` — це `[назва, профіль, рядки]`.
 */
export function withFakeApp<T>(IDMCP: any, opts: FakeAppOptions, fn: () => T): T {
  const proc = opts.process;
  const rules = opts.rules ?? [
    { id: "ADBE_OversetText", flag: "RETURN_AS_ERROR" },
    { id: "ADBE_ImageResolution", flag: "RULE_IS_DISABLED" },
  ];
  const profiles = (opts.profileNames ?? ["[Basic]"]).map((name) => ({
    name,
    preflightProfileRules: Object.assign(rules.slice(), { length: rules.length }),
  }));

  const doc = {
    name: opts.docName ?? "Фікстура.indd",
    preflightOptions: {
      preflightWorkingProfile: opts.workingProfile ?? "[Basic]",
      preflightOff: opts.preflightOff ?? false,
      preflightScope: "PREFLIGHT_ALL_PAGES",
    },
  };

  const fakeProcess = {
    waitForProcess(_seconds: number) {
      return proc.waitReturns;
    },
    get aggregatedResults() {
      if (proc.aggThrows) throw new Error(proc.aggThrows);
      return proc.agg;
    },
    remove() {
      proc.removeCalls++;
      if (proc.removeThrows) throw new Error("не вдалося прибрати процес");
    },
  };

  const prevApp = (globalThis as { app?: unknown }).app;
  const prevActiveDoc = IDMCP.activeDoc;
  (globalThis as { app?: unknown }).app = {
    preflightProfiles: Object.assign(profiles.slice(), { length: profiles.length }),
    preflightProcesses: { add: () => fakeProcess },
  };
  IDMCP.activeDoc = () => doc;
  try {
    return fn();
  } finally {
    (globalThis as { app?: unknown }).app = prevApp;
    IDMCP.activeDoc = prevActiveDoc;
  }
}

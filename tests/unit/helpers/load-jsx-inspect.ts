import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { loadJsxCore } from "./load-jsx-core.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const INSPECT_PATH = join(HERE, "..", "..", "..", "src", "jsx", "inspect.jsx");

/**
 * Виконує СПРАВЖНІЙ `src/jsx/inspect.jsx` поверх справжнього `_core.jsx` —
 * з тих самих міркувань, що й решта завантажувачів: перевіряємо той код, що
 * поїде в InDesign, а не переказ його логіки в TypeScript.
 *
 * На верхньому рівні файл лише вішає функції на `IDMCP`; до `app`/`doc` він
 * звертається виключно всередині тіл, тож для самого завантаження підставні
 * глобальні об'єкти не потрібні.
 */
export function loadJsxInspect(): any {
  const IDMCP = loadJsxCore();
  vm.runInThisContext(readFileSync(INSPECT_PATH, "utf8"), { filename: INSPECT_PATH });
  return IDMCP;
}

/**
 * Об'єкт, який КИДАЄ на переліку властивостей — рівно так, як це робить
 * ExtendScript.
 *
 * Це не стилізація під помилку, а відтворення виміряної поведінки: читання
 * `parentPage` на TextPath не повертає `undefined`, воно кидає «Object does
 * not support the property or method 'parentPage'» (зонд
 * `scripts/probe-textpath.jsx`, 2026-08-18, InDesign 21.5.1.73, чотири
 * контейнери з 724). Підставити тут `undefined` означало б написати тест, що
 * проходить на моделі, якої в природі немає.
 */
export function throwingOn<T extends object>(base: T, missing: string[]): T {
  const blocked = new Set(missing);
  return new Proxy(base, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && blocked.has(prop)) {
        throw new Error(`Object does not support the property or method '${prop}'`);
      }
      return Reflect.get(target, prop, receiver);
    },
    has(target, prop) {
      if (typeof prop === "string" && blocked.has(prop)) return false;
      return Reflect.has(target, prop);
    },
  });
}

/**
 * Перелік, ВИМІРЯНИЙ на живому TextPath: 111 властивостей PageItem, яких у
 * нього немає. Тут — ті, що їх справді читає наш JSX; решта в зонді.
 */
export const TEXT_PATH_MISSING = [
  "parentPage",
  "rotationAngle",
  "absoluteRotationAngle",
  "geometricBounds",
  "visibleBounds",
  "itemLayer",
  "textFramePreferences",
  "locked",
  "visible",
  "strokeWeight",
];

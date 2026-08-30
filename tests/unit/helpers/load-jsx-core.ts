import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const HERE = dirname(fileURLToPath(import.meta.url));
const CORE_PATH = join(HERE, "..", "..", "..", "src", "jsx", "_core.jsx");

/**
 * Виконує СПРАВЖНІЙ src/jsx/_core.jsx (а не його ручну копію в TypeScript) —
 * тому будь-яка майбутня правка quote/stringify/resolveContainer або зламає
 * ці тести, або мовчки пройде повз них не зможе. _core.jsx користується лише
 * підмножиною ES3, яка є звичайним JS, тож рушій V8 виконує його як є.
 * Функції на кшталт readFile/writeFile/withNoInteraction звертаються до
 * File/app лише всередині свого тіла — саме визначення функцій цього не
 * потребує, тому підставних глобальних об'єктів тут не треба.
 *
 * Навмисно НЕ використовуємо vm.createContext: окремий контекст створює
 * окрему реалізацію (інший Array/Object), і тоді "value instanceof Array"
 * всередині IDMCP.stringify не впізнає масиви, створені в тестовому файлі
 * (вони — з іншої реалізації). runInThisContext виконує код у тій самій
 * реалізації, що й тест, тому instanceof працює як у справжньому ExtendScript.
 */
export function loadJsxCore(): any {
  const code = readFileSync(CORE_PATH, "utf8");
  vm.runInThisContext(code, { filename: CORE_PATH });
  return (globalThis as { IDMCP?: unknown }).IDMCP;
}

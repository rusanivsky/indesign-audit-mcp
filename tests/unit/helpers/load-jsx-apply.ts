import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { loadJsxCore } from "./load-jsx-core.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const APPLY_PATH = join(HERE, "..", "..", "..", "src", "jsx", "apply.jsx");

/**
 * Виконує СПРАВЖНІЙ src/jsx/apply.jsx поверх справжнього _core.jsx — з тих
 * самих міркувань, що й loadJsxCore: перевіряємо той код, який поїде в
 * InDesign, а не його переказ у TypeScript.
 *
 * На верхньому рівні apply.jsx лише вішає функції на IDMCP і IDMCP.handlers —
 * до app, doc чи File він звертається виключно всередині тіл функцій, тож для
 * самого завантаження підставні глобальні об'єкти не потрібні. Функції, які
 * справді потребують File (uniqueBackupFile), тут не тестуються — їх покриває
 * інтеграційний тест на живому InDesign, де File справжній.
 */
export function loadJsxApply(): any {
  const IDMCP = loadJsxCore();
  vm.runInThisContext(readFileSync(APPLY_PATH, "utf8"), { filename: APPLY_PATH });
  return IDMCP;
}

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { loadJsxCore } from "./load-jsx-core.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const STYLES_PATH = join(HERE, "..", "..", "..", "src", "jsx", "styles.jsx");

/**
 * Виконує СПРАВЖНІЙ `src/jsx/styles.jsx` поверх справжнього `_core.jsx` — та
 * сама схема, що `load-jsx-apply.ts` для `apply.jsx` (звіт Задачі 12/13,
 * рецензія кола 1, I-1): перевіряємо код, який поїде в InDesign, а не його
 * переказ у TypeScript.
 *
 * На верхньому рівні `styles.jsx` лише вішає функції на IDMCP і
 * IDMCP.handlers — до `app`/`doc` він звертається виключно всередині тіл
 * функцій, тож для самого завантаження підставні глобальні об'єкти не
 * потрібні. `IDMCP.anyFontName` конкретно — чиста функція без жодної
 * залежності від InDesign, тому саме її тестуємо тут behavior-тестом, а не
 * текстовим сторожем: справжнє виконання ловить більше мутантів, ніж пошук
 * підрядка.
 */
export function loadJsxStyles(): any {
  const IDMCP = loadJsxCore();
  vm.runInThisContext(readFileSync(STYLES_PATH, "utf8"), { filename: STYLES_PATH });
  return IDMCP;
}

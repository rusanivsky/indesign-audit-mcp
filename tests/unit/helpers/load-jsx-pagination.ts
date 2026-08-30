import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { loadJsxCore } from "./load-jsx-core.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGINATION_PATH = join(HERE, "..", "..", "..", "src", "jsx", "pagination.jsx");

/**
 * Виконує СПРАВЖНІЙ `src/jsx/pagination.jsx` поверх справжнього `_core.jsx`.
 *
 * ВІДМІННІСТЬ ВІД РЕШТИ ЗАВАНТАЖУВАЧІВ: цей файл звертається до глобального
 * `SpecialCharacters` НА ВЕРХНЬОМУ РІВНІ (`pagination.jsx:32-34`, таблиця
 * маркерів), а не лише всередині тіл функцій. Тому підставний об'єкт треба
 * поставити ДО виконання, а не на виклик.
 *
 * Значення в ньому — довільні сентінели: у тестах, що користуються цим
 * завантажувачем, звіряються не самі коди, а поведінка функцій, які їх не
 * читають. Якщо колись знадобляться справжні коди — вони виміряні й лежать у
 * `docs/measured-facts-phase6.md` (усі три маркери мають ОДНАКОВИЙ код 24, тип
 * видно лише через enum символу).
 */
export function loadJsxPagination(): any {
  const IDMCP = loadJsxCore();
  const g = globalThis as Record<string, unknown>;
  const previous = g.SpecialCharacters;
  g.SpecialCharacters = {
    AUTO_PAGE_NUMBER: "AUTO_PAGE_NUMBER",
    SECTION_MARKER: "SECTION_MARKER",
    NEXT_PAGE_NUMBER: "NEXT_PAGE_NUMBER",
    PREVIOUS_PAGE_NUMBER: "PREVIOUS_PAGE_NUMBER",
  };
  try {
    vm.runInThisContext(readFileSync(PAGINATION_PATH, "utf8"), { filename: PAGINATION_PATH });
  } finally {
    if (previous === undefined) delete g.SpecialCharacters;
    else g.SpecialCharacters = previous;
  }
  return IDMCP;
}

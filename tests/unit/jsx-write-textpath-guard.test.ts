import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { loadJsxPagination } from "./helpers/load-jsx-pagination.js";
import { throwingOn, TEXT_PATH_MISSING } from "./helpers/load-jsx-inspect.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const JSX = (name: string) => join(HERE, "..", "..", "src", "jsx", name);

/**
 * ВОРОТА НА ШЛЯХУ ЗАПИСУ: текст уздовж контуру колонцифрою не буває.
 *
 * ЧОМУ ЦЕ ІСНУЄ, І ЧОМУ САМЕ ЯВНИМИ ВОРОТАМИ. Я двічі поспіль помилився в
 * міркуванні й обидва рази мене виправив вимір на живому документі
 * (2026-08-18, «Зоряні Мрії»):
 *
 *   1. «`doc.pageItems.itemByID` не може віддати TextPath, бо той не елемент
 *      сторінки» — МОЖЕ: `isValid → true`, `getElements()[0].constructor.name
 *      → TextPath` (контроль: неіснуючий id дає `isValid → false`).
 *   2. «`isTextFrameLike` його відсіє» — НЕ ВІДСІЄ: у TextPath є
 *      `paragraphs`, і предикат пропускає.
 *
 * До правки TextPath відсіювався ВИПАДКОВО: `parentPageOf` віддавав `null`,
 * сторінка не збігалась із виміряною, і рамка діставала відмову «макет
 * змінився» — правильний результат із неправдивою причиною. Відколи
 * `parentPageOf` знає графічного власника, сторінка СХОДИТЬСЯ, і випадковий
 * захист зник.
 *
 * Ціна помилки несиметрична: це шлях ЗАПИСУ.
 */
function loadWrite(): any {
  const IDMCP = loadJsxPagination();
  vm.runInThisContext(readFileSync(JSX("inspect.jsx"), "utf8"), { filename: "inspect.jsx" });
  /* `pagination-write.jsx` теж чіпає `SpecialCharacters` на верхньому рівні
   * (`FOLIO_MARKER_BY_DIRECTION`), тож підставний об'єкт має стояти й тут. */
  const g = globalThis as Record<string, unknown>;
  const previous = g.SpecialCharacters;
  g.SpecialCharacters = {
    AUTO_PAGE_NUMBER: "AUTO_PAGE_NUMBER",
    SECTION_MARKER: "SECTION_MARKER",
    NEXT_PAGE_NUMBER: "NEXT_PAGE_NUMBER",
    PREVIOUS_PAGE_NUMBER: "PREVIOUS_PAGE_NUMBER",
  };
  try {
    vm.runInThisContext(readFileSync(JSX("pagination-write.jsx"), "utf8"), {
      filename: "pagination-write.jsx",
    });
  } finally {
    if (previous === undefined) delete g.SpecialCharacters;
    else g.SpecialCharacters = previous;
  }
  return IDMCP;
}

/** Документ, чий `pageItems.itemByID` віддає задану рамку — як робить InDesign. */
function fakeDoc(byId: Record<number, unknown>): unknown {
  return { pageItems: { itemByID: (id: number) => byId[id] ?? { isValid: false } } };
}

/** Текст уздовж контуру — точна копія виміряної форми. */
function textPathFrame(ownerPage: string) {
  const owner = {
    id: 4984,
    parentPage: { name: ownerPage },
    parent: { constructor: { name: "Group" } },
  };
  return throwingOn(
    {
      id: 4985,
      isValid: true,
      contents: "• ВИДАВНИЧИЙ •",
      paragraphs: { length: 1 },
      parent: owner,
    },
    TEXT_PATH_MISSING,
  );
}

describe("replaceFolioLiteral відмовляє тексту вздовж контуру", () => {
  it("відмова НАЗИВАЄ причину, а не ховається за «макет змінився»", () => {
    const IDMCP = loadWrite();
    const doc = fakeDoc({ 4985: textPathFrame("592") });
    const причина = IDMCP.replaceFolioLiteral(doc, {
      frameId: "4985",
      page: "592",
      direction: "previous",
      literal: 591,
    });
    expect(причина).toMatch(/text-on-a-path/);
    expect(причина).toMatch(/4985/);
    /* Саме тут раніше стояла НЕПРАВДИВА причина. */
    expect(причина).not.toMatch(/макет змінився/);
  });

  it("НЕГАТИВНИЙ КОНТРОЛЬ: сторінка СХОДИТЬСЯ, тож старий захист уже не спрацював би", () => {
    /*
     * Це і є доказ, що ворота потрібні. `parentPageOf` тепер віддає сторінку
     * власника (592), і вона дорівнює тій, на якій рамку «виміряли». Стара
     * перевірка «pageName !== e.page» пропустила б цей запис далі.
     */
    const IDMCP = loadWrite();
    const frame = textPathFrame("592");
    expect(IDMCP.parentPageOf(frame)).not.toBeNull();
    expect(IDMCP.parentPageOf(frame).name).toBe("592");
    expect(IDMCP.containerOnPath(frame)).toBe(true);
  });

  it("звичайна рамка воротами НЕ зачіпається", () => {
    const IDMCP = loadWrite();
    const frame = {
      id: 700,
      isValid: true,
      parentPage: { name: "12" },
      paragraphs: { length: 1 },
      parent: { constructor: { name: "Spread" } },
    };
    const причина = IDMCP.replaceFolioLiteral(fakeDoc({ 700: frame }), {
      frameId: "700",
      page: "12",
      direction: "previous",
      literal: 11,
    });
    /* Проходить далі — до перевірок замків і тексту, тобто НЕ на цих воротах. */
    expect(String(причина ?? "")).not.toMatch(/text-on-a-path/);
  });
});

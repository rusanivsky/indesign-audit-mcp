import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { loadJsxCore } from "./load-jsx-core.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const INSPECT_PATH = join(HERE, "..", "..", "..", "src", "jsx", "inspect.jsx");
const CLI_EXTRAS_PATH = join(HERE, "..", "..", "..", "src", "jsx", "cli-extras.jsx");

/**
 * Виконує СПРАВЖНІЙ `src/jsx/cli-extras.jsx` поверх справжнього `_core.jsx`
 * і `inspect.jsx` — з тих самих міркувань, що й `loadJsxApply`/
 * `loadJsxPreflight`: перевіряємо той код, який поїде в InDesign, а не
 * переказ його логіки в TypeScript.
 *
 * `inspect.jsx` — ПЕРЕД `cli-extras.jsx`, той самий порядок, що й у
 * реальному мості (`src/bridge/runner.ts`, `CORE_MODULES`): `IDMCP.
 * cliPageOfPara` кличе `IDMCP.pageNameFor`, визначений в `inspect.jsx`. Без
 * цього порядку `pageNameFor` був би `undefined`, виклик кинув би, і
 * `cliPageOfPara`, спіймавши той кидок у своєму `try`, тихо повернув би
 * «монтажний стіл» для КОЖНОГО абзаца — сторінки в тестах були б фіктивні.
 *
 * На верхньому рівні обидва файли лише вішають функції на `IDMCP` — до
 * `app`/`doc` вони звертаються виключно всередині тіл функцій, тож для
 * самого завантаження підставні глобальні об'єкти не потрібні. Вони
 * потрібні на ВИКЛИК — їх ставить `withFakeIndesignApp` поруч.
 */
export function loadJsxCliExtras(): any {
  const IDMCP = loadJsxCore();
  vm.runInThisContext(readFileSync(INSPECT_PATH, "utf8"), { filename: INSPECT_PATH });
  vm.runInThisContext(readFileSync(CLI_EXTRAS_PATH, "utf8"), { filename: CLI_EXTRAS_PATH });
  return IDMCP;
}

export interface FakePara {
  /** Контекст, що йде в `para.appliedParagraphStyle.name`. */
  style: string;
  /** `para.contents` — текст абзаца. */
  contents: string;
  /**
   * Місце в порядку СТОРІНОК (не в порядку обходу `doc.stories`!) — те
   * саме `page.documentOffset`, яке зонд на живому документі 2026-08-16
   * виміряв як справжній порядок читання номерів (див. коментар при
   * `IDMCP.cliSequenceOrderKey` у `cli-extras.jsx`).
   */
  pageOffset: number;
  /** Назва сторінки — те, що піде в поле `page` результату. */
  pageName: string;
  /** Вертикальна позиція рамки НА сторінці (`geometricBounds[0]`). */
  top: number;
}

/**
 * Підставний `doc` — рівно ті властивості, які чіпає `__cli_extras`:
 * `documentPreferences` (для pageFormat/bleed), `stories[].paragraphs`,
 * `allPageItems` (порожній масив — тест не про монтажний стіл).
 *
 * Кожен `FakePara` стає своєю ОКРЕМОЮ story з ОДНИМ абзацом — так само, як
 * на живому документі: зонд показав, що кожне входження стилю «Нумерація
 * питань» сидить у власній однопараграфній історії, а сам масив `doc.
 * stories` НЕ йде в порядку сторінок.
 */
export function fakeDoc(paras: FakePara[]): unknown {
  return {
    documentPreferences: {
      pageWidth: 0,
      pageHeight: 0,
      documentBleedTopOffset: 0,
      documentBleedBottomOffset: 0,
      documentBleedInsideOrLeftOffset: 0,
      documentBleedOutsideOrRightOffset: 0,
    },
    stories: paras.map((p) => ({
      paragraphs: [
        {
          appliedParagraphStyle: { name: p.style },
          contents: p.contents,
          horizontalScale: 100,
          pointSize: 10,
          parentTextFrames: [
            {
              parentPage: { documentOffset: p.pageOffset, name: p.pageName },
              geometricBounds: [p.top, 0, p.top + 20, 100],
            },
          ],
        },
      ],
    })),
    allPageItems: [],
  };
}

/** Ставить підставні `app`/`MeasurementUnits` на час одного виклику й прибирає їх після. */
export function withFakeIndesignApp<T>(doc: unknown, fn: () => T): T {
  const g = globalThis as Record<string, unknown>;
  const previousApp = g.app;
  const previousUnits = g.MeasurementUnits;
  g.app = {
    documents: { length: 1 },
    activeDocument: doc,
    scriptPreferences: { measurementUnit: "MILLIMETERS" },
  };
  g.MeasurementUnits = { POINTS: "POINTS" };
  try {
    return fn();
  } finally {
    g.app = previousApp;
    g.MeasurementUnits = previousUnits;
  }
}

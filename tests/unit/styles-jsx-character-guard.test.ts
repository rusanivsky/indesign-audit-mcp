import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadJsxStyles } from "./helpers/load-jsx-styles.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/*
 * Та сама техніка, що в `layout-jsx-styleid-guard.test.ts` (C-1, коло 2):
 * прибирає ExtendScript-коментарі ДО пошуку по тексту, інакше закоментований
 * рядок ("// appliedFont: IDMCP.anyFontName(...)") проходить сторожа так
 * само, як живий код — уже одного разу ловили на `map.jsx`.
 */
function stripComments(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  let inString: '"' | "'" | null = null;

  while (i < n) {
    const ch = src[i];

    if (inString) {
      out += ch;
      if (ch === "\\" && i + 1 < n) {
        out += src[i + 1];
        i += 2;
        continue;
      }
      if (ch === inString) inString = null;
      i += 1;
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = ch;
      out += ch;
      i += 1;
      continue;
    }

    if (ch === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") i += 1;
      continue;
    }

    if (ch === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

function stylesJsxSource(): string {
  return stripComments(readFileSync(join(ROOT, "src", "jsx", "styles.jsx"), "utf8"));
}

/*
 * Рецензія Задачі 13, коло 1, I-1: жоден тест не захищав JSX-бік родини
 * `character` — ні `tests/integration/styles-measure.test.ts` (не згадує
 * ranges/characterStyles/appliedFont узагалі), ні юніт-рівень (чистий
 * TypeScript `character.ts` не бачить `styles.jsx`). Наслідок: мутант
 * «anyFontName -> fontFamilyName у styles.jsx» (та сама порожня колонка
 * гарнітури, проти якої писався весь пункт 2 брифа Задачі 13) не ловився
 * НІЧИМ, так само як мутант «звузити обхід діапазонів до голих (continue за
 * назвою символьного стилю)» — пропустив би 131 випадок масштабу зі 164.
 *
 * Живого InDesign тут немає (юніт-рівень) — це сторож ТЕКСТУ файлу, не
 * поведінки, з тих самих причин, що в `layout-jsx-styleid-guard.test.ts`.
 */
describe("охорона: styles.jsx — гарнітура діапазону й повний обхід ranges (I-1)", () => {
  it("читання шрифту діапазону йде через anyFontName (не в коментарі)", () => {
    const src = stylesJsxSource();
    expect(src).toMatch(/appliedFont:\s*IDMCP\.anyFontName\(run\.appliedFont\)/);
  });

  it("IDMCP.fontFamilyName у styles.jsx не використовується — вона написана під об'єктну форму й дала б порожню колонку для символьного стилю", () => {
    const src = stylesJsxSource();
    expect(src).not.toMatch(/IDMCP\.fontFamilyName\(/);
  });

  it("обхід textStyleRanges не звужується до голих діапазонів — немає continue у циклі збору ranges", () => {
    const src = stylesJsxSource();
    const loopStart = src.indexOf("var runs = para.textStyleRanges;");
    expect(loopStart, "не знайдено цикл textStyleRanges у styles_measure").toBeGreaterThan(-1);
    const loopEnd = src.indexOf("var allCharStyles = doc.allCharacterStyles;", loopStart);
    expect(loopEnd, "не знайдено кінець ділянки збору ranges/characterStyles").toBeGreaterThan(loopStart);
    const loopBody = src.slice(loopStart, loopEnd);
    expect(loopBody).not.toMatch(/continue/);
  });

  /*
   * Дрібне п.5 рецензії: `characterStyles` мусить рахувати ужиток за `.id`
   * стилю, не за назвою — інакше два символьні стилі з однаковою назвою
   * зіллються в лічбі, і невживаний зникне за спиною ужитого (та сама
   * пастка, що Critical у сусідній родині `usage`).
   */
  it("лічильник ужитку символьних стилів індексується за .id, не за назвою", () => {
    const src = stylesJsxSource();
    expect(src).toMatch(/charStyleRunCounts\[csId\]/);
    expect(src).not.toMatch(/charStyleRunCounts\[csName\]/);
  });

  it("інвентар символьних стилів читає ужиток за тим самим .id і несе його назовні полем id", () => {
    const src = stylesJsxSource();
    const invStart = src.indexOf("var allCharStyles = doc.allCharacterStyles;");
    expect(invStart, "не знайдено ділянку інвентаря символьних стилів").toBeGreaterThan(-1);
    const invBody = src.slice(invStart);
    expect(invBody).toMatch(/charStyleRunCounts\[csStyleId\]/);
    expect(invBody).toMatch(/id:\s*csStyleId/);
  });

  it("лічба ужитку захищена від успадкованих властивостей Object.prototype (hasOwnProperty)", () => {
    const src = stylesJsxSource();
    expect(src).toMatch(/charStyleRunCounts\.hasOwnProperty\(csId\)/);
    expect(src).toMatch(/charStyleRunCounts\.hasOwnProperty\(csStyleId\)/);
  });
});

/*
 * Behavior-тест, не текстовий сторож: `IDMCP.anyFontName` — чиста функція
 * без залежності від InDesign, тож справжнє виконання (через loadJsxStyles,
 * той самий VM-харнес, що `loadJsxApply` для apply.jsx) ловить більше
 * мутантів, ніж пошук підрядка.
 */
describe("IDMCP.anyFontName (behavior, coло 1 дрібне п.1)", () => {
  const IDMCP = loadJsxStyles();

  it("undefined/null -> null", () => {
    expect(IDMCP.anyFontName(undefined)).toBeNull();
    expect(IDMCP.anyFontName(null)).toBeNull();
  });

  it("рядок (символьний стиль, виміряна форма) -> той самий рядок", () => {
    expect(IDMCP.anyFontName("Minion Pro")).toBe("Minion Pro");
  });

  it("порожній рядок -> null", () => {
    expect(IDMCP.anyFontName("")).toBeNull();
  });

  it("об'єкт Font з .fontFamily (абзац/діапазон, виміряна форма) -> .fontFamily", () => {
    expect(IDMCP.anyFontName({ fontFamily: "Minion Pro" })).toBe("Minion Pro");
  });

  /*
   * Обгортка String: typeof "object", АЛЕ String(value) дає читабельний
   * текст через вбудований toString/valueOf — не "[object ...]". Це та
   * ознака, яку перший варіант функції (typeof-перевірка сама-по-собі)
   * пропускав: об'єкт, не рядок за typeof, без .fontFamily — провалювався б
   * у порожню колонку. Мутант «прибрати другий шанс після .fontFamily»
   * ловиться рівно цим тестом.
   */
  it("обгортка String без .fontFamily -> текст через другий шанс String(value)", () => {
    const stringWrapper = { toString: () => "Vydilennia" };
    expect(IDMCP.anyFontName(stringWrapper)).toBe("Vydilennia");
  });

  /*
   * Справжній Font-подібний об'єкт: .fontFamily недоступний (undefined), а
   * String(value) дає "[object ...]" — так само, як виміряно для Font у
   * map.jsx (String(font) === "[object Font]"). Другий шанс МУСИТЬ його
   * відкинути, інакше колонка гарнітури почала б показувати сміття "[object
   * Object]" замість чесного null.
   */
  it("об'єкт без .fontFamily, чий String() дає \"[object ...]\" -> null (не сміття в колонці)", () => {
    expect(IDMCP.anyFontName({})).toBeNull();
  });

  it("значення, що кидає на .fontFamily -> null, не виняток назовні", () => {
    const throwing = {
      get fontFamily(): string {
        throw new Error("недоступно");
      },
      toString: () => "Vydilennia",
    };
    expect(IDMCP.anyFontName(throwing)).toBe("Vydilennia");
  });
});

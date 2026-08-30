import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/*
 * Прибирає ExtendScript-коментарі (`//…` і `/*…*​/`) із джерела, зберігаючи
 * рядкові літерали з "//" чи "/*" усередині недоторканими.
 *
 * Рецензія кола 2 (C-1, залишок): перший варіант сторожа шукав по СИРОМУ
 * тексту файлу — `/styleId:\s*styleId/` знаходив рядок, навіть якщо його
 * закоментували (`// styleId: styleId,`), бо regex не відрізняє код від
 * коментаря. Наслідок для продукту той самий, що й у мутанта «прибрати
 * рядок повністю»: `p.styleId` стає `undefined` для кожного абзацу, усі
 * стилі зливаються в один рядок з ключем "undefined". Просто ДОВШИЙ regex
 * цього не лікує — потрібне однакове ставлення до «рядка немає» й «рядок
 * закоментовано», тобто прибрати коментарі ДО пошуку.
 *
 * Обхід посимвольний зі станом «у рядковому літералі / поза ним», а не
 * regex по всьому файлу наосліп: `map.jsx` на момент написання не містить
 * "//" чи "/*" усередині рядкових літералів (перевірено), але посимвольний
 * стан не покладається на цей факт — він коректний і тоді, коли з'явиться.
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

/*
 * Рецензія кола 1, C-1 (CRITICAL): жоден інший тест не захищав ЄДИНУ точку,
 * від якої залежить уся Задача 12, — вилучення `styleId` у самому обробнику
 * `layout_measure` (`src/jsx/map.jsx`). `src/tools/map.ts` викликає
 * `runJsx<LayoutMeasure>(...)` без zod-перевірки форми відповіді (голе
 * приведення типу), тож типи цього не ловлять; ExtendScript не компілюється
 * TypeScript-ом узагалі, тож і `typecheck`/`build` мовчать. Прибери рядок —
 * і `p.styleId` стане `undefined` для КОЖНОГО абзацу з живого InDesign, усі
 * стилі зіллються в один рядок звіту з ключем "undefined" — рівно
 * ПРОТИЛЕЖНИЙ ефект, заради уникнення якого й зроблена ця задача.
 *
 * Живого InDesign тут немає (юніт-рівень), тому це не тест ПОВЕДІНКИ —
 * це сторож ТЕКСТУ файлу. Менш елегантно, ніж юніт-тест на функцію, але
 * `map.jsx` — не функція TypeScript, а ExtendScript-джерело, що йде в
 * InDesign напряму: інакшого способу перевірити його вміст поза живим
 * прогоном не існує. Доведено мутантом ВИКОНАННЯМ (звіт Задачі 12, рецензії
 * кіл 1 і 2): і «прибрати рядок», і «закоментувати рядок» — тест падає;
 * повернути — тест зелений.
 */
describe("охорона: layout_measure віддає styleId (map.jsx, C-1)", () => {
  function mapJsxSource(): string {
    return stripComments(readFileSync(join(ROOT, "src", "jsx", "map.jsx"), "utf8"));
  }

  it("вилучає `.id` застосованого абзацного стилю в циклі абзаців (не в коментарі)", () => {
    expect(mapJsxSource()).toMatch(/String\(style\.id\)/);
  });

  it("передає styleId у запис абзацу (paragraphs.push у layout_measure, не в коментарі)", () => {
    const src = mapJsxSource();
    const pushStart = src.indexOf("paragraphs.push({");
    expect(pushStart, "не знайдено paragraphs.push у циклі абзаців layout_measure").toBeGreaterThan(-1);
    const pushEnd = src.indexOf("});", pushStart);
    expect(pushEnd, "не знайдено кінець об'єкта paragraphs.push").toBeGreaterThan(pushStart);
    const pushBlock = src.slice(pushStart, pushEnd);
    expect(pushBlock).toMatch(/styleId:\s*styleId/);
  });

  /*
   * M-6 (рецензія кола 1, закрито "заразом" кола 2): фолбек при невдалому
   * читанні `.id` — унікальний сентінел `"unresolved:" + containerId + "#" +
   * paragraphIndex`, НЕ порожній рядок. Порожній рядок як спільний ключ —
   * той самий дефект, заради якого існує вся задача, лише рідший: два
   * абзаци з РІЗНИХ невдалих читань злилися б в один рядок звіту. Відкат
   * catch-гілки назад до `styleId = "";` тут і ловиться.
   */
  it("фолбек при невдалому читанні .id — унікальний сентінел, не порожній рядок (M-6)", () => {
    const src = mapJsxSource();
    const tryIndex = src.indexOf("try { styleId = String(style.id);");
    expect(tryIndex, "не знайдено try/catch вилучення styleId").toBeGreaterThan(-1);
    const catchIndex = src.indexOf("catch", tryIndex);
    const lineEnd = src.indexOf("\n", catchIndex);
    const catchLine = src.slice(catchIndex, lineEnd === -1 ? undefined : lineEnd);
    expect(catchLine).toMatch(/styleId\s*=\s*"unresolved:"\s*\+/);
    expect(catchLine).not.toMatch(/styleId\s*=\s*"";?\s*}/);
  });
});

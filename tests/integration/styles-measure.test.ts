import { afterAll, beforeAll, expect, it } from "vitest";
import { runJsx } from "../../src/bridge/runner.js";
import { detectOverrides } from "../../src/layout/overrides.js";
import type { StylesMeasure } from "../../src/styles/types.js";
import { assertFixtureActive, closeFixtureDoc, makeLayoutFixtureDoc } from "./fixture-doc.js";

let docName = "";

beforeAll(async () => {
  docName = await makeLayoutFixtureDoc();
});

afterAll(async () => {
  if (docName) await closeFixtureDoc(docName);
});

it("віддає інвентар стилів із оголошеними значеннями", async () => {
  await assertFixtureActive(docName);
  const m = await runJsx<StylesMeasure>("styles_measure", {}, { timeoutMs: 120_000 });
  const names = m.styles.map((s) => s.name);
  expect(names).toContain("Osnovnyi");
  const osnovnyi = m.styles.find((s) => s.name === "Osnovnyi")!;
  expect(typeof osnovnyi.id).toBe("string");
  expect(osnovnyi.declared.pointSize).not.toBeNull();
});

it("абзаци віддаються у форматі, який споживає detectOverrides без правки", async () => {
  await assertFixtureActive(docName);
  const m = await runJsx<StylesMeasure>("styles_measure", {}, { timeoutMs: 120_000 });
  expect(m.paragraphs.length).toBeGreaterThan(0);
  const p = m.paragraphs[0]!;
  expect(p).toHaveProperty("containerId");
  expect(p).toHaveProperty("declared");
  expect(p).toHaveProperty("actual");
  expect(p).toHaveProperty("hasCharacterStyleRuns");
  /* isMaster і preview НЕ можна перевіряти самою наявністю поля: isMaster
   * заповнений хибним значенням непомітно для toHaveProperty (він і був
   * захардкоджений false — рецензія C-1), а preview — вхід detectOverrides
   * для manual-bullet (overrides.ts: p.preview.trimStart().charAt(0));
   * undefined там кидає TypeError, порожній рядок тихо ковтає цілий клас
   * знахідок. Перевіряємо не просто "поле є", а що виклик самого детектора
   * на цих даних не падає і щось реально нарахував. */
  expect(p).toHaveProperty("isMaster");
  expect(p).toHaveProperty("preview");
  expect(typeof p.preview).toBe("string");
  expect(() => detectOverrides(m.paragraphs)).not.toThrow();
  const result = detectOverrides(m.paragraphs);
  expect(result.paragraphCounts.size).toBeGreaterThan(0);
});

it("preview несе справжній текст абзацу, а не порожній рядок правильного типу", async () => {
  await assertFixtureActive(docName);
  const m = await runJsx<StylesMeasure>("styles_measure", {}, { timeoutMs: 120_000 });
  /*
   * ЗАЛИШОК I-3 (коло 2): `typeof p.preview === "string"` пропускає мутанта
   * `preview: ""` — порожній рядок теж string, .trimStart().charAt(0) на
   * ньому дає "" (не undefined), винятку нема, і саме той клас регресій,
   * що вище названо словами, лишався непокритим. Ловимо не тип, а ВМІСТ:
   * фікстура кладе в story на сторінці "1", paragraphIndex 0, буквальний
   * текст "Chystyi abzats bez pereviznachen." (src/jsx/_fixtures.jsx,
   * __fixture_make_layout) — той самий абзац, на який спирається
   * map.test.ts. Якщо preview стане "", toContain нижче впаде негайно.
   *
   * РЕЦЕНЗІЯ Задачі 8, п. Г: після додавання нових рамок Задачі 8 (`extra`,
   * `mixedFrame`) на тій самій сторінці "1" фільтр «сторінка + paragraphIndex
   * 0» більше НЕ однозначний — три різні story дають paragraphIndex 0 на
   * сторінці "1". Досі `.find()` мовчки повертав саме f1 лише тому, що вона
   * створюється РАНІШЕ за нові рамки, а `doc.stories` на практиці йде в
   * порядку створення — спостережена поведінка рушія, не гарантія API.
   * Прив'язуємось до styleName "Osnovnyi": цей стиль явно застосовано лише
   * до f1 (`f1.texts[0].appliedParagraphStyle = osnovnyi`), жодна інша рамка
   * фікстури його не використовує — тому пара (page, paragraphIndex,
   * styleName) знову однозначна. Явна перевірка довжини перед взяттям
   * елемента — щоб майбутнє порушення цієї унікальності впало тут голосно,
   * а не дало хибний позитив нижче.
   */
  const candidates = m.paragraphs.filter(
    (par) => !par.isMaster && par.page === "1" && par.paragraphIndex === 0 && par.styleName === "Osnovnyi",
  );
  expect(candidates).toHaveLength(1);
  const clean = candidates[0];
  expect(clean).toBeDefined();
  expect(clean!.preview.length).toBeGreaterThan(0);
  expect(clean!.preview).toContain("Chystyi abzats");
});

it("doc.stories містить абзаци батьківських розворотів — isMaster не завжди false", async () => {
  await assertFixtureActive(docName);
  const m = await runJsx<StylesMeasure>("styles_measure", {}, { timeoutMs: 120_000 });
  /*
   * ВИМІРЯНО (рецензія C-1, docs/measured-facts-phase4.md): обхід doc.stories
   * дає й абзаци, покладені просто на батьківський розворот (isMaster:
   * true) — фікстура несе фоліо саме для цього. detectOverrides фільтрує
   * рівно цим полем (overrides.ts:132) — з isMaster завжди false прапорець
   * includeMasters нічого не фільтрував би, і колонтитул батьківської, що
   * відхиляється від стилю за побудовою, ставав би хибною знахідкою.
   */
  expect(m.paragraphs.some((p) => p.isMaster)).toBe(true);
});

it("масштаб записується ЛИШЕ для абзаців, де він не 100 — інакше масив дублював би документ", async () => {
  await assertFixtureActive(docName);
  const m = await runJsx<StylesMeasure>("styles_measure", {}, { timeoutMs: 120_000 });
  for (const s of m.scales) {
    expect(s.horizontalScale === 100 && s.verticalScale === 100).toBe(false);
  }
});

it("шлях стилю поза теками дорівнює його назві", async () => {
  await assertFixtureActive(docName);
  const m = await runJsx<StylesMeasure>("styles_measure", {}, { timeoutMs: 120_000 });
  const osnovnyi = m.styles.find((s) => s.name === "Osnovnyi")!;
  expect(osnovnyi.path).toBe("Osnovnyi");
});

/*
 * Рецензія Задачі 13, коло 1, I-1: до цього рядка жоден інтеграційний тест
 * не згадував ні `ranges`, ні `characterStyles`, ні `appliedFont` — тимчасовий
 * зонд, яким перевірялась форма бриджа під час першого кола, підтвердив
 * реальні дані ("ranges.length = 18", appliedFont: "Minion Pro") і був
 * видалений, як і мав бути, але після нього не лишилось нічого постійного.
 * Живий InDesign — єдиний спосіб перевірити, що ExtendScript-бік родини
 * `character` (ranges/characterStyles/anyFontName у `styles.jsx`) реально
 * узгоджений з тим, що очікує чистий TypeScript `detectCharacter`.
 */
it("ranges і characterStyles приходять з бриджа очікуваної форми", async () => {
  await assertFixtureActive(docName);
  const m = await runJsx<StylesMeasure>("styles_measure", {}, { timeoutMs: 120_000 });

  expect(Array.isArray(m.ranges)).toBe(true);
  expect(m.ranges.length).toBeGreaterThan(0);
  const r = m.ranges[0]!;
  expect(r).toHaveProperty("containerId");
  expect(r).toHaveProperty("paragraphIndex");
  expect(r).toHaveProperty("rangeIndex");
  expect(r).toHaveProperty("characterStyle");
  expect(r).toHaveProperty("pointSize");
  expect(r).toHaveProperty("appliedFont");
  expect(r).toHaveProperty("fontStyle");
  expect(r).toHaveProperty("tracking");
  expect(r).toHaveProperty("horizontalScale");

  /*
   * Не просто "поле є" — ВМІСТ. Мутант «anyFontName -> fontFamilyName»
   * (пункт 2 брифа Задачі 13) залишив би appliedFont об'єктної форми
   * порожнім МОВЧКИ для КОЖНОГО діапазону — саме те, проти чого написана
   * функція. Юніт-рівень (styles-jsx-character-guard.test.ts) ловить це
   * текстовим сторожем і behavior-тестом самої функції; тут — та сама
   * гарантія, але на СПРАВЖНЬОМУ документі, без підміни моком.
   */
  expect(m.ranges.some((range) => typeof range.appliedFont === "string" && range.appliedFont.length > 0)).toBe(true);

  expect(Array.isArray(m.characterStyles)).toBe(true);
  expect(m.characterStyles.length).toBeGreaterThan(0);
  const none = m.characterStyles.find((cs) => cs.name === "[None]");
  expect(none).toBeDefined();
  for (const cs of m.characterStyles) {
    expect(typeof cs.id).toBe("string");
    expect(cs.id.length).toBeGreaterThan(0);
    expect(typeof cs.appliedRuns).toBe("number");
  }
});

/*
 * Задача 8: стан фікстури для гігієни стилів. Урок folio-missing застосовано
 * наперед — стан додається РАЗОМ із детекторами, а не після, щоб перевірити
 * поведінку було чим.
 */

it("фікстура має оголошений і НЕ вжитий стиль", async () => {
  await assertFixtureActive(docName);
  const m = await runJsx<StylesMeasure>("styles_measure", {}, { timeoutMs: 120_000 });
  expect(m.styles.map((s) => s.name)).toContain("Nevzhyvanyi");
  expect(m.paragraphs.filter((p) => p.styleName === "Nevzhyvanyi")).toHaveLength(0);
});

it("фікстура має стиль, який перевизначають УСІ його абзаци", async () => {
  await assertFixtureActive(docName);
  const m = await runJsx<StylesMeasure>("styles_measure", {}, { timeoutMs: 120_000 });
  const paras = m.paragraphs.filter((p) => p.styleName === "Vsi_Pereviznachaiut");
  expect(paras.length).toBeGreaterThan(1);
  for (const p of paras) expect(p.actual.pointSize).not.toBe(p.declared.pointSize);
});

it("фікстура має стиль усередині теки — шлях відрізняється від назви", async () => {
  await assertFixtureActive(docName);
  const m = await runJsx<StylesMeasure>("styles_measure", {}, { timeoutMs: 120_000 });
  const inGroup = m.styles.find((s) => s.name === "V_Hrupi")!;
  expect(inGroup.path).toBe("Hrupa/V_Hrupi");
});

it("фікстура має абзац на службовому стилі", async () => {
  await assertFixtureActive(docName);
  const m = await runJsx<StylesMeasure>("styles_measure", {}, { timeoutMs: 120_000 });
  expect(m.paragraphs.filter((p) => p.styleName === "[Basic Paragraph]").length).toBeGreaterThan(0);
});

it("фікстура має абзац із масштабованим текстом", async () => {
  await assertFixtureActive(docName);
  const m = await runJsx<StylesMeasure>("styles_measure", {}, { timeoutMs: 120_000 });
  const scaled = m.scales.filter((s) => s.horizontalScale === 96);
  expect(scaled.length).toBeGreaterThan(0);
});

/*
 * Мішаний масштаб — стан, доданий за рецензією Задачі 2. Він розрізняє
 * два шляхи, які на решті фікстури дають однаковий результат: читання
 * `para.horizontalScale` напряму тихо віддає значення ПЕРШОГО діапазону
 * (тобто 80), а `charPropActual` дає `null`. Без цього тесту мутант
 * «прибрати charPropActual» проходив увесь набір.
 */
it("абзац із мішаним масштабом дає null, а не значення першого діапазону", async () => {
  await assertFixtureActive(docName);
  const m = await runJsx<StylesMeasure>("styles_measure", {}, { timeoutMs: 120_000 });
  const mixed = m.scales.filter((s) => s.horizontalScale === null);
  expect(mixed.length).toBeGreaterThan(0);
  expect(m.scales.some((s) => s.horizontalScale === 80)).toBe(false);
});

/*
 * Мутант «умова запису масштабу навпаки» (|| замість &&) на порожньому
 * `scales` не ловився. Тепер ловиться: у фікстурі є і 100/100, і не-100.
 */
it("абзаци зі 100/100 у scales НЕ потрапляють", async () => {
  await assertFixtureActive(docName);
  const m = await runJsx<StylesMeasure>("styles_measure", {}, { timeoutMs: 120_000 });
  expect(m.scales.some((s) => s.horizontalScale === 100 && s.verticalScale === 100)).toBe(false);
  expect(m.paragraphs.length).toBeGreaterThan(m.scales.length);
});

/*
 * ПОВЕДІНКОВИЙ доказ того, чого текстовий сторож перевірити не може:
 * що лічба символьних стилів іде за `.id`, а не за назвою. Мутант
 * `String(...id)` -> `String(...name)` лишає текст сторожа незмінним і
 * проходить його — але тут злив би два «Dvijnyk» в один запис, і
 * невживаний зник би, як це вже сталося в родині `usage`.
 */
it("два символьні стилі з ОДНАКОВОЮ назвою рахуються окремо, за id", async () => {
  await assertFixtureActive(docName);
  const m = await runJsx<StylesMeasure>("styles_measure", {}, { timeoutMs: 120_000 });
  const twins = m.characterStyles.filter((c) => c.name === "Dvijnyk");
  expect(twins).toHaveLength(2);
  expect(new Set(twins.map((c) => c.id)).size).toBe(2);
  /* Рівно один ужитий і рівно один — ні. Це і є асиметрія, яку злиття вбило б. */
  expect(twins.filter((c) => c.appliedRuns > 0)).toHaveLength(1);
  expect(twins.filter((c) => c.appliedRuns === 0)).toHaveLength(1);
});

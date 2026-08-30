import { describe, expect, it } from "vitest";
import type { StyleValues } from "../../src/layout/types.js";
import { detectHierarchy, resolveChains, resolveChainsDetailed } from "../../src/styles/hierarchy.js";
import type { DeclaredStyle } from "../../src/styles/types.js";

const EMPTY: StyleValues = {
  firstLineIndent: null, leftIndent: null, rightIndent: null,
  spaceBefore: null, spaceAfter: null, pointSize: null, leading: null,
  justification: null, appliedFont: null, fontStyle: null, tracking: null, listType: null,
};

function style(id: string, name: string, basedOnId: string | null, declared: Partial<StyleValues> = {}): DeclaredStyle {
  return { id, name, path: name, basedOn: null, basedOnId, nextStyle: null, declared: { ...EMPTY, ...declared } };
}

describe("resolveChains", () => {
  it("корінь має ланцюжок довжини 1", () => {
    expect(resolveChains([style("1", "Корінь", null)]).get("1")).toEqual(["1"]);
  });

  it("ланцюжок будується за id від стилю до кореня", () => {
    const chains = resolveChains([style("1", "Корінь", null), style("2", "Дитя", "1"), style("3", "Онук", "2")]);
    expect(chains.get("3")).toEqual(["3", "2", "1"]);
  });

  /*
   * ГОЛОВНИЙ ТЕСТ РОДИНИ. Виміряно: 6 стилів книжки оголошують basedOn із
   * однією й тією ж назвою, а стилів із цією назвою два — і один із шести
   * веде до іншого. Розв'язання за назвою хибне в 1 випадку з 6.
   */
  it("два батьки з ОДНАКОВОЮ назвою розрізняються за id", () => {
    const chains = resolveChains([
      style("100", "Однакова", null),
      style("200", "Однакова", null),
      style("300", "Дитя А", "100"),
      style("400", "Дитя Б", "200"),
    ]);
    expect(chains.get("300")).toEqual(["300", "100"]);
    expect(chains.get("400")).toEqual(["400", "200"]);
  });

  it("цикл не зациклює — ланцюжок обривається без зависання", () => {
    const chains = resolveChains([style("1", "А", "2"), style("2", "Б", "1")]);
    expect(chains.get("1")!.length).toBeLessThan(10);
  });

  it("basedOnId, що вказує в нікуди, обриває ланцюжок, а не падає", () => {
    expect(resolveChains([style("1", "Сирота", "999")]).get("1")).toEqual(["1"]);
  });

  /*
   * Найкоротший можливий цикл — самопосилання: стиль оголошує basedOnId
   * на власний id. Множина відвіданих ловить його на першому ж кроці
   * (parent === сам себе, вже у visited), і ланцюжок лишається довжини 1.
   * Виконанням раніше не підтверджено — код проходив за трасуванням.
   */
  it("самопосилання (basedOnId на власний id) не зациклює", () => {
    expect(resolveChains([style("1", "Сам на себе", "1")]).get("1")).toEqual(["1"]);
  });

  /*
   * Взаємний цикл із ТРЬОХ вузлів (А→Б→В→А), не з двох. Той самий механізм
   * захисту (множина відвіданих), інша топологія — і саме тому test окремий:
   * пара A↔B ловиться на другому кроці, трійка — на третьому, і жодна
   * коротша перевірка цього шляху коду не проходить.
   */
  it("взаємний цикл із трьох вузлів обривається без зависання", () => {
    const chains = resolveChains([
      style("1", "А", "2"),
      style("2", "Б", "3"),
      style("3", "В", "1"),
    ]);
    expect(chains.get("1")).toEqual(["1", "2", "3"]);
  });

  /*
   * I-2 РЕЦЕНЗІЇ: стеля кроків (MAX_CHAIN_STEPS = 50 у hierarchy.ts) і
   * множина відвіданих — це ДВА незалежні запобіжники, і жоден наявний до
   * рецензії тест не доводив, що стеля потрібна: єдиний тест циклу (пара
   * A↔B) ловиться множиною ще ДО того, як стеля встигла б спрацювати.
   *
   * Тут — довгий ланцюжок БЕЗ жодного повторення id (100 стилів, кожен
   * посилається на попередній за унікальним id): множина відвіданих його
   * не зупинить узагалі, бо цикл ніде не замикається. Якщо чекати наступний
   * `.length` менше за загальну кількість стилів (100) — довести можна лише
   * стелею. Число 51 — це 1 (сам стиль) + 50 кроків стелі, тому воно
   * прив'язане саме до MAX_CHAIN_STEPS, а не довільне.
   */
  it("довгий ациклічний ланцюжок (100 унікальних id) обривається стелею кроків, а не множиною", () => {
    const CHAIN_LENGTH = 100;
    const styles: DeclaredStyle[] = [style("0", "Корінь", null)];
    for (let i = 1; i < CHAIN_LENGTH; i += 1) {
      styles.push(style(String(i), `Рівень ${i}`, String(i - 1)));
    }

    const chains = resolveChains(styles);
    const chain = chains.get(String(CHAIN_LENGTH - 1))!;

    expect(chain.length).toBe(51); // 1 старт + 50 кроків стелі MAX_CHAIN_STEPS
    expect(chain.length).toBeLessThan(CHAIN_LENGTH);
    // Ланцюжок обірвано ДО кореня — "0" у нього не потрапив.
    expect(chain).not.toContain("0");
  });

  /*
   * ДРІБНЕ П.3 ФІНАЛЬНОЇ РЕЦЕНЗІЇ. Стеля спрацьовувала МОВЧКИ: і документ
   * із ланцюжком у 50 рівнів, і документ із ланцюжком у 500 показували те
   * саме `maxChainDepth: 50`. Той самий принцип, що вже діє для `detail`:
   * обрізання називається. Тест доводить обидва боки — що впирання
   * фіксується і що звичайний короткий ланцюжок його НЕ фіксує.
   */
  it("ланцюжок, обірваний стелею, потрапляє в truncated — обрізання не мовчазне", () => {
    const styles: DeclaredStyle[] = [style("0", "Корінь", null)];
    for (let i = 1; i < 100; i += 1) styles.push(style(String(i), `Рівень ${i}`, String(i - 1)));

    const { truncated } = resolveChainsDetailed(styles);
    /* Стелі вистачає рівно тим стилям, що глибші за MAX_CHAIN_STEPS: id
     * від 51 до 99 включно — 49 штук. */
    expect(truncated).toHaveLength(49);
    expect(truncated).toContain("99");
    expect(truncated).not.toContain("50");
  });

  it("короткий ланцюжок, цикл і сирота в truncated НЕ потрапляють", () => {
    const { truncated } = resolveChainsDetailed([
      style("0", "Корінь", null),
      style("1", "Дитя", "0"),
      style("2", "Цикл А", "3"),
      style("3", "Цикл Б", "2"),
      style("4", "Сирота", "999"),
    ]);
    expect(truncated).toEqual([]);
  });

  /*
   * ДЕФЕКТ, ЗНАЙДЕНИЙ РЕЦЕНЗІЄЮ ХВИЛІ. Наявний тест циклу перевіряв лише
   * ДВА вузли — випадок, надто короткий, щоб різниця проявилася: там
   * стеля (50 кроків) не встигає спрацювати взагалі. На кільці рівно з 51
   * стилю кроки вичерпуються РІВНО тоді, коли наступний крок і так уперся
   * б у множину відвіданих, — і стара умова звітувала «уперлися в стелю»
   * для всіх 51, хоча ланцюжок пройдено повністю й нічого не втрачено.
   *
   * Обидва боки в одному тесті навмисно: кільце 51 (стеля НЕ спрацювала —
   * зупинила множина) і кільце 60 (стеля спрацювала по-справжньому —
   * пройдено 51 вузол із 60). Мутант, що прибирає перевірку `visited`,
   * падає на першому; мутант, що взагалі не звітує стелю, — на другому.
   */
  function ring(n: number): DeclaredStyle[] {
    const out: DeclaredStyle[] = [];
    for (let i = 0; i < n; i += 1) out.push(style(String(i), `Кільце ${i}`, String((i + 1) % n)));
    return out;
  }

  it("кільце рівно з 51 стилю: ланцюжок пройдено повністю, стеля НЕ звітується", () => {
    const r = resolveChainsDetailed(ring(51));
    /* Пройдено всі 51 — нічого не втрачено, отже й обрізання не було. */
    expect(r.chains.get("0")).toHaveLength(51);
    expect(r.truncated).toEqual([]);
  });

  it("кільце з 60 стилів: стеля справді обрізала — звітується, і не мовчки", () => {
    const r = resolveChainsDetailed(ring(60));
    /* 1 старт + 50 кроків стелі: до решти 9 вузлів обхід не дійшов. */
    expect(r.chains.get("0")).toHaveLength(51);
    expect(r.truncated).toHaveLength(60);
  });

  it("resolveChains — та сама лічба, лише без переліку обрізаних", () => {
    const styles = [style("0", "Корінь", null), style("1", "Дитя", "0")];
    expect(resolveChains(styles)).toEqual(resolveChainsDetailed(styles).chains);
  });
});

describe("detectHierarchy", () => {
  it("стилі з ідентичним набором оголошених значень дають знахідку", () => {
    const found = detectHierarchy([
      style("1", "Перший", null, { pointSize: 11.5 }),
      style("2", "Другий", null, { pointSize: 11.5 }),
    ]);
    expect(found.filter((f) => f.defect === "styles-indistinguishable")).toHaveLength(1);
  });

  /*
   * Формулювання — ЧАСТИНА ВИМОГИ, не оздоба. Виміряно, що одна з двох
   * груп книжки, найімовірніше, хибне спрацювання: 12 властивостей
   * declaredStyleValues можуть не охоплювати того, що ці стилі розрізняє.
   */
  /*
   * `styles-indistinguishable` стосується ГРУПИ з двох і більше стилів
   * одразу (тут — "Перший" і "Другий") — на відміну від решти знахідок
   * родини, тут немає ОДНОГО стилю, чий `id` можна назвати. `styleId`
   * лишається `null`, тою самою причиною, що названа в докстрінгу
   * `StyleFinding.styleId`: знахідка не про конкретний оголошений стиль,
   * а про пару/групу.
   */
  it("styles-indistinguishable — styleId null, бо знахідка про ГРУПУ стилів, а не про один", () => {
    const found = detectHierarchy([
      style("1", "Перший", null, { pointSize: 11.5 }),
      style("2", "Другий", null, { pointSize: 11.5 }),
    ]);
    const f = found.find((x) => x.defect === "styles-indistinguishable")!;
    expect(f.styleId).toBeNull();
  });

  it("знахідка каже «нерозрізненні за N властивостями», а НЕ «дублікати»", () => {
    const found = detectHierarchy([
      style("1", "Перший", null, { pointSize: 11.5 }),
      style("2", "Другий", null, { pointSize: 11.5 }),
    ]);
    const f = found.find((x) => x.defect === "styles-indistinguishable")!;
    expect(f.detail).not.toMatch(/\bduplicate\b|\bcopy\b|same styles?/i);
    expect(f.detail).toMatch(/indistinguishable/i);
    expect(f.detail).toContain("12");
  });

  it("різні оголошені значення знахідки не дають", () => {
    const found = detectHierarchy([
      style("1", "Перший", null, { pointSize: 11.5 }),
      style("2", "Другий", null, { pointSize: 12 }),
    ]);
    expect(found.filter((f) => f.defect === "styles-indistinguishable")).toHaveLength(0);
  });

  it("basedOnId, що вказує на неіснуючий стиль, дає окрему знахідку", () => {
    const found = detectHierarchy([style("1", "Сирота", "999")]);
    const missing = found.filter((f) => f.defect === "based-on-missing");
    expect(missing).toHaveLength(1);
    // styleId — id стилю-СИРОТИ (того, що знахідка стосується), а не 999
    // (якого серед переданих стилів немає взагалі).
    expect(missing[0]!.styleId).toBe("1");
  });

  /*
   * I-3 РЕЦЕНЗІЇ: `basedOnId === null` — це КОРІНЬ, виміряно з двох різних
   * причин (службовий стиль, що кидає виняток на читанні `.basedOn`, і
   * стиль, що віддає рядок "undefined" — обидва вимір звів у null до того,
   * як дані сюди потрапляють; див. коментар `DeclaredStyle.basedOnId`).
   * Корінь — НЕ «батько зник»: до цього тесту жодна перевірка не доводила,
   * що умова в detectHierarchy справді розрізняє «null» (корінь, усе гаразд)
   * і «id є, але стилю з таким id немає» (реальна знахідка). Мутант, що
   * прибирає перевірку `!== null`, трактував би кожен кореневий стиль як
   * знахідку — і жоден із 12 тестів до цього моменту цього не ловив.
   */
  it("кореневий стиль (basedOnId === null) НЕ дає based-on-missing", () => {
    const found = detectHierarchy([style("1", "Корінь", null)]);
    expect(found.filter((f) => f.defect === "based-on-missing")).toHaveLength(0);
  });

  it("nextStyle у знахідки не перетворюється — 47 стилів із 51 вказують самі на себе", () => {
    const s = { ...style("1", "А", null), nextStyle: "А" };
    expect(detectHierarchy([s]).filter((f) => f.defect.includes("next"))).toHaveLength(0);
  });

  /*
   * ПОПРАВКА ДО РЕГЕКСА. Сьогодні в сусідній задачі (родина `scale`,
   * tests/unit/styles-scale.test.ts) з'ясувалося, що вузький регекс
   * /дефект|помилк|хибн/i пропускав реальні формулювання діагнозу — намір
   * тесту був ширший за три букворяди. Тест вище повторює ту саму вузькість
   * (/дублікат|копі[яї]|однаков[іи] стил/i — рівно з брифа, чіпати не можна),
   * тож тут перевіряється чесність ширшим переліком коренів, що покриває
   * намір «не називати це дублікатом»: дублікат/дублю- (ширший за буквальне
   * слово «дублікат»), копі(я/ю/ров-), ідентичн-, тотожн-, клон-, двійник-,
   * повторю-. Перевірено виконанням в обидва боки: старий вузький регекс
   * брифа пропускає нижченаведені формулювання, розширений ловить усі, і
   * жоден не хибить на нейтральному тексті, який `detectHierarchy` реально
   * повертає.
   */
  const DUPLICATE_WORDS = /dupl|copy|copied|identical|equivalent|clone|twin|repeat/i;

  it("розширений регекс ловить формулювання «дублікат», яких вузький регекс брифа пропускав", () => {
    const OLD_NARROW = /\bduplicate\b|\bcopy\b|same styles?/i;
    const duplicatePhrases = [
      "identical styles",
      "equivalent styles",
      "clone styles",
      "twin styles",
      "duplicating style",
      "copied style",
      "styles repeat one another",
    ];
    for (const phrase of duplicatePhrases) {
      // Доказ мутанта: вузький регекс брифа пропускав би саме ці формулювання.
      expect(phrase).not.toMatch(OLD_NARROW);
      // Розширений регекс їх ловить.
      expect(phrase).toMatch(DUPLICATE_WORDS);
    }
  });

  it("реальний текст знахідки чесний і під ширшим регексом теж", () => {
    const found = detectHierarchy([
      style("1", "Перший", null, { pointSize: 11.5 }),
      style("2", "Другий", null, { pointSize: 11.5 }),
    ]);
    const f = found.find((x) => x.defect === "styles-indistinguishable")!;
    expect(f.detail).not.toMatch(DUPLICATE_WORDS);
  });
});

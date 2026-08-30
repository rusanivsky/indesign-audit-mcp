import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runJsx } from "../../src/bridge/runner.js";
import { assertFixtureActive, closeFixtureDoc, makeFixtureDoc } from "./fixture-doc.js";
import { EPSILON, type GeometryMeasure, type ItemMeasure } from "../../src/geometry/types.js";
import { typeArea } from "../../src/geometry/reference.js";
import { detectWrap } from "../../src/geometry/wrap.js";

let docName: string;
/* Вимір фікстури один раз на файл: живий виклик до InDesign коштує ~1 с, а
 * документ між перевірками не змінюється — обробник лише читає (той самий
 * підхід, що й tests/integration/composition.test.ts). */
let measured: GeometryMeasure;

describe("geometry_measure", () => {
  beforeAll(async () => {
    docName = await makeFixtureDoc();
    await assertFixtureActive(docName);
    measured = await runJsx<GeometryMeasure>("geometry_measure", {});
  });

  afterAll(async () => {
    if (docName) await closeFixtureDoc(docName);
  });

  it("віддає вимір у пунктах правильним приладом", () => {
    expect(measured.units).toBe("points");
    expect(measured.traversal).toBe("page.allPageItems");
    expect(measured.pages.length).toBeGreaterThan(0);
    expect(measured.items.length).toBeGreaterThan(0);
    /* Габарити мусять бути числами, не рядками й не undefined — саме тут
     * ламається примус одиниць, якщо його зняти. */
    for (const it of measured.items) {
      expect(it.bounds).toHaveLength(4);
      for (const v of it.bounds) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("називає поля inside/outside НЕ міняючи їх місцями, а typeArea дзеркалить", async () => {
    /* Фікстура __fixture_make дає розворот 1-2: сторінка 1 — right, сторінка
     * 2 — left — рівно матеріал, якого бракувало: recto Й verso ОКРЕМО, як
     * вимагає спек Фази 13 §9 п. 4 (перевірка лише на одній стороні нічого
     * не доводить, бо помилка дзеркалення на verso невидима звідти).
     *
     * АЛЕ дефолтні поля фікстури СИМЕТРИЧНІ (36pt з усіх боків на обох
     * сторінках — звірено живим виміром). При inside === outside навіть
     * зламане дзеркалення (без обміну місцями) дає той самий результат, тож
     * перевірка на дефолтних полях була б порожньою. Тому тут явно
     * розставлено асиметричні left/right через run_script — документ це
     * фікстура, мутація дозволена (той самий підхід, що й в інших
     * інтеграційних тестах, напр. composition.test.ts). */
    await assertFixtureActive(docName);
    await runJsx("run_script", {
      script:
        "var prevUnit = app.scriptPreferences.measurementUnit;" +
        "app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;" +
        "var pgs = app.activeDocument.pages.everyItem().getElements();" +
        "try {" +
        "  for (var i = 0; i < pgs.length; i++) {" +
        "    pgs[i].marginPreferences.left = 50;" +
        "    pgs[i].marginPreferences.right = 70;" +
        "  }" +
        "} finally {" +
        "  app.scriptPreferences.measurementUnit = prevUnit;" +
        "}" +
        "__result = { pages: pgs.length };",
      undoName: "Асиметричні поля для перевірки дзеркалення",
    });

    const m = await runJsx<GeometryMeasure>("geometry_measure", {});
    const right = m.pages.find((p) => p.side === "right");
    const left = m.pages.find((p) => p.side === "left");

    if (!right || !left) {
      throw new Error(
        `Фікстура не дає розвороту left+right — right=${String(!!right)}, ` +
          `left=${String(!!left)}. Перевірка дзеркалення потребує обох сторін; ` +
          "підганяти результат не можна, звітую як є.",
      );
    }

    /* Асиметрія мусить БУТИ (inside ≠ outside за побудовою вище) — інакше
     * перевірка нижче тривіально пройшла б і на зламаному коді. */
    expect(Math.abs(right.margins.inside - right.margins.outside)).toBeGreaterThan(EPSILON);
    expect(Math.abs(left.margins.inside - left.margins.outside)).toBeGreaterThan(EPSILON);

    /* ОБРОБНИК НЕ МІНЯЄ ПОЛІВ МІСЦЯМИ. Виміряно на робочій книжці
     * 2026-08-15: `marginPreferences.left` — внутрішнє поле на ОБОХ
     * сторонах, `.right` — зовнішнє (нуль контрприкладів на 196 сторінках).
     * Тут left=50, right=70 на обох сторінках ⇒ inside=50, outside=70 теж на
     * обох. Стара версія цього тесту вимагала протилежного (inside(right) ==
     * outside(left)) і тим зашивала подвійний обмін, через який дзеркалення
     * зникало зовсім. */
    expect(right.margins.inside).toBeCloseTo(50, 3);
    expect(right.margins.outside).toBeCloseTo(70, 3);
    expect(left.margins.inside).toBeCloseTo(50, 3);
    expect(left.margins.outside).toBeCloseTo(70, 3);

    /* А САМЕ ДЗЕРКАЛЕННЯ робить typeArea(), і робить його ОДНЕ. Ліва межа
     * полоси: на recto — inside (50), на verso — outside (70). Це і є той
     * наскрізний контроль на ОБОХ сторонах, якого вимагає спек §9.4. */
    const areaRight = typeArea(right);
    const areaLeft = typeArea(left);
    expect(areaRight[1]).toBeCloseTo(50, 3);
    expect(areaLeft[1]).toBeCloseTo(70, 3);
    expect(right.width - areaRight[3]).toBeCloseTo(70, 3);
    expect(left.width - areaLeft[3]).toBeCloseTo(50, 3);

    /* Негативний контроль: сторони мусять РОЗІЙТИСЯ. Мутант, що повертає
     * обмін у geometry.jsx (композиція → тотожність) або прибирає його з
     * typeArea(), робить цей рядок червоним. */
    expect(Math.abs(areaRight[1] - areaLeft[1])).toBeCloseTo(20, 3);
  });
});

/*
 * __fixture_geometry — ОКРЕМИЙ будівник (Задача 4), незалежний від
 * __fixture_make: власний документ, власні beforeAll/afterAll. Задача
 * бриф вимагає не просто "тест пройшов", а доказу, що КОЖЕН обіцяний стан
 * СПРАВДІ присутній у вимірі geometry_measure — інакше родини frame/wrap/
 * anchored (Задачі 6, 9, 10) тестувалися б проти фікстури, у якій потрібний
 * стан міг тихо не збудуватися.
 *
 * ItemMeasure НЕ несе текстового вмісту елемента (лише геометрію й службові
 * поля), тож ідентифікація по фіксованих рядках "близький промах" тощо, як
 * у чернетці брифа, неможлива — items шукаються за геометричною сигнатурою
 * (bounds/rotation/locked/wrapMode/layer), яку фікстура задає детерміновано.
 */
describe("__fixture_geometry — стани, яких робоча книжка НЕ має (вимір H13)", () => {
  let geoName: string;
  let gm: GeometryMeasure;
  let W: number;
  let H: number;
  let top: number;
  let left: number;
  let right: number;

  function findBounds(y1: number, x1: number, y2: number, x2: number, tol = 0.01): ItemMeasure[] {
    return gm.items.filter(
      (i) =>
        Math.abs(i.bounds[0] - y1) < tol &&
        Math.abs(i.bounds[1] - x1) < tol &&
        Math.abs(i.bounds[2] - y2) < tol &&
        Math.abs(i.bounds[3] - x2) < tol,
    );
  }

  beforeAll(async () => {
    const built = await runJsx<{ name: string; pages: number; versoSide: string; note: string }>(
      "__fixture_geometry",
      { name: "__geometry_fixture" },
    );
    geoName = built.name;
    /* Доказ, що будівник справді повертає значення (а не спирався на
     * недоступний тут __result — див. звіт задачі). Якщо це коли-небудь
     * зламається знову, тест провалиться тут, а не мовчки далі. */
    expect(geoName).toBe("__geometry_fixture");
    /* Дві сторінки: recto з усіма станами й порожня verso для перевірки
     * дзеркалення полів (спек §9.4). Друга сторінка МУСИТЬ бути саме verso —
     * інакше перевірка обох сторін нижче мовчки перевіряла б одну. */
    expect(built.pages).toBe(2);
    expect(built.versoSide).toBe("LEFT_HAND");
    expect(built.note).toMatch(/Images are NOT inserted/);

    await assertFixtureActive(geoName);
    gm = await runJsx<GeometryMeasure>("geometry_measure", {});

    expect(gm.pages).toHaveLength(2);
    W = gm.pages[0]!.width;
    H = gm.pages[0]!.height;
    top = H * 0.08;
    left = W * 0.15;
    right = W - W * 0.17;
  });

  afterAll(async () => {
    if (geoName) await closeFixtureDoc(geoName);
  });

  it("негативний контроль: рамка ТОЧНО на межі полоси існує і виміряна", () => {
    const hits = findBounds(top, left, top + H * 0.05, right);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.type).toBe("TextFrame");
  });

  it("близький промах — 0,05pt повз ліву межу полоси, не більше й не менше", () => {
    const hits = findBounds(top + H * 0.1, left - 0.05, top + H * 0.15, right);
    expect(hits).toHaveLength(1);
    /* Промах саме на 0,05pt — не на межі (0) і не грубий (сантиметри). */
    expect(left - hits[0]!.bounds[1]).toBeCloseTo(0.05, 3);
  });

  it("грубий вихід за полосу — 20% ширини аркуша, навмисно НЕ близький промах", () => {
    const hits = findBounds(top + H * 0.2, W * 0.02, top + H * 0.25, right);
    expect(hits).toHaveLength(1);
    expect(left - hits[0]!.bounds[1]).toBeGreaterThan(W * 0.1);
  });

  it("елемент за межами вильоту: x1 = -20pt, далеко за будь-яким вильотом", () => {
    const hits = findBounds(top + H * 0.3, -20, top + H * 0.35, W * 0.3);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.bounds[1]).toBeCloseTo(-20, 3);
  });

  it("елемент РІВНО у вильоті: верхня межа збігається з documentBleedTopOffset (8.5pt)", () => {
    const hits = findBounds(-8.5, W * 0.4, H * 0.05, W * 0.6);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.bounds[0]).toBeCloseTo(-8.5, 3);
    /* Негативний контроль до "за вильотом" вище: тут рівно на межі, не за нею. */
    const bleedTop = gm.pages[0]!.bleed.top;
    expect(bleedTop).toBeCloseTo(8.5, 3);
  });

  it("повернена рамка виключається з вироку про вирівнювання (rotationAngle ±90°)", () => {
    const rotated = gm.items.filter((i) => i.type === "TextFrame" && Math.abs(i.rotation) > 1);
    expect(rotated).toHaveLength(1);
    expect(Math.abs(Math.abs(rotated[0]!.rotation) - 90)).toBeLessThan(0.01);
  });

  it("замкнений елемент: рівно один locked===true, і саме TextFrame", () => {
    const locked = gm.items.filter((i) => i.locked === true);
    expect(locked).toHaveLength(1);
    expect(locked[0]!.type).toBe("TextFrame");
  });

  it("обтікання ≥ двох режимів — у книжці NONE на всіх 965 елементах", () => {
    const wrapped = gm.items.filter((i) => i.wrapMode !== null && !i.wrapMode.includes("NONE"));
    expect(wrapped.length).toBeGreaterThanOrEqual(3);
    const modes = new Set(wrapped.map((i) => i.wrapMode));
    expect(modes.size).toBeGreaterThanOrEqual(2);
    expect([...modes].some((m) => m!.includes("BOUNDING_BOX"))).toBe(true);
    expect([...modes].some((m) => m!.includes("JUMP_OBJECT"))).toBe(true);
  });

  it("обтікання на непридатному до друку шарі — знахідка родини wrap", () => {
    const onHiddenLayer = gm.items.filter(
      (i) => i.layer === "_geometry-nonprint" && i.layerPrintable === false,
    );
    expect(onHiddenLayer).toHaveLength(1);
    expect(onHiddenLayer[0]!.wrapMode).not.toBeNull();
    expect(onHiddenLayer[0]!.wrapMode!.includes("NONE")).toBe(false);
  });

  it("прив'язані трьох популяцій: TextFrame-номер і GraphicLine нульової висоти", () => {
    const anchored = gm.items.filter((i) => i.anchored);
    expect(anchored).toHaveLength(2);

    const anchorFrame = anchored.find((i) => i.type === "TextFrame");
    expect(anchorFrame).toBeDefined();
    expect(anchorFrame!.parentKind).not.toBe("?");

    const anchorLine = anchored.find((i) => i.type === "GraphicLine");
    expect(anchorLine).toBeDefined();
    /* Лінійка НУЛЬОВОЇ висоти — стан, на якому ламається будь-яка перевірка,
     * що ділить на висоту (родина anchored, Задача 9). */
    expect(anchorLine!.bounds[2] - anchorLine!.bounds[0]).toBeCloseTo(0, 6);
  });

  it("НАСКРІЗНО: typeArea дзеркалиться на recto й verso живого виміру (спек §9.4)", () => {
    /*
     * Той самий контроль, що в geometry-measure вище, але на ВЛАСНІЙ
     * фікстурі родини й через увесь ланцюг: InDesign → geometry.jsx →
     * PageMeasure → typeArea(). До 2026-08-15 його не було ніде, бо ця
     * фікстура мала лише recto, і подвійний обмін inside/outside складався в
     * тотожність непоміченим.
     */
    const recto = gm.pages.find((p) => p.side === "right");
    const verso = gm.pages.find((p) => p.side === "left");
    if (!recto || !verso) {
      throw new Error(
        `Фікстура не дає обох сторін — recto=${String(!!recto)}, verso=${String(!!verso)}. ` +
          "Перевірка дзеркалення потребує обох; підганяти результат не можна, звітую як є.",
      );
    }

    /* Поля обох сторінок ідентичні й асиметричні за побудовою фікстури: без
     * асиметрії навіть зламане дзеркалення дало б ті самі числа. */
    const inside = W * 0.15;
    const outside = W * 0.17;
    expect(Math.abs(inside - outside)).toBeGreaterThan(EPSILON);
    for (const p of [recto, verso]) {
      expect(p.margins.inside).toBeCloseTo(inside, 3);
      expect(p.margins.outside).toBeCloseTo(outside, 3);
    }

    const aRecto = typeArea(recto);
    const aVerso = typeArea(verso);
    /* Ліва межа полоси: на recto — inside, на verso — outside. */
    expect(aRecto[1]).toBeCloseTo(inside, 3);
    expect(aVerso[1]).toBeCloseTo(outside, 3);
    /* Права: дзеркально. */
    expect(W - aRecto[3]).toBeCloseTo(outside, 3);
    expect(W - aVerso[3]).toBeCloseTo(inside, 3);
    /* Негативний контроль: сторони РОЗІЙШЛИСЯ рівно на різницю полів.
     * Мутант, що повертає тотожність, червонить саме цей рядок. */
    expect(aVerso[1] - aRecto[1]).toBeCloseTo(outside - inside, 3);
  });

  it("сумарно: усі виміряні елементи фікстури — рівно 13 на першій сторінці", () => {
    /* 9 TextFrame (exact, near, gross, beyond, inBleed, rot, host, anchorNum,
     * lockedFrame) + 3 Rectangle (wrapBox, wrapJump, wrapHidden) +
     * 1 GraphicLine (anchorLine) = 13. Число-контроль: якщо будь-який стан
     * тихо не збудувався (виняток проковтнуто десь усередині JSX), цей тест
     * впаде першим, навіть якщо решта перевірок з якоїсь причини цього не
     * помітять. */
    expect(gm.items).toHaveLength(13);
  });

  it("wrapOffsets — числа для обтікання, null для NONE (Задача 10б; null тут ВЛАСТИВІСТЬ)", () => {
    /* Виміряно живим прогоном (indesign_run_jsx): при wrapMode === NONE
     * textWrapOffset повертає NothingEnum.NOTHING, а не масив — індексація
     * на ньому кидає, і try/catch у geometry.jsx лишає wrapOffsets null.
     * Це той самий стан, що й «тип не підтримує обтікання»: властивість, не
     * брак виміру, тож перевіряємо обидва боки одним тестом-парою. */
    const wrapped = gm.items.filter((i) => i.wrapMode !== null && !i.wrapMode.includes("NONE"));
    expect(wrapped.length).toBeGreaterThanOrEqual(3);
    for (const i of wrapped) {
      expect(i.wrapOffsets).not.toBeNull();
      expect(i.wrapOffsets).toHaveLength(4);
      for (const v of i.wrapOffsets!) expect(Number.isFinite(v)).toBe(true);
    }

    const none = gm.items.filter((i) => i.wrapMode === "NONE");
    expect(none.length).toBeGreaterThan(0);
    for (const i of none) expect(i.wrapOffsets).toBeNull();
  });

  it("детектор wrap-offsets-inconsistent на живому вимірі: асиметричний відступ дає знахідку", async () => {
    /*
     * Доказ на кінець-у-кінець, не лише юнітом: детектор мусить побачити
     * розбіжність, зібрану СПРАВЖНІМ виміром geometry_measure, а не лише
     * синтетичним ItemMeasure з тесту детектора. Це і є той матеріал, на
     * якому мутант 2 з брифа («прибрати try навколо textWrapOffset») мусить
     * зробити тест червоним.
     *
     * wrapBox і wrapHidden фікстури — ОБИДВА BOUNDING_BOX_TEXT_WRAP, одна
     * популяція. Виміряно живим прогоном: textWrapOffset за замовчуванням —
     * [0,0,0,0] на обох, тож без явної мутації перевірка була б порожня
     * (брифінг Задачі 10б, крок 4) — мутуємо offset лише printable-елемента.
     */
    await assertFixtureActive(geoName);

    const printableBoundingBox = gm.items.find(
      (i) => i.layer !== "_geometry-nonprint" && i.wrapMode !== null && i.wrapMode.includes("BOUNDING_BOX"),
    );
    const nonPrintBoundingBox = gm.items.find(
      (i) => i.layer === "_geometry-nonprint" && i.wrapMode !== null && i.wrapMode.includes("BOUNDING_BOX"),
    );
    if (!printableBoundingBox || !nonPrintBoundingBox) {
      throw new Error(
        "Фікстура не дає двох елементів BOUNDING_BOX_TEXT_WRAP (wrapBox і wrapHidden) — " +
          "перевірка детектора неможлива, звітую як є.",
      );
    }
    /* Негативний контроль ДО мутації: обидва відступи однакові за
     * замовчуванням — інакше нижче нема що доводити мутацією. */
    expect(printableBoundingBox.wrapOffsets).not.toBeNull();
    expect(nonPrintBoundingBox.wrapOffsets).not.toBeNull();

    await runJsx("run_script", {
      script:
        "var prevUnit = app.scriptPreferences.measurementUnit;" +
        "app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;" +
        "try {" +
        "  var items = app.activeDocument.pages[0].allPageItems;" +
        "  var target = null;" +
        "  for (var i = 0; i < items.length; i++) {" +
        `    if (items[i].id === ${printableBoundingBox.itemId}) { target = items[i]; break; }` +
        "  }" +
        "  if (!target) { throw new Error('wrapBox не знайдено за itemId'); }" +
        "  target.textWrapPreferences.textWrapOffset = [12, 0, 0, 0];" +
        "} finally {" +
        "  app.scriptPreferences.measurementUnit = prevUnit;" +
        "}" +
        "__result = { ok: true };",
      undoName: "Асиметричний відступ обтікання для перевірки детектора",
    });

    const m2 = await runJsx<GeometryMeasure>("geometry_measure", {});
    const changed = m2.items.find((i) => i.itemId === printableBoundingBox.itemId);
    expect(changed).toBeDefined();
    expect(changed!.wrapOffsets).not.toBeNull();
    /* Саме мутований бік (top, індекс 0) розійшовся — доказ, що вимір
     * справді прочитав НОВЕ значення з документа, а не старий кеш. */
    expect(changed!.wrapOffsets![0]).toBeCloseTo(12, 3);

    const found = detectWrap(m2.items);
    const mismatch = found.filter((f) => f.defect === "wrap-offsets-inconsistent");
    expect(mismatch).toHaveLength(1);
    /* I1 (рецензія гілки): звітується ДЕФЕКТ, не популяція. Популяція тут
     * 1:1 (wrapBox проти wrapHidden), більшості немає, тож порушником
     * названо рівно один елемент — а не обидва, як до 2026-08-15.
     * Який саме — залежить від порядку обходу InDesign, тому перевіряється
     * ЛИШЕ кількість: обидва лежать на сторінці 1, тож pages однакові в
     * будь-якому разі. */
    expect(mismatch[0]!.count).toBe(1);
    expect(mismatch[0]!.pages).toEqual(["1"]);
  });
});

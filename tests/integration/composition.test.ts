import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runJsx } from "../../src/bridge/runner.js";
import { assertFixtureActive, closeFixtureDoc, makeFixtureDoc } from "./fixture-doc.js";
import type { LineMeasure, MeasureResult } from "../../src/composition/types.js";
import { mergeResults, pageWindows, parseMeasureResult } from "../../src/tools/composition.js";

let docName: string;
/* Вимір фікстури один раз на файл: живий виклик до InDesign коштує ~0,6 с,
 * а документ між перевірками не змінюється — обробник лише читає. */
let measured: MeasureResult;

const EM_DASH = "—";
const SOFT_HYPHEN = "­";

beforeAll(async () => {
  docName = await makeFixtureDoc();
  await assertFixtureActive(docName);
  measured = await runJsx<MeasureResult>("composition_measure", { pages: null });
});

afterAll(async () => {
  if (docName) await closeFixtureDoc(docName);
});

/** Чи має рядок хоч один друкований гліф. */
function hasGlyphs(l: LineMeasure): boolean {
  return l.chars.some((c) => c.ch !== null);
}

/**
 * Рядки, для яких горизонтальна геометрія взагалі визначена: у прямій рамці і
 * з хоч одним гліфом. Порожні за гліфами рядки (сам лише якір таблиці U+0016
 * чи маркер виноски U+0004) законно мають нульову ширину.
 */
function upright(r: MeasureResult): LineMeasure[] {
  return r.lines.filter((l) => !l.rotated && hasGlyphs(l));
}

const isLetter = (c: string) => c.length === 1 && c.toUpperCase() !== c.toLowerCase();

describe("composition_measure", () => {
  it("віддає рядки з координатами й одиницею points", () => {
    expect(measured.measurementUnit).toBe("points");
    expect(measured.lines.length).toBeGreaterThan(0);

    const line = measured.lines[0]!;
    expect(line.right).toBeGreaterThan(line.left);
    expect(line.columnWidth).toBeGreaterThan(0);
    expect(line.pointSize!).toBeGreaterThan(0);
    expect(line.styleName.length).toBeGreaterThan(0);
    expect(line.spacing.desired!).toBeGreaterThan(0);
  });

  /*
   * Раніше ці нерівності перевірялись лише на lines[0]. На книжці
   * `right > left` хибне для 111 повернутих рядків, а «міра вміщає рядок» —
   * для 13 рядків зі справжнім перевищенням виключки. Тепер перевіряємо УСІ
   * рядки прямих рамок, із допуском на законне перевищення.
   */
  it("на всіх придатних до виміру рядках права межа правіша за ліву, а міра їх вміщає", () => {
    const lines = upright(measured);
    expect(lines.length).toBeGreaterThan(0);

    for (const l of lines) {
      expect(l.right).toBeGreaterThan(l.left);
      expect(l.columnWidth).toBeGreaterThan(0);
      /* 1 пт допуску: виключений рядок може законно трохи перевищити міру
       * (у книжці максимум 4,6 пт), але не на порядок. */
      expect(l.right - l.left).toBeLessThanOrEqual(l.columnWidth + 1);
    }
  });

  it("координати символів монотонно зростають і їх стільки ж, скільки символів", () => {
    const line = upright(measured).find((l) => l.chars.length > 5)!;

    expect(line.chars).toHaveLength(line.text.length);
    for (let i = 1; i < line.chars.length; i++) {
      expect(line.chars[i]!.x).toBeGreaterThanOrEqual(line.chars[i - 1]!.x);
    }
  });

  /*
   * `chars.length === text.length` більше НЕ тавтологія: chars будується з
   * line.characters.everyItem().horizontalOffset, а text — з line.contents.
   * Це звірка двох незалежних API InDesign між собою.
   */
  it("довжина chars збігається з довжиною text на кожному рядку", () => {
    for (const line of measured.lines) {
      expect(line.chars.length).toBe(line.text.length);
    }
  });

  it("керівні символи позначені ch: null, а не сміттям", () => {
    for (const line of measured.lines) {
      for (const c of line.chars) {
        if (c.ch === null) continue;
        expect(c.ch).not.toBe("\r");
        expect(c.ch).not.toBe("\n");
        expect(c.ch!.length).toBe(1);
      }
    }
  });

  /*
   * Якір таблиці — це U+0016, маркер виноски — U+0004; брифінг знав лише про
   * \r, \n і U+2028/U+2029, тож обидва проходили як звичайні гліфи. Рядок із
   * самим лише якорем має нульову ширину при повній ширині колонки — та сама
   * пастка, що з повернутими рамками.
   */
  it("жоден символ C0 не вважається гліфом", () => {
    let c0 = 0;
    for (const line of measured.lines) {
      for (let i = 0; i < line.text.length; i++) {
        if (line.text.charCodeAt(i) >= 32) continue;
        c0++;
        expect(line.chars[i]!.ch).toBeNull();
      }
    }
    /* У фікстурі є щонайменше кінці абзаців, якір таблиці й маркер виноски. */
    expect(c0).toBeGreaterThan(0);

    const anchorOnly = measured.lines.filter((l) => l.text.length > 0 && !hasGlyphs(l));
    for (const l of anchorOnly) {
      expect(l.chars.every((c) => c.ch === null)).toBe(true);
    }
  });

  /*
   * Регресія на Critical 2. Посимвольний `contents` віддає для тире Enumerator
   * EM_DASH, а не рядок, — і попередня реалізація перетворювала його на
   * ПРОБІЛ. У книжці таких символів 130 на одну story (тире, апострофи,
   * нерозривні пробіли, трикрапки, лапки); у фікстурі рівно один, і його
   * досить, щоб цю ваду не можна було внести непоміченою.
   */
  it("тире з фікстури приходить справжнім U+2014, а не пробілом", () => {
    const line = measured.lines.find((l) => l.text.indexOf("Kyiv") === 0);
    expect(line, "рядок фікстури, що починається з Kyiv").toBeDefined();

    expect(line!.text.charCodeAt(5)).toBe(0x2014);
    expect(line!.text.charAt(5)).toBe(EM_DASH);
    expect(line!.chars[5]!.ch).toBe(EM_DASH);
    expect(line!.text.charAt(5)).not.toBe(" ");
  });

  it("віддає justification абзацу на кожному рядку", () => {
    expect(measured.lines.length).toBeGreaterThan(0);
    for (const line of measured.lines) {
      expect(typeof line.justification).toBe("string");
      expect(line.justification.length).toBeGreaterThan(0);
    }
  });

  /*
   * Регресія на Critical 1. У книжці 111 рядків лежать у повернутих на ±90°
   * рамках (колонтитули й колонцифри): у кожного horizontalOffset ===
   * endHorizontalOffset, тобто нульова ширина, а geometricBounds — це
   * осеорієнтований габарит, з якого міра виходить безглузда. Вони не мають
   * видавати себе за придатний до виміру основний текст.
   */
  it("позначає рядки повернутих рамок і не видає їх за придатні до виміру", () => {
    const rotated = measured.lines.filter((l) => l.rotated);
    expect(rotated.length, "у фікстурі є повернута рамка").toBeGreaterThan(0);

    for (const l of rotated) {
      expect(l.rotationAngle).not.toBe(0);
      /* Характерний підпис повернутої рамки — нульова ширина рядка. */
      expect(l.right - l.left).toBeCloseTo(0, 6);
    }

    const kolontytul = rotated.find((l) => l.text.indexOf("Kolontytul") >= 0);
    expect(kolontytul, "повернутий рядок фікстури").toBeDefined();
    expect(kolontytul!.rotationAngle).toBe(-90);

    /* І навпаки: звичайний текст не має позначатися повернутим. */
    const kyiv = measured.lines.find((l) => l.text.indexOf("Kyiv") === 0)!;
    expect(kyiv.rotated).toBe(false);
    expect(kyiv.rotationAngle).toBe(0);
  });

  /*
   * Без ланцюжка фреймів ці прапорці тривіально істинні на кожному рядку
   * (один фрейм — один абзац), тож у фікстурі є пара зчеплених рамок.
   */
  it("прапорці першого й останнього рядка фрейму працюють на ланцюжку рамок", () => {
    const threaded = measured.lines.filter((l) => l.text.indexOf("Considerable") >= 0);
    expect(threaded.length, "початок зчепленого потоку").toBeGreaterThan(0);
    const containerId = threaded[0]!.containerId;

    const flow = measured.lines.filter((l) => l.containerId === containerId);
    expect(flow.length).toBeGreaterThan(2);

    /* Текст тече через ДВІ рамки, отже по два «перших» і «останніх» рядки. */
    expect(flow.filter((l) => l.isFirstInFrame).length).toBeGreaterThanOrEqual(2);
    expect(flow.filter((l) => l.isLastInFrame).length).toBeGreaterThanOrEqual(2);

    /* І це один абзац, розірваний між рамками, — саме той випадок, заради
     * якого геометрія береться з рамки САМОГО РЯДКА, а не абзацу. */
    const single = flow.filter((l) => l.paragraphIndex === flow[0]!.paragraphIndex);
    expect(single.length).toBeGreaterThan(2);

    /* Середина потоку не може бути ні першим, ні останнім рядком рамки. */
    expect(flow.some((l) => !l.isFirstInFrame && !l.isLastInFrame)).toBe(true);
  });

  /*
   * Регресія на Critical 3. Автоматичний перенос InDesign не є символом
   * тексту, тож правило «останній символ рядка й перший символ наступного —
   * літери» є основним; літеральний дефіс і м'який перенос лишились в
   * об'єднанні. Перевіряємо і факт спрацювання, і несуперечність.
   */
  it("ловить переноси у виключеній колонці з увімкненим переносом", () => {
    const threaded = measured.lines.filter((l) => l.text.indexOf("Considerable") >= 0);
    const containerId = threaded[0]!.containerId;
    const flow = measured.lines.filter((l) => l.containerId === containerId);

    expect(flow.some((l) => l.endsWithHyphen), "хоч один перенос у вузькій колонці").toBe(true);

    /* Несуперечність на всіх рядках: прапорець ніколи не стоїть на останньому
     * рядку абзацу й завжди пояснюється одним із трьох правил. */
    for (const l of measured.lines) {
      if (!l.endsWithHyphen) continue;
      expect(l.lineInParagraph).toBeLessThan(l.paragraphLineCount - 1);

      const last = l.text.charAt(l.text.length - 1);
      const next = measured.lines.find(
        (o) =>
          o.containerId === l.containerId &&
          o.paragraphIndex === l.paragraphIndex &&
          o.lineInParagraph === l.lineInParagraph + 1,
      );
      const byLetters = next !== undefined && isLetter(last) && isLetter(next.text.charAt(0));
      expect(last === "-" || last === SOFT_HYPHEN || byLetters).toBe(true);
    }
  });

  it("повідомляє про overset у полі unmeasured", () => {
    /* f2 фікстури навмисно не вміщає свій текст. */
    expect(measured.unmeasured.length).toBeGreaterThan(0);
    for (const u of measured.unmeasured) {
      expect(u.reason).toBe("overset");
      expect(u.containerId).toMatch(/^story:\d+$/);
    }
  });

  it("віддає isMaster на кожному рядку", () => {
    for (const line of measured.lines) {
      expect(typeof line.isMaster).toBe("boolean");
    }
    /*
     * Фаза 12, Задача 7: фікстура тепер несе одну рамку НА МАЙСТРІ (текст
     * «Колонтитул: пів-майстра», доданий для родини piv2019) — тож "жоден
     * рядок не майстровий" більше не вірно для фікстури в цілому. Натомість
     * перевіряємо адресну властивість: рядок із цим текстом майстровий, а
     * решта — ні.
     */
    const masterLines = measured.lines.filter((l) => l.text.indexOf("майстра") >= 0);
    expect(masterLines.length).toBeGreaterThan(0);
    expect(masterLines.every((l) => l.isMaster)).toBe(true);
    expect(measured.lines.filter((l) => l.text.indexOf("майстра") < 0).every((l) => !l.isMaster)).toBe(true);
  });

  it("відновлює одиницю виміру після себе", async () => {
    await assertFixtureActive(docName);
    const before = await runJsx<{ unit: string }>("run_script", {
      script: "__result = { unit: String(app.scriptPreferences.measurementUnit) };",
      undoName: "Читання одиниці",
    });
    await runJsx<MeasureResult>("composition_measure", { pages: null });
    const after = await runJsx<{ unit: string }>("run_script", {
      script: "__result = { unit: String(app.scriptPreferences.measurementUnit) };",
      undoName: "Читання одиниці",
    });
    expect(after.unit).toBe(before.unit);
  });

  it("звужує вимір до заданих сторінок", async () => {
    await assertFixtureActive(docName);
    const firstPage = measured.lines[0]!.page;
    const one = await runJsx<MeasureResult>("composition_measure", { pages: [firstPage] });

    expect(one.lines.length).toBeGreaterThan(0);
    expect(one.lines.every((l) => l.page === firstPage)).toBe(true);
    expect(one.lines.length).toBeLessThanOrEqual(measured.lines.length);
  });

  /* Порожній масив — це «усі сторінки», а не «жодної»: інакше нуль рядків не
   * відрізнити від «на цих сторінках нічого немає». */
  it("порожній список сторінок означає «усі»", async () => {
    await assertFixtureActive(docName);
    const empty = await runJsx<MeasureResult>("composition_measure", { pages: [] });
    expect(empty.lines.length).toBe(measured.lines.length);
  });

  /* unmeasured заповнюється ПІСЛЯ відсіву за сторінками, інакше звужений
   * виклик рапортує overset у story, яких у запиті немає. */
  it("не рапортує overset story, що не потрапила у звужений запит", async () => {
    await assertFixtureActive(docName);
    const oversetIds = new Set(measured.unmeasured.map((u) => u.containerId));
    const oversetPages = new Set(
      measured.lines.filter((l) => oversetIds.has(l.containerId)).map((l) => l.page),
    );
    const otherPage = measured.lines.map((l) => l.page).find((p) => !oversetPages.has(p));
    if (otherPage === undefined) return;

    const narrowed = await runJsx<MeasureResult>("composition_measure", { pages: [otherPage] });
    expect(narrowed.unmeasured.length).toBeLessThan(measured.unmeasured.length);
  });
});

/*
 * B5.4. Живі перевірки того, на чому стоїть `composition_audit`: перелік
 * сторінок, типізований розбір на межі JSX і рівність «по вікнах» повному
 * прогонові. Останнє — не косметика: вікна нарізає сам інструмент, і якби
 * склеювання губило чи переставляло рядки, це тихо міняло б знахідки драбини
 * переносів і коридорів, які тримаються за сусідство рядків у масиві.
 */
describe("composition_pages і зведення вікон", () => {
  it("віддає імена сторінок документа й ім'я самого документа", async () => {
    await assertFixtureActive(docName);
    const listed = await runJsx<{ docName: string; pages: string[] }>("composition_pages", {});
    expect(listed.docName).toBe(docName);
    expect(listed.pages.length).toBeGreaterThan(0);
    /* Кожна сторінка, на якій справді є рядки, мусить бути в переліку. */
    for (const page of new Set(measured.lines.map((l) => l.page))) {
      /* Крім майстрів: doc.pages їх не містить за побудовою. */
      if (!/^\d/.test(page)) continue;
      expect(listed.pages).toContain(page);
    }
  });

  it("типізований розбір пропускає справжній результат живого InDesign", async () => {
    await assertFixtureActive(docName);
    const raw = await runJsx<unknown>("composition_measure", { pages: null });
    const parsed = parseMeasureResult(raw);
    expect(parsed.lines.length).toBe(measured.lines.length);
    expect(parsed.measurementUnit).toBe("points");
  });

  it("прохід по вікнах по одній сторінці дає ті самі рядки, що й повний прогін", async () => {
    await assertFixtureActive(docName);
    const listed = await runJsx<{ pages: string[] }>("composition_pages", {});
    const windows = pageWindows(listed.pages, 1);
    const parts: MeasureResult[] = [];
    for (const window of windows) {
      parts.push(parseMeasureResult(await runJsx<unknown>("composition_measure", { pages: window })));
    }
    const merged = mergeResults(parts);

    const key = (l: LineMeasure) =>
      `${l.containerId}|${l.paragraphIndex}|${l.lineInParagraph}|${l.text}`;
    /* Повний прогін бачить і story майстер-спредів, яких у doc.pages немає, —
     * тому порівнюємо не кількість, а те, що вікна нічого не загубили з того,
     * що лежить на звичайних сторінках, і не переставили порядок усередині
     * контейнера. */
    const onPages = new Set(listed.pages);
    const expected = measured.lines.filter((l) => onPages.has(l.page)).map(key);
    expect(merged.lines.map(key).sort()).toEqual([...expected].sort());

    for (const containerId of new Set(merged.lines.map((l) => l.containerId))) {
      const seq = merged.lines
        .filter((l) => l.containerId === containerId)
        .map((l) => l.paragraphIndex * 1000 + l.lineInParagraph);
      expect(seq).toEqual([...seq].sort((a, b) => a - b));
    }
  });
});

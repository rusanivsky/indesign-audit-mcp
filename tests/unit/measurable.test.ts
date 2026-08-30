import { describe, expect, it } from "vitest";
import {
  HYPHEN_EM_FALLBACK,
  effectiveRight,
  isMeasurable,
  measurableLines,
  measureShortfall,
  median,
  widthContext,
} from "../../src/composition/measurable.js";
import { line } from "./helpers/composition.js";

/** Гарантує тип MeasurableLine у тесті й заразом перевіряє саме правило. */
function ok(l: ReturnType<typeof line>) {
  if (!isMeasurable(l)) throw new Error("рядок мав бути придатним до виміру");
  return l;
}

describe("isMeasurable", () => {
  it("звичайний рядок придатний", () => {
    expect(isMeasurable(line({ spaceWidth: 3.2, isLast: false }))).toBe(true);
  });

  it("рядок у повернутій рамці непридатний — уся горизонтальна геометрія недійсна", () => {
    const l = line({ spaceWidth: 3.2, isLast: false, rotated: true });
    expect(l.left).toBe(l.right);
    expect(new Set(l.chars.map((c) => c.x)).size).toBe(1);
    expect(isMeasurable(l)).toBe(false);
  });

  it("рамка під довільним кутом теж непридатна, хоча координати ВАРІЮЮТЬСЯ", () => {
    /* rotated — це rotationAngle !== 0, а не «±90°». У такій рамці ширини
     * пробілів додатні й правдоподібні, тож жоден інший фільтр її не ловить. */
    const l = line({ spaceWidth: 3.2, isLast: false, rotationAngle: 30 });
    expect(l.rotated).toBe(true);
    expect(new Set(l.chars.map((c) => c.x)).size).toBeGreaterThan(1);
    expect(l.right - l.left).toBeGreaterThan(0);
    expect(isMeasurable(l)).toBe(false);
  });

  it("порожній абзац непридатний — повна міра при ширині 2,3 пт і жодного прапорця", () => {
    const l = line({ spaceWidth: 3.2, isLast: true, empty: true });
    expect(l.rotated).toBe(false);
    expect(l.isMaster).toBe(false);
    expect(l.columnWidth - (l.right - l.left)).toBeGreaterThan(100);
    expect(isMeasurable(l)).toBe(false);
  });

  it("measurableLines відсіює обидва класи разом", () => {
    const lines = [
      line({ spaceWidth: 3.2, isLast: false }),
      line({ spaceWidth: 3.2, isLast: false, rotated: true }),
      line({ spaceWidth: 3.2, isLast: true, empty: true }),
    ];
    expect(measurableLines(lines)).toHaveLength(1);
  });
});

describe("effectiveRight", () => {
  it("кінцевий пробіл не рахується — міряємо по останньому непробільному гліфу", () => {
    const l = ok(line({ spaceWidth: 3.2, isLast: false, trailingSpace: 4.599, fillsMeasure: true }));
    /* «В лоб» рядок виглядає ширшим за міру рівно на кінцевий пробіл. */
    expect(l.right - l.left - l.columnWidth).toBeCloseTo(4.599, 5);
    expect(measureShortfall(l)).toBeCloseTo(0, 9);
  });

  it("рядок із переносом добирає намальований дефіс, якого немає в right", () => {
    const raw = line({ spaceWidth: 3.2, isLast: false, size: 11.5, endsWithHyphen: true });
    /* Виміряно на книжці: 100 виключених рядків із переносом недобирають до
     * міри 3,9099–3,9100 пт при кеглі 11,5, тобто повністю виключений рядок
     * із переносом має міру рівно на дефіс більшу за свій right.
     * Міра ставиться ДО звуження: MeasurableLine — Readonly. */
    raw.columnWidth = raw.right + 3.91;
    const l = ok(raw);
    expect(effectiveRight(l) - l.right).toBeCloseTo(3.91, 2);
    /* «В лоб» такий рядок читався б як розріджений на 3,9 пт. */
    expect(l.columnWidth - (l.right - l.left)).toBeCloseTo(3.91, 2);
    expect(measureShortfall(l)).toBeCloseTo(0, 2);
  });

  it("допуск на перенос масштабується з кеглем, а не є константою 3,91", () => {
    const small = ok(line({ spaceWidth: 3.2, isLast: false, size: 11.5, endsWithHyphen: true }));
    const big = ok(line({ spaceWidth: 3.2, isLast: false, size: 23, endsWithHyphen: true }));
    expect(effectiveRight(big) - big.right).toBeCloseTo(2 * (effectiveRight(small) - small.right), 6);
  });

  it("літеральний дефіс уже входить у right — удруге його не додаємо", () => {
    const l = ok(line({ spaceWidth: 3.2, isLast: false, literalHyphen: true }));
    expect(l.endsWithHyphen).toBe(true);
    expect(effectiveRight(l)).toBeCloseTo(l.right, 9);
  });

  it("рядок без переносу міряється рівно по right", () => {
    const l = ok(line({ spaceWidth: 3.2, isLast: false }));
    expect(effectiveRight(l)).toBeCloseTo(l.right, 9);
  });
});

describe("widthContext", () => {
  /** Три рядки з літеральним дефісом — мінімум зразків для будь-якого джерела. */
  function literals(size?: number) {
    return [1, 2, 3].map(() => line({ spaceWidth: 3.2, isLast: false, literalHyphen: true, size }));
  }

  it("виводить ширину дефіса з даних, коли є рядки з літеральним дефісом", () => {
    /* Літеральний дефіс у фікстурі — 2,8 пт при кеглі 10, тобто 0,28 кегля.
     * Число навмисно НЕ дорівнює запасному: інакше тест не відрізнив би
     * виведення від підстановки запасного значення. */
    const ctx = widthContext(literals());
    expect(ctx.hyphenEm).toBeCloseTo(0.28, 6);
    expect(ctx.hyphenEm).not.toBeCloseTo(HYPHEN_EM_FALLBACK, 6);
  });

  it("виводить ту саму частку кегля з рядка іншого кегля", () => {
    expect(widthContext(literals(20)).hyphenEm).toBeCloseTo(0.28, 6);
  });

  it("виведене значення витісняє запасне в допуску на перенос", () => {
    const corpus = [
      ...literals(),
      line({ spaceWidth: 3.2, isLast: false, size: 10, endsWithHyphen: true }),
    ];
    const ctx = widthContext(corpus);
    const hyphenated = corpus[corpus.length - 1]!;
    if (!isMeasurable(hyphenated)) throw new Error("рядок мав бути придатним до виміру");
    /* 10 × 0,28 = 2,8 пт, а не 10 × 0,34 = 3,4 пт із запасного. */
    expect(effectiveRight(hyphenated, ctx) - hyphenated.right).toBeCloseTo(2.8, 6);
    expect(effectiveRight(hyphenated) - hyphenated.right).toBeCloseTo(3.4, 6);
  });

  it("без таких рядків лишається запасне значення", () => {
    expect(widthContext([line({ spaceWidth: 3.2, isLast: false })]).hyphenEm).toBe(HYPHEN_EM_FALLBACK);
  });

  it("виведене значення справді використовується в effectiveRight", () => {
    const ctx = {
      hyphenEm: 0.5,
      hyphenSource: "literal",
      hyphenSamples: 3,
      hyphenDisagreementEm: null,
    } as const;
    const l = ok(line({ spaceWidth: 3.2, isLast: false, size: 10, endsWithHyphen: true }));
    expect(effectiveRight(l, ctx) - l.right).toBeCloseTo(5, 9);
  });

  it("літеральний вимір позначений джерелом і кількістю зразків", () => {
    const ctx = widthContext(literals());
    expect(ctx.hyphenSource).toBe("literal");
    expect(ctx.hyphenSamples).toBe(3);
  });

  it("без жодного джерела запасне значення позначене як запасне", () => {
    const ctx = widthContext([line({ spaceWidth: 3.2, isLast: false })]);
    expect(ctx.hyphenSource).toBe("fallback");
    expect(ctx.hyphenSamples).toBe(0);
    expect(ctx.hyphenDisagreementEm).toBeNull();
  });

  it("один-два літеральні дефіси НЕ витісняють стозразковий вивід", () => {
    /* Виміряно: старе правило літеральних дефісів спрацьовувало 2 рази на
     * 5 193 рядки. Доти `literal.length > 0` віддавало управління при одному
     * зразку, тож сильніший шлях не запускався б на цьому документі ніколи. */
    const corpus = [
      line({ spaceWidth: 3.2, isLast: false, literalHyphen: true }),
      line({ spaceWidth: 3.2, isLast: false, literalHyphen: true }),
      ...[1, 2, 3].map(() => {
        const l = line({ spaceWidth: 3.2, isLast: false, size: 10, endsWithHyphen: true });
        l.columnWidth = l.right + 4.5; /* 0,45 кегля — не 0,28 і не 0,34 */
        return l;
      }),
    ];
    const ctx = widthContext(corpus);
    expect(ctx.hyphenSource).toBe("shortfall");
    expect(ctx.hyphenEm).toBeCloseTo(0.45, 9);
  });

  it("коли обидва шляхи набрали зразків, розбіжність між ними повідомляється", () => {
    const corpus = [
      ...literals() /* 0,28 */,
      ...[1, 2, 3].map(() => {
        const l = line({ spaceWidth: 3.2, isLast: false, size: 10, endsWithHyphen: true });
        l.columnWidth = l.right + 4.5; /* 0,45 */
        return l;
      }),
    ];
    const ctx = widthContext(corpus);
    expect(ctx.hyphenSource).toBe("literal");
    expect(ctx.hyphenDisagreementEm).toBeCloseTo(0.17, 6);
  });

  it("самотній літеральний дефіс безглуздої ширини відкидається як нефізичний", () => {
    /* Гліф дефіса вужчий за кегль у будь-якій гарнітурі. */
    const corpus = [1, 2, 3].map(() => {
      const l = line({ spaceWidth: 3.2, isLast: false, literalHyphen: true, size: 10 });
      /* Розсуваємо правий край так, що «дефіс» виходить 2 кеглі завширшки. */
      l.right = l.chars[l.chars.length - 1]!.x + 20;
      return l;
    });
    expect(widthContext(corpus).hyphenSource).toBe("fallback");
  });
});

/**
 * Рішення Задачі 8: вивід ширини дефіса з НЕДОБОРІВ виключених рядків із
 * переносом. Виміряно на книжці — 100 таких рядків проти жмені літеральних.
 */
describe("widthContext — вивід із недоборів", () => {
  /** Виключений не останній рядок із переносом, недобір рівно `shortfall` пт. */
  function hyphenLine(shortfall: number, over: Parameters<typeof line>[0] | null = null) {
    const l = line({
      spaceWidth: 3.2,
      isLast: false,
      size: 10,
      endsWithHyphen: true,
      ...(over ?? {}),
    });
    /* Без кінцевого пробілу right — і є правий край останнього гліфа. */
    l.columnWidth = l.right + shortfall;
    return l;
  }

  it("виводить частку кегля з недоборів, коли літеральних дефісів немає", () => {
    /* 2,8 пт при кеглі 10 = 0,28 кегля — навмисно НЕ дорівнює запасному 0,34. */
    const ctx = widthContext([hyphenLine(2.8), hyphenLine(2.8), hyphenLine(2.8)]);
    expect(ctx.hyphenEm).toBeCloseTo(0.28, 9);
    expect(ctx.hyphenSource).toBe("shortfall");
    expect(ctx.hyphenEm).not.toBeCloseTo(HYPHEN_EM_FALLBACK, 6);
  });

  it("переносить вимір на інший кегль — це частка, а не пункти", () => {
    const big = { spaceWidth: 3.2, isLast: false, size: 20, endsWithHyphen: true } as const;
    const ctx = widthContext([
      hyphenLine(5.6, big),
      hyphenLine(5.6, big),
      hyphenLine(5.6, big),
    ]);
    expect(ctx.hyphenEm).toBeCloseTo(0.28, 9);
  });

  it("за РІВНИХ прав літеральний вимір має перевагу як прямий", () => {
    /* Обидва шляхи набрали мінімум зразків: літеральний каже 0,28, недобори —
     * 0,5. Перевагу дістає прямий вимір гліфа. Перевага саме за рівних прав:
     * коли літеральних зразків замало, вона не діє (окремий тест вище). */
    const ctx = widthContext([
      line({ spaceWidth: 3.2, isLast: false, literalHyphen: true }),
      line({ spaceWidth: 3.2, isLast: false, literalHyphen: true }),
      line({ spaceWidth: 3.2, isLast: false, literalHyphen: true }),
      hyphenLine(5.0),
      hyphenLine(5.0),
      hyphenLine(5.0),
    ]);
    expect(ctx.hyphenSource).toBe("literal");
    expect(ctx.hyphenEm).toBeCloseTo(0.28, 9);
  });

  it("менше трьох зразків — запасне значення, а не медіана по одному", () => {
    const ctx = widthContext([hyphenLine(2.8), hyphenLine(2.8)]);
    expect(ctx.hyphenSource).toBe("fallback");
    expect(ctx.hyphenEm).toBe(HYPHEN_EM_FALLBACK);
  });

  it("хибне спрацювання endsWithHyphen на повному рядку не отруює медіану", () => {
    /* Заперечення Задачі 7: endsWithHyphen — евристика «літера + літера».
     * Хибне спрацювання дає рядок, що дотягує до міри, тобто недобір ≈0.
     * Таких тут БІЛЬШІСТЬ — і медіана однаково лишається виміряною. */
    const ctx = widthContext([
      hyphenLine(0),
      hyphenLine(0),
      hyphenLine(0.001),
      hyphenLine(0.009),
      hyphenLine(2.8),
      hyphenLine(2.8),
      hyphenLine(2.8),
    ]);
    expect(ctx.hyphenEm).toBeCloseTo(0.28, 9);
    expect(ctx.hyphenSource).toBe("shortfall");
  });

  it("ВЕЛИЧИНА порогу шуму важить, а не лише його наявність", () => {
    /* Хибних спрацювань БІЛЬШЕ, ніж справжніх, і всі вони мають додатний, але
     * шумовий недобір (0,004–0,007 пт — усередині виміряних ±0,001 пт похибки
     * «рядок дотягує до міри», з десятикратним запасом під порогом 0,01 пт).
     * Порогом 0,01 медіана дорівнює 0,28; будь-яким меншим — 0,0007, тобто
     * послаблення саме ЧИСЛА, а не знака, ламає вимір. */
    const ctx = widthContext([
      hyphenLine(0.004),
      hyphenLine(0.005),
      hyphenLine(0.006),
      hyphenLine(0.007),
      hyphenLine(2.8),
      hyphenLine(2.8),
      hyphenLine(2.8),
    ]);
    expect(ctx.hyphenSource).toBe("shortfall");
    expect(ctx.hyphenSamples).toBe(3);
    expect(ctx.hyphenEm).toBeCloseTo(0.28, 9);
  });

  it("зразок ширший за кегль відкидається — дефіс не буває ширшим за кегль", () => {
    /* Недобір 15 пт при кеглі 10 — це рядок, який просто не дотягує до міри. */
    const ctx = widthContext([hyphenLine(15), hyphenLine(15), hyphenLine(15)]);
    expect(ctx.hyphenSource).toBe("fallback");
  });

  it("невиключений рядок у вибірку не йде — він до міри не дотягує за побудовою", () => {
    const opts = {
      spaceWidth: 3.2,
      isLast: false,
      size: 10,
      endsWithHyphen: true,
      justification: "LEFT_ALIGN",
    } as const;
    const ctx = widthContext([hyphenLine(2.8, opts), hyphenLine(2.8, opts), hyphenLine(2.8, opts)]);
    expect(ctx.hyphenSource).toBe("fallback");
  });

  it("останній рядок абзацу у вибірку не йде — він теж не виключається", () => {
    const opts = { spaceWidth: 3.2, isLast: true, size: 10, endsWithHyphen: true } as const;
    const ctx = widthContext([hyphenLine(2.8, opts), hyphenLine(2.8, opts), hyphenLine(2.8, opts)]);
    expect(ctx.hyphenSource).toBe("fallback");
  });

  it("рядок із м'яким переносом у вибірку не йде — цей знак УЖЕ входить у right", () => {
    /* U+00AD не є зразком ширини (поза розривом його гліф нульовий), але на
     * розриві він намальований і вже враховний у right. Порахувати його
     * недобір означало б виміряти НЕ дефіс, а щось інше. */
    const opts = { spaceWidth: 3.2, isLast: false, size: 10, softHyphen: true } as const;
    const corpus = [hyphenLine(2.8, opts), hyphenLine(2.8, opts), hyphenLine(2.8, opts)];
    expect(corpus[0]!.endsWithHyphen).toBe(true);
    expect(widthContext(corpus).hyphenSource).toBe("fallback");
  });

  it("виведене значення справді витісняє запасне в допуску на перенос", () => {
    const corpus = [hyphenLine(2.8), hyphenLine(2.8), hyphenLine(2.8)];
    const ctx = widthContext(corpus);
    const l = corpus[0]!;
    if (!isMeasurable(l)) throw new Error("рядок мав бути придатним до виміру");
    expect(effectiveRight(l, ctx) - l.right).toBeCloseTo(2.8, 9);
    expect(effectiveRight(l) - l.right).toBeCloseTo(3.4, 9);
  });
});

describe("median", () => {
  it("парна кількість — середнє двох середніх", () => {
    expect(median([1, 2, 3, 4])).toBeCloseTo(2.5, 9);
  });

  it("не псує вхідний масив", () => {
    const xs = [3, 1, 2];
    median(xs);
    expect(xs).toEqual([3, 1, 2]);
  });
});

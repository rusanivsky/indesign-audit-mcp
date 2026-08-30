import { describe, expect, it } from "vitest";
import { fakeDoc, loadJsxCliExtras, withFakeIndesignApp, type FakePara } from "./helpers/load-jsx-cli-extras.js";

const СТИЛЬ = "Нумерація питань";

/**
 * C2/C4/C6 (родина `sequences`, спек §4.4, рулінг R25): виконує СПРАВЖНІЙ
 * `src/jsx/cli-extras.jsx` (не переказ логіки в TypeScript) через
 * `loadJsxCliExtras` — той самий прийом, що вже застосований до `apply.jsx`/
 * `preflight.jsx`/`styles.jsx` (`tests/unit/helpers/load-jsx-*.ts`).
 */
describe("cli-extras.jsx — sequences (C2/C4)", () => {
  it("сортує за СТОРІНКОЮ, не за порядком doc.stories — розриву нема, де його нема", () => {
    /*
     * Відтворює ПАСТКУ, знайдену зондом на живому документі 2026-08-16:
     * `doc.stories` НЕ йде в порядку сторінок. Тут п'ять абзаців (1..5)
     * навмисно НЕ в порядку номера/сторінки в масиві `paras` — так само,
     * як на живому документі («8,7,9» замість «7,8,9» у порядку обходу).
     * Якби `cliMeasureSequence` довіряв порядку traversal, це дало б
     * фальшиві розриви на цілком справній нумерації.
     */
    const IDMCP = loadJsxCliExtras();
    const paras: FakePara[] = [
      { style: СТИЛЬ, contents: "3", pageOffset: 2, pageName: "3", top: 300 },
      { style: СТИЛЬ, contents: "1", pageOffset: 0, pageName: "1", top: 100 },
      { style: СТИЛЬ, contents: "5", pageOffset: 4, pageName: "5", top: 500 },
      { style: СТИЛЬ, contents: "2", pageOffset: 1, pageName: "2", top: 200 },
      { style: СТИЛЬ, contents: "4", pageOffset: 3, pageName: "4", top: 400 },
    ];
    const doc = fakeDoc(paras);
    const result = withFakeIndesignApp(doc, () => IDMCP.cliMeasureSequence(doc, { style: СТИЛЬ, mustBeSequential: true }));

    expect(result.found).toBe(5);
    expect(result.parsed).toBe(5);
    expect(result.restarts).toBe(1);
    expect(result.breaks).toEqual([]);
    expect(result.unparsed).toEqual([]);
  });

  it("сортує за ВЕРТИКАЛЬНОЮ позицією на тій самій сторінці — «8,7,9» стає «7,8,9»", () => {
    /* Буквальне відтворення зонда: три абзаци НА ОДНІЙ сторінці, у порядку
     * traversal «8,7,9», з top 195/35/339. Правильний порядок читання —
     * зверху вниз: 7 (top 35), 8 (top 195), 9 (top 339). */
    const IDMCP = loadJsxCliExtras();
    const paras: FakePara[] = [
      { style: СТИЛЬ, contents: "8", pageOffset: 27, pageName: "28", top: 195 },
      { style: СТИЛЬ, contents: "7", pageOffset: 27, pageName: "28", top: 35 },
      { style: СТИЛЬ, contents: "9", pageOffset: 27, pageName: "28", top: 339 },
    ];
    const doc = fakeDoc(paras);
    const result = withFakeIndesignApp(doc, () => IDMCP.cliMeasureSequence(doc, { style: СТИЛЬ, mustBeSequential: true }));

    expect(result.breaks).toEqual([]);
  });

  it("справжній розрив: 1,2,4 (пропущено 3) — попереднє число, наступне і сторінка", () => {
    const IDMCP = loadJsxCliExtras();
    const paras: FakePara[] = [
      { style: СТИЛЬ, contents: "1", pageOffset: 0, pageName: "10", top: 0 },
      { style: СТИЛЬ, contents: "2", pageOffset: 1, pageName: "11", top: 0 },
      { style: СТИЛЬ, contents: "4", pageOffset: 2, pageName: "12", top: 0 },
    ];
    const doc = fakeDoc(paras);
    const result = withFakeIndesignApp(doc, () => IDMCP.cliMeasureSequence(doc, { style: СТИЛЬ, mustBeSequential: true }));

    expect(result.found).toBe(3);
    expect(result.parsed).toBe(3);
    expect(result.breaks).toEqual([{ prev: 2, next: 4, page: "12" }]);
  });

  it("легітимний рестарт на 1 (дві глави: 1,2,3 і знову 1,2,3) — розривів НЕМАЄ", () => {
    /* Виміряно на живому документі: нумерація рестартує від 1 дванадцять
     * разів по розділах. Без евристики «1 = початок нового відрізка» кожен
     * такий рестарт читався б як розрив на справному макеті. */
    const IDMCP = loadJsxCliExtras();
    const paras: FakePara[] = [
      { style: СТИЛЬ, contents: "1", pageOffset: 0, pageName: "1", top: 0 },
      { style: СТИЛЬ, contents: "2", pageOffset: 1, pageName: "2", top: 0 },
      { style: СТИЛЬ, contents: "3", pageOffset: 2, pageName: "3", top: 0 },
      { style: СТИЛЬ, contents: "1", pageOffset: 3, pageName: "10", top: 0 },
      { style: СТИЛЬ, contents: "2", pageOffset: 4, pageName: "11", top: 0 },
      { style: СТИЛЬ, contents: "3", pageOffset: 5, pageName: "12", top: 0 },
    ];
    const doc = fakeDoc(paras);
    const result = withFakeIndesignApp(doc, () => IDMCP.cliMeasureSequence(doc, { style: СТИЛЬ, mustBeSequential: true }));

    expect(result.found).toBe(6);
    expect(result.breaks).toEqual([]);
    /*
     * Minor 5 (раунд виправлень 1): `restarts` — це число, яке робить
     * рестарти ВИДИМИМИ, а не мовчки поглинутими евристикою. Тут два
     * відрізки — два «1» — тож `restarts === 2`.
     */
    expect(result.restarts).toBe(2);
  });

  it("абзац, з якого число не читається взагалі, — стан «unparsed», не мовчазний пропуск", () => {
    const IDMCP = loadJsxCliExtras();
    const paras: FakePara[] = [
      { style: СТИЛЬ, contents: "1", pageOffset: 0, pageName: "1", top: 0 },
      { style: СТИЛЬ, contents: "два", pageOffset: 1, pageName: "2", top: 0 },
      { style: СТИЛЬ, contents: "3", pageOffset: 2, pageName: "3", top: 0 },
    ];
    const doc = fakeDoc(paras);
    const result = withFakeIndesignApp(doc, () => IDMCP.cliMeasureSequence(doc, { style: СТИЛЬ, mustBeSequential: true }));

    /* found — усі три абзаци стилю; parsed — лише два, що дали число. */
    expect(result.found).toBe(3);
    expect(result.parsed).toBe(2);
    expect(result.unparsed).toEqual([{ page: "2", text: "два" }]);
    /* «1» → «3» без проміжного «2» (воно unparsed) — теж розрив: не гублена мовчки. */
    expect(result.breaks).toEqual([{ prev: 1, next: 3, page: "3" }]);
  });

  /*
   * Important 2 (раунд виправлень 1): назва стилю, якої в документі немає
   * (описка, або повний шлях замість барого імені), дає `found: 0` — і сам
   * JSX-обробник, а не лише `summariseExtras`, мусить повернути це чесно
   * (нуль абзаців), а не впасти чи вигадати щось.
   */
  it("стилю з такою назвою в документі немає — found: 0, parsed: 0, без розривів і без помилки", () => {
    const IDMCP = loadJsxCliExtras();
    const paras: FakePara[] = [{ style: "Інший стиль", contents: "1", pageOffset: 0, pageName: "1", top: 0 }];
    const doc = fakeDoc(paras);
    const result = withFakeIndesignApp(doc, () =>
      IDMCP.cliMeasureSequence(doc, { style: "Стилі книги / Нумерація питань", mustBeSequential: true }),
    );
    expect(result.found).toBe(0);
    expect(result.parsed).toBe(0);
    expect(result.restarts).toBe(0);
    expect(result.breaks).toEqual([]);
    expect(result.unparsed).toEqual([]);
  });

  it("нетипова форма «12а» розбирається як 12 (ведучі цифри) — задокументована межа парсера", () => {
    const IDMCP = loadJsxCliExtras();
    const num = IDMCP.cliParseSequenceNumber("12а");
    expect(num).toBe(12);
  });

  it("порожній/нецифровий текст — null, окремий стан «unparsed»", () => {
    const IDMCP = loadJsxCliExtras();
    expect(IDMCP.cliParseSequenceNumber("")).toBeNull();
    expect(IDMCP.cliParseSequenceNumber("Питання")).toBeNull();
  });

  describe("IDMCP.handlers[\"__cli_extras\"] — маршрут C1", () => {
    it("params.rules ПРИСУТНІЙ → out.sequences з'являється", () => {
      const IDMCP = loadJsxCliExtras();
      const paras: FakePara[] = [
        { style: СТИЛЬ, contents: "1", pageOffset: 0, pageName: "1", top: 0 },
        { style: СТИЛЬ, contents: "2", pageOffset: 1, pageName: "2", top: 0 },
      ];
      const doc = fakeDoc(paras);
      const out = withFakeIndesignApp(doc, () =>
        IDMCP.handlers["__cli_extras"]({ rules: [{ style: СТИЛЬ, mustBeSequential: true }] }),
      );
      expect(out.sequences).toEqual([
        { style: СТИЛЬ, found: 2, parsed: 2, restarts: 1, breaks: [], unparsed: [] },
      ]);
    });

    /*
     * Без `rules` (виклик лише для родини `extras`) поле `sequences`
     * узагалі НЕ з'являється — «не питали», а не «нуль правил» (§5.4/§8).
     */
    it("params.rules ВІДСУТНІЙ → out.sequences НЕ з'являється (не порожній масив)", () => {
      const IDMCP = loadJsxCliExtras();
      const doc = fakeDoc([]);
      const out = withFakeIndesignApp(doc, () => IDMCP.handlers["__cli_extras"]({ bodyTextStyles: [] }));
      expect(out.sequences).toBeUndefined();
    });
  });
});

import { describe, expect, it } from "vitest";
import {
  loadJsxPreflight,
  withFakeApp,
  type FakeProcess,
} from "./helpers/load-jsx-preflight.js";

const IDMCP = loadJsxPreflight();

/** Виміряна форма `aggregatedResults` документа зі свідомим overset. */
const AGG = [
  "Untitled-266",
  "[Basic]",
  [
    [1, "TEXT (1)", "", "", []],
    [2, "Overset text (1)", "", "", []],
    [
      3,
      "Text Frame",
      "1",
      "Problem: Overset text: 94 characters",
      [["Problem", "Overset text: 94 characters"]],
    ],
  ],
];

function proc(over: Partial<FakeProcess> = {}): FakeProcess {
  return { waitReturns: false, agg: AGG, removeCalls: 0, ...over };
}

function measure(p: FakeProcess, params: Record<string, unknown> = {}) {
  return withFakeApp(IDMCP, { process: p }, () =>
    IDMCP.handlers.preflight_measure({ waitSeconds: 165, ...params }),
  );
}

/*
 * ЧОМУ ЦЕЙ ФАЙЛ ІСНУЄ. Обробник має гілку, недосяжну на живому InDesign:
 * «очікування не дочекалось, але результат УСЕ Ж прочитався». Виміряно, що
 * справжній InDesign у цьому стані кидає при читанні `aggregatedResults`, тож
 * інтеграційний тест туди дійти не може — сигнал 1 спрацьовує раніше за
 * сигнал 2 ЗАВЖДИ. Доти гілку стеріг лише регексп ґарда, тобто статично.
 *
 * Прецедент — `jsx-apply-logic.test.ts`: справжній .jsx виконується в Node
 * поверх справжнього `_core.jsx`, а `app`/`doc` підставляються. Перевіряється
 * той код, який поїде в InDesign, а не його переказ.
 */
describe("preflight_measure — гілки, недосяжні на живому InDesign", () => {
  it("успішний прогін: рядки розібрано, процес прибрано, waitTimedOut false", () => {
    const p = proc();
    const m = measure(p);
    expect(m.waitTimedOut).toBe(false);
    expect(m.shapeRecognised).toBe(true);
    expect(m.rowsSeen).toBe(3);
    expect(m.rowsParsed).toBe(3);
    expect(m.processRemoved).toBe(true);
    expect(p.removeCalls).toBe(1);
    /* Назва береться з ПЕРШОГО елемента aggregatedResults, а не з doc.name. */
    expect(m.docName).toBe("Untitled-266");
  });

  it("СИГНАЛ 1 — результат не прочитався: кидає з поясненням, звіту немає", () => {
    const p = proc({
      waitReturns: true,
      aggThrows: "Aggregated Result for this process is not available.",
    });
    expect(() => measure(p)).toThrow(/did not finish within 165 s/);
    /* Процес прибирається навіть на шляху винятку — інакше він лишився б у
     * панелі Preflight назавжди. */
    expect(p.removeCalls).toBe(1);
  });

  it("СИГНАЛ 2 — не дочекалось, але результат Є: звіт ВІДДАЄТЬСЯ з waitTimedOut true", () => {
    /*
     * Стан, якого вимір не спостерігав. Кидати тут було б помилкою по суті:
     * знахідки preflight поодинці справжні, під сумнівом лише ПОВНОТА переліку.
     * Саме цей виклик робить поле waitTimedOut змістовним — доти воно могло
     * бути тільки false, бо кидок стояв ДО повернення результату.
     */
    const p = proc({ waitReturns: true });
    const m = measure(p);
    expect(m.waitTimedOut).toBe(true);
    expect(m.rowsParsed).toBe(3);
    expect(m.processRemoved).toBe(true);
  });

  /*
   * СИГНАЛ 3 — НЕПОЛЯРНЕ ЗНАЧЕННЯ. Доти цей стан ловився ПОБІЧНО, кидком
   * `waitTimedOut !== false`; коли сигнал 2 свідомо перестав кидати, перевірка
   * зникла разом із ним. Наслідок був найтихішим із можливих: серіалізатор
   * (`_core.jsx`) віддає `null` і для `undefined`, і для `NaN`, а `buildCaveat`
   * перевіряє поле істинністю — тобто звіт їхав би без ЖОДНОГО гучного рядка.
   *
   * Деградація, а не кидок: рядки читаються з `aggregatedResults` і від
   * `waitForProcess` не залежать. Під сумнівом лише ПОВНОТА.
   */
  /*
   * `it.each`, а не цикл усередині одного `it`. Різниця не косметична: цикл із
   * жорсткими `expect` уривається на ПЕРШОМУ падінні, тобто з шести значень
   * доводив би одне — а коментар при ньому стверджував протилежне. Тут кожне
   * значення має власний тест, і зелені лишаються зеленими незалежно.
   */
  it.each([
    [undefined, "undefined undefined"],
    [null, "object null"],
    [Number.NaN, "number NaN"],
    [0, "number 0"],
    [1, "number 1"],
    ["true", "string true"],
  ])("НЕ булеве (%s) деградує до «повнота не підтверджена», а не кидає", (raw, expected) => {
    const p = proc({ waitReturns: raw });
    const m = measure(p);
    expect(m.waitPolarity).toBe(expected);
    /* Консервативно, і це ЗАЯВЛЕНО в caveat як невиміряне. */
    expect(m.waitTimedOut).toBe(true);
    /* Головне: звіт таки віддається — знахідки не втрачені. */
    expect(m.rowsParsed).toBe(3);
    expect(p.removeCalls).toBe(1);
  });

  it("`typeof` у waitPolarity відрізняє те, що String() зливає в одне", () => {
    /* Без типу рядок "true" і об'єкт-обгортка дали б однакове «true», і поле
     * не сказало б нічого про причину. */
    expect(measure(proc({ waitReturns: "true" })).waitPolarity).toBe("string true");
    expect(measure(proc({ waitReturns: new Boolean(true) })).waitPolarity).toBe("object true");
  });

  it("справжнє булеве лишає waitPolarity порожнім — інакше гучний блок кричав би завжди", () => {
    expect(measure(proc()).waitPolarity).toBe(null);
    expect(measure(proc({ waitReturns: true })).waitPolarity).toBe(null);
  });

  it("СИГНАЛ 1 при неполярному значенні називає СИРЕ значення, а не підставлене true", () => {
    /* Інакше повідомлення про таймаут приховало б справжню причину: тип. */
    const p = proc({ waitReturns: undefined, aggThrows: "not available" });
    expect(() => measure(p)).toThrow(/undefined undefined/);
  });

  it("невпізнана форма результату дає лічильники, а не тихий порожній список", () => {
    const m = measure(proc({ agg: "не масив" }));
    expect(m.shapeRecognised).toBe(false);
    expect(m.rowsSeen).toBe(0);
    expect(m.rows).toEqual([]);
  });

  it("впізнана форма з нулем рядків — це НЕ невпізнана форма", () => {
    /* Виміряно на чистому документі: ["Untitled-268", "[Basic]", []]. */
    const m = measure(proc({ agg: ["Untitled-268", "[Basic]", []] }));
    expect(m.shapeRecognised).toBe(true);
    expect(m.rowsSeen).toBe(0);
  });

  it("нерозібрані рядки й пари РАХУЮТЬСЯ, а не зникають мовчки", () => {
    const m = measure(
      proc({
        agg: [
          "d",
          "[Basic]",
          [
            [1, "TEXT (1)", "", "", []],
            "рядок не тієї форми",
            [3, "Text Frame", "1", "", [["Problem", "є"], ["зіпсована пара"]]],
          ],
        ],
      }),
    );
    expect(m.rowsSeen).toBe(3);
    expect(m.rowsParsed).toBe(2);
    expect(m.pairsSeen).toBe(2);
    expect(m.pairsParsed).toBe(1);
  });

  it("провал прибирання процесу видно полем, а не лише в панелі InDesign", () => {
    const m = measure(proc({ removeThrows: true }));
    expect(m.processRemoved).toBe(false);
  });

  it("провал прибирання НЕ маскує первинного винятку", () => {
    const p = proc({ waitReturns: true, aggThrows: "not available", removeThrows: true });
    expect(() => measure(p)).toThrow(/did not finish/);
  });

  it("відсутній waitSeconds — ГУЧНА помилка, а не тихий дефолт", () => {
    const p = proc();
    expect(() => withFakeApp(IDMCP, { process: p }, () => IDMCP.handlers.preflight_measure({}))).toThrow(
      /waitSeconds/,
    );
    /* Кидок стається ДО створення процесу — прибирати нема чого. */
    expect(p.removeCalls).toBe(0);
  });

  it("невідомий профіль — відмова з переліком доступних, і процес не створюється", () => {
    const p = proc();
    expect(() =>
      withFakeApp(
        IDMCP,
        { process: p, profileNames: ["[Basic]", "Друкарня Х"] },
        () => IDMCP.handlers.preflight_measure({ profileName: "нема", waitSeconds: 165 }),
      ),
    ).toThrow(/Available: \[Basic\], Друкарня Х/);
    expect(p.removeCalls).toBe(0);
  });

  it("без profileName береться РОБОЧИЙ профіль документа, а не константа", () => {
    const m = withFakeApp(
      IDMCP,
      {
        process: proc(),
        profileNames: ["[Basic]", "Друкарня Х"],
        workingProfile: "Друкарня Х",
      },
      () => IDMCP.handlers.preflight_measure({ waitSeconds: 165 }),
    );
    expect(m.profileName).toBe("Друкарня Х");
  });

  it("профіль у КВАДРАТНИХ ДУЖКАХ знаходиться перебором", () => {
    /* itemByName на таких назвах віддає невалідний об'єкт — виміряно. */
    const m = withFakeApp(IDMCP, { process: proc(), profileNames: ["Інший", "[Basic]"] }, () =>
      IDMCP.handlers.preflight_measure({ profileName: "[Basic]", waitSeconds: 165 }),
    );
    expect(m.profileName).toBe("[Basic]");
  });

  it("стан правил профілю читається за флагом RULE_IS_DISABLED", () => {
    const m = measure(proc());
    expect(m.rules).toEqual([
      { id: "ADBE_OversetText", flag: "RETURN_AS_ERROR", enabled: true },
      { id: "ADBE_ImageResolution", flag: "RULE_IS_DISABLED", enabled: false },
    ]);
  });
});

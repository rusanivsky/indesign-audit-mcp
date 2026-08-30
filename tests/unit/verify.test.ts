import { describe, expect, it } from "vitest";
import { verifyFixes } from "../../src/composition/verify.js";
import type { Finding } from "../../src/composition/types.js";

/*
 * КОНТРАКТ `Finding` ТУТ ДОТРИМАНИЙ ПОВНІСТЮ, і це не педантизм.
 *
 * У брифінгу Задачі 14 фабрика знахідки не мала поля `strength` — а воно
 * обов'язкове (`types.ts`), і саме тому брифінговий тест не скомпілювався б
 * узагалі. Те саме зауваження вже висували попереднім задачам фази, тож
 * фабрика тут повторює ту, що в `propose.test.ts`, поле в поле.
 */
const f = (id: string, over: Partial<Finding> = {}): Finding => ({
  id,
  defect: "loose",
  severity: "error",
  page: "12",
  containerId: "story:0",
  paragraphIndex: 1,
  lineInParagraph: 0,
  lineText: "",
  measured: 1.4,
  strength: 0.4,
  detail: "",
  ...over,
});

describe("verifyFixes", () => {
  it("знахідка зникла — resolved", () => {
    const v = verifyFixes([f("a")], [], ["a"]);
    expect(v).toEqual([{ findingId: "a", outcome: "resolved", detail: expect.any(String) }]);
  });

  it("знахідка лишилася — still-present", () => {
    expect(verifyFixes([f("a")], [f("a")], ["a"])[0]!.outcome).toBe("still-present");
  });

  it("з'явився новий дефект, якого не було, — displaced", () => {
    const v = verifyFixes([f("a")], [f("b", { lineInParagraph: 1 })], ["a"]);
    expect(v.map((x) => x.outcome).sort()).toEqual(["displaced", "resolved"]);
  });

  it("знахідки, яких не застосовували, не звітуються", () => {
    expect(verifyFixes([f("a"), f("b")], [f("b")], ["a"]).map((v) => v.findingId)).toEqual(["a"]);
  });

  it("новий дефект в іншому абзаці теж displaced — правка могла зачепити сусідів", () => {
    const v = verifyFixes([f("a")], [f("z", { paragraphIndex: 9 })], ["a"]);
    expect(v.find((x) => x.outcome === "displaced")!.findingId).toBe("z");
  });

  /*
   * Далі — те, чого брифінг не перевіряв, але без чого звіт бреше.
   */

  it("still-present несе виміряні числа ДО і ПІСЛЯ — інакше «лишилося» не відрізнити від «лишилося вдвічі слабше»", () => {
    const v = verifyFixes([f("a", { strength: 0.4 })], [f("a", { strength: 0.2 })], ["a"]);
    expect(v[0]!.outcome).toBe("still-present");
    expect(v[0]!.detail).toContain("0.4");
    expect(v[0]!.detail).toContain("0.2");
  });

  it("порожній applied не звітує нічого зі старих, але нові дефекти показує", () => {
    const v = verifyFixes([f("a")], [f("a"), f("n", { lineInParagraph: 3 })], []);
    expect(v.map((x) => x.findingId)).toEqual(["n"]);
    expect(v[0]!.outcome).toBe("displaced");
  });

  it("applied з ідентифікатором, якого не було в before, не вигадує знахідки", () => {
    expect(verifyFixes([], [], ["привид"])).toEqual([]);
  });

  it("порядок сталий: спершу застосовані в порядку before, потім нові в порядку after", () => {
    const v = verifyFixes(
      [f("a"), f("b", { lineInParagraph: 1 })],
      [f("b", { lineInParagraph: 1 }), f("x", { lineInParagraph: 5 }), f("y", { lineInParagraph: 6 })],
      ["a", "b"],
    );
    expect(v.map((x) => x.findingId)).toEqual(["a", "b", "x", "y"]);
    expect(v.map((x) => x.outcome)).toEqual(["resolved", "still-present", "displaced", "displaced"]);
  });

  it("дубль ідентифікатора в applied не подвоює рядок звіту", () => {
    const v = verifyFixes([f("a")], [], ["a", "a"]);
    expect(v).toHaveLength(1);
  });

  /*
   * Дубль у САМИХ знахідках — а не в `applied`. Мутаційний прогін показав, що
   * попередній тест дедуплікацію не перевіряв узагалі: цикл іде по `before`, тож
   * повтор у `applied` подвоїти нічого не може за побудовою. Реальне джерело
   * повтору — зведення пачок сторінок (`mergeResults`), де та сама адреса може
   * прийти з двох вікон, якщо перелік сторінок містить повтори.
   */
  it("та сама знахідка двічі в before дає ОДИН рядок звіту", () => {
    const v = verifyFixes([f("a"), f("a")], [], ["a"]);
    expect(v).toHaveLength(1);
    expect(v[0]!.outcome).toBe("resolved");
  });

  it("та сама нова знахідка двічі в after дає ОДИН рядок displaced", () => {
    const v = verifyFixes([], [f("n"), f("n")], []);
    expect(v).toHaveLength(1);
    expect(v[0]!.outcome).toBe("displaced");
  });

  it("числа у звіті округлені: сира подвійна точність робить рядок нечитним", () => {
    const v = verifyFixes(
      [f("a", { strength: 1 / 3, measured: 1 / 7 })],
      [f("a", { strength: 1 / 3, measured: 1 / 7 })],
      ["a"],
    );
    expect(v[0]!.detail).toContain("0.3333");
    expect(v[0]!.detail).not.toContain("0.3333333333333333");
  });

  it("детально названо клас дефекту й сторінку — звіт читає людина", () => {
    const v = verifyFixes([f("a", { defect: "widow", page: "77" })], [], ["a"]);
    expect(v[0]!.detail).toContain("widow");
    expect(v[0]!.detail).toContain("77");
  });
});

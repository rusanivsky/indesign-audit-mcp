import { describe, it, expect } from "vitest";
import { normalizeForMatching } from "../../src/corrections/normalize.js";

describe("normalizeForMatching", () => {
  it("згортає прогін пробільних символів в один пробіл", () => {
    const r = normalizeForMatching("а  \t б");
    expect(r.text).toBe("а б");
    expect(r.map).toEqual([0, 1, 5]);
    expect(r.mapEnd).toEqual([1, 5, 6]);
  });

  it("вилучає м'який перенос і символи нульової ширини", () => {
    const r = normalizeForMatching("пере­нос​");
    expect(r.text).toBe("перенос");
    expect(r.map[4]).toBe(5);
  });

  it("зводить нерозривний пробіл до звичайного", () => {
    expect(normalizeForMatching("на столі").text).toBe("на столі");
  });

  it("уніфікує лапки", () => {
    expect(normalizeForMatching("«текст» „текст“").text).toBe('"текст" "текст"');
  });

  it("уніфікує тире й дефіси", () => {
    expect(normalizeForMatching("а—б – в‑г").text).toBe("а-б - в-г");
  });

  it("не змінює регістр", () => {
    expect(normalizeForMatching("Київ").text).toBe("Київ");
  });

  it("зберігає інваріант карти: кожен нормалізований символ походить із свого діапазону", () => {
    const src = "Слово  друге—третє";
    const r = normalizeForMatching(src);
    for (let i = 0; i < r.text.length; i++) {
      expect(r.map[i]).toBeLessThan(r.mapEnd[i]!);
      expect(r.mapEnd[i]!).toBeLessThanOrEqual(src.length);
      if (i > 0) expect(r.map[i]!).toBeGreaterThanOrEqual(r.mapEnd[i - 1]!);
    }
    expect(r.mapEnd[r.text.length - 1]).toBe(src.length);
  });

  it("порожній рядок дає порожній результат", () => {
    expect(normalizeForMatching("")).toEqual({ text: "", map: [], mapEnd: [] });
  });

  it("вилучає DROP-символ (м'який перенос) усередині прогону пробілів", () => {
    // "a" (0) " " (1) SHY (2) " " (3) "b" (4), довжина джерела 5.
    // Внутрішній while у гілці WS поглинає SHY разом із сусідніми пробілами
    // в один діапазон [1, 4), тож увесь прогін згортається в один пробіл.
    const src = "a ­ b";
    const r = normalizeForMatching(src);
    expect(r.text).toBe("a b");
    expect(r.map).toEqual([0, 1, 4]);
    expect(r.mapEnd).toEqual([1, 4, 5]);
    for (let i = 0; i < r.text.length; i++) {
      expect(r.map[i]).toBeLessThan(r.mapEnd[i]!);
      if (i > 0) expect(r.map[i]!).toBeGreaterThanOrEqual(r.mapEnd[i - 1]!);
    }
    expect(r.mapEnd[r.text.length - 1]).toBe(src.length);
  });

  it("вилучає кілька WS і DROP символів упереміш в одному прогоні", () => {
    // "x"(0) " "(1) " "(2) ZWSP(3) SHY(4) " "(5) " "(6) "y"(7), довжина 8.
    // Увесь прогін індексів 1..6 (два пробіли, ZWSP, SHY, два пробіли)
    // згортається в один пробіл — діапазон [1, 7).
    const src = "x  ​­  y";
    const r = normalizeForMatching(src);
    expect(r.text).toBe("x y");
    expect(r.map).toEqual([0, 1, 7]);
    expect(r.mapEnd).toEqual([1, 7, 8]);
    for (let i = 0; i < r.text.length; i++) {
      expect(r.map[i]).toBeLessThan(r.mapEnd[i]!);
      if (i > 0) expect(r.map[i]!).toBeGreaterThanOrEqual(r.mapEnd[i - 1]!);
    }
    expect(r.mapEnd[r.text.length - 1]).toBe(src.length);
  });

  it("DROP одразу перед прогоном пробілів лишає в карті непокритий проміжок джерела", () => {
    // "a"(0) SHY(1) " "(2) " "(3) "b"(4), довжина 5.
    // SHY на позиції 1 зустрічається ГОЛОВНИМ циклом (не з середини WS-гілки,
    // бо перед ним не було пробілу), тож він вилучається верхньою перевіркою
    // DROP і взагалі не потрапляє в жоден діапазон map/mapEnd: mapEnd[0]=1,
    // а наступний map[1]=2 — джерельний індекс 1 (сам SHY) "осиротілий".
    // Це допустимо: інваріант вимагає лише map[i] < mapEnd[i] і
    // map[i] >= mapEnd[i-1] (без перекриття), а не суцільне покриття без
    // прогалин — межі збігу беруться з першого й останнього токена, а не
    // з кожного проміжного символу.
    const src = "a­  b";
    const r = normalizeForMatching(src);
    expect(r.text).toBe("a b");
    expect(r.map).toEqual([0, 2, 4]);
    expect(r.mapEnd).toEqual([1, 4, 5]);
    for (let i = 0; i < r.text.length; i++) {
      expect(r.map[i]).toBeLessThan(r.mapEnd[i]!);
      if (i > 0) expect(r.map[i]!).toBeGreaterThanOrEqual(r.mapEnd[i - 1]!);
    }
    expect(r.mapEnd[r.text.length - 1]).toBe(src.length);
  });
});

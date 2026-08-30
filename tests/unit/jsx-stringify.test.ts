import { describe, it, expect } from "vitest";
import { loadJsxCore } from "./helpers/load-jsx-core.js";

/**
 * Серіалізація IDMCP.quote/IDMCP.stringify — найризикованіша функція в мосту:
 * текст InDesign містить \r (кінець абзацу, буде в КОЖНОМУ story), лапки,
 * зворотні слеші й довільну кирилицю. Тест виконує СПРАВЖНІЙ src/jsx/_core.jsx
 * (через loadJsxCore), а не ручну копію логіки — тому будь-яка майбутня правка
 * quote/stringify або зламає ці тести, або мовчки пройде повз них не зможе.
 */
describe("IDMCP.quote / IDMCP.stringify", () => {
  const IDMCP = loadJsxCore();

  it("round-trip для кожного керівного коду 0x00-0x1F дає той самий символ", () => {
    for (let code = 0x00; code <= 0x1f; code++) {
      const original = String.fromCharCode(code);
      const json = IDMCP.stringify(original);
      const parsed = JSON.parse(json);
      expect(parsed).toBe(original);
    }
  });

  it("\\r (кінець абзацу InDesign) серіалізується як \\r і повертається як \\r", () => {
    const original = "перший\rдругий";
    const parsed = JSON.parse(IDMCP.stringify(original));
    expect(parsed).toBe(original);
    expect(IDMCP.stringify(original)).toContain("\\r");
  });

  it("\\n, \\t, \\b, \\f round-trip правильно", () => {
    const original = "a\nb\tc\bd\fe";
    expect(JSON.parse(IDMCP.stringify(original))).toBe(original);
  });

  it("подвійна лапка і зворотний слеш екрануються і повертаються без змін", () => {
    const original = 'він сказав "привіт" і додав \\ символ';
    const json = IDMCP.stringify(original);
    expect(JSON.parse(json)).toBe(original);
    expect(json).toContain('\\"');
    expect(json).toContain("\\\\");
  });

  it("U+2028 (LINE SEPARATOR) і U+2029 (PARAGRAPH SEPARATOR) round-trip правильно", () => {
    const ls = String.fromCharCode(0x2028);
    const ps = String.fromCharCode(0x2029);
    const original = "рядок1" + ls + "рядок2" + ps;
    expect(JSON.parse(IDMCP.stringify(original))).toBe(original);
  });

  it("кирилиця лишається літерами в JSON, а не \\uXXXX", () => {
    const original = "Київ — столиця України";
    const json = IDMCP.stringify(original);
    expect(json).toContain("Київ");
    expect(json).not.toMatch(/\\u04[0-9a-f]{2}/i);
    expect(JSON.parse(json)).toBe(original);
  });

  it("вкладений масив в об'єкті серіалізується коректно", () => {
    const original = { items: ["а", "б", 3] };
    expect(JSON.parse(IDMCP.stringify(original))).toEqual(original);
  });

  it("вкладений об'єкт у масиві серіалізується коректно", () => {
    const original = [{ a: 1 }, { b: "текст\rз \\ і \"лапками\"" }];
    expect(JSON.parse(IDMCP.stringify(original))).toEqual(original);
  });

  it("порожній масив і порожній об'єкт", () => {
    expect(IDMCP.stringify([])).toBe("[]");
    expect(IDMCP.stringify({})).toBe("{}");
  });

  it("null серіалізується як null", () => {
    expect(IDMCP.stringify(null)).toBe("null");
  });

  it("NaN і Infinity серіалізуються як null (JSON не має цих значень)", () => {
    expect(IDMCP.stringify(NaN)).toBe("null");
    expect(IDMCP.stringify(Infinity)).toBe("null");
    expect(IDMCP.stringify(-Infinity)).toBe("null");
  });
});

/*
 * `undefined` У ВЛАСТИВОСТІ — ВИПУСКАЄТЬСЯ, ЯК І В JSON.stringify.
 *
 * Доти воно ставало `"key": null`, і це не косметика: інтерфейси на боці TS
 * писані під конвенцію Node, тобто з НЕОБОВ'ЯЗКОВИМИ полями (`JsxResult.data?`,
 * `runWrite` з `backupPath?: string`). Обробник, що повертав
 * `{ backupPath: undefined }`, давав на тому боці `{ backupPath: null }`:
 * `"backupPath" in result` істинне, а перевірка `result.backupPath ? … : …`
 * тихо йшла гілкою «копії не робилося» для поля, якого просто не задавали.
 */
describe("undefined у властивостях", () => {
  const IDMCP = loadJsxCore();

  it("властивість зі значенням undefined випускається", () => {
    expect(IDMCP.stringify({ a: 1, b: undefined })).toBe(JSON.stringify({ a: 1, b: undefined }));
  });

  it("null лишається null — це ЗАДАНЕ значення, не відсутність", () => {
    expect(IDMCP.stringify({ a: null })).toBe('{"a":null}');
  });

  it("на верхньому рівні undefined лишається null", () => {
    /* Там немає ключа, який можна випустити, а порожня відповідь зламала б
     * розбір на боці Node. */
    expect(IDMCP.stringify(undefined)).toBe("null");
  });

  it("у МАСИВІ undefined лишається null — як у JSON.stringify", () => {
    expect(IDMCP.stringify([1, undefined, 3])).toBe(JSON.stringify([1, undefined, 3]));
  });
});

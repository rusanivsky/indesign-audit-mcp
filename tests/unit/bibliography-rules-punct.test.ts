import { describe, expect, it } from "vitest";
import {
  doubleDotRule, finalDotRule, headingFormRule, prescribedSpacingRule, slashOnceRule,
} from "../../src/bibliography/rules-dstu.js";
import { parseRecord } from "../../src/bibliography/parse.js";
import type { BibRecord } from "../../src/bibliography/types.js";

const rec = (text: string): BibRecord => ({
  number: 50, text, containerId: "story:0", start: 0, end: text.length, page: "20",
});
const parse = (t: string) => parseRecord(rec(t));
const OK =
  "50. Прізвище, Ім'я По батькові. Назва : підназва / І. П. Прізвище // Журнал. – 2024. – С. 5-9.";

describe("prescribedSpacingRule", () => {
  it("ловить двокрапку без пробілу перед нею, але ЗАВЖДИ як needs-review", () => {
    /*
     * ДСТУ 7.1: `;` `:` `…` до винятків НЕ належать і мають пробіли з обох боків.
     * Але в корпусі 1290 двокрапок без пробілу, і більшість граматичні —
     * «Серія: Історичні науки». Відрізнити автоматично не можна.
     */
    const f = prescribedSpacingRule.check(parse(OK.replace(" : ", ": ")), "7.1");
    expect(f.length).toBeGreaterThan(0);
    for (const x of f) expect(x.confidence).toBe("needs-review");
  });

  it("граматична двокрапка в назві серії не видається за помилку набору", () => {
    const t = OK.replace("// Журнал", "// Вісник Черкас. ун-ту. Серія: Історичні науки");
    for (const x of prescribedSpacingRule.check(parse(t), "7.1")) {
      expect(x.confidence).toBe("needs-review");
    }
  });

  it("НЕ чіпає `упоряд.:` — роль перед іменами пишеться злито", () => {
    /* Виміряно: у стандарті 27 проти 0, у корпусі 84 проти 0 (спек §7.1). */
    const t = OK.replace("/ І. П. Прізвище", "/ упоряд.: І. П. Прізвище, О. О. Інший");
    expect(prescribedSpacingRule.check(parse(t), "7.1")).toEqual([]);
  });

  it("НЕ вимагає пробілу перед комою й крапкою — це виняток стандарту", () => {
    expect(prescribedSpacingRule.check(parse(OK), "7.1")).toEqual([]);
  });

  /*
   * Наслідок виправлення C1. Межа абзацу тепер лишається `\r`, а не
   * підміняється пробілом, тож обидва боки треба називати явно:
   *  - знак НА ПОЧАТКУ абзацу відокремлений межею абзацу, не менше ніж
   *    пробілом — знахідки бути НЕ мусить (інакше правило радило б вставити
   *    пробіл одразу після знака абзацу);
   *  - знак У КІНЦІ абзацу відокремлений з правого боку так само — знахідка
   *    про відсутній пробіл ЗЛІВА мусить лишитись, а не зникнути мовчки.
   */
  it("двокрапка на ПОЧАТКУ абзацу не вважається такою, що без пробілу перед нею", () => {
    const t = OK.replace("// Журнал", "// Журнал\r: продовження");
    for (const x of prescribedSpacingRule.check(parse(t), "7.1")) {
      expect(x.contextBefore.endsWith("\r")).toBe(false);
    }
  });

  it("двокрапка в КІНЦІ абзацу не зникає зі звіту", () => {
    const t = OK.replace("// Журнал", "// Журнал:\rпродовження");
    const f = prescribedSpacingRule.check(parse(t), "7.1");
    expect(f.length).toBeGreaterThan(0);
    expect(f.some((x) => x.before === ":")).toBe(true);
  });
});

describe("slashOnceRule", () => {
  it("ловить другу похилу риску в одному записі", () => {
    const t = OK.replace("// Журнал", "/ ще один // Журнал");
    expect(slashOnceRule.check(parse(t), "7.1")).toHaveLength(1);
  });

  it("дві похилі риски поспіль — це інший знак, не повтор", () => {
    expect(slashOnceRule.check(parse(OK), "7.1")).toEqual([]);
  });

  /*
   * Знахідка M8: гілка `text[i + 2] === "/"` була мертвою — вимога
   * роздільника ПІСЛЯ риски відкидає «//» сама. Гілку прибрано; цей тест
   * фіксує, що поведінка, яку вона нібито захищала, збереглась і без неї —
   * ЖОДНА з двох рисок у «//» не звітується, навіть коли одинарна риска в
   * записі вже була.
   */
  it("після виправлення M8 «//» так само не рахується за повтор", () => {
    const t = OK.replace("// Журнал", "// Журнал // Ще");
    const f = slashOnceRule.check(parse(t), "7.1");
    for (const x of f) expect(x.contextAfter.startsWith("/")).toBe(false);
    expect(f).toEqual([]);
  });

  /*
   * Наслідок виправлення C1: межа абзацу лишається `\r`, тож роздільник
   * довкола риски мусить називати її явно — інакше риска на початку
   * абзацу-продовження мовчки випадає зі звіту.
   */
  it("риска НА ПОЧАТКУ абзацу-продовження лічиться так само, як після пробілу", () => {
    /*
     * Запис із кількох абзаців (Задача 15): другий елемент відповідальності
     * починає новий абзац. Відколи межа абзацу лишається `\r` (виправлення
     * C1), роздільник довкола риски мусить називати її явно — інакше ця
     * друга риска мовчки випадає зі звіту, і запис виглядає бездоганним.
     */
    const t = OK.replace("// Журнал", "\r/ ще один // Журнал");
    const f = slashOnceRule.check(parse(t), "7.1");
    expect(f).toHaveLength(1);
    expect(f[0]?.before).toBe("/");
  });
});

describe("finalDotRule", () => {
  it("ловить запис без кінцевої крапки", () => {
    expect(finalDotRule.check(parse(OK.replace(/\.$/, "")), "7.1")).toHaveLength(1);
  });
  it("мовчить, коли крапка є", () => {
    expect(finalDotRule.check(parse(OK), "7.1")).toEqual([]);
  });
});

describe("headingFormRule", () => {
  it("ловить заголовок без коми після прізвища, і ЗАВЖДИ як needs-review", () => {
    /*
     * Правило не вміє відрізнити пропущену кому в заголовку від звичайної
     * назви, що починається з двох слів із великої літери («Історія
     * України.») — та сама непереборна двозначність, що й у
     * prescribedSpacingRule. Впевнений вердикт тут був би брехнею.
     */
    const t = OK.replace("Прізвище, Ім'я По батькові.", "Прізвище Ім'я По батькові.");
    const f = headingFormRule.check(parse(t), "7.1");
    expect(f.length).toBeGreaterThan(0);
    for (const x of f) expect(x.confidence).toBe("needs-review");
  });

  it("працює на заголовку з ЛАТИНСЬКОЮ i", () => {
    /* Спек §0.6: 55 847 латинських i проти 115 кириличних. */
    const t = "50. Iванов, Iван Iванович. Назва / I. I. Iванов // Журнал. – 2024. – С. 5-9.";
    expect(headingFormRule.check(parse(t), "7.1")).toEqual([]);
  });
});

describe("doubleDotRule", () => {
  it("ловить подвоєну крапку", () => {
    const t = OK.replace("// Журнал", "// Журнал.. Продовження");
    expect(doubleDotRule.check(parse(t), "7.1").length).toBeGreaterThan(0);
  });

  it("НЕ чіпає три крапки — це інший знак", () => {
    const dots = OK.replace("Назва", "Назва… далі");
    expect(doubleDotRule.check(parse(dots), "7.1")).toEqual([]);
    const literal = OK.replace("Назва", "Назва... далі");
    expect(doubleDotRule.check(parse(literal), "7.1")).toEqual([]);
  });

  it("НЕ чіпає «.-» у складних скороченнях", () => {
    const t = OK.replace("/ І. П. Прізвище", "/ авт.-упоряд. І. П. Прізвище");
    expect(doubleDotRule.check(parse(t), "7.1")).toEqual([]);
  });
});

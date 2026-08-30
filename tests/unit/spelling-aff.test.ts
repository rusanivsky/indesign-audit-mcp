import { describe, expect, it } from "vitest";
import { parseAff, parseFlags } from "../../src/spelling/aff.js";

describe("parseAff", () => {
  it("розбирає групу SFX із умовою", () => {
    const aff = parseAff([
      "SET UTF-8",
      "IGNORE ́",
      "WORDCHARS -'",
      "BREAK 1",
      "BREAK -",
      "SFX V Y 2",
      "SFX V ий ого [^ц]ий",
      "SFX V ий им ий",
    ].join("\n"));

    const v = aff.sfx.get("V");
    expect(v).toBeDefined();
    if (!v) throw new Error("v is undefined");
    expect(v.crossProduct).toBe(true);
    expect(v.rules).toHaveLength(2);
    const rule0 = v.rules[0];
    expect(rule0).toBeDefined();
    if (!rule0) throw new Error("rule0 is undefined");
    expect(rule0).toMatchObject({ strip: "ий", add: "ого" });
    expect(rule0.condition.test("білий")).toBe(true);
    expect(rule0.condition.test("куций")).toBe(false);
    expect(aff.ignore).toEqual(["́"]);
    expect(aff.wordChars).toEqual(["-", "'"]);
    expect(aff.breaks).toEqual(["-"]);
  });

  it("«0» у полі strip означає «нічого не знімати»", () => {
    const aff = parseAff(["PFX A N 1", "PFX A 0 не ."].join("\n"));
    const a = aff.pfx.get("A");
    expect(a).toBeDefined();
    if (!a) throw new Error("a is undefined");
    const rule0 = a.rules[0];
    expect(rule0).toBeDefined();
    if (!rule0) throw new Error("rule0 is undefined");
    expect(rule0.strip).toBe("");
    expect(rule0.add).toBe("не");
    expect(a.crossProduct).toBe(false);
  });

  it("розбирає групу PFX із умовою на початку основи", () => {
    const aff = parseAff([
      "PFX P Y 1",
      "PFX P 0 не [аеиіоуяю]",
    ].join("\n"));

    const p = aff.pfx.get("P");
    expect(p).toBeDefined();
    if (!p) throw new Error("p is undefined");
    expect(p.crossProduct).toBe(true);
    expect(p.rules).toHaveLength(1);
    const rule0 = p.rules[0];
    expect(rule0).toBeDefined();
    if (!rule0) throw new Error("rule0 is undefined");
    expect(rule0).toMatchObject({ strip: "", add: "не" });
    // Умови PFX приймаються до ПОЧАТКУ основи, тому якір ^ на початку
    expect(rule0.condition.test("адреса")).toBe(true);  // починається з 'а' (у умові)
    expect(rule0.condition.test("естетика")).toBe(true); // починається з 'е' (у умові)
    expect(rule0.condition.test("огірок")).toBe(true);    // починається з 'о' (у умові)
    expect(rule0.condition.test("люди")).toBe(false);   // починається з 'л' (не в умові)
    expect(rule0.condition.test("мосток")).toBe(false);  // починається з 'м' (не в умові)
    expect(rule0.condition.test("стіл")).toBe(false);    // починається з 'с' (не в умові)
  });

  it("кидає на директиві, якої не знає", () => {
    /* COMPOUNDMIN тепер розпізнається (Задача 15: рівень 2, «розпізнано, не
     * застосовано») — тому тут навмисно взято COMPOUNDBEGIN, яка лишається у
     * блок-листі. */
    expect(() => parseAff("COMPOUNDBEGIN 3")).toThrow(/COMPOUNDBEGIN/);
  });
});

describe("parseAff — англійські директиви", () => {
  it("FLAG num: прапорці — числа через кому", () => {
    const aff = parseAff(["FLAG num", "SFX 1001 Y 1", "SFX 1001 0 s ."].join("\n"));
    expect(aff.flagMode).toBe("num");
    expect(parseFlags("1001,2002", aff)).toEqual(["1001", "2002"]);
  });

  it("FLAG long: прапорці — пари символів", () => {
    const aff = parseAff("FLAG long");
    expect(parseFlags("AaBb", aff)).toEqual(["Aa", "Bb"]);
  });

  it("FLAG ПІСЛЯ SFX: перший прохід усе одно бачить режим правильно", () => {
    /* Рядок FLAG у справжніх .aff не завжди перший — це саме той порядок,
     * заради якого detectFlagMode робить окремий прохід ДО основного розбору.
     * Однопрохідний розбірник, що зустрів SFX раніше за FLAG, розібрав би
     * групу "1001" у режимі single (по одному символу з "1001"), а не як
     * цілий числовий прапорець. */
    const aff = parseAff(["SFX 1001 Y 1", "SFX 1001 0 s .", "FLAG num"].join("\n"));
    expect(aff.flagMode).toBe("num");
    const group = aff.sfx.get("1001");
    expect(group).toBeDefined();
    if (!group) throw new Error("group is undefined");
    expect(group.rules).toHaveLength(1);
    expect(group.rules[0]).toMatchObject({ strip: "", add: "s" });
  });

  it("однолітерні прапорці лишаються типовими", () => {
    const aff = parseAff("SFX V Y 0");
    expect(aff.flagMode).toBe("single");
    expect(parseFlags("efg", aff)).toEqual(["e", "f", "g"]);
  });

  it("цифровий прапорець без таблиці AF лишається ЛІТЕРАЛЬНИМ, а не аліасом", () => {
    /* Брифовий випадок окремо: у режимі single без AF цифра "2" — це
     * прапорець "2", а не звернення до порожньої таблиці псевдонімів. */
    const aff = parseAff("SFX V Y 0");
    expect(parseFlags("2", aff)).toEqual(["2"]);
  });

  it("AF: прапорець у .dic — НОМЕР рядка таблиці, а не набір літер", () => {
    /* Найнебезпечніша директива фази: без неї «слово/12» читається як
     * «прапорці 1 і 2» замість «прапорці з дванадцятого рядка AF», і
     * розбирач НЕ падає — він тихо бере чужі прапорці. */
    const aff = parseAff(["AF 2", "AF ABC", "AF DE"].join("\n"));
    expect(aff.aliases[1]).toEqual(["A", "B", "C"]);
    expect(aff.aliases[2]).toEqual(["D", "E"]);
    expect(parseFlags("2", aff)).toEqual(["D", "E"]);
  });

  it("AF: межі таблиці — слот 0 і індекс за останнім рядком лишаються ЛІТЕРАЛЬНИМИ", () => {
    /* Той самий небезпечний рубіж, лише з іншого боку: індекс 0 — навмисно
     * незайманий слот, а індекс, що дорівнює aliases.length, — уже ПОЗА
     * таблицею. Обидва мають читатись як звичайний прапорець-цифра, а не як
     * аліас. */
    const aff = parseAff(["AF 2", "AF ABC", "AF DE"].join("\n"));
    expect(parseFlags("0", aff)).toEqual(["0"]);
    expect(parseFlags(String(aff.aliases.length), aff)).toEqual([String(aff.aliases.length)]);
  });

  it("ICONV збирається парами", () => {
    const aff = parseAff(["ICONV 1", "ICONV ’ '"].join("\n"));
    expect(aff.iconv).toEqual([["’", "'"]]);
  });

  it("COMPOUND* розпізнається й позначається як НЕ застосоване", () => {
    const aff = parseAff(["COMPOUNDMIN 3", "COMPOUNDRULE 1", "COMPOUNDRULE n*1t"].join("\n"));
    expect(aff.compoundPresent).toBe(true);
  });

  it("підказкові директиви не ламають розбір і нічого не міняють", () => {
    const aff = parseAff(["PHONE 1", "PHONE AH0 _", "OCONV 1", "OCONV a b", "NOSUGGEST !"].join("\n"));
    expect(aff.compoundPresent).toBe(false);
  });

  it("num-режим КИДАЄ на порожньому елементі «12,,34»", () => {
    /* Мовчазне прийняття дало б прапорець "", який не збігається з жодним
     * заголовком групи, — тобто ТИХО втрачену парадигму. */
    expect(() => parseAff(["FLAG num", "AF 1", "AF 12,,34"].join("\n")))
      .toThrow(/non-numeric/);
  });

  it("num-режим КИДАЄ на літерному елементі «12,ab»", () => {
    expect(() => parseAff(["FLAG num", "AF 1", "AF 12,ab"].join("\n")))
      .toThrow(/non-numeric/);
  });

  it("long-режим КИДАЄ на непарному хвості замість мовчазного обрізання", () => {
    expect(() => parseAff(["FLAG long", "AF 1", "AF ABC"].join("\n")))
      .toThrow(/odd length/);
  });

  it("BREAK: прив'язаний патерн КИДАЄ — інакше правило мовчки не працює", () => {
    /* `^-` розгортач звів би до `w.includes("^-")`, що не справджується
     * ніколи: не хибний вирок, а невидима бездіяльність. */
    expect(() => parseAff(["BREAK 1", "BREAK ^-"].join("\n"))).toThrow(/BREAK/);
    expect(() => parseAff(["BREAK 1", "BREAK -$"].join("\n"))).toThrow(/BREAK/);
  });

  it("BREAK: звичайний роздільник розбирається й далі", () => {
    /* Негативний контроль до попереднього: кидає САМЕ прив'язка, а не
     * директива BREAK узагалі. Виміряні значення трьох словників — «-»,
     * «—», «–» — мусять проходити. */
    expect(parseAff(["BREAK 3", "BREAK —", "BREAK –", "BREAK -"].join("\n")).breaks)
      .toEqual(["—", "–", "-"]);
  });

  it("НЕВІДОМА директива й далі кидає з назвою", () => {
    expect(() => parseAff("CHECKSHARPS 1")).toThrow(/CHECKSHARPS/);
  });
});

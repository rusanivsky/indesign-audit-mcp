import { describe, expect, it } from "vitest";
import { joinParagraphRange, parseCommand } from "../../src/corrections/commands.js";

describe("parseCommand", () => {
  it("розуміє видалення в різних формулюваннях", () => {
    for (const note of ["видалити", "прибрати", "Вилучити", "забрати", "зайве слово", "зайва кома"]) {
      expect(parseCommand(note)).toEqual({ kind: "delete" });
    }
  });

  it("розуміє «прибрати абзац» як з'єднання, а НЕ як видалення", () => {
    for (const note of ["прибрати абзац", "з'єднати абзаци", "об'єднати абзац"]) {
      expect(parseCommand(note)).toEqual({ kind: "join-paragraph" });
    }
  });

  it("розуміє розбиття абзацу", () => {
    for (const note of ["розбити абзац", "новий абзац", "з нового абзацу"]) {
      expect(parseCommand(note)).toEqual({ kind: "split-paragraph" });
    }
  });

  it("розуміє перестановку", () => {
    expect(parseCommand("поміняти місцями")).toEqual({ kind: "swap" });
    expect(parseCommand("переставити")).toEqual({ kind: "swap" });
  });

  it("звичайну заміну віддає як replace з текстом", () => {
    expect(parseCommand("матір'ю")).toEqual({ kind: "replace", text: "матір'ю" });
  });

  it("на порожній нотатці не дає команди", () => {
    expect(parseCommand("   ")).toBeNull();
  });

  it("не плутає «прибрати» з «прибрати абзац»", () => {
    expect(parseCommand("прибрати")).toEqual({ kind: "delete" });
    expect(parseCommand("прибрати абзац")).toEqual({ kind: "join-paragraph" });
  });
});

describe("joinParagraphRange", () => {
  it("замінює роздільник на один пробіл", () => {
    const src = "Перше речення.\rДруге речення.";
    const r = joinParagraphRange(src, 14)!;
    expect(src.slice(0, r.start) + r.newText + src.slice(r.end)).toBe(
      "Перше речення. Друге речення.",
    );
  });

  it("не лишає подвійного пробілу, коли пробіл уже є з одного боку", () => {
    const src = "Перше речення. \rДруге речення.";
    const r = joinParagraphRange(src, 15)!;
    expect(src.slice(0, r.start) + r.newText + src.slice(r.end)).toBe(
      "Перше речення. Друге речення.",
    );
  });

  it("не втрачає жодного НЕпробільного символу", () => {
    const src = "Абзац один.\r\nАбзац два.";
    const r = joinParagraphRange(src, 11)!;
    const after = src.slice(0, r.start) + r.newText + src.slice(r.end);
    const letters = (s: string) => s.replace(/\s+/gu, "");
    expect(letters(after)).toBe(letters(src));
  });

  it("зменшує кількість абзаців рівно на один", () => {
    const src = "А.\rБ.\rВ.";
    const count = (s: string) => s.split(/[\r\n]+/u).length;
    const r = joinParagraphRange(src, 2)!;
    const after = src.slice(0, r.start) + r.newText + src.slice(r.end);
    expect(count(after)).toBe(count(src) - 1);
  });

  it("повертає null, коли роздільника поруч немає", () => {
    expect(joinParagraphRange("суцільний текст без меж", 5)).toBeNull();
  });
});

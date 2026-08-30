import { describe, expect, it } from "vitest";
import { paragraphAt, parseNote, type VariantDecision } from "../../src/corrections/variants.js";

describe("parseNote", () => {
  it("розбирає варіанти через скісну риску", () => {
    expect(parseNote("мамою / матір'ю").variants).toEqual(["мамою", "матір'ю"]);
  });

  it("розбирає варіанти через «або»", () => {
    expect(parseNote("тиша або спокій").variants).toEqual(["тиша", "спокій"]);
  });

  it("не ріже кому всередині фрази", () => {
    const p = parseNote("а потім, коли стемніло");
    expect(p.variants).toEqual(["а потім, коли стемніло"]);
  });

  it("ріже кому, коли всі частини — окремі слова", () => {
    expect(parseNote("тиша, спокій, лад").variants).toEqual(["тиша", "спокій", "лад"]);
  });

  it("позначає нотатку, що закінчується трьома крапками", () => {
    const p = parseNote("вона сказала....");
    expect(p.openEnded).toBe(true);
    expect(p.variants).toEqual(["вона сказала"]);
  });

  it("зберігає початкову нотатку без змін", () => {
    expect(parseNote("мамою / матір'ю").raw).toBe("мамою / матір'ю");
  });

  it("на порожній нотатці не дає варіантів", () => {
    expect(parseNote("   ").variants).toEqual([]);
  });
});

describe("paragraphAt", () => {
  const text = "Перший абзац тут.\rДругий абзац, довший, із комою.\rТретій.";

  it("повертає абзац цілком, а не обрізаний фрагмент", () => {
    expect(paragraphAt(text, 25)).toBe("Другий абзац, довший, із комою.");
  });

  it("працює на першому абзаці", () => {
    expect(paragraphAt(text, 2)).toBe("Перший абзац тут.");
  });

  it("працює на останньому абзаці без завершального роздільника", () => {
    expect(paragraphAt(text, text.length - 2)).toBe("Третій.");
  });

  it("розуміє \\n так само, як \\r", () => {
    expect(paragraphAt("а\nб\nв", 2)).toBe("б");
  });
});

describe("VariantDecision", () => {
  it("власний варіант позначається як власний", () => {
    const d: VariantDecision = {
      chosen: "матусею",
      source: "own",
      variantIndex: null,
      paragraph: "Вона завжди називала її матусею, а не мамою.",
      reason: "обидва варіанти редактора повторюють слово з наступного речення",
    };
    expect(d.source).toBe("own");
    expect(d.variantIndex).toBeNull();
  });

  it("варіант редактора несе свій індекс", () => {
    const d: VariantDecision = {
      chosen: "матір'ю",
      source: "editor",
      variantIndex: 1,
      paragraph: "…",
      reason: "перший варіант дає збіг відмінків із наступним словом",
    };
    expect(d.variantIndex).toBe(1);
  });
});

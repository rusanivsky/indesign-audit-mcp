import { describe, expect, it } from "vitest";
import {
  classifyBlack,
  colorDistance,
  describeColor,
  effectiveTint,
  totalInk,
} from "../../src/color/ink.js";
import type { ColorRef } from "../../src/color/types.js";

function cmyk(value: number[], named: string | null = null): ColorRef {
  return { named, model: "PROCESS", space: "CMYK", value, kind: "solid" };
}

describe("effectiveTint", () => {
  it("−1 означає «не задано» і дорівнює ста відсоткам", () => {
    expect(effectiveTint(-1)).toBe(100);
  });

  it("нуль — це справжній нуль, а не «не задано»", () => {
    expect(effectiveTint(0)).toBe(0);
  });

  it("звичайне значення проходить незмінним", () => {
    expect(effectiveTint(40)).toBe(40);
  });
});

describe("totalInk", () => {
  it("рахує суму чотирьох компонент CMYK", () => {
    expect(totalInk(cmyk([76, 48, 66, 70]), -1)).toBe(260);
  });

  it("[Registration] дає 400", () => {
    const reg: ColorRef = {
      named: "Registration", model: "REGISTRATION", space: "CMYK",
      value: [100, 100, 100, 100], kind: "solid",
    };
    expect(totalInk(reg, -1)).toBe(400);
  });

  it("відтінок зменшує фарбу пропорційно — 50 % від 260 лягає 130", () => {
    expect(totalInk(cmyk([76, 48, 66, 70]), 50)).toBe(130);
  });

  it("НЕ рахує суму для RGB: там немає фарби, є світло", () => {
    const rgb: ColorRef = {
      named: null, model: "PROCESS", space: "RGB", value: [0, 0, 0], kind: "solid",
    };
    expect(totalInk(rgb, -1)).toBeNull();
  });

  it("непрочитане значення дає null, а не нуль", () => {
    expect(totalInk(cmyk(null as unknown as number[]), -1)).toBeNull();
  });
});

describe("classifyBlack", () => {
  it("чиста K — це pure-k", () => {
    expect(classifyBlack(cmyk([0, 0, 0, 100]))).toBe("pure-k");
  });

  it("виміряний на книжці 76/48/66/70 — це збагачений чорний", () => {
    expect(classifyBlack(cmyk([76, 48, 66, 70]))).toBe("rich");
  });

  it("[Registration] класифікується окремо від збагаченого", () => {
    const reg: ColorRef = {
      named: "Registration", model: "REGISTRATION", space: "CMYK",
      value: [100, 100, 100, 100], kind: "solid",
    };
    expect(classifyBlack(reg)).toBe("registration");
  });

  it("акцентний червоний 20/100/90/10 чорним НЕ є — K замалий", () => {
    expect(classifyBlack(cmyk([20, 100, 90, 10]))).toBe("not-black");
  });

  it("темний із мізерною домішкою чорним збагаченим НЕ вважається", () => {
    expect(classifyBlack(cmyk([2, 0, 0, 95]))).toBe("pure-k");
  });
});

describe("colorDistance", () => {
  it("нуль для однакових", () => {
    expect(colorDistance(cmyk([1, 29, 18, 0]), cmyk([1, 29, 18, 0]))).toBe(0);
  });

  it("виміряний близький промах 0/100/85/5 повз 20/100/90/10 — двадцять", () => {
    expect(colorDistance(cmyk([0, 100, 85, 5]), cmyk([20, 100, 90, 10]))).toBe(20);
  });

  it("різні простори незрівнянні — null, а не велике число", () => {
    const rgb: ColorRef = {
      named: null, model: "PROCESS", space: "RGB", value: [0, 0, 0], kind: "solid",
    };
    expect(colorDistance(cmyk([0, 0, 0, 100]), rgb)).toBeNull();
  });
});

describe("describeColor", () => {
  it("іменований показує назву разом зі значенням", () => {
    expect(describeColor(cmyk([0, 0, 0, 100], "Black"), -1)).toBe('"Black" CMYK 0/0/0/100');
  });

  it("безіменний називається безіменним прямо", () => {
    expect(describeColor(cmyk([76, 48, 66, 70]), -1)).toBe("unnamed CMYK 76/48/66/70");
  });

  it("відтінок, відмінний від ста, входить в опис — інакше дві різні знахідки зіллються", () => {
    expect(describeColor(cmyk([0, 0, 0, 100], "Black"), 40)).toBe('"Black" CMYK 0/0/0/100 @40%');
  });
});

/*
 * ВІДТІНОК — ЧАСТИНА РЕЦЕПТА ФАРБИ, А НЕ ОЗДОБА.
 *
 * `totalInk` множив на відтінок від початку, `classifyBlack` — ні: дві
 * функції одного файлу відповідали про ту саму фарбу по-різному. Виміряно
 * 2026-08-26 на обох боках вади.
 */
describe("classifyBlack і відтінок", () => {
  const rich = cmyk([60, 40, 40, 100], "Rich Black");
  const pureK = cmyk([0, 0, 0, 100], "Black");

  it("насичений чорний при відтінку 20 — це світло-сірий, а не насичений чорний", () => {
    /* Хибне спрацювання: родина black звітувала «насичений чорний під
     * дрібним текстом» про текст, що кладе 12/8/8/20. */
    expect(classifyBlack(rich, -1)).toBe("rich");
    expect(classifyBlack(rich, 20)).toBe("not-black");
    expect(totalInk(rich, 20)).toBe(48);
  });

  it("чиста K при відтінку 0 не кладе фарби, тож і не «pure-k»", () => {
    /* Пропуск: як `pure-k` цей сайт відсіювався в detectOverprintSuspicious
     * рядком `continue`, і надрук поверх нічого лишався непоміченим. */
    expect(classifyBlack(pureK, -1)).toBe("pure-k");
    expect(classifyBlack(pureK, 0)).toBe("not-black");
    expect(totalInk(pureK, 0)).toBe(0);
  });

  it("НЕГАТИВНИЙ КОНТРОЛЬ: без відтінку вердикт незмінний", () => {
    /* Замовчування −1 мусить лишати всю попередню поведінку як була —
     * інакше правка мовчки переписала б усі наявні вердикти. */
    expect(classifyBlack(rich)).toBe("rich");
    expect(classifyBlack(pureK)).toBe("pure-k");
    expect(classifyBlack(rich, 100)).toBe("rich");
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runJsx } from "../../src/bridge/runner.js";
import { makeFixtureDoc, closeFixtureDoc, assertFixtureActive } from "./fixture-doc.js";

let docName: string;

beforeAll(async () => {
  docName = await makeFixtureDoc();
});

afterAll(async () => {
  if (docName) {
    await closeFixtureDoc(docName);
  }
});

interface RangeInfo {
  containerId: string;
  start: number;
  end: number;
  charStyles: string[];
  paraStyles: string[];
}

describe("grep_find", () => {
  it("знаходить слово в документі й повертає офсети", async () => {
    await assertFixtureActive(docName);
    const r = await runJsx<{ matches: { containerId: string; start: number; end: number; text: string }[] }>(
      "grep_find",
      { pattern: "pomylka" },
    );
    expect(r.matches.length).toBeGreaterThan(0);
    expect(r.matches[0]!.text).toBe("pomylka");
    expect(r.matches[0]!.end - r.matches[0]!.start).toBe("pomylka".length);
  });

  it("порожній результат для відсутнього тексту", async () => {
    await assertFixtureActive(docName);
    const r = await runJsx<{ matches: unknown[] }>("grep_find", { pattern: "zzzznemaie" });
    expect(r.matches).toHaveLength(0);
  });
});

describe("ranges_inspect", () => {
  it("повідомляє абзацний стиль діапазону", async () => {
    await assertFixtureActive(docName);
    const found = await runJsx<{ matches: { containerId: string; start: number; end: number }[] }>(
      "grep_find",
      { pattern: "stolytsia" },
    );
    const m = found.matches[0]!;
    const r = await runJsx<{ results: RangeInfo[] }>("ranges_inspect", {
      ranges: [{ containerId: m.containerId, start: m.start, end: m.end }],
    });
    expect(r.results[0]!.paraStyles).toContain("Osnovnyi");
    expect(r.results[0]!.charStyles.length).toBeGreaterThan(0);
  });

  it("порожній діапазон (end === start) не кидає виняток і повертає порожні списки стилів", async () => {
    await assertFixtureActive(docName);
    const found = await runJsx<{ matches: { containerId: string; start: number; end: number }[] }>(
      "grep_find",
      { pattern: "stolytsia" },
    );
    const m = found.matches[0]!;
    const r = await runJsx<{ results: RangeInfo[] }>("ranges_inspect", {
      ranges: [{ containerId: m.containerId, start: m.start, end: m.start }],
    });
    expect(r.results).toHaveLength(1);
    expect(r.results[0]!.charStyles).toEqual([]);
    expect(r.results[0]!.paraStyles).toEqual([]);
  });
});

/*
 * Виправлення 2 (моє рішення з брифінгу): grep_find у базовому коді брифінгу
 * завжди формує containerId як "story:" + storyIndex за t.parentStory, ігноруючи
 * випадок, коли збіг лежить усередині комірки таблиці чи виноски (Task 6 має для
 * них окремі форми containerId, і resolveContainer суворо їх валідує). Цей блок
 * перевіряє емпірично на фікстурі (яка містить і таблицю, і виноску), що для
 * такого збігу пара (containerId, start/end) з grep_find, пропущена через
 * ranges_inspect, справді вказує на текст комірки/виноски, а не на щось інше.
 */
describe("grep_find + ranges_inspect: збіги всередині комірки таблиці й виноски", () => {
  it("збіг у комірці таблиці отримує containerId у форматі story:N/table:N/cell:R,C", async () => {
    await assertFixtureActive(docName);
    const r = await runJsx<{ matches: { containerId: string; start: number; end: number; text: string }[] }>(
      "grep_find",
      { pattern: "Yacheika" },
    );
    expect(r.matches.length).toBeGreaterThan(0);
    const m = r.matches[0]!;
    expect(m.containerId).toMatch(/^story:\d+\/table:\d+\/cell:\d+,\d+$/);

    const read = await runJsx<{ containers: { containerId: string; text: string }[] }>("containers_read", {
      containerIds: [m.containerId],
    });
    const container = read.containers[0]!;
    expect(container).toBeTruthy();
    expect(container.text.substring(m.start, m.end)).toBe("Yacheika");
  });

  it("збіг у виносці отримує containerId у форматі story:N/footnote:N", async () => {
    await assertFixtureActive(docName);
    const r = await runJsx<{ matches: { containerId: string; start: number; end: number; text: string }[] }>(
      "grep_find",
      { pattern: "vynosky" },
    );
    expect(r.matches.length).toBeGreaterThan(0);
    const m = r.matches[0]!;
    expect(m.containerId).toMatch(/^story:\d+\/footnote:\d+$/);

    const read = await runJsx<{ containers: { containerId: string; text: string }[] }>("containers_read", {
      containerIds: [m.containerId],
    });
    const container = read.containers[0]!;
    expect(container).toBeTruthy();
    expect(container.text.substring(m.start, m.end)).toBe("vynosky");
  });
});

/*
 * Рецензія Task 7, fix round 1, Important 1: findGrepPreferences/
 * changeGrepPreferences — не єдиний глобальний стан, що керує областю
 * пошуку doc.findGrep(). app.findChangeGrepOptions.includeFootnotes і чотири
 * сусідні прапорці (includeMasterPages, includeHiddenLayers,
 * includeLockedStoriesForFind, includeLockedLayersForFind) — окремий
 * ambient-стан застосунку, який раніше не скидався. На машині, де
 * "Include Footnotes" вимкнено в діалозі Find/Change, grep_find мовчки не
 * знаходив би збіг у виносці. Цей тест примусово вимикає includeFootnotes
 * ПЕРЕД викликом grep_find (симулюючи несприятливий ambient-стан) і
 * перевіряє: (а) збіг у виносці все одно знаходиться — обробник примусово
 * встановлює includeFootnotes=true на час пошуку; (б) після виклику
 * grep_find ambient-значення лишається false, а не "витікає" як true
 * назовні — доводить, що finally справді відновлює попереднє значення.
 */
describe("grep_find: не залежить від ambient findChangeGrepOptions (Important 1)", () => {
  it("знаходить збіг у виносці, навіть якщо includeFootnotes вимкнено заздалегідь, і відновлює попереднє значення після виклику", async () => {
    await assertFixtureActive(docName);

    const before = await runJsx<{ previous: boolean; current: boolean }>(
      "__debug_set_include_footnotes",
      { value: false },
    );
    try {
      const forced = await runJsx<{ current: boolean }>("__debug_set_include_footnotes", {});
      expect(forced.current).toBe(false);

      const r = await runJsx<{ matches: { containerId: string; start: number; end: number; text: string }[] }>(
        "grep_find",
        { pattern: "vynosky" },
      );
      expect(r.matches.length).toBeGreaterThan(0);
      expect(r.matches[0]!.text).toBe("vynosky");

      const after = await runJsx<{ current: boolean }>("__debug_set_include_footnotes", {});
      expect(after.current).toBe(false);
    } finally {
      /* Повертаємо застосунок у стан, у якому його застав тест, — не лишаємо
       * стійких змін ambient-налаштувань InDesign користувача. */
      await runJsx("__debug_set_include_footnotes", { value: before.previous });
    }
  });
});

/*
 * Рецензія Task 7, fix round 1, Important 2: unwrapStyleRef безумовно бере
 * елемент [0] із загорнутого в масив значення appliedParagraphStyle/
 * appliedCharacterStyle. Попередній тест ("повідомляє абзацний стиль
 * діапазону") перевіряв лише 9-символьний діапазон в ОДНОМУ абзаці з
 * порожнім charStyles.length > 0 (що проходить і на самому "[None]") — не
 * доводив, що ranges_inspect накопичує ВСІ стилі діапазону, що охоплює
 * межу. Фікстура (src/jsx/_fixtures.jsx) тепер має окрему story f3 з двома
 * абзацами різних стилів ("Zaholovok" і "Osnovnyi") і символьним стилем
 * "Vydilennia", застосованим до частини другого абзацу — саме так, щоб
 * діапазон [0, кінець тексту] перетинав ОБИДВІ межі одночасно.
 */
describe("ranges_inspect: діапазон, що охоплює межу кількох стилів (Important 2)", () => {
  it("накопичує ВСІ абзацні й символьні стилі діапазону, а не лише перший", async () => {
    await assertFixtureActive(docName);

    const read = await runJsx<{ containers: { containerId: string; text: string }[] }>("containers_read", {});
    const container = read.containers.find((c) => c.text.indexOf("Zaholovok rozdilu.") === 0);
    expect(container).toBeTruthy();

    const r = await runJsx<{ results: RangeInfo[] }>("ranges_inspect", {
      ranges: [{ containerId: container!.containerId, start: 0, end: container!.text.length }],
    });
    const info = r.results[0]!;

    expect([...info.paraStyles].sort()).toEqual(["Osnovnyi", "Zaholovok"]);
    expect(info.paraStyles).toHaveLength(2);

    expect(info.charStyles).toContain("Vydilennia");
    expect(info.charStyles).toHaveLength(2);
  });
});

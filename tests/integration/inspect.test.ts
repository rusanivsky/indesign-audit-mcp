import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runJsx } from "../../src/bridge/runner.js";
import { makeFixtureDoc, closeFixtureDoc, assertFixtureActive } from "./fixture-doc.js";
import type { ContainerSnapshot } from "../../src/corrections/types.js";

let docName: string | undefined;

beforeAll(async () => {
  docName = await makeFixtureDoc();
});

afterAll(async () => {
  /* Закриваємо фікстуру навіть якщо якийсь тест впав — інакше вона лишиться
   * відкритою й зіб'є наступні запуски. __fixture_close сам по собі безпечний
   * (закриває лише документ із точним іменем), тож викликати його можна
   * безумовно, поки ім'я взагалі відоме. */
  if (docName) {
    await closeFixtureDoc(docName);
  }
});

describe("doc_overview", () => {
  it("бачить обидві сторінки, обидва story і створені стилі", async () => {
    await assertFixtureActive(docName!);
    const o = await runJsx<{
      pageCount: number;
      stories: { overflows: boolean }[];
      paragraphStyles: string[];
      characterStyles: string[];
    }>("doc_overview", {});
    expect(o.pageCount).toBe(2);
    expect(o.stories.length).toBeGreaterThanOrEqual(2);
    expect(o.paragraphStyles).toContain("Osnovnyi");
    expect(o.characterStyles).toContain("Vydilennia");
  });

  it("позначає story з overset", async () => {
    await assertFixtureActive(docName!);
    const o = await runJsx<{ stories: { overflows: boolean }[] }>("doc_overview", {});
    expect(o.stories.some((s) => s.overflows)).toBe(true);
  });
});

describe("containers_read", () => {
  it("повертає текст і діапазони сторінок", async () => {
    await assertFixtureActive(docName!);
    const r = await runJsx<{ docName: string; containers: ContainerSnapshot[] }>("containers_read", {});
    const first = r.containers.find((c) => c.text.includes("stolytsia"))!;
    expect(first).toBeTruthy();
    expect(first.pageRuns.length).toBeGreaterThan(0);
    expect(first.pageRuns[0]!.page).toBe("1");
    expect(first.kind).toBe("text");
  });

  it("вказує, з якого символу починається overset", async () => {
    await assertFixtureActive(docName!);
    const r = await runJsx<{ containers: ContainerSnapshot[] }>("containers_read", {});
    const over = r.containers.find((c) => c.oversetFrom !== null);
    expect(over).toBeTruthy();
    expect(over!.oversetFrom).toBeGreaterThan(0);
  });

  it("фільтрує за containerIds", async () => {
    await assertFixtureActive(docName!);
    const all = await runJsx<{ containers: ContainerSnapshot[] }>("containers_read", {});
    const id = all.containers[0]!.containerId;
    const one = await runJsx<{ containers: ContainerSnapshot[] }>("containers_read", { containerIds: [id] });
    expect(one.containers).toHaveLength(1);
    expect(one.containers[0]!.containerId).toBe(id);
  });

  it("віддає комірку таблиці й виноску окремими контейнерами з форматом containerId, який розуміє resolveContainer", async () => {
    await assertFixtureActive(docName!);
    const r = await runJsx<{ containers: ContainerSnapshot[] }>("containers_read", {});

    const cell = r.containers.find((c) => c.kind === "table");
    expect(cell).toBeTruthy();
    expect(cell!.containerId).toMatch(/^story:\d+\/table:\d+\/cell:\d+,\d+$/);
    expect(cell!.text).toBe("Yacheika tablytsi.");

    const footnote = r.containers.find((c) => c.kind === "footnote");
    expect(footnote).toBeTruthy();
    expect(footnote!.containerId).toMatch(/^story:\d+\/footnote:\d+$/);
    expect(footnote!.text).toBe("Tekst vynosky.");

    /* Текст комірки й виноски не повинен потрапляти в основний текст story. */
    const parentStory = r.containers.find((c) => c.kind === "text" && cell!.containerId.startsWith(c.containerId));
    expect(parentStory).toBeTruthy();
    expect(parentStory!.text).not.toContain("Yacheika tablytsi");
    expect(parentStory!.text).not.toContain("Tekst vynosky");
  });
});

/*
 * Рецензія Task 6, Important 1: зовнішній цикл containers_read робив `continue`
 * за самим "story:N", тому запит на вкладений контейнер (комірку чи виноску)
 * БЕЗ батьківського "story:N" у списку відсіював усю story разом із вкладеними
 * циклами — виноска чи комірка не поверталися взагалі. Ці тести фіксують
 * правильну поведінку: фільтр застосовується до кожного контейнера окремо.
 */
describe("containers_read: фільтрація за вкладеними containerIds (Important 1)", () => {
  it("повертає виноску за її власним id без батьківського story:N у списку", async () => {
    await assertFixtureActive(docName!);
    const all = await runJsx<{ containers: ContainerSnapshot[] }>("containers_read", {});
    const footnote = all.containers.find((c) => c.kind === "footnote");
    expect(footnote).toBeTruthy();

    const filtered = await runJsx<{ containers: ContainerSnapshot[] }>("containers_read", {
      containerIds: [footnote!.containerId],
    });
    expect(filtered.containers).toHaveLength(1);
    expect(filtered.containers[0]!.containerId).toBe(footnote!.containerId);
    expect(filtered.containers[0]!.kind).toBe("footnote");
  });

  it("повертає комірку таблиці за її власним id без батьківського story:N у списку", async () => {
    await assertFixtureActive(docName!);
    const all = await runJsx<{ containers: ContainerSnapshot[] }>("containers_read", {});
    const cell = all.containers.find((c) => c.kind === "table");
    expect(cell).toBeTruthy();

    const filtered = await runJsx<{ containers: ContainerSnapshot[] }>("containers_read", {
      containerIds: [cell!.containerId],
    });
    expect(filtered.containers).toHaveLength(1);
    expect(filtered.containers[0]!.containerId).toBe(cell!.containerId);
    expect(filtered.containers[0]!.kind).toBe("table");
  });

  it("повертає обидва контейнери за сумішшю story:N (іншої story) і вкладеного id", async () => {
    await assertFixtureActive(docName!);
    const all = await runJsx<{ containers: ContainerSnapshot[] }>("containers_read", {});
    const footnote = all.containers.find((c) => c.kind === "footnote")!;
    expect(footnote).toBeTruthy();

    /* Story, яка НЕ є батьківською для виноски — щоб перевірка суміші була
     * змістовною (не просто рівнозначна одиничному фільтру). */
    const otherStory = all.containers.find(
      (c) => c.kind === "text" && !footnote.containerId.startsWith(c.containerId),
    );
    expect(otherStory).toBeTruthy();

    const filtered = await runJsx<{ containers: ContainerSnapshot[] }>("containers_read", {
      containerIds: [otherStory!.containerId, footnote.containerId],
    });
    const ids = filtered.containers.map((c) => c.containerId).sort();
    expect(ids).toEqual([otherStory!.containerId, footnote.containerId].sort());
  });

  it("повертає порожній список на неіснуючий containerId, без винятку", async () => {
    await assertFixtureActive(docName!);
    const filtered = await runJsx<{ containers: ContainerSnapshot[] }>("containers_read", {
      containerIds: ["story:999/footnote:999"],
    });
    expect(filtered.containers).toEqual([]);
  });
});

/*
 * Рецензія Task 6, Important 2: попередні тести перевіряли лише
 * pageRuns.length > 0 і oversetFrom > 0 — жоден не звіряв офсети з конкретними
 * символами. Тут офсети звіряються з ЛІТЕРАЛЬНИМ текстом, який ми самі
 * поклали у фікстуру (src/jsx/_fixtures.jsx), тож підміна не пройде непоміченою.
 */
describe("containers_read: точність символьних офсетів (Important 2)", () => {
  const BASE_TEXT_1 = "Kyiv — stolytsia Ukrainy. Cei tekst mistyt slovo pomylka dlia testu.";
  const BASE_TEXT_2 = "Druhyi potik tekstu, iakyi navmysno ne vlizaie u ramku i daie overset.";

  it("story без overset: pageRun покриває весь текст, офсети точно відповідають символам", async () => {
    await assertFixtureActive(docName!);
    const r = await runJsx<{ containers: ContainerSnapshot[] }>("containers_read", {});
    const story = r.containers.find((c) => c.kind === "text" && c.text.indexOf(BASE_TEXT_1) === 0);
    expect(story).toBeTruthy();
    expect(story!.oversetFrom).toBeNull();
    expect(story!.pageRuns).toHaveLength(1);

    const run = story!.pageRuns[0]!;
    expect(run.start).toBe(0);
    /* Довжина story = базове речення + 1 символ-якір таблиці + 1 символ-якір
     * виноски (перевірено окремим пробним скриптом проти живого InDesign). */
    expect(story!.text.length).toBe(BASE_TEXT_1.length + 2);
    expect(run.end).toBe(story!.text.length);
    expect(run.page).toBe("1");
    expect(story!.text.substring(run.start, run.end)).toBe(story!.text);
    expect(story!.text.substring(0, BASE_TEXT_1.length)).toBe(BASE_TEXT_1);
  });

  it("story з overset: pageRun і oversetFrom точно розділяють видиму й overset частини тексту", async () => {
    await assertFixtureActive(docName!);
    const r = await runJsx<{ containers: ContainerSnapshot[] }>("containers_read", {});
    const story = r.containers.find((c) => c.kind === "text" && c.text === BASE_TEXT_2);
    expect(story).toBeTruthy();
    expect(story!.oversetFrom).toBe(7);
    expect(story!.pageRuns).toHaveLength(1);

    const run = story!.pageRuns[0]!;
    expect(run.start).toBe(0);
    expect(run.end).toBe(7);
    expect(story!.text.substring(run.start, run.end)).toBe("Druhyi ");
    expect(story!.text.substring(0, story!.oversetFrom!)).toBe("Druhyi ");
    expect(story!.text.substring(story!.oversetFrom!)).toBe(
      "potik tekstu, iakyi navmysno ne vlizaie u ramku i daie overset.",
    );
  });

  it("діапазони pageRuns не перекриваються і йдуть за зростанням у кожній story", async () => {
    await assertFixtureActive(docName!);
    const r = await runJsx<{ containers: ContainerSnapshot[] }>("containers_read", {});
    for (const c of r.containers.filter((x) => x.kind === "text")) {
      let prevEnd = 0;
      for (const run of c.pageRuns) {
        expect(run.start).toBeLessThan(run.end);
        expect(run.start).toBeGreaterThanOrEqual(prevEnd);
        prevEnd = run.end;
      }
    }
  });
});

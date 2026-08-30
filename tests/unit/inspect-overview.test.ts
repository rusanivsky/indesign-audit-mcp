import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_STORIES,
  OVERVIEW_SECTIONS,
  shapeOverview,
  type OverviewSection,
  type RawOverview,
} from "../../src/inspect/overview.js";
import { serialise } from "../../src/tools/shared.js";

function story(index: number, characters: number, overflows = false) {
  return {
    index,
    containerId: `story:${index}`,
    characters,
    words: Math.ceil(characters / 6),
    preview: "х".repeat(Math.min(60, characters)),
    overflows,
  };
}

function raw(over: Partial<RawOverview> = {}): RawOverview {
  return {
    name: "Книжка.indd",
    saved: true,
    fullName: "/шлях/Книжка.indd",
    pageCount: 2,
    spreadCount: 1,
    pages: [
      { name: "1", frames: 3 },
      { name: "2", frames: 4 },
    ],
    stories: [story(0, 100), story(1, 200)],
    paragraphStyles: ["Основний текст"],
    characterStyles: ["Напівжирний"],
    fonts: ["Proba Pro [installed]"],
    links: [{ name: "фото.psd", status: "NORMAL" }],
    ...over,
  };
}

const ALL = [...OVERVIEW_SECTIONS];

describe("shapeOverview — стеля на перелік історій", () => {
  it("історій менше за стелю — обрізання немає, і поле про це не бреше", () => {
    /* Позитивний близнюк: без нього наступний тест проходив би й на коді,
     * що заявляє обрізання завжди. */
    const r = shapeOverview(raw(), { sections: ALL, maxStories: 60 });
    expect(r.stories).toHaveLength(2);
    expect(r.storiesTruncated).toBeUndefined();
  });

  it("історій РІВНО стеля — це ще не обрізання", () => {
    const stories = Array.from({ length: 5 }, (_, i) => story(i, 100 + i));
    const r = shapeOverview(raw({ stories }), { sections: ALL, maxStories: 5 });
    expect(r.stories).toHaveLength(5);
    expect(r.storiesTruncated).toBeUndefined();
  });

  it("історій більше за стелю — рядків рівно стеля, і скільки їх насправді, видно", () => {
    const stories = Array.from({ length: 500 }, (_, i) => story(i, 100 + i));
    const r = shapeOverview(raw({ stories }), { sections: ALL, maxStories: 60 });
    expect(r.stories).toHaveLength(60);
    expect(r.storiesTruncated).toEqual({ shown: 60, total: 500, rule: expect.any(String) });
  });

  it("стеля тримає ОБСЯГ: 575 історій важать не більше, ніж 60", () => {
    /* Власне те, заради чого стеля й з'явилась. Виміряно на робочій книжці
     * 2026-08-16: 575 історій дають 75 392 Б самого лише переліку —
     * 90 % усієї відповіді doc_overview. Мутант «прибрати зріз» червонить
     * саме тут. Міряється ТИМ САМИМ серіалізатором, що віддає `ok()`. */
    const many = Array.from({ length: 575 }, (_, i) => story(i, 500 + i));
    const capped = serialise(shapeOverview(raw({ stories: many }), { sections: ALL, maxStories: 60 }));
    const uncapped = serialise(shapeOverview(raw({ stories: many }), { sections: ALL, maxStories: 575 }));
    expect(Buffer.byteLength(uncapped, "utf8") - Buffer.byteLength(capped, "utf8")).toBeGreaterThan(
      50_000,
    );
  });

  it("не мутує вхідного масиву викликача", () => {
    const stories = Array.from({ length: 10 }, (_, i) => story(i, 100 + i));
    shapeOverview(raw({ stories }), { sections: ALL, maxStories: 3 });
    expect(stories).toHaveLength(10);
    expect(stories[0]!.index).toBe(0);
  });
});

describe("shapeOverview — підсумки рахуються ДО обрізання", () => {
  it("числа підсумків не залежать від стелі", () => {
    /*
     * Головне твердження всього модуля: обрізаний перелік не сміє
     * применшувати числа. Мутант, що рахує підсумки після зрізу, дав би
     * тут 3 замість 40 — і відповідь брехала б тихо.
     */
    const stories = Array.from({ length: 40 }, (_, i) => story(i, 10, i < 4));
    const full = shapeOverview(raw({ stories }), { sections: ALL, maxStories: 40 });
    const cut = shapeOverview(raw({ stories }), { sections: ALL, maxStories: 3 });
    expect(cut.totals).toEqual(full.totals);
    expect(cut.totals.stories).toBe(40);
    expect(cut.totals.storiesOverset).toBe(4);
  });

  it("рахує знаки, слова, overset і порожні історії", () => {
    const stories = [story(0, 100), story(1, 0), story(2, 50, true)];
    const r = shapeOverview(raw({ stories }), { sections: ALL, maxStories: 60 });
    expect(r.totals.storyCharacters).toBe(150);
    expect(r.totals.storyWords).toBe(17 + 0 + 9);
    expect(r.totals.storiesOverset).toBe(1);
    expect(r.totals.storiesEmpty).toBe(1);
  });

  it("підсумки решти розділів є навіть тоді, коли самих розділів у відповіді немає", () => {
    /* Інакше `sections` перетворював би «не просили» на «немає». */
    const r = shapeOverview(raw(), { sections: [], maxStories: 60 });
    expect(r.totals.pages).toBe(2);
    expect(r.totals.paragraphStyles).toBe(1);
    expect(r.totals.characterStyles).toBe(1);
    expect(r.totals.fonts).toBe(1);
    expect(r.totals.links).toBe(1);
  });
});

describe("shapeOverview — порядок історій", () => {
  it("overset попереду, далі за обсягом, а рівні — за індексом", () => {
    const stories = [story(0, 10), story(1, 900), story(2, 10, true), story(3, 900)];
    const r = shapeOverview(raw({ stories }), { sections: ALL, maxStories: 60 });
    expect(r.stories!.map((s) => s.index)).toEqual([2, 1, 3, 0]);
  });

  it("порядок той самий і тоді, коли обрізання не сталося", () => {
    /*
     * Один шлях коду, а не два: сортування «лише коли обрізаємо» — це
     * гілка, яку легко зламати непомітно, бо на маленькому документі
     * її не видно.
     */
    const stories = [story(0, 10), story(1, 900)];
    const r = shapeOverview(raw({ stories }), { sections: ALL, maxStories: 60 });
    expect(r.stories!.map((s) => s.index)).toEqual([1, 0]);
  });

  it("обрізання лишає найважливіші, а не перші за індексом", () => {
    const stories = [story(0, 10), story(1, 20), story(2, 30)];
    const r = shapeOverview(raw({ stories }), { sections: ALL, maxStories: 1 });
    expect(r.stories!.map((s) => s.index)).toEqual([2]);
  });
});

describe("shapeOverview — розділи", () => {
  it("названий розділ є, неназваного немає ЗОВСІМ", () => {
    const r = shapeOverview(raw(), { sections: ["stories"], maxStories: 60 });
    expect(r.stories).toBeDefined();
    expect("pages" in r).toBe(false);
    expect("fonts" in r).toBe(false);
    expect("links" in r).toBe(false);
    expect("paragraphStyles" in r).toBe(false);
    expect("characterStyles" in r).toBe(false);
  });

  it("відповідь сама каже, які розділи в ній є", () => {
    const r = shapeOverview(raw(), { sections: ["fonts", "links"], maxStories: 60 });
    expect(r.sections).toEqual(["fonts", "links"]);
  });

  it("без розділу stories немає й поля про його обрізання", () => {
    const stories = Array.from({ length: 100 }, (_, i) => story(i, 100));
    const r = shapeOverview(raw({ stories }), { sections: ["pages"], maxStories: 10 });
    expect("stories" in r).toBe(false);
    expect(r.storiesTruncated).toBeUndefined();
  });

  it("шапка документа є завжди, хай би які розділи просили", () => {
    const r = shapeOverview(raw(), { sections: [], maxStories: 60 });
    expect(r.name).toBe("Книжка.indd");
    expect(r.pageCount).toBe(2);
    expect(r.spreadCount).toBe(1);
    expect(r.fullName).toBe("/шлях/Книжка.indd");
  });

  it("порожній перелік розділів залишає відповідь маленькою", () => {
    const stories = Array.from({ length: 575 }, (_, i) => story(i, 500));
    const bytes = Buffer.byteLength(
      serialise(shapeOverview(raw({ stories }), { sections: [], maxStories: 60 })),
      "utf8",
    );
    expect(bytes).toBeLessThan(1_000);
  });
});

describe("замовчування", () => {
  it("стеля за замовчуванням покриває звичайний документ і ріже книжку", () => {
    /* Число взяте з виміру, не зі стелі: на робочій книжці 575 історій, і
     * 60 рядків важать ≈8 КБ проти 75 КБ повного переліку. */
    expect(DEFAULT_MAX_STORIES).toBe(60);
  });

  it("перелік розділів покриває всі ключі виміру", () => {
    const r = shapeOverview(raw(), { sections: ALL, maxStories: 60 });
    for (const section of OVERVIEW_SECTIONS as readonly OverviewSection[]) {
      expect(r[section]).toBeDefined();
    }
  });
});

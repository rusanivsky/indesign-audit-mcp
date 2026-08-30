import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { detectMasterIslands, DEFAULT_MIN_RUN } from "../../src/pagination/master-island.js";
import type { PageRef } from "../../src/pagination/types.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * ФІКСТУРА — НЕ ВИГАДАНА. Це виміряні карти «сторінка → майстер» двох
 * реальних версій робочої книжки (зонд `scripts/probe-foreign-master.jsx`,
 * 2026-08-18, InDesign 21.5.1.73, обидва файли читались і закривались без
 * збереження, `modified false→false`).
 *
 * Оракул тут ЗНАЙДЕНИЙ, а не сконструйований: різниця між двома картами —
 * РІВНО ОДНА сторінка, с. 188, і це той самий інцидент, який описав автор
 * книжки («забув переназначити материнський шаблон, і колонтитул зник»).
 * Тобто цей файл дає рідкісну для проєкту річ — правильну відповідь, здобуту
 * незалежно від детектора.
 */
const МАПА = JSON.parse(
  readFileSync(join(HERE, "fixtures", "book-master-map.json"), "utf8"),
) as {
  зламаний: { pages: Array<{ name: string; offset: number; side: string; master: string | null }> };
  виправлений: { pages: Array<{ name: string; offset: number; side: string; master: string | null }> };
};

/** Карта зонда → `PageRef`. Поля, яких детектор не чіпає, порожні. */
function pageRefs(які: "зламаний" | "виправлений"): PageRef[] {
  return МАПА[які].pages.map((p) => ({
    name: p.name,
    offset: p.offset,
    side: p.side as PageRef["side"],
    spreadIndex: Math.floor(p.offset / 2),
    spreadSiblings: [],
    master: p.master,
  }));
}

/** Дрібна синтетична книжка: одна сторона, задані майстри по порядку. */
function synthetic(masters: Array<string | null>): PageRef[] {
  return masters.map((m, i) => ({
    name: String(i + 1),
    offset: i,
    side: "LEFT_HAND" as const,
    spreadIndex: i,
    spreadSiblings: [],
    master: m,
  }));
}

describe("острів чужого майстра на РЕАЛЬНІЙ книжці", () => {
  it("знаходить с. 188 — сторінку, з якої зник колонтитул", () => {
    const кандидати = detectMasterIslands(pageRefs("зламаний"));
    const мішень = кандидати.find((c) => c.page === "188");
    expect(мішень).toBeDefined();
    expect(мішень!.master).toBe("G-Шаблон без колонтитулів");
    expect(мішень!.neighbourMaster).toBe("J-Розділ 3 текст колонтитули");
    expect(мішень!.side).toBe("LEFT_HAND");
  });

  it("на 196 сторінках дає рівно чотири кандидати — це ВИМІРЯНА влучність", () => {
    /*
     * Число не «має бути малим», а є таким, яким виміряне. Якщо майбутня
     * правка розмиє детектор, тут виросте саме воно — і зросте не абстрактно,
     * а на конкретній книжці з відомою відповіддю.
     */
    const кандидати = detectMasterIslands(pageRefs("зламаний"));
    expect(кандидати.map((c) => c.page)).toEqual(["49", "108", "167", "188"]);
  });

  it("у ВИПРАВЛЕНОМУ файлі с. 188 зникає, а решта кандидатів лишається", () => {
    /*
     * НАЙСИЛЬНІШИЙ КОНТРОЛЬ, ЯКИЙ ТУТ ВЗАГАЛІ МОЖЛИВИЙ. Два файли різняться
     * рівно однією сторінкою, тож зникнення саме її — і збереження решти —
     * доводить, що детектор реагує на ту зміну, яку зробив автор, а не на
     * щось інше, що корелює з нею.
     */
    const кандидати = detectMasterIslands(pageRefs("виправлений"));
    expect(кандидати.map((c) => c.page)).toEqual(["49", "108", "167"]);
  });

  it("минає свідомі ЧЕРГУВАННЯ — саме через них minRun не може бути 1", () => {
    /*
     * с. 164-170 (J/N) і 119-125 (D/M) — ритм «текст розділу — чекліст», а
     * не збій. При minRun = 1 їх десять, і всі десять — хибні.
     */
    const при1 = detectMasterIslands(pageRefs("зламаний"), { minRun: 1 });
    const при2 = detectMasterIslands(pageRefs("зламаний"), { minRun: 2 });
    expect(при1.length).toBe(16);
    expect(при2.length).toBe(4);
    for (const p of ["164", "166", "168", "170", "119", "121", "123", "125"]) {
      expect(при1.map((c) => c.page)).toContain(p);
      expect(при2.map((c) => c.page)).not.toContain(p);
    }
  });

  it("minRun = 3 ВТРАЧАЄ мішень — ось чому замовчування саме 2", () => {
    /*
     * Ряд перед с. 188 — три сторінки, після — дві. Задум казав «усередині
     * ДОВГОГО рівного ряду»; вимір показав, що ряд не довгий, і що строгіший
     * поріг відкидає саме той випадок, заради якого детектор написаний.
     */
    const при3 = detectMasterIslands(pageRefs("зламаний"), { minRun: 3 });
    expect(при3).toHaveLength(0);
  });

  it("замовчування дорівнює виміряному", () => {
    expect(DEFAULT_MIN_RUN).toBe(2);
    expect(detectMasterIslands(pageRefs("зламаний"))).toEqual(
      detectMasterIslands(pageRefs("зламаний"), { minRun: 2 }),
    );
  });
});

describe("правила, на яких детектор стоїть", () => {
  it("острів — це коли сусіди узгоджені МІЖ СОБОЮ", () => {
    expect(detectMasterIslands(synthetic(["A", "A", "X", "A", "A"]))).toHaveLength(1);
  });

  it("межа двох ділянок островом НЕ Є", () => {
    /* A A X B B — сторінка між двома різними ділянками законно належить
     * будь-якій із них, і назвати її чужою нема підстав. */
    expect(detectMasterIslands(synthetic(["A", "A", "X", "B", "B"]))).toHaveLength(0);
  });

  it("сторінка БЕЗ майстра островом не є — «шаблон знято» це рішення, не збій", () => {
    expect(detectMasterIslands(synthetic(["A", "A", null, "A", "A"]))).toHaveLength(0);
  });

  it("сусід без майстра еталону не задає", () => {
    expect(detectMasterIslands(synthetic(["A", null, "X", null, "A"]))).toHaveLength(0);
  });

  it("два острови поспіль — це вже ділянка, а не острови", () => {
    expect(detectMasterIslands(synthetic(["A", "A", "X", "X", "A", "A"]))).toHaveLength(0);
  });

  it("краї книжки: першу й останню сторінку боку судити нема з чим", () => {
    expect(detectMasterIslands(synthetic(["X", "A", "A", "A", "X"]))).toHaveLength(0);
  });

  it("боки не змішуються — verso судиться з verso", () => {
    /* Розворот у книжці з дзеркальними полями має два різні шаблони ЗА
     * ПОБУДОВОЮ; порівняння впоперек розвороту позначило б половину книжки. */
    const pages: PageRef[] = [];
    for (let i = 0; i < 10; i++) {
      pages.push({
        name: String(i + 1),
        offset: i,
        side: i % 2 === 0 ? "RIGHT_HAND" : "LEFT_HAND",
        spreadIndex: Math.floor(i / 2),
        spreadSiblings: [],
        master: i % 2 === 0 ? "R" : "L",
      });
    }
    expect(detectMasterIslands(pages)).toHaveLength(0);
  });

  it("порядок видачі — документний, а не порядок обходу боків", () => {
    const pages: PageRef[] = [];
    const masters = ["L", "R", "L", "R", "Lx", "Rx", "L", "R", "L", "R"];
    for (let i = 0; i < 10; i++) {
      pages.push({
        name: String(i + 1),
        offset: i,
        side: i % 2 === 0 ? "LEFT_HAND" : "RIGHT_HAND",
        spreadIndex: Math.floor(i / 2),
        spreadSiblings: [],
        master: masters[i]!,
      });
    }
    const c = detectMasterIslands(pages);
    expect(c.map((x) => x.page)).toEqual(["5", "6"]);
  });

  it("minRun нуль або дробовий — ГУЧНА відмова", () => {
    expect(() => detectMasterIslands(synthetic(["A", "A", "X", "A", "A"]), { minRun: 0 })).toThrow(
      /minRun/,
    );
    expect(() =>
      detectMasterIslands(synthetic(["A", "A", "X", "A", "A"]), { minRun: 1.5 }),
    ).toThrow(/minRun/);
  });

  it("порожній документ і одна сторінка не кидають", () => {
    expect(detectMasterIslands([])).toHaveLength(0);
    expect(detectMasterIslands(synthetic(["A"]))).toHaveLength(0);
  });
});

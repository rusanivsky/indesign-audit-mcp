import { afterAll, describe, expect, it } from "vitest";
import { runJsx } from "../../src/bridge/runner.js";
import { closeFixtureDoc } from "./fixture-doc.js";
import type { ColorMeasure, Surface } from "../../src/color/types.js";

const DOC = "__color_fixture";

async function measured(): Promise<ColorMeasure> {
  await runJsx("__fixture_color", { name: DOC }, { timeoutMs: 60_000 });
  return runJsx<ColorMeasure>("color_measure", {}, { timeoutMs: 120_000 });
}

describe("color_measure на фікстурі", () => {
  afterAll(async () => {
    await closeFixtureDoc(DOC);
  });

  it("бачить [Registration] і на об'єкті, і на тексті", async () => {
    const m = await measured();
    const reg = m.sites.filter(
      (s) => s.color.model === "REGISTRATION" && s.surface !== "swatch",
    );
    const surfaces = new Set(reg.map((s) => s.surface));
    expect(surfaces.has("pageItem")).toBe(true);
    expect(surfaces.has("textRange")).toBe(true);
  });

  it("несе шар і його придатність до друку на кожному кортежі об'єкта", async () => {
    const m = await measured();
    const tech = m.sites.filter((s) => s.layer === "__технічний");
    expect(tech.length).toBeGreaterThan(0);
    for (const s of tech) expect(s.printable).toBe(false);
  });

  it("читає кегль текстових кортежів — без нього родина black сліпа", async () => {
    const m = await measured();
    const small = m.sites.filter((s) => s.surface === "textRange" && s.pointSize === 8);
    expect(small.length).toBeGreaterThan(0);
  });

  it("бачить колір у комірці таблиці — поверхня, якої немає в робочій книжці", async () => {
    const m = await measured();
    expect(m.sites.some((s) => s.surface === "tableCell")).toBe(true);
  });

  /* Гейти шару застосовуються й до комірки таблиці: без цього таблиця на
   * службовому шарі судилася б як друкована й не потрапила б навіть у
   * sitesSkippedNonPrinting. Фікстурна таблиця лежить у рамці на звичайному
   * шарі, тож шар мусить бути НАЗВАНИЙ, а не «?». */
  it("комірка таблиці несе шар своєї рамки, а не «?»", async () => {
    const m = await measured();
    const cells = m.sites.filter((s) => s.surface === "tableCell");
    expect(cells.length).toBeGreaterThan(0);
    for (const s of cells) expect(s.layer).not.toBe("?");
  });

  it("бачить колір у лінійці абзацу", async () => {
    const m = await measured();
    expect(m.sites.some((s) => s.surface === "paragraphRule")).toBe(true);
  });

  it("бачить спотову фарбу й рахує п'ять фарб у документі", async () => {
    const m = await measured();
    expect(m.inkCount).toBeGreaterThan(4);
    expect(m.sites.some((s) => s.color.model === "SPOT")).toBe(true);
  });

  it("бачить RGB-зразок", async () => {
    const m = await measured();
    expect(m.sites.some((s) => s.color.space === "RGB")).toBe(true);
  });

  /* Ruling 12: InDesign 21.5.1.73 не дає ні створити, ні прочитати стан
   * «overprint увімкнено на нульовій фарбі» — дванадцять спроб кидають.
   * Тест пінить саме це: якщо колись версія InDesign почне цей стан
   * віддавати, тест впаде — і це буде СИГНАЛ переглянути правило, а не
   * поломка. */
  it("overprint на нульовій фарбі НЕ читається — і це властивість InDesign, не фікстури", async () => {
    const m = await measured();
    const white = m.sites.filter(
      (s) => s.surface === "pageItem" && s.color.named === "Paper",
    );
    expect(white.length).toBeGreaterThan(0);
    for (const s of white) expect(s.overprint).not.toBe(true);
  });

  it("лічильники поверхонь відрізняють «немає» від «не прочитали»", async () => {
    const m = await measured();
    for (const c of m.counters) {
      if (c.seen > 0) expect(c.parsed + c.failed).toBeGreaterThan(0);
    }
  });

  /*
   * Лінивий лічильник не вміє сказати «нема»: поверхня, якої обхідник не
   * торкнувся, просто зникала з відповіді, і читач не відрізняв «таблиць у
   * книжці немає» від «таблиці не обходяться взагалі». Тепер перелік повний
   * за побудовою.
   */
  it("віддає лічильник на КОЖНУ поверхню, а не лише на ті, яких торкнувся", async () => {
    const m = await measured();
    const surfaces: Surface[] = [
      "swatch", "pageItem", "textRange", "paragraphRule", "underline",
      "strikeThrough", "tableCell", "tableStroke", "styleDefinition",
      "effect", "gradientStop", "link",
    ];
    for (const s of surfaces) {
      expect(m.counters.some((c) => c.surface === s), `лічильник ${s} відсутній`).toBe(true);
    }
  });

  /* Обведень таблиць прилад НЕ читає — визнана межа (спек §3.2 п.7). Саме
   * тому поверхня мусить стояти у відповіді з seen: 0: чесний нуль і є тим,
   * що доповідається. Фікстура таблицю МАЄ, тож нуль тут — про обведення, а
   * не про відсутність таблиць. */
  it("tableStroke доходить до відповіді з seen: 0 — межа приладу, названа числом", async () => {
    const m = await measured();
    const stroke = m.counters.filter((c) => c.surface === "tableStroke")[0];
    expect(stroke).toBeDefined();
    expect(stroke!.seen).toBe(0);
    const cell = m.counters.filter((c) => c.surface === "tableCell")[0];
    expect(cell!.seen).toBeGreaterThan(0);
  });

  /* Пом'якшення Ruling 9: effect.seen мусить рахувати НОСІЇВ, які читали, а
   * не самі лише знайдені тіні. Фікстура тіней не має взагалі — отже нуль
   * тіней при ненульовому seen і є доказом, що поверхню обходили. */
  it("effect.seen рахує носіїв, а не самі тіні: обхід видно навіть без жодної тіні", async () => {
    const m = await measured();
    const fx = m.counters.filter((c) => c.surface === "effect")[0];
    expect(fx!.seen).toBeGreaterThan(0);
    expect(fx!.parsed).toBeGreaterThan(0);
  });
});

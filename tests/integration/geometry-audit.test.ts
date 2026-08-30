import { afterAll, describe, expect, it } from "vitest";
import { runJsx } from "../../src/bridge/runner.js";
import { serialise } from "../../src/tools/shared.js";
import { closeFixtureDoc } from "./fixture-doc.js";
import type { GeometryMeasure } from "../../src/geometry/types.js";
import type { PopulationFamily } from "../../src/geometry/report.js";

const DOC = "__geometry_fixture";

describe("geometry_audit на фікстурі", () => {
  afterAll(async () => {
    await closeFixtureDoc(DOC);
  });

  it("знаходить близький промах і мовчить про грубий вихід", async () => {
    await runJsx("__fixture_geometry", { name: DOC });
    const m = await runJsx<{ items: unknown[]; pages: unknown[] }>("geometry_measure", {});
    const { detectNearMiss } = await import("../../src/geometry/frame.js");
    const found = detectNearMiss(m.items as never, m.pages as never, 1);
    expect(found.length).toBeGreaterThan(0);
    /* Грубий вихід (20 % ширини аркуша) серед знахідок бути не сміє. */
    for (const f of found) expect(Number.parseFloat(f.value)).toBeLessThan(1);
  });

  it("обсяг відповіді виміряно, а не призначено (Раунд 2: критерій wrap — матеріал, не інвентар)", async () => {
    const m = await runJsx<GeometryMeasure>("geometry_measure", {});
    const { buildReport } = await import("../../src/geometry/report.js");
    const { inventoryAnchored } = await import("../../src/geometry/anchored.js");
    const { inventoryGraphics } = await import("../../src/geometry/image.js");
    const { hasWrapMaterial } = await import("../../src/geometry/wrap.js");

    /* Та сама обв'язка, що в src/tools/geometry.ts — вимір мусить брати
     * РЕАЛЬНИЙ обсяг відповіді інструмента, а не звіту без нових полів §8.
     * Раунд 2: критерій wrap — hasWrapMaterial (матеріал для вироку), а НЕ
     * inventoryWrap().length === 0 (той критерій мовчав би про робочу
     * книжку, де textWrapMode = NONE на всіх елементах). */
    const anchoredInventory = inventoryAnchored(m.items);
    const graphicsInventory = inventoryGraphics(m.items);
    const emptyPopulations: PopulationFamily[] = [];
    if (anchoredInventory.length === 0) emptyPopulations.push("anchored");
    if (graphicsInventory.length === 0) emptyPopulations.push("image");
    if (!hasWrapMaterial(m.items)) emptyPopulations.push("wrap");
    const vectorGraphicsCount = m.items.filter(
      (i) => i.graphic !== null && i.graphic.kind === "vector",
    ).length;

    /* Фікстура __fixture_geometry НЕ вставляє зображень (власна нотатка
     * будівника), тож `image` тут — гарантована порожня популяція: це
     * реальний матеріал для рядка «Графіки в документі немає», а не
     * синтетика лише для юніт-тесту. */
    expect(emptyPopulations).toContain("image");
    /* Негативний контроль ДО виміру обсягу: фікстура МАЄ справжнє обтікання
     * (BOUNDING_BOX/JUMP_OBJECT, доведено tests/integration/geometry-measure.test.ts),
     * тож wrap тут НЕ мусить потрапити в emptyPopulations — інакше вимір
     * обсягу випадково включав би рядок, якого в реальній фікстурі бути не
     * повинно, і число нижче не відповідало б задуманому сценарію. */
    expect(emptyPopulations).not.toContain("wrap");

    const { inventoryWrap } = await import("../../src/geometry/wrap.js");
    const report = buildReport(m, [], {
      families: ["frame", "image", "anchored", "wrap"],
      rotatedExcluded: 0,
      vectorGraphicsCount,
      emptyPopulations,
      inventory: {
        anchored: anchoredInventory,
        graphics: graphicsInventory,
        wrap: inventoryWrap(m.items),
      },
      survey: null,
    });

    /*
     * ВИМІРЮЄТЬСЯ ТЕ, ЩО ВІДДАЄ ІНСТРУМЕНТ (рецензія гілки, I2), І САМЕ ТИМ
     * СЕРІАЛІЗАТОРОМ, ЩО Й `ok()`.
     *
     * Історія цього рядка — історія двох разів, коли поріг міряв не ту
     * відповідь. До 2026-08-15 тут важився `JSON.stringify(buildReport(...))`
     * — компактно й БЕЗ полів `inventory`/`survey`, тобто відповідь, якої
     * користувач ніколи не отримує (1861 Б проти справжніх 3758 Б, і поріг
     * 3722 книжка вже перевищувала). Далі тут стояв власний
     * `JSON.stringify(data, null, 2)` — знову НЕ те, що віддає сервер,
     * щойно `ok()` перейшов на компактну серіалізацію.
     *
     * Тому тепер — `serialise` із `src/tools/shared.ts`: ОДНА функція на
     * сервер і на тест, і розійтися вони більше не можуть за побудовою.
     */
    const payload = serialise(report);
    const bytes = Buffer.byteLength(payload, "utf8");
    console.log(`[вимір] обсяг ВІДПОВІДІ на фікстурі (як в ok()): ${bytes} Б`);

    /*
     * Поріг = 2× від РЕАЛЬНО виміряного розміру (правило Фази 5: поріг зі
     * стелі вакуумний, і там це сталося двічі за одну фазу).
     *
     * ВИМІРЯНО на цій фікстурі 2026-08-15, обома формами: з відступами —
     * 3758 Б, компактно — 3272 Б. Відколи `ok()` компактний, чинне друге:
     * 3272 × 2 = 6544. Число друкується рядком вище на кожному прогоні —
     * якщо фікстура зміниться, це видно, а не приховано.
     */
    expect(bytes).toBeLessThan(6544);

    /* Негативний контроль до самого порогу: поле, заради якого вимір
     * переробили, мусить БУТИ в тому, що зважено. Інакше поріг знову
     * стосувався б не тієї відповіді. */
    expect(payload).toContain("\"inventory\"");
    expect(payload).toContain("\"survey\"");
    expect(payload).toContain("\"coordinateOrigin\"");
  });
});

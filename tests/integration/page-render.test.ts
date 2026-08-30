import { readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runJsx } from "../../src/bridge/runner.js";
import { assertFixtureActive, closeFixtureDoc, makeFixtureDoc } from "./fixture-doc.js";

interface Bounds {
  docName: string; page: string; spread: boolean;
  widthPt: number; heightPt: number; longEdgePt: number; pagesInSpread: number;
}
interface Export { docName: string; path: string; bytes: number; dpi: number; strays: number; }

const ДЕВ_ЯТЬ = [
  "exportResolution", "pngQuality", "pngColorSpace", "transparentBackground",
  "antiAlias", "useDocumentBleeds", "exportingSpread", "pageString", "pngExportRange",
] as const;

/** Знімок налаштувань застосунку — щоб довести, що інструмент їх не з'їв. */
async function знімокНалаштувань(): Promise<Record<string, string>> {
  const тіло = ДЕВ_ЯТЬ.map((n) => `out["${n}"] = String(p.${n});`).join("\n");
  return runJsx<Record<string, string>>("run_script", {
    script: `var p = app.pngExportPreferences; var out = {}; ${тіло} __result = out;`,
    undoName: "Знімок налаштувань експорту",
  });
}

/*
 * ВИМІРЯНО: InDesign PNG-кодер може дати ОДНАКОВУ довжину файла для
 * ДІЙСНО РІЗНОГО вмісту — перевірено двічі (плашка на розвороті з
 * поверненою рамкою: 4929 = 4929 і 12442 = 12442 байт при різних
 * пікселях; недрукований/друкований шар: 7869 = 7869 при 88186
 * відмінних пікселях зі 484704). Порівняння `bytes` — довжини — тому
 * НЕНАДІЙНЕ як доказ вмісту: воно може дати хибний негатив на
 * справному коді. Порівнюємо повний вміст файла (усі байти, не лише
 * довжину) — це і є «звірка вмістом», обіцяна в назві тестів нижче.
 */
async function вмістОднаковий(a: string, b: string): Promise<boolean> {
  const [ba, bb] = await Promise.all([readFile(a), readFile(b)]);
  return ba.equals(bb);
}

let docName: string;
const створені: string[] = [];

describe("page_render наскрізно", () => {
  beforeAll(async () => {
    docName = await makeFixtureDoc();
    await assertFixtureActive(docName);
  });

  afterAll(async () => {
    for (const p of створені) await rm(p, { force: true });
    if (docName) await closeFixtureDoc(docName);
  });

  it("РІВНО ОДИН файл — негативний контроль до EXPORT_RANGE", async () => {
    const b = await runJsx<Bounds>("render_bounds", { page: "1", spread: false });
    const path = join(tmpdir(), "render-one-file-probe.png");
    const out = await runJsx<Export>("render_export", {
      page: b.page, spread: false, dpi: 72, bleed: false, path,
    });
    створені.push(path);
    /* Саме це падає, якщо прибрати pngExportRange = EXPORT_RANGE. */
    expect(out.strays).toBe(0);
    const поруч = (await readdir(tmpdir())).filter((n) =>
      n.startsWith("render-one-file-probe") && n.endsWith(".png"));
    expect(поруч).toEqual(["render-one-file-probe.png"]);
  });

  it("розворот ширший за сторінку рівно на СВОЮ кількість сторінок", async () => {
    /* Фікстура `__fixture_make` — 2-сторінковий facing-pages документ, а
     * в такому кожен розворот містить рівно ОДНУ сторінку (виміряно: page
     * "2" spread=true дає pagesInSpread=1 так само, як spread=false). Тест
     * на meaning «розворот ширший за сторінку» був би порожнім без
     * розвороту з двома сторінками — тож додаємо третю сторінку тут-таки,
     * у самому тесті, а не в спільній фікстурі (яку іншим тестам чіпати
     * не можна). Після додавання сторінка 2 і нова сторінка 3 утворюють
     * один розворот з pagesInSpread=2.
     */
    await runJsx("run_script", {
      script: "app.activeDocument.pages.add(); __result = true;",
      undoName: "Третя сторінка для тесту розвороту",
    });

    const сторінка = await runJsx<Bounds>("render_bounds", { page: "2", spread: false });
    const розворот = await runJsx<Bounds>("render_bounds", { page: "2", spread: true });
    /* Очікування виводиться з документа: розворот може мати 1, 2 або 3
     * сторінки, і «вдвічі» — припущення про конкретну фікстуру. */
    expect(розворот.pagesInSpread).toBeGreaterThan(1);
    expect(розворот.widthPt).toBeCloseTo(сторінка.widthPt * розворот.pagesInSpread, 1);
    expect(розворот.heightPt).toBeCloseTo(сторінка.heightPt, 1);
    expect(розворот.longEdgePt).toBe(розворот.widthPt);
  });

  it("довга сторона сторінки — це висота, і вона в ПУНКТАХ, не в піках", async () => {
    const b = await runJsx<Bounds>("render_bounds", { page: "1", spread: false });
    /* Піки дали б число близько 40×57 — на два порядки менше. */
    expect(b.heightPt).toBeGreaterThan(200);
    expect(b.longEdgePt).toBe(Math.max(b.widthPt, b.heightPt));
  });

  it("неіснуюча сторінка — зрозуміла помилка, а не порожній файл", async () => {
    await expect(
      runJsx<Bounds>("render_bounds", { page: "НЕМАЄ-ТАКОЇ", spread: false }),
    ).rejects.toThrow(/no page/);
  });

  it("expectedDocName боронить від рендера не того документа", async () => {
    await expect(
      runJsx<Bounds>("render_bounds", { page: "1", spread: false, expectedDocName: "Чужий.indd" }),
    ).rejects.toThrow(/meant for/);
  });

  it("обрана сторінка — САМЕ ТА (звірка вмістом, не байтами наосліп)", async () => {
    /* Кладемо велику чорну плашку ТІЛЬКИ на сторінку 2. Рендер сторінки 2
     * мусить стати помітно важчим, а рендер сторінки 1 — не змінитись.
     * Без цього тесту page_render міг би віддавати завжди першу сторінку.
     *
     * Порівнюємо ПОВНИЙ вміст файлів, не лише .bytes (довжину) — див.
     * вмістОднаковий вище й коментар при ній. */
    const до1 = join(tmpdir(), "render-pick-p1-before.png");
    const до2 = join(tmpdir(), "render-pick-p2-before.png");
    const по1 = join(tmpdir(), "render-pick-p1-after.png");
    const по2 = join(tmpdir(), "render-pick-p2-after.png");
    створені.push(до1, до2, по1, по2);

    await runJsx<Export>("render_export",
      { page: "1", spread: false, dpi: 72, bleed: false, path: до1 });
    await runJsx<Export>("render_export",
      { page: "2", spread: false, dpi: 72, bleed: false, path: до2 });

    await runJsx("run_script", {
      script:
        'var d = app.activeDocument;' +
        'var r = d.pages[1].rectangles.add();' +
        'r.geometricBounds = ["5mm","5mm","150mm","110mm"];' +
        'r.fillColor = d.swatches.item("Black"); r.strokeWeight = 0;' +
        '__result = { id: r.id };',
      undoName: "Плашка для перевірки вибору сторінки",
    });

    await runJsx<Export>("render_export",
      { page: "1", spread: false, dpi: 72, bleed: false, path: по1 });
    await runJsx<Export>("render_export",
      { page: "2", spread: false, dpi: 72, bleed: false, path: по2 });

    expect(await вмістОднаковий(до1, по1)).toBe(true);   // сторінка 1 не змінилась
    expect(await вмістОднаковий(до2, по2)).toBe(false);  // сторінка 2 змінилась
  });

  it("недрукований шар НЕ потрапляє, друкований потрапляє — ОБИДВІ половини", async () => {
    /* Без другої половини тест проходить і на зламаному коді: «не видно»
     * може означати «не намальовано взагалі». Порівнюємо ПОВНИЙ вміст
     * файлів — див. коментар при вмістОднаковий. */
    const прихованийШлях = join(tmpdir(), "render-layer-probe-hidden.png");
    const видимийШлях = join(tmpdir(), "render-layer-probe-visible.png");
    створені.push(прихованийШлях, видимийШлях);

    await runJsx("run_script", {
      script:
        'var d = app.activeDocument;' +
        'var L = d.layers.add({ name: "_render_probe", printable: false });' +
        'var r = d.pages[0].rectangles.add({ itemLayer: L });' +
        'r.geometricBounds = ["5mm","5mm","120mm","100mm"];' +
        'r.fillColor = d.swatches.item("Black"); r.strokeWeight = 0;' +
        '__result = { layer: L.name };',
      undoName: "Недрукований шар для перевірки",
    });
    await runJsx<Export>("render_export",
      { page: "1", spread: false, dpi: 72, bleed: false, path: прихованийШлях });

    await runJsx("run_script", {
      script:
        'app.activeDocument.layers.itemByName("_render_probe").printable = true;' +
        '__result = true;',
      undoName: "Увімкнути друк шару",
    });
    await runJsx<Export>("render_export",
      { page: "1", spread: false, dpi: 72, bleed: false, path: видимийШлях });

    expect(await вмістОднаковий(прихованийШлях, видимийШлях)).toBe(false);
  });

  it("НАЛАШТУВАННЯ КОРИСТУВАЧА повернуто — усі дев'ять", async () => {
    const до = await знімокНалаштувань();
    const b = await runJsx<Bounds>("render_bounds", { page: "1", spread: false });
    const path = join(tmpdir(), "render-prefs-probe.png");
    await runJsx<Export>("render_export", {
      page: b.page, spread: true, dpi: 96, bleed: true, path,
    });
    створені.push(path);
    expect(await знімокНалаштувань()).toEqual(до);
  });

  it("налаштування повернуто ПІСЛЯ ВИНЯТКУ — без цього finally не доведений", async () => {
    const до = await знімокНалаштувань();
    await expect(
      runJsx<Export>("render_export", {
        page: "1", spread: false, dpi: 96, bleed: false,
        path: "/шлях/якого/немає/render.png",
      }),
    ).rejects.toThrow();
    expect(await знімокНалаштувань()).toEqual(до);
  });
});

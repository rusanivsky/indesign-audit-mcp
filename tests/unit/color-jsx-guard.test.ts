import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { jsxModules } from "../../src/bridge/runner.js";

const RAW = readFileSync("src/jsx/color.jsx", "utf8");
const TYPES = readFileSync("src/color/types.ts", "utf8");

/*
 * Ґард дивиться на КОД, не на коментарі: у цьому файлі коментарі згадують і
 * `layer: "?"`, і ShadowMode.NONE — саме щоб пояснити, чому вони стоять там,
 * де стоять. Ґард, що не відрізняє код від тексту про код, карав би за
 * документування (та сама вимога, що в preflight-jsx-guard).
 */
const SRC = RAW.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

/** Назви в лапках із блоку тексту — і тип, і перелік записані однаково. */
function quoted(block: string): string[] {
  const names: string[] = [];
  const re = /"([a-zA-Z]+)"/g;
  let m = re.exec(block);
  while (m !== null) {
    names.push(m[1]!);
    m = re.exec(block);
  }
  return names;
}

/** Поверхні з типу `Surface` — джерело правди для приладу. */
function declaredSurfaces(): string[] {
  const block = /export type Surface =([\s\S]*?);/.exec(TYPES);
  expect(block, "тип Surface зник із src/color/types.ts").not.toBeNull();
  return quoted(block![1]!);
}

/** Поверхні, перелічені в IDMCP.COLOR_SURFACES. */
function jsxSurfaces(): string[] {
  const block = /IDMCP\.COLOR_SURFACES\s*=\s*\[([\s\S]*?)\];/.exec(SRC);
  expect(block, "IDMCP.COLOR_SURFACES зник із src/jsx/color.jsx").not.toBeNull();
  return quoted(block![1]!);
}

describe("color.jsx", () => {
  it("модуль зареєстровано, інакше обробник не існує в рантаймі", () => {
    expect(jsxModules({})).toContain("color.jsx");
  });

  /*
   * Лінивий лічильник не вміє сказати «нема»: поверхня, якої обхідник не
   * торкнувся, просто відсутня у відповіді. Перелік мусить бути ПОВНИЙ і
   * мусить збігатися з типом, інакше додана в TypeScript поверхня мовчки
   * зникне з counters — рівно те, що сталося з tableStroke.
   */
  it("перелік поверхонь приладу збігається з типом Surface — усі дванадцять", () => {
    expect(jsxSurfaces().slice().sort()).toEqual(declaredSurfaces().slice().sort());
  });

  it("tableStroke стоїть у переліку, хоч його ніхто не виробляє — чесний нуль", () => {
    /* Обведень таблиць прилад НЕ читає (визнана межа, спек §3.2 п.7). Тому
     * поверхня мусить дійти до відповіді з seen: 0, а не зникнути з неї. */
    expect(jsxSurfaces()).toContain("tableStroke");
    expect(SRC).not.toMatch(/surface:\s*"tableStroke"/);
  });

  it("лічильники заводяться на початку обходу, а не при першому дотику", () => {
    expect(SRC).toMatch(/IDMCP\.colorInitCounters\(out\);/);
    expect(SRC).toMatch(/seen:\s*0,\s*parsed:\s*0,\s*failed:\s*0/);
  });

  it("effect.seen підіймається ПЕРЕД перевіркою на ShadowMode.NONE", () => {
    /* Інакше seen рахує лише справжні тіні, а невдале читання дає failed без
     * seen — стан, невидимий для unreadSurfaces. */
    const seenAt = SRC.indexOf('IDMCP.colorCounter(out, "effect", "seen")');
    const modeAt = SRC.indexOf("ShadowMode.NONE");
    expect(seenAt).toBeGreaterThan(-1);
    expect(modeAt).toBeGreaterThan(-1);
    expect(seenAt).toBeLessThan(modeAt);
  });

  it("носій без тіні рахується прочитаним, інакше кожен документ звітує сліпоту", () => {
    expect(SRC).toMatch(
      /ShadowMode\.NONE\)\s*\{\s*IDMCP\.colorCounter\(out,\s*"effect",\s*"parsed"\);/,
    );
  });

  it("failed ніде не підіймається раніше за seen на тій самій поверхні", () => {
    for (const surface of ["underline", "strikeThrough", "paragraphRule", "effect"]) {
      const seen = SRC.indexOf(`IDMCP.colorCounter(out, "${surface}", "seen")`);
      const failed = SRC.indexOf(`IDMCP.colorCounter(out, "${surface}", "failed")`);
      expect(seen, `${surface}: seen зник`).toBeGreaterThan(-1);
      expect(failed, `${surface}: failed зник`).toBeGreaterThan(-1);
      expect(seen, `${surface}: failed стоїть перед seen`).toBeLessThan(failed);
    }
  });

  it("комірка таблиці бере шар із рамки, а не з жорсткого «?»", () => {
    /* Вирок ширший за друковане: таблиця на службовому шарі судилася б як
     * друкована й не потрапила б навіть у sitesSkippedNonPrinting. */
    const cell = /surface:\s*"tableCell"[\s\S]{0,700}?\}\);/.exec(SRC);
    expect(cell, "кортеж комірки таблиці зник").not.toBeNull();
    expect(cell![0]).toMatch(/layer:\s*tHost\.layer/);
    expect(cell![0]).toMatch(/printable:\s*tHost\.printable/);
    expect(cell![0]).toMatch(/visible:\s*tHost\.visible/);
    expect(cell![0]).not.toMatch(/layer:\s*"\?"/);
  });

  it("жодна текстова поверхня не будує носія власними руками — лише colorHostOf", () => {
    /* Четверта копія цього коду й розійшлася б четвертою — комірка таблиці
     * саме нею й була. Носія збирає РІВНО ОДНЕ місце (colorHostOf), і три
     * поверхні його викликають: текстовий діапазон, лінійка абзацу, комірка. */
    expect(SRC.match(/printable:\s*l\.printable/g) ?? []).toHaveLength(1);
    expect(SRC.match(/IDMCP\.colorHostOf\(/g) ?? []).toHaveLength(3);
  });
});

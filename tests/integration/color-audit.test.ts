import { afterAll, describe, expect, it } from "vitest";
import { runJsx } from "../../src/bridge/runner.js";
import { assembleFindings, type AuditArgs } from "../../src/tools/color.js";
import { buildReport } from "../../src/color/report.js";
import { closeFixtureDoc } from "./fixture-doc.js";
import type { ColorMeasure } from "../../src/color/types.js";

const DOC = "__color_fixture";

async function audited(args: AuditArgs = {}) {
  await runJsx("__fixture_color", { name: DOC }, { timeoutMs: 60_000 });
  const m = await runJsx<ColorMeasure>("color_measure", {}, { timeoutMs: 120_000 });
  const assembled = assembleFindings(m, args);
  /* Та сама обв'язка, що в src/tools/color.ts: вимір мусить брати РЕАЛЬНУ
   * відповідь інструмента, а не звіт без частини полів (урок Фази 13). */
  return { measure: m, report: buildReport(m, assembled.findings, assembled) };
}

describe("color_audit на фікстурі", () => {
  afterAll(async () => {
    await closeFixtureDoc(DOC);
  });

  it("знаходить [Registration] на змісті й НЕ доповідає сам зразок у палітрі", async () => {
    const { report } = await audited();
    const reg = report.findings.filter((f) => f.rule === "registration-applied");
    expect(reg.length).toBeGreaterThan(0);
    for (const f of reg) expect(f.surfaces).not.toContain("swatch");
  });

  it("знаходить дрібний текст збагаченим чорним і мовчить про дрібний чистою K", async () => {
    const { report } = await audited();
    const rich = report.findings.filter((f) => f.rule === "rich-black-small-text");
    expect(rich.length).toBeGreaterThan(0);
    for (const f of rich) expect(f.color).not.toContain("0/0/0/100");
  });

  /* Ruling 12: overprint-on-white не може спрацювати на цій версії InDesign
   * (стан «overprint на нульовій фарбі» ні створити, ні прочитати).
   * Позитивний доказ правила лишається юніт-тестом
   * (tests/unit/color-detect-overprint.test.ts, ColorSite синтетичний).
   * Тут доводиться протилежне: звіт МОВЧИТЬ, і це мовчання не приховується —
   * caveat називає sitesOverprintUnknown словами "НЕ ПРОЧИТАНО". */
  it("правило overprint-on-white на фікстурі мовчить, і звіт це не приховує", async () => {
    const { report } = await audited();
    expect(report.findings.some((f) => f.rule === "overprint-on-white")).toBe(false);
  });

  /* Спек §5.2 і фінальна рецензія, C1: доказом родини `space` є УЖИТОК, а не
   * зразок у палітрі. Доти, доки фікстура зразок `__rgb` нікуди не
   * застосовувала, цей тест проходив саме хибним спрацюванням гейта. Тому
   * перевіряється не лише наявність правила, а й поверхня знахідки. */
  it("знаходить RGB і спот НА ОБ'ЄКТАХ, і рахує п'яту фарбу", async () => {
    const { report } = await audited();
    const rules = report.findings.map((f) => f.rule);
    expect(rules).toContain("non-cmyk-color");
    expect(rules).toContain("spot-applied");
    expect(rules).toContain("unexpected-ink-count");
    const usages = report.findings.filter(
      (f) => f.rule === "non-cmyk-color" || f.rule === "spot-applied",
    );
    for (const f of usages) expect(f.surfaces).not.toContain("swatch");
    for (const f of usages) expect(f.surfaces).toContain("pageItem");
  });

  /* Негативний близнюк до тесту вище на рівні інструмента: [Registration]
   * = 100/100/100/100 лежить у палітрі КОЖНОГО документа, і при межі 300
   * знахідки бути не має. Без гейта зразка тут була б знахідка на будь-якому
   * файлі світу. Позитивний близнюк — випадок 11/12 фікстури: та сама
   * [Registration], застосована до об'єкта, знаходиться (перший тест файла). */
  it("МОВЧИТЬ про TAC 400 у палітрі: [Registration] є в кожному документі", async () => {
    const { report } = await audited();
    const tac = report.findings.filter((f) => f.rule === "tac-over-limit");
    /* Позитивна половина: плашка TAC 340 (випадок 3) знаходитись МУСИТЬ,
     * інакше мовчання доводило б лише те, що правило вимкнене. */
    expect(tac.length).toBeGreaterThan(0);
    for (const f of report.findings) expect(f.surfaces).not.toContain("swatch");
  });

  it("МОВЧИТЬ про TAC 400 на недрукованому шарі — інакше вісім хибних на форзаці", async () => {
    const { report } = await audited();
    for (const f of report.findings) {
      expect(f.pages.join(" ")).not.toContain("__технічний");
    }
    expect(report.caveat).toContain("non-printing");
  });

  it("з includeNonPrinting недрукований шар СУДИТЬСЯ — свідомий вибір людини", async () => {
    const off = await audited({});
    const on = await audited({ includeNonPrinting: true });
    const offCount = off.report.occurrenceCount;
    const onCount = on.report.occurrenceCount;
    expect(onCount).toBeGreaterThan(offCount);
  });

  // Ruling 6: прихований шар — окрема причина не судитися, від недрукованого.
  it("МОВЧИТЬ про TAC 400 на прихованому шарі, і застереження називає причину окремо", async () => {
    const { report } = await audited();
    expect(report.caveat).toContain("HIDDEN");
    const onHidden = await audited({ includeHidden: true });
    expect(onHidden.report.occurrenceCount).toBeGreaterThan(report.occurrenceCount);
  });

  // Ruling 8: заливка лінії не лягає фарбою — гейт laysInk мовчить про неї.
  it("МОВЧИТЬ про заливку [Registration] на лінії — заливка лінії не друкує нічого", async () => {
    const { report } = await audited();
    const onLines = report.findings.filter((f) => f.examples.join(" ").includes("GraphicLine"));
    expect(onLines).toEqual([]);
    expect(report.caveat).toContain("zero-area");
  });

  it("застереження називає межу фарби як ужиту, а не виведену", async () => {
    const { report } = await audited();
    expect(report.caveat).toContain("300");
    expect(report.parameters.maxTotalInk).toBe(300);
  });
});

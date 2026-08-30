import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runJsx } from "../../src/bridge/runner.js";
import { buildReport } from "../../src/preflight/summarise.js";
import type { PreflightMeasure } from "../../src/preflight/types.js";
import { assertFixtureActive, closeFixtureDoc } from "./fixture-doc.js";

/** Стільки ж, скільки передає сам інструмент (див. `src/tools/preflight.ts`). */
const WAIT_SECONDS = 165;

interface Signature {
  pageCount: number;
  storyCount: number;
  frameCount: number;
  frames: Array<{ id: string; label: string }>;
  paragraphs: Array<{ styleName: string; contents: string }>;
}

describe("preflight_measure на власній фікстурі", () => {
  let docName: string;
  let m: PreflightMeasure;
  let processesBefore: number;
  let signatureBefore: Signature;

  beforeAll(async () => {
    const made = await runJsx<{ docName: string }>("__fixture_make_preflight", {}, {
      timeoutMs: 180_000,
    });
    docName = made.docName;
    await assertFixtureActive(docName);
    signatureBefore = await runJsx<Signature>("__fixture_signature", {});
    processesBefore = await runJsx<number>("__fixture_preflight_process_count", {});
    m = await runJsx<PreflightMeasure>("preflight_measure", { waitSeconds: WAIT_SECONDS }, {
      timeoutMs: 180_000,
    });
  }, 300_000);

  afterAll(async () => {
    if (docName) await closeFixtureDoc(docName);
  });

  it("міряє саме фікстуру, а не чужий документ", () => {
    /* Назва береться з ПЕРШОГО елемента aggregatedResults, тобто з відповіді
     * самого preflight, — а не з doc.name, який ми й так знали. */
    expect(m.docName).toBe(docName);
  });

  it("форму aggregatedResults впізнано, і рядки розібрано ВСІ", () => {
    /* Саме цей вимір неможливо зробити на чистому документі: там список
     * рядків порожній і глибин не видно. */
    expect(m.shapeRecognised).toBe(true);
    expect(m.rowsSeen).toBeGreaterThan(0);
    expect(m.rowsParsed).toBe(m.rowsSeen);
    expect(m.pairsParsed).toBe(m.pairsSeen);
  });

  it("рядки приходять деревом, сплющеним у список: перша колонка — глибина", () => {
    const depths = m.rows.map((r) => r[0]);
    expect(depths).toContain(1);
    expect(depths).toContain(2);
    expect(depths).toContain(3);
  });

  it("свідомий overset знайдено, зі сторінкою і текстом Problem/Fix від застосунку", () => {
    const rep = buildReport(m);
    const overset = rep.findings.find((f) => /overset/i.test(f.rule));
    expect(overset, `правила overset немає серед: ${rep.findings.map((f) => f.rule).join(", ")}`).toBeDefined();
    const occ = overset!.occurrences[0]!;
    expect(occ.page).toBe("1");
    expect(occ.details.map((d) => d.key)).toContain("Problem");
    expect(occ.details.find((d) => d.key === "Problem")!.value).toMatch(/overset/i);
  });

  it("вміщений текст на другій сторінці порушенням НЕ став", () => {
    const rep = buildReport(m);
    expect(rep.findings.flatMap((f) => f.occurrences).map((o) => o.page)).not.toContain("2");
  });

  it("правило overset справді увімкнене — інакше сам цей тест нічого не доводив би", () => {
    const rep = buildReport(m);
    expect(rep.enabledRuleIds).toContain("ADBE_OversetText");
    expect(rep.rulesEnabled + rep.rulesDisabled).toBe(m.rules.length);
  });

  it("очікування завершилось: waitTimedOut === false", () => {
    /* Полярність зворотна до назви — виміряно контролем на одному процесі:
     * waitForProcess(0) → true й недоступні результати, waitForProcess(60) →
     * false й повні. */
    expect(m.waitTimedOut).toBe(false);
  });

  it("поле waitPolarity доїжджає у вимір і на живому прогоні порожнє", () => {
    /*
     * ЩО ЦЕЙ РЯДОК ДОВОДИТЬ, А ЩО НІ — названо вголос, бо перша його редакція
     * обіцяла більше, ніж робить.
     *
     * НЕ доводить, що InDesign віддав справжнє булеве: це строгіше доводить
     * `waitTimedOut === false` вище. `false` не може виникнути з неполярного
     * значення — обробник перетворює його на `true`.
     *
     * І НЕ ДОВОДИТЬ, ЩО ГІЛКА СИГНАЛУ 3 ЖИВА. Попередня редакція цього
     * коментаря обіцяла, що з видаленою гілкою сусідній рядок почервоніє —
     * переогляд прогнав мутанта й показав, що зелені ОБИДВА. Так і має бути:
     * поки `waitForProcess` віддає справжнє `false`, гілка не виконується
     * взагалі, тож її видалення тут нічого не змінює. Живою її тримають
     * юніт-тести з підставним `app`, а не цей файл.
     *
     * Доводить він інше, і теж потрібне: що поле ФІЗИЧНО долітає з ExtendScript
     * до типізованого виміру, а не гине по дорозі. Це єдине місце, де воно
     * проходить справжній серіалізатор і справжній міст, а не підставний `app`.
     */
    expect(m.waitPolarity).toBe(null);
  });

  it("процес прибрано за собою — і це видно ззовні, а не лише з власного поля", async () => {
    expect(m.processRemoved).toBe(true);
    const after = await runJsx<number>("__fixture_preflight_process_count", {});
    expect(after).toBe(processesBefore);
  });

  it("незавершений preflight КИДАЄ помилку з поясненням, а не віддає порожній звіт", async () => {
    /*
     * Нульове очікування — єдиний спосіб відтворити таймаут за секунди.
     * Виміряно: aggregatedResults у цьому стані не віддає порожнечу, а кидає
     * «Aggregated Result for this process is not available». Без перекладу це
     * повідомлення про таймаут не каже нічого.
     */
    await expect(
      runJsx<PreflightMeasure>("preflight_measure", { waitSeconds: 0.001 }, { timeoutMs: 180_000 }),
    ).rejects.toThrow(/did not finish|not respond/);
  });

  it("неназваний профіль — ГУЧНА відмова з переліком доступних", async () => {
    await expect(
      runJsx<PreflightMeasure>(
        "preflight_measure",
        { profileName: "profiliu-z-takoiu-nazvoiu-nemaie", waitSeconds: WAIT_SECONDS },
        { timeoutMs: 180_000 },
      ),
    ).rejects.toThrow(/Available:/);
  });

  it("профіль у КВАДРАТНИХ ДУЖКАХ знаходиться — перебором, бо itemByName його не бачить", async () => {
    const byName = await runJsx<PreflightMeasure>(
      "preflight_measure",
      { profileName: "[Basic]", waitSeconds: WAIT_SECONDS },
      { timeoutMs: 180_000 },
    );
    expect(byName.profileName).toBe("[Basic]");
  });

  it("документ НЕ змінився: сигнатура до й після збігається", async () => {
    const after = await runJsx<Signature>("__fixture_signature", {});
    expect(after).toEqual(signatureBefore);
  });
});

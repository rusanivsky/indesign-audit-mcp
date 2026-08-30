import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runJsx } from "../../src/bridge/runner.js";
import { registerCompositionTools } from "../../src/tools/composition.js";
import type { Tools } from "../../src/tools/shared.js";
import { assertFixtureActive, closeFixtureDoc } from "./fixture-doc.js";

/*
 * УВАГА ЩОДО БЕЗПЕКИ — той самий режим, що в corrections.test.ts, і з тієї
 * самої причини: у користувача в тому самому InDesign відкритий РЕАЛЬНИЙ макет
 * книжки на 196 сторінок. Тому:
 *   - фікстура створюється лише через __fixture_make_composition і закривається
 *     через closeFixtureDoc(docName), який закриває документ ВИКЛЮЧНО за
 *     точною назвою; жодного «закрити активний» чи «закрити всі»;
 *   - перед КОЖНОЮ перевіркою, що спирається на активний документ, стоїть
 *     assertFixtureActive — якщо фокус переїхав на чужий документ, тест падає,
 *     а не «обходить проблему»;
 *   - у КОЖНОМУ виклику apply_edits передається expectedDocName фікстури:
 *     обробник відмовляється писати в чужий документ ДО створення копії й до
 *     будь-якого запису;
 *   - composition_apply бере expectedDocName із власного виміру, тож і він
 *     прив'язаний до того самого документа. Саме тому у виклики
 *     composition_audit / composition_apply його НЕ передають: їхні Zod-схеми
 *     такого поля не оголошують, і воно там нічого не робить. Раніше воно в цих
 *     трьох викликах стояло — і виглядало запобіжником, якого немає. Борг
 *     закрито 2026-08-05; саме через цю оману пропущені колись assertFixtureActive
 *     здалися безпечнішими, ніж були. Якщо колись схочете передати його сюди,
 *     спершу додайте поле в схему, інакше воно знову буде декорацією;
 *   - afterEach закриває фікстуру навіть після падіння тесту.
 */

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
type AnyHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

function toolHandler(name: string): AnyHandler {
  let captured: AnyHandler | null = null;
  const fakeServer = {
    registerTool: (n: string, _c: unknown, handler: AnyHandler) => {
      if (n === name) captured = handler;
    },
  } as unknown as Tools;
  registerCompositionTools(fakeServer);
  if (captured === null) throw new Error(`${name} не зареєстровано`);
  return captured;
}

const body = (r: ToolResult) => JSON.parse(r.content[0]!.text);

/** Замовчування zod підробленим сервером не застосовуються — задаємо явно. */
const DETECTION = {
  spacingMode: "survey" as const,
  warnBandPct: 0,
  shortLastLineFraction: 0.15,
  minWordChars: 4,
  maxLadder: 3,
  riverMinRows: 3,
  riverTolerancePt: 1.5,
  riverMinChannelPt: 0,
  riverJustifiedOnly: false,
  includeMasters: false,
  pageWindow: 20,
  undoName: "Тест композиції",
  maxTracking: 20,
  dryRun: false,
};

interface TrackingReport {
  backupPath: string;
  applied: { requestId: string }[];
  trackingApplied: { containerId: string; paragraphIndex: number; delta: number; trackingAfter: number }[];
  trackingFailed: { containerId: string; paragraphIndex: number; reason: string }[];
}

let docName: string | undefined;
let dir: string;

async function trackingOf(containerId: string, paragraphIndex: number): Promise<number | null> {
  const r = await runJsx<{ tracking: number | null }>("__debug_paragraph_tracking", {
    name: docName,
    containerId,
    paragraphIndex,
  });
  return r.tracking;
}

async function applyEdits(params: Record<string, unknown>): Promise<TrackingReport> {
  await assertFixtureActive(docName!);
  return runJsx<TrackingReport>("apply_edits", {
    expectedDocName: docName,
    stamp: "2026-08-04-1200",
    undoName: "Тест",
    edits: [],
    ...params,
  });
}

beforeEach(async () => {
  docName = undefined;
  dir = await mkdtemp(join(tmpdir(), "idmcp-comp-"));
  docName = await runJsx<string>("__fixture_make_composition", { dir });
});

afterEach(async () => {
  if (docName) await closeFixtureDoc(docName);
  await rm(dir, { recursive: true, force: true });
});

describe("apply_edits із трекінгом", () => {
  it("змінює трекінг абзацу, звітує про це й лишає копію документа", async () => {
    expect(await trackingOf("story:1", 4)).toBe(0);

    const report = await applyEdits({
      undoName: "Тест трекінгу",
      tracking: [{ containerId: "story:1", paragraphIndex: 4, delta: 20 }],
    });

    expect(report.trackingApplied).toHaveLength(1);
    expect(report.trackingApplied[0]!.delta).toBe(20);
    expect(report.trackingApplied[0]!.trackingAfter).toBe(20);
    expect(report.trackingFailed).toEqual([]);
    expect(report.backupPath.length).toBeGreaterThan(0);

    /* Головне: трекінг ліг у ДОКУМЕНТ, а не лише у звіт. */
    await assertFixtureActive(docName!);
    expect(await trackingOf("story:1", 4)).toBe(20);
  });

  it("дельта ДОДАЄТЬСЯ, а не заміщає — саме тому дедуплікація обов'язкова", async () => {
    await applyEdits({ tracking: [{ containerId: "story:1", paragraphIndex: 4, delta: 20 }] });
    await applyEdits({
      stamp: "2026-08-04-1201",
      tracking: [{ containerId: "story:1", paragraphIndex: 4, delta: 20 }],
    });
    await assertFixtureActive(docName!);
    expect(await trackingOf("story:1", 4)).toBe(40);
  });

  it("неіснуючий абзац потрапляє у trackingFailed, а не валить пачку", async () => {
    const report = await applyEdits({
      undoName: "Тест невдалого трекінгу",
      tracking: [
        { containerId: "story:1", paragraphIndex: 9999, delta: 5 },
        { containerId: "story:1", paragraphIndex: 4, delta: 7 },
      ],
    });

    expect(report.trackingFailed).toHaveLength(1);
    expect(report.trackingFailed[0]!.paragraphIndex).toBe(9999);
    /* Решта пачки лягла: одна невдача не скасовує сусідніх правок. */
    expect(report.trackingApplied).toHaveLength(1);
    expect(report.backupPath.length).toBeGreaterThan(0);
    await assertFixtureActive(docName!);
    expect(await trackingOf("story:1", 4)).toBe(7);
  });

  it("нечислова дельта відхиляється, а не додається мовчки", async () => {
    const report = await applyEdits({
      tracking: [{ containerId: "story:1", paragraphIndex: 4, delta: "багато" }],
    });
    expect(report.trackingApplied).toEqual([]);
    expect(report.trackingFailed).toHaveLength(1);
    expect(report.trackingFailed[0]!.reason).toContain("must be a number");
    await assertFixtureActive(docName!);
    expect(await trackingOf("story:1", 4)).toBe(0);
  });

  it("без поля tracking поведінка не змінюється — зворотна сумісність", async () => {
    const report = await applyEdits({});
    expect(report.trackingApplied).toEqual([]);
    expect(report.trackingFailed).toEqual([]);
    expect(report.backupPath.length).toBeGreaterThan(0);
  });

  it("текст і трекінг — ОДИН крок історії: одне Cmd+Z відкочує обидва", async () => {
    const containers = await runJsx<{ containers: { containerId: string; text: string }[] }>(
      "containers_read",
      {},
    );
    const story0 = containers.containers.find((c) => c.containerId === "story:0")!;
    const start = story0.text.indexOf("Considerable");
    expect(start).toBe(0);

    const report = await applyEdits({
      undoName: "Пачка з текстом і трекінгом",
      edits: [
        {
          requestId: "r1",
          candidateId: "c1",
          containerId: "story:0",
          start: 0,
          end: "Considerable".length,
          expectedOld: "Considerable",
          newText: "Znachnyi",
          action: "replace",
        },
      ],
      tracking: [{ containerId: "story:1", paragraphIndex: 4, delta: 20 }],
    });
    expect(report.applied).toHaveLength(1);
    expect(report.trackingApplied).toHaveLength(1);
    await assertFixtureActive(docName!);
    expect(await trackingOf("story:1", 4)).toBe(20);

    await runJsx("__undo_once", { name: docName });

    await assertFixtureActive(docName!);
    const after = await runJsx<{ containers: { containerId: string; text: string }[] }>(
      "containers_read",
      {},
    );
    expect(after.containers.find((c) => c.containerId === "story:0")!.text).toContain("Considerable");
    expect(await trackingOf("story:1", 4)).toBe(0);
  });
});

describe("composition_apply — перемір після запису", () => {
  /*
   * ГОЛОВНИЙ ТЕСТ ЗАДАЧІ. Слово «international» розірване композитором; список
   * заборонених до переносу слів робить із цього знахідку `hyphen-forbidden`,
   * і виправлення ставить U+00AD перед уламком. Виміряно на живому InDesign
   * (див. коментар до SOFT_HYPHEN у propose.ts): слово переходить цілим, а на
   * НАСТУПНОМУ рядку з'являється перенос, якого до запису не було.
   *
   * Тобто `displaced` тут не інсценований завеликим трекінгом, а є справжнім
   * наслідком справжнього виправлення — рівно та константа фази, заради якої
   * перемір і існує.
   */
  it("м'який перенос усуває свою знахідку І породжує нову — resolved разом із displaced", async () => {
    await assertFixtureActive(docName!);
    const r = body(
      await toolHandler("composition_apply")({
        ...DETECTION,
        pages: ["1"],
        forbiddenWords: ["international"],
        findingIds: ["hyphen-forbidden:story:0:0:0"],
        undoName: "Тест м'якого переносу",
      }),
    );

    expect(r.verificationError).toBeNull();
    expect(r.backupPath.length).toBeGreaterThan(0);
    expect(r.write.applied).toHaveLength(1);
    expect(r.write.skipped).toEqual([]);
    expect(r.write.failed).toEqual([]);
    expect(r.unknownFindingIds).toEqual([]);

    const byOutcome = (o: string) =>
      r.verification.filter((v: { outcome: string }) => v.outcome === o);
    expect(byOutcome("resolved").map((v: { findingId: string }) => v.findingId)).toEqual([
      "hyphen-forbidden:story:0:0:0",
    ]);
    /* Дефект переїхав, а не зник із документа — саме це звіт і мусить сказати. */
    expect(byOutcome("displaced").length).toBeGreaterThan(0);
    expect(r.verificationCounts.resolved).toBe(1);
  });

  it("dryRun рахує ту саму пачку й не чіпає документа", async () => {
    await assertFixtureActive(docName!);
    const before = await runJsx<{ containers: { containerId: string; text: string }[] }>(
      "containers_read",
      {},
    );
    const r = body(
      await toolHandler("composition_apply")({
        ...DETECTION,
        dryRun: true,
        pages: ["1"],
        forbiddenWords: ["international"],
        findingIds: ["hyphen-forbidden:story:0:0:0"],
      }),
    );

    expect(r.dryRun).toBe(true);
    expect(r.edits).toHaveLength(1);
    expect(r.edits[0]!.newText).toBe("­internation");

    await assertFixtureActive(docName!);
    const after = await runJsx<{ containers: { containerId: string; text: string }[] }>(
      "containers_read",
      {},
    );
    expect(after.containers.map((c) => c.text)).toEqual(before.containers.map((c) => c.text));
  });

  it("невідомий ідентифікатор не пише нічого й називає причину", async () => {
    await assertFixtureActive(docName!);
    const before = await runJsx<{ containers: { text: string }[] }>("containers_read", {});
    const r = body(
      await toolHandler("composition_apply")({
        ...DETECTION,
        pages: ["1"],
        findingIds: ["loose:story:0:0:0"],
      }),
    );

    expect(r.applied).toBe(0);
    expect(r.unknownFindingIds).toEqual(["loose:story:0:0:0"]);
    await assertFixtureActive(docName!);
    const after = await runJsx<{ containers: { text: string }[] }>("containers_read", {});
    expect(after.containers.map((c) => c.text)).toEqual(before.containers.map((c) => c.text));
  });

  it("відмову трекінгу на рядку з примусовим переносом видно в blocked, а не мовчки", async () => {
    /*
     * Перший рядок story:1 виключений на повну міру U+000A. `proposeFixes`
     * свідомо відмовляє тут у трекінгу — і Задача 14 поміряла, що відмова
     * тримається на «симптом проти причини», а не на механіці (див. propose.ts).
     * Тут перевіряється лише те, що причина ДОХОДИТЬ до звіту.
     */
    await assertFixtureActive(docName!);
    const r = body(
      await toolHandler("composition_apply")({
        ...DETECTION,
        spacingMode: "rank",
        pages: ["1"],
        findingIds: ["loose:story:1:0:0"],
      }),
    );

    expect(r.applied).toBe(0);
    expect(r.blocked).toHaveLength(1);
    expect(r.blocked[0]!.reason).toContain("FORCED LINE BREAK");
  });

  /*
   * ЗАДАЧА 4 ФАЗИ «line-start-dash». Юніт-тести доводять, що предикат і
   * правка правильні на СИНТЕТИЧНИХ вимірах; цей тест доводить те саме на
   * СПРАВЖНЬОМУ композиторі InDesign — що запис U+00A0 замість звичайного
   * пробілу справді змушує перекомпонувати абзац так, що тире більше не
   * починає рядка. Фікстура `f3` дає дванадцять тире у вузькій колонці саме
   * тому, що позицію розриву рядка вирішує композитор, а не тест.
   */
  it("тире на початку рядка: аудит → правка → перемір → повторний аудит чистий", async () => {
    await assertFixtureActive(docName!);

    const audit = body(
      await toolHandler("composition_audit")({
        ...DETECTION,
        pages: ["1"],
      }),
    );

    /* Знахідки лежать по шкалах, а не пласко: плаского списку звіт не віддає. */
    const unranked = audit.findingsByScale.find(
      (g: { scale: string }) => g.scale === "unranked",
    );
    const dashDefect = unranked?.defects.find(
      (d: { defect: string }) => d.defect === "line-start-dash",
    );
    const dashes = dashDefect?.worst ?? [];
    expect(
      dashes.length,
      "фікстура не дала жодного тире на початку рядка — звузьте f3.geometricBounds у _fixtures.jsx",
    ).toBeGreaterThan(0);

    const target = dashes[0]!;
    await assertFixtureActive(docName!);
    const applied = body(
      await toolHandler("composition_apply")({
        ...DETECTION,
        pages: ["1"],
        findingIds: [target.id],
      }),
    );

    expect(applied.verificationError).toBeNull();
    expect(applied.written).toContain(target.id);
    const verdict = applied.verification.find(
      (v: { findingId: string }) => v.findingId === target.id,
    );
    expect(verdict.outcome).toBe("resolved");

    await assertFixtureActive(docName!);
    const again = body(
      await toolHandler("composition_audit")({
        ...DETECTION,
        pages: ["1"],
      }),
    );
    const againDashDefect = again.findingsByScale
      .find((g: { scale: string }) => g.scale === "unranked")
      ?.defects.find((d: { defect: string }) => d.defect === "line-start-dash");
    const stillThere = (againDashDefect?.worst ?? []) as { id: string }[];

    expect(stillThere.map((f) => f.id)).not.toContain(target.id);
    /*
     * Виміряно: фікстура дає 11 знахідок line-start-dash, а `perDefectLimit`
     * за замовчуванням — 5 (composition.ts, схема composition_audit). Тобто
     * «немає в stillThere» вище — перевірка СЛАБША за «немає взагалі»: якщо
     * б обрана знахідка випадково лежала за межею перших п'яти в `worst`,
     * тест пройшов би, навіть не прибравши дефекту. Тому вирішальна перевірка
     * — за `total` класу: він мусить зменшитися РІВНО на одну знахідку.
     */
    expect(againDashDefect?.total ?? 0).toBe((dashDefect.total ?? 0) - 1);
  });
});

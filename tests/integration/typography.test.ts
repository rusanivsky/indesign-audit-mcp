import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runJsx } from "../../src/bridge/runner.js";
import { scanContainers, toEdits } from "../../src/tools/typography.js";
import { QUOTE_RULES, SPACING_RULES } from "../../src/typography/rules-uk.js";
import type { AcceptedEdit, ApplyReport, ContainerSnapshot } from "../../src/corrections/types.js";
import { assertFixtureActive, closeFixtureDoc } from "./fixture-doc.js";

/*
 * I4 (фінальна рецензія): typography_apply (src/tools/typography.ts) не мав
 * ЖОДНОГО живого/інтеграційного покриття. Зокрема, toEdits() ставив
 * action:"replace" навіть для порожньої заміни (spaceBeforeBreak, Task 11,
 * replace: "") — а в apply.jsx "replace" пише через range.contents = newText,
 * тоді як для видалення в решті кодової бази скрізь використовується
 * action:"delete" (range.remove()). Це виправлено в toEdits (m.after === ""
 * тепер дає "delete"), але саме ця комбінація ще ніколи не проганялася проти
 * живого InDesign. Цей файл проганяє РЕАЛЬНІ scanContainers/toEdits/apply_edits
 * проти фікстури — той самий обережний патерн, що й tests/integration/corrections.test.ts:
 * власна фікстура-документ, assertFixtureActive перед кожною перевіркою,
 * закриття фікстури за точною назвою навіть після падіння тесту.
 */

let docName: string | undefined;
let dir: string;

async function readContainers(): Promise<ContainerSnapshot[]> {
  await assertFixtureActive(docName!);
  const r = await runJsx<{ containers: ContainerSnapshot[] }>("containers_read", {});
  return r.containers;
}

async function textOfContainer(predicate: (c: ContainerSnapshot) => boolean): Promise<string> {
  const containers = await readContainers();
  const found = containers.find(predicate);
  expect(found).toBeTruthy();
  return found!.text;
}

async function applyEdits(
  edits: Partial<AcceptedEdit>[],
  opts: { stamp?: string; undoName?: string } = {},
): Promise<ApplyReport> {
  await assertFixtureActive(docName!);
  return runJsx<ApplyReport>("apply_edits", {
    expectedDocName: docName,
    stamp: opts.stamp ?? "test-typo",
    undoName: opts.undoName ?? "Тест типографіки",
    edits,
  });
}

const edit = (o: Partial<AcceptedEdit>): Partial<AcceptedEdit> => ({
  requestId: "r1",
  candidateId: "c1",
  action: "replace",
  ...o,
});

beforeEach(async () => {
  docName = undefined;
  dir = await mkdtemp(join(tmpdir(), "idmcp-doc-"));
  docName = await runJsx<string>("__fixture_make_saved", { dir });
});

afterEach(async () => {
  if (docName) await closeFixtureDoc(docName);
  await rm(dir, { recursive: true, force: true });
});

describe("typography_apply (живий прогін): spaceBeforeBreak → action delete", () => {
  it("прибирає пробіли в кінці контейнера рівно через range.remove(), а не порожній replace", async () => {
    const cell = (await readContainers()).find((c) => c.kind === "table")!;
    expect(cell).toBeTruthy();
    const base = cell.text; // "Yacheika z opecatka vseredyni."

    /*
     * Готуємо сценарій: дописуємо пробіли в самий кінець контейнера. insert
     * не приймає виродженого (нульової довжини) якоря (apply.jsx,
     * validateEdits вимагає end > start для БУДЬ-якої дії) — тож якір тут
     * останній символ базового тексту, а вставка лягає одразу після нього
     * (insertionPoints[e.end], те саме, що й корекційний "insert" усюди
     * в кодовій базі).
     */
    const setup = await applyEdits([
      edit({
        action: "insert",
        containerId: cell.containerId,
        start: base.length - 1,
        end: base.length,
        expectedOld: base.at(-1),
        newText: "   ",
      }),
    ]);
    expect(setup.applied).toHaveLength(1);
    const withTrailingSpaces = await textOfContainer((c) => c.containerId === cell.containerId);
    expect(withTrailingSpaces).toBe(base + "   ");

    /* Тепер справжній typography_apply-шлях: scanContainers → toEdits → apply_edits. */
    const containers = await readContainers();
    const matches = scanContainers(containers, SPACING_RULES).matches;
    const target = matches.filter((m) => m.containerId === cell.containerId && m.after === "");
    expect(target.length).toBeGreaterThan(0);

    const typoEdits = toEdits(target);
    expect(typoEdits).toHaveLength(1);
    expect(typoEdits[0]!.action).toBe("delete");
    expect(typoEdits[0]!.newText).toBe("");

    const report = await applyEdits(typoEdits, { stamp: "test-typo-del" });
    expect(report.applied).toHaveLength(1);
    expect(report.failed).toHaveLength(0);

    /* Пробіли справді зникли з реального документа, а не лишились як "порожній" текст. */
    const finalText = await textOfContainer((c) => c.containerId === cell.containerId);
    expect(finalText).toBe(base);
  });
});

describe("typography_apply (живий прогін): quotes-uk", () => {
  it("прямі лапки в документі стають правильними ялинками через реальний запис", async () => {
    const footnote = (await readContainers()).find((c) => c.kind === "footnote")!;
    expect(footnote).toBeTruthy();
    const base = footnote.text;

    /* Дописуємо в кінець контейнера слово в прямих лапках (якір — останній символ, як вище). */
    const setup = await applyEdits([
      edit({
        action: "insert",
        containerId: footnote.containerId,
        start: base.length - 1,
        end: base.length,
        expectedOld: base.at(-1),
        newText: ' "tak"',
      }),
    ]);
    expect(setup.applied).toHaveLength(1);
    const withStraightQuotes = await textOfContainer((c) => c.containerId === footnote.containerId);
    expect(withStraightQuotes).toBe(base + ' "tak"');

    const containers = await readContainers();
    const matches = scanContainers(containers, QUOTE_RULES).matches.filter(
      (m) => m.containerId === footnote.containerId,
    );
    expect(matches.length).toBeGreaterThanOrEqual(2);

    const typoEdits = toEdits(matches);
    expect(typoEdits.every((e) => e.action === "replace")).toBe(true);

    const report = await applyEdits(typoEdits, { stamp: "test-typo-quotes" });
    expect(report.applied).toHaveLength(typoEdits.length);
    expect(report.failed).toHaveLength(0);

    const finalText = await textOfContainer((c) => c.containerId === footnote.containerId);
    expect(finalText).toBe(base + " «tak»");
    /* Ані сліду прямих лапок — і жодної випадкової "розумної" підміни InDesign. */
    expect(finalText).not.toContain('"');
  });
});

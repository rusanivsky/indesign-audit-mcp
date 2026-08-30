import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runJsx } from "../../src/bridge/runner.js";
import { scanContainers, toEdits } from "../../src/tools/typography.js";
import { rulesFor, crossLocaleApplies, observedLanguages } from "../../src/typography/packs.js";
import { readLanguageRuns } from "../../src/spelling/langruns.js";
import { familyOf } from "../../src/typography/locale.js";
import type { AcceptedEdit, ApplyReport, ContainerSnapshot } from "../../src/corrections/types.js";
import { assertFixtureActive, closeFixtureDoc } from "./fixture-doc.js";

/*
 * A LIVE run of the English packs and the cross-locale guard.
 *
 * Unit tests prove the rules on strings; what they cannot prove is that the
 * language names this whole design keys on are the names a real InDesign
 * actually applies and reports back. Two links are only checkable here:
 *
 *   1. `appliedLanguage.name` really returns "English: UK" / "Ukrainian", so
 *      familyOf() resolves live text (docs/measured-facts-bilingual.md M4).
 *   2. The cross-locale guard behaves on a genuinely bilingual document, which
 *      is the case a fixture of pure strings cannot represent.
 *
 * Same careful pattern as tests/integration/typography.test.ts: our own fixture
 * document, assertFixtureActive before every check, and the fixture closed by
 * exact name even after a failure.
 */

let docName: string | undefined;
let dir: string;

async function readContainers(): Promise<ContainerSnapshot[]> {
  await assertFixtureActive(docName!);
  const r = await runJsx<{ containers: ContainerSnapshot[] }>("containers_read", {});
  return r.containers;
}

async function applyEdits(edits: Partial<AcceptedEdit>[]): Promise<ApplyReport> {
  await assertFixtureActive(docName!);
  return runJsx<ApplyReport>("apply_edits", {
    expectedDocName: docName,
    stamp: "test-locale",
    undoName: "Locale test",
    edits,
  });
}

beforeEach(async () => {
  docName = undefined;
  dir = await mkdtemp(join(tmpdir(), "idmcp-doc-"));
  docName = await runJsx<string>("__fixture_make_saved", { dir });
});

afterEach(async () => {
  if (docName) await closeFixtureDoc(docName);
  await rm(dir, { recursive: true, force: true });
});

describe("live: the language names the whole design keys on", () => {
  it("readLanguageRuns returns names whose family familyOf() can resolve", async () => {
    await assertFixtureActive(docName!);
    const langs = await readLanguageRuns();
    const seen = observedLanguages(langs);

    /* Negative control on the instrument itself: an empty reading would make
     * every assertion below vacuously true. */
    expect(seen.length).toBeGreaterThan(0);

    for (const s of seen) {
      expect(s.name.length, "an empty language name would break the gate silently").toBeGreaterThan(0);
      expect(s.family).toBe(familyOf(s.name));
    }
  });

  it("a fixture with one language does NOT engage cross-locale skipping", async () => {
    await assertFixtureActive(docName!);
    const langs = await readLanguageRuns();
    /* This is the measured hazard of M5 in live form: whatever single language
     * the fixture carries, the guard must stay off so the packs keep working. */
    expect(crossLocaleApplies(langs)).toBe(false);
  });
});

describe("live: the English pack writes English quotes", () => {
  it("straight quotes become curly ones through a real write", async () => {
    const containers = await readContainers();
    const story = containers.find((c) => c.kind !== "table" && c.text.length > 5)!;
    expect(story).toBeTruthy();

    /* Put an English sentence with straight quotes into the fixture. */
    const sentence = 'He said "hello" twice.';
    await applyEdits([{
      requestId: "seed", candidateId: "seed#0", action: "replace",
      containerId: story.containerId, start: 0, end: story.text.length,
      expectedOld: story.text, newText: sentence,
    }]);

    const after = (await readContainers()).find((c) => c.containerId === story.containerId)!;
    expect(after.text).toBe(sentence);

    /* The real path: scanContainers -> toEdits -> apply_edits, en-US pack. */
    const langs = await readLanguageRuns();
    const scan = scanContainers([after], rulesFor("en-US"), langs);
    const quoteMatches = scan.matches.filter((m) => m.ruleId === "en-quotes-us");
    expect(quoteMatches).toHaveLength(2);

    const report = await applyEdits(toEdits(quoteMatches));
    expect(report.applied).toHaveLength(2);

    const final = (await readContainers()).find((c) => c.containerId === story.containerId)!;
    expect(final.text).toBe("He said “hello” twice.");
  });

  it("the British pack produces single outer quotes on the same input", async () => {
    const containers = await readContainers();
    const story = containers.find((c) => c.kind !== "table" && c.text.length > 5)!;
    const sentence = 'He said "hello" twice.';
    await applyEdits([{
      requestId: "seed", candidateId: "seed#0", action: "replace",
      containerId: story.containerId, start: 0, end: story.text.length,
      expectedOld: story.text, newText: sentence,
    }]);

    const after = (await readContainers()).find((c) => c.containerId === story.containerId)!;
    const langs = await readLanguageRuns();
    const scan = scanContainers([after], rulesFor("en-GB"), langs);
    const report = await applyEdits(toEdits(scan.matches.filter((m) => m.ruleId === "en-quotes-gb")));
    expect(report.applied).toHaveLength(2);

    const final = (await readContainers()).find((c) => c.containerId === story.containerId)!;
    expect(final.text).toBe("He said ‘hello’ twice.");
  });
});

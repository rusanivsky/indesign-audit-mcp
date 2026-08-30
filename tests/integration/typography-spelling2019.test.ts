import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runJsx } from "../../src/bridge/runner.js";
import { scanContainers } from "../../src/tools/typography.js";
import { UK2019_RULES } from "../../src/typography/rules-uk.js";
import { UK_LANGUAGE, countLanguageRuns } from "../../src/typography/langgate.js";
import { collectVariantPairs } from "../../src/typography/spelling2019.js";
import { assertLanguageCoverage, readLanguageRuns } from "../../src/spelling/langruns.js";
import type { ContainerSnapshot } from "../../src/corrections/types.js";
import type { ContainerLanguage } from "../../src/spelling/types.js";
import { assertFixtureActive, closeFixtureDoc } from "./fixture-doc.js";

let docName: string | undefined;
let containers: ContainerSnapshot[];
let langs: ContainerLanguage[];

beforeAll(async () => {
  docName = await runJsx<string>("__fixture_make", {});
  await assertFixtureActive(docName);
  const read = await runJsx<{ containers: ContainerSnapshot[] }>("containers_read", {});
  containers = read.containers;
  langs = await readLanguageRuns();
});

afterAll(async () => {
  if (docName !== undefined) await closeFixtureDoc(docName);
});

describe("правопис 2019 на живій фікстурі", () => {
  it("шов двох викликів моста цілий — офсети мови збігаються з офсетами тексту", () => {
    /* Якби прилад брехав, усі числа нижче були б зміщені й нічого не важили. */
    expect(() => assertLanguageCoverage(containers, langs)).not.toThrow();
  });

  it("українських діапазонів НЕ нуль — інакше вся родина темна", () => {
    expect(countLanguageRuns(langs, UK_LANGUAGE)).toBeGreaterThan(0);
  });

  it("правила спрацювали в українському тексті й НЕ спрацювали поза ним", () => {
    const scan = scanContainers(containers, UK2019_RULES, langs);
    const byRule = (id: string) => scan.matches.filter((m) => m.ruleId === id);

    /* Позитив: три різні правила знайшли свій єдиний український збіг. */
    expect(byRule("uk2019-proiekt")).toHaveLength(1);
    expect(byRule("uk2019-proiekt")[0]!.before.toLowerCase()).toBe("прое");
    expect(byRule("uk2019-compound")).toHaveLength(1);
    expect(byRule("uk2019-compound")[0]!.after).toBe("веб");
    expect(byRule("uk2019-sviashchennyk")).toHaveLength(1);

    /* Негатив із числом, а не з тишею: російський «проект» і збіг на межі
     * мов — ДВА відкинутих, і кожен з них порахований. */
    expect(scan.skippedByLanguage).toBe(2);
  });

  it("пара ефір/етер бачиться змішаною", () => {
    const audited = containers.filter((c) => !c.isMaster);
    const auditedIds = new Set(audited.map((c) => c.containerId));
    const r = collectVariantPairs(
      audited, langs.filter((l) => auditedIds.has(l.containerId)), UK_LANGUAGE,
    );
    const p = r.pairs.find((x) => x.pairId === "ефір/етер");
    expect(p).toBeDefined();
    expect(p!.mixed).toBe(true);
    expect(p!.forms.map((f) => f.count)).toEqual([1, 1]);
  });

  it("аудит НІЧОГО не змінив у документі", async () => {
    /* Чесно про межі цього тесту: scanContainers і collectVariantPairs — чисті
     * функції над уже прочитаним знімком (containers, langs), тож збіг
     * сигнатури до/після доводить лише те, що ЦЕЙ виклик не сягає назад в
     * InDesign, — а не читальність родини в цілому. Справжній доказ на
     * реальній книжці — sha256 усіх 574 контейнерів, однаковий на двох
     * повних прогонах аудиту, записаний у docs/measured-facts-phase11.md. */
    const sig = async () =>
      await runJsx<string>("run_script", {
        script:
          "var s = ''; for (var i = 0; i < app.activeDocument.stories.length; i++)" +
          " { s += app.activeDocument.stories[i].contents; } __result = s;",
        undoName: "Сигнатура вмісту",
      });
    const before = await sig();
    scanContainers(containers, UK2019_RULES, langs);
    collectVariantPairs(containers, langs, UK_LANGUAGE);
    expect(await sig()).toBe(before);
  });
});

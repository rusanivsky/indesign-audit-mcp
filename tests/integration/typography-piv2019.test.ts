import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runJsx } from "../../src/bridge/runner.js";
import { UK_LANGUAGE, countLanguageRuns } from "../../src/typography/langgate.js";
import { collectPivStems } from "../../src/typography/piv2019.js";
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

const collect = () => collectPivStems(containers, langs, UK_LANGUAGE);

describe("piv2019 на живій фікстурі", () => {
  it("шов двох викликів моста цілий — інакше всі числа нижче зміщені", () => {
    expect(() => assertLanguageCoverage(containers, langs)).not.toThrow();
  });

  it("українських діапазонів НЕ нуль — інакше вся родина темна", () => {
    expect(countLanguageRuns(langs, UK_LANGUAGE)).toBeGreaterThan(0);
  });

  it("вирок на суцільній формі з роздільного переліку", () => {
    const g = collect().stems.find((s) => s.stem === "години");
    expect(g?.verdict).toBe("wrong");
    expect(g?.reason).toBe("contradicts-list");
  });

  it("дореформені знаки впізнані обидва", () => {
    const kinds = collect().stems.flatMap((s) => s.forms.map((f) => f.kind));
    expect(kinds).toContain("apostrophe");
    expect(kinds).toContain("hyphen");
  });

  it("текст «пів» на МАЙСТРІ в аудит не потрапляє", () => {
    /* На майстрі стоїть «пів-майстра» — єдине місце фікстури з основою
     * «майстра». Якщо вона у звіті, фільтр isMaster не працює. Без цього
     * твердження мутант 6 проходить зеленим. */
    expect(collect().stems.map((s) => s.stem)).not.toContain("майстра");
  });

  it("позитивний близнюк: той самий дефіс на звичайній сторінці — потрапляє", () => {
    expect(collect().stems.map((s) => s.stem)).toContain("києва");
  });
});

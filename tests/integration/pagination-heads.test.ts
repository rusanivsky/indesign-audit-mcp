import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runJsx } from "../../src/bridge/runner.js";
import { assertFixtureActive, closeFixtureDoc, makePaginationFixtureDoc } from "./fixture-doc.js";
import { chapterSpans, detectHeads } from "../../src/pagination/heads.js";
import type { PageRef, PaginationMeasure } from "../../src/pagination/types.js";
type PageRefSide = PageRef["side"];

/*
 * РОДИНА `runningHead` НА ЖИВОМУ ДОКУМЕНТІ.
 *
 * Безпека — той самий режим, що в pagination-apply.test.ts: документ
 * створюється лише через `__fixture_make_pagination`, закривається
 * `closeFixtureDoc` за ТОЧНОЮ назвою, `afterEach` прибирає навіть після
 * падіння. Тут при цьому НІЧОГО не пишеться взагалі: уся фаза читальна.
 */

const BASE = {
  folioStyles: ["Kolontsyfra"],
  contentsNumberStyle: "Zmist Cyfra",
  contentsTitleStyles: ["Zmist Rozdil"],
  headingStyles: ["Zagolovok"],
};

let docName: string;
let dir: string;

beforeEach(async () => {
  /* Скидання назви й `finally` на теку — з тієї самої причини, що в
   * `pagination-apply.test.ts`. */
  docName = "";
  dir = await mkdtemp(join(tmpdir(), "idmcp-heads-"));
  docName = await makePaginationFixtureDoc(dir);
  await assertFixtureActive(docName);
}, 300_000);

afterEach(async () => {
  try {
    if (docName) await closeFixtureDoc(docName);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 120_000);

describe("pagination_measure — збір колонтитулів", () => {
  it("без runningHeadStyles headFrames ПОРОЖНІ — вимір за родину не платить", async () => {
    await assertFixtureActive(docName);
    const m = await runJsx<PaginationMeasure>("pagination_measure", BASE, { timeoutMs: 180_000 });
    expect(m.headFrames).toEqual([]);
    /* Негативний контроль: рамки в документі є, просто не колонтитули. */
    expect(m.folioFrames.length).toBeGreaterThan(0);
  }, 300_000);

  it(
    "стиль, оголошений І колонцифрою, І колонтитулом, не вбиває родину колонцифр",
    async () => {
      /*
       * ГОЛОВНИЙ ВИМІР ФАЗИ, ПЕРЕНЕСЕНИЙ У ТЕСТ (зонд `H10-A`): на майстрах
       * `E`, `D`, `J` робочої книжки стиль `Колонтитул v1` несе ОБИДВІ
       * рамки — колонтитул на verso й колонцифру на recto. Тут той самий стан
       * відтворено найгіршим випадком: колонтитулом оголошено САМ стиль
       * колонцифри.
       *
       * Твердження подвійне, і обидві половини потрібні:
       *   - жодна КОЛОНЦИФРА не пролізла в `headFrames` — ні автоматична
       *     (спецсимволи), ні РУЧНА («8–9»: самі цифри й тире, спецсимволів
       *     немає взагалі). Другий випадок знайдено виконанням саме тут, і на
       *     робочій книжці таких рамок 91;
       *   - `folioFrames` не спорожніли — оголошення другої родини не затерло
       *     роль першої. Саме це сталося б, якби колонтитул був ще однією
       *     роллю в мапі «стиль → роль».
       */
      await assertFixtureActive(docName);
      const m = await runJsx<PaginationMeasure>(
        "pagination_measure",
        { ...BASE, runningHeadStyles: [...BASE.folioStyles] },
        { timeoutMs: 180_000 },
      );
      expect(m.folioFrames.length).toBeGreaterThan(0);
      const numeric = m.headFrames.filter((h) => /^[0-9\s‐-―-]+$/.test(h.text));
      expect(numeric).toEqual([]);
    },
    300_000,
  );

  it("оголошений, але відсутній стиль колонтитула — ГУЧНО в missingStyles", async () => {
    /*
     * Друкарська помилка в назві стилю інакше дає нуль знахідок, який
     * читається як «усе чисто» — той самий відмовний режим, який Фаза 5
     * ловила п'ять разів.
     */
    await assertFixtureActive(docName);
    const m = await runJsx<PaginationMeasure>(
      "pagination_measure",
      { ...BASE, runningHeadStyles: ["Стиль, якого нема"] },
      { timeoutMs: 180_000 },
    );
    expect(m.missingStyles).toContain("Стиль, якого нема");
  }, 300_000);
});

/*
 * ─────────────────────────────────────────────────────────────────────────
 * ОКРЕМА ФІКСТУРА КОЛОНТИТУЛІВ — власний документ, і це не оформлення.
 *
 * Стани колонтитула в СПІЛЬНІЙ фікстурі зламали шість числових тверджень у
 * трьох сусідніх файлах: прикладення нового майстра до наявних сторінок
 * забирає в них майстрові колонцифри старого. Стан `head-missing` без
 * майстра недосяжний у принципі, тож обійти це не виходило — лише винести.
 * Той самий прецедент, що односторонння фікстура пагінації.
 */
describe("родина runningHead на власній фікстурі", () => {
  let headsDoc: string;
  let states: string[];

  beforeEach(async () => {
    const made = await runJsx<{ docName: string; states: string[] }>(
      "__fixture_make_pagination_heads",
      {},
      { timeoutMs: 180_000 },
    );
    headsDoc = made.docName;
    states = made.states;
    await assertFixtureActive(headsDoc);
  }, 300_000);

  afterEach(async () => {
    if (headsDoc) await closeFixtureDoc(headsDoc);
  }, 120_000);

  const HEAD_PARAMS = {
    folioStyles: [],
    contentsNumberStyle: null,
    contentsTitleStyles: [],
    headingStyles: ["Zagolovok"],
    runningHeadStyles: ["Kolontytul"],
  };

  it("фікстура несе всі шість станів", () => {
    expect(states).toContain("head-correct-from-master");
    expect(states).toContain("head-wrong-chapter");
    expect(states).toContain("head-missing");
    expect(states).toContain("head-unexpected");
    expect(states).toContain("head-style-stray");
    expect(states).toContain("head-side-stray");
  });

  it("МАЙСТРОВИЙ колонтитул видно, і майстер названо", async () => {
    /*
     * Найважливіше твердження файла. На робочій книжці 50 сторінок із 50
     * дістають колонтитул саме з майстра, переозначених НУЛЬ — тобто якби
     * гейт майстрових рамок відсіював колонтитул (а він відсіював, поки це
     * не полагодили), родина мовчала б «усе чисто» на всій книжці.
     */
    await assertFixtureActive(headsDoc);
    const m = await runJsx<PaginationMeasure>("pagination_measure", HEAD_PARAMS, {
      timeoutMs: 180_000,
    });
    const fromMaster = m.headFrames.filter((h) => h.fromMaster);
    expect(fromMaster.length).toBeGreaterThan(0);
    expect(fromMaster[0]!.masterName).not.toBeNull();
  }, 300_000);

  it("кегль приходить у ПУНКТАХ, а не в одиницях геометрії", async () => {
    /*
     * Обробник виміру навмисно працює в міліметрах, і це перекривало текстові
     * атрибути теж: стиль на 10 pt приходив як 3,5278. Правило від цього не
     * ламалось (порівнюються однакові одиниці), але звіт сказав би операторові
     * «кегль 6,35 проти 3,53» — число, якого немає в жодній палітрі InDesign.
     */
    await assertFixtureActive(headsDoc);
    const m = await runJsx<PaginationMeasure>("pagination_measure", HEAD_PARAMS, {
      timeoutMs: 180_000,
    });
    const sizes = m.headFrames.map((h) => h.appearance.pointSize);
    expect(sizes).toContain(10);
    expect(sizes).toContain(18);
  }, 300_000);

  it("детектор знаходить рівно ті чотири дефекти, що заклала фікстура", async () => {
    await assertFixtureActive(headsDoc);
    const m = await runJsx<PaginationMeasure>("pagination_measure", HEAD_PARAMS, {
      timeoutMs: 180_000,
    });

    const spans = chapterSpans(m.headings, m.pages);
    expect(spans).toHaveLength(2);

    const expectedByMaster = new Map<string, Set<PageRefSide>>();
    for (const h of m.headFrames) {
      if (h.fromMaster && h.masterName !== null && !h.empty) {
        /* Мусить збігатися з накопиченням у src/tools/pagination.ts: сторони
         * НАКОПИЧУЮТЬСЯ, бо майстер-розворот має дві сторінки. */
        const sides = expectedByMaster.get(h.masterName) ?? new Set<PageRefSide>();
        sides.add(h.side);
        expectedByMaster.set(h.masterName, sides);
      }
    }

    const r = detectHeads(m.pages, m.headFrames, spans, {
      compareChapter: true,
      expectedByMaster,
    });
    const kinds = new Set(r.findings.map((f) => f.defect));

    expect(kinds.has("head-wrong-chapter")).toBe(true);
    expect(kinds.has("head-missing")).toBe(true);
    expect(kinds.has("head-unexpected")).toBe(true);
    expect(kinds.has("head-side-stray")).toBe(true);
    expect(kinds.has("head-style-stray")).toBe(true);
  }, 300_000);
});

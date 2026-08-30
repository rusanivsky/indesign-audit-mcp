import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { runJsx } from "../../src/bridge/runner.js";
import { runWrite } from "../../src/bridge/envelope.js";
import { APPLY_TIMEOUT_MS } from "../../src/tools/corrections.js";
import { detectFolio } from "../../src/pagination/folio.js";
import { planRewrite } from "../../src/pagination/rewrite.js";
import {
  documentThreadLinks,
  helperChainWins,
  mainThreadLinks,
  resolveFromLinks,
} from "../../src/pagination/topology.js";
import { registerPaginationTools } from "../../src/tools/pagination.js";
import type { Tools } from "../../src/tools/shared.js";
import type {
  ClaimFrame,
  PaginationDefect,
  PaginationMeasure,
} from "../../src/pagination/types.js";
import { assertFixtureActive, closeFixtureDoc, makePaginationFixtureDoc } from "./fixture-doc.js";

/*
 * ПЕРША ЗАДАЧА ФАЗИ, ЩО ПИШЕ, — і тому цей файл перевіряє не «чи вийшов
 * маркер», а «за яких умов обробник ВІДМОВЛЯЄТЬСЯ писати» (спек §3, §4.6).
 *
 * УВАГА ЩОДО БЕЗПЕКИ — той самий режим, що в composition-apply.test.ts:
 *   - документ створюється лише через `__fixture_make_pagination` і
 *     закривається `closeFixtureDoc(docName)` за ТОЧНОЮ назвою;
 *   - перед кожним записом стоїть `assertFixtureActive`;
 *   - у КОЖНОМУ виклику передається `expectedDocName` фікстури — обробник
 *     відмовляється писати в чужий документ ДО копії й до будь-якого запису;
 *   - `afterEach` закриває фікстуру навіть після падіння тесту.
 *
 * ЧОМУ ФІКСТУРА ЗБЕРІГАЄТЬСЯ НА ДИСК. `doc.saveACopy` потребує файла:
 * тека копій виводиться з `doc.fullName.parent`, а в незбереженого документа
 * її немає. Обробник відмовляється писати в незбережений документ так само,
 * як `apply_edits` (`src/jsx/apply.jsx`), тож без `dir` тут не перевіриш
 * НІЧОГО, крім самої відмови.
 */

const PARAMS = {
  folioStyles: ["Kolontsyfra"],
  contentsNumberStyle: "Zmist Cyfra",
  contentsTitleStyles: ["Zmist Rozdil"],
  headingStyles: ["Zagolovok"],
};

/** Напрямок, який ОГОЛОШУЄ маркер, — не вгадується з боку сторінки (§4.9). */
type Direction = "previous" | "next";

interface FolioMarkerEdit {
  frameId: string;
  page: string;
  paragraphIndex: number;
  charOffset: number;
  expectedLiteral: string;
  expectedParagraphText: string;
  direction: Direction;
}

interface WriteReport {
  docName: string;
  backupPath: string;
  applied: number;
  failed: { frameId: string; page: string; paragraphIndex: number; error: string }[];
  oversetBefore: string[];
  oversetAfter: string[];
  pageCountBefore: number;
  pageCountAfter: number;
}

let docName: string;
let dir: string;

async function measure(): Promise<PaginationMeasure> {
  await assertFixtureActive(docName);
  return runJsx<PaginationMeasure>("pagination_measure", PARAMS, { timeoutMs: 180_000 });
}

/**
 * Рамку шукаємо ЗА `id`, А НЕ ЗА СТОРІНКОЮ, і це не педантизм: сторінка може
 * містити не одну рамку колонцифри (у фікстурі с. «16» має дві намальовані,
 * а с. «15» — ту саму рамку, що й ціль правки, лише на прихованому шарі).
 * Пошук за сторінкою віддавав би ПЕРШУ, тобто перевіряв би випадкову сусідку
 * замість тієї, у яку писали.
 */
const byId = (m: PaginationMeasure, id: string): ClaimFrame =>
  m.folioFrames.find((f) => f.id === id && !f.fromMaster)!;

/**
 * ЦЕ Й Є ПРОВОД §4.1: правка НЕ несе числа, яке треба знайти в тексті, — вона
 * несе ВИМІРЯНИЙ символьний зсув (`literalOffsets`) і виміряний текст абзацу.
 * Обробник, який шукав би число самостійно, розійшовся б із оракулом, на
 * якому побудовано `eligible`.
 */
function editsFromPlan(m: PaginationMeasure): FolioMarkerEdit[] {
  /*
   * `"contract"` — ПЕРЕДБАЧЕННЯ, І ТУТ ВОНО ДОРЕЧНЕ, бо цей describe перевіряє
   * не оракул, а JSX-ОБРОБНИК ЗАПИСУ: його конверт, звірку тексту, копію й
   * крок скасування. Службового ланцюжка в цих тестах не будують узагалі, тож
   * порамкового доказу (C1) взяти нізвідки — а без правок обробникові нема що
   * подати. Це рівно той стан, у якому придатність рахує `create-helper-thread`.
   *
   * Наскрізний принцип §3 на надрукованому числі доводить інший describe —
   * той, що будує ланцюжок і читає PDF.
   */
  const verdicts = planRewrite(m.pages, m.folioFrames, "backward", "helper", "contract");
  const edits: FolioMarkerEdit[] = [];
  for (const v of verdicts) {
    if (!v.eligible) continue;
    const frame = m.folioFrames.find((f) => f.id === v.frameId && !f.fromMaster)!;
    const para = frame.paragraphs[v.paragraphIndex]!;
    edits.push({
      frameId: frame.id,
      page: frame.page,
      paragraphIndex: v.paragraphIndex,
      charOffset: para.literalOffsets[0]!,
      expectedLiteral: String(para.literals[0]!),
      expectedParagraphText: para.text,
      direction: v.direction!,
    });
  }
  return edits;
}

function editFor(frame: ClaimFrame, direction: Direction, paragraphIndex = 0): FolioMarkerEdit {
  const para = frame.paragraphs[paragraphIndex]!;
  return {
    frameId: frame.id,
    page: frame.page,
    paragraphIndex,
    charOffset: para.literalOffsets[0]!,
    expectedLiteral: String(para.literals[0]!),
    expectedParagraphText: para.text,
    direction,
  };
}

async function write(params: Record<string, unknown>): Promise<WriteReport> {
  await assertFixtureActive(docName);
  return runWrite<WriteReport>({
    handler: "pagination_replace_literals",
    params: {
      expectedDocName: docName,
      stamp: "2026-08-08-1200",
      undoName: "Тест заміни колонцифр",
      edits: [],
      ...params,
    },
    timeoutMs: APPLY_TIMEOUT_MS,
  });
}

/** Довільна правка тексту у фікстурі — імітує оператора, що втрутився. */
async function runScript<T = unknown>(script: string): Promise<T> {
  await assertFixtureActive(docName);
  return runJsx<T>("run_script", { script, undoName: "Тест: зміна тексту" }, { timeoutMs: 60_000 });
}

beforeEach(async () => {
  /* Назву скидаємо ПЕРЕД створенням: інакше `afterEach` після невдалого
   * створення закривав би документ попереднього тесту, якого вже немає, і
   * мовчки вважав би, що прибрав. */
  docName = "";
  dir = await mkdtemp(join(tmpdir(), "idmcp-pgn-write-"));
  docName = await makePaginationFixtureDoc(dir);
  await assertFixtureActive(docName);
}, 300_000);

afterEach(async () => {
  /* Тека йде в `finally`: коли закриття падає (InDesign зайнятий, міст
   * здався), лишити по собі ще й теку на диску — це другий слід тієї самої
   * однієї причини. */
  try {
    if (docName) await closeFixtureDoc(docName);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 120_000);

describe("pagination_replace_literals", () => {
  it("заміняє літерал на маркер потрібного НАПРЯМКУ, не змінюючи чисел", async () => {
    const before = await measure();
    const edits = editsFromPlan(before);
    expect(edits.length).toBeGreaterThan(0);
    /* Фікстура мусить містити ОБИДВА напрямки, інакше дзеркальна половина
     * §4.3 не перевіряється жодним записом (спек §8, рядок «колонцифра на
     * verso»). */
    expect(edits.map((e) => e.direction)).toContain("previous");
    expect(edits.map((e) => e.direction)).toContain("next");

    const res = await write({ edits });

    expect(res.applied).toBe(edits.length);
    expect(res.failed).toEqual([]);
    expect(res.docName).toBe(docName);
    await stat(res.backupPath);

    const after = await measure();
    for (const e of edits) {
      const frame = after.folioFrames.find((f) => f.id === e.frameId && !f.fromMaster)!;
      const para = frame.paragraphs[e.paragraphIndex]!;
      /* Літералів не лишилось — рамка стала самооновною. */
      expect(para.literals).toEqual([]);
      /* І це ТОЙ САМИЙ спецсимвол, що просив напрямок: мутант, який завжди
       * пише PREVIOUS_PAGE_NUMBER, на verso дав би «наступну» замість
       * «попередньої» — тобто мовчки брехливий маркер (§3). */
      expect(para.markers).toContain(
        e.direction === "previous" ? "previous-page-number" : "next-page-number",
      );
    }

    /*
     * ВИМІР «ДО» І «ПІСЛЯ» СПРАВДІ ЗРОБЛЕНО (§4.6, останній рядок таблиці) —
     * і саме цей рядок найлегше загубити: без нього `withDiffs` рахує дифи з
     * порожнечі, а гучна помилка §7 «becameOverset непорожній» не спрацює
     * ніколи.
     *
     * ЧОМУ ЦЕ ВЗАГАЛІ МОЖНА ПЕРЕВІРИТИ. У фікстури overset-історій НУЛЬ
     * (виміряно: 59 історій, жодної переповненої), тож «виміряли після» і
     * «підставили значення до» дали б ПОБАЙТОВО однаковий звіт. Обробник
     * тому й стартує з `null` — «не міряли»: мутант, що прибирає вимір
     * «після», лишає `null`, і обидві звірки нижче падають.
     */
    expect(res.pageCountBefore).toBe(before.pages.length);
    expect(res.pageCountAfter).toBe(res.pageCountBefore);
    expect(res.oversetAfter).toEqual(res.oversetBefore);
    /* Рівно те, що з цих полів рахує `withDiffs` (`src/tools/corrections.ts`). */
    expect(res.oversetAfter.filter((id) => !res.oversetBefore.includes(id))).toEqual([]);
    expect(res.pageCountAfter - res.pageCountBefore).toBe(0);
  });

  it("відмовляється, якщо активний документ не той — до копії й до запису", async () => {
    const before = await measure();
    const edits = editsFromPlan(before);

    await expect(
      write({ expectedDocName: "Не той.indd", edits }),
    ).rejects.toThrow(/Не той\.indd/);

    /* Копії немає: відмова стоїть ПЕРЕД `saveACopy` (`apply.jsx:258-266`). */
    await expect(stat(join(dir, "_backups"))).rejects.toThrow();

    /* І в документі нічого не змінилось. */
    const after = await measure();
    expect(byId(after, edits[0]!.frameId).paragraphs[0]!.literals).toEqual(
      byId(before, edits[0]!.frameId).paragraphs[0]!.literals,
    );
  });

  it("без stamp не пише — копію не буде куди покласти", async () => {
    await expect(write({ stamp: undefined })).rejects.toThrow(/stamp/);
  });

  it("текст, що змінився між виміром і записом, пропускається, а не переписується", async () => {
    /*
     * Той самий захист, що `expectedOld` у `corrections_apply`. Без нього
     * запис спирався б на вимір, якого вже немає.
     *
     * ДОПИСАНА ЦИФРА — НАЙГІРШИЙ ІЗ МОЖЛИВИХ ВИПАДКІВ, І САМЕ ТОМУ ВІН ТУТ.
     * «16» → «166»: діапазон за виміряним зсувом усе ще читається як «16»,
     * тобто звірка САМОГО ЛІТЕРАЛА проходить. Замінити його маркером
     * означало б лишити в рамці «⟨маркер⟩6» — правдоподібне неправильне
     * число, тобто рівно той режим відмови, який §3 називає гіршим за ручне.
     * Ловить це лише звірка ВСЬОГО абзацу.
     */
    const before = await measure();
    /*
     * ЛІТЕРАЛ ДВОЗНАЧНИЙ — це вимога сценарію, а не смак: дописана цифра мусить
     * лишити за виміряним зсувом ті самі символи. Доти тут стояло «14» —
     * колонцифра сторінки «15», яка лежить на ПРИХОВАНОМУ шарі; відколи оракул
     * такі рамки відкидає (`hidden-layer-frame`, Задача 11), придатної правки з
     * «14» не існує, і сценарій переїхав на «16» (сторінка «17»).
     */
    const target = editsFromPlan(before).find((e) => e.expectedLiteral === "16")!;
    expect(target).toBeDefined();

    await runScript(
      `var doc = app.activeDocument;
       var f = doc.pageItems.itemByID(${Number(target.frameId)});
       f.paragraphs[0].insertionPoints[${target.charOffset + target.expectedLiteral.length}]
         .contents = "6";
       __result = String(f.paragraphs[0].contents);`,
    );

    const res = await write({ edits: [target] });

    expect(res.applied).toBe(0);
    expect(res.failed).toHaveLength(1);
    expect(res.failed[0]!.frameId).toBe(target.frameId);
    expect(res.failed[0]!.error).toMatch(/text changed since the measurement/i);

    /*
     * Головне: у документі лишилось те, що там було. Якби маркер ліг,
     * літерали стали б `[6]` (перші два символи «16» замінив би один
     * спецсимвол), а маркерів побільшало б на один.
     */
    const after = await measure();
    const para = byId(after, target.frameId).paragraphs[0]!;
    expect(para.literals).toEqual([166]);
    expect(para.markers).toEqual(byId(before, target.frameId).paragraphs[0]!.markers);
  });

  it("зсув, що показує не на виміряний літерал, не пише — навіть при цілому тексті", async () => {
    /*
     * ДРУГА ЗВІРКА ПРО ЗСУВ, А НЕ ПРО ТЕКСТ, і без неї вона не перевіряється
     * нічим: абзац тут ЦІЛИЙ, тобто широка звірка проходить. Правка з чужим
     * зсувом — це правка, зібрана не з того виміру (§4.1: зсув міряють саме
     * для того, щоб обробник не шукав число сам), і запис за нею переписав би
     * сусідні символи, а не число. На «2–⟨маркер⟩» зсув 1 — це тире.
     *
     * ЦЕЙ ТЕСТ ДОПИСАНО ПІСЛЯ ТОГО, ЯК МУТАНТ ВИЖИВ: із вимкненою звіркою
     * зсуву всі сім тестів лишались зеленими.
     */
    const before = await measure();
    const good = editsFromPlan(before)[0]!;
    const shifted = { ...good, charOffset: good.charOffset + 1 };

    const res = await write({ edits: [shifted] });

    expect(res.applied).toBe(0);
    expect(res.failed).toHaveLength(1);
    expect(res.failed[0]!.error).toMatch(/at offset/i);

    const after = await measure();
    expect(byId(after, good.frameId).paragraphs[0]!.text).toBe(good.expectedParagraphText);
  });

  it("дві правки в той самий абзац: друга відмовляється, бо текст уже інший", async () => {
    const before = await measure();
    const target = editsFromPlan(before)[0]!;

    const res = await write({ edits: [target, { ...target }] });

    expect(res.applied).toBe(1);
    expect(res.failed).toHaveLength(1);
    expect(res.failed[0]!.error).toMatch(/text changed since the measurement/i);

    const after = await measure();
    expect(byId(after, target.frameId).paragraphs[0]!.literals).toEqual([]);
  });

  it("майстрова й заблокована рамки потрапляють у failed, а решта пачки лягає", async () => {
    const before = await measure();
    const good = editsFromPlan(before)[0]!;

    /*
     * МАЙСТРОВА РАМКА — не просто «не записати». `page.masterPageItems` дає
     * один і той самий об'єкт для кожної сторінки з цим майстром, тож запис
     * туди змінив би ВСІ ці сторінки одразу (§4.4, крок 7).
     */
    const master = before.folioFrames.find((f) => f.fromMaster && f.page === good.page)!;
    const masterEdit: FolioMarkerEdit = {
      frameId: master.id,
      page: master.page,
      paragraphIndex: 0,
      charOffset: 0,
      expectedLiteral: "1",
      expectedParagraphText: master.paragraphs[0]!.text,
      direction: "previous",
    };

    /*
     * Заблокована рамка. НЕ «фізична заборона InDesign» — це формулювання
     * спростовано виміром (Питання 19, стани B і B2: при
     * `frame.locked === true` заміна символа проходить без винятку). Відмовляє
     * НАШ обробник, і робить це навмисно: замок ставить верстальник.
     */
    const locked = before.folioFrames.find((f) => !f.fromMaster && f.locked)!;
    expect(locked).toBeDefined();
    const lockedEdit = editFor(locked, "next");

    const res = await write({ edits: [masterEdit, lockedEdit, good] });

    expect(res.applied).toBe(1);
    expect(res.failed).toHaveLength(2);
    expect(res.failed[0]!.error).toMatch(/parent-page item/i);
    expect(res.failed[1]!.error).toMatch(/is locked/i);

    const after = await measure();
    /* Майстрову рамку не чіпали: її текст той самий. */
    expect(after.folioFrames.find((f) => f.id === master.id)!.paragraphs[0]!.text).toBe(
      master.paragraphs[0]!.text,
    );
    expect(byId(after, locked.id).paragraphs[0]!.literals).toEqual(
      locked.paragraphs[0]!.literals,
    );
    expect(byId(after, good.frameId).paragraphs[0]!.literals).toEqual([]);
  });

  it("рамка на ЗАМКНЕНОМУ ШАРІ: оракул відмовляє окремою причиною, обробник — теж", async () => {
    /*
     * ЗАДАЧА 11Б, І ЦЕ ВЛАСТИВІСТЬ INDESIGN, ЯКУ АРИФМЕТИКОЮ НЕ ПЕРЕВІРИШ.
     *
     * Виміряно зондом `scripts/probe-h7-lock.jsx` (Питання 19): рамка на
     * замкненому шарі має `frame.locked === false`, а заміна символа в ній
     * ПРОХОДИТЬ — і при замовчуванні взаємодії, і при `NEVER_INTERACT`, тобто
     * саме на тому шляху, яким пише бойовий обробник. Контрольний зонд
     * доводить, що замок не фіктивний: `geometricBounds` і `remove()` на тій
     * самій рамці кидають `Object is locked.`. InDesign захищає ЕЛЕМЕНТ, а не
     * його текст.
     *
     * Отже верстальник, який замкнув шар, щоб його не чіпали, без цієї
     * відмови дістав би переписані рамки. Юніт доводить, що оракул уміє
     * назвати причину; цей тест доводить, що ВИМІР доносить до нього прапорець
     * із живого документа, і що обробник запису відмовляє незалежно від
     * оракула.
     */
    const before = await measure();
    const onLockedLayer = before.folioFrames.find((f) => !f.fromMaster && f.layerLocked)!;
    expect(onLockedLayer).toBeDefined();
    /* Розрізнення двох замків на живому документі, а не на рукописному типі. */
    expect(onLockedLayer.locked).toBe(false);

    /* `"contract"`: ланцюжка тут не будують, а перевіряється КРОК 7 — тобто
     * рамка мусить до нього дійти. Без передбачення вона впала б на кроці 6
     * («службової рамки під нею немає»), і тест називався б не своїм станом. */
    const verdict = planRewrite(
      before.pages,
      before.folioFrames,
      "backward",
      "helper",
      "contract",
    ).find((v) => v.frameId === onLockedLayer.id)!;
    expect(verdict).toBeDefined();
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toBe("locked-layer-frame");
    /*
     * Рамка дійшла ДО кроку 7, а не впала раніше: число правильне. Інакше
     * «відмовив оракул» означало б `oracle-mismatch`, і стан перевіряв би
     * зовсім не той крок (та сама вада, за яку Задача 4Б переносила
     * `folio-broken-thread`).
     */
    expect(verdict.current).toBe(verdict.expected);
    expect(verdict.current).not.toBeNull();

    /*
     * ДРУГИЙ ЕШЕЛОН. Обробник звіряє стан документа заново перед кожним
     * записом — план міг застаріти між виміром і записом (§4.1). Правку
     * будуємо РУКАМИ саме тому, що оракул її не віддасть.
     */
    const res = await write({ edits: [editFor(onLockedLayer, "next")] });
    expect(res.applied).toBe(0);
    expect(res.failed).toHaveLength(1);
    expect(res.failed[0]!.error).toMatch(/locked layer/i);

    const after = await measure();
    expect(byId(after, onLockedLayer.id).paragraphs[0]!.literals).toEqual(
      onLockedLayer.paragraphs[0]!.literals,
    );
  });

  it("уся пачка — ОДИН крок скасування", async () => {
    const before = await measure();
    const edits = editsFromPlan(before);
    expect(edits.length).toBeGreaterThan(1);

    await write({ edits, undoName: "Пачка колонцифр" });

    const mid = await measure();
    for (const e of edits) {
      expect(byId(mid, e.frameId).paragraphs[e.paragraphIndex]!.literals).toEqual([]);
    }

    await runJsx("__undo_once", { name: docName });

    const after = await measure();
    for (const e of edits) {
      expect(byId(after, e.frameId).paragraphs[e.paragraphIndex]!.literals).toEqual([
        Number(e.expectedLiteral),
      ]);
    }
  });
});

/*
 * ─────────────────────────────────────────────────────────────────────────
 * СІМНАДЦЯТИЙ ІНСТРУМЕНТ на живому документі.
 *
 * ЩО САМЕ ДОВОДИТЬ ЛИШЕ ЖИВИЙ ПРОГІН, А ЩО НІ — названо чесно, бо межа тут
 * не очевидна.
 *
 * ДОВОДИТЬ: що дві операції зшиті насправді (planId їде на диск і назад, а
 * `route: "auto"` без нього не працює); що сухий прогін не лишає в теці
 * користувача ні копії, ні ланцюжка; що після заміни числа на аркуші ті самі;
 * що рамка на прихованому шарі лишається ручною.
 *
 * НЕ ДОВОДИТЬ І НЕ МОЖЕ: гучну помилку «eligible > 0, applied === 0». Щоб
 * дістати цей стан на живому документі, документ мусить змінитися МІЖ виміром
 * інструмента і його ж записом — тобто потрібна гонка, якої тест не влаштує.
 * Спроба інсценувати її замком шару ВИМІРЯНА і провалилась: замок шару лишає
 * `frame.locked === false`, і InDesign запис пропускає (Питання 19, стан C).
 * Гонки з цього не вийшло, але вийшла Задача 11Б: `ClaimFrame.layerLocked`,
 * причина `locked-layer-frame` і власна відмова обробника — тобто тепер цей
 * стан дає `failed`, а не тиху заміну. Гучна помилка натомість доводиться в
 * `tests/unit/tools-pagination-apply.test.ts` підробленим `runWrite`, а живий
 * прогін нижче доводить друге, без чого той доказ був би порожнім: число
 * `applied`, на яке дивиться перевірка, приходить від СПРАВЖНЬОГО обробника й
 * дорівнює справжній кількості записаних рамок.
 * ─────────────────────────────────────────────────────────────────────────
 */

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
type ApplyArgs = Record<string, unknown>;

function applyHandler(): (a: ApplyArgs) => Promise<ToolResult> {
  let captured: ((a: ApplyArgs) => Promise<ToolResult>) | null = null;
  const fake = {
    registerTool(name: string, _cfg: unknown, h: (a: ApplyArgs) => Promise<ToolResult>) {
      if (name === "pagination_apply") captured = h;
    },
  } as unknown as Tools;
  registerPaginationTools(fake);
  if (!captured) throw new Error("pagination_apply не зареєстровано");
  return captured;
}

/** Виклик інструмента з ГУЧНИМ поясненням, коли він відмовився. */
async function apply(args: ApplyArgs): Promise<Record<string, unknown>> {
  await assertFixtureActive(docName);
  const res = await applyHandler()({
    folio: { styleNames: PARAMS.folioStyles, range: "backward" },
    expectedDocName: docName,
    ...args,
  });
  if (res.isError) throw new Error(`pagination_apply відмовився: ${res.content[0]!.text}`);
  return JSON.parse(res.content[0]!.text) as Record<string, unknown>;
}

/** Те саме, але коли відмова і є очікуваним результатом. */
async function applyExpectingError(args: ApplyArgs): Promise<string> {
  await assertFixtureActive(docName);
  const res = await applyHandler()({
    folio: { styleNames: PARAMS.folioStyles, range: "backward" },
    expectedDocName: docName,
    ...args,
  });
  if (!res.isError) throw new Error(`очікували відмову, а прийшло: ${res.content[0]!.text}`);
  return res.content[0]!.text;
}

/**
 * Фікстура навмисно містить стан `folio-helper-layer-hidden`: шар
 * `_folio-helper` уже є, прихований, і на ньому лежить ЧУЖИЙ ланцюжок із двох
 * рамок. Прибирати цей стан із фікстури не можна (§4.9), тож тести, яким
 * потрібна побудова, звільняють сам шар.
 */
/**
 * СТАН, У ЯКОМУ `replace-literals` ВЗАГАЛІ МАЄ ПРАВО ЩОСЬ ЗАПИСАТИ.
 *
 * Доти чотири тести нижче робили самий лише `clearHelperItems()` і одразу
 * `route: "helper", dryRun: false` — тобто писали маркери туди, де службового
 * ланцюжка НЕМАЄ, і перевіряли лише модель («літерали зникли»). На аркуші при
 * цьому «2–3» ставало «3–3» (фінальна рецензія, вхід A). Зелений прогін
 * документував дефект як правильну поведінку.
 *
 * Ланцюжок будує СПРАВЖНЯ операція, а не скрипт: інакше тести перевіряли б
 * власну підробку замість того, що робить інструмент.
 */
async function buildChain(): Promise<void> {
  await clearHelperItems();
  const built = await apply({ operation: "create-helper-thread", dryRun: false });
  if ((built.helper as { created: number }).created === 0) {
    throw new Error("службовий ланцюжок не побудувався — далі перевіряти нема чого");
  }
}

async function clearHelperItems(): Promise<void> {
  await runScript(
    `var doc = app.activeDocument;
     var lay = doc.layers.itemByName("_folio-helper");
     if (lay.isValid) { var it = lay.pageItems; for (var i = it.length - 1; i >= 0; i--) it[i].remove(); }
     __result = 1;`,
  );
}

describe("pagination_apply — інструмент", () => {
  let home: string;

  beforeEach(async () => {
    /* Плани — у тимчасову теку, а не в `~/.indesign-mcp` користувача. */
    home = await mkdtemp(join(tmpdir(), "idmcp-plans-live-"));
    process.env.INDESIGN_MCP_HOME = home;
  });

  afterEach(async () => {
    delete process.env.INDESIGN_MCP_HOME;
    await rm(home, { recursive: true, force: true });
  });

  it("сухий прогін за замовчуванням: без dryRun у виклику НІЧОГО не змінено", async () => {
    /*
     * `dryRun` замовчується `true` (§5.1), і тут це перевіряється НАСЛІДКАМИ, а
     * не полем відповіді: ні теки копій, ні нових рамок на службовому шарі, ні
     * плану на диску. Саме цей тест ловить те, що зловив його юніт-двійник —
     * шлях, на якому замовчування схеми не застосувалось і інструмент пішов
     * писати.
     */
    await clearHelperItems();
    const data = await apply({ operation: "create-helper-thread" });

    expect(data.dryRun).toBe(true);
    expect(data.planId).toBeNull();
    expect(data.backupPath).toBeNull();
    await expect(stat(join(dir, "_backups"))).rejects.toThrow();
    await expect(stat(join(home, "pagination-plans"))).rejects.toThrow();

    const seen = await runScript<{ items: number }>(
      `var doc = app.activeDocument;
       var lay = doc.layers.itemByName("_folio-helper");
       __result = { items: lay.isValid ? lay.pageItems.length : -1 };`,
    );
    expect(seen.items).toBe(0);
  });

  it("route: auto без planId — відмова; той самий виклик із planId працює", async () => {
    /*
     * ГОЛОВНИЙ ТЕСТ ЗШИВАННЯ ДВОХ ОПЕРАЦІЙ (§4.5), і він навмисно містить обидві
     * половини. Без відмови зліва «вимагає planId» було б словами.
     *
     * ПРИДАТНІСТЬ ПРИ ЦЬОМУ БЕРЕТЬСЯ НЕ З ПЛАНУ (C1): `chainEvidence` доповідає
     * `"measured"`, тобто кожна рамка довела своє перекриттям зі службовою.
     * План везе інше — знімок, схвалений оператором, і він ЗВІРЯЄТЬСЯ.
     */
    await clearHelperItems();

    const refusal = await applyExpectingError({
      operation: "replace-literals",
      route: "auto",
      dryRun: false,
    });
    expect(refusal).toMatch(/planId/);

    const built = await apply({ operation: "create-helper-thread", dryRun: false });
    const planId = built.planId as string;
    expect(planId).toMatch(/^folio-plan-/);

    /* План на диску несе ФАКТИЧНЕ покриття — по одному offset на сторінку. */
    const plan = JSON.parse(await readFile(join(home, "pagination-plans", `${planId}.json`), "utf8"));
    const before = await measure();
    expect(plan.docName).toBe(docName);
    expect(plan.chainOffsets).toEqual(before.pages.map((_, i) => i));
    /* І ДРУГУ одиницю покриття: під якими саме колонцифрами рамки лягли. Без
     * неї план обіцяв би придатність рамкам, під якими ланцюжка немає (I2). */
    expect((plan.chainFolioFrameIds as string[]).length).toBeGreaterThan(0);

    const done = await apply({
      operation: "replace-literals",
      route: "auto",
      planId,
      dryRun: false,
    });
    expect(done.chainEvidence).toBe("measured");
    expect(done.applied).toBe(done.eligible);
    expect(done.applied as number).toBeGreaterThan(0);
  });

  it("route: helper БЕЗ ланцюжка — нуль придатних і жодного запису (C1)", async () => {
    /*
     * ВХІД A ФІНАЛЬНОЇ РЕЦЕНЗІЇ, І ДОТИ ЦЕЙ ФАЙЛ ЙОГО ОСВЯЧУВАВ. Чотири тести
     * робили `clearHelperItems()`, далі `route: "helper", dryRun: false` — і
     * перевіряли лише модель (літерали зникли). Зелений прогін документував
     * дефектну поведінку як правильну: на аркуші «2–3» ставало «3–3».
     *
     * Придатність доводиться перекриттям САМОЇ рамки, тож без ланцюжка під нею
     * доводити нема чим. Причина названа поіменно — `no-neighbour-frame`, — і
     * це не «нічого не треба було робити»: `total` лишається ненульовим.
     */
    await clearHelperItems();
    const before = await measure();

    /*
     * ДВА ПЕРЕЛІКИ З ОДНОГО ВИМІРУ, І РІЗНИЦЯ МІЖ НИМИ І Є ДІРА. Передбачення
     * за контрактом («рамка на кожній сторінці») каже, скільки рамок оракул
     * визнавав придатними ДОТИ; порамковий вимір — скільки їх насправді має
     * ланцюжок під собою. Перелік не переписаний константою навмисно: зміна
     * складу фікстури інакше зробила б тест хибним мовчки.
     */
    const forecast = planRewrite(before.pages, before.folioFrames, "backward", "helper", "contract");
    const measured = planRewrite(before.pages, before.folioFrames, "backward", "helper");
    const lostEligibility = forecast.filter(
      (v) => v.eligible && !measured.some((m) => m.frameId === v.frameId && m.eligible),
    );
    expect(lostEligibility.length).toBeGreaterThan(0);

    const data = await apply({ operation: "replace-literals", route: "helper", dryRun: false });

    /*
     * ЩО ЛИШИЛОСЬ ПРИДАТНИМ — ЛИШЕ МАРШРУТ `thread`. У фікстурі є рамка, що
     * перекриває СПРАВЖНІЙ основний ланцюжок і бере число з нього; вона
     * придатна законно й без службових рамок, і §4.2 примушує їй `thread`
     * незалежно від прохання оператора. Нуль тут був би хибною обіцянкою.
     */
    expect(data.total as number).toBeGreaterThan(0);
    expect(measured.filter((v) => v.eligible).every((v) => v.route === "thread")).toBe(true);
    expect(data.eligible).toBe(measured.filter((v) => v.eligible).length);
    expect(
      (data.skipped as { reason: string; count: number }[]).find(
        (g) => g.reason === "no-neighbour-frame",
      )!.count,
    ).toBeGreaterThan(0);

    /*
     * І ГОЛОВНЕ — НА АРКУШІ. Кожна рамка, яку доти визнавали придатною за
     * посторінковим переліком, лишилась РУЧНОЮ: її літерал на місці. Доти на
     * цих рамках з'явився б маркер, і надруковане число змінилося б.
     */
    const after = await measure();
    for (const v of lostEligibility) {
      const frame = after.folioFrames.find((f) => f.id === v.frameId && !f.fromMaster)!;
      expect(frame.paragraphs[v.paragraphIndex]!.literals).toEqual([v.current]);
    }
  });

  it("сухий прогін replace-literals показує ТЕ САМЕ, що потім записує", async () => {
    /*
     * СУХИЙ ПРОГІН — ЦЕ ОБІЦЯНКА, І ТУТ ВОНА ЗВІРЯЄТЬСЯ З ВИКОНАННЯМ. Інакше
     * `dryRun` був би окремою гілкою, яка рахує щось своє: оператор дивився б на
     * один перелік, а в документ ішов би інший — тобто найгірший різновид
     * «показали й зробили не те».
     */
    await buildChain();
    const dry = await apply({ operation: "replace-literals", route: "helper" });
    const willWrite = dry.willWrite as {
      frameId: string;
      expectedLiteral: string;
      resolvedBy: string;
    }[];

    expect(dry.dryRun).toBe(true);
    expect(dry.applied).toBeNull();
    expect(willWrite.length).toBe(dry.eligible);
    expect(willWrite.length).toBeGreaterThan(0);

    /*
     * I7 НА ЖИВОМУ ДОКУМЕНТІ: обіцянка везе не лише АДРЕСУ правки, а й те, ВІД
     * ЧОГО залежить пообіцяне число. Ланцюжок щойно збудовано цим самим тестом,
     * тобто службовий переможець тут не інсценований — він фізичний.
     *
     * Чому це перевіряється саме тут: §4.8 називає видалення шару
     * `_folio-helper` штатною зворотною дією, а Питання 8 виміряло її ціну
     * («N–N»). Порамкове джерело — єдине, з чого оператор може дізнатися, які
     * колонцифри від того шару залежать; лічильник мусить збігатися з
     * переліком, інакше одне з двох чисел бреше.
     */
    console.log(
      `  джерело числа у willWrite: ${JSON.stringify(
        willWrite.reduce<Record<string, number>>(
          (acc, w) => ({ ...acc, [String(w.resolvedBy)]: (acc[String(w.resolvedBy)] ?? 0) + 1 }),
          {},
        ),
      )}`,
    );
    const byHelper = willWrite.filter((w) => w.resolvedBy === "helper");
    expect(byHelper.length).toBeGreaterThan(0);
    expect(dry.resolvedByHelper).toBe(byHelper.length);
    expect(dry.message).toContain("_folio-helper");
    /*
     * Копії від СУХОГО прогону немає. Рахуємо файли, а не саму теку: ланцюжок
     * будувала справжня операція, і одна копія в теці вже законно лежить.
     * Перевірка «теки немає» тут мовчки перетворилась би на тавтологію.
     */
    const backupsAfterDry = (await readdir(join(dir, "_backups"))).length;
    expect(backupsAfterDry).toBe(1);

    const wet = await apply({ operation: "replace-literals", route: "helper", dryRun: false });
    expect(wet.applied).toBe(willWrite.length);
    expect(wet.failed).toEqual([]);
    /* А запис копію зробив — друга поруч із тією, що лишив ланцюжок. */
    expect((await readdir(join(dir, "_backups"))).length).toBe(2);

    /* І записано саме те, що обіцяли: ті самі рамки, і числа ті самі. */
    const after = await measure();
    for (const w of willWrite) {
      const frame = after.folioFrames.find((f) => f.id === w.frameId && !f.fromMaster)!;
      expect(frame.paragraphs[0]!.literals).toEqual([]);
    }
  });

  it("другий прогін на тій самій книжці: усе вже автоматичне, запису немає", async () => {
    /*
     * §5.2 назвав цей сценарій імовірним і саме під нього завів окремий
     * лічильник `alreadyAutomatic`: порахувати вже переведені абзаци в
     * `skipped` зробило б `balanced: false` на бездоганному прогоні, а не
     * рахувати ніде — оператор не відрізнив би «вже зроблено» від «загубилось».
     * Тут це перевіряється двома прогонами підряд, а не міркуванням.
     */
    await buildChain();
    const first = await apply({ operation: "replace-literals", route: "helper", dryRun: false });
    const wrote = first.applied as number;
    expect(wrote).toBeGreaterThan(0);
    const autoBefore = first.alreadyAutomatic as number;

    const second = await apply({ operation: "replace-literals", route: "helper", dryRun: false });

    /* Ті самі абзаци переїхали з `total` у `alreadyAutomatic` — один в один. */
    expect(second.alreadyAutomatic).toBe(autoBefore + wrote);
    expect(second.total).toBe((first.total as number) - wrote);
    expect(second.eligible).toBe(0);
    expect(second.applied).toBe(0);
    /* І це НЕ помилка: нуль придатних — законний стан, а не збій. */
    expect((second.reconciliation as { balanced: boolean }).balanced).toBe(true);
    /* Другий прогін нічого не писав — тож і копії другої немає. */
    expect(second.backupPath).toBeNull();
  });

  it("рамка на ПРИХОВАНОМУ шарі лишається ручною, і причина названа", async () => {
    /*
     * РІШЕННЯ ЗАДАЧІ 11 НА ЖИВОМУ ДОКУМЕНТІ. Рамка «15» фікстури лежить на шарі
     * `Numeratsiia` (`visible: false`) і за числом бездоганна — `current ===
     * expected === 14`. §4.9 називає той самий стан `folio-dormant-duplicate`;
     * оракул відтепер із ним згоден і рамку не чіпає.
     */
    await buildChain();
    const data = await apply({ operation: "replace-literals", route: "helper", dryRun: false });

    const hidden = (data.skipped as { reason: string; pages: string[]; count: number }[]).find(
      (g) => g.reason === "hidden-layer-frame",
    );
    expect(hidden).toBeDefined();
    expect(hidden!.pages).toContain("15");

    /* І в документі вона й далі ручна: літерал на місці. */
    const after = await measure();
    const frame = after.folioFrames.find((f) => f.page === "15" && !f.layerVisible)!;
    expect(frame.paragraphs[0]!.literals).toEqual([14]);
  });

  it(
    "C2: службовий ланцюжок СТАРШИЙ за докладений основний — thread ВІДМОВЛЯЄТЬСЯ, аркуш не змінюється",
    async () => {
      /*
       * ЧЕТВЕРТИЙ ВХІД, І ЄДИНИЙ ТУТ, ЩО ДОВОДИТЬСЯ НАДРУКОВАНИМ ЧИСЛОМ ПОЗА
       * НАСКРІЗНИМ СЦЕНАРІЄМ.
       *
       * Стан збирається зі штатних дій, названих самим спеком: службовий
       * ланцюжок будується ПЕРШИМ (§4.5) → зникає ОДНА службова рамка (§4.8
       * називає штатною зворотною дією видалення ЦІЛОГО шару, тобто строго
       * більше) → оператор докладає верстку, чия рамка лягає під колонцифру
       * (заради цієї можливості §4.5 і існує) → `replace-literals` із
       * `route: "thread"`.
       *
       * InDesign розв'язує маркер по ВСІХ перекриттях і виграє СТВОРЕНИЙ РАНІШЕ
       * (виміряно, Питання 9), тобто тут — службовий ланцюжок, який після
       * видалення рамки веде вже не на сусідню сторінку. Оракул, що на прохання
       * `thread` рахував лише основні зв'язки, бачив натомість «правильне»
       * число докладеного ланцюжка, визнавав рамку придатною й писав маркер:
       * на власному документі рецензента «2–3» ставало «1–3» при `applied: 1`
       * і звіті без жодної скарги.
       *
       * ЩО САМЕ ЛОВИТЬ ЦЕЙ ТЕСТ, а не сусідній юніт: юніт твердить про вердикт
       * на рукописних `ThreadLink`, а тут ті самі числа приходять із живого
       * документа й перевіряються НА АРКУШІ — посимвольною рівністю PDF.
       */
      await buildChain();

      const before = await measure();
      const byName = new Map(before.pages.map((p) => [p.name, p]));

      /*
       * ЦІЛЬ БЕРЕТЬСЯ З ВИМІРУ, А НЕ ПИШЕТЬСЯ КОНСТАНТОЮ (§3.2): потрібна
       * рамка, придатна ПОРАМКОВО через службовий ланцюжок, із маркером назад і
       * сусідом, у якого сам є попередник, — інакше після видалення рамки
       * ланцюжок обірветься зовсім і стан вийде інший (`no-neighbour-frame`).
       */
      const measured = planRewrite(before.pages, before.folioFrames, "backward", "helper");
      const target = measured.find((v) => {
        if (!v.eligible || v.route !== "helper" || v.direction !== "previous") return false;
        const sibling = byName.get(String(v.expected));
        return sibling !== undefined && sibling.offset > 0;
      });
      expect(target).toBeDefined();
      const siblingName = String(target!.expected);

      /* ── 2. Зникає ОДНА службова рамка — та, що на сторінці-сусідові ── */
      const dropped = await runScript<{ killed: string[]; left: number }>(
        `var doc = app.activeDocument;
         var lay = doc.layers.itemByName("_folio-helper");
         var killed = [];
         var items = lay.pageItems;
         for (var i = items.length - 1; i >= 0; i--) {
             var pg = null;
             try { pg = items[i].parentPage; } catch (e) { pg = null; }
             if (pg !== null && String(pg.name) === ${JSON.stringify(siblingName)}) {
                 killed.push(String(items[i].id));
                 items[i].remove();
             }
         }
         __result = { killed: killed, left: lay.pageItems.length };`,
      );
      expect(dropped.killed).toHaveLength(1);

      /* ── 3. Оператор докладає ОСНОВНИЙ ланцюжок, створений ПІЗНІШЕ ──── */
      const main = await runScript<{ containers: number; layer: string }>(
        `var doc = app.activeDocument;
         var folio = doc.pageItems.itemByID(${Number(target!.frameId)});
         var gb = folio.geometricBounds;
         var here = folio.parentPage;
         var prev = doc.pages.itemByName(${JSON.stringify(siblingName)});
         /* ШАР БЕРЕТЬСЯ В САМОЇ КОЛОНЦИФРИ, а не «перший, що не службовий»:
          * перший у фікстурі — ПРИХОВАНИЙ шар Numeratsiia, а прихований шар
          * перекритої рамки маркер ГЛУШИТЬ (Питання 8), тобто стан вийшов би
          * зовсім інший. Ціль обрана придатною, отже її шар видимий і
          * незамкнений. */
         var lay0 = folio.itemLayer;
         if (String(lay0.name) === "_folio-helper") throw new Error("колонцифра на службовому шарі");
         var pb = prev.bounds;
         var ph = pb[2] - pb[0];
         var pw = pb[3] - pb[1];
         var a = prev.textFrames.add();
         a.itemLayer = lay0;
         /*
          * ЧАСТКАМИ АРКУША, А НЕ АБСОЛЮТНИМИ ЧИСЛАМИ — і це не стиль, а
          * причина, з якої тест був червоний. Обробник run_script іде під
          * scriptPreferences.measurementUnit = AUTO_VALUE (виміряно), тобто
          * в одиницях ЛІНІЙКИ ДОКУМЕНТА, а лінійка — налаштування застосунку,
          * не наше: фікстура ставить POINTS лише всередині власного обробника
          * й повертає як було. Числа 380/300/420/460 писалися в пунктах, де
          * аркуш фікстури — 612×792 pt і рамка лягала на середину. Та сама
          * арифметика при лінійці в ПІКАХ (заводське замовчування InDesign;
          * виміряно зараз: аркуш 51×66 пік) виносила рамку на монтажний стіл
          * за шість аркушів від сторінки — parentPage ставав null, а разом
          * із ним зникала «попередня сторінка» докладеного ланцюжка, і крок
          * 3a падав ще до того, як інструмента встигали спитати.
          *
          * Частки відтворюють ТУ САМУ середину правої половини аркуша
          * (0.48–0.53 висоти, 0.49–0.75 ширини — це і є 380/420 з 792 та
          * 300/460 з 612) у будь-яких одиницях. Колонцифри фікстури стоять
          * унизу (≈0.88 висоти), тож перекриття з ними не виникає.
          */
         a.geometricBounds = [pb[0] + ph * 0.48, pb[1] + pw * 0.49,
                              pb[0] + ph * 0.53, pb[1] + pw * 0.75];
         var b = here.textFrames.add();
         b.itemLayer = lay0;
         /* ТОЧНО під колонцифрою: та сама геометрія, що й у службової рамки. */
         b.geometricBounds = gb;
         a.nextTextFrame = b;
         __result = { containers: a.parentStory.textContainers.length,
                      layer: String(a.itemLayer.name) };`,
      );
      /* Обидві рамки ПОРОЖНІ навмисно: стан має міняти РОЗВ'ЯЗАННЯ маркера, а
       * не додавати на аркуш тексту, який сам собою зіпсував би порівняння. */
      expect(main.containers).toBe(2);
      expect(main.layer).not.toBe("_folio-helper");

      /* ── 3a. Пастка названа ЧИСЛАМИ З ЖИВОГО ДОКУМЕНТА ─────────────── */
      const staged = await measure();
      const frameNow = staged.folioFrames.find((f) => f.id === target!.frameId && !f.fromMaster)!;
      const links = documentThreadLinks(frameNow)!;
      /* Те, що бачив ЗВУЖЕНИЙ оракул: докладений ланцюжок веде рівно на сусіда,
       * тобто рамка виглядала придатною. */
      expect(resolveFromLinks(mainThreadLinks(links), "previous")).toBe(siblingName);
      /* Те, що бачить InDesign: виграє СТАРШИЙ службовий, і він веде не туди. */
      expect(helperChainWins(links, "previous")).toBe(true);
      expect(resolveFromLinks(links, "previous")).not.toBe(siblingName);

      /* ── 4. Прохання `thread` у цьому стані НЕЗДІЙСНЕННЕ ───────────── */
      const pdfBefore = await printedPages("c2-before");
      const data = await apply({ operation: "replace-literals", route: "thread", dryRun: false });

      /*
       * ГОЛОВНЕ ТВЕРДЖЕННЯ ЙДЕ ПЕРШИМ, І ЦЕ НЕ ПОРЯДОК ЗАРАДИ ПОРЯДКУ. §3 —
       * твердження про АРКУШ, тож саме воно мусить бути тим, що червоніє: без
       * правки сюди приходив маркер, який друкує число попередньої рамки
       * СЛУЖБОВОГО ланцюжка, і в звіті про це не було ані слова. Посимвольна
       * рівність, а не «стільки ж сторінок».
       */
      expect(await printedPages("c2-after")).toEqual(pdfBefore);

      /* Рамка лишилась РУЧНОЮ — літерал на місці. */
      const after = await measure();
      const frameAfter = after.folioFrames.find((f) => f.id === target!.frameId && !f.fromMaster)!;
      expect(frameAfter.paragraphs[target!.paragraphIndex]!.literals).toEqual([target!.current]);

      /* І причина названа ВЛАСНА — не «сусідньої рамки немає» про рамку, під
       * якою сусідня рамка є. */
      const group = (data.skipped as { reason: string; pages: string[] }[]).find(
        (g) => g.reason === "helper-chain-winner",
      );
      expect(group).toBeDefined();
      expect(group!.pages).toContain(frameNow.page);
    },
    900_000,
  );

  it(
    "I7: службовий ланцюжок СТАРШИЙ і веде ПРАВИЛЬНО — рамка придатна, і звіт каже, ЧИЄ це число",
    async () => {
      /*
       * СТАН, У ЯКОМУ ПОЛЕ БРЕХАЛО, — НА ЖИВОМУ ДОКУМЕНТІ. Він відрізняється
       * від сусіднього C2 рівно однією дією: службову рамку НІХТО не видаляє,
       * тож службовий ланцюжок веде куди слід. Виходить рамка ПРИДАТНА, а не
       * пропущена, — і саме тому C2 її не ловив: там прохання `thread` дає
       * відмову, а тут ніхто нічого не просить.
       *
       * Що бачив оператор доти: `route: "thread"` (основний ланцюжок під
       * рамкою Є) — і жодного натяку, що число фізично тримає СЛУЖБОВИЙ шар,
       * який старший. §4.8 називає видалення того шару штатною зворотною дією,
       * Питання 8 виміряло ціну («N–N»), тобто поле вело до найгіршої з
       * можливих дій.
       *
       * ПИСАТИ ТУТ НІЧОГО НЕ ТРЕБА: твердження — про сухий прогін, який
       * оператор і читає перед тим, як вирішувати долю шару.
       */
      await buildChain();

      const before = await measure();
      const byName = new Map(before.pages.map((p) => [p.name, p]));
      const measured = planRewrite(before.pages, before.folioFrames, "backward", "helper");
      const target = measured.find((v) => {
        if (!v.eligible || v.route !== "helper" || v.direction !== "previous") return false;
        const sibling = byName.get(String(v.expected));
        return sibling !== undefined && sibling.offset > 0;
      });
      expect(target).toBeDefined();
      const siblingName = String(target!.expected);

      /* ── Оператор докладає ОСНОВНИЙ ланцюжок, створений ПІЗНІШЕ ─────── */
      const main = await runScript<{ containers: number }>(
        `var doc = app.activeDocument;
         var folio = doc.pageItems.itemByID(${Number(target!.frameId)});
         var gb = folio.geometricBounds;
         var here = folio.parentPage;
         var prev = doc.pages.itemByName(${JSON.stringify(siblingName)});
         var lay0 = folio.itemLayer;
         if (String(lay0.name) === "_folio-helper") throw new Error("колонцифра на службовому шарі");
         var pb = prev.bounds;
         var ph = pb[2] - pb[0];
         var pw = pb[3] - pb[1];
         var a = prev.textFrames.add();
         a.itemLayer = lay0;
         /* Частками аркуша, з тієї самої причини, що в C2 вище: абсолютні
          * числа тут читаються в одиницях лінійки документа й при піках
          * виносять рамку на монтажний стіл. Тут це не червонило тест —
          * його твердження про переможця тримається й без сторінки в
          * сусіда, — тобто постановка мовчки була не тією, яку описує
          * коментар. Мовчазна вада гірша за гучну. */
         a.geometricBounds = [pb[0] + ph * 0.48, pb[1] + pw * 0.49,
                              pb[0] + ph * 0.53, pb[1] + pw * 0.75];
         var b = here.textFrames.add();
         b.itemLayer = lay0;
         b.geometricBounds = gb;
         a.nextTextFrame = b;
         __result = { containers: a.parentStory.textContainers.length };`,
      );
      expect(main.containers).toBe(2);

      /* ── Пастка названа числами з ЖИВОГО документа ──────────────────── */
      const staged = await measure();
      const frameNow = staged.folioFrames.find((f) => f.id === target!.frameId && !f.fromMaster)!;
      const links = documentThreadLinks(frameNow)!;
      /* Основний ланцюжок під рамкою Є — саме він і примушує `route: "thread"`. */
      expect(mainThreadLinks(links).length).toBeGreaterThan(0);
      /* Але виграє СТАРШИЙ службовий — і веде він туди ж, тобто рамка придатна. */
      expect(helperChainWins(links, "previous")).toBe(true);
      expect(resolveFromLinks(links, "previous")).toBe(siblingName);

      /* ── Сухий прогін: два поля кажуть РІЗНЕ, і обидва правду ───────── */
      const dry = await apply({ operation: "replace-literals", route: "helper" });
      const willWrite = dry.willWrite as { frameId: string; resolvedBy: string }[];
      const written = willWrite.find((w) => w.frameId === target!.frameId);
      expect(written).toBeDefined();
      expect(written!.resolvedBy).toBe("helper");

      /* А маршрут у цій самій рамці — `thread`, і це не суперечність: він
       * відповідає на ІНШЕ питання (§4.2, примус основним перекриттям). */
      const fresh = planRewrite(staged.pages, staged.folioFrames, "backward", "helper");
      const verdict = fresh.find(
        (v) => v.frameId === target!.frameId && v.paragraphIndex === target!.paragraphIndex,
      )!;
      expect(verdict.eligible).toBe(true);
      expect(verdict.route).toBe("thread");
      expect(verdict.resolvedBy).toBe("helper");

      /* І оператор дізнається про залежність зі слів, а не лише з переліку. */
      expect(dry.resolvedByHelper as number).toBeGreaterThan(0);
      expect(dry.message).toContain("_folio-helper");
    },
    900_000,
  );
});

/*
 * ─────────────────────────────────────────────────────────────────────────
 * ЗАДАЧА 13 — НАСКРІЗНИЙ СЦЕНАРІЙ, І ЄДИНЕ МІСЦЕ, ДЕ ФАЗА ПЕРЕВІРЯЄТЬСЯ
 * НАДРУКОВАНИМ ЧИСЛОМ, А НЕ ЧИСЛОМ У МОДЕЛІ.
 *
 * §3 формулює наскрізний принцип фази як твердження про АРКУШ: «інструмент не
 * сміє записати число, відмінне від того, що стоїть у рамці зараз». Усі
 * попередні тести доводять це через `pagination_measure` — тобто питають ту
 * саму систему, яка робила заміну, чи вона зробила її правильно. Маркер при
 * цьому лишається в моделі спецсимволом; що InDesign НАДРУКУЄ на його місці,
 * вимір не знає взагалі, і Питання 5 Фази 6 спіткнулося рівно тут.
 *
 * Тому доказ іде через PDF, як у Питанні 18 і Задачі 10: експорт → читання
 * тексту сторінок через `pdfjs-dist` → посимвольне порівняння.
 *
 * ЕКСПОРТІВ ТРИ, А НЕ ДВА, І ЦЕ ГОЛОВНЕ РІШЕННЯ ЦЬОГО ФАЙЛА.
 *
 * Двома експортами («до всього» і «після всього») сценарій ВПАВ БИ — і впав би
 * ПРАВДИВО, показавши стан, який спек не описував: `create-helper-thread`
 * НЕ нейтральний на аркуші. Виміряно тут-таки, 2026-08-08:
 *
 *   с. «11»:  «11–11»  →  «x–11»
 *   с. «21»:  «21–21»  →  «20–21»
 *
 * Це рівно ті дві рамки, що мали `folio-marker-unbound` ДО прогону: їхній
 * маркер не мав на що розв'язатися, і InDesign, за Питанням 10, друкував не
 * порожнечу й не попередження, а номер ПОТОЧНОЇ сторінки. Службовий ланцюжок
 * дав їм сусіда — і число перестало брехати. Тобто зміна є, вона на користь,
 * і вона НЕ від заміни літералів.
 *
 * Розділення на три експорти робить обидва твердження перевірними нарізно:
 *
 *   PDF1 → PDF2  (побудова ланцюжка): змінюються РІВНО сторінки, що несли
 *                `folio-marker-unbound`, і жодної іншої;
 *   PDF2 → PDF3  (заміна літералів):  не змінюється ЖОДЕН символ.
 *
 * Друге — це §3 у своїй буквальній формі. Перше заразом рятує весь доказ від
 * вакуумності: якби експорт чи читання PDF були зламані (порожній текст,
 * однакові байти), PDF2 === PDF3 справдилося б само собою. Ненульова дельта
 * PDF1 → PDF2 доводить, що прилад РОЗРІЗНЯЄ сторінки, перш ніж ним твердити
 * про рівність.
 * ─────────────────────────────────────────────────────────────────────────
 */

/** Три детектори §4.9 — ті самі, заради яких §2 називає фазу без них шкідливою. */
const MARKER_DEFECTS: PaginationDefect[] = [
  "folio-marker-unbound",
  "folio-marker-cross-spread",
  "folio-dormant-duplicate",
];

/**
 * Текст кожної сторінки PDF, у порядку сторінок.
 *
 * Елементи склеюються роздільником, а не порожнім рядком: без нього «11» плюс
 * «11–11» і «111» плюс «1–11» дали б той самий рядок, тобто порівняння мовчки
 * втратило б межі текстових об'єктів.
 */
async function printedPages(tag: string): Promise<string[]> {
  const path = join(dir, `${tag}.pdf`);
  await runScript(
    `var doc = app.activeDocument;
     doc.recompose();
     doc.exportFile(ExportFormat.PDF_TYPE, new File(${JSON.stringify(path)}), false);
     __result = 1;`,
  );
  const pdf = await getDocument({ data: new Uint8Array(await readFile(path)) }).promise;
  const out: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const content = await (await pdf.getPage(i)).getTextContent();
    out.push(content.items.map((it) => ("str" in it ? it.str : "")).join("|"));
  }
  return out;
}

/** Назви сторінок, чий надрукований текст відрізняється. */
function printedDiff(a: string[], b: string[], pageNames: string[]): string[] {
  const changed: string[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) changed.push(pageNames[i] ?? `(поза виміром, індекс ${i})`);
  }
  return changed;
}

/** Знахідки родини `folio` з живого виміру — той самий шлях, що в `pagination_audit`. */
function folioFindings(m: PaginationMeasure) {
  return detectFolio(m.pages, m.folioFrames).findings;
}

const countOf = (
  findings: ReturnType<typeof folioFindings>,
  defect: PaginationDefect,
): number => findings.filter((f) => f.defect === defect).length;

describe("НАСКРІЗНО: вимір → сухий прогін → запис → повторний аудит", () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "idmcp-plans-e2e-"));
    process.env.INDESIGN_MCP_HOME = home;
  });

  afterEach(async () => {
    delete process.env.INDESIGN_MCP_HOME;
    await rm(home, { recursive: true, force: true });
  });

  it(
    "три інваріанти §9: надруковані числа, folio-manual рівно на applied, нуль нових знахідок §4.9",
    async () => {
      await clearHelperItems();

      /* ── 1. Вимір і аудит ДО ───────────────────────────────────────── */
      const before = await measure();
      const pageNames = before.pages.map((p) => p.name);
      const findingsBefore = folioFindings(before);
      const manualBefore = countOf(findingsBefore, "folio-manual");
      expect(manualBefore).toBeGreaterThan(0);

      /*
       * Сторінки, чиї маркери ДО прогону не мали на що розв'язатися. Саме вони
       * — і тільки вони — мають право змінити надруковане число на кроці
       * побудови ланцюжка. Перелік БЕРЕТЬСЯ З ВИМІРУ, а не переписується
       * константою: інакше зміна складу фікстури зробила б його хибним мовчки.
       */
      const unboundPages = [
        ...new Set(
          findingsBefore.filter((f) => f.defect === "folio-marker-unbound").map((f) => f.page),
        ),
      ].sort();
      expect(unboundPages.length).toBeGreaterThan(0);

      const pdfBefore = await printedPages("e2e-before");
      expect(pdfBefore).toHaveLength(before.pages.length);
      expect(pdfBefore.some((t) => t.length > 0)).toBe(true);

      /* ── 2. Побудова службового ланцюжка ───────────────────────────── */
      const built = await apply({ operation: "create-helper-thread", dryRun: false });
      const planId = built.planId as string;
      expect(planId).toMatch(/^folio-plan-/);
      /* Контракт §4.2: рамка на КОЖНІЙ сторінці, а не лише там, де колонцифра. */
      expect((built.helper as { created: number }).created).toBe(before.pages.length);

      const pdfMid = await printedPages("e2e-mid");

      /*
       * ПЕРШИЙ ДОКАЗ, І ВІН ЗАРАЗОМ НЕГАТИВНИЙ КОНТРОЛЬ ДО ДРУГОГО.
       *
       * Змінились РІВНО сторінки з `folio-marker-unbound` — тобто ті, чия
       * колонцифра вже друкувала неправильне число (§4.9: InDesign не лишає
       * порожнечі й не попереджає, він друкує номер ПОТОЧНОЇ сторінки).
       * Побудова ланцюжка дала їхнім маркерам сусіда.
       *
       * Якби прилад був зламаний, тут вийшов би порожній перелік — і тоді
       * рівність PDF2 === PDF3 нижче не доводила б нічого.
       */
      expect(printedDiff(pdfBefore, pdfMid, pageNames)).toEqual(unboundPages);

      /* ── 3. Сухий прогін ───────────────────────────────────────────── */
      const dry = await apply({
        operation: "replace-literals",
        route: "auto",
        planId,
        dryRun: true,
      });
      const willWrite = dry.willWrite as {
        frameId: string;
        page: string;
        paragraphIndex: number;
        expectedLiteral: string;
        direction: Direction;
      }[];
      expect(dry.dryRun).toBe(true);
      expect(dry.applied).toBeNull();
      /* Придатність доведена ПОРАМКОВО — з перекриттів кожної рамки зі
       * службовою, а не з переліку сторінок у плані (C1). */
      expect(dry.chainEvidence).toBe("measured");
      expect(willWrite.length).toBe(dry.eligible);
      expect(willWrite.length).toBeGreaterThan(0);
      /* Обидва боки розвороту, інакше дзеркальна половина §4.3 не перевірена. */
      expect(willWrite.map((e) => e.direction)).toContain("previous");
      expect(willWrite.map((e) => e.direction)).toContain("next");
      /*
       * Сухий прогін не лишає ні копії, ні сліду НА АРКУШІ. Друге перевіряється
       * тим самим приладом, що й інваріант 1: обіцянка «нічого не записано»
       * доти доводилась лише полями відповіді й відсутністю теки копій, тобто
       * знову власним твердженням інструмента про себе.
       */
      expect(dry.backupPath).toBeNull();
      expect(await printedPages("e2e-after-dry")).toEqual(pdfMid);

      /* ── 4. Запис ──────────────────────────────────────────────────── */
      const wet = await apply({
        operation: "replace-literals",
        route: "auto",
        planId,
        dryRun: false,
      });
      const applied = wet.applied as number;
      expect(applied).toBe(willWrite.length);
      expect(wet.failed).toEqual([]);
      expect((wet.reconciliation as { balanced: boolean }).balanced).toBe(true);
      expect(wet.diffs).toEqual({ becameOverset: [], noLongerOverset: [], pageCountDelta: 0 });

      /* ── ІНВАРІАНТ 1: жодне НАДРУКОВАНЕ число не змінилось ─────────── */
      const pdfAfter = await printedPages("e2e-after");
      expect(printedDiff(pdfMid, pdfAfter, pageNames)).toEqual([]);
      /* Посимвольно, а не «стільки ж сторінок»: масив рядків цілком. */
      expect(pdfAfter).toEqual(pdfMid);

      /* ── 5. Повторний аудит ────────────────────────────────────────── */
      const after = await measure();
      const findingsAfter = folioFindings(after);

      /* ІНВАРІАНТ 2: `folio-manual` упав РІВНО на `applied`.
       * Одиниця в обох частинах одна — абзац-твердження (§4.4, §5.2): і
       * знахідка `folio-manual`, і вердикт оракула породжуються на абзац. */
      expect(countOf(findingsAfter, "folio-manual")).toBe(manualBefore - applied);

      /* ІНВАРІАНТ 3: три детектори §4.9 не дали ЖОДНОЇ нової знахідки.
       *
       * «Нуль» тут не абсолютний, і формулювати його абсолютним було б
       * неправдою про фікстуру: `folio-dormant-duplicate` (с. «15») і
       * `folio-marker-cross-spread` (с. «18») — навмисні стани §8, вони
       * описують рамки, яких оракул не чіпав, і після заміни нікуди не
       * діваються. Нулем мусить бути ПРИРІСТ: заміна не сміє породити жодної
       * нової знахідки маркера. Порівнюються `id` знахідок, а не лічильники:
       * однакове число при різних рамках означало б «одну зламали, іншу
       * полагодили», і лічильник цього не показав би. */
      const idsBefore = new Set(
        findingsBefore.filter((f) => MARKER_DEFECTS.includes(f.defect)).map((f) => f.id),
      );
      const newOnes = findingsAfter
        .filter((f) => MARKER_DEFECTS.includes(f.defect))
        .filter((f) => !idsBefore.has(f.id));
      expect(newOnes.map((f) => `${f.defect} с.${f.page} рамка ${f.frameId}`)).toEqual([]);

      /* І ЖОДНА З ПЕРЕВЕДЕНИХ РАМОК не має знахідки маркера — це та половина
       * інваріанта 3, яку перевірка приросту не покриває: рамка могла нести
       * таку знахідку ще ДО заміни й лишитись у `idsBefore`. */
      const writtenIds = new Set(willWrite.map((e) => e.frameId));
      const onWritten = findingsAfter
        .filter((f) => MARKER_DEFECTS.includes(f.defect))
        .filter((f) => f.frameId !== null && writtenIds.has(f.frameId));
      expect(onWritten.map((f) => `${f.defect} рамка ${f.frameId}`)).toEqual([]);

      /* `folio-marker-unbound` дійшов до НУЛЯ, і це не побічний ефект тесту, а
       * виміряний наслідок: ті самі дві рамки, що змінили надруковане число на
       * кроці 2. Абсолютний нуль тут стверджувати можна саме тому, що жодна
       * рамка фікстури не лишається без ланцюжка після його побудови. */
      expect(countOf(findingsAfter, "folio-marker-unbound")).toBe(0);

      /* І в документі рамки справді стали самооновними. */
      for (const e of willWrite) {
        const frame = after.folioFrames.find((f) => f.id === e.frameId && !f.fromMaster)!;
        const para = frame.paragraphs[e.paragraphIndex]!;
        expect(para.literals).toEqual([]);
        expect(para.markers).toContain(
          e.direction === "previous" ? "previous-page-number" : "next-page-number",
        );
      }
    },
    900_000,
  );
});

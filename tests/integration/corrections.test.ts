import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runJsx } from "../../src/bridge/runner.js";
import { buildPlan, orderForApply } from "../../src/corrections/planner.js";
import { toAcceptedEdits } from "../../src/tools/corrections.js";
import type { AcceptedEdit, ApplyReport, ContainerSnapshot } from "../../src/corrections/types.js";
import { assertFixtureActive, closeFixtureDoc } from "./fixture-doc.js";

/*
 * УВАГА щодо безпеки. Це єдиний файл тестів у проєкті, який ПИШЕ в документ
 * InDesign. У користувача в тому самому застосунку може бути відкритий
 * реальний робочий макет. Тому:
 *   - фікстура створюється й закривається лише через __fixture_make_saved /
 *     closeFixtureDoc(docName) — closeFixtureDoc закриває документ виключно
 *     за точною назвою;
 *   - перед кожною перевіркою викликається assertFixtureActive;
 *   - у КОЖНОМУ виклику apply_edits передається expectedDocName фікстури —
 *     обробник відмовиться писати, якщо активним раптом виявиться інший
 *     документ, і зробить це ДО створення копії й до будь-якого запису;
 *   - afterEach закриває фікстуру навіть після падіння тесту.
 */

interface AppState {
  userInteractionLevel: string;
  typographersQuotes: boolean;
}

const BASE_TEXT_1 = "Kyiv — stolytsia Ukrainy. Cei tekst mistyt slovo pomylka dlia testu.";
const BASE_TEXT_2 = "Druhyi potik tekstu, iakyi navmysno ne vlizaie u ramku i daie overset.";

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

/** Кожен виклик apply_edits у цих тестах прив'язаний до назви фікстури. */
async function applyEdits(
  edits: Partial<AcceptedEdit>[],
  opts: { stamp?: string; undoName?: string; expectedDocName?: string } = {},
): Promise<ApplyReport> {
  await assertFixtureActive(docName!);
  return runJsx<ApplyReport>("apply_edits", {
    expectedDocName: opts.expectedDocName ?? docName,
    stamp: opts.stamp ?? "test",
    undoName: opts.undoName ?? "Тест",
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

describe("apply_edits: запобіжник «не той документ» (виправлення 1)", () => {
  it("відмовляється писати, якщо активний документ не той, для якого будувався план", async () => {
    const before = await textOfContainer((c) => c.text.includes("pomylka"));
    const c = (await readContainers()).find((x) => x.text.includes("pomylka"))!;
    const start = c.text.indexOf("pomylka");

    await expect(
      applyEdits(
        [
          edit({
            containerId: c.containerId,
            start,
            end: start + "pomylka".length,
            expectedOld: "pomylka",
            newText: "NE MAIE ZAPYSATYS",
          }),
        ],
        { expectedDocName: "chuzhyi-dokument.indd" },
      ),
    ).rejects.toThrow(/plan was built for/);

    /* Відмова мусить статися ДО копії: теки _backups не має існувати взагалі. */
    expect(existsSync(join(dir, "_backups"))).toBe(false);
    /* І текст мусить лишитися недоторканим. */
    expect(await textOfContainer((x) => x.containerId === c.containerId)).toBe(before);
  });
});

describe("apply_edits: заміна й резервна копія", () => {
  it("замінює текст і створює копію в _backups", async () => {
    const c = (await readContainers()).find((x) => x.text.includes("pomylka"))!;
    const start = c.text.indexOf("pomylka");

    const report = await applyEdits([
      edit({
        containerId: c.containerId,
        start,
        end: start + "pomylka".length,
        expectedOld: "pomylka",
        newText: "vypravleno",
      }),
    ]);

    expect(report.applied).toHaveLength(1);
    expect(report.skipped).toHaveLength(0);
    expect(report.backupPath).toContain("_backups");
    expect(existsSync(report.backupPath)).toBe(true);
    expect(report.pageCountBefore).toBe(report.pageCountAfter);

    expect(await textOfContainer((x) => x.containerId === c.containerId)).toBe(
      BASE_TEXT_1.replace("pomylka", "vypravleno"),
    );
  });

  /*
   * Запобіжник №1 доводиться не існуванням файлу, а його ВМІСТОМ: копія має
   * містити текст ДО правок. Файл, зроблений уже після запису, теж існував би
   * і теж лежав би в _backups — і був би марним.
   */
  it("копія в _backups містить текст ДО правок, а не після", async () => {
    const c = (await readContainers()).find((x) => x.text.includes("pomylka"))!;
    const start = c.text.indexOf("pomylka");

    const report = await applyEdits(
      [
        edit({
          containerId: c.containerId,
          start,
          end: start + "pomylka".length,
          expectedOld: "pomylka",
          newText: "vypravleno",
        }),
      ],
      { stamp: "test-backup" },
    );
    expect(report.applied).toHaveLength(1);

    /* У живому документі — уже виправлено. */
    expect(await textOfContainer((x) => x.containerId === c.containerId)).toBe(
      BASE_TEXT_1.replace("pomylka", "vypravleno"),
    );

    /* А у копії — початковий текст. */
    const backupTexts = await runJsx<string[]>("__fixture_read_doc_file", {
      path: report.backupPath,
    });
    expect(backupTexts).toContain(BASE_TEXT_1);
    expect(backupTexts.join(" ")).not.toContain("vypravleno");

    /* Відкриття копії не мало лишити її відкритою й не мало збити активний документ. */
    await assertFixtureActive(docName!);
  });

  /*
   * Important 2. backupStamp має точність до хвилини, а дві пачки правок за
   * одну хвилину — звичайний ритм приймання дрібних порцій. Раніше друга копія
   * мовчки затирала першу через saveACopy, і backupPath зі звіту ПЕРШОЇ пачки
   * вказував би на файл, у якому правки першої пачки вже є.
   */
  it("друга пачка з тим самим stamp не затирає копію першої", async () => {
    const c = (await readContainers()).find((x) => x.text === BASE_TEXT_1)!;

    const first = await applyEdits(
      [
        edit({
          containerId: c.containerId,
          start: c.text.indexOf("Kyiv"),
          end: c.text.indexOf("Kyiv") + 4,
          expectedOld: "Kyiv",
          newText: "Lviv",
        }),
      ],
      { stamp: "odna-khvylyna" },
    );

    const afterFirst = BASE_TEXT_1.replace("Kyiv", "Lviv");
    expect(await textOfContainer((x) => x.containerId === c.containerId)).toBe(afterFirst);

    /* Той самий stamp — саме те, що дав би реальний backupStamp() тієї ж хвилини. */
    const second = await applyEdits(
      [
        edit({
          requestId: "r2",
          candidateId: "c2",
          containerId: c.containerId,
          start: afterFirst.indexOf("testu"),
          end: afterFirst.indexOf("testu") + 5,
          expectedOld: "testu",
          newText: "proby",
        }),
      ],
      { stamp: "odna-khvylyna" },
    );

    /* Два РІЗНІ файли, обидва на місці. */
    expect(second.backupPath).not.toBe(first.backupPath);
    expect(existsSync(first.backupPath)).toBe(true);
    expect(existsSync(second.backupPath)).toBe(true);

    /* Копія першої пачки досі містить текст ДО першої правки. */
    const firstBackup = await runJsx<string[]>("__fixture_read_doc_file", {
      path: first.backupPath,
    });
    expect(firstBackup).toContain(BASE_TEXT_1);
    expect(firstBackup.join(" ")).not.toContain("Lviv");

    /* А копія другої — стан після першої пачки, до другої. */
    const secondBackup = await runJsx<string[]>("__fixture_read_doc_file", {
      path: second.backupPath,
    });
    expect(secondBackup).toContain(afterFirst);

    await assertFixtureActive(docName!);
  });

  it("пропускає правку, якщо текст у документі вже не той", async () => {
    const c = (await readContainers()).find((x) => x.text.includes("pomylka"))!;
    const start = c.text.indexOf("pomylka");

    const report = await applyEdits(
      [
        edit({
          containerId: c.containerId,
          start,
          end: start + "pomylka".length,
          expectedOld: "INSHYI TEKST",
          newText: "ne maie zastosuvatys",
        }),
      ],
      { stamp: "test2" },
    );

    expect(report.applied).toHaveLength(0);
    expect(report.skipped).toHaveLength(1);
    expect(report.skipped[0]!.reason).toContain("changed after the plan was built");
    expect(report.skipped[0]!.actual).toBe("pomylka");
    expect(await textOfContainer((x) => x.containerId === c.containerId)).toBe(BASE_TEXT_1);
  });

  it("видаляє рівно вказаний діапазон", async () => {
    const c = (await readContainers()).find((x) => x.text.includes("pomylka"))!;
    /* Разом із пробілом перед словом, щоб побачити точні межі. */
    const start = c.text.indexOf(" pomylka");

    const report = await applyEdits(
      [
        edit({
          action: "delete",
          containerId: c.containerId,
          start,
          end: start + " pomylka".length,
          expectedOld: " pomylka",
          newText: "",
        }),
      ],
      { stamp: "test-del" },
    );

    expect(report.applied).toHaveLength(1);
    expect(await textOfContainer((x) => x.containerId === c.containerId)).toBe(
      BASE_TEXT_1.replace(" pomylka", ""),
    );
  });
});

/*
 * Виправлення 2. У базовому коді брифінгу гілка insert робила `continue` ДО
 * порівняння actual !== expectedOld, тобто вставка застосовувалася наосліп —
 * навіть якщо текст-якір у документі змінився після побудови плану. Це прямо
 * порушує четвертий запобіжник спека.
 */
describe("apply_edits: звірка тексту-якоря для insert (виправлення 2)", () => {
  it("вставляє рівно після якоря, коли якір збігається", async () => {
    const c = (await readContainers()).find((x) => x.text.includes("Ukrainy"))!;
    const start = c.text.indexOf("Ukrainy");

    const report = await applyEdits(
      [
        edit({
          action: "insert",
          containerId: c.containerId,
          start,
          end: start + "Ukrainy".length,
          expectedOld: "Ukrainy",
          newText: " (vstavka)",
        }),
      ],
      { stamp: "test-ins" },
    );

    expect(report.applied).toHaveLength(1);
    expect(report.skipped).toHaveLength(0);
    expect(await textOfContainer((x) => x.containerId === c.containerId)).toBe(
      BASE_TEXT_1.replace("Ukrainy", "Ukrainy (vstavka)"),
    );
  });

  it("НЕ вставляє наосліп, якщо текст-якір у документі вже не той", async () => {
    const c = (await readContainers()).find((x) => x.text.includes("Ukrainy"))!;
    const start = c.text.indexOf("Ukrainy");

    const report = await applyEdits(
      [
        edit({
          action: "insert",
          containerId: c.containerId,
          start,
          end: start + "Ukrainy".length,
          /* Якір, якого в документі на цих офсетах немає. */
          expectedOld: "Ukrayiny",
          newText: " (ne maie vstavytys)",
        }),
      ],
      { stamp: "test-ins2" },
    );

    expect(report.applied).toHaveLength(0);
    expect(report.skipped).toHaveLength(1);
    expect(report.skipped[0]!.reason).toContain("changed after the plan was built");
    expect(report.skipped[0]!.actual).toBe("Ukrainy");
    expect(await textOfContainer((x) => x.containerId === c.containerId)).toBe(BASE_TEXT_1);
  });

  /*
   * Important 3. Вставка — єдина дія, яка НЕ змінює власного якоря: після
   * вставки " (vstavka)" після "Ukrainy" якір усе ще читається як "Ukrainy",
   * тож звірка перед записом повторний запуск того самого плану спинити не може
   * за побудовою — і текст дублювався б. Шлях прямо досяжний зі сценарію
   * таймауту: describeApplyTimeout радить операторові перевірити документ, і
   * повторний запуск — природна реакція.
   */
  it("повторне застосування тієї самої вставки не дублює текст", async () => {
    const c = (await readContainers()).find((x) => x.text === BASE_TEXT_1)!;
    const start = c.text.indexOf("Ukrainy");
    const insertEdit = edit({
      action: "insert",
      containerId: c.containerId,
      start,
      end: start + "Ukrainy".length,
      expectedOld: "Ukrainy",
      newText: " (vstavka)",
    });

    const first = await applyEdits([insertEdit], { stamp: "ins-once" });
    expect(first.applied).toHaveLength(1);
    const expected = BASE_TEXT_1.replace("Ukrainy", "Ukrainy (vstavka)");
    expect(await textOfContainer((x) => x.containerId === c.containerId)).toBe(expected);

    /* Той самий план удруге — якір не змінився, але вставка вже стоїть. */
    const second = await applyEdits([insertEdit], { stamp: "ins-twice" });
    expect(second.applied).toHaveLength(0);
    expect(second.skipped).toHaveLength(1);
    expect(second.skipped[0]!.reason).toContain("already applied");

    /* Головне: рівно одна вставка, а не дві. */
    const after = await textOfContainer((x) => x.containerId === c.containerId);
    expect(after).toBe(expected);
    expect(after.split("(vstavka)")).toHaveLength(2);
  });
});

/*
 * Important 5. Найчастіша форма «документ змінився після побудови плану» —
 * story СКОРОТИЛАСЯ. characters.itemByRange(start, end - 1) на позамежному
 * індексі кидає, а не обрізає, тож раніше одна така правка валила всю пачку —
 * причому вже після того, як інші були записані. Тепер пре-прохід ловить це до
 * копії й віддає правку як skipped, а решта пачки лягає чисто.
 */
describe("apply_edits: правка поза межами контейнера (Important 5)", () => {
  it("пропускає позамежну правку й застосовує решту пачки", async () => {
    const c = (await readContainers()).find((x) => x.text === BASE_TEXT_1)!;
    const start = c.text.indexOf("pomylka");

    const report = await applyEdits(
      [
        edit({
          requestId: "poza",
          candidateId: "poza#0",
          containerId: c.containerId,
          /* План нібито будувався для довшого тексту: кінець далеко за межею. */
          start: c.text.length - 3,
          end: c.text.length + 400,
          expectedOld: "byloshchos",
          newText: "ne maie zapysatys",
        }),
        edit({
          containerId: c.containerId,
          start,
          end: start + "pomylka".length,
          expectedOld: "pomylka",
          newText: "vypravleno",
        }),
      ],
      { stamp: "poza-mezhamy" },
    );

    expect(report.applied).toHaveLength(1);
    expect(report.failed).toHaveLength(0);
    expect(report.skipped).toHaveLength(1);
    expect(report.skipped[0]!.requestId).toBe("poza");
    expect(report.skipped[0]!.reason).toContain("out of the container's bounds");

    /* Валідна правка пачки лягла — позамежна її не завалила. */
    expect(await textOfContainer((x) => x.containerId === c.containerId)).toBe(
      BASE_TEXT_1.replace("pomylka", "vypravleno"),
    );
  });
});

/*
 * Important 4. Виняток посеред пачки раніше знищував ВЕСЬ звіт: правки 1..k
 * лишалися записаними, а користувач отримував лише текст помилки ExtendScript —
 * без backupPath і без переліку того, що встигло лягти. Реалістичний випадок:
 * одна правка видаляє символ-якір виноски, а наступна цілиться в саму виноску,
 * якої після цього вже немає, — resolveContainer кидає.
 */
describe("apply_edits: виняток на одній правці не з'їдає звіт (Important 4)", () => {
  it("збирає невдалу правку в failed[] і все одно повертає звіт із backupPath", async () => {
    const containers = await readContainers();
    const footnote = containers.find((x) => x.kind === "footnote")!;
    expect(footnote).toBeTruthy();
    /* Story, у якій живе виноска: останній її символ — якір цієї виноски. */
    const host = containers.find(
      (x) => x.kind === "text" && footnote.containerId.startsWith(x.containerId + "/"),
    )!;
    expect(host).toBeTruthy();

    const anchorChar = host.text.slice(-1);
    const opStart = footnote.text.indexOf("opecatka");
    expect(opStart).toBeGreaterThanOrEqual(0);

    const report = await applyEdits(
      [
        /* Спершу зносимо якір виноски... */
        edit({
          requestId: "znos",
          candidateId: "znos#0",
          action: "delete",
          containerId: host.containerId,
          start: host.text.length - 1,
          end: host.text.length,
          expectedOld: anchorChar,
          newText: "",
        }),
        /* ...а потім цілимося у виноску, якої вже немає. */
        edit({
          requestId: "vynoska",
          candidateId: "vynoska#0",
          containerId: footnote.containerId,
          start: opStart,
          end: opStart + "opecatka".length,
          expectedOld: "opecatka",
          newText: "vypravleno",
        }),
      ],
      { stamp: "vynyatok" },
    );

    /* Звіт повернувся цілим — це і є суть виправлення. */
    expect(report.backupPath).toContain("_backups");
    expect(existsSync(report.backupPath)).toBe(true);
    expect(report.applied).toHaveLength(1);
    expect(report.applied[0]!.requestId).toBe("znos");
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0]!.requestId).toBe("vynoska");
    expect(report.failed[0]!.reason.length).toBeGreaterThan(0);
  });
});

/*
 * Біла пляма рецензії (б): запис саме в комірку таблиці й у виноску живим
 * тестом не проганявся. resolveContainer для них покритий Task 6/7, але сам
 * ЗАПИС — ні. Це остання непокрита гілка запису.
 */
describe("apply_edits: запис у комірку таблиці й у виноску", () => {
  it("замінює текст усередині комірки таблиці", async () => {
    const cell = (await readContainers()).find((x) => x.kind === "table")!;
    expect(cell).toBeTruthy();
    expect(cell.text).toBe("Yacheika z opecatka vseredyni.");
    const start = cell.text.indexOf("opecatka");

    const report = await applyEdits(
      [
        edit({
          containerId: cell.containerId,
          start,
          end: start + "opecatka".length,
          expectedOld: "opecatka",
          newText: "vypravleno",
        }),
      ],
      { stamp: "cell" },
    );

    expect(report.applied).toHaveLength(1);
    expect(report.failed).toHaveLength(0);
    expect(await textOfContainer((x) => x.containerId === cell.containerId)).toBe(
      "Yacheika z vypravleno vseredyni.",
    );
  });

  it("замінює текст усередині виноски", async () => {
    const footnote = (await readContainers()).find((x) => x.kind === "footnote")!;
    expect(footnote).toBeTruthy();
    expect(footnote.text).toContain("Vynoska z opecatka vseredyni.");
    const start = footnote.text.indexOf("opecatka");

    const report = await applyEdits(
      [
        edit({
          containerId: footnote.containerId,
          start,
          end: start + "opecatka".length,
          expectedOld: "opecatka",
          newText: "vypravleno",
        }),
      ],
      { stamp: "footnote" },
    );

    expect(report.applied).toHaveLength(1);
    expect(report.failed).toHaveLength(0);
    expect(await textOfContainer((x) => x.containerId === footnote.containerId)).toContain(
      "Vynoska z vypravleno vseredyni.",
    );
  });
});

/*
 * Task 6 довів збіг символьних індексів JS-рядка й InDesign для ЧИТАННЯ.
 * Тут те саме доводиться для ЗАПИСУ — конкретними числами, з окремою увагою
 * до em dash (один символ, не два) і до контейнера з overset.
 */
describe("apply_edits: символьні офсети запису збігаються з JS-рядком", () => {
  it("em dash — рівно один символ: заміна після нього лягає точно на місце", async () => {
    /* Пін-перевірка самої фікстури: em dash стоїть на індексі 5. */
    expect(BASE_TEXT_1.indexOf("—")).toBe(5);
    expect(BASE_TEXT_1.indexOf("stolytsia")).toBe(7);

    const c = (await readContainers()).find((x) => x.text === BASE_TEXT_1)!;
    expect(c.text.indexOf("stolytsia")).toBe(7);

    const report = await applyEdits(
      [
        edit({
          containerId: c.containerId,
          start: 7,
          end: 7 + "stolytsia".length,
          expectedOld: "stolytsia",
          newText: "STOLYCIA",
        }),
      ],
      { stamp: "test-dash" },
    );

    expect(report.applied).toHaveLength(1);
    const after = await textOfContainer((x) => x.containerId === c.containerId);
    expect(after).toBe("Kyiv — STOLYCIA Ukrainy. Cei tekst mistyt slovo pomylka dlia testu.");
    /* Тире на місці й досі одне: наступний символ після нього — пробіл. */
    expect(after.indexOf("—")).toBe(5);
    expect(after.charAt(6)).toBe(" ");
  });

  it("пише в невидиму (overset) частину контейнера за тими самими офсетами", async () => {
    const c = (await readContainers()).find((x) => x.text === BASE_TEXT_2)!;
    expect(c.oversetFrom).not.toBeNull();

    const start = c.text.indexOf("overset");
    /* Слово навмисно взяте з невидимої частини — саме там перевіряємо офсети. */
    expect(start).toBeGreaterThanOrEqual(c.oversetFrom!);

    const report = await applyEdits(
      [
        edit({
          containerId: c.containerId,
          start,
          end: start + "overset".length,
          expectedOld: "overset",
          newText: "OVERSET",
        }),
      ],
      { stamp: "test-over" },
    );

    expect(report.applied).toHaveLength(1);
    expect(report.oversetBefore).toContain(c.containerId);
    expect(await textOfContainer((x) => x.containerId === c.containerId)).toBe(
      BASE_TEXT_2.replace("overset", "OVERSET"),
    );
  });
});

/*
 * Третій запобіжник спека. Доводиться не тим, що після одного скасування текст
 * повернувся, а тим, що скасовано РІВНО один крок: перша пачка з двох правок
 * після одного undo лишається на місці, і зникає лише друга пачка. Якби пачка
 * не була одним кроком, перше ж undo відкотило б лише половину правок.
 */
describe("apply_edits: одна пачка — рівно один крок скасування", () => {
  it("одне скасування відкочує всю другу пачку й не чіпає першу", async () => {
    const c = (await readContainers()).find((x) => x.text === BASE_TEXT_1)!;
    const id = c.containerId;

    /* Пачка 1: дві правки в одному виклику. */
    const first = await applyEdits(
      [
        edit({
          requestId: "r1",
          candidateId: "c1",
          containerId: id,
          start: c.text.indexOf("Kyiv"),
          end: c.text.indexOf("Kyiv") + 4,
          expectedOld: "Kyiv",
          newText: "Lviv",
        }),
        edit({
          requestId: "r2",
          candidateId: "c2",
          containerId: id,
          start: c.text.indexOf("testu"),
          end: c.text.indexOf("testu") + 5,
          expectedOld: "testu",
          newText: "proby",
        }),
      ],
      { stamp: "undo1", undoName: "Пачка 1" },
    );
    expect(first.applied).toHaveLength(2);

    const afterFirst = BASE_TEXT_1.replace("Kyiv", "Lviv").replace("testu", "proby");
    expect(await textOfContainer((x) => x.containerId === id)).toBe(afterFirst);

    /* Пачка 2: окремий виклик — окремий крок історії. */
    const second = await applyEdits(
      [
        edit({
          requestId: "r3",
          candidateId: "c3",
          containerId: id,
          start: afterFirst.indexOf("pomylka"),
          end: afterFirst.indexOf("pomylka") + "pomylka".length,
          expectedOld: "pomylka",
          newText: "vypravl",
        }),
      ],
      { stamp: "undo2", undoName: "Пачка 2" },
    );
    expect(second.applied).toHaveLength(1);

    /* Одне скасування: зникає ВСЯ друга пачка й НІЧОГО з першої. */
    await assertFixtureActive(docName!);
    await runJsx("__undo_once", { name: docName });
    expect(await textOfContainer((x) => x.containerId === id)).toBe(afterFirst);

    /* Ще одне скасування: обидві правки першої пачки зникають РАЗОМ. */
    await assertFixtureActive(docName!);
    await runJsx("__undo_once", { name: docName });
    expect(await textOfContainer((x) => x.containerId === id)).toBe(BASE_TEXT_1);
  });

  it("__undo_once відмовляється скасовувати в документі з іншою назвою", async () => {
    await expect(runJsx("__undo_once", { name: "chuzhyi-dokument.indd" })).rejects.toThrow(
      /Nothing was undone/,
    );
  });
});

/*
 * B4 (ЗМІНЕНО з попередньої поведінки Фази 1). До Task 13 глобальне обмеження
 * спека стверджувало: «у документ пишеться рівно те, що в полі new» — і цей
 * тест це перевіряв буквально, дослівним рядком з прямими лапками. B4 скасовує
 * саме це обмеження: перед записом `new` проходить типографські правила В
 * КОНТЕКСТІ ШВА (planner.ts → normalizeAtSeam), і план/запис несуть writeText,
 * а не сире `new`. Прогнавши цей тест проти живого InDesign (а не проти мокá),
 * отримали: `"тут"` (прямі лапки) стає «тут» (ялинки, бо на цій глибині
 * вкладення це зовнішні лапки — «Львів» уже закрився й обнулив depth). Це не
 * побічний ефект і не регресія — це саме та поведінка, яку Task 13 і мав
 * увімкнути: quotes-uk із UK_RULES тепер працює на `new`, а не лише як
 * окремий прохід. Тест перейменовано й переписано на очікування B4, а
 * незалежна перевірка «InDesign сам не підмінює прямі лапки, поки
 * typographersQuotes вимкнено на час запису» лишається — це той самий
 * запобіжник apply_edits, і B4 його не стосується.
 */
describe("apply_edits: new проходить нормалізацію в контексті шва (B4)", () => {
  it("запит зі звичайним дефісом знаходить em dash; new нормалізується до writeText кандидата", async () => {
    const containers = await readContainers();
    const plan = buildPlan({
      planId: "p-norm",
      docName: docName!,
      requests: [
        {
          id: "r1",
          action: "replace",
          /* Дефіс-мінус замість em dash і прямі лапки — matcher це зіставляє. */
          old: 'Kyiv - stolytsia',
          new: '«Львів» — не-нормалізовано "тут"',
        },
      ],
      containers,
    });

    expect(plan.items[0]!.status).toBe("unique");
    const cand = plan.items[0]!.candidates[0]!;
    /* Що знайдено в документі — це em dash, а не дефіс із запиту. */
    expect(cand.matchText).toBe("Kyiv — stolytsia");

    /*
     * B4: writeText — це `new` ПІСЛЯ нормалізації в контексті шва. Тире вже
     * типографське й «Львів» уже в правильних лапках, тож правило зачіпає
     * лише внутрішні прямі лапки навколо "тут" — на цій глибині вкладення
     * (0, бо «Львів» устиг закритися) вони зовнішні, тож стають «тут», а не
     * “тут”.
     */
    expect(cand.writeText).toBe('«Львів» — не-нормалізовано «тут»');
    expect(cand.normalizations.map((n) => n.ruleId)).toContain("quotes-uk");

    const edits = orderForApply(
      toAcceptedEdits(plan, [{ requestId: "r1", candidateId: cand.candidateId }]),
    );
    /* toAcceptedEdits бере cand.writeText, а не сире request.new (Крок 7). */
    expect(edits[0]!.newText).toBe('«Львів» — не-нормалізовано «тут»');

    /* Ambient-стан до запису: обидва прапорці належать користувачеві. */
    const stateBefore = await runJsx<AppState>("__debug_app_state", { name: docName });
    expect(stateBefore.typographersQuotes).toBe(true);

    const report = await applyEdits(edits, { stamp: "test-norm" });
    expect(report.applied).toHaveLength(1);

    /*
     * Перевіряємо, що в документі лежить рівно writeText (нормалізований B4
     * текст), і що це не InDesign сам підмінив прямі лапки на парні за
     * власним ambient-налаштуванням (doc.textPreferences.typographersQuotes,
     * яке apply_edits вимикає на час запису) — адже в writeText прямих лапок
     * уже немає: наша нормалізація випередила б і замаскувала таку підміну.
     * Тому ця перевірка й далі ловить регресію запобіжника №2, лише іншим
     * рядком, що відповідає новій, а не старій поведінці.
     */
    expect(await textOfContainer((x) => x.containerId === cand.containerId)).toBe(
      BASE_TEXT_1.replace("Kyiv — stolytsia", '«Львів» — не-нормалізовано «тут»'),
    );

    /*
     * Обидва ambient-прапорці мусять повернутися як були: і «типографські
     * лапки» документа, і рівень взаємодії застосунку (запобіжник №2 вимикає
     * діалоги лише на час запису й не має лишати NEVER_INTERACT назавжди —
     * інакше InDesign перестав би питати користувача про будь-що).
     */
    const stateAfter = await runJsx<AppState>("__debug_app_state", { name: docName });
    expect(stateAfter).toEqual(stateBefore);
  });

  /*
   * Рецензія Task 13, раунд 2 (Critical). Тест вище довів, що quotes-uk
   * ПЕРЕТВОРЮЄ прямі лапки, коли їх треба перетворити — але після нормалізації
   * в записаному тексті не лишилось ЖОДНОЇ прямої лапки, тож той тест нічого
   * не каже про те, чи досі працює `IDMCP.withLiteralText` (src/jsx/apply.jsx):
   * механізм, що вимикає ambient-підміну InDesign (typographersQuotes) на час
   * запису, аби пряма лапка, яка МАЄ лишитися прямою, не була мовчки з'їдена
   * самим InDesign. Без окремого тесту, де пряма лапка законно виживає seam-
   * нормалізацію, ця гарантія лишається неперевіреною жодним тестом у сюїті.
   *
   * rules-uk.ts (Task 11) навмисно НЕ чіпає пряму лапку одразу після цифри —
   * дюймова позначка (15"), а не лапка (див. tests/unit/rules-uk.test.ts,
   * «дюйми після числа не стають лапками»). Це рівно той природний випадок,
   * коли writeText після нормалізації ще містить пряму лапку. Спершу
   * звіряємо це проти самої normalizeAtSeam/плану (без InDesign), а потім —
   * що в РЕАЛЬНОМУ документі справді лежить пряма лапка, а не «розумна».
   */
  it("дюймова позначка (15\") переживає нормалізацію — withLiteralText і далі захищає пряму лапку", async () => {
    const containers = await readContainers();
    const plan = buildPlan({
      planId: "p-inches",
      docName: docName!,
      requests: [
        {
          id: "r1",
          action: "replace",
          old: "slovo pomylka",
          new: 'екран 15" завширшки',
        },
      ],
      containers,
    });

    expect(plan.items[0]!.status).toBe("unique");
    const cand = plan.items[0]!.candidates[0]!;

    /*
     * writeText === new дослівно: дюймова позначка не мала жодного правила,
     * що її зачепить, тож normalizations порожній — це не "нормалізація
     * нічого не змінила", а "нормалізація підтвердила: пряму лапку чіпати
     * не можна".
     */
    expect(cand.writeText).toBe('екран 15" завширшки');
    expect(cand.writeText).toContain('15"');
    expect(cand.normalizations).toEqual([]);

    const edits = orderForApply(
      toAcceptedEdits(plan, [{ requestId: "r1", candidateId: cand.candidateId }]),
    );
    expect(edits[0]!.newText).toBe('екран 15" завширшки');

    const stateBefore = await runJsx<AppState>("__debug_app_state", { name: docName });
    expect(stateBefore.typographersQuotes).toBe(true);

    const report = await applyEdits(edits, { stamp: "test-inches" });
    expect(report.applied).toHaveLength(1);

    /*
     * Головна перевірка: у РЕАЛЬНОМУ документі лежить літеральна пряма лапка
     * (U+0022), а не InDesign-івська «розумна» заміна. Якби withLiteralText
     * був зламаний, ambient typographersQuotes InDesign підмінив би її на
     * лапку-ялинку чи дюймовий знак-примітив під час самого запису — і рядок
     * нижче б не збігся.
     */
    const written = await textOfContainer((x) => x.containerId === cand.containerId);
    expect(written).toBe(BASE_TEXT_1.replace("slovo pomylka", 'екран 15" завширшки'));
    expect(written).toContain('15"');
    expect(written.includes("”") || written.includes("»")).toBe(false);

    const stateAfter = await runJsx<AppState>("__debug_app_state", { name: docName });
    expect(stateAfter).toEqual(stateBefore);
  });
});

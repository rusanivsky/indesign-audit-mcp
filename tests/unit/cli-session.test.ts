import { homedir } from "node:os";
import { describe, expect, it } from "vitest";
import { chooseDocument, normalizePathForComparison, openSession, SessionError } from "../../src/cli/run/session.js";
import type { ToolBox, ToolResult } from "../../src/cli/collect.js";

const шлях = "/тека/Book 260816-1250.indd";

/**
 * Задача G: `openSession` шле в `indesign_run_jsx` ТРИ різні скрипти —
 * `app.open()`, перемикання активного документа (R41) і перевірку-й-
 * закриття з `release()`. Розрізняти їх ПОРЯДКОВИМ НОМЕРОМ виклику, як
 * робили фейкові коробки нижче до цієї задачі, більше не можна: кожен
 * новий виклик мовчки зсував би відповіді на один і давав би скриптові
 * чужий результат. Розрізняємо за ВМІСТОМ — тим самим, чим їх розрізняє
 * сам InDesign.
 */
function відповідьНаСкрипт(
  script: string,
  документи: Array<{ name: string; fullName: string | null }>,
  закриття: { closed: boolean; reason?: string },
): unknown {
  if (script.includes("app.open(")) return "ok";
  if (script.includes("var __p ")) {
    // Повернення попереднього активного (у цих блоках не виникає: до
    // прогону тут не відкрито жодного документа, тож і повертати нема що).
    return { restored: false, active: null };
  }
  if (script.includes("app.activeDocument =")) {
    /* InDesign, який завжди слухається: назву беремо з самого скрипта
     * (`var __name = "…"`), шлях — із переліку відкритих документів. Ці
     * блоки перевіряють НЕ перемикання, тож їм потрібне саме слухняне
     * середовище; перемикання перевіряє власний блок наприкінці файлу.
     *
     * `switched: false` — після `app.open()` документ активний за
     * побудовою, тож зонд нічого не перемикав; це той самий стан, що дає
     * справжній InDesign на цій гілці. */
    const назва = /var __name = "(.*?)";/.exec(script)?.[1] ?? null;
    const док = документи.find((d) => d.name === назва);
    return {
      found: true,
      sameNameCount: 1,
      beforeName: назва,
      switched: false,
      active: назва,
      activeFullName: док?.fullName ?? null,
    };
  }
  return закриття;
}

/** Скрипт закриття — за ВМІСТОМ, не за номером виклику (задача G). */
function скриптЗакриття(виклики: readonly string[]): string {
  return виклики.find((c) => c.includes(".close(")) ?? "";
}

describe("chooseDocument", () => {
  it("приєднується до вже відкритого документа", () => {
    const r = chooseDocument(
      { documents: [{ name: "Book 260816-1250.indd", fullName: шлях, modified: true }] },
      шлях,
    );
    expect(r.action).toBe("attach");
    expect(r.docName).toBe("Book 260816-1250.indd");
  });

  it("відкриває, коли документа не відкрито", () => {
    expect(chooseDocument({ documents: [] }, шлях).action).toBe("open");
  });

  it("приєднується, навіть коли відкрито ще й інші документи", () => {
    const r = chooseDocument(
      {
        documents: [
          { name: "чужий.indd", fullName: "/інше/чужий.indd", modified: false },
          { name: "Book 260816-1250.indd", fullName: шлях, modified: false },
        ],
      },
      шлях,
    );
    expect(r.action).toBe("attach");
  });

  it("ВІДМОВЛЯЄ, коли відкрито інші документи, а цільового серед них немає", () => {
    // Активність живе на вікні; app.activeDocument = doc мовчки не спрацьовує.
    // Відкрити свій документ поверх чужих — виміряти не той.
    expect(() =>
      chooseDocument(
        { documents: [{ name: "чужий.indd", fullName: "/інше/чужий.indd", modified: true }] },
        шлях,
      ),
    ).toThrow(SessionError);
  });

  it("відмова називає, що саме відкрито — інакше її не виправити", () => {
    try {
      chooseDocument(
        { documents: [{ name: "чужий.indd", fullName: "/інше/чужий.indd", modified: true }] },
        шлях,
      );
      throw new Error("мало відмовити");
    } catch (e) {
      expect((e as Error).message).toMatch(/чужий\.indd/);
    }
  });

  // Рецензія задачі 4, знахідка #1: збіг лише за basename із ІНШОЇ теки —
  // це не той самий документ. Раніше `chooseDocument` приєднувалась до
  // нього мовчки; тепер це має потрапляти у звичайну відмову «відкрито
  // чуже», а не в attach.
  it("однакова назва файлу, РІЗНА тека — НЕ приєднується (може виміряти не той документ)", () => {
    expect(() =>
      chooseDocument(
        {
          documents: [
            {
              name: "Book 260816-1250.indd",
              fullName: "/зовсім/інша/тека/Book 260816-1250.indd",
              modified: true,
            },
          ],
        },
        шлях,
      ),
    ).toThrow(SessionError);
  });

  // Незбережений документ (fullName === null) — не з диска, тож звірити
  // шлях неможливо. Єдиний прийнятний сигнал тут — збіг за іменем, і лише
  // коли кандидат рівно один.
  it("незбережений документ (fullName === null), кандидат рівно один — приєднується", () => {
    const r = chooseDocument(
      { documents: [{ name: "Book 260816-1250.indd", fullName: null, modified: true }] },
      шлях,
    );
    expect(r.action).toBe("attach");
    expect(r.docName).toBe("Book 260816-1250.indd");
  });

  it("незбережені документи (fullName === null), кандидатів двоє — відмова через неоднозначність", () => {
    expect(() =>
      chooseDocument(
        {
          documents: [
            { name: "Book 260816-1250.indd", fullName: null, modified: true },
            { name: "Book 260816-1250.indd", fullName: null, modified: false },
          ],
        },
        шлях,
      ),
    ).toThrow(SessionError);
  });
});

/**
 * Рецензія задачі 4, знахідка #2: після `app.open` `release()` не сміє
 * закривати документ, якого не ідентифіковано ВИМІРОМ (різницею множин
 * «до» і «після»). Тестуємо на фейковій `ToolBox` — до реального InDesign
 * не звертаємось.
 */
describe("openSession — ідентифікація нового документа перед закриттям", () => {
  /**
   * Фейкова `ToolBox`: `indesign_status` на першому виклику каже «нічого
   * не відкрито» (щоб `chooseDocument` обрав `"open"`), на наступних —
   * повертає `документиПісля`. Відповідь на `indesign_run_jsx` добирає
   * `відповідьНаСкрипт` за ВМІСТОМ скрипта (`app.open()` → "ok",
   * перемикання → слухняне середовище, перевірка-й-закриття →
   * `результатПеревіркиЗакриття`, за замовчуванням успіх). Аргумент
   * читаємо з ключа `script` — саме його вимагає реальний обробник
   * (`src/jsx/run.jsx`), не `code`.
   */
  function makeBox(
    документиПісля: Array<{ name: string; fullName: string | null; modified: boolean }>,
    результатПеревіркиЗакриття: { closed: boolean; reason?: string } = { closed: true },
  ) {
    const виклики: string[] = [];
    const box: ToolBox = new Map();
    let лічильникСтатусу = 0;

    box.set("indesign_status", {
      handler: async (): Promise<ToolResult> => {
        лічильникСтатусу += 1;
        const дані = лічильникСтатусу === 1 ? { documents: [] } : { documents: документиПісля };
        return { content: [{ type: "text", text: JSON.stringify(дані) }] };
      },
    });

    box.set("indesign_run_jsx", {
      handler: async (args): Promise<ToolResult> => {
        const script = String((args as { script?: string }).script ?? "");
        виклики.push(script);
        const дані = відповідьНаСкрипт(script, документиПісля, результатПеревіркиЗакриття);
        return { content: [{ type: "text", text: JSON.stringify(дані) }] };
      },
    });

    return { box, виклики };
  }

  it("рівно один новий документ — release() закриває саме його (позитивний контроль)", async () => {
    const { box, виклики } = makeBox([
      { name: "Book 260816-1250.indd", fullName: шлях, modified: false },
    ]);
    const handle = await openSession(box, шлях);
    expect(handle.stamp.releaseSkippedReason).toBeNull();

    await handle.release();
    const закриття = виклики.filter((c) => c.includes(".close("));
    expect(закриття).toHaveLength(1);
    expect(закриття[0]).toMatch(/Book 260816-1250\.indd/);
  });

  /*
   * I8 (фінальна рецензія, Important): `release()` тепер кличеться ДВІЧІ —
   * на успішному шляху (щоб `releaseSkippedReason` устиг у
   * `measurements.json`) і в `finally` (щоб документ закрився й на шляху
   * збою середовища). Отже він мусить бути ідемпотентним ПО-СПРАВЖНЬОМУ:
   * без прапорця другий виклик пішов би в InDesign знову, не знайшов би
   * щойно закритого документа й переписав би причину на «документ із такою
   * назвою вже не відкритий» — тобто звіт про власне прибирання став би
   * неправдою рівно тому, що прибирання ВДАЛОСЯ.
   */
  it("I8: другий release() — цілковитий no-op: ні другого закриття, ні переписаної причини", async () => {
    const { box, виклики } = makeBox([
      { name: "Book 260816-1250.indd", fullName: шлях, modified: false },
    ]);
    const handle = await openSession(box, шлях);

    await handle.release();
    await handle.release();

    expect(виклики.filter((c) => c.includes(".close("))).toHaveLength(1);
    expect(handle.stamp.releaseSkippedReason).toBeNull();
  });

  it("нуль нових документів після відкриття — release() нічого не закриває", async () => {
    const { box, виклики } = makeBox([]);
    const handle = await openSession(box, шлях);
    expect(handle.stamp.releaseSkippedReason).not.toBeNull();

    await handle.release();
    expect(виклики.filter((c) => c.includes(".close("))).toHaveLength(0);
  });

  it("два нових документи після відкриття — release() нічого не закриває", async () => {
    const { box, виклики } = makeBox([
      { name: "А.indd", fullName: "/деінде/А.indd", modified: false },
      { name: "Б.indd", fullName: "/деінде/Б.indd", modified: false },
    ]);
    const handle = await openSession(box, шлях);
    expect(handle.stamp.releaseSkippedReason).not.toBeNull();

    await handle.release();
    expect(виклики.filter((c) => c.includes(".close("))).toHaveLength(0);
  });
});

/**
 * Рецензія задачі 4, раунд 2 (R13, рішення координатора): вікно між
 * `openSession` і `release()` — це ВЕСЬ аудит (хвилини, не мілісекунди).
 * За такий час користувач може закрити наш документ і відкрити ІНШИЙ під
 * тією самою назвою — `itemByName` цього не бачить. `release()` мусить
 * закривати лише коли документ знайдено за назвою, його `fullName`
 * збігається з тим, що ми відкривали, І він `modified === false`.
 */
describe("release() — потрійна умова перед закриттям (R13)", () => {
  const назва = "Book 260816-1250.indd";

  function makeBoxWithCloseCheck(результатПеревіркиЗакриття: { closed: boolean; reason?: string }) {
    const виклики: string[] = [];
    const box: ToolBox = new Map();
    let лічильникСтатусу = 0;
    const відкриті = [{ name: назва, fullName: шлях, modified: false }];

    box.set("indesign_status", {
      handler: async (): Promise<ToolResult> => {
        лічильникСтатусу += 1;
        const дані = лічильникСтатусу === 1 ? { documents: [] } : { documents: відкриті };
        return { content: [{ type: "text", text: JSON.stringify(дані) }] };
      },
    });

    box.set("indesign_run_jsx", {
      handler: async (args): Promise<ToolResult> => {
        const script = String((args as { script?: string }).script ?? "");
        виклики.push(script);
        const дані = відповідьНаСкрипт(script, відкриті, результатПеревіркиЗакриття);
        return { content: [{ type: "text", text: JSON.stringify(дані) }] };
      },
    });

    return { box, виклики };
  }

  it("документ змінений у проміжку → release() не закриває, releaseSkippedReason не null", async () => {
    const { box, виклики } = makeBoxWithCloseCheck({
      closed: false,
      reason: "документ має незбережені зміни — це не наш незайманий прогін",
    });
    const handle = await openSession(box, шлях);
    expect(handle.stamp.releaseSkippedReason).toBeNull(); // ще ДО release()

    await handle.release();
    expect(handle.stamp.releaseSkippedReason).not.toBeNull();
    expect(handle.stamp.releaseSkippedReason).toMatch(/незбережені зміни/);

    // Перевірка стану — ОДНИМ читанням усередині JSX (той самий виклик,
    // що й закриває), а не окремим indesign_status.
    const перевірка = скриптЗакриття(виклики);
    expect(перевірка).toContain(".modified");
  });

  it("fullName не той (документ підмінили в проміжку) → release() не закриває", async () => {
    const { box, виклики } = makeBoxWithCloseCheck({
      closed: false,
      reason: "шлях документа відрізняється від очікуваного — це вже не той документ",
    });
    const handle = await openSession(box, шлях);

    await handle.release();
    expect(handle.stamp.releaseSkippedReason).not.toBeNull();
    expect(handle.stamp.releaseSkippedReason).toMatch(/шлях/);

    const перевірка = скриптЗакриття(виклики);
    expect(перевірка).toContain(JSON.stringify(шлях));
    expect(перевірка).toContain("fullName");
  });

  it("усе збігається → release() закриває документ (позитивний контроль)", async () => {
    const { box, виклики } = makeBoxWithCloseCheck({ closed: true });
    const handle = await openSession(box, шлях);

    await handle.release();
    expect(handle.stamp.releaseSkippedReason).toBeNull();

    const перевірка = скриптЗакриття(виклики);
    expect(перевірка).toContain(".close(");
    expect(перевірка).toContain("SaveOptions.NO");
    expect(перевірка).toContain(JSON.stringify(шлях));
    expect(перевірка).toContain(JSON.stringify(назва));
  });
});

/**
 * Задача B+D, рулінг R27: `!__d.saved` і порівняння `fullName` РАНІШЕ
 * ділили одну гілку через `||` — незбережений документ (`saved === false`,
 * шлях нема з чим звіряти) діставав те саме повідомлення «шлях документа
 * відрізняється», що й документ із чужим шляхом, хоча причини різні.
 *
 * Тести вище (R13) мокають `indesign_run_jsx` — вони підставляють
 * ЗАДАНИЙ `{closed, reason}` і перевіряють лише, що він доходить до
 * `stamp.releaseSkippedReason`; самого розгалуження в JSX вони не
 * виконують (виконати JSX локально неможливо — це рядок для InDesign).
 * Тут інакше: `виконатиСценарій` бере СПРАВЖНІЙ рядок скрипта, який
 * `release()` щойно згенерував і передав у `indesign_run_jsx`
 * (пізнаний за вмістом, як і в тестах вище), і ВИКОНУЄ його
 * (`new Function`) проти фейкового `app`/`__d`/`SaveOptions` — так
 * перевіряється РЕАЛЬНА логіка розгалуження (`toRunScript` — це
 * `{script: body}` без жодної обгортки, `src/cli/run/session.ts:166-168`,
 * тож захоплений рядок ідентичний тому, що піде в InDesign), а не лише
 * факт, що мокований `reason` кудись доходить.
 */
describe("release() — незбережений документ і чужий шлях це РІЗНІ причини (R27)", () => {
  const назва = "Book 260816-1250.indd";

  /** Captures the script `release()` would send to `indesign_run_jsx`. */
  async function захопитиСкриптЗакриття(): Promise<string> {
    const box: ToolBox = new Map();
    let лічильникСтатусу = 0;
    let скрипт = "";
    const відкриті = [{ name: назва, fullName: шлях, modified: false }];

    box.set("indesign_status", {
      handler: async (): Promise<ToolResult> => {
        лічильникСтатусу += 1;
        const дані = лічильникСтатусу === 1 ? { documents: [] } : { documents: відкриті };
        return { content: [{ type: "text", text: JSON.stringify(дані) }] };
      },
    });

    box.set("indesign_run_jsx", {
      handler: async (args): Promise<ToolResult> => {
        const script = String((args as { script?: string }).script ?? "");
        if (script.includes(".close(")) скрипт = script;
        // Канонічний результат неважливий: скрипт виконуємо самі, нижче.
        const дані = відповідьНаСкрипт(script, відкриті, { closed: true });
        return { content: [{ type: "text", text: JSON.stringify(дані) }] };
      },
    });

    const handle = await openSession(box, шлях);
    await handle.release();
    return скрипт;
  }

  /**
   * Виконує захоплений скрипт проти фейкового `app.documents.itemByName`,
   * що завжди повертає `документ`, і повертає `__result`. `SaveOptions.NO`
   * і `__d.close` — фейкові заглушки: у сценаріях цього блоку жоден шлях
   * не доходить до `close()` (усі три — випадки ВІДМОВИ), крім
   * контрольного "усе гаразд" тесту, де close дійсно викликається.
   */
  function виконатиСценарій(
    script: string,
    документ: { isValid: boolean; saved: boolean; fullName: string | null; modified: boolean },
  ): { closed: boolean; reason?: string } {
    const app = {
      documents: {
        itemByName: () => ({ ...документ, close: () => {} }),
      },
    };
    const SaveOptions = { NO: "NO" };
    // eslint-disable-next-line no-new-func -- навмисне виконання захопленого JSX-тексту в пісочниці
    const fn = new Function("app", "SaveOptions", `var __result;\n${script}\nreturn __result;`);
    return fn(app, SaveOptions) as { closed: boolean; reason?: string };
  }

  it("документ НІКОЛИ не зберігався на диск → причина називає ЗБЕРЕЖЕННЯ, не шлях", async () => {
    const script = await захопитиСкриптЗакриття();
    const результат = виконатиСценарій(script, {
      isValid: true,
      saved: false,
      fullName: null,
      modified: false,
    });

    expect(результат.closed).toBe(false);
    // R27: власна причина, називає САМЕ збереження, а НЕ generic "шлях
    // документа відрізняється від очікуваного" (той текст, що раніше
    // діставали ОБИДВІ причини через спільну гілку `||`).
    expect(результат.reason).toMatch(/never saved to disk/i);
    expect(результат.reason).not.toBe("the document's path differs from what was expected — this isn't the document we opened anymore");
  });

  it("документ ЗБЕРІГАВСЯ, але шлях інший → причина називає ШЛЯХ, не збереження", async () => {
    const script = await захопитиСкриптЗакриття();
    const результат = виконатиСценарій(script, {
      isValid: true,
      saved: true,
      fullName: "/зовсім/інший/файл.indd",
      modified: false,
    });

    expect(результат.closed).toBe(false);
    expect(результат.reason).toBe(
      "the document's path differs from what was expected — this isn't the document we opened anymore",
    );
    expect(результат.reason).not.toMatch(/never saved to disk/i);
  });

  it("документ модифікований (шлях і збереження — гаразд) → причина називає ЗМІНИ", async () => {
    const script = await захопитиСкриптЗакриття();
    const результат = виконатиСценарій(script, {
      isValid: true,
      saved: true,
      fullName: шлях,
      modified: true,
    });

    expect(результат.closed).toBe(false);
    expect(результат.reason).toMatch(/unsaved changes/);
  });

  it("усе гаразд → скрипт РЕАЛЬНО закриває (позитивний контроль трьох гілок відмови)", async () => {
    const script = await захопитиСкриптЗакриття();
    const результат = виконатиСценарій(script, {
      isValid: true,
      saved: true,
      fullName: шлях,
      modified: false,
    });

    expect(результат.closed).toBe(true);
    expect(результат.reason).toBeUndefined();
  });
});

describe("normalizePathForComparison (R23)", () => {
  it("percent-decode: %20 стає пробілом", () => {
    expect(normalizePathForComparison("My%20Drive")).toBe("My Drive");
  });

  it("розгортає ПРОВІДНУ тильду в домівку", () => {
    expect(normalizePathForComparison("~/Library/foo")).toBe(`${homedir()}/Library/foo`);
  });

  it("тильда деінде в рядку (не на початку) залишається тильдою", () => {
    expect(normalizePathForComparison("/a/б~в/foo")).toBe("/a/б~в/foo");
  });

  it("Unicode NFD ('и' + комбінований бревіс) нормалізується до NFC ('й')", () => {
    const nfd = "й"; // и + COMBINING BREVE U+0306
    const nfc = "й"; // й, один символ
    expect(nfd).not.toBe(nfc); // контроль: рядки СПРАВДІ різні до нормалізації
    expect(normalizePathForComparison(nfd)).toBe(nfc);
  });

  it("некоректна percent-послідовність не кидає — обробка продовжується над сирим рядком", () => {
    expect(() => normalizePathForComparison("100% готово")).not.toThrow();
  });
});

/**
 * Рецензія задачі 4, раунд 3 (R23) — доведено ЖИВИМ прогоном CLI, а не
 * гіпотезою: `indesign_status` на реальному документі повертає `fullName`
 * із тильдою замість домівки, percent-encoding і Unicode NFD одночасно.
 * Рядок нижче — та сама форма, знята з живого прогону (дослівно, як дав
 * координатор), а не вигаданий POSIX-шлях, який і приховав ваду раніше.
 */
describe("chooseDocument — реальна форма fullName з Google Drive (R23)", () => {
  const реальнийFullName =
    "~/Library/CloudStorage/GoogleDrive-designer@example.com/My%20Drive/KR/Production/Design/" +
    "Book/" +
    "03%20%D0%A4%D0%B0%D0%B8%CC%86%D0%BB%D0%B8%20%D0%BF%D1%80%D0%BE%D1%94%D0%BA%D1%82%D1%83/" +
    "Book%20260816-1250.indd";

  // Побудований через homedir(), а не захардкоджений "/Users/designer" —
  // тест мусить генералізуватись на будь-яку машину, не лише цю.
  const цільовийПосіксШлях =
    `${homedir()}/Library/CloudStorage/GoogleDrive-designer@example.com/My Drive/KR/Production/Design/` +
    "Book/03 Файли проєкту/Book 260816-1250.indd";

  it("тильда + percent-encoding + Unicode NFD одночасно → приєднується", () => {
    const r = chooseDocument(
      { documents: [{ name: "Book 260816-1250.indd", fullName: реальнийFullName, modified: true }] },
      цільовийПосіксШлях,
    );
    expect(r.action).toBe("attach");
    expect(r.docName).toBe("Book 260816-1250.indd");
  });

  it("та сама назва файлу, ІНША тека (навіть у реальній Drive-формі) — захист R10 вистояв", () => {
    // Єдина відмінність від реального fullName — тека "KR" замінена на іншу.
    const іншаТекаFullName = реальнийFullName.replace("/KR/", "/ЗОВСІМ-ІНША-ТЕКА/");
    expect(() =>
      chooseDocument(
        { documents: [{ name: "Book 260816-1250.indd", fullName: іншаТекаFullName, modified: true }] },
        цільовийПосіксШлях,
      ),
    ).toThrow(SessionError);
  });

  it("release() звіряє СИРИЙ fullName від InDesign, зафіксований при відкритті, — не POSIX-шлях виклику", async () => {
    const назва = "Book 260816-1250.indd";
    const виклики: string[] = [];
    const box: ToolBox = new Map();
    let лічильникСтатусу = 0;
    const відкриті = [{ name: назва, fullName: реальнийFullName, modified: false }];

    box.set("indesign_status", {
      handler: async (): Promise<ToolResult> => {
        лічильникСтатусу += 1;
        const дані = лічильникСтатусу === 1 ? { documents: [] } : { documents: відкриті };
        return { content: [{ type: "text", text: JSON.stringify(дані) }] };
      },
    });

    box.set("indesign_run_jsx", {
      handler: async (args): Promise<ToolResult> => {
        const script = String((args as { script?: string }).script ?? "");
        виклики.push(script);
        const дані = відповідьНаСкрипт(script, відкриті, { closed: true });
        return { content: [{ type: "text", text: JSON.stringify(дані) }] };
      },
    });

    const handle = await openSession(box, цільовийПосіксШлях);
    await handle.release();

    expect(handle.stamp.releaseSkippedReason).toBeNull();
    const перевірка = скриптЗакриття(виклики);
    // R23: скрипт звіряє СИРИЙ fullName, який InDesign повернув при
    // відкритті (реальнийFullName) — НЕ POSIX-шлях виклику.
    expect(перевірка).toContain(JSON.stringify(реальнийFullName));
    expect(перевірка).not.toContain(JSON.stringify(цільовийПосіксШлях));
  });
});

/*
 * Виміряно на живому документі 2026-08-17. InDesign віддав назву
 * «02 Зоряні Мрії 2022 Print 3 copy.indd», у якій «ї» стоїть
 * РОЗКЛАДЕНОЮ: U+0456 + U+0308. Набрана з клавіатури «ї» — U+0457. Рядки
 * виглядають однаково, `===` дає false — і CLI відмовляв словами
 * «цільового серед них немає», друкуючи цю саму назву в переліку
 * відкритих. Незбережений документ адресувати можна ЛИШЕ назвою, тож без
 * нормалізації ця гілка не працює для української назви взагалі.
 */
describe("chooseDocument — незбережений документ і форма Unicode", () => {
  /* Послідовності задано ЯВНО escape'ами, а не набрано з клавіатури: набрані
   * виглядають однаково, і тест, у якому обидві форми виявились ОДНІЄЮ, зеленів
   * би на зламаному коді. Саме це сталося з першою редакцією цього тесту — там
   * стояла латинська «i» замість кириличної «і» (U+0456), тобто інший символ,
   * а не інша форма запису того самого. */
  const РОЗКЛАДЕНА = "02 Приклад Укра\u0456\u0308нською.indd"; // ї = і + діерезис
  const СКЛАДЕНА = "02 Приклад Укра\u0457нською.indd"; //        ї = один символ

  it("приєднується, коли InDesign дав NFD, а оператор набрав NFC", () => {
    const r = chooseDocument(
      { documents: [{ name: РОЗКЛАДЕНА, fullName: null, modified: true }] },
      СКЛАДЕНА,
    );
    expect(r.action).toBe("attach");
    expect(r.docName).toBe(РОЗКЛАДЕНА);
  });

  it("приєднується і в зворотний бік — NFC у InDesign, NFD в аргументі", () => {
    const r = chooseDocument(
      { documents: [{ name: СКЛАДЕНА, fullName: null, modified: true }] },
      РОЗКЛАДЕНА,
    );
    expect(r.action).toBe("attach");
  });

  /* Нормалізація не сміє злити РІЗНІ назви: вона зводить форми запису
   * того самого символу, а не схожі символи. */
  it("інший документ не стає збігом через нормалізацію", () => {
    expect(() =>
      chooseDocument(
        { documents: [{ name: "зовсім інша.indd", fullName: null, modified: true }] },
        СКЛАДЕНА,
      ),
    ).toThrow(SessionError);
  });
});

/*
 * Задача B (рулінг R26). `scripts/regression-book.mjs` дотепер тестів не
 * мав (спек §9 покриває лише `npm run test`; сам скрипт живе поза цим,
 * бо потребує живої книжки — див. коментар на самому початку скрипта).
 *
 * Тут — синтетичний `measurements.json` (не живий: живої книжки на іншій
 * машині немає, спек §9), що ЛІТЕРАЛЬНО відтворює баг, який зламав старий
 * скрипт: вузол із ключем "words" і значенням 2 (`overview.stories[0].
 * words`) лежить у ПЕРШОМУ за порядком проходів (`overview`), а справжнє
 * число (`spelling.languages[0].words === 31412`) — у ПІЗНІШОМУ ("spelling").
 * Старий пошук за назвою ключа (ДФС по всіх проходах) знаходив 2 і
 * зупинявся. Новий — адресується явно (прохід "spelling", шлях
 * ["languages", 0, "words"]) і decoy-вузол взагалі не бачить.
 *
 * Скрипт запускається як окремий процес (`node scripts/regression-
 * maaam.mjs <файл>`), а не імпортується: сам скрипт виконує свою логіку
 * одразу при завантаженні модуля (читає `process.argv`, друкує, викликає
 * `process.exit`) — це узгоджено з його призначенням окремого CLI-скрипта,
 * що живе поза `npm run test` (спек §9, §10). Дочірній процес — єдиний
 * спосіб перевірити РЕАЛЬНУ поведінку (stdout і код виходу), не
 * переписуючи скрипт заради тестабельності.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const СКРИПТ = join(process.cwd(), "scripts", "regression-book.mjs");

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "regression-book-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Базовий каркас `measurements.json` — stamp, спільний для всіх тестів. */
function stamp(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    docName: "Тест.indd",
    wasAlreadyOpen: false,
    modified: false,
    indesignVersion: "21.5.1.73",
    locale: "uk_UA",
    ...overrides,
  };
}

/**
 * Повний набір проходів з УСІМА значеннями, що ЗБІГАЮТЬСЯ з контрольними.
 *
 * H2-H4: доти чотири числа не збігалися й на ідеальній фікстурі — три не
 * мали адреси, одне не запитувалось. Тепер адресовані ВСІ, крім `maxTac`,
 * який лишається діркою спроможності (його не міряє жоден прохід, і
 * фікстурою це не лікується — саме тому він не рахується розбіжністю).
 *
 * Decoy-вузол `overview.stories[0].words = 2` — рівно той, що зламав
 * старий скрипт.
 */
function повнийНабірПроходів() {
  return [
    {
      id: "overview",
      ok: true,
      data: {
        pageCount: 196,
        // decoy: старий баг брав САМЕ це "words", бо overview йде першим
        stories: [{ words: 2 }],
        /* H3: шість лінків, усі NORMAL. Сьомий — НЕ NORMAL, щоб тест
         * стеріг сам предикат: лічильник, який рахує довжину масиву
         * замість збігу за полем, дав би 7 і впав. */
        links: [
          { name: "a.psd", status: "NORMAL" },
          { name: "b.psd", status: "NORMAL" },
          { name: "c.psd", status: "NORMAL" },
          { name: "d.psd", status: "NORMAL" },
          { name: "e.ai", status: "NORMAL" },
          { name: "f.ai", status: "NORMAL" },
          { name: "зниклий.psd", status: "LINK_MISSING" },
        ],
      },
    },
    { id: "color", ok: true, data: { inkCount: 4 } },
    {
      id: "pagination",
      ok: true,
      data: {
        folio: { checked: 131 },
        runningHead: { checked: 50 },
        contents: null, // конфіг родину contents не запитує — див. скрипт
      },
    },
    {
      id: "extras",
      ok: true,
      data: {
        sequences: [
          { style: "Нумерація питань", found: 185, parsed: 185, restarts: 12, breaks: [], unparsed: [] },
        ],
        /* R43: 416 = 398 + 18 відбивок у рамках змісту. */
        emptyParagraphs: 416,
        forcedBreaks: { total: 401, inBodyText: 27 },
      },
    },
    {
      id: "spelling",
      ok: true,
      data: {
        languages: [{ language: "uk", words: 31412 }],
        wordTypesTotal: 497,
        words: [], // SpellingReport.words — ІНШЕ поле (перелік типів), не число
      },
    },
  ];
}

/**
 * H2: `overset` — поле ВЕРХНЬОГО РІВНЯ вимірів, не всередині проходу, і
 * тримає воно ПОКАЗ (рядок), а не число: `oversetЗПоказу` може віддати
 * «н/д». Тому параметр окремий — щоб тест міг подати і «0», і «н/д».
 */
function записатиФікстуру(
  passes: unknown[],
  stampOverrides: Record<string, unknown> = {},
  overset: unknown = "0",
) {
  const файл = join(dir, "measurements.json");
  writeFileSync(
    файл,
    JSON.stringify({ stamp: stamp(stampOverrides), passes, overset }, null, 2),
    "utf8",
  );
  return файл;
}

/** `execFileSync` кидає на ненульовому коді виходу — стек несе stdout/status. */
function запустити(файл: string, конфіг?: string): { stdout: string; status: number } {
  const аргументи = конфіг === undefined ? [СКРИПТ, файл] : [СКРИПТ, файл, конфіг];
  try {
    const stdout = execFileSync("node", аргументи, { encoding: "utf8" });
    return { stdout, status: 0 };
  } catch (e) {
    const err = e as { stdout?: string; status?: number };
    return { stdout: err.stdout ?? "", status: err.status ?? -1 };
  }
}

/**
 * F7: конфіг, який скрипт читає другим аргументом. Без нього він бере
 * `configs/example-book.json` поруч зі собою — там `pagination.contents` уже
 * оголошено незастосовною (задача F2), і саме тому окремі фікстури тут
 * потрібні: без них годі перевірити ДРУГИЙ стан, «мусило бути й нема».
 */
function записатиКонфіг(pagination: Record<string, unknown>): string {
  const файл = join(dir, "конфіг.json");
  writeFileSync(
    файл,
    JSON.stringify({
      edition: { title: "Т", docPath: "/т/к.indd" },
      print: { minPpi: 300, maxTotalInk: 300, expectedInks: 4 },
      families: { pagination },
    }),
    "utf8",
  );
  return файл;
}

describe("regression-book.mjs — адресація за (прохід, шлях), не за назвою (B, R26)", () => {
  it("words: decoy-вузол `overview.stories[0].words=2` НЕ перемагає справжнє spelling.languages[0].words=31412", () => {
    const файл = записатиФікстуру(повнийНабірПроходів());
    const { stdout } = запустити(файл);

    // Правильне число, з правильної адреси.
    expect(stdout).toMatch(/✓ words\s+очікувано\s+31412\s+фактично\s+31412\s+\(spelling\.languages\.0\.words\)/);
    // Значення decoy (2) ніде не з'являється як "фактично" для words.
    expect(stdout).not.toMatch(/words[\s\S]*фактично\s+2\D/);
  });

  it("H2/H3/H4: три різні стани друкуються трьома різними рядками, а не однією купою", () => {
    // Конфіг БЕЗ оголошень: жодного свідомого пропуску, все як до F7.
    const файл = записатиФікстуру(повнийНабірПроходів());
    const { stdout, status } = запустити(файл, записатиКонфіг({}));

    // H2: адреса в корені вимірів; показ «0» стає числом.
    expect(stdout).toMatch(/✓ overset\s+очікувано\s+0\s+фактично\s+0\s+\(корінь\.overset\)/);
    // H3: іменований лічильник — предикат у самій адресі, щоб її було видно.
    expect(stdout).toMatch(
      /✓ linksNormal\s+очікувано\s+6\s+фактично\s+6\s+\(overview\.links\[status=NORMAL\]\)/,
    );
    // H4/R42: дірка спроможності — окремий значок, НЕ «✗», і не розбіжність.
    expect(stdout).toMatch(/◐ maxTac\s+очікувано\s+240\s+НЕ МІРЯЄ ЖОДЕН ПРОХІД/);
    expect(stdout).not.toMatch(/✗ maxTac/);
    // contentsNumbers: адреса Є, але дані null (підродину не запитано) —
    // ще один окремий стан: "НЕ ЗНАЙДЕНО".
    expect(stdout).toMatch(/✗ contentsNumbers\s+очікувано\s+35\s+фактично НЕ ЗНАЙДЕНО\s+\(pagination\.contents\.checked\)/);

    expect(stdout).toMatch(
      /РЕГРЕСІЯ: ВПАЛА — розбіжностей 1, свідомих пропусків 0, дірок спроможності 1\./,
    );
    expect(status).toBe(1);
  });

  /*
   * H2, межа: `overset` тримає ПОКАЗ. «н/д» означає «preflight не виміряли»,
   * і прочитатись як «overset нуль, чисто» воно не сміє — це рівно та
   * підміна, проти якої стоїть R46.
   */
  it("H2: нечисловий показ overset («н/д») падає розбіжністю, а не читається нулем", () => {
    const файл = записатиФікстуру(повнийНабірПроходів(), {}, "н/д");
    const { stdout } = запустити(файл);

    expect(stdout).toMatch(/✗ overset\s+очікувано\s+0\s+фактично\s+н\/д/);
    expect(stdout).not.toMatch(/✓ overset/);
  });

  /*
   * H3, межа: лічильник мусить рахувати ЗБІГ ЗА ПОЛЕМ, а не довжину масиву.
   * Фікстура несе сьомий лінк зі статусом LINK_MISSING саме для цього.
   */
  it("H3: лічильник рахує предикат, а не довжину масиву", () => {
    const файл = записатиФікстуру(повнийНабірПроходів());
    const { stdout } = запустити(файл);
    expect(stdout).toMatch(/✓ linksNormal\s+очікувано\s+6\s+фактично\s+6/);
    expect(stdout).not.toMatch(/linksNormal[^\n]*фактично\s+7/);
  });

  /*
   * H3, друга межа: відсутній масив — це РОЗБІЖНІСТЬ, а не нуль. «Жодного
   * NORMAL» і «лінків не читали» — різні твердження, і повертати 0 за
   * обидва означало б сказати перше там, де правда друге.
   */
  it("H3: відсутній масив дає НЕ ЗНАЙДЕНО, а не 0", () => {
    const passes = повнийНабірПроходів().map((p) =>
      p.id === "overview" ? { ...p, data: { ...p.data, links: undefined } } : p,
    );
    const файл = записатиФікстуру(passes);
    const { stdout } = запустити(файл);
    expect(stdout).toMatch(/✗ linksNormal\s+очікувано\s+6\s+фактично НЕ ЗНАЙДЕНО/);
    expect(stdout).not.toMatch(/linksNormal[^\n]*фактично\s+0\b/);
  });

  it("десять адресованих контрольних чисел на повній фікстурі — усі ЗБІГАЮТЬСЯ (мутаційний контроль self-check)", () => {
    const файл = записатиФікстуру(повнийНабірПроходів());
    const { stdout } = запустити(файл);

    for (const [назва, значення] of [
      ["pages", 196],
      ["inks", 4],
      ["folios", 131],
      ["runningHeads", 50],
      ["questionNumbers", 185],
      ["unknownWordTypes", 497],
      ["emptyParagraphs", 416],
      ["forcedBreaksTotal", 401],
      ["forcedBreaksInBody", 27],
    ] as const) {
      const рядок = new RegExp(`✓ ${назва}\\s+очікувано\\s+${значення}\\s+фактично\\s+${значення}\\b`);
      expect(stdout, `${назва} мав збігтись`).toMatch(рядок);
    }
  });

  it("прохід, що впав (ok:false), дає ГОЛОСНЕ «НЕ ЗНАЙДЕНО» для адрес усередині нього — не 0 і не сусіднє число", () => {
    const passes = повнийНабірПроходів().map((p) =>
      p.id === "pagination" ? { id: "pagination", ok: false, data: null } : p,
    );
    const файл = записатиФікстуру(passes);
    const { stdout, status } = запустити(файл, записатиКонфіг({}));

    expect(stdout).toMatch(/✗ folios\s+очікувано\s+131\s+фактично НЕ ЗНАЙДЕНО\s+\(pagination\.folio\.checked\)/);
    expect(stdout).toMatch(/✗ runningHeads\s+очікувано\s+50\s+фактично НЕ ЗНАЙДЕНО\s+\(pagination\.runningHead\.checked\)/);
    expect(status).toBe(1);
  });
});

/*
 * F7 / рулінг R34: «свідомо не оголошено» — це НЕ «мусило бути й нема».
 *
 * `contentsNumbers` = 35 має справжню адресу (`pagination.contents.checked`),
 * але виміряне не буде ніколи: R29 свідомо не оголошує підродину `contents`.
 * Тобто регресія падала б ЗАВЖДИ, а спек §6.4 називає це прямо: «ворота, що
 * горять постійно, — не ворота».
 *
 * Ціна помилки в другий бік теж названа (R34): надто широкий пропуск сховав
 * би СПРАВЖНЮ втрату виміру. Тому перший тест тут — саме мутаційний контроль
 * цієї межі: той самий вимір, той самий скрипт, конфіг БЕЗ оголошення —
 * і число мусить лишитись розбіжністю.
 */
describe("regression-book.mjs — свідомий пропуск проти справжньої втрати (F7, R34)", () => {
  const ПРИЧИНА = "35 чисел змісту — інстанси текстової змінної, звіряти нема чого";

  it("оголошено в конфігу → ПРОПУСК із дослівною причиною, і розбіжністю НЕ рахується", () => {
    const файл = записатиФікстуру(повнийНабірПроходів());
    const конфіг = записатиКонфіг({
      folio: { styleName: "Колонтитул v1" },
      contents: { notApplicable: ПРИЧИНА },
    });
    const { stdout } = запустити(файл, конфіг);

    expect(stdout).toMatch(
      /⊘ contentsNumbers\s+очікувано\s+35\s+СВІДОМО НЕ ОГОЛОШЕНО \(pagination\.contents\)/,
    );
    // Дослівно — не переказ скрипта.
    expect(stdout).toContain(`причина з конфіга: ${ПРИЧИНА}`);
    // Три БЕЗ АДРЕСИ лишаються розбіжностями; contentsNumbers — ні.
    expect(stdout).toMatch(/РЕГРЕСІЯ: ПРОЙШЛА — розбіжностей 0, свідомих пропусків 1, дірок спроможності 1\./);
  });

  it("НЕ оголошено → лишається РОЗБІЖНІСТЮ (пропуск не сміє бути ширшим за конфіг)", () => {
    const файл = записатиФікстуру(повнийНабірПроходів());
    const конфіг = записатиКонфіг({ folio: { styleName: "Колонтитул v1" } });
    const { stdout } = запустити(файл, конфіг);

    expect(stdout).not.toMatch(/⊘ contentsNumbers/);
    expect(stdout).toMatch(/✗ contentsNumbers\s+очікувано\s+35\s+фактично НЕ ЗНАЙДЕНО/);
    expect(stdout).toMatch(/РЕГРЕСІЯ: ВПАЛА — розбіжностей 1, свідомих пропусків 0, дірок спроможності 1\./);
  });

  it("порожня причина пропуску НЕ дає: пропуск без причини — той самий тихий нуль", () => {
    // Той самий предикат, що й `isNotApplicable` у схемі конфіга: причина
    // мусить бути непорожня, інакше пропуск невідрізненний від недогляду.
    const файл = записатиФікстуру(повнийНабірПроходів());
    const конфіг = записатиКонфіг({ contents: { notApplicable: "   " } });
    const { stdout } = запустити(файл, конфіг);

    expect(stdout).not.toMatch(/⊘ contentsNumbers/);
    expect(stdout).toMatch(/РЕГРЕСІЯ: ВПАЛА — розбіжностей 1, свідомих пропусків 0, дірок спроможності 1\./);
  });

  it("оголошена РОДИНА цілком пропускає всі свої числа, не лише одне", () => {
    const файл = записатиФікстуру(повнийНабірПроходів());
    const конфіг = записатиКонфіг({ notApplicable: "у виданні немає колонцифр і змісту" });
    const { stdout } = запустити(файл, конфіг);

    for (const назва of ["folios", "runningHeads", "contentsNumbers"]) {
      expect(stdout, `${назва} мав стати пропуском`).toMatch(
        new RegExp(`⊘ ${назва}\\s+очікувано\\s+\\d+\\s+СВІДОМО НЕ ОГОЛОШЕНО \\(pagination\\)`),
      );
    }
    expect(stdout).toMatch(/РЕГРЕСІЯ: ПРОЙШЛА — розбіжностей 0, свідомих пропусків 3, дірок спроможності 1\./);
  });

  it("конфіг не прочитано → УВАГА в stdout і жодного пропуску, а не тиха зміна поведінки", () => {
    const файл = записатиФікстуру(повнийНабірПроходів());
    const { stdout } = запустити(файл, join(dir, "конфіга-немає.json"));

    expect(stdout).toMatch(/УВАГА: конфіг .* не прочитано/);
    expect(stdout).toMatch(/РЕГРЕСІЯ: ВПАЛА — розбіжностей 1, свідомих пропусків 0, дірок спроможності 1\./);
  });

  it("СПРАВЖНІЙ configs/example-book.json (замовчування другого аргументу) оголошує contents", () => {
    // Без другого аргументу скрипт бере конфіг ПОРУЧ ІЗ СОБОЮ. Саме так його
    // запускає оператор — і саме там після F2 стоїть оголошення R29.
    const файл = записатиФікстуру(повнийНабірПроходів());
    const { stdout } = запустити(файл);

    expect(stdout).toMatch(/⊘ contentsNumbers\s+очікувано\s+35\s+СВІДОМО НЕ ОГОЛОШЕНО \(pagination\.contents\)/);
    expect(stdout).toMatch(/причина з конфіга: .*35.*/);
    expect(stdout).toMatch(/РЕГРЕСІЯ: ПРОЙШЛА — розбіжностей 0, свідомих пропусків 1, дірок спроможності 1\./);
  });
});

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, it, expect, vi } from "vitest";
import { loadJsxApply } from "./helpers/load-jsx-apply.js";

const IDMCP = loadJsxApply();
const APPLY_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "jsx", "apply.jsx"),
  "utf8",
);

/** Мінімальна заглушка колекції символів InDesign. */
function characters(text: string) {
  return {
    length: text.length,
    itemByRange(a: number, b: number) {
      if (a < 0 || b >= text.length || b < a) {
        throw new Error(`itemByRange поза межами: (${a}, ${b}) при довжині ${text.length}`);
      }
      /* Саме так поводиться живий InDesign — див. IDMCP.rangeText. */
      return { contents: [text.slice(a, b + 1)] };
    },
  };
}

const container = (text: string) => ({ characters: characters(text) });
const docWith = (text: string) => ({ stories: [{ texts: [container(text)] }] });

const edit = (o: Record<string, unknown> = {}) => ({
  requestId: "r1",
  candidateId: "c1",
  containerId: "story:0",
  action: "replace",
  start: 0,
  end: 4,
  expectedOld: "abcd",
  newText: "xyz",
  ...o,
});

/*
 * Знахідка, на якій тримається четвертий запобіжник: contents діапазону —
 * це масив із одним рядком, а не рядок. Пряме порівняння з рядком завжди
 * істинне, тож без розгортання інструмент пропускав би геть усі правки,
 * звітуючи «текст змінився» на однаковому тексті.
 */
describe("IDMCP.rangeText", () => {
  it("розгортає Array(1), який повертає InDesign", () => {
    expect(IDMCP.rangeText({ contents: ["pomylka"] })).toBe("pomylka");
  });

  it("масив НЕ дорівнює рядку — саме тому розгортання обов'язкове", () => {
    const raw = ["pomylka"];
    expect((raw as unknown) === "pomylka").toBe(false);
    expect(IDMCP.rangeText({ contents: raw })).toBe("pomylka");
  });

  it("зберігає текст із розривом абзацу без спотворень", () => {
    expect(IDMCP.rangeText({ contents: ["de\rfgh"] })).toBe("de\rfgh");
  });

  it("звичайний рядок теж приймає", () => {
    expect(IDMCP.rangeText({ contents: "abcde" })).toBe("abcde");
  });

  it("кілька елементів склеює без коми, а не через String(масив)", () => {
    /* Не спостерігалося на живому InDesign, але склейка комами дала б
     * рядок, якого в документі немає. */
    expect(IDMCP.rangeText({ contents: ["ab", "cd"] })).toBe("abcd");
  });
});

/*
 * Important 1 — структурна перевірка, і свідомо саме структурна.
 *
 * doc.saveACopy — найсхильніший до модальних вікон виклик усього обробника
 * (змінені чи відсутні лінки, підстановка шрифтів, «файл зайнято», дозвіл на
 * том). Спершу він стояв ПЕРЕД withNoInteraction і був єдиним незахищеним
 * запобіжником №2: модальне вікно там блокувало б osascript на весь таймаут,
 * а користувач отримав би тривожне повідомлення про можливо застосовані
 * правки для операції, яка не записала нічого.
 *
 * Поведінкою це не перевірити — змусити InDesign підняти модальне вікно у
 * фікстурі на вимогу неможливо. Тому фіксуємо саме інваріант розташування:
 * копія мусить робитися вже всередині NEVER_INTERACT. Тест впіймає рівно ту
 * регресію, яка тут була, — повернення withNoInteraction нижче за копію.
 */
describe("порядок запобіжника №2 навколо резервної копії (Important 1)", () => {
  it("saveACopy викликається вже всередині withNoInteraction", () => {
    const guard = APPLY_SRC.indexOf("IDMCP.withNoInteraction(function ()");
    const copy = APPLY_SRC.indexOf("doc.saveACopy(");
    expect(guard).toBeGreaterThan(-1);
    expect(copy).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(copy);
  });

  it("withUndo лишається вужчим за withNoInteraction і не обгортає копію", () => {
    const undo = APPLY_SRC.indexOf("IDMCP.withUndo(");
    const copy = APPLY_SRC.indexOf("doc.saveACopy(");
    expect(undo).toBeGreaterThan(copy);
  });
});

/*
 * OPEN-A (раунд 2 рецензії Задачі 14). Round 1 переніс `IDMCP.withHeartbeat`
 * так, щоб він охоплював і `doc.saveACopy` (коментар «A2. Heartbeat охоплює
 * ВСЕ» в apply.jsx), але жоден тест цього не перевіряв: 19 незмінених
 * інтеграційних тестів `corrections.test.ts` кличуть `apply_edits` БЕЗ
 * `heartbeatPath`, тож `IDMCP.withHeartbeat` (`if (!path) return
 * fn(function(){})`) вироджується в порожню обгортку й регресію на своєму
 * місці не ловить.
 *
 * Три мутанти, названі рецензією, — і саме на них розраховані тести нижче
 * (перевірено застосуванням кожного локально, звіт у round-2 файлі задачі):
 *  1. повернути `IDMCP.withHeartbeat` НАЗАД, за `doc.saveACopy` — рівно та
 *     діра, яку раунд 1 заявляв закритою;
 *  2. вимкнути слід узагалі, підмінивши `params.heartbeatPath` на `null` у
 *     самому виклику;
 *  3. видалити ОБИДВА нові дотики раунду 1 (після копії й після ротації).
 */
describe("OPEN-A: порядок withHeartbeat навколо копії (раунд 2)", () => {
  it("IDMCP.withHeartbeat стоїть ДО doc.saveACopy — слід уже пишеться, поки копія в польоті", () => {
    const hb = APPLY_SRC.indexOf("IDMCP.withHeartbeat(");
    const copy = APPLY_SRC.indexOf("doc.saveACopy(");
    expect(hb).toBeGreaterThan(-1);
    expect(copy).toBeGreaterThan(-1);
    expect(hb).toBeLessThan(copy);
  });

  it("IDMCP.withHeartbeat стоїть УСЕРЕДИНІ withNoInteraction — найзовнішня обгортка з двох", () => {
    const guard = APPLY_SRC.indexOf("IDMCP.withNoInteraction(function ()");
    const hb = APPLY_SRC.indexOf("IDMCP.withHeartbeat(");
    expect(guard).toBeGreaterThan(-1);
    expect(hb).toBeGreaterThan(guard);
  });

  it('виклик передає САМЕ params.heartbeatPath, а не вимкнений слід — мутант 2 (heartbeatPath -> null)', () => {
    /*
     * Джерельна підрядкова перевірка, а не лише «якийсь аргумент»: мутація
     * `IDMCP.withHeartbeat(null, ...)` чи `IDMCP.withHeartbeat(undefined,
     * ...)` НЕ впала б на структурних тестах порядку вище (вони дивляться
     * лише на позицію виклику, не на його аргументи), а `if (!path) return
     * fn(function(){})` у withHeartbeat зробила б слід мовчки нульовим —
     * рівно та регресія, яку runWrite/envelope.test.ts (раунд 2) якраз і
     * ловить З ІНШОГО боку моста. Тут ловимо той самий клас на боці JSX.
     */
    expect(APPLY_SRC).toContain(
      'IDMCP.withHeartbeat(params.heartbeatPath, "apply_edits", doc.name, function (touch) {',
    );
  });

  it("щонайменше два дотики (після копії й після ротації) стоять МІЖ saveACopy і withUndo — мутант 3", () => {
    const copy = APPLY_SRC.indexOf("doc.saveACopy(");
    const undo = APPLY_SRC.indexOf("IDMCP.withUndo(");
    expect(copy).toBeGreaterThan(-1);
    expect(undo).toBeGreaterThan(copy);
    const between = APPLY_SRC.slice(copy, undo);
    const touches = between.match(/\btouch\(/g) ?? [];
    /*
     * Один дотик тут МІГ БИ бути залишком старого коду (Фаза 2, всередині
     * циклу правок), але цей зріз лежить ПОЗА циклом правок за побудовою —
     * `withUndo(` іще не почався. Обидва дотики цього зрізу — саме ті, що
     * додав раунд 1: після `doc.saveACopy` і після `IDMCP.rotateBackups`.
     */
    expect(touches.length).toBeGreaterThanOrEqual(2);
  });

  it('перший дотик після копії перемикає фазу на "edits" — межа переходу copy → edits', () => {
    const copy = APPLY_SRC.indexOf("doc.saveACopy(");
    expect(copy).toBeGreaterThan(-1);
    const firstTouch = APPLY_SRC.indexOf("touch(", copy);
    expect(firstTouch).toBeGreaterThan(-1);
    expect(APPLY_SRC.startsWith('touch("edits");', firstTouch)).toBe(true);
  });
});

/*
 * Поведінкова половина OPEN-A: не лише порядок джерела, а й фактичний ефект
 * IDMCP.withHeartbeat — новий параметр фази (heartbeat residual, раунд 2).
 * `File` тут — та сама сировина ExtendScript, що й `doc`/`app`: вона існує
 * лише всередині тіл функцій, тож підставний глобальний клас перед викликом
 * safe, як і в решті цього файлу (див. коментар до `loadJsxApply`).
 */
describe("IDMCP.withHeartbeat — фаза copy → edits (heartbeat residual, раунд 2)", () => {
  interface FakeFileInstance {
    path: string;
    content: string;
    removed: boolean;
  }

  function installFakeFile(): FakeFileInstance[] {
    const instances: FakeFileInstance[] = [];
    class FakeFile implements FakeFileInstance {
      path: string;
      content = "";
      removed = false;
      encoding = "";
      constructor(path: string) {
        this.path = path;
        instances.push(this);
      }
      open(_mode: string): boolean {
        return true;
      }
      write(s: string): void {
        this.content = s;
      }
      close(): void {}
      remove(): boolean {
        this.removed = true;
        return true;
      }
    }
    (globalThis as unknown as { File: unknown }).File = FakeFile;
    return instances;
  }

  afterEach(() => {
    delete (globalThis as { File?: unknown }).File;
  });

  it("перший запис (до fn) несе phase=copy — до старту тіла обробника слід уже каже «копіюю»", () => {
    const instances = installFakeFile();
    IDMCP.withHeartbeat("/шлях/hb.json", "apply_edits", "фікстура.indd", (_touch: (p?: string) => void) => {
      expect(instances).toHaveLength(1);
      expect(JSON.parse(instances[0]!.content).phase).toBe("copy");
    });
  });

  it("touch() без аргументу лишає ПОТОЧНУ фазу незмінною", () => {
    const instances = installFakeFile();
    IDMCP.withHeartbeat("/шлях/hb.json", "apply_edits", "фікстура.indd", (touch: (p?: string) => void) => {
      touch();
      expect(JSON.parse(instances[0]!.content).phase).toBe("copy");
    });
  });

  it('touch("edits") перемикає фазу РАЗ І НАЗАВЖДИ — наступні дотики без аргументу її не відкочують', () => {
    const instances = installFakeFile();
    IDMCP.withHeartbeat("/шлях/hb.json", "apply_edits", "фікстура.indd", (touch: (p?: string) => void) => {
      touch("edits");
      touch();
      touch();
      expect(JSON.parse(instances[0]!.content).phase).toBe("edits");
    });
  });

  it("слід прибирається у finally незалежно від того, у якій фазі обробник завершився", () => {
    const instances = installFakeFile();
    IDMCP.withHeartbeat("/шлях/hb.json", "apply_edits", "фікстура.indd", (touch: (p?: string) => void) => {
      touch("edits");
    });
    expect(instances[0]!.removed).toBe(true);
  });

  it("без heartbeatPath (null) обробник узагалі не звертається до File — touch стає no-op", () => {
    /* Без цього File лишається НЕ підставленим (реальний ExtendScript-глобал
     * недоступний у Node), і будь-яке звернення до `new File(...)` тут упало
     * б саме тому, що фейка немає — тест ловить регресію «шлях завжди
     * непорожній» так само надійно, як інстанс-лічильник. */
    expect(() =>
      IDMCP.withHeartbeat(null, "apply_edits", "фікстура.indd", (touch: (p?: string) => void) => {
        touch();
        touch("edits");
      }),
    ).not.toThrow();
  });
});

describe("IDMCP.validateEdits", () => {
  it("нічого не повертає, коли всі правки в межах", () => {
    const out = IDMCP.validateEdits(docWith("abcdefgh"), [edit()]);
    expect(Object.keys(out)).toHaveLength(0);
  });

  it("end рівно на довжині контейнера — це ще в межах", () => {
    const out = IDMCP.validateEdits(docWith("abcdefgh"), [edit({ start: 4, end: 8 })]);
    expect(Object.keys(out)).toHaveLength(0);
  });

  /*
   * Important 5: найчастіша форма «документ змінився» — story скоротилася.
   * itemByRange на позамежному індексі кидає, а не обрізає, тож одна така
   * правка валила всю пачку. Тепер вона стає skipped, а решта лягає.
   */
  it("позамежну правку віддає як готовий запис skipped, а не кидає", () => {
    const out = IDMCP.validateEdits(docWith("abcdefgh"), [edit({ start: 4, end: 9 })]);
    expect(out[0]).toBeTruthy();
    expect(out[0].requestId).toBe("r1");
    expect(out[0].reason).toContain("out of the container's bounds");
    expect(out[0].actual).toContain("8");
  });

  it("позначає лише позамежні правки, не чіпаючи сусідніх у пачці", () => {
    const out = IDMCP.validateEdits(docWith("abcdefgh"), [
      edit({ requestId: "ok", start: 0, end: 4 }),
      edit({ requestId: "poza", start: 4, end: 99 }),
    ]);
    expect(out[0]).toBeUndefined();
    expect(out[1].requestId).toBe("poza");
  });

  it("кидає на невідомій дії", () => {
    expect(() => IDMCP.validateEdits(docWith("abcdefgh"), [edit({ action: "spalyty" })])).toThrow(
      /Unknown edit action/,
    );
  });

  it("кидає на виродженому діапазоні", () => {
    expect(() => IDMCP.validateEdits(docWith("abcdefgh"), [edit({ start: 4, end: 4 })])).toThrow(
      /Degenerate range/,
    );
  });

  it("кидає на хибному containerId — до копії й до будь-якого запису", () => {
    expect(() => IDMCP.validateEdits(docWith("abcdefgh"), [edit({ containerId: "storyy:0" })])).toThrow(
      /containerId/,
    );
  });
});

/*
 * Important 3: вставка — єдина дія, яка не змінює власного якоря, тож звірка
 * перед записом повторний запуск того самого плану спинити не може за
 * побудовою. Дивимося натомість, чи не стоїть новий текст уже після якоря.
 */
describe("IDMCP.insertAlreadyThere", () => {
  it("бачить, що вставка вже стоїть одразу після якоря", () => {
    const c = container("Ukrainy (vstavka) dali");
    expect(IDMCP.insertAlreadyThere(c, edit({ start: 0, end: 7, newText: " (vstavka)" }))).toBe(true);
  });

  it("не плутає з іншим текстом після якоря", () => {
    const c = container("Ukrainy (inshe) dali");
    expect(IDMCP.insertAlreadyThere(c, edit({ start: 0, end: 7, newText: " (vstavka)" }))).toBe(false);
  });

  it("хвіст коротший за новий текст — вставки там бути не може", () => {
    const c = container("Ukrainy!");
    expect(IDMCP.insertAlreadyThere(c, edit({ start: 0, end: 7, newText: " (vstavka)" }))).toBe(false);
  });

  it("порожній newText ніколи не вважається вже вставленим", () => {
    const c = container("Ukrainy dali");
    expect(IDMCP.insertAlreadyThere(c, edit({ start: 0, end: 7, newText: "" }))).toBe(false);
  });
});

/*
 * A4, раунд 2 — знахідка координатора: ротація копій не була покрита жодним
 * тестом. Регресія в межі «keep включно чи виключно» (видалення на одну
 * копію забагато чи замало) пройшла б непоміченою і в npm test, і в
 * npm run test:integration, доки на живому 196-сторінковому документі не
 * накопичиться стільки копій, скільки треба, щоб це стало видно.
 */
describe("IDMCP.rotateBackups", () => {
  /** Мінімальна заглушка File-об'єкта резервної копії ExtendScript. */
  function fakeFile(name: string, modified: Date, opts: { removeThrows?: boolean } = {}) {
    return {
      name,
      modified,
      remove: vi.fn(() => {
        if (opts.removeThrows) throw new Error("EBUSY: файл заблоковано синхронізацією");
        return true;
      }),
    };
  }

  /** Folder.getFiles у справжньому ExtendScript бере маску — фейк її ігнорує й віддає весь список. */
  function fakeDir(files: ReturnType<typeof fakeFile>[]) {
    return { getFiles: () => files };
  }

  const base = "Testova-Knyha_260731-0055";

  /*
   * A4, раунд 3: штамп мусить мати РІВНО формат backupStamp() з
   * src/tools/corrections.ts — "YYYY-MM-DD-HHMM" — інакше ці ж тести
   * перестали б відрізнятися від файлів, які isOwnBackupName зобов'язаний
   * відкидати. i зростає в хвилинах від опівночі 2026-07-31, щоб порядок
   * стампів співпадав з порядком i, як і в решті тестів цього файлу.
   */
  function stamp(i: number) {
    const hh = Math.floor(i / 60);
    const mm = i % 60;
    const pad2 = (n: number) => String(n).padStart(2, "0");
    return `2026-07-31-${pad2(hh)}${pad2(mm)}`;
  }

  it("копій не більше keep — не видаляється нічого", () => {
    const files = [
      fakeFile(`${base}_do-pravok_${stamp(1)}.indd`, new Date(2026, 6, 31, 0, 1)),
      fakeFile(`${base}_do-pravok_${stamp(2)}.indd`, new Date(2026, 6, 31, 0, 2)),
    ];
    const removed = IDMCP.rotateBackups(fakeDir(files), base, 10);
    expect(removed).toBe(0);
    for (const f of files) expect(f.remove).not.toHaveBeenCalled();
  });

  it("копій більше keep — лишається рівно keep найновіших за modified", () => {
    const files: ReturnType<typeof fakeFile>[] = [];
    for (let i = 1; i <= 12; i++) {
      files.push(fakeFile(`${base}_do-pravok_${stamp(i)}.indd`, new Date(2026, 6, 31, 0, i)));
    }
    const removed = IDMCP.rotateBackups(fakeDir(files), base, 10);
    /* Найстаріші два (i=1,2) — на видалення; десять найновіших (i=3..12) лишаються. */
    expect(removed).toBe(2);
    expect(files[0]!.remove).toHaveBeenCalledTimes(1);
    expect(files[1]!.remove).toHaveBeenCalledTimes(1);
    for (let i = 2; i < 12; i++) expect(files[i]!.remove).not.toHaveBeenCalled();
  });

  it("щойно створена копія цієї пачки (найновіша) не видаляється ніколи", () => {
    const files: ReturnType<typeof fakeFile>[] = [];
    for (let i = 1; i <= 10; i++) {
      files.push(fakeFile(`${base}_do-pravok_${stamp(i)}.indd`, new Date(2026, 6, 31, 0, i)));
    }
    const justCreated = fakeFile(`${base}_do-pravok_${stamp(99)}.indd`, new Date(2026, 6, 31, 23, 59));
    files.push(justCreated);
    const removed = IDMCP.rotateBackups(fakeDir(files), base, 10);
    expect(removed).toBe(1);
    expect(justCreated.remove).not.toHaveBeenCalled();
  });

  it("виняток із .remove() не поширюється назовні — файл лишається, ротація не падає", () => {
    const files: ReturnType<typeof fakeFile>[] = [];
    for (let i = 1; i <= 11; i++) {
      files.push(
        fakeFile(`${base}_do-pravok_${stamp(i)}.indd`, new Date(2026, 6, 31, 0, i), i === 1 ? { removeThrows: true } : {}),
      );
    }
    let removed = -1;
    expect(() => {
      removed = IDMCP.rotateBackups(fakeDir(files), base, 10);
    }).not.toThrow();
    /* 11 копій, keep=10 → на видалення йде рівно найстаріша (i=1), а її
     * remove() кидає виняток. Вона лишається на диску, не рахується як
     * видалена, але ротація в цілому не падає. */
    expect(removed).toBe(0);
    expect(files[0]!.remove).toHaveBeenCalledTimes(1);
  });

  it("маска не перетворює спецсимвол '*' у назві документа на wildcard (Minor)", () => {
    const weirdBase = "Zvit* 2026";
    const files = [
      fakeFile(`${weirdBase}_do-pravok_${stamp(1)}.indd`, new Date(2026, 6, 31, 0, 1)),
      fakeFile(`Inshyi_do-pravok_${stamp(2)}.indd`, new Date(2026, 6, 31, 0, 2)),
    ];
    const removed = IDMCP.rotateBackups(fakeDir(files), weirdBase, 0);
    /* keep=0 і рівно одна копія належить weirdBase — видалено має бути лише вона. */
    expect(removed).toBe(1);
    expect(files[0]!.remove).toHaveBeenCalledTimes(1);
    expect(files[1]!.remove).not.toHaveBeenCalled();
  });

  /*
   * A4, раунд 3 — знахідка координатора (Critical): у користувача всередині
   * _backups/ лежить ЙОГО ВЛАСНИЙ файл, названий вручну під тим самим
   * префіксом, але без нашого штампу: "..._do-pravok_20260731-vychytka.indd"
   * (власна вичитка, а не автокопія). Самого префікса замало для фільтра —
   * такий файл видалився б, щойно автокопій набереться понад keep. Три тести
   * нижче — рівно ті, які координатор попросив явно.
   */
  describe("IDMCP.isOwnBackupName / строгий формат штампу (A4, раунд 3, Critical)", () => {
    it("файл із довільним суфіксом типу '-vychytka' НЕ видаляється ніколи, навіть при переповненні keep", () => {
      const usersOwnFile = fakeFile(`${base}_do-pravok_20260731-vychytka.indd`, new Date(2026, 6, 31, 0, 0));
      const files: ReturnType<typeof fakeFile>[] = [usersOwnFile];
      for (let i = 1; i <= 15; i++) {
        files.push(fakeFile(`${base}_do-pravok_${stamp(i)}.indd`, new Date(2026, 6, 31, 0, i)));
      }
      const removed = IDMCP.rotateBackups(fakeDir(files), base, 10);
      /* 15 справжніх автокопій, keep=10 → 5 найстаріших автокопій ідуть на
       * видалення; файл користувача — ніколи, він не проходить isOwnBackupName. */
      expect(removed).toBe(5);
      expect(usersOwnFile.remove).not.toHaveBeenCalled();
    });

    it("файл із правильним штампом видаляється, коли він поза межею keep", () => {
      const files = [
        fakeFile(`${base}_do-pravok_2026-07-28-1432.indd`, new Date(2026, 6, 28, 14, 32)),
      ];
      for (let i = 1; i <= 10; i++) {
        files.push(fakeFile(`${base}_do-pravok_${stamp(i)}.indd`, new Date(2026, 6, 31, 0, i)));
      }
      const removed = IDMCP.rotateBackups(fakeDir(files), base, 10);
      /* 11 файлів усього, усі за нашим форматом, keep=10 → видаляється рівно
       * найстаріший — файл із 2026-07-28, дата якого раніша за всі stamp(i). */
      expect(removed).toBe(1);
      expect(files[0]!.remove).toHaveBeenCalledTimes(1);
      for (let i = 1; i <= 10; i++) expect(files[i]!.remove).not.toHaveBeenCalled();
    });

    it("варіант зі суфіксом колізії '-2' (від IDMCP.uniqueBackupFile) теж розпізнається як наш", () => {
      const collisionFile = fakeFile(`${base}_do-pravok_2026-07-28-1432-2.indd`, new Date(2026, 6, 28, 14, 32));
      const files: ReturnType<typeof fakeFile>[] = [collisionFile];
      for (let i = 1; i <= 10; i++) {
        files.push(fakeFile(`${base}_do-pravok_${stamp(i)}.indd`, new Date(2026, 6, 31, 0, i)));
      }
      const removed = IDMCP.rotateBackups(fakeDir(files), base, 10);
      /* Так само 11 файлів, усі розпізнані як наші (колізійний суфікс не
       * заважає), keep=10 → видаляється рівно найстаріший — файл-колізія. */
      expect(removed).toBe(1);
      expect(collisionFile.remove).toHaveBeenCalledTimes(1);
      for (let i = 1; i <= 10; i++) expect(files[i]!.remove).not.toHaveBeenCalled();
    });
  });
});

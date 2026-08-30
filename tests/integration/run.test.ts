import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { unlink } from "node:fs/promises";
import { runJsx } from "../../src/bridge/runner.js";
import { makeFixtureDoc, closeFixtureDoc, assertFixtureActive } from "./fixture-doc.js";

let docName: string;

/*
 * Тимчасовий файл потрібен, щоб `doc.modified` узагалі можна було виміряти:
 * новий незбережений документ уже позначений зміненим, і на ньому дельти не
 * видно. Зберігаємо фікстуру на диск один раз — після цього modified = false,
 * і кожна наступна зміна прапорця має причиною рівно те, що ми міряємо.
 */
/*
 * Шлях будує САМ ExtendScript і повертає його нативну форму, а Node лише
 * прибирає за собою. Причина виміряна прогоном 2026-08-05: `new File("/tmp/…")`
 * і `new File("/private/tmp/…")` обидва падають з «Cannot find the folder» —
 * ExtendScript читає перший компонент шляху як НАЗВУ ТОМУ, а не як кореневу
 * теку. Канонічний ідіом — конкатенація з `Folder.temp`, яка дає коректний URI.
 */
const SAVE_NAME = `indesign-mcp-run-readonly-${process.pid}.indd`;
let savedPath: string | null = null;

interface StatusDoc {
  name: string;
  modified: boolean;
}
interface Status {
  documents: StatusDoc[];
}

/*
 * Читаємо прапорець обробником `status`, а НЕ через run_script: `IDMCP.run`
 * (`src/jsx/_core.jsx:173`) undo-обгортки не має, тож `status` документа не
 * бруднить. Міряти readOnly інструментом, який сам страждає на ту саму ваду,
 * означало б не виміряти нічого.
 */
async function isModified(name: string): Promise<boolean> {
  const status = await runJsx<Status>("status", {});
  const doc = status.documents.find((d) => d.name === name);
  if (!doc) throw new Error(`Документа "${name}" немає серед відкритих.`);
  return doc.modified;
}

beforeAll(async () => {
  docName = await makeFixtureDoc();
});

afterAll(async () => {
  if (docName) {
    await closeFixtureDoc(docName);
  }
  if (savedPath) await unlink(savedPath).catch(() => {});
});

describe("run_script", () => {
  it("повертає значення з __result", async () => {
    await assertFixtureActive(docName);
    const r = await runJsx<number>("run_script", {
      script: "__result = app.activeDocument.pages.length;",
    });
    expect(r).toBe(2);
  });

  it("повертає структуру, а не лише число", async () => {
    await assertFixtureActive(docName);
    const r = await runJsx<{ names: string[] }>("run_script", {
      script:
        "var n = []; for (var i = 0; i < app.activeDocument.pages.length; i++) n.push(app.activeDocument.pages[i].name); __result = { names: n };",
    });
    expect(r.names).toEqual(["1", "2"]);
  });

  it("помилка в скрипті повертається з номером рядка", async () => {
    await assertFixtureActive(docName);
    await expect(runJsx("run_script", { script: "__result = nemaieTakoiZminnoi.x;" })).rejects.toThrow(
      /ExtendScript/,
    );
  });
});

/*
 * Ці тести з'явилися зі СПРОСТОВАНОЇ гіпотези, і саме тому їх варто мати.
 *
 * 2026-08-05, під час скану масштабованих рамок, робоча книжка користувача
 * перейшла з `modified: false` у `true` десь між першим і останнім зондом.
 * Напрошувалося пояснення: `src/jsx/run.jsx` безумовно загортає будь-який код
 * у `IDMCP.withUndo`, а `UndoModes.ENTIRE_SCRIPT` створює крок історії — отже,
 * мовляв, навіть читальний скрипт бруднить документ. Планувалося додати
 * `readOnly`, який обгортку знімає.
 *
 * Гіпотезу вбив цей-таки тест, написаний ДО реалізації: `readOnly` ще не
 * існував, параметр ігнорувався, код ішов через `withUndo` — і документ
 * лишався чистим. Контрольна діагностика на самій книжці (повне відтворення
 * сканувальних читань: everyItem по шести властивостях, allPageItems,
 * transformValuesOf, обхід історій) теж лишила `modified: false`.
 *
 * Отже забруднення прийшло не від інструмента. Книжка весь час відкрита в
 * користувача В РОБОТІ, і `modified` міг поставити він сам — це була
 * кореляція, прийнята за причину. `readOnly` не додано: підстави немає.
 *
 * Лишається те, що виміряно і на що ми тепер спираємось: читальний скрипт
 * крізь `run_script` документа НЕ бруднить. Якщо колись зміниться —
 * зламається тут, а не в чужому робочому файлі.
 */
describe("run_script і doc.modified", () => {
  it("готує ґрунт: збережена фікстура має modified = false", async () => {
    await assertFixtureActive(docName);
    /*
     * `save` ПЕРЕЙМЕНОВУЄ документ: «Untitled-N» стає назвою файла. Виміряно
     * прогоном 2026-08-05 — без оновлення `docName` далі падає і
     * `assertFixtureActive`, і `closeFixtureDoc` у afterAll, тобто фікстура
     * лишається відкритою в InDesign користувача. Тому нову назву повертає
     * той самий скрипт, що зберігає.
     */
    const saved = await runJsx<{ path: string; name: string }>("run_script", {
      script:
        `var f = new File(Folder.temp + "/" + ${JSON.stringify(SAVE_NAME)});` +
        "app.activeDocument.save(f);" +
        "__result = { path: f.fsName, name: app.activeDocument.name };",
      undoName: "Зберегти фікстуру",
    });
    savedPath = saved.path;
    docName = saved.name;

    expect(savedPath).toContain(SAVE_NAME);
    expect(docName).toBe(SAVE_NAME);
    expect(await isModified(docName)).toBe(false);
  });

  it("читальний скрипт не позначає документ зміненим", async () => {
    await assertFixtureActive(docName);
    expect(await isModified(docName)).toBe(false);

    const pages = await runJsx<number>("run_script", {
      script: "__result = app.activeDocument.pages.length;",
    });

    expect(pages).toBe(2);
    expect(await isModified(docName)).toBe(false);
  });

  /*
   * Друга половина твердження: прапорець узагалі робочий. Без цього тест вище
   * проходив би й на документі, що не бруднішає ніколи й ні від чого, — тобто
   * не перевіряв би нічого.
   */
  it("скрипт, що ПИШЕ, документ бруднить", async () => {
    await assertFixtureActive(docName);
    expect(await isModified(docName)).toBe(false);

    await runJsx("run_script", {
      script:
        "var p = app.activeDocument.pages.add();" +
        "__result = app.activeDocument.pages.length;",
      undoName: "Додати сторінку (перевірка прапорця)",
    });

    expect(await isModified(docName)).toBe(true);
  });
});

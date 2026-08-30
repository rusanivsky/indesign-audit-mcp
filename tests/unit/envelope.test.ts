import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * `runWrite` — ЄДИНА точка входу всього, що пише в документ, і її головна
 * обіцянка («не запускати запис поверх живого запису») не мала жодного тесту в
 * усьому репозиторії. Мутація, що ВИДАЛЯЄ `assertNoLiveWrite`, лишала прогін
 * зеленим: у юнітах `runWrite` підмінений, а інтеграційні кличуть `apply_edits`
 * через `runJsx` напряму, тобто конверт обходять.
 *
 * Ціна цієї прогалини — не абстрактна. Саме цей запобіжник стоїть між книжкою
 * користувача на 196 сторінок і ДРУГИМ записом поверх живого першого: при
 * таймауті osascript убито, а скрипт усередині InDesign продовжує писати, і
 * жодна звірка `expectedOld` цього не ловить, бо на момент другого запису текст
 * уже змінено першим.
 */
const { runJsxMock } = vi.hoisted(() => ({ runJsxMock: vi.fn() }));
vi.mock("../../src/bridge/runner.js", () => ({ runJsx: runJsxMock }));

const { runWrite } = await import("../../src/bridge/envelope.js");
const { IndesignError } = await import("../../src/bridge/errors.js");

let home: string;
const prev = process.env.INDESIGN_MCP_HOME;

/** Файл сліду там, де його шукає `heartbeatPath()`. */
async function writeHeartbeat(touchedAt: number, phase?: "copy" | "edits"): Promise<void> {
  await mkdir(home, { recursive: true });
  await writeFile(
    join(home, "write.heartbeat.json"),
    JSON.stringify({
      startedAt: touchedAt - 3000,
      touchedAt,
      handler: "apply_edits",
      docName: "Book-A.indd",
      ...(phase === undefined ? {} : { phase }),
    }),
    "utf8",
  );
}

const OK_REPORT = { backupPath: "/шлях/копія.indd", applied: [] };

beforeEach(async () => {
  runJsxMock.mockReset();
  runJsxMock.mockResolvedValue(OK_REPORT);
  home = await mkdtemp(join(tmpdir(), "idmcp-env-"));
  process.env.INDESIGN_MCP_HOME = home;
});

afterEach(async () => {
  if (prev === undefined) delete process.env.INDESIGN_MCP_HOME;
  else process.env.INDESIGN_MCP_HOME = prev;
  await rm(home, { recursive: true, force: true });
});

const call = () =>
  runWrite<{ backupPath?: string; fatalError?: string }>({
    handler: "apply_edits",
    params: { expectedDocName: "фікстура.indd" },
    timeoutMs: 1000,
  });

describe("runWrite — відмова писати поверх живого запису", () => {
  it("СВІЖИЙ слід зупиняє запис, і InDesign навіть не викликається", async () => {
    await writeHeartbeat(Date.now());

    await expect(call()).rejects.toThrow(IndesignError);
    /* Головне: не «впало з помилкою», а «до InDesign не дійшло». */
    expect(runJsxMock).not.toHaveBeenCalled();
  });

  it("помилка називає обробник, документ і шлях до сліду", async () => {
    await writeHeartbeat(Date.now());

    /* `hint` — окреме поле IndesignError, і саме в ньому живе шлях, який
     * користувачеві доведеться видалити вручну, якщо InDesign уже мертвий. */
    const e = (await call().catch((x: unknown) => x)) as InstanceType<typeof IndesignError>;
    expect(e).toBeInstanceOf(IndesignError);
    expect(e.kind).toBe("busy");
    expect(e.message).toContain("apply_edits");
    expect(e.message).toContain("Book-A.indd");
    expect(e.hint).toContain("write.heartbeat.json");
  });

  it("ЗАСТАРІЛИЙ слід не блокує: інакше обірваний колись запис заблокував би все назавжди", async () => {
    await writeHeartbeat(Date.now() - 10 * 60_000);

    await expect(call()).resolves.toEqual(OK_REPORT);
    expect(runJsxMock).toHaveBeenCalledTimes(1);
  });

  it("без сліду запис іде, і шлях сліду передається в обробник", async () => {
    await expect(call()).resolves.toEqual(OK_REPORT);

    const params = runJsxMock.mock.calls[0]![1] as { heartbeatPath: string };
    /* Без цього поля JSX не має куди писати слід — і весь запобіжник німий. */
    expect(params.heartbeatPath).toContain("write.heartbeat.json");
    expect(params.heartbeatPath).toContain(home);
  });

  it("fatalError зі звіту стає помилкою, яка НАЗИВАЄ шлях копії", async () => {
    runJsxMock.mockResolvedValue({
      backupPath: "/шлях/копія.indd",
      fatalError: "заблокована story",
    });

    const e = (await call().catch((x: unknown) => x)) as InstanceType<typeof IndesignError>;
    expect(e.message).toContain("заблокована story");
    expect(e.hint).toContain("/шлях/копія.indd");
  });

  it("fatalError без копії каже саме це, а не мовчить про відсутність копії", async () => {
    runJsxMock.mockResolvedValue({ fatalError: "впало до створення копії" });

    const e = (await call().catch((x: unknown) => x)) as InstanceType<typeof IndesignError>;
    expect(e.hint).toContain("no document copy");
  });

  /*
   * Раунд 2 (heartbeat residual). `runWrite` мусить передати ВЛАСНИЙ
   * `timeoutMs` у `assertNoLiveWrite` як межу застарілості фази "copy" —
   * інакше слід, написаний перед довгою `doc.saveACopy`, за 90 с уже виглядав
   * би мертвим (звичайна межа — 20 с), і другий виклик проскочив би поверх
   * живого першого рівно так само, як до появи фази взагалі.
   *
   * `call()` вище передає `timeoutMs: 1000` — замало для цього доказу (менше
   * за самі 90 с сліду), тож тут власний виклик із `timeoutMs`, що явно
   * більший за вік сліду.
   */
  describe("фаза «copy» доходить до assertNoLiveWrite через власний timeoutMs виклику", () => {
    const callWithTimeout = (timeoutMs: number) =>
      runWrite<{ backupPath?: string; fatalError?: string }>({
        handler: "apply_edits",
        params: { expectedDocName: "фікстура.indd" },
        timeoutMs,
      });

    it("90-секундний слід із phase=copy зупиняє запис, коли timeoutMs виклику ширший", async () => {
      await writeHeartbeat(Date.now() - 90_000, "copy");

      await expect(callWithTimeout(180_000)).rejects.toThrow(IndesignError);
      expect(runJsxMock).not.toHaveBeenCalled();
    });

    it("90-секундний слід БЕЗ phase не зупиняє запис — звичайна 20-секундна межа вже минула", async () => {
      await writeHeartbeat(Date.now() - 90_000);

      await expect(callWithTimeout(180_000)).resolves.toEqual(OK_REPORT);
      expect(runJsxMock).toHaveBeenCalledTimes(1);
    });

    it('90-секундний слід із phase="edits" теж не зупиняє запис — розширення лише для "copy"', async () => {
      await writeHeartbeat(Date.now() - 90_000, "edits");

      await expect(callWithTimeout(180_000)).resolves.toEqual(OK_REPORT);
      expect(runJsxMock).toHaveBeenCalledTimes(1);
    });
  });
});

/*
 * ЧАСТКОВИЙ ЗВІТ МУСИТЬ ПЕРЕЖИТИ ЗБІЙ.
 *
 * apply.jsx НАВМИСНО будує один спільний об'єкт звіту, щоб при виключенні
 * всередині withUndo віддати його ж — із уже накопиченими applied/skipped/
 * failed. Коментар там про це каже прямо. А runWrite перетворював його на
 * помилку, що несла лише message і hint, тобто перелік «які саме правки
 * лягли» будувався й одразу викидався.
 *
 * Ціна видима на пакеті з 40 правок, де падає 23-тя: оператор діставав одне
 * речення «якісь правки могли лягти — перевірте оком» замість двадцяти двох
 * відомих requestId.
 */
describe("частковий звіт при fatalError", () => {
  it("їде разом із помилкою, а не гине", async () => {
    const report = {
      fatalError: "locked frame on p. 23",
      backupPath: "/т/_backups/к.indd",
      applied: [{ requestId: "r1" }, { requestId: "r2" }],
      skipped: [],
      failed: [],
    };
    runJsxMock.mockReset();
    runJsxMock.mockResolvedValue(report);
    const e = await runWrite({ handler: "apply_edits", params: {}, timeoutMs: 1000 }).catch(
      (x: unknown) => x,
    );
    expect(e).toBeInstanceOf(IndesignError);
    expect((e as InstanceType<typeof IndesignError>).payload).toEqual(report);
  });

  it("fail() показує його операторові, а не лише кладе в об'єкт", async () => {
    const { fail } = await import("../../src/tools/shared.js");
    const e = new IndesignError("jsx-error", "цур", "підказка", {
      applied: [{ requestId: "r1" }],
    });
    const text = fail(e).content[0]!.text;
    expect(text).toContain("What had already happened");
    expect(text).toContain("r1");
  });

  it("НЕГАТИВНИЙ КОНТРОЛЬ: без звіту зайвого блоку немає", async () => {
    /* Інакше кожна помилка тягла б порожній розділ, і читач перестав би на
     * нього дивитися. */
    const { fail } = await import("../../src/tools/shared.js");
    const text = fail(new IndesignError("busy", "цур", "підказка")).content[0]!.text;
    expect(text).not.toContain("What had already happened");
  });
});

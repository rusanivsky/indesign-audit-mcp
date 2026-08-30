import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertNoLiveWrite,
  COPY_PHASE_SLACK,
  HEARTBEAT_STALE_MS,
  isStale,
  ensureHeartbeatDir,
  readHeartbeat,
  type HeartbeatFile,
} from "../../src/bridge/heartbeat.js";

let dir: string;
let path: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "idmcp-hb-"));
  path = join(dir, "write.heartbeat.json");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const hb = (touchedAt: number, phase?: HeartbeatFile["phase"]): HeartbeatFile => ({
  startedAt: touchedAt - 1000,
  touchedAt,
  handler: "apply_edits",
  docName: "фікстура.indd",
  ...(phase === undefined ? {} : { phase }),
});

/*
 * Той самий APPLY_TIMEOUT_MS, яким користуються src/tools/corrections.ts і
 * реальний виклик runWrite. Значення НЕ імпортоване звідти навмисно — саме
 * циклічного імпорту (heartbeat.ts -> corrections.ts -> envelope.ts ->
 * heartbeat.ts) і уникає раунд 2 (див. коментар у envelope.ts, runWrite): цей
 * файл про параметр `copyPhaseStaleMs` не знає нічого, крім того, що це
 * число, яке передає ВИКЛИКАЧ.
 */
const APPLY_TIMEOUT_MS_MIRROR = 180_000;

describe("isStale", () => {
  it("свіжий heartbeat не застарілий", () => {
    const now = 1_000_000;
    expect(isStale(hb(now - 1000), now)).toBe(false);
  });

  it("застарілий після HEARTBEAT_STALE_MS", () => {
    const now = 1_000_000;
    expect(isStale(hb(now - HEARTBEAT_STALE_MS - 1), now)).toBe(true);
  });

  it("heartbeat з майбутнього не вважається живим вічно", () => {
    const now = 1_000_000;
    expect(isStale(hb(now + 10 * HEARTBEAT_STALE_MS), now)).toBe(true);
  });

  /*
   * Мінор 5 фінальної рецензії: мутант `age > bound` → `age >= bound` вижив у
   * прогоні рецензента (рецензент визнав різницю поведінково неважливою — рівно
   * мілісекундний збіг не є реальним сценарієм, — але непокрите лишається
   * непокритим). Рівно на межі вік ЩЕ НЕ застарілий: `isStale` порівнює строгим
   * `>`, а не `>=`.
   */
  it("вік РІВНО на межі — ще НЕ застарілий (строге >, не >=)", () => {
    const now = 1_000_000;
    expect(isStale(hb(now - HEARTBEAT_STALE_MS), now)).toBe(false);
  });

  /*
   * Раунд 2 (heartbeat residual). Без `phase` слід, старший за 90 с,
   * застарілий за звичайною межею (20 с) — цю поведінку розширення НЕ чіпає.
   */
  it("без phase — застарілий на 90 с, як і завжди", () => {
    const now = 1_000_000;
    expect(isStale(hb(now - 90_000), now, APPLY_TIMEOUT_MS_MIRROR)).toBe(true);
  });

  it('phase "edits" на 90 с — так само застарілий: розширення діє ЛИШЕ для "copy"', () => {
    const now = 1_000_000;
    expect(isStale(hb(now - 90_000, "edits"), now, APPLY_TIMEOUT_MS_MIRROR)).toBe(true);
  });

  it('phase "copy" на 90 с НЕ застарілий, коли викликач дав ширшу межу (APPLY_TIMEOUT_MS)', () => {
    const now = 1_000_000;
    expect(isStale(hb(now - 90_000, "copy"), now, APPLY_TIMEOUT_MS_MIRROR)).toBe(false);
  });

  /*
   * Борг Фази 3, закритий 2026-08-05. Раніше межа фази "copy" дорівнювала
   * РІВНО таймауту викликача, і запобіжник відмовляв саме в тій ситуації, для
   * якої існував: клієнт здається за 180 с, користувач одразу пробує ще раз,
   * слід має вік ≈ 180 с — рівно на порозі, — і другий запис іде поверх
   * живого першого. Множник COPY_PHASE_SLACK розриває цей збіг.
   */
  it('phase "copy" переживає ТОЙ САМИЙ таймаут, за яким здався клієнт', () => {
    const now = 1_000_000;
    /* Вік трохи більший за таймаут викликача — колись це означало
     * «застарілий», тепер ні: саме тут і стартував би дублюючий запис. */
    expect(
      isStale(hb(now - APPLY_TIMEOUT_MS_MIRROR - 1000, "copy"), now, APPLY_TIMEOUT_MS_MIRROR),
    ).toBe(false);
  });

  it('phase "copy" усе ж не безмежна — за межею множника застаріває', () => {
    const now = 1_000_000;
    const beyond = APPLY_TIMEOUT_MS_MIRROR * COPY_PHASE_SLACK + 1000;
    expect(isStale(hb(now - beyond, "copy"), now, APPLY_TIMEOUT_MS_MIRROR)).toBe(true);
  });

  it("множник більший за одиницю — інакше правка не мала б сенсу", () => {
    expect(COPY_PHASE_SLACK).toBeGreaterThan(1);
  });

  it('phase "copy" без явного copyPhaseStaleMs від викликача (замовчання) поводиться як звичайний слід', () => {
    const now = 1_000_000;
    /* Замовчання assertNoLiveWrite/isStale — HEARTBEAT_STALE_MS, тож без
     * викликача, що явно передає ширшу межу, фаза "copy" нічого не рятує. */
    expect(isStale(hb(now - 90_000, "copy"), now)).toBe(true);
  });

  it('heartbeat з майбутнього залишається застарілим і при phase "copy" — годинник підозрілий незалежно від фази', () => {
    const now = 1_000_000;
    expect(isStale(hb(now + 10 * HEARTBEAT_STALE_MS, "copy"), now, APPLY_TIMEOUT_MS_MIRROR)).toBe(
      true,
    );
  });
});

describe("readHeartbeat", () => {
  it("на відсутньому файлі повертає null", async () => {
    expect(await readHeartbeat(path)).toBeNull();
  });

  /*
   * ЦЕЙ ТЕСТ ЗАКРІПЛЮВАВ ВАДУ, і його змінено разом із нею 2026-08-26.
   *
   * Раніше він вимагав `null` на пошкодженому файлі — тобто «запису не
   * відбувається». Але писар у JSX НЕ атомарний: `File.open("w")` спершу
   * ОБРІЗАЄ файл, потім пише, потім закриває, і між обрізанням та записом
   * на диску лежить нуль байтів. `apply_edits` торкається сліду раз на
   * правку — на книжці в 196 сторінок це сотні разів. Отже «нечитабельний
   * файл» — це найімовірніше «запис саме зараз триває», а не його
   * відсутність, і старе `null` віддавало дозвіл на другий запис поверх
   * живого першого.
   *
   * Тепер нечитабельний слід НЕ виправдовує запису: він судиться за
   * власним mtime, як усі інші. Відсутність файла лишається єдиним
   * «запису немає» — це перевіряє тест вище.
   */
  it("пошкоджений файл НЕ означає «запису немає»", async () => {
    await writeFile(path, "{ це не json", "utf8");
    const hbNow = await readHeartbeat(path);
    expect(hbNow, "нечитабельний слід прочитано як відсутність запису").not.toBeNull();
    /* Імена невідомі — і сказано про це прямо, а не вигадано. */
    expect(hbNow!.handler).toContain("unreadable");
  });

  it("порожній файл — той самий випадок: це вікно між обрізанням і записом", async () => {
    await writeFile(path, "", "utf8");
    expect(await readHeartbeat(path)).not.toBeNull();
  });

  it("нечитабельний слід усе одно СТАРІЄ, інакше він блокував би записи назавжди", async () => {
    /* Зворотний бік попереднього: якби нечитабельний слід завжди читався як
     * живий, забутий порожній файл замкнув би запис навіки. Судиться за
     * mtime, тож старіє звичайним шляхом. */
    await writeFile(path, "{ це не json", "utf8");
    const hbNow = (await readHeartbeat(path))!;
    expect(isStale(hbNow, Date.now() + HEARTBEAT_STALE_MS * 10)).toBe(true);
  });

  it("читає коректний файл", async () => {
    await writeFile(path, JSON.stringify(hb(123)), "utf8");
    expect((await readHeartbeat(path))!.handler).toBe("apply_edits");
  });
});

describe("assertNoLiveWrite", () => {
  it("мовчить, коли файла немає", async () => {
    await expect(assertNoLiveWrite(path)).resolves.toBeUndefined();
  });

  it("мовчить на застарілому heartbeat", async () => {
    await writeFile(path, JSON.stringify(hb(Date.now() - HEARTBEAT_STALE_MS - 5000)), "utf8");
    await expect(assertNoLiveWrite(path)).resolves.toBeUndefined();
  });

  it("кидає busy на живому heartbeat і називає обробник", async () => {
    await writeFile(path, JSON.stringify(hb(Date.now())), "utf8");
    await expect(assertNoLiveWrite(path)).rejects.toThrow(/apply_edits/);
  });

  it("у повідомленні пояснює, чому не можна повторювати", async () => {
    await writeFile(path, JSON.stringify(hb(Date.now())), "utf8");
    await expect(assertNoLiveWrite(path)).rejects.toThrow(/does not stop|keeps writing/);
  });

  /*
   * Раунд 2 (heartbeat residual, названий у щоденнику задачі): за
   * замовчуванням HEARTBEAT_STALE_MS = 20 с, а doc.saveACopy книжки на 196
   * сторінок у хмарній теці може тривати довше, торкнутися файла усередині
   * нього нічим. Слід, написаний ще до копії, лишається віком у секунди,
   * доки копія не завершиться. `copyPhaseStaleMs` дає викликачу (`runWrite`)
   * право сказати «під час копії чекай довше — рівно стільки, скільки я і
   * так чекаю відповіді».
   *
   * НАПРЯМ ПЕРЕВІРКИ, названий прямо, бо він контрінтуїтивний на перший
   * погляд: «довша межа застарілості» означає, що слід ДОВШЕ лишається
   * ЖИВИМ — тобто `assertNoLiveWrite` мусить ДАЛІ КИДАТИ busy, а не
   * переставати. Це й є захист: другий виклик посеред довгої копії має
   * зупинитися, а не проскочити повз мертвий на вигляд, але насправді живий
   * слід.
   */
  describe("фаза «copy» — розширена межа за явним copyPhaseStaleMs від викликача", () => {
    it("90-секундний слід із phase=copy УСЕ ЩЕ кидає busy, коли викликач дав ширшу межу — саме це і є захист", async () => {
      await writeFile(path, JSON.stringify(hb(Date.now() - 90_000, "copy")), "utf8");
      await expect(assertNoLiveWrite(path, undefined, APPLY_TIMEOUT_MS_MIRROR)).rejects.toThrow(/apply_edits/);
    });

    it("той самий 90-секундний слід БЕЗ phase (звичайний запис) НЕ блокує — звичайна 20-секундна межа вже спрацювала", async () => {
      await writeFile(path, JSON.stringify(hb(Date.now() - 90_000)), "utf8");
      await expect(assertNoLiveWrite(path, undefined, APPLY_TIMEOUT_MS_MIRROR)).resolves.toBeUndefined();
    });

    it('той самий 90-секундний слід із phase="edits" теж НЕ блокує — розширення діє лише для "copy"', async () => {
      await writeFile(path, JSON.stringify(hb(Date.now() - 90_000, "edits")), "utf8");
      await expect(assertNoLiveWrite(path, undefined, APPLY_TIMEOUT_MS_MIRROR)).resolves.toBeUndefined();
    });

    it("без явного copyPhaseStaleMs від викликача (замовчання) phase=copy нічого не рятує — 90 с усе одно застарілі", async () => {
      await writeFile(path, JSON.stringify(hb(Date.now() - 90_000, "copy")), "utf8");
      await expect(assertNoLiveWrite(path)).resolves.toBeUndefined();
    });
  });
});

/*
 * СВІЖА УСТАНОВКА — сценарій, у якому сторож був декоративним.
 *
 * `<stateDir>` не створював НІХТО на шляху запису: підтеки `plans/` і
 * `numbering/` робили лише аудитні шляхи, а `typography_apply` доходить до
 * `runWrite`, не торкнувшись диска. У ExtendScript `File.open("w")` при
 * відсутній батьківській теці ПОВЕРТАЄ FALSE, а не кидає, тож слід не
 * писався жодного разу — мовчки, — і другий запис спокійно лягав поверх
 * живого першого.
 */
describe("ensureHeartbeatDir", () => {
  it("створює теку, якої ще немає", async () => {
    const fresh = join(dir, "не-існує", "ще-глибше", "write.heartbeat.json");
    await ensureHeartbeatDir(fresh);
    expect((await stat(join(dir, "не-існує", "ще-глибше"))).isDirectory()).toBe(true);
  });

  it("після неї слід СПРАВДІ записується — саме цього бракувало", async () => {
    /* Негативний контроль на саму правку: створення теки має значення лише
     * тоді, коли після нього запис файла вдається. */
    const fresh = join(dir, "новий-корінь", "write.heartbeat.json");
    await ensureHeartbeatDir(fresh);
    await writeFile(fresh, JSON.stringify(hb(Date.now())), "utf8");
    expect((await readHeartbeat(fresh))!.handler).toBe("apply_edits");
  });

  it("на наявній теці не падає — її кличуть перед КОЖНИМ записом", async () => {
    await ensureHeartbeatDir(path);
    await expect(ensureHeartbeatDir(path)).resolves.toBeUndefined();
  });
});

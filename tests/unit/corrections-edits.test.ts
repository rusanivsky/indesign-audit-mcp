import { describe, it, expect } from "vitest";
import {
  APPLY_TIMEOUT_MS,
  backupStamp,
  describeApplyTimeout,
  toAcceptedEdits,
} from "../../src/tools/corrections.js";
import type { Candidate, Plan, PlanItem } from "../../src/corrections/types.js";

const candidate = (o: Partial<Candidate> = {}): Candidate => ({
  candidateId: "r1#0",
  containerId: "story:0",
  start: 10,
  end: 17,
  page: "3",
  contextBefore: "",
  matchText: "Kyiv — stolytsia",
  contextAfter: "",
  warnings: [],
  /*
   * B4: у справжньому плані writeText рахує normalizeAtSeam (planner.ts), а не
   * toAcceptedEdits — тут кандидат будується вручну, тож writeText задається
   * фікстурою напряму, як і matchText. Для рядка нижче нормалізація нічого не
   * міняє (тире й лапки вже типографські), тож writeText збігається з request.new.
   */
  writeText: "Львів — «столиця»",
  normalizations: [],
  ...o,
});

const item = (o: Partial<PlanItem> = {}): PlanItem => ({
  id: "r1",
  status: "unique",
  request: { id: "r1", action: "replace", old: "Kyiv - stolytsia", new: "Львів — «столиця»" },
  candidates: [candidate()],
  suggestions: [],
  ...o,
});

const plan = (o: Partial<Plan> = {}): Plan => ({
  planId: "p1",
  createdAt: "2026-07-28T10:00:00.000Z",
  docName: "kniha.indd",
  items: [item()],
  ...o,
});

describe("toAcceptedEdits", () => {
  /*
   * Очікуваний старий текст — це matchText, тобто рівно те, що прочитано з
   * документа (з em dash), а не `old` із запиту (де дефіс). Новий текст — це
   * cand.writeText (B4: поле `new` ПІСЛЯ типографської нормалізації в
   * контексті шва, обчисленої під час сухого прогону в planner.ts; toAcceptedEdits
   * її лише бере). У цьому кандидаті writeText збігається з `new` дослівно,
   * бо рядок уже типографський (тире, а не дефіс; лапки-ялинки) — нормалізації
   * тут нічого не змінюють.
   */
  it("бере expectedOld з документа, а newText — writeText кандидата", () => {
    const edits = toAcceptedEdits(plan(), [{ requestId: "r1", candidateId: "r1#0" }]);
    expect(edits).toHaveLength(1);
    expect(edits[0]!.expectedOld).toBe("Kyiv — stolytsia");
    expect(edits[0]!.newText).toBe("Львів — «столиця»");
    expect(edits[0]!.start).toBe(10);
    expect(edits[0]!.end).toBe(17);
    expect(edits[0]!.containerId).toBe("story:0");
  });

  it("для delete записуваний текст завжди порожній", () => {
    const p = plan({
      items: [
        item({
          request: { id: "r1", action: "delete", old: "зайве", new: "не має значення" },
        }),
      ],
    });
    const edits = toAcceptedEdits(p, [{ requestId: "r1", candidateId: "r1#0" }]);
    expect(edits[0]!.newText).toBe("");
    expect(edits[0]!.action).toBe("delete");
  });

  it("для insert діапазон лишається діапазоном якоря", () => {
    const p = plan({
      items: [
        item({
          request: { id: "r1", action: "insert", old: "Kyiv - stolytsia", new: " (уточнення)" },
        }),
      ],
    });
    const edits = toAcceptedEdits(p, [{ requestId: "r1", candidateId: "r1#0" }]);
    expect(edits[0]!.action).toBe("insert");
    expect(edits[0]!.expectedOld).toBe("Kyiv — stolytsia");
    expect(edits[0]!.end).toBe(17);
  });

  it("кидає зрозумілу помилку на невідомий requestId", () => {
    expect(() => toAcceptedEdits(plan(), [{ requestId: "nemaie", candidateId: "r1#0" }])).toThrow(
      /nemaie/,
    );
  });

  it("кидає зрозумілу помилку на невідомий candidateId", () => {
    expect(() => toAcceptedEdits(plan(), [{ requestId: "r1", candidateId: "r1#9" }])).toThrow(
      /r1#9/,
    );
  });
});

/*
 * Виправлення 4. runJsx при таймауті вбиває osascript, але скрипт УСЕРЕДИНІ
 * InDesign продовжує виконуватися — для обробника, що пише, це означає, що
 * правки можуть лягти вже після того, як інструмент відзвітував про помилку.
 * Тому запис має і власний, більший ліміт, і повідомлення, яке прямо це каже.
 */
describe("таймаут застосування правок", () => {
  it("дає запису більше часу, ніж 30 с за замовчуванням у runJsx", () => {
    expect(APPLY_TIMEOUT_MS).toBeGreaterThan(30_000);
  });

  it("повідомляє, що операція могла продовжитися, і де шукати копію", () => {
    const e = describeApplyTimeout();
    expect(e.kind).toBe("busy");
    /* Йдеться саме про запис, а не про будь-який виклик InDesign. */
    expect(e.message).toContain("WRITING");
    /* Прямо сказано, що правки могли застосуватися попри помилку. */
    expect(e.message).toMatch(/NOT aborted by that/);
    expect(e.message).toMatch(/may have been applied/);
    /* І куди дивитися: документ очима + копія в _backups. */
    expect(e.hint).toContain("_backups");
    expect(e.hint).toMatch(/inspected the document/);
  });
});

describe("backupStamp", () => {
  it("дає позначку у форматі спека і без символів, заборонених в іменах файлів", () => {
    const stamp = backupStamp(new Date("2026-07-28T14:32:59.123Z"));
    expect(stamp).toBe("2026-07-28-1432");
    expect(stamp).not.toMatch(/[:/\\]/);
  });
});

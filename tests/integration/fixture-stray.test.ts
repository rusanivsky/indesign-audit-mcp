import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  closeFixtureDocAtPath,
  closeStrayFixtureDocs,
  isStrayFixtureDoc,
  listOpenDocs,
  makePaginationFixtureDoc,
} from "./fixture-doc.js";

/*
 * ЩО ТУТ ДОВОДИТЬСЯ І ЧОГО НЕ ДОВЕДЕ ЮНІТ.
 *
 * Юніт-двійник (`tests/unit/fixture-stray.test.ts`) судить ПРЕДИКАТ на
 * вигаданих шляхах. Він не знає головного: у якому саме вигляді InDesign
 * віддає шлях відкритого документа. Виміряно 2026-08-16 — `mkdtemp` дає
 * `/var/folders/…`, а `doc.fullName` те саме місце називає
 * `/private/var/folders/…`. Предикат, зелений на вигаданих рядках, на живому
 * документі не впізнав би НІЧОГО.
 *
 * Тому цей тест інсценує рівно той стан, що лишався після прогону: фікстуру
 * створено, до кінця не закрито — і прибирання мусить закрити саме її, не
 * зачепивши решти відкритих документів (у користувача це його робоча книжка).
 */
describe("прибирання ЗАБУТОЇ фікстури", () => {
  it(
    "закриває залишений документ і НЕ чіпає жодного іншого відкритого",
    async () => {
      /* Знімок «до» рахуємо БЕЗ уже забутих фікстур, якщо такі є: інакше
       * власний слід чужого файлу зробив би цей тест хибно червоним, а
       * прибирання — винним у чужому витоку. */
      const before = (await listOpenDocs()).filter((d) => !isStrayFixtureDoc(d.name, d.fullName));

      const dir = await mkdtemp(join(tmpdir(), "idmcp-pgn-stray-"));
      const filePath = join(dir, "pagination-fixture.indd");
      try {
        const docName = await makePaginationFixtureDoc(dir);
        /* І НЕ ЗАКРИВАЄМО. Це і є стан витоку — рівно те, що лишав по собі
         * прогін, коли `afterEach` не мав чого закривати або не зміг. */

        const during = await listOpenDocs();
        const leaked = during.find((d) => d.fullName !== null && d.fullName.includes(basename(dir)));
        expect(leaked, "фікстура мусить бути серед відкритих документів").toBeDefined();
        expect(leaked!.name).toBe(docName);
        expect(during.length).toBe(before.length + 1);

        const closed = await closeStrayFixtureDocs();
        expect(closed.map((d) => d.fullName)).toContain(leaked!.fullName);

        /* ГОЛОВНЕ ТВЕРДЖЕННЯ: множина відкритих документів повернулась до
         * тієї, що була до створення фікстури, — поіменно, а не за
         * кількістю. Однакова кількість при різних документах означала б
         * «одне закрили, інше відкрили», і лічильник цього не показав би. */
        const after = await listOpenDocs();
        expect(after.map((d) => d.name).sort()).toEqual(before.map((d) => d.name).sort());
      } finally {
        /* Якщо перевірка впала ДО прибирання — фікстура все одно не має
         * пережити цього тесту. Закриття за точним шляхом безпечне навіть
         * тоді, коли документа вже немає: воно просто нічого не знайде. */
        await closeFixtureDocAtPath(filePath).catch(() => {});
        await rm(dir, { recursive: true, force: true });
      }
    },
    300_000,
  );
});

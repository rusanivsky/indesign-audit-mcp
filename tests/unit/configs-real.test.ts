import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { collectTools } from "../../src/cli/collect.js";
import { reconcileWithToolSchemas, validateConfig } from "../../src/cli/config/validate.js";

const КОРІНЬ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/*
 * КОНФІГИ, ЩО ЛЕЖАТЬ У РЕПОЗИТОРІЇ, МУСЯТЬ БУТИ ДІЙСНИМИ — і це не
 * формальність.
 *
 * Дірою, через яку цей файл з'явився (§3.3 передачі, 2026-08-18), був
 * `configs/istoriya.json`: він ніс `sequences: { rules: [] }`, тобто родину,
 * яка виконується, платить за весь обхід документа й не перевіряє нічого, а
 * зі звіту зникає цілком. Ворота на таку форму додано — і виявилось, що
 * ЧИННИЙ конфіг користувача крізь них не проходить. Тобто мовчазний стан
 * жив не в теорії, а в тому самому файлі, яким ганяли «Book B».
 *
 * Перевіряються ОБИДВА шари ступеня 1, і це теж не формальність: перший
 * зонд цієї задачі кликав лише `validateConfig`, побачив «пройшло» й мало не
 * дав хибний висновок, що стара форма `folio` не ловиться ніде. Ловить її
 * саме `reconcileWithToolSchemas` — другий шар, окрема функція.
 */
/*
 * ПЕРЕЛІК ЧИТАЄТЬСЯ З ДИСКА, А НЕ ЗАПИСАНИЙ РУКАМИ.
 *
 * Доти тут стояв список із трьох імен, і новий `configs/*.json` не
 * перевірявся НІЧИМ — ані `validateConfig`, ані `reconcileWithToolSchemas`, —
 * тобто ворота, поставлені саме проти мовчазного конфіга, самі мали мовчазну
 * межу. `readdirSync` знімає це: файл, покладений у теку, потрапляє під
 * перевірку тим, що він там лежить.
 */
const КОНФІГИ = readdirSync(join(КОРІНЬ, "configs"))
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => `configs/${f}`);

describe("конфіги в репозиторії проходять ступінь 1", () => {
  it("у теці взагалі є конфіги — інакше кожна перевірка нижче порожня", () => {
    /* Негативний контроль на сам прилад: перейменована тека або змінене
     * розширення лишили б цикли без жодної ітерації, а набір — зеленим. */
    expect(КОНФІГИ.length).toBeGreaterThan(0);
  });

  for (const шлях of КОНФІГИ) {
    it(`${шлях}: обидва шари`, async () => {
      const сирий = JSON.parse(readFileSync(join(КОРІНЬ, шлях), "utf8"));
      const cfg = validateConfig(сирий);
      await expect(reconcileWithToolSchemas(cfg, collectTools())).resolves.toBeUndefined();
    });
  }

  it("жоден конфіг не несе порожнього sequences.rules", () => {
    /* Той самий стан, що зробив цей файл потрібним. Якщо він повернеться —
     * повернеться сюди, а не в мовчазний прогін. */
    for (const шлях of КОНФІГИ) {
      const сирий = JSON.parse(readFileSync(join(КОРІНЬ, шлях), "utf8"));
      const sq = сирий.families?.sequences;
      if (sq !== undefined && Array.isArray(sq.rules)) {
        expect(sq.rules.length, `${шлях}: порожній rules`).toBeGreaterThan(0);
      }
    }
  });
});

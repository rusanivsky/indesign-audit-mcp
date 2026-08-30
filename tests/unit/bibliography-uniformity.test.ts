import { describe, expect, it } from "vitest";
import { MIN_RECORDS_FOR_UNIFORMITY, measureUniformity } from "../../src/bibliography/uniformity.js";
import { parseRecord } from "../../src/bibliography/parse.js";
import type { BibRecord } from "../../src/bibliography/types.js";

const rec = (n: number, text: string): BibRecord => ({
  number: n, text, containerId: "story:0", start: 0, end: text.length, page: "20",
});

const body = (sep: string) =>
  `Прізвище, Ім'я По батькові. Назва / І. П. Прізвище // Журнал${sep}2024${sep}С. 5-9.`;

const corpus = (dashCount: number, hyphenCount: number) => {
  const out: BibRecord[] = [];
  let n = 1;
  for (let i = 0; i < dashCount; i++) out.push(rec(n++, `${n}. ${body(". – ")}`));
  for (let i = 0; i < hyphenCount; i++) out.push(rec(n++, `${n}. ${body(". - ")}`));
  return out.map(parseRecord);
};

describe("measureUniformity", () => {
  it("однорідну більшість називає systematic", () => {
    const f = measureUniformity(corpus(2, 98)).find((x) => x.id === "zone-separator");
    expect(f?.verdict).toBe("systematic");
    expect(f?.dominantShare).toBeGreaterThanOrEqual(0.95);
  });

  it("поділ навпіл називає mixed, а не systematic", () => {
    /* Спек §6: детектор, що при 50/50 оголошує половину книжки помилковою, гірший за відсутній. */
    const f = measureUniformity(corpus(50, 50)).find((x) => x.id === "zone-separator");
    expect(f?.verdict).toBe("mixed");
  });

  it("розсипані відхилення називає scattered", () => {
    const f = measureUniformity(corpus(88, 12)).find((x) => x.id === "zone-separator");
    expect(f?.verdict).toBe("scattered");
  });

  it("при вибірці менше 30 записів не рахує взагалі", () => {
    expect(measureUniformity(corpus(2, 3))).toEqual([]);
    expect(MIN_RECORDS_FOR_UNIFORMITY).toBe(30);
  });

  it("бачить ОБИДВІ форми, коли вони в одному записі", () => {
    /*
     * Реальний запис має роздільник зон кілька разів. Зонд, що дивиться лише на
     * перший, звітує «100 % systematic» для корпусу, де половина позицій хибна.
     *
     * Перший роздільник (перед вихідними даними) — тире (–),
     * другий роздільник (перед сторінками) — дефіс (-).
     * У всіх 35 записах — такий же розподіл.
     * Так кожен запис додає 1 до тире й 1 до дефіса => 50/50.
     */
    const body = (n: number) =>
      `${n}. Прізвище, Ім'я По батькові. Назва / І. П. Прізвище // Журнал. – 2024. - С. 5-9.`;
    const corpus = Array.from({ length: 35 }, (_, i) =>
      parseRecord(rec(i + 1, body(i + 1))));
    const f = measureUniformity(corpus).find((x) => x.id === "zone-separator");
    expect(f?.forms).toHaveLength(2);
    expect(f?.dominantShare).toBeCloseTo(0.5, 2);
    expect(f?.verdict).toBe("mixed");
  });

  /*
   * Знахідка M2: проба `initials-spacing` вживала літерал `" ?"` замість `H`.
   * Літерал не збігається з U+00A0, тобто пара, УЖЕ захищена нерозривним
   * пробілом, для проби просто не існувала. Наслідок на видання, захищеному
   * наполовину: лічився лише незахищений бік, домінантна частка виходила
   * 100 %, і вердикт читався `systematic` — рівно протилежне до правди.
   */
  it("бачить пару, ЗАХИЩЕНУ нерозривним пробілом, а не тільки звичайну", () => {
    const NBSP = "\u00A0";
    const withGap = (n: number, gap: string) =>
      `${n}. Прізвище, Ім'я По батькові. Назва / І.${gap}П. Прізвище // Журнал. – 2024. – С. 5-9.`;
    const corpus = [
      ...Array.from({ length: 20 }, (_, i) => parseRecord(rec(i + 1, withGap(i + 1, NBSP)))),
      ...Array.from({ length: 20 }, (_, i) => parseRecord(rec(i + 21, withGap(i + 21, " ")))),
    ];
    const f = measureUniformity(corpus).find((x) => x.id === "initials-spacing");
    /* Обидві форми видні, і вердикт відповідає реальному розколу 50/50. */
    expect(f?.forms).toHaveLength(2);
    expect([...(f?.forms ?? [])].map((x) => x.value).sort()).toEqual([NBSP, " "].sort());
    expect(f?.verdict).toBe("mixed");
  });
});

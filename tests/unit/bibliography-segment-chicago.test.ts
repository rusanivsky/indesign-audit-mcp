import { describe, expect, it } from "vitest";
import type { ContainerSnapshot } from "../../src/corrections/types.js";
import { segmentChicago } from "../../src/bibliography/segment-chicago.js";
import { CIP_RECORD } from "./fixtures/chicago-cip.js";

const snap = (text: string): ContainerSnapshot => ({
  containerId: "story:245",
  text,
  pageRuns: [{ start: 0, end: text.length + 1, page: "4" }],
  oversetFrom: null,
  isMaster: false,
  kind: "text",
});


describe("segmentChicago", () => {
  it("зшиває заголовок в окремому абзаці з описом у наступному", () => {
    const r = segmentChicago(snap(CIP_RECORD));
    expect(r.records).toHaveLength(1);
    expect(r.records[0]?.text).toBe(CIP_RECORD);
    expect(r.records[0]?.page).toBe("4");
  });

  it("зріз запису дослівно дорівнює зрізу контейнера", () => {
    /* Контракт, на якому тримаються ВСІ зсуви правил. */
    const s = snap(CIP_RECORD);
    const r = segmentChicago(s);
    const rec = r.records[0];
    expect(rec).toBeDefined();
    expect(s.text.slice(rec!.start, rec!.end)).toBe(rec!.text);
  });

  it("проза, що починається з «Слово + Я», записів НЕ відкриває", () => {
    /*
     * ЦЕ НЕ ГІПОТЕТИЧНИЙ ВИПАДОК. Перша редакція відкривача вимагала лише
     * `[A-Z]` другим токеном, і живий прогін по англійському виданню відкрив
     * П'ЯТЬ хибних записів із шести — усі проза такої форми. Тест нижче
     * відтворює саме ті форми (речення власні, бо текст книжки в репозиторії
     * не живе), разом із лапками в прозі, на яких вони проходили
     * розрізняльник.
     */
    const prose =
      "When I found out about it, I lived a great many emotions at once.\r" +
      "Today I am a mother of two, and they grow up at a sprint.\r" +
      "Here I want to speak about being kind to yourself.\r" +
      "Professionally, I recommend being a witness rather than a fighter.\r" +
      "Do NOT rely on a machine — ask a doctor, not “just in case,” but knowing why.";
    const r = segmentChicago(snap(prose));
    expect(r.records).toEqual([]);
  });

  it("лапки в прозі — не розрізняльник", () => {
    /* Відкривач тут справжній, тож усе тримається на розрізняльнику. */
    const quoted = "Alpha Ann said the words “fighting the swings” and nothing else.";
    expect(segmentChicago(snap(quoted)).records).toEqual([]);
  });

  it("проза цієї книжки записів НЕ відкриває", () => {
    /*
     * Точна пастка ДСТУ: патерн лише за ознакою відкриття дав 1866 хибних
     * «записів» на цьому ж виданні. Абзаци нижче взято з живого документа за
     * формою: друге слово з малої літери, або цифра, або двокрапка.
     */
    const prose =
      "The book covers the practical and psychological sides of pregnancy.\r" +
      "Back home I bought a test almost on autopilot.\r" +
      "Format 70×100/12. Offset printing.\r" +
      "Paper: Munken Print White, 150 g/m2\r" +
      "Created by the publisher PUBLISHER, editor in chief: Name Surname.\r" +
      "BIRTH — MEETING YOUR BABY";
    const r = segmentChicago(snap(prose));
    expect(r.records).toEqual([]);
  });

  it("відкривач без розрізняльника — не запис", () => {
    const r = segmentChicago(snap("Surname Firstname.\r\rAnother Paragraph here."));
    expect(r.records).toEqual([]);
    expect(r.skipped.some((s) => s.reason === "no-discriminator")).toBe(true);
  });

  it("кириличний запис не відкривається взагалі", () => {
    const uk = "Прізвище Ім'я.\rНазва / Ім'я Прізвище. — Київ : ВИДАВЕЦЬ, 2026. — 196 с.";
    const r = segmentChicago(snap(uk));
    expect(r.records).toEqual([]);
    expect(r.skipped.map((s) => s.reason)).toContain("cyrillic");
  });

  it("кириличне продовження не приростає до латинського відкривача", () => {
    /*
     * Ворота стоять на рівні абзацу саме заради цього випадку: блок,
     * відкритий латиницею, не сміє поглинути кириличний абзац і піти на
     * правила разом із ним.
     */
    const mixed = "Alpha, Ann. First Title. City: Publisher, 2019.\rКиїв : ВИДАВЕЦЬ, 2026.";
    const r = segmentChicago(snap(mixed));
    expect(r.records).toHaveLength(1);
    expect(r.records[0]?.text).toBe("Alpha, Ann. First Title. City: Publisher, 2019.");
    expect(r.skipped.map((s) => s.reason)).toContain("cyrillic");
  });

  it("причина пропуску не бреше: кирилиця — це не «рубрика»", () => {
    const uk = "Прізвище Ім'я.\rНазва / Ім'я Прізвище. — Київ : ВИДАВЕЦЬ, 2026. — 196 с.";
    const reasons = segmentChicago(snap(uk)).skipped.map((s) => s.reason);
    expect(reasons.every((x) => x === "cyrillic")).toBe(true);
    expect(reasons).not.toContain("heading");
  });

  it("три-емний тире відкриває запис повторюваного автора", () => {
    const repeated = "———. Another Title. City: Publisher, 2019.";
    const r = segmentChicago(snap(repeated));
    expect(r.records).toHaveLength(1);
  });

  it("майстер-сторінки не сегментуються", () => {
    const r = segmentChicago({ ...snap(CIP_RECORD), isMaster: true });
    expect(r.records).toEqual([]);
  });

  it("два записи поспіль розділяються, і нумеруються за порядком", () => {
    const two =
      "Alpha, Ann. First Title. City: Publisher, 2019.\r" +
      "Beta, Bob. Second Title. City: Publisher, 2020.";
    const r = segmentChicago(snap(two));
    expect(r.records.map((x) => x.number)).toEqual([1, 2]);
  });
});

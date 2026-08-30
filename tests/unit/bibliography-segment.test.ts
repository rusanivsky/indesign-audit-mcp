import { describe, expect, it } from "vitest";
import type { ContainerSnapshot } from "../../src/corrections/types.js";
import { segmentContainer } from "../../src/bibliography/segment.js";

const snap = (text: string): ContainerSnapshot => ({
  containerId: "story:0",
  text,
  pageRuns: [{ start: 0, end: text.length + 1, page: "20" }],
  oversetFrom: null,
  isMaster: false,
  kind: "text",
});

/* Дослівно з випуску 2024, спек §0. */
const REC_50 =
  "50. Павлинський, Юрій Віталійович. Історичні джерела про рибальство України " +
  "/ Ю. В. Павлинський // Наукові праці студентів. - 2024. - Вип. 21, ч. 2. - С. 68-74.";
const REC_51 =
  "51. Палаш, Альона Олегівна. Маркери національної картини світу " +
  "/ А. О. Палаш // Культура слова : зб. наук. пр. - 2024. - Вип. 100. - С. 148-161.";

describe("segmentContainer", () => {
  it("розрізає два записи й дістає їхні номери", () => {
    const r = segmentContainer(snap(`${REC_50}\r${REC_51}`));
    expect(r.records.map((x) => x.number)).toEqual([50, 51]);
    expect(r.records[0]?.page).toBe("20");
  });

  it("НЕ рахує записами рубрики, які нумеруються так само", () => {
    /*
     * Спек §4: патерн лише за номером ловив рубрикатор — шість розділів із
     * шести перших «записів». Пастка спрацювала на двох незалежних прогонах.
     */
    const headings =
      "4. Iсторичне краєзнавство\r" +
      "2. Теорія та філософія історії України\r" +
      "3. Населення. Демографія";
    const r = segmentContainer(snap(headings));
    expect(r.records).toEqual([]);
    expect(r.skipped.map((s) => s.reason)).toEqual([
      "no-discriminator",
      "no-discriminator",
      "no-discriminator",
    ]);
  });

  it("рубрика поруч із записом не з'їдає запис", () => {
    const r = segmentContainer(snap(`4. Iсторичне краєзнавство\r${REC_50}`));
    expect(r.records.map((x) => x.number)).toEqual([50]);
    expect(r.skipped).toHaveLength(1);
  });

  it("НЕ рахує записом відсилання «Див. також №:»", () => {
    const r = segmentContainer(snap("Див. також №: 195, 219, 569, 961."));
    expect(r.records).toEqual([]);
    expect(r.skipped[0]?.reason).toBe("cross-reference");
  });

  it("бачить дірку в нумерації", () => {
    const r = segmentContainer(snap(`${REC_50}\r${REC_51.replace(/^51\./, "77.")}`));
    expect(r.numberingGaps).toEqual([{ after: 50, next: 77 }]);
  });

  it("пропускає майстер-контейнери цілком", () => {
    const s = { ...snap(REC_50), isMaster: true };
    expect(segmentContainer(s).records).toEqual([]);
  });

  it("запис із роздільником-тире розпізнається так само, як із дефісом", () => {
    const withDash = REC_50.replace(/\. - /g, ". – ");
    expect(segmentContainer(snap(withDash)).records).toHaveLength(1);
  });

  /*
   * Задача 15: доказ на живій книжці показав, що модель «абзац = запис»
   * неправильна — запис часто розірваний на кілька абзаців (заголовок і
   * опис окремо). Сегментація стає блоковою: порожній абзац або новий номер
   * закриває відкритий запис, а звичайний абзац приєднується до нього.
   */
  it("з'єднує заголовок і опис, розділені знаком абзацу", () => {
    const text =
      "446. Добко, Тетяна Василiвна. \rБiблiографiчнi покажчики / Т. В. Добко // " +
      "Вiсник. – 2021. – С. 54-58.\r\r447. Iнший, Iван. \rОпис / I. Iнший // Журнал. – 2022. – С. 1-9.";
    const r = segmentContainer(snap(text));
    expect(r.records).toHaveLength(2);
    expect(r.records[0]?.number).toBe(446);
    expect(r.records[0]?.text).toContain("Бiблiографiчнi покажчики");
  });

  /*
   * ПОСИЛЕНО після знахідки C1 фінальної рецензії. Раніше тут вимагалось лише
   * «довжина збігається» і «\r у тексті немає» — саме друга вимога і БУЛА
   * дефектом: `\r` замінявся на пробіл символ-на-символ, довжина справді
   * зберігалась, а жоден шар нижче вже не відрізняв справжній пробіл від межі
   * абзацу, і `bib-nbsp-initials` пропонував поставити U+00A0 НА МІСЦЕ знака
   * абзацу (тобто злити два абзаци). Тепер вимога сильніша й простіша: текст
   * запису — це РІВНО зріз контейнера, знак у знак.
   */
  it("текст запису — РІВНО зріз контейнера, включно зі знаками абзацу", () => {
    const text = "446. Заголовок. \rОпис / I. I. // Ж. – 2021. – С. 5-9.";
    const r = segmentContainer(snap(text));
    const rec = r.records[0]!;
    expect(rec.text).toBe(text.slice(rec.start, rec.end));
    expect(rec.text).toContain("\r");
  });

  /*
   * Знахідка M4: `DEFAULT_RECORD_PATTERN` вживав `\s`, а `parse.ts:81` для
   * ТОГО САМОГО префікса («номер, крапка, пробіл») — `H`. Різниця не
   * теоретична: `\s` збігається з примусовим розривом рядка `\n` усередині
   * абзацу, `H` — ні. Розходження мовчазне: сегментація відкривала б запис,
   * якого парсер не впізнає, і номер зі своєю крапкою потрапляв би всередину
   * зони «title».
   */
  it("номер із примусовим розривом рядка замість пробілу НЕ відкриває запис", () => {
    const text = "50.\nПрізвище, Ім'я. Назва / І. П. Прізвище // Журнал. – 2024. – С. 5-9.";
    const r = segmentContainer(snap(text));
    expect(r.records).toEqual([]);
    expect(r.skipped.some((s) => s.reason === "heading")).toBe(true);
  });

  it("порожній абзац завершує запис, і наступний блок не приклеюється", () => {
    const text = "446. Заголовок. \rОпис / I. I. // Ж. – 2021. – С. 5-9.\r\rРубрика без номера";
    const r = segmentContainer(snap(text));
    expect(r.records).toHaveLength(1);
    expect(r.records[0]?.text).not.toContain("Рубрика");
    expect(r.skipped.some((s) => s.text.includes("Рубрика"))).toBe(true);
  });

  it("запис із ТРЬОХ абзаців збирається цілком", () => {
    const text =
      "448. Життя у творчому горiннi : покажчик / Прикарпат. ун-т ; упоряд.: \r" +
      "В. Г. Дутчак ; вступ. слово Л. В. Бабiй. – Iвано-Франкiвськ, 2022. – \r" +
      "110 с. – До 65-рiччя.";
    const r = segmentContainer(snap(text));
    expect(r.records).toHaveLength(1);
    expect(r.records[0]?.text).toContain("110 с.");
  });

  it("відсилання завершує запис, а не поглинається ним", () => {
    /*
     * «Див. також №:» — не частина опису. Якщо воно трапляється між заголовним
     * абзацом і продовженням, запис мусить закритися на ньому, інакше той самий
     * текст буде і в skipped, і всередині запису — і правила ДСТУ дадуть знахідки,
     * приписані чужому запису.
     *
     * Заголовний абзац навмисно вже несе роздільник зони (" – 2021. – С. 5.") —
     * інакше запис 446 сам по собі не проходить дискримінатор і зникає з
     * results цілком (r.records[0] стає undefined), і тест перестає щось
     * доводити про саме відсилання.
     */
    const text = "446. Заголовок. – 2021. – С. 5.\rДив. також №: 1, 2.\rОпис продовження.";
    const r = segmentContainer(snap(text));
    expect(r.records[0]?.text).not.toContain("Див. також");
    expect(r.skipped.some((s) => s.reason === "cross-reference")).toBe(true);
  });
});

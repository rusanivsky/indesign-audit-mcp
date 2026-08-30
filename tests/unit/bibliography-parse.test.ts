import { describe, expect, it } from "vitest";
import { parseRecord } from "../../src/bibliography/parse.js";
import type { BibRecord } from "../../src/bibliography/types.js";

const rec = (text: string): BibRecord => ({
  number: 50, text, containerId: "story:0", start: 0, end: text.length, page: "20",
});

const FULL =
  "50. Павлинський, Юрій Віталійович. Історичні джерела про рибальство " +
  "/ Ю. В. Павлинський // Наукові праці студентів : зб. наук. пр. - 2024. - Вип. 21. - С. 68-74.";

describe("parseRecord", () => {
  it("виділяє заголовок запису до першої крапки після ПІБ", () => {
    const z = parseRecord(rec(FULL)).zones.find((x) => x.id === "heading");
    expect(z?.text).toBe("Павлинський, Юрій Віталійович.");
  });

  it("виділяє відповідальність за похилою рискою", () => {
    const z = parseRecord(rec(FULL)).zones.find((x) => x.id === "responsibility");
    expect(z?.text.trim()).toBe("/ Ю. В. Павлинський");
  });

  it("виділяє джерело за двома похилими рисками", () => {
    const z = parseRecord(rec(FULL)).zones.find((x) => x.id === "source");
    expect(z?.text).toContain("Наукові праці студентів");
  });

  it("розпізнає зону, ПОПРИ хибний роздільник — інакше правило не змогло б поскаржитись", () => {
    /*
     * Парсер не суддя (спек §5). Щоб правило сказало «тут дефіс замість тире»,
     * зона мусить спершу розпізнатись саме з дефісом.
     */
    const ids = parseRecord(rec(FULL)).zones.map((z) => z.id);
    expect(ids).toContain("imprint");
    const withDash = FULL.replace(/\. - /g, ". – ");
    expect(parseRecord(rec(withDash)).zones.map((z) => z.id)).toContain("imprint");
  });

  it("НЕ ріже зону на граматичному тире", () => {
    /*
     * Спек §0.3: більшість «. – » у корпусі — граматичні тире, а не роздільники.
     * Наступний токен мусить справді починати зону.
     */
    const grammatical =
      "50. Любовець, Н. І. Українська мемуарна традиція (ХІІ ст. – перша третина ХХ ст.) " +
      "/ Н. І. Любовець // Вісник. - 2024. - С. 5-9.";
    const zones = parseRecord(rec(grammatical)).zones;
    expect(zones.filter((z) => z.id === "imprint")).toHaveLength(1);
    expect(zones.find((z) => z.id === "title")?.text).toContain("перша третина ХХ ст.");
  });

  it("нерозбірний запис повертає причину, а не викидається", () => {
    const p = parseRecord(rec("50. Самі слова без жодної приписаної пунктуації 2024"));
    expect(p.unparsed).not.toBeNull();
    expect(p.zones).toEqual([]);
  });

  it("опис БЕЗ особистого заголовка розбирається, а не оголошується нерозбірним", () => {
    /*
     * Ревізія: заголовок запису НЕобов'язковий (крок 1 у parse.ts). Стара
     * HEADING хапала все до першої коми — а перша кома в описі без
     * особистого заголовка це «Видавництво, рік» у вихідних даних, тож
     * запис оголошувався нерозбірним.
     */
    const p = parseRecord(rec("50. Педагогіка. – Київ : Освіта, 2024. – 5 с."));
    expect(p.unparsed).toBeNull();
    expect(p.zones.find((z) => z.id === "heading")).toBeUndefined();
    expect(p.zones.find((z) => z.id === "title")?.text.trim()).toBe("Педагогіка");
  });

  it("заголовок з ініціалами не обрізається", () => {
    const p = parseRecord(rec("50. Іванов, П. П. Назва праці. – Київ : Наука, 2024. – 10 с."));
    expect(p.zones.find((z) => z.id === "heading")?.text).toBe("Іванов, П. П.");
    expect(p.zones.find((z) => z.id === "title")?.text.trim()).toBe("Назва праці");
  });

  it("заголовок із повним іменем і по батькові лишається цілим", () => {
    const p = parseRecord(
      rec(
        "50. Павлинський, Юрій Віталійович. Історичні джерела / Ю. В. Павлинський " +
          "// Праці. - 2024. - С. 68-74.",
      ),
    );
    expect(p.zones.find((z) => z.id === "heading")?.text).toBe("Павлинський, Юрій Віталійович.");
  });

  /*
   * Опора для знахідки M3. `ZONE_STARTERS` вшивав власний літерал
   * `a-zа-яїієґ'’.-` замість `UK_LOWER` із `chars.ts`. Заміна — це
   * ДЕДУПЛІКАЦІЯ, не виправлення поведінки: діапазон `а-я` за збігом уже
   * покривав ті самі літери, тож мутація «повернути літерал» цей тест НЕ
   * вбиває — і саме це тут і доводиться. Тест фіксує поведінку, яку заміна
   * НЕ сміла зачепити: місце видання впізнається з будь-якою українською
   * літерою в хвості слова, включно з латинською гомогліфною `i`.
   */
  it("впізнає місце видання незалежно від літер у хвості слова", () => {
    for (const city of ["Севастополь", "Миколаїв", "Хмельницький", "Львiв"]) {
      const p = parseRecord(rec(`50. Назва праці. – ${city} : Наука, 2024. – 10 с.`));
      expect(p.unparsed).toBeNull();
      expect(p.zones.find((z) => z.id === "imprint")?.text).toContain(city);
    }
  });
});

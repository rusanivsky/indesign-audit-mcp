import { describe, expect, it } from "vitest";
import { collectVariantPairs, matchVariantForm, VARIANT_PAIRS } from "../../src/typography/spelling2019.js";
import type { ContainerSnapshot } from "../../src/corrections/types.js";
import type { ContainerLanguage } from "../../src/spelling/types.js";

describe("matchVariantForm", () => {
  it("впізнає обидві форми пари у відмінкових формах", () => {
    expect(matchVariantForm("ефіру")).toEqual({ pairId: "ефір/етер", form: "ефір" });
    expect(matchVariantForm("етері")).toEqual({ pairId: "ефір/етер", form: "етер" });
  });

  it("впізнає форму, що інфлектує зі зміною закінчення", () => {
    expect(matchVariantForm("аудиторії")).toEqual({
      pairId: "аудиторія/авдиторія", form: "аудиторія",
    });
    expect(matchVariantForm("павзи")).toEqual({ pairId: "пауза/павза", form: "павза" });
  });

  it("не плутає регістру у власних назвах", () => {
    expect(matchVariantForm("Афінах")).toEqual({ pairId: "Афіни/Атени", form: "Афіни" });
    expect(matchVariantForm("Ґете")).toEqual({ pairId: "Гете/Ґете", form: "Ґете" });
  });

  it("виняток вимикає збіг, а сама форма лишається впізнаваною", () => {
    /* Позитивний близнюк у тому самому тесті: «Георгій не збігся» істинне й
     * тоді, коли впізнавання зламане назовсім. */
    expect(matchVariantForm("Георгій")).toBeNull();
    expect(matchVariantForm("георгін")).toBeNull();
    expect(matchVariantForm("Георга")).toEqual({ pairId: "Георг/Ґеорґ", form: "Георг" });

    expect(matchVariantForm("гетерогенний")).toBeNull();
    expect(matchVariantForm("Гете")).toEqual({ pairId: "Гете/Ґете", form: "Гете" });
  });

  it("точний перелік не ловить чужих слів із тим самим початком", () => {
    /* «міт» як основа збігся б із «мітинг», «мітка», «мітла» — тому саме ця
     * пара лічиться ТОЧНИМ переліком словоформ, а не початком слова. */
    expect(matchVariantForm("мітинг")).toBeNull();
    expect(matchVariantForm("мітла")).toBeNull();
    expect(matchVariantForm("мітом")).toEqual({ pairId: "міф/міт", form: "міт" });
    expect(matchVariantForm("міфи")).toEqual({ pairId: "міф/міт", form: "міф" });
  });

  it("слово поза таблицею — null, а слово з таблиці лишається впізнаваним", () => {
    expect(matchVariantForm("мама")).toBeNull();
    expect(matchVariantForm("ефіру")).toEqual({ pairId: "ефір/етер", form: "ефір" });
  });

  it("виняток «Іродіада» вимикає збіг з «ірод»/«ирод», а самі форми лишаються впізнаваними", () => {
    /* «Іродіада» (Иродіада) — інша особа, не форма «Ірод»/«Ирод»; саме її
     * ловить `except`. Позитивний близнюк для обох половин пари: родовий
     * відмінок «Ірода»/«Ирода» лишається впізнаваним. */
    expect(matchVariantForm("Іродіада")).toBeNull();
    expect(matchVariantForm("Ірода")).toEqual({ pairId: "ірод/ирод", form: "ірод" });
    expect(matchVariantForm("Иродіада")).toBeNull();
    expect(matchVariantForm("Ирода")).toEqual({ pairId: "ірод/ирод", form: "ирод" });
  });
});

describe("таблиця пар — структурні інваріанти", () => {
  const forms = VARIANT_PAIRS.flatMap((p) => p.forms);

  it("у таблиці рівно чотири класи й жодної порожньої пари", () => {
    expect(VARIANT_PAIRS.length).toBeGreaterThan(20);
    expect(new Set(VARIANT_PAIRS.map((p) => p.class))).toEqual(
      new Set(["au", "th", "и-", "ґ"]),
    );
  });

  it("кожна форма має РІВНО ОДИН спосіб упізнавання", () => {
    for (const f of forms) {
      expect(
        [f.stem !== undefined, f.exact !== undefined].filter(Boolean),
        `форма «${f.form}»`,
      ).toHaveLength(1);
    }
  });

  it("обидві половини пари впізнаються ОДНАКОВИМ способом", () => {
    /* Інакше числа половин непорівнянні: одну лічили б широко (початком
     * слова), другу вузько (переліком), і `mixed` брехав би. */
    for (const p of VARIANT_PAIRS) {
      expect(p.forms[0].stem === undefined, `пара «${p.pairId}»`)
        .toBe(p.forms[1].stem === undefined);
    }
  });

  it("жодна основа не є початком іншої основи", () => {
    /* Це і робить впізнавання однозначним: перший збіг = єдиний збіг, тож
     * порядок обходу таблиці не впливає на результат. */
    const stems = forms.map((f) => f.stem).filter((s): s is string => s !== undefined);
    for (const a of stems) {
      for (const b of stems) {
        if (a === b) continue;
        expect(b.startsWith(a), `«${a}» — початок «${b}»`).toBe(false);
      }
    }
  });

  it("жодна основа не є початком точної словоформи з ІНШОЇ пари", () => {
    /* matchVariantForm іде парами в порядку таблиці: якщо десь раніше в
     * масиві лежить stem, що є початком exact-словоформи, яка стоїть
     * пізніше, ця словоформа НІКОЛИ не дійде до власної exact-перевірки —
     * її мовчки підмінить чужа основа. Попередній тест звіряє лише
     * основи-з-основами; тут — основи проти точних переліків, той самий
     * ризик, якого те звіряння не бачить. */
    const stems = forms.map((f) => f.stem).filter((s): s is string => s !== undefined);
    const exacts = forms.flatMap((f) => f.exact ?? []);
    for (const stem of stems) {
      for (const word of exacts) {
        expect(word.startsWith(stem), `основа «${stem}» — початок словоформи «${word}»`)
          .toBe(false);
      }
    }
  });

  it("основи й точні переліки записані в нижньому регістрі", () => {
    for (const f of forms) {
      if (f.stem !== undefined) expect(f.stem).toBe(f.stem.toLocaleLowerCase("uk"));
      for (const w of f.exact ?? []) expect(w).toBe(w.toLocaleLowerCase("uk"));
    }
  });

  it("pairId кожної пари унікальний", () => {
    const ids = VARIANT_PAIRS.map((p) => p.pairId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

const snap = (
  id: string, text: string, page = "12", isMaster = false,
): ContainerSnapshot => ({
  containerId: id,
  text,
  pageRuns: [{ start: 0, end: text.length + 1, page }],
  oversetFrom: null,
  isMaster,
  kind: "text",
});

const uk = (id: string, len: number): ContainerLanguage[] => [
  { containerId: id, runs: [{ start: 0, end: len + 1, language: "Ukrainian" }] },
];

describe("collectVariantPairs", () => {
  it("пара в ОБОХ формах — знахідка з числами кожної", () => {
    const text = "ефір і ефіру, а далі етер.";
    const r = collectVariantPairs([snap("story:0", text)], uk("story:0", text.length), "Ukrainian");
    expect(r.mixedCount).toBe(1);
    const p = r.pairs.find((x) => x.pairId === "ефір/етер")!;
    expect(p.mixed).toBe(true);
    expect(p.forms.map((f) => [f.form, f.count])).toEqual([["ефір", 2], ["етер", 1]]);
    expect(p.forms[0]!.pages).toEqual(["12"]);
  });

  it("пара в ОДНІЙ формі — рядок інвентаря, але НЕ знахідка", () => {
    /* Послідовне видання звинуватити нема в чому: обидві форми законні. */
    const text = "ефір і ефіру.";
    const r = collectVariantPairs([snap("story:0", text)], uk("story:0", text.length), "Ukrainian");
    expect(r.mixedCount).toBe(0);
    const p = r.pairs.find((x) => x.pairId === "ефір/етер")!;
    expect(p.mixed).toBe(false);
    expect(p.forms).toHaveLength(1);
  });

  it("пари, якої в тексті немає, у звіті немає, а пара, що є, — є", () => {
    /* Позитивний близнюк: сам по собі порожній результат не відрізняє
     * коректний код від зламаного (наприклад, matchVariantForm, що завжди
     * повертає null) — обидва дали б тут []. */
    const text = "мама і тато.";
    const r = collectVariantPairs([snap("story:0", text)], uk("story:0", text.length), "Ukrainian");
    expect(r.pairs).toEqual([]);

    const withPair = "мама, тато і ефір.";
    const r2 = collectVariantPairs(
      [snap("story:0", withPair)], uk("story:0", withPair.length), "Ukrainian",
    );
    expect(r2.pairs.map((p) => p.pairId)).toEqual(["ефір/етер"]);
  });

  it("слово в ЧУЖОМОВНОМУ діапазоні не лічиться, а в українському — лічиться", () => {
    /* Негативне твердження з позитивним близнюком у тому самому тесті. */
    const text = "пауза тут. пауза там.";
    const langs: ContainerLanguage[] = [{
      containerId: "story:0",
      runs: [
        { start: 0, end: 11, language: "Ukrainian" },
        { start: 11, end: text.length + 1, language: "Russian" },
      ],
    }];
    const r = collectVariantPairs([snap("story:0", text)], langs, "Ukrainian");
    expect(r.pairs.find((x) => x.pairId === "пауза/павза")!.forms[0]!.count).toBe(1);
  });

  it("контейнер майстер-сторінки не лічиться (а звичайний — лічиться)", () => {
    const text = "ефір.";
    const master = { ...snap("story:0", text), isMaster: true };
    expect(collectVariantPairs([master], uk("story:0", text.length), "Ukrainian").pairs)
      .toEqual([]);
    expect(collectVariantPairs([snap("story:0", text)], uk("story:0", text.length), "Ukrainian").pairs)
      .toHaveLength(1);
  });

  it("сторінки не повторюються, а їх повне число їде окремо", () => {
    const text = "ефір ефір ефір";
    const container: ContainerSnapshot = {
      ...snap("story:0", text),
      pageRuns: [
        { start: 0, end: 5, page: "10" },
        { start: 5, end: 10, page: "11" },
        { start: 10, end: text.length + 1, page: "10" },
      ],
    };
    const r = collectVariantPairs([container], uk("story:0", text.length), "Ukrainian");
    const f = r.pairs[0]!.forms[0]!;
    expect(f.count).toBe(3);
    expect(f.pages).toEqual(["10", "11"]);
    expect(f.pageCount).toBe(2);
  });

  it("знахідки стоять перед рядками інвентаря", () => {
    const text = "ефір етер пауза";
    const r = collectVariantPairs([snap("story:0", text)], uk("story:0", text.length), "Ukrainian");
    expect(r.pairs.map((p) => p.mixed)).toEqual([true, false]);
  });

  it("сторінки пари впорядковані числом, а не порядком появи", () => {
    /* Той самий урок Фази 9, що дав comparePageNames: після обрізання до
     * MAX_PAGES_LISTED порядок стає самою відповіддю. */
    const text = "ефір ефір ефір";
    const c: ContainerSnapshot = {
      containerId: "story:1",
      text,
      pageRuns: [
        { start: 0, end: 5, page: "22" },
        { start: 5, end: 10, page: "4" },
        { start: 10, end: text.length, page: "13" },
      ],
      oversetFrom: null,
      isMaster: false,
      kind: "text",
    };
    const r = collectVariantPairs([c], uk("story:1", text.length), "Ukrainian");
    expect(r.pairs[0]!.forms[0]!.pages).toEqual(["4", "13", "22"]);
  });

  it("з БІЛЬШЕ ніж MAX_PAGES_LISTED сторінок обрізає до шести НАЙМЕНШИХ, а не до перших шести появи", () => {
    /* Позитивний близнюк до попереднього тесту і регрес на діру, яку
     * знайшла попередня задача цього плану: при рівно трьох сторінках
     * (менше MAX_PAGES_LISTED = 6) "сортувати потім різати" й "різати
     * потім сортувати" дають один і той самий результат — тест на трьох
     * сторінках нічого не доводить. Тут вісім РІЗНИХ сторінок у свідомо
     * НЕчисловому порядку появи: старий (зламаний) порядок різав би перші
     * шість появи ("50","3","41","2","19","7"), новий — шість НАЙМЕНШИХ
     * числом за зростанням. pageCount лишає повне число (8), незалежно
     * від сортування. */
    const word = "ефір ";
    const text = Array.from({ length: 8 }, () => word).join("").trimEnd();
    const pages = ["50", "3", "41", "2", "19", "7", "30", "1"];
    const pageRuns = pages.map((page, i) => ({
      start: i * word.length,
      end: i === pages.length - 1 ? text.length : i * word.length + word.length,
      page,
    }));
    const c: ContainerSnapshot = {
      containerId: "story:2",
      text,
      pageRuns,
      oversetFrom: null,
      isMaster: false,
      kind: "text",
    };
    const r = collectVariantPairs([c], uk("story:2", text.length), "Ukrainian");
    const f = r.pairs[0]!.forms[0]!;
    expect(f.pages).toEqual(["1", "2", "3", "7", "19", "30"]);
    expect(f.pageCount).toBe(8);
  });
});

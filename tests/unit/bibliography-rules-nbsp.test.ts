import { describe, expect, it } from "vitest";
import { collectNbspCandidates, nbspFindings } from "../../src/bibliography/rules-nbsp.js";
import { parseRecord } from "../../src/bibliography/parse.js";
import { NBSP } from "../../src/bibliography/chars.js";

const parse = (t: string) =>
  parseRecord({
    number: 50,
    text: t,
    containerId: "story:0",
    start: 0,
    end: t.length,
    page: "20",
  });
const REC =
  "50. Прізвище, Ім'я По батькові. Назва / А. В. Прізвище // Журнал. – 2024. – Вип. 21. – С. 68–74.";

describe("collectNbspCandidates", () => {
  it("ловить ОБИДВІ пари в «А. В. Прізвище», а не одну", () => {
    /* Замовник назвав ключовим саме це: щоб не переносило ані окрему літеру
     * ініціалу, ані ініціали цілком у відриві від прізвища (спек §7.2). */
    const c = collectNbspCandidates([parse(REC)]).filter((x) => x.ruleId === "bib-nbsp-initials");
    expect(c).toHaveLength(2);
  });

  it("ловить локатори «Вип. 21» і «С. 68»", () => {
    const c = collectNbspCandidates([parse(REC)]).filter((x) => x.ruleId === "bib-nbsp-locator");
    expect(c.length).toBeGreaterThanOrEqual(2);
  });

  it("ловить обсяг «240 с.»", () => {
    const t = REC.replace("С. 68–74.", "240 с.");
    const c = collectNbspCandidates([parse(t)]).filter((x) => x.ruleId === "bib-nbsp-extent");
    expect(c).toHaveLength(1);
  });

  it("не пропонує кандидата там, де вже стоїть U+00A0", () => {
    const t = REC.replace("А. В.", `А.${NBSP}В.`);
    const c = collectNbspCandidates([parse(t)]).filter((x) => x.ruleId === "bib-nbsp-initials");
    expect(c).toHaveLength(1);
  });
});

describe("nbspFindings", () => {
  it("МОВЧИТЬ, коли пара захищена атрибутом noBreak при звичайному пробілі", () => {
    /* Спек §0.5: інакше видання з GREP-стилем дасть тисячі хибних спрацювань. */
    const c = collectNbspCandidates([parse(REC)]);
    const allProtected = c.map(() => true);
    expect(nbspFindings(c, allProtected)).toEqual([]);
  });

  it("звітує, коли не захищено жодним із двох механізмів", () => {
    const c = collectNbspCandidates([parse(REC)]);
    const f = nbspFindings(c, c.map(() => false));
    expect(f.length).toBe(c.length);
    expect(f[0]?.confidence).toBe("high");
    expect(f[0]?.suggested).toBe(NBSP);
  });
});

/*
 * U+FEFF — НЕ ПРОБІЛ, І ЦЮ САМУ ВАДУ ТИПОГРАФІКА ВЖЕ ВИМІРЯЛА Й ЗАКРИЛА.
 *
 * У JavaScript `\s` містить U+FEFF (ZERO WIDTH NO-BREAK SPACE), тож `H`,
 * записане як `[^\S\r\n]`, ловило його як звичайний пробіл. На робочій
 * книжці 2026-08-15 це дало дев'ять знахідок `collapse-spaces` виду
 * [U+FEFF U+FEFF] → [U+0020]: «виправлення» не прибирало сміття, а ВСТАВЛЯЛО
 * видимий пробіл там, де пробілу не було зовсім. Типографіку полагодили тоді
 * ж (`rules-shared.ts`), а бібліографію — ні, аж до 2026-08-26.
 *
 * Тут наслідок той самий на одне правило далі: локатор, набраний як «С.﻿12»,
 * давав кандидата, а `nbspFindings` — знахідку `high` з пропозицією U+00A0
 * НА МІСЦЕ нульової ширини. Тобто інструмент пропонував додати видимий
 * пробіл у запис, де його не було.
 *
 * Нульова ширина не є пробілом за визначенням, скільки б їх не стояло поспіль.
 */
describe("U+FEFF не вважається пробілом", () => {
  const FEFF = "\uFEFF";

  it("локатор із нульовою шириною НЕ дає кандидата", () => {
    const c = collectNbspCandidates([parse(`50. Назва. – 2020. – С.${FEFF}12–15.`)]);
    expect(c.filter((x) => x.ruleId === "bib-nbsp-locator")).toHaveLength(0);
  });

  it("ініціали з нульовою шириною НЕ дають кандидата", () => {
    /* Після «В.» — рядкова літера, тож ЄДИНА пара, яку тут узагалі можна
     * зловити, — це та, що склеєна нульовою шириною. Перша редакція цього
     * тесту брала «А.﻿В. Прізвище» й падала на законному кандидаті «В. Прізвище»
     * — тобто перевіряла не те, що називала. */
    const c = collectNbspCandidates([parse(`50. Назва / А.${FEFF}В. прізвище. – 2020. – 10 с.`)]);
    expect(c.filter((x) => x.ruleId === "bib-nbsp-initials")).toHaveLength(0);
  });

  it("ЖОДЕН кандидат ніде не вказує на нульову ширину", () => {
    /* Найпряміше формулювання претензії: хай там які пари знайдено в записі,
     * жодна з них не сміє мати за «пробіл» символ нульової ширини — інакше
     * `nbspFindings` запропонує U+00A0 НА ЙОГО МІСЦЕ. */
    const text = `50. Назва / А.${FEFF}В. Прізвище. – 2020. – С.${FEFF}12–15. – 240${FEFF}с.`;
    for (const c of collectNbspCandidates([parse(text)])) {
      const group = c.parsed.record.text.slice(c.localStart, c.localEnd);
      expect(group, `кандидат ${c.ruleId} вказує на U+FEFF`).not.toContain(FEFF);
    }
  });

  it("обсяг із нульовою шириною НЕ дає кандидата", () => {
    const c = collectNbspCandidates([parse(`50. Назва. – 2020. – 240${FEFF}с.`)]);
    expect(c.filter((x) => x.ruleId === "bib-nbsp-extent")).toHaveLength(0);
  });

  it("ПОЗИТИВНИЙ БЛИЗНЮК: той самий локатор зі ЗВИЧАЙНИМ пробілом кандидата дає", () => {
    /* Без цього близнюка правило, вимкнене назовсім, склало б усі три
     * перевірки вище — і родина `bib-nbsp-*` мовчала б на цілій книжці. */
    const c = collectNbspCandidates([parse("50. Назва. – 2020. – С. 12–15.")]);
    expect(c.filter((x) => x.ruleId === "bib-nbsp-locator").length).toBeGreaterThan(0);
  });
});

/*
 * АБРЕВІАТУРА В КІНЦІ РЕЧЕННЯ — НЕ ІНІЦІАЛ.
 *
 * Шаблон вимагав лише ОДНУ велику літеру перед крапкою, а остання літера
 * абревіатури цю вимогу задовольняє. Зміряно 2026-08-26: «Праці НТШ. Львів»
 * і «Історія УРСР. Київ» давали знахідки `high`, які пропонували U+00A0 між
 * крапкою в кінці РЕЧЕННЯ і першим словом наступного — тобто склеювали через
 * межу зон. Українська бібліографія рясніє такими абревіатурами (НТШ, УРСР,
 * НАН, ДСТУ), тож це постійний шум, а не крайовий випадок.
 */
describe("ініціали проти абревіатур", () => {
  const ініціали = (t: string) =>
    collectNbspCandidates([parse(t)]).filter((x) => x.ruleId === "bib-nbsp-initials");

  it.each([
    ["12. Праці НТШ. Львів : Наукова думка, 2020. – 240 с.", "НТШ"],
    ["13. Історія УРСР. Київ : Наук. думка, 1980. – 300 с.", "УРСР"],
    ["14. Збірник НАН. Київ : Наука, 2019. – 88 с.", "НАН"],
  ])("абревіатура %# (%s) кандидата не дає", (текст) => {
    expect(ініціали(текст)).toHaveLength(0);
  });

  it("ПОЗИТИВНИЙ БЛИЗНЮК: справжні ініціали досі дають ОБИДВІ пари", () => {
    /* Саме заради обох пар шаблон і має погляд уперед (спец §7.2). Якби
     * правка звузила його надто, тут була б одиниця або нуль. */
    expect(ініціали("50. Назва / А. В. Прізвище. – Київ, 2024. – 10 с.")).toHaveLength(2);
  });

  it("ПОЗИТИВНИЙ БЛИЗНЮК: одиночний ініціал після скороження теж лишається", () => {
    expect(ініціали("51. Назва / ред. І. Петренко. – Київ, 2024. – 10 с.").length).toBeGreaterThan(0);
  });
});

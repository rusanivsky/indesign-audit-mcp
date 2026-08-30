// tests/unit/typography-piv2019.test.ts
import { describe, expect, it } from "vitest";
import {
  AMBIGUOUS_STEMS,
  SEPARATE_STEMS,
  TOGETHER_WORDS,
} from "../../src/typography/piv2019.js";
import { comparePageNames } from "../../src/spelling/types.js";

describe("переліки джерела (§ 36, п. 6, Примітка)", () => {
  it("разомних слів ДЕСЯТЬ, і півлітра серед них", () => {
    expect(TOGETHER_WORDS).toHaveLength(10);
    expect(TOGETHER_WORDS.map((w) => w.nominative)).toContain("літра");
  });

  it("півклубка в переліку НЕМАЄ — не підтвердився джерелом", () => {
    expect(TOGETHER_WORDS.map((w) => w.nominative)).not.toContain("клубок");
  });

  it("роздільних основ тринадцять", () => {
    expect(SEPARATE_STEMS).toHaveLength(13);
  });

  it("переліки транскрибовано без наголосів", () => {
    const all = [...SEPARATE_STEMS, ...TOGETHER_WORDS.map((w) => w.nominative)];
    for (const s of all) expect(s).toBe(s.normalize("NFC"));
    expect(all.join("")).not.toMatch(/[̀-ͯ́]/u);
  });
});

describe("AMBIGUOUS_STEMS — обчислюється, а не вписується", () => {
  /* Роздільний перелік стоїть у РОДОВОМУ, разомний — у НАЗИВНОМУ. Родовий
   * разомного слова дає ту саму основу, і на цих основах вирок неможливий:
   * «мешканці півострова» правильні, і «пів острова» теж. */
  it("дає рівно три основи", () => {
    expect([...AMBIGUOUS_STEMS].sort()).toEqual(["аркуша", "літра", "острова"]);
  });

  it("кожна з трьох є в ОБОХ переліках — це і є означення набору", () => {
    const genitives = new Set(TOGETHER_WORDS.map((w) => w.genitive));
    for (const s of AMBIGUOUS_STEMS) {
      expect(genitives.has(s)).toBe(true);
      expect(SEPARATE_STEMS).toContain(s);
    }
  });

  /* Позитивний близнюк: основа, що є лише в одному переліку, до набору НЕ
   * входить — інакше тест проходив би й проти «набір = усі основи». */
  it("основа лише з одного переліку до набору не входить", () => {
    expect(AMBIGUOUS_STEMS.has("години")).toBe(false); // лише роздільний
    expect(AMBIGUOUS_STEMS.has("кулі")).toBe(false); // лише родовий разомного
  });
});

import { matchPivForms } from "../../src/typography/piv2019.js";

const kinds = (t: string) => matchPivForms(t).matches.map((m) => m.kind);
const stems = (t: string) => matchPivForms(t).matches.map((m) => m.stem);

describe("matchPivForms — чотири написання", () => {
  it("впізнає всі чотири", () => {
    expect(kinds("півгодини")).toEqual(["solid"]);
    expect(kinds("пів години")).toEqual(["separate"]);
    expect(kinds("пів'яблука")).toEqual(["apostrophe"]);
    expect(kinds("пів-Києва")).toEqual(["hyphen"]);
  });

  it("нерозривний пробіл — теж separate", () => {
    expect(kinds("пів\u00A0години")).toEqual(["separate"]);
  });

  it("типографський апостроф U+2019 — теж apostrophe", () => {
    expect(kinds("пів\u2019яблука")).toEqual(["apostrophe"]);
  });

  /* STEM_TAIL мусить впізнавати U+2019 УСЕРЕДИНІ основи, не лише як
   * роздільник після «пів» (те інше правило перевіряють тести вище). Тут
   * роздільник — звичайний пробіл (separate), а сам апостроф належить
   * основі: «пів з\u2019їзду». Без \u2019 у класі символів STEM_TAIL
   * захопить лише «з», обірвавши основу навпіл. */
  it("апостроф УСЕРЕДИНІ основи не рве її навпіл («пів з\u2019їзду»)", () => {
    expect(kinds("пів з\u2019їзду")).toEqual(["separate"]);
    expect(stems("пів з\u2019їзду")).toEqual(["з\u2019їзду"]);
  });

  it("основа береться в нижньому регістрі", () => {
    expect(stems("пів-Києва")).toEqual(["києва"]);
    expect(stems("Півгодини")).toEqual(["години"]);
  });
});

describe("ліва межа — головний фільтр родини на живому тексті", () => {
  /* Виміряно на книжці: 12 із 20 збігів підрядка «пів» сидять усередині
   * інших слів. `\b` з кирилицею не працює — у JS `\w` лише ASCII. */
  it.each([
    ["співати", "співати"],
    ["купівлі", "купівлі"],
    ["принципів", "принципів"],
    ["самоспівчуття", "самоспівчуття"],
    ["етапів", "етапів"],
    ["напівфабрикатів", "напівфабрикатів"],
  ])("не ловить усередині «%s»", (_name, text) => {
    expect(matchPivForms(text).matches).toEqual([]);
  });

  /* Позитивний близнюк: те саме слово З МЕЖЕЮ ліворуч — ловиться. Без нього
   * тест проходив би й проти «взірець не ловить нічого взагалі». */
  it("на межі слова — ловить", () => {
    expect(kinds("за півгодини")).toEqual(["solid"]);
    expect(kinds("(півгодини")).toEqual(["solid"]);
  });
});

describe("після роздільника мусить бути КИРИЛИЧНА літера", () => {
  it.each(["пів 2020 року", "пів on-line", "пів \u2014 тире"])(
    "не ловить «%s»",
    (text) => {
      expect(matchPivForms(text).matches).toEqual([]);
    },
  );

  it("позитивний близнюк: з кирилицею — ловить", () => {
    expect(kinds("пів року")).toEqual(["separate"]);
  });
});

describe("не-числівники виключаються, і їх лічать", () => {
  it.each([
    ["півень", "півень"],
    ["півонія", "півонія"],
    ["півтори", "півтори"],
    ["північ", "північ"],
    ["південь", "південь"],
  ])("«%s» не дає основи", (_n, text) => {
    const r = matchPivForms(text);
    expect(r.matches).toEqual([]);
    expect(r.excludedNotNumeral).toBe(1);
  });

  /* Виміряно на книжці, с. 22: «проспала години півтори». Ліва межа його НЕ
   * відсіює — слово справді починається з «пів». */
  it("півтори в реченні книжки", () => {
    const r = matchPivForms("проспала години півтори — і прокинулась");
    expect(r.matches).toEqual([]);
    expect(r.excludedNotNumeral).toBe(1);
  });

  /* Позитивний близнюк: РОЗДІЛЬНЕ «пів дня» — це числівник, і воно лишається,
   * хоч суцільне «півдня» (родовий від «південь») виключається. */
  it("виключення діє лише на суцільну форму", () => {
    expect(kinds("півдня")).toEqual([]);
    expect(kinds("пів дня")).toEqual(["separate"]);
  });

  it("нічого не виключено — лічильник нуль", () => {
    expect(matchPivForms("пів року").excludedNotNumeral).toBe(0);
  });
});

import { classifyStem, type PivKind } from "../../src/typography/piv2019.js";

const cls = (stem: string, ...ks: PivKind[]) => classifyStem(stem, new Set(ks));

describe("classifyStem — вирок лише там, де його виніс правопис", () => {
  it("апостроф і дефіс — хибні БЕЗУМОВНО, хай яка основа", () => {
    expect(cls("яблука", "apostrophe")).toEqual({
      verdict: "wrong",
      reason: "pre-reform-mark",
    });
    expect(cls("фінал", "hyphen")).toEqual({
      verdict: "wrong",
      reason: "pre-reform-mark",
    });
  });

  it("основа з роздільного переліку, написана РАЗОМ — хибно", () => {
    // виміряно на книжці, с. 125: «розпалась вже за півгодини»
    expect(cls("години", "solid")).toEqual({
      verdict: "wrong",
      reason: "contradicts-list",
    });
  });

  it("основа з разомного переліку, написана ОКРЕМО — хибно", () => {
    expect(cls("острів", "separate")).toEqual({
      verdict: "wrong",
      reason: "contradicts-list",
    });
  });

  /* ПАРА до двох попередніх — мутант «переліки переставлено місцями» не
   * впаде без неї. */
  it("ті самі основи, написані ЗА переліком — не хибні", () => {
    expect(cls("години", "separate")).toEqual({
      verdict: "inventory",
      reason: "matches-list",
    });
    expect(cls("острів", "solid")).toEqual({
      verdict: "inventory",
      reason: "matches-list",
    });
  });

  it("основа поза обома переліками — вироку немає", () => {
    expect(cls("квартири", "separate")).toEqual({
      verdict: "inventory",
      reason: "not-in-lists",
    });
    expect(cls("фінал", "solid")).toEqual({
      verdict: "inventory",
      reason: "not-in-lists",
    });
  });
});

describe("три неоднозначні основи — вирок неможливий У ЖОДЕН БІК", () => {
  it.each(["аркуша", "острова", "літра"])("«%s» разом — не хибно", (s) => {
    expect(cls(s, "solid").verdict).toBe("inventory");
  });

  it.each(["аркуша", "острова", "літра"])("«%s» окремо — не хибно", (s) => {
    expect(cls(s, "separate").verdict).toBe("inventory");
  });

  /* «мешканці півострова» — правильна форма, яку родина без цього набору
   * позначила б як «виправити». */
  it("але дореформений знак на них ХИБНИЙ і далі", () => {
    expect(cls("острова", "hyphen").verdict).toBe("wrong");
  });
});

describe("comparePageNames — порядок сторінок несе відповідь", () => {
  it("числові сторінки за числом, не за рядком", () => {
    expect(["13", "22", "4", "5"].sort(comparePageNames)).toEqual([
      "4",
      "5",
      "13",
      "22",
    ]);
  });

  it("нечислові назви — після числових, за абеткою", () => {
    expect(["B", "10", "A", "9"].sort(comparePageNames)).toEqual([
      "9",
      "10",
      "A",
      "B",
    ]);
  });
});

import { collectPivStems } from "../../src/typography/piv2019.js";
import type { ContainerSnapshot } from "../../src/corrections/types.js";
import type { ContainerLanguage } from "../../src/spelling/types.js";

function container(id: string, text: string, isMaster = false): ContainerSnapshot {
  return {
    containerId: id,
    text,
    pageRuns: [{ start: 0, end: text.length, page: "5" }],
    oversetFrom: null,
    isMaster,
    kind: "text",
  };
}

function uk(id: string, end: number): ContainerLanguage {
  return { containerId: id, runs: [{ start: 0, end, language: "Ukrainian" }] };
}

describe("collectPivStems", () => {
  it("групує однакову основу з різних написань в ОДИН рядок", () => {
    const c = container("story:1", "півгодини і ще пів години");
    const r = collectPivStems([c], [uk("story:1", c.text.length)], "Ukrainian");
    expect(r.stems).toHaveLength(1);
    expect(r.stems[0]!.stem).toBe("години");
    expect(r.stems[0]!.mixed).toBe(true);
    expect(r.mixedCount).toBe(1);
  });

  it("одне написання — mixed false", () => {
    const c = container("story:1", "пів року і ще пів року");
    const r = collectPivStems([c], [uk("story:1", c.text.length)], "Ukrainian");
    expect(r.stems[0]!.mixed).toBe(false);
    expect(r.stems[0]!.forms[0]!.count).toBe(2);
  });

  it("wrongCount рахує лише вирок", () => {
    const c = container("story:1", "за півгодини, та пів квартири");
    const r = collectPivStems([c], [uk("story:1", c.text.length)], "Ukrainian");
    expect(r.wrongCount).toBe(1);
    expect(r.stems[0]!.stem).toBe("години"); // wrong іде першим
    expect(r.stems[0]!.verdict).toBe("wrong");
  });

  it("майстер-сторінки поза аудитом", () => {
    const c = container("story:1", "за півгодини", true);
    const r = collectPivStems([c], [uk("story:1", c.text.length)], "Ukrainian");
    expect(r.stems).toEqual([]);
  });

  it("чужомовний діапазон відкидається і ЛІЧИТЬСЯ", () => {
    const c = container("story:1", "пів року");
    const ru: ContainerLanguage = {
      containerId: "story:1",
      runs: [{ start: 0, end: c.text.length, language: "Russian" }],
    };
    const r = collectPivStems([c], [ru], "Ukrainian");
    expect(r.stems).toEqual([]);
    expect(r.skippedByLanguage).toBe(1);
  });

  /* Позитивний близнюк до попереднього: той самий текст під українською
   * мовою — рахується, і skippedByLanguage нуль. */
  it("український діапазон — рахується", () => {
    const c = container("story:1", "пів року");
    const r = collectPivStems([c], [uk("story:1", c.text.length)], "Ukrainian");
    expect(r.stems).toHaveLength(1);
    expect(r.skippedByLanguage).toBe(0);
  });

  it("сторінки впорядковані числом, не порядком появи", () => {
    const text = "пів року пів року пів року";
    const c: ContainerSnapshot = {
      containerId: "story:1",
      text,
      pageRuns: [
        { start: 0, end: 9, page: "22" },
        { start: 9, end: 18, page: "4" },
        { start: 18, end: text.length, page: "13" },
      ],
      oversetFrom: null,
      isMaster: false,
      kind: "text",
    };
    const r = collectPivStems([c], [uk("story:1", text.length)], "Ukrainian");
    expect(r.stems[0]!.forms[0]!.pages).toEqual(["4", "13", "22"]);
  });

  /* РЕГРЕСІЯ: сортування мусить бути ДО обрізання, не після. Восьмеро
   * сторінок, у ПОРЯДКУ ПОЯВИ навмисно невпорядкованому — понад
   * MAX_PAGES_LISTED (6), інакше "спочатку обрізати" і "спочатку
   * сортувати" дають однаковий результат: нічого не обрізається, і різницю
   * підмінити нічим.
   *
   * "Спочатку обрізати, потім сортувати" узяв би перші шість ЗА ПОРЯДКОМ
   * ПОЯВИ (30, 4, 25, 7, 19, 2) і посортував ЇХ — вийшло б ["2","4","7",
   * "19","25","30"]: акуратний висхідний список, який усе одно НЕ є шістьма
   * найменшими сторінками книжки (бракує 11, зайва 30) — і саме тому баг
   * невидимий: результат далі виглядає посортованим. */
  it("сторінок понад ліміт — обрізає ПІСЛЯ сортування, не до", () => {
    const unit = "пів року";
    const sep = " ";
    const pages = ["30", "4", "25", "7", "19", "2", "11", "40"];
    let text = "";
    const pageRuns: { start: number; end: number; page: string }[] = [];
    let pos = 0;
    for (let i = 0; i < pages.length; i++) {
      const chunk = unit + (i < pages.length - 1 ? sep : "");
      const start = pos;
      const end = pos + chunk.length;
      pageRuns.push({ start, end, page: pages[i]! });
      text += chunk;
      pos = end;
    }
    const c: ContainerSnapshot = {
      containerId: "story:1",
      text,
      pageRuns,
      oversetFrom: null,
      isMaster: false,
      kind: "text",
    };
    const r = collectPivStems([c], [uk("story:1", text.length)], "Ukrainian");
    expect(r.stems[0]!.forms[0]!.pages).toEqual(["2", "4", "7", "11", "19", "25"]);
    expect(r.stems[0]!.forms[0]!.pageCount).toBe(8);
  });

  /* РУЛІНГ: три написання однієї основи — не дві. Спокуса — скопіювати
   * `rows.length === 2` із spelling2019.ts, де це правильно (варіантна пара
   * завжди має рівно дві форми). Тут написань чотири, і `=== 2` тихо
   * пропустив би основу з трьома формами як "не mixed". Перевірено виконанням
   * на committed-коді: «півяблука, пів яблука, пів'яблука» дає ОДНУ основу
   * «яблука» з ТРЬОМА формами (solid, separate, apostrophe). */
  it("основа з ТРЬОМА написаннями теж mixed, не лише з двома", () => {
    const c = container("story:1", "півяблука, пів яблука, пів\u2019яблука");
    const r = collectPivStems([c], [uk("story:1", c.text.length)], "Ukrainian");
    expect(r.stems).toHaveLength(1);
    expect(r.stems[0]!.stem).toBe("яблука");
    expect(r.stems[0]!.forms).toHaveLength(3);
    expect(r.stems[0]!.mixed).toBe(true);
    expect(r.mixedCount).toBe(1);
  });
});

import { capPivStems, MAX_PIV_STEMS, PIV2019_CAVEAT } from "../../src/typography/piv2019.js";

describe("стеля рядків і caveat", () => {
  it("матеріалу для обрізання вистачає — понад MAX_PIV_STEMS основ", () => {
    const text = Array.from({ length: MAX_PIV_STEMS + 5 }, (_, i) =>
      `пів слово${String.fromCharCode(1072 + (i % 30))}${String.fromCharCode(1072 + Math.floor(i / 30))}`,
    ).join(" ");
    const c = container("story:1", text);
    const r = collectPivStems([c], [uk("story:1", text.length)], "Ukrainian");
    expect(r.stems.length).toBeGreaterThan(MAX_PIV_STEMS);
    /* САМЕ обрізання — тестами нижче: воно переїхало з тіла обробника в
     * `capPivStems`, і саме тому стало досяжним звідси. Доти цей тест
     * доводив лише «матеріалу вистачає», а стеля не мала ані тесту, ані
     * прогону (на книжці 4 основи проти 60). */
    expect(capPivStems(r.stems).stems).toHaveLength(MAX_PIV_STEMS);
    expect(capPivStems(r.stems).hidden).toBe(r.stems.length - MAX_PIV_STEMS);
  });

  /*
   * ЄДИНА СТЕЛЯ ЦЬОГО ПРОЄКТУ, ЯКА НЕ МАЛА ТЕСТУ. `MAX_GROUP_VALUES`,
   * `MAX_SCALE_GROUPS` і `maxChainDepth` свої обрізання перевіряють;
   * `MAX_PIV_STEMS` — ні, бо зріз стояв двома рядками в обробнику. На
   * робочій книжці стеля не спрацювала жодного разу, тобто не була
   * підтверджена й прогоном.
   */
  it("зріз лишає ПЕРШІ max і не сортує — читач бачить ті самі основи, тільки менше", () => {
    const r = capPivStems(["ґ", "а", "в", "б"], 2);
    expect(r.stems).toEqual(["ґ", "а"]);
    expect(r.hidden).toBe(2);
  });

  it("основ рівно стільки, скільки стеля — hidden нуль, а не одиниця", () => {
    /* Межа off-by-one: `>=` замість `>` дав би тут hidden 0 і stems 2,
     * а зріз на `max - 1` — stems 1. Обидва мутанти червонять цей рядок. */
    const r = capPivStems(["а", "б"], 2);
    expect(r.stems).toEqual(["а", "б"]);
    expect(r.hidden).toBe(0);
  });

  it("основ менше за стелю — hidden нуль, а не від'ємне число", () => {
    /* Без `Math.max(0, …)` вийшло б -1, і поле, що має відповідати
     * «скільки сховано», доповідало б від'ємну кількість. */
    expect(capPivStems(["а"], 2)).toEqual({ stems: ["а"], hidden: 0 });
  });

  it("замовчування — саме MAX_PIV_STEMS, а не якесь інше число", () => {
    /* Обробник кличе `capPivStems(piv.stems)` без другого аргументу, тож
     * замовчування — це і є чинна стеля відповіді. */
    const many = Array.from({ length: MAX_PIV_STEMS + 3 }, (_, i) => `s${i}`);
    expect(capPivStems(many).stems).toHaveLength(MAX_PIV_STEMS);
    expect(capPivStems(many).hidden).toBe(3);
  });

  it("caveat називає межу mixed, а не лише хвалить родину", () => {
    expect(PIV2019_CAVEAT).toContain("mixed");
    expect(PIV2019_CAVEAT).toContain("does NOT mean");
    expect(PIV2019_CAVEAT).toContain("ukrainianRuns");
  });
});

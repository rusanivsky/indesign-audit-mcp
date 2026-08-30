import { describe, expect, it } from "vitest";
import { rewrite, runRules } from "../../src/typography/engine.js";
import { EN_GB_RULES, EN_US_RULES } from "../../src/typography/rules-en.js";
import { UK_RULES } from "../../src/typography/rules-uk.js";

const fix = (text: string, rules = EN_US_RULES) => rewrite(text, runRules(text, rules));
const ids = (text: string, rules = EN_US_RULES) => runRules(text, rules).map((m) => m.ruleId);

/*
 * A regression test for the ORIGINAL defect that started the bilingual work
 * (measured 2026-08-25, docs/measured-facts-bilingual.md M1): on English text
 * the Ukrainian pack produced 14 matches, 8 of which corrupted the text at
 * confidence "high" — meaning `typography_apply` would have applied them by
 * default.
 */
describe("the defect that brought in the English pack", () => {
  const EN = `She said, "I don't know," and left.`;

  it("the Ukrainian pack put guillemets into an English sentence", () => {
    expect(fix(EN, UK_RULES)).toContain("«I don’t know,»");
  });

  it("the American pack uses English quotes", () => {
    expect(fix(EN, EN_US_RULES)).toContain("“I don’t know,”");
  });

  it("the British pack uses single outer quotes", () => {
    expect(fix(EN, EN_GB_RULES)).toContain("‘I don’t know,’");
  });

  it("bullet list: the Ukrainian dialogue-dash ate it, the English packs do not", () => {
    expect(ids("- First item", UK_RULES)).toContain("dialogue-dash");
    expect(ids("- First item", EN_US_RULES)).not.toContain("dialogue-dash");
    expect(ids("- First item", EN_GB_RULES)).not.toContain("dialogue-dash");
  });
});

describe("the two schools diverge on the parenthetical dash", () => {
  const SRC = "The result - a mess - was clear.";

  it("Chicago: em dash, unspaced", () => {
    expect(fix(SRC, EN_US_RULES)).toBe("The result—a mess—was clear.");
  });

  it("Oxford: en dash, spaced", () => {
    expect(fix(SRC, EN_GB_RULES)).toBe("The result – a mess – was clear.");
  });

  it("the Ukrainian pack gave EM DASH WITH SPACES — matching neither school", () => {
    expect(fix(SRC, UK_RULES)).toBe("The result — a mess — was clear.");
  });

  it("double hyphen: -- diverges too", () => {
    expect(fix("wait--no", EN_US_RULES)).toBe("wait—no");
    expect(fix("wait--no", EN_GB_RULES)).toBe("wait – no");
  });

  it("a phone number stays doubtful rather than being rewritten silently", () => {
    const m = runRules("tel. 555 - 123", EN_US_RULES).filter((x) => x.ruleId.startsWith("en-dash"));
    expect(m).toHaveLength(1);
    expect(m[0]!.confidence).toBe("needs-review");
  });
});

describe("nested quotes swap places between the schools", () => {
  it("Chicago: double outer, single nested", () => {
    expect(fix(`He said "a 'small' thing" today`, EN_US_RULES))
      .toBe("He said “a ‘small’ thing” today");
  });

  it("Oxford: the other way round", () => {
    expect(fix(`He said "a 'small' thing" today`, EN_GB_RULES))
      .toBe("He said ‘a “small” thing’ today");
  });

  it("idempotence: a second pass yields no matches at all", () => {
    const once = fix(`He said "a 'small' thing" today`, EN_US_RULES);
    expect(runRules(once, EN_US_RULES)).toEqual([]);
  });

  it("a contraction apostrophe is NOT counted as a quote and does not skew depth", () => {
    expect(fix(`"don't stop" now`, EN_US_RULES)).toBe("“don’t stop” now");
  });

  it("inches and feet are not quotes", () => {
    expect(runRules(`a 15" screen`, EN_US_RULES).filter((m) => m.ruleId.startsWith("en-quotes")))
      .toEqual([]);
  });
});

describe("elision — the most common mechanical error in English typesetting", () => {
  it("'90s gets the RIGHT single quote, not the left one", () => {
    expect(fix("back in the '90s", EN_US_RULES)).toContain("’90s");
  });

  it("'tis likewise", () => {
    expect(fix("'tis the season", EN_US_RULES)).toContain("’tis");
  });

  it("the rule is shared by both schools", () => {
    expect(fix("the '90s", EN_GB_RULES)).toContain("’90s");
  });
});

describe("possessive plural — doubtful, being indistinguishable from a closing quote", () => {
  it("boys' books goes to needs-review rather than being applied silently", () => {
    const m = runRules("the boys' books", EN_US_RULES)
      .filter((x) => x.ruleId.startsWith("en-quotes"));
    for (const x of m) expect(x.confidence).toBe("needs-review");
  });
});

describe("the shared core is in both English packs", () => {
  it("apostrophe, ellipsis, numeric range, spacing", () => {
    for (const pack of [EN_US_RULES, EN_GB_RULES]) {
      expect(fix("don't", pack)).toBe("don’t");
      expect(fix("wait...", pack)).toBe("wait…");
      expect(fix("1939-1945", pack)).toBe("1939–1945");
      expect(fix("two  spaces", pack)).toBe("two spaces");
    }
  });

  it("an ISBN is not broken — the same exception as in the Ukrainian pack", () => {
    expect(fix("ISBN 978-966-1234-56-7", EN_US_RULES)).toBe("ISBN 978-966-1234-56-7");
  });
});

describe("pack composition", () => {
  it("no duplicate id inside a pack", () => {
    for (const pack of [EN_US_RULES, EN_GB_RULES, UK_RULES]) {
      const list = pack.map((r) => r.id);
      expect(new Set(list).size).toBe(list.length);
    }
  });

  it("the English packs contain no Ukrainian conventions", () => {
    for (const pack of [EN_US_RULES, EN_GB_RULES]) {
      const list = pack.map((r) => r.id);
      expect(list).not.toContain("quotes-uk");
      expect(list).not.toContain("dialogue-dash");
      expect(list).not.toContain("dash-separator");
      expect(list.some((id) => id.startsWith("uk2019"))).toBe(false);
    }
  });

  it("every school rule has a locale, every core rule has none", () => {
    const core = new Set(["collapse-spaces", "space-before-punct", "space-before-break",
      "space-after-open-paren", "space-before-close-paren", "apostrophe", "ellipsis",
      "range-dash-numeric", "range-dash-words", "en-elision-apostrophe"]);
    for (const r of EN_US_RULES) {
      if (core.has(r.id)) expect(r.locale, r.id).toBeUndefined();
      else expect(r.locale, r.id).toBe("en-US");
    }
    for (const r of EN_GB_RULES) {
      if (core.has(r.id)) expect(r.locale, r.id).toBeUndefined();
      else expect(r.locale, r.id).toBe("en-GB");
    }
  });
});

/*
 * ВИХІДНІ ВІДОМОСТІ АНГЛІЙСЬКОГО ВИДАННЯ — ЗНАЙДЕНО ЖИВИМ ПРОГОНОМ 2026-08-27.
 *
 * Перша англійська книжка, пропущена крізь пакет Chicago, дала на с. 4 збіг
 * `high` РІВНО на бібліографічному записі:
 *
 *   «Night Herons / Kateryna Vygadana. — Kyiv : PUBLISHER, 2026. — 196 p.»
 *
 * `typography_apply` пише `high` без перегляду, тож прохід зіпсував би зону
 * вихідних відомостей — те саме, від чого `space-before-punct` береже двокрапку
 * (див. `rules-shared.ts`).
 *
 * І ось ЧОМУ цього не було видно українською: ДСТУ розділяє зони записом
 * « — » (тире в пробілах), і українська конвенція вимагає ТОГО САМОГО тире в
 * пробілах. Збігу немає — правило не має що міняти. Chicago ж вимагає тире БЕЗ
 * пробілів, тож конвенція й стандарт уперше вступають у суперечку саме на
 * перекладеному виданні. Колізію створює перемикання мови, а не текст.
 *
 * Сигнал беремо з самого тексту, а не з номера сторінки: приписна пунктуація
 * ДСТУ (« : » або « ; » у пробілах) чи ISBN у тому ж абзаці. Правило має
 * узагальнюватись на будь-яке видання, а не знати про це.
 *
 * НАЗВУ Й ПРІЗВИЩЕ В ЗАПИСІ ЗАМІНЕНО НА ВИГАДАНІ. Правило не дивиться на
 * літери — воно дивиться на тире, двокрапку й ISBN, тож взірець від заміни не
 * втрачає нічого. Первісний запис ніс справжню назву перекладеного видання, і
 * ворота приватності його не бачили: ряд однакових літер шукали лише в
 * кирилиці (див. `tests/unit/privacy-gate.test.ts`).
 */
describe("вихідні відомості не ламаються англійським тире", () => {
  const IMPRINT = "Night Herons / Kateryna Vygadana. — Kyiv : PUBLISHER, 2026. — 196 p.";

  it("Chicago НЕ чіпає тире-роздільник зон у записі", () => {
    const hits = runRules(IMPRINT, EN_US_RULES).filter(
      (h) => h.ruleId === "en-dash-parenthetical-us",
    );
    expect(hits, `запис зіпсовано: ${JSON.stringify(hits.map((h) => h.before))}`).toEqual([]);
  });

  it("Oxford так само", () => {
    const hits = runRules(IMPRINT, EN_GB_RULES).filter(
      (h) => h.ruleId === "en-dash-parenthetical-gb",
    );
    expect(hits).toEqual([]);
  });

  it("ISBN у рядку — той самий сигнал", () => {
    const line = "PUBLISHER, 2026. — 196 p. ISBN 978-966-1234-56-7";
    const hits = runRules(line, EN_US_RULES).filter(
      (h) => h.ruleId === "en-dash-parenthetical-us",
    );
    expect(hits).toEqual([]);
  });

  it("а СПРАВЖНЄ вставне тире у прозі лишається знайденим", () => {
    /* Негативний контроль: виняток, що з'їв би саме правило, зеленів би так
     * само, як виняток, що працює. */
    const prose = "The night - and it was a long one - finally ended.";
    const hits = runRules(prose, EN_US_RULES).filter(
      (h) => h.ruleId === "en-dash-parenthetical-us",
    );
    expect(hits.length).toBeGreaterThan(0);
  });
});

/*
 * ФОРМА З ЖИВОГО ДОКУМЕНТА, А НЕ ПРИБРАНА ДЛЯ ТЕСТУ.
 *
 * Перша редакція винятку вище була написана на охайному однорядковому записі —
 * і на справжньому не спрацювала б. У живій верстці всередині того самого
 * АБЗАЦУ стоїть примусовий розрив рядка (`\n`), бо запис ламають вручну:
 *
 *   «Night Herons / Kateryna Vygadana. — Kyiv :\nPUBLISHER, 2026. — 196 p.»
 *
 * Розрив розділяє приписну двокрапку й друге тире. Розбір «абзацу» по `\n`
 * лишав друге тире в шматку «PUBLISHER, 2026. — 196 p.», де немає ні
 * двокрапки, ні ISBN, — тобто виняток мовчав саме там, де він і потрібен.
 *
 * В InDesign `\r` — це абзац, а `\n` — розрив рядка ВСЕРЕДИНІ абзацу. Межа
 * рахується по `\r`, і тільки по ньому.
 */
describe("вихідні відомості у формі, яку віддає InDesign", () => {
  const REAL = "Author Name.\rNight Herons / Kateryna Vygadana. — Kyiv :\nPUBLISHER, 2026. — 196 p.\rNext paragraph.";

  it("ОБИДВА тире запису лишаються недоторканими попри розрив рядка", () => {
    const hits = runRules(REAL, EN_US_RULES).filter((h) => h.ruleId === "en-dash-parenthetical-us");
    expect(hits, `зіпсовано: ${JSON.stringify(hits.map((h) => h.contextBefore))}`).toEqual([]);
  });

  it("а сусідній абзац за `\\r` виняток НЕ накриває", () => {
    /* Інакше один бібліографічний запис глушив би правило на цілій сторінці. */
    const withProse = REAL + "\rThe night - and it was long - ended.";
    const hits = runRules(withProse, EN_US_RULES).filter(
      (h) => h.ruleId === "en-dash-parenthetical-us",
    );
    expect(hits.length).toBe(2);
  });
});

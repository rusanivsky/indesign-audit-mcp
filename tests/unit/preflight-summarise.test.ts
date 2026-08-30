import { describe, expect, it } from "vitest";
import {
  buildCaveat,
  buildFindings,
  buildReport,
  stripCount,
  type CaveatInput,
} from "../../src/preflight/summarise.js";
import {
  MAX_PREFLIGHT_OCCURRENCES,
  type PreflightMeasure,
  type PreflightRow,
  type PreflightRuleState,
} from "../../src/preflight/types.js";

/**
 * ВИМІРЯНІ рядки, не вигадані. Знято 2026-08-07 із тимчасової фікстури зі
 * свідомим overset (`aggregatedResults` профілю `[Basic]`). Форма — дерево,
 * сплющене в список: перша колонка є глибиною.
 */
const MEASURED_ROWS: PreflightRow[] = [
  [1, "TEXT (1)", "", "", []],
  [2, "Overset text (1)", "", "", []],
  [
    3,
    "Text Frame",
    "1",
    "Problem: Overset text: 5200 characters\nFix: Resize the text frame, or edit the text to fit within the frame.",
    [
      ["Problem", "Overset text: 5200 characters"],
      ["Fix", "Resize the text frame, or edit the text to fit within the frame."],
    ],
  ],
];

/**
 * ЗРІЗ виміряного складу `[Basic]`, а не він увесь: у профілі 38 правил, з яких
 * увімкнено ШІСТЬ (виміряно 2026-08-07 прямим перебором
 * `profile.preflightProfileRules`). Тут шість увімкнених і ТРИ вимкнені —
 * рівно стільки, скільки треба, щоб перевірити розкладку. Числа 6/32/38
 * перевіряються на живому профілі в інтеграційному тесті, а не тут: зашити їх
 * у масив із дев'яти записів означало б зробити коментар неправдивим.
 */
const BASIC_RULES_SAMPLE: PreflightRuleState[] = [
  { id: "ADBE_InaccessibleUrlLinks", flag: "RETURN_AS_ERROR", enabled: true },
  { id: "ADBE_MathExprPlaceHolders", flag: "RETURN_AS_ERROR", enabled: true },
  { id: "ADBE_MissingFonts", flag: "RETURN_AS_ERROR", enabled: true },
  { id: "ADBE_MissingModifiedGraphics", flag: "RETURN_AS_ERROR", enabled: true },
  { id: "ADBE_OversetText", flag: "RETURN_AS_ERROR", enabled: true },
  { id: "ADBE_UnresolvedCaption", flag: "RETURN_AS_ERROR", enabled: true },
  { id: "ADBE_ImageResolution", flag: "RULE_IS_DISABLED", enabled: false },
  { id: "ADBE_Colorspace", flag: "RULE_IS_DISABLED", enabled: false },
  { id: "ADBE_ScaledGraphics", flag: "RULE_IS_DISABLED", enabled: false },
];

function measure(over: Partial<PreflightMeasure> = {}): PreflightMeasure {
  return {
    docName: "Книжка.indd",
    profileName: "[Basic]",
    workingProfile: "[Basic]",
    preflightOff: false,
    scope: "PREFLIGHT_ALL_PAGES",
    rules: BASIC_RULES_SAMPLE,
    rows: MEASURED_ROWS,
    availableProfiles: ["[Basic]", "kDigPubProfileName", "New Preflight Profile"],
    shapeRecognised: true,
    rowsSeen: MEASURED_ROWS.length,
    rowsParsed: MEASURED_ROWS.length,
    pairsSeen: 2,
    pairsParsed: 2,
    processRemoved: true,
    waitTimedOut: false,
    waitPolarity: null,
    ...over,
  };
}

function caveatInput(over: Partial<CaveatInput> = {}): CaveatInput {
  return {
    profileName: "[Basic]",
    enabled: 6,
    disabled: 32,
    disabledRuleIds: ["ADBE_ImageResolution", "ADBE_Colorspace"],
    enabledRuleIds: ["ADBE_OversetText", "ADBE_MissingFonts"],
    occurrences: 0,
    preflightOff: false,
    waitTimedOut: false,
    waitPolarity: null,
    shapeRecognised: true,
    rowsSeen: 3,
    rowsParsed: 3,
    ...over,
  };
}

describe("stripCount", () => {
  it("прибирає кількість у дужках, яку InDesign дописує до підпису", () => {
    expect(stripCount("Overset text (1)")).toBe("Overset text");
    expect(stripCount("TEXT (12)")).toBe("TEXT");
  });

  it("не чіпає дужок, які є частиною назви", () => {
    /* «(1)» в кінці — кількість; «(CMYK)» посередині — назва. */
    expect(stripCount("Colour (CMYK) space")).toBe("Colour (CMYK) space");
  });

  it("не чіпає дужок У КІНЦІ, якщо в них не число", () => {
    /*
     * Мутант «\\(\\d+\\) → \\(.+\\)» переживав обидві перевірки вище, бо в них
     * дужки або з числом, або не в кінці. Назва шрифту стоїть саме в кінці й
     * саме в дужках — і зникала б цілком.
     */
    expect(stripCount("Missing font (Minion Pro)")).toBe("Missing font (Minion Pro)");
    expect(stripCount("Overset text (кілька)")).toBe("Overset text (кілька)");
  });
});

describe("buildFindings", () => {
  it("відновлює дерево з плаского списку за колонкою глибини", () => {
    const findings = buildFindings(MEASURED_ROWS);
    expect(findings.length).toBe(1);
    expect(findings[0]!.category).toBe("TEXT");
    expect(findings[0]!.rule).toBe("Overset text");
    expect(findings[0]!.occurrences.length).toBe(1);
    expect(findings[0]!.occurrenceCount).toBe(1);
  });

  it("випадок несе сторінку, об'єкт і пари Problem/Fix від застосунку", () => {
    const occ = buildFindings(MEASURED_ROWS)[0]!.occurrences[0]!;
    expect(occ.page).toBe("1");
    expect(occ.object).toBe("Text Frame");
    expect(occ.details.map((d) => d.key)).toEqual(["Problem", "Fix"]);
    expect(occ.details[0]!.value).toContain("5200 characters");
  });

  it("опис від застосунку НЕ втрачається, коли пар немає", () => {
    /*
     * Доведено виконанням у рецензії: рядок нижче давав
     * {"page":"12","object":"Image","details":[]} — звіт виглядав повним, а
     * єдине речення про суть проблеми зникало разом із четвертою колонкою.
     */
    const rows: PreflightRow[] = [
      [1, "COLOUR (1)", "", "", []],
      [2, "Colour space (1)", "", "", []],
      [3, "Image", "12", "Problem: RGB у CMYK-документі\nFix: конвертувати", []],
    ];
    const occ = buildFindings(rows)[0]!.occurrences[0]!;
    expect(occ.description).toBe("Problem: RGB у CMYK-документі\nFix: конвертувати");
    expect(occ.details).toEqual([]);
  });

  it("опис не дублюється, коли пари відтворюють його ТОЧНО", () => {
    /* Виміряна форма опису — це склеєні пари; возити обидві копії означало б
     * подвоїти відповідь заради нуля інформації. */
    expect(buildFindings(MEASURED_ROWS)[0]!.occurrences[0]!.description).toBeNull();
  });

  it("опис, який пари НЕ відтворюють, лишається дослівно", () => {
    const rows: PreflightRow[] = [
      [3, "Image", "12", "Problem: RGB\nFix: конвертувати\nПримітка від застосунку", [["Problem", "RGB"]]],
    ];
    expect(buildFindings(rows)[0]!.occurrences[0]!.description).toContain("Примітка від застосунку");
  });

  it("порожня сторінка стає null, а не сторінкою з назвою «»", () => {
    const rows: PreflightRow[] = [
      [1, "LINKS (1)", "", "", []],
      [2, "Missing fonts (1)", "", "", []],
      [3, "Document", "", "Problem: …", [["Problem", "…"]]],
    ];
    expect(buildFindings(rows)[0]!.occurrences[0]!.page).toBeNull();
  });

  it("рівень 3 без попереднього рівня 2 НЕ втрачається", () => {
    /* Мовчазна втрата рядка — рівно той відмовний режим, проти якого цей
     * інструмент і написаний. Краще «(невідомо)», ніж тиша. */
    const rows: PreflightRow[] = [[3, "Text Frame", "7", "Problem: щось", [["Problem", "щось"]]]];
    const findings = buildFindings(rows);
    expect(findings.length).toBe(1);
    expect(findings[0]!.rule).toBe("(unknown)");
    expect(findings[0]!.occurrences[0]!.page).toBe("7");
  });

  it("НОВА категорія скидає правило: випадок під нею не йде в правило з попередньої", () => {
    /*
     * Мутант «прибрати current = null на глибині 1» переживав усі попередні
     * перевірки, бо в жодній не було ДРУГОЇ категорії. А наслідок його —
     * найгірший з можливих: звіт лишається правдоподібним і при цьому
     * приписує знахідку чужому правилу.
     */
    const rows: PreflightRow[] = [
      [1, "TEXT (1)", "", "", []],
      [2, "Overset text (1)", "", "", []],
      [3, "Text Frame", "1", "", []],
      [1, "LINKS (1)", "", "", []],
      [3, "Image", "9", "", []],
    ];
    const findings = buildFindings(rows);
    expect(findings.length).toBe(2);
    expect(findings[0]!.rule).toBe("Overset text");
    expect(findings[0]!.occurrences.map((o) => o.page)).toEqual(["1"]);
    expect(findings[1]!.category).toBe("LINKS");
    expect(findings[1]!.rule).toBe("(unknown)");
    expect(findings[1]!.occurrences.map((o) => o.page)).toEqual(["9"]);
  });

  it("правило без жодного випадку лишається у звіті", () => {
    const rows: PreflightRow[] = [
      [1, "LINKS (1)", "", "", []],
      [2, "Missing fonts (1)", "", "", []],
    ];
    const findings = buildFindings(rows);
    expect(findings.length).toBe(1);
    expect(findings[0]!.occurrences).toEqual([]);
    expect(findings[0]!.occurrenceCount).toBe(0);
  });

  it("порожній список дає порожній результат, а не виняток", () => {
    expect(buildFindings([])).toEqual([]);
  });
});

describe("buildCaveat", () => {
  it("числа беруться з АРГУМЕНТІВ, а не з пам'яті про [Basic]", () => {
    /*
     * Мутант «зашити 6 правил із 38» переживав усі три попередні перевірки, бо
     * всі три кликали buildCaveat із тими самими (6, 32). Тут числа інші
     * навмисно: профіль друкарні цілком може мати їх інші.
     */
    const text = buildCaveat(caveatInput({ enabled: 2, disabled: 5 }));
    expect(text).toContain("2 rules are active out of 7");
    expect(text).toContain("5 disabled");
    expect(text).not.toContain("out of 38");
  });

  it("називає ПРОФІЛЬ, яким міряли, а не «[Basic]» назавжди", () => {
    const text = buildCaveat(caveatInput({ profileName: "Друкарня Х" }));
    expect(text).toContain('"Друкарня Х"');
  });

  it("при нулі порушень прямо каже, що це НЕ означає «чисто»", () => {
    const text = buildCaveat(caveatInput({ occurrences: 0 }));
    expect(text).toContain('not "the layout is clean"');
    expect(text).not.toMatch(/everything('s| is) (fine|ok|okay|good)/i);
  });

  /*
   * ТРЕТІЙ СТАН, ЯКИЙ ВИДАВАВ СЕБЕ ЗА ДРУГИЙ.
   *
   * Правило буває вимкненим, увімкненим і ВІДСУТНІМ У ПРОФІЛІ ЗОВСІМ.
   * Перевірялося лише членство в disabledRuleIds, тож третій стан ішов у
   * гілку «увімкнено — роздільність перевірено». А третій стан — це саме те,
   * що дістає оператор, який послухався останньої фрази цього ж застереження
   * і зібрав власний профіль із кількох потрібних правил.
   */
  it("правило, ВІДСУТНЄ в профілі, не видається за увімкнене", () => {
    const text = buildCaveat(
      caveatInput({
        profileName: "PrintShop",
        enabled: 2,
        disabled: 0,
        disabledRuleIds: [],
        enabledRuleIds: ["ADBE_OversetText", "ADBE_MissingFonts"],
      }),
    );
    expect(text).toMatch(/ADBE_ImageResolution[^.]*NOT PRESENT/);
    expect(text, "відсутнє правило названо перевіреним").not.toMatch(
      /ADBE_ImageResolution[^.]*ENABLED/,
    );
    expect(text).toMatch(/NOT checked/);
  });

  it("називає ADBE_ImageResolution ВИМКНЕНИМ лише коли воно справді вимкнене", () => {
    const text = buildCaveat(caveatInput({ disabledRuleIds: ["ADBE_ImageResolution"] }));
    expect(text).toMatch(/Among the disabled ones — ADBE_ImageResolution/);
  });

  it("коли ADBE_ImageResolution УВІМКНЕНЕ — caveat каже саме це, а не протилежне", () => {
    /*
     * Найдорожчий із чотирьох мутантів: caveat, який стверджує ПРОТИЛЕЖНЕ
     * («ADBE_ImageResolution увімкнене за замовчуванням, тож нуль помилок
     * означає, що все гаразд»), проходив усі 15 тестів. Порада caveat робила
     * сам caveat неправдивим: оператор умикав правило у власному профілі,
     * міряв ним — і читав, що роздільність не перевірялась.
     */
    const on = buildCaveat(
      caveatInput({
        disabledRuleIds: ["ADBE_Colorspace"],
        /* Тепер «увімкнене» треба ЗАДАТИ, а не вивести з того, що правила
         * немає серед вимкнених: правило, відсутнє в профілі зовсім, теж не
         * лежить серед вимкнених — і саме воно раніше видавало себе за
         * увімкнене (див. наступний тест). */
        enabledRuleIds: ["ADBE_ImageResolution", "ADBE_OversetText"],
      }),
    );
    expect(on).toMatch(/ADBE_ImageResolution[^.]*ENABLED/);
    expect(on).not.toMatch(/Among the disabled ones — ADBE_ImageResolution/);

    const off = buildCaveat(caveatInput({ disabledRuleIds: ["ADBE_ImageResolution"] }));
    expect(off).not.toMatch(/ADBE_ImageResolution[^.]*ENABLED/);
  });

  it("жодна редакція caveat не називає правило «вимкненим за замовчуванням»", () => {
    /* Твердження про ЗАМОВЧУВАННЯ не виводиться з виміру: міряли конкретним
     * профілем, а не «за замовчуванням». */
    for (const ids of [["ADBE_ImageResolution"], ["ADBE_Colorspace"], []]) {
      expect(buildCaveat(caveatInput({ disabledRuleIds: ids }))).not.toContain("by default");
    }
  });

  it("вимкнений живий preflight — гучний сигнал, і він перед числами", () => {
    const text = buildCaveat(caveatInput({ preflightOff: true }));
    expect(text).toContain("preflightOff = true");
    expect(text.indexOf("preflightOff")).toBeLessThan(text.indexOf("No violations found"));
  });

  it("незавершений прогін — НАЙГУЧНІШИЙ сигнал, і він перший з усіх", () => {
    /*
     * Решта блоків кажуть, ЧОГО НЕ ПИТАЛИ; цей каже, що не дослухали
     * відповідь. Перелік неповний — це сильніше за будь-що інше в caveat.
     */
    const text = buildCaveat(caveatInput({ waitTimedOut: true, preflightOff: true, occurrences: 3 }));
    expect(text).toContain("waitTimedOut = true");
    expect(text).toContain("INCOMPLETE");
    expect(text.indexOf("waitTimedOut")).toBeLessThan(text.indexOf("preflightOff"));
  });

  it("завершений прогін про таймаут не згадує взагалі", () => {
    expect(buildCaveat(caveatInput({ waitTimedOut: false }))).not.toContain("waitTimedOut");
  });

  it("НЕ булеве значення дає ІНШИЙ блок: «невідомо», а не «не дочекався»", () => {
    /*
     * Сказати «не дочекався» тут означало б стверджувати те, чого вимір не
     * показував: полярність виміряна на true/false, і поза цією парою вона не
     * означає нічого. Незмінним лишається тільки висновок про ПОВНОТУ.
     */
    const text = buildCaveat(
      caveatInput({ waitTimedOut: true, waitPolarity: "object null", preflightOff: true }),
    );
    expect(text).toContain("object null");
    expect(text).toContain("UNKNOWN");
    expect(text).toContain("conservatively");
    /* Формулювання виміряного таймауту тут НЕ вживається. */
    expect(text).not.toContain("did NOT finish");
    /* Місце в черзі те саме — найгучніший сигнал перший. */
    expect(text.indexOf("waitForProcess")).toBeLessThan(text.indexOf("preflightOff"));
  });

  it("блок про неполярність не з'являється, поки значення булеве", () => {
    for (const waitTimedOut of [true, false]) {
      expect(buildCaveat(caveatInput({ waitTimedOut }))).not.toContain("NON-boolean");
    }
  });

  it("невпізнана форма результату не читається як «нуль порушень»", () => {
    const text = buildCaveat(caveatInput({ shapeRecognised: false, rowsSeen: 0, rowsParsed: 0 }));
    expect(text).toContain("shapeRecognised = false");
  });

  it("частково розібраний результат зізнається в цьому числами", () => {
    const text = buildCaveat(caveatInput({ rowsSeen: 9, rowsParsed: 4 }));
    expect(text).toContain("out of 9 result rows, 4 were parsed");
  });

  it("при ненульовому числі порушень каже число, а не оцінку", () => {
    const text = buildCaveat(caveatInput({ occurrences: 3 }));
    expect(text).toContain("3 violations");
    expect(text).not.toContain('not "the layout is clean"');
  });
});

describe("buildReport", () => {
  it("розкладає правила на увімкнені й вимкнені поіменно", () => {
    const rep = buildReport(measure());
    expect(rep.rulesEnabled).toBe(6);
    expect(rep.rulesDisabled).toBe(3);
    expect(rep.enabledRuleIds).toContain("ADBE_OversetText");
    expect(rep.disabledRuleIds).toContain("ADBE_ImageResolution");
  });

  it("waitPolarity ДОЇЖДЖАЄ з виміру у звіт, а не гине по дорозі", () => {
    /*
     * Доти перенесення цього поля тримала сама лише система типів: у всіх
     * фікстурах воно `null`, тобто видалення рядка `waitPolarity: measure.…` з
     * `buildReport` не завалило б жодного тесту — звіт просто мовчки віддавав би
     * `undefined` там, де мусить бути причина непідтвердженої повноти.
     */
    const rep = buildReport(measure({ waitTimedOut: true, waitPolarity: "object null" }));
    expect(rep.waitPolarity).toBe("object null");
    expect(rep.caveat).toContain("object null");
  });

  it("рахує ВИПАДКИ, а не правила", () => {
    const rows: PreflightRow[] = [
      [1, "TEXT (2)", "", "", []],
      [2, "Overset text (2)", "", "", []],
      [3, "Text Frame", "1", "", []],
      [3, "Text Frame", "5", "", []],
    ];
    const rep = buildReport(measure({ rows }));
    expect(rep.findings.length).toBe(1);
    expect(rep.occurrenceCount).toBe(2);
    expect(rep.occurrencesTruncated).toBeNull();
  });

  it("несе робочий профіль документа окремо від того, яким міряли", () => {
    const rep = buildReport(measure({ profileName: "New Preflight Profile" }));
    expect(rep.profileName).toBe("New Preflight Profile");
    expect(rep.workingProfile).toBe("[Basic]");
  });

  it("незавершений прогін ВІДДАЄ звіт із waitTimedOut true, а caveat кричить про неповноту", () => {
    /*
     * Поле мало б сенс лише тоді, коли воно справді може бути true у ВИДАНОМУ
     * звіті. Тут це перевіряється на шляху звіту, а не лише в JSX.
     */
    const rep = buildReport(measure({ waitTimedOut: true }));
    expect(rep.waitTimedOut).toBe(true);
    expect(rep.caveat).toContain("INCOMPLETE");
    expect(rep.occurrenceCount).toBe(1);
  });

  it("лічильники приладу доходять до звіту поруч із occurrenceCount", () => {
    const rep = buildReport(
      measure({ shapeRecognised: false, rowsSeen: 7, rowsParsed: 2, pairsSeen: 4, pairsParsed: 1, processRemoved: false }),
    );
    expect(rep.shapeRecognised).toBe(false);
    expect(rep.rowsSeen).toBe(7);
    expect(rep.rowsParsed).toBe(2);
    expect(rep.pairsSeen).toBe(4);
    expect(rep.pairsParsed).toBe(1);
    expect(rep.processRemoved).toBe(false);
  });

  it("числа в caveat збігаються з фактичними rulesEnabled/rulesDisabled звіту", () => {
    /* Стара перевірка дивилась лише на caveat.length > 0 — тобто пропускала
     * будь-який текст, зокрема протилежний за змістом. */
    const rep = buildReport(measure());
    expect(rep.caveat).toContain(`${rep.rulesEnabled} rules are active out of ${rep.rulesEnabled + rep.rulesDisabled}`);
    expect(rep.caveat).toContain(`${rep.rulesDisabled} disabled`);
    expect(rep.caveat).toContain(`"${rep.profileName}"`);
  });

  it("caveat присутній ЗАВЖДИ, і при нулі порушень він про нуль", () => {
    const rep = buildReport(measure({ rows: [] }));
    expect(rep.occurrenceCount).toBe(0);
    expect(rep.caveat).toContain("No violations found");
  });

  it("перелік випадків обрізається стелею, і обрізання видно", () => {
    const rows: PreflightRow[] = [
      [1, "IMAGES (300)", "", "", []],
      [2, "Image resolution (300)", "", "", []],
    ];
    const total = MAX_PREFLIGHT_OCCURRENCES + 40;
    for (let i = 0; i < total; i++) rows.push([3, "Image", String(i + 1), "", []]);

    const rep = buildReport(measure({ rows }));
    expect(rep.occurrenceCount).toBe(total);
    expect(rep.findings[0]!.occurrences).toHaveLength(MAX_PREFLIGHT_OCCURRENCES);
    expect(rep.findings[0]!.occurrenceCount).toBe(total);
    expect(rep.occurrencesTruncated).toEqual({ shown: MAX_PREFLIGHT_OCCURRENCES, total });
  });

  it("бюджет стелі СПІЛЬНИЙ на всю відповідь, а не на кожне правило", () => {
    /* Байти коштує вся відповідь разом; стеля на кожне правило множилася б на
     * кількість правил і не була б стелею. */
    const rows: PreflightRow[] = [];
    for (let r = 0; r < 3; r++) {
      rows.push([1, `CAT${r}`, "", "", []]);
      rows.push([2, `RULE${r}`, "", "", []]);
      for (let i = 0; i < MAX_PREFLIGHT_OCCURRENCES; i++) rows.push([3, "Image", String(i + 1), "", []]);
    }
    const rep = buildReport(measure({ rows }));
    const shown = rep.findings.reduce((n, f) => n + f.occurrences.length, 0);
    expect(shown).toBe(MAX_PREFLIGHT_OCCURRENCES);
    expect(rep.occurrenceCount).toBe(MAX_PREFLIGHT_OCCURRENCES * 3);
    /* Правило, від якого не лишилось жодного випадку, все одно каже свою
     * СПРАВЖНЮ кількість — інакше воно виглядало б як правило без знахідок. */
    expect(rep.findings[2]!.occurrences).toEqual([]);
    expect(rep.findings[2]!.occurrenceCount).toBe(MAX_PREFLIGHT_OCCURRENCES);
  });
});

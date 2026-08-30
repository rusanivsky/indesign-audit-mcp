import { afterAll, beforeAll, expect, it } from "vitest";
import { runJsx } from "../../src/bridge/runner.js";
import type { StyleRow } from "../../src/styles/report.js";
import type { StyleFinding, StylesMeasure } from "../../src/styles/types.js";
import { registerStyleTools } from "../../src/tools/styles.js";
import type { Tools } from "../../src/tools/shared.js";
import { assertFixtureActive, closeFixtureDoc, makeLayoutFixtureDoc } from "./fixture-doc.js";

/*
 * Задача 7 перевірила обробник styles_audit підміненим містком
 * (tests/unit/tools-styles-handler.test.ts) — там `runJsx` замоктано, і
 * жоден рядок цього файлу не торкається живого InDesign. Тут навпаки:
 * `runJsx` НЕ підмінюється, `registerStyleTools` реєструється на
 * справжньому `Tools`-пастці так само, як в юніт-тесті (ловимо captured
 * handler через registerTool), але сам виклик обробника йде до живого
 * InDesign через справжній bridge/runner.js — наскрізний шлях від
 * `styles_measure` до серіалізованої відповіді MCP.
 *
 * Форма відповіді взята НЕ з брифа Задачі 9 (він застарів — писався до
 * чотирьох кіл рецензій, які додали дві родини, стелю detail,
 * detailTruncated, detailUnit і перейменували totals), а з реального
 * src/tools/styles.ts. Розбіжності з брифом, звірені явно:
 *   - родин п'ять (usage/overrides/scale/character/hierarchy), не три;
 *   - default-style-applied НЕ потрапляє у верхньорівневий findings —
 *     лише сума в usage.defaultStyleApplied і адреси через
 *     detail: { family: "usage", styleId } (CRITICAL рецензії кола 1:
 *     другий цикл detectUsage дає знахідку на КОЖЕН абзац службового
 *     стилю, а findings обмежений за побудовою кількістю СТИЛІВ, не
 *     абзаців — сирий перелік туди потрапити не може);
 *   - totals.declaredStyles/usedStyles/... — перейменовані поля з
 *     одиницею виміру в самій назві, не старі pages/styles/overrides;
 *   - detail тепер приймає family (обов'язково серед families) і
 *     styleId (за .id, не за назвою — саме це розрізняє двійників
 *     "Dvijnyk" нижче).
 */

let docName = "";

beforeAll(async () => {
  docName = await makeLayoutFixtureDoc();
});

afterAll(async () => {
  if (docName) await closeFixtureDoc(docName);
});

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
type AnyHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

interface AuditBody {
  docName: string;
  families: string[];
  styles: StyleRow[];
  findings: StyleFinding[];
  /*
   * Повне пояснення межі «таблиці й виноски» — ОДИН раз на відповідь, а
   * не в тексті кожної знахідки (рецензія хвилі, п.2). Поле умовне.
   */
  caveats?: { tablesAndFootnotes: string };
  usage: { unusedStyles: number; defaultStyleApplied: number } | null;
  scale: {
    groups: {
      horizontalScale: number | null;
      verticalScale: number | null;
      paragraphs: number;
      containers: string[];
      containersTruncated?: { shown: number; total: number };
      /* За `.id` стилю, з назвою поруч — не голі назви (дрібне п.4). */
      styles: { styleId: string; styleName: string }[];
      stylesTruncated?: { shown: number; total: number };
    }[];
    /* Стеля на кількість ГРУП — ключ групи містить точне значення float. */
    groupsTruncated?: { shown: number; total: number };
    paragraphs: number;
    ratioMatches: number;
    ratioUnavailable: number;
  } | null;
  character: {
    declaredStyles: number;
    usedStyles: number;
    unusedStyles: number;
    /* ТРИ числа, ТРИ популяції: rangesTotal — усі діапазони виміру
     * (батьківські включно), rangesAudited — ті, що дійшли до
     * порівняння (ЗНАМЕННИК частки), rangesDeviating — підмножина
     * rangesAudited. Ділити можна лише два останні. */
    rangesTotal: number;
    rangesAudited: number;
    rangesDeviating: number;
    byProperty: Record<string, number>;
    /* Стилі, що живуть лише на носії поза текстом (маркер, вкладений,
     * GREP, перехресне посилання, зміст) — інвентар, не знахідка. */
    stylesOnlyReferenced: {
      name: string;
      styleId: string;
      referencedBy: { carrier: string; count: number }[];
    }[];
    /* Скільки читань під час пошуку носіїв провалилося. Нуль — «обійшли
     * все, що вміємо»; більше нуля — на цьому документі знахідка про
     * невжиток може бути хибною. */
    carrierProbeFailures: number;
  } | null;
  hierarchy: {
    stylesInChains: number;
    maxChainDepth: number;
    /* `stylesAffected`, не `styles`: тут ЧИСЛО, а scale.groups[].styles
     * у тій самій відповіді — МАСИВ (дрібне п.1 рецензії хвилі). */
    chainDepthTruncated?: { limit: number; stylesAffected: number };
  } | null;
  detail: unknown[] | null;
  detailUnit?: string;
  /* Область визначення total: один стиль, не документ (I-2). */
  detailTotalNote?: string;
  detailTruncated?: { shown: number; total: number };
  totals: {
    declaredStyles: number;
    usedStyles: number;
    paragraphs: number;
    paragraphsOffPage: number;
    usageUnusedStyles: number | null;
    usageDefaultStyleApplied: number | null;
    overridePropertyDeviations: number | null;
    scaleParagraphs: number | null;
    characterRangesDeviating: number | null;
    hierarchyStylesInChains: number | null;
  };
}

/*
 * Той самий патерн, що в tests/unit/tools-styles-handler.test.ts: пастка
 * registerTool ловить handler styles_audit. Єдина відмінність від
 * юніт-тесту — bridge/runner.js тут НЕ замокано, тож handler усередині
 * реально викликає runJsx("styles_measure", ...) до живого InDesign.
 */
function toolHandler(): AnyHandler {
  let captured: AnyHandler | null = null;
  const fake = {
    registerTool(name: string, _cfg: unknown, handler: AnyHandler) {
      if (name === "styles_audit") captured = handler;
    },
  } as unknown as Tools;
  registerStyleTools(fake);
  if (!captured) throw new Error("styles_audit не зареєстровано");
  return captured;
}

const ALL_FAMILIES = ["usage", "overrides", "scale", "character", "hierarchy"];

async function audit(args: Record<string, unknown> = {}): Promise<AuditBody> {
  const result = await toolHandler()({ families: ALL_FAMILIES, ...args });
  expect(result.isError).toBeFalsy();
  return JSON.parse(result.content[0]!.text) as AuditBody;
}

it("живий прогін: віддає рядок звіту на кожен оголошений стиль", async () => {
  await assertFixtureActive(docName);
  const body = await audit();
  expect(body.docName).toBe(docName);
  /*
   * report.ts: `ids` — об'єднання ключів usage (яке заповнює ЗАВЖДИ
   * кожен оголошений стиль нулем, countUsage) і summaryById, тож рядків
   * не менше, ніж оголошених стилів.
   */
  expect(body.styles.length).toBeGreaterThanOrEqual(body.totals.declaredStyles);

  /* Поіменно — стилі, чий стан ця задача перевіряє нижче, справді
   * присутні рядком, а не лише маються на увазі числом. */
  const names = body.styles.map((r) => r.styleName);
  expect(names).toContain("Nevzhyvanyi");
  expect(names).toContain("Vsi_Pereviznachaiut");
  expect(names).toContain("Osnovnyi");
});

it("живий прогін: невживаний стиль має ratio null (не 0) і paragraphs 0", async () => {
  await assertFixtureActive(docName);
  const body = await audit();
  const rows = body.styles.filter((r) => r.styleName === "Nevzhyvanyi");
  expect(rows).toHaveLength(1);
  const unused = rows[0]!;
  expect(unused.paragraphs).toBe(0);
  expect(unused.paragraphsAudited).toBe(0);
  expect(unused.ratio).toBeNull();
});

it("живий прогін: невживаний стиль-ЛИСТОК дає знахідку style-unused-leaf у findings", async () => {
  await assertFixtureActive(docName);
  const body = await audit();
  const found = body.findings.filter((f) => f.defect === "style-unused-leaf" && f.styleName === "Nevzhyvanyi");
  expect(found).toHaveLength(1);
  expect(found[0]!.family).toBe("usage");
  expect(typeof found[0]!.styleId).toBe("string");
});

it("живий прогін: стиль, який перевизначають УСІ абзаци, дає ratio 1", async () => {
  await assertFixtureActive(docName);
  const body = await audit();
  const rows = body.styles.filter((r) => r.styleName === "Vsi_Pereviznachaiut");
  expect(rows).toHaveLength(1);
  const all = rows[0]!;
  /* Фікстура кладе рівно 2 абзаци (ep[0], ep[1]), обидва не на батьківській. */
  expect(all.paragraphsAudited).toBeGreaterThan(1);
  expect(all.deviating).toBe(all.paragraphsAudited);
  expect(all.ratio).toBe(1);
});

/*
 * Форма відповіді тут відрізняється від брифа НАЙПОМІТНІШЕ. Брифовий тест
 * очікував `findings.filter(f => f.defect === "default-style-applied")`
 * непорожнім і з `containerId`. Реальний код (styles.ts, коментар
 * CRITICAL рецензії кола 1) явно ВИКЛЮЧАЄ default-style-applied із
 * findings: другий цикл detectUsage дає знахідку НА КОЖЕН абзац
 * службового стилю, а findings — allowlist, обмежений за побудовою
 * кількістю СТИЛІВ, не абзаців. Службовий стиль рахується сумою в
 * usage.defaultStyleApplied/totals.usageDefaultStyleApplied, а поіменна
 * адреса (containerId/paragraphIndex) доступна лише через
 * detail: { family: "usage", styleId }.
 */
it("живий прогін: службовий стиль у верстці рахується сумою, а не в findings; адреса — лише через detail", async () => {
  await assertFixtureActive(docName);
  const body = await audit();

  expect(body.findings.some((f) => f.defect === "default-style-applied")).toBe(false);

  expect(body.usage).not.toBeNull();
  expect(body.usage!.defaultStyleApplied).toBeGreaterThan(0);
  expect(body.totals.usageDefaultStyleApplied).toBe(body.usage!.defaultStyleApplied);

  /*
   * `.id` службового стилю НЕ дорівнює літеральному рядку "[Basic
   * Paragraph]" — виміряно тут-таки (перша версія тесту з жорстко
   * прописаним рядком провалилась: JSX-бік бере `String(appliedParagraphStyle.id)`,
   * реальний внутрішній id InDesign, не назву). Тому styleId для detail
   * береться з уже отриманого рядка звіту (`body.styles`), де службовий
   * стиль так само присутній рядком, як «оголошений і рахований» — за
   * тим самим механізмом, що й будь-який інший стиль.
   */
  const defaultRow = body.styles.find(
    (r) => r.styleName === "[Basic Paragraph]" || r.styleName === "[No Paragraph Style]",
  );
  expect(defaultRow).toBeDefined();

  const detailBody = await audit({
    detail: { family: "usage", styleId: defaultRow!.styleId },
  });
  expect(detailBody.detail).not.toBeNull();
  const detailRows = detailBody.detail as { containerId: string | null; paragraphIndex: number | null }[];
  expect(detailRows.length).toBeGreaterThan(0);
  for (const d of detailRows) {
    expect(d.containerId).not.toBeNull();
  }
});

it("живий прогін: масштабований текст групується за значенням горизонтального масштабу", async () => {
  await assertFixtureActive(docName);
  const body = await audit();
  expect(body.scale).not.toBeNull();
  const g = body.scale!.groups.find((x) => x.horizontalScale === 96);
  expect(g).toBeDefined();
  expect(g!.paragraphs).toBeGreaterThan(0);
  /* Мішаний масштаб (null) — окрема група, не змішана з 96. */
  const mixed = body.scale!.groups.find((x) => x.horizontalScale === null);
  expect(mixed).toBeDefined();
});

/*
 * РЕЦЕНЗІЯ КОЛА 1 (Important 3): родина `hierarchy` не мала ЖОДНОЇ живої
 * перевірки — ні тут, ні в styles-measure.test.ts. Разом із нею лишався
 * непокритим `IDMCP.relatedStyleId` (styles.jsx) на живому InDesign.
 *
 * ВИПРАВЛЕННЯ ПРИПУЩЕННЯ РЕЦЕНЗІЇ, ЗМІРЯНЕ, НЕ ВГАДАНЕ. Рецензія
 * припустила, що «у фікстурі є стилі з basedOn (V_Hrupi у теці,
 * Vsi_Pereviznachaiut)». Живий зонд (той самий прийом, що й решта
 * фікстури — вимір, а не здогад) показав: НІ, до цієї правки жоден
 * стиль фікстури, створений через `.add()` без явного `basedOn`, не мав
 * реального батька — `st.basedOn.name`/`.id` давали рядок `"undefined"`
 * через `NothingEnum.NOTHING` (властивість просто не задана), а не через
 * жодну з двох гілок, які `IDMCP.relatedStyleId` документує явно: ані
 * "кидає виняток" (сам `[No Paragraph Style]`), ані "легальне явне
 * `basedOn: [No Paragraph Style]`". Обидві лишались би непокритими
 * живим прогоном, і мутант «прибрати спецвипадок [No Paragraph Style] у
 * relatedStyleId» пройшов би непоміченим — саме те, що назвала рецензія.
 *
 * Тому у фікстуру (`_fixtures.jsx`, розділ «Фаза 5») додано ДВА нові
 * стилі САМЕ для цього: `Bazovanyi_Na_NoPara` (явний `basedOn: [No
 * Paragraph Style]`) і `Bazovanyi_Na_Osnovnyi` (`basedOn: osnovnyi`,
 * справжній батько). Решта стилів фікстури (`V_Hrupi`,
 * `Vsi_Pereviznachaiut` і всі інші) лишаються без реального `basedOn` —
 * і це тепер очікування тесту, а не порожнє місце.
 *
 * Перша половина тесту працює НАПРЯМУ з `styles_measure` (а не через
 * `styles_audit`): це єдиний спосіб перевірити `basedOnId` по СИРИХ
 * оголошених стилях. Друга половина перевіряє, що `styles_audit` справді
 * будує ланцюжки з цих `basedOnId` (`resolveChains`/`hierarchyBlock`).
 */
it("живий прогін: relatedStyleId дає null для ОБОХ видів кореня (включно з явним basedOn: [No Paragraph Style]) і реальний id для справжнього ланцюжка; hierarchy його рахує", async () => {
  await assertFixtureActive(docName);
  const measure = await runJsx<StylesMeasure>("styles_measure", {}, { timeoutMs: 120_000 });

  /* Корінь №1: [No Paragraph Style] сам по собі — .basedOn КИДАЄ виняток у InDesign. */
  const noParaStyleRows = measure.styles.filter((s) => s.name === "[No Paragraph Style]");
  expect(noParaStyleRows).toHaveLength(1);
  expect(noParaStyleRows[0]!.basedOnId).toBeNull();

  /* Корінь №2: [Basic Paragraph] — .basedOn не кидає, дає NothingEnum ("undefined"). */
  const basicParaRows = measure.styles.filter((s) => s.name === "[Basic Paragraph]");
  expect(basicParaRows).toHaveLength(1);
  expect(basicParaRows[0]!.basedOnId).toBeNull();

  /*
   * Стиль з ЯВНИМ `basedOn: [No Paragraph Style]` — ТРЕТІЙ, окремо
   * виміряний шлях (не throws, не NothingEnum): .basedOn — справжнє
   * посилання на реальний об'єкт з `.name === "[No Paragraph Style]"` і
   * робочим `.id`. Без перевірки за назвою в `relatedStyleId` це дало б
   * НЕ null, а реальний id [No Paragraph Style] — рівно мутант, який
   * назвала рецензія.
   */
  const noParaBasedRows = measure.styles.filter((s) => s.name === "Bazovanyi_Na_NoPara");
  expect(noParaBasedRows).toHaveLength(1);
  expect(noParaBasedRows[0]!.basedOnId).toBeNull();

  /* Стилі без реального basedOn (NothingEnum-шлях) — теж null, не "undefined" рядком. */
  const vHrupiRows = measure.styles.filter((s) => s.name === "V_Hrupi");
  expect(vHrupiRows).toHaveLength(1);
  expect(vHrupiRows[0]!.basedOnId).toBeNull();

  /*
   * ЄДИНИЙ стиль фікстури зі СПРАВЖНІМ ланцюжком: `basedOn: osnovnyi`.
   * basedOnId тут — реальний id, і саме він рівний `.id` рядка "Osnovnyi"
   * у тому самому вимірі (перевірка структурна, за id, не назвою — Задачі
   * 12-14).
   */
  const chainedRows = measure.styles.filter((s) => s.name === "Bazovanyi_Na_Osnovnyi");
  expect(chainedRows).toHaveLength(1);
  const osnovnyiRows = measure.styles.filter((s) => s.name === "Osnovnyi");
  expect(osnovnyiRows).toHaveLength(1);
  expect(typeof chainedRows[0]!.basedOnId).toBe("string");
  expect(chainedRows[0]!.basedOnId).toBe(osnovnyiRows[0]!.id);

  /* `styles_audit`, родина hierarchy: цей один справжній ланцюжок мусить
   * дійти до зведення — а не лишитися непоміченим полем виміру. */
  const body = await audit();
  expect(body.hierarchy).not.toBeNull();
  expect(body.hierarchy!.stylesInChains).toBeGreaterThanOrEqual(1);
  expect(body.hierarchy!.maxChainDepth).toBeGreaterThanOrEqual(1);
});

/*
 * Найцінніший тест задачі — та поведінка, яку текстовий сторож
 * (styles-jsx-character-guard.test.ts) структурно не може довести:
 * підміна `String(...id)` на `String(...name)` лишила б текст ключування
 * незмінним і пройшла б сторожа, але злила б два "Dvijnyk" в один рядок,
 * і невживаний зник би зі звіту так само, як це вже сталося в родині
 * usage. Тут — поведінковий доказ на живому InDesign, наскрізь до
 * серіалізованої відповіді MCP.
 */
it("живий прогін: ДВА символьні стилі з однаковою назвою рахуються ОКРЕМО за id", async () => {
  await assertFixtureActive(docName);
  const body = await audit();
  expect(body.character).not.toBeNull();
  /* Двійники "Dvijnyk" самі по собі не мають окремого рядка в body.styles
   * (це абзацний звіт), тож перевіряємо через character-style-unused у
   * findings — рівно один невживаний, попри те що вжитий двійник з тією
   * самою назвою існує. */
  const unusedFindings = body.findings.filter((f) => f.defect === "character-style-unused");
  expect(unusedFindings.length).toBeGreaterThan(0);
  /* Якби лічба йшла за назвою, а не .id, невживаний "Dvijnyk" зник би
   * взагалі — findings не містив би жодного character-style-unused із
   * цією назвою, бо вжитий двійник "перекрив" би невживаного. */
  const dvijnykFindings = unusedFindings.filter((f) => f.styleName === "Dvijnyk");
  expect(dvijnykFindings).toHaveLength(1);
  expect(typeof dvijnykFindings[0]!.styleId).toBe("string");

  /* character.unusedStyles рахує СТИЛІ (за id), не назви — теж мінімум 1. */
  expect(body.character!.unusedStyles).toBeGreaterThanOrEqual(1);
});

/*
 * НОСІЇ ПОЗА ТЕКСТОМ — наскрізний доказ на живому InDesign.
 *
 * Юніт-тести `styles-character.test.ts` доводять поведінку детектора на
 * зібраному вручну `StylesMeasure`. Вони НЕ доводять головного: що обхід
 * `IDMCP.characterStyleCarriers` справді знаходить ці стилі в документі —
 * імена властивостей InDesign юніт-тест не перевіряє в принципі, і саме на
 * вгаданих іменах властивостей Фаза 14 уже мала три мовчазні провали.
 *
 * Робоча книжка цього не доводить теж (виміряно 2026-08-16: вкладених
 * стилів у ній немає взагалі, а обидва стилі на носіях мають і текстовий
 * ужиток), тож єдиний доказ — тут.
 */
it("живий прогін: символьний стиль лише на носії — НЕ знахідка, а рядок інвентаря", async () => {
  await assertFixtureActive(docName);
  const body = await audit();
  expect(body.character).not.toBeNull();

  const onlyReferenced = body.character!.stylesOnlyReferenced;
  const byName = new Map(onlyReferenced.map((s) => [s.name, s]));

  /* Усі три носії фікстури — знайдені, кожен зі своєю назвою. */
  expect(byName.get("Lyshe_Marker")?.referencedBy).toEqual([{ carrier: "bullets", count: 1 }]);
  expect(byName.get("Lyshe_Vkladenyi")?.referencedBy).toEqual([{ carrier: "nested", count: 1 }]);
  expect(byName.get("Lyshe_Grep")?.referencedBy).toEqual([{ carrier: "nestedGrep", count: 1 }]);

  /* І жоден із них не названий невживаним — власне те, заради чого все. */
  const unusedNames = body.findings
    .filter((f) => f.defect === "character-style-unused")
    .map((f) => f.styleName);
  expect(unusedNames).not.toContain("Lyshe_Marker");
  expect(unusedNames).not.toContain("Lyshe_Vkladenyi");
  expect(unusedNames).not.toContain("Lyshe_Grep");

  /* НЕГАТИВНИЙ КОНТРОЛЬ до всього тесту: стиль без тексту Й без носія
   * знахідку дає. Інакше все вище проходило б і на коді, що просто
   * перестав давати знахідки про символьні стилі. */
  expect(unusedNames).toContain("Dvijnyk");

  /* Обхід не мовчить про власну сліпоту: жодне читання не провалилось. */
  expect(body.character!.carrierProbeFailures).toBe(0);
});

it("живий прогін: число unusedStyles не розходиться з переліком знахідок", async () => {
  /*
   * Стилі на носіях зникли зі знахідок — отже вони мусять зникнути й з
   * числа. Різниця «оголошено мінус ужито в тексті» дала б 6 при трьох
   * знахідках, і оператор побачив би дві різні правди в одній відповіді.
   */
  await assertFixtureActive(docName);
  const body = await audit();
  const unusedFindings = body.findings.filter((f) => f.defect === "character-style-unused");
  expect(body.character!.unusedStyles).toBe(unusedFindings.length);
});

it("живий прогін: невживана БАЗА дає style-unused-base, а не листок", async () => {
  /*
   * Другий бік поділу з сесії 2026-08-16. Досі фікстура мала лише листок
   * (`Nevzhyvanyi`), тож інтеграційний набір гілку «база» не проходив
   * узагалі — борг, записаний у точці входу.
   *
   * `Baza_Nevzhyvana` не несе абзаців, але на ній стоїть
   * `Dytyna_Vzhyvana`, у якої абзац є: база переживе обчищення, і зносити
   * її не можна — саме це знесення `Чеклист 2` і зламало верстку книжки.
   */
  await assertFixtureActive(docName);
  const body = await audit();

  const base = body.findings.filter(
    (f) => f.defect === "style-unused-base" && f.styleName === "Baza_Nevzhyvana",
  );
  expect(base).toHaveLength(1);
  /* Текст знахідки мусить називати, ЩО САМЕ на ній тримається — інакше це
   * та сама порада «зносьте», лише під іншою назвою. */
  expect(base[0]!.detail).toMatch(/\d/);

  /* Позитивний близнюк: листок лишається листком, тобто поділ живий. */
  expect(
    body.findings.filter((f) => f.defect === "style-unused-leaf" && f.styleName === "Nevzhyvanyi"),
  ).toHaveLength(1);
  /* І база листком НЕ називається. */
  expect(
    body.findings.filter((f) => f.defect === "style-unused-leaf" && f.styleName === "Baza_Nevzhyvana"),
  ).toHaveLength(0);
});

/*
 * detail для родини повертає адреси — тут за родиною `overrides`, з
 * реальним `.id` стилю "Vsi_Pereviznachaiut", узятим НЕ вгадуванням, а з
 * уже отриманого рядка звіту (styleId — розрізнювач, за яким і адресується
 * detail, Задачі 12-14). Обидва його абзаци відхиляються в pointSize
 * (група "sizes"), тож перелік не може бути порожнім.
 */
it("живий прогін: detail для родини (overrides) повертає адреси за реальним styleId", async () => {
  await assertFixtureActive(docName);
  const base = await audit();
  /*
   * Minor (рецензія кола 1): `.find()` без попередньої перевірки
   * унікальності — інконсистентно з рештою файлу й з патерном проєкту
   * (map.test.ts, styles-measure.test.ts беруть елемент лише після
   * `.filter().toHaveLength(1)`). Наразі безпечно, бо ім'я унікальне, але
   * саме цю крихкість Задача 8 виправляла в чужих тестах — тут вона не
   * мала повторитись.
   */
  const rows = base.styles.filter((r) => r.styleName === "Vsi_Pereviznachaiut");
  expect(rows).toHaveLength(1);
  const row = rows[0]!;

  const detailBody = await audit({
    detail: { family: "overrides", styleId: row.styleId, group: "sizes" },
  });
  expect(detailBody.detail).not.toBeNull();
  const detailRows = detailBody.detail as {
    styleId: string | null;
    containerId: string | null;
    paragraphIndex: number | null;
  }[];
  expect(detailRows.length).toBeGreaterThan(0);
  for (const r of detailRows) {
    expect(r.styleId).toBe(row.styleId);
    expect(r.containerId).not.toBeNull();
    expect(r.paragraphIndex).not.toBeNull();
  }
});

/*
 * ПЕРЕВІРЯТИ ТРЕБА ОБСЯГ ВІДПОВІДІ, НЕ ЛИШЕ ВМІСТ — правило, здобуте
 * Фазою 4, коли 78 КБ на трьох сторінках зробили інструмент непридатним.
 *
 * РЕЦЕНЗІЯ КОЛА 1 (Important 2): перша версія цього тесту була вакуумною —
 * поріг 64 000 Б лежав більш ніж удвічі понад теоретичну стелю (~28 300 Б,
 * якби `detail` заповнився всіма 50 записами), тож тест пройшов би
 * однаково і з захистом, і без нього. Обсяг на ВЕЛИКИХ числах уже
 * стереже юніт-тест Задачі 7 (150 записів, поріг 20 000 Б, перевірено, що
 * лежить МІЖ обрізаною і неурізаною відповіддю). Цінність тут інша —
 * довести, що РЕАЛЬНА відповідь на РЕАЛЬНОМУ документі мала. Тому:
 * фактичний розмір ВИМІРЯНО і НАЗВАНИЙ у самому `expect` (через `toBe`,
 * не лише нерівність) — так регресія, що змінює обсяг хоч на один байт,
 * падає з точним числом, а не мовчки ковтається запасом; а стеля нижче
 * (`MEASURED_BYTES * 2`, округлено вгору) ловить регресію, що роздує
 * відповідь на порядок, і водночас не падає від дрібного дрейфу фікстури.
 *
 * Виміряно (живий прогін, InDesign 21.4.1.4, ця фікстура — включно з
 * двома стилями, доданими фіксом Important 3 нижче): без `detail` (усі
 * п'ять родин) — **10 774 Б**. Поріг лишається 19 000 Б: він від виміру
 * 9 187 Б (≈2×), і рішення попередньої задачі його не переглядає — нове
 * число в нього вкладається з великим запасом.
 *
 * ЧОМУ ЧИСЛО ЗМІНИЛОСЯ (9 187 → 10 774, +1 587 Б, +17 %): хвиля
 * виправлень фінальної рецензії додала до відповіді ТЕКСТ, не дані —
 * застереження про таблиці й виноски в знахідках про невживані стилі
 * (I-4), поле `caveats.tablesAndFootnotes` один раз на відповідь, поле
 * `rangesAudited` у блоці `character` (I-3) і об'єктну форму
 * `scale.groups[].styles` замість голих назв (дрібне п.4).
 *
 * Проміжний вимір тієї самої хвилі — 11 290 Б: тоді повне застереження
 * стояло в тексті КОЖНОЇ знахідки, і 1 785 Б з 2 103 Б приросту (85 %)
 * давало саме повторення одного речення на 5 знахідках фікстури.
 * Застереження винесено у відповідь один раз, у знахідці лишилася
 * коротка заборона з ключем — звідси 10 774. Хто побачить падіння цього
 * тесту наступним: число рухає САМЕ обсяг тексту знахідок і полів-пояснень,
 * а не кількість виміряних місць.
 */
/*
 * Обсяг відповіді БЕЗ впливу назви документа.
 *
 * Точні побайтові числа нижче одного дня почали розходитись на 1 байт, і
 * причина була не в коді: фікстура зветься «Untitled-N», N росте з кожним
 * створеним за сесію документом, і `docName` їде у відповіді. «Untitled-9»
 * і «Untitled-68» — різна довжина, тобто тест мовчки залежав від того,
 * скільки документів InDesign відкривав РАНІШЕ.
 *
 * Точність побайтового виміру тут цінна (вона й ловила роздування), тож
 * замість послаблення до діапазону нормалізуємо назву: рахуємо байти
 * відповіді, у якій ім'я документа замінене на сталий токен.
 */
function bytesWithoutDocName(text: string, name: string): number {
  return Buffer.byteLength(text.split(name).join("DOC"), "utf8");
}

it("живий прогін: відповідь без detail не роздувається поабзацними/подіапазонними записами", async () => {
  await assertFixtureActive(docName);
  const result = await toolHandler()({ families: ALL_FAMILIES });
  expect(result.isError).toBeFalsy();
  /* Число НОРМАЛІЗОВАНЕ (див. bytesWithoutDocName): 10 774 сирих байтів на
   * «Untitled-9» — це 10 765 з ім'ям, зведеним до сталого токена.
   *
   * 2026-08-16, зі злиттям Фази 14: 10 765 → 10 903, рівно **+138 Б**.
   * Причина СТРУКТУРНА, а не «книжка змінилася», і це доведено арифметикою:
   * той самий приріст +138 з'явився й у тесті з `detail` нижче, хоча
   * відповіді там інша форма й інший розмір. Дрейф вмісту дав би різні
   * дельти; однакова стала дельта буває лише від сталого додатка. Він і є:
   * розділення `style-unused` на `style-unused-leaf`/`style-unused-base`
   * подовжило назву дефекту на 5 Б у кожній із 14 знахідок (=70), а
   * `totals` дістав два нові поля `usageUnusedLeafStyles` і
   * `usageUnusedBaseStyles` (≈69). Разом ≈139 — збігається з виміром. */
  /*
   * 2026-08-16, ДРУГА ЗМІНА ТОГО САМОГО ДНЯ: 10 903 → 11 711. Обидві
   * причини виміряні окремо, а не оцінені — прогін цього самого тесту з
   * тимчасово поверненою серіалізацією «з відступами» дав 15 929 Б:
   *   +5 026 Б  нові стани фікстури (три символьні стилі на носіях, чотири
   *             абзацні стилі до них, невживана база з дитиною);
   *   −4 218 Б  компактна серіалізація `serialise` (−26,5 %).
   * Разом +808. Та сама дельта фікстури (+5 026, до байта) з'явилась і в
   * тесті з `detail` нижче — однакова стала дельта на двох різних за
   * формою відповідях буває лише від сталого структурного додатка.
   */
  /*
   * 2026-08-25, ЗЛИТТЯ ГІЛКИ ПЕРЕКЛАДУ: 11 711 → 10 310, тобто −1 401 Б.
   * Причина — МОВА ВІДПОВІДІ, і вона виміряна, а не оцінена: `detail`
   * знахідок і `caveat` перекладено з української на англійську, а кирилиця
   * в UTF-8 коштує 2 байти на символ проти 1 у латиниці. Кириличних байтів
   * у РЯДКАХ КОДУ (не в коментарях) модулів, що будують цю відповідь
   * (`src/styles/*.ts` + `src/tools/styles.ts`), було 2 080, лишилось 144.
   *
   * Дельти двох тестів РІЗНІ (−1 401 і −1 593) — і за логікою, вже записаною
   * вище в цьому файлі, це саме дрейф вмісту, а не сталий структурний
   * додаток: відповідь із `detail` несе більше тієї самої прози, тож і
   * втрачає більше. Стала дельта тут була б ознакою іншої причини.
   *
   * Ця зміна НЕ від двомовної типографіки: між `68bf642` і цим комітом у
   * `src/styles/` і `src/tools/styles.ts` не змінено жодного файла
   * (`git diff --name-only 68bf642..HEAD -- src/styles/ src/tools/styles.ts`
   * порожній).
   */
  /*
   * 2026-08-27, ЧЕТВЕРТА ЗМІНА: 10310 → 10597, тобто +287 Б. Причина — КОД, а
   * НЕ документ, і це важливо, бо перша діагноза була протилежна й хибна.
   *
   * Коміт `65c6d90` дописав одне речення до спільного
   * `UNUSED_STYLE_CAVEAT_TEXT` (`src/styles/types.ts`) — «AND ON DELETING A
   * BRANCH: …». Виміряно: 286 Б UTF-8, 287 із провідним пробілом. Дельта
   * СТАЛА в обох тестах, бо застереження їде ОДИН раз на відповідь, у
   * `caveats.tablesAndFootnotes` (`src/tools/styles.ts`), а не на кожну
   * знахідку — рівно та ознака структурного додатку, що описана вище.
   *
   * ЦИТАТА ПРО `git diff` У ЗАПИСІ ВІД 2026-08-25 ПРОТУХЛА, І САМЕ ВОНА
   * ЗБИЛА ПЕРШУ ДІАГНОЗУ. Вона записує ПЕРЕВІРКУ, зроблену того дня, а не
   * сталий факт: за два дні `src/styles/` і `src/tools/styles.ts` зачепили
   * два коміти (`65c6d90`, `bdbadd6`). Датований вимір у коментарі
   * протухає так само, як датований вимір деінде — перезапускайте команду,
   * а не цитуйте її результат.
   *
   * Друга хибна гадка, варта запису: «числа прив'язані до живого документа
   * користувача, а він змінився». Неможливо ЗА ПОБУДОВОЮ — `beforeAll`
   * кличе `makeLayoutFixtureDoc()`, тобто міряється фікстура, зібрана з
   * нуля, і відкриті видання на ці числа не впливають ніяк.
   *
   * ДОВЕДЕНО ВИКОНАННЯМ, А НЕ АРИФМЕТИКОЮ. Речення тимчасово відкотили до
   * форми перед `65c6d90` і прогнали цей файл: обидві рівності сіли рівно на
   * 10310 і на другу стару базу, 14/14 зелених. Повернули текст — знову 10597.
   *
   * Перша спроба доказу дала 10311, тобто на байт БІЛЬШЕ за історичне число,
   * і цей байт варто назвати: `65c6d90` дописав не лише речення (286 Б), а й
   * ПРОБІЛ перед ним. Відкат, що прибирає саме речення, лишає пробіл і не
   * відтворює старої бази. 286 + 1 = 287.
   *
   * РІВНІСТЬ ЛИШАЄТЬСЯ РІВНІСТЮ. Послабити до `toBeLessThan` означало б
   * сховати саме той дрейф, який ці числа й спіймали: `65c6d90` шанував
   * бюджет байтів у тексті знахідки (на нього є тест) — і тому пояснення
   * поїхало у спільне застереження, чий бюджет живе ЛИШЕ тут.
   */
  const bytes = bytesWithoutDocName(result.content[0]!.text, docName);
  expect(bytes).toBe(10597);
  expect(bytes).toBeLessThan(19_000);
});

/*
 * Той самий тест на обсяг, але для detail — і тут же фікс Important 1
 * (рецензія кола 1): попередня версія адресувала
 * `detail: { family: "usage", styleId: "[Basic Paragraph]" }` літеральним
 * рядком, а тест "службовий стиль..." вище ЩЕ РАНІШЕ в цьому самому файлі
 * довів, що `.id` службового стилю — НЕ цей рядок, а внутрішній id
 * InDesign. Наслідок: `detailFull` для того виклику був ЗАВЖДИ порожній
 * масив, і тест мовчки перевіряв ту саму «коротку» відповідь, що й тест
 * без detail, — жодного самостійного покриття не давав. Виправлено: styleId
 * бере з `body.styles` (той самий прийом, що в тесті "службовий стиль..."),
 * і додано `expect(detailRows.length).toBeGreaterThan(0)` — без цієї
 * перевірки та сама пастка (порожній detail, що виглядає як «перевірено»)
 * повернулася б мовчки за першої ж правки фікстури чи styleId.
 *
 * Виміряно (той самий прогін): з detail на реальних адресах —
 * **13 267 Б** (було 11 215 Б до хвилі виправлень фінальної рецензії).
 * Приріст +2 052 Б — той самий, що в тесті без `detail` (застереження,
 * `caveats`, `rangesAudited`, об'єктна форма `scale.groups[].styles`),
 * плюс поле `detailTotalNote`, що з'являється РАЗОМ із `detailUnit` і
 * каже, що `total` рахує один стиль, а числа блоків — увесь документ
 * (I-2). Проміжний вимір хвилі — 13 783 Б, до винесення застереження з
 * тексту кожної знахідки.
 * Поріг — 23 000 Б (той самий запас ~2×, що вище; за конструкцією
 * `detail` ще й обрізається стелею MAX_DETAIL_ITEMS=50, тож на порядок
 * більшого документа ця відповідь однаково не виросте до теоретичної
 * стелі ≈28 300 Б, підрахованої рецензентом для повністю заповненого
 * detail — на цій фікстурі службових абзаців лише кілька, не 50).
 */
it("живий прогін: відповідь з detail — реальні адреси, теж у межах розумного обсягу", async () => {
  await assertFixtureActive(docName);
  const base = await audit();
  const defaultRow = base.styles.find(
    (r) => r.styleName === "[Basic Paragraph]" || r.styleName === "[No Paragraph Style]",
  );
  expect(defaultRow).toBeDefined();

  const result = await toolHandler()({
    families: ALL_FAMILIES,
    detail: { family: "usage", styleId: defaultRow!.styleId },
  });
  expect(result.isError).toBeFalsy();
  const body = JSON.parse(result.content[0]!.text) as AuditBody;
  const detailRows = body.detail as { containerId: string | null }[] | null;
  expect(detailRows).not.toBeNull();
  /* Без цього тест знову міг би мовчки перевіряти порожній detail —
   * рівно та пастка, яку рецензія кола 1 знайшла в попередній версії. */
  expect(detailRows!.length).toBeGreaterThan(0);

  /* Нормалізоване число, як і вище: 13 267 сирих → 13 258 без імені.
   *
   * 2026-08-16: 13 258 → 13 396, той самий приріст **+138 Б**, що й у тесті
   * без `detail`. Саме ця ОДНАКОВІСТЬ дельти на двох різних за формою й
   * розміром відповідях і доводить, що причина — сталий структурний
   * додаток (розділення `style-unused` на leaf/base), а не зміна книжки. */
  /*
   * 2026-08-16, друга зміна: 13 396 → 13 749. Розклад виміряний так само,
   * як у тесті без `detail`: з відступами й новою фікстурою — 18 422 Б,
   * тобто +5 026 Б від станів фікстури (ТА САМА дельта, до байта) і
   * −4 673 Б від компактної серіалізації.
   */
  /*
   * 2026-08-23, третя зміна: 13 749 → 13 614. Причина НЕ в книжці й не в
   * структурі відповіді, а в злитті англійського перекладу: видимі рядки
   * інструмента стали коротшими на 135 Б. Перевірено тим, що дельта лягла
   * рівно на переклад — фікстура й розклад решти не мінялись.
   */
  /*
   * 2026-08-25, ЗЛИТТЯ ГІЛКИ ПЕРЕКЛАДУ: 13 614 → 12 021, тобто −1 593 Б.
   * Причина — МОВА ВІДПОВІДІ, і вона виміряна, а не оцінена: `detail`
   * знахідок і `caveat` перекладено з української на англійську, а кирилиця
   * в UTF-8 коштує 2 байти на символ проти 1 у латиниці. Кириличних байтів
   * у РЯДКАХ КОДУ (не в коментарях) модулів, що будують цю відповідь
   * (`src/styles/*.ts` + `src/tools/styles.ts`), було 2 080, лишилось 144.
   *
   * Дельти двох тестів РІЗНІ (−1 401 і −1 593) — і за логікою, вже записаною
   * вище в цьому файлі, це саме дрейф вмісту, а не сталий структурний
   * додаток: відповідь із `detail` несе більше тієї самої прози, тож і
   * втрачає більше. Стала дельта тут була б ознакою іншої причини.
   *
   * Ця зміна НЕ від двомовної типографіки: між `68bf642` і цим комітом у
   * `src/styles/` і `src/tools/styles.ts` не змінено жодного файла
   * (`git diff --name-only 68bf642..HEAD -- src/styles/ src/tools/styles.ts`
   * порожній).
   */
  /*
   * 2026-08-27, ЧЕТВЕРТА ЗМІНА: 12021 → 12308, тобто +287 Б. Причина — КОД, а
   * НЕ документ, і це важливо, бо перша діагноза була протилежна й хибна.
   *
   * Коміт `65c6d90` дописав одне речення до спільного
   * `UNUSED_STYLE_CAVEAT_TEXT` (`src/styles/types.ts`) — «AND ON DELETING A
   * BRANCH: …». Виміряно: 286 Б UTF-8, 287 із провідним пробілом. Дельта
   * СТАЛА в обох тестах, бо застереження їде ОДИН раз на відповідь, у
   * `caveats.tablesAndFootnotes` (`src/tools/styles.ts`), а не на кожну
   * знахідку — рівно та ознака структурного додатку, що описана вище.
   *
   * ЦИТАТА ПРО `git diff` У ЗАПИСІ ВІД 2026-08-25 ПРОТУХЛА, І САМЕ ВОНА
   * ЗБИЛА ПЕРШУ ДІАГНОЗУ. Вона записує ПЕРЕВІРКУ, зроблену того дня, а не
   * сталий факт: за два дні `src/styles/` і `src/tools/styles.ts` зачепили
   * два коміти (`65c6d90`, `bdbadd6`). Датований вимір у коментарі
   * протухає так само, як датований вимір деінде — перезапускайте команду,
   * а не цитуйте її результат.
   *
   * Друга хибна гадка, варта запису: «числа прив'язані до живого документа
   * користувача, а він змінився». Неможливо ЗА ПОБУДОВОЮ — `beforeAll`
   * кличе `makeLayoutFixtureDoc()`, тобто міряється фікстура, зібрана з
   * нуля, і відкриті видання на ці числа не впливають ніяк.
   *
   * ДОВЕДЕНО ВИКОНАННЯМ, А НЕ АРИФМЕТИКОЮ. Речення тимчасово відкотили до
   * форми перед `65c6d90` і прогнали цей файл: обидві рівності сіли рівно на
   * 12021 і на другу стару базу, 14/14 зелених. Повернули текст — знову 12308.
   *
   * Перша спроба доказу дала 12022, тобто на байт БІЛЬШЕ за історичне число,
   * і цей байт варто назвати: `65c6d90` дописав не лише речення (286 Б), а й
   * ПРОБІЛ перед ним. Відкат, що прибирає саме речення, лишає пробіл і не
   * відтворює старої бази. 286 + 1 = 287.
   *
   * РІВНІСТЬ ЛИШАЄТЬСЯ РІВНІСТЮ. Послабити до `toBeLessThan` означало б
   * сховати саме той дрейф, який ці числа й спіймали: `65c6d90` шанував
   * бюджет байтів у тексті знахідки (на нього є тест) — і тому пояснення
   * поїхало у спільне застереження, чий бюджет живе ЛИШЕ тут.
   */
  const bytes = bytesWithoutDocName(result.content[0]!.text, docName);
  expect(bytes).toBe(12308);
  expect(bytes).toBeLessThan(23_000);
});

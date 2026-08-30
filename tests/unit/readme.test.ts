import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Розділ README від заголовка до наступного заголовка того ж рівня.
 *
 * Заголовок шукається як РЯДОК ІЗ НАЗВОЮ, а не як точний префікс: у README є
 * емодзі перед словом («## 🧰 Tools»), і `indexOf("## Tools")` на такому
 * заголовку дає -1. Ослаблення тут немає — назва все одно мусить бути в рядку
 * заголовка другого рівня, а зникнення розділу так само валить перевірку.
 */
function section(title: string): string {
  const text = readFileSync(join(ROOT, "README.md"), "utf8");
  const head = new RegExp(`^## .*\\b${title.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\s*$`, "mu");
  const m = head.exec(text);
  expect(m, `у README немає розділу «${title}»`).not.toBeNull();
  const rest = text.slice(m!.index + m![0].length);
  const to = rest.indexOf("\n## ");
  return to === -1 ? rest : rest.slice(0, to);
}

/*
 * СТОРОЖ ПЕРЕЛІКУ ІНСТРУМЕНТІВ — і його не було, хоча всі вважали, що є.
 *
 * Фаза 6 додала `pagination_audit` і НЕ дописала його в таблицю README; це
 * протрималось цілу фазу й знайшлось аж на Задачі 14 Фази 7, коли туди прийшли
 * дописувати `pagination_apply`. Помилка тиха за побудовою: README читає людина,
 * а не прогін, тож зникнення рядка нічого не валить.
 *
 * Джерело правди — САМ КОД: перелік будується з `server.registerTool("…"` у
 * `src/tools/*.ts`, а не з переписаного від руки масиву. Переписаний масив
 * повторив би ту саму помилку на один рівень глибше — він так само старів би
 * мовчки.
 */
describe("README, таблиця «Інструменти»", () => {
  /** Назви, зареєстровані в коді. Читаємо з файлів, бо імпорт потяг би SDK. */
  function registeredToolNames(): string[] {
    const dir = join(ROOT, "src", "tools");
    const names: string[] = [];
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".ts")) continue;
      const src = readFileSync(join(dir, file), "utf8");
      for (const m of src.matchAll(/registerTool\(\s*"([a-z0-9_]+)"/g)) names.push(m[1]!);
    }
    return names.sort();
  }

  it("у коді знайдено інструменти — інакше перевірка нижче була б порожньою", () => {
    /* Негативний контроль до самого приладу: регексп, що перестав збігатися,
     * зробив би наступний тест зеленим на порожньому переліку. */
    expect(registeredToolNames().length).toBeGreaterThan(10);
  });

  it("кожен зареєстрований інструмент названий у розділі «Tools»", () => {
    const listed = section("Tools");
    const missing = registeredToolNames().filter((n) => !listed.includes(`\`${n}\``));
    expect(missing, `у таблиці README немає: ${missing.join(", ")}`).toEqual([]);
  });
});

/*
 * I2 (фінальна рецензія): README стверджував, що corrections_apply — єдиний
 * інструмент, який пише в документ. Це неправда: indesign_run_jsx виконує
 * довільний ExtendScript і пише без копії, без звірки назви документа й без
 * звірки тексту. І сказано це було саме в розділі «Модель безпеки» — тобто
 * там, де користувач шукає межі довіри.
 */
describe("README, розділ «Safety model» (I2)", () => {
  const safety = () => section("Safety model");

  it("не стверджує, що корекційний інструмент — єдиний, хто пише в документ", () => {
    expect(safety()).not.toMatch(/the only (write )?tool[^.]*?writes/i);
  });

  it("називає indesign_run_jsx як інструмент без запобіжників", () => {
    const s = safety();
    expect(s).toMatch(/indesign_run_jsx/);
    expect(s).toMatch(/no backup/i);
    expect(s).toMatch(/deliberate/i);
  });

  it("решта розділу не послаблена: чотири запобіжники й три виміряні факти на місці", () => {
    const s = safety();
    for (const claim of [
      "_backups/",
      "modal dialogs",
      "One undo step",
      "text check right before each write",
      "locked layer does NOT protect",
      "rotates automatically",
      "backupRotationError",
      "must already be saved to disk",
    ]) {
      expect(s, `зникло твердження «${claim}»`).toContain(claim);
    }
  });
});

/**
 * Назви всіх зареєстрованих інструментів — з КОДУ, а не зі списку поруч.
 * Список, який ведуть руками, і є те, що застаріває.
 */
function registeredTools(): string[] {
  const dir = join(ROOT, "src", "tools");
  const names: string[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".ts")) continue;
    const text = readFileSync(join(dir, file), "utf8");
    for (const m of text.matchAll(/registerTool\(\s*"([A-Za-z0-9_]+)"/g)) names.push(m[1]!);
  }
  return names.sort();
}

/*
 * Борг, знайдений рецензією preflight: README не мав НІ `preflight_document`,
 * НІ `pagination_audit` (той відстав ще з Фази 6), а `docs/ПРОДОВЖИТИ-ТУТ.md`
 * казав «Шістнадцять», коли інструментів було сімнадцять. Обидва переліки
 * ведуться руками, тож обидва застарівали мовчки — рівно доти, доки ніхто не
 * звірить їх із кодом. Тепер звіряє тест.
 */
describe("переліки інструментів не можуть застаріти мовчки", () => {
  it("кожен зареєстрований інструмент є в таблиці README", () => {
    const tools = registeredTools();
    expect(tools.length).toBeGreaterThan(0);
    const table = section("Tools");
    for (const name of tools) {
      expect(table, `у таблиці README немає «${name}»`).toContain(`\`${name}\``);
    }
  });

  it("кожен зареєстрований інструмент згаданий у docs/reference.md", () => {
    /*
     * README тричі відсилає до reference.md «за повними правилами», а до
     * 2026-08-26 дев'ять із двадцяти трьох інструментів не згадувалися там
     * ЖОДНОГО разу — зокрема всі п'ять найновіших родин аудиту. Відсилання
     * вело в документ, де про інструмент не було нічого.
     *
     * Перевіряємо саме ЗГАДКУ, а не якість опису: ґард, що вимагав би
     * розділу на кожен інструмент, диктував би структуру документа. Але
     * зникнення назви з довідки він ловить, а саме так вона й відстає.
     */
    const ref = readFileSync(join(ROOT, "docs", "reference.md"), "utf8");
    for (const name of registeredTools()) {
      expect(ref, `docs/reference.md не згадує «${name}»`).toContain(name);
    }
  });

  it("таблиця README не називає інструментів, яких немає в коді", () => {
    const tools = new Set(registeredTools());
    const table = section("Tools");
    for (const m of table.matchAll(/^\|\s*`([A-Za-z0-9_]+)`/gm)) {
      expect(tools.has(m[1]!), `README називає неіснуючий інструмент «${m[1]}»`).toBe(true);
    }
  });

  /*
   * ТУТ БУВ ҐАРД НА docs/ПРОДОВЖИТИ-ТУТ.md — ДОКУМЕНТ ВИДАЛЕНО 2026-08-26.
   *
   * Це був сеансовий журнал передачі, писаний довкола однієї приватної
   * книжки; разом з рештою наративних журналів він пішов із репозиторію
   * перед публікацією. Ґард знято РАЗОМ із його предметом, а не послаблено:
   * тест, який читає неіснуючий файл, довелося б або зробити умовним, або
   * вказати кудись іще — і в обох випадках він перестав би що-небудь
   * стерегти, лишаючись зеленим.
   *
   * Перелік інструментів у README стереже перевірка вище, і вона лишається.
   */
});

/*
 * ВНУТРІШНІ ПОСИЛАННЯ README — і чому вони тут явні.
 *
 * Заголовки мають емодзі, а як GitHub будує з них якір — питання, на яке
 * різні відповіді виглядають однаково правдоподібно (чи лишається провідний
 * дефіс, чи виживає селектор варіації U+FE0F). Здогад тут коштував би битого
 * посилання на видноті першої сторінки.
 *
 * Тому цілі посилань — ЯВНІ `<a id="…">` перед заголовком: вони не залежать
 * від жодного правила слагування. Тест лише тримає їх у парі.
 */
describe("README, внутрішні посилання", () => {
  const readme = () => readFileSync(join(ROOT, "README.md"), "utf8");

  it("кожен якір `](#…)` має явну ціль `<a id=…>`", () => {
    const text = readme();
    const targets = new Set(
      [...text.matchAll(/<a id="([^"]+)"><\/a>/gu)].map((m) => m[1]!),
    );
    const links = [...text.matchAll(/\]\(#([^)]+)\)/gu)].map((m) => m[1]!);
    expect(links.length, "у README не лишилось внутрішніх посилань").toBeGreaterThan(0);
    const broken = links.filter((l) => !targets.has(l));
    expect(broken, `нема цілі для: ${broken.join(", ")}`).toEqual([]);
  });
});

/*
 * README КАЖЕ: «кожен аудит повідомляє, чого він НЕ перевірив». Це не гасло, а
 * твердження про код — і саме тому воно тут під вартою.
 *
 * Твердження такого роду старіє найтихіше: досить додати двадцять четвертий
 * інструмент без поля покриття, і перше речення README стає неправдою, якої
 * ніхто не помітить — бо README читає людина, а не прогін. Той самий клас, що
 * зниклий рядок таблиці інструментів вище.
 *
 * Перевіряємо НАЯВНІСТЬ поля, а не його якість: ґард, що вимагав би певного
 * формулювання, диктував би текст. Але інструмент, який мовчки віддає саму
 * лише знахідку, він ловить.
 */
describe("обіцянка README про покриття тримається кодом", () => {
  /** Поля, якими інструмент називає непокрите. */
  const COVERAGE = /caveat|notMeasured|notCompared|skipped|unread|unmeasurable|missingStyles|rulesDisabled/u;

  it("кожен файл із аудитом має поле, що називає непокрите", () => {
    const dir = join(ROOT, "src", "tools");
    const offenders: string[] = [];
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".ts")) continue;
      const src = readFileSync(join(dir, file), "utf8");
      const audits = [...src.matchAll(/registerTool\(\s*"([a-z0-9_]*(?:audit|preflight_document|map))"/gu)];
      if (audits.length === 0) continue;
      if (!COVERAGE.test(src)) offenders.push(`${file} (${audits.map((m) => m[1]).join(", ")})`);
    }
    expect(offenders, `аудит без поля покриття: ${offenders.join("; ")}`).toEqual([]);
  });

  it("негативний контроль: регексп аудитів справді щось знаходить", () => {
    /* Інакше перевірка вище зеленіла б на порожньому переліку файлів. */
    const dir = join(ROOT, "src", "tools");
    const found = readdirSync(dir).filter(
      (f) => f.endsWith(".ts") && /registerTool\(\s*"[a-z0-9_]*audit"/u.test(readFileSync(join(dir, f), "utf8")),
    );
    expect(found.length).toBeGreaterThan(5);
  });
});

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  ALLOWED,
  DENIED_DIGESTS,
  detectPrivate,
  digest,
  normalise,
  phrases,
  REPEATED_LETTER,
  REPEATED_LETTER_ALL,
  tokenAt,
} from "./support/private-line.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/*
 * ЦЕЙ ІНСТРУМЕНТ РОЗРАХОВАНО НА БАГАТО КНИЖОК, ТОЖ ЖОДНОЇ КОНКРЕТНОЇ В НЬОМУ
 * БУТИ НЕ МАЄ.
 *
 * До 2026-08-26 у репозиторії жили: редакційне досьє клієнтської книжки з
 * іменами третіх осіб, справжній ISBN видання як стала в `src/`, пошта й
 * домашній шлях власника у 17 файлах, словниковий оракул, зібраний зі
 * словника ОДНІЄЇ книжки, і 66 файлів сеансових журналів довкола одного
 * приватного рукопису. Нічого з цього не потрібне для роботи інструмента —
 * воно просто накопичилося, бо не було місця, куди таке класти, і не було
 * нічого, що б про це нагадало.
 *
 * Тепер місце є: тека `private/`, яку `.gitignore` не пускає в коміт. А цей
 * файл — те, що нагадує. Він читає СПИСОК ВІДСТЕЖУВАНИХ ФАЙЛІВ у git (не обхід
 * диска: саме відстежувані файли й поїдуть у публічний репозиторій) і падає,
 * щойно в них з'явиться щось, що називає конкретну людину, видання чи машину.
 *
 * Чому саме так, а не «уважно перечитати перед публікацією»: перечитування —
 * це перевірка, яку виконує людина один раз, а забуває назавжди. Тут вона
 * виконується на кожному прогоні набору.
 *
 * МЕЖА, НАЗВАНА ВГОЛОС: ІМЕН ЦІ ВОРОТА НЕ ЛОВЛЯТЬ І НЕ МОЖУТЬ.
 *
 * Шлях, пошта, ISBN і тека диска мають ФОРМУ, за якою їх видно без словника.
 * Ім'я людини форми не має: «Мар'яна» і «Дар'я» для regexp однакові.
 * Спіймано на живому 2026-08-27 — уже ПІСЛЯ чистки: приклади з апострофом,
 * дописані в коментар і тест цієї ж сесії, несли ім'я авторки книжки, і
 * ворота пропустили їх, бо пропустити мусили.
 *
 * Тож для імен лишається людське правило, а не автоматика: у прикладах беруть
 * вигадані імена. Розширювати ворота словником справжніх імен не можна — він
 * сам став би переліком приватних даних у репозиторії.
 */

/** Файли, які git справді відстежує, — саме вони й поїдуть у публічний репозиторій. */
function trackedFiles(): string[] {
  let out: Buffer;
  try {
    out = execFileSync("git", ["ls-files", "-z"], {
      cwd: ROOT,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (e) {
    /*
     * ВІДМОВЛЯЄМОСЬ ГУЧНО, А НЕ ПРОПУСКАЄМО.
     *
     * Без git списку відстежуваних файлів не існує, тож перевіряти нема що.
     * Пропуск (`it.skip`) був би тут найгіршим із виходів: набір лишався б
     * зеленим і читався б як «приватного немає», хоча не подивилися взагалі.
     * Розпакований тарбол чи копія без `.git` — саме той випадок.
     */
    throw new Error(
      "ворота приватності не можуть працювати без git: `git ls-files` не вдався " +
        `у ${ROOT}. Це не «чисто» — це «не перевірено». ` +
        `Запускайте набір у git-репозиторії. Причина: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  return out.toString("utf8").split("\0").filter(Boolean);
}

/*
 * ЦІ ДВА ФАЙЛИ СЕБЕ НЕ ЧИТАЮТЬ, І ЦЕ НЕ ПОБЛАЖКА.
 *
 * Кожен МУСИТЬ містити взірці приватного — інакше нічим довести, що regexp'и
 * ловлять бодай щось (див. «позитивний близнюк» унизу). Скануючи їх, ворота
 * падали б завжди й на власних прикладах, тож єдиний спосіб їх зазеленити був
 * би прибрати докази.
 *
 * Список виріс 2026-08-28 із одного файла до трьох, і кожен рядок — ПІСЛЯ
 * падіння, а не наперед:
 *
 *   - ворота повідомлень комітів несуть власні позитивні близнюки, і ворота
 *     спіймали всі дев'ять;
 *   - спільний модуль детекторів містить рядки, які СТЕРЕЖЕ, — інакше він не
 *     міг би їх стерегти. Ловити `GoogleDrive-` у визначенні правила про
 *     `GoogleDrive-` означає вимагати, щоб правило себе не називало.
 *
 * Виняток лишається вузьким: три файли, названі шляхами, а не шаблон на теку.
 * Шаблон `tests/unit/*-gate.test.ts` зняв би варту з усіх майбутніх воріт
 * гуртом, зокрема з тих, що взірців не несуть і ховатися не мають права.
 *
 * ЦІНА НАЗВАНА: модуль детекторів лишається поза вартою, тож приватне,
 * дописане САМЕ В НЬОГО, ворота не побачать. Він малий і не містить даних —
 * самі правила; але це обмін, а не безкоштовність.
 */
const SELF = new Set([
  "tests/unit/privacy-gate.test.ts",
  "tests/unit/commit-message-gate.test.ts",
  "tests/unit/support/private-line.ts",
]);

/* Двійкові й згенеровані файли читати як текст сенсу немає. */
const SKIP_EXT = /\.(png|jpg|jpeg|gif|pdf|indd|idml|zip|woff2?|ttf|otf|ico)$/iu;

/* Детектори переїхали у спільний модуль — див. `support/private-line.ts`. */

interface Hit {
  file: string;
  line: number;
  what: string;
  text: string;
}

function scan(): Hit[] {
  const hits: Hit[] = [];
  for (const file of trackedFiles()) {
    if (SELF.has(file)) continue;
    if (SKIP_EXT.test(file)) continue;
    let body: string;
    try {
      body = readFileSync(join(ROOT, file), "utf8");
    } catch {
      continue; /* двійкове або зникле — не наша справа */
    }
    body.split("\n").forEach((raw, i) => {
      for (const h of detectPrivate(raw, file)) {
        hits.push({ file, line: i + 1, what: h.what, text: h.text });
      }
    });
  }
  return hits;
}

describe("у відстежуваних файлах немає приватних даних", () => {
  const tracked = trackedFiles();

  it("список відстежуваних файлів узагалі не порожній", () => {
    /* Негативний контроль на прилад: якби `git ls-files` мовчки віддав
     * порожньо (не той каталог, немає git), кожна перевірка нижче зеленіла б
     * на нулі файлів — рівно та «перевірка, що не може впасти», проти якої
     * цей файл і написано. */
    expect(tracked.length).toBeGreaterThan(100);
  });

  it("прилад справді читає вміст, а не самі імена файлів", () => {
    /* Другий контроль: підтверджує, що бодай один відстежуваний файл
     * прочитався й має непорожній текст. */
    const readable = tracked.filter((f) => !SKIP_EXT.test(f));
    expect(readable.length).toBeGreaterThan(50);
    expect(readFileSync(join(ROOT, "package.json"), "utf8").length).toBeGreaterThan(0);
  });

  it("ні домашніх шляхів, ні пошти, ні ISBN, ні чужого Drive", () => {
    const hits = scan();
    const report = hits
      .slice(0, 40)
      .map((h) => `  ${h.file}:${h.line} — ${h.what}\n      ${h.text}`)
      .join("\n");
    expect(
      hits,
      hits.length === 0
        ? ""
        : `знайдено приватне у відстежуваних файлах (${hits.length}):\n${report}\n\n` +
          "Такому місце в private/ — її не комітять. У configs/ лишаються лише синтетичні приклади.",
    ).toEqual([]);
  });

  it("ПОЗИТИВНИЙ БЛИЗНЮК: прилад ловить кожен із чотирьох взірців", () => {
    /* Без цього ворота могли б мовчати не тому, що чисто, а тому, що regexp
     * не збігається ні з чим узагалі. Взірці навмисно НЕ лежать у файлі на
     * диску — інакше ворота впали б самі на собі. */
    const samples = [
      "/Users/somebody/Design/книжка.indd",
      "editor@realpublisher.ua",
      "ISBN 978-617-0000-11-2",
      "GoogleDrive-someone@gmail.com/My Drive",
    ];
    const patterns = [
      /\/Users\/[A-Za-z0-9._-]+/u,
      /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/u,
      /97[89][-\s‐‑–]\d[\d\s\-‐‑–]{7,}\d/u,
      /GoogleDrive-(?!designer@example\.com)/u,
    ];
    samples.forEach((s, i) => {
      expect(patterns[i]!.test(s), `взірець ${i + 1} не спійманий: ${s}`).toBe(true);
    });
    /* І дзеркально: дозволені форми НЕ мають ловитися. */
    expect(ALLOWED.placeholderHome.test("/Users/designer/x")).toBe(true);
    /* Заповнювач у кінці рядка й у лапках — теж законні форми. */
    expect(ALLOWED.placeholderHome.test("/Users/name")).toBe(true);
    expect(ALLOWED.placeholderHome.test('"/Users/you/MCP"')).toBe(true);
    /* А ось справжня домівка, що ПОЧИНАЄТЬСЯ зі слова-заповнювача, — ні.
     * Спіймано мутацією: доти `\b` пускав її. */
    expect(ALLOWED.placeholderHome.test("/Users/someone-real/secret")).toBe(false);
    expect(ALLOWED.placeholderHome.test("/Users/username/secret")).toBe(false);
    expect(ALLOWED.exampleMailHosts.test("designer@example.com")).toBe(true);
  });

  it("зведення форми: NFD і percent-кодування більше не ховають рядок", () => {
    /* Саме так друге видання пережило й чистку, і перші ворота: назва лежала
     * в NFD, тож із regexp не збігалася жодна її буква з діакритикою. */
    const РОЗКЛАДЕНЕ = "Укра\u0456\u0308нською";
    const СКЛАДЕНЕ = "Укра\u0457нською";
    expect(РОЗКЛАДЕНЕ).not.toBe(СКЛАДЕНЕ);
    expect(normalise(РОЗКЛАДЕНЕ)).toBe(СКЛАДЕНЕ);

    expect(normalise("/My%20Drive/%D0%9A%D0%BD%D0%B8%D0%B3%D0%B0.indd")).toBe(
      "/My Drive/Книга.indd",
    );

    /* Некоректний відсоток не має валити прилад — рядок лишається як є. */
    expect(normalise("знижка 50% на все")).toBe("знижка 50% на все");
  });

  it("ПОЗИТИВНИЙ БЛИЗНЮК: обидві перевірки на назву видання ловлять взірець", () => {
    /* Форма: довгий ряд однакових літер. Взірець вигаданий — рівно тому, що
     * перевірка стоїть на ФОРМІ, а не на конкретній назві. */
    expect(REPEATED_LETTER.test("Куууууурочка.indd")).toBe(true);
    /* І не ловить звичайного повтору: п'ять літер — це ще не назва. */
    expect(REPEATED_LETTER.test("ааааа")).toBe(false);

    /*
     * ЛАТИНКА — ОКРЕМИЙ ДОКАЗ, А НЕ НАСЛІДОК ПОПЕРЕДНЬОГО.
     *
     * Кириличний взірець вище зеленітиме й тоді, коли клас звузять назад до
     * `[\u0400-\u04FF]`, — тобто саме та вада, яку закрито 2026-08-27, стала б
     * тихо можливою знову. Взірець латинкою навмисно дзеркалить кириличний
     * (курочка ↔ chicken) і так само вигаданий.
     */
    expect(REPEATED_LETTER.test("Chiiiiiicken.indd")).toBe(true);
    expect(REPEATED_LETTER.test("aaaaa")).toBe(false);

    /*
     * ДВА ВИМІРЯНІ ХИБНІ СПРАЦЮВАННЯ — І ДОКАЗ, ЩО ВИНЯТОК НЕ З'ЇВ ПЕРЕВІРКИ.
     *
     * Виняток судить про ТОКЕН, тож назва поруч із кольором у тому самому
     * рядку лишається спійманою. Без цього контролю `hexLiteral` міг би
     * розростись до «рядок із кольором не перевіряємо» й лишитись зеленим.
     */
    const колір = "  --surface:#FFFFFF;";
    expect(ALLOWED.hexLiteral.test(tokenAt(колір, колір.search(REPEATED_LETTER)))).toBe(true);
    const псевдонім = '"url": "https://github.com/sponsors/Brooooooklyn"';
    expect(
      ALLOWED.upstreamHandle.has(tokenAt(псевдонім, псевдонім.search(REPEATED_LETTER))),
    ).toBe(true);

    const обидва = "--surface:#FFFFFF; /* Chiiiiiicken.indd */";
    const токени = [...обидва.matchAll(REPEATED_LETTER_ALL)].map((m) =>
      tokenAt(обидва, m.index ?? 0),
    );
    expect(токени).toContain("#FFFFFF");
    expect(
      токени.some((t) => !ALLOWED.hexLiteral.test(t) && !ALLOWED.upstreamHandle.has(t)),
      `виняток проковтнув увесь рядок: ${JSON.stringify(токени)}`,
    ).toBe(true);

    /* Відбиток: механізм показано на СВОЄМУ зразку, а не на записі зі списку —
     * інакше довелося б написати тут саму назву, якої список і уникає. */
    const зразок = "вигадана назва видання";
    const свій = new Set([digest(зразок)]);
    const рядок = `docName: "у файлі стоїть вигадана назва видання 2022.indd"`;
    expect(phrases(рядок).some((ph) => свій.has(digest(ph)))).toBe(true);
    expect(phrases("нічого спільного").some((ph) => свій.has(digest(ph)))).toBe(false);

    /* Список не має тихо спорожніти: тоді перевірка 6 зеленіла б завжди. */
    expect(DENIED_DIGESTS.size).toBe(2);
  });
});

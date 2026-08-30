import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { runJsx } from "../../src/bridge/runner.js";

/**
 * Створює новий документ InDesign із відомим вмістом: два story, абзацний і
 * символьний стилі, навмисний overset у другому фреймі, таблиця з одним рядком.
 * Повертає назву документа.
 */
export async function makeFixtureDoc(): Promise<string> {
  return runJsx<string>("__fixture_make", {});
}

export async function closeFixtureDoc(name: string): Promise<void> {
  await runJsx("__fixture_close", { name });
}

/**
 * Назви, під якими фікстурні обробники зберігають документ на диск, — рівно
 * ті чотири, що стоять у `doc.save(new File(...))` у `_fixtures.jsx`. Список
 * НАЗВАНИЙ, а не виведений із чогось: прибирання чужого документа — саме те,
 * чого ці тести не мають права зробити ніколи, тож множина мусить бути
 * скінченною і перечитуваною очима.
 */
export const TEMP_FIXTURE_DOC_NAMES = [
  "fixture.indd",
  "composition-fixture.indd",
  "pagination-fixture.indd",
  "helper-chain.indd",
];

/** Префікси тек `mkdtemp`, у які інтеграційні тести кладуть ці фікстури. */
export const TEMP_FIXTURE_DIR_PREFIXES = ["idmcp-", "phase8-"];

/*
 * Два написання одного кореня: `mkdtemp` віддає `/var/folders/…`, а InDesign
 * у `doc.fullName` — `/private/var/folders/…` (виміряно 2026-08-16). Порівняння
 * лише з одним із них мовчки не збігалося б ніколи.
 */
const TEMP_ROOTS = Array.from(new Set([tmpdir(), realpathSync(tmpdir())])).map((root) =>
  root.endsWith("/") ? root : `${root}/`,
);

export interface OpenDoc {
  name: string;
  fullName: string | null;
}

/**
 * ЧИ ЦЕ ЗАБУТА ФІКСТУРА — і три умови тут стоять разом навмисно.
 *
 * Робочий документ користувача (196 сторінок у Google Drive) не проходить
 * ЖОДНОЇ з них, і навіть однойменний `fixture.indd`, що лежить не в
 * тимчасовій теці, не проходить другої. Ціна помилки несиметрична: не
 * закрити зайве — це сміття в списку документів, закрити зайве — це чужа
 * робота, тож умови складаються, а не додаються.
 */
export function isStrayFixtureDoc(name: string, fullName: string | null): boolean {
  if (fullName === null) return false;
  if (TEMP_FIXTURE_DOC_NAMES.indexOf(name) === -1) return false;
  if (!TEMP_ROOTS.some((root) => fullName.startsWith(root))) return false;
  const dir = basename(dirname(fullName));
  return TEMP_FIXTURE_DIR_PREFIXES.some((prefix) => dir.startsWith(prefix));
}

/** Відкриті документи так, як їх бачить сам InDesign. */
export async function listOpenDocs(): Promise<OpenDoc[]> {
  const status = await runJsx<{ documents: OpenDoc[] }>("status", {});
  return status.documents;
}

/**
 * Закриває документ за шляхом — обидва написання кореня одразу (див.
 * `TEMP_ROOTS`). Повертає кількість закритих: нуль означає «такого документа
 * не відкрито», а не помилку.
 */
export async function closeFixtureDocAtPath(path: string): Promise<number> {
  const paths = Array.from(new Set([path, safeRealpath(path)]));
  const res = await runJsx<{ closed: { name: string; path: string }[] }>("__fixture_close_path", {
    paths,
  });
  return res.closed.length;
}

/** realpath, який не падає на вже видаленій теці — саме так і буває в afterEach. */
function safeRealpath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * Прибирає ЗАБУТІ фікстури — ті, що лишились відкритими від попереднього
 * прогону або від прогону, який урвався. Повертає їх перелік, щоб викликач
 * міг про них ГОЛОСНО сказати: тихе прибирання ховало б причину, а вона
 * щоразу різна.
 */
export async function closeStrayFixtureDocs(): Promise<OpenDoc[]> {
  const stray = (await listOpenDocs()).filter((d) => isStrayFixtureDoc(d.name, d.fullName));
  for (const doc of stray) {
    await runJsx("__fixture_close_path", { paths: [doc.fullName] });
  }
  return stray;
}

/**
 * Створює фікстуру пагінації в тимчасовій теці й повертає назву документа.
 *
 * ЧОМУ ЦЕ НЕ ПРОСТО `runJsx`. Обробник зберігає документ на диск ОСТАННІМ
 * кроком, тобто «виклик не повернувся» ≠ «документа немає»: якщо міст здався
 * за таймаутом уже після `doc.save`, документ лишається відкритим, а
 * викликач НЕ ЗНАЄ його назви. `afterEach` з умовою `if (docName)` тоді не
 * закриває НІЧОГО — це єдиний шлях у цих файлах, де по документу не
 * робиться жодної спроби закриття (доведено виконанням: vitest 3.2.7 виконує
 * `afterEach` і після падіння `beforeEach`, але закривати йому нічого).
 *
 * Тека своя, назва файла відома наперед — тож прибрати можна ТОЧНО, не
 * вгадуючи назви документа.
 */
export async function makePaginationFixtureDoc(dir: string): Promise<string> {
  try {
    const made = await runJsx<{ docName: string }>("__fixture_make_pagination", { dir }, {
      timeoutMs: 180_000,
    });
    return made.docName;
  } catch (err) {
    await closeFixtureDocAtPath(join(dir, "pagination-fixture.indd")).catch(() => {
      /* Причина падіння — вище; невдале прибирання її не заступає. */
    });
    throw err;
  }
}

/**
 * Фікстура верстки Фази 4: 7 сторінок (НЕПАРНА кількість; Задача 7 розширила
 * з 5, додавши розворот 6-7 для одностороньої батьківської), батьківська з
 * фоліо, перевизначений і видалений елементи батьківської, сторінка без
 * батьківської, одностороння батьківська, абзаци з перевизначеннями в
 * кожній групі властивостей.
 */
export async function makeLayoutFixtureDoc(): Promise<string> {
  return runJsx<string>("__fixture_make_layout", {});
}

interface StatusForAssert {
  activeDocument: string | null;
}

/**
 * Захисний хелпер: у користувача під час запуску цих тестів може бути відкритий
 * реальний робочий документ. Ми НЕ маємо права, щоб помилка в тесті випадково
 * торкнулася його. Ця функція перевіряє через живий виклик до InDesign, що
 * активний документ — саме очікувана фікстура, і кидає зрозумілу помилку,
 * якщо ні. Викликати перед будь-якою перевіркою, що спирається на активний
 * документ (усі обробники читання в цій задачі працюють через
 * IDMCP.activeDoc(), тобто завжди неявно читають активний документ).
 */
export async function assertFixtureActive(name: string): Promise<void> {
  const status = await runJsx<StatusForAssert>("status", {});
  if (status.activeDocument !== name) {
    throw new Error(
      `Очікували активним документ фікстури "${name}", а активний — ` +
        `"${status.activeDocument}". Тест зупинено, щоб не торкнутися чужого документа.`,
    );
  }
}

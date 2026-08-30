import { describe, expect, it } from "vitest";
import { callTool, type ToolBox, type ToolResult } from "../../src/cli/collect.js";
import { FAMILY_NAMES, type AuditConfig } from "../../src/cli/config/schema.js";
import { ConfigError, reconcileWithDocument } from "../../src/cli/config/validate.js";
import { openSession, SessionError } from "../../src/cli/run/session.js";

/*
 * ЗАДАЧА G — CLI мусить міряти той документ, до якого приєднався.
 *
 * Дефект знайдено ДРУГИМ ЖИВИМ ПРОГОНОМ 2026-08-16, а не тестом, і це тут
 * головне: 2390 тестів були зелені, бо кожна фікстура й обидва попередні
 * прогони мали РІВНО ОДИН відкритий документ. Сеансовий шар обирає документ
 * за нормалізованим шляхом із конфіга, вимірювальний (`IDMCP.activeDoc()`)
 * читає `app.activeDocument`; на одному документі ці двоє збігаються, на
 * двох — тихо розходяться. У верстальника відкрито кілька документів
 * ЗАВЖДИ, тож це звичайний стан, а не крайовий випадок.
 *
 * Стан на момент відмови, виміряний зондом:
 *   спереду: Cover_260812_429.5x226_cut463.5x260.indd — 1 стор., 2 стилі
 *   ціль:    Book 260816-1250.indd              — 196 стор., 56 стилів
 * Прогін НАЗВАВ книжку правильно й ВІДМОВИВ на стилі «Колонтитул v1», якого
 * немає в ОБКЛАДИНЦІ; у книжці цей стиль несуть 99 абзаців.
 *
 * Тому фікстура тут — ДВА документи, цільовий НЕ активний, і в чужому немає
 * оголошених стилів. На одному документі цей блок не довів би нічого.
 */

const ОБКЛАДИНКА = "Cover_260812_429.5x226_cut463.5x260.indd";
const КНИЖКА = "Book 260816-1250.indd";
/** Третій документ — щоб перемикання мало куди піти НЕ туди. */
const ЧЕРНЕТКА = "Чернетка.indd";
/* Тотожності документів у фейку — навмисно НЕ назви (див. ФейковийДок.id). */
const ID_ОБКЛАДИНКА = "обкладинка";
const ID_КНИЖКА = "книжка";
const ID_ДВІЙНИК = "двійник";
const ID_ЧЕРНЕТКА = "чернетка";
const ШЛЯХ_ОБКЛАДИНКИ = `/тека/${ОБКЛАДИНКА}`;
const ШЛЯХ_КНИЖКИ = `/тека/${КНИЖКА}`;

interface ФейковийДок {
  /**
   * Стійка тотожність документа — те, чим InDesign розрізняє два відкриті
   * файли з ОДНАКОВОЮ назвою. Фейк мусить її мати: модель, що впізнає
   * документ за назвою, не здатна відтворити саме той клас вад, заради
   * якого цей файл написано.
   */
  id: string;
  name: string;
  fullName: string | null;
  modified: boolean;
  saved: boolean;
  /** Абзацні стилі саме ЦЬОГО документа — те, чим два документи й різняться. */
  paragraphStyles: string[];
}

interface СтанInDesign {
  документи: ФейковийДок[];
  /** `id` документа, що СПЕРЕДУ (НЕ назва). Скрипти цю клітинку мутують. */
  активний: string | null;
}

/**
 * Фейковий InDesign, у якому перемикання активного документа ПРАЦЮЄ так
 * само, як на живому рушії: `indesign_run_jsx` не повертає замокану
 * відповідь, а ВИКОНУЄ надісланий скрипт (`new Function`) проти моделі —
 * той самий прийом, яким уже перевіряється розгалуження `release()`
 * (`tests/unit/cli-session.test.ts`, блок R27). Мок «завжди слухняного»
 * середовища тут не годився б: він довів би лише, що ми кудись надіслали
 * рядок, а перевірити треба, що після надсилання спереду СТАВ інший
 * документ і що `doc_overview` після цього віддає стилі ІНШОГО документа.
 *
 * Два способи зіпсувати перемикання, і вони РІЗНІ:
 *   `слухаєтьсяПеремикання: false` — присвоєння ІГНОРУЄТЬСЯ мовчки (саме це
 *      припускав спек §6.1); спереду лишається той самий документ;
 *   `підміняє: {просили: дістали}` — присвоєння спрацьовує, але виводить
 *      наперед ІНШИЙ документ. Тільки в цьому разі є що повертати назад, і
 *      лише він перевіряє повернення на шляху відмови по-справжньому.
 * Обидва читання назад мусить упіймати.
 */
function зробитиInDesign(
  стан: СтанInDesign,
  {
    слухаєтьсяПеремикання = true,
    підміняє = {},
  }: { слухаєтьсяПеремикання?: boolean; підміняє?: Record<string, string> } = {},
): { box: ToolBox; стан: СтанInDesign; присвоєння: string[] } {
  /* Кожне ДОТИКАННЯ до app.activeDocument, навіть безрезультатне. Порожній
   * масив = прогін не чіпав стану користувача взагалі. */
  const присвоєння: string[] = [];

  function обгортка(д: ФейковийДок): Record<string, unknown> {
    return {
      /* Службове поле фейка: справжній Document його не має, жоден скрипт
       * його не читає — воно лише повертає присвоєному об'єктові його
       * тотожність, яку InDesign знає й без назви. */
      __id: д.id,
      isValid: true,
      name: д.name,
      saved: д.saved,
      fullName: д.fullName,
      modified: д.modified,
      close: () => undefined,
    };
  }

  /* Будується НА КОЖЕН виклик скрипта: `app.documents[i]` в ExtendScript —
   * індексований доступ, тож перелік мусить бути звичайними числовими
   * ключами, а стан «хто спереду» скрипт міняє під час виконання. */
  function сцена(): Record<string, unknown> {
    const перелік = стан.документи.map(обгортка);
    const documents: Record<string | number, unknown> = {
      length: перелік.length,
      itemByName(n: string): Record<string, unknown> {
        const д = стан.документи.find((x) => x.name === n);
        return д === undefined ? { isValid: false } : обгортка(д);
      },
    };
    перелік.forEach((d, i) => {
      documents[i] = d;
    });

    return {
      documents,
      get activeDocument(): Record<string, unknown> | undefined {
        const д = стан.документи.find((x) => x.id === стан.активний);
        return д === undefined ? undefined : обгортка(д);
      },
      set activeDocument(d: Record<string, unknown> | undefined) {
        const попрошено = String(d?.["name"]);
        присвоєння.push(попрошено); // сам факт дотику, ще до слухняності
        if (!слухаєтьсяПеремикання) return; // мовчазна відмова — і жодної помилки
        стан.активний = підміняє[попрошено] ?? String(d?.["__id"]);
      },
    };
  }

  const box: ToolBox = new Map();

  box.set("indesign_status", {
    handler: async (): Promise<ToolResult> => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            version: "21.5.1.73",
            documents: стан.документи.map((d) => ({
              name: d.name,
              fullName: d.saved ? d.fullName : null,
              modified: d.modified,
            })),
            activeDocument: стан.документи.find((d) => d.id === стан.активний)?.name ?? null,
          }),
        },
      ],
    }),
  });

  box.set("indesign_run_jsx", {
    handler: async (args): Promise<ToolResult> => {
      const script = String((args as { script?: string }).script ?? "");
      const SaveOptions = { NO: "NO" };
      // eslint-disable-next-line no-new-func -- навмисне виконання надісланого JSX у пісочниці
      const fn = new Function("app", "SaveOptions", `var __result = null;\n${script}\nreturn __result;`);
      return { content: [{ type: "text", text: JSON.stringify(fn(сцена(), SaveOptions)) }] };
    },
  });

  /* Ключове: `doc_overview` віддає стилі АКТИВНОГО документа — так само, як
   * справжній (`IDMCP.activeDoc()`, `src/jsx/inspect.jsx:32-33`). Саме тут
   * і розходились два шари. */
  box.set("doc_overview", {
    handler: async (): Promise<ToolResult> => {
      const д = стан.документи.find((x) => x.id === стан.активний);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              // `name` — того документа, який ПРОЧИТАЛИ (`src/jsx/inspect.jsx:68`).
              name: д?.name ?? null,
              paragraphStyles: д?.paragraphStyles ?? [],
              characterStyles: [],
            }),
          },
        ],
      };
    },
  });

  return { box, стан, присвоєння };
}

function двадокументнийСтан(): СтанInDesign {
  return {
    активний: ID_ОБКЛАДИНКА, // спереду — ЧУЖИЙ документ, як і було на прогоні
    документи: [
      {
        id: ID_ОБКЛАДИНКА,
        name: ОБКЛАДИНКА,
        fullName: ШЛЯХ_ОБКЛАДИНКИ,
        modified: false,
        saved: true,
        paragraphStyles: ["[Basic Paragraph]", "Обкладинка Назва"],
      },
      {
        id: ID_КНИЖКА,
        name: КНИЖКА,
        fullName: ШЛЯХ_КНИЖКИ,
        modified: true,
        saved: true,
        paragraphStyles: ["[Basic Paragraph]", "Колонтитул v1", "Назва розділу"],
      },
    ],
  };
}

/** Шлях двійника — та сама НАЗВА файлу, зовсім інша тека. */
const ШЛЯХ_ДВІЙНИКА = `/зовсім/інша/тека/${КНИЖКА}`;

/**
 * Стан із ДВІЙНИКОМ: два відкриті документи з однаковою назвою з різних
 * тек. Двійник стоїть у переліку ПЕРШИМ — саме його віддасть
 * `app.documents.itemByName`, бо назва не є тотожністю (R10).
 */
function двійниковийСтан(): СтанInDesign {
  const стан = двадокументнийСтан();
  стан.документи.unshift({
    id: ID_ДВІЙНИК,
    name: КНИЖКА,
    fullName: ШЛЯХ_ДВІЙНИКА,
    modified: false,
    saved: true,
    paragraphStyles: ["[Basic Paragraph]"],
  });
  return стан;
}

/** Конфіг, що називає «Колонтитул v1» — той самий стиль, що й на прогоні. */
function конфіг(): AuditConfig {
  return {
    edition: { title: "Book", docPath: ШЛЯХ_КНИЖКИ },
    print: { minPpi: 300, maxTotalInk: 300, expectedInks: 4 },
    families: {
      ...Object.fromEntries(FAMILY_NAMES.map((f) => [f, { notApplicable: "ні" }])),
      pagination: { folio: { styleNames: ["Колонтитул v1"] } },
    },
  } as AuditConfig;
}

/**
 * Ступінь 2 рівно так, як його кличе `audit.ts`: і перелік стилів, і назва
 * документа — з ОДНІЄЇ відповіді `doc_overview`, тобто з того документа,
 * який справді прочитали.
 */
async function ступінь2(box: ToolBox): Promise<void> {
  const overview = await callTool<{
    name: string;
    paragraphStyles: string[];
    characterStyles: string[];
  }>(box, "doc_overview", {});
  reconcileWithDocument(
    конфіг(),
    [...overview.paragraphStyles, ...overview.characterStyles],
    overview.name,
  );
}

describe("два відкриті документи — вимірюється той, до якого приєднались (R41)", () => {
  it("цільовий документ НЕ активний → openSession виводить його наперед", async () => {
    const { box, стан } = зробитиInDesign(двадокументнийСтан());
    expect(стан.активний).toBe(ID_ОБКЛАДИНКА); // контроль вхідного стану

    const handle = await openSession(box, ШЛЯХ_КНИЖКИ);

    expect(handle.stamp.docName).toBe(КНИЖКА);
    expect(стан.активний).toBe(ID_КНИЖКА);
    expect(handle.stamp.wasAlreadyOpen).toBe(true);
  });

  /*
   * ДОКАЗ МУТАЦІЄЮ (форма, яку вимагає постановка): прибери перемикання в
   * `openSession` — і цей тест упаде РІВНО тією відмовою, що її дав живий
   * прогін: `Конфіг недійсний: pagination.Колонтитул v1 … стилю
   * «Колонтитул v1» немає`, бо `doc_overview` віддасть стилі ОБКЛАДИНКИ.
   */
  it("ступінь 2 після приєднання бачить стилі КНИЖКИ, а не обкладинки", async () => {
    const { box } = зробитиInDesign(двадокументнийСтан());
    await openSession(box, ШЛЯХ_КНИЖКИ);

    await expect(ступінь2(box)).resolves.toBeUndefined();
  });

  /*
   * Негативний близнюк: доводить, що тест вище справді щось стереже. Без
   * перемикання ступінь 2 опитав би обкладинку — ось ця відмова, дослівно
   * та сама, яку побачив оператор. Тут вона не помилка, а очікуваний
   * результат ІНШОГО (виправленого) стану: документ названо чесно.
   */
  it("якби опитали обкладинку — відмова, і вона називає ОБКЛАДИНКУ на ім'я", async () => {
    const стан = двадокументнийСтан();
    const { box } = зробитиInDesign(стан);
    стан.активний = ID_ОБКЛАДИНКА; // жодного перемикання не сталось

    await expect(ступінь2(box)).rejects.toThrow(ConfigError);
    await expect(ступінь2(box)).rejects.toThrow(
      `In document "${ОБКЛАДИНКА}" the style "Колонтитул v1" doesn't exist.`,
    );
  });

  /*
   * Захист R10, продовжений на перемикання: `itemByName` знає лише НАЗВУ,
   * а назва не є тотожністю — однойменний файл із іншої теки цілком може
   * бути відкритий поруч. Якби перевірка звіряла тільки назву, спереду міг
   * би опинитись однойменний ЧУЖИЙ документ, і вимір пішов би з нього. Тут
   * `itemByName` навмисно віддає першу-ліпшу однойменну ціль (як і
   * справжній), а рятує звірка СИРОГО `fullName` — того, який InDesign сам
   * повернув для цільового документа при `openSession` (R23).
   */
  it("однойменний документ з ІНШОЇ теки вийшов наперед → відмова за розбіжністю шляху", async () => {
    const { box, стан } = зробитиInDesign(двійниковийСтан());

    await expect(openSession(box, ШЛЯХ_КНИЖКИ)).rejects.toThrow(SessionError);
    expect(стан.активний).toBe(ID_ОБКЛАДИНКА); // повернуто те, що було
  });

  it("перемикання НЕ взялося → відмова, а не вимір", async () => {
    const { box, стан } = зробитиInDesign(двадокументнийСтан(), { слухаєтьсяПеремикання: false });

    await expect(openSession(box, ШЛЯХ_КНИЖКИ)).rejects.toThrow(SessionError);
    /* Жодного виміру не сталось: спереду й далі обкладинка, і ніхто її не
     * опитував — сеанс упав ДО ступеня 2. */
    expect(стан.активний).toBe(ID_ОБКЛАДИНКА);
  });

  it("відмова називає ОБИДВА документи — потрібний і той, що спереду", async () => {
    const { box } = зробитиInDesign(двадокументнийСтан(), { слухаєтьсяПеремикання: false });

    const повідомлення = await openSession(box, ШЛЯХ_КНИЖКИ).then(
      () => "жодної відмови не сталось",
      (e: unknown) => (e instanceof Error ? e.message : String(e)),
    );

    // Потрібний документ, той що спереду, і слово, яке їх розрізняє.
    expect(повідомлення).toContain(`"${КНИЖКА}"`);
    expect(повідомлення).toContain(`"${ОБКЛАДИНКА}"`);
    expect(повідомлення).toContain("in front");
  });

  /*
   * ТЕКСТ, а не лише тип помилки. Рецензія раунду 1: тест на цю гілку був,
   * але перевіряв тільки `toThrow(SessionError)` — тому й не спіймав, що
   * повідомлення називало документ спереду самого себе («…документ «X» —
   * спереду «X»») і радило дію, яка не може спрацювати. Порада «клацніть
   * вікно й запустіть знову» тут БЕЗРЕЗУЛЬТАТНА: наступний прогін знову
   * покличе itemByName(назва) і знову дістане того самого двійника.
   */
  it("відмова про двійника: називає ШЛЯХИ і радить закрити зайвий документ", async () => {
    const { box } = зробитиInDesign(двійниковийСтан());

    const повідомлення = await openSession(box, ШЛЯХ_КНИЖКИ).then(
      () => "жодної відмови не сталось",
      (e: unknown) => (e instanceof Error ? e.message : String(e)),
    );

    // Причина названа по суті — однакова назва, різні шляхи.
    expect(повідомлення).toContain(`The document in front has the same name "${КНИЖКА}", but from a different path.`);
    expect(повідомлення).toContain(`Needed: "${ШЛЯХ_КНИЖКИ}", and in front is "${ШЛЯХ_ДВІЙНИКА}".`);
    expect(повідомлення).toContain(`Documents open with this name "${КНИЖКА}": 2.`);

    // Порада — та, що справді допомагає.
    expect(повідомлення).toContain(`Close the extra document named "${КНИЖКА}"`);
    expect(повідомлення).toContain(`NOT at the path "${ШЛЯХ_КНИЖКИ}"`);

    // І НЕ та, що не допоможе.
    expect(повідомлення).not.toContain("Make the target document active in InDesign");
    // Документ спереду самого себе більше не називається.
    expect(повідомлення).not.toContain(`"${КНИЖКА}" to the front — in front is "${КНИЖКА}"`);
  });

  it("відмова про ЧУЖИЙ документ спереду: інший текст і інша порада", async () => {
    const { box } = зробитиInDesign(двадокументнийСтан(), { слухаєтьсяПеремикання: false });

    const повідомлення = await openSession(box, ШЛЯХ_КНИЖКИ).then(
      () => "жодної відмови не сталось",
      (e: unknown) => (e instanceof Error ? e.message : String(e)),
    );

    expect(повідомлення).toContain(
      `Failed to bring the target document "${КНИЖКА}" to the front — in front is "${ОБКЛАДИНКА}".`,
    );
    expect(повідомлення).toContain("Make the target document active in InDesign");
    // Порада про двійників тут була б хибною: документ спереду ІНШИЙ.
    expect(повідомлення).not.toContain("Close the extra document");
    expect(повідомлення).not.toContain("the same name");
  });

  /*
   * СУПУТНЄ виправлення раунду 1: присвоєння лише КОЛИ ПОТРІБНЕ. Раніше
   * `app.activeDocument = itemByName(назва)` виконувалось безумовно — і в
   * стані з двійником це виводило наперед ЧУЖОГО двійника навіть тоді, коли
   * спереду вже стояв саме потрібний файл. Тобто код псував коректний стан,
   * щоб потім на нього поскаржитись.
   */
  it("цільовий документ УЖЕ спереду (при відкритому двійнику) → жодного присвоєння, жодної відмови", async () => {
    const стан = двійниковийСтан();
    стан.активний = ID_КНИЖКА; // і це саме ПОТРІБНИЙ файл, не двійник
    const { box, присвоєння } = зробитиInDesign(стан);

    const handle = await openSession(box, ШЛЯХ_КНИЖКИ);

    expect(handle.stamp.docName).toBe(КНИЖКА);
    expect(присвоєння).toEqual([]); // стану користувача не торкались узагалі
    await expect(ступінь2(box)).resolves.toBeUndefined();
  });

  it("цільовий уже спереду (двійника немає) → теж жодного присвоєння", async () => {
    const стан = двадокументнийСтан();
    стан.активний = ID_КНИЖКА;
    const { box, присвоєння } = зробитиInDesign(стан);

    await openSession(box, ШЛЯХ_КНИЖКИ);

    expect(присвоєння).toEqual([]);
  });

  /*
   * Код виходу 3 (спек §6.4, `EXIT.ENVIRONMENT`) виникає з ТИПУ відмови:
   * `audit.ts` перетворює на код 2 лише `ConfigError` зі ступеня 2
   * (`src/cli/audit.ts:709-716`), а все інше, що вилетіло з `try`, ловить
   * зовнішній `catch` і повертає `EXIT.ENVIRONMENT`. Тож перевіряємо саме
   * те, що вирішує код: це SessionError, а НЕ ConfigError.
   */
  it("відмова перемикання — збій СЕРЕДОВИЩА (код 3), а не недійсний конфіг (код 2)", async () => {
    const { box } = зробитиInDesign(двадокументнийСтан(), { слухаєтьсяПеремикання: false });

    try {
      await openSession(box, ШЛЯХ_КНИЖКИ);
      throw new Error("мало відмовити");
    } catch (e) {
      expect(e).toBeInstanceOf(SessionError);
      expect(e).not.toBeInstanceOf(ConfigError);
    }
  });
});

/*
 * R41, крок 4: прогін має бути НЕПОМІТНИМ для середовища користувача.
 * Документ, що був спереду до прогону, мусить бути спереду й після — і на
 * успіху, і на відмові.
 */
describe("попередній активний документ повертається спереду (R41, крок 4)", () => {
  it("успішний шлях: після restoreActiveDocument() спереду знову обкладинка", async () => {
    const { box, стан } = зробитиInDesign(двадокументнийСтан());
    const handle = await openSession(box, ШЛЯХ_КНИЖКИ);
    expect(стан.активний).toBe(ID_КНИЖКА); // міряли ЦЕЙ документ

    const збій = await handle.restoreActiveDocument();

    expect(збій).toBeNull();
    expect(стан.активний).toBe(ID_ОБКЛАДИНКА);
  });

  /*
   * Шлях відмови перевіряється саме ПІДМІНОЮ, а не ігноруванням: коли
   * присвоєння ігнорують, спереду й так лишається попередній документ, і
   * тест пройшов би навіть без жодного повернення — тобто не доводив би
   * нічого (виявлено мутацією: зняття повернення на шляху відмови такого
   * тесту не валило). Тут присвоєння спрацьовує, але виводить наперед
   * ТРЕТІЙ документ — і повернути обкладинку може лише саме повернення.
   */
  it("шлях відмови: перемикання вивело наперед ЧУЖИЙ документ → обкладинку повернуто", async () => {
    const стан = двадокументнийСтан();
    стан.документи.push({
      id: ID_ЧЕРНЕТКА,
      name: ЧЕРНЕТКА,
      fullName: `/тека/${ЧЕРНЕТКА}`,
      modified: false,
      saved: true,
      paragraphStyles: [],
    });
    const { box } = зробитиInDesign(стан, { підміняє: { [КНИЖКА]: ID_ЧЕРНЕТКА } });

    await expect(openSession(box, ШЛЯХ_КНИЖКИ)).rejects.toThrow(SessionError);

    expect(стан.активний).toBe(ID_ОБКЛАДИНКА);
  });

  it("шлях відмови: присвоєння проігноровано → спереду й далі обкладинка", async () => {
    const { box, стан } = зробитиInDesign(двадокументнийСтан(), { слухаєтьсяПеремикання: false });

    await expect(openSession(box, ШЛЯХ_КНИЖКИ)).rejects.toThrow(SessionError);

    expect(стан.активний).toBe(ID_ОБКЛАДИНКА);
  });

  it("попередній активний зник у проміжку → причина повертається, і НІЧОГО не кидається", async () => {
    const { box, стан } = зробитиInDesign(двадокументнийСтан());
    const handle = await openSession(box, ШЛЯХ_КНИЖКИ);

    // Користувач закрив обкладинку, поки тривав аудит.
    стан.документи = стан.документи.filter((d) => d.name !== ОБКЛАДИНКА);

    const збій = await handle.restoreActiveDocument();

    expect(збій).not.toBeNull();
    expect(збій).toContain(ОБКЛАДИНКА);
    expect(стан.активний).toBe(ID_КНИЖКА); // спереду лишився той, що й був
  });

  it("спереду й був цільовий → повертати нічого, жодного скрипта не шлемо", async () => {
    const стан = двадокументнийСтан();
    стан.активний = ID_КНИЖКА;
    const { box } = зробитиInDesign(стан);
    const handle = await openSession(box, ШЛЯХ_КНИЖКИ);

    expect(await handle.restoreActiveDocument()).toBeNull();
    expect(стан.активний).toBe(ID_КНИЖКА);
  });
});

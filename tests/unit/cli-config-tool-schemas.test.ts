/*
 * F1 / рулінг R30: ступінь 1 звіряє форму кожної родини зі СПРАВЖНЬОЮ
 * `inputSchema` її інструмента — до дотику до InDesign.
 *
 * Клас відмови, який це закриває, виміряний живим прогоном
 * (`docs/measured-facts-cli.md` §4.1): `"folio": "Колонтитул v1"` (рядок
 * замість `{styleName}`) пройшов схему конфіга мовчки, бо `familySchema` —
 * це `z.record(z.string(), z.unknown())`, і впав аж на живому документі:
 * 0 колонцифр, 169 фантомних дефектів ланцюжка, жодної помилки.
 *
 * НАЙВАЖЛИВІШИЙ ТУТ — НЕ негативний тест, а ПОЗИТИВНИЙ: валідатор, суворіший
 * за інструмент, який він стереже, відкинув би конфіг, що працює, і це гірша
 * вада за ту, що він лагодить. Тому перший блок ганяє справжній
 * `configs/example-book.json` з диска.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { collectTools, type ToolBox } from "../../src/cli/collect.js";
import { FAMILY_NAMES, type AuditConfig } from "../../src/cli/config/schema.js";
import {
  ConfigError,
  reconcileWithToolSchemas,
  validateConfig,
} from "../../src/cli/config/validate.js";

const КОРІНЬ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const box: ToolBox = collectTools();

function конфіг(родини: Record<string, unknown>): AuditConfig {
  return {
    edition: { title: "К", docPath: "/т/к.indd" },
    print: { minPpi: 300, maxTotalInk: 300, expectedInks: 4 },
    families: {
      ...Object.fromEntries(FAMILY_NAMES.map((f) => [f, { notApplicable: "ні" }])),
      ...родини,
    },
  } as AuditConfig;
}

/** Ловить `ConfigError`, щоб можна було перевіряти ПОЛЯ, а не лише факт кидка. */
async function відмова(cfg: AuditConfig): Promise<ConfigError> {
  try {
    await reconcileWithToolSchemas(cfg, box);
  } catch (e) {
    if (e instanceof ConfigError) return e;
    throw e;
  }
  throw new Error("мало відмовити, але звірка промовчала");
}

describe("reconcileWithToolSchemas — справжній конфіг видання ПРОХОДИТЬ", () => {
  /*
   * Головний запобіжник цієї задачі. Він ганяє ВИРОБНИЧИМ шляхом:
   * файл із диска → `validateConfig` → `reconcileWithToolSchemas` (яка сама
   * кличе `planPasses`, тобто звіряє аргументи ПІСЛЯ перейменування
   * `nearMissPt` → `nearMissThresholdPt` і доливання `print.*`).
   *
   * Якби звірка йшла по СИРОМУ конфігу, вона впала б на першому ж полі:
   * `geometry.nearMissPt` у схемі `geometry_audit` не існує взагалі.
   */
  it("configs/example-book.json звіряється зі схемами інструментів без відмови", async () => {
    const cfg = validateConfig(
      JSON.parse(readFileSync(join(КОРІНЬ, "configs/example-book.json"), "utf8")),
    );
    await expect(reconcileWithToolSchemas(cfg, box)).resolves.toBeUndefined();
  });

  it("родини, оголошені незастосовними, не звіряються взагалі", async () => {
    // `конфіг({})` — усі одинадцять родин у стані notApplicable.
    await expect(reconcileWithToolSchemas(конфіг({}), box)).resolves.toBeUndefined();
  });

  it("перейменований поріг: nearMissPt із конфіга проходить, бо звірка бачить уже nearMissThresholdPt", async () => {
    await expect(
      reconcileWithToolSchemas(конфіг({ geometry: { nearMissPt: 3 } }), box),
    ).resolves.toBeUndefined();
  });

  it("порожня родина `{}` проходить: усі поля цих схем необов'язкові або мають замовчування", async () => {
    await expect(
      reconcileWithToolSchemas(конфіг({ styles: {}, layout: {}, color: {}, spelling: {} }), box),
    ).resolves.toBeUndefined();
  });

  it("службовий `critical` не доїжджає до схеми — plan.ts його знімає", async () => {
    await expect(
      reconcileWithToolSchemas(конфіг({ typography: { critical: true } }), box),
    ).resolves.toBeUndefined();
  });
});

/*
 * F2 (рулінг R29): підродина, оголошена незастосовною, до інструмента не
 * доїжджає — `plan.ts` знімає її разом із `critical`. Отже `.strict()` її
 * не побачить, і одруківка в ЇЇ імені не вимкнула б нічого, зате звіт
 * друкував би причину під назвою, якої в інструмента немає: «не бачили» й
 * «виміряно» водночас. Тому ім'я підродини звіряється окремо.
 */
describe("reconcileWithToolSchemas — ім'я незастосовної ПІДРОДИНИ (R29)", () => {
  it("оголошена підродина, яку інструмент СПРАВДІ має, проходить", async () => {
    await expect(
      reconcileWithToolSchemas(
        конфіг({
          pagination: {
            folio: { styleNames: ["Колонтитул v1"] },
            contents: { notApplicable: "числа змісту не звірялися" },
          },
        }),
        box,
      ),
    ).resolves.toBeUndefined();
  });

  it("одруківка в імені підродини — ВІДМОВА, а не тихий пропуск під неіснуючою назвою", async () => {
    const e = await відмова(
      конфіг({
        pagination: {
          folio: { styleNames: ["Колонтитул v1"] },
          contnts: { notApplicable: "числа змісту не звірялися" },
        },
      }),
    );
    expect(e.family).toBe("pagination");
    expect(e.key).toBe("contnts");
    expect(e.purpose).toMatch(/unknown sub-family/);
  });
});

describe("reconcileWithToolSchemas — неправильна ФОРМА родини (те, що дожило до живого прогону)", () => {
  it("folio рядком замість {styleNames} — відмова, і вона називає чотири речі", async () => {
    const e = await відмова(конфіг({ pagination: { folio: "Колонтитул v1" } }));
    expect(e.family).toBe("pagination");
    expect(e.key).toBe("folio");
    // «для чого він» береться з `.describe()` САМОЇ схеми інструмента.
    expect(e.purpose).toMatch(/The folio family: page numbers/);
    expect(e.whyNoDefault).toMatch(/pagination_audit/);
    expect(e.whyNoDefault).toMatch(/expected object, received string/);
    // Повідомлення для людини несе всі чотири.
    expect(e.message).toMatch(/pagination\.folio/);
  });

  it("runningHead масивом замість {styleNames} — відмова", async () => {
    const e = await відмова(
      конфіг({ pagination: { runningHead: ["Колонтитул v1", "Колонтитул v2"] } }),
    );
    expect(e.family).toBe("pagination");
    expect(e.key).toBe("runningHead");
  });

  it("contents рядком замість {numberStyle, levelMap} — відмова", async () => {
    const e = await відмова(конфіг({ pagination: { contents: "Зміст Номер сторінки" } }));
    expect(e.key).toBe("contents");
  });

  it("вкладене поле не тієї форми адресується ШЛЯХОМ, а не самим лише іменем родини", async () => {
    const e = await відмова(конфіг({ pagination: { runningHead: { styleNames: "не масив" } } }));
    expect(e.key).toBe("runningHead.styleNames");
  });

  it("від'ємний поріг (спек §5.3, третій названий випадок) — відмова", async () => {
    const e = await відмова(конфіг({ geometry: { nearMissPt: -3 } }));
    expect(e.family).toBe("geometry");
    expect(e.key).toBe("nearMissThresholdPt");
  });
});

describe("reconcileWithToolSchemas — НЕВІДОМИЙ ключ усередині родини", () => {
  it("одруківка в ключі — відмова, і ключ НАЗВАНО (zod кладе його в issue.keys, не в path)", async () => {
    const e = await відмова(конфіг({ pagination: { folioo: { styleNames: ["Колонтитул v1"] } } }));
    expect(e.family).toBe("pagination");
    expect(e.key).toBe("folioo");
    // Відмова УЧИТЬ: перелічує, що інструмент насправді приймає.
    expect(e.purpose).toMatch(/folio, contents, headingStyles, runningHead, detail/);
    expect(e.whyNoDefault).toMatch(/dropped SILENTLY/);
  });

  it("ключ, якого немає в жодній схемі, ловиться й у не-pagination родині", async () => {
    const e = await відмова(конфіг({ typography: { sampleSizee: 10 } }));
    expect(e.family).toBe("typography");
    expect(e.key).toBe("sampleSizee");
  });

  /*
   * МЕЖА, НАЗВАНА ВГОЛОС (і закріплена тестом, щоб не вважалася покриттям):
   * `.strict()` діє на ВЕРХНЬОМУ рівні родини. Одруківка у ВКЛАДЕНОМУ
   * необов'язковому полі проходить — там її ловить не строгість, а
   * обов'язковість сусіда.
   */
  it("МЕЖА: одруківка у вкладеному об'єкті ловиться лише через брак обов'язкового сусіда", async () => {
    // `styleNames` бракує → invalid_type, ключ названо шляхом.
    const e = await відмова(конфіг({ pagination: { folio: { stylName: "Колонтитул v1" } } }));
    expect(e.key).toBe("folio.styleNames");

    // А ось одруківка в НЕОБОВ'ЯЗКОВОМУ вкладеному полі (`tolerance`)
    // проходить мовчки: обов'язкові сусіди на місці, а `.strict()` сюди не
    // сягає. Саме це й означає «межа», і саме тому вона тут закріплена.
    await expect(
      reconcileWithToolSchemas(
        конфіг({ geometry: { anchorRule: { style: "С", edge: "left", alignsTo: "column-start", tolerace: 1 } } }),
        box,
      ),
    ).resolves.toBeUndefined();
  });
});

describe("reconcileWithToolSchemas — межі покриття, названі вголос", () => {
  /*
   * I7 (фінальна рецензія, Important) — ЦЕЙ ТЕСТ ПЕРЕВЕРНУТО НАВМИСНО.
   *
   * Було: «extras/sequences НЕ звіряються: у __cli_extras схеми немає» —
   * межа, названа вголос і закріплена тестом. Але через неї проходила
   * одруківка в КЛЮЧІ (`bodyTextStyle` замість `bodyTextStyles`), а
   * `src/jsx/cli-extras.jsx:214` мовчки бере `[]` — і звіт друкував
   * «Примусових розривів: 402, з них в основному тексті 0». Спек §5.1
   * обіцяє, що «тихого нуля не існує за побудовою»; цей був.
   */
  it("I7: незнаний ключ у extras — ВІДМОВА ще до дотику до InDesign", async () => {
    const e = await відмова(
      конфіг({
        extras: { bodyTextStyles: ["Основний текст L"], вигаданийКлюч: 1 },
        sequences: { rules: [{ style: "Нумерація питань", mustBeSequential: true }] },
      }),
    );
    expect(e.family).toBe("extras");
    expect(e.key).toBe("вигаданийКлюч");
  });

  it("I7: одруківка в КЛЮЧІ доміру (bodyTextStyle) — саме той тихий нуль, і тепер це відмова", async () => {
    const e = await відмова(конфіг({ extras: { bodyTextStyle: ["Основний текст L"] } }));
    expect(e.family).toBe("extras");
    expect(e.key).toBe("bodyTextStyle");
  });

  it("I7: одруківка ВСЕРЕДИНІ rules[] теж ловиться — вкладений об'єкт оголошено .strict()", async () => {
    const e = await відмова(
      конфіг({
        extras: { bodyTextStyles: ["Основний текст L"] },
        sequences: { rules: [{ styl: "Нумерація питань" }] },
      }),
    );
    expect(e.family).toBe("extras");
  });

  /* Позитивний близнюк: справжня форма з `configs/example-book.json` проходить. */
  it("I7: справжня форма extras+sequences (як у configs/example-book.json) проходить", async () => {
    await expect(
      reconcileWithToolSchemas(
        конфіг({
          extras: { bodyTextStyles: ["Основний текст F", "Основний текст L"] },
          sequences: { rules: [{ style: "Нумерація питань", mustBeSequential: true }] },
        }),
        box,
      ),
    ).resolves.toBeUndefined();
  });

  it("звірка не торкається InDesign: коробка з echo-обробниками дає той самий вердикт", async () => {
    // Доказ від конструкції: підміняємо КОЖЕН обробник на такий, що кидає
    // при виклику. Звірка все одно проходить — отже жодного не викликала.
    const вибухова: ToolBox = new Map();
    for (const [name, запис] of box) {
      вибухова.set(name, {
        inputSchema: запис.inputSchema,
        handler: async () => {
          throw new Error(`обробник «${name}» не сміє викликатись на ступені 1`);
        },
      });
    }
    const cfg = validateConfig(
      JSON.parse(readFileSync(join(КОРІНЬ, "configs/example-book.json"), "utf8")),
    );
    await expect(reconcileWithToolSchemas(cfg, вибухова)).resolves.toBeUndefined();
  });
});

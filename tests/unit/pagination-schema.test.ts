import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FOLIO_OBJECT, registerPaginationTools } from "../../src/tools/pagination.js";
import type { Tools } from "../../src/tools/shared.js";

/*
 * Сторож ПУБЛІЧНОЇ схеми `pagination_audit` при винесенні спільної бази
 * `FOLIO_OBJECT` для сімнадцятого інструмента (§5.1 спеку).
 *
 * ЧОМУ ЦЕ ОКРЕМИЙ ФАЙЛ, А НЕ ДВА РЯДКИ В `tools-pagination-handler.test.ts`:
 * там перевіряється ПОВЕДІНКА обробника при підробленому `registerTool`, який
 * схему навіть не прогонює. Тут перевіряється сама схема — те, що клієнт MCP
 * бачить ДО будь-якого виклику.
 *
 * Небезпека, заради якої сторож існує, названа в §5.1 спеку: спокуса зняти
 * `.optional()` з `FOLIO_SCHEMA`, щоб «перевикористати» його в
 * `pagination_apply`, де `folio` обов'язковий. Це зробило б родину folio
 * обов'язковою і в аудиті — а тоді перевірка «не оголошено жодної родини»
 * (`pagination.ts`) стала б недосяжною, шлях «аудит лише змісту» помер би, а
 * конвенція Фаз 4–6 «родина без оголошення = null („не питали"), а не порожній
 * звіт („шукали й не знайшли")» зламалась би мовчки.
 *
 * ЧЕСНО ПРО ЧЕРВОНЕ: тест 1 і тест 2 на HEAD до цієї задачі не існували лише
 * тому, що не існувало експорту `FOLIO_OBJECT` — файл не компілювався. Їхня
 * ФАЛЬСИФІКОВНІСТЬ доведена не початковим падінням, а мутантами (звіт Задачі 8):
 * зняття `.optional()` вбиває тест 1, підміна спільної бази копією — тест 2,
 * дописування `range` у саму базу — тест 3.
 */

/** Схема, яку `registerPaginationTools` справді віддає в `registerTool`. */
function inputSchemaOf(tool: string): Record<string, z.ZodTypeAny> {
  const captured = new Map<string, Record<string, z.ZodTypeAny>>();
  const fake = {
    registerTool(name: string, cfg: { inputSchema: Record<string, z.ZodTypeAny> }) {
      captured.set(name, cfg.inputSchema);
    },
  } as unknown as Tools;
  registerPaginationTools(fake);
  const schema = captured.get(tool);
  if (!schema) throw new Error(`${tool} не зареєстровано`);
  return schema;
}

const auditInputSchema = () => inputSchemaOf("pagination_audit");

/**
 * Поле схеми на ім'я — з ГУЧНОЮ відмовою, якщо його немає.
 *
 * Не косметика під `noUncheckedIndexedAccess`: перейменоване поле інакше дало б
 * `undefined`, а тест на `undefined` упав би з невиразним «cannot read
 * properties», замість сказати, чого саме бракує.
 */
function auditField(name: string): z.ZodTypeAny {
  const field = auditInputSchema()[name];
  if (!field) throw new Error(`pagination_audit не має поля «${name}»`);
  return field;
}

/** Мінімальний законний виклик родини contents — «аудит лише змісту». */
const CONTENTS_ONLY = {
  contents: {
    numberStyle: "Зміст число",
    levelMap: [{ contentsStyle: "Зміст рівень 1", headingStyles: ["Підзаголовок"] }],
  },
  headingStyles: ["Підзаголовок"],
};

it("pagination_audit і далі приймає виклик БЕЗ folio", () => {
  /* Не локально зліплена форма, а та сама, що поїде клієнтові. */
  expect(auditField("folio").isOptional()).toBe(true);

  const shape = z.object(auditInputSchema());
  expect(shape.safeParse({}).success).toBe(true);
  /* Головний шлях, який тут стережеться: аудит лише змісту. */
  expect(shape.safeParse(CONTENTS_ONLY).success).toBe(true);
});

it("поле folio аудиту — це САМЕ FOLIO_OBJECT, а не його копія", () => {
  /*
   * Без цього тесту «спільна база» розійшлася б із ужитком тихо: інструмент
   * лишився б зі своїм інлайновим об'єктом, `pagination_apply` дістав би
   * експорт, і два описи одного поля почали б жити нарізно.
   */
  const folio = auditField("folio") as z.ZodOptional<typeof FOLIO_OBJECT>;
  expect(folio.unwrap()).toBe(FOLIO_OBJECT);

  /* `.describe()` лишається на місці вжитку — це воно пояснює клієнтові, що
   * означає відсутність поля. */
  expect(folio.description).toContain("not asked");
});

it("pagination_apply вимагає folio З range", () => {
  const shape = z.object({
    folio: FOLIO_OBJECT.extend({ range: z.enum(["backward", "forward"]) }),
  });
  expect(shape.safeParse({ folio: { styleNames: ["К"] } }).success).toBe(false);
  expect(shape.safeParse({ folio: { styleNames: ["К"], range: "backward" } }).success).toBe(true);
  /* База сама по собі `range` не несе — інакше аудит почав би його вимагати. */
  expect(FOLIO_OBJECT.safeParse({ styleNames: ["К"] }).success).toBe(true);
});

/* ── схема сімнадцятого інструмента, §5.1 ─────────────────────────────── */

const APPLY_MIN = {
  operation: "create-helper-thread",
  folio: { styleNames: ["Kolontsyfra"], range: "backward" },
  expectedDocName: "d.indd",
};

function applyShape(): z.ZodObject<Record<string, z.ZodTypeAny>> {
  return z.object(inputSchemaOf("pagination_apply"));
}

it("pagination_apply: expectedDocName ОБОВ'ЯЗКОВЕ, на відміну від решти інструментів запису", () => {
  /*
   * §5.1: `src/tools/shared.ts` робить це поле `.optional()`, а
   * `assertExpectedDoc` при `undefined` НЕ РОБИТЬ НІЧОГО. Причина там названа —
   * обов'язковість зламала б кожен наявний виклик; до НОВОЇ точки входу цей
   * аргумент не застосовний, а ціна тиші — структурна зміна живої книжки
   * користувача при забутому полі.
   */
  const shape = applyShape();
  expect(shape.safeParse(APPLY_MIN).success).toBe(true);
  const { expectedDocName: _drop, ...withoutDoc } = APPLY_MIN;
  expect(shape.safeParse(withoutDoc).success).toBe(false);
  /* І це саме поле схеми, а не наш локальний об'єкт: спільне
   * `EXPECTED_DOC_NAME_FIELD` тут ужити НЕ можна — воно `.optional()`. */
  expect(inputSchemaOf("pagination_apply").expectedDocName!.isOptional()).toBe(false);
});

it("pagination_apply: dryRun за замовчуванням TRUE", () => {
  /*
   * Відхилення від `typography_apply`/`composition_apply` (там `false`), і воно
   * навмисне (§5.1): там перед записом стоїть аудит, який показує всі збіги.
   * Тут попередника немає — поняття маршруту й придатності вводить сама Фаза 7,
   * тож перший виклик мусить бути читальним.
   */
  const parsed = applyShape().parse(APPLY_MIN) as { dryRun: boolean };
  expect(parsed.dryRun).toBe(true);
});

it("pagination_apply: route і planId — необов'язкові В СХЕМІ, бо їхнє правило перехресне", () => {
  /*
   * «`route` обов'язковий лише для `replace-literals`» — умова МІЖ полями, а
   * `inputSchema` MCP описує поля поодинці. Тому в схемі вони `.optional()`, а
   * саме правило стереже обробник ГУЧНОЮ відмовою до виміру
   * (`tools-pagination-apply.test.ts`). Тест фіксує цей поділ, щоб наступний,
   * побачивши `.optional()`, не вирішив, що правила немає.
   */
  const schema = inputSchemaOf("pagination_apply");
  expect(schema.route!.isOptional()).toBe(true);
  expect(schema.planId!.isOptional()).toBe(true);
  expect(applyShape().safeParse({ ...APPLY_MIN, operation: "replace-literals" }).success).toBe(true);
  /* Значення поза переліком схема відкидає сама. */
  expect(applyShape().safeParse({ ...APPLY_MIN, route: "auto-ish" }).success).toBe(false);
  expect(applyShape().safeParse({ ...APPLY_MIN, operation: "rewrite" }).success).toBe(false);
});

it("pagination_apply: поле folio — це FOLIO_OBJECT, РОЗШИРЕНИЙ range, а не копія", () => {
  /* Той самий сторож, що для аудиту, з другого боку: дві схеми одного поля
   * мусять народжуватися з однієї бази, інакше вони розійдуться мовчки. */
  const shape = applyShape();
  expect(shape.safeParse({ ...APPLY_MIN, folio: { styleNames: ["К"] } }).success).toBe(false);
  expect(
    shape.safeParse({ ...APPLY_MIN, folio: { styleNames: ["К"], range: "forward" } }).success,
  ).toBe(true);
  /* І `range` не просочився в базу — інакше аудит почав би його вимагати. */
  expect(auditField("folio").safeParse({ styleNames: ["К"] }).success).toBe(true);
});

/*
 * Межа, заради якої форму й міняли. «02 Зоряні Мрії» (592 с.) набирає
 * колонцифри ДВОМА стилями — «Нумерація L» і «Нумерація R», по одному на
 * бік розвороту. Поки поле було одне, назвати можна було лише один: тобто
 * перевірити половину книжки й надрукувати це як перевірену родину.
 */
describe("folio приймає КІЛЬКА стилів", () => {
  it("два стилі — законна форма", () => {
    expect(FOLIO_OBJECT.safeParse({ styleNames: ["Нумерація L", "Нумерація R"] }).success).toBe(true);
  });

  it("один стиль так само законний — це не вимога множинності", () => {
    expect(FOLIO_OBJECT.safeParse({ styleNames: ["Колонтитул v1"] }).success).toBe(true);
  });

  /* Порожній перелік — не «усі стилі» й не «жодного»: це нічого не
   * означає, і мовчки прийняти його означало б родину, яка нічого не
   * міряє, але звітує як оголошена. */
  it("порожній перелік відхиляється", () => {
    expect(FOLIO_OBJECT.safeParse({ styleNames: [] }).success).toBe(false);
  });

  it("стара однина більше не приймається — форма ОДНА", () => {
    expect(FOLIO_OBJECT.safeParse({ styleName: "Колонтитул v1" }).success).toBe(false);
  });
});

#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs as nodeParseArgs } from "node:util";
import type { BibliographyReport } from "../bibliography/report.js";
import type { ColorReport } from "../color/report.js";
import type { GeometryReport } from "../geometry/report.js";
import type { FamilyReport as PaginationFamilyReport, PaginationReport } from "../pagination/report.js";
import type { PreflightReport } from "../preflight/types.js";
import type { SpellingReport } from "../spelling/types.js";
import { callTool, collectTools, type ToolBox } from "./collect.js";
import { scaffoldConfig, підказкаСтилів } from "./config/scaffold.js";
import type { AuditConfig } from "./config/schema.js";
import {
  ConfigError,
  reconcileWithDocument,
  reconcileWithToolSchemas,
  validateConfig,
} from "./config/validate.js";
import {
  довжинаОдиницею,
  довжинаЧислом,
  форматСловами,
  ВОЛОСЯНА_PT,
  type ExtrasMeasure,
} from "./measure/extras.js";
import { bi, same, type Bi } from "./report/i18n.js";
import { biCell, biSpan, dataKey, escapeHtml, renderRows, type ReportRow } from "./report/render.js";
import {
  deriveSections,
  hasCritical,
  judgePasses,
  tallyFindings,
  type DocOverviewResponse,
  type Sections,
  type StylesAuditResponse,
} from "./report/sections.js";
import { loadTemplate } from "./report/template.js";
import { type Measurements } from "./run/execute.js";
import { executePasses } from "./run/execute.js";
import { planPasses, type Pass } from "./run/plan.js";
import { normalizePathForComparison, openSession, type SessionHandle } from "./run/session.js";

export const EXIT = { CLEAN: 0, CRITICAL: 1, CONFIG: 2, ENVIRONMENT: 3 } as const;

/**
 * ВЕРДИКТ ДРУКУ: критична знахідка — ступінь 1, інакше — 0.
 *
 * Винесено з `main` окремою функцією 2026-08-26, і причина не в охайності.
 * Мутаційна проба показала, що цей рядок можна замінити на голе
 * `return EXIT.CLEAN` — тобто НАЗАВЖДИ сказати «книжка чиста» — і ВЕСЬ
 * юніт-набір лишиться зеленим (2762 тести). Єдина згадка `EXIT` утестах
 * (`cli-args.test.ts:46`) звіряє сталі самі з собою: `[0,1,2,3]` дорівнює
 * `[0,1,2,3]`. Отже, ворота, які спиняють дефектну книжку перед друком, не
 * були накриті нічим.
 *
 * `hasCritical` сам по собі перевірений добре (`cli-sections.test.ts`).
 * Незакритим був ПЕРЕХІД від його вердикту до коду виходу — шов між двома
 * перевіреними шматками, а не самі шматки.
 */
export function exitCodeFor(m: Measurements, criticalIds: ReadonlySet<string>): number {
  return hasCritical(m, criticalIds) ? EXIT.CRITICAL : EXIT.CLEAN;
}

export interface Args {
  /**
   * `--init`: не аудит, а збірщик ЧЕРНЕТКИ конфіга з відкритого документа.
   * Прогонів не робить, звіту не пише — лише читає `doc_overview` і кладе
   * заготовку в `--out`. Конфіга при цьому ще немає, тож `--config` у цьому
   * режимі не вимагається.
   */
  init: boolean;
  /**
   * `--documents`: надрукувати, ЩО ЗАРАЗ ВІДКРИТО в InDesign, по рядку на
   * документ (`ім'я<TAB>повний шлях або порожньо`), і вийти.
   *
   * Потрібен запускачеві: меню має відповідати на питання «що зараз у
   * застосунку», а не «які конфіги колись написали». Інакше оператор
   * зіставляє відкритий документ із назвою конфіга ГОЛОВОЮ — тобто робить
   * роботу, яку машина зробить точніше, і помиляється саме там, де ціна
   * помилки найбільша (прогін не на тій книжці).
   *
   * Живе тут, а не окремим викликом `osascript` із shell, свідомо: канал до
   * InDesign у цього інструмента ОДИН — міст. Другий канал довелося б
   * навчити тих самих речей (таймаут AppleScript, лапки, кодування шляхів),
   * і вони розійшлися б із першим тієї ж миті, коли щось із цього зміниться.
   */
  documents: boolean;
  /** Тека конфігів для зіставлення у режимі `--documents`. */
  configsDir: string | null;
  /** У режимах `--init` і `--documents` конфіга ще немає — тому `null`. */
  config: string | null;
  /** У режимі `--documents` писати нема чого — тому `null`. */
  out: string | null;
  measurements: string | null;
  restartIndesign: boolean;
  /**
   * I2: шлях документа, що ПЕРЕКРИВАЄ `edition.docPath` конфіга (спек §6.1:
   * «CLI відкриває документ сам (`--doc` або `edition.docPath`)»).
   *
   * Прапорець існував лише в спеку й у ПОРАДІ відмови сеансу
   * («Закрийте зайві документи або вкажіть `--doc` на той, що вже
   * відкритий»), а `parseArgs` про нього не знав узагалі — з `strict: true`
   * виконання поради давало «Unknown option '--doc'» і код 2. Порада, яка
   * не може спрацювати, — той самий клас, що R27.
   */
  doc: string | null;
}

export function parseArgs(argv: string[]): Args {
  const { values } = nodeParseArgs({
    args: argv,
    options: {
      config: { type: "string" },
      out: { type: "string" },
      measurements: { type: "string" },
      doc: { type: "string" },
      init: { type: "boolean", default: false },
      documents: { type: "boolean", default: false },
      configs: { type: "string" },
      "restart-indesign": { type: "boolean", default: false },
    },
    strict: true,
  });
  const init = values.init === true;
  const documents = values.documents === true;

  /* `--documents` — це запит СТАНУ, а не робота: ні конфіга, ні виходу він
   * не потребує й не приймає. Мовчки прийняти зайвий прапорець означало б
   * дати оператору вірити, що той щось робить. */
  if (documents) {
    if (init) throw new Error("--documents and --init make no sense together: the first only lists what is open, the second drafts a config.");
    if (values.config !== undefined) throw new Error("--documents does not read the config: it lists what is currently open in InDesign.");
    if (values.out !== undefined) throw new Error("--documents writes nothing: the listing goes to stdout.");
    return {
      init: false,
      documents: true,
      configsDir: values.configs ?? null,
      config: null,
      out: null,
      measurements: null,
      doc: null,
      restartIndesign: false,
    };
  }

  if (!init && values.config === undefined) {
    throw new Error(
      "--config was not named. There is no default: the config carries knowledge about the edition that the document does not know about itself.",
    );
  }
  /* `--init --config …` приймати не можна МОВЧКИ: оператор, який набрав
   * обидва, майже напевно чекав, що чернетка складеться З УРАХУВАННЯМ
   * наявного конфіга. Вона не складається — збірщик читає лише документ. */
  if (init && values.config !== undefined) {
    throw new Error(
      "--init and --config make no sense together: the builder drafts FROM THE DOCUMENT, it does not read an existing config. " +
        "Drop --config to draft one, or --init to run the audit with an existing config.",
    );
  }
  if (values.out === undefined) {
    throw new Error(
      init ? "--out was not named — where to write the config draft." : "--out was not named — where to write the report.",
    );
  }
  return {
    init,
    documents: false,
    configsDir: null,
    config: values.config ?? null,
    out: values.out,
    measurements: values.measurements ?? null,
    doc: values.doc ?? null,
    /* Побічна дія на машині оператора, тож ніколи не типова (спек §6.3).
     * Саму дію перезапуску тут НЕ реалізовано — жоден із готових модулів
     * (collect/session) її не надає, тож прапорець лишається розібраним, але
     * без дії; звіт про це — окремим пунктом, не мовчки. */
    restartIndesign: values["restart-indesign"] === true,
  };
}

/* ==========================================================================
 * R9: відбиток середовища — дві клітинки, яких `openSession` не заповнює.
 * ========================================================================== */

/**
 * Час роботи процесу InDesign, засобами ОС (спек-нейтрально: без нього
 * `sessionUptimeMs` лишається `null`, і REFERENCE-пам'ять («кожен вимір часу
 * — на щойно перезапущеному InDesign») лишається непідтвердженою для ЦЬОГО
 * прогону). Вимірюється лише на macOS (`ps` дає `lstart` фіксованої ширини
 * 24 символи — рівно стільки, скільки бере зріз нижче, byte-для-byte).
 * Немає надійного способу на інших ОС тут — і вигадувати число забороняє
 * сам бриф, тож `null`.
 */
function виявитиЧасРоботиInDesign(): number | null {
  if (process.platform !== "darwin") return null;
  try {
    const вивід = execFileSync("ps", ["-axo", "lstart=,comm="], { encoding: "utf8" });
    let найраніший: number | null = null;
    for (const рядок of вивід.split("\n")) {
      if (!/indesign/i.test(рядок)) continue;
      const часоваМітка = рядок.slice(0, 24).trim();
      const мс = Date.parse(часоваМітка);
      if (Number.isNaN(мс)) continue;
      if (найраніший === null || мс < найраніший) найраніший = мс;
    }
    return найраніший === null ? null : Date.now() - найраніший;
  } catch {
    return null;
  }
}

interface ДжерелоСловника {
  code: string;
  path: string;
}

/**
 * `spelling_audit` віддає джерела словників у полі `dictionaries` (мова
 * коду → шлях), не в одному полі: перевірено читанням `src/tools/
 * spelling.ts` (`otherFields.dictionaries = sources`, кожен запис —
 * `{code, path, stems, vintage, affixGroups, compoundRulesPresentNotApplied}`).
 * `EnvironmentStamp.dictionaryPath` — ОДИН рядок, тож при кількох мовах
 * (типовий випадок для книжки з епіграфами іншою мовою) шляхи склеюються в
 * один читний рядок "код: шлях; код: шлях" — це не вигадка, а форматування
 * реальних пар, тим самим прийомом, яким код по всьому CLI склеює масиви в
 * речення (див. `sections.ts`).
 */
function витягнутиШляхиСловників(spellingData: unknown): string | null {
  if (typeof spellingData !== "object" || spellingData === null) return null;
  const сире = (spellingData as { dictionaries?: unknown }).dictionaries;
  if (!Array.isArray(сире) || сире.length === 0) return null;
  const пари = сире
    .filter((d): d is ДжерелоСловника => typeof d === "object" && d !== null && typeof (d as ДжерелоСловника).path === "string")
    .map((d) => `${d.code}: ${d.path}`);
  return пари.length > 0 ? пари.join("; ") : null;
}

/* ==========================================================================
 * Зшивання: рядкові адаптери «інструмент → ReportRow[]» для секцій
 * «Критичне» і «Важливе». `sections.ts` (deriveSections/hasCritical) дає
 * ЛІЧИЛЬНИКИ, потрібні для воріт і для «Перевірено — чисто»; тут — ОКРЕМА,
 * рядкова форма, для таблиць. Обидві читають ТІ САМІ справжні поля, що
 * задокументовані коментарями у sections.ts (перевірено там читанням
 * кожного tools/*.ts).
 *
 * Інструменти БЕЗ адаптера тут (typography_audit, layout_audit,
 * composition_audit, doc_overview, indesign_status) рядків не дають —
 * їхня форма відповіді не несе стабільного поля «сторінка» на знахідку
 * (composition/typography — лише лічильники чи офсети в тексті, не
 * сторінка; перевірено читанням report.ts/engine.ts кожного). Це свідома
 * межа, не недогляд: після R20 (`sections.ts`) такий прохід усе одно НЕ
 * зникає — він потрапляє в `needsEyes` із числом, лише без рядків
 * таблиці.
 *
 * «Без адаптера ТУТ» — саме про РЯДКИ таблиці, і в раунді виправлень 1 це
 * розійшлося з `sections.ts`: `indesign_status` тепер має СЕКЦІЙНИЙ адаптер
 * (числа середовища йдуть у «Перевірено чисто»), а рядків таблиці не має й
 * не потребує — зонд сеансу не судить макета, тож адресувати нічого. Дві
 * різні речі, обидві правдиві.
 *
 * `__cli_extras` — ВИНЯТОК серед п'яти, на які раніше вказувала ця
 * примітка (R22, рецензія задачі 12): знахідки доміру МАЮТЬ адресу
 * (сторінку для масштабу, шар для монтажного столу), тож для нього
 * адаптер тепер є — `rowsFromExtras` нижче.
 * ========================================================================== */

function сторінкаВМасив(p: string | null): string[] {
  return p === null ? [] : [p];
}

function rowsFromColor(data: unknown): ReportRow[] {
  const d = data as ColorReport;
  return d.findings.map((f) => ({
    pages: f.pages,
    what: bi(
      `color/${f.family}: ${f.rule} — ${f.color}` +
        (f.pagesTotal > f.pages.length ? ` (сторінок показано ${f.pages.length} з ${f.pagesTotal})` : ""),
      `color/${f.family}: ${f.rule} — ${f.color}` +
        (f.pagesTotal > f.pages.length ? ` (pages shown ${f.pages.length} of ${f.pagesTotal})` : ""),
    ),
    evidence: bi(
      `${f.count} місць` + (f.totalInk !== null ? `, сумарна фарба ${f.totalInk}%` : ""),
      `${f.count} places` + (f.totalInk !== null ? `, total ink ${f.totalInk}%` : ""),
    ),
    fix:
      f.examples.length > 0
        ? bi(`Приклади: ${f.examples.slice(0, 3).join("; ")}`, `Examples: ${f.examples.slice(0, 3).join("; ")}`)
        : bi("Деталі — у файлі вимірів.", "Details are in the measurements file."),
  }));
}

function rowsFromGeometry(data: unknown): ReportRow[] {
  const d = data as GeometryReport;
  return d.findings.map((f) => ({
    pages: f.pages,
    what: bi(
      `geometry/${f.family}: ${f.defect}` +
        (f.pagesTotal !== undefined ? ` (сторінок показано ${f.pages.length} з ${f.pagesTotal})` : ""),
      `geometry/${f.family}: ${f.defect}` +
        (f.pagesTotal !== undefined ? ` (pages shown ${f.pages.length} of ${f.pagesTotal})` : ""),
    ),
    evidence: bi(
      `${f.count} випадків, значення «${f.value}»` + (f.detail !== undefined ? `. ${f.detail}` : ""),
      `${f.count} occurrences, value “${f.value}”` + (f.detail !== undefined ? `. ${f.detail}` : ""),
    ),
    fix: bi("Деталі — у файлі вимірів.", "Details are in the measurements file."),
  }));
}

const НАЗВА_РОДИНИ_PAGINATION: Record<"folio" | "contents" | "runningHead", Bi> = {
  folio: bi("колонцифра", "folio"),
  contents: bi("зміст", "contents"),
  runningHead: bi("колонтитул", "running head"),
};

function rowsFromPagination(data: unknown): ReportRow[] {
  const d = data as PaginationReport;
  const rows: ReportRow[] = [];
  const родини: Array<["folio" | "contents" | "runningHead", PaginationFamilyReport | null]> = [
    ["folio", d.folio],
    ["contents", d.contents],
    ["runningHead", d.runningHead],
  ];
  for (const [ключ, fam] of родини) {
    if (fam === null) continue;
    for (const g of fam.groups) {
      rows.push({
        pages: g.pages,
        what: bi(
          `${НАЗВА_РОДИНИ_PAGINATION[ключ].uk}: ${g.defect}` +
            (g.pagesTruncated !== null
              ? ` (сторінок показано ${g.pagesTruncated.shown} з ${g.pagesTruncated.total})`
              : ""),
          `${НАЗВА_РОДИНИ_PAGINATION[ключ].en}: ${g.defect}` +
            (g.pagesTruncated !== null
              ? ` (pages shown ${g.pagesTruncated.shown} of ${g.pagesTruncated.total})`
              : ""),
        ),
        evidence: bi(
          `${g.count} тверджень. Приклад: заявлено «${g.example.claimed ?? "—"}», ` +
            `насправді «${g.example.actual ?? "—"}» — ${g.example.detail}`,
          `${g.count} assertions. Example: declared “${g.example.claimed ?? "—"}”, ` +
            `actually “${g.example.actual ?? "—"}” — ${g.example.detail}`,
        ),
        /*
         * §3.4 передачі: ОБІЦЯНКА БУЛА НЕПОКРИТА. Тут стояло «повний перелік
         * адрес — у файлі вимірів», і це неправда: адреси беруться з
         * `g.pages`, обрізаних стелею `MAX_GROUP_PAGES` (20), а повний перелік
         * живе лише в полі `detail`, якого CLI НЕ ПРОСИТЬ у жодної родини
         * (`src/cli/run/plan.ts`). Тобто у `measurements.json` тих адрес немає
         * так само, як і у звіті — читач ішов їх шукати туди, де їх нема.
         *
         * Просити `detail` безумовно не можна: у нього своя стеля
         * (`MAX_PAGINATION_DETAIL_ITEMS`) саме тому, що поіменний перелік на
         * реальній книжці — це ~380 тверджень, більше за 78 КБ, на яких Фаза 4
         * вже одного разу вивела інструмент з ладу. Тому правдою робиться не
         * обіцянка, а ПОРАДА: сказано, скільки показано, і чим дістати решту.
         */
        fix:
          g.pagesTruncated !== null
            ? bi(
                `Звірте з еталоном родини. Показано ${g.pagesTruncated.shown} сторінок із ` +
                  `${g.pagesTruncated.total}; решти адрес немає ні у звіті, ні у файлі вимірів — ` +
                  "щоб дістати повний перелік, прогоніть pagination_audit із detail: " +
                  `{ family: "${ключ}" }.`,
                `Reconcile against the family's reference. Shown ${g.pagesTruncated.shown} pages of ` +
                  `${g.pagesTruncated.total}; the remaining addresses are neither in the report nor in the measurements file — ` +
                  "to obtain the full listing, run pagination_audit with detail: " +
                  `{ family: "${ключ}" }.`,
              )
            : bi(
                "Звірте з еталоном родини; адреси всіх тверджень цієї групи наведені вище.",
                "Reconcile against the family's reference; the addresses of all assertions in this group are given above.",
              ),
      });
    }
  }
  return rows;
}

function rowsFromPreflight(data: unknown): ReportRow[] {
  const d = data as PreflightReport;
  const rows: ReportRow[] = [];
  for (const finding of d.findings) {
    for (const occ of finding.occurrences) {
      const fixEntry = occ.details.find((kv) => kv.key === "Fix");
      rows.push({
        pages: сторінкаВМасив(occ.page),
        what: same(`preflight/${finding.category}: ${finding.rule} — ${occ.object}`),
        evidence: same(occ.description ?? occ.details.map((kv) => `${kv.key}: ${kv.value}`).join("; ")),
        fix:
          fixEntry !== undefined
            ? same(fixEntry.value)
            : bi(
                "InDesign не надав Fix для цього правила — див. опис ліворуч.",
                "InDesign supplied no Fix for this rule — see the description on the left.",
              ),
      });
    }
  }
  return rows;
}

function rowsFromStyles(data: unknown): ReportRow[] {
  const d = data as StylesAuditResponse;
  const rows: ReportRow[] = d.findings.map((f) => ({
    pages: сторінкаВМасив(f.page),
    what: same(`styles/${f.family}: ${f.defect} — «${f.styleName}»`),
    evidence: same(f.detail),
    fix: bi(
      "Див. стиль у документі; деталі — у файлі вимірів.",
      "See the style in the document; details are in the measurements file.",
    ),
  }));
  const агрегати: Array<[number | null, Bi]> = [
    [d.totals.overridePropertyDeviations, bi("перевизначень властивостей абзацу", "paragraph property overrides")],
    [d.totals.scaleParagraphs, bi("абзаців із неномінальним масштабом", "paragraphs with a non-nominal scale")],
    [d.totals.characterRangesDeviating, bi("символьних діапазонів, що відхиляються", "deviating character ranges")],
  ];
  for (const [число, підпис] of агрегати) {
    if (число !== null && число > 0) {
      rows.push({
        pages: [],
        what: bi(
          `styles: ${підпис.uk} (сума по родині)`,
          `styles: ${підпис.en} (sum across the family)`,
        ),
        evidence: bi(
          `${число} із ${d.totals.paragraphs} проаудитованих абзаців`,
          `${число} of ${d.totals.paragraphs} audited paragraphs`,
        ),
        fix: bi(
          "Поіменного переліку тут немає — числа зведені; деталі за абзацами — у файлі вимірів.",
          "There is no by-name listing here — the numbers are aggregated; per-paragraph details are in the measurements file.",
        ),
      });
    }
  }
  return rows;
}

function rowsFromBibliography(data: unknown): ReportRow[] {
  const d = data as BibliographyReport;
  const rows: ReportRow[] = [];
  for (const g of d.groups) {
    for (const s of g.samples) {
      rows.push({
        pages: [s.page],
        what: bi(
          `bibliography/${g.title} — запис №${s.recordNumber}`,
          `bibliography/${g.title} — record no. ${s.recordNumber}`,
        ),
        evidence: same(`«${s.before}» → «${s.suggested}» (${s.basis})`),
        fix: bi(
          "Застосувати правку в тексті бібліографічного запису.",
          "Apply the correction in the text of the bibliographic record.",
        ),
      });
    }
    if (g.needsReviewTotal > 0) {
      rows.push({
        pages: [],
        what: bi(
          `bibliography/${g.title}: потребує підтвердження людиною`,
          `bibliography/${g.title}: needs human confirmation`,
        ),
        evidence: bi(
          `${g.needsReviewTotal} сумнівних збігів окремо від ${g.total} підтверджених`,
          `${g.needsReviewTotal} doubtful matches, separately from ${g.total} confirmed ones`,
        ),
        fix: bi(
          "Підтвердити поштучно — перелік у файлі вимірів.",
          "Confirm one by one — the listing is in the measurements file.",
        ),
      });
    }
  }
  return rows;
}

function rowsFromSpelling(data: unknown): ReportRow[] {
  const d = data as SpellingReport;
  /* Лише `language-none` — справжній дефект (спек §.., сам SpellingReport:
   * `deviating` рахує `language-none` + `word-not-checked`, НЕ
   * `language-stray`). Невідомі слова (`word-unknown`/`word-not-checked`)
   * тут навмисно не йдуть рядками: sections.ts кладе їх у «потребує очей»
   * СПИСКОМ, бо тріаж — за людиною, а не «знахідка на сторінці». */
  return d.language
    .filter((l) => l.defect === "language-none")
    .map((l) => ({
      pages: [l.page],
      what: bi(
        `spelling/мова не призначена (${l.words} слів)`,
        `spelling/no language assigned (${l.words} words)`,
      ),
      evidence: bi(`Зразок: «${l.sample}»`, `Sample: “${l.sample}”`),
      fix: bi(
        "Призначити мову діапазону тексту в InDesign.",
        "Assign a language to the text range in InDesign.",
      ),
    }));
}

/**
 * R22 (рецензія задачі 12, Important, доведено ВИКОНАННЯМ): доміру
 * (`__cli_extras`) знахідки МАЮТЬ адресу — на відміну від typography/
 * layout/composition, це не той випадок. `horizontalScaleOffenders` несе
 * сторінку, `pasteboardItems` — шар (адреса монтажного столу; сторінки в
 * нього за визначенням немає). Рядки будуються зі СТРУКТУРНИХ полів
 * `ExtrasMeasure`, НЕ з рядків-речень `summariseExtras` (ті самі рядки, з
 * яких раніше мовчки зникало число 193 — рецензент прогнав шлях і не
 * знайшов його НІДЕ, ні в числі, ні в тексті).
 */
function rowsFromExtras(data: unknown): ReportRow[] {
  const d = data as ExtrasMeasure;
  const rows: ReportRow[] = [];
  for (const o of d.horizontalScaleOffenders) {
    rows.push({
      pages: [o.page],
      what: bi(
        `extras/горизонтальний масштаб абзаців: ${String(o.scale)} % — стиль «${o.style}»`,
        `extras/horizontal scale of paragraphs: ${String(o.scale)} % — style “${o.style}”`,
      ),
      evidence: bi(`${String(o.count)} абзаців`, `${String(o.count)} paragraphs`),
      fix: bi(
        "Повернути масштаб до 100 % або підтвердити навмисність.",
        "Return the scale to 100 % or confirm it is deliberate.",
      ),
    });
  }
  for (const p of d.pasteboardItems) {
    rows.push({
      pages: [],
      what: bi(
        `extras/об'єкти на монтажному столі — шар «${p.layer}»`,
        `extras/objects on the pasteboard — layer “${p.layer}”`,
      ),
      evidence: bi(
        `${String(p.count)} об'єктів (монтажний стіл сторінки не має за визначенням)`,
        `${String(p.count)} objects (the pasteboard has no page by definition)`,
      ),
      fix: bi(
        "Перевірити: чи мають лишитись поза полосою набору, чи прибрати перед здачею в друк.",
        "Check: should they stay outside the text column, or be removed before going to print.",
      ),
    });
  }
  if (d.thinnestStrokePt !== null && d.thinnestStrokePt < ВОЛОСЯНА_PT) {
    rows.push({
      pages: [],
      what: bi(
        `extras/волосяне обведення ${String(d.thinnestStrokePt)} pt`,
        `extras/hairline stroke ${String(d.thinnestStrokePt)} pt`,
      ),
      evidence: bi(
        `тонше за ${String(ВОЛОСЯНА_PT)} pt — друкарня фізично не відтворює`,
        `thinner than ${String(ВОЛОСЯНА_PT)} pt — the print shop physically cannot reproduce it`,
      ),
      fix: bi("Збільшити товщину обведення.", "Increase the stroke weight."),
    });
  }
  /*
   * Critical 1 (раунд виправлень 1, задача C): до цієї правки жоден рядок
   * таблиці не будувався з `d.sequences` узагалі — розрив у нумерації,
   * навіть коли решта `extras` брудна й прохід ішов у `needsEyes`, не мав
   * рядка НІ в «crit», НІ в «major». `countSequenceProblems` (звідти ж,
   * `sections.ts`) і ці рядки тепер судять «є проблема» ОДНИМ правилом.
   */
  for (const seq of d.sequences ?? []) {
    if (seq.found === 0) {
      rows.push({
        pages: [],
        what: bi(
          `extras/нумерація «${seq.style}»: стилю в документі не знайдено`,
          `extras/numbering “${seq.style}”: the style was not found in the document`,
        ),
        evidence: bi("0 абзаців — нічого не перевірено", "0 paragraphs — nothing was checked"),
        fix: bi(
          "Перевірити назву стилю в конфігу видання (бара назва, не повний шлях).",
          "Check the style name in the edition config (the bare name, not the full path).",
        ),
      });
      continue;
    }
    for (const b of seq.breaks) {
      rows.push({
        pages: [b.page],
        what: bi(
          `extras/нумерація «${seq.style}»: розрив ${String(b.prev)} → ${String(b.next)}`,
          `extras/numbering “${seq.style}”: gap ${String(b.prev)} → ${String(b.next)}`,
        ),
        evidence: bi(
          `${String(seq.found)} абз. знайдено, розібрано ${String(seq.parsed)}`,
          `${String(seq.found)} paragraphs found, parsed ${String(seq.parsed)}`,
        ),
        fix: bi(
          "Звірити фізичну нумерацію на сторінці; можлива форма запису поза розбором (напр. «12а»).",
          "Reconcile the physical numbering on the page; a record form outside the parser is possible (e.g. «12а»).",
        ),
      });
    }
    for (const unp of seq.unparsed) {
      rows.push({
        pages: [unp.page],
        what: bi(
          `extras/нумерація «${seq.style}»: число не розпізнано`,
          `extras/numbering “${seq.style}”: the number was not recognised`,
        ),
        evidence: bi(`текст «${unp.text}»`, `text “${unp.text}”`),
        fix: bi(
          "Перевірити вручну — саморобний розбір читає лише ведучі цифри.",
          "Check by hand — the hand-rolled parser reads only leading digits.",
        ),
      });
    }
  }
  return rows;
}

const РЯДКОВІ_АДАПТЕРИ: Record<string, (data: unknown) => ReportRow[]> = {
  color_audit: rowsFromColor,
  geometry_audit: rowsFromGeometry,
  pagination_audit: rowsFromPagination,
  preflight_document: rowsFromPreflight,
  styles_audit: rowsFromStyles,
  bibliography_audit: rowsFromBibliography,
  spelling_audit: rowsFromSpelling,
  __cli_extras: rowsFromExtras,
};

/**
 * Ділить рядки на «критичне»/«важливе» за СПРАВЖНІМ прапорцем ПРОХОДУ
 * (`Pass.critical`, з `planPasses`), а не за вгаданим списком родин:
 * конфіг може підняти будь-яку родину до critical (`plan.ts`,
 * `налаштування.critical === true`) — і саме той самий прапорець керує
 * кодом виходу через `hasCritical`. Бакет тут і ворота там мусять
 * СПІВПАДАТИ, інакше «важливе» в цьому звіті може виявитись тим самим,
 * що зупинило вихідний код.
 */
function зібратиРядки(m: Measurements, passes: Pass[]): { crit: ReportRow[]; major: ReportRow[] } {
  const crit: ReportRow[] = [];
  const major: ReportRow[] = [];
  const вироки = judgePasses(m);
  for (const [i, p] of m.passes.entries()) {
    const критично = passes.find((pp) => pp.id === p.id)?.critical === true;
    const кошик = критично ? crit : major;
    // Довжина `вироки` дорівнює `m.passes` за побудовою `judgePasses`.
    const вирок = вироки[i]!;

    /*
     * I6 (фінальна рецензія, Important): прохід, чиї знахідки є, але
     * рядкового адаптера немає (`typography_audit`, `layout_audit`,
     * `composition_audit`), більше не зникає з ТАБЛИЦІ так само, як він уже
     * не зникає з секцій (R20). Інакше шапка називала одне число, «Потребує
     * очей» — інше, а таблиця не показувала нічого, і читач не мав як їх
     * звести. Число тут — з ТОГО САМОГО вироку, що й у шапці й у секціях.
     */
    if (вирок.extract !== null && вирок.extract.unconfirmed.length > 0) {
      кошик.push({
        pages: [],
        what: bi(
          `${p.id} (${p.tool}): вимір НЕ підтверджений приладом`,
          `${p.id} (${p.tool}): the measurement is NOT confirmed by the instrument`,
        ),
        evidence: same(вирок.extract.unconfirmed.join(" ")),
        fix: bi(
          "Усунути причину й повторити прогін: число цієї родини нічого не стверджує, доки причина стоїть.",
          "Remove the cause and repeat the run: this family's number asserts nothing while the cause stands.",
        ),
      });
    }

    if (!p.ok || p.data === null) continue;
    const адаптер = РЯДКОВІ_АДАПТЕРИ[p.tool];
    if (адаптер !== undefined) {
      кошик.push(...адаптер(p.data));
      continue;
    }
    if (вирок.extract !== null && вирок.extract.count > 0 && вирок.extract.unconfirmed.length === 0) {
      кошик.push({
        pages: [],
        what: bi(
          `${p.id} (${p.tool}): ${вирок.extract.count} знахідок без поіменних адрес`,
          `${p.id} (${p.tool}): ${вирок.extract.count} findings without by-name addresses`,
        ),
        evidence: bi(
          `${вирок.extract.measured}. Форма відповіді цього інструмента не несе сторінки на знахідку.`,
          `${вирок.extract.measured}. This tool's response shape does not carry a page per finding.`,
        ),
        fix: bi(
          "Поіменний перелік — у файлі вимірів (measurements.json), у розділі цього проходу.",
          "The by-name listing is in the measurements file (measurements.json), in this pass's section.",
        ),
      });
    }
  }
  return { crit, major };
}

/* ==========================================================================
 * Складання HTML із шаблону. Порядок операцій ВАЖЛИВИЙ: спершу заміна
 * <tbody> (яка забирає з собою приклади-плейсхолдери всередині рядків
 * шаблону — {{СТОР}}, {{ЩО_НЕ_ТАК}} тощо, разом узятих), потім заміна
 * блока «чисто», і лише НАПРИКІНЦІ — крапкові заміни решти токенів.
 * Зробити навпаки означало б ловити позиційні токени (напр. {{ДАТА}}),
 * які трапляються і в прикладах рядків, і в шапці — а прибрати приклад
 * рядка ДО крапкової заміни й є спосіб уникнути цієї плутанини без
 * regex-магії з номерами збігів.
 * ========================================================================== */

function замінитиTbody(html: string, sectionId: string, вмістРядків: string): string {
  const шаблон = new RegExp(`(<section id="${sectionId}">[\\s\\S]*?<tbody>)[\\s\\S]*?(<\\/tbody>)`);
  if (!шаблон.test(html)) {
    throw new Error(`The report template has changed: no <tbody> was found in the section “${sectionId}”.`);
  }
  return html.replace(шаблон, (_збіг, відкриття: string, закриття: string) => `${відкриття}\n${вмістРядків}\n${закриття}`);
}

/** Рядок «Питання до друкарні» — ІНША форма колонок за ReportRow (немає «Сторінки», дві «fix»-колонки), тож окремий рендерер. */
function renderPrintRows(family: string, items: Sections["needsEyes"]): string {
  return items
    .map(
      (it, i) =>
        `<tr>` +
        `<td class="chk"><input type="checkbox" data-k="${escapeHtml(dataKey(family, i + 1))}"></td>` +
        `<td class="what"><strong ${biCell(it.topic)}</strong></td>` +
        `<td class="fix" ${biCell(it.detail)}</td>` +
        `<td class="fix" ${biCell(bi("Уточнити з друкарнею.", "Clarify with the print shop."))}</td>` +
        `</tr>`,
    )
    .join("\n");
}

/**
 * Переддрукарський чекліст живе в скілі `print-audit-report`
 * (`~/.claude/skills/...`), якого CLI НЕ читає навмисно (спек §3, §7,
 * `template.ts`: «на іншій машині цього немає»). Тому тут — не вигаданий
 * набір пунктів, а ОДИН чесний рядок-пояснення без чекбокса (щоб не
 * псував лічильник прогресу трекера числом, якого користувач не може
 * «закрити»).
 */
function рядокПрогалиниПрепресу(): string {
  return (
    `<tr>` +
    `<td class="chk"></td>` +
    "<td class=\"pages\"><span class=\"pg\">checklist</span></td>" +
    "<td class=\"what\"><strong>The checklist was not loaded by this run</strong>" +
    "<span>The items live in the print-audit-report skill; this CLI deliberately does not read them — on another machine the skill is absent.</span></td>" +
    "<td class=\"fix\">Go through the checklist separately, with the print-audit-report skill.</td>" +
    `</tr>`
  );
}

/**
 * Кожен рядок «параметрів, якими міряв» — ВЛАСНИЙ `<span>` (рулінг R37).
 * `.clean span` у шаблоні — це `display:block` моноширинний підпис, тож два
 * рядки стають двома блоками без жодного нового класу; половина «задано в
 * конфігу» і половина «замовчування інструмента» читаються як дві, а не як
 * один довгий хвіст при назві інструмента.
 *
 * `escapeHtml` — по разу на кожен рядок: у параметрах їдуть назви стилів із
 * документа (спек §7), а `describeParams` навмисно віддає чистий текст.
 */
function замінитиCleanБлок(html: string, clean: Sections["clean"]): string {
  const шаблон = /<div class="clean">[\s\S]*?\n {2}<\/div>/;
  if (!шаблон.test(html)) throw new Error("The report template has changed: the .clean block was not found.");
  const внутрішнє =
    clean.length > 0
      ? clean
          .map(
            (it) =>
              `    <div><b>✓</b><div><span ${biCell(it.what)}</span> (<span ${biCell(it.params)}</span>)` +
              `<span ${biCell(it.measured)}</span>` +
              it.paramLines.map((рядок) => `<span ${biCell(рядок)}</span>`).join("") +
              `</div></div>`,
          )
          .join("\n")
      : `    <div><b>✓</b><div><span ${biCell(bi("Нічого перевіреного з нульовим результатом у цьому прогоні немає", "Nothing checked with a zero result in this run"))}</span><span>—</span></div></div>`;
  return html.replace(шаблон, `<div class="clean">\n${внутрішнє}\n  </div>`);
}

/** Позиційна заміна: N-те входження `токен` — на N-те значення з `значення`, у порядку появи в тексті. */
function замінитиПоЧерзі(html: string, токен: string, значення: string[]): string {
  let результат = html;
  let від = 0;
  for (const в of значення) {
    const індекс = результат.indexOf(токен, від);
    if (індекс === -1) {
      throw new Error(`Token ${токен} occurs less often than the number of values expected (${значення.length}).`);
    }
    результат = результат.slice(0, індекс) + в + результат.slice(індекс + токен.length);
    від = індекс + в.length;
  }
  return результат;
}

function знайтиДані<T>(m: Measurements, tool: string): T | null {
  const p = m.passes.find((pp) => pp.tool === tool && pp.ok && pp.data !== null);
  return p ? (p.data as T) : null;
}

/**
 * `Overset` — факт тільки коли правило справді УВІМКНЕНО в профілі
 * preflight (`[Basic]` вмикає лише 6 із 38 правил, `preflight/types.ts`).
 * Вимкнене правило дає «н/д», а НЕ мовчазний нуль: нуль від вимкненого
 * правила невідрізненний від «не питали» (та сама пастка, що дала 45
 * хибних знахідок в іншому місці цього CLI).
 */
function overset(preflight: PreflightReport | null): Bi {
  if (preflight === null) return bi("н/д", "n/a");
  if (preflight.disabledRuleIds.some((id) => id.toLowerCase().includes("overset"))) {
    return bi("н/д (правило вимкнено)", "n/a (rule disabled)");
  }
  const сума = preflight.findings
    .filter((f) => f.rule.toLowerCase().includes("overset"))
    .reduce((s, f) => s + f.occurrenceCount, 0);
  /* Число мовою не відрізняється. */
  return same(String(сума));
}

/**
 * I5 (рулінг R42, «дешевий виняток»): `overset` — контрольне число §10, і
 * воно ВЖЕ обчислюється, лише жило винятково в HTML. `measurements.json` —
 * окремий артефакт, яким порівнюються два прогони (спек §4.2), тож число,
 * якого в ньому немає, з прогону в прогін порівняти нічим.
 *
 * Обчислення ОДНЕ — функція `overset` вище. Ця обгортка лише знаходить для
 * неї прохід. Другого місця, де overset рахувався б інакше, немає й не
 * з'явиться: R22 виник саме з такої пари.
 */
export function oversetЗВимірів(m: Measurements): Bi {
  return overset(знайтиДані<PreflightReport>(m, "preflight_document"));
}

/**
 * I3: «формат не виміряно» був ЖОРСТКО ВПИСАНИМ рядком, тоді як формат
 * виміряно — `ExtrasMeasure.pageFormat` (`src/cli/measure/extras.ts:28`,
 * заповнює `src/jsx/cli-extras.jsx:205-206`), і `summariseExtras` друкував
 * його ж («Формат сторінки: 190 × 220 pt» — до округлення, доданого раундом
 * 1 нижче) в іншій секції ТОГО САМОГО звіту. Шапка суперечила тілу.
 *
 * Одиниця береться з виміру (`units`), а не перекладається: перекладення з
 * непроговореною одиницею вже раз дало тиху помилку в цьому проєкті (C2,
 * Фаза 9).
 *
 * Коли доміру не було (родина `extras` незастосовна, прохід упав) — чесне
 * «формат не виміряно» лишається, бо тоді воно ПРАВДА.
 *
 * Раунд виправлень 1, знахідка контролера №2 (живий прогін): числа йшли в
 * шапку СИРИМИ — «538.582677165354 × 623.622047244095 pt, виліт
 * 8.50393700787402/…». Фізично правильно, для друкарні непридатно.
 *
 * Раунд виправлень 2, Minor 2: тепер це справді ОДНА функція на обидва
 * показники, а не два схожі. `форматСловами` (`src/cli/measure/extras.ts`,
 * поряд із самим виміром) складає розмір, `довжинаЧислом`/`довжинаОдиницею`
 * — кожну окрему довжину; картка «Перевірено чисто» кличе ті самі. Доти
 * спільним був лише `ммЗПунктів`, і на не-пунктовому вимірі плитка
 * друкувала сире число там, де картка друкувала округлене — пара «одна
 * величина, два форматування», з якої й виросли R22 та I6.
 *
 * Різниця показів ОДНА і названа параметром: у плитці немає пунктів у
 * дужках (вона вузька, `minmax(132px,1fr)`, а пункти того самого виміру
 * стоять поруч у картці «Формат сторінки» тієї ж сторінки). Одиниця
 * названа скрізь, тож ніхто не читає міліметри як пункти.
 */
export function форматСторінки(m: Measurements): Bi {
  const extras = знайтиДані<ExtrasMeasure>(m, "__cli_extras");
  const f = extras?.pageFormat;
  if (f === undefined) return bi("формат не виміряно", "format not measured");
  const розмір = форматСловами(f, { пунктиВДужках: false });
  const виліт = extras?.bleed;
  /* Самі числа мовою не відрізняються — відрізняється лише слово «виліт». */
  if (виліт === undefined) return same(розмір);
  const в = (pt: number): string => довжинаЧислом(pt, f.units);
  const числа =
    `${в(виліт.top)}/${в(виліт.bottom)}/` +
    `${в(виліт.inside)}/${в(виліт.outside)} ${довжинаОдиницею(f.units)}`;
  return bi(`${розмір}, виліт ${числа}`, `${розмір}, bleed ${числа}`);
}

/**
 * Складає готовий HTML звіту з шаблону й РЕАЛЬНИХ вимірів.
 *
 * ЧЕСНІСТЬ ПО ПЛЕЙСХОЛДЕРАХ (35 унікальних у `report.html`, перелік — у
 * звіті задачі): кожен або замінюється СПРАВЖНІМ числом/текстом із `m`,
 * або — коли даних просто немає в жодному з зібраних інструментів
 * (формат сторінки, максимальна виміряна фарба, переддрукарський
 * чекліст) — чесним рядком на кшталт «н/д» чи поясненням, чому саме.
 * Жоден токен `{{...}}` не лишається в готовому HTML незамінним.
 */
export function buildReportHtml(cfg: AuditConfig, m: Measurements, passes: Pass[]): string {
  const sections = deriveSections(m);
  const { crit, major } = зібратиРядки(m, passes);

  let html = loadTemplate();

  /* 1. <tbody> секцій — ПЕРШИМИ, забирають приклади-плейсхолдери разом. */
  html = замінитиTbody(html, "crit", renderRows("crit", crit));
  html = замінитиTbody(html, "major", renderRows("major", major));
  html = замінитиTbody(html, "prepress", рядокПрогалиниПрепресу());
  html = замінитиTbody(html, "print", renderPrintRows("print", sections.needsEyes));

  /* 2. Блок «чисто». */
  html = замінитиCleanБлок(html, sections.clean);

  /* 3. Решта — крапкові й позиційні заміни. */
  const дата = m.startedAt.slice(0, 10);
  const overview = знайтиДані<DocOverviewResponse>(m, "doc_overview");

  const критичніРодини = passes.filter((p) => p.critical).map((p) => p.id);
  const pageCountStr = overview !== null ? same(String(overview.pageCount)) : bi("н/д", "n/a");
  /*
   * I6: числа шапки — зі СПІЛЬНОЇ функції `tallyFindings`, тієї самої, що
   * живить секції й ворота. Раніше тут стояло `crit.length`/`major.length`
   * — довжини ТАБЛИЦЬ, у яких немає рядків для `typography_audit`,
   * `layout_audit` і `composition_audit`: на живому прогоні quotes-uk 8 і
   * space-before-break 1 у «Важливих» не рахувались узагалі, а «Потребує
   * очей» для тих самих проходів показувало своє число. Одна величина,
   * два різні числа в одному документі — і читач вірить шапці.
   */
  const критичніІдентифікатори = new Set(passes.filter((p) => p.critical).map((p) => p.id));
  const підсумок = tallyFindings(m, критичніІдентифікатори);
  const критичнихN = String(підсумок.критичних);
  const важливихN = String(підсумок.важливих);
  const чистоN = String(sections.clean.length);
  /*
   * I2 (рулінг R46): число, якого шапка доти не друкувала взагалі. Ворота
   * запалює й родина, яку не виміряли ЗОВСІМ (`hasCritical`, `sections.ts`),
   * а «Критичних» при цьому чесно лишається 0 — знахідок немає, бо не було
   * виміру. Шапка без цього числа суперечила б кодові виходу: «нуль
   * критичних» на прогоні, який частини макета не бачив.
   */
  const невиміряноN = String(підсумок.непідтверджених);
  const oversetStr = oversetЗВимірів(m);
  /*
   * I5/R42: числа тут немає, бо його не міряє жоден прохід — і сама
   * прогалина названа в «Чого перевірка НЕ бачила» (`ЗАВЖДИ_НЕ_БАЧИЛИ`,
   * `sections.ts`), із переліком того, що довелося б збудувати. Знак «%»
   * стоїть у самому шаблоні, який везеться байт у байт зі скіла (спек §7,
   * тест звірки), тож клітинка читається «н/д %» — правити її можна лише
   * правкою шаблона, а це розійшло б копію з оригіналом.
   */
  const максФарбаStr = bi("н/д", "n/a");

  /*
   * I2: сама плитка «Не виміряно» каже СКІЛЬКИ, але не каже, ЧОМУ звіт не
   * можна читати як «готово». Це речення каже — і лише тоді, коли є що
   * казати: критична родина без виміру. Слова «непідтверджений» тут немає
   * навмисно — читає це людина в друкарні, а не автор коду.
   *
   * Речення НЕ друкується, коли невиміряними лишились тільки НЕкритичні
   * проходи: ворота в цьому разі й не горять, а попередження, яке
   * з'являється при закритих воротах, читач навчиться проминати — рівно те,
   * що §6.4 забороняє воротам. Живий приклад такого стану: `layout`, який
   * віддав число, але сам оголосив 41 незвірену групу властивостей —
   * некритична родина, плитка «Не виміряно» показує 1, код виходу цим не
   * міняється, речення мовчить, а причина стоїть у «Чого перевірка НЕ
   * бачила» дослівно.
   */
  const безВиміру = підсумок.критичніБезВиміру;
  const попередженняПроНевимір: Bi =
    безВиміру.length === 0
      ? bi("", "")
      : bi(
          ` УВАГА: критичних перевірок без результату — ${String(безВиміру.length)} ` +
            `(${безВиміру.join(", ")}). Ці ділянки макета не перевірено ніяк, тому нуль у графі ` +
            "«Критичних» означає тут «не дивились», а не «чисто» — саме через це прогін " +
            "завершено як критичний. Причина кожної названа в розділі «Чого перевірка НЕ бачила»: " +
            "прохід не виконався, віддав порожні дані, звіт не зміг прочитати його відповідь, " +
            "або прилад сам сказав, що прочитав не все.",
          ` NOTE: critical checks without a result — ${String(безВиміру.length)} ` +
            `(${безВиміру.join(", ")}). These areas of the layout were not checked in any way, so a zero in the ` +
            "“Critical” column here means “we did not look”, not “clean” — that is precisely why the run " +
            "finished as critical. The reason for each is named in the section “What the check did NOT see”: " +
            "the pass did not run, returned empty data, the report could not read its response, " +
            "or the instrument itself said it had not read everything.",
        );

  const переліктІнструментів = passes.map((p) => {
    if (p.tool === "color_audit") return `color_audit(maxTotalInk=${cfg.print.maxTotalInk}%)`;
    if (p.tool === "geometry_audit") return `geometry_audit(minPpi=${cfg.print.minPpi})`;
    return p.tool;
  });
  const переліктІнструментівУнікальний = [...new Set(переліктІнструментів)].join(", ");

  html = html
    /* <title> несе українську назву: так її бачить друкарня у вкладці й у
     * збереженому PDF. Англійська чекає в data-title-en на <html>, і кнопка
     * міняє document.title разом з усім іншим. */
    .replace("{{REPORT_TITLE}}", escapeHtml(`${cfg.edition.title} — передпольотний аудит, ${дата}`))
    .replace("{{REPORT_TITLE_EN}}", escapeHtml(`${cfg.edition.title} — preflight audit, ${дата}`))
    .replace("{{CHECK_TYPE}}", biSpan(bi("Передпольотна перевірка", "Preflight check")))
    .replace("{{APP_AND_VERSION}}", escapeHtml(`InDesign ${m.stamp.indesignVersion}`))
    .replace("{{DATE}}", escapeHtml(дата))
    .replace("{{LAYOUT_NAME}}", escapeHtml(cfg.edition.title))
    .replace("{{REPORT_KIND}}", biSpan(bi("автоматичний аудит перед друком", "automated audit before print")))
    .replace(
      "{{ONE_PARAGRAPH: what was run, with how many measurements, and what is below}}",
      biSpan(
        bi(
          `Прогнано ${String(passes.length)} проходів автоматичного аудиту ` +
            `(${String(критичніРодини.length)} критичних родин: ${критичніРодини.join(", ")}). ` +
            "Нижче: критичне, важливе, переддрукарський чекліст, питання до друкарні, і що перевірено чисто." +
            попередженняПроНевимір.uk,
          `Ran ${String(passes.length)} passes of the automated audit ` +
            `(${String(критичніРодини.length)} critical ` +
            `famil${критичніРодини.length === 1 ? "y" : "ies"}: ${критичніРодини.join(", ")}). ` +
            "Below: critical, important, the prepress checklist, questions for the print shop, and what checked clean." +
            попередженняПроНевимір.en,
        ),
      ),
    );

  /* Числа мовою не відрізняються й ідуть як є; «н/д» відрізняється, тож воно
   * їде двомовним прогоном, який кнопка перемикає разом з усім іншим. */
  html = замінитиПоЧерзі(html, "{{N}}", [
    pageCountStr.uk === pageCountStr.en ? pageCountStr.uk : biSpan(pageCountStr),
    критичнихN,
    важливихN,
    чистоN,
    невиміряноN,
    oversetStr.uk === oversetStr.en ? oversetStr.uk : biSpan(oversetStr),
    biSpan(максФарбаStr),
    чистоN,
    "0",
  ]);
  html = html.replace("{{FORMAT}}", biSpan(форматСторінки(m)));

  html = html.replace(
    "{{WHY_THESE_ITEMS_ARE_HERE}}",
    biSpan(
      критичніРодини.length > 0
        ? bi(
            `Родини ${критичніРодини.join(", ")} позначено критичними: вони зупиняють друк.`,
            `Families ${критичніРодини.join(", ")} are marked critical: they stop the press.`,
          )
        : bi(
            "У цьому прогоні критичних родин не оголошено.",
            "No critical families were declared in this run.",
          ),
    ),
  );
  html = html.replace(
    "{{Setting defects and consistency. Does not stop the press, but is visible to the eye.}}",
    biSpan(
      bi(
        "Набірні й системні дефекти важливих (некритичних) родин. Не зупиняє друк, але видно оку.",
        "Setting and consistency defects of important (non-critical) families. Does not stop the press, but is visible to the eye.",
      ),
    ),
  );

  html = html.replace(
    "{{LIST}}",
    biSpan(
      sections.clean.length > 0
        ? bi("усе перелічено картками вище.", "everything is listed in the cards above.")
        : bi("нічого — жоден прохід не дав нуля.", "nothing — not one pass returned a zero."),
    ),
  );
  html = html.replace(
    "{{WHICH_RULES_ARE_DISABLED, WHAT_IS_UNREACHABLE_TO_THE_SCRIPT, WHICH_SURFACES_WERE_NOT_WALKED}}",
    sections.notSeen
      .map((n) => `<b ${biCell(n.source)}</b>: <span ${biCell(n.detail)}</span>`)
      .join("<br>\n"),
  );

  html = html
    .replace(
      "{{FILE, APP, DATE}}",
      escapeHtml(`${m.stamp.docPath} (${m.stamp.docName}), InDesign ${m.stamp.indesignVersion}, ${дата}`),
    )
    .replace("{{LIST_WITH_PARAMETERS}}", escapeHtml(переліктІнструментівУнікальний))
    .replace("{{Whether anything was written to the document}}", biSpan(bi("Чи писали в документ", "Whether anything was written to the document")))
    .replace(
      "{{If not — say so. If yes — what exactly, and whether it was saved.}}",
      biSpan(
        bi(
          "Ні. Аудит лише читає документ: мутуючі інструменти (typography_apply, pagination_apply, " +
            "composition_apply, corrections_apply, corrections_plan) до збору не увійшли (src/cli/collect.ts).",
          "No. The audit only reads the document: the mutating tools (typography_apply, pagination_apply, " +
            "composition_apply, corrections_apply, corrections_plan) were not included in the collection (src/cli/collect.ts).",
        ),
      ),
    );

  return html;
}

/* ==========================================================================
 * Точка входу.
 * ========================================================================== */

/**
 * ПРИБИРАННЯ ЗА СОБОЮ — обидві дії, в одному місці, на всіх шляхах виходу.
 *
 * I8 (фінальна рецензія, Important): `release()` стояв ЛИШЕ на двох шляхах
 * — успішному й на відмові ступеня 2. Виклик `callTool(doc_overview)` живе
 * ПОЗА внутрішнім `try`, тож будь-який збій мосту між `openSession` і
 * `executePasses` ішов у `catch` → EXIT.ENVIRONMENT, а `finally` повертав
 * лише активний документ. Документ, який CLI ВІДКРИВ САМ, лишався
 * відкритим — усупереч §6.1 («не відкрито → відкрити, виміряти, закрити
 * БЕЗ збереження»), — і `measurements.json` про це не казав нічого, бо
 * його ще не писали.
 *
 * ЗАКРИТТЯ ПЕРШЕ, ПОВЕРНЕННЯ АКТИВНОГО ДРУГЕ: закриття міняє те, який
 * документ спереду, тож повернути попередній активний після нього — єдиний
 * порядок, за якого середовище справді лишається таким, яким було.
 *
 * НІЧОГО НЕ КИДАЄ. Викликається з `finally`, де кинуте затерло б і код
 * виходу, і причину справжньої відмови. Тому збій закриття — попередження,
 * а не відмова: вимір уже зроблено (або вже провалено з власної причини).
 *
 * Окремою функцією — щоб цю послідовність можна було перевірити тестом, а
 * не лише прочитати: рецензія ловила саме те, що на одному з шляхів її
 * половини не було.
 */
export async function прибратиЗаСобою(
  session: SessionHandle,
  попередити: (рядок: string) => void,
): Promise<void> {
  try {
    await session.release();
  } catch (e) {
    попередити(
      "Warning: could not close the document this run opened " +
        `(${e instanceof Error ? e.message : String(e)}). It has been left open.`,
    );
  }
  if (session.stamp.releaseSkippedReason !== null) {
    попередити(`Warning: ${session.stamp.releaseSkippedReason}`);
  }

  const збійПовернення = await session.restoreActiveDocument();
  if (збійПовернення !== null) попередити(`Warning: ${збійПовернення}`);
}

/**
 * `--documents`: що зараз відкрито в InDesign, по рядку на документ.
 *
 * Формат — `ім'я<TAB>шлях`, шлях порожній для документа, який ще не
 * зберігали. Машиночитно навмисно: це вхід для запускача, а не звіт для
 * людини.
 *
 * ІМ'Я НОРМАЛІЗУЄТЬСЯ ДО NFC. InDesign віддає його в тій формі, у якій
 * воно лежить у файловій системі, і на macOS це часто NFD — виміряно на
 * «02 Зоряні Мрії…», де «ї» стоїть як U+0456 + U+0308. Запускач
 * зіставлятиме це ім'я з конфігами; без зведення форм зіставлення дає
 * false на рядках, які виглядають однаково, і меню показувало б «конфіга
 * немає» для документа, конфіг якого лежить поруч.
 */
/**
 * Роздільник полів у `--documents` — U+001F (UNIT SEPARATOR), НЕ табуляція.
 *
 * Виміряно на живому запуску: таб належить до IFS-ПРОБІЛЬНИХ символів, і
 * `read` у zsh склеює два підряд в один роздільник. Для незбереженого
 * документа шлях порожній, тобто в рядку стоять два таби поспіль — поля
 * з'їжджали, і в запускач замість ШЛЯХУ до конфіга потрапляла НАЗВА
 * видання. Перевірка «чи є конфіг» при цьому проходила (рядок непорожній),
 * тож прогін пішов би зі сміттям замість конфіга й упав би далеко від
 * причини.
 *
 * U+001F не пробільний, тож порожні поля зберігаються, і в назві файлу
 * трапитись він не може за побудовою файлової системи.
 */
const РОЗДІЛЮВАЧ = "";

async function перелічитиДокументи(box: ToolBox, тека: string | null): Promise<number> {
  try {
    const стан = await callTool<{ documents: { name: string; fullName: string | null }[] }>(
      box,
      "indesign_status",
      {},
    );
    const конфіги = тека === null ? [] : прочитатиКонфіги(тека);
    for (const d of стан.documents) {
      const назва = d.name.normalize("NFC");
      const шлях = d.fullName === null ? "" : normalizePathForComparison(d.fullName);
      const конфіг = зіставитиКонфіг(конфіги, назва, шлях);
      process.stdout.write(
        `${назва}${РОЗДІЛЮВАЧ}${шлях}${РОЗДІЛЮВАЧ}${конфіг?.шлях ?? ""}${РОЗДІЛЮВАЧ}${конфіг?.назва ?? ""}\n`,
      );
    }
    return EXIT.CLEAN;
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    return EXIT.ENVIRONMENT;
  }
}

interface ЗнайденийКонфіг {
  шлях: string;
  назва: string;
  docPath: string;
}

/** Конфіги теки, з яких вдалося прочитати `edition`. Биті — мовчки повз. */
function прочитатиКонфіги(тека: string): ЗнайденийКонфіг[] {
  let імена: string[];
  try {
    імена = readdirSync(тека).filter((n) => n.endsWith(".json")).sort();
  } catch {
    return [];
  }
  const знайдені: ЗнайденийКонфіг[] = [];
  for (const ім of імена) {
    const шлях = join(тека, ім);
    try {
      const сире = JSON.parse(readFileSync(шлях, "utf8")) as {
        edition?: { title?: unknown; docPath?: unknown };
      };
      const docPath = сире.edition?.docPath;
      const назва = сире.edition?.title;
      if (typeof docPath !== "string" || typeof назва !== "string") continue;
      знайдені.push({ шлях, назва, docPath });
    } catch {
      /* Нечитаний конфіг — не привід валити перелік: решта відкритих
       * документів однаково потребує відповіді. */
    }
  }
  return знайдені;
}

/**
 * Який конфіг описує ЦЕЙ відкритий документ.
 *
 * Порядок точний: спершу повний шлях (тотожність документа — саме шлях,
 * R10/R23), і лише коли документ ще не зберігали — ім'я файлу, бо шляху
 * в нього не існує. Обидва порівняння в NFC: назви приходять із файлової
 * системи, а там на macOS буває розкладена форма.
 */
export function зіставитиКонфіг(
  конфіги: ЗнайденийКонфіг[],
  назваДокумента: string,
  шляхДокумента: string,
): ЗнайденийКонфіг | null {
  if (шляхДокумента !== "") {
    const заШляхом = конфіги.find(
      (c) => normalizePathForComparison(c.docPath) === шляхДокумента,
    );
    if (заШляхом !== undefined) return заШляхом;
  }
  const ціль = назваДокумента.normalize("NFC");
  return конфіги.find((c) => basename(c.docPath).normalize("NFC") === ціль) ?? null;
}

/**
 * `--init`: чернетка конфіга з відкритого документа.
 *
 * Окремою функцією, а не гілкою всередині `main`, бо спільного з аудитом у
 * неї лише міст: проходів не планує, вимірів не пише, воріт не має. Єдиний
 * виклик до InDesign — `doc_overview`, той самий, яким ступінь 2 звіряє
 * стилі; нової поверхні JSX збірщик не додає.
 */
async function запуститиЗбірщик(args: Args, box: ToolBox): Promise<number> {
  let шлях = args.doc;
  if (шлях === null) {
    /*
     * Документ не названо — беремо єдиний відкритий. Саме ЄДИНИЙ: коли їх
     * кілька, вибір за оператором, і «візьму перший-ліпший» тут дало б
     * чернетку не тієї книжки, яку помітили б уже після заповнення стилів.
     */
    const стан = await callTool<{ documents: { name: string; fullName: string | null }[] }>(
      box,
      "indesign_status",
      {},
    );
    if (стан.documents.length === 0) {
      process.stderr.write("No document is open in InDesign — there is nothing to draft a config from.\n");
      return EXIT.ENVIRONMENT;
    }
    if (стан.documents.length > 1) {
      const перелік = стан.documents.map((d) => `«${d.name}»`).join(", ");
      process.stderr.write(
        `Open: ${стан.documents.length} documents (${перелік}) — name the target one with --doc.
`,
      );
      return EXIT.ENVIRONMENT;
    }
    const єдиний = стан.documents[0]!;
    шлях = єдиний.fullName ?? єдиний.name;
  }

  let session: SessionHandle | undefined;
  try {
    session = await openSession(box, шлях);
    const overview = await callTool<DocOverviewResponse>(box, "doc_overview", {});
    const паспорт = {
      docName: overview.name,
      /* R23: InDesign віддає шлях сирим — тильда, percent-encoding, NFD.
       * У конфіг має лягти те, що людина прочитає й упізнає, тож ведемо
       * його крізь ту саму нормалізацію, якою сеанс порівнює шляхи: одне
       * правило, а не друге поруч. */
      fullName: overview.fullName === null ? null : normalizePathForComparison(overview.fullName),
      pageCount: overview.pageCount,
      paragraphStyles: overview.paragraphStyles,
    };
    /* `parseArgs` вимагає --out поза режимом --documents; тут звуження типу. */
    writeFileSync(args.out!, `${JSON.stringify(scaffoldConfig(паспорт), null, 2)}\n`, "utf8");
    process.stderr.write(`${підказкаСтилів(паспорт)}

Draft: ${args.out}\n`);
    return EXIT.CLEAN;
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    return EXIT.ENVIRONMENT;
  } finally {
    /* R41 крок 4: документ, що був спереду, має бути спереду й після — і в
     * збірщику теж. Він читальний, але активний документ перемикає так само. */
    if (session !== undefined) {
      await прибратиЗаСобою(session, (рядок) => process.stderr.write(`${рядок}\n`));
    }
  }
}

async function main(): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    return EXIT.CONFIG;
  }

  /* R21 (рецензія задачі 12): документація в коді не доходить до
   * оператора, який набрав прапорець. `--restart-indesign` розібраний, але
   * без дії — жоден готовий модуль перезапуску не надає; сказати про це
   * ТРЕБА оператору в stderr, а не лише в коментарі, якого він не читає. */
  if (args.restartIndesign) {
    process.stderr.write(
      "The --restart-indesign flag was accepted, but does nothing: restarting InDesign is not implemented in this version of the CLI.\n",
    );
  }

  if (args.documents) return перелічитиДокументи(collectTools(), args.configsDir);
  if (args.init) return запуститиЗбірщик(args, collectTools());

  let cfg: AuditConfig;
  try {
    /* `parseArgs` уже відмовив, коли --config не названо поза --init; тут
     * звуження типу, а не друга перевірка тієї самої умови. */
    cfg = validateConfig(JSON.parse(readFileSync(args.config!, "utf8")));
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    return EXIT.CONFIG;
  }

  const box: ToolBox = collectTools();

  /* Ступінь 1, друга половина (R30): форма кожної родини проти СПРАВЖНЬОЇ
   * `inputSchema` її інструмента. Стоїть тут, а не після `openSession`, бо
   * коштує нуль — `collectTools()` лише складає обробники, InDesign не
   * торкається ніхто. Відмова тут — EXIT.CONFIG, як і решта ступеня 1. */
  try {
    await reconcileWithToolSchemas(cfg, box);
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    return EXIT.CONFIG;
  }

  const { passes, skipped } = planPasses(cfg);
  const шляхВимірів = args.measurements ?? `${args.out}.measurements.json`;

  /* I2: `--doc` перекриває `edition.docPath` (спек §6.1). Саме цей шлях іде
   * і в `openSession` (політика документа), і у відбиток середовища — тобто
   * прапорець СПРАВДІ обирає документ, а не лише приймається без дії. */
  const шляхДокумента = args.doc ?? cfg.edition.docPath;
  if (args.doc !== null) {
    process.stderr.write(`The document was taken from --doc: ${args.doc} (the config's edition.docPath was overridden).
`);
  }

  let session: SessionHandle | undefined;
  try {
    session = await openSession(box, шляхДокумента);

    /* R9: час роботи InDesign засобами ОС — доступний одразу, незалежно
     * від подальших проходів. Чесний `null`, коли platform не macOS. */
    session.stamp.sessionUptimeMs = виявитиЧасРоботиInDesign();

    process.stderr.write(
      `Document “${session.stamp.docName}” — ${session.stamp.wasAlreadyOpen ? "was already open, NOT closing it" : "opened by us"}` +
        `${session.stamp.modified ? ", has UNSAVED edits" : ""}\n`,
    );

    /* Ступінь 2 валідації (спек §5.3): ПІСЛЯ відкриття документа, ДО
     * важких проходів — ціна відмови тут одне відкриття, а не десять
     * хвилин прогону, який однаково впав би на невідповідних назвах
     * стилів. ConfigError тут — окрема відмова (EXIT.CONFIG), не збій
     * середовища: документ відкрився нормально, конфіг просто називає
     * стилі, яких у НЬОМУ немає. */
    const overview = await callTool<DocOverviewResponse>(box, "doc_overview", {});
    try {
      /* Задача G: `doc_overview` читає `app.activeDocument`, тож відмова
       * правдива лише щодо ТОГО документа, який справді опитали — і мусить
       * назвати його на ім'я. Без імені вона звинувачує конфіг у тому,
       * чого конфіг не робив: живий прогін 2026-08-16 сказав «У документі
       * стилю „Колонтитул v1“ немає», опитавши обкладинку, тоді як у
       * книжці цей стиль несуть 99 абзаців.
       *
       * Ім'я беремо з `overview.name`, а НЕ з `session.stamp.docName`: воно
       * приходить тим самим викликом, що й перелік стилів, тож називає
       * рівно той документ, з якого цей перелік знято. `stamp.docName` — це
       * документ, до якого сеанс ВВАЖАЄ, що приєднався; сьогодні вони
       * тотожні (сеанс вивів документ наперед і перевірив це виміром, R41),
       * але тотожність тут доводити нічим не треба — джерело під рукою. */
      reconcileWithDocument(
        cfg,
        [...overview.paragraphStyles, ...overview.characterStyles],
        overview.name,
      );
    } catch (e) {
      if (e instanceof ConfigError) {
        process.stderr.write(`${e.message}\n`);
        /* I8: `release()` тепер стоїть у `finally` — тут його кликати вдруге
         * не треба (він ідемпотентний, але другий виклик читав би стан
         * InDesign без потреби). */
        return EXIT.CONFIG;
      }
      throw e;
    }

    const m = await executePasses(box, passes, session.stamp, skipped, {
      onProgress: (l) => process.stderr.write(`${l}\n`),
      onPartial: async (часткові) => {
        /* R15: запис проміжного знімку НЕ сміє зупинити решту проходів.
         * Прогін триває 10–20 хвилин; втратити один знімок дешевше, ніж
         * дев'ять успішних проходів через збій диска на десятому. Тиша
         * тут заборонена — попередження в stderr обов'язкове. */
        try {
          writeFileSync(шляхВимірів, JSON.stringify(часткові, null, 2), "utf8");
        } catch (e) {
          process.stderr.write(
            "Warning: could not write the interim measurements snapshot " +
              `(${e instanceof Error ? e.message : String(e)}). The run CONTINUES.
`,
          );
        }
      },
    });

    /* I8: закриття лишається ТУТ (а не лише в `finally`) з однієї причини —
     * `release()` може виставити `stamp.releaseSkippedReason`, і воно мусить
     * устигнути у фінальний знімок вимірів нижче. Другий виклик у `finally`
     * — страховка для шляхів, куди виконання сюди не доходить; `release()`
     * ідемпотентний (прапорець `вжеЗвільнено`, `session.ts`), тож двічі
     * закриття не станеться й причина не перепишеться. */
    await session.release();

    /* R9: dictionaryPath — лише тепер, з відповіді проходу spelling_audit
     * (якщо він виконався й дав дані). */
    const spellingPass = m.passes.find((p) => p.tool === "spelling_audit" && p.ok && p.data !== null);
    if (spellingPass !== undefined) {
      m.stamp.dictionaryPath = витягнутиШляхиСловників(spellingPass.data);
    }
    /* I5/R42: overset — контрольне число §10; рахується РІВНО ТУТ і рівно
     * раз, і потрапляє у файл вимірів, а не лише в HTML. */
    /* У файл вимірів іде ПЛОСКИЙ рядок: це дані, а не показ, і структура
     * файла не мусить змінюватись через кнопку мови у звіті. Двомовну пару
     * звіт бере з `oversetЗВимірів` наново — вимір той самий. */
    m.overset = oversetЗВимірів(m).uk;
    /* Фінальний знімок — щоб щойно заповнені поля відбитку не загубились
     * у файлі вимірів, останній запис якого стався ДО цього моменту. */
    try {
      writeFileSync(шляхВимірів, JSON.stringify(m, null, 2), "utf8");
    } catch (e) {
      process.stderr.write(
        "Warning: could not write the final measurements snapshot " +
          `(${e instanceof Error ? e.message : String(e)}).\n`,
      );
    }

    const sections = deriveSections(m);
    const html = buildReportHtml(cfg, m, passes);
    writeFileSync(args.out!, html, "utf8");

    process.stderr.write(
      `Report: ${args.out}
Measurements: ${шляхВимірів}\n` +
        `Clean: ${String(sections.clean.length)} · Not seen: ${String(sections.notSeen.length)} · Needs eyes: ${String(sections.needsEyes.length)}\n`,
    );

    const критичніІдентифікатори = new Set(passes.filter((p) => p.critical).map((p) => p.id));
    return exitCodeFor(m, критичніІдентифікатори);
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    return EXIT.ENVIRONMENT;
  } finally {
    /* Задача G, R41 крок 4: документ, що був спереду до прогону, має бути
     * спереду й після — на ВСІХ трьох виходах (успіх, відмова ступеня 2,
     * збій середовища). Тому `finally`, а не рядок після кожного `return`:
     * прогін, що впав посередині й лишив спереду чужий документ, — та сама
     * неввічливість, лише тихіша.
     *
     * `restoreActiveDocument()` не кидає за контрактом: кинуте звідси
     * затерло б і код виходу, і повідомлення справжньої відмови. Коли
     * повернути не вдалось — це попередження, а не відмова: вимір уже
     * зроблено (або вже провалено з власної причини), і перебивати його
     * причину станом чужого вікна було б гірше. Коли ж `openSession` упав
     * ще до створення сеансу, він повернув активний документ сам. */
    if (session !== undefined) {
      await прибратиЗаСобою(session, (рядок) => process.stderr.write(`${рядок}\n`));
    }
  }
}

/**
 * Запуск лише як програма, не при імпорті з тесту.
 *
 * ЧОМУ НЕ `argv[1].endsWith("audit.js")`, ЯК БУЛО. Умова за ІМЕНЕМ ФАЙЛУ
 * хибна для будь-якого запуску, де точка входу зветься інакше, — і мовчки.
 * Виміряно на бандлі задачі P (`dist/indesign-audit.mjs`): `main()` не
 * викликався ЖОДНОГО разу, процес виходив із кодом **0**, тобто «чисто,
 * готово до друку», не зробивши перевірки взагалі. Це та сама форма відмови,
 * проти якої стоїть R46, лише гірша: там нуль брехав про невиміряну родину,
 * тут — про весь аудит.
 *
 * Порівняння REALPATH знімає це за побудовою й лишає обидві потрібні
 * відповіді: `dist/cli/audit.js` і запуск через `bin`-симлінк
 * `indesign-audit` розв'язуються в той самий файл (true), а vitest, який
 * імпортує цей модуль, має в `argv[1]` власний бінарник (false).
 */
export function isProgramEntry(
  argv1: string | undefined,
  moduleUrl: string,
  resolve: (p: string) => string = realpathSync,
): boolean {
  if (argv1 === undefined) return false;
  try {
    return resolve(argv1) === resolve(fileURLToPath(moduleUrl));
  } catch {
    /* Точка входу, якої немає на диску (`node --eval`, віртуальний модуль),
     * — не привід запускати аудит: мовчазний нуль дорожчий за незапуск. */
    return false;
  }
}

if (isProgramEntry(process.argv[1], import.meta.url)) {
  main().then((code) => process.exit(code));
}

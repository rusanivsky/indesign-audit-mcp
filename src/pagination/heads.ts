/**
 * The `runningHead` family — the running head. Pure TypeScript, and that's
 * exactly why it's testable without InDesign.
 *
 * NOT A SINGLE RULE HERE WAS DERIVED BY REASONING. Every one rests on
 * `docs/measured-facts-phase10.md` (probes `H10-A`…`H10-E`, 2026-08-14) and
 * is named at its own line.
 *
 * THIS FILE WAS DESIGNED BY PHASE 6 AND NOT BUILT BY IT: it cancelled the
 * family with a probe that walked `page.textFrames` and saw no running
 * heads at all, because they live on the parent pages. The instrument was
 * wrong, not the fact.
 */

import type {
  FamilyResult,
  HeadFrame,
  HeadingRef,
  PageRef,
  PaginationFinding,
} from "./types.js";

/**
 * Text for COMPARISON, not for display.
 *
 * Case is folded, because both running-head styles in this book have
 * `capitalization: ALL_CAPS` (measured, `H10-E`), i.e. on the sheet
 * «Вагітність» and «ВАГІТНІСТЬ» are the same. The rule about case isn't even
 * written because of this: without the measurement the phase would have
 * given eight false positives and called them a finding.
 *
 * Whitespace (including `\r` between paragraphs) is collapsed to one.
 *
 * THE DASH IS NOT TOUCHED. The en dash and em dash are different marks with
 * different meanings (`reference_bibliographic_description_dstu`), and
 * folding them would mean treating two different sets as the same.
 */
export function normalizeTitle(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * A chapter's span: from the page of its heading to the page before the next one.
 */
export interface ChapterSpan {
  /** Text glued together as typeset — for showing to the operator. */
  titleRaw: string;
  /** Normalized — for comparison. */
  title: string;
  startPage: string;
  startOffset: number;
  /** Inclusive. */
  endOffset: number;
}

/**
 * Chapter spans built from headings.
 *
 * GLUING ADJACENT PARAGRAPHS TOGETHER is not decoration, it's a condition
 * for the family to work at all. Measured (`H10-C`): a direct search for the
 * three chapter titles across the book's text finds **zero** occurrences,
 * because the heading is split across paragraph lines («Пологи —» +
 * «зустріч» + «з малюком»). Glued together, all three match the running
 * head EXACTLY. A family without the gluing would stay silent, and silence
 * reads as "all clear".
 *
 * Paragraphs are glued when they run CONSECUTIVELY by `order`, share THE
 * SAME style and THE SAME page. Matching style is mandatory: otherwise
 * "Chapter number" ("1") would stick to "Chapter title" and the reference
 * would become "1 вагітність — це новий світ", which appears in no running
 * head at all.
 *
 * A BOUNDARY, NAMED OUT LOUD (spec §6.2): two DIFFERENT headings of the same
 * style back to back on one page will glue into one. This book has no such
 * case (measured); the next one might, and then a parameter will be needed.
 *
 * A heading with no page (`page === null` — overset text) produces no span
 * at all: inventing a place for it would mean building the whole verdict on
 * a guess.
 */
export function chapterSpans(headings: HeadingRef[], pages: PageRef[]): ChapterSpan[] {
  const offsetOf = new Map<string, number>();
  for (const p of pages) offsetOf.set(p.name, p.offset);

  /* Document order is the only thing that orders headings (`HeadingRef.order`). */
  const ordered = [...headings].sort((a, b) => a.order - b.order);

  const groups: { styleName: string; page: string; parts: string[] }[] = [];
  for (const h of ordered) {
    if (h.page === null || !offsetOf.has(h.page)) continue;
    const last = groups[groups.length - 1];
    if (last !== undefined && last.page === h.page && last.styleName === h.styleName) {
      last.parts.push(h.text);
    } else {
      groups.push({ styleName: h.styleName, page: h.page, parts: [h.text] });
    }
  }

  if (groups.length === 0) return [];

  let lastOffset = -1;
  for (const p of pages) if (p.offset > lastOffset) lastOffset = p.offset;

  const spans: ChapterSpan[] = [];
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i]!;
    const start = offsetOf.get(g.page)!;
    const next = groups[i + 1];
    /*
     * `Math.max(start, …)` — ІНАКШЕ ДІАПАЗОН НЕ МІСТИТЬ ВЛАСНОЇ ПОЧАТКОВОЇ
     * СТОРІНКИ Й СТАЄ НЕДОСЯЖНИМ.
     *
     * Групи ключуються парою (сторінка, стиль), і збіг стилю обов'язковий за
     * побудовою — саме щоб «Номер розділу» і «Назва розділу» не злипалися
     * (докстрінг вище). Отже два заголовки різних стилів на ОДНІЙ сторінці
     * дають дві групи з тією самою сторінкою, і в першої `end = start − 1`.
     * `spanAt` вимагає `offset >= startOffset && offset <= endOffset`, тож
     * така група мертва: усі її сторінки дістаються наступному розділу, а
     * колонтитул, що правильно називає перший, звітується як
     * head-wrong-chapter проти другого.
     *
     * Обидва розділи починаються на одній сторінці, тож ця сторінка належить
     * обом за будь-яким прочитанням; `spanAt` віддає перший збіг. Головне —
     * що діапазон перестає бути порожнім.
     */
    const end =
      next === undefined ? lastOffset : Math.max(start, offsetOf.get(next.page)! - 1);
    const titleRaw = g.parts.join(" ").replace(/\s+/g, " ").trim();
    spans.push({
      titleRaw,
      title: normalizeTitle(titleRaw),
      startPage: g.page,
      startOffset: start,
      endOffset: end,
    });
  }
  return spans;
}

export interface HeadOptions {
  /**
   * Whether to compare the running head's text against the chapter title.
   *
   * `false` when `headingStyles` isn't declared: the rule then does NOT
   * silently keep quiet — the pages go into `notCompared`, and the report
   * says why (spec §7). Zero findings, indistinguishable from "checked and
   * clean", is exactly the fail-silent mode Phase 5 caught five times over.
   */
  compareChapter: boolean;
  /**
   * "This master gives a running head on this side" is derived from a
   * MEASUREMENT, not from a rule about the page number.
   *
   * WHY EXACTLY THIS, AND THIS IS THE USER'S DECISION (2026-08-14). The
   * book has 78 pages on the "Шаблон інтерв'ю" master with no running head,
   * and that's BY DESIGN. An expectation derived from "page inside a
   * chapter" would have reported on 39 verso pages and buried the real
   * findings. The tool cannot know the intent — so it doesn't decide for
   * the typesetter.
   */
  /**
   * СТОРОНИ, НА ЯКИХ ЦЕЙ МАЙСТЕР НЕСЕ КОЛОНТИТУЛ, — МНОЖИНА, А НЕ ОДНА.
   *
   * Ключем є ім'я майстер-РОЗВОРОТУ, а розворот має дві сторінки. Доти тут
   * лежала одна сторона, і `Map.set` у циклі просто затирав попередню: майстер
   * із колонтитулом і на верстці, і на звороті лишав ту, що трапилася
   * останньою. Далі `expectSide !== p.side` пропускав КОЖНУ сторінку другої
   * сторони, тож head-missing на них не спрацьовував ніколи — саме той клас
   * тихої втрати, заради якого існує master-island.
   */
  expectedByMaster: Map<string, ReadonlySet<PageRef["side"]>>;
}

/**
 * The family's reference — what side and appearance are compared against.
 *
 * `null` in a field means "no reference": no running head produced a
 * value, so there's nothing to compare against.
 */
export interface HeadReference {
  side: PageRef["side"] | null;
  font: string | null;
  pointSize: number | null;
  fillValue: string | null;
}

/**
 * The mode, ignoring `null`: "not read" doesn't vote for the reference.
 *
 * What's counted are ASSERTIONS (one per page), not frames: a master frame
 * that feeds 13 pages weighs into the mode in proportion to how many sheets
 * it determines — because the reference is exactly "what most SHEETS look
 * like".
 */
function mode<T>(values: (T | null)[]): T | null {
  const counts = new Map<T, number>();
  for (const v of values) {
    if (v === null) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: T | null = null;
  let bestN = 0;
  for (const [v, n] of counts) {
    if (n > bestN) {
      best = v;
      bestN = n;
    }
  }
  return best;
}

/**
 * The reference comes from the DOCUMENT, not from this layout (project §3.2).
 *
 * A constant like "the running head sits on verso" would flip in the very
 * first edition that places it the other way; the mode is portable by
 * construction.
 */
export function headReference(heads: HeadFrame[]): HeadReference {
  return {
    side: mode(heads.map((h) => h.side)),
    font: mode(heads.map((h) => h.appearance.font)),
    pointSize: mode(heads.map((h) => h.appearance.pointSize)),
    fillValue: mode(heads.map((h) => h.appearance.fillValue)),
  };
}

/** The span the page belongs to, or `null` — the page is outside any chapter. */
function spanAt(spans: ChapterSpan[], offset: number): ChapterSpan | null {
  for (const s of spans) if (offset >= s.startOffset && offset <= s.endOffset) return s;
  return null;
}

/**
 * The `runningHead` family: checked assertions, unchecked ones, and findings.
 */
export function detectHeads(
  pages: PageRef[],
  heads: HeadFrame[],
  spans: ChapterSpan[],
  opts: HeadOptions,
): FamilyResult {
  const offsetOf = new Map<string, number>();
  for (const p of pages) offsetOf.set(p.name, p.offset);

  const findings: PaginationFinding[] = [];
  let checked = 0;
  let notCompared = 0;

  for (const h of heads) {
    const offset = offsetOf.get(h.page);
    /* No page with this name exists in the measurement — nothing to compare against. */
    if (offset === undefined) {
      notCompared++;
      continue;
    }

    if (!opts.compareChapter) {
      notCompared++;
      continue;
    }

    /*
     * ЖОДНОГО ДІАПАЗОНУ В ДОКУМЕНТІ — ЦЕ «НЕ ПОРІВНЯНО», А НЕ «ВСІ ЗАЙВІ».
     *
     * `compareChapter` вмикається самою наявністю `headingStyles`, а гучні
     * ворота `missingStyles` пропускають виклик, якщо стиль у документі Є.
     * Але заголовки можуть усі до одного сидіти на майстер-сторінках, які
     * `pagination.jsx` свідомо не бере в перелік заголовків, — тоді
     * `measure.headings` порожній, `chapterSpans` повертає `[]`, і КОЖЕН
     * колонтитул падав у гілку `span === null`, дістаючи
     * head-unexpected із текстом «сторінка не належить жодному розділу
     * (титул, шмуцтитул, передмова)». На книжці це 50 хибних знахідок із
     * причиною, якої не існує; справжня причина жила окремо, в
     * `masterSkipped`, куди читач після п'ятдесятого рядка вже не доходив.
     *
     * Ознака точна: діапазонів нема ЗОВСІМ. Порожній перелік не дозволяє
     * судити нікого, тож рахуємо в notCompared й мовчимо.
     */
    if (spans.length === 0) {
      notCompared++;
      continue;
    }

    const span = spanAt(spans, offset);
    /* Outside any span at all — a SEPARATE rule, not "wrong chapter": conflating
     * them would send the typesetter to fix the wrong thing. */
    if (span === null) {
      findings.push({
        id: `runningHead:${h.page}:${h.id}:unexpected`,
        family: "runningHead",
        defect: "head-unexpected",
        page: h.page,
        frameId: h.id,
        paragraphIndex: null,
        claimed: h.text,
        actual: null,
        detail:
          `The running head "${h.text}" sits on a page that belongs to no chapter ` +
          "(title page, half-title, or front matter before the first heading).",
      });
      continue;
    }

    checked++;
    if (normalizeTitle(h.text) !== span.title) {
      findings.push({
        id: `runningHead:${h.page}:${h.id}:wrong-chapter`,
        family: "runningHead",
        defect: "head-wrong-chapter",
        page: h.page,
        frameId: h.id,
        paragraphIndex: null,
        claimed: h.text,
        actual: span.titleRaw,
        detail:
          `The page belongs to the chapter "${span.titleRaw}" (starts on p. ${span.startPage}), ` +
          `but the running head says "${h.text}". Source: ` +
          (h.fromMaster ? `master ${h.masterName ?? "(unknown)"}` : "an overridden frame") +
          ".",
      });
    }
  }

  /*
   * A page the MASTER promised a running head to, but it doesn't show one.
   *
   * An empty frame and an overset one both count as ABSENT: on the sheet
   * both cases look empty, and the family makes claims about the sheet.
   *
   * A BOUNDARY, NAMED OUT LOUD (spec §6.3): a page whose running head was
   * removed deliberately — by redefinition or deletion — is indistinguishable
   * from one where it was simply lost. Both arrive as candidates, and that's
   * more honest than a verdict.
   */
  const shown = new Set<string>();
  for (const h of heads) if (!h.empty && !h.overset) shown.add(h.page);

  for (const p of pages) {
    if (p.master === null) continue;
    const expectSides = opts.expectedByMaster.get(p.master);
    if (expectSides === undefined || !expectSides.has(p.side)) continue;
    if (shown.has(p.name)) continue;
    findings.push({
      id: `runningHead:${p.name}::missing`,
      family: "runningHead",
      defect: "head-missing",
      page: p.name,
      frameId: null,
      paragraphIndex: null,
      claimed: null,
      actual: null,
      detail:
        `Master ${p.master} gives this side a running head, but the page doesn't show one: ` +
        "an overridden-and-deleted element, an empty frame, or overset text.",
    });
  }

  /*
   * THE REPORTING UNIT HERE IS THE FRAME, NOT THE PAGE, and that's not
   * cosmetic: one master frame feeds up to 13 pages (measured `H10-B`), so a
   * per-page report would give 13 identical lines for one cause that gets
   * fixed in one place. The `id` is shared across all N assertions, because
   * `masterPageItems` returns the master item itself (Phase 7).
   */
  const ref = headReference(heads);
  /*
   * THE APPEARANCE REFERENCE IS PER STYLE, NOT PER WHOLE DOCUMENT, and this
   * is a fix made from a MEASUREMENT, not a fit to expectations.
   *
   * A control run on the book gave 4 findings instead of the expected 1:
   * three extra ones were all running heads of style `Колонтитул v2`
   * (checklists, masters `H`, `M`, `N`), color `CMYK:2,8,23,0` against the
   * accent red of `v1`. The rule required TWO DIFFERENT NAMED STYLES to
   * look alike — but styles are different for a reason: `v2` is light
   * because it sits on a colored panel. The document declares two styles,
   * so there are two references (§3.2: the reference is derived from the
   * document).
   *
   * A BOUNDARY, NAMED OUT LOUD: if the typesetter mistakenly applied `v2`
   * where `v1` was meant, the appearance rule stays silent — the frame is
   * compared against its own style and looks flawless. Catching that kind of
   * mix-up would need a separate rule about WHICH style belongs WHERE, and
   * there is none: the tool cannot know the intent. The cost is named
   * deliberately; the opposite choice gives three findings where the layout
   * is correct.
   *
   * The side, meanwhile, stays DOCUMENT-WIDE: which side a running head is
   * on is a property of the layout, not of the style.
   */
  const refByStyle = new Map<string, HeadReference>();
  for (const h of heads) {
    if (refByStyle.has(h.styleName)) continue;
    refByStyle.set(
      h.styleName,
      headReference(heads.filter((x) => x.styleName === h.styleName)),
    );
  }

  const byFrame = new Map<string, HeadFrame[]>();
  for (const h of heads) {
    const list = byFrame.get(h.id);
    if (list === undefined) byFrame.set(h.id, [h]);
    else list.push(h);
  }

  for (const [frameId, group] of byFrame) {
    const first = group[0]!;

    /*
     * СТОРОНУ ПЕРЕВІРЯЄМО В КОЖНОГО ЧЛЕНА ГРУПИ, А НЕ ЛИШЕ В ПЕРШОГО.
     *
     * Група — це ОДНА рамка, побачена з кількох сторінок (майстрова рамка
     * віддає по `HeadFrame` на сторінку, і всі вони мають один `id`).
     * Односторонній майстер прикладається до сторінок ОБОХ сторін, тож група
     * буває змішаною за `side`. Доти дивилися на `group[0]`:
     *   — якщо відхилення не перше, його не бачили ЗОВСІМ;
     *   — якщо перше, знахідка описувала одну сторінку, а `group.length`
     *     твердив, що вона стосується всіх.
     * Зовнішній вигляд, навпаки, лишається по `group[0]` правомірно: це та
     * сама рамка, отже той самий шрифт, кегль і колір.
     */
    const sideStrays = ref.side === null ? [] : group.filter((h) => h.side !== ref.side);
    if (sideStrays.length > 0) {
      const stray = sideStrays[0]!;
      findings.push({
        id: `runningHead:${frameId}::side-stray`,
        family: "runningHead",
        defect: "head-side-stray",
        page: stray.page,
        frameId,
        paragraphIndex: null,
        claimed: stray.side,
        actual: ref.side,
        detail:
          `The running head sits on side ${stray.side}, while the rest of the document's running heads are ` +
          `on ${ref.side}. Pages where this frame strays: ${sideStrays.map((h) => h.page).join(", ")} ` +
          `(of ${group.length} page(s) under this frame).`,
      });
    }

    /*
     * "NOT READ" DOES NOT EQUAL "SAME". The fill of style `Колонтитул v2`
     * has an empty name (measured), so `fillValue` may not read there at
     * all; comparing against `null` as if it were a value would make two
     * different unnamed colors equal — i.e. a check that can never fail.
     */
    const a = first.appearance;
    const styleRef = refByStyle.get(first.styleName) ?? ref;
    if (
      a.font === null ||
      a.pointSize === null ||
      a.fillValue === null ||
      styleRef.font === null ||
      styleRef.pointSize === null ||
      styleRef.fillValue === null
    ) {
      notCompared += group.length;
      continue;
    }

    const diffs: string[] = [];
    if (a.font !== styleRef.font) {
      diffs.push(`font ${a.font} vs ${styleRef.font}`);
    }
    if (a.pointSize !== styleRef.pointSize) {
      diffs.push(`point size ${a.pointSize} vs ${styleRef.pointSize}`);
    }
    if (a.fillValue !== styleRef.fillValue) {
      diffs.push(`fill ${a.fillValue} vs ${styleRef.fillValue}`);
    }
    if (diffs.length > 0) {
      findings.push({
        id: `runningHead:${frameId}::style-stray`,
        family: "runningHead",
        defect: "head-style-stray",
        page: first.page,
        frameId,
        paragraphIndex: null,
        claimed: diffs.join("; "),
        actual: null,
        detail:
          `The running head's appearance differs from the rest of the frames of style "${first.styleName}": ` +
          `${diffs.join("; ")}. ` +
          `Pages under this frame: ${group.length}.`,
      });
    }
  }

  return { checked, notCompared, findings };
}

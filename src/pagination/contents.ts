/**
 * Family `contents`: the numbers in the table of contents against the actual heading pages.
 *
 * THE FAMILY'S MAIN QUESTION CHANGED AFTER THE PROBE (spec §4.5). MEASURED
 * 2026-08-07: this book's table of contents is being converted to cross-
 * references right now — 35 of ~60 lines are already automatic. For a
 * cross-reference, the question "is the number correct" is meaningless: it
 * is correct by construction. The useful question is parallel to
 * `folio-manual`:
 *
 *     which contents lines are NOT YET converted.
 *
 * So geometric matching is only needed where the number is still literal.
 */

import type {
  ClaimFrame,
  FamilyResult,
  HeadingRef,
  MarkerKind,
  PageRef,
  PaginationFinding,
} from "./types.js";

/**
 * ДОКУМЕНТНИЙ ПОРЯДОК ДВОХ РЯДКІВ ЗМІСТУ — розворот, тоді сторінка, тоді
 * положення по вертикалі, тоді номер абзацу в рамці.
 *
 * Складено з наявних полів, бо порядкового номера `PlacedParagraph` не несе, а
 * покладатися на порядок обходу InDesign не можна: `helper-chain.ts` фіксує
 * вимір, де шість рамок прийшли в порядку історій 256, 412, 393, 450, 431,
 * 469 при сторінках 1,3,2,5,4,6.
 *
 * `baseline === null` іде в кінець своєї сторінки, а не на початок: рядок без
 * виміряної базової лінії не має права протиснутися поперед виміряних.
 */
function documentOrder(a: PlacedParagraph, b: PlacedParagraph): number {
  if (a.spreadIndex !== b.spreadIndex) return a.spreadIndex - b.spreadIndex;
  const na = /^\d+$/.test(a.page) ? Number(a.page) : null;
  const nb = /^\d+$/.test(b.page) ? Number(b.page) : null;
  if (na !== null && nb !== null && na !== nb) return na - nb;
  if (a.page !== b.page) return a.page.localeCompare(b.page, "uk");
  const ba = a.baseline ?? Number.POSITIVE_INFINITY;
  const bb = b.baseline ?? Number.POSITIVE_INFINITY;
  if (ba !== bb) return ba - bb;
  return a.index - b.index;
}

export interface PlacedParagraph {
  frameId: string;
  page: string;
  /** Baselines are comparable ONLY within the same spread. */
  spreadIndex: number;
  styleName: string;
  index: number;
  literals: number[];
  markers: MarkerKind[];
  text: string;
  baseline: number | null;
  leading: number | null;
}

/**
 * Frame paragraphs eligible for matching.
 *
 * ROTATED FRAMES ARE DELIBERATELY DISCARDED: in a rotated frame the
 * baseline lies in the rotated coordinate system, so such a frame would
 * silently match against the wrong line. `detectContents` builds the
 * finding about it — here it is simply absent from the candidates.
 *
 * A frame on a page outside the measured range is also discarded: it has
 * no spread.
 */
export function flattenFrames(frames: ClaimFrame[], pages: PageRef[]): PlacedParagraph[] {
  const spreadOf = new Map(pages.map((p) => [p.name, p.spreadIndex]));
  const out: PlacedParagraph[] = [];
  for (const frame of frames) {
    if (frame.rotationAngle !== 0) continue;
    const spreadIndex = spreadOf.get(frame.page);
    if (spreadIndex === undefined) continue;
    for (const para of frame.paragraphs) {
      out.push({
        frameId: frame.id,
        page: frame.page,
        spreadIndex,
        /* PARAGRAPH style, falling back to frame style only when the paragraph
         * has none of its own. In the real book, one contents frame contains
         * all three levels at once (measured 2026-08-07), so taking the level
         * from the frame would attribute all its lines to a single level. */
        styleName: para.styleName ?? frame.styleName,
        index: para.index,
        literals: para.literals,
        markers: para.markers,
        text: para.text,
        baseline: para.baseline,
        leading: para.leading,
      });
    }
  }
  return out;
}

export interface Pair {
  title: PlacedParagraph;
  number: PlacedParagraph;
}

export interface PairResult {
  pairs: Pair[];
  findings: PaginationFinding[];
}

/**
 * The tolerance is DERIVED FROM THE DOCUMENT: half of the smaller of the pair's two leadings.
 *
 * It is needed because the contents is adjusted by hand — in the measured
 * book the offsets wander within 0.7–1.4 mm at the same leading. But a
 * "2 mm" constant would be a property of ONE layout, while the rules are
 * written for future different editions (spec §3).
 *
 * `null` — when the leading is Auto: there is nothing to compute, and the
 * pair isn't built at all, rather than getting a tolerance of 0.
 */
function tolerance(a: PlacedParagraph, b: PlacedParagraph): number | null {
  if (a.leading === null || b.leading === null) return null;
  return Math.min(a.leading, b.leading) / 2;
}

function finding(
  defect: PaginationFinding["defect"],
  p: PlacedParagraph,
  detail: string,
  claimed: string | null = null,
  actual: string | null = null,
): PaginationFinding {
  return {
    id: `contents:${p.page}:${p.frameId}:${p.index}:${defect}`,
    family: "contents",
    defect,
    page: p.page,
    frameId: p.frameId,
    paragraphIndex: p.index,
    claimed,
    actual,
    detail,
  };
}

/**
 * Matches numbers to titles GEOMETRICALLY, by baseline.
 *
 * There is no structural link between them in the document — measured:
 * the titles and numbers live in DIFFERENT stories, with no tab stop or
 * shared paragraph. User decision 2026-08-06: match by baseline.
 *
 * Iteration runs over the NUMBERS, not the titles: a title without a
 * number is normal (the book has 60 title lines against 35 cross-
 * references), while a number without a title is a defect.
 */
export function pairByBaseline(
  titles: PlacedParagraph[],
  numbers: PlacedParagraph[],
): PairResult {
  const pairs: Pair[] = [];
  const findings: PaginationFinding[] = [];
  const taken = new Set<string>();

  const key = (p: PlacedParagraph): string => `${p.frameId}#${p.index}`;

  for (const num of numbers) {
    /*
     * EMPTY PARAGRAPHS ARE NOT CANDIDATES.
     *
     * In the real book's contents, empty spacer paragraphs sit between
     * blocks, and their style is the same as the contents lines' style.
     * They have a baseline, so they fell within the tolerance and produced
     * `contents-ambiguous` where there was actually no ambiguity at all: an
     * empty line cannot be a contents line.
     *
     * Measured 2026-08-07: these alone accounted for 14 of 14 ambiguities.
     */
    /*
     * CANDIDATES — FROM THE SAME PAGE, not the spread.
     *
     * The baseline is shared across the WHOLE spread, so a line on the left
     * page and a line on the right page standing at the same height have
     * the same baseline. Measured 2026-08-07: this alone accounted for 11
     * of the remaining 11 `contents-ambiguous` — «БАДи під час вагітності»
     * from p. 8 and «1. План пологів» from p. 9, both at 46.2.
     *
     * A contents line and its number sit on the same page by construction:
     * the number stands in a field next to the title, not across a spread.
     * The spread check remains in `flattenFrames` as the broader condition
     * for coordinate comparability.
     */
    const sameSpread = titles.filter((t) => t.page === num.page && t.text.trim().length > 0);
    if (sameSpread.length === 0) {
      findings.push(
        finding(
          "contents-cross-spread",
          num,
          "There is no contents line on the SAME PAGE as this number, so no pair can be " +
            "built: baselines are compared within a page (a deliberate narrowing — see " +
            "the note above this filter), not across the spread. A line may well exist " +
            "on the facing page; that is not a pair for this number.",
          num.literals.join(", ") || null,
        ),
      );
      continue;
    }

    const within: PlacedParagraph[] = [];
    let toleranceKnown = false;
    /*
     * КАНДИДАТИ, ЩО ВЖЕ ЗАЙНЯТІ, РАХУЮТЬСЯ ОКРЕМО — інакше причина в звіті
     * підміняється. `continue` по `taken` стоїть ПЕРЕД обчисленням допуску,
     * тож коли всі кандидати на сторінці вже розібрані попередніми числами,
     * `toleranceKnown` лишався `false`, і код звинувачував Auto-leading —
     * причину, якої ніхто не встановлював.
     *
     * Реальний випадок: рядок «1. План пологів» і ДВА числових абзаци на тій
     * самій базовій лінії (продубльована рамка числа або залишок від
     * обірваного перетворення на перехресні посилання). Перше число забирає
     * заголовок; друге дістає пораду піти в палітру абзаца й перевірити
     * інтерліньяж, який там цілком гаразд, замість вказівки на дублікат.
     */
    let takenCandidates = 0;
    for (const title of sameSpread) {
      if (taken.has(key(title))) {
        takenCandidates += 1;
        continue;
      }
      const tol = tolerance(title, num);
      if (tol === null) continue;
      toleranceKnown = true;
      if (title.baseline === null || num.baseline === null) continue;
      if (Math.abs(title.baseline - num.baseline) <= tol) within.push(title);
    }

    if (!toleranceKnown) {
      findings.push(
        finding(
          "contents-unpaired",
          num,
          takenCandidates > 0
            ? `Every contents line on this page (${String(takenCandidates)}) has already been ` +
              "paired with an earlier number, so there is none left for this one. The usual " +
              "cause is a DUPLICATE number — two number paragraphs on one baseline — not the " +
              "leading. No pair is built; this is 'not checked', not 'clean'."
            : "The line's or the number's leading is set to Auto, so the matching tolerance " +
              "cannot be computed. No pair is built — this is 'not checked', not 'clean'.",
          num.literals.join(", ") || null,
        ),
      );
      continue;
    }

    if (within.length === 0) {
      findings.push(
        finding(
          "contents-unpaired",
          num,
          "Within half a leading's tolerance of this number there is no free contents " +
            "line. There is nothing to match the number against.",
          num.literals.join(", ") || null,
        ),
      );
      continue;
    }

    if (within.length > 1) {
      /* Guessing is forbidden: two lines within tolerance means the geometry
       * here doesn't distinguish the pairs, and that is itself a finding. */
      findings.push(
        finding(
          "contents-ambiguous",
          num,
          `Within half a leading's tolerance of this number, there are ${within.length}` +
            " contents lines. Which one this actually is doesn't follow from geometry.",
          num.literals.join(", ") || null,
        ),
      );
      continue;
    }

    const title = within[0]!;
    taken.add(key(title));
    pairs.push({ title, number: num });
  }

  return { pairs, findings };
}

export interface LevelMapping {
  contentsStyle: string;
  /**
   * NOT one-to-one: one contents-line style can correspond to several
   * heading styles in the body (user clarification 2026-08-06 — headings
   * of the same level could have been set in different styles).
   */
  headingStyles: string[];
}

/**
 * One heading style must not belong to two levels.
 *
 * Otherwise the same heading would be consumed twice, and BOTH levels
 * would produce false numbers — while each alone would look plausible.
 * So this is a loud parameter-validation error, BEFORE measurement, not a
 * silent discrepancy afterward.
 */
export function assertDisjointLevels(levelMap: LevelMapping[]): void {
  const seen = new Map<string, string>();
  for (const level of levelMap) {
    for (const style of level.headingStyles) {
      const owner = seen.get(style);
      if (owner !== undefined) {
        throw new Error(
          `The heading style "${style}" is named in two contents levels at once — ` +
            `"${owner}" and "${level.contentsStyle}". The same heading would be consumed twice, ` +
            "and both levels would produce wrong numbers. Separate the levels.",
        );
      }
      seen.set(style, level.contentsStyle);
    }
  }
}

/**
 * The `contents` family as a whole.
 *
 * Matching runs WITHIN A LEVEL, not across all of them: the contents
 * almost never lists every heading in the book, so cross-level ordering
 * would give only a count mismatch and no useful finding.
 */
export function detectContents(
  pairs: Pair[],
  headings: HeadingRef[],
  levelMap: LevelMapping[],
  rotatedFrames: ClaimFrame[],
): FamilyResult {
  assertDisjointLevels(levelMap);

  const findings: PaginationFinding[] = [];
  let checked = 0;
  let notCompared = 0;

  /* A rotated numbers frame is a finding about the WHOLE frame, not a pair:
   * the baselines in it lie in the rotated coordinate system, so matching
   * would silently drift (spec §4.7). */
  for (const frame of rotatedFrames) {
    findings.push({
      id: `contents:${frame.page}:${frame.id}:rotated`,
      family: "contents",
      defect: "contents-rotated-frame",
      page: frame.page,
      frameId: frame.id,
      paragraphIndex: null,
      claimed: null,
      actual: `${frame.rotationAngle}°`,
      detail:
        `The numbers frame is rotated by ${frame.rotationAngle}°. Baselines of a rotated ` +
        "frame lie in the rotated coordinate system, so it cannot be matched against " +
        "contents lines — the frame is excluded from the check.",
    });
    notCompared += frame.paragraphs.length;
  }

  for (const level of levelMap) {
    /*
     * СОРТУЄМО ОБИДВА БОКИ, А НЕ ОДИН.
     *
     * `levelHeadings` явно зводиться в документний порядок рядком нижче, а
     * `levelPairs` успадковував порядок `numbers`, тобто порядок обходу
     * `page.allPageItems`. Далі позиція `i` одного зіставляється з позицією
     * `i` другого — і зіставлення тримається на припущенні, що обидва
     * впорядковані однаково.
     *
     * Репозиторій сам це припущення спростовує: `helper-chain.ts` фіксує
     * вимір, де шість рамок прийшли в порядку історій 256, 412, 393, 450,
     * 431, 469 при сторінках 1,3,2,5,4,6; `wrap.ts` каже, що порядок
     * елементів — властивість обходу InDesign. У книжці ~35 чисел змісту —
     * це 35 ОКРЕМИХ прив'язаних рамок, тобто 35 окремих записів обходу.
     *
     * Перестановка не ловилася нічим: довжини збігаються, тож ворота
     * `contents-count-mismatch` мовчать, і кожна пара просто зіставляється з
     * чужим заголовком — низка contents-stale із сусідніми сторінками плюс
     * вигаданий contents-out-of-order.
     */
    const levelPairs = pairs
      .filter((p) => p.title.styleName === level.contentsStyle)
      .slice()
      .sort((a, b) => documentOrder(a.title, b.title));
    const levelHeadings = headings
      .filter((h) => level.headingStyles.includes(h.styleName))
      .slice()
      .sort((a, b) => a.order - b.order);

    if (levelPairs.length === 0 && levelHeadings.length === 0) continue;

    if (levelPairs.length !== levelHeadings.length) {
      /*
       * STOP, not matching by min(). Lesson from Phase 5: the numerator and
       * denominator come from different populations. Shifting by one
       * position would make ALL pairs at the level "stale", and among them
       * the real cause — that the counts don't match — would be lost.
       */
      findings.push({
        id: `contents:level:${level.contentsStyle}:count-mismatch`,
        family: "contents",
        defect: "contents-count-mismatch",
        page: null,
        frameId: null,
        paragraphIndex: null,
        claimed: String(levelPairs.length),
        actual: String(levelHeadings.length),
        detail:
          `Level "${level.contentsStyle}": the contents lists ${levelPairs.length} lines with a number, ` +
          `while headings of styles [${level.headingStyles.join(", ")}] in the body — ` +
          `${levelHeadings.length}. Matching by order is stopped: at a different ` +
          "count, it would produce a false finding on EVERY line of the level.",
      });
      notCompared += levelPairs.length;
      continue;
    }

    const claimedSequence: { value: number; num: PlacedParagraph }[] = [];

    for (let i = 0; i < levelPairs.length; i += 1) {
      const { number } = levelPairs[i]!;
      const head = levelHeadings[i]!;

      const isAutomatic = number.literals.length === 0 && number.markers.length > 0;
      if (isAutomatic) {
        checked += 1;
        continue;
      }

      if (number.literals.length === 0) {
        /*
         * `notCompared` БЕЗ `checked` — вони взаємовиключні на пару.
         * `folio.ts` формулює цей інваріант прямо («обидві гілки
         * notCompared стоять ПЕРЕД checked і роблять continue»), а тут
         * `checked += 1` стояв ВИЩЕ обох гілок, тож пара, яку не порівняли,
         * рахувалася двічі: рівень із 35 пар, три заголовки яких в оверсеті,
         * звітував checked 35 і notCompared 3 — тридцять вісім одиниць
         * роботи на тридцять п'ять пар, і будь-яка похідна від них частка
         * покриття хибна.
         */
        notCompared += 1;
        continue;
      }

      checked += 1;

      /*
       * `contents-manual` — NOT a number error, but a fact about the line: it
       * has not yet been converted to a cross-reference, meaning it will
       * break on the next recompose, while neighboring lines will not.
       * Exact analog of `folio-manual`.
       */
      findings.push({
        id: `contents:${number.page}:${number.frameId}:${number.index}:manual`,
        family: "contents",
        defect: "contents-manual",
        page: number.page,
        frameId: number.frameId,
        paragraphIndex: number.index,
        claimed: number.literals.join(", "),
        actual: null,
        detail:
          "The number is typed by hand, not as a cross-reference: it will not update " +
          "on recomposition, while converted lines will.",
      });

      /*
       * ПЕРЕВІРЯЄМО ВСІ ЛІТЕРАЛИ РЯДКА, А НЕ ЛИШЕ ПЕРШИЙ.
       *
       * `contents-manual` показує їх усі (`literals.join(", ")`), а звіряння
       * брало `literals[0]`. Рядок змісту з полем «12, 15» або діапазоном
       * «12–14» показувався читачеві повністю, а перевірявся на одному числі:
       * якщо заголовок переїхав на 15, contents-stale спрацьовував проти 12 і
       * про 15 не казав нічого; якщо протух лише другий — не спрацьовував
       * узагалі.
       *
       * Для послідовності (`claimedSequence`) береться ПЕРШИЙ: монотонність
       * змісту визначає початок рядка, а не його хвіст.
       */
      const value = number.literals[0]!;
      claimedSequence.push({ value, num: number });

      /* Решта літералів того самого рядка: жоден із них не сміє суперечити
       * сторінці заголовка. Перший звіряється звичайним шляхом нижче. */
      const staleExtras = number.literals
        .slice(1)
        .filter((v) => head.page !== null && String(v) !== head.page);

      if (head.page === null) {
        notCompared += 1;
        continue;
      }

      if (String(value) !== head.page) {
        findings.push({
          id: `contents:${number.page}:${number.frameId}:${number.index}:stale`,
          family: "contents",
          defect: "contents-stale",
          page: number.page,
          frameId: number.frameId,
          paragraphIndex: number.index,
          claimed: String(value),
          actual: head.page,
          detail:
            `The contents says ${value}, but the heading "${head.text}" is actually on ` +
            `page ${head.page}.`,
        });
      }

      if (staleExtras.length > 0) {
        /* Окрема знахідка, а не розширення попередньої: перший літерал міг
         * бути ЦІЛКОМ правильним, і тоді сказати «зміст каже 12» було б
         * неправдою — бреше саме хвіст. */
        findings.push({
          id: `contents:${number.page}:${number.frameId}:${number.index}:stale-extra`,
          family: "contents",
          defect: "contents-stale",
          page: number.page,
          frameId: number.frameId,
          paragraphIndex: number.index,
          claimed: staleExtras.join(", "),
          actual: head.page,
          detail:
            `The contents line also carries ${staleExtras.join(", ")}, but the heading ` +
            `"${head.text}" is on page ${head.page}. Only the FIRST number on a line used ` +
            "to be checked, so the rest were shown to the reader without ever being compared.",
        });
      }
    }

    /*
     * MONOTONICITY — a check that replaces title matching (spec §4.5).
     *
     * Not a threshold and not a similarity measure: the document itself
     * defines reading order, and by construction the contents follows the
     * book's order. Catches transposed lines, which abandoning title
     * matching would otherwise leave completely uncovered.
     */
    for (let i = 1; i < claimedSequence.length; i += 1) {
      const prev = claimedSequence[i - 1]!;
      const cur = claimedSequence[i]!;
      if (cur.value >= prev.value) continue;
      findings.push({
        id: `contents:${cur.num.page}:${cur.num.frameId}:${cur.num.index}:out-of-order`,
        family: "contents",
        defect: "contents-out-of-order",
        page: cur.num.page,
        frameId: cur.num.frameId,
        paragraphIndex: cur.num.index,
        claimed: String(cur.value),
        actual: `≥ ${prev.value}`,
        detail:
          `Number ${cur.value} comes after ${prev.value}, meaning contents numbers decrease. ` +
          "The contents follows the book's order by construction, so a decrease means either " +
          "transposed lines or a wrong number.",
      });
    }
  }

  return { checked, notCompared, findings };
}

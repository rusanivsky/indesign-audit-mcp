/**
 * B5.3c. HYPHENATION defect detector: ladders, word breaks across a page,
 * forbidden words. Pure TypeScript.
 *
 * HOW THIS DETECTOR DIFFERS FROM ITS TWO NEIGHBORS
 * ===============================================
 * Task 8 measures the GEOMETRY of spacing, Task 9 — the GEOMETRY of the line. This
 * module doesn't measure geometry at all: everything it reads is `endsWithHyphen`,
 * the line's address, `page`, `isLastInFrame`, and `text`. The consequence needs
 * to be known up front: `measurable.ts`'s corrections for the hyphen and trailing
 * space (`effectiveRight`, `hyphenAllowance`) do NOT enter here — not because
 * they were forgotten, but because there is nothing here to compare against a
 * measure. The only thing taken from the shared corrections is `isMeasurable`
 * and `lineWords`; why exactly those two is explained below, each separately.
 *
 * THE CENTRAL FACT THIS WHOLE MODULE RESTS ON
 * ==============================================
 * InDesign's automatic hyphenation **is not a text character**: it's simply
 * absent from `line.characters`, so catching a hyphenation break through the
 * line's text is impossible (`docs/measured-facts-phase3.md:422-423`). That's
 * why `endsWithHyphen` is computed in JSX (`src/jsx/composition.jsx:295-299`)
 * as the union of three rules — a literal hyphen, U+00AD, or "the line's last
 * character and the next line's first character are both letters."
 *
 * Two measurements make this a precondition rather than a detail:
 * - the old rule (literal hyphen and soft hyphen only) fired
 *   **2 times out of 5,193 lines** (`docs/measured-facts-phase3.md:421`);
 * - the union yields **103 hyphenations for the document** (same source, :555).
 * In other words, **101 out of 103 hyphenations are visible ONLY through the
 * "letter + letter" rule** — that's the difference between two measured numbers,
 * not a separate measurement. A detector built on the line's text would have
 * seen 2% of its population.
 *
 * The rule is computed in JSX and can't be moved here: it looks at the FIRST
 * CHARACTER OF THE NEXT LINE, and narrowing by page can leave the next line
 * outside the sample. In JSX the next line always exists.
 *
 * WHAT FOLLOWS FROM THIS FOR THE DETECTOR
 * =================================
 * 1. **The last line of a paragraph can never have a hyphenation, by
 *    construction** — the condition `(L < paraLines.length - 1)` is the first
 *    conjunct in JSX (`src/jsx/composition.jsx:295`). So there's no separate
 *    `isParagraphFinal` check here: it would duplicate the measurement layer's
 *    invariant. If that invariant is ever removed, this guarantee goes with
 *    it — which is exactly why it's named here rather than left implicit.
 * 2. **The `rotated` rule is NOT checked.** That is, "there are no
 *    hyphenations on rotated lines" is a property of THIS book (running heads
 *    are single-line, so the first conjunct is false), NOT a property of the
 *    rule. There are no measurements at all for this subset in the facts, and
 *    that's exactly why `isMeasurable` is mandatory here.
 *
 * WHY `isMeasurable`, GIVEN THAT WE DON'T TOUCH GEOMETRY
 * =================================================
 * The justification here is DIFFERENT from Tasks 8 and 9, and it's worth saying
 * out loud, because repeating someone else's sentence would be a lie. For the
 * neighbors it's protection against INVALID GEOMETRY (a rotated frame returns
 * `right − left === 0`, an empty paragraph returns the full `columnWidth`
 * despite an actual width of 2.3–7.6 pt). There's no geometry here, so two
 * other reasons remain, both valid:
 *
 * - **the corpus.** 111 rotated lines are running heads and folios
 *   («Колонтитул v1» ×104, «Нумерація сторінок» ×6, «Колонтитул v2» ×1 —
 *   `docs/measured-facts-phase3.md`, the section on rotated frames). A
 *   hyphenation in a running head isn't a defect of the main text's setting,
 *   and 91 of these 111 lines sit on ORDINARY pages, meaning narrowing by page
 *   doesn't remove them — the only reliable filter is `rotated` itself;
 * - **the text.** 484 lines of empty paragraphs carry not a single glyph. The
 *   forbidden-word and page-turn rules read the line's WORDS; on such a line
 *   there are no words, and any verdict about them would be fabricated.
 *
 * Together, 595 out of 5,193 are unfit (11.5%). **What's shared with the
 * neighbors is `isMeasurable` itself, NOT the denominator:** `detectSpacing`
 * narrows further to justified non-final lines, `detectLines` discards
 * single-line paragraphs, and this module discards neither. So it's the FIRST
 * filtering pass that coincides, and Task 12 has no right to pool findings from
 * different detectors into one population. (An earlier draft of this paragraph
 * said "the denominator must match" — untrue, caught by review.)
 *
 * `isMaster` — PHASE 3 DEBT, CLOSED HERE (Task 10, Phase 4, spec §8)
 * =================================================================
 * Before this task, master-page lines entered here unfiltered: `isMaster` was
 * only filtered by the caller above, so this detector taken on its own silently
 * counted running heads as ordinary text. Now `HyphenOptions.includeMasters`
 * (default `false`) settles this RIGHT HERE — see `detectHyphens`.
 *
 * With `includeMasters: true`, master lines do enter, and the caveat that stood
 * here before still holds: their `page` is the master's name ("B", "E", "F",
 * "M", "N" — `docs/measured-facts-phase3.md`, the section on master pages),
 * not a number, so the finding's explanation can read as "between pages B and
 * E." This is a property of the data that the explicit call
 * `includeMasters: true` takes on knowingly — not a flaw in the filter.
 */

import { lineWords } from "./detect-lines.js";
import { findingId } from "./finding.js";
import { isMeasurable, percentile } from "./measurable.js";
import type { Finding, LineMeasure, Severity } from "./types.js";

/**
 * How many hyphenations in a row are still acceptable. Beyond this — a ladder.
 *
 * **THIS IS A TYPESETTING CONVENTION, NOT A MEASUREMENT OF THIS BOOK.** Saying
 * this outright, because two earlier steps in this block were flagged by review
 * precisely for numbers presented as measured when they weren't: 2 is the
 * traditional limit ("no more than two hyphens in a row"), also supported by
 * InDesign itself as a separate paragraph property, `hyphenateLadderLimit`.
 * There is NO distribution of run lengths in `docs/measured-facts-phase3.md` —
 * nobody counted it, and I can't count it either: that requires a measurement
 * pass on the open document.
 *
 * WHAT I CAN STILL SAY ABOUT THIS NUMBER — and how that differs from a
 * measurement. Hyphenations in the document: **103** out of **4,598
 * measurable-eligible lines** (`docs/measured-facts-phase3.md:555` and :572),
 * i.e. a share of hyphenated lines of ≈2.24%. IF hyphenations were independent
 * of each other, the expected count of runs of length 3 would be on the order
 * of 4,598 × 0.0224³ ≈ 0.05 — essentially zero. **Independence here is
 * knowingly false**: the composer hyphenates where space is tight, and
 * tightness tends to span several lines in a row, so the real count is higher
 * than the estimate, and by an unknown factor. So this count does NOT
 * determine the threshold. It supports exactly one, weak claim, and it's the
 * one the default needs: **a threshold of 2 cannot flood the report**, because
 * even at ten times the estimate, we're talking single-digit findings per
 * book. This is the same criterion by which Task 9 kept its own default and
 * Task 8 removed its own: a default that stays silent in the worst case is
 * safe; a default that flags the majority is not.
 *
 * Anyone who needs a number FOR THEIR OWN document should look at
 * `surveyHyphens().runs`: it's the raw distribution of run lengths, giving
 * exactly the value I'm missing. The "survey first, threshold second" order
 * was set by Task 8, and here it's the only path to a justified value.
 *
 * WHAT WOULD MAKE THIS THRESHOLD MEASURED, and what's missing for that:
 * `hyphenateLadderLimit` — a PARAGRAPH property in InDesign itself, i.e. a
 * standard the document declares, exactly like the 80/133 justification bounds
 * for Task 8. `LineMeasure` doesn't carry this field. If it did, the threshold
 * would be taken from the document per paragraph, and `Severity` would get a
 * meaningful `unrated` for paragraphs with mixed values. This is the most
 * useful fix the measurement layer could get from a future task; until then,
 * the number remains a caller's convention.
 */
export const DEFAULT_MAX_LADDER = 2;

export interface HyphenOptions {
  /** How many hyphenations in a row are still acceptable. Beyond this — a ladder. */
  maxLadder?: number;
  /**
   * Words that must not be hyphenated: surnames, abbreviations, proper names.
   * The comparison is CASE-SENSITIVE — the list must contain the spelling
   * exactly as it appears in the text.
   */
  forbidden?: string[];
  /**
   * Count lines from master (parent) pages.
   *
   * Phase 3 debt, closed in Phase 4 (spec §8): previously `isMaster` was
   * filtered only by Task 12's caller, so this detector taken on its own
   * silently counted running heads as ordinary text. The policy is now
   * declared RIGHT HERE, where it takes effect.
   *
   * Default `false`. A master line is not judged AND DOES NOT EXTEND a
   * ladder — the same conservative choice already applied to unfit lines
   * (`isMeasurable`), and enforced in the same place, in `detectHyphens`: a
   * broken run is an undercount, not a fabricated defect.
   */
  includeMasters?: boolean;
}

/** The classes this module emits. They live in the shared `DefectClass`. */
export type HyphenDefect = "hyphen-ladder" | "hyphen-across-spread" | "hyphen-forbidden";

/**
 * FINDING SEVERITY — this module's decision, made independently; here it is
 * in full.
 *
 * `Severity` describes four DIFFERENT statements about a DECLARED STANDARD,
 * and the enum itself was written for Task 8, where the standard is declared
 * by the document (numeric justification bounds of the style). The question
 * to answer here is: does the data carry a declared hyphenation standard?
 *
 * **No.** It exists in InDesign (`hyphenateLadderLimit` — a paragraph
 * property), but `LineMeasure` doesn't carry it. So everything this detector
 * compares against is either a bound declared by the CALLER (`maxLadder`), or
 * not a bound at all but an exact structural predicate (page turn, exception
 * list).
 *
 * Hence: **every finding from this module has severity `error`**, and the
 * other three values are UNREACHABLE here.
 *
 * - `error` — justified. For the ladder, this is the Task 8 precedent: in
 *   `"ratio"` mode the bound is also given by the caller, and a line past
 *   that bound gets `error`. For the page turn and forbidden words, the
 *   predicate is exact and binary: a line either is the last one in its frame
 *   and continues on another page, or it isn't. And the share here isn't
 *   59%: there are only 103 hyphenations out of 4,598 eligible lines (2.24%),
 *   and ladders are a subset of that.
 * - `warning` (the line is still within bounds, but in a cautionary band) — a
 *   band is only possible on a continuous quantity. Run length is an integer
 *   and small: a "band" would mean exactly "a run of length precisely
 *   `maxLadder`," i.e. every other pair of hyphenations in the book. That's
 *   not a warning, that's noise, and no measurement exists that would justify
 *   such a band. So there is no band.
 * - `info` ("measured and within bounds") — unreachable by construction: the
 *   module SELECTS, it doesn't rank everything indiscriminately; it has no
 *   `"rank"` mode, because the one continuous quantity here (the fraction of
 *   the hyphenated word) is only defined on the defects themselves.
 * - `unrated` ("no verdict, because the bounds aren't measured") —
 *   unreachable, because a line lacking the needed measurement here produces
 *   no FINDING at all: an unfit line is filtered out by `isMeasurable`, and a
 *   break whose continuation isn't visible is left without a verdict and
 *   counted by a separate tally in `surveyHyphens` (`undecidableSpread`,
 *   `unmeasuredWord`). In other words, "unmeasured" is expressed by the
 *   ABSENCE of a finding, not by a severity on one.
 *
 * CONSEQUENCE FOR TASK 12 (the same as for Task 9): sorting or filtering this
 * detector's findings by `severity` is pointless — it's constant. Ordering is
 * carried by `strength`. If the measurement layer ever starts supplying
 * `hyphenateLadderLimit`, `unrated` will become reachable and meaningful (a
 * paragraph with a mixed value), and this comment will need rewriting — that
 * is the sign that the constant here is a state of the data, not laziness.
 */
const HYPHEN_SEVERITY: Severity = "error";

/**
 * Characters that at line-end are already a rendered hyphenation mark and are
 * not part of the word. The same set as `HYPHEN_CHARS` in `measurable.ts`;
 * the two declarations can't be merged only because that one is private and
 * describes a DIFFERENT thing — "the allowance is already folded into
 * `right`," i.e. geometry. Here it's about text.
 */
const TRAILING_HYPHENS = /[-‐­]+$/;

/**
 * A word: starts and ends with a letter, and allows an apostrophe or a hyphen
 * INSIDE it. Both internal classes were added following review, and neither
 * is pedantry.
 *
 * **THE APOSTROPHE.** `text` carries a REAL U+2019 (`types.ts:82-87`,
 * `src/jsx/composition.jsx`), while an earlier revision matched "letters plus
 * diacritics," which cut the fragment off right at the apostrophe. Measured
 * by review: «з'єд-» + «нання» against the list `["з'єднання"]` produced the
 * word «єднання», a strength of 5/7 = 0.714 instead of 5/9 = 0.556, and NO
 * finding at all. The class of words this hits is exactly the one the
 * exception list exists for: В'ячеслав, Дем'ян, Лук'яненко, Мар'яна,
 * Григор'єв.
 *
 * Three glyph forms are accepted (U+2019, U+02BC, ASCII `'`), because all
 * three occur in Ukrainian texts and lists; before comparison they're folded
 * to one — see `foldApostrophes`. In this book itself the apostrophe arrives
 * as `SINGLE_RIGHT_QUOTE` (28 occurrences, `docs/measured-facts-phase3.md`,
 * the control-character table).
 *
 * **THE INTERNAL HYPHEN.** The same mechanism truncated «жовто-блакит-» to
 * «блакит». A trailing hyphen is a hyphenation mark and is stripped
 * separately (`TRAILING_HYPHENS`) BEFORE this parsing, so the internal and
 * the trailing one are never confused.
 */
const WORD_INNER = "[\\p{L}\\p{M}'’ʼ‐-]";
const LETTER = "[\\p{L}\\p{M}]";
const LETTER_RUN_END = new RegExp(`${LETTER}(?:${WORD_INNER}*${LETTER})?$`, "u");
const LETTER_RUN_START = new RegExp(`^${LETTER}(?:${WORD_INNER}*${LETTER})?`, "u");

/**
 * Folds three apostrophe glyph forms to U+2019 — and EXACTLY that, with no
 * other normalization. Needed only for COMPARISON against the exception
 * list: the book's text has U+2019, while whoever writes the list may well
 * type ASCII `'`, and a silent miss on «Дем'ян» would be indistinguishable
 * from "the word isn't in the list." String length doesn't change (a
 * one-to-one substitution), so the strength and `measured` arithmetic doesn't
 * depend on the folding. The finding's explanation text carries the
 * UNFOLDED fragment — the reader should see what's actually on the page.
 */
function foldApostrophes(s: string): string {
  return s.replace(/['ʼ]/g, "’");
}

/**
 * The word fragment left at the end of a line: the last word, with the
 * hyphenation mark and any punctuation trim removed («Шевчен» out of
 * «…до «Шевчен-»).
 *
 * Words are taken from Task 9's `lineWords`, not a homegrown `split`: that one
 * already accounts for C0 control characters arriving in `text` as real
 * characters (the table anchor U+0016, the footnote marker U+0004 —
 * `docs/measured-facts-phase3.md`, the C0 section), and two different word
 * splits would have silently diverged. An empty string means "no fragment is
 * visible," not "the fragment is zero-length."
 *
 * EXPORTED for Task 13: the fix proposal places the soft hyphen RIGHT BEFORE
 * this same fragment, so it must find exactly the word boundary the detector
 * flagged it by. A homegrown parse there would have silently diverged from
 * this — exactly the way two eligibility rules (`isMeasurable`) would have
 * diverged.
 */
export function wordTail(text: string): string {
  const words = lineWords(text);
  const last = words[words.length - 1];
  if (last === undefined) return "";
  return LETTER_RUN_END.exec(last.replace(TRAILING_HYPHENS, ""))?.[0] ?? "";
}

/**
 * The word's continuation on the next line: the leading letters of its first
 * word («ком» out of «ком, і далі»). Punctuation after the letters is
 * trimmed off — it's no longer part of the hyphenated word.
 */
function wordHead(text: string): string {
  const first = lineWords(text)[0];
  if (first === undefined) return "";
  return LETTER_RUN_START.exec(first)?.[0] ?? "";
}

/**
 * The next line of the SAME paragraph, if it's truly adjacent.
 *
 * It checks not just the paragraph's address but also numbering continuity
 * (`lineInParagraph + 1`). Adjacency in the array is not adjacency on the
 * page: the array comes from the caller, and although the current per-page
 * narrowing discards the ENTIRE story (`src/jsx/composition.jsx:165`, meaning
 * gaps inside a paragraph don't currently occur), the detector has no right
 * to rely on a filtering method it doesn't control. A gap without this check
 * would turn into a ladder made of lines sitting on different pages, and into
 * a "word continuation" that doesn't exist.
 *
 * An unfit next line doesn't qualify either: its words can't be read.
 */
function continuationOf(lines: readonly LineMeasure[], i: number): LineMeasure | null {
  const line = lines[i]!;
  const next = lines[i + 1];
  if (next === undefined) return null;
  if (next.containerId !== line.containerId) return null;
  if (next.paragraphIndex !== line.paragraphIndex) return null;
  if (next.lineInParagraph !== line.lineInParagraph + 1) return null;
  if (!isMeasurable(next)) return null;
  return next;
}

/**
 * FINDING STRENGTH. There are TWO of them here, and they measure different
 * things — exactly as in Task 9. The `Finding.strength` contract explicitly
 * allows this: strength is comparable ONLY WITHIN ONE DEFECT CLASS.
 *
 * - **ladder — RUN LENGTH in lines.** The quantity that IS the defect itself:
 *   a ladder of five hyphenations is more noticeable than one of three. It is
 *   deliberately NOT normalized by the threshold (`runLength − maxLadder`
 *   would be tempting), because the threshold is set by the caller: Task 12
 *   pools batches of pages, and if two batches ran with different
 *   `maxLadder`, normalized strengths would turn out incomparable while
 *   looking comparable. The raw length doesn't depend on the threshold.
 *   It's likewise not normalized by paragraph length: a ladder is a stack of
 *   hyphens that catches the eye on the right edge, and five in a row stay
 *   five whether the paragraph is short or long.
 *
 * - **page turn and forbidden word — SHARE OF THE WORD CARRIED ACROSS THE
 *   BREAK.** `carried / (kept + carried)`, within (0; 1). Reads as "this many
 *   percent of the word the reader will only see after the break," and grows
 *   toward worse: «Ше-вченко» leaves a fragment that carries no meaning and
 *   reads like a typesetting error, while «Шевчен-ко» the reader completes on
 *   their own without breaking stride. Both classes measure ONE quantity, so
 *   they're comparable to each other — this is the only such pair in the
 *   module.
 *
 * There is NO common scale for a ladder and a fragment (lines versus word
 * shares), and that's exactly why `detectHyphens` sorts by CLASS first.
 * Merging classes into one order is Task 11's question, same as for the
 * neighbors.
 */
function fragmentStrength(kept: number, carried: number): number {
  const whole = kept + carried;
  return whole > 0 ? carried / whole : 0;
}

/**
 * Flags hyphenation defects: ladders, words split by a page turn, and words
 * from the exception list.
 *
 * It does not flag — and does not declare clean — lines unfit for
 * measurement, or breaks whose continuation is missing from the sample: those
 * have their own tallies in `surveyHyphens`.
 *
 * RESULT ORDER is the same as in Task 9: first by CLASS (alphabetically),
 * within a class by descending strength, ties broken by key. Class comes
 * first deliberately: an alphabetical class order is meaningless, and this is
 * a refusal to assert a cross-class order that nobody measured.
 */
export function detectHyphens(lines: readonly LineMeasure[], opts: HyphenOptions = {}): Finding[] {
  const maxLadder = opts.maxLadder ?? DEFAULT_MAX_LADDER;
  if (!Number.isInteger(maxLadder) || maxLadder < 1) {
    throw new Error(
      `detectHyphens: maxLadder must be an integer ≥ 1, got ${maxLadder}. ` +
        "Zero would mean a finding for EVERY hyphenation in the document (103 in the book), " +
        "and a fractional number makes no sense for counting lines — see surveyHyphens().",
    );
  }
  const forbidden = opts.forbidden ?? [];
  const out: Finding[] = [];

  const push = (
    line: LineMeasure,
    defect: HyphenDefect,
    measured: number,
    strength: number,
    detail: string,
  ): void => {
    out.push({
      id: findingId(line, defect),
      defect,
      severity: HYPHEN_SEVERITY,
      page: line.page,
      containerId: line.containerId,
      paragraphIndex: line.paragraphIndex,
      lineInParagraph: line.lineInParagraph,
      lineText: line.text,
      measured,
      strength,
      detail,
    });
  };

  /* A ladder is counted within a SINGLE paragraph: a hyphenation at the end of
   * a paragraph and one at the start of the next sit on opposite sides of an
   * empty line or a paragraph indent, and don't read as a stack to the eye. */
  let runStart: LineMeasure | null = null;
  let runPrev: LineMeasure | null = null;
  let runLength = 0;

  const flush = (): void => {
    if (runStart !== null && runLength > maxLadder) {
      push(
        runStart,
        "hyphen-ladder",
        runLength,
        runLength,
        `${runLength} consecutive lines end with a hyphen (threshold ${maxLadder}); ` +
          `the stack of hyphens on the right edge starts at this line.`,
      );
    }
    runStart = null;
    runPrev = null;
    runLength = 0;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    /* A master-page line — the same conservative choice as for an unfit line: not
     * judged, and doesn't extend a ladder. The check comes BEFORE `isMeasurable`
     * deliberately: both kinds of run-break are equivalent, and the order here
     * doesn't affect the result (no line falls under both rules at once —
     * `isMaster` and geometry are independent properties). */
    if (line.isMaster && !opts.includeMasters) {
      flush();
      continue;
    }

    /* An unfit line is not judged AND DOES NOT EXTEND a run: we can't assert,
     * either way, that a stack of hyphenations continues through a line nobody
     * measured. Breaking the run is the conservative choice (an undercount,
     * not a fabricated defect). */
    if (!isMeasurable(line)) {
      flush();
      continue;
    }

    if (!line.endsWithHyphen) {
      flush();
      continue;
    }

    /* ——— ladder ——— */
    const continues =
      runPrev !== null &&
      runPrev.containerId === line.containerId &&
      runPrev.paragraphIndex === line.paragraphIndex &&
      runPrev.lineInParagraph + 1 === line.lineInParagraph;
    if (continues) {
      runLength++;
    } else {
      flush();
      runStart = line;
      runLength = 1;
    }
    runPrev = line;

    const next = continuationOf(lines, i);
    const kept = wordTail(line.text);

    /* ——— a word split by a PAGE ———
     *
     * A NOTE ON THE CLASS NAME. The class is called `hyphen-across-spread`,
     * because that's what the shared `DefectClass` dictionary named it, but the
     * rule measures a PAGE CHANGE, not a spread crossing. These are different
     * events: pages 12 and 13 in an ordinary book face each other, and the
     * reader turns nothing; they only turn a page at the even→odd seam. Spread
     * parity CANNOT be derived from the current payload: `page` is a string,
     * and for frames on master pages it's the master's name entirely ("B",
     * "E", …), not a number. I chose not to fabricate parity from a string.
     * So the finding's explanation talks strictly about a page change — see
     * Task 10's review, Important 1. The class name stays as is: Tasks 11–12
     * already import it, and renaming the shared dictionary isn't a one-sided
     * decision for this module to make.
     *
     * `isLastInFrame` is REDUNDANT here on real data — exactly like the four
     * "physically next line" guards, and in the same sense: a frame sits on
     * one page, so a line whose continuation is on another page is already
     * last in its own frame regardless. The condition is kept because it
     * records exactly what the definition names (the frame seam), rather than
     * relying on the consequence; there is a test for it, and the fixture it
     * needs is physically impossible. Added to the inventory following
     * review — this guard wasn't previously listed among the artificially
     * covered ones. */
    /*
     * РОЗВОРОТ, А НЕ СТОРІНКА — і тепер це справді так.
     *
     * Коментар вище описував межу: правило міряло зміну СТОРІНКИ, бо парність
     * розвороту з рядка вивести не можна. Сторінки 12 і 13 дивляться одна на
     * одну, читач нічого не гортає — а правило звітувало про кожну таку пару,
     * тобто приблизно половина влучань на книжці з розворотами була хибною, і
     * `composition_apply` вставляв би м'який перенос, перекомпоновуючи абзац
     * заради неіснуючої вади.
     *
     * `spreadIndex` тепер приходить із виміру (`page.parent.index`), тож
     * вивідність із рядка більше не потрібна. Коли номер не прочитався
     * (`-1` бодай з одного боку), падаємо назад на порівняння сторінок: це
     * консервативніше — можлива зайва знахідка, але не пропущена.
     */
    const spreadKnown = line.spreadIndex >= 0 && next !== null && next.spreadIndex >= 0;
    const crossesSeam =
      next !== null &&
      (spreadKnown ? next.spreadIndex !== line.spreadIndex : next.page !== line.page);

    if (line.isLastInFrame && crossesSeam) {
      const carried = wordHead(next.text);
      if (kept.length > 0 && carried.length > 0) {
        push(
          line,
          "hyphen-across-spread",
          carried.length,
          fragmentStrength(kept.length, carried.length),
          `The word "${kept}${carried}" is broken across pages ${line.page} → ${next.page}: ` +
            `${carried.length} of ${kept.length + carried.length} letters are already on ` +
            `the next page.`,
        );
      }
    }

    /* ——— a word from the exception list ———
     *
     * The comparison runs against the RECONSTRUCTED word (fragment +
     * continuation), not against the fragment alone, as the brief proposed.
     * The reason isn't theoretical: under a prefix comparison, the list
     * ["Шевченко"] flags «Ше-вчук», because «Шевченко» starts with «Ше».
     * Ukrainian surnames share prefixes abundantly, so a prefix comparison on
     * a real list misfires systematically.
     *
     * WHY THE PREDICATE IS SHAPED THIS WAY, and not "the list word is a
     * prefix of the reconstructed one." Ukrainian inflection: the list holds
     * the lemma «Шевченко», while the text has «Шевченком», «Шевченка». So
     * agreement is needed IN BOTH DIRECTIONS: the reconstructed word either
     * continues the list word (inflection), or is its beginning (the word is
     * split again further on). A mismatch outside `kept` rejects the match —
     * that's exactly what makes «Ше|вчук» fall away from «Шевченко».
     *
     * THE COST OF THIS DECISION, three points, the third found by review:
     *  1. with no next line, there's no verdict at all;
     *  2. a word split TWICE yields one finding at the FIRST break, not two —
     *     the second fragment («чен» in «Шев|чен|ко») is not the beginning of
     *     a list word. This is exactly what the `w.startsWith(whole)`
     *     conjunct is responsible for: without it, even the first break
     *     wouldn't be found, because «Шевчен» doesn't continue «Шевченко»;
     *  3. **FALSE POSITIVES FROM WORD FORMATION.** `whole.startsWith(w)`
     *     accepts ANY tail, not just an inflectional ending, so the list
     *     ["Іван"] flags «Іва|ненко», and ["Лев"] flags «Лев|ченко». This
     *     happens for real on a list of surnames, and I'm not drawing a word
     *     boundary here: telling an inflectional ending apart from a
     *     derivational suffix requires Ukrainian morphology, which this
     *     module doesn't have and shouldn't have. The practical consequence
     *     for whoever builds the list: keep FULL forms in it («Іваненко», not
     *     «Іван») — the shorter the entry, the wider it catches;
     *  4. **A CHANGE TO THE STEM'S FINAL LETTER ISN'T CAUGHT.** The rule only
     *     sees the inflection that ADDS a tail: «Шевченко» → «Шевченком» is
     *     caught, because the lemma is a prefix of the form. But in the
     *     genitive «Шевченка» the final «о» is REPLACED, a prefix is no
     *     longer enough, and there's no finding. This was exposed by the very
     *     first test run after the apostrophe fix. The rule CANNOT be widened
     *     to "shared prefix longer than the fragment": that would bring back
     *     the false positive «Ше|вчук» against «Шевченко», which this whole
     *     predicate exists to get rid of. Telling a stem replacement apart
     *     from word formation is only possible with Ukrainian morphology,
     *     which isn't here and shouldn't be, so the boundary is named,
     *     covered by a test, and left in place. Whoever wants to catch
     *     inflected forms adds them to the list as separate entries. */
    if (forbidden.length > 0 && kept.length > 0 && next !== null) {
      const carried = wordHead(next.text);
      const whole = kept + carried;
      /* The apostrophe is folded to a single glyph form on both sides of the
       * comparison — see `foldApostrophes`. The finding's explanation text
       * carries the UNFOLDED strings.
       *
       * `w.startsWith(kept)` is NOT needed here and is deliberately absent: it
       * follows from the two remaining conditions. If `w` is longer than the
       * fragment and either starts with `whole` (= `kept` + continuation) or
       * is its beginning, then in both cases `w` starts with `kept`. A
       * mutation run confirmed this — the redundant condition couldn't be
       * killed by any test. */
      const foldedWhole = foldApostrophes(whole);
      const hit = forbidden.find((w) => {
        const fw = foldApostrophes(w);
        return fw.length > kept.length && (fw.startsWith(foldedWhole) || foldedWhole.startsWith(fw));
      });
      if (hit !== undefined && carried.length > 0) {
        push(
          line,
          "hyphen-forbidden",
          carried.length,
          fragmentStrength(kept.length, carried.length),
          /* Named `whole` and not `hit`: the numbers alongside it count the letters
           * of the RECONSTRUCTED word, and a sentence that names one word while
           * measuring another would read as "'Шевченко' … 3 of 6 letters." The
           * list entry appears as a separate clause giving the reason, not as
           * the thing being counted. */
          `The word "${whole}" is broken after "${kept}": ${carried.length} of ` +
            `${whole.length} letters are carried to the next line. ` +
            `The exceptions list forbids hyphenating "${hit}".`,
        );
      }
    }
  }
  flush();

  out.sort(
    (a, b) =>
      (a.defect < b.defect ? -1 : a.defect > b.defect ? 1 : 0) ||
      b.strength - a.strength ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return out;
}

/** The distribution of hyphenations across the range — input for a human choosing the threshold. */
export interface HyphenSurvey {
  /** The detector's denominator: lines eligible for measurement. */
  judged: number;
  /** Of those, the ones ending in a hyphenation. */
  hyphenated: number;
  /**
   * The lengths of ALL maximal hyphenation runs, ascending. Raw, not
   * aggregated: Task 12 slices the document into batches of pages, and
   * averaging batch percentiles isn't valid — they need to be computed on the
   * merged sample.
   *
   * This is the very quantity missing for deriving `maxLadder`: there is no
   * run-length distribution in `docs/measured-facts-phase3.md`.
   */
  runs: number[];
  /** Percentiles by nearest rank; NaN on an empty sample, not 0. */
  percentiles: { p50: number; p75: number; p95: number; max: number };
  /** Hyphenations on the LAST line of a frame — candidates for a page-turn split. */
  frameBreaks: number;
  /** Of those, the ones whose continuation truly lies on another page. */
  acrossSpread: number;
  /**
   * Breaks at a frame seam whose continuation is missing from the SAMPLE, so no
   * verdict about the page exists. These are NOT "clean" lines: under the
   * current per-page narrowing (which discards an entire story), the count
   * should be zero, and a nonzero value means the sample was sliced
   * differently than the detector assumes.
   */
  undecidableSpread: number;
  /**
   * Breaks where the continuation exists and the page differs, but no word is
   * visible (a fragment or continuation with no letters at all). There is no
   * finding, because `Finding.measured` is always a number.
   */
  unmeasuredWord: number;
  /** Outside the denominator by construction — these are NOT "clean" lines. */
  excluded: { notMeasurable: number };
}

/**
 * Measures, but flags nothing. Exists because `maxLadder` is a convention
 * without a measurement: before trusting the number, you need to see the run
 * distribution on YOUR OWN document. The "survey first, threshold second"
 * order was set by Task 8.
 *
 * The selection rules here are the same as in `detectHyphens`, and that's
 * exactly why both functions read the same `isMeasurable` and the same
 * `continuationOf`: two copies of this sequence would have diverged, and the
 * survey would start counting a different denominator than the one the
 * detector flags against.
 */
export function surveyHyphens(lines: readonly LineMeasure[]): HyphenSurvey {
  const runs: number[] = [];
  const excluded = { notMeasurable: 0 };
  let judged = 0;
  let hyphenated = 0;
  let frameBreaks = 0;
  let acrossSpread = 0;
  let undecidableSpread = 0;
  let unmeasuredWord = 0;

  let runPrev: LineMeasure | null = null;
  let runLength = 0;
  const flush = (): void => {
    if (runLength > 0) runs.push(runLength);
    runPrev = null;
    runLength = 0;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!isMeasurable(line)) {
      excluded.notMeasurable++;
      flush();
      continue;
    }
    judged++;
    if (!line.endsWithHyphen) {
      flush();
      continue;
    }
    hyphenated++;

    const continues =
      runPrev !== null &&
      runPrev.containerId === line.containerId &&
      runPrev.paragraphIndex === line.paragraphIndex &&
      runPrev.lineInParagraph + 1 === line.lineInParagraph;
    if (continues) runLength++;
    else {
      flush();
      runLength = 1;
    }
    runPrev = line;

    if (!line.isLastInFrame) continue;
    frameBreaks++;
    const next = continuationOf(lines, i);
    if (next === null) {
      undecidableSpread++;
      continue;
    }
    if (next.page === line.page) continue;
    if (wordTail(line.text).length === 0 || wordHead(next.text).length === 0) {
      unmeasuredWord++;
      continue;
    }
    acrossSpread++;
  }
  flush();

  runs.sort((a, b) => a - b);
  return {
    judged,
    hyphenated,
    runs,
    percentiles: {
      p50: percentile(runs, 0.5),
      p75: percentile(runs, 0.75),
      p95: percentile(runs, 0.95),
      max: runs.length === 0 ? NaN : runs[runs.length - 1]!,
    },
    frameBreaks,
    acrossSpread,
    undecidableSpread,
    unmeasuredWord,
    excluded,
  };
}

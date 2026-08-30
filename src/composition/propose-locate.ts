/**
 * Locators — translate a FINDING into absolute bounds in the container's text.
 *
 * Split out of `propose.ts` on 2026-08-05: that file had grown to 1001 lines,
 * and its `describe()` already branched with a switch over ten defect
 * classes. The split direction was named as debt back in Phase 4 and carried
 * out literally: this file keeps the address arithmetic, `propose.ts` keeps
 * the class maps and `proposeFixes` itself. Behavior is unchanged: moved
 * verbatim, no logic edits.
 *
 * Why this particular boundary. A one-character error HERE means writing to
 * the wrong place in the book — the worst possible consequence in the whole
 * phase. Keeping this arithmetic next to the formatting of descriptions and
 * percentages would have meant re-reading it alongside them every time.
 */
import type { ContainerSnapshot } from "../corrections/types.js";
import { dashOffsetInLine, precedingWord } from "./detect-dashes.js";
import { wordTail } from "./detect-hyphens.js";
import { isMeasurable } from "./measurable.js";
import type { Finding, LineMeasure } from "./types.js";

/** "Didn't work, and here's why" — a separate type so the reason doesn't get lost along the way. */
export type Attempt<T> = { ok: true; value: T } | { ok: false; blocked: string };

export const no = (blocked: string): Attempt<never> => ({ ok: false, blocked });

/** A paragraph in the sample: its lines by number and all its findings. */
export interface Paragraph {
  /** The paragraph's lines from the passed sample, keyed by `lineInParagraph`. */
  byIndex: Map<number, LineMeasure>;
  /** This paragraph's findings — all of them, not only the ones with a write. */
  findingIds: string[];
}

/** Paragraph key. `U+0000` never occurs in `containerId`, so the join is unambiguous. */
export function paragraphKey(containerId: string, paragraphIndex: number): string {
  return containerId + "\u0000" + paragraphIndex;
}

/**
 * Soft hyphen. Written as a code point: in the source text it's invisible.
 *
 * VERIFIED ON LIVE InDesign (Task 14, W2) — before that it was a documented
 * Adobe assumption that NOTHING on this branch actually exercised. Run on the
 * `__fixture_make_composition` fixture, InDesign 21.4.1.4:
 *
 *   BEFORE: line 0 "Considerable internation" (endsWithHyphen = true),
 *           "international" broken by the composer into "internation" + "al";
 *   fix: replace [13; 24) "internation" with "U+00AD + internation";
 *   AFTER: line 0 "Considerable ­international " (endsWithHyphen = false) —
 *          the word moved down WHOLE, the hyphenation is off.
 *
 * So the mark BEFORE the word genuinely does turn off hyphenation for the
 * whole word, and the fix isn't a no-op. The same run also showed the cost
 * named in `describe`: line 1 got a NEW break ("communication requires ex-")
 * that wasn't there before the write. That's exactly `displaced` — the whole
 * reason the re-measurement exists.
 */
export const SOFT_HYPHEN = String.fromCharCode(0x00ad);

/**
 * A regular space — written as a code point rather than a literal: next to a
 * non-breaking one (`NBSP`, left in `propose.ts` — only fix formatting uses
 * it) they look identical, and mixing them up by eye is exactly the way to
 * corrupt a fix that must not happen here.
 */
export const SPACE = String.fromCharCode(0x0020);

/** Paragraph-end mark in `story.contents` — see `SEPARATORS` in `normalize.ts`. */
const PARAGRAPH_END = "\r";

/**
 * Absolute paragraph and line offset in the container's text — arithmetic
 * shared by both locators. Two copies of this would drift apart, and a
 * one-character error here means writing to the wrong place in the book.
 *
 * TWO CHECKS, both needed:
 *  1. the paragraph stitched together from lines must MATCH the paragraph
 *     from the snapshot — this catches a gap in numbering, an incomplete
 *     paragraph, and any parsing mismatch;
 *  2. each locator then checks ITS OWN target against the computed bounds.
 * A third check already exists in `apply.jsx`: `expectedOld` is compared
 * immediately before the write, and a mismatch produces `skipped` rather
 * than a blind write.
 */
export function stitchParagraph(
  f: Finding,
  para: Paragraph,
  line: LineMeasure,
  containers: readonly ContainerSnapshot[] | undefined,
): Attempt<{ snapshot: ContainerSnapshot; paragraphStart: number; offsetInParagraph: number }> {
  if (containers === undefined) {
    return no(
      "No container text: the edit's absolute offsets are taken only from a snapshot " +
        "(containers_read), because LineMeasure doesn't carry them. Pass opts.containers.",
    );
  }
  const snapshot = containers.find((c) => c.containerId === f.containerId);
  if (snapshot === undefined) {
    return no(`No container "${f.containerId}" among the passed snapshots.`);
  }

  const parts = snapshot.text.split(PARAGRAPH_END);
  if (f.paragraphIndex >= parts.length) {
    return no(
      `The container snapshot has ${parts.length} paragraphs, but the finding is in paragraph ` +
        `${f.paragraphIndex}: paragraph parsing diverged from the measurement.`,
    );
  }
  let paragraphStart = 0;
  for (let i = 0; i < f.paragraphIndex; i++) paragraphStart += parts[i]!.length + 1;
  const isLastParagraph = f.paragraphIndex === parts.length - 1;
  const paragraphText = parts[f.paragraphIndex]! + (isLastParagraph ? "" : PARAGRAPH_END);

  let joined = "";
  let offsetInParagraph = 0;
  for (let i = 0; i < line.paragraphLineCount; i++) {
    const l = para.byIndex.get(i);
    if (l === undefined) {
      return no(
        `Paragraph not fully measured: out of ${line.paragraphLineCount} lines the sample is missing ` +
          `line ${i}, so the offset within the paragraph is unknown.`,
      );
    }
    if (i < f.lineInParagraph) offsetInParagraph += l.text.length;
    joined += l.text;
  }
  if (joined !== paragraphText) {
    return no(
      "The paragraph stitched from lines diverged from the measurement: the snapshot text doesn't match what " +
        "was measured. Writing at such offsets is not safe.",
    );
  }
  return { ok: true, value: { snapshot, paragraphStart, offsetInParagraph } };
}

/**
 * Absolute bounds of a word fragment in the container's text — or the reason
 * they don't exist.
 *
 * CHECK 2 (the text at the found bounds must equal the fragment itself) is
 * ARTIFICIALLY UNCOVERED, and that's stated outright rather than hidden. A
 * mutation run showed no test can kill it, and the reason is strict: once
 * check 1 (`stitchParagraph`) has passed, the paragraph offset is computed
 * from the lengths of those same `parts`, and the offset within the
 * paragraph from that same stitched text, so the slice ALWAYS equals the
 * fragment. So check 2 doesn't guard against the data — it guards against a
 * future arithmetic error in this file. Left in on purpose: a one-character
 * error here means writing to the wrong place in the book, the worst
 * possible consequence in the whole phase. (The same accounting as
 * `isMeasurable` in `detect-rivers.ts`: a rule that guards a class not
 * represented in the corpus is more honest to name than to pass off as
 * covered.) Check 1 is killed by the "mismatch AFTER the word" test.
 */
export function locateWord(
  f: Finding,
  para: Paragraph,
  containers: readonly ContainerSnapshot[] | undefined,
): Attempt<{ start: number; end: number; word: string }> {
  const line = para.byIndex.get(f.lineInParagraph);
  if (line === undefined) return no("Line not found among the measured ones.");
  if (!isMeasurable(line)) return no("Line is not measurable.");

  const word = wordTail(line.text);
  if (word.length === 0) {
    return no("No word fragment visible at the end of the line — there's nothing to place the mark before.");
  }

  const st = stitchParagraph(f, para, line, containers);
  if (!st.ok) return st;
  const { snapshot, paragraphStart, offsetInParagraph } = st.value;

  const inLine = line.text.lastIndexOf(word);
  if (inLine < 0) return no("Word fragment not found in its own line's text.");
  const start = paragraphStart + offsetInParagraph + inLine;
  const end = start + word.length;
  if (snapshot.text.slice(start, end) !== word) {
    return no("The text at the computed bounds doesn't match the word fragment — the offset has diverged from the measurement.");
  }
  if (start > 0 && snapshot.text[start - 1] === SOFT_HYPHEN) {
    return no("There's already a soft hyphen before the word — the fix is already applied.");
  }
  return { ok: true, value: { start, end, word } };
}

/**
 * Absolute position of the space before a dash — or the reason it doesn't
 * exist.
 *
 * The end-of-sentence exception is NOT checked here, and that's deliberate:
 * it answers the question "is this a defect", and the detector has already
 * answered that — possibly with a different set of sentence endings, which
 * isn't passed down here. The locator only asks about the address.
 */
export function locateDashSpace(
  f: Finding,
  para: Paragraph,
  containers: readonly ContainerSnapshot[] | undefined,
): Attempt<{ start: number; word: string }> {
  const line = para.byIndex.get(f.lineInParagraph);
  if (line === undefined) return no("Line not found among the measured ones.");
  if (!isMeasurable(line)) return no("Line is not measurable.");

  const prev = para.byIndex.get(f.lineInParagraph - 1);
  if (prev === undefined) {
    return no("The previous line isn't among the measured ones — the space before the dash can't be addressed.");
  }

  const d = dashOffsetInLine(line.text);
  if (d === null) return no("The line no longer starts with a dash — the measurement has diverged from the finding.");

  const st = stitchParagraph(f, para, line, containers);
  if (!st.ok) return st;
  const { snapshot, paragraphStart, offsetInParagraph } = st.value;

  const start = paragraphStart + offsetInParagraph + d - 1;
  if (start < 0) return no("The dash is at the very start of the paragraph — there's no space before it.");
  if (snapshot.text[start] !== SPACE) {
    return no(
      "The computed position isn't a regular space — most likely the fix is already " +
        "applied (a non-breaking space is there).",
    );
  }
  /*
   * DOUBLE SPACE BEFORE A DASH — debt from the `line-start-dash` branch,
   * closed on 2026-08-05 by refusing to fix rather than by a silent one.
   *
   * What used to happen. The fix replaces the SECOND space with a
   * non-breaking one, producing "space + NBSP + dash". The line break can now
   * land on the FIRST space — and the line starts with a dash again, only now
   * with a non-breaking space before it. Visually the defect is still there,
   * but a repeat audit sees the NBSP and calls it clean: the fix didn't repair
   * the line, it just made it invisible to the next check. That's worse than
   * not fixing it at all.
   *
   * Why refuse rather than replace both spaces with one NBSP: the problem
   * here isn't the dash, it's the double space — a standalone error that
   * `collapse-spaces` in `typography_apply` should be the one to remove. The
   * `line-start-dash` class is declared as an INVISIBLE fix (`FIX_KIND`): it
   * replaces a character without changing the text's length. Deleting a
   * character would turn it into a text edit and silently widen the class's
   * contract.
   */
  if (start > 0 && snapshot.text[start - 1] === SPACE) {
    return no(
      "There are TWO consecutive spaces before the dash. Replacing the second with a non-breaking one won't fix " +
        "the line: the break will land on the first space, the dash will end up at the start of the line again, " +
        "and a repeat audit will already consider the spot fixed. First remove the double " +
        "space with the collapse-spaces rule in typography_apply, then come back here.",
    );
  }
  return { ok: true, value: { start, word: precedingWord(prev.text) } };
}


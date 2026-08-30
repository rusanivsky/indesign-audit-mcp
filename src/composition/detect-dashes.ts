/**
 * The fifth composition detector: a dash that starts a line mid-sentence.
 *
 * WHY THIS IS A COMPOSITION DETECTOR, NOT A TEXT RULE
 * ==================================================
 * The question "did it start a new line" doesn't exist without composition.
 * The text-rule equivalent of the same idea ("always a non-breaking space
 * before a dash") is deliberately rejected and not even added to
 * `rules-uk.ts`: that file's header names the reason — non-breaking spaces
 * give thousands of matches and recompose the text the most aggressively.
 * Here the rule fires EXACTLY where the defect is.
 *
 * WHAT'S DECIDED HERE
 * ===============
 * - **Only real dashes.** A hyphen between spaces is its own defect, already
 *   fixed by `dash-separator` in `typography_apply`. Catching it here would
 *   mean LOCKING IN the wrong mark with a non-breaking space instead of first
 *   turning it into a dash. The minus sign U+2212 is excluded for the mirror
 *   reason: in "x − y" a break before the sign is normal.
 * - **A closing quote is transparent, not a sentence end.** The exception
 *   asks "does the dash open a new sentence", and the mark UNDER the quote
 *   answers it. Otherwise «Він сказав «іди» / — і пішов» would be an
 *   exception, i.e. a real defect that got missed (spec §4.3.7).
 * - **The dash's position is looked up, not assumed.** Whose space sits at
 *   the line boundary — the end of the previous line or the start of the
 *   next — is the composer's call. `types.ts` measured that InDesign leaves
 *   it in the PREVIOUS line (which is exactly why 13 lines of the book
 *   "exceed" `columnWidth`), so in practice the dash sits at position 0. But
 *   a rule written on that assumption would lose findings SILENTLY if it
 *   ever broke — and a silent loss here is worse than an extra look at the line.
 */

import { wordTail } from "./detect-hyphens.js";
import { findingId } from "./finding.js";
import { isMeasurable } from "./measurable.js";
import type { Finding, LineMeasure, Severity } from "./types.js";

/** Four real dashes. The hyphen and the minus sign are NOT included — see the header. */
export const DASHES: ReadonlySet<string> = new Set([
  "—" /* em dash */,
  "–" /* en dash */,
  "‒" /* figure dash */,
  "―" /* horizontal bar */,
]);

/**
 * Sentence endings for the exception. The set is a MATTER OF TASTE, not a
 * measurement: the colon was added here by the user on 2026-08-05, and in
 * another book the decision could differ. That's exactly why it's
 * overridable via an option, while the sets of dashes and transparent marks
 * are not: those follow from the defect class, not from the book.
 */
export const SENTENCE_ENDERS: readonly string[] = [".", "!", "?", "…", ":"];

/**
 * Marks the sentence-end exception looks THROUGH. They neither end a
 * sentence nor start one — they only wrap whatever's underneath.
 */
const TRANSPARENT: ReadonlySet<string> = new Set([
  "»",
  String.fromCharCode(0x201d),
  String.fromCharCode(0x0022),
  String.fromCharCode(0x2019),
  ")",
  "]",
]);

/** Horizontal whitespace: `\s` is forbidden here — it would eat `\r`. */
const H_SPACE = /[^\S\r\n]/u;
/** The trailing run of horizontal whitespace. */
const TRAILING_H_SPACE = /[^\S\r\n]+$/u;

const SPACE = String.fromCharCode(0x0020);
const NBSP = String.fromCharCode(0x00a0);

/**
 * The dash's offset within the line's text — or `null` if the line doesn't
 * start with a dash. "Starts with" means: nothing but horizontal whitespace
 * precedes the dash.
 *
 * EXPORTED for `propose.ts`: the fix proposal must find EXACTLY the position
 * the detector flagged as a finding. A separate parse there would silently
 * diverge from this one.
 */
export function dashOffsetInLine(text: string): number | null {
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (DASHES.has(ch)) return i;
    if (!H_SPACE.test(ch)) return null;
  }
  return null;
}

/**
 * The word the dash will stick to. An empty string means: before the space
 * there is no word, only a punctuation mark; this doesn't get in the way of
 * the fix, only of the description.
 */
export function precedingWord(prevText: string): string {
  return wordTail(prevText.replace(TRAILING_H_SPACE, ""));
}

/**
 * The predicate's verdict. Each rejection is named separately, because each
 * has its own counter in the survey: "not found" must not be
 * indistinguishable from "wasn't looked at".
 */
export type DashVerdict =
  | { kind: "finding"; dashInLine: number }
  | { kind: "no-dash" }
  | { kind: "not-space"; why: "forcedBreak" | "alreadyNbsp" | "other" }
  | { kind: "sentence-end" }
  | { kind: "dash-before" };

/**
 * Whether this line has an orphaned dash. `prev` is the PREVIOUS line of the
 * same paragraph; selecting lines (eligibility, master, first line of a
 * paragraph) is the caller's job — only the text is looked at here.
 */
export function judgeDashLine(
  line: LineMeasure,
  prev: LineMeasure,
  sentenceEnders: ReadonlySet<string> = new Set(SENTENCE_ENDERS),
): DashVerdict {
  const d = dashOffsetInLine(line.text);
  if (d === null) return { kind: "no-dash" };

  /* The mark right before the dash. When d > 0, it sits in THIS line; when
   * d === 0, it's the last character of the previous line. */
  const before = d > 0 ? line.text[d - 1]! : (prev.text[prev.text.length - 1] ?? "");
  if (before !== SPACE) {
    return {
      kind: "not-space",
      why:
        before === NBSP
          ? "alreadyNbsp"
          : before === "\n" || before === "\r"
            ? "forcedBreak"
            : "other",
    };
  }

  /* Everything between the start of the line and the dash is only whitespace
   * (otherwise dashOffsetInLine would have returned null), so the head of the
   * sentence sits entirely in the previous line. */
  let head = prev.text.replace(TRAILING_H_SPACE, "");

  /* A forced break followed by a space. The dash opens a new line by the
   * author's will, not the composer's — this is the same exception. */
  if (head.endsWith("\n") || head.endsWith("\r")) return { kind: "not-space", why: "forcedBreak" };

  while (head.length > 0 && TRANSPARENT.has(head[head.length - 1]!)) head = head.slice(0, -1);

  const last = head[head.length - 1];
  /* No preceding text is left at all — there's nothing to glue onto. */
  if (last === undefined) return { kind: "sentence-end" };
  if (sentenceEnders.has(last)) return { kind: "sentence-end" };
  if (DASHES.has(last)) return { kind: "dash-before" };

  return { kind: "finding", dashInLine: d };
}

export interface DashOptions {
  /**
   * Lines from parent pages. Defaulting to `false` is the same policy as the
   * other four detectors (Phase 4 spec, §8): `page` for them is the master's
   * name, not a page number, and a fix there edits the template, not the book.
   */
  includeMasters?: boolean;
  /**
   * Sentence-end marks. Defaults to `SENTENCE_ENDERS`. **An empty array
   * disables the sentence-end exception entirely** — this is a legitimate
   * mode, not a bug: in a corpus without dialogue, a sentence end before a
   * dash never occurs.
   */
  sentenceEnders?: readonly string[];
}

const DEFECT = "line-start-dash" as const;

/**
 * The weight is always `error`, and the class is NOT in
 * `SEVERITY_VARYING_CLASSES`. The document declares no number here at all,
 * the predicate is binary, and the exact rule that already held for the
 * seven existing classes is broken; with this one they become eight — see
 * `SEVERITY_VARYING_CLASSES` in `detect.ts`.
 */
const DASH_SEVERITY: Severity = "error";

/**
 * The strength is constant — see the `unranked` scale doc in `finding.ts`.
 * That's not derived out of laziness: there is no quantity by which one
 * orphaned dash would be "worse" than another, and this module refuses to
 * invent one, the same way the three previous ones refused to invent an
 * inter-class order.
 */
const DASH_STRENGTH = 1;

/** The paragraph key. ` ` never occurs in `containerId`, so the join is unambiguous. */
function paragraphKey(line: LineMeasure): string {
  return `${line.containerId} ${line.paragraphIndex}`;
}

/**
 * Lines grouped by paragraph. Adjacency in the ARRAY is not adjacency in the
 * paragraph: the array comes from the caller, and relying on an order the
 * detector doesn't control isn't safe — the same caution as in the
 * hyphenation detector's `continuationOf`.
 */
function byParagraph(lines: readonly LineMeasure[]): Map<string, Map<number, LineMeasure>> {
  const out = new Map<string, Map<number, LineMeasure>>();
  for (const l of lines) {
    const key = paragraphKey(l);
    let m = out.get(key);
    if (m === undefined) {
      m = new Map();
      out.set(key, m);
    }
    m.set(l.lineInParagraph, l);
  }
  return out;
}

export function detectDashes(lines: readonly LineMeasure[], opts: DashOptions = {}): Finding[] {
  const enders = new Set(opts.sentenceEnders ?? SENTENCE_ENDERS);
  const index = byParagraph(lines);
  const out: Finding[] = [];

  for (const line of lines) {
    if (line.isMaster && !opts.includeMasters) continue;
    /* This detector doesn't use geometry — only text. The filter exists for the
     * sake of one shared population across all five detectors (`detect.ts`),
     * not because a rotated line's geometry breaks anything here. */
    if (!isMeasurable(line)) continue;
    /* The first line of a paragraph is the start of the paragraph, i.e. an
     * exception. List items land here too, automatically: an item is its
     * own paragraph. */
    if (line.lineInParagraph === 0) continue;

    const prev = index.get(paragraphKey(line))?.get(line.lineInParagraph - 1);
    if (prev === undefined) continue;

    const v = judgeDashLine(line, prev, enders);
    if (v.kind !== "finding") continue;

    const word = precedingWord(prev.text);
    out.push({
      id: findingId(line, DEFECT),
      defect: DEFECT,
      severity: DASH_SEVERITY,
      page: line.page,
      containerId: line.containerId,
      paragraphIndex: line.paragraphIndex,
      lineInParagraph: line.lineInParagraph,
      lineText: line.text,
      /* "One orphaned dash." By contract `measured` is ALWAYS a number, and there
       * is nothing to build a continuous quantity out of here — see
       * DASH_STRENGTH. */
      measured: 1,
      strength: DASH_STRENGTH,
      detail:
        `The line starts with a dash "${line.text[v.dashInLine]}", torn away from ` +
        `${word.length > 0 ? `the word "${word}"` : "the previous line"}. This is not the start ` +
        "of a paragraph, a line of dialogue, or a sentence.",
    });
  }

  return out;
}

/**
 * An unmarked survey. Exists for the same reason as `surveyHyphens`: before
 * trusting a rule, you need to see how much of what it touches in ITS OWN
 * document. How many such findings are in the book — NOT MEASURED, and
 * there's no made-up number here.
 */
export interface DashSurvey {
  /** The denominator: eligible non-master lines with `lineInParagraph > 0`. */
  eligible: number;
  /** Of those, the ones that start with a dash. */
  startsWithDash: number;
  /** There's no previous line in the sample — no verdict exists. */
  skippedNoPreviousLine: number;
  /** The mark before the dash isn't `U+0020`. */
  skippedNotSpace: { forcedBreak: number; alreadyNbsp: number; other: number };
  /** The sentence-end exception fired. */
  skippedSentenceEnd: number;
  /** Another dash sits before the dash. */
  skippedDashBefore: number;
  findings: number;
  /** Outside the denominator by construction — these are NOT "clean" lines. */
  excluded: { notMeasurable: number; master: number; firstInParagraph: number };
}

export function surveyDashes(
  lines: readonly LineMeasure[],
  opts: DashOptions = {},
): DashSurvey {
  const enders = new Set(opts.sentenceEnders ?? SENTENCE_ENDERS);
  const index = byParagraph(lines);
  const s: DashSurvey = {
    eligible: 0,
    startsWithDash: 0,
    skippedNoPreviousLine: 0,
    skippedNotSpace: { forcedBreak: 0, alreadyNbsp: 0, other: 0 },
    skippedSentenceEnd: 0,
    skippedDashBefore: 0,
    findings: 0,
    excluded: { notMeasurable: 0, master: 0, firstInParagraph: 0 },
  };

  for (const line of lines) {
    if (line.isMaster && !opts.includeMasters) {
      s.excluded.master++;
      continue;
    }
    if (!isMeasurable(line)) {
      s.excluded.notMeasurable++;
      continue;
    }
    if (line.lineInParagraph === 0) {
      s.excluded.firstInParagraph++;
      continue;
    }
    s.eligible++;

    if (dashOffsetInLine(line.text) === null) continue;
    s.startsWithDash++;

    const prev = index.get(paragraphKey(line))?.get(line.lineInParagraph - 1);
    if (prev === undefined) {
      s.skippedNoPreviousLine++;
      continue;
    }

    const v = judgeDashLine(line, prev, enders);
    switch (v.kind) {
      case "finding":
        s.findings++;
        break;
      case "sentence-end":
        s.skippedSentenceEnd++;
        break;
      case "dash-before":
        s.skippedDashBefore++;
        break;
      case "not-space":
        s.skippedNotSpace[v.why]++;
        break;
      case "no-dash":
        /* Unreachable: `dashOffsetInLine` already gave a non-null result above, and
         * `judgeDashLine` starts with that very same call. The branch exists
         * because the `switch` is exhaustive by type, and falling through it
         * silently would hide a divergence between the two calls. */
        throw new Error("surveyDashes: judgeDashLine didn't see the dash that was just found.");
    }
  }

  return s;
}

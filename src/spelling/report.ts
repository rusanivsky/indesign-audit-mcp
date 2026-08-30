/**
 * The `language` and `dictionary` families produce findings — this module turns them
 * into a response a human reads. Three decisions carry the whole design.
 *
 * 1) Sorting — BY FREQUENCY ASCENDING, not descending. A typo happens once; a
 *    deliberate choice — forty times. The book yielded 8081 word-types, 4787 of
 *    them occurring exactly once (`docs/measured-facts-phase9.md`, Task 1);
 *    sorting descending would bury every typo candidate under "Ойойой ×47" —
 *    the book's own title, which no dictionary will ever have.
 *
 * 2) `word-unknown` is NOT counted in `deviating`. "Not in the dictionary" is a
 *    fact about the dictionary, not an error: proper names, invented words,
 *    borrowings, and new norms are legitimately absent. `word-not-checked`, on
 *    the contrary, is counted — a range without a dictionary was not measured at
 *    all, and an unmarked state must not silently pass as "clean" (the same
 *    principle as in `WordTypeFinding`, types.ts). Of the `language` family,
 *    `language-none` is counted; `language-stray` is not (a harmless stray tag,
 *    comment at `LanguageDefect`).
 *
 * 3) COMPLETENESS yields to the CEILING when the two together don't fit — but
 *    this is ALWAYS visible, never silent. Most of the book's words occur
 *    exactly once, i.e. they're all pinned to the same `count = 1`, and a byte
 *    budget, cutting by size, would slice exactly this mass of typos
 *    ARBITRARILY, alphabetically (Task 16, round-1 review) — the silent
 *    disappearance of candidates chosen by the alphabet is worse than a large
 *    response. So `words` (structured rows: `count`, `pages`, `language`…) is
 *    trimmed by the budget FIRST, and `wordsAll`/`wordsNotCheckedAll` (bare
 *    strings, no structure) only as a LAST resort, when even they themselves
 *    don't fit the OVERALL response budget (round 2: the constant had to govern
 *    the book as it grows, not just this one). `truncated` names the trimming
 *    out loud for ALL three fields separately — a silently full ceiling reads as
 *    "everything is covered" (the Phase 8 rule, `pagination_audit`).
 */
import { serialise } from "../serialise.js";
import type { LanguageFinding, SpellingReport, WordTypeFinding } from "./types.js";

/**
 * The OVERALL response budget in bytes (not just `words` — round 1 of this task
 * did exactly that, and the round-2 review showed why it doesn't work for a
 * future book: `wordsAll`/`wordsNotCheckedAll` and the response's service
 * fields (docName, dictionaries, languages, caveat…) grow together with the
 * book, and a ceiling on `words` alone would never see this — 549 B of margin
 * out of 45 KB (1.2%) would dissolve into a single new sentence of the book).
 * Taken from MEASUREMENT, not from a ceiling: Phase 4 knocked a tool out of
 * commission at 78 KB, styles_audit lives at 69 KB and was already called
 * "on the edge" back then.
 *
 * WHERE EXACTLY to look for "margin" is an important clarification.
 * `buildReport` fills `words` UNTIL the budget runs out ("fill-to-budget"): as
 * soon as the book has more word-types than full detail can hold (here — yes:
 * all 562 with full structure and full bare lists weigh 114,717 B, far beyond
 * any safe ceiling), the response will ALWAYS land right up against the
 * ceiling itself — the same way a packed suitcase sits right against the
 * latch no matter how it's packed. So "margin as a percentage of
 * MAX_RESPONSE_BYTES" is almost always small (here ≈300 B, ≈0.6% — left over
 * from SMALL_FIELDS_SAFETY_MARGIN_BYTES and per-row rounding), and THIS IS
 * NORMAL: the real margin that matters is the distance FROM THE CEILING
 * ITSELF to the 78 KB failure threshold, because it's exactly this distance
 * that protects against the book growing.
 *
 * THE ARITHMETIC (measured on the book, `dist/`, 2026-08-13, round 2):
 *   - the response's service fields + `language` findings (everything EXCEPT
 *     words/wordsAll/wordsNotCheckedAll), passed by the caller as
 *     `otherFieldsBytes`: ≈ 6,973 B;
 *   - `wordsAll` (494 word-unknown word-types) + `wordsNotCheckedAll`
 *     (68 word-not-checked word-types), as bare strings, FULL: ≈ 11,615 B;
 *   - the rest goes to `words`: 162 detailed rows out of 562 (rarest first);
 *   - the actual OVERALL response: 49,696 B (≈48.5 KB) — 304 B (0.6%) short
 *     of the ceiling itself, 50,000 (expected, fill-to-budget, see above), but
 *     28,304 B (36.3%) short of the 78 KB failure threshold — and this margin
 *     is the real protection against a future, bigger book: even if
 *     `otherFieldsBytes`/the bare lists grow, the 50,000 ceiling won't let the
 *     overall response cross it, and the ceiling itself stays far from 78 KB.
 *
 * THE NUMBERS ABOVE WERE TAKEN BEFORE 2026-08-16, when `ok()` still
 * serialized with indentation. Since then the format is compact, i.e. roughly
 * a third more content fits into that same 50,000 B, while the ceiling itself
 * remains the OVERALL response's ceiling. The arithmetic hasn't been
 * re-measured — it stands here as the history of the decision, not as the
 * current measurement; the current number is printed by
 * `scripts/measure-response-size.mjs spelling_audit`.
 */
export const MAX_RESPONSE_BYTES = 50_000;

/**
 * Reserve for `deviating` (a number), `wordTypesTotal` (a number), and
 * `truncated` (an object with six fields and a text `note` describing TWO
 * possible truncation scenarios — round 2). A fixed conservative estimate,
 * not a precise measurement: the exact size of `truncated` is known only
 * AFTER the truncation decision (which rows/words fit), and the decision
 * needs the budget BEFORE that — the same "chicken-and-egg" cycle as the
 * `words` budget itself. The longest real `note` (the "ceiling won over
 * completeness" scenario) is ≈300 Cyrillic characters (≈600 B in UTF-8);
 * 700 B leaves a margin.
 */
export const SMALL_FIELDS_SAFETY_MARGIN_BYTES = 700;

/**
 * How many BYTES the object `{ [key]: value }` weighs, as it will ACTUALLY go
 * into the response — using the SAME `serialise` that `ok()` outputs, in
 * UTF-8. Not an estimate — the field's actual size.
 *
 * This function already measured the wrong format twice, and both times the
 * bug was silent. The first version (Task 16, Step 2) counted the CHARACTERS
 * of the compact string — and on the live book produced a 75,754 B actual
 * response against a 40,000 budget, because Cyrillic in UTF-8 is two bytes
 * per character, and `ok()` back then still serialized with indentation.
 * The second (round 1) weighed the array on its own, without the key,
 * missing a level of nesting.
 *
 * Now diverging from the response is impossible by construction: the format
 * isn't named here at all — it comes from `src/serialise.ts`, the very place
 * the server takes it from. The key stays (`{ [key]: value }`), because in
 * compact JSON it too costs bytes.
 */
function fieldBytes(key: string, value: unknown): number {
  return Buffer.byteLength(serialise({ [key]: value }), "utf8");
}

/** How many of the first elements of `sorted` (already ordered by priority) fit under `budget` bytes, when the array goes under the key `key`. */
function fitRows(sorted: WordTypeFinding[], budget: number): WordTypeFinding[] {
  const shown: WordTypeFinding[] = [];
  for (const w of sorted) {
    const candidate = shown.concat(w);
    if (fieldBytes("words", candidate) > budget) break;
    shown.push(w);
  }
  return shown;
}

/** The same as `fitRows`, but for a bare list of words under an arbitrary key (`wordsAll`/`wordsNotCheckedAll`, round 2 — the ceiling won over completeness). */
function fitBareList(key: "wordsAll" | "wordsNotCheckedAll", list: string[], budget: number): string[] {
  if (budget <= 0) return [];
  const shown: string[] = [];
  for (const word of list) {
    const candidate = shown.concat(word);
    if (fieldBytes(key, candidate) > budget) break;
    shown.push(word);
  }
  return shown;
}

export function buildReport(args: {
  language: LanguageFinding[];
  words: WordTypeFinding[];
  maxResponseBytes?: number;
  /**
   * The bytes that the response's service fields (docName, dictionaries,
   * languagesWithoutDictionary, caveat, the languages inventory — everything
   * `buildReport` does NOT return) will eat on top of what this function
   * returns. The caller (tools/spelling.ts) measures this UP FRONT, using the
   * same `fieldBytes`, and passes it in here — otherwise the
   * `words`/`wordsAll`/`wordsNotCheckedAll` budget would be computed as if
   * the response consisted only of them (round 2).
   */
  otherFieldsBytes?: number;
}): SpellingReport {
  const budget = args.maxResponseBytes ?? MAX_RESPONSE_BYTES;
  const otherFieldsBytes = args.otherFieldsBytes ?? 0;

  /* Sorting BY FREQUENCY ASCENDING: the most valuable thing is what occurred
   * once, not "Ойойой ×47", under which a typo would be buried (see the
   * header). */
  const sorted = [...args.words].sort(
    (a, b) => a.count - b.count || a.word.localeCompare(b.word, "uk"),
  );
  const wordsAllFull = sorted.filter((w) => w.defect === "word-unknown").map((w) => w.word);
  const wordsNotCheckedAllFull = sorted
    .filter((w) => w.defect === "word-not-checked")
    .map((w) => w.word);

  const languageBytes = fieldBytes("language", args.language);
  const fixedBytes = otherFieldsBytes + languageBytes + SMALL_FIELDS_SAFETY_MARGIN_BYTES;
  const remaining = Math.max(0, budget - fixedBytes);

  /* FULL bare lists, NOT yet truncated — needed to check whether they fit at
   * all into what's left of the budget. */
  const bareBytesFull = Buffer.byteLength(
    serialise({ wordsAll: wordsAllFull, wordsNotCheckedAll: wordsNotCheckedAllFull }),
    "utf8",
  );

  let wordsAll: string[];
  let wordsNotCheckedAll: string[];
  let shown: WordTypeFinding[];

  if (bareBytesFull <= remaining) {
    /* The normal case (this book, round 2): COMPLETENESS is guaranteed, DETAIL
     * gets the rest of the budget. */
    wordsAll = wordsAllFull;
    wordsNotCheckedAll = wordsNotCheckedAllFull;
    shown = fitRows(sorted, remaining - bareBytesFull);
  } else {
    /* The EDGE case (a much larger edition): even the FULL bare lists don't
     * fit the budget. The ceiling WINS, completeness LOSES — and this MUST be
     * visible (truncated below), not silent. No detail remains at all. */
    shown = [];
    wordsAll = fitBareList("wordsAll", wordsAllFull, remaining);
    const usedByWordsAll = fieldBytes("wordsAll", wordsAll);
    wordsNotCheckedAll = fitBareList(
      "wordsNotCheckedAll",
      wordsNotCheckedAllFull,
      Math.max(0, remaining - usedByWordsAll),
    );
  }

  /* word-unknown is NOT a deviation: "not in the dictionary" ≠ "error" (see
   * the header, item 2). language-stray likewise isn't counted — a harmless
   * stray tag. Counted from the FULL set, not the truncated one — truncating
   * the response must not change the verdict. */
  const deviating =
    args.language.filter((f) => f.defect !== "language-stray").length +
    args.words.filter((f) => f.defect === "word-not-checked").length;

  const wordsTruncated = shown.length < sorted.length;
  const wordsAllTruncated = wordsAll.length < wordsAllFull.length;
  const wordsNotCheckedAllTruncated = wordsNotCheckedAll.length < wordsNotCheckedAllFull.length;
  const bareListsTruncated = wordsAllTruncated || wordsNotCheckedAllTruncated;

  return {
    deviating,
    language: args.language,
    words: shown,
    wordsAll,
    wordsNotCheckedAll,
    wordTypesTotal: sorted.length,
    /* A silently full ceiling reads as "everything is covered" — the Phase 8
     * rule. `null` only when ALL THREE fields are complete. When only DETAIL
     * is truncated — nothing is lost (completeness is intact). When the bare
     * lists are truncated too — that's a LOSS, and `note` says so directly,
     * not with the same text as the normal case (round 2, the requirement
     * "the ceiling won — say plainly what was cut"). */
    truncated:
      wordsTruncated || bareListsTruncated
        ? {
            shown: shown.length,
            total: sorted.length,
            wordsAllShown: wordsAll.length,
            wordsAllTotal: wordsAllFull.length,
            wordsNotCheckedAllShown: wordsNotCheckedAll.length,
            wordsNotCheckedAllTotal: wordsNotCheckedAllFull.length,
            note: bareListsTruncated
              ? `The budget isn't even enough for the FULL word list: showing ${wordsAll.length} of ` +
                `${wordsAllFull.length} word-unknown and ${wordsNotCheckedAll.length} of ` +
                `${wordsNotCheckedAllFull.length} word-not-checked, rarest first. Details ` +
                `(frequency, pages) are not shown at all — the budget wasn't enough even for those.`
              : `Shown in detail (with frequency and pages): ${shown.length} word-types out of ` +
                `${sorted.length}, rarest first. The rest — IN FULL, word only, in ` +
                `wordsAll/wordsNotCheckedAll: no word disappears, only some lack structure.`,
          }
        : null,
  };
}

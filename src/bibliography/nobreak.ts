/**
 * Reconciling InDesign's TWO non-breaking mechanisms into one answer.
 *
 * Non-breaking is done via the U+00A0 character in the text (visible on an
 * ordinary read of the content) OR via the `Text.noBreak` attribute,
 * typically applied through a GREP style in a paragraph style (nothing
 * visible in the text — the character remains an ordinary space). A rule
 * that checks only characters will produce thousands of false positives on
 * an edition using a GREP style (spec §0.5, §7.2). That's exactly why this
 * is a separate module, not two lines inside the rule.
 */

import { runJsx } from "../bridge/runner.js";
import { NO_BREAK_SPACES } from "./chars.js";

export interface NoBreakQuery {
  containerId: string;
  start: number;
  end: number;
}

export interface NoBreakAnswer {
  protectedByAttribute: boolean;
}

/*
 * Task 5 review: `readNoBreak` sends ONE batch for the whole bibliography —
 * on the real book that can be on the order of ~9000 ranges, with unique and
 * increasing offsets (not like the tiny fixture, where 9000 requests over 70
 * characters completed in 4.85s thanks to repeated indexes). `DEFAULT_TIMEOUT`
 * in `src/bridge/runner.ts` is 30,000 ms, sized for a typical read, not for a
 * batch pass over an entire story's length: the cost of `characters[idx]` in
 * ExtendScript depends on position, so 30s on the real book may not be
 * enough — and the failure would arrive as a bridge timeout, from which the
 * cause isn't visible.
 *
 * The number here is a CEILING WITH HEADROOM, by the same principle as
 * STYLES_MEASURE_TIMEOUT_MS/PAGINATION_MEASURE_TIMEOUT_MS
 * (src/tools/styles.ts, src/tools/pagination.ts): not a time measured on the
 * real book (that's Task 13), but headroom deliberately chosen above the
 * typical DEFAULT_TIMEOUT for an operation that reads an entire
 * business-scale story.
 */
const NOBREAK_READ_TIMEOUT_MS = 120_000;

/**
 * Whether a pair of characters (the [start, end) range in `text`) is
 * protected from breaking. `byAttribute` is the attribute mechanism's answer
 * for the same range, obtained beforehand via `readNoBreak`.
 */
export function isProtected(
  text: string,
  start: number,
  end: number,
  byAttribute: boolean,
): boolean {
  if (byAttribute) return true;
  /*
   * НЕ ЛИШЕ U+00A0. Захистом є БУДЬ-ЯКИЙ пробільний символ, що не дає
   * перенесення: вузький нерозривний U+202F і цифровий U+2007 роблять рівно
   * те саме, що й U+00A0. Доти зараховувався тільки останній, тож роздільник,
   * набраний вузьким нерозривним (звичайна річ у наборі з тонкими пробілами
   * коло ініціалів), звітувався як НЕЗАХИЩЕНИЙ, ще й з упевненістю `high`.
   */
  return NO_BREAK_SPACES.some((ch) => text.slice(start, end).includes(ch));
}

/** A pointwise read of the attribute as a batch. An empty batch doesn't bother the bridge. */
export async function readNoBreak(queries: NoBreakQuery[]): Promise<boolean[]> {
  if (queries.length === 0) return [];
  const res = await runJsx<{ answers: boolean[] }>(
    "nobreak_read",
    { queries },
    { timeoutMs: NOBREAK_READ_TIMEOUT_MS },
  );
  return res.answers;
}

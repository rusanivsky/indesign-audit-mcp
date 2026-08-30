/**
 * K2. Parses an editor's note into variants and presents the context for a decision.
 *
 * Scope boundary: this module does NOT choose a variant. It only preserves all
 * variants without loss and gives the whole paragraph, so the choice can be made
 * with knowledge of the context. The model makes the choice, and that's exactly
 * why it isn't covered by a unit test.
 */

/** Paragraph and line separators — the same ones as in normalize.ts. */
const PARA_BREAK = /[\r\n\u2028\u2029]/;

export interface ParsedNote {
  /** All variants in the order the editor wrote them. */
  variants: string[];
  /** The original note, unchanged. */
  raw: string;
  /**
   * The note ended with an ellipsis — by convention this means
   * "the rest of the text stays as is", not part of the replacement.
   */
  openEnded: boolean;
}

/**
 * A comma as a variant separator is dangerous: it also occurs inside a phrase
 * ("and then, when it got dark"). We split on it only when there are no other
 * separators AND every part is a single word. This is a deliberately conservative
 * heuristic: an unsplit variant that should have been split ends up in the
 * disputed bucket, whereas a wrongly split phrase would silently corrupt the text.
 */
function splitVariants(text: string): string[] {
  const bySlash = text.split("/").map((s) => s.trim()).filter((s) => s.length > 0);
  if (bySlash.length > 1) return bySlash;

  const byOr = text.split(/\s+(?:або|чи)\s+/u).map((s) => s.trim()).filter((s) => s.length > 0);
  if (byOr.length > 1) return byOr;

  const byComma = text.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  if (byComma.length > 1 && byComma.every((p) => !/\s/u.test(p))) return byComma;

  const single = text.trim();
  return single.length > 0 ? [single] : [];
}

export function parseNote(note: string): ParsedNote {
  const raw = note;
  let body = note.trim();

  const openEnded = /\.{3,}\s*$/u.test(body);
  if (openEnded) body = body.replace(/\.{3,}\s*$/u, "").trim();

  return { variants: splitVariants(body), raw, openEnded };
}

/**
 * The paragraph containing the character at index — the WHOLE paragraph, edge
 * to edge. A truncated fragment won't do here: the decision on a variant often
 * depends on a word at the other end of the sentence.
 */
export function paragraphAt(text: string, index: number): string {
  let start = index;
  while (start > 0 && !PARA_BREAK.test(text[start - 1]!)) start--;
  let end = index;
  while (end < text.length && !PARA_BREAK.test(text[end]!)) end++;
  return text.slice(start, end);
}

export interface VariantDecision {
  /** The text that will actually go into the document. */
  chosen: string;
  /** Whose variant this is: the editor's or our own. Never conflate the two. */
  source: "editor" | "own";
  /** Index into ParsedNote.variants; null for our own variant. */
  variantIndex: number | null;
  /** The paragraph in whose context the decision was made. */
  paragraph: string;
  /** Why this particular variant. Goes into the report. */
  reason: string;
}

/**
 * K4. Dictionary of editor commands.
 *
 * The editor doesn't only write "was → became" pairs. They write «видалити»
 * (delete), «зайве слово» (extra word), «прибрати абзац» (remove the
 * paragraph break). The pipeline must understand these, not substitute the
 * note as literal text.
 */

export type EditorCommand =
  | { kind: "delete" }
  | { kind: "join-paragraph" }
  | { kind: "split-paragraph" }
  | { kind: "swap" }
  | { kind: "replace"; text: string };

/*
 * WATCH THE ORDER: «прибрати абзац» (remove the paragraph break) must be
 * checked BEFORE «прибрати» (remove), otherwise a paragraph-join command
 * gets recognized as a text deletion — which destroys the whole paragraph
 * instead of removing a single line-break character.
 */
const JOIN = /(прибрати|забрати|зняти|з'?єднати|об'?єднати|склеїти)\s+абзац/iu;
const SPLIT = /(розбити|розділити)\s+абзац|нови[йм]\s+абзац|з\s+нового\s+абзацу|поділити\s+абзац/iu;
const SWAP = /поміняти\s+місцями|переставити|поміняти\s+порядок/iu;
const DELETE = /^\s*(видалити|прибрати|вилучити|забрати|зняти|геть)\s*$|зайв[аеиійо]\w*\s+\S+/iu;

/**
 * «прибрати абзац» = remove the line BREAK; the next sentence continues on
 * the same line. This is NOT a deletion of the paragraph's text.
 */
export function parseCommand(note: string): EditorCommand | null {
  const text = note.trim();
  if (text.length === 0) return null;

  if (JOIN.test(text)) return { kind: "join-paragraph" };
  if (SPLIT.test(text)) return { kind: "split-paragraph" };
  if (SWAP.test(text)) return { kind: "swap" };
  if (DELETE.test(text)) return { kind: "delete" };

  return { kind: "replace", text };
}

const SEPARATOR = /[\r\n\u2028\u2029]/;
const SPACE = /[ \t\u00A0]/;

/**
 * The range whose replacement joins two paragraphs. Captures the separator
 * together with the spaces on both sides of it and puts exactly one space in
 * their place — otherwise a double space, invisible on screen, is left at
 * the seam.
 *
 * `at` — any index inside or next to the separator.
 */
export function joinParagraphRange(
  source: string,
  at: number,
): { start: number; end: number; newText: string } | null {
  // Find the separator: first at `at`, then to the right of it.
  let sep = -1;
  for (let i = Math.max(0, at); i < source.length; i++) {
    if (SEPARATOR.test(source[i]!)) { sep = i; break; }
    if (!SPACE.test(source[i]!)) break;
  }
  if (sep === -1) {
    for (let i = Math.min(at, source.length) - 1; i >= 0; i--) {
      if (SEPARATOR.test(source[i]!)) { sep = i; break; }
      if (!SPACE.test(source[i]!)) break;
    }
  }
  if (sep === -1) return null;

  let start = sep;
  while (start > 0 && SPACE.test(source[start - 1]!)) start--;
  let end = sep + 1;
  while (end < source.length && SEPARATOR.test(source[end]!)) end++;
  while (end < source.length && SPACE.test(source[end]!)) end++;

  return { start, end, newText: " " };
}
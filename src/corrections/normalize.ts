/** Characters that simply disappear during matching. */
const DROP = new Set([0x00ad, 0x200b, 0x200c, 0x200d, 0xfeff]);

/** Everything considered whitespace and collapsed into a single space. */
const WS = new Set([
  0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, 0x00a0, 0x1680,
  0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007,
  0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
]);

/**
 * Paragraph and line separators. This is a subset of WS: for MATCHING they still
 * behave as ordinary whitespace (otherwise an `old` with trailing whitespace would
 * simply stop being found), but the WRITE range has no right to contain them —
 * a replacement that covers a separator destroys a paragraph boundary that the user
 * didn't ask to remove. In ExtendScript, `\r` in `contents` is exactly the paragraph
 * end mark, `\n` is a forced line break.
 */
const SEPARATORS = new Set([0x000d, 0x000a, 0x2028, 0x2029]);

export function isSeparator(code: number): boolean {
  return SEPARATORS.has(code);
}

export function isMatchWhitespace(code: number): boolean {
  return WS.has(code);
}

/** Whether the string has a paragraph or line break — i.e. whether the user asked for it explicitly. */
export function hasSeparator(text: string): boolean {
  for (let i = 0; i < text.length; i++) if (SEPARATORS.has(text.charCodeAt(i))) return true;
  return false;
}

const DOUBLE_QUOTES = new Set(['«', '»', '„', '“', '”', '‟', '❝', '❞', '"', '‹', '›']);
const SINGLE_QUOTES = new Set(["'", '‘', '’', '‚', '‛', '`', '´']);
const DASHES = new Set(['-', '‐', '‑', '‒', '–', '—', '―', '−']);

export interface NormalizedText {
  /** The normalized text that matching is performed against. */
  text: string;
  /** map[i] — the source index where normalized character i starts. */
  map: number[];
  /** mapEnd[i] — the source index right after the characters collapsed into character i. */
  mapEnd: number[];
}

export function normalizeForMatching(source: string): NormalizedText {
  const out: string[] = [];
  const map: number[] = [];
  const mapEnd: number[] = [];
  let i = 0;

  while (i < source.length) {
    const code = source.charCodeAt(i);

    if (DROP.has(code)) {
      i++;
      continue;
    }

    if (WS.has(code)) {
      const start = i;
      while (i < source.length && (WS.has(source.charCodeAt(i)) || DROP.has(source.charCodeAt(i)))) i++;
      out.push(" ");
      map.push(start);
      mapEnd.push(i);
      continue;
    }

    const ch = source[i]!;
    map.push(i);
    mapEnd.push(i + 1);
    if (DOUBLE_QUOTES.has(ch)) out.push('"');
    else if (SINGLE_QUOTES.has(ch)) out.push("'");
    else if (DASHES.has(ch)) out.push("-");
    else out.push(ch);
    i++;
  }

  return { text: out.join(""), map, mapEnd };
}

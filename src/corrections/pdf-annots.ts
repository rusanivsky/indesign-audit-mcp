import { readFile } from "node:fs/promises";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export interface PdfAnnotation {
  /** 1-based page number. */
  page: number;
  type: string;
  author: string;
  date: string;
  /** The corrector's comment text. */
  note: string;
  /** Text under the markup; empty for notes without QuadPoints. */
  markedText: string;
  contextBefore: string;
  contextAfter: string;
  /**
   * Filled in only when the text under the markup could not be extracted, and
   * says why. An empty markedText with no explanation would look like "the
   * corrector marked nothing", when in fact the annotation exists but could
   * not be read.
   */
  markedTextIssue?: string;
}

interface PositionedItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Index where this fragment starts within the page's assembled text. */
  offset: number;
  /**
   * A rotated or vertical fragment: the text matrix has a nonzero b or c.
   * All the geometry below (x + width along the line, per-character
   * interpolation along +x) makes no sense for such a fragment.
   */
  rotated: boolean;
}

const CONTEXT = 40;
/** I5: there is nothing to recover the text under the markup from on a rotated fragment. */
const ROTATED_TEXT_ISSUE =
  "The text under the markup lies in a rotated or vertical fragment — " +
  "it cannot be recovered from the PDF. Type old in by hand from the PDF itself.";
const MARKUP_TYPES = new Set(["Highlight", "StrikeOut", "Underline", "Squiggly", "Caret"]);

/**
 * Extracts the corrector's annotations from a PDF together with the text they
 * mark up. The text under the markup is recovered by matching QuadPoints
 * against the coordinates of the text fragments that pdfjs returns.
 *
 * This is a tool the MCP server will call many times over its lifetime
 * (pdf_read_annotations), so pdfjs resources (document, worker, font cache)
 * are released in finally — REGARDLESS of which step failed: whether the PDF
 * did not load at all (invalid file), or an exception occurred already while
 * processing pages/annotations. `getDocument()` synchronously spins up an
 * in-process fake worker in Node (pdfjs, _setupFakeWorker) BEFORE it is even
 * known whether the PDF is valid — so even a rejection of
 * `loadingTask.promise` itself (unreadable PDF) leaves the worker and font
 * cache alive unless destroy() is called for that case too (Task 4, debt from
 * Task 9, fix round 1 review).
 */
export async function readPdfAnnotations(filePath: string): Promise<PdfAnnotation[]> {
  const data = await readPdfFile(filePath);

  const loadingTask = getDocument({ data, useSystemFonts: true });
  try {
    let pdf: PdfDocumentProxy;
    try {
      pdf = await loadingTask.promise;
    } catch (e) {
      throw describePdfLoadError(filePath, e);
    }

    const result: PdfAnnotation[] = [];

    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
      const page = await pdf.getPage(pageNo);
      const annotations = await page.getAnnotations({ intent: "display" });
      if (annotations.length === 0) continue;

      const { items, pageText } = await collectPageText(page);

      for (const a of annotations) {
        const type = String(a.subtype ?? "");
        if (type === "Link" || type === "Popup" || type === "Widget") continue;

        let markedText = "";
        let contextBefore = "";
        let contextAfter = "";
        let markedTextIssue: string | undefined;

        // pdfjs returns quadPoints as a Float32Array, not a plain Array —
        // Array.isArray is always false here, so we check for the presence of a length instead.
        if (MARKUP_TYPES.has(type) && a.quadPoints != null && a.quadPoints.length > 0) {
          const { span: raw, rotated } = spanFromQuadPoints(a.quadPoints, items);
          if (rotated) {
            markedTextIssue = ROTATED_TEXT_ISSUE;
          } else if (raw) {
            // The corrector almost always marks up whole words: an approximate per-character
            // position (especially for non-standard fonts or Cyrillic, where there is no
            // exact metric) can drift by a character or two. Snapping to
            // the nearest word boundaries in pageText removes this error almost always
            // and does not depend on the accuracy of the character-width table.
            const span = snapSpanToWords(pageText, raw.start, raw.end);
            markedText = pageText.slice(span.start, span.end);
            contextBefore = pageText.slice(Math.max(0, span.start - CONTEXT), span.start);
            contextAfter = pageText.slice(span.end, span.end + CONTEXT);
          }
        } else if (Array.isArray(a.rect) && a.rect.length >= 4) {
          // A sticky note (Text) has no QuadPoints — there is no marked-up text,
          // but the annotation's Rect shows where on the page it was placed.
          // Without this, the pipeline that processes notes has nothing to anchor to
          // when looking for the location of a correction.
          const ctx = contextFromRect(a.rect as number[], items, pageText);
          contextBefore = ctx.contextBefore;
          contextAfter = ctx.contextAfter;
        }

        result.push({
          page: pageNo,
          type,
          author: String(a.titleObj?.str ?? a.title ?? ""),
          date: String(a.modificationDate ?? ""),
          note: String(a.contentsObj?.str ?? a.contents ?? ""),
          markedText: stripPdfLineBreaks(markedText),
          contextBefore: stripPdfLineBreaks(contextBefore),
          contextAfter: stripPdfLineBreaks(contextAfter),
          ...(markedTextIssue ? { markedTextIssue } : {}),
        });
      }
    }

    return result;
  } finally {
    // We call loadingTask.destroy() specifically (not pdf.destroy() — they
    // are equivalent: pdf.destroy() just delegates here), because loadingTask
    // is available right after getDocument(), unlike pdf, which
    // only exists inside the nested try, after pdf.promise succeeds.
    await loadingTask.destroy();
  }
}

/** Reads the file into memory, turning common filesystem errors into clear messages. */
async function readPdfFile(filePath: string): Promise<Uint8Array> {
  try {
    return new Uint8Array(await readFile(filePath));
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new Error(`PDF file not found: ${filePath}. Check the path and try again.`);
    }
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Could not read file ${filePath}: ${message}. Check the file's access permissions.`,
    );
  }
}

/**
 * Turns a raw pdfjs exception (e.g. InvalidPDFException with a message
 * unclear to the operator, "Invalid PDF structure.") into a message that
 * plainly states what happened and what to do — Task 9, debt from Task 4.
 */
function describePdfLoadError(filePath: string, e: unknown): Error {
  const name = e instanceof Error ? e.name : "";

  if (name === "InvalidPDFException") {
    return new Error(
      `The file is not a valid PDF or is corrupted: ${filePath}. Check that this is really a PDF file, and try another.`,
    );
  }
  if (name === "PasswordException") {
    return new Error(`The PDF is password-protected: ${filePath}. Remove the password protection and try again.`);
  }
  if (name === "MissingPDFException") {
    return new Error(`PDF file not found: ${filePath}. Check the path and try again.`);
  }

  const message = e instanceof Error ? e.message : String(e);
  return new Error(`Could not read PDF ${filePath}: ${message}.`);
}

/**
 * Line breaks in a PDF are not part of the text.
 * A soft hyphen (U+00AD) is only a layout hint for where a word may be
 * broken; it was never meant to be a visible character, so we remove it
 * together with the break. A real hyphen ("-") is part of a word (e.g.
 * "синьо-жовтий"), and if the line happens to be broken right at it, the
 * hyphen must be kept and only the line break itself removed. A plain break
 * (with no hyphen of either kind) is turned into a space, as a boundary
 * between two words.
 */
export function stripPdfLineBreaks(text: string): string {
  return text
    .replace(/(\p{L})­\s*\n\s*(\p{L})/gu, "$1$2")
    .replace(/(\p{L})-\s*\n\s*(\p{L})/gu, "$1-$2")
    .replace(/\s*\n\s*/g, " ");
}

// Derived pdfjs types: getDocument() returns a loading task with a
// `promise` field that resolves to a document; the document's `.getPage` resolves to a page.
// (The original expression from the brief applied ReturnType to `.promise` —
// a promise property, not a function — which doesn't typecheck; fixed here.)
type PdfDocumentProxy = Awaited<ReturnType<typeof getDocument>["promise"]>;
type PdfPageProxy = Awaited<ReturnType<PdfDocumentProxy["getPage"]>>;

async function collectPageText(
  page: PdfPageProxy,
): Promise<{ items: PositionedItem[]; pageText: string }> {
  const content = await page.getTextContent();
  const items: PositionedItem[] = [];
  let pageText = "";

  for (const raw of content.items) {
    const item = raw as {
      str?: string;
      transform?: number[];
      width?: number;
      height?: number;
      hasEOL?: boolean;
    };

    if (typeof item.str === "string" && item.str.length > 0) {
      const t = item.transform ?? [1, 0, 0, 1, 0, 0];
      items.push({
        str: item.str,
        x: t[4] ?? 0,
        y: t[5] ?? 0,
        width: item.width ?? 0,
        height: item.height ?? 0,
        offset: pageText.length,
        rotated: (t[1] ?? 0) !== 0 || (t[2] ?? 0) !== 0,
      });
      pageText += item.str;
    }

    // pdfjs marks the end of a line with the hasEOL field (often on a separate empty
    // element {str:"", hasEOL:true}, sometimes on the last non-empty
    // element of the line). Ignoring this glues the text of two lines together with no
    // separator at all — and any markup that crosses a line break
    // (a common situation for a struck-through phrase) is recovered incorrectly.
    if (item.hasEOL) pageText += "\n";
  }

  return { items, pageText };
}

/**
 * Relative character widths of the Helvetica font (Standard 14, WinAnsi) in
 * thousandths of an em — public font metric data (AFM), not text content.
 * pdfjs returns only a single text fragment with a total width for a line,
 * with no position for each individual glyph, so splitting the width evenly
 * across characters (uniform perChar) is systematically wrong for a
 * proportional font: verified on a fixture — boundaries came out shifted by a
 * whole character. This table gives a much more accurate ESTIMATE of each
 * character's relative width; the sum is normalized to the fragment's real
 * measured width, so the error does not accumulate even if a character is
 * missing from the table or the document's font is different.
 *
 * The table is only an approximation, and for non-standard fonts or Cyrillic
 * (where no character is in the table at all) it degenerates into an even
 * split. So this approximation is never the final word: the result is always
 * anchored to word boundaries in snapSpanToWords, which is what removes the
 * error within a margin of a couple of characters regardless of how accurate
 * this table is.
 */
const HELVETICA_WIDTHS: Record<string, number> = {
  " ": 278, "!": 278, '"': 355, "#": 556, $: 556, "%": 889, "&": 667, "'": 191,
  "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333, ".": 278, "/": 278,
  "0": 556, "1": 556, "2": 556, "3": 556, "4": 556, "5": 556, "6": 556, "7": 556,
  "8": 556, "9": 556, ":": 278, ";": 278, "<": 584, "=": 584, ">": 584, "?": 556,
  "@": 1015,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500,
  K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611,
  U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  "[": 278, "\\": 278, "]": 278, "^": 469, _: 556, "`": 333,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222,
  k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278,
  u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
  "{": 334, "|": 260, "}": 334, "~": 584,
};
const DEFAULT_CHAR_WIDTH = 556;

/**
 * Approximate left/right x-edges of each character in the fragment: the
 * widths are taken from the Helvetica table (the best approximation for
 * standard fonts), and the sum is normalized to the fragment's real width
 * from pdfjs (item.width), so the positions always stay within
 * [item.x, item.x + item.width] regardless of how closely the document's
 * font matches the table.
 */
function charEdges(item: PositionedItem): number[] | null {
  // I5: interpolation runs only along +x, so for a rotated or vertical
  // fragment it produces not an approximation but garbage — better nothing than a wrong answer.
  if (item.rotated) return null;
  const raw: number[] = [];
  for (const ch of item.str) raw.push(HELVETICA_WIDTHS[ch] ?? DEFAULT_CHAR_WIDTH);
  const rawTotal = raw.reduce((a, b) => a + b, 0);
  const scale = rawTotal > 0 ? item.width / rawTotal : 0;

  const edges: number[] = [item.x];
  let x = item.x;
  for (const w of raw) {
    x += w * scale;
    edges.push(x);
  }
  return edges;
}

/**
 * QuadPoints come as quadruples of corners (x1,y1 … x4,y4) in PDF
 * coordinates. A fragment is considered marked up if its horizontal midpoint
 * falls within the rectangle and its baseline falls within its vertical
 * bounds.
 */
function spanFromQuadPoints(
  quadPoints: ArrayLike<number>,
  items: PositionedItem[],
): { span: { start: number; end: number } | null; rotated: boolean } {
  const boxes: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (let i = 0; i + 7 < quadPoints.length; i += 8) {
    const xs = [quadPoints[i]!, quadPoints[i + 2]!, quadPoints[i + 4]!, quadPoints[i + 6]!];
    const ys = [quadPoints[i + 1]!, quadPoints[i + 3]!, quadPoints[i + 5]!, quadPoints[i + 7]!];
    boxes.push({
      x1: Math.min(...xs),
      y1: Math.min(...ys),
      x2: Math.max(...xs),
      y2: Math.max(...ys),
    });
  }
  if (boxes.length === 0) return { span: null, rotated: false };

  let start = Number.POSITIVE_INFINITY;
  let end = -1;

  for (const item of items) {
    /*
     * A rotated fragment: none of the checks below make sense (width runs
     * along the line, not along x). The only meaningful sign of involvement
     * with the markup is the fragment's start falling inside some quad. If it
     * is involved, the whole annotation is treated as unread: a partial
     * "extracted something" here would mean garbage in the old field.
     */
    if (item.rotated) {
      const involved = boxes.some(
        (b) => item.x >= b.x1 - 2 && item.x <= b.x2 + 2 && item.y >= b.y1 - 2 && item.y <= b.y2 + 2,
      );
      if (involved) return { span: null, rotated: true };
      continue;
    }

    const cy = item.y;
    const yMatches = boxes.filter((b) => cy >= b.y1 - 2 && cy <= b.y2 + 2);
    if (yMatches.length === 0) continue; // the fragment is not on the same line as any quad

    const itemX1 = item.x;
    const itemX2 = item.x + item.width;

    // The fragment lies entirely inside some quad (typical for lines
    // fully covered by markup in a multi-line selection) — in that case there's no
    // need to interpolate anything, we take the whole fragment.
    const fullyInside = yMatches.some((b) => itemX1 >= b.x1 - 2 && itemX2 <= b.x2 + 2);
    if (fullyInside) {
      start = Math.min(start, item.offset);
      end = Math.max(end, item.offset + item.str.length);
      continue;
    }

    // The fragment lies entirely outside the horizontal bounds of all quads on this line —
    // skip it, without spending time on per-character interpolation.
    const noOverlap = yMatches.every((b) => itemX2 < b.x1 || itemX1 > b.x2);
    if (noOverlap) continue;

    // Partial overlap: the fragment may be longer than the markup — we count
    // per character, using approximate but normalized-to-the-real-width
    // character boundaries.
    const edges = charEdges(item);
    if (!edges) return { span: null, rotated: true };
    for (let c = 0; c < item.str.length; c++) {
      const cx = (edges[c]! + edges[c + 1]!) / 2;
      const inside = yMatches.some((b) => cx >= b.x1 && cx <= b.x2);
      if (!inside) continue;
      start = Math.min(start, item.offset + c);
      end = Math.max(end, item.offset + c + 1);
    }
  }

  if (end < 0) return { span: null, rotated: false };
  return { span: { start, end }, rotated: false };
}

/**
 * Snaps an approximately computed range [start, end) to the nearest word
 * boundaries in pageText. The corrector marks up whole words practically
 * always, so replacing an "approximate character position" with the
 * "nearest word boundary" removes the error of a character or two that
 * approximate (not guaranteed accurate for an arbitrary font) character-width
 * interpolation inevitably produces. If no suitable boundaries exist (e.g.
 * the markup lies within a run of whitespace), returns the original range
 * unchanged.
 */
function snapSpanToWords(
  pageText: string,
  start: number,
  end: number,
): { start: number; end: number } {
  if (start >= end) return { start, end };

  // First we trim whitespace from the edges of the "raw" range. Without this step
  // a stray extra space at the boundary (a typical ± one character interpolation error)
  // can lie EXACTLY halfway between the end of the neighboring word and the start
  // of the intended one — then the "nearest boundary" for it is unstable (at equal
  // distance an arbitrary side gets picked) and drags a wrong word into the result
  // entirely, instead of simply discarding the stray space.
  let s = start;
  let e = end;
  while (s < e && /\s/.test(pageText[s]!)) s++;
  while (e > s && /\s/.test(pageText[e - 1]!)) e--;
  if (s >= e) return { start, end };

  const wordStarts: number[] = [];
  const wordEnds: number[] = [];
  const wordRe = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = wordRe.exec(pageText))) {
    wordStarts.push(m.index);
    wordEnds.push(m.index + m[0]!.length);
  }

  const snappedStart = nearest(wordStarts, s);
  const snappedEnd = nearest(wordEnds, e);
  if (snappedStart === undefined || snappedEnd === undefined || snappedStart >= snappedEnd) {
    return { start: s, end: e };
  }
  return { start: snappedStart, end: snappedEnd };
}

/** Returns the element of `candidates` nearest to `target` (by absolute difference). */
function nearest(candidates: number[], target: number): number | undefined {
  let best: number | undefined;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    const d = Math.abs(c - target);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

/**
 * For notes without QuadPoints (sticky notes), finds the nearest text
 * fragment by coordinates and returns the context around the approximate
 * point within it that the annotation's Rect points to. This way the
 * pipeline that processes notes gets at least some textual anchor near the
 * comment's location — without this, a sticky note would have nothing at
 * all to anchor it to the layout's text.
 */
function contextFromRect(
  rect: number[],
  items: PositionedItem[],
  pageText: string,
): { contextBefore: string; contextAfter: string } {
  if (items.length === 0 || rect.length < 4) return { contextBefore: "", contextAfter: "" };

  const rx = (rect[0]! + rect[2]!) / 2;
  const ry = (rect[1]! + rect[3]!) / 2;

  let best: PositionedItem | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const item of items) {
    const dy = Math.abs(item.y - ry);
    const dx =
      rx >= item.x && rx <= item.x + item.width
        ? 0
        : Math.min(Math.abs(rx - item.x), Math.abs(rx - (item.x + item.width)));
    // Vertical proximity matters more: a note is almost always attached to
    // a specific line, and only after that to a specific place within it.
    const dist = dy * 1000 + dx;
    if (dist < bestDist) {
      bestDist = dist;
      best = item;
    }
  }
  if (!best) return { contextBefore: "", contextAfter: "" };

  const frac = best.width > 0 ? clamp((rx - best.x) / best.width, 0, 1) : 0;
  const approxOffset = best.offset + Math.round(frac * best.str.length);

  return {
    contextBefore: pageText.slice(Math.max(0, approxOffset - CONTEXT), approxOffset),
    contextAfter: pageText.slice(approxOffset, approxOffset + CONTEXT),
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

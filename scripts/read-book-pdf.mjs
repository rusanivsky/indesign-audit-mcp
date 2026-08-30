/*
 * A PDF text extractor for a character-by-character comparison of a run
 * on the book.
 *
 * The ENTIRE page text is compared, not just the folio: Phase 7 did
 * exactly that ("196 pages, zero discrepancies"), and it's the only way
 * to see a change you didn't expect. Short lines that look like a folio
 * are called out separately — so a discrepancy can be read by eye, not
 * only counted.
 */
import { readFile, writeFile } from "node:fs/promises";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const [, , pdfPath, outPath] = process.argv;
const pdf = await getDocument({ data: new Uint8Array(await readFile(pdfPath)) }).promise;

const pages = [];
for (let i = 1; i <= pdf.numPages; i++) {
  const content = await (await pdf.getPage(i)).getTextContent();
  const items = content.items.map((it) => it.str);
  const all = items.join("").replace(/\s+/g, " ").trim();
  /* This book's folio looks like "96–97": two numbers separated by a dash. */
  const folio = items
    .map((s) => s.trim())
    .filter((s) => /^\d{1,3}\s*[–—-]\s*\d{1,3}$/.test(s) || /^\d{1,3}$/.test(s));
  pages.push({ page: i, folio, all });
}

await writeFile(outPath, JSON.stringify(pages), "utf8");
console.log(`${pdfPath}: ${pdf.numPages} сторінок, колонцифр знайдено ${pages.filter((p) => p.folio.length > 0).length}`);

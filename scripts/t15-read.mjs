import { readFile, writeFile } from "node:fs/promises";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
const path = process.argv[2];
const outJson = process.argv[3];
const pdf = await getDocument({ data: new Uint8Array(await readFile(path)) }).promise;
const pages = [];
for (let i = 1; i <= pdf.numPages; i++) {
  const c = await (await pdf.getPage(i)).getTextContent();
  /* A folio is a short fragment with a digit; we take ALL of them, so as not to guess. */
  const items = c.items.map((it) => it.str.trim()).filter((s) => s.length > 0 && s.length <= 12 && /\d/.test(s));
  pages.push({ p: i, folio: items });
}
await writeFile(outJson, JSON.stringify(pages, null, 0));
console.log("сторінок:", pdf.numPages);
console.log("із цифровими фрагментами:", pages.filter((x) => x.folio.length > 0).length);
console.log("приклади:", JSON.stringify(pages.slice(0, 3)), "...", JSON.stringify(pages.slice(96, 99)));

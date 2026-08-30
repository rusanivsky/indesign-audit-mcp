import {
  PDFDocument,
  StandardFonts,
  PDFName,
  PDFString,
  PDFArray,
  PDFNumber,
  degrees,
  type PDFFont,
} from "pdf-lib";
import { writeFile } from "node:fs/promises";

export interface MakeAnnotatedPdfOptions {
  /** Стандартний шрифт для основного рядка тексту. За замовчуванням Helvetica. */
  font?: (typeof StandardFonts)[keyof typeof StandardFonts];
}

/**
 * Створює PDF з відомим текстом і трьома анотаціями:
 * StrikeOut над словом "старе", Highlight над словом "друге", і sticky note
 * поруч зі словом "tut" (щоб можна було перевірити контекст нотатки).
 * Координати рахуються від відомої позиції тексту, щоб тест був детермінованим.
 *
 * `options.font` дозволяє перегенерувати той самий сценарій іншим шрифтом —
 * так перевіряється, що відновлення розміченого тексту не залежить від
 * жорстко зашитої таблиці ширин символів Helvetica (див. звіт Task 4, C2).
 */
export async function makeAnnotatedPdf(
  outPath: string,
  options: MakeAnnotatedPdfOptions = {},
): Promise<void> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 200]);
  const font = await doc.embedFont(options.font ?? StandardFonts.Helvetica);

  const line = "Pershe stare slovo i druge slovo tut.";
  const size = 12;
  const x = 20;
  const y = 150;
  page.drawText(line, { x, y, size, font });

  const widthUpTo = (n: number) => font.widthOfTextAtSize(line.slice(0, n), size);
  const quadFor = (from: number, to: number) => {
    const x1 = x + widthUpTo(from);
    const x2 = x + widthUpTo(to);
    const y1 = y - 2;
    const y2 = y + size;
    return [x1, y2, x2, y2, x1, y1, x2, y1];
  };

  const addMarkup = (subtype: string, from: number, to: number, contents: string) => {
    const quads = quadFor(from, to);
    const annot = doc.context.obj({
      Type: PDFName.of("Annot"),
      Subtype: PDFName.of(subtype),
      Rect: doc.context.obj([quads[0]!, quads[6]!, quads[2]!, quads[1]!]),
      QuadPoints: PDFArray.withContext(doc.context),
      Contents: PDFString.of(contents),
      T: PDFString.of("Korektor"),
      F: PDFNumber.of(4),
    });
    const qp = annot.get(PDFName.of("QuadPoints")) as PDFArray;
    for (const v of quads) qp.push(PDFNumber.of(v));
    page.node.addAnnot(doc.context.register(annot));
  };

  const startStare = line.indexOf("stare");
  addMarkup("StrikeOut", startStare, startStare + 5, "nove");

  const startDruge = line.indexOf("druge");
  addMarkup("Highlight", startDruge, startDruge + 5, "perevirty");

  // Sticky note навмисно поставлена біля слова "tut" (останнє слово рядка),
  // а не в довільній точці сторінки — щоб можна було перевірити, що контекст
  // нотатки прив'язується до найближчого тексту за координатами Rect.
  const startTut = line.lastIndexOf("tut");
  const tutX = x + widthUpTo(startTut);
  const note = doc.context.obj({
    Type: PDFName.of("Annot"),
    Subtype: PDFName.of("Text"),
    Rect: doc.context.obj([tutX - 5, y - 5, tutX + 20, y + size + 10]),
    Contents: PDFString.of("zagalnyi komentar"),
    T: PDFString.of("Korektor"),
    F: PDFNumber.of(4),
  });
  page.node.addAnnot(doc.context.register(note));

  await writeFile(outPath, await doc.save());
}

/**
 * Створює PDF із ДВОМА рядками тексту й однією анотацією StrikeOut, розмітка
 * якої перетинає розрив рядка (два квади: один на кінці першого рядка, інший
 * на початку другого). Перевіряє, що collectPageText не губить розрив рядка
 * і правильно вставляє роздільник між рядками (Task 4 звіт, C1).
 */
export async function makeTwoLineAnnotatedPdf(outPath: string): Promise<void> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 200]);
  const font: PDFFont = await doc.embedFont(StandardFonts.Helvetica);
  const size = 12;
  const x = 20;

  const line1 = "Pershe rechennia mistyt stare";
  const y1 = 160;
  page.drawText(line1, { x, y: y1, size, font });

  const line2 = "slovo yake tut.";
  const y2 = 140;
  page.drawText(line2, { x, y: y2, size, font });

  const quadForLine = (line: string, y: number, from: number, to: number) => {
    const widthUpTo = (n: number) => font.widthOfTextAtSize(line.slice(0, n), size);
    const x1 = x + widthUpTo(from);
    const x2 = x + widthUpTo(to);
    const y1q = y - 2;
    const y2q = y + size;
    return [x1, y2q, x2, y2q, x1, y1q, x2, y1q];
  };

  const start1 = line1.indexOf("stare");
  const quad1 = quadForLine(line1, y1, start1, start1 + "stare".length);

  const word2 = "slovo";
  const quad2 = quadForLine(line2, y2, 0, word2.length);

  const annot = doc.context.obj({
    Type: PDFName.of("Annot"),
    Subtype: PDFName.of("StrikeOut"),
    Rect: doc.context.obj([quad1[0]!, quad2[6]!, quad2[2]!, quad1[1]!]),
    QuadPoints: PDFArray.withContext(doc.context),
    Contents: PDFString.of("nove misto"),
    T: PDFString.of("Korektor"),
    F: PDFNumber.of(4),
  });
  const qp = annot.get(PDFName.of("QuadPoints")) as PDFArray;
  for (const v of [...quad1, ...quad2]) qp.push(PDFNumber.of(v));
  page.node.addAnnot(doc.context.register(annot));

  await writeFile(outPath, await doc.save());
}

/**
 * Створює PDF із ДВОМА рядками: звичайним горизонтальним і повернутим на 90°
 * (бічна колонка, як у журналі). Обидва мають власну Highlight-анотацію.
 *
 * Потрібен для I5: `charEdges` рухається лише по +x, тож для повернутого чи
 * вертикального тексту витягнутий текст — сміття, яке йде прямо в поле `old`
 * правки. Друга (горизонтальна) анотація тут не менш важлива: захист від
 * повернутого тексту не сміє заодно вбити читання нормальних анотацій на тій
 * самій сторінці.
 */
export async function makeRotatedAnnotatedPdf(outPath: string): Promise<void> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 300]);
  const font: PDFFont = await doc.embedFont(StandardFonts.Helvetica);
  const size = 12;

  const addMarkup = (quads: number[], contents: string) => {
    const annot = doc.context.obj({
      Type: PDFName.of("Annot"),
      Subtype: PDFName.of("Highlight"),
      Rect: doc.context.obj([quads[0]!, quads[6]!, quads[2]!, quads[1]!]),
      QuadPoints: PDFArray.withContext(doc.context),
      Contents: PDFString.of(contents),
      T: PDFString.of("Korektor"),
      F: PDFNumber.of(4),
    });
    const qp = annot.get(PDFName.of("QuadPoints")) as PDFArray;
    for (const v of quads) qp.push(PDFNumber.of(v));
    page.node.addAnnot(doc.context.register(annot));
  };

  // Горизонтальний рядок і розмітка над словом "ryadok".
  const flat = "Horyzontalnyi ryadok tut.";
  const fx = 100;
  const fy = 250;
  page.drawText(flat, { x: fx, y: fy, size, font });
  const upTo = (n: number) => font.widthOfTextAtSize(flat.slice(0, n), size);
  const from = flat.indexOf("ryadok");
  const to = from + "ryadok".length;
  addMarkup(
    [fx + upTo(from), fy + size, fx + upTo(to), fy + size, fx + upTo(from), fy - 2, fx + upTo(to), fy - 2],
    "flat",
  );

  // Повернутий на 90° рядок: текст іде вгору, гліфи — ліворуч від базової лінії.
  const side = "Vertykalnyi tekst zboku.";
  const vx = 40;
  const vy = 40;
  page.drawText(side, { x: vx, y: vy, size, font, rotate: degrees(90) });
  const sideUpTo = (n: number) => font.widthOfTextAtSize(side.slice(0, n), size);
  const word = "Vertykalnyi";
  const x1 = vx - size - 2;
  // Квад навмисно ширший за базову лінію: так стара посимвольна інтерполяція
  // (яка рухається лише по +x) впіймає кілька перших символів і віддасть сміття.
  const x2 = vx + 30;
  const y1 = vy - 2;
  const y2 = vy + sideUpTo(word.length);
  addMarkup([x1, y2, x2, y2, x1, y1, x2, y1], "side");

  await writeFile(outPath, await doc.save());
}

import { describe, it, expect, beforeAll } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { StandardFonts } from "pdf-lib";
import {
  makeAnnotatedPdf,
  makeTwoLineAnnotatedPdf,
  makeRotatedAnnotatedPdf,
} from "../fixtures/make-annotated-pdf.js";
import { readPdfAnnotations, stripPdfLineBreaks } from "../../src/corrections/pdf-annots.js";
import type { PdfAnnotation } from "../../src/corrections/pdf-annots.js";

async function tmpFile(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "idmcp-pdf-"));
  return join(dir, name);
}

describe("readPdfAnnotations — базовий сценарій (Helvetica)", () => {
  let annots: PdfAnnotation[];

  beforeAll(async () => {
    const file = await tmpFile("annotated.pdf");
    await makeAnnotatedPdf(file);
    annots = await readPdfAnnotations(file);
  });

  it("читає всі три анотації", () => {
    expect(annots).toHaveLength(3);
  });

  it("витягує закреслений текст і коментар коректора точно, без зайвих пробілів по краях", () => {
    const a = annots.find((x) => x.type === "StrikeOut")!;
    // Без .trim() навмисно: провідний/кінцевий пробіл — саме той клас похибки
    // меж, який має ловити цей тест (Task 4 звіт, C2).
    expect(a.markedText).toBe("stare");
    expect(a.note).toBe("nove");
    expect(a.page).toBe(1);
    expect(a.author).toBe("Korektor");
  });

  it("витягує підсвічений текст точно, без зайвих символів по краях", () => {
    const a = annots.find((x) => x.type === "Highlight")!;
    expect(a.markedText).toBe("druge");
    expect(a.note).toBe("perevirty");
  });

  it("нотатка без розмітки не має markedText, але контекст прив'язаний до найближчого тексту (Rect)", () => {
    const a = annots.find((x) => x.type === "Text")!;
    expect(a.markedText).toBe("");
    expect(a.note).toBe("zagalnyi komentar");
    // Sticky note у фікстурі поставлена біля слова "tut" — контекст має це
    // відображати, інакше конвеєру нема за що зачепитись, шукаючи місце правки.
    expect(a.contextBefore + a.contextAfter).toContain("tut");
  });

  it("дає контекст навколо розміченого фрагмента", () => {
    const a = annots.find((x) => x.type === "StrikeOut")!;
    expect(a.contextBefore).toContain("Pershe");
    expect(a.contextAfter).toContain("slovo");
  });
});

describe("readPdfAnnotations — розмітка перетинає розрив рядка (C1)", () => {
  let annots: PdfAnnotation[];

  beforeAll(async () => {
    const file = await tmpFile("two-line.pdf");
    await makeTwoLineAnnotatedPdf(file);
    annots = await readPdfAnnotations(file);
  });

  it("відновлює текст із двох рядків із пробілом на місці розриву, а не склеєним словом", () => {
    const a = annots.find((x) => x.type === "StrikeOut")!;
    // Без вставки "\n" на hasEOL рядки склеюються без роздільника
    // ("stareslovo") замість коректного "stare slovo".
    expect(a.markedText).toBe("stare slovo");
  });
});

describe("readPdfAnnotations — інший шрифт, не Helvetica (C2)", () => {
  let annots: PdfAnnotation[];

  beforeAll(async () => {
    const file = await tmpFile("times-roman.pdf");
    await makeAnnotatedPdf(file, { font: StandardFonts.TimesRoman });
    annots = await readPdfAnnotations(file);
  });

  it("відновлює закреслений текст точно навіть коли шрифт документа не Helvetica", () => {
    const a = annots.find((x) => x.type === "StrikeOut")!;
    // Жорстко зашита таблиця ширин Helvetica для Times-Roman неточна —
    // без прив'язки до меж слів це дає " star" (зайвий пробіл, відрізана "e").
    expect(a.markedText).toBe("stare");
  });

  it("відновлює підсвічений текст точно навіть коли шрифт документа не Helvetica", () => {
    const a = annots.find((x) => x.type === "Highlight")!;
    // Без прив'язки до меж слів це дає зсунутий/відрізаний фрагмент
    // (наприклад " druge" із зайвим пробілом попереду).
    expect(a.markedText).toBe("druge");
  });
});

/*
 * Task 9, борг Task 4: журнал проєкту прямо казав, що виняток на пошкодженому
 * PDF летить сирим (напр. "Invalid PDF structure." від pdfjs — незрозуміло
 * оператору, що саме сталося і що робити). Ці тести перевіряють, що
 * readPdfAnnotations на непрочитному, відсутньому й не-PDF файлі кидає
 * повідомлення, яке прямо називає причину і підказує дію — а не сирий
 * виняток pdfjs чи Node fs.
 */
describe("readPdfAnnotations — зрозумілі повідомлення про помилки (борг Task 4)", () => {
  it("відсутній файл: повідомлення каже, що файл не знайдено", async () => {
    const missing = await tmpFile("nema-takoho.pdf");
    await expect(readPdfAnnotations(missing)).rejects.toThrow(/not found/);
  });

  it("непрочитний файл (немає прав): повідомлення каже про права доступу, а не сирий код ОС", async () => {
    const path = await tmpFile("bez-prav.pdf");
    await writeFile(path, "%PDF-1.4 fake");
    await chmod(path, 0o000);
    try {
      await expect(readPdfAnnotations(path)).rejects.toThrow(/access permissions/);
    } finally {
      // Відновлюємо права, інакше тимчасову теку не вдасться прибрати.
      await chmod(path, 0o644);
    }
  });

  it("не-PDF файл: повідомлення каже, що файл пошкоджений або не PDF, а не сирий текст pdfjs", async () => {
    const path = await tmpFile("ne-pdf.txt");
    await writeFile(path, "це звичайний текстовий файл, а не PDF");
    await expect(readPdfAnnotations(path)).rejects.toThrow(/not a valid PDF|corrupted/);
  });
});

/*
 * I5 (борг Task 4, підтверджений фінальною рецензією): charEdges рухається
 * лише по +x, тож для повернутого чи вертикального тексту (бічні колонки в
 * журналі) витягнутий текст — сміття, яке йде ПРЯМО в поле `old` правки.
 * Виміряно на цій фікстурі: до фіксу розмітка над словом "Vertykalnyi"
 * віддавала markedText "Verty".
 */
describe("readPdfAnnotations — повернутий і вертикальний текст (I5)", () => {
  let annots: PdfAnnotation[];

  beforeAll(async () => {
    const file = await tmpFile("rotated.pdf");
    await makeRotatedAnnotatedPdf(file);
    annots = await readPdfAnnotations(file);
  });

  it("замість сміття повертає порожній текст і прямо каже, чому", () => {
    const side = annots.find((a) => a.note === "side")!;
    expect(side.markedText).toBe("");
    expect(side.markedTextIssue).toMatch(/rotated|vertical/i);
  });

  it("анотація не зникає зі списку — користувач бачить, що її не прочитано", () => {
    expect(annots).toHaveLength(2);
    expect(annots.map((a) => a.note).sort()).toEqual(["flat", "side"]);
  });

  it("горизонтальна анотація на тій самій сторінці читається як і раніше", () => {
    const flat = annots.find((a) => a.note === "flat")!;
    expect(flat.markedText).toBe("ryadok");
    expect(flat.markedTextIssue).toBeUndefined();
  });
});

describe("stripPdfLineBreaks — прямі юніт-тести (I1)", () => {
  it("зберігає справжній дефіс на межі перенесеного рядка", () => {
    expect(stripPdfLineBreaks("synio-\nzhovtyi")).toBe("synio-zhovtyi");
  });

  it("прибирає м'який перенос (U+00AD) разом із розривом рядка", () => {
    expect(stripPdfLineBreaks("sy­\nnio")).toBe("synio");
  });

  it("перетворює звичайний розрив рядка на пробіл", () => {
    expect(stripPdfLineBreaks("Persha stroka\nDruga stroka")).toBe("Persha stroka Druga stroka");
  });

  it("не займає текст без розривів рядка", () => {
    expect(stripPdfLineBreaks("zvychainyi tekst")).toBe("zvychainyi tekst");
  });
});

import { describe, it, expect, vi } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";

/*
 * Рецензія Task 9, fix round 1 (Important): readPdfAnnotations раніше
 * викликала loadingTask.destroy() лише в другому try/finally, недосяжному,
 * якщо саме loadingTask.promise відхилявся (невалідний/пошкоджений PDF) —
 * рецензент простежив у node_modules/pdfjs-dist, що getDocument() синхронно
 * піднімає фейковий воркер у Node ще ДО того, як відомо, чи PDF валідний,
 * тож цей шлях відмови лишав воркер і кеш шрифтів живими назавжди.
 *
 * Щоб довести це БЕЗ залежності від внутрішньої структури pdfjs (яка не
 * дає перехопити чи підмінити свій PDFDocumentLoadingTask ззовні), тут
 * підміняється сам модуль pdfjs-dist: getDocument повертає підроблений
 * loadingTask із promise, що ЗАВЖДИ відхиляється, і зі шпигуном на destroy().
 * vi.mock діє лише в межах цього файлу (vitest ізолює модулі між тестовими
 * файлами за замовчуванням) — решта tests/unit/pdf-annots.test.ts і далі
 * працює з реальним pdfjs і реальними згенерованими PDF.
 */
const destroyMock = vi.fn(async () => {});

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  getDocument: () => ({
    promise: Promise.reject(
      Object.assign(new Error("Invalid PDF structure."), { name: "InvalidPDFException" }),
    ),
    destroy: destroyMock,
  }),
}));

const { readPdfAnnotations } = await import("../../src/corrections/pdf-annots.js");

async function tmpFile(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "idmcp-pdf-cleanup-"));
  const path = join(dir, name);
  // Вміст ігнорується: getDocument замокано і не читає data взагалі.
  await writeFile(path, "dummy");
  return path;
}

describe("readPdfAnnotations — звільнення ресурсів pdfjs при відмові завантаження (рецензія Task 9, fix round 1)", () => {
  it("викликає loadingTask.destroy() рівно один раз, навіть коли loadingTask.promise відхиляється", async () => {
    const path = await tmpFile("pomylkovyi.pdf");

    await expect(readPdfAnnotations(path)).rejects.toThrow(/not a valid PDF|corrupted/);

    expect(destroyMock).toHaveBeenCalledTimes(1);
  });
});

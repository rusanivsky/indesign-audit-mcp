import { describe, it, expect, beforeAll } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { makeAnnotatedPdf } from "../fixtures/make-annotated-pdf.js";
import { registerPdfTools } from "../../src/tools/pdf.js";
import type { Tools } from "../../src/tools/shared.js";
import type { PdfAnnotation } from "../../src/corrections/pdf-annots.js";

/*
 * Рецензія Task 9, fix round 1: src/tools/pdf.ts не мав жодного тесту, хоча
 * фільтр за `types` і форма відповіді (count/annotations) — це чиста
 * TypeScript-логіка, яка не потребує InDesign. Перехоплюємо обробник, який
 * registerPdfTools передає в server.registerTool, підробленим "сервером" —
 * так само, як реальний McpServer, лише без мережі й протоколу MCP.
 */
type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
type ToolHandler = (args: { path: string; types?: string[] }) => Promise<ToolResult>;

function captureHandler(register: (server: Tools) => void): ToolHandler {
  let captured: ToolHandler | undefined;
  const fakeServer = {
    registerTool: (_name: string, _config: unknown, handler: ToolHandler) => {
      captured = handler;
    },
  } as unknown as Tools;

  register(fakeServer);
  if (!captured) throw new Error("registerPdfTools не викликав server.registerTool.");
  return captured;
}

describe("pdf_read_annotations (обгортка src/tools/pdf.ts)", () => {
  let filePath: string;

  beforeAll(async () => {
    const dir = await mkdtemp(join(tmpdir(), "idmcp-pdf-tool-"));
    filePath = join(dir, "annotated.pdf");
    // Фікстура з трьома анотаціями: StrikeOut, Highlight, Text
    // (tests/fixtures/make-annotated-pdf.ts — та сама, що й у pdf-annots.test.ts).
    await makeAnnotatedPdf(filePath);
  });

  it("без types повертає всі анотації, count відповідає довжині масиву", async () => {
    const handler = captureHandler(registerPdfTools);
    const result = await handler({ path: filePath });

    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0]!.text) as { count: number; annotations: PdfAnnotation[] };
    expect(data.annotations).toHaveLength(3);
    expect(data.count).toBe(data.annotations.length);
  });

  it("з types лишає лише вказані типи", async () => {
    const handler = captureHandler(registerPdfTools);
    const result = await handler({ path: filePath, types: ["StrikeOut"] });

    const data = JSON.parse(result.content[0]!.text) as { count: number; annotations: PdfAnnotation[] };
    expect(data.count).toBe(1);
    expect(data.annotations).toHaveLength(1);
    expect(data.annotations[0]!.type).toBe("StrikeOut");
  });

  it("з types, що охоплює кілька типів, лишає їх усі й нічого зайвого", async () => {
    const handler = captureHandler(registerPdfTools);
    const result = await handler({ path: filePath, types: ["Highlight", "Text"] });

    const data = JSON.parse(result.content[0]!.text) as { count: number; annotations: PdfAnnotation[] };
    expect(data.count).toBe(2);
    expect([...data.annotations.map((a) => a.type)].sort()).toEqual(["Highlight", "Text"]);
  });

  it("з types, що не збігається з жодним типом у файлі, повертає порожній список, а не помилку", async () => {
    const handler = captureHandler(registerPdfTools);
    const result = await handler({ path: filePath, types: ["Underline"] });

    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0]!.text) as { count: number; annotations: PdfAnnotation[] };
    expect(data.count).toBe(0);
    expect(data.annotations).toEqual([]);
  });

  it("помилку (відсутній файл) повертає як isError із зрозумілим текстом, а не кидає виняток протоколу", async () => {
    const handler = captureHandler(registerPdfTools);
    const missing = join(tmpdir(), "nema-takoho-pdf-tool-xyz.pdf");

    const result = await handler({ path: missing });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/not found/);
  });
});

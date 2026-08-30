import { z } from "zod";
import { readPdfAnnotations } from "../corrections/pdf-annots.js";
import { fail, ok, type Tools } from "./shared.js";

export function registerPdfTools(server: Tools): void {
  server.registerTool(
    "pdf_read_annotations",
    {
      title: "Proofreader annotations from PDF",
      description:
        "Reads annotations from a PDF: type (StrikeOut, Highlight, Underline, Caret, Text), page, author, comment text, the marked text and the context around it. If an annotation carries markedTextIssue, the marked text could not be extracted (e.g. a rotated or vertical fragment) — markedText is empty and it must NOT be used as old: fill old in by hand from the PDF itself. Changes nothing — the result is then turned into a list of edits for corrections_plan.",
      inputSchema: {
        path: z.string().describe("Full path to the PDF file."),
        types: z
          .array(z.string())
          .optional()
          .describe('Keep only the listed types, e.g. ["StrikeOut", "Highlight"].'),
      },
    },
    async ({ path, types }) => {
      try {
        const all = await readPdfAnnotations(path);
        const filtered = types ? all.filter((a) => types.includes(a.type)) : all;
        return ok({ count: filtered.length, annotations: filtered });
      } catch (e) {
        return fail(e);
      }
    },
  );
}

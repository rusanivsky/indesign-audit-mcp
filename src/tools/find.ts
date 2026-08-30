import { z } from "zod";
import { runJsx } from "../bridge/runner.js";
import { findOccurrences } from "../corrections/matcher.js";
import type { ContainerSnapshot, Warning } from "../corrections/types.js";
import { fail, ok, type Tools } from "./shared.js";

export interface RangeStyleInfo {
  containerId: string;
  start: number;
  end: number;
  charStyles: string[];
  paraStyles: string[];
}

/** Styles for specific ranges; an empty input never calls InDesign. */
export async function inspectRanges(
  ranges: { containerId: string; start: number; end: number }[],
): Promise<RangeStyleInfo[]> {
  if (ranges.length === 0) return [];
  const r = await runJsx<{ results: RangeStyleInfo[] }>("ranges_inspect", { ranges });
  return r.results;
}

/** Warnings about several styles overlapping within a range. */
export function styleWarnings(info: RangeStyleInfo): Warning[] {
  const w: Warning[] = [];
  if (info.charStyles.length > 1) w.push("multiple-char-styles");
  if (info.paraStyles.length > 1) w.push("multiple-para-styles");
  return w;
}

export function registerFindTools(server: Tools): void {
  server.registerTool(
    "text_find",
    {
      title: "Find text",
      description:
        "Searches for text in the active document. Plain mode is resilient to hyphenation, non-breaking spaces and differing quotation marks, and returns docName plus matches with their container, character offsets, page and surrounding context (contextBefore/contextAfter). Grep mode passes the expression to InDesign's own search and returns ONLY {containerId, start, end, text} — no docName, no page and no context; if you need page and context, search in plain mode.",
      inputSchema: {
        query: z.string().describe("Text or GREP expression."),
        mode: z.enum(["plain", "grep"]).default("plain"),
        limit: z.number().int().positive().max(500).default(100),
      },
    },
    async ({ query, mode, limit }) => {
      try {
        if (mode === "grep") {
          return ok(await runJsx("grep_find", { pattern: query, limit }));
        }

        const read = await runJsx<{ docName: string; containers: ContainerSnapshot[] }>(
          "containers_read",
          {},
        );
        const matches = [];
        for (const c of read.containers) {
          for (const m of findOccurrences(c.text, query)) {
            matches.push({
              containerId: c.containerId,
              start: m.start,
              end: m.end,
              page: c.pageRuns.find((r) => m.start >= r.start && m.start < r.end)?.page ?? "?",
              contextBefore: c.text.slice(Math.max(0, m.start - 40), m.start),
              matchText: c.text.slice(m.start, m.end),
              contextAfter: c.text.slice(m.end, m.end + 40),
            });
            if (matches.length >= limit) break;
          }
          if (matches.length >= limit) break;
        }
        return ok({ docName: read.docName, matches });
      } catch (e) {
        return fail(e);
      }
    },
  );
}

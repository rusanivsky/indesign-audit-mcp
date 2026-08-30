import { z } from "zod";
import { runJsx } from "../bridge/runner.js";
import {
  DEFAULT_MAX_STORIES,
  OVERVIEW_SECTIONS,
  shapeOverview,
  type RawOverview,
} from "../inspect/overview.js";
import { fail, ok, type Tools } from "./shared.js";

export function registerInspectTools(server: Tools): void {
  server.registerTool(
    "doc_overview",
    {
      title: "Document overview",
      description:
        "Structure of the active document: pages, stories with their length and an overset flag, " +
        "paragraph and character styles, fonts, links. The totals block is ALWAYS present and is " +
        "counted before any truncation — its numbers are complete even when the response carries " +
        "no listing at all. The story listing is truncated to maxStories, and storiesTruncated " +
        "{ shown, total, rule } then appears: a silent cut would read as \"these are all the stories\". " +
        "The most informative ones are shown — overset first, then by length; the order is the same " +
        "without truncation. Sections are chosen through sections — on a 196-page book the full " +
        "response weighed 122,582 B and would not fit back, and the stories alone accounted for 90 % " +
        "of that. To obtain the containerId of every story for story_read, raise maxStories.",
      inputSchema: {
        sections: z
          .array(z.enum(OVERVIEW_SECTIONS))
          .default([...OVERVIEW_SECTIONS])
          .describe(
            "Which sections to put in the response. A section not named will be absent ENTIRELY, " +
              "but its numbers stay in totals.",
          ),
        maxStories: z
          .number()
          .int()
          .min(1)
          .max(5000)
          .default(DEFAULT_MAX_STORIES)
          .describe(
            `How many story rows to show. The default ${DEFAULT_MAX_STORIES} comes from measurement: ` +
              "a row weighs ≈131 B, so 60 rows ≈8 KB. Raising the ceiling on a document with hundreds " +
              "of stories returns the same response that the client then truncates.",
          ),
      },
    },
    async ({ sections, maxStories }) => {
      try {
        const raw = await runJsx<RawOverview>("doc_overview", {});
        return ok(shapeOverview(raw, { sections, maxStories }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "story_read",
    {
      title: "Read text",
      description:
        "Returns the text of all or selected text containers of the active document together with character offsets, a page breakdown and an overset flag. A container is a story, a table cell or a footnote.",
      inputSchema: {
        containerIds: z
          .array(z.string())
          .optional()
          .describe('Restrict the listing, e.g. ["story:0", "story:3/footnote:1"]. Without this — all of them.'),
      },
    },
    async ({ containerIds }) => {
      try {
        return ok(await runJsx("containers_read", { containerIds }));
      } catch (e) {
        return fail(e);
      }
    },
  );
}

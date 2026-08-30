import { z } from "zod";
import { runJsx } from "../bridge/runner.js";
import { fail, ok, type Tools } from "./shared.js";

export function registerRunTool(server: Tools): void {
  server.registerTool(
    "indesign_run_jsx",
    {
      title: "Run ExtendScript",
      description:
        "Runs arbitrary ExtendScript in InDesign and returns the value of the __result variable as JSON. The code must be ES3: only var, function and ordinary loops. Execution is wrapped in a single undo step. Used for one-off tasks that do not yet have a dedicated tool.",
      inputSchema: {
        script: z
          .string()
          .describe("The ES3 script body. Put the result in the __result variable."),
        undoName: z.string().default("InDesign script").describe("Name of the step in the undo history."),
      },
    },
    async ({ script, undoName }) => {
      try {
        return ok(await runJsx("run_script", { script, undoName }, { timeoutMs: 120_000 }));
      } catch (e) {
        return fail(e);
      }
    },
  );
}

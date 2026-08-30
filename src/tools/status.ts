import { runJsx } from "../bridge/runner.js";
import { fail, ok, type Tools } from "./shared.js";

export function registerStatusTool(server: Tools): void {
  server.registerTool(
    "indesign_status",
    {
      title: "InDesign status",
      description:
        "Checks whether InDesign is running and returns the version, the list of open documents, the active document and the open books (.indb).",
      inputSchema: {},
    },
    async () => {
      try {
        return ok(await runJsx("status", {}));
      } catch (e) {
        return fail(e);
      }
    },
  );
}
